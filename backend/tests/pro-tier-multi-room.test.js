const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");

const { default: userStore } = require("../dist/services/user-store.service");
const { default: TelemetryController } = require("../dist/controllers/telemetry.controller");
const { default: pairingService } = require("../dist/services/pairing.service");

test("Reproduction & Validation: Pro user creating multi-user room", async (t) => {
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

  // 1. Utilisateur Pro par login (non préfixé usr_) avec subscriptionTier 'premium' et isSubscriber false
  const userPremium = await userStore.createUser({
    id: `pro_athlete_${Date.now()}`,
    name: "Alex Pro",
    login: `alex_pro_${Date.now()}`,
    password: "Password123!",
    subscriptionTier: "premium",
    subscriptionStatus: "active",
    isSubscriber: false,
  });

  await pairingService.pairGuestDirect(userPremium.id, `dev_pro_${Date.now()}`, {
    token: `tok_pro_${Date.now()}`,
    watchModel: "Fenix 7",
  });

  await t.test("Pro user with subscriptionTier 'premium' (using login) can create a multi-user room", async () => {
    const res = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Salon Pro 10 Rameurs",
        hostUserId: userPremium.login,
        hostUserName: userPremium.name,
        gameMode: "multi",
        maxParticipants: 8,
        targetDistance: 5000,
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 201, `Expected 201 but got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.success, true);
    assert.equal(body.race.maxParticipants, 8);
  });

  // 2. Utilisateur Pro avec identifiant ID préfixé usr_ (cas très fréquent car généré par défaut)
  const userUsrId = await userStore.createUser({
    id: `usr_pro_${Date.now()}`,
    name: "Chris Pro Usr",
    login: `chris_pro_${Date.now()}`,
    password: "Password123!",
    subscriptionTier: "premium",
    subscriptionStatus: "active",
    isSubscriber: false,
  });

  await pairingService.pairGuestDirect(userUsrId.id, `dev_chris_${Date.now()}`, {
    token: `tok_chris_${Date.now()}`,
    watchModel: "Forerunner 965",
  });

  await t.test("Pro user with ID starting with usr_ can create a multi-user room", async () => {
    const res = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Salon Pro Usr",
        hostUserId: userUsrId.id,
        hostUserName: userUsrId.name,
        gameMode: "multi",
        maxParticipants: 8,
        targetDistance: 5000,
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 201, `Expected 201 but got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.success, true);
    assert.equal(body.race.maxParticipants, 8);
  });

  // 3. Utilisateur Pro avec subscriptionTier 'pro' (alias direct de l'offre pro)
  const userProAlias = await userStore.createUser({
    id: `pro_alias_${Date.now()}`,
    name: "Sam Pro Alias",
    login: `sam_pro_${Date.now()}`,
    password: "Password123!",
    subscriptionTier: "pro",
    subscriptionStatus: "active",
    isSubscriber: false,
  });

  await pairingService.pairGuestDirect(userProAlias.id, `dev_pro_alias_${Date.now()}`, {
    token: `tok_pro_alias_${Date.now()}`,
    watchModel: "Forerunner 965",
  });

  await t.test("Pro user with subscriptionTier 'pro' alias can create a multi-user room with 10 racers", async () => {
    const res = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Salon Pro Alias",
        hostUserId: userProAlias.login,
        hostUserName: userProAlias.name,
        gameMode: "multi",
        maxParticipants: 10,
        targetDistance: 10000,
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 201, `Expected 201 but got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.success, true);
    assert.equal(body.race.maxParticipants, 10);
  });
});
