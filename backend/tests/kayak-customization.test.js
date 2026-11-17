const { describe, it, before, after } = require("node:test");
const assert = require("assert");
const http = require("http");

describe("Kayak Customization API & Telemetry", () => {
  let app;
  let server;
  let baseUrl;

  before(async () => {
    // import backend dist/src and start ephemeral server
    process.env.NODE_ENV = "test";
    const appModule = require("../dist/index");
    app = appModule.default || appModule.app || appModule;
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
  });

  after((done) => {
    if (server) server.close(done);
    else done();
  });

  it("should register a user with default or custom kayak customization", async () => {
    const registerPayload = {
      nom: "TestKayak",
      prenom: "Racer",
      anneeNaissance: 1990,
      sexe: "M",
      pays: "France",
      login: "kayak_pilot_" + Date.now().toString().slice(-6),
      email: `pilot_${Date.now()}@test.com`,
      password: "password123",
      kayakCustomization: {
        hullColor: "#ff0055",
        bladeColor: "#ffe600",
        pattern: "racing-stripe",
        glowColor: "#ff0055",
      },
    };

    const res = await fetch(`${baseUrl}/api/user/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registerPayload),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.success, true);
    assert.ok(data.user);
    assert.strictEqual(data.user.kayakCustomization?.hullColor, "#ff0055");
  });

  it("should assign default kayak customization matching Spec 3.1 when not provided", async () => {
    const defaultPayload = {
      nom: "DefaultKayak",
      prenom: "Pilot",
      anneeNaissance: 1995,
      sexe: "M",
      pays: "France",
      login: "kayak_def_" + Date.now().toString().slice(-6),
      email: `def_${Date.now()}@test.com`,
      password: "password123",
    };

    const res = await fetch(`${baseUrl}/api/user/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(defaultPayload),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.success, true);
    assert.ok(data.user);
    assert.deepStrictEqual(data.user.kayakCustomization, {
      hullColor: "#00e5ff",
      bladeColor: "#00f0ff",
      pattern: "racing-stripe",
      glowColor: "#00f0ff",
    });
  });

  it("should update active participant kayak in RaceManager and return in leaderboard", async () => {
    const { RaceManager } = require("../dist/services/race-manager.service");
    const raceManager = RaceManager.getInstance();

    const login = "active_pilot_" + Date.now().toString().slice(-6);
    await fetch(`${baseUrl}/api/user/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nom: "Active",
        prenom: "Pilot",
        anneeNaissance: 1991,
        sexe: "M",
        pays: "France",
        login,
        email: `${login}@test.com`,
        password: "password123",
      }),
    });

    const privateRace = raceManager.createPrivateRace({
      title: "Test Room",
      targetDistance: 2000,
      hostUserId: login,
      hostUserName: "Active Pilot",
    });
    assert.ok(privateRace);
    assert.ok(privateRace.id);

    const newKayak = {
      hullColor: "#ff0055",
      bladeColor: "#ffe600",
      pattern: "gradient",
      glowColor: "#ff0055",
    };

    const updateRes = await fetch(`${baseUrl}/api/user/kayak`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: login,
        kayakCustomization: newKayak,
      }),
    });
    assert.strictEqual(updateRes.status, 200);

    const participant = privateRace.participants.get(login);
    assert.ok(participant);
    assert.deepStrictEqual(participant.kayak, newKayak);

    const lbRes = await fetch(`${baseUrl}/api/races/${privateRace.id}/leaderboard`);
    assert.strictEqual(lbRes.status, 200);
    const lbData = await lbRes.json();
    assert.ok(lbData.leaderboard);
    const racerEntry = lbData.leaderboard.find((e) => e.userId === login);
    assert.ok(racerEntry);
    assert.deepStrictEqual(racerEntry.kayak, newKayak);
  });

  it("should update kayak customization via PUT /api/user/kayak", async () => {
    const login = "kayak_update_" + Date.now().toString().slice(-6);
    await fetch(`${baseUrl}/api/user/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nom: "Pilot",
        prenom: "Custom",
        anneeNaissance: 1992,
        sexe: "F",
        pays: "France",
        login,
        email: `${login}@test.com`,
        password: "password123",
      }),
    });

    const updateRes = await fetch(`${baseUrl}/api/user/kayak`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: login,
        kayakCustomization: {
          hullColor: "#39ff14",
          bladeColor: "#00f0ff",
          pattern: "dual-tone",
          glowColor: "#39ff14",
        },
      }),
    });
    const updateData = await updateRes.json();
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateData.success, true);
    assert.strictEqual(updateData.user.kayakCustomization.pattern, "dual-tone");
    assert.strictEqual(updateData.user.kayakCustomization.hullColor, "#39ff14");
  });

  it("should reject invalid color formats on PUT /api/user/kayak", async () => {
    const res = await fetch(`${baseUrl}/api/user/kayak`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "any_user",
        kayakCustomization: {
          hullColor: "not-a-color",
          bladeColor: "#000",
          pattern: "solid",
          glowColor: "#111",
        },
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  it("should attach kayak customization to live metrics in RaceManager.toLiveMetrics", async () => {
    const { RaceManager } = require("../dist/services/race-manager.service");
    const userStore = require("../dist/services/user-store.service").default;

    const login = "kayak_telem_" + Date.now().toString().slice(-6);
    await userStore.createUser({
      id: login,
      login,
      name: "Telemetry Racer",
      kayakCustomization: {
        hullColor: "#ffaa00",
        bladeColor: "#00aaff",
        pattern: "racing-stripe",
        glowColor: "#ffaa00",
      },
    });

    const row = {
      get: (field) => {
        if (field === "userId") return login;
        if (field === "userName") return "Telemetry Racer";
        if (field === "netDistance") return 100;
        if (field === "status") return "in_progress";
        return undefined;
      },
      userId: login,
    };

    const metrics = RaceManager.toLiveMetrics([row], null);
    assert.strictEqual(metrics.length, 1);
    assert.ok(metrics[0].kayak);
    assert.strictEqual(metrics[0].kayak.hullColor, "#ffaa00");
    assert.strictEqual(metrics[0].kayak.pattern, "racing-stripe");
  });
});
