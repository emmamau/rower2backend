# Duel 1v1 Email Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable players creating a 1v1 duel to invite a friend via their email address, dispatching a branded cyber/sport invitation email with calendar attachments and automatically linking the duel and referral upon account registration.

**Architecture:** A smart opponent input accepts either a RowerRace username or an email address. If an existing user matches the email, standard duel flow is used; otherwise, a pending duel with `challengedEmail` and an `inviteToken` is created, and an invitation email is sent via `emailService`. On registration with the token or matching email, the duel is reassigned to the newly created account (`status: PENDING`), and the challenger is recorded as `referredBy`.

**Tech Stack:** Node.js, Express, TypeScript, Sequelize (PostgreSQL/SQLite), Resend API / custom Cyber HTML templates, Angular 19 frontend.

**Spec:** Decisions aligned during `/grill-me` session on 2026-11-21:
1. Smart input field detecting email vs username.
2. Auto-linking to existing user if email is registered.
3. Branded invitation email with .ics calendar attachment & calendar links for new friends.
4. Auto-assigning challenge in `PENDING` status upon friend registration + setting `referredBy`.
5. Challenger management UI displaying "Invité : [email] (En attente d'inscription)" with Resend / Cancel actions.

## Global Constraints

- Backend must compile cleanly with `npm run build` in `backend/` and pass `node --test` test suite.
- Frontend must compile cleanly with `npm run build` in `frontend/`.
- No disruption or breaking changes to existing duel creation with usernames or multi-player room flows.
- Adhere to RowerRace Cyber/Sport brand colors (`#060913`, `#0c1a38`, `#00f0ff`, `#ff0055`, `#ff6600`, `#ffe600`).

---

### Task 1: Data Model & Schema Extension (`DuelChallenge` and `User`)

**Files:**
- Modify: `backend/src/models/duel-challenge.model.ts`
- Modify: `backend/src/models/user.model.ts`
- Modify: `backend/src/services/duel.service.ts`
- Test: `backend/tests/duel-email-invitations.test.js`

**Interfaces:**
- Consumes: Existing `DuelChallengeAttributes` and `UserAttributes`.
- Produces:
  - `DuelChallengeAttributes.challengedEmail?: string | null`
  - `DuelChallengeAttributes.inviteToken?: string | null`
  - `UserAttributes.referredBy?: string | null`

- [ ] **Step 1: Write the failing test for model updates**

Create `backend/tests/duel-email-invitations.test.js`:
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../dist/models').default;

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

test('DuelChallenge model allows challengedEmail, inviteToken and nullable challengedUserId', async () => {
  const DuelChallenges = db.duelChallenges;
  assert.ok(DuelChallenges, 'DuelChallenges model must exist');
  
  const testId = `test_duel_${Date.now()}`;
  const challenge = await DuelChallenges.create({
    id: testId,
    challengerUserId: 'challenger_123',
    challengerLogin: 'challenger_login',
    challengerName: 'Challenger Name',
    challengedUserId: '',
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

  assert.equal(challenge.challengedEmail, 'friend@example.com');
  assert.equal(challenge.inviteToken, 'test_token_abc123');

  await DuelChallenges.destroy({ where: { id: testId } }).catch(() => {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test backend/tests/duel-email-invitations.test.js` in `backend/`
Expected: FAIL (fields `challengedEmail` or `inviteToken` not defined or validation failure).

- [ ] **Step 3: Implement model changes**

In `backend/src/models/duel-challenge.model.ts`:
1. Add `challengedEmail?: string | null;` and `inviteToken?: string | null;` to interface `DuelChallengeAttributes`.
2. In `sequelize.define<Model<DuelChallengeAttributes>>`:
   - Change `challengedUserId`: `{ type: DataTypes.STRING(64), allowNull: true, defaultValue: "" }`
   - Add `challengedEmail`: `{ type: DataTypes.STRING(255), allowNull: true }`
   - Add `inviteToken`: `{ type: DataTypes.STRING(128), allowNull: true }`

In `backend/src/models/user.model.ts`:
1. Add `referredBy?: string | null;` to interface `UserAttributes`.
2. In `sequelize.define<Model<UserAttributes>>`:
   - Add `referredBy`: `{ type: DataTypes.STRING(64), allowNull: true }`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test backend/tests/duel-email-invitations.test.js` in `backend/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/duel-challenge.model.ts backend/src/models/user.model.ts backend/tests/duel-email-invitations.test.js
git commit -m "feat(duels): add challengedEmail, inviteToken and referredBy to models"
```

---

### Task 2: Duel Service & Challenge Creation with Email Detection

**Files:**
- Modify: `backend/src/services/duel.service.ts`
- Modify: `backend/src/services/email.service.ts`
- Test: `backend/tests/duel-email-invitations.test.js`

**Interfaces:**
- Consumes:
  - `userStore.findUserByEmail(email: string)` or `userStore.getAllUsers()` filtering by email.
  - `emailService.sendDuelInvitationNewUserEmail(...)`
- Produces:
  - `duelService.createChallenge({ ... })` handles either username or email.
  - `duelService.resendInvitation(challengeId: string, challengerUserId: string)`
  - `duelService.findChallengeByInviteToken(token: string)`

- [ ] **Step 1: Write failing tests for email-based challenge creation**

Append to `backend/tests/duel-email-invitations.test.js`:
```javascript
const duelService = require('../dist/services/duel.service').default;
const userStore = require('../dist/services/user-store.service').default;

test('createChallenge with unknown email creates pending invitation challenge with inviteToken', async () => {
  const challenger = await userStore.createUser({
    id: `challenger_${Date.now()}`,
    login: `challenger_${Date.now()}`,
    name: 'Challenger',
    email: `challenger_${Date.now()}@example.com`,
  });

  const slotStart = new Date(Date.now() + 24 * 3600000);
  const outcome = await duelService.createChallenge({
    challengerId: challenger.id,
    challengedLoginOrId: 'newfriend@test.com',
    slotStart,
    targetDistance: 2000,
  });

  assert.ok('challenge' in outcome, `Creation failed: ${outcome.error}`);
  assert.equal(outcome.challenge.challengedEmail, 'newfriend@test.com');
  assert.equal(outcome.challenge.challengedUserId, '');
  assert.ok(outcome.challenge.inviteToken, 'inviteToken must be generated');
  assert.equal(outcome.challenge.status, 'PENDING');

  // Verify findChallengeByInviteToken
  const retrieved = await duelService.findChallengeByInviteToken(outcome.challenge.inviteToken);
  assert.ok(retrieved, 'Should retrieve challenge by invite token');
  assert.equal(retrieved.id, outcome.challenge.id);
});

test('createChallenge with existing user email reuses existing user account', async () => {
  const existingEmail = `existing_${Date.now()}@test.com`;
  const existingUser = await userStore.createUser({
    id: `existing_${Date.now()}`,
    login: `racer_${Date.now()}`,
    name: 'Existing Racer',
    email: existingEmail,
  });
  const challenger = await userStore.createUser({
    id: `ch2_${Date.now()}`,
    login: `ch2_${Date.now()}`,
    name: 'Challenger 2',
    email: `ch2_${Date.now()}@example.com`,
  });

  const slotStart = new Date(Date.now() + 48 * 3600000);
  const outcome = await duelService.createChallenge({
    challengerId: challenger.id,
    challengedLoginOrId: existingEmail,
    slotStart,
    targetDistance: 2000,
  });

  assert.ok('challenge' in outcome);
  assert.equal(outcome.challenge.challengedUserId, existingUser.id);
  assert.equal(outcome.challenge.challengedLogin, existingUser.login);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test backend/tests/duel-email-invitations.test.js` in `backend/`
Expected: FAIL (`findChallengeByInviteToken` is not a function, or user not found with email).

- [ ] **Step 3: Implement email detection and inviteToken logic in DuelService**

1. Helper in `duel.service.ts`:
```typescript
function isEmailString(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(value || '').trim());
}
```
2. In `createChallenge`:
- If `isEmailString(params.challengedLoginOrId)`:
  - Look up user by email in `userStore.getAllUsers()`: `const matched = allUsers.find(u => u.email?.toLowerCase() === target.toLowerCase())`.
  - If found: `challenged = matched;` and proceed with normal flow.
  - If NOT found:
    - Target is a new guest email `targetEmail = params.challengedLoginOrId.trim().toLowerCase()`.
    - Do NOT fail on `checkPlayerAvailabilityForSlot` (new player has no conflicts).
    - Generate unique invite token: `const inviteToken = "inv_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);`
    - Create `raceManager.createPrivateRace` as usual.
    - Set `challengedUserId: ""`, `challengedLogin: targetEmail`, `challengedName: targetEmail`, `challengedEmail: targetEmail`, `inviteToken`.
    - Persist challenge.
    - Call `emailService.sendDuelInvitationNewUserEmail({ to: targetEmail, challengerName, challengerLogin, slotStart: start.toISOString(), slotEnd: end.toISOString(), timezone, targetDistance, roomCode: race.code, roomPin: race.pinCode, inviteToken })`.
3. Add `findChallengeByInviteToken(token: string): Promise<StoredDuelChallenge | null>`:
- Search in memory and in `DuelChallenges.findOne({ where: { inviteToken: token.trim() } })`.
4. Add `resendInvitation(challengeId: string, challengerUserId: string): Promise<{ success: boolean; message: string }>`:
- Check that challenge exists and belongs to challenger.
- Verify status is `PENDING` and `challengedEmail` is present.
- Re-send `emailService.sendDuelInvitationNewUserEmail(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test backend/tests/duel-email-invitations.test.js` in `backend/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/duel.service.ts backend/tests/duel-email-invitations.test.js
git commit -m "feat(duels): implement email detection and guest challenge creation in duelService"
```

---

### Task 3: Transactional Invitation Email (`email.service.ts`)

**Files:**
- Modify: `backend/src/services/email.service.ts`
- Test: `backend/tests/duel-email-invitations.test.js`

**Interfaces:**
- Consumes: `renderCyberEmailHtml`, `generateIcsContent`, calendar URL generators from `backend/src/utils/calendar.util.ts`.
- Produces: `emailService.sendDuelInvitationNewUserEmail(params: DuelInvitationNewUserParams)`

- [ ] **Step 1: Write failing test for new user duel invitation email**

Append to `backend/tests/duel-email-invitations.test.js`:
```javascript
const emailService = require('../dist/services/email.service').default;

test('sendDuelInvitationNewUserEmail generates cyber email with ics and signup link containing inviteToken', async () => {
  const result = await emailService.sendDuelInvitationNewUserEmail({
    to: 'friend@test.com',
    challengerName: 'Emma Racer',
    challengerLogin: 'EmmaRacer',
    slotStart: new Date(Date.now() + 86400000).toISOString(),
    slotEnd: new Date(Date.now() + 86400000 + 3600000).toISOString(),
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
  assert.equal(lastMail.to, 'friend@test.com');
  assert.ok(lastMail.subject.includes('Emma Racer'));
  assert.ok(lastMail.html.includes('tok_test_123'));
  assert.ok(lastMail.html.includes('2000'));
  assert.ok(lastMail.attachments?.some(a => a.filename.endsWith('.ics')), 'Must include .ics attachment');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test backend/tests/duel-email-invitations.test.js` in `backend/`
Expected: FAIL (`sendDuelInvitationNewUserEmail` not a function).

- [ ] **Step 3: Implement `sendDuelInvitationNewUserEmail` in `email.service.ts`**

In `backend/src/services/email.service.ts`:
1. Define interface:
```typescript
export interface DuelInvitationNewUserParams {
  to: string;
  challengerName: string;
  challengerLogin: string;
  slotStart: string;
  slotEnd: string;
  timezone?: string;
  targetDistance: number;
  roomCode: string;
  roomPin: string;
  inviteToken: string;
  lang?: string;
}
```
2. Implement method in `EmailService`:
- Generate signup URL: `${config.frontendUrl}/?duelInviteToken=${encodeURIComponent(params.inviteToken)}&email=${encodeURIComponent(params.to)}&mode=register`
- Build `.ics` content with calendar helper.
- Build Google Calendar and Outlook Web calendar links.
- Format Cyber HTML with `renderCyberEmailHtml`:
  - Subject: `⚔️ [ChallengerName] vous défie en duel sur Rower Race !`
  - Preheader: `Relevez le défi de ${params.challengerName} sur ${params.targetDistance}m !`
  - Body: Présentation de la plateforme Rower Race, description du défi 1v1, heure du créneau et calendrier, bouton CTA "Créer mon compte et relever le défi".
  - Attachment: `invitation-duel-rowerrace.ics`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test backend/tests/duel-email-invitations.test.js` in `backend/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/email.service.ts backend/tests/duel-email-invitations.test.js
git commit -m "feat(email): add sendDuelInvitationNewUserEmail with cyber template and calendar attachment"
```

---

### Task 4: Registration Hook & Duel Linking on Signup (`user.controller.ts` & `duel.controller.ts`)

**Files:**
- Modify: `backend/src/controllers/user.controller.ts`
- Modify: `backend/src/controllers/duel.controller.ts`
- Modify: `backend/src/routes/duel.routes.ts`
- Test: `backend/tests/duel-email-invitations.test.js`

**Interfaces:**
- Consumes: `registerUser` payload (`duelInviteToken`, `email`, `login`, etc.)
- Produces:
  - User registration links matching duel challenges and assigns `referredBy`.
  - Endpoint `POST /api/duels/:id/resend-invite`
  - Endpoint `GET /api/duels/invite-info?token=...`

- [ ] **Step 1: Write failing test for registration linking and resend-invite API**

Append to `backend/tests/duel-email-invitations.test.js`:
```javascript
const { createTestServer } = require('./duel-challenges.test'); // or local test server helper

test('Registration with matching email or inviteToken links pending duel and sets referredBy', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // 1. Challenger creates challenge to friend@rower.test
    const challengerRes = await fetch(`${baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Challenger',
        prenom: 'Boss',
        login: `boss_${Date.now()}`,
        email: `boss_${Date.now()}@rower.test`,
        password: 'Password123!',
      }),
    });
    const challengerData = await challengerRes.json();
    const challengerId = challengerData.user.id;

    const duelRes = await fetch(`${baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId,
        challengedLogin: 'friend@rower.test',
        slotStart: new Date(Date.now() + 24 * 3600000).toISOString(),
        targetDistance: 2000,
      }),
    });
    const duelData = await duelRes.json();
    assert.equal(duelData.success, true);
    const challengeId = duelData.challenge.id;
    const inviteToken = duelData.challenge.inviteToken;

    // 2. Test invite-info endpoint
    const infoRes = await fetch(`${baseUrl}/api/duels/invite-info?token=${inviteToken}`);
    const infoData = await infoRes.json();
    assert.equal(infoData.success, true);
    assert.equal(infoData.challenge.id, challengeId);
    assert.equal(infoData.challenge.challengerName, 'Challenger Boss');

    // 3. Friend registers using inviteToken
    const friendLogin = `friend_${Date.now()}`;
    const friendRes = await fetch(`${baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: 'Friend',
        prenom: 'User',
        login: friendLogin,
        email: 'friend@rower.test',
        password: 'Password123!',
        duelInviteToken: inviteToken,
      }),
    });
    const friendData = await friendRes.json();
    assert.equal(friendData.success, true);
    assert.equal(friendData.user.referredBy, challengerId);

    // 4. Verify duel challenge has been updated with friend's account info
    const checkDuel = await duelService.getChallengeById(challengeId);
    assert.equal(checkDuel.challengedUserId, friendData.user.id);
    assert.equal(checkDuel.challengedLogin, friendLogin);
    assert.equal(checkDuel.status, 'PENDING');
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test backend/tests/duel-email-invitations.test.js` in `backend/`
Expected: FAIL (`invite-info` route 404 or `referredBy` undefined).

- [ ] **Step 3: Implement registration duel linking & endpoints**

1. In `backend/src/controllers/user.controller.ts` (`registerUser`):
- Extract `duelInviteToken` from `req.body`.
- Look for pending challenges matching `inviteToken === duelInviteToken` OR (`challengedEmail === cleanEmail` and `challengedUserId === ""`).
- If found:
  - Set `userPayload.referredBy = challenge.challengerUserId;`
  - After user is persisted, update challenge:
    ```typescript
    challenge.challengedUserId = newUser.id;
    challenge.challengedLogin = newUser.login || newUser.id;
    challenge.challengedName = newUser.name || newUser.login || newUser.id;
    challenge.updatedAt = new Date();
    await duelService.persistChallenge(challenge);
    ```
2. In `backend/src/controllers/duel.controller.ts`:
- Add `getInviteInfo`:
  ```typescript
  public static async getInviteInfo(req: Request, res: Response): Promise<void> {
    const token = String(req.query.token || "").trim();
    if (!token) {
      res.status(400).json({ success: false, message: "Token d'invitation requis." });
      return;
    }
    const challenge = await duelService.findChallengeByInviteToken(token);
    if (!challenge) {
      res.status(404).json({ success: false, message: "Invitation introuvable ou expirée." });
      return;
    }
    res.status(200).json({
      success: true,
      challenge: {
        id: challenge.id,
        challengerName: challenge.challengerName,
        challengerLogin: challenge.challengerLogin,
        targetDistance: challenge.targetDistance,
        slotStart: challenge.slotStart,
        slotEnd: challenge.slotEnd,
        timezone: challenge.timezone,
        challengedEmail: challenge.challengedEmail,
        status: challenge.status,
      }
    });
  }
  ```
- Add `resendInvite`:
  ```typescript
  public static async resendInvite(req: Request, res: Response): Promise<void> {
    const challengeId = String(req.params.id || "").trim();
    const userId = resolveRequestUserId(req);
    const result = await duelService.resendInvitation(challengeId, userId);
    res.status(result.success ? 200 : 400).json(result);
  }
  ```
3. In `backend/src/routes/duel.routes.ts`:
- Register `router.get("/invite-info", DuelController.getInviteInfo);`
- Register `router.post("/:id/resend-invite", DuelController.resendInvite);`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test backend/tests/duel-email-invitations.test.js` in `backend/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/user.controller.ts backend/src/controllers/duel.controller.ts backend/src/routes/duel.routes.ts backend/tests/duel-email-invitations.test.js
git commit -m "feat(duels): link pending duel and referral upon user registration"
```

---

### Task 5: Frontend Integration (`private-room-manager`, `account-modal`, `app.ts`)

**Files:**
- Modify: `frontend/src/app/models/user.model.ts`
- Modify: `frontend/src/app/services/rower.service.ts`
- Modify: `frontend/src/app/components/private-room-manager/private-room-manager.component.ts`
- Modify: `frontend/src/app/components/private-room-manager/private-room-manager.component.html`
- Modify: `frontend/src/app/components/modals/account-modal/account-modal.component.ts`
- Modify: `frontend/src/app/components/modals/account-modal/account-modal.component.html`
- Modify: `frontend/src/app/app.ts`

**Interfaces:**
- Consumes:
  - `rowerService.createDuelChallenge({ challengerId, challengedLogin, ... })`
  - `rowerService.resendDuelInvite(challengeId: string, userId: string)`
  - URL query params `duelInviteToken` & `email` in `app.ts`
- Produces:
  - UI hints and placeholder for email invitation.
  - "Invité : [email]" with "En attente d'inscription" badge in sent duels list.
  - "Relancer l'invitation" action button.
  - Pre-filled registration flow when arriving from invitation email.

- [ ] **Step 1: Update frontend models and RowerService**

In `frontend/src/app/models/user.model.ts`:
- Add `challengedEmail?: string;` and `inviteToken?: string;` to `DuelChallenge`.
- Add `referredBy?: string;` to `UserProfile`.

In `frontend/src/app/services/rower.service.ts`:
- Add `resendDuelInvite(challengeId: string, userId: string): Observable<{ success: boolean; message: string }>`:
  `return this.http.post<{ success: boolean; message: string }>(`${this.apiUrl}/duels/${encodeURIComponent(challengeId)}/resend-invite`, { userId });`
- Add `getDuelInviteInfo(token: string): Observable<{ success: boolean; challenge?: any; message?: string }>`:
  `return this.http.get<any>(`${this.apiUrl}/duels/invite-info?token=${encodeURIComponent(token)}`);`

- [ ] **Step 2: Update `private-room-manager` component**

1. In `private-room-manager.component.html`:
- Update label & placeholder for `duelTargetLogin`:
  ```html
  <label for="priv-duel-login" class="priv-label">Adversaire : Login RowerRace ou E-mail d'un ami *</label>
  <input
    id="priv-duel-login"
    name="duelTargetLogin"
    type="text"
    class="priv-input"
    placeholder="ex: EmmaRacer ou ami@email.com"
    [(ngModel)]="duelTargetLogin"
    (input)="duelChallengeError = ''" />
  ```
- In sent challenges card list:
  ```html
  @if (challenge.challengedEmail && !challenge.challengedUserId) {
    <span class="priv-meta-chip priv-chip-pending-reg">📩 En attente d'inscription</span>
  }
  ```
  And when `challenge.challengedEmail && !challenge.challengedUserId && challenge.status === 'PENDING'`:
  Add a button:
  ```html
  <button
    type="button"
    class="priv-btn priv-btn-xs priv-btn-outline"
    [disabled]="isResendingInvite === challenge.id"
    (click)="onResendInvite(challenge)">
    {{ isResendingInvite === challenge.id ? 'Envoi...' : '🔄 Relancer l\'invitation' }}
  </button>
  ```
2. In `private-room-manager.component.ts`:
- Add `isResendingInvite = '';`
- Add `onResendInvite(challenge: DuelChallenge): void` calling `this.rowerService.resendDuelInvite(challenge.id, this.activeUserId)`.

- [ ] **Step 3: Update `app.ts` & `account-modal` for onboarding from invite URL**

1. In `frontend/src/app/app.ts` (`ngOnInit`):
- Read `duelInviteToken = urlParams.get('duelInviteToken') || urlParams.get('inviteToken')`.
- Read `prefillEmail = urlParams.get('email')`.
- If `duelInviteToken`:
  - Store `this.pendingDuelInviteToken = duelInviteToken;`
  - If `prefillEmail`, store `this.pendingRegistrationEmail = prefillEmail;`
  - Open registration modal: `this.openAccountModal('register');`
2. In `account-modal.component.ts` & `account-modal.component.html`:
- Add `@Input() pendingDuelInviteToken = '';`
- If `pendingRegistrationEmail` is provided, set form `email` control value.
- When calling `register`, pass `duelInviteToken: this.pendingDuelInviteToken`.
- Show banner: "🎉 Vous avez été invité(e) à un duel 1v1 ! Créez votre compte pour relever le défi."

- [ ] **Step 4: Verify frontend builds without errors**

Run: `npm run build` in `frontend/`
Expected: Build success with zero compilation errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/models/user.model.ts frontend/src/app/services/rower.service.ts frontend/src/app/components/private-room-manager/ frontend/src/app/components/modals/account-modal/ frontend/src/app/app.ts
git commit -m "feat(frontend): integrate duel email invitations, resend action and registration onboarding"
```

---

### Task 6: Full Verification & E2E Validation

**Files:**
- Test: All backend tests (`backend/tests/*.test.js`)
- Test: Frontend build (`frontend/`)

- [ ] **Step 1: Run complete backend test suite**

Run: `npm test` in `backend/`
Expected: All backend tests pass.

- [ ] **Step 2: Run complete frontend build**

Run: `npm run build` in `frontend/`
Expected: Build succeeds with zero errors.

- [ ] **Step 3: Commit final adjustments if any**

```bash
git status
# If clean, ready for review
```
