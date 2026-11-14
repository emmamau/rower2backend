const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { RaceManager } = require('../dist/services/race-manager.service');
const { formatRaceStateResponse } = require('../dist/controllers/race.controller');
const initRaceRoutes = require('../dist/routes/race.routes').default;
const initRoomRoutes = require('../dist/routes/room.routes').default;
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const userStore = require('../dist/services/user-store.service').default;
const db = require('../dist/models').default;

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  initRaceRoutes(app);
  initRoomRoutes(app);
  initTelemetryRoutes(app);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((resClose) => {
            server.close(resClose);
          }),
      });
    });
  });
}

test('End-to-end: private room auto-close, admin max duration config, countdown and member exit lifecycle', async () => {
  const raceManager = RaceManager.getInstance();
  const testServer = await createTestServer();

  try {
    // -------------------------------------------------------------------------
    // Étape 1 : Vérifier la valeur par défaut privateMaxDurationMinutes = 55 min
    // et modifier via l'endpoint admin à 50 min.
    // -------------------------------------------------------------------------
    // S'assurer de réinitialiser la config à 55 avant de tester
    raceManager.updatePublicRaceConfig({ privateMaxDurationMinutes: 55 });

    // GET /api/race/admin/config
    const getRes = await fetch(`${testServer.baseUrl}/api/race/admin/config`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.success, true);
    assert.equal(getBody.config.privateMaxDurationMinutes, 55);

    // PUT /api/race/admin/config -> 50 min
    const putRes = await fetch(`${testServer.baseUrl}/api/race/admin/config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: 'admin',
        privateMaxDurationMinutes: 50,
      }),
    });
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.equal(putBody.success, true);
    assert.equal(putBody.config.privateMaxDurationMinutes, 50);
    assert.equal(raceManager.adminPrivateRaceConfig.maxDurationMinutes, 50);

    // -------------------------------------------------------------------------
    // Étape 2 : Créer une course privée -> vérifier que maxDurationMinutes vaut 50.
    // -------------------------------------------------------------------------
    const race1 = raceManager.createPrivateRace({
      title: 'E2E Timeout Race',
      targetDistance: 2000,
      hostUserId: 'host_e2e_1',
      requireApproval: false,
    });

    assert.equal(race1.maxDurationMinutes, 50);
    const race1Id = race1.id;
    const race1Code = race1.code;
    const race1Pin = race1.pinCode;

    // -------------------------------------------------------------------------
    // Étape 3 : Simuler le passage à RUNNING avec 2 participants ->
    // vérifier que formatRaceStateResponse renvoie remainingSeconds = 3000s
    // et formattedCountdown = "50m 00s".
    // -------------------------------------------------------------------------
    const joinOutcome = raceManager.joinPrivateRace(race1Code, 'guest_e2e_1', 'Guest 1', undefined, { ready: true });
    assert.equal('error' in joinOutcome, false);
    assert.equal(race1.participants.size, 2);

    const startTime = new Date();
    race1.status = 'RUNNING';
    race1.startedAt = startTime;

    const formattedInitial = formatRaceStateResponse(race1, startTime);
    assert.equal(formattedInitial.remainingSeconds, 3000); // 50 * 60 = 3000s
    assert.equal(formattedInitial.timing.remainingSeconds, 3000);
    assert.equal(formattedInitial.maxDurationSeconds, 3000);
    assert.equal(formattedInitial.formattedCountdown, '50m 0s');

    // Vérifier également avec 10 minutes écoulées (600s)
    const after10Min = new Date(startTime.getTime() + 10 * 60 * 1000);
    const formatted10Min = formatRaceStateResponse(race1, after10Min);
    assert.equal(formatted10Min.remainingSeconds, 2400); // 3000 - 600 = 2400s = 40m
    assert.equal(formatted10Min.elapsedSeconds, 600);
    assert.equal(formatted10Min.formattedCountdown, '40m 0s');

    // -------------------------------------------------------------------------
    // Étape 4 : Avancer artificiellement le temps au-delà de 50 min ->
    // appeler tickPrivateRaces() -> vérifier que la course passe en COMPLETED,
    // que removePrivateRaceInternal a libéré le PIN et supprimé la course des salons actifs.
    // -------------------------------------------------------------------------
    // Avancer startedAt à il y a 51 minutes (51 * 60 * 1000 ms)
    race1.startedAt = new Date(Date.now() - 51 * 60 * 1000);

    // Vérifier que race1 est toujours présente en mémoire avant tick
    assert.ok(raceManager.findPrivateRace(race1Id));
    assert.ok(raceManager.findPrivateRace(race1Code));
    if (race1Pin) {
      assert.ok(raceManager.findPrivateRace(race1Pin));
    }

    // Déclencher le tick
    await raceManager.tickPrivateRaces();

    // La course doit être passée en COMPLETED
    assert.equal(race1.status, 'COMPLETED');

    // removePrivateRaceInternal doit avoir supprimé la course et libéré le PIN
    assert.equal(raceManager.findPrivateRace(race1Id), null);
    assert.equal(raceManager.findPrivateRace(race1Code), null);
    if (race1Pin) {
      assert.equal(raceManager.findPrivateRace(race1Pin), null);
    }

    // -------------------------------------------------------------------------
    // Étape 5 : Créer un second salon privé avec 2 joueurs,
    // simuler le départ du joueur 1 -> salon toujours actif.
    // Simuler le départ du joueur 2 -> vérifier que le salon est immédiatement
    // fermé (roomClosed: true) et n'apparaît plus dans findPrivateRace.
    // -------------------------------------------------------------------------
    const race2 = raceManager.createPrivateRace({
      title: 'E2E Leave Room Race',
      targetDistance: 1000,
      hostUserId: 'host_e2e_2',
      requireApproval: false,
    });

    const race2Id = race2.id;
    const race2Code = race2.code;
    const race2Pin = race2.pinCode;

    // Ajouter le 2ème joueur
    const join2 = raceManager.joinPrivateRace(race2Code, 'guest_e2e_2', 'Guest 2', undefined, { ready: true });
    assert.equal('error' in join2, false);
    assert.equal(race2.participants.size, 2);

    // Départ du joueur 1 via leavePrivateRace
    const leaveRes1 = raceManager.leavePrivateRace(race2Id, 'guest_e2e_2');
    assert.equal('error' in leaveRes1, false);
    if (!('error' in leaveRes1)) {
      assert.equal(leaveRes1.success, true);
      assert.equal(leaveRes1.roomClosed, false);
      assert.equal(leaveRes1.remainingParticipants, 1);
    }
    // Le salon doit rester actif
    assert.ok(raceManager.findPrivateRace(race2Id));
    assert.ok(raceManager.findPrivateRace(race2Code));
    if (race2Pin) {
      assert.ok(raceManager.findPrivateRace(race2Pin));
    }

    // Départ du joueur 2 (dernier joueur) via l'API HTTP POST /api/rooms/leave
    const leaveHttpRes = await fetch(`${testServer.baseUrl}/api/rooms/leave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: race2Id,
        userId: 'host_e2e_2',
      }),
    });
    assert.equal(leaveHttpRes.status, 200);
    const leaveHttpData = await leaveHttpRes.json();
    assert.equal(leaveHttpData.success, true);
    assert.equal(leaveHttpData.roomClosed, true);
    assert.equal(leaveHttpData.remainingParticipants, 0);

    // Le salon doit être fermé et n'apparaître plus dans findPrivateRace
    assert.equal(raceManager.findPrivateRace(race2Id), null);
    assert.equal(raceManager.findPrivateRace(race2Code), null);
    if (race2Pin) {
      assert.equal(raceManager.findPrivateRace(race2Pin), null);
    }

    // Vérifier également qu'une tentative de rejoindre ou retrouver la course échoue
    assert.equal(raceManager.findPrivateRace(race2Code), null);
  } finally {
    await testServer.close();
  }
});
