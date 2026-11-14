const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { RaceManager } = require('../dist/services/race-manager.service');
const { formatRaceStateResponse } = require('../dist/controllers/race.controller');
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

test('1. formatRaceStateResponse: accurately calculates remainingSeconds and timing for RUNNING private race', () => {
  const raceManager = RaceManager.getInstance();
  const race = raceManager.createPrivateRace({
    title: 'Test Timing Race',
    targetDistance: 2000,
    hostUserId: 'host_timing',
    maxDurationMinutes: 10,
  });

  const now = new Date();
  const startAt = new Date(now.getTime() - 150 * 1000); // 150s ago = 2m 30s
  race.status = 'RUNNING';
  race.startedAt = startAt;

  const res = formatRaceStateResponse(race, now);
  assert.equal(res.timing.elapsedSeconds, 150);
  assert.equal(res.timing.maxDurationSeconds, 600);
  assert.equal(res.timing.remainingSeconds, 450);
  assert.equal(res.remainingSeconds, 450);
  assert.equal(res.elapsedSeconds, 150);
  assert.equal(res.maxDurationSeconds, 600);
  assert.equal(res.formattedCountdown, '7m 30s');

  // Verify it caps remainingSeconds at 0 when elapsed exceeds maxDuration
  const futureNow = new Date(startAt.getTime() + 700 * 1000); // 700s > 600s
  const resExceeded = formatRaceStateResponse(race, futureNow);
  assert.equal(resExceeded.timing.remainingSeconds, 0);
  assert.equal(resExceeded.remainingSeconds, 0);
  assert.equal(resExceeded.formattedCountdown, '0m 0s');
});

test('2. tickPrivateRaces: finishes race and closes room on timeout', async () => {
  const raceManager = RaceManager.getInstance();
  const race = raceManager.createPrivateRace({
    title: 'Test Timeout Race',
    targetDistance: 2000,
    hostUserId: 'host_timeout',
    maxDurationMinutes: 5,
  });

  const pinCode = race.pinCode;
  const raceId = race.id;
  const meetCode = race.code;

  // Set to RUNNING with startedAt 6 minutes ago (> maxDurationMinutes 5)
  race.status = 'RUNNING';
  race.startedAt = new Date(Date.now() - 6 * 60 * 1000);

  // Verify race is in memory before tick
  assert.ok(raceManager.findPrivateRace(raceId));

  // Tick private races
  await raceManager.tickPrivateRaces();

  // Status must be COMPLETED
  assert.equal(race.status, 'COMPLETED');

  // Salon must be removed from memory structures
  assert.equal(raceManager.findPrivateRace(raceId), null);
  assert.equal(raceManager.findPrivateRace(meetCode), null);
  if (pinCode) {
    assert.equal(raceManager.findPrivateRace(pinCode), null);
  }
});

test('3. tickPrivateRaces: finishes race and closes room when all participants finished', async () => {
  const raceManager = RaceManager.getInstance();
  const race = raceManager.createPrivateRace({
    title: 'Test Completed Race',
    targetDistance: 1000,
    hostUserId: 'host_completed',
    maxDurationMinutes: 30,
  });

  const raceId = race.id;
  race.status = 'RUNNING';
  race.startedAt = new Date(Date.now() - 60 * 1000);

  // Record finished activity in userStore (DB fallback safe)
  userStore.recordActivity({
    id: `${raceId}_user1`,
    activityId: raceId,
    userId: 'user1',
    userName: 'User 1',
    status: 'finished',
    netDistance: 1000,
    targetDistance: 1000,
    elapsedTime: 200,
    isBot: false,
    update: async () => {},
  });

  await raceManager.tickPrivateRaces();

  assert.equal(race.status, 'COMPLETED');
  assert.equal(raceManager.findPrivateRace(raceId), null);
});

test('4. tickPrivateRaces: closes room when no active humans left', async () => {
  const raceManager = RaceManager.getInstance();
  const race = raceManager.createPrivateRace({
    title: 'Test No Humans Race',
    targetDistance: 1000,
    hostUserId: 'host_deserted',
    maxDurationMinutes: 30,
  });

  const raceId = race.id;
  race.status = 'RUNNING';
  // Started 20s ago (> 10s grace period)
  race.startedAt = new Date(Date.now() - 20 * 1000);
  race.participants.clear(); // No humans in memory

  await raceManager.tickPrivateRaces();

  assert.equal(race.status, 'COMPLETED');
  assert.equal(raceManager.findPrivateRace(raceId), null);
});
