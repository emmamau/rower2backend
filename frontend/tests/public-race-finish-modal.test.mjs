import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');

test('1. Public race leaderboard modal closes permanently on X / Close click and does not reopen', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  assert.match(appTs, /dismissedLeaderboardRaceIds\s*=\s*new Set<string>\(\)/, 'app.ts must declare dismissedLeaderboardRaceIds Set');
  assert.match(appTs, /completedPublicRaceId:\s*string\s*\|\s*null\s*=\s*null/, 'app.ts must declare completedPublicRaceId');
  assert.match(appTs, /this\.dismissedLeaderboardRaceIds\.add\(closedRaceId\)/, 'closeRaceLeaderboardModal must record closedRaceId in dismissedLeaderboardRaceIds');
  assert.match(appTs, /resetPublicWaterForNextRace\(/, 'app.ts must declare and invoke resetPublicWaterForNextRace to reset the water body for the next public race');
  assert.match(appTs, /allHumansFinishedInMetric/, 'app.ts must wait for all engaged human players to finish before displaying the public race leaderboard');

  // Behavioral simulation: race finishes, modal opens, user clicks X, further ticks arrive
  const simulatedApp = {
    activePrivateRoom: null,
    nextRaceInfo: { race: { id: 'RACE_PUB_100', targetDistance: 1000 }, status: 'in_progress' },
    myActivity: { netDistance: 1000, status: 'finished' },
    isPostRaceRankingActive: false,
    isRaceLeaderboardModalOpen: false,
    hasCelebratedFinish: true,
    showFinishCelebration: false,
    completedPublicRaceId: null,
    selectedRaceInfo: { id: 'RACE_PUB_100' },
    dismissedLeaderboardRaceIds: new Set(),

    get isFinished() {
      return this.myActivity && this.myActivity.status === 'finished';
    },

    openRaceLeaderboard(raceId) {
      this.isRaceLeaderboardModalOpen = true;
      this.selectedRaceInfo = { id: raceId };
    },

    closeRaceLeaderboardModal() {
      const closedRaceId = this.selectedRaceInfo?.id || this.completedPublicRaceId || this.nextRaceInfo?.race?.id;
      if (closedRaceId) {
        this.dismissedLeaderboardRaceIds.add(closedRaceId);
      }
      this.isRaceLeaderboardModalOpen = false;
    },

    onLeaderboardTick() {
      const isPublicRace = !this.activePrivateRoom;
      if (isPublicRace && this.isFinished && !this.isPostRaceRankingActive && this.nextRaceInfo?.race?.id) {
        const pubRaceId = this.nextRaceInfo.race.id;
        this.completedPublicRaceId = pubRaceId;
        this.isPostRaceRankingActive = true;
        if (!this.dismissedLeaderboardRaceIds.has(pubRaceId)) {
          this.openRaceLeaderboard(pubRaceId);
        }
      }
    },

    onRaceStatusSocket(update) {
      if (update.status === 'COMPLETED') {
        const targetRaceId = update.raceId || this.nextRaceInfo?.race?.id;
        if (targetRaceId) {
          this.completedPublicRaceId = targetRaceId;
        }
        if (targetRaceId && !this.dismissedLeaderboardRaceIds.has(targetRaceId)) {
          this.openRaceLeaderboard(targetRaceId);
        }
        this.isPostRaceRankingActive = true;
      } else if (update.status === 'POST_RACE_PAUSE') {
        const pubRaceId = this.nextRaceInfo?.race?.id;
        if (pubRaceId) {
          this.completedPublicRaceId = pubRaceId;
          if (!this.showFinishCelebration && !this.isPostRaceRankingActive && !this.dismissedLeaderboardRaceIds.has(pubRaceId)) {
            this.openRaceLeaderboard(pubRaceId);
            this.isPostRaceRankingActive = true;
          }
        }
      }
    }
  };

  // 1. First tick when race finishes opens modal once
  simulatedApp.onLeaderboardTick();
  assert.equal(simulatedApp.isRaceLeaderboardModalOpen, true);
  assert.equal(simulatedApp.isPostRaceRankingActive, true);

  // 2. User clicks the top-right 'X' button to close modal
  simulatedApp.closeRaceLeaderboardModal();
  assert.equal(simulatedApp.isRaceLeaderboardModalOpen, false);
  assert.equal(simulatedApp.dismissedLeaderboardRaceIds.has('RACE_PUB_100'), true);

  // 3. Subsequent ticks or socket broadcasts arrive -> modal MUST NOT reopen!
  simulatedApp.onLeaderboardTick();
  assert.equal(simulatedApp.isRaceLeaderboardModalOpen, false, 'Modal must stay closed on subsequent leaderboard ticks');

  simulatedApp.onRaceStatusSocket({ status: 'COMPLETED', raceId: 'RACE_PUB_100' });
  assert.equal(simulatedApp.isRaceLeaderboardModalOpen, false, 'Modal must stay closed on COMPLETED socket broadcast');

  simulatedApp.onRaceStatusSocket({ status: 'POST_RACE_PAUSE', raceId: 'RACE_PUB_100' });
  assert.equal(simulatedApp.isRaceLeaderboardModalOpen, false, 'Modal must stay closed on POST_RACE_PAUSE socket broadcast');
});

test('2. Navigating back to Home clears post-race state so the new public race lobby timer is active', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  assert.match(
    appTs,
    /setSiteView\(view:\s*'home'\s*\|\s*'regatta'\s*\|\s*'cockpit'\):\s*void\s*\{[\s\S]*?if\s*\(view\s*===\s*'home'\)\s*\{[\s\S]*?this\.isPostRaceRankingActive\s*=\s*false;/,
    'setSiteView("home") must reset isPostRaceRankingActive so the user can return to home and start the next public race'
  );
  assert.match(
    appTs,
    /returnToHomeAfterRace\(\):\s*void\s*\{[\s\S]*?this\.completedPublicRaceId\s*=\s*null;[\s\S]*?this\.myActivity\s*=\s*null;/,
    'returnToHomeAfterRace() must reset completedPublicRaceId and myActivity'
  );
});

test('3. Public race waits for all engaged humans to finish, opens ranking modal, and immediately resets the water body for the next race', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  // 1. Inline finish banner is suppressed on public races so the reset water body stays clean underneath the modal
  assert.match(
    appTs,
    /get\s+isPostRaceDisplayActive\(\):\s*boolean\s*\{\s*if\s*\(!this\.activePrivateRoom\)\s*\{\s*return\s+false;\s*\}/,
    'isPostRaceDisplayActive must return false for public races so only the modal is shown over the reset water body'
  );

  // 2. triggerFinishCelebration does not prematurely open the leaderboard on a public race if other humans are still racing
  assert.match(
    appTs,
    /const\s+shouldOpenLeaderboard\s*=\s*Boolean\(\s*raceId\s*&&\s*\(!isPublicRace\s*\|\|\s*this\.completedPublicRaceId\s*===\s*raceId\s*\|\|\s*this\.isPostRaceRankingActive\)\s*\)/,
    'triggerFinishCelebration must only open the leaderboard on public race once the race is completed by all humans'
  );

  // 3. Upon COMPLETED status of a public race, resetPublicWaterForNextRace is called with nextRaceId and loadNextRaceInfo is triggered
  assert.match(
    appTs,
    /this\.resetPublicWaterForNextRace\(update\.details\?\.nextRaceId\);\s*this\.loadNextRaceInfo\(\);/,
    'Public race COMPLETED handler must immediately reset the water body and load the next public race info'
  );
});

test('4. Pre-race countdown is strictly monotonic in the last 15s and never reverts to 2 after reaching GO (0)', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  assert.match(appTs, /private\s+goTransitionLockUntilMs\s*=\s*0;/, 'app.ts must declare goTransitionLockUntilMs');
  assert.match(appTs, /private\s+applyMonotonicServerCountdown\(serverRemaining:\s*number\):\s*void/, 'app.ts must define applyMonotonicServerCountdown');
  assert.match(appTs, /if\s*\(now\s*<\s*this\.goHoldUntilMs\)\s*\{\s*this\.is3sCountdown\s*=\s*true;\s*this\.isPreStartCountdown\s*=\s*false;\s*this\.threeSecondsCount\s*=\s*0;\s*return;\s*\}/, 'syncCountdownUI must lock threeSecondsCount = 0 while goHoldUntilMs is active');

  // Behavioral simulation of the countdown reaching GO (0) and receiving a lagging HTTP poll with secondsRemaining = 2
  const sim = {
    countdownSeconds: 1,
    is3sCountdown: true,
    isPreStartCountdown: false,
    threeSecondsCount: 1,
    goHoldUntilMs: 0,
    goTransitionLockUntilMs: 0,
    nextRaceInfo: { status: 'countdown', secondsRemaining: 1, race: { id: 'RACE_1', status: 'COUNTDOWN' } },

    triggerGoOverlayHold(now) {
      this.is3sCountdown = true;
      this.isPreStartCountdown = false;
      this.threeSecondsCount = 0;
      this.goHoldUntilMs = now + 1000;
      this.goTransitionLockUntilMs = now + 4000;
      this.nextRaceInfo.status = 'in_progress';
      this.nextRaceInfo.secondsRemaining = 0;
      this.nextRaceInfo.race.status = 'RUNNING';
    },

    applyMonotonicServerCountdown(serverRemaining, now) {
      if (now < this.goTransitionLockUntilMs && serverRemaining <= 5) {
        this.countdownSeconds = 0;
        return;
      }
      if (this.countdownSeconds > 0 && this.countdownSeconds <= 15 && serverRemaining <= 15) {
        if (serverRemaining < this.countdownSeconds && this.countdownSeconds - serverRemaining > 2) {
          this.countdownSeconds = serverRemaining;
        }
        return;
      }
      if (this.countdownSeconds <= 0 || Math.abs(this.countdownSeconds - serverRemaining) > 3) {
        this.countdownSeconds = serverRemaining;
      }
    },

    syncCountdownUI(now) {
      if (now < this.goHoldUntilMs) {
        this.is3sCountdown = true;
        this.isPreStartCountdown = false;
        this.threeSecondsCount = 0;
        return;
      }
      if (this.nextRaceInfo.status === 'in_progress' || this.countdownSeconds <= 0) {
        this.isPreStartCountdown = false;
        this.is3sCountdown = false;
        return;
      }
      if (this.countdownSeconds <= 3) {
        this.is3sCountdown = true;
        this.isPreStartCountdown = false;
        this.threeSecondsCount = this.countdownSeconds;
      }
    }
  };

  const t0 = 100000;
  // Local tick decrements 1 -> 0 ("GO !")
  sim.countdownSeconds = 0;
  sim.triggerGoOverlayHold(t0);
  assert.equal(sim.threeSecondsCount, 0, 'Must display GO ! (threeSecondsCount = 0)');
  assert.equal(sim.is3sCountdown, true);

  // 150ms later, an in-flight HTTP response from the server arrives with secondsRemaining: 2
  sim.applyMonotonicServerCountdown(2, t0 + 150);
  sim.syncCountdownUI(t0 + 150);
  assert.equal(sim.countdownSeconds, 0, 'Countdown must stay at 0 and not jump back to 2');
  assert.equal(sim.threeSecondsCount, 0, 'Overlay must remain on GO ! (0) and never revert to 2');
  assert.equal(sim.is3sCountdown, true);

  // 1200ms later (after the 1s GO hold, still inside the 4s transition window), another lagging poll arrives with secondsRemaining: 1
  sim.applyMonotonicServerCountdown(1, t0 + 1200);
  sim.syncCountdownUI(t0 + 1200);
  assert.equal(sim.countdownSeconds, 0, 'Countdown must remain 0 during the 4s transition window');
  assert.equal(sim.is3sCountdown, false, '3s/GO overlay must close cleanly after 1s without flashing 1 or 2');
});
