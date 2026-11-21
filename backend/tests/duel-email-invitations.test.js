const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../dist/models').default;

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
