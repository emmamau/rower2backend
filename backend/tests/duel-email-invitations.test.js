const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const initUserRoutes = require('../dist/routes/user.routes').default;
const initDuelRoutes = require('../dist/routes/duel.routes').default;
const db = require('../dist/models').default;
const duelService = require('../dist/services/duel.service').default;
const userStore = require('../dist/services/user-store.service').default;
const emailService = require('../dist/services/email.service').default;

function createTestServer() {
  const app = express();
  app.use(express.json());
  initUserRoutes(app);
  initDuelRoutes(app);
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

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

test('DuelChallenge model allows challengedEmail, inviteToken and nullable challengedUserId/challengedLogin', async () => {
  const DuelChallenges = db.duelChallenges;
  assert.ok(DuelChallenges, 'DuelChallenges model must exist');

  const attrs = DuelChallenges.rawAttributes;
  assert.ok(attrs.challengedEmail, 'DuelChallenge must define challengedEmail attribute');
  assert.ok(attrs.inviteToken, 'DuelChallenge must define inviteToken attribute');
  assert.equal(attrs.challengedUserId.allowNull, true, 'challengedUserId must allow null');
  assert.equal(attrs.challengedLogin.allowNull, true, 'challengedLogin must allow null');

  const testId = `test_duel_${Date.now()}`;
  const challenge = DuelChallenges.build({
    id: testId,
    challengerUserId: 'challenger_123',
    challengerLogin: 'challenger_login',
    challengerName: 'Challenger Name',
    challengedUserId: null,
    challengedLogin: 'friend@example.com',
    challengedName: 'friend@example.com',
    challengedEmail: 'friend@example.com',
    inviteToken: 'test_token_abc123',
    slotStart: new Date(),
    slotEnd: new Date(Date.now() + 3600000),
    timezone: 'Europe/Paris',
    targetDistance: 2000,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 72 * 3600000),
  });

  await challenge.validate();

  assert.equal(challenge.challengedUserId, null);
  assert.equal(challenge.challengedEmail, 'friend@example.com');
  assert.equal(challenge.inviteToken, 'test_token_abc123');
});

test('User model defines nullable referredBy attribute', async () => {
  const Users = db.users;
  assert.ok(Users, 'Users model must exist');

  const attrs = Users.rawAttributes;
  assert.ok(attrs.referredBy, 'User must define referredBy attribute');
  assert.equal(attrs.referredBy.allowNull, true, 'referredBy must allow null');

  const user = Users.build({
    id: `test_user_${Date.now()}`,
    name: 'Invited Friend',
    referredBy: 'challenger_123',
  });

  await user.validate();
  assert.equal(user.referredBy, 'challenger_123');
});

function futureUtcDaytimeSlot(daysAhead, hourUtc = 14) {
  const base = new Date();
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + daysAhead, hourUtc, 0, 0, 0));
}

test('createChallenge with unknown email creates pending invitation challenge with inviteToken', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const challenger = await userStore.createUser({
    id: `challenger_${suffix}`,
    login: `challenger_${suffix}`,
    name: 'Challenger',
    email: `challenger_${suffix}@example.com`,
  });

  const slotStart = futureUtcDaytimeSlot(2, 14);
  const outcome = await duelService.createChallenge({
    challengerId: challenger.id,
    challengedLoginOrId: `newfriend_${suffix}@test.com`,
    slotStart,
    targetDistance: 2000,
  });

  assert.ok('challenge' in outcome, `Creation failed: ${outcome.error}`);
  assert.equal(outcome.challenge.challengedEmail, `newfriend_${suffix}@test.com`);
  assert.equal(outcome.challenge.challengedUserId, '');
  assert.equal(outcome.challenge.challengedLogin, `newfriend_${suffix}@test.com`);
  assert.ok(outcome.challenge.inviteToken, 'inviteToken must be generated');
  assert.ok(outcome.challenge.inviteToken.startsWith('inv_'), 'inviteToken should start with inv_');
  assert.equal(outcome.challenge.status, 'PENDING');
  assert.ok(outcome.challenge.roomCode, 'roomCode must be created');

  const sent = emailService.getSentEmails();
  assert.ok(
    sent.some((e) => e.to === `newfriend_${suffix}@test.com`),
    'Invitation email must be dispatched to guest email'
  );

  const retrieved = await duelService.findChallengeByInviteToken(outcome.challenge.inviteToken);
  assert.ok(retrieved, 'Should retrieve challenge by invite token');
  assert.equal(retrieved.id, outcome.challenge.id);

  const missing = await duelService.findChallengeByInviteToken('inv_nonexistent_token');
  assert.equal(missing, null);
});

test('createChallenge with existing user email reuses existing user account', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const existingEmail = `existing_${suffix}@test.com`;
  const existingUser = await userStore.createUser({
    id: `existing_${suffix}`,
    login: `racer_${suffix}`,
    name: 'Existing Racer',
    email: existingEmail,
  });
  const challenger = await userStore.createUser({
    id: `ch2_${suffix}`,
    login: `ch2_${suffix}`,
    name: 'Challenger 2',
    email: `ch2_${suffix}@example.com`,
  });

  const slotStart = futureUtcDaytimeSlot(3, 14);
  const outcome = await duelService.createChallenge({
    challengerId: challenger.id,
    challengedLoginOrId: existingEmail.toUpperCase(),
    slotStart,
    targetDistance: 2000,
  });

  assert.ok('challenge' in outcome, `Creation failed: ${outcome.error}`);
  assert.equal(outcome.challenge.challengedUserId, existingUser.id);
  assert.equal(outcome.challenge.challengedLogin, existingUser.login);
  assert.ok(!outcome.challenge.inviteToken, 'Existing user challenge should not generate inviteToken');
  assert.ok(!outcome.challenge.challengedEmail, 'Existing user challenge should not set guest challengedEmail');
});

test('resendInvitation succeeds when called by challenger and rejects unauthorized or non-guest challenges', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const challenger = await userStore.createUser({
    id: `ch3_${suffix}`,
    login: `ch3_${suffix}`,
    name: 'Challenger 3',
    email: `ch3_${suffix}@example.com`,
  });
  const existingUser = await userStore.createUser({
    id: `ex3_${suffix}`,
    login: `ex3_${suffix}`,
    name: 'Existing 3',
    email: `ex3_${suffix}@example.com`,
  });

  const guestOutcome = await duelService.createChallenge({
    challengerId: challenger.id,
    challengedLoginOrId: `guest3_${suffix}@test.com`,
    slotStart: futureUtcDaytimeSlot(4, 14),
    targetDistance: 2000,
  });
  assert.ok('challenge' in guestOutcome, `Guest creation failed: ${guestOutcome.error}`);

  const countBefore = emailService.getSentEmails().length;
  const resendOk = await duelService.resendInvitation(guestOutcome.challenge.id, challenger.id);
  assert.equal(resendOk.success, true);
  assert.equal(emailService.getSentEmails().length, countBefore + 1);

  const resendOther = await duelService.resendInvitation(guestOutcome.challenge.id, existingUser.id);
  assert.equal(resendOther.success, false);

  const regularOutcome = await duelService.createChallenge({
    challengerId: challenger.id,
    challengedLoginOrId: existingUser.login,
    slotStart: futureUtcDaytimeSlot(5, 14),
    targetDistance: 2000,
  });
  assert.ok('challenge' in regularOutcome, `Regular creation failed: ${regularOutcome.error}`);

  const resendRegular = await duelService.resendInvitation(regularOutcome.challenge.id, challenger.id);
  assert.equal(resendRegular.success, false);
});

test('sendDuelInvitationNewUserEmail (FR) generates cyber email with .ics attachment, calendar links, and signup URL', async () => {
  emailService.clearLog();

  const slotStart = new Date('2026-12-15T18:00:00.000Z').toISOString();
  const slotEnd = new Date('2026-12-15T18:45:00.000Z').toISOString();

  const result = await emailService.sendDuelInvitationNewUserEmail({
    to: 'friend@test.com',
    challengerName: 'Emma Racer',
    challengerLogin: 'EmmaRacer',
    slotStart,
    slotEnd,
    timezone: 'Europe/Paris',
    targetDistance: 2000,
    roomCode: 'RR-1234',
    roomPin: '5678',
    inviteToken: 'tok_test_123',
    lang: 'fr',
  });

  assert.equal(result, true);
  const sent = emailService.getSentEmails();
  const lastMail = sent[sent.length - 1];
  assert.ok(lastMail, 'Email should be logged');
  assert.equal(lastMail.to, 'friend@test.com');
  assert.ok(lastMail.subject.includes('Emma Racer'), 'Subject must include challenger name');
  assert.ok(lastMail.subject.toLowerCase().includes('duel'), 'Subject must mention duel');

  assert.ok(lastMail.html.includes('ROWER'), 'HTML must include Rower Race cyber branding');
  assert.ok(lastMail.html.includes('tok_test_123'), 'HTML must include inviteToken');
  assert.ok(lastMail.html.includes('2000'), 'HTML must include targetDistance');
  assert.ok(lastMail.html.includes('duelInviteToken=tok_test_123'), 'HTML must include signupUrl with duelInviteToken');
  assert.ok(lastMail.html.includes('mode=register'), 'HTML must include mode=register in signupUrl');
  assert.ok(lastMail.html.includes('Europe/Paris'), 'HTML must display timezone');
  assert.ok(lastMail.html.includes('Créer mon compte et relever le défi'), 'HTML must include French CTA');
  assert.ok(lastMail.html.includes('calendar.google.com/calendar/render'), 'HTML must include Google Calendar link');
  assert.ok(lastMail.html.includes('outlook.live.com/calendar'), 'HTML must include Outlook Calendar link');

  assert.ok(lastMail.text.includes('tok_test_123'), 'Text fallback must include signup link with token');
  assert.ok(lastMail.text.includes('2000'), 'Text fallback must include distance');

  assert.ok(Array.isArray(lastMail.attachments) && lastMail.attachments.length === 1, 'Must include .ics attachment');
  const icsAtt = lastMail.attachments[0];
  assert.equal(icsAtt.filename, 'invitation-duel-rowerrace.ics');
  assert.equal(icsAtt.type, 'text/calendar');
  const decodedIcs = Buffer.from(icsAtt.content, 'base64').toString('utf-8');
  assert.ok(decodedIcs.includes('BEGIN:VCALENDAR'), 'Decoded attachment must be valid iCalendar');
  assert.ok(decodedIcs.includes('BEGIN:VEVENT'), 'Decoded attachment must contain VEVENT');
  assert.ok(decodedIcs.includes('20261215T180000Z'), 'ICS must contain DTSTART in UTC');
  assert.ok(decodedIcs.includes('20261215T184500Z'), 'ICS must contain DTEND in UTC');
  assert.ok(decodedIcs.includes('Emma Racer'), 'ICS must mention challenger');
});

test('sendDuelInvitationNewUserEmail (EN) generates localized English cyber email with calendar attachment', async () => {
  emailService.clearLog();

  const slotStart = new Date('2026-12-20T15:00:00.000Z').toISOString();
  const slotEnd = new Date('2026-12-20T15:30:00.000Z').toISOString();

  const result = await emailService.sendDuelInvitationNewUserEmail({
    to: 'english.friend@test.com',
    challengerName: 'Alex Row',
    challengerLogin: 'AlexRow',
    slotStart,
    slotEnd,
    timezone: 'America/New_York',
    targetDistance: 5000,
    roomCode: 'RR-9999',
    roomPin: '4321',
    inviteToken: 'tok_en_456',
    lang: 'en',
  });

  assert.equal(result, true);
  const sent = emailService.getSentEmails();
  const lastMail = sent[sent.length - 1];
  assert.ok(lastMail);
  assert.equal(lastMail.to, 'english.friend@test.com');
  assert.ok(lastMail.subject.includes('Alex Row'));
  assert.ok(lastMail.subject.includes('challenged you to a duel on Rower Race'));
  assert.ok(lastMail.html.includes('<html lang="en">'), 'HTML lang attribute must be en');
  assert.ok(lastMail.html.includes('Create account and accept challenge'), 'HTML must include English CTA');
  assert.ok(lastMail.html.includes('tok_en_456'));
  assert.ok(lastMail.html.includes('5000'));
  assert.ok(lastMail.html.includes('America/New_York'));
  assert.ok(lastMail.html.includes('Google Calendar'));
  assert.ok(lastMail.html.includes('Outlook'));
  assert.ok(lastMail.attachments?.some((a) => a.filename === 'invitation-duel-rowerrace.ics' && a.type === 'text/calendar'));
});

test('GET /api/duels/invite-info returns invite metadata and validates token', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();
  const ctx = await createTestServer();

  try {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const challenger = await userStore.createUser({
      id: `invinfo_ch_${suffix}`,
      login: `invinfo_ch_${suffix}`,
      name: 'Alice Invite',
      email: `invinfo_ch_${suffix}@example.com`,
    });

    const outcome = await duelService.createChallenge({
      challengerId: challenger.id,
      challengedLoginOrId: `invinfo_guest_${suffix}@test.com`,
      slotStart: futureUtcDaytimeSlot(3, 14),
      targetDistance: 1500,
    });
    assert.ok('challenge' in outcome, `Creation failed: ${outcome.error}`);

    const missingRes = await fetch(`${ctx.baseUrl}/api/duels/invite-info`);
    assert.equal(missingRes.status, 400);

    const notFoundRes = await fetch(`${ctx.baseUrl}/api/duels/invite-info?token=inv_does_not_exist`);
    assert.equal(notFoundRes.status, 404);

    const okRes = await fetch(
      `${ctx.baseUrl}/api/duels/invite-info?token=${encodeURIComponent(outcome.challenge.inviteToken)}`
    );
    assert.equal(okRes.status, 200);
    const data = await okRes.json();
    assert.equal(data.success, true);
    assert.equal(data.challenge.id, outcome.challenge.id);
    assert.equal(data.challenge.challengerName, 'Alice Invite');
    assert.equal(data.challenge.challengerLogin, challenger.login);
    assert.equal(data.challenge.targetDistance, 1500);
    assert.equal(data.challenge.challengedEmail, `invinfo_guest_${suffix}@test.com`);
    assert.equal(data.challenge.status, 'PENDING');
  } finally {
    await ctx.close();
  }
});

test('POST /api/duels/:id/resend-invite dispatches email for challenger and rejects unauthorized user', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();
  const ctx = await createTestServer();

  try {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const challenger = await userStore.createUser({
      id: `resend_ch_${suffix}`,
      login: `resend_ch_${suffix}`,
      name: 'Bob Resend',
      email: `resend_ch_${suffix}@example.com`,
    });
    const otherUser = await userStore.createUser({
      id: `resend_other_${suffix}`,
      login: `resend_other_${suffix}`,
      name: 'Other User',
      email: `resend_other_${suffix}@example.com`,
    });

    const outcome = await duelService.createChallenge({
      challengerId: challenger.id,
      challengedLoginOrId: `resend_guest_${suffix}@test.com`,
      slotStart: futureUtcDaytimeSlot(4, 15),
      targetDistance: 2000,
    });
    assert.ok('challenge' in outcome, `Creation failed: ${outcome.error}`);

    const countBefore = emailService.getSentEmails().length;

    const noUserRes = await fetch(`${ctx.baseUrl}/api/duels/${outcome.challenge.id}/resend-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(noUserRes.status, 400);

    const missingChallengeRes = await fetch(`${ctx.baseUrl}/api/duels/nonexistent_duel_id/resend-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: challenger.id }),
    });
    assert.equal(missingChallengeRes.status, 404);

    const unauthRes = await fetch(`${ctx.baseUrl}/api/duels/${outcome.challenge.id}/resend-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: otherUser.id }),
    });
    assert.equal(unauthRes.status, 403);
    const unauthData = await unauthRes.json();
    assert.equal(unauthData.success, false);
    assert.equal(emailService.getSentEmails().length, countBefore);

    const authRes = await fetch(`${ctx.baseUrl}/api/duels/${outcome.challenge.id}/resend-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: challenger.id }),
    });
    assert.equal(authRes.status, 200);
    const authData = await authRes.json();
    assert.equal(authData.success, true);
    assert.equal(emailService.getSentEmails().length, countBefore + 1);
  } finally {
    await ctx.close();
  }
});

test('POST /api/user/register with duelInviteToken links pending duel, sets referredBy, and keeps status PENDING', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();
  const ctx = await createTestServer();

  try {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const challenger = await userStore.createUser({
      id: `reg_tok_ch_${suffix}`,
      login: `reg_tok_ch_${suffix}`,
      name: 'Challenger Token',
      email: `reg_tok_ch_${suffix}@example.com`,
    });

    const guestEmail = `invited_tok_${suffix}@test.com`;
    const outcome = await duelService.createChallenge({
      challengerId: challenger.id,
      challengedLoginOrId: guestEmail,
      slotStart: futureUtcDaytimeSlot(5, 16),
      targetDistance: 2000,
    });
    assert.ok('challenge' in outcome, `Creation failed: ${outcome.error}`);

    const newLogin = `invited_tok_${suffix}`;
    const regRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Invited',
        prenom: 'Friend',
        anneeNaissance: 1994,
        sexe: 'F',
        pays: 'France',
        login: newLogin,
        email: guestEmail,
        password: 'StrongPassword123!',
        duelInviteToken: outcome.challenge.inviteToken,
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    assert.equal(regData.success, true);
    assert.equal(regData.user.referredBy, challenger.id);

    const storedUser = await userStore.findUser(newLogin);
    assert.ok(storedUser, 'Registered user must exist in store');
    assert.equal(storedUser.referredBy, challenger.id);

    const updatedChallenge = await duelService.getChallengeById(outcome.challenge.id);
    assert.ok(updatedChallenge, 'Challenge must still exist');
    assert.equal(updatedChallenge.challengedUserId, storedUser.id);
    assert.equal(updatedChallenge.challengedLogin, newLogin);
    assert.equal(updatedChallenge.challengedName, 'Friend Invited');
    assert.equal(updatedChallenge.status, 'PENDING');
  } finally {
    await ctx.close();
  }
});

test('POST /api/user/register without token links pending duel by matching email and sets referredBy', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();
  const ctx = await createTestServer();

  try {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const challenger = await userStore.createUser({
      id: `reg_mail_ch_${suffix}`,
      login: `reg_mail_ch_${suffix}`,
      name: 'Challenger Email',
      email: `reg_mail_ch_${suffix}@example.com`,
    });

    const guestEmail = `invited_mail_${suffix}@test.com`;
    const outcome = await duelService.createChallenge({
      challengerId: challenger.id,
      challengedLoginOrId: guestEmail,
      slotStart: futureUtcDaytimeSlot(6, 17),
      targetDistance: 2000,
    });
    assert.ok('challenge' in outcome, `Creation failed: ${outcome.error}`);

    const newLogin = `invited_mail_${suffix}`;
    const regRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Email',
        prenom: 'Matcher',
        anneeNaissance: 1991,
        sexe: 'M',
        pays: 'France',
        login: newLogin,
        email: guestEmail.toUpperCase(),
        password: 'StrongPassword123!',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    assert.equal(regData.success, true);
    assert.equal(regData.user.referredBy, challenger.id);

    const updatedChallenge = await duelService.getChallengeById(outcome.challenge.id);
    assert.ok(updatedChallenge);
    assert.equal(updatedChallenge.challengedUserId, regData.user.id);
    assert.equal(updatedChallenge.challengedLogin, newLogin);
    assert.equal(updatedChallenge.challengedName, 'Matcher Email');
    assert.equal(updatedChallenge.status, 'PENDING');
  } finally {
    await ctx.close();
  }
});

test('Email > 64 chars creation/persistence and strict isEmailString validation', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const challenger = await userStore.createUser({
    id: `longmail_ch_${suffix}`,
    login: `longmail_ch_${suffix}`,
    name: 'Long Mail Challenger',
    email: `longmail_ch_${suffix}@example.com`,
  });

  const longLocal = 'very.long.guest.email.address.exceeding.sixty.four.characters.easily';
  const longEmail = `${longLocal}_${suffix}@subdomain.example.com`;
  assert.ok(longEmail.length > 64 && longEmail.length <= 254);

  const outcome = await duelService.createChallenge({
    challengerId: challenger.id,
    challengedLoginOrId: longEmail,
    slotStart: futureUtcDaytimeSlot(4, 14),
    targetDistance: 2000,
  });
  assert.ok('challenge' in outcome, `Long email challenge failed: ${outcome.error}`);
  assert.equal(outcome.challenge.challengedLogin, longEmail);
  assert.equal(outcome.challenge.challengedEmail, longEmail);
  assert.match(outcome.challenge.inviteToken, /^inv_[0-9a-f]{48}$/, 'inviteToken must use 24-byte CSPRNG hex');

  const DuelChallenges = db.duelChallenges;
  const built = DuelChallenges.build({
    id: `long_model_${suffix}`,
    challengerUserId: challenger.id,
    challengerLogin: challenger.login,
    challengerName: challenger.name,
    challengedUserId: null,
    challengedLogin: longEmail,
    challengedName: longEmail,
    challengedEmail: longEmail,
    inviteToken: outcome.challenge.inviteToken,
    slotStart: futureUtcDaytimeSlot(4, 14),
    slotEnd: futureUtcDaytimeSlot(4, 15),
    timezone: 'Europe/Paris',
    targetDistance: 2000,
    status: 'PENDING',
    expiresAt: futureUtcDaytimeSlot(7, 14),
  });
  await built.validate();

  // Rejects angle brackets / quotes / >254 chars as email
  const xssOutcome = await duelService.createChallenge({
    challengerId: challenger.id,
    challengedLoginOrId: 'bad<script>@example.com',
    slotStart: futureUtcDaytimeSlot(4, 14),
    targetDistance: 2000,
  });
  assert.ok('error' in xssOutcome);
  assert.equal(xssOutcome.statusCode, 404);

  const tooLongEmail = `${'a'.repeat(245)}@example.com`;
  assert.ok(tooLongEmail.length > 254);
  const tooLongOutcome = await duelService.createChallenge({
    challengerId: challenger.id,
    challengedLoginOrId: tooLongEmail,
    slotStart: futureUtcDaytimeSlot(4, 14),
    targetDistance: 2000,
  });
  assert.ok('error' in tooLongOutcome);
  assert.equal(tooLongOutcome.statusCode, 404);
});

test('Resend cooldown enforcement and rejection after guest registers', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();
  const ctx = await createTestServer();

  try {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const challenger = await userStore.createUser({
      id: `cd_ch_${suffix}`,
      login: `cd_ch_${suffix}`,
      name: 'Cooldown Challenger',
      email: `cd_ch_${suffix}@example.com`,
    });

    const guestEmail = `cd_guest_${suffix}@test.com`;
    const outcome = await duelService.createChallenge({
      challengerId: challenger.id,
      challengedLoginOrId: guestEmail,
      slotStart: futureUtcDaytimeSlot(5, 14),
      targetDistance: 2000,
    });
    assert.ok('challenge' in outcome, `Creation failed: ${outcome.error}`);

    const countAfterCreate = emailService.getSentEmails().length;

    // First resend succeeds (using challengerLogin to verify identifier flexibility)
    const firstResend = await fetch(`${ctx.baseUrl}/api/duels/${outcome.challenge.id}/resend-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: challenger.login.toUpperCase() }),
    });
    assert.equal(firstResend.status, 200);
    assert.equal(emailService.getSentEmails().length, countAfterCreate + 1);

    // Immediate second resend is blocked by 60s cooldown
    const secondResend = await fetch(`${ctx.baseUrl}/api/duels/${outcome.challenge.id}/resend-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: challenger.id }),
    });
    assert.equal(secondResend.status, 400);
    const secondData = await secondResend.json();
    assert.equal(secondData.success, false);
    assert.ok(secondData.message.includes('60 secondes'));
    assert.equal(emailService.getSentEmails().length, countAfterCreate + 1);

    // Register the guest -> resend must now report already registered
    const guestUser = await userStore.createUser({
      id: `cd_reg_${suffix}`,
      login: `cd_reg_${suffix}`,
      name: 'Registered Guest',
      email: guestEmail,
    });
    await duelService.linkGuestToRegisteredUser(guestUser, outcome.challenge.inviteToken);

    const afterRegResend = await fetch(`${ctx.baseUrl}/api/duels/${outcome.challenge.id}/resend-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: challenger.id }),
    });
    assert.equal(afterRegResend.status, 400);
    const afterRegData = await afterRegResend.json();
    assert.equal(afterRegData.success, false);
    assert.ok(afterRegData.message.includes('déjà créé son compte'));
  } finally {
    await ctx.close();
  }
});

test('Expired invitation is rejected in invite-info and registration linking, and referredBy is sanitized', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();
  const ctx = await createTestServer();

  try {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const challenger = await userStore.createUser({
      id: `exp_ch_${suffix}`,
      login: `exp_ch_${suffix}`,
      name: 'Expired Challenger',
      email: `exp_ch_${suffix}@example.com`,
    });

    const guestEmail = `exp_guest_${suffix}@test.com`;
    const outcome = await duelService.createChallenge({
      challengerId: challenger.id,
      challengedLoginOrId: guestEmail,
      slotStart: futureUtcDaytimeSlot(4, 14),
      targetDistance: 2000,
    });
    assert.ok('challenge' in outcome, `Creation failed: ${outcome.error}`);

    // Force challenge expiration
    outcome.challenge.expiresAt = new Date(Date.now() - 60 * 1000);
    await duelService.persistChallenge(outcome.challenge);

    const infoRes = await fetch(
      `${ctx.baseUrl}/api/duels/invite-info?token=${encodeURIComponent(outcome.challenge.inviteToken)}`
    );
    assert.equal(infoRes.status, 404);
    const infoData = await infoRes.json();
    assert.equal(infoData.success, false);

    // Registering with expired token & bogus referredBy must NOT link challenge or persist bogus referredBy
    const regRes = await fetch(`${ctx.baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Expired',
        prenom: 'Guest',
        anneeNaissance: 1993,
        sexe: 'M',
        pays: 'France',
        login: `exp_user_${suffix}`,
        email: guestEmail,
        password: 'StrongPassword123!',
        duelInviteToken: outcome.challenge.inviteToken,
        referredBy: 'nonexistent_referrer_' + 'x'.repeat(80),
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    assert.equal(regData.user.referredBy, null);

    const refreshed = await duelService.getChallengeById(outcome.challenge.id);
    assert.equal(refreshed.status, 'EXPIRED');
    assert.equal(refreshed.challengedUserId, '');
  } finally {
    await ctx.close();
  }
});

test('POST /api/duels/challenge and GET /api/duels/:id do not leak inviteToken', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();
  const ctx = await createTestServer();

  try {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const challenger = await userStore.createUser({
      id: `leak_ch_${suffix}`,
      login: `leak_ch_${suffix}`,
      name: 'Leak Guard',
      email: `leak_ch_${suffix}@example.com`,
    });

    const createRes = await fetch(`${ctx.baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId: challenger.id,
        challengedLogin: `leak_guest_${suffix}@test.com`,
        slotStart: futureUtcDaytimeSlot(6, 14).toISOString(),
        targetDistance: 2000,
      }),
    });
    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    assert.equal(createData.success, true);
    assert.equal(createData.challenge.inviteToken, undefined, 'createChallenge HTTP response must not expose inviteToken');
    assert.ok(!('inviteToken' in createData.challenge));

    const getRes = await fetch(`${ctx.baseUrl}/api/duels/${createData.challenge.id}`);
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.success, true);
    assert.equal(getData.challenge.inviteToken, undefined, 'GET /api/duels/:id must not expose inviteToken');
    assert.ok(!('inviteToken' in getData.challenge));
  } finally {
    await ctx.close();
  }
});

test('sendDuelInvitationNewUserEmail escapes HTML special characters in user-supplied fields', async () => {
  emailService.clearLog();

  const result = await emailService.sendDuelInvitationNewUserEmail({
    to: 'safe+tag@test.com',
    challengerName: 'Evil <script>alert(1)</script> & "Co"',
    challengerLogin: "bad'login<>",
    slotStart: new Date('2026-12-15T18:00:00.000Z').toISOString(),
    slotEnd: new Date('2026-12-15T18:30:00.000Z').toISOString(),
    timezone: 'Europe/Paris<img src=x>',
    targetDistance: 2000,
    roomCode: 'RR-1234',
    roomPin: '5678',
    inviteToken: 'tok_xss_test',
    lang: 'fr',
  });

  assert.equal(result, true);
  const sent = emailService.getSentEmails();
  const lastMail = sent[sent.length - 1];
  assert.ok(lastMail);
  assert.ok(!lastMail.html.includes('<script>'), 'HTML must not contain raw <script> tag');
  assert.ok(!lastMail.html.includes('<img src=x>'), 'HTML must not contain raw injected <img> tag');
  assert.ok(lastMail.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot;'));
  assert.ok(lastMail.html.includes('bad&#39;login&lt;&gt;'));
  assert.ok(lastMail.html.includes('Europe/Paris&lt;img src=x&gt;'));
});
