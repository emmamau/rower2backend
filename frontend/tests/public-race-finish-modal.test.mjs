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
  assert.match(appTs, /!this\.dismissedLeaderboardRaceIds\.has\(/, 'Automatic modal triggers must check !this.dismissedLeaderboardRaceIds.has(...)');

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
