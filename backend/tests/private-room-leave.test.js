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

test('1. RaceManager.leavePrivateRace: leaving with 2 players keeps room open, last player leaving ALSO keeps room open', () => {
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

  // Player 2 leaves -> consulting/leaving room must NOT delete it
  const resLeave2 = raceManager.leavePrivateRace(raceId, 'user_host');
  assert.equal('error' in resLeave2, false);
  if (!('error' in resLeave2)) {
    assert.equal(resLeave2.success, true);
    assert.equal(resLeave2.roomClosed, false);
    assert.equal(resLeave2.remainingParticipants, 0);
  }

  // Room must STILL exist
  assert.ok(raceManager.findPrivateRace(raceId));
  assert.ok(raceManager.findPrivateRace(race.code));
  if (pinCode) {
    assert.ok(raceManager.findPrivateRace(pinCode));
  }

  // Explicit close by host DOES close room
  const closeRes = raceManager.closePrivateRace(raceId, 'user_host');
  assert.equal('error' in closeRes, false);
  assert.equal(raceManager.findPrivateRace(raceId), null);
});

test('2. POST /api/rooms/leave: HTTP endpoint allows leaving without deleting room', async () => {
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
    assert.equal(data.roomClosed, false);
    assert.equal(data.remainingParticipants, 0);

    // Salon is NOT closed by merely leaving
    assert.ok(raceManager.findPrivateRace(race.id));
    raceManager.closePrivateRace(race.id, 'user_solo');
  } finally {
    await close();
  }
});

test('3. POST /api/rooms/:identifier/leave: HTTP endpoint handles identifier param and keeps room', async () => {
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
    assert.equal(data.roomClosed, false);
    assert.equal(data.remainingParticipants, 0);

    // Salon is NOT closed
    assert.ok(raceManager.findPrivateRace(race.id));
    raceManager.closePrivateRace(race.id, 'user_param');
  } finally {
    await close();
  }
});

test('4. RaceManager.startOrResetPrivateRace: scheduled race cannot be started > 5 minutes before scheduled date', () => {
  const raceManager = RaceManager.getInstance();
  const futureTime = new Date(Date.now() + 60 * 60 * 1000); // 1h in the future
  const race = raceManager.createPrivateRace({
    title: 'Scheduled Race Test',
    targetDistance: 2000,
    hostUserId: 'user_host_sched',
    startMode: 'scheduled',
    scheduledStartTime: futureTime,
  });

  // Attempting to start now (> 5 min before) must be rejected with 403
  const outcomeEarly = raceManager.startOrResetPrivateRace(race.id, {
    hostUserId: 'user_host_sched',
    countdownSeconds: 15,
  });
  assert.equal('error' in outcomeEarly, true);
  if ('error' in outcomeEarly) {
    assert.equal(outcomeEarly.statusCode, 403);
  }

  // If scheduled 4 minutes in future (< 5 min), start is allowed
  race.scheduledStartTime = new Date(Date.now() + 4 * 60 * 1000);
  const outcomeAllowed = raceManager.startOrResetPrivateRace(race.id, {
    hostUserId: 'user_host_sched',
    countdownSeconds: 15,
  });
  assert.equal('error' in outcomeAllowed, false);
  raceManager.closePrivateRace(race.id, 'user_host_sched');
});
