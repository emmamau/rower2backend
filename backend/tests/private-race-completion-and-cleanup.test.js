const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { RaceManager } = require('../dist/services/race-manager.service');
const { getRaceLeaderboard } = require('../dist/controllers/race.controller');
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
  initTelemetryRoutes(app);
  app.get('/api/race/:id/leaderboard', getRaceLeaderboard);
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

test('1. Private race completion removes salon from active pools but preserves leaderboard', async () => {
  const raceManager = RaceManager.getInstance();
  const race = raceManager.createPrivateRace({
    title: 'Salon Final Test',
    targetDistance: 500,
    hostUserId: 'host_cleanup_user',
    maxDurationMinutes: 15,
  });

  const raceId = race.id;
  const pinCode = race.pinCode;
  const meetCode = race.code;

  race.status = 'RUNNING';
  race.startedAt = new Date(Date.now() - 30 * 1000);

  // Record activities
  userStore.recordActivity({
    id: `${raceId}_racer1`,
    activityId: raceId,
    userId: 'racer1',
    userName: 'Racer Un',
    status: 'finished',
    netDistance: 500,
    targetDistance: 500,
    elapsedTime: 95,
    isBot: false,
    update: async () => {},
  });

  userStore.recordActivity({
    id: `${raceId}_racer2`,
    activityId: raceId,
    userId: 'racer2',
    userName: 'Racer Deux',
    status: 'finished',
    netDistance: 500,
    targetDistance: 500,
    elapsedTime: 102,
    isBot: false,
    update: async () => {},
  });

  // Tick private races to trigger completion
  await raceManager.tickPrivateRaces();

  // Race is now COMPLETED
  assert.equal(race.status, 'COMPLETED');

  // Salon must be deleted from active in-memory collections
  assert.equal(raceManager.findPrivateRace(raceId), null);
  assert.equal(raceManager.findPrivateRace(meetCode), null);
  if (pinCode) {
    assert.equal(raceManager.findPrivateRace(pinCode), null);
  }

  // Attempting to restart or reset the completed salon must be rejected (410)
  const restartResult = raceManager.startOrResetPrivateRace(raceId, {
    hostUserId: 'host_cleanup_user',
    reset: true,
  });
  assert.ok('error' in restartResult);
  assert.equal(restartResult.statusCode, 404); // Not found in memory

  // Joining must also fail
  const joinResult = raceManager.joinPrivateRace(raceId, 'late_user');
  assert.ok('error' in joinResult);
  assert.equal(joinResult.statusCode, 404);
});

test('2. getRaceLeaderboard returns the preserved ranking after salon is deleted', async () => {
  const { baseUrl, close } = await createTestServer();

  try {
    const raceManager = RaceManager.getInstance();
    const race = raceManager.createPrivateRace({
      title: 'Salon Ranking Test',
      targetDistance: 1000,
      hostUserId: 'host_rank_test',
      maxDurationMinutes: 10,
    });

    const raceId = race.id;

    userStore.recordActivity({
      id: `${raceId}_player_a`,
      activityId: raceId,
      userId: 'player_a',
      userName: 'Alice',
      status: 'finished',
      netDistance: 1000,
      targetDistance: 1000,
      elapsedTime: 200,
      isBot: false,
      update: async function (fields) {
        Object.assign(this, fields);
      },
      get: function (k) {
        return this[k];
      },
    });

    // Finish race
    await raceManager.finishRace(raceId, false, 'completed');

    // Salon is removed from memory
    assert.equal(raceManager.findPrivateRace(raceId), null);

    // Leaderboard endpoint must still return the ranking successfully
    const res = await fetch(`${baseUrl}/api/race/${raceId}/leaderboard`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.leaderboard));
    assert.ok(body.leaderboard.length >= 1);
    assert.equal(body.leaderboard[0].userId, 'player_a');
  } finally {
    await close();
  }
});
