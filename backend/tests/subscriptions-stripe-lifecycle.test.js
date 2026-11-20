const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initSubscriptionRoutes = require('../dist/routes/subscription.routes').default;
const initAdminRoutes = require('../dist/routes/admin.routes').default;
const initUserRoutes = require('../dist/routes/user.routes').default;
const db = require('../dist/models').default;
const userStore = require('../dist/services/user-store.service').default;
const emailService = require('../dist/services/email.service').default;
const jwtService = require('../dist/services/jwt.service').default;
const subscriptionPlanService = require('../dist/services/subscription-plan.service').default;

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
  initAdminRoutes(app);
  initUserRoutes(app);

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

test('Admin Plan Toggle & Checkout Restriction', async () => {
  const ctx = await createTestServer();
  emailService.clearLog();

  try {
    const adminUser = await userStore.createUser({
      id: 'admin_test_toggle',
      login: 'admin_test_toggle',
      name: 'Admin Test',
      email: 'admin_toggle@rowerrace.com',
      role: 'ADMIN',
      isAdmin: true,
    });

    const adminToken = jwtService.sign({
      userId: adminUser.id,
      login: adminUser.login,
      role: 'ADMIN',
    });

    const timestamp = Date.now();
    const testUserId = `plan_toggle_user_${timestamp}`;
    await userStore.createUser({
      id: testUserId,
      login: testUserId,
      name: 'Test Runner',
      email: `${testUserId}@example.com`,
    });

    const userToken = jwtService.sign({
      userId: testUserId,
      login: testUserId,
      name: 'Test Runner',
      email: `${testUserId}@example.com`,
      role: 'USER',
    });

    // 1. Initial tiers: all active
    const tiersRes1 = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/tiers`);
    assert.equal(tiersRes1.status, 200);
    const tiersData1 = await tiersRes1.json();
    const clubTier1 = tiersData1.tiers.find((t) => t.id === 'intermediate');
    assert.equal(clubTier1.isActive, true);

    // 2. Admin deactivates Offre Club (STANDARD)
    const toggleRes = await fetch(`${ctx.baseUrl}/api/admin/plans/STANDARD/toggle`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(toggleRes.status, 200);
    const toggleData = await toggleRes.json();
    assert.equal(toggleData.success, true);
    assert.equal(toggleData.plan.isActive, false);

    // 3. Tiers API now returns isActive: false for intermediate
    const tiersRes2 = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/tiers`);
    const tiersData2 = await tiersRes2.json();
    const clubTier2 = tiersData2.tiers.find((t) => t.id === 'intermediate');
    assert.equal(clubTier2.isActive, false);

    // 4. Attempting to checkout deactivated tier is rejected with 403
    const blockedCheckout = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ userId: testUserId, tier: 'intermediate' }),
    });
    assert.equal(blockedCheckout.status, 403);
    const blockedData = await blockedCheckout.json();
    assert.equal(blockedData.success, false);
    assert.match(blockedData.message, /désactivée/i);

    // 5. Admin reactivates Offre Club (STANDARD)
    const reactivateRes = await fetch(`${ctx.baseUrl}/api/admin/plans/STANDARD/toggle`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ isActive: true }),
    });
    assert.equal(reactivateRes.status, 200);
    const reactivateData = await reactivateRes.json();
    assert.equal(reactivateData.plan.isActive, true);

    // 6. Checkout is now accepted
    const acceptedCheckout = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ userId: testUserId, tier: 'intermediate' }),
    });
    assert.equal(acceptedCheckout.status, 200);
    const acceptedData = await acceptedCheckout.json();
    assert.equal(acceptedData.success, true);
    assert.ok(acceptedData.checkoutUrl);
  } finally {
    // Restore STANDARD to true in case
    await subscriptionPlanService.invalidateCache();
    await ctx.close();
  }
});

test('Stripe Webhook & Transactional Emails: Subscription Confirmation', async () => {
  const ctx = await createTestServer();
  emailService.clearLog();

  try {
    const timestamp = Date.now();
    const subUserId = `stripe_sub_user_${timestamp}`;
    const userEmail = `${subUserId}@example.com`;
    await userStore.createUser({
      id: subUserId,
      login: subUserId,
      name: 'Stripe Sub Athlete',
      email: userEmail,
    });

    const stripeCustId = `cus_test_${timestamp}`;
    const stripeSubId = `sub_test_${timestamp}`;

    // Simulate Stripe webhook checkout.session.completed
    const checkoutEvent = {
      id: `evt_cs_${timestamp}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: subUserId,
          customer: stripeCustId,
          subscription: stripeSubId,
          customer_email: userEmail,
          metadata: {
            userId: subUserId,
            tier: 'premium',
          },
        },
      },
    };

    const webhookRes = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkoutEvent),
    });
    assert.equal(webhookRes.status, 200);

    // Verify user is upgraded
    const upgradedUser = await userStore.findUser(subUserId);
    assert.equal(upgradedUser.isSubscriber, true);
    assert.equal(upgradedUser.subscriptionTier, 'premium');
    assert.equal(upgradedUser.stripeSubscriptionId, stripeSubId);

    // Verify subscription confirmation email was triggered
    const sentEmails = emailService.getSentEmails();
    const confirmationEmail = sentEmails.find((e) => e.to === userEmail && /Confirmation de votre abonnement/i.test(e.subject));
    assert.ok(confirmationEmail, 'Subscription confirmation email should be logged');
    assert.match(confirmationEmail.subject, /Élite Pro|premium/i);
    assert.match(confirmationEmail.html, /Abonnement Activé/i);
  } finally {
    await ctx.close();
  }
});

test('User Unsubscribe: Cancels Subscription & Sends Cancellation Email', async () => {
  const ctx = await createTestServer();
  emailService.clearLog();

  try {
    const timestamp = Date.now();
    const unsubUserId = `unsub_user_${timestamp}`;
    const userEmail = `${unsubUserId}@example.com`;
    await userStore.createUser({
      id: unsubUserId,
      login: unsubUserId,
      name: 'Unsubscribe Athlete',
      email: userEmail,
      isSubscriber: true,
      subscriptionTier: 'intermediate',
      subscriptionStatus: 'active',
      stripeSubscriptionId: `sub_stripe_active_${timestamp}`,
    });

    const token = jwtService.sign({
      userId: unsubUserId,
      login: unsubUserId,
      name: 'Unsubscribe Athlete',
      email: userEmail,
      role: 'USER',
      isAdmin: false,
    });

    const unsubRes = await fetch(`${ctx.baseUrl}/api/user/unsubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: unsubUserId }),
    });
    assert.equal(unsubRes.status, 200);
    const unsubData = await unsubRes.json();
    assert.equal(unsubData.success, true);

    const userAfter = await userStore.findUser(unsubUserId);
    assert.equal(userAfter.isSubscriber, false);
    assert.equal(userAfter.subscriptionTier, 'free');
    assert.equal(userAfter.subscriptionStatus, 'canceled');

    // Verify cancellation email was sent
    const sentEmails = emailService.getSentEmails();
    const cancelEmail = sentEmails.find((e) => e.to === userEmail && /Confirmation de résiliation/i.test(e.subject));
    assert.ok(cancelEmail, 'Subscription cancellation email should be logged');
    assert.match(cancelEmail.html, /Offre Club/i);
    assert.match(cancelEmail.html, /Offre Gratuite/i);
  } finally {
    await ctx.close();
  }
});

test('Account Deletion: Purges Data & Sends Account Closure Email', async () => {
  const ctx = await createTestServer();
  emailService.clearLog();

  try {
    const timestamp = Date.now();
    const delUserId = `delete_acc_user_${timestamp}`;
    const userEmail = `${delUserId}@example.com`;
    await userStore.createUser({
      id: delUserId,
      login: delUserId,
      name: 'Goodbye Athlete',
      email: userEmail,
      isSubscriber: true,
      subscriptionTier: 'premium',
      stripeSubscriptionId: `sub_stripe_del_${timestamp}`,
    });

    const token = jwtService.sign({
      userId: delUserId,
      login: delUserId,
      name: 'Goodbye Athlete',
      email: userEmail,
      role: 'USER',
      isAdmin: false,
    });

    const delRes = await fetch(`${ctx.baseUrl}/api/user/account`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: delUserId }),
    });
    assert.equal(delRes.status, 200);

    // Verify user is deleted
    const deletedUser = await userStore.findUser(delUserId);
    assert.equal(deletedUser, null);

    // Verify account closure email was sent
    const sentEmails = emailService.getSentEmails();
    const closureEmail = sentEmails.find((e) => e.to === userEmail && /fermeture définitive de votre compte/i.test(e.subject));
    assert.ok(closureEmail, 'Account closure email should be logged');
    assert.match(closureEmail.html, /RGPD Art\. 17/i);
    assert.match(closureEmail.html, /Compte Fermé/i);
  } finally {
    await ctx.close();
  }
});
