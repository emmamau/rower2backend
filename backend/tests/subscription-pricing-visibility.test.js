const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");

const { getSubscriptionTiers } = require("../dist/controllers/subscription.controller");
const subscriptionPlanService = require("../dist/services/subscription-plan.service").default;

test("Subscription pricing visibility rules: prices only given when active, null by default", async (t) => {
  const app = express();
  app.use(express.json());
  app.get("/api/v1/subscriptions/tiers", getSubscriptionTiers);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
  });

  await t.test("When plans are active, getSubscriptionTiers returns price and isActive: true", async () => {
    await subscriptionPlanService.setPlanActive("STANDARD", true);
    await subscriptionPlanService.setPlanActive("PREMIUM", true);
    await subscriptionPlanService.setPlanActive("FREE", true);

    const res = await fetch(`${baseUrl}/api/v1/subscriptions/tiers`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.tiers));

    const standard = body.tiers.find((t) => t.id === "competitor" || t.id === "intermediate");
    assert.ok(standard);
    assert.equal(standard.isActive, true);
    assert.equal(standard.priceEur, 5.99);
    assert.ok(standard.priceFormatted.includes("5,99"));

    const premium = body.tiers.find((t) => t.id === "club_elite" || t.id === "premium");
    assert.ok(premium);
    assert.equal(premium.isActive, true);
    assert.equal(premium.priceEur, 8.99);

    const free = body.tiers.find((t) => t.id === "free");
    assert.ok(free);
    assert.equal(free.isActive, true);
    assert.equal(free.priceEur, 0);
  });

  await t.test("When plans are inactive, getSubscriptionTiers returns null prices and isActive: false", async () => {
    await subscriptionPlanService.setPlanActive("STANDARD", false);
    await subscriptionPlanService.setPlanActive("PREMIUM", false);
    await subscriptionPlanService.setPlanActive("FREE", false);

    const res = await fetch(`${baseUrl}/api/v1/subscriptions/tiers`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);

    const standard = body.tiers.find((t) => t.id === "competitor" || t.id === "intermediate");
    assert.ok(standard);
    assert.equal(standard.isActive, false);
    assert.equal(standard.priceEur, null);
    assert.equal(standard.priceFormatted, null);

    const premium = body.tiers.find((t) => t.id === "club_elite" || t.id === "premium");
    assert.ok(premium);
    assert.equal(premium.isActive, false);
    assert.equal(premium.priceEur, null);
    assert.equal(premium.priceFormatted, null);

    // Découverte : toujours disponible, indépendamment de son ancien drapeau isActive
    const free = body.tiers.find((t) => t.id === "free");
    assert.ok(free);
    assert.equal(free.isActive, true);
    assert.equal(free.priceEur, 0);

    // Re-active for other tests
    await subscriptionPlanService.setPlanActive("STANDARD", true);
    await subscriptionPlanService.setPlanActive("PREMIUM", true);
    await subscriptionPlanService.setPlanActive("FREE", true);
  });
});
