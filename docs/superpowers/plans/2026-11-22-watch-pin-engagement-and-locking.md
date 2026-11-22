# Watch PIN Engagement and Room Locking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Defer rower lane engagement and start-line locking for private rooms and duels until the connected user explicitly validates the room PIN on their Garmin watch, allowing web clients to open rooms in spectator/lobby preview without consuming lanes or locking the grid prematurely.

**Architecture:**
- Backend `RaceManager`: do not auto-add the creator/host or challenged opponent to `race.participants` upon race/duel creation or room consultation. Only assign a lane and add to `race.participants` when `viaPin` is true (watch PIN claimed).
- Watch PIN Claiming (`garmin.controller.ts` & `session.service.ts`): map the PIN entered on the watch to the connected user's identity (host or challenged duel opponent) and engage them on the starting line.
- Web UI (`frontend/src/app/`): open rooms and duels in spectator/lobby preview without calling `joinPrivateRace`. Display the room PIN clearly and render unengaged lanes with "En attente montre (PIN : XXXXX)". Disable race launch controls until the user's lane is engaged.

**Tech Stack:** Node.js, Express, TypeScript, Angular, Socket.io, Node.js Test Runner (`node --test`).

**Spec:** Shared understanding established via `/grill-me` session on 2026-11-22.

## Global Constraints
- Opening a room or duel from the web must NEVER occupy a starting lane or lock the salon.
- In 1v1 Bot Duels, the bot may wait on Lane 2, but Lane 1 remains pending until the watch validates the PIN.
- Start button must remain disabled until the connected user's watch has claimed the PIN and engaged their lane.
- All existing tests in `backend/tests/` must remain passing.

---

### Task 1: Backend - Prevent Auto-Engagement on Creation & Consultation

**Files:**
- Modify: `backend/src/services/race-manager.service.ts:1820-1840`
- Modify: `backend/src/controllers/room.controller.ts:180-210`
- Modify: `backend/src/services/duel.service.ts:985-1002`
- Test: `backend/tests/watch-pin-engagement.test.js`

**Interfaces:**
- Consumes: `RaceManager.createPrivateRace`, `RoomController.joinRoom`, `DuelService.respondToChallenge`
- Produces: Room created and opened without host/opponent in `race.participants`. `race.participants.size === 0` (or 1 for bot in duel bot).

- [ ] **Step 1: Write the failing test**
Create `backend/tests/watch-pin-engagement.test.js` asserting that creating a private room or duel does not add the host to `participants`, and calling `joinRoom` via web code (without PIN) returns room info as spectator without adding to `participants`.

- [ ] **Step 2: Run test to confirm failure**
Run: `node --test backend/tests/watch-pin-engagement.test.js` and verify it fails because host was automatically added to `participants`.

- [ ] **Step 3: Update `createPrivateRace`, `joinRoom`, and `respondToChallenge`**
In `race-manager.service.ts`: do not insert `hostUserId` into `participants` at creation time.
In `room.controller.ts`: if `!viaPin`, treat as spectator consultation without adding to `race.participants` (returning `lane: 0` or spectator status).
In `duel.service.ts`: do not auto-call `joinPrivateRace` on duel acceptance.

- [ ] **Step 4: Run test to confirm pass**
Run: `node --test backend/tests/watch-pin-engagement.test.js` and verify it passes.

- [ ] **Step 5: Run full test suite regression**
Run: `npm test --prefix backend` to ensure existing race lifecycle tests pass or adapt expectations where appropriate.

- [ ] **Step 6: Commit changes**
`git add backend/src/services/race-manager.service.ts backend/src/controllers/room.controller.ts backend/src/services/duel.service.ts backend/tests/watch-pin-engagement.test.js && git commit -m "feat(backend): defer private race engagement until PIN is claimed"`

---

### Task 2: Backend - Watch PIN Claiming Links Connected User & Engages Lane

**Files:**
- Modify: `backend/src/controllers/garmin.controller.ts:240-285`
- Modify: `backend/src/services/session.service.ts:220-275`
- Modify: `backend/src/services/race-manager.service.ts:2420-2460`
- Test: `backend/tests/watch-pin-engagement.test.js`

**Interfaces:**
- Consumes: `POST /api/garmin/claim-ticket`, `POST /api/sessions/claim-code`
- Produces: Watch claiming PIN associates connected user (host or duel opponent), sets `race.participants.set(userId, ...)`, locks lane.

- [ ] **Step 1: Write test for PIN claim by watch**
In `backend/tests/watch-pin-engagement.test.js`, add test where watch claims PIN for a room: verifies that the host user ID is assigned to Lane 1 and added to `race.participants`.

- [ ] **Step 2: Run test to verify failure**
Run: `node --test backend/tests/watch-pin-engagement.test.js`

- [ ] **Step 3: Implement connected user resolution on PIN claim**
In `garmin.controller.ts` and `session.service.ts`:
When a watch claims `race.pinCode`:
1. Check if user already has an active pairing.
2. If not, check if `race.hostUserId` is not yet engaged; if so, assign to host.
3. If it's a duel and challenger is already engaged, assign to challenged opponent.
4. Call `joinPrivateRace` with `viaPin: true`, assigning the starting lane and broadcasting participant joined.

- [ ] **Step 4: Run test to verify pass**
Run: `node --test backend/tests/watch-pin-engagement.test.js` and verify all tests pass.

- [ ] **Step 5: Commit changes**
`git add backend/src/controllers/garmin.controller.ts backend/src/services/session.service.ts backend/src/services/race-manager.service.ts backend/tests/watch-pin-engagement.test.js && git commit -m "feat(backend): engage connected user and lock lane upon watch PIN claim"`

---

### Task 3: Frontend - Spectator Room Activation & Starting Line Presentation

**Files:**
- Modify: `frontend/src/app/app.ts:6000-6040, 6160-6185`
- Modify: `frontend/src/app/components/private-room-manager/private-room-manager.component.ts:1020-1060`
- Modify: `frontend/src/app/components/private-room-manager/private-room-manager.component.html:260-280, 1400-1430`
- Modify: `frontend/src/app/components/private-room-manager/private-room-manager.component.css`

**Interfaces:**
- Consumes: `PrivateRacePayload`, `race.participants`, `race.pinCode`
- Produces: Web client opens room without calling `joinPrivateRace`. Lane 1 shows "En attente montre (PIN : XXXXX)" when user not yet engaged. Start button is disabled until engaged.

- [ ] **Step 1: Update `app.ts` room activation**
In `activatePrivateRoom`: remove auto-call to `this.rowerService.joinPrivateRace(...)`. The client joins the socket room for live broadcasts without registering an active lane until watch claims PIN.

- [ ] **Step 2: Update start button condition**
In `canStartRace` or `isStartLocked`: verify that the connected user is present in `participants` with `ready: true` / `connectionState: "CONNECTED"` before enabling start.

- [ ] **Step 3: Update 2D regatta dock & participant view**
Display empty lane with pending status "En attente montre (PIN : XXXXX)" when the current user has not yet entered PIN on the watch.

- [ ] **Step 4: Build and test frontend**
Run: `npm run build --prefix frontend` to ensure TypeScript compilation passes.

- [ ] **Step 5: Commit changes**
`git add frontend/src/app/app.ts frontend/src/app/components/private-room-manager/ && git commit -m "feat(frontend): open salon and duels in spectator mode until watch PIN is entered"`

---

### Task 4: End-to-End Verification

**Files:**
- All modified files
- Verification script / tests

- [ ] **Step 1: Execute complete backend test suite**
Run: `npm test --prefix backend` and confirm all suites pass.

- [ ] **Step 2: Build frontend**
Run: `npm run build --prefix frontend` and confirm zero compilation errors.

- [ ] **Step 3: Verify git status and clean working tree**
`git status`
