const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const initRaceRoutes = require('../dist/routes/race.routes').default;

function createTestServer() {
  const app = express();
  app.use(express.json());
  initTelemetryRoutes(app);
  initRaceRoutes(app);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('1. Solo race defaults to "first_stroke" start mode and waits in LOBBY without countdown', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const hostId = `solo_user_${Date.now()}`;
    const createRes = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isSolo: true,
        targetDistance: 2000,
        hostUserId: hostId,
        hostUserName: 'SoloRower',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    assert.equal(created.race.isSolo, true);
    assert.equal(created.race.botStartMode, 'first_stroke', 'Solo race should default to first_stroke start mode');
    assert.equal(created.race.internalStatus, 'LOBBY', 'Solo race must wait in LOBBY for the first stroke');
  } finally {
    await close();
  }
});

test('2. Solo race in "first_stroke" mode immediately starts (RUNNING) upon receiving first telemetry stroke', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const hostId = `solo_telem_${Date.now()}`;
    const createRes = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isSolo: true,
        targetDistance: 1000,
        hostUserId: hostId,
        hostUserName: 'SoloStrokeRower',
        botStartMode: 'first_stroke',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    const raceId = created.race.id;

    // Send first stroke telemetry
    const telemRes = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: hostId,
        raceId,
        userName: 'SoloStrokeRower',
        netDistance: 12,
        power: 210,
        strokeRate: 28,
        pace: 118,
      }),
    });
    assert.equal(telemRes.status, 200);

    // Verify race transitioned to RUNNING
    const checkRes = await fetch(`${baseUrl}/api/v1/races/private/${raceId}`);
    assert.equal(checkRes.status, 200);
    const checkData = await checkRes.json();
    assert.equal(checkData.race.internalStatus, 'RUNNING', 'Race internalStatus must transition to RUNNING on first stroke');
    assert.ok(checkData.race.startTime, 'startTime timestamp must be set');
  } finally {
    await close();
  }
});

test('3. Solo race can switch between "first_stroke" and "countdown" mode via /start', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const hostId = `solo_switch_${Date.now()}`;
    const createRes = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isSolo: true,
        targetDistance: 2000,
        hostUserId: hostId,
        hostUserName: 'SwitchRower',
        botStartMode: 'countdown',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    const raceId = created.race.id;

    // Switch to first_stroke
    const startRes1 = await fetch(`${baseUrl}/api/v1/races/private/${raceId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: hostId,
        botStartMode: 'first_stroke',
      }),
    });
    assert.equal(startRes1.status, 200);
    const data1 = await startRes1.json();
    assert.equal(data1.race.botStartMode, 'first_stroke');
    assert.equal(data1.race.internalStatus, 'LOBBY');

    // Launch countdown of 10s
    const startRes2 = await fetch(`${baseUrl}/api/v1/races/private/${raceId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: hostId,
        countdownSeconds: 10,
        botStartMode: 'countdown',
      }),
    });
    assert.equal(startRes2.status, 200);
    const data2 = await startRes2.json();
    assert.equal(data2.race.internalStatus, 'COUNTDOWN');
  } finally {
    await close();
  }
});
