const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const cors = require('cors');

const initRoutes = require('../dist/routes/index').default;
const socketGateway = require('../dist/websocket/socket.gateway').default;

function createTestServer() {
  return new Promise((resolve) => {
    const app = express();
    const server = http.createServer(app);
    socketGateway.init(server);

    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    initRoutes(app);

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

test('Garmin Pairing Protocol: 6-char code generation, watch pairing, deviceToken, and revocation', async () => {
  process.env.NODE_ENV = 'test';
  const { baseUrl, close } = await createTestServer();

  try {
    const userId = `athlete_${Date.now()}`;
    const deviceId = `fenix7_hw_${Date.now()}`;

    // 1. Generation without identity is rejected
    const resNoId = await fetch(`${baseUrl}/api/garmin/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(resNoId.status, 400);

    // 2. Generate pairing code for athlete
    const resCode = await fetch(`${baseUrl}/api/garmin/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    assert.equal(resCode.status, 200);
    const codeData = await resCode.json();
    assert.equal(codeData.success, true);
    assert.equal(codeData.userId, userId);
    assert.equal(typeof codeData.pairingCode, 'string');
    assert.equal(codeData.pairingCode.length, 6);
    assert.equal(codeData.expiresInSeconds, 300);

    const pairingCode = codeData.pairingCode;

    // 3. Status before pairing
    const resStatusBefore = await fetch(`${baseUrl}/api/garmin/pairing-status?userId=${userId}`);
    assert.equal(resStatusBefore.status, 200);
    const statusBeforeData = await resStatusBefore.json();
    assert.equal(statusBeforeData.paired, false);

    // 4. Watch pairing with bad input rejected
    const resBadCode = await fetch(`${baseUrl}/api/garmin/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: 'WRONG1', deviceId }),
    });
    assert.equal(resBadCode.status, 400);

    // 5. Watch pairs with legitimate 6-character code
    const resPair = await fetch(`${baseUrl}/api/garmin/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, deviceId }),
    });
    assert.equal(resPair.status, 200);
    const pairData = await resPair.json();
    assert.equal(pairData.success, true);
    assert.equal(pairData.userId, userId);
    assert.equal(pairData.deviceId, deviceId);
    assert.ok(pairData.deviceToken);
    // UUID v4 format verification
    assert.match(
      pairData.deviceToken,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const deviceToken = pairData.deviceToken;

    // 6. Ephemeral code is destroyed: second attempt must fail
    const resPairAgain = await fetch(`${baseUrl}/api/garmin/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, deviceId }),
    });
    assert.equal(resPairAgain.status, 400);

    // 7. Web detects pairing in real time via polling/status
    const resStatusAfter = await fetch(`${baseUrl}/api/garmin/pairing-status?userId=${userId}`);
    assert.equal(resStatusAfter.status, 200);
    const statusAfterData = await resStatusAfter.json();
    assert.equal(statusAfterData.paired, true);
    assert.equal(statusAfterData.status, 'paired');
    assert.equal(statusAfterData.deviceId, deviceId);
    assert.equal(statusAfterData.deviceToken, deviceToken);

    // 8. Device status endpoint
    const resDevStatus = await fetch(`${baseUrl}/api/garmin/status`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    assert.equal(resDevStatus.status, 200);
    const devStatusData = await resDevStatus.json();
    assert.equal(devStatusData.success, true);
    assert.equal(devStatusData.userId, userId);
    assert.equal(devStatusData.deviceId, deviceId);

    // 9. Reset / Revoke pairing
    const resReset = await fetch(`${baseUrl}/api/garmin/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken }),
    });
    assert.equal(resReset.status, 200);
    const resetData = await resReset.json();
    assert.equal(resetData.success, true);

    // 10. Status after reset: device token is no longer valid
    const resDevStatusAfter = await fetch(`${baseUrl}/api/garmin/status`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    assert.equal(resDevStatusAfter.status, 401);
  } finally {
    await close();
  }
});

test('/boost Activity Telemetry Middleware: strict token enforcement and metric ingestion', async () => {
  process.env.NODE_ENV = 'test';
  const { baseUrl, close } = await createTestServer();

  try {
    const userId = `racer_${Date.now()}`;
    const deviceId = `venu3_hw_${Date.now()}`;

    // Generate code & pair device
    const resCode = await fetch(`${baseUrl}/api/garmin/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const { pairingCode } = await resCode.json();

    const resPair = await fetch(`${baseUrl}/api/garmin/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, deviceId }),
    });
    const { deviceToken } = await resPair.json();

    // 1. Missing or invalid token is rejected (401)
    const resUnauth = await fetch(`${baseUrl}/boost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        raceId: 'RACE_TEST',
        metrics: { distanceM: 50, powerWatts: 200 },
      }),
    });
    assert.equal(resUnauth.status, 401);

    const resBadToken = await fetch(`${baseUrl}/boost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-dummy-token',
        'x-enforce-device-token': 'true',
      },
      body: JSON.stringify({
        raceId: 'RACE_TEST',
        metrics: { distanceM: 50, powerWatts: 200 },
      }),
    });
    assert.equal(resBadToken.status, 401);

    // 2. Legitimate transmission with Bearer deviceToken is accepted
    const resAuthBearer = await fetch(`${baseUrl}/boost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify({
        raceId: 'RACE_TEST',
        metrics: { distanceM: 100, splitSec: 110, powerWatts: 250, strokeRate: 28 },
      }),
    });
    assert.equal(resAuthBearer.status, 200);

    // 3. Legitimate transmission via /api/garmin/boost with JSON body deviceToken is accepted
    const resAuthBody = await fetch(`${baseUrl}/api/garmin/boost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceToken,
        raceId: 'RACE_TEST',
        metrics: { distanceM: 200, splitSec: 108, powerWatts: 260, strokeRate: 29 },
      }),
    });
    assert.equal(resAuthBody.status, 200);
  } finally {
    await close();
  }
});

test('Guest Spectator & Guest Pairing: guest_session_id works seamlessly for pairing', async () => {
  process.env.NODE_ENV = 'test';
  const { baseUrl, close } = await createTestServer();

  try {
    const guestSessionId = `guest_sess_${Date.now()}`;
    const deviceId = `forerunner_hw_${Date.now()}`;

    // Guest gets pairing code
    const resCode = await fetch(`${baseUrl}/api/garmin/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestSessionId }),
    });
    assert.equal(resCode.status, 200);
    const { pairingCode } = await resCode.json();
    assert.equal(pairingCode.length, 6);

    // Watch pairs
    const resPair = await fetch(`${baseUrl}/api/garmin/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, deviceId }),
    });
    assert.equal(resPair.status, 200);
    const pairData = await resPair.json();
    assert.equal(pairData.userId, guestSessionId);
    assert.ok(pairData.deviceToken);

    // Ingest telemetry as guest via deviceToken
    const resBoost = await fetch(`${baseUrl}/boost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pairData.deviceToken}`,
      },
      body: JSON.stringify({
        raceId: 'RACE_GUEST_TEST',
        metrics: { distanceM: 150, powerWatts: 180, splitSec: 125, strokeRate: 24 },
      }),
    });
    assert.equal(resBoost.status, 200);
  } finally {
    await close();
  }
});

test('Pairing model definition: index fields must match database column names and query generator outputs valid SQL', () => {
  const { Sequelize, DataTypes } = require('sequelize');
  const seq = new Sequelize('postgres://user:pass@localhost:5432/testdb', { logging: false });
  const definePairings = require('../dist/models/pairing.model').default;
  const Pairing = definePairings(seq, DataTypes);

  const rawAttributes = Pairing.rawAttributes;
  const columnNames = new Set(
    Object.values(rawAttributes).map((attr) => attr.field || attr.fieldName)
  );

  const indexes = Pairing.options.indexes || [];
  assert.ok(indexes.length > 0, 'Pairing model should define indexes');

  const qg = seq.getQueryInterface().queryGenerator;

  for (const idx of indexes) {
    for (const field of idx.fields) {
      const fieldName = typeof field === 'string' ? field : field.name || field.attribute;
      assert.ok(
        columnNames.has(fieldName),
        `Index field "${fieldName}" does not exist in Pairing table columns (${Array.from(columnNames).join(', ')})`
      );
    }

    const indexSql = qg.addIndexQuery(Pairing.getTableName(), idx.fields, idx, Pairing.getTableName());
    assert.ok(!indexSql.includes('"pairingCode"'), 'Generated SQL must not reference camelCase pairingCode: ' + indexSql);
    assert.ok(!indexSql.includes('"userId"'), 'Generated SQL must not reference camelCase userId: ' + indexSql);
    assert.ok(!indexSql.includes('"deviceToken"'), 'Generated SQL must not reference camelCase deviceToken: ' + indexSql);
    assert.ok(!indexSql.includes('"deviceId"'), 'Generated SQL must not reference camelCase deviceId: ' + indexSql);
  }

  // Also verify all models defined in the database
  const { db } = require('../dist/models');
  const allModels = [db.activities, db.races, db.users, db.loginRequests, db.pairings];
  for (const m of allModels) {
    const cols = new Set(Object.values(m.rawAttributes).map((a) => a.field || a.fieldName));
    for (const idx of m.options.indexes || []) {
      for (const field of idx.fields) {
        const fieldName = typeof field === 'string' ? field : field.name || field.attribute;
        assert.ok(
          cols.has(fieldName),
          `Model ${m.name} has index on non-existent column "${fieldName}"`
        );
      }
    }
  }
});

test('Parcours 2: Atomic 5-char Guest Ticket in Private Room + BLE READY State Machine & Start Lock', async () => {
  process.env.NODE_ENV = 'test';
  const { baseUrl, close } = await createTestServer();

  try {
    // 1. Create a private room (Group Regatta) using admin host EmmaRacer
    const hostId = 'EmmaRacer';
    const resCreate = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: hostId,
        hostUserName: 'EmmaRacer',
        title: 'Test Regatta Room',
        targetDistance: 500,
        startMode: 'manual',
        hostParticipates: true,
        adminAsSpectator: false,
      }),
    });
    assert.equal(resCreate.status, 201);
    const roomData = await resCreate.json();
    const roomId = roomData.race.id;
    assert.ok(roomId);

    // 2. Generate a 5-character guest boarding ticket on Web
    const resTicket = await fetch(`${baseUrl}/api/rooms/${roomId}/guest-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestName: 'Alex',
        socketId: 'sock_test_123',
      }),
    });
    assert.equal(resTicket.status, 200);
    const ticketData = await resTicket.json();
    assert.equal(ticketData.ticketPin.length, 5, 'Guest ticket PIN must be 5 characters');
    assert.match(ticketData.ticketPin, /^[0-9A-Z]{5}$/, 'Guest ticket PIN must be alphanumeric');
    assert.ok(ticketData.lane >= 2, 'Guest must be assigned a reserved water lane');

    // 3. Claim the 5-char ticket on the Garmin Watch (POST /api/garmin/claim-ticket)
    const watchDeviceId = `garmin_guest_hw_${Date.now()}`;
    const resClaim = await fetch(`${baseUrl}/api/garmin/claim-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketPin: ticketData.ticketPin,
        deviceId: watchDeviceId,
      }),
    });
    assert.equal(resClaim.status, 200);
    const claimData = await resClaim.json();
    assert.equal(claimData.success, true);
    assert.equal(claimData.status, 'waiting');
    assert.ok(claimData.deviceToken, 'Must issue a persistent deviceToken');
    assert.equal(claimData.guestName, 'Alex');
    assert.equal(claimData.lane, ticketData.lane);
    assert.equal(claimData.connectionState, 'CONNECTED');
    assert.equal(claimData.ready, false);
    assert.match(claimData.message, /Bienvenue Alex ! Ligne \d+ attribuée/);

    // 4. Attempting immediate start while participants are NOT READY must be blocked (409)
    const resStartBlocked = await fetch(`${baseUrl}/api/rooms/${roomId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: hostId,
        countdownSeconds: 0,
      }),
    });
    assert.equal(resStartBlocked.status, 409, 'Manual start must be locked until all participants are READY');

    // 5. Transition both host and guest to READY via POST /api/rooms/:roomId/status
    const resReadyHost = await fetch(`${baseUrl}/api/rooms/${roomId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: hostId,
        ready: true,
      }),
    });
    assert.equal(resReadyHost.status, 200);

    const resReadyGuest = await fetch(`${baseUrl}/api/rooms/${roomId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${claimData.deviceToken}`,
      },
      body: JSON.stringify({
        ready: true,
      }),
    });
    assert.equal(resReadyGuest.status, 200);
    const readyGuestBody = await resReadyGuest.json();
    assert.equal(readyGuestBody.connectionState, 'READY');
    assert.equal(readyGuestBody.allHumansReady, true);

    // 6. Now manual start succeeds because all participants are READY
    const resStartOk = await fetch(`${baseUrl}/api/rooms/${roomId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: hostId,
        countdownSeconds: 15,
      }),
    });
    assert.equal(resStartOk.status, 200);

    // 7. Live telemetry sent with guest deviceToken (even if userId in body is guestName "Alex")
    // updates the exact guest participant (claimData.userId) instead of creating a duplicate boat!
    const resStartImmediate = await fetch(`${baseUrl}/api/rooms/${roomId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: hostId,
        countdownSeconds: 0,
      }),
    });
    assert.equal(resStartImmediate.status, 200);

    const resGuestBoost = await fetch(`${baseUrl}/boost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${claimData.deviceToken}`,
      },
      body: JSON.stringify({
        raceId: roomId,
        userId: 'Alex', // legacy/display name sent instead of guest_xxx id
        userName: 'Alex',
        deviceToken: claimData.deviceToken,
        raceMode: 'race',
        status: 'in_progress',
        targetDistance: 2000,
        seq: 5,
        elapsedTime: 15,
        currentDistance: 65,
        instantPower: 220,
        instantPace: 112,
        strokeRate: 28,
        metrics: {
          distanceM: 65,
          splitSec: 112,
          powerWatts: 220,
          strokeRate: 28,
          heartRate: 152,
        },
      }),
    });
    assert.equal(resGuestBoost.status, 200);
    const guestBoostBody = await resGuestBoost.json();
    assert.equal(guestBoostBody.status, 'RUNNING');

    const resRoomAfterBoost = await fetch(`${baseUrl}/api/v1/races/private/${roomId}`);
    assert.equal(resRoomAfterBoost.status, 200);
    const roomAfterBoost = await resRoomAfterBoost.json();
    const participantsList = roomAfterBoost.participants || roomAfterBoost.race?.participants || [];
    const humanParticipants = participantsList.filter((p) => !p.isBot);
    assert.equal(humanParticipants.length, 2, 'Must not create a duplicate 3rd participant when guest sends /boost');
  } finally {
    await close();
  }
});

test('Scheduled private race auto-start is locked until all connected participants are BLE READY', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const hostId = 'EmmaRacer';
    const scheduledTime = new Date(Date.now() + 5 * 1000).toISOString();
    const resRoom = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: hostId,
        hostUserName: 'EmmaRacer',
        title: 'Scheduled Ready Lock Test',
        targetDistance: 2000,
        hasBots: false,
        startMode: 'scheduled',
        scheduledStartTime: scheduledTime,
      }),
    });
    assert.equal(resRoom.status, 201);
    const roomData = await resRoom.json();
    const roomId = roomData.race?.id || roomData.id;

    // Guest claims a boarding ticket (joins with ready = false, connectionState = CONNECTED)
    const resTicket = await fetch(`${baseUrl}/api/rooms/${roomId}/guest-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestName: 'Lucas' }),
    });
    const ticketData = await resTicket.json();
    const resClaim = await fetch(`${baseUrl}/api/garmin/claim-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketPin: ticketData.ticketPin,
        deviceId: `garmin_sched_${Date.now()}`,
      }),
    });
    assert.equal(resClaim.status, 200);
    const claimData = await resClaim.json();

    // Tick private races: because Lucas has ready === false, scheduled race MUST stay in LOBBY (not COUNTDOWN)
    const raceManager = require('../dist/services/race-manager.service').default;
    await raceManager.tickPrivateRaces();
    const raceWhileNotReady = raceManager.getRaceById(roomId);
    assert.equal(raceWhileNotReady.status, 'LOBBY', 'Scheduled race must remain in LOBBY while a connected participant is not READY');

    // Now both host and Lucas become READY -> scheduled race within 15s window transitions to COUNTDOWN!
    const resHostReady = await fetch(`${baseUrl}/api/rooms/${roomId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: hostId, ready: true }),
    });
    const hostReadyBody = await resHostReady.json();

    const resGuestReady = await fetch(`${baseUrl}/api/rooms/${roomId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${claimData.deviceToken}`,
      },
      body: JSON.stringify({ userId: claimData.userId, ready: true }),
    });
    assert.equal(resGuestReady.status, 200);
    const readyBody = await resGuestReady.json();
    assert.ok(hostReadyBody.countdownTriggered || readyBody.countdownTriggered, 'Scheduled race within 15s window must trigger countdown once all participants are READY');
    assert.equal(readyBody.internalStatus, 'COUNTDOWN');
  } finally {
    await close();
  }
});

test('End-to-End Salon Race via Watch PIN (/api/session/claim): kayak advances stroke-by-stroke from start to finish line', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const raceManager = require('../dist/services/race-manager.service').default;

    // 1. Create a 500m private salon (Duel 1v1 Bot or Multi)
    const resCreate = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'bot_duel',
        targetDistance: 500,
        hostUserId: 'usr_salon_e2e',
        hostUserName: 'KayakHero',
      }),
    });
    assert.equal(resCreate.status, 201);
    const created = await resCreate.json();
    const salonId = created.race.id;
    const pinCode = created.pinCode;
    assert.ok(salonId.startsWith('PRIV_'));
    assert.equal(pinCode.length, 5);

    // 2. Watch joins the salon via POST /api/session/claim (Garmin menu "Entrer un code pin")
    const resClaim = await fetch(`${baseUrl}/api/session/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: pinCode,
        deviceId: 'garmin_watch_salon_e2e',
        pseudo: 'KayakHero',
      }),
    });
    assert.equal(resClaim.status, 200);
    const claimData = await resClaim.json();
    assert.equal(claimData.success, true);
    assert.equal(claimData.id, salonId, '/api/session/claim must return id = salonId so watch does not fall back to solo_<timestamp>');
    assert.equal(claimData.raceId, salonId, '/api/session/claim must return raceId = salonId');
    assert.equal(claimData.roomId, salonId);
    assert.equal(claimData.targetDistance, 500);
    assert.equal(claimData.lane, 1);

    // 3. Countdown finishes -> race transitions to RUNNING
    const race = raceManager.getRaceById(salonId);
    race.lobbyEndsAt = new Date(Date.now() - 500);
    await raceManager.tickPrivateRaces();
    assert.equal(race.status, 'RUNNING', 'Salon must transition to RUNNING when countdown reaches 0');

    // 4. Watch sends progressive strokes via POST /api/boost and kayak advances monotonically to finish (500m)
    let prevNormDist = 0;
    let seq = 0;
    let dist = 0;
    let elapsed = 0;
    while (dist < 500) {
      seq++;
      elapsed += 10;
      dist = Math.min(500, seq * 46);
      const isLast = dist >= 500;
      const resBoost = await fetch(`${baseUrl}/api/boost`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${claimData.deviceToken}`,
        },
        body: JSON.stringify({
          raceId: claimData.id,
          userId: claimData.userId,
          userName: 'KayakHero',
          deviceId: 'garmin_watch_salon_e2e',
          seq,
          status: isLast ? 'completed' : 'in_progress',
          elapsedTime: elapsed,
          metrics: {
            distanceM: dist,
            splitSec: 115,
            powerWatts: 280,
            strokeRate: 30,
            heartRate: 165,
          },
        }),
      });
      assert.equal(resBoost.status, 200);
      const boostBody = await resBoost.json();
      assert.equal(boostBody.falseStart, false, 'Must not flag falseStart while race is RUNNING');
      assert.ok(boostBody.normDistM > 0, `Stroke ${seq}: normDistM (${boostBody.normDistM}) must be > 0`);
      assert.ok(boostBody.normDistM > prevNormDist, `Stroke ${seq}: kayak distance must strictly advance`);
      prevNormDist = boostBody.normDistM;

      // Verify GET /api/activity/race/:id/leaderboard reflects the advancing kayak (and never resets to 0m)
      const resLb = await fetch(`${baseUrl}/api/activity/race/${salonId}/leaderboard`);
      assert.equal(resLb.status, 200);
      const lbData = await resLb.json();
      const myRow = lbData.leaderboard.find((r) => r.userId === claimData.userId);
      assert.ok(myRow, 'Player kayak must be present in salon leaderboard');
      assert.ok(myRow.netDistance > 0, `Leaderboard netDistance (${myRow.netDistance}) must be > 0`);
      if (isLast) break;
    }

    // 5. Simulate bot also finishing or tick completing the race
    race.startedAt = new Date(Date.now() - 200 * 1000);
    await raceManager.tickPrivateRaces();
    assert.equal(race.status, 'COMPLETED', 'Race must complete cleanly once all racers reach targetDistance');
    assert.ok(Array.isArray(race.finalRanking) && race.finalRanking.length >= 1, 'Official finalRanking must be generated');
  } finally {
    await close();
  }
});


