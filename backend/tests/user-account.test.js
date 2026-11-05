const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initUserRoutes = require('../dist/routes/user.routes').default;
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const db = require('../dist/models').default;
const emailService = require('../dist/services/email.service').default;

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

test('User registration with full required subscriber fields & validation', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const uniqueLogin = `racer_${timestamp}`;

    // 1. Missing fields validation
    const incompleteRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Dupont',
        prenom: 'Jean',
        // missing login, email, password, etc.
      }),
    });
    assert.equal(incompleteRes.status, 400);

    // 2. Successful subscriber registration
    const registerRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Dupont',
        prenom: 'Jean',
        anneeNaissance: 1990,
        sexe: 'M',
        pays: 'France',
        login: uniqueLogin,
        email: `${uniqueLogin}@example.com`,
        password: 'SecretPassword123!',
      }),
    });
    assert.equal(registerRes.status, 201);
    const regData = await registerRes.json();
    assert.equal(regData.success, true);
    assert.equal(regData.user.login, uniqueLogin);
    assert.equal(regData.user.email, `${uniqueLogin}@example.com`);
    assert.equal(regData.user.lastName, 'Dupont');
    assert.equal(regData.user.firstName, 'Jean');
    assert.equal(regData.user.birthYear, 1990);
    assert.equal(regData.user.gender, 'M');
    assert.equal(regData.user.country, 'France');
    assert.equal(regData.user.isSubscriber, true);
    assert.equal(regData.user.passwordHash, undefined); // Sensitive data must never be exposed

    // 3. Duplicate login must be rejected (409 Conflict)
    const duplicateRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Martin',
        prenom: 'Paul',
        anneeNaissance: 1995,
        sexe: 'M',
        pays: 'France',
        login: uniqueLogin,
        email: `another_${timestamp}@example.com`,
        password: 'AnotherPassword456!',
      }),
    });
    assert.equal(duplicateRes.status, 409);
    const dupData = await duplicateRes.json();
    assert.equal(dupData.success, false);
    assert.match(dupData.message, /déjà utilisé/i);
  } finally {
    await ctx.close();
  }
});

test('Password authentication & EmmaRacer admin rights', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const login = `user_auth_${timestamp}`;
    const password = 'MyPassword2026!';

    // Register user
    await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Durand',
        prenom: 'Sophie',
        anneeNaissance: 1988,
        sexe: 'F',
        pays: 'Belgique',
        login,
        email: `${login}@example.com`,
        password,
      }),
    });

    // Wrong password -> 401
    const badLoginRes = await fetch(`${ctx.baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login,
        password: 'WrongPassword!',
      }),
    });
    assert.equal(badLoginRes.status, 401);

    // Correct password -> 200
    const goodLoginRes = await fetch(`${ctx.baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login,
        password,
      }),
    });
    assert.equal(goodLoginRes.status, 200);
    const goodData = await goodLoginRes.json();
    assert.equal(goodData.success, true);
    assert.equal(goodData.isSubscriber, true);
    assert.equal(goodData.isAdmin, false);

    // Register EmmaRacer (hardcoded admin)
    const emmaRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Racer',
        prenom: 'Emma',
        anneeNaissance: 1996,
        sexe: 'F',
        pays: 'France',
        login: 'EmmaRacer',
        email: 'emmaracer@rower.fr',
        password: 'AdminPassword123!',
      }),
    });
    const emmaReg = await emmaRes.json();
    assert.equal(emmaReg.user.isAdmin, true);
    assert.equal(emmaReg.user.isSubscriber, true);

    // EmmaRacer login
    const emmaLoginRes = await fetch(`${ctx.baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'EmmaRacer',
        password: 'AdminPassword123!',
      }),
    });
    assert.equal(emmaLoginRes.status, 200);
    const emmaLoginData = await emmaLoginRes.json();
    assert.equal(emmaLoginData.isAdmin, true);
    assert.equal(emmaLoginData.isSubscriber, true);
  } finally {
    await ctx.close();
  }
});

test('Garmin Watch app confirmation flow using unique login', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const login = `watch_racer_${timestamp}`;

    // Register user
    const regRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Watch',
        prenom: 'Alex',
        anneeNaissance: 1992,
        sexe: 'M',
        pays: 'Suisse',
        login,
        email: `${login}@example.com`,
        password: 'Password999!',
      }),
    });
    const regData = await regRes.json();
    assert.equal(regData.success, true);
    const reqId = regData.confirmationRequestId;
    assert.ok(reqId);

    // Watch queries pending request with login
    const watchPendingRes = await fetch(`${ctx.baseUrl}/api/user/auth/pending?userId=${login}`);
    assert.equal(watchPendingRes.status, 200);
    const pendingData = await watchPendingRes.json();
    assert.equal(pendingData.hasPending, true);
    assert.equal(pendingData.login, login);
    assert.equal(pendingData.requestId, reqId);

    // Watch responds approved
    const watchRespondRes = await fetch(`${ctx.baseUrl}/api/user/auth/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: reqId,
        approved: true,
      }),
    });
    assert.equal(watchRespondRes.status, 200);

    // Account status is now confirmed
    const accountRes = await fetch(`${ctx.baseUrl}/api/user/account/${login}`);
    assert.equal(accountRes.status, 200);
    const accData = await accountRes.json();
    assert.equal(accData.account.isConfirmed, true);
  } finally {
    await ctx.close();
  }
});

test('Subscribers & EmmaRacer can create private rooms, unauthenticated guests are rejected', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const subLogin = `sub_host_${timestamp}`;

    // Register a subscriber
    await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Host',
        prenom: 'Chloe',
        anneeNaissance: 1993,
        sexe: 'F',
        pays: 'Canada',
        login: subLogin,
        email: `${subLogin}@example.com`,
        password: 'HostPassword123!',
      }),
    });

    // 1. Subscriber creates a private race -> 201 Created
    const createSubRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Salon Abonne Chloe',
        targetDistance: 2000,
        hostUserId: subLogin,
        hostUserName: 'Chloe',
      }),
    });
    assert.equal(createSubRes.status, 201);
    const subRace = await createSubRes.json();
    assert.equal(subRace.success, true);
    assert.equal(subRace.race.title, 'Salon Abonne Chloe');

    // 2. EmmaRacer creates a private race -> 201 Created
    const createEmmaRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Salon Admin Emma',
        targetDistance: 5000,
        hostUserId: 'EmmaRacer',
        hostUserName: 'EmmaRacer',
      }),
    });
    assert.equal(createEmmaRes.status, 201);
    const emmaRace = await createEmmaRes.json();
    assert.equal(emmaRace.success, true);

    // 3. Free guest / unauthenticated user (usr_...) is forbidden -> 403
    const createGuestRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Salon Invite Gratuit',
        targetDistance: 2000,
        hostUserId: 'usr_guest123',
        hostUserName: 'GuestRacer',
      }),
    });
    assert.equal(createGuestRes.status, 403);
    const guestData = await createGuestRes.json();
    assert.equal(guestData.code, 'SUBSCRIBER_REQUIRED');

    // 4. Omitted or empty hostUserId is forbidden -> 403
    const emptyHostRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Salon Sans Hote',
        targetDistance: 2000,
      }),
    });
    assert.equal(emptyHostRes.status, 403);

    // 5. Anonymous hostUserId is forbidden -> 403
    const anonHostRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Salon Anonyme',
        targetDistance: 2000,
        hostUserId: 'anonymous',
      }),
    });
    assert.equal(anonHostRes.status, 403);
  } finally {
    await ctx.close();
  }
});

test('Password reset procedure (forgot-password and reset-password)', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const login = `reset_user_${timestamp}`;
    const email = `${login}@example.com`;

    // Register user
    await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Moreau',
        prenom: 'Luc',
        anneeNaissance: 1985,
        sexe: 'M',
        pays: 'France',
        login,
        email,
        password: 'InitialPassword1!',
      }),
    });

    // Request password reset
    const forgotRes = await fetch(`${ctx.baseUrl}/api/user/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrLogin: email }),
    });
    assert.equal(forgotRes.status, 200);
    const forgotData = await forgotRes.json();
    const token = forgotData.token;
    assert.ok(token);

    // Reset password with token
    const resetRes = await fetch(`${ctx.baseUrl}/api/user/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        newPassword: 'BrandNewPassword2026!',
      }),
    });
    assert.equal(resetRes.status, 200);

    // Old password should now fail
    const oldLogin = await fetch(`${ctx.baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: 'InitialPassword1!' }),
    });
    assert.equal(oldLogin.status, 401);

    // New password should succeed
    const newLogin = await fetch(`${ctx.baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: 'BrandNewPassword2026!' }),
    });
    assert.equal(newLogin.status, 200);
  } finally {
    await ctx.close();
  }
});

test('Security & Robustness: Emma substring does not grant admin, name is preserved on Garmin approval, strict input validation', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();

    // 1. User named "Emmanuel" or "Emma Watson" must NOT be granted admin rights
    const emmanuelLogin = `emmanuel_${timestamp}`;
    const emmanuelRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Macron',
        prenom: 'Emmanuel',
        anneeNaissance: 1977,
        sexe: 'M',
        pays: 'France',
        login: emmanuelLogin,
        email: `${emmanuelLogin}@example.com`,
        password: 'PasswordEmmanuel1!',
      }),
    });
    assert.equal(emmanuelRes.status, 201);
    const emmanuelData = await emmanuelRes.json();
    assert.equal(emmanuelData.user.isAdmin, false, 'Emmanuel must NOT be admin!');
    assert.equal(emmanuelData.user.isSubscriber, true);
    assert.equal(emmanuelData.user.name, 'Emmanuel Macron');

    // 2. Garmin watch approval must preserve real user name ("Pierre Dupont") and not overwrite with login
    const watchLogin = `athlete_${timestamp}`;
    const regRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Dupont',
        prenom: 'Pierre',
        anneeNaissance: 1994,
        sexe: 'M',
        pays: 'France',
        login: watchLogin,
        email: `${watchLogin}@example.com`,
        password: 'PasswordPierre1!',
        watchUserId: 'W_DUPONT',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    const reqId = regData.confirmationRequestId;

    // Approve via Garmin
    const approveRes = await fetch(`${ctx.baseUrl}/api/user/auth/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: reqId, approved: true }),
    });
    assert.equal(approveRes.status, 200);

    // Profile check: name must remain "Pierre Dupont", NOT overwritten with "athlete_..."
    const accRes = await fetch(`${ctx.baseUrl}/api/user/account/${watchLogin}`);
    assert.equal(accRes.status, 200);
    const accData = await accRes.json();
    assert.equal(accData.account.name, 'Pierre Dupont');
    assert.equal(accData.account.nom, 'Dupont');
    assert.equal(accData.account.prenom, 'Pierre');
    assert.equal(accData.account.isConfirmed, true);

    // Lookup by watchUserId
    const accByWatch = await fetch(`${ctx.baseUrl}/api/user/account/W_DUPONT`);
    assert.equal(accByWatch.status, 200);
    const accByWatchData = await accByWatch.json();
    assert.equal(accByWatchData.account.login, watchLogin);

    // 3. Invalid login formats (with spaces or symbols) are rejected
    const badLoginRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Test',
        prenom: 'Invalid',
        anneeNaissance: 1990,
        sexe: 'M',
        pays: 'France',
        login: 'bad login with spaces',
        email: `bad_${timestamp}@example.com`,
        password: 'Password123!',
      }),
    });
    assert.equal(badLoginRes.status, 400);

    // 4. Invalid birth year (e.g. float or future) is rejected
    const badBirthRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Test',
        prenom: 'Invalid',
        anneeNaissance: 2099,
        sexe: 'M',
        pays: 'France',
        login: `valid_${timestamp}`,
        email: `valid_${timestamp}@example.com`,
        password: 'Password123!',
      }),
    });
    assert.equal(badBirthRes.status, 400);
  } finally {
    await ctx.close();
  }
});

