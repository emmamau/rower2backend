const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initUserRoutes = require('../dist/routes/user.routes').default;
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const db = require('../dist/models').default;
const emailService = require('../dist/services/email.service').default;
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

test('Unsubscribe, Delete Account, and 10-day vs Unlimited Statistics Space', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const login = `user_sub_${timestamp}`;

    // 1. Register a new user (isSubscriber: true by default on registration)
    const regRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Martin',
        prenom: 'Claire',
        anneeNaissance: 1992,
        sexe: 'F',
        pays: 'France',
        login,
        email: `${login}@example.com`,
        password: 'PasswordSub1!',
      }),
    });
    assert.equal(regRes.status, 201);

    // Mock 2 activities in the store: one recent (2 days ago), one old (25 days ago)
    const db = require('../dist/models').default;
    const Activities = db.activities;
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const twentyFiveDaysAgo = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);

    const actRecent = {
      id: `RACE_RECENT_${login}`,
      activityId: 'RACE_RECENT',
      userId: login,
      userName: 'Claire Martin',
      targetDistance: 2000,
      netDistance: 2000,
      elapsedTime: 460,
      avgPower: 220,
      avgPace: 115,
      avgStrokeRate: 28,
      totalStrokes: 215,
      totalEnergy: 140,
      finalRank: 1,
      status: 'finished',
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
    };
    userStore.recordActivity(actRecent);
    try { await Activities.create(actRecent); } catch {}

    const actOld = {
      id: `RACE_OLD_${login}`,
      activityId: 'RACE_OLD',
      userId: login,
      userName: 'Claire Martin',
      targetDistance: 5000,
      netDistance: 5000,
      elapsedTime: 1200,
      avgPower: 200,
      avgPace: 120,
      avgStrokeRate: 26,
      totalStrokes: 520,
      totalEnergy: 350,
      finalRank: 2,
      status: 'finished',
      createdAt: twentyFiveDaysAgo,
      updatedAt: twentyFiveDaysAgo,
    };
    userStore.recordActivity(actOld);
    try { await Activities.create(actOld); } catch {}

    // 2. Statistics check as SUBSCRIBER: must return ALL 2 races (unlimited history)
    const statsSubRes = await fetch(`${ctx.baseUrl}/api/user/statistics/${login}`);
    assert.equal(statsSubRes.status, 200);
    const statsSubData = await statsSubRes.json();
    assert.equal(statsSubData.isSubscriber, true);
    assert.equal(statsSubData.historyDaysLimit, null, 'Subscribers must have unlimited history');
    assert.equal(statsSubData.totalRacesAvailable, 2);
    assert.equal(statsSubData.olderRacesLocked, 0);
    assert.equal(statsSubData.activities.length, 2);
    assert.equal(statsSubData.summary.totalWins, 1);
    assert.equal(statsSubData.summary.podiums, 2);

    // 3. User unsubscribes via POST /api/user/unsubscribe
    const unsubRes = await fetch(`${ctx.baseUrl}/api/user/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: login }),
    });
    assert.equal(unsubRes.status, 200);
    const unsubData = await unsubRes.json();
    assert.equal(unsubData.success, true);
    assert.equal(unsubData.user.isSubscriber, false);
    assert.equal(unsubData.user.subscriptionTier, 'free');

    // 4. Statistics check as UNSUBSCRIBED account: must be LIMITED to 10 days!
    // The 25-day-old race is locked, only the 2-day-old race is returned.
    const statsFreeRes = await fetch(`${ctx.baseUrl}/api/user/statistics/${login}`);
    assert.equal(statsFreeRes.status, 200);
    const statsFreeData = await statsFreeRes.json();
    assert.equal(statsFreeData.isSubscriber, false);
    assert.equal(statsFreeData.historyDaysLimit, 10, 'Unsubscribed accounts limited to 10 days');
    assert.equal(statsFreeData.totalRacesAvailable, 2);
    assert.equal(statsFreeData.olderRacesLocked, 1, '1 older race must be locked');
    assert.equal(statsFreeData.activities.length, 1);
    assert.equal(statsFreeData.activities[0].activityId, 'RACE_RECENT');

    // 5. Delete account: EmmaRacer cannot be deleted (403)
    const delEmmaRes = await fetch(`${ctx.baseUrl}/api/user/account`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'EmmaRacer' }),
    });
    assert.equal(delEmmaRes.status, 403);

    // 6. Delete account: regular user Claire Martin is permanently deleted
    const delRes = await fetch(`${ctx.baseUrl}/api/user/account`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: login }),
    });
    assert.equal(delRes.status, 200);
    const delData = await delRes.json();
    assert.equal(delData.success, true);

    // Account lookup now returns 404
    const getDeleted = await fetch(`${ctx.baseUrl}/api/user/account/${login}`);
    assert.equal(getDeleted.status, 404);
  } finally {
    await ctx.close();
  }
});

test('Statistics space gracefully handles raw in-memory activity objects without .get() method', async () => {
  const ctx = await createTestServer();
  try {
    const timestamp = Date.now();
    const login = `raw_obj_user_${timestamp}`;

    // Register a user
    const regRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Raw',
        prenom: 'Tester',
        anneeNaissance: 1988,
        sexe: 'H',
        pays: 'France',
        login,
        email: `${login}@example.com`,
        password: 'PasswordSub1!',
      }),
    });
    assert.equal(regRes.status, 201);

    // Insert a raw object without any .get() method into userStore
    const rawActivity = {
      id: `RAW_ACT_${login}`,
      activityId: 'RAW_ACT',
      userId: login,
      userName: 'Raw Tester',
      targetDistance: 2000,
      netDistance: 2000,
      elapsedTime: 420,
      avgPower: 250,
      avgPace: 105,
      avgStrokeRate: 30,
      totalStrokes: 210,
      totalEnergy: 150,
      finalRank: 1,
      status: 'finished',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    delete rawActivity.get; // Ensure no .get method exists
    userStore.recordActivity(rawActivity);

    // Call statistics endpoint
    const statsRes = await fetch(`${ctx.baseUrl}/api/user/statistics/${login}`);
    assert.equal(statsRes.status, 200);
    const data = await statsRes.json();
    assert.equal(data.success, true);
    assert.equal(data.activities.length >= 1, true);
    assert.equal(data.activities[0].netDistance, 2000);
    assert.equal(data.summary.totalWins, 1);
  } finally {
    await ctx.close();
  }
});

