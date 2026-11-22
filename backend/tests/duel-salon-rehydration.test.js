const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const initRoomRoutes = require('../dist/routes/room.routes').default;
const db = require('../dist/models').default;
const raceManager = require('../dist/services/race-manager.service').default;
const duelService = require('../dist/services/duel.service').default;

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  initTelemetryRoutes(app);
  initRoomRoutes(app);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res))
      });
    });
  });
}

test('Duel salon rehydration: active duel room is restored on-the-fly when lost from RAM', async () => {
  const { baseUrl, close } = await createTestServer();
  const DuelChallenges = db.duelChallenges;
  const now = new Date();
  const slotStart = new Date(now.getTime() + 60 * 60 * 1000);
  const slotEnd = new Date(now.getTime() + 120 * 60 * 1000);
  const uniqueCode = 'tst-' + Math.random().toString(36).substring(2, 5) + '-due';
  const uniqueId = 'PRIV_DUEL_' + Date.now();
  const uniquePin = 'DL' + Math.floor(100 + Math.random() * 900);

  const testChallenge = {
    id: 'duel_rehydrate_test_' + Date.now(),
    challengerUserId: 'user_test_ch',
    challengerLogin: 'challenger_test',
    challengerName: 'Challenger Test',
    challengedUserId: 'user_test_df',
    challengedLogin: 'defender_test',
    challengedName: 'Defender Test',
    slotStart,
    slotEnd,
    timezone: 'Europe/Paris',
    targetDistance: 2000,
    title: 'Duel 1v1 Test Rehydration',
    roomId: uniqueId,
    roomCode: uniqueCode,
    roomPin: uniquePin,
    status: 'PENDING',
    expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  };

  try {
    // 1. Enregistrer le défi (in-memory + DB best-effort)
    await duelService.persistChallenge(testChallenge);

    // 2. S'assurer qu'il n'est PAS en mémoire vive (simulation redémarrage serveur)
    if (raceManager.findPrivateRace(uniqueCode)) {
      raceManager.closePrivateRace(uniqueCode, undefined, true);
    }
    assert.equal(raceManager.findPrivateRace(uniqueCode), null, 'Le salon ne doit pas être en RAM initialement');

    // 3. Appeler GET /api/v1/races/private/:identifier avec le code du salon
    const res = await fetch(`${baseUrl}/api/v1/races/private/${uniqueCode}`);
    assert.equal(res.status, 200, 'La requête doit réussir avec code 200');
    const data = await res.json();

    assert.equal(data.code, uniqueCode, 'Le code Meet doit être restauré à l\'identique');
    assert.equal(data.pinCode || data.pin, uniquePin, 'Le code PIN montre doit être restauré à l\'identique');
    assert.equal(data.race.isDuel1v1, true, 'Le salon restauré doit être en mode duel 1v1');
    assert.equal(data.race.targetDistance, 2000, 'La distance cible doit être conservée');

    // 4. Vérifier qu'il est désormais réhydraté en RAM
    const inMemory = raceManager.findPrivateRace(uniqueCode);
    assert.ok(inMemory !== null, 'Le salon doit maintenant être présent en RAM dans RaceManager');
    assert.equal(inMemory.id, uniqueId, 'L\'identifiant PRIV_ doit être préservé');

    // 5. Tester la réhydratation de masse au démarrage du serveur
    // On referme le salon
    raceManager.closePrivateRace(uniqueCode, undefined, true);
    assert.equal(raceManager.findPrivateRace(uniqueCode), null);
    // On appelle rehydrateDuelSalons()
    const count = await duelService.rehydrateDuelSalons();
    assert.ok(count >= 1, 'Au moins un salon actif doit être réhydraté');
    assert.ok(raceManager.findPrivateRace(uniqueCode) !== null, 'Le salon doit être réhydraté par rehydrateDuelSalons');
  } finally {
    try {
      await DuelChallenges.destroy({ where: { id: testChallenge.id } });
    } catch {}
    duelService.inMemoryChallenges.delete(testChallenge.id);
    raceManager.closePrivateRace(uniqueCode, undefined, true);
    await close();
  }
});

test('Duel salon rehydration: cancelled or expired duel returns 410 with precise message', async () => {
  const { baseUrl, close } = await createTestServer();
  const DuelChallenges = db.duelChallenges;
  const now = new Date();
  const pastSlotStart = new Date(now.getTime() - 120 * 60 * 1000);
  const pastSlotEnd = new Date(now.getTime() - 60 * 60 * 1000);
  const expiredCode = 'exp-' + Math.random().toString(36).substring(2, 5) + '-due';

  const expiredChallenge = {
    id: 'duel_expired_test_' + Date.now(),
    challengerUserId: 'user_test_ch',
    challengerLogin: 'challenger_test',
    challengerName: 'Challenger Test',
    challengedUserId: 'user_test_df',
    challengedLogin: 'defender_test',
    challengedName: 'Defender Test',
    slotStart: pastSlotStart,
    slotEnd: pastSlotEnd,
    timezone: 'Europe/Paris',
    targetDistance: 2000,
    title: 'Duel 1v1 Test Expired',
    roomId: 'PRIV_EXP_' + Date.now(),
    roomCode: expiredCode,
    roomPin: 'EX123',
    status: 'EXPIRED',
    expiresAt: new Date(now.getTime() - 1000),
    createdAt: now,
    updatedAt: now,
  };

  try {
    await duelService.persistChallenge(expiredChallenge);

    const res = await fetch(`${baseUrl}/api/v1/races/private/${expiredCode}`);
    assert.equal(res.status, 410, 'Un duel expiré doit retourner le statut HTTP 410');
    const data = await res.json();
    assert.ok(
      (data.error || data.message).includes('expiré'),
      `Le message d'erreur doit indiquer que le duel est expiré, obtenu: ${JSON.stringify(data)}`
    );
  } finally {
    try {
      await DuelChallenges.destroy({ where: { id: expiredChallenge.id } });
    } catch {}
    duelService.inMemoryChallenges.delete(expiredChallenge.id);
    await close();
  }
});
