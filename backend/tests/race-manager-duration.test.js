const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { RaceManager } = require('../dist/services/race-manager.service');
const initRaceRoutes = require('../dist/routes/race.routes').default;
const userStore = require('../dist/services/user-store.service').default;
const db = require('../dist/models').default;

function createTestServer() {
  const app = express();
  app.use(express.json());
  initRaceRoutes(app);
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

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

test('RaceManager - Default private race max duration is 55 minutes', async () => {
  const raceManager = RaceManager.getInstance();
  
  // Verify default config
  assert.equal(
    raceManager.adminPrivateRaceConfig?.maxDurationMinutes ?? raceManager.adminPublicRaceConfig?.privateMaxDurationMinutes,
    55
  );

  // Verify private race created with default maxDurationMinutes = 55
  const race = raceManager.createPrivateRace({
    title: 'Test Duration Default',
    targetDistance: 2000,
    hostUserId: 'user_test_duration',
    hostUserName: 'Test User',
  });

  assert.equal(race.maxDurationMinutes, 55);
});

test('RaceManager - Admin update private race max duration with bounds (5 - 180 min)', async () => {
  const raceManager = RaceManager.getInstance();

  // Test updating to valid duration
  raceManager.updatePublicRaceConfig({
    privateMaxDurationMinutes: 45,
  });

  assert.equal(
    raceManager.adminPrivateRaceConfig?.maxDurationMinutes ?? raceManager.adminPublicRaceConfig?.privateMaxDurationMinutes,
    45
  );

  // New race should use updated duration
  const race45 = raceManager.createPrivateRace({
    title: 'Test Duration 45',
    targetDistance: 2000,
    hostUserId: 'user_test_45',
  });
  assert.equal(race45.maxDurationMinutes, 45);

  // Test lower bound (under 5 clamped to 5)
  raceManager.updatePublicRaceConfig({
    privateMaxDurationMinutes: 2,
  });
  assert.equal(
    raceManager.adminPrivateRaceConfig?.maxDurationMinutes ?? raceManager.adminPublicRaceConfig?.privateMaxDurationMinutes,
    5
  );

  // Test upper bound (over 180 clamped to 180)
  raceManager.updatePublicRaceConfig({
    privateMaxDurationMinutes: 250,
  });
  assert.equal(
    raceManager.adminPrivateRaceConfig?.maxDurationMinutes ?? raceManager.adminPublicRaceConfig?.privateMaxDurationMinutes,
    180
  );

  // Reset back to 55
  raceManager.updatePublicRaceConfig({
    privateMaxDurationMinutes: 55,
  });
  assert.equal(
    raceManager.adminPrivateRaceConfig?.maxDurationMinutes ?? raceManager.adminPublicRaceConfig?.privateMaxDurationMinutes,
    55
  );
});

test('Race Controller - GET and PUT /api/race/admin/config includes privateMaxDurationMinutes', async () => {
  const { server, baseUrl, close } = await createTestServer();

  try {
    // 1. GET /api/race/admin/config
    const getRes = await fetch(`${baseUrl}/api/race/admin/config`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.success, true);
    assert.equal(getBody.config.privateMaxDurationMinutes, 55);

    // 2. PUT /api/race/admin/config as admin Emma
    const putRes = await fetch(`${baseUrl}/api/race/admin/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'admin',
        privateMaxDurationMinutes: 40,
      }),
    });
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.equal(putBody.success, true);
    assert.equal(putBody.config.privateMaxDurationMinutes, 40);

    // Verify GET reflects the change
    const getRes2 = await fetch(`${baseUrl}/api/race/admin/config`);
    const getBody2 = await getRes2.json();
    assert.equal(getBody2.config.privateMaxDurationMinutes, 40);

    // Reset back to 55
    await fetch(`${baseUrl}/api/race/admin/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'admin',
        privateMaxDurationMinutes: 55,
      }),
    });
  } finally {
    await close();
  }
});
