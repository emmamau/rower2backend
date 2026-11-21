const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../dist/models').default;
const duelService = require('../dist/services/duel.service').default;
const userStore = require('../dist/services/user-store.service').default;
const emailService = require('../dist/services/email.service').default;

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
