const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initSubscriptionRoutes = require('../dist/routes/subscription.routes').default;
const initAdminRoutes = require('../dist/routes/admin.routes').default;
const db = require('../dist/models').default;
const userStore = require('../dist/services/user-store.service').default;
const jwtService = require('../dist/services/jwt.service').default;
const subscriptionPlanService = require('../dist/services/subscription-plan.service').default;

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

async function createTestServer() {
  const app = express();
  app.use(express.json());
  initSubscriptionRoutes(app);
  initAdminRoutes(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test('Per-plan paid / pioneer switches and full subscription block', async () => {
  const ctx = await createTestServer();
  try {
    const admin = await userStore.createUser({
      id: 'admin_pioneer_switch',
      login: 'admin_pioneer_switch',
      name: 'Admin',
      email: 'admin_pioneer_switch@rowerrace.com',
      role: 'ADMIN',
      isAdmin: true,
    });
    const adminToken = jwtService.sign({ userId: admin.id, login: admin.login, role: 'ADMIN' });

    const userId = `pioneer_switch_user_${Date.now()}`;
    await userStore.createUser({ id: userId, login: userId, name: 'Runner', email: `${userId}@example.com` });
    const userToken = jwtService.sign({ userId, login: userId, name: 'Runner', email: `${userId}@example.com`, role: 'USER' });

    const toggle = (code, body) =>
      fetch(`${ctx.baseUrl}/api/admin/plans/${code}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(body),
      });
    const getTier = async (id) => {
      const body = await (await fetch(`${ctx.baseUrl}/api/v1/subscriptions/tiers`)).json();
      return body.tiers.find((t) => t.id === id);
    };
    const post = (path, body) =>
      fetch(`${ctx.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify(body),
      });

    // Reset known state
    await toggle('COMPETITOR', { isActive: true });
    await toggle('COMPETITOR', { isActive: true, mode: 'pioneer' });

    // 1. Découverte is never switchable
    const freeToggle = await toggle('FREE', { isActive: false });
    assert.equal(freeToggle.status, 400);
    const free = await getTier('free');
    assert.equal(free.isAvailable, true);

    // 2. Pioneer off, paid on: pioneer blocked, checkout allowed
    const offPioneer = await toggle('COMPETITOR', { isActive: false, mode: 'pioneer' });
    assert.equal(offPioneer.status, 200);
    let tier = await getTier('competitor');
    assert.equal(tier.isPaidEnabled, true);
    assert.equal(tier.isPioneerEnabled, false);
    assert.equal(tier.isAvailable, true);

    const pioneerBlocked = await post('/api/v1/subscriptions/activate-pioneer', { userId, plan: 'competitor' });
    assert.equal(pioneerBlocked.status, 403);
    const checkoutOk = await post('/api/v1/subscriptions/stripe/checkout', { userId, tier: 'competitor' });
    assert.notEqual(checkoutOk.status, 403);

    // 3. Pioneer on, paid off: checkout blocked, pioneer allowed
    await toggle('COMPETITOR', { isActive: true, mode: 'pioneer' });
    await toggle('COMPETITOR', { isActive: false, mode: 'paid' });
    tier = await getTier('competitor');
    assert.equal(tier.isPaidEnabled, false);
    assert.equal(tier.isPioneerEnabled, true);
    assert.equal(tier.isAvailable, true);
    const checkoutBlocked = await post('/api/v1/subscriptions/stripe/checkout', { userId, tier: 'competitor' });
    assert.equal(checkoutBlocked.status, 403);
    const pioneerOk = await post('/api/v1/subscriptions/activate-pioneer', { userId, plan: 'competitor' });
    assert.equal(pioneerOk.status, 200);

    // 4. Both off: tier unavailable, every subscription path blocked
    await toggle('COMPETITOR', { isActive: false, mode: 'pioneer' });
    tier = await getTier('competitor');
    assert.equal(tier.isAvailable, false);
    assert.equal((await post('/api/v1/subscriptions/stripe/checkout', { userId, tier: 'competitor' })).status, 403);
    assert.equal((await post('/api/v1/subscriptions/activate-pioneer', { userId, plan: 'competitor' })).status, 403);
    assert.equal(await subscriptionPlanService.isTierSubscribable('competitor'), false);

    // Restore
    await toggle('COMPETITOR', { isActive: true });
    await toggle('COMPETITOR', { isActive: true, mode: 'pioneer' });
  } finally {
    await ctx.close();
  }
});
