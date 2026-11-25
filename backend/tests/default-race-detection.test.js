const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const raceManager = require('../dist/services/race-manager.service').default;
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const initRoomRoutes = require('../dist/routes/room.routes').default;
const db = require('../dist/models').default;

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
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((resClose) => server.close(resClose)),
      });
    });
  });
}

test('1. A scheduled race starting in 10 minutes is detected by findActiveRaceForUser', () => {
  const userId = 'user_scheduled_10m';
  const scheduledTime = new Date(Date.now() + 10 * 60 * 1000);

  const race = raceManager.createPrivateRace({
    title: 'Course Programmée 10 min',
    targetDistance: 2000,
    hostUserId: userId,
    hostUserName: 'Racer10m',
    startMode: 'scheduled',
    scheduledStartTime: scheduledTime,
  });

  const active = raceManager.findActiveRaceForUser(userId);
  assert.ok(active, 'La course prévue dans 10 min doit être détectée');
  assert.equal(active.id, race.id);
  assert.equal(active.startMode, 'scheduled');
});

test('2. A completed race (COMPLETED) where participant has not left (hasLeft !== true) is still returned', () => {
  const userId = 'user_finished_not_left';

  const race = raceManager.createPrivateRace({
    title: 'Course Terminée Non Quittée',
    targetDistance: 1000,
    hostUserId: 'host_completed',
    hostUserName: 'HostComp',
  });

  raceManager.joinPrivateRace(race.id, userId, 'RacerNotLeft', 'FR', { viaPin: true, bypassApproval: true });

  // Course terminée
  race.status = 'COMPLETED';
  const participant = race.participants.get(userId);
  assert.ok(participant, 'Le participant doit être présent');
  participant.hasLeft = false;

  const active = raceManager.findActiveRaceForUser(userId);
  assert.ok(active, 'La course COMPLETED doit toujours être retournée tant que le coureur n a pas quitté');
  assert.equal(active.id, race.id);
});

test('3. When participant has hasLeft = true or status === abandoned, findActiveRaceForUser returns null', () => {
  const userLeft = 'user_has_left';
  const userAbandoned = 'user_has_abandoned';

  const race = raceManager.createPrivateRace({
    title: 'Course Test Sortie et Abandon',
    targetDistance: 1000,
    hostUserId: 'host_abandon_test',
  });

  raceManager.joinPrivateRace(race.id, userLeft, 'RacerLeft', 'FR', { viaPin: true, bypassApproval: true });
  raceManager.joinPrivateRace(race.id, userAbandoned, 'RacerAbandoned', 'FR', { viaPin: true, bypassApproval: true });

  race.status = 'COMPLETED';

  // Cas A : hasLeft = true
  const pLeft = race.participants.get(userLeft);
  assert.ok(pLeft);
  pLeft.hasLeft = true;

  const activeLeft = raceManager.findActiveRaceForUser(userLeft);
  assert.equal(activeLeft, null, 'Un participant avec hasLeft = true ne doit plus avoir de salon actif');

  // Cas B : status = abandoned
  const pAbandoned = race.participants.get(userAbandoned);
  assert.ok(pAbandoned);
  pAbandoned.status = 'abandoned';

  const activeAbandoned = raceManager.findActiveRaceForUser(userAbandoned);
  assert.equal(activeAbandoned, null, 'Un participant avec status = abandoned ne doit plus avoir de salon actif');
});

test('4. When two scheduled races exist (e.g. 5 min and 12 min), the 5 min race is returned', () => {
  const userId = 'user_multi_scheduled';
  const time12m = new Date(Date.now() + 12 * 60 * 1000);
  const time5m = new Date(Date.now() + 5 * 60 * 1000);

  const race12m = raceManager.createPrivateRace({
    title: 'Course dans 12 min',
    targetDistance: 1000,
    hostUserId: 'host_other_1',
    startMode: 'scheduled',
    scheduledStartTime: time12m,
  });
  raceManager.joinPrivateRace(race12m.id, userId, 'MultiUser', 'FR', { viaPin: true, bypassApproval: true });

  const race5m = raceManager.createPrivateRace({
    title: 'Course dans 5 min',
    targetDistance: 1000,
    hostUserId: 'host_other_2',
    startMode: 'scheduled',
    scheduledStartTime: time5m,
  });
  raceManager.joinPrivateRace(race5m.id, userId, 'MultiUser', 'FR', { viaPin: true, bypassApproval: true });

  const active = raceManager.findActiveRaceForUser(userId);
  assert.ok(active, 'Une course programmée doit être retournée');
  assert.equal(active.id, race5m.id, 'La course la plus proche dans le temps (5m) doit être prioritaire sur 12m');
});

test('5. API GET /api/v1/races/my-active returns enriched activeRoom with isAwaitingWatchPin and pinCode', async () => {
  const { baseUrl, close } = await createTestServer();
  const userId = 'user_api_active_test';

  try {
    const race = raceManager.createPrivateRace({
      title: 'Salon API Default Test',
      targetDistance: 2000,
      hostUserId: userId,
      hostUserName: 'ApiTester',
      pinCode: 'PIN42',
    });

    const res = await fetch(`${baseUrl}/api/v1/races/my-active?userId=${userId}`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.ok(data.activeRoom, 'activeRoom doit être présent');
    assert.equal(data.activeRoom.isDefaultRace, true);
    assert.equal(data.activeRoom.pinCode, race.pinCode);
    assert.equal(data.activeRoom.isAwaitingWatchPin, true, 'isAwaitingWatchPin doit être true avant saisie montre');

    // Appel à leaveRoom
    const leaveRes = await fetch(`${baseUrl}/api/rooms/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: race.id, userId }),
    });
    assert.equal(leaveRes.status, 200);

    // Après leaveRoom, le salon ne doit plus être actif
    const resAfterLeave = await fetch(`${baseUrl}/api/v1/races/my-active?userId=${userId}`);
    const dataAfterLeave = await resAfterLeave.json();
    assert.equal(dataAfterLeave.activeRoom, null);
  } finally {
    await close();
  }
});

test('6. When a private race finishes (COMPLETED), findActiveRaceForUser still returns it until leavePrivateRace is called', async () => {
  const userId = 'user_finish_private_e2e';
  const race = raceManager.createPrivateRace({
    title: 'Course Finie Directe E2E',
    targetDistance: 500,
    hostUserId: 'host_e2e_tester',
    hostUserName: 'HostE2E',
  });
  raceManager.joinPrivateRace(race.id, userId, 'RacerE2E', 'FR', { viaPin: true, bypassApproval: true });

  // Appel direct à finishPrivateRace
  await raceManager.finishPrivateRace(race, 'completed');
  assert.equal(race.status, 'COMPLETED');

  // Toujours actif pour l'athlète
  const activeBeforeLeave = raceManager.findActiveRaceForUser(userId);
  assert.ok(activeBeforeLeave, 'La course finie doit rester la course par défaut en RAM');
  assert.equal(activeBeforeLeave.id, race.id);

  // Le participant quitte le salon
  const leaveOutcome = raceManager.leavePrivateRace(race.id, userId);
  assert.ok(leaveOutcome);

  // N'est plus actif
  const activeAfterLeave = raceManager.findActiveRaceForUser(userId);
  assert.equal(activeAfterLeave, null, 'Après leavePrivateRace, le salon ne doit plus être actif');
});
