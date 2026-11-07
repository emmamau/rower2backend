const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initSubscriptionRoutes = require('../dist/routes/subscription.routes').default;
const db = require('../dist/models').default;
const userStore = require('../dist/services/user-store.service').default;

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

function createTestServer() {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  initSubscriptionRoutes(app);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
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

test('Stripe Subscriptions: Tiers listing and user status with stripe IDs', async () => {
  const ctx = await createTestServer();
  try {
    // 1. Tiers
    const tiersRes = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/tiers`);
    assert.equal(tiersRes.status, 200);
    const tiersData = await tiersRes.json();
    assert.equal(tiersData.success, true);
    assert.equal(tiersData.tiers.length, 3);
    const clubTier = tiersData.tiers.find((t) => t.id === 'intermediate');
    const eliteTier = tiersData.tiers.find((t) => t.id === 'premium');
    assert.equal(clubTier.priceEur, 5.99);
    assert.equal(eliteTier.priceEur, 8.99);

    // 2. Status for seeded EmmaRacer
    const statusRes = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/status/EmmaRacer`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.success, true);
    assert.equal(statusData.tier, 'premium');
    assert.equal(statusData.isSubscriber, true);
    assert.equal(statusData.isAdmin, true);
    assert.ok('stripeCustomerId' in statusData);
    assert.ok('stripeSubscriptionId' in statusData);
  } finally {
    await ctx.close();
  }
});

test('Stripe Checkout Session: input validation and fallback simulation', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const testUserId = `stripe_user_${timestamp}`;
    await userStore.createUser({
      id: testUserId,
      login: testUserId,
      name: 'Stripe Test User',
      email: `${testUserId}@example.com`,
    });

    // 1. Empty userId rejected
    const emptyRes = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'intermediate' }),
    });
    assert.equal(emptyRes.status, 400);

    // 2. Invalid tier rejected
    const invalidTierRes = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: testUserId, tier: 'unsupported_tier' }),
    });
    assert.equal(invalidTierRes.status, 400);

    // 3. Unknown user returns 404
    const unknownRes = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'ghost_user_9999', tier: 'intermediate' }),
    });
    assert.equal(unknownRes.status, 404);

    // 4. Free plan downgrade directly updates user
    const freeRes = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: testUserId, tier: 'free' }),
    });
    assert.equal(freeRes.status, 200);
    const freeData = await freeRes.json();
    assert.equal(freeData.tier, 'free');

    // 5. Club plan checkout generates simulated URL when keys are not configured
    const checkoutRes = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: testUserId, tier: 'intermediate' }),
    });
    assert.equal(checkoutRes.status, 200);
    const checkoutData = await checkoutRes.json();
    assert.equal(checkoutData.success, true);
    assert.ok(checkoutData.checkoutUrl.includes('simulate-checkout'));
  } finally {
    await ctx.close();
  }
});

test('Stripe Customer Portal: validation and resolution by userId or customerId', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const testUserId = `portal_user_${timestamp}`;
    await userStore.createUser({
      id: testUserId,
      login: testUserId,
      name: 'Portal Test User',
      email: `${testUserId}@example.com`,
    });

    // 1. Without customer ID returns 400
    const noCustomerRes = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: testUserId }),
    });
    assert.equal(noCustomerRes.status, 400);

    // 2. Attach stripe customer ID and request portal session
    await userStore.updateUser(testUserId, {
      stripeCustomerId: `cus_test_${timestamp}`,
    });

    const portalRes = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: testUserId }),
    });
    assert.equal(portalRes.status, 200);
    const portalData = await portalRes.json();
    assert.equal(portalData.success, true);
    assert.ok(portalData.url);
  } finally {
    await ctx.close();
  }
});

test('Stripe Webhook: processes checkout.session.completed, customer.subscription lifecycle, invoices, and refunds', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const webhookUserId = `wh_user_${timestamp}`;
    const stripeCustId = `cus_wh_${timestamp}`;
    const stripeSubId = `sub_wh_${timestamp}`;

    await userStore.createUser({
      id: webhookUserId,
      login: webhookUserId,
      name: 'Webhook Athlete',
      email: `${webhookUserId}@example.com`,
      subscriptionTier: 'free',
      isSubscriber: false,
    });

    // 1. checkout.session.completed event
    const checkoutEvent = {
      id: `evt_chk_${timestamp}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${timestamp}`,
          client_reference_id: webhookUserId,
          customer: stripeCustId,
          subscription: stripeSubId,
          metadata: {
            userId: webhookUserId,
            tier: 'premium',
          },
        },
      },
    };

    const whRes1 = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkoutEvent),
    });
    assert.equal(whRes1.status, 200);

    const userAfterCheckout = await userStore.findUser(webhookUserId);
    assert.equal(userAfterCheckout.isSubscriber, true);
    assert.equal(userAfterCheckout.subscriptionTier, 'premium');
    assert.equal(userAfterCheckout.subscriptionStatus, 'active');
    assert.equal(userAfterCheckout.stripeCustomerId, stripeCustId);
    assert.equal(userAfterCheckout.stripeSubscriptionId, stripeSubId);

    // 2. invoice.payment_failed marks past_due
    const failInvoiceEvent = {
      id: `evt_inv_fail_${timestamp}`,
      type: 'invoice.payment_failed',
      data: {
        object: {
          customer: stripeCustId,
        },
      },
    };

    const whRes2 = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(failInvoiceEvent),
    });
    assert.equal(whRes2.status, 200);

    const userAfterFail = await userStore.findUser(webhookUserId);
    assert.equal(userAfterFail.subscriptionStatus, 'past_due');

    // 3. invoice.paid restores active
    const paidInvoiceEvent = {
      id: `evt_inv_paid_${timestamp}`,
      type: 'invoice.paid',
      data: {
        object: {
          customer: stripeCustId,
        },
      },
    };

    const whRes3 = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paidInvoiceEvent),
    });
    assert.equal(whRes3.status, 200);

    const userAfterPaid = await userStore.findUser(webhookUserId);
    assert.equal(userAfterPaid.subscriptionStatus, 'active');

    // 4. customer.subscription.deleted downgrades to free
    const deleteSubEvent = {
      id: `evt_sub_del_${timestamp}`,
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: stripeSubId,
          customer: stripeCustId,
          metadata: { userId: webhookUserId },
        },
      },
    };

    const whRes4 = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deleteSubEvent),
    });
    assert.equal(whRes4.status, 200);

    const userAfterDelete = await userStore.findUser(webhookUserId);
    assert.equal(userAfterDelete.isSubscriber, false);
    assert.equal(userAfterDelete.subscriptionTier, 'free');
    assert.equal(userAfterDelete.subscriptionStatus, 'canceled');

    // 5. charge.refunded event revokes access
    await userStore.updateUser(webhookUserId, {
      isSubscriber: true,
      subscriptionTier: 'intermediate',
      subscriptionStatus: 'active',
    });

    const refundEvent = {
      id: `evt_ref_${timestamp}`,
      type: 'charge.refunded',
      data: {
        object: {
          customer: stripeCustId,
        },
      },
    };

    const whRes5 = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(refundEvent),
    });
    assert.equal(whRes5.status, 200);

    const userAfterRefund = await userStore.findUser(webhookUserId);
    assert.equal(userAfterRefund.isSubscriber, false);
    assert.equal(userAfterRefund.subscriptionTier, 'free');
    assert.equal(userAfterRefund.subscriptionStatus, 'canceled');
  } finally {
    await ctx.close();
  }
});
