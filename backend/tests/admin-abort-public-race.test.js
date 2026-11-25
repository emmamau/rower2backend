const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const initAdminRoutes = require("../dist/routes/admin.routes").default;
const initRaceRoutes = require("../dist/routes/race.routes").default;
const db = require("../dist/models").default;
const AdminInitService = require("../dist/services/admin-init.service").default;
const JwtService = require("../dist/services/jwt.service").default;
const { RaceManager } = require("../dist/services/race-manager.service");
const raceManager = RaceManager.getInstance();
const userStore = require("../dist/services/user-store.service").default;

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  initAdminRoutes(app);
  initRaceRoutes(app);

  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
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

test("Admin Abort & Reset Public Race: Complete workflow verification", async (t) => {
  await AdminInitService.init();

  userStore.cacheUser({
    id: "usr_normal_player",
    login: "NormalPlayer",
    email: "player@rowerrace.com",
    role: "USER",
    isAdmin: false,
  });

  const { baseUrl, close } = await createTestServer();
  const adminToken = JwtService.sign({
    userId: "usr_admin_rowerrace",
    login: "Admin_RowerRace",
    email: "admin@rowerrace.com",
    role: "ADMIN",
    isAdmin: true,
  });

  const nonAdminToken = JwtService.sign({
    userId: "usr_normal_player",
    login: "NormalPlayer",
    email: "player@rowerrace.com",
    role: "USER",
    isAdmin: false,
  });

  try {
    await t.test("1. raceManager.abortAndResetPublicRace directly stops old race, voids ranking and creates new lobby", async () => {
      // S'assurer qu'une course publique existe
      await raceManager.initNextPublicRace(10);
      const currentPublic = raceManager.getCurrentPublicRace();
      assert.ok(currentPublic, "Current public race must exist");
      const oldRaceId = currentPublic.id;

      // Ajouter un participant fictif
      raceManager.notifyPlayerJoinedPublic("test_user_1", "TestRacer", undefined, undefined, false);
      assert.ok(currentPublic.participants && currentPublic.participants.has("test_user_1"), "Participant must be added");

      // Déclencher l'arrêt immédiat et réinitialisation
      const result = await raceManager.abortAndResetPublicRace("test_admin_abort");
      assert.equal(result.success, true);
      assert.equal(result.oldRaceId, oldRaceId);
      assert.ok(result.newRace, "A new race must be created");
      assert.notEqual(result.newRace.id, oldRaceId, "New race ID must be different from old race ID");
      assert.equal(result.newRace.status, "LOBBY", "New race must be in LOBBY status");
      assert.equal(result.newRace.participants ? result.newRace.participants.size : 0, 0, "New race must have 0 human participants");
      assert.equal(currentPublic.status, "STOPPED", "Old race must be STOPPED");
      assert.deepEqual(currentPublic.finalRanking, [], "Old race must have empty final ranking (no leaderboard)");
    });

    await t.test("2. POST /api/admin/public-races/abort-and-reset requires admin authentication", async () => {
      // Sans token -> 401
      const noAuthRes = await fetch(`${baseUrl}/api/admin/public-races/abort-and-reset`, {
        method: "POST",
      });
      assert.equal(noAuthRes.status, 401);

      // Avec token non-admin -> 403
      const nonAdminRes = await fetch(`${baseUrl}/api/admin/public-races/abort-and-reset`, {
        method: "POST",
        headers: { Authorization: `Bearer ${nonAdminToken}` },
      });
      assert.equal(nonAdminRes.status, 403);
    });

    await t.test("3. POST /api/admin/public-races/abort-and-reset stops and resets race with admin token", async () => {
      const initialRace = raceManager.getCurrentPublicRace();
      assert.ok(initialRace);
      const oldId = initialRace.id;

      const res = await fetch(`${baseUrl}/api/admin/public-races/abort-and-reset`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.oldRaceId, oldId);
      assert.ok(body.newRace);
      assert.notEqual(body.newRace.id, oldId);

      const activeRace = raceManager.getCurrentPublicRace();
      assert.equal(activeRace.id, body.newRace.id);
      assert.equal(activeRace.status, "LOBBY");
    });

    await t.test("4. POST /api/race/stop stops public race when called by admin (even in LOBBY/COUNTDOWN/RUNNING)", async () => {
      const current = raceManager.getCurrentPublicRace();
      assert.ok(current);
      const publicId = current.id;

      // Un utilisateur normal ne peut pas arrêter la course publique
      const failRes = await fetch(`${baseUrl}/api/race/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raceId: publicId,
          userId: "usr_normal_player"
        })
      });
      assert.equal(failRes.status, 403);

      // EmmaRacer (admin) peut arrêter la course publique
      const successRes = await fetch(`${baseUrl}/api/race/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raceId: publicId,
          userId: "EmmaRacer"
        })
      });
      assert.equal(successRes.status, 200);
      const data = await successRes.json();
      assert.equal(data.success, true);
      assert.deepEqual(data.ranking, [], "No ranking returned for stopped public race");

      // Une nouvelle course publique a été relancée
      const brandNew = raceManager.getCurrentPublicRace();
      assert.notEqual(brandNew.id, publicId);
      assert.equal(brandNew.status, "LOBBY");
    });

  } finally {
    await close();
  }
});
