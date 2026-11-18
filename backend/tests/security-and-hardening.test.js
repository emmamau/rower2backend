const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Helper pour instancier l'application de test
async function createTestServer() {
  process.env.NODE_ENV = 'test';
  const app = require('../dist/index').default;
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('1. Politique de Mot de Passe Fort : Rejet strict des mots de passe faibles & acceptation des conformes', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();

    // 1a. Trop court (< 8 caractères)
    const resShort = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Sec',
        prenom: 'Test',
        anneeNaissance: 1995,
        sexe: 'M',
        pays: 'France',
        login: `short_${timestamp}`,
        email: `short_${timestamp}@example.com`,
        password: 'Pass1!', // 6 caractères
      }),
    });
    assert.equal(resShort.status, 400);
    const dataShort = await resShort.json();
    assert.match(dataShort.message, /8 caractères/i);

    // 1b. Sans lettre majuscule
    const resNoUpper = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Sec',
        prenom: 'Test',
        anneeNaissance: 1995,
        sexe: 'M',
        pays: 'France',
        login: `noupper_${timestamp}`,
        email: `noupper_${timestamp}@example.com`,
        password: 'password123!',
      }),
    });
    assert.equal(resNoUpper.status, 400);
    const dataNoUpper = await resNoUpper.json();
    assert.match(dataNoUpper.message, /majuscule/i);

    // 1c. Sans chiffre
    const resNoDigit = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Sec',
        prenom: 'Test',
        anneeNaissance: 1995,
        sexe: 'M',
        pays: 'France',
        login: `nodigit_${timestamp}`,
        email: `nodigit_${timestamp}@example.com`,
        password: 'Password!',
      }),
    });
    assert.equal(resNoDigit.status, 400);
    const dataNoDigit = await resNoDigit.json();
    assert.match(dataNoDigit.message, /chiffre/i);

    // 1d. Sans caractère spécial
    const resNoSpecial = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Sec',
        prenom: 'Test',
        anneeNaissance: 1995,
        sexe: 'M',
        pays: 'France',
        login: `nospec_${timestamp}`,
        email: `nospec_${timestamp}@example.com`,
        password: 'Password123',
      }),
    });
    assert.equal(resNoSpecial.status, 400);
    const dataNoSpecial = await resNoSpecial.json();
    assert.match(dataNoSpecial.message, /spécial/i);

    // 1e. Conforme : Succès 201 avec émission du token JWT
    const resValid = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Sec',
        prenom: 'Test',
        anneeNaissance: 1995,
        sexe: 'M',
        pays: 'France',
        login: `valid_${timestamp}`,
        email: `valid_${timestamp}@example.com`,
        password: 'StrongPassword2026!',
      }),
    });
    assert.equal(resValid.status, 201);
    const dataValid = await resValid.json();
    assert.equal(dataValid.success, true);
    assert.ok(dataValid.token, 'Le token JWT doit être renvoyé dès l\'inscription.');
  } finally {
    await ctx.close();
  }
});

test('2. Protection Anti-Robots (Honeypot) : Simulation 200 sans création de compte', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const botLogin = `bot_${timestamp}`;

    const resBot = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'BotSpam',
        prenom: 'Robot',
        anneeNaissance: 1990,
        sexe: 'M',
        pays: 'France',
        login: botLogin,
        email: `bot_${timestamp}@spam.com`,
        password: 'StrongBotPassword2026!',
        website_url: 'http://spam-link.ru', // Champ piège rempli par le bot
      }),
    });
    assert.equal(resBot.status, 200, 'Le honeypot doit répondre 200 pour leurrer le bot');
    const dataBot = await resBot.json();
    assert.equal(dataBot.success, true);

    // Vérifier que le compte n'a JAMAIS été inséré en base
    const userStore = require('../dist/services/user-store.service').default;
    const found = await userStore.findUser(botLogin);
    assert.equal(found, null, 'Le bot ne doit JAMAIS être inséré en base de données');
  } finally {
    await ctx.close();
  }
});

test('3. requireAuth JWT Middleware : Protection 401 sur routes sensibles et autorisation sur son propre compte', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const login = `jwt_user_${timestamp}`;

    // Inscription d'un utilisateur régulier
    const regRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Dupont',
        prenom: 'Luc',
        anneeNaissance: 1993,
        sexe: 'M',
        pays: 'France',
        login,
        email: `${login}@example.com`,
        password: 'StrongUserPassword2026!',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    const token = regData.token;
    assert.ok(token);

    // 3a. Tentative de modification kayak SANS token -> 401 Unauthorized
    const unauthKayakRes = await fetch(`${ctx.baseUrl}/api/user/kayak`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: login,
        kayakCustomization: {
          hullColor: '#ff0055',
          bladeColor: '#ffe600',
          pattern: 'racing-stripe',
          glowColor: '#ff0055',
        },
      }),
    });
    assert.equal(unauthKayakRes.status, 401);

    // 3b. Tentative avec token expiré ou corrompu -> 401 Unauthorized
    const badTokenRes = await fetch(`${ctx.baseUrl}/api/user/kayak`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token-invalide-corrompu',
      },
      body: JSON.stringify({
        userId: login,
        kayakCustomization: {
          hullColor: '#ff0055',
          bladeColor: '#ffe600',
          pattern: 'racing-stripe',
          glowColor: '#ff0055',
        },
      }),
    });
    assert.equal(badTokenRes.status, 401);

    // 3c. Modification avec son propre token valide -> 200 OK
    const authKayakRes = await fetch(`${ctx.baseUrl}/api/user/kayak`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId: login,
        kayakCustomization: {
          hullColor: '#39ff14',
          bladeColor: '#00f0ff',
          pattern: 'dual-tone',
          glowColor: '#39ff14',
        },
      }),
    });
    assert.equal(authKayakRes.status, 200);
    const authData = await authKayakRes.json();
    assert.equal(authData.success, true);
    assert.equal(authData.user.kayakCustomization.pattern, 'dual-tone');

    // 3d. Tentative de modifier le compte de quelqu'un d'autre -> 403 Forbidden
    const hijackRes = await fetch(`${ctx.baseUrl}/api/user/kayak`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId: 'other_user_victim',
        kayakCustomization: {
          hullColor: '#000000',
          bladeColor: '#000000',
          pattern: 'solid',
          glowColor: '#000000',
        },
      }),
    });
    assert.equal(hijackRes.status, 403);
  } finally {
    await ctx.close();
  }
});

test('4. Durcissement HTTP : En-têtes de sécurité, suppression de X-Powered-By et limitation payload 100kb', async () => {
  const ctx = await createTestServer();
  try {
    const res = await fetch(`${ctx.baseUrl}/`);
    assert.equal(res.status, 200);

    // Vérification des en-têtes
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(res.headers.get('x-powered-by'), null, 'X-Powered-By doit être masqué');

    // Test payload > 100kb rejeté (413 Payload Too Large)
    const largePayload = {
      data: 'A'.repeat(105 * 1024), // 105kb
    };
    const resLarge = await fetch(`${ctx.baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(largePayload),
    });
    assert.equal(resLarge.status, 413, 'Un payload > 100kb doit être rejeté avec le code 413');
  } finally {
    await ctx.close();
  }
});

test('5. Anti-DDoS Garmin Telemetry : Isolation par deviceToken pour clubs multi-montres', async () => {
  const ctx = await createTestServer();
  try {
    const { garminBoostRateLimiter } = require('../dist/middleware/rate-limit.middleware');
    assert.ok(garminBoostRateLimiter, 'Le rate-limiter Garmin doit être exporté et configuré');

    // Simuler le keyGenerator pour vérifier la différenciation par deviceToken
    const keyGen = garminBoostRateLimiter.keyGenerator;
    if (typeof keyGen === 'function') {
      const watchA = { body: { deviceToken: 'WATCH_DEV_TOKEN_AAA' }, headers: {}, ip: '192.168.1.1' };
      const watchB = { body: { deviceToken: 'WATCH_DEV_TOKEN_BBB' }, headers: {}, ip: '192.168.1.1' };

      const keyA = keyGen(watchA);
      const keyB = keyGen(watchB);

      assert.equal(keyA, 'WATCH_DEV_TOKEN_AAA');
      assert.equal(keyB, 'WATCH_DEV_TOKEN_BBB');
      assert.notEqual(keyA, keyB, 'Deux montres sur le même Wi-Fi/IP doivent avoir deux clés de rate-limit distinctes !');
    }
  } finally {
    await ctx.close();
  }
});
