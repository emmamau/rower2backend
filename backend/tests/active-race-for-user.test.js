const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { RaceManager } = require('../dist/services/race-manager.service');
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
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
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}

test('findActiveRaceForUser & GET /api/v1/races/my-active: resolves active room for user or watch and clears when completed/left', async () => {
  const { baseUrl, close } = await createTestServer();
  const raceManager = RaceManager.getInstance();

  try {
    // 1. Initial state: no active race
    const resEmpty = await fetch(`${baseUrl}/api/v1/races/my-active?userId=user_pin_tester`);
    const dataEmpty = await resEmpty.json();
    assert.equal(resEmpty.status, 200);
    assert.equal(dataEmpty.activeRoom, null);

    // 2. Create private race with PIN
    const created = raceManager.createPrivateRace({
      hostUserId: 'host_organizer',
      title: 'Salon Pin Test',
      targetDistance: 1000,
      pinCode: 'P9876',
      requireApproval: false
    });
    assert.ok(created);
    const raceId = created.id;

    // 3. User joins via PIN / deviceToken
    const joinRes = raceManager.joinPrivateRace(raceId, 'user_pin_tester', 'Rameur Tester', 'FR', {
      deviceToken: 'token_garmin_watch_999',
      viaPin: true,
      bypassApproval: true
    });
    assert.ok(!('error' in joinRes));

    // 4. Query active race by userId
    const resByUserId = await fetch(`${baseUrl}/api/v1/races/my-active?userId=user_pin_tester`);
    assert.equal(resByUserId.status, 200);
    const dataByUserId = await resByUserId.json();
    assert.ok(dataByUserId.activeRoom);
    assert.equal(dataByUserId.activeRoom.race.id, raceId);
    assert.equal(dataByUserId.activeRoom.race.pinCode, created.pinCode);

    // 5. Query active race by deviceToken (as watch appairing would send)
    const resByToken = await fetch(`${baseUrl}/api/v1/races/my-active?deviceToken=token_garmin_watch_999`);
    assert.equal(resByToken.status, 200);
    const dataByToken = await resByToken.json();
    assert.ok(dataByToken.activeRoom);
    assert.equal(dataByToken.activeRoom.race.id, raceId);

    // 6. Finish race -> should no longer be active
    await raceManager.finishRace(raceId, false, 'completed');
    const resAfterFinish = await fetch(`${baseUrl}/api/v1/races/my-active?userId=user_pin_tester`);
    const dataAfterFinish = await resAfterFinish.json();
    assert.equal(resAfterFinish.status, 200);
    assert.equal(dataAfterFinish.activeRoom, null);

  } finally {
    await close();
  }
});

test('GET /api/v1/races/user-enrolled: returns all enrolled salons and duels sorted by temporal priority', async () => {
  const { baseUrl, close } = await createTestServer();
  const raceManager = RaceManager.getInstance();

  try {
    const userId = 'virtual_player_07';

    // 1. Open lobby salon where player is host
    const hostSalon = raceManager.createPrivateRace({
      hostUserId: userId,
      title: 'Salon Hote',
      targetDistance: 2000,
      pinCode: 'H1111',
      requireApproval: false,
    });

    // 2. Scheduled salon starting in 5 minutes where player is participant
    const scheduledSoon = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const soonSalon = raceManager.createPrivateRace({
      hostUserId: 'other_organizer',
      title: 'Salon Imminent 5min',
      targetDistance: 1500,
      pinCode: 'S2222',
      startMode: 'scheduled',
      scheduledStartTime: scheduledSoon,
      requireApproval: false,
    });
    raceManager.joinPrivateRace(soonSalon.id, userId, 'Virtual 07', 'FR', {
      deviceToken: 'tok_virtual_07',
      viaPin: true,
      bypassApproval: true,
    });

    const res = await fetch(`${baseUrl}/api/v1/races/user-enrolled?userId=${userId}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.count >= 2);
    assert.ok(Array.isArray(body.enrolledRaces));

    // Scheduled race in 5min has higher priority than unscheduled open lobby
    assert.equal(body.recommendedRace.race.id, soonSalon.id);
    assert.equal(body.recommendedRace.pinCode, soonSalon.pinCode);
    assert.equal(body.recommendedRace.isEngagedOnLane, true);

    const hostEntry = body.enrolledRaces.find((r) => r.race.id === hostSalon.id);
    assert.ok(hostEntry);
    assert.equal(hostEntry.role, 'host');
    assert.equal(hostEntry.pinCode, hostSalon.pinCode);
  } finally {
    await close();
  }
});
