const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { getFrontendBaseUrl } = require('../dist/controllers/subscription.controller');
const initSubscriptionRoutes = require('../dist/routes/subscription.routes').default;
const userStore = require('../dist/services/user-store.service').default;

function createTestServer() {
  const app = express();
  app.use(express.json());

  // Racine avec redirection automatique vers le frontend si query params
  app.get('/', (req, res) => {
    if (req.query.subscription || req.query.resetToken || req.query.token) {
      const frontendBase = getFrontendBaseUrl(req);
      const queryString = new URLSearchParams(req.query).toString();
      return res.redirect(302, `${frontendBase}/?${queryString}`);
    }
    res.json({ message: 'Welcome to Rower Race Multiplayer Real-Time API.' });
  });

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

test('getFrontendBaseUrl resolves priority correctly', () => {
  // 1. Origin header
  const reqWithOrigin = {
    get: (h) => (h.toLowerCase() === 'origin' ? 'https://rower-dashboard-frontend.onrender.com' : undefined),
  };
  assert.equal(getFrontendBaseUrl(reqWithOrigin), 'https://rower-dashboard-frontend.onrender.com');

  // Origin pointing to backend itself is ignored
  const reqWithSelfOrigin = {
    get: (h) => (h.toLowerCase() === 'origin' ? 'https://rower-api-service.onrender.com' : undefined),
  };
  assert.notEqual(getFrontendBaseUrl(reqWithSelfOrigin), 'https://rower-api-service.onrender.com');

  // 2. Referer header
  const reqWithReferer = {
    get: (h) => (h.toLowerCase() === 'referer' ? 'https://www.rowerrace.com/pricing?ref=app' : undefined),
  };
  assert.equal(getFrontendBaseUrl(reqWithReferer), 'https://www.rowerrace.com');

  // 3. Environment variable fallback
  process.env.FRONTEND_URL = 'https://custom-frontend.rowerrace.com';
  const reqEmpty = { get: () => undefined };
  assert.equal(getFrontendBaseUrl(reqEmpty), 'https://custom-frontend.rowerrace.com');
  delete process.env.FRONTEND_URL;
});

test('Backend root GET / redirects to frontend when query params present', async () => {
  const ctx = await createTestServer();
  try {
    // 1. Without params -> returns API JSON
    const resRoot = await fetch(`${ctx.baseUrl}/`, { redirect: 'manual' });
    assert.equal(resRoot.status, 200);
    const data = await resRoot.json();
    assert.equal(data.message, 'Welcome to Rower Race Multiplayer Real-Time API.');

    // 2. With subscription params -> returns 302 redirect to frontend
    const resSub = await fetch(`${ctx.baseUrl}/?subscription=success&tier=intermediate&session_id=sim_123`, {
      redirect: 'manual',
      headers: {
        Origin: 'https://rower-dashboard-frontend.onrender.com',
      },
    });
    assert.equal(resSub.status, 302);
    const location = resSub.headers.get('location');
    assert.ok(location.startsWith('https://rower-dashboard-frontend.onrender.com/?'));
    assert.ok(location.includes('subscription=success'));
    assert.ok(location.includes('tier=intermediate'));
    assert.ok(location.includes('session_id=sim_123'));
  } finally {
    await ctx.close();
  }
});

test('Subscription checkout creates simulation session targeting frontend, never backend root', async () => {
  const ctx = await createTestServer();
  try {
    // Crée un utilisateur de test
    const testUser = await userStore.createUser({
      id: 'usr_sub_redir_test',
      login: 'sub_redir_test',
      name: 'Sub Redir Test',
      email: 'sub_redir_test@rowerrace.com',
      subscriptionTier: 'free',
      isSubscriber: false,
    });

    // Test POST /api/v1/subscriptions/checkout avec Origin header
    const resCheckout = await fetch(`${ctx.baseUrl}/api/v1/subscriptions/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://rower-dashboard-frontend.onrender.com',
      },
      body: JSON.stringify({
        userId: testUser.id,
        tier: 'intermediate',
      }),
    });

    const data = await resCheckout.json();
    assert.equal(data.success, true);
    assert.ok(data.checkoutUrl, 'Doit retourner une checkoutUrl');
    assert.equal(data.mode, 'simulation');

    const checkoutUrlObj = new URL(data.checkoutUrl);
    const redirectParam = checkoutUrlObj.searchParams.get('redirect');
    assert.ok(redirectParam, 'Doit inclure le paramètre redirect');

    // Le paramètre de redirection doit pointer vers le frontend, PAS le backend !
    assert.ok(
      redirectParam.startsWith('https://rower-dashboard-frontend.onrender.com'),
      `La redirection doit pointer vers le frontend. Obtenu: ${redirectParam}`
    );
    assert.ok(
      !redirectParam.includes('{CHECKOUT_SESSION_ID}'),
      'Le template {CHECKOUT_SESSION_ID} doit avoir été remplacé'
    );
    assert.ok(
      redirectParam.includes('sim_session_'),
      'Le session ID de simulation doit être renseigné'
    );
  } finally {
    await ctx.close();
  }
});
