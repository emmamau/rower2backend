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

async function createBotDuel(baseUrl, botMaxPace) {
  const res = await fetch(`${baseUrl}/api/v1/races/private`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      isBotDuel: true,
      targetDistance: 2000,
      hostUserId: `guest_pace_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      hostUserName: 'PaceTester',
      botMaxPace,
    }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

test('bot duel pace is clamped to 1:45 (105s) - 2:45 (165s)', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    assert.equal((await createBotDuel(baseUrl, 60)).race.botMaxPace, 105);
    assert.equal((await createBotDuel(baseUrl, 300)).race.botMaxPace, 165);
    assert.equal((await createBotDuel(baseUrl, 125)).race.botMaxPace, 125);
  } finally {
    await close();
  }
});

test('bot duel "first_stroke" start mode: no countdown, waits in LOBBY', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const created = await createBotDuel(baseUrl, 130);
    assert.equal(created.race.botStartMode, 'countdown');
    const res = await fetch(`${baseUrl}/api/v1/races/private/${created.race.id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostUserId: created.race.hostUserId, botStartMode: 'first_stroke' }),
    });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.race.botStartMode, 'first_stroke');
    assert.notEqual(String(updated.race.internalStatus || '').toUpperCase(), 'COUNTDOWN');
    assert.notEqual(String(updated.race.internalStatus || '').toUpperCase(), 'RUNNING');
  } finally {
    await close();
  }
});
