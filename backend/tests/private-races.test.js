const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { RaceManager } = require('../dist/services/race-manager.service');
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const userStore = require('../dist/services/user-store.service').default;
const db = require('../dist/models').default;

test.before(async () => {
  await userStore.createUser({
    id: 'host_emma',
    login: 'host_emma',
    name: 'Emma',
    isSubscriber: true,
  });
  await userStore.createUser({
    id: 'host_organizer',
    login: 'host_organizer',
    name: 'Organizer',
    isSubscriber: true,
  });
  await userStore.createUser({
    id: 'host_coach',
    login: 'host_coach',
    name: 'Coach',
    isSubscriber: true,
  });
});

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

test('RaceManager.normalizeMeetCode normalizes valid codes and rejects invalid inputs', () => {
  assert.equal(RaceManager.normalizeMeetCode('abc-def-ghi'), 'abc-def-ghi');
  assert.equal(RaceManager.normalizeMeetCode('  ABC-DEF-GHI '), 'abc-def-ghi');
  assert.equal(RaceManager.normalizeMeetCode('abcdefghi'), 'abc-def-ghi');
  assert.equal(RaceManager.normalizeMeetCode('abc def ghi'), 'abc-def-ghi');
  assert.equal(RaceManager.normalizeMeetCode('abc-def'), null);
  assert.equal(RaceManager.normalizeMeetCode('1234'), null);
  assert.equal(RaceManager.normalizeMeetCode(''), null);
});

test('HTTP lifecycle: create private salon, lookup by code/PIN/raceId, manage codes, host auth, capacity, start & close', async () => {
  const ctx = await createTestServer();
  try {
    // 1. Create private salon
    const createRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '  Salon Club Aviron  ',
        targetDistance: 2000,
        maxParticipants: 2,
        hostUserId: 'host_emma',
        hostUserName: 'Emma',
        countdownMinutes: 0,
        requireApproval: false,
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.success, true);
    assert.equal(created.race.title, 'Salon Club Aviron');
    assert.equal(created.race.targetDistance, 2000);
    assert.equal(created.race.maxParticipants, 2);
    assert.equal(created.waitingForHost, true);
    assert.equal(created.requireApproval, false);
    assert.match(created.code, /^[a-z]{3}-[a-z]{3}-[a-z]{3}$/);
    assert.match(created.pinCode, /^[A-Z0-9]{5}$/);
    assert.equal(created.inviteUrl, `/r/${created.code}`);

    const initialCode = created.code;
    const initialPin = created.pinCode;
    const raceId = created.race.id;

    // 2. Lookup by Meet code (uppercase without hyphens)
    const upperCompact = initialCode.replace(/-/g, '').toUpperCase();
    const getByCode = await fetch(`${ctx.baseUrl}/api/v1/races/private/${upperCompact}`);
    assert.equal(getByCode.status, 200);
    const gotByCode = await getByCode.json();
    assert.equal(gotByCode.race.id, raceId);

    // 3. Lookup by 4-digit PIN (Garmin watch & web)
    const getByPin = await fetch(`${ctx.baseUrl}/api/v1/races/pin/${initialPin}`);
    assert.equal(getByPin.status, 200);
    const gotByPin = await getByPin.json();
    assert.equal(gotByPin.raceId, raceId);
    assert.equal(gotByPin.id, raceId);
    assert.equal(gotByPin.targetDistance, 2000);

    // 4. Privacy check: GET /api/v1/races/private without params must not leak rooms
    const emptyListRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`);
    const emptyList = await emptyListRes.json();
    assert.equal(emptyList.races.length, 0);

    // Host query returns the salon
    const hostListRes = await fetch(`${ctx.baseUrl}/api/v1/races/private?hostUserId=host_emma`);
    const hostList = await hostListRes.json();
    assert.ok(hostList.races.some((r) => r.race.id === raceId));

    // 5. Capacity enforcement (maxParticipants = 2)
    const join1 = await fetch(`${ctx.baseUrl}/api/v1/races/private/${initialCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', userName: 'Player1', registerLane: true }),
    });
    assert.equal(join1.status, 200);

    const join2 = await fetch(`${ctx.baseUrl}/api/v1/races/private/${initialCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u2', userName: 'Player2', registerLane: true }),
    });
    assert.equal(join2.status, 200);

    // Re-joining same user u1 is idempotent
    const join1Again = await fetch(`${ctx.baseUrl}/api/v1/races/private/${initialCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', userName: 'Player1', registerLane: true }),
    });
    assert.equal(join1Again.status, 200);

    // 3rd distinct user gets 409 Conflict
    const join3 = await fetch(`${ctx.baseUrl}/api/v1/races/private/${initialCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u3', userName: 'Player3', registerLane: true }),
    });
    assert.equal(join3.status, 409);

    // 6. Unauthorized non-host cannot regenerate PIN or start race
    const unauthPin = await fetch(`${ctx.baseUrl}/api/v1/races/private/${initialCode}/regenerate-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostUserId: 'intruder_99' }),
    });
    assert.equal(unauthPin.status, 403);

    // 7. Host regenerates PIN: old PIN invalidated, new PIN works
    const regenPinRes = await fetch(`${ctx.baseUrl}/api/v1/races/private/${initialCode}/regenerate-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostUserId: 'host_emma' }),
    });
    assert.equal(regenPinRes.status, 200);
    const regenPin = await regenPinRes.json();
    assert.notEqual(regenPin.pinCode, initialPin);

    const oldPinCheck = await fetch(`${ctx.baseUrl}/api/v1/races/pin/${initialPin}`);
    assert.equal(oldPinCheck.status, 404);
    const newPinCheck = await fetch(`${ctx.baseUrl}/api/v1/races/pin/${regenPin.pinCode}`);
    assert.equal(newPinCheck.status, 200);

    // 8. Host regenerates salon code & URL: old code invalidated, raceId & participants preserved!
    const regenCodeRes = await fetch(`${ctx.baseUrl}/api/v1/races/private/${initialCode}/regenerate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostUserId: 'host_emma' }),
    });
    assert.equal(regenCodeRes.status, 200);
    const regenCode = await regenCodeRes.json();
    assert.notEqual(regenCode.code, initialCode);
    assert.equal(regenCode.race.id, raceId);
    assert.equal(regenCode.inviteUrl, `/r/${regenCode.code}`);
    assert.equal(regenCode.totalParticipants, 2);

    const oldCodeCheck = await fetch(`${ctx.baseUrl}/api/v1/races/private/${initialCode}`);
    assert.equal(oldCodeCheck.status, 404);

    // 9. Start countdown & immediate start & reset
    const startCountdownRes = await fetch(`${ctx.baseUrl}/api/v1/races/private/${regenCode.code}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostUserId: 'host_emma', countdownSeconds: 15 }),
    });
    assert.equal(startCountdownRes.status, 200);
    const startedCd = await startCountdownRes.json();
    assert.equal(startedCd.waitingForHost, false);
    assert.ok(startedCd.secondsRemaining > 0 && startedCd.secondsRemaining <= 15);

    const immediateStartRes = await fetch(`${ctx.baseUrl}/api/v1/races/private/${regenCode.code}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostUserId: 'host_emma', countdownSeconds: 0 }),
    });
    const immediateStarted = await immediateStartRes.json();
    assert.equal(immediateStarted.status, 'in_progress');

    const resetRes = await fetch(`${ctx.baseUrl}/api/v1/races/private/${regenCode.code}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostUserId: 'host_emma', reset: true, targetDistance: 5000 }),
    });
    const resetData = await resetRes.json();
    assert.equal(resetData.status, 'waiting');
    assert.equal(resetData.waitingForHost, true);
    assert.equal(resetData.race.targetDistance, 5000);

    // 10. Close salon revokes both code and PIN
    const closeRes = await fetch(
      `${ctx.baseUrl}/api/v1/races/private/${regenCode.code}?hostUserId=host_emma`,
      { method: 'DELETE' }
    );
    assert.equal(closeRes.status, 200);

    const afterCloseCode = await fetch(`${ctx.baseUrl}/api/v1/races/private/${regenCode.code}`);
    assert.equal(afterCloseCode.status, 404);
    const afterClosePin = await fetch(`${ctx.baseUrl}/api/v1/races/pin/${regenPin.pinCode}`);
    assert.equal(afterClosePin.status, 404);
  } finally {
    await ctx.close();
  }
});

test('Boundary & invalid input handling on private race endpoints', async () => {
  const ctx = await createTestServer();
  try {
    // Distance clamping (min 100, max 100000) & control char stripping
    const res = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '\u0000\u0007   ',
        targetDistance: -500,
        maxParticipants: 999,
        hostUserId: 'host_emma',
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.race.title, 'Régate Privée');
    assert.equal(data.race.targetDistance, 100);
    assert.equal(data.race.maxParticipants, 30);

    // Invalid PIN format returns 400 (too short or special characters)
    const badPinShort = await fetch(`${ctx.baseUrl}/api/v1/races/pin/12`);
    assert.equal(badPinShort.status, 400);
    const badPinChars = await fetch(`${ctx.baseUrl}/api/v1/races/pin/AB$$!`);
    assert.equal(badPinChars.status, 400);

    // Non-existent room returns 404
    const missing = await fetch(`${ctx.baseUrl}/api/v1/races/private/zzz-zzz-zzz`);
    assert.equal(missing.status, 404);
  } finally {
    await ctx.close();
  }
});

test('Organizer Approval System: default requireApproval=true, pending queue, host approval/rejection, and auto-approval toggle', async () => {
  const ctx = await createTestServer();
  try {
    // 1. Host creates a private salon with default approval required
    const createRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Coupe du Club',
        targetDistance: 2000,
        maxParticipants: 5,
        hostUserId: 'host_coach',
        hostUserName: 'Coach',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.requireApproval, true);
    assert.match(created.pinCode, /^[A-Z0-9]{5}$/);
    const pin = created.pinCode;
    const code = created.code;

    // 2. Athlete connects with PIN and athlete login via Garmin watch GET /api/v1/races/pin/:pin?userId=athlete_1
    const watchPinJoin = await fetch(`${ctx.baseUrl}/api/v1/races/pin/${pin}?userId=athlete_1&userName=Alex`);
    assert.equal(watchPinJoin.status, 200);
    const watchData = await watchPinJoin.json();
    // Watch receives pending approval information!
    assert.equal(watchData.status, 'pending_approval');
    assert.equal(watchData.approvalStatus, 'pending');

    // 3. Polling participant approval status from watch
    const pollPending = await fetch(`${ctx.baseUrl}/api/v1/races/private/${code}/participant-status?userId=athlete_1`);
    assert.equal(pollPending.status, 200);
    const statusData = await pollPending.json();
    assert.equal(statusData.status, 'pending');

    // 4. Host views private salon: athlete_1 is in pendingParticipants
    const hostRoomRes = await fetch(`${ctx.baseUrl}/api/v1/races/private/${code}`);
    assert.equal(hostRoomRes.status, 200);
    const hostRoom = await hostRoomRes.json();
    assert.ok(hostRoom.pendingParticipants.some((p) => p.userId === 'athlete_1'));

    // 5. Host approves athlete_1
    const approveRes = await fetch(`${ctx.baseUrl}/api/v1/races/private/${code}/approve-participant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: 'host_coach',
        targetUserId: 'athlete_1',
        approve: true,
      }),
    });
    assert.equal(approveRes.status, 200);
    const approvedRoom = await approveRes.json();
    assert.ok(approvedRoom.race.participants.some((p) => p.userId === 'athlete_1'));
    assert.ok(!approvedRoom.pendingParticipants.some((p) => p.userId === 'athlete_1'));

    // Watch polling now returns 'approved'
    const pollApproved = await fetch(`${ctx.baseUrl}/api/v1/races/private/${code}/participant-status?userId=athlete_1`);
    assert.equal(pollApproved.status, 200);
    const approvedStatus = await pollApproved.json();
    assert.equal(approvedStatus.status, 'approved');

    // 6. Another athlete attempts to join and host rejects them
    const watchJoin2 = await fetch(`${ctx.baseUrl}/api/v1/races/pin/${pin}?userId=athlete_2&userName=Bob`);
    assert.equal(watchJoin2.status, 200);

    const rejectRes = await fetch(`${ctx.baseUrl}/api/v1/races/private/${code}/approve-participant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: 'host_coach',
        targetUserId: 'athlete_2',
        approve: false,
      }),
    });
    assert.equal(rejectRes.status, 200);

    // athlete_2 status is rejected
    const pollRejected = await fetch(`${ctx.baseUrl}/api/v1/races/private/${code}/participant-status?userId=athlete_2`);
    assert.equal(pollRejected.status, 200);
    const rejectedStatus = await pollRejected.json();
    assert.equal(rejectedStatus.status, 'rejected');

    // athlete_2 trying to join again with PIN gets 403 rejected
    const retryJoin = await fetch(`${ctx.baseUrl}/api/v1/races/pin/${pin}?userId=athlete_2`);
    assert.equal(retryJoin.status, 403);

    // 7. Host toggles approval requirement OFF (auto-accept all)
    const toggleRes = await fetch(`${ctx.baseUrl}/api/v1/races/private/${code}/toggle-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: 'host_coach',
        requireApproval: false,
      }),
    });
    assert.equal(toggleRes.status, 200);
    const toggledRoom = await toggleRes.json();
    assert.equal(toggledRoom.requireApproval, false);

    // Now athlete_3 joins with PIN and is automatically approved immediately
    const watchJoin3 = await fetch(`${ctx.baseUrl}/api/v1/races/pin/${pin}?userId=athlete_3&userName=Charlie`);
    assert.equal(watchJoin3.status, 200);
    const join3Data = await watchJoin3.json();
    assert.equal(join3Data.approvalStatus, 'approved');
  } finally {
    await ctx.close();
  }
});
