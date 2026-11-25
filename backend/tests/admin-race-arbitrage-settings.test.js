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

test("Admin & RaceManager: Overtake threshold and inactivity abandon configuration", async () => {
  await AdminInitService.init();

  const { baseUrl, close } = await createTestServer();
  const adminToken = JwtService.sign({
    userId: "usr_admin_rowerrace",
    login: "Admin_RowerRace",
    email: "admin@rowerrace.com",
    role: "ADMIN",
    isAdmin: true,
  });

  try {
    // 1. Initial settings should include default values (5m and 60s)
    const getRes = await fetch(`${baseUrl}/api/admin/public-races/settings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.ok(getData.success);
    assert.equal(getData.settings.overtakeThresholdM, 5);
    assert.equal(getData.settings.inactivityAbandonSec, 60);

    // 2. Update settings with new values (e.g. 10m and 30s)
    const updateRes = await fetch(`${baseUrl}/api/admin/public-races/settings`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        overtake_threshold_m: 10,
        inactivity_abandon_sec: 30,
      }),
    });
    assert.equal(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.ok(updateData.success);
    assert.equal(updateData.settings.overtakeThresholdM, 10);
    assert.equal(updateData.settings.inactivityAbandonSec, 30);

    // Verify RaceManager in-memory synchronization
    assert.equal(raceManager.overtakeThresholdM, 10);
    assert.equal(raceManager.inactivityAbandonMs, 30 * 1000);

    // 3. Validation rejection: out of bounds values
    const badRes1 = await fetch(`${baseUrl}/api/admin/public-races/settings`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        overtake_threshold_m: 0, // min is 1
      }),
    });
    assert.equal(badRes1.status, 400);

    const badRes2 = await fetch(`${baseUrl}/api/admin/public-races/settings`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inactivity_abandon_sec: 10, // min is 15
      }),
    });
    assert.equal(badRes2.status, 400);

    // 4. Test Inactivity Abandon behavior with the new 30s threshold
    const race = raceManager.createPrivateRace({
      title: "Custom Inactivity Test",
      targetDistance: 1000,
      hostUserId: "host_inactivity_test",
      maxDurationMinutes: 15,
    });
    const raceId = race.id;
    race.status = "RUNNING";
    const startMs = Date.now() - 100 * 1000;
    race.startedAt = new Date(startMs);

    // Player stopped 35s ago (with 30s threshold, this MUST abandon; with old 60s, it wouldn't)
    const stopped35sAgo = new Date(Date.now() - 35 * 1000);
    userStore.recordActivity({
      id: `${raceId}_stopped_35s_racer`,
      activityId: raceId,
      userId: "stopped_35s_racer",
      userName: "Stopped Racer",
      status: "in_progress",
      netDistance: 150,
      targetDistance: 1000,
      elapsedTime: 25,
      isBot: false,
      updatedAt: stopped35sAgo,
      lastRowedAtMs: stopped35sAgo.getTime(),
      lastTelemetryAtMs: stopped35sAgo.getTime(),
      update: async function (fields) { Object.assign(this, fields); },
      get: function (k) { return this[k]; },
    });

    // An active human still rowing
    userStore.recordActivity({
      id: `${raceId}_active_human`,
      activityId: raceId,
      userId: "active_human",
      userName: "Active Human",
      status: "in_progress",
      netDistance: 300,
      targetDistance: 1000,
      elapsedTime: 50,
      isBot: false,
      updatedAt: new Date(),
      lastRowedAtMs: Date.now(),
      update: async function (fields) { Object.assign(this, fields); },
      get: function (k) { return this[k]; },
    });

    await raceManager.tickPrivateRaces();

    const actStopped = userStore.findActivityById(`${raceId}_stopped_35s_racer`);
    assert.equal(actStopped.status, "abandoned", "Racer stopped for 35s must be marked abandoned with a 30s threshold");
    assert.equal(actStopped.isDnf, true);

    // 5. Test Public Race payload exposes overtakeThresholdM
    const nextRaceRes = await fetch(`${baseUrl}/api/race/next`);
    assert.equal(nextRaceRes.status, 200);
    const nextRaceData = await nextRaceRes.json();
    assert.equal(nextRaceData.overtakeThresholdM, 10);
    assert.equal(nextRaceData.race.overtakeThresholdM, 10);

  } finally {
    // Restore default settings
    await fetch(`${baseUrl}/api/admin/public-races/settings`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        overtake_threshold_m: 5,
        inactivity_abandon_sec: 60,
      }),
    });
    await close();
  }
});
