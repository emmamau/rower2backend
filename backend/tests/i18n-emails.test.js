const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initUserRoutes = require('../dist/routes/user.routes').default;
const initRoomRoutes = require('../dist/routes/room.routes').default;
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const db = require('../dist/models').default;
const emailService = require('../dist/services/email.service').default;
const userStore = require('../dist/services/user-store.service').default;
const { RaceManager } = require('../dist/services/race-manager.service');
const { JwtService } = require('../dist/services/jwt.service');

const raceManager = RaceManager.getInstance();

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  initUserRoutes(app);
  initRoomRoutes(app);
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

test('1. Registration in English sends English welcome email and stores user.language', async () => {
  const ctx = await createTestServer();
  try {
    emailService.clearLog();
    const ts = Date.now();
    const login = `en_user_${ts}`;
    const email = `en_user_${ts}@example.com`;

    const res = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Smith',
        prenom: 'John',
        anneeNaissance: 1992,
        sexe: 'M',
        pays: 'United Kingdom',
        language: 'en',
        login,
        email,
        password: 'Password123!',
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.user.language, 'en');

    await new Promise((r) => setTimeout(r, 80));

    const sent = emailService.getSentEmails();
    const welcome = sent.find((e) => e.to === email);
    assert.ok(welcome, 'Welcome email must have been sent');
    assert.ok(
      welcome.subject.includes('Welcome to Rower Race'),
      `Subject should be English: ${welcome.subject}`
    );
    assert.ok(welcome.html.includes('Your unique login ID'), 'Body should be English');
  } finally {
    await ctx.close();
  }
});

test('2. Forgot password sends reset email in the user preferred language', async () => {
  const ctx = await createTestServer();
  try {
    emailService.clearLog();
    const ts = Date.now();
    const login = `en_reset_${ts}`;
    const email = `en_reset_${ts}@example.com`;

    // Create English user
    await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Miller',
        prenom: 'Alice',
        anneeNaissance: 1995,
        sexe: 'F',
        pays: 'United States',
        language: 'en',
        login,
        email,
        password: 'Password123!',
      }),
    });

    emailService.clearLog();

    const forgotRes = await fetch(`${ctx.baseUrl}/api/user/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrLogin: email }),
    });

    assert.equal(forgotRes.status, 200);

    const sent = emailService.getSentEmails();
    const resetMail = sent.find((e) => e.to === email);
    assert.ok(resetMail, 'Reset email must be sent');
    assert.ok(
      resetMail.subject.includes('Password Reset') || resetMail.subject.includes('Reset'),
      `Subject should be English: ${resetMail.subject}`
    );
    assert.ok(
      resetMail.html.includes('Reset My Password') || resetMail.html.includes('reset your password'),
      'Body should be English'
    );
  } finally {
    await ctx.close();
  }
});

test('3. Room invitations: sends in player preferred language if registered, or organizer language if external', async () => {
  const ctx = await createTestServer();
  try {
    emailService.clearLog();
    const ts = Date.now();

    // 1. Create French Organizer
    const hostLogin = `host_fr_${ts}`;
    const hostEmail = `host_fr_${ts}@example.com`;
    await userStore.createUser({
      id: hostLogin,
      login: hostLogin,
      name: 'Organisateur Français',
      email: hostEmail,
      subscriptionTier: 'premium',
      isSubscriber: true,
      country: 'France',
      language: 'fr',
    });

    // 2. Create English Player
    const playerLogin = `player_en_${ts}`;
    const playerEmail = `player_en_${ts}@example.com`;
    await userStore.createUser({
      id: playerLogin,
      login: playerLogin,
      name: 'English Rower',
      email: playerEmail,
      subscriptionTier: 'free',
      isSubscriber: false,
      country: 'Canada',
      language: 'en',
    });

    // 3. External invitee (not registered)
    const externalEmail = `external_guest_${ts}@example.com`;

    // 4. Create Private Room
    const createRoomRes = await fetch(`${ctx.baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: hostLogin,
        title: 'Regatta Franco-Anglaise',
        targetDistance: 2000,
        maxParticipants: 5,
        startMode: 'manual',
      }),
    });
    assert.equal(createRoomRes.status, 201);
    const roomData = await createRoomRes.json();
    const room = roomData.room || roomData;
    const roomCode = room.code || room.id;

    emailService.clearLog();

    // 5. Send invitations to both English player and External guest
    const inviteRes = await fetch(`${ctx.baseUrl}/api/rooms/${roomCode}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      body: JSON.stringify({
        hostUserId: hostLogin,
        emails: [playerEmail, externalEmail],
        lang: 'fr', // Organizer is French
      }),
    });

    assert.equal(inviteRes.status, 200);
    const inviteData = await inviteRes.json();
    assert.equal(inviteData.success, true);
    assert.equal(inviteData.count, 2);

    const sent = emailService.getSentEmails();
    const playerMail = sent.find((e) => e.to === playerEmail);
    const guestMail = sent.find((e) => e.to === externalEmail);

    assert.ok(playerMail, 'Registered player must receive an email');
    assert.ok(guestMail, 'External guest must receive an email');

    // Player preferred English -> MUST BE ENGLISH
    assert.ok(
      playerMail.subject.includes('Invitation to') && playerMail.subject.includes('by '),
      `Registered English player should receive English subject: ${playerMail.subject}`
    );
    assert.ok(
      playerMail.html.includes('invites you') || playerMail.html.includes('Join the Regatta'),
      'Registered English player body should be English'
    );

    // Guest has no account -> Falls back to organizer language (French)
    assert.ok(
      guestMail.subject.includes('Invitation à la régate') || guestMail.subject.includes('par '),
      `External guest should receive French subject: ${guestMail.subject}`
    );
    assert.ok(
      guestMail.html.includes('vous invite') || guestMail.html.includes('Rejoindre la Régate'),
      'External guest body should be French'
    );
  } finally {
    await ctx.close();
  }
});

test('4. PUT /api/user/language updates user preference', async () => {
  const ctx = await createTestServer();
  try {
    const ts = Date.now();
    const login = `lang_switch_${ts}`;
    const user = await userStore.createUser({
      id: login,
      login,
      name: 'Lang Switcher',
      email: `${login}@example.com`,
      subscriptionTier: 'free',
      isSubscriber: false,
      language: 'fr',
    });

    const token = JwtService.sign({
      userId: user.id,
      login: user.login,
      role: 'USER',
      isRevoked: false,
    });

    const updateRes = await fetch(`${ctx.baseUrl}/api/user/language`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ language: 'en' }),
    });

    assert.equal(updateRes.status, 200);
    const data = await updateRes.json();
    assert.equal(data.success, true);
    assert.equal(data.language, 'en');
    assert.equal(data.user.language, 'en');

    const freshUser = await userStore.findUser(user.id);
    assert.equal(freshUser?.language, 'en');
  } finally {
    await ctx.close();
  }
});
