const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const { RaceManager } = require("../dist/services/race-manager.service");
const userStore = require("../dist/services/user-store.service").default;
const initRoomRoutes = require("../dist/routes/room.routes").default;
const initTelemetryRoutes = require("../dist/routes/telemetry.routes").default;
const initRaceRoutes = require("../dist/routes/race.routes").default;

function createTestServer() {
  const app = express();
  app.use(express.json());
  initRoomRoutes(app);
  initTelemetryRoutes(app);
  initRaceRoutes(app);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((resClose) => server.close(resClose)),
      });
    });
  });
}

describe("Multiplayer Salon Bots Configuration & Random Pace", () => {
  const raceManager = RaceManager.getInstance();

  test("1. createPrivateRace with bots generates random paces within [botMaxPace, botMinPace]", async () => {
    const minPace = 165; // Loisir (2:45/500m)
    const maxPace = 115; // Avancé (1:55/500m)
    const botCount = 3;

    const race = raceManager.createPrivateRace({
      title: "Salon Test Multi Bots",
      targetDistance: 2000,
      hostUserId: "host_test_123",
      hostUserName: "Coach Test",
      gameMode: "multi",
      botCount,
      botMinPace: minPace,
      botMaxPace: maxPace,
    });

    assert.ok(race, "Race must be created");
    assert.strictEqual(race.botCount, botCount, "botCount must match");
    assert.strictEqual(race.hasBots, true, "hasBots must be true");
    assert.strictEqual(race.botMinPace, minPace, "botMinPace must be recorded");
    assert.strictEqual(race.botMaxPace, maxPace, "botMaxPace must be recorded");

    // Wait slightly for ensureSalonBots async execution
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Check participants for the bots
    const participants = Array.from(race.participants.values());
    const bots = participants.filter((p) => String(p.userId).startsWith("bot_salon_"));
    assert.strictEqual(bots.length, botCount, `Must have ${botCount} bots registered`);

    for (const b of bots) {
      assert.ok(b.lane >= 2, "Bot lane must be assigned");
      const act = userStore.findActivityById(`${race.id}_${b.userId}`);
      assert.ok(act, `Bot activity must exist for ${b.userId}`);
      assert.ok(act.lastPace >= maxPace && act.lastPace <= minPace,
        `Bot pace ${act.lastPace} must be between ${maxPace} and ${minPace}`);
      assert.ok(act.lastPower > 0, "Bot power must be calculated (> 0)");
      assert.ok(act.lastStrokeRate > 0, "Bot stroke rate must be calculated (> 0)");
      assert.ok(act.avgSpeedKmh > 0, "Bot speed must be calculated (> 0)");
    }
  });

  test("2. updateSalonBots updates bot count and paces in active room", async () => {
    const race = raceManager.createPrivateRace({
      title: "Salon Update Bots",
      targetDistance: 1000,
      hostUserId: "host_test_456",
      gameMode: "multi",
      botCount: 2,
      botMinPace: 160,
      botMaxPace: 140,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Now update bots to 4 bots with new pace bounds
    const updated = await raceManager.updateSalonBots(race.id, 4, 150, 110);
    assert.ok(updated, "Update must succeed");
    assert.strictEqual(updated.botCount, 4);
    assert.strictEqual(updated.hasBots, true);

    const bots = Array.from(updated.participants.values()).filter((p) => String(p.userId).startsWith("bot_salon_"));
    assert.strictEqual(bots.length, 4, "Must now have 4 bots");

    for (const b of bots) {
      const act = userStore.findActivityById(`${race.id}_${b.userId}`);
      assert.ok(act, `Bot activity must exist for ${b.userId}`);
      assert.ok(act.lastPace >= 110 && act.lastPace <= 150,
        `Updated bot pace ${act.lastPace} must be between 110 and 150`);
    }

    // Now remove all bots (botCount: 0)
    const cleared = await raceManager.updateSalonBots(race.id, 0);
    assert.ok(cleared);
    assert.strictEqual(cleared.botCount, 0);
    assert.strictEqual(cleared.hasBots, false);

    const remainingBots = Array.from(cleared.participants.values()).filter((p) => String(p.userId).startsWith("bot_salon_"));
    assert.strictEqual(remainingBots.length, 0, "No bots must remain");
  });

  test("3. HTTP API: GET /api/rooms/limits returns maxBots and POST /api/race/bots updates lobby bots", async () => {
    const { server, baseUrl, close } = await createTestServer();
    try {
      // 1. Quotas check for club subscriber
      const userClub = await userStore.createUser({
        id: "usr_club_bots_test",
        login: "ClubMember",
        name: "Club Member",
        subscriptionTier: "club",
        isSubscriber: true,
      });

      const limitsRes = await fetch(`${baseUrl}/api/rooms/limits?hostUserId=${userClub.id}`);
      assert.strictEqual(limitsRes.status, 200);
      const limitsData = await limitsRes.json();
      assert.strictEqual(limitsData.success, true);
      assert.strictEqual(limitsData.maxBots, 3, "Club member must have maxBots = 3");

      // 2. Create room with 3 bots
      const createRes = await fetch(`${baseUrl}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Multi Salon HTTP",
          targetDistance: 2000,
          hostUserId: userClub.id,
          hostUserName: userClub.name,
          gameMode: "multi",
          botCount: 3,
          botMinPace: 165,
          botMaxPace: 120,
        }),
      });

      assert.strictEqual(createRes.status, 201);
      const createData = await createRes.json();
      assert.ok(createData.code, "Must return code");
      assert.strictEqual(createData.race.botCount, 3);
      assert.strictEqual(createData.race.hasBots, true);

      // 3. Toggle/update bots in lobby
      const toggleRes = await fetch(`${baseUrl}/api/race/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enable: true,
          raceId: createData.race.id,
          userId: userClub.id,
          botCount: 2,
          botMinPace: 150,
          botMaxPace: 130,
        }),
      });

      assert.strictEqual(toggleRes.status, 200);
      const toggleData = await toggleRes.json();
      assert.strictEqual(toggleData.success, true);
      assert.strictEqual(toggleData.hasBots, true);
      assert.strictEqual(toggleData.botCount, 2);
    } finally {
      await close();
    }
  });
});
