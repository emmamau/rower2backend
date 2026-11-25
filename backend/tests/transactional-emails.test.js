const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initUserRoutes = require('../dist/routes/user.routes').default;
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const db = require('../dist/models').default;
const emailService = require('../dist/services/email.service').default;
const { getEmailConfig } = require('../dist/services/email.service');
const userStore = require('../dist/services/user-store.service').default;

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  initUserRoutes(app);
  initTelemetryRoutes(app);
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

test('1. Welcome email dispatched on user registration with login and responsive Cyber/Sport template', async () => {
  const ctx = await createTestServer();
  try {
    emailService.clearLog();
    const timestamp = Date.now();
    const login = `welcome_${timestamp}`;
    const email = `welcome_${timestamp}@example.com`;

    const registerRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Dupont',
        prenom: 'Jean',
        anneeNaissance: 1990,
        sexe: 'M',
        pays: 'France',
        login,
        email,
        password: 'InitialPassword1!',
      }),
    });

    assert.equal(registerRes.status, 201);
    const regData = await registerRes.json();
    assert.equal(regData.success, true);

    // Wait a brief tick for async non-blocking email dispatch
    await new Promise((resolve) => setTimeout(resolve, 80));

    const sentEmails = emailService.getSentEmails();
    const welcomeEmail = sentEmails.find((e) => e.to === email);
    assert.ok(welcomeEmail, 'Un email de bienvenue doit avoir été envoyé');
    assert.equal(welcomeEmail.subject, 'Bienvenue sur Rower Race - Votre compte abonné est créé');
    assert.ok(welcomeEmail.html, 'L\'email de bienvenue doit comporter une version HTML soignée');
    assert.ok(welcomeEmail.html.includes(login), 'Le HTML doit contenir le login unique de l\'utilisateur');
    assert.ok(welcomeEmail.html.includes('ROWER RACE'), 'Le template doit intégrer le branding Cyber/Sport');
    assert.ok(welcomeEmail.html.includes('Accéder à Rower Race'), 'Le template doit comporter le bouton CTA');

    const config = getEmailConfig();
    assert.ok(welcomeEmail.html.includes(config.frontendUrl), 'Le CTA doit pointer vers FRONTEND_URL');
  } finally {
    await ctx.close();
  }
});

test('2. Forgot password generates 64-char hex token, sets 1-hour expiration, and sends secure reset email', async () => {
  const ctx = await createTestServer();
  try {
    emailService.clearLog();
    const timestamp = Date.now();
    const login = `resetuser_${timestamp}`;
    const email = `reset_${timestamp}@example.com`;

    // Create user
    await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Martin',
        prenom: 'Sophie',
        anneeNaissance: 1992,
        sexe: 'F',
        pays: 'France',
        login,
        email,
        password: 'PasswordOriginal1!',
      }),
    });

    emailService.clearLog();

    // Forgot password request
    const forgotRes = await fetch(`${ctx.baseUrl}/api/user/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrLogin: login }),
    });

    assert.equal(forgotRes.status, 200);
    const forgotData = await forgotRes.json();
    assert.equal(forgotData.success, true);
    assert.ok(forgotData.token, 'Le token doit être présent en environnement de test');

    // 64 characters hexadecimal
    assert.equal(forgotData.token.length, 64, 'Le jeton doit comporter exactement 64 caractères hexadécimaux');
    assert.match(forgotData.token, /^[0-9a-f]{64}$/, 'Le jeton doit être une chaîne hexadécimale valide');

    // Verify user in store
    const userInStore = await userStore.findUser(login);
    assert.ok(userInStore);
    assert.equal(userInStore.resetPasswordToken, forgotData.token);
    assert.ok(userInStore.resetPasswordExpires);
    const expiresMs = new Date(userInStore.resetPasswordExpires).getTime();
    const nowMs = Date.now();
    // Expiration should be within 1 hour (allowing 5s delta for test execution)
    assert.ok(expiresMs - nowMs > 3590000 && expiresMs - nowMs <= 3600000 + 5000, 'Expiration doit être fixée à 1 heure');

    // Verify sent email
    const sentEmails = emailService.getSentEmails();
    const resetEmail = sentEmails.find((e) => e.to === email);
    assert.ok(resetEmail, 'L\'email de réinitialisation doit avoir été envoyé');
    assert.equal(resetEmail.subject, 'Rower Race - Réinitialisation de votre mot de passe');
    assert.ok(resetEmail.html.includes('/reset-password?token=' + encodeURIComponent(forgotData.token)), 'Le lien HTML doit inclure /reset-password?token=');
    assert.ok(resetEmail.text.includes('/reset-password?token=' + encodeURIComponent(forgotData.token)), 'Le lien texte doit inclure /reset-password?token=');
    assert.ok(resetEmail.html.includes('1 heure'), 'La mention de 1 heure doit être présente');
    assert.ok(resetEmail.html.includes('Réinitialiser mon mot de passe'), 'Le bouton CTA de réinitialisation doit être présent');
  } finally {
    await ctx.close();
  }
});

test('3. Rejection of invalid, non-existent, or expired tokens', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const login = `expired_${timestamp}`;
    const email = `expired_${timestamp}@example.com`;

    await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Durand',
        prenom: 'Paul',
        anneeNaissance: 1988,
        sexe: 'M',
        pays: 'France',
        login,
        email,
        password: 'PasswordValid1!',
      }),
    });

    // 1. Inexistent token
    const invalidRes = await fetch(`${ctx.baseUrl}/api/user/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: '0000000000000000000000000000000000000000000000000000000000000000',
        newPassword: 'BrandNewPassword2026!',
      }),
    });
    assert.equal(invalidRes.status, 400);

    // 2. Expired token
    const expiredToken = '1111111111111111111111111111111111111111111111111111111111111111';
    await userStore.updateUser(login, {
      resetPasswordToken: expiredToken,
      resetPasswordExpires: new Date(Date.now() - 5000), // Expiré il y a 5 secondes
    });

    const expiredRes = await fetch(`${ctx.baseUrl}/api/user/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: expiredToken,
        newPassword: 'BrandNewPassword2026!',
      }),
    });
    assert.equal(expiredRes.status, 400);
    const expiredData = await expiredRes.json();
    assert.equal(expiredData.success, false);
    assert.ok(expiredData.message.includes('invalide ou a expiré'));
  } finally {
    await ctx.close();
  }
});

test('4. Successful password reset, single-use token consumption, and password policy enforcement', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const login = `policy_${timestamp}`;
    const email = `policy_${timestamp}@example.com`;

    await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Leclerc',
        prenom: 'Camille',
        anneeNaissance: 1995,
        sexe: 'F',
        pays: 'France',
        login,
        email,
        password: 'PasswordInit1!',
      }),
    });

    // Request token
    const forgotRes = await fetch(`${ctx.baseUrl}/api/user/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrLogin: email }),
    });
    const { token } = await forgotRes.json();
    assert.ok(token);

    // Test password policy rejections
    const weakPasswords = [
      'short1!', // < 8 car
      'nouppercase1!', // pas de majuscule
      'NOLOWERCASE1!', // pas de minuscule
      'NoDigitsHere!', // pas de chiffre
      'NoSpecialChars1', // pas de caractère spécial
    ];

    for (const weakPwd of weakPasswords) {
      const weakRes = await fetch(`${ctx.baseUrl}/api/user/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: weakPwd }),
      });
      assert.equal(weakRes.status, 400, `Le mot de passe "${weakPwd}" aurait dû être rejeté`);
    }

    // Valid strong password reset
    const newValidPassword = 'BrandNewSecurePassword2026!';
    const resetRes = await fetch(`${ctx.baseUrl}/api/user/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: newValidPassword }),
    });
    assert.equal(resetRes.status, 200);

    // Single-use token: re-attempting with the same token must fail
    const reuseRes = await fetch(`${ctx.baseUrl}/api/user/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'AnotherPassword2026!' }),
    });
    assert.equal(reuseRes.status, 400, 'Le jeton déjà utilisé doit être immédiatement rejeté (usage unique)');

    // Old password must fail
    const oldLoginRes = await fetch(`${ctx.baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: 'PasswordInit1!' }),
    });
    assert.equal(oldLoginRes.status, 401);

    // New password must succeed
    const newLoginRes = await fetch(`${ctx.baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: newValidPassword }),
    });
    assert.equal(newLoginRes.status, 200);
    const newLoginData = await newLoginRes.json();
    assert.equal(newLoginData.success, true);
    assert.ok(newLoginData.token, 'La connexion doit retourner un JWT valide');
  } finally {
    await ctx.close();
  }
});
