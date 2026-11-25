const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Dynamically import compiled dist or require transpiled
const { antiCheatService } = require("../dist/services/anti-cheat.service");
const { verifyAntiCheat } = require("../dist/middleware/anti-cheat.middleware");

test("AntiCheat Service - Mode Bascule & Protection Stricte", async (t) => {
  // Reset initial
  antiCheatService.resetStats();

  await t.test("1. Mode Permissif (Anti-Triche désactivé) autorise tout flux", () => {
    antiCheatService.toggleAntiCheat(false);
    antiCheatService.closeLoadTest();

    const reqMock = {
      body: { deviceId: "SIM_UNOFFICIAL_01" },
      headers: {},
      query: {},
    };

    const res = antiCheatService.verifyRequest(reqMock);
    assert.equal(res.allowed, true);
    assert.equal(res.mode, "disabled");
  });

  await t.test("2. Mode Bouclier Actif bloque les scripts non signés (HTTP 403)", () => {
    antiCheatService.toggleAntiCheat(true);
    antiCheatService.closeLoadTest();

    const reqMock = {
      body: { deviceId: "SIM_UNOFFICIAL_01" },
      headers: {},
      query: {},
      originalUrl: "/api/garmin/boost",
    };

    const res = antiCheatService.verifyRequest(reqMock);
    assert.equal(res.allowed, false);
    assert.match(res.reason, /Garmin Connect IQ requise/);

    const status = antiCheatService.getStatus();
    assert.ok(status.blockedAttemptsCount >= 1);
    assert.equal(status.recentBlocked.length >= 1, true);
    assert.equal(status.recentBlocked[0].deviceId, "SIM_UNOFFICIAL_01");
  });

  await t.test("3. Montre Garmin avec signature HMAC officielle est acceptée", () => {
    antiCheatService.toggleAntiCheat(true);
    antiCheatService.closeLoadTest();

    const devId = "GARMIN_FENIX7_REAL";
    const sig = antiCheatService.generateGarminSignature(devId);

    const reqMock = {
      body: { deviceId: devId },
      headers: { "x-garmin-signature": sig },
      query: {},
    };

    const res = antiCheatService.verifyRequest(reqMock);
    assert.equal(res.allowed, true);
    assert.equal(res.mode, "garmin_official");
  });

  await t.test("4. Ouverture du Mode Tests de Charge autorise le simulateur avec la clé secrète", () => {
    antiCheatService.toggleAntiCheat(true);
    const status = antiCheatService.openLoadTest(60, "LTK-SECRET-KEY-123");
    assert.equal(status.loadTestModeEnabled, true);
    assert.equal(status.loadTestKey, "LTK-SECRET-KEY-123");

    // Requête avec la bonne clé
    const reqWithKey = {
      body: { deviceId: "SIM_GARMIN_01" },
      headers: { "x-load-test-key": "LTK-SECRET-KEY-123" },
      query: {},
    };
    const resKey = antiCheatService.verifyRequest(reqWithKey);
    assert.equal(resKey.allowed, true);
    assert.equal(resKey.mode, "load_test");

    // Requête sans la clé ou avec mauvaise clé
    const reqWrongKey = {
      body: { deviceId: "SIM_GARMIN_02" },
      headers: { "x-load-test-key": "WRONG_KEY" },
      query: {},
    };
    const resWrong = antiCheatService.verifyRequest(reqWrongKey);
    assert.equal(resWrong.allowed, false);
  });

  await t.test("5. Fermeture du Mode Tests de Charge réarme immédiatement le bouclier", () => {
    antiCheatService.closeLoadTest();
    assert.equal(antiCheatService.isLoadTestOpen(), false);

    const reqWithKey = {
      body: { deviceId: "SIM_GARMIN_01" },
      headers: { "x-load-test-key": "LTK-SECRET-KEY-123" },
      query: {},
    };
    const res = antiCheatService.verifyRequest(reqWithKey);
    assert.equal(res.allowed, false);
  });

  await t.test("6. Middleware Express verifyAntiCheat renvoie 403 Forbidden", (t, done) => {
    antiCheatService.toggleAntiCheat(true);
    antiCheatService.closeLoadTest();

    const req = {
      body: { deviceId: "HACK_DEVICE" },
      headers: {},
      query: {},
    };

    let statusCode = 200;
    let jsonPayload = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonPayload = data;
        assert.equal(statusCode, 403);
        assert.equal(data.error, "AntiCheatEnforced");
        assert.equal(data.antiCheatActive, true);
        assert.equal(data.loadTestModeOpen, false);
        done();
      },
    };

    verifyAntiCheat(req, res, () => {
      assert.fail("Should not call next() for unauthenticated script");
    });
  });
});
