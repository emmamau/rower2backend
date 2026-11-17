const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const initRaceRoutes = require('../dist/routes/race.routes').default;
const raceManager = require('../dist/services/race-manager.service').default;
const RaceManagerClass = require('../dist/services/race-manager.service').RaceManager;

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

test('1. RaceManager.toLiveMetrics allocates distinct unique lanes (1, 2, 3...) and avoids duplicate Lane 1', async () => {
  const hostId = `host_lane_${Date.now()}`;
  const guestId = `guest_lane_${Date.now()}`;
  const botId = `bot_salon_1`;

  const participants = new Map();
  participants.set(hostId, { userId: hostId, userName: 'Host', lane: 1, ready: true });
  participants.set(guestId, { userId: guestId, userName: 'Guest', lane: 2, ready: true });

  const mockRace = {
    id: `RACE_LANE_${Date.now()}`,
    isBotDuel: false,
    participants,
  };

  const rows = [
    { get: (f) => (f === 'userId' ? hostId : f === 'netDistance' ? 100 : null) },
    { get: (f) => (f === 'userId' ? guestId : f === 'netDistance' ? 80 : null) },
    { get: (f) => (f === 'userId' ? botId : f === 'isBot' ? true : f === 'netDistance' ? 50 : null) },
  ];

  const metrics = RaceManagerClass.toLiveMetrics(rows, mockRace);
  assert.equal(metrics.length, 3);

  const lanes = metrics.map((m) => m.lane);
  // Verify all lanes are strictly distinct and > 0
  const uniqueLanes = new Set(lanes);
  assert.equal(uniqueLanes.size, 3, `Expected 3 unique lanes, got: ${JSON.stringify(lanes)}`);
  assert.ok(lanes.includes(1), 'Lane 1 should be present');
  assert.ok(lanes.includes(2), 'Lane 2 should be present');
  assert.ok(lanes.includes(3), 'Lane 3 should be present');
});

test('2. GET /api/v1/races/:id/leaderboard includes distinct lane property for each racer', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const hostId = `host_lead_${Date.now()}`;
    const createRes = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isBotDuel: true,
        targetDistance: 1000,
        hostUserId: hostId,
        hostUserName: 'LeaderHost',
        botMaxPace: 120,
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    const raceId = created.race.id;

    // Send 1 telemetry ping so host has an activity
    const telemRes = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: hostId,
        raceId,
        userName: 'LeaderHost',
        netDistance: 50,
        power: 200,
        strokeRate: 28,
        pace: 120,
      }),
    });
    assert.equal(telemRes.status, 200);

    // Fetch leaderboard
    const lbRes = await fetch(`${baseUrl}/api/races/${raceId}/leaderboard`);
    assert.equal(lbRes.status, 200);
    const lbData = await lbRes.json();

    assert.ok(lbData.leaderboard.length >= 2, 'Leaderboard must contain host and bot');
    for (const item of lbData.leaderboard) {
      assert.ok(item.lane !== undefined && item.lane !== null, `Racer ${item.userId} must have a lane property`);
      assert.ok(item.lane > 0, `Racer ${item.userId} lane must be > 0, got ${item.lane}`);
    }

    const assignedLanes = lbData.leaderboard.map((x) => x.lane);
    const distinctSet = new Set(assignedLanes);
    assert.equal(distinctSet.size, lbData.leaderboard.length, `Expected distinct lanes, got: ${JSON.stringify(assignedLanes)}`);
  } finally {
    await close();
  }
});
