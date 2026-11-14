const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { RaceManager } = require('../dist/services/race-manager.service');
const initRoomRoutes = require('../dist/routes/room.routes').default;
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
  initRoomRoutes(app);
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

test('1. RaceManager.leavePrivateRace: leaving with 2 players keeps room open, last player closes room', () => {
  const raceManager = RaceManager.getInstance();
  const race = raceManager.createPrivateRace({
    title: 'Test Leave Room',
    targetDistance: 1000,
    hostUserId: 'user_host',
    requireApproval: false,
    maxDurationMinutes: 10,
  });

  const pinCode = race.pinCode;
  const raceId = race.id;

  // Add 2nd player via joinPrivateRace
  const joinOutcome = raceManager.joinPrivateRace(race.code, 'user_guest', 'GuestRacer', undefined, { ready: true });
  assert.equal('error' in joinOutcome, false);
  assert.equal(race.participants.size, 2);

  // Player 1 leaves -> room stays open, remaining: 1
  const resLeave1 = raceManager.leavePrivateRace(raceId, 'user_guest');
  assert.equal('error' in resLeave1, false);
  if (!('error' in resLeave1)) {
    assert.equal(resLeave1.success, true);
    assert.equal(resLeave1.roomClosed, false);
    assert.equal(resLeave1.remainingParticipants, 1);
  }
  assert.ok(raceManager.findPrivateRace(raceId));

  // Player 2 leaves -> last player, room automatically closed
  const resLeave2 = raceManager.leavePrivateRace(raceId, 'user_host');
  assert.equal('error' in resLeave2, false);
  if (!('error' in resLeave2)) {
    assert.equal(resLeave2.success, true);
    assert.equal(resLeave2.roomClosed, true);
    assert.equal(resLeave2.remainingParticipants, 0);
  }

  // Room must be removed and not findable
  assert.equal(raceManager.findPrivateRace(raceId), null);
  assert.equal(raceManager.findPrivateRace(race.code), null);
  if (pinCode) {
    assert.equal(raceManager.findPrivateRace(pinCode), null);
  }
});

test('2. POST /api/rooms/leave: HTTP endpoint allows leaving and returns status', async () => {
  const { baseUrl, close } = await createTestServer();
  const raceManager = RaceManager.getInstance();

  try {
    const race = raceManager.createPrivateRace({
      title: 'HTTP Leave Room',
      targetDistance: 500,
      hostUserId: 'user_solo',
      requireApproval: false,
    });

    const res = await fetch(`${baseUrl}/api/rooms/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: race.code,
        userId: 'user_solo',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.roomClosed, true);
    assert.equal(data.remainingParticipants, 0);

    // Salon is closed
    assert.equal(raceManager.findPrivateRace(race.id), null);
  } finally {
    await close();
  }
});

test('3. POST /api/rooms/:identifier/leave: HTTP endpoint handles identifier param', async () => {
  const { baseUrl, close } = await createTestServer();
  const raceManager = RaceManager.getInstance();

  try {
    const race = raceManager.createPrivateRace({
      title: 'HTTP Leave Room Param',
      targetDistance: 500,
      hostUserId: 'user_param',
      requireApproval: false,
    });

    const res = await fetch(`${baseUrl}/api/rooms/${race.code}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user_param',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.roomClosed, true);
    assert.equal(data.remainingParticipants, 0);

    // Salon is closed
    assert.equal(raceManager.findPrivateRace(race.id), null);
  } finally {
    await close();
  }
});
