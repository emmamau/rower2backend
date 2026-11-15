const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");

const { default: userStore } = require("../dist/services/user-store.service");
const { default: raceManager } = require("../dist/services/race-manager.service");
const { default: pairingService } = require("../dist/services/pairing.service");
const { default: TelemetryController } = require("../dist/controllers/telemetry.controller");
const { default: RoomController } = require("../dist/controllers/room.controller");

test("Room Watch Pairing Requirement & Quotas (Concurrent + Weekly)", async (t) => {
  const app = express();
  app.use(express.json());

  app.get("/api/v1/races/private/limits", TelemetryController.getPrivateRoomLimits);
  app.post("/api/v1/races/private", TelemetryController.createPrivateRace);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
  });

  const testUser = await userStore.createUser({
    id: `usr_quota_test_${Date.now()}`,
    name: "Athlete Test",
    login: `athlete_test_${Date.now()}`,
    password: "Password123!",
    isSubscriber: false,
    subscriptionTier: "free",
  });

  await t.test("1. Reject room creation if no watch is paired", async () => {
    const res = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-enforce-watch-pairing": "true",
      },
      body: JSON.stringify({
        title: "Test Sans Montre",
        hostUserId: testUser.id,
        isSolo: true,
      }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "WATCH_PAIRING_REQUIRED");
  });

  // Appairage de la montre pour le testUser
  const deviceToken = `tok_dev_${Date.now()}`;
  await pairingService.pairGuestDirect(testUser.id, `dev_${Date.now()}`, {
    token: deviceToken,
    watchModel: "Enduro 3",
  });

  await t.test("2. Allow room creation with paired watch and verify limits API", async () => {
    // Vérification des quotas initiaux (Free : 1 concurrent max, 5 weekly max)
    const limitsRes = await fetch(`${baseUrl}/api/v1/races/private/limits?hostUserId=${testUser.id}&deviceToken=${deviceToken}`);
    assert.equal(limitsRes.status, 200);
    const limits = await limitsRes.json();
    assert.equal(limits.isWatchConnected, true);
    assert.equal(limits.concurrent.max, 1);
    assert.equal(limits.concurrent.remaining, 1);
    assert.equal(limits.weekly.max, 5);
    assert.equal(limits.weekly.remaining, 5);

    // Création 1er salon (OK)
    const createRes = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-device-token": deviceToken,
      },
      body: JSON.stringify({
        title: "Salon 1",
        hostUserId: testUser.id,
        deviceToken,
        isSolo: true,
      }),
    });

    assert.ok(createRes.status === 200 || createRes.status === 201);
    const room1 = await createRes.json();
    assert.ok(room1.id || room1.race?.id);

    // Vérifier que le quota restant passe à 0 pour concurrent
    const limitsAfter = await (await fetch(`${baseUrl}/api/v1/races/private/limits?hostUserId=${testUser.id}&deviceToken=${deviceToken}`)).json();
    assert.equal(limitsAfter.concurrent.current, 1);
    assert.equal(limitsAfter.concurrent.remaining, 0);
    assert.equal(limitsAfter.weekly.remaining, 4);

    // Création d'un 2ème salon simultané : DOIT ÉCHOUER (Plafond simultané 1 atteint pour Free)
    const createFail = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-device-token": deviceToken,
      },
      body: JSON.stringify({
        title: "Salon 2 Bloqué",
        hostUserId: testUser.id,
        deviceToken,
        isSolo: true,
      }),
    });

    assert.equal(createFail.status, 403);
    const failBody = await createFail.json();
    assert.equal(failBody.code, "CONCURRENT_ROOM_LIMIT_REACHED");

    // Clôture/abandon du salon 1
    const raceId = room1.id || room1.race?.id;
    const raceObj = raceManager.getRaceById(raceId);
    if (raceObj) {
      raceObj.status = "COMPLETED";
    }

    // Le quota simultané est maintenant libéré
    const limitsFreed = await (await fetch(`${baseUrl}/api/v1/races/private/limits?hostUserId=${testUser.id}&deviceToken=${deviceToken}`)).json();
    assert.equal(limitsFreed.concurrent.remaining, 1);
  });

  await t.test("3. Quotas Club (3 simultanés, 10 hebdo) and Elite Pro (5 simultanés, 15 hebdo)", async () => {
    // Passer l'utilisateur en Club
    await userStore.updateUser(testUser.id, {
      subscriptionTier: "intermediate",
      isSubscriber: true,
    });

    const clubLimits = await (await fetch(`${baseUrl}/api/v1/races/private/limits?hostUserId=${testUser.id}&deviceToken=${deviceToken}`)).json();
    assert.equal(clubLimits.concurrent.max, 3);
    assert.equal(clubLimits.weekly.max, 10);

    // Passer l'utilisateur en Élite Pro
    await userStore.updateUser(testUser.id, {
      subscriptionTier: "premium",
      isSubscriber: true,
    });

    const eliteLimits = await (await fetch(`${baseUrl}/api/v1/races/private/limits?hostUserId=${testUser.id}&deviceToken=${deviceToken}`)).json();
    assert.equal(eliteLimits.concurrent.max, 5);
    assert.equal(eliteLimits.weekly.max, 15);
  });
});
