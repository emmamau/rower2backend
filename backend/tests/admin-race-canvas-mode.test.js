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
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((resClose) => server.close(() => resClose())),
      });
    });
  });
}

test("Admin: race_canvas_mode defaults to follow_camera, is validated, persisted and public", async () => {
  await AdminInitService.init();
  const { baseUrl, close } = await createTestServer();
  const adminToken = JwtService.sign({
    userId: "usr_admin_rowerrace",
    login: "Admin_RowerRace",
    email: "admin@rowerrace.com",
    role: "ADMIN",
    isAdmin: true,
  });
  const auth = { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" };

  try {
    // 1. Valeur par défaut exposée à l'admin et publiquement
    const getRes = await fetch(`${baseUrl}/api/admin/public-races/settings`, { headers: auth });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.ok(["follow_camera", "global_fit"].includes(getData.settings.raceCanvasMode));

    // 2. Passage en global_fit
    const putRes = await fetch(`${baseUrl}/api/admin/public-races/settings`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ raceCanvasMode: "global_fit" }),
    });
    assert.equal(putRes.status, 200);
    const putData = await putRes.json();
    assert.equal(putData.settings.raceCanvasMode, "global_fit");
    assert.equal(raceManager.raceCanvasMode, "global_fit");

    const pubRes = await fetch(`${baseUrl}/api/race/canvas-mode`);
    assert.equal(pubRes.status, 200);
    assert.equal((await pubRes.json()).raceCanvasMode, "global_fit");

    // 3. Valeur invalide rejetée, mode inchangé
    const badRes = await fetch(`${baseUrl}/api/admin/public-races/settings`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ race_canvas_mode: "fullscreen_3d" }),
    });
    assert.equal(badRes.status, 400);
    assert.equal(raceManager.raceCanvasMode, "global_fit");

    // 4. Retour à la valeur par défaut recommandée
    const resetRes = await fetch(`${baseUrl}/api/admin/public-races/settings`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ race_canvas_mode: "follow_camera" }),
    });
    assert.equal(resetRes.status, 200);
    assert.equal(raceManager.raceCanvasMode, "follow_camera");

    // 5. Accès non authentifié refusé sur l'endpoint admin
    const anonRes = await fetch(`${baseUrl}/api/admin/public-races/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raceCanvasMode: "global_fit" }),
    });
    assert.ok([401, 403].includes(anonRes.status));
  } finally {
    await close();
  }
});
