const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../dist/models").default;
const { formatDetailedCountdown, getWaitingStatusMessage } = require("../dist/services/race-manager.service");
const duelService = require("../dist/services/duel.service").default;
const userStore = require("../dist/services/user-store.service").default;

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

test("1. formatDetailedCountdown formats days, hours, minutes and seconds when needed, otherwise minutes by default", () => {
  // 1. Duration >= 1 day: displays days, hours, minutes, seconds
  const twoDaysMs = (2 * 86400 + 5 * 3600 + 14 * 60 + 25) * 1000;
  assert.equal(formatDetailedCountdown(twoDaysMs), "2j 5h 14m 25s");

  // 2. Duration >= 1 hour: displays hours, minutes, seconds
  const threeHoursMs = (3 * 3600 + 20 * 60 + 45) * 1000;
  assert.equal(formatDetailedCountdown(threeHoursMs), "3h 20m 45s");

  // 3. Duration < 1 hour with non-zero seconds: displays minutes and seconds
  const fifteenMinMs = (15 * 60 + 30) * 1000;
  assert.equal(formatDetailedCountdown(fifteenMinMs), "15m 30s");

  // 4. Duration < 1 hour with zero seconds: default is in minutes
  const exactTenMinMs = 10 * 60 * 1000;
  assert.equal(formatDetailedCountdown(exactTenMinMs), "10 min");

  // 5. Duration < 1 minute: displays seconds
  const thirtySecMs = 30 * 1000;
  assert.equal(formatDetailedCountdown(thirtySecMs), "30s");

  // 6. Zero or negative ms: imminent
  assert.equal(formatDetailedCountdown(0), "imminent");
  assert.equal(formatDetailedCountdown(-5000), "imminent");
});

test("2. getWaitingStatusMessage integrates detailed countdown for scheduled and autoStart private races", () => {
  const baseNow = new Date("2026-11-20T12:00:00.000Z");

  // Multi-day scheduled race (2 days later)
  const raceMultiDay = {
    id: "RACE_MULTI_DAY",
    status: "LOBBY",
    startMode: "scheduled",
    scheduledStartTime: new Date("2026-11-22T14:15:30.000Z"),
    timezone: "Europe/Paris"
  };
  const msgMultiDay = getWaitingStatusMessage(raceMultiDay, baseNow);
  assert.match(msgMultiDay, /2j 2h 15m 30s/);

  // AutoStart race with lobbyEndsAt in 45 minutes
  const raceAutoStart = {
    id: "RACE_AUTO_START",
    status: "LOBBY",
    autoStart: true,
    lobbyEndsAt: new Date(baseNow.getTime() + 45 * 60 * 1000)
  };
  const msgAuto = getWaitingStatusMessage(raceAutoStart, baseNow);
  assert.equal(msgAuto, "Départ dans 45 min");
});

test("3. duelService.deleteChallenge allows deleting REFUSED, CANCELLED and EXPIRED duels and prevents deleting active ones", async () => {
  const uid1 = `user_del_1_${Date.now()}`;
  const uid2 = `user_del_2_${Date.now()}`;
  const stranger = `stranger_${Date.now()}`;

  await userStore.createUser({ id: uid1, login: uid1, name: "Challenger Del", email: `${uid1}@test.com`, isSubscriber: true, subscriptionTier: "premium", duelPreferences: { acceptsDuels: true, isAbsent: false, refusedDays: [], availableWindows: [{ startTime: "00:00", endTime: "23:59" }], timezone: "Europe/Paris" } });
  await userStore.createUser({ id: uid2, login: uid2, name: "Challenged Del", email: `${uid2}@test.com`, duelPreferences: { acceptsDuels: true, isAbsent: false, refusedDays: [], availableWindows: [{ startTime: "00:00", endTime: "23:59" }], timezone: "Europe/Paris" } });
  await userStore.createUser({ id: stranger, login: stranger, name: "Stranger", email: `${stranger}@test.com` });

  const tomorrowNoon = new Date();
  tomorrowNoon.setDate(tomorrowNoon.getDate() + 1);
  tomorrowNoon.setHours(12, 0, 0, 0);

  // Create challenge
  const created = await duelService.createChallenge({
    challengerId: uid1,
    challengedLoginOrId: uid2,
    slotStart: tomorrowNoon.toISOString(),
    slotEnd: new Date(tomorrowNoon.getTime() + 3600000).toISOString(),
    targetDistance: 2000,
  });
  assert.ok("challenge" in created, `Challenge must be created: ${JSON.stringify(created)}`);
  const challengeId = created.challenge.id;

  // 1. Cannot delete while PENDING
  const delPending = await duelService.deleteChallenge({ challengeId, userId: uid1 });
  assert.ok("error" in delPending);
  assert.equal(delPending.statusCode, 400);

  // 2. Respond REFUSED
  const responded = await duelService.respondToChallenge({
    challengeId,
    responderUserId: uid2,
    action: "refuse",
  });
  assert.ok("challenge" in responded);
  assert.equal(responded.challenge.status, "REFUSED");

  // 3. Stranger cannot delete
  const delStranger = await duelService.deleteChallenge({ challengeId, userId: stranger });
  assert.ok("error" in delStranger);
  assert.equal(delStranger.statusCode, 403);

  // 4. Authorized participant (challenger or challenged) can delete
  const delSuccess = await duelService.deleteChallenge({ challengeId, userId: uid2 });
  assert.ok("success" in delSuccess);
  assert.equal(delSuccess.success, true);

  // 5. Challenge is now gone from database and inMemory
  const checkGone = await duelService.getChallengeById(challengeId);
  assert.equal(checkGone, null, "Deleted duel must no longer exist");

  // 6. Test with CANCELLED duel
  const created2 = await duelService.createChallenge({
    challengerId: uid1,
    challengedLoginOrId: uid2,
    slotStart: new Date(Date.now() + 48 * 3600000).toISOString(),
    slotEnd: new Date(Date.now() + 49 * 3600000).toISOString(),
    targetDistance: 5000,
  });
  assert.ok("challenge" in created2);
  const challengeId2 = created2.challenge.id;

  // Cancel it
  const cancelOutcome = await duelService.cancelChallenge({ challengeId: challengeId2, userId: uid1 });
  assert.ok("challenge" in cancelOutcome);
  assert.equal(cancelOutcome.challenge.status, "CANCELLED");

  // Delete it
  const delCancelled = await duelService.deleteChallenge({ challengeId: challengeId2, userId: uid1 });
  assert.ok("success" in delCancelled);
  assert.equal(delCancelled.success, true);

  const checkGone2 = await duelService.getChallengeById(challengeId2);
  assert.equal(checkGone2, null, "Cancelled and deleted duel must no longer exist");
});

test("4. Closing a duel private room via DELETE /api/v1/races/private/:identifier cancels/refuses the duel challenge for both players so it never reappears", async () => {
  const http = require("node:http");
  const express = require("express");
  const initDuelRoutes = require("../dist/routes/duel.routes").default;
  const initTelemetryRoutes = require("../dist/routes/telemetry.routes").default;

  const app = express();
  app.use(express.json());
  initDuelRoutes(app);
  initTelemetryRoutes(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const uidA = `duel_close_a_${Date.now()}`;
    const uidB = `duel_close_b_${Date.now()}`;
    await userStore.createUser({
      id: uidA,
      login: uidA,
      name: "Player A",
      email: `${uidA}@test.com`,
      isSubscriber: true,
      subscriptionTier: "premium",
      duelPreferences: { acceptsDuels: true, isAbsent: false, refusedDays: [], availableWindows: [{ startTime: "00:00", endTime: "23:59" }], timezone: "Europe/Paris" }
    });
    await userStore.createUser({
      id: uidB,
      login: uidB,
      name: "Player B",
      email: `${uidB}@test.com`,
      duelPreferences: { acceptsDuels: true, isAbsent: false, refusedDays: [], availableWindows: [{ startTime: "00:00", endTime: "23:59" }], timezone: "Europe/Paris" }
    });

    // Case 1: Challenger closes the duel room via DELETE /api/v1/races/private/:code while PENDING
    const slot1 = new Date(Date.now() + 48 * 3600000);
    const created1 = await duelService.createChallenge({
      challengerId: uidA,
      challengedLoginOrId: uidB,
      slotStart: slot1.toISOString(),
      slotEnd: new Date(slot1.getTime() + 3600000).toISOString(),
      targetDistance: 2000,
    });
    assert.ok("challenge" in created1);
    const ch1 = created1.challenge;

    const closeRes1 = await fetch(`${baseUrl}/api/v1/races/private/${ch1.roomCode}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostUserId: uidA }),
    });
    assert.equal(closeRes1.status, 200);
    const closeData1 = await closeRes1.json();
    assert.equal(closeData1.success, true);

    const updatedCh1 = await duelService.getChallengeById(ch1.id);
    assert.equal(updatedCh1.status, "CANCELLED", "Challenge must be CANCELLED when challenger closes the duel room");

    // Case 2: Challenged player closes the duel room via DELETE /api/v1/races/private/:code while PENDING -> REFUSED
    const slot2 = new Date(Date.now() + 72 * 3600000);
    const created2 = await duelService.createChallenge({
      challengerId: uidA,
      challengedLoginOrId: uidB,
      slotStart: slot2.toISOString(),
      slotEnd: new Date(slot2.getTime() + 3600000).toISOString(),
      targetDistance: 2000,
    });
    assert.ok("challenge" in created2);
    const ch2 = created2.challenge;

    const closeRes2 = await fetch(`${baseUrl}/api/v1/races/private/${ch2.roomCode}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostUserId: uidB }),
    });
    assert.equal(closeRes2.status, 200);
    const updatedCh2 = await duelService.getChallengeById(ch2.id);
    assert.equal(updatedCh2.status, "REFUSED", "Challenge must be REFUSED when challenged player deletes a PENDING duel room");

    // Case 3: Challenged player closes an ACCEPTED duel room (> 24h) -> CANCELLED for both players
    const slot3 = new Date(Date.now() + 96 * 3600000);
    const created3 = await duelService.createChallenge({
      challengerId: uidA,
      challengedLoginOrId: uidB,
      slotStart: slot3.toISOString(),
      slotEnd: new Date(slot3.getTime() + 3600000).toISOString(),
      targetDistance: 2000,
    });
    assert.ok("challenge" in created3);
    const ch3 = created3.challenge;
    await duelService.respondToChallenge({ challengeId: ch3.id, responderUserId: uidB, action: "accept" });

    const closeRes3 = await fetch(`${baseUrl}/api/v1/races/private/${ch3.roomCode}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostUserId: uidB }),
    });
    assert.equal(closeRes3.status, 200);
    const updatedCh3 = await duelService.getChallengeById(ch3.id);
    assert.equal(updatedCh3.status, "CANCELLED", "Accepted duel (>24h) must be CANCELLED when challenged player deletes the duel room");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
