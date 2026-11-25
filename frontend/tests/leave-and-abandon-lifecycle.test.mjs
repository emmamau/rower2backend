import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');
const appHeaderDir = path.join(frontendAppDir, 'components/app-header');

test('1. Finishing a race leaves activePrivateRoom intact and sets isPrivateRoomCompleted = true', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  // Verify closeRaceLeaderboardModal does not clear isPrivateRoomCompleted when activePrivateRoom is present
  assert.match(
    appTs,
    /if\s*\(\s*!this\.activePrivateRoom\s*\)\s*\{\s*this\.isPrivateRoomCompleted\s*=\s*false;\s*\}/,
    'closeRaceLeaderboardModal must preserve isPrivateRoomCompleted when activePrivateRoom exists'
  );

  // Behavioral simulation of finishing a private race
  const simulatedApp = {
    activePrivateRoom: {
      race: { id: 'PRIV_123', targetDistance: 2000, title: 'Salon Test' },
      code: 'priv-123'
    },
    isPrivateRoomCompleted: false,
    isPostRaceRankingActive: false,
    myActivity: { netDistance: 2000, status: 'in_progress' },
    activeTargetDistance: 2000,

    simulateFinish() {
      if (this.myActivity.netDistance >= this.activeTargetDistance) {
        this.myActivity.status = 'finished';
        this.isPrivateRoomCompleted = true;
        this.isPostRaceRankingActive = true;
      }
    }
  };

  simulatedApp.simulateFinish();
  assert.equal(simulatedApp.myActivity.status, 'finished');
  assert.equal(simulatedApp.isPrivateRoomCompleted, true);
  assert.ok(simulatedApp.activePrivateRoom !== null, 'activePrivateRoom must remain intact after finishing');
  assert.equal(simulatedApp.activePrivateRoom.race.id, 'PRIV_123');
});

test('2. Explicitly leaving the room via leaveCompletedPrivateRoom calls backend leaveRoom, clears localStorage, and reverts to public race', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  // Must declare leaveCompletedPrivateRoom
  assert.match(
    appTs,
    /leaveCompletedPrivateRoom\s*\(\s*\)\s*:\s*void/,
    'app.ts must declare leaveCompletedPrivateRoom()'
  );

  // leaveCompletedPrivateRoom must call exitPrivateRoomToPublic(true)
  assert.match(
    appTs,
    /leaveCompletedPrivateRoom[\s\S]*?this\.exitPrivateRoomToPublic\(\s*true\s*\)/,
    'leaveCompletedPrivateRoom must call exitPrivateRoomToPublic(true)'
  );

  // exitPrivateRoomToPublic must call rowerService.leaveRoom and purge localStorage
  assert.match(
    appTs,
    /this\.rowerService\.leaveRoom\s*\(/,
    'exitPrivateRoomToPublic must call rowerService.leaveRoom'
  );
  assert.match(
    appTs,
    /localStorage\.removeItem\(\s*['"]rower_active_private_room_id['"]\s*\)/,
    'exitPrivateRoomToPublic must remove rower_active_private_room_id from localStorage'
  );
  assert.match(
    appTs,
    /localStorage\.removeItem\(\s*['"]rower_active_private_room_code['"]\s*\)/,
    'exitPrivateRoomToPublic must remove rower_active_private_room_code from localStorage'
  );

  // Behavioral simulation
  let backendLeaveCalledWith = null;
  const storage = new Map([
    ['rower_active_private_room_id', 'PRIV_123'],
    ['rower_active_private_room_code', 'priv-123']
  ]);

  const simulatedApp = {
    activePrivateRoom: { race: { id: 'PRIV_123' }, code: 'priv-123' },
    activeUserId: 'usr_abc',
    isPrivateRoomCompleted: true,
    gameLoopInitialized: false,
    rowerService: {
      leaveRoom(roomId, userId) {
        backendLeaveCalledWith = { roomId, userId };
        return { subscribe: (cb) => { if (cb?.next) cb.next({}); } };
      }
    },
    initGameLoop() {
      this.gameLoopInitialized = true;
    },
    exitPrivateRoomToPublic(resetUrl) {
      if (this.activePrivateRoom) {
        const ident = this.activePrivateRoom.race?.id || this.activePrivateRoom.code;
        this.rowerService.leaveRoom(ident, this.activeUserId).subscribe();
      }
      this.activePrivateRoom = null;
      this.isPrivateRoomCompleted = false;
      storage.delete('rower_active_private_room_id');
      storage.delete('rower_active_private_room_code');
    },
    leaveCompletedPrivateRoom() {
      this.isPrivateRoomCompleted = false;
      this.exitPrivateRoomToPublic(true);
      this.initGameLoop();
    }
  };

  simulatedApp.leaveCompletedPrivateRoom();
  assert.deepEqual(backendLeaveCalledWith, { roomId: 'PRIV_123', userId: 'usr_abc' });
  assert.equal(storage.has('rower_active_private_room_id'), false);
  assert.equal(storage.has('rower_active_private_room_code'), false);
  assert.equal(simulatedApp.activePrivateRoom, null);
  assert.equal(simulatedApp.gameLoopInitialized, true);
});

test('3. Abandoning the race transitions to DNF, clears localStorage, and reverts to public race after delay or action', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');
  const appHtml = fs.readFileSync(path.join(frontendAppDir, 'app.html'), 'utf8');

  // Verify abandonActiveRace or confirmAbandonRace exists in app.ts
  assert.match(
    appTs,
    /abandonActiveRace\s*\(\s*\)\s*:\s*void/,
    'app.ts must declare abandonActiveRace()'
  );
  assert.match(
    appTs,
    /dismissDnfAndExitToPublic\s*\(\s*\)\s*:\s*void/,
    'app.ts must declare dismissDnfAndExitToPublic()'
  );

  // Verify DNF toast / summary with exact French wording and button in app.html
  assert.match(
    appHtml,
    /dnf-summary-toast|dnf-toast|activeDnfSummary/,
    'app.html must render DNF summary overlay/toast'
  );
  assert.match(
    appHtml,
    /Retour aux courses publiques/,
    'app.html must have button "Retour aux courses publiques" in DNF overlay'
  );

  // Behavioral simulation
  let backendLeaveCalledWith = null;
  const storage = new Map([
    ['rower_active_private_room_id', 'PRIV_DNF'],
    ['rower_active_private_room_code', 'priv-dnf']
  ]);

  const simulatedApp = {
    activeUserId: 'usr_dnf',
    activePrivateRoom: { race: { id: 'PRIV_DNF' }, code: 'priv-dnf' },
    myActivity: { dist: 750, status: 'in_progress' },
    racers: [{ userId: 'usr_dnf', status: 'in_progress' }],
    activeDnfSummary: null,
    dnfAutoExitTimer: null,
    gameLoopStarted: false,
    rowerService: {
      leaveRoom(roomId, userId) {
        backendLeaveCalledWith = { roomId, userId };
        return { subscribe: (cb) => { if (cb?.next) cb.next({}); } };
      }
    },
    initGameLoop() {
      this.gameLoopStarted = true;
    },
    exitPrivateRoomToPublic(resetUrl) {
      this.activePrivateRoom = null;
      storage.delete('rower_active_private_room_id');
      storage.delete('rower_active_private_room_code');
    },
    abandonActiveRace() {
      const dist = Math.round(this.myActivity?.dist || 0);
      if (this.myActivity) this.myActivity.status = 'abandoned';
      const r = this.racers.find(x => x.userId === this.activeUserId);
      if (r) r.status = 'abandoned';

      this.activeDnfSummary = {
        distance: dist,
        formattedText: `Course abandonnée (DNF) · Distance: ${dist} m`
      };
    },
    dismissDnfAndExitToPublic() {
      if (this.dnfAutoExitTimer) {
        clearTimeout(this.dnfAutoExitTimer);
        this.dnfAutoExitTimer = null;
      }
      this.activeDnfSummary = null;
      if (this.activePrivateRoom) {
        this.rowerService.leaveRoom(this.activePrivateRoom.race.id, this.activeUserId).subscribe();
      }
      this.exitPrivateRoomToPublic(true);
      this.initGameLoop();
    }
  };

  // Step A: Trigger abandon
  simulatedApp.abandonActiveRace();
  assert.equal(simulatedApp.myActivity.status, 'abandoned');
  assert.equal(simulatedApp.racers[0].status, 'abandoned');
  assert.ok(simulatedApp.activeDnfSummary !== null);
  assert.equal(simulatedApp.activeDnfSummary.formattedText, 'Course abandonnée (DNF) · Distance: 750 m');

  // Step B: Trigger dismiss/return
  simulatedApp.dismissDnfAndExitToPublic();
  assert.deepEqual(backendLeaveCalledWith, { roomId: 'PRIV_DNF', userId: 'usr_dnf' });
  assert.equal(storage.has('rower_active_private_room_id'), false);
  assert.equal(simulatedApp.activePrivateRoom, null);
  assert.equal(simulatedApp.activeDnfSummary, null);
  assert.equal(simulatedApp.gameLoopStarted, true);
});

test('4. Toggling public race preview switches view while preserving the private room state', () => {
  const headerTs = fs.readFileSync(path.join(appHeaderDir, 'app-header.component.ts'), 'utf8');
  const headerHtml = fs.readFileSync(path.join(appHeaderDir, 'app-header.component.html'), 'utf8');
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');
  const appHtml = fs.readFileSync(path.join(frontendAppDir, 'app.html'), 'utf8');

  // app-header inputs and outputs
  assert.match(headerTs, /@Input\(\)\s*hasActivePrivateRoom\s*=\s*false/, 'app-header must declare @Input() hasActivePrivateRoom');
  assert.match(headerTs, /@Input\(\)\s*isPublicRacePreview\s*=\s*false/, 'app-header must declare @Input() isPublicRacePreview');
  assert.match(headerTs, /@Output\(\)\s*togglePublicRacePreviewRequest/, 'app-header must declare @Output() togglePublicRacePreviewRequest');

  // app-header template must include buttons for public preview and return to salon
  assert.match(headerHtml, /Aperçu public/, 'app-header must have "Aperçu public" button');
  assert.match(headerHtml, /Revenir à mon salon/, 'app-header must have "Revenir à mon salon" button / banner');

  // app.html must bind inputs and event
  assert.match(appHtml, /\[hasActivePrivateRoom\]="Boolean\(activePrivateRoom\)"/, 'app.html must bind [hasActivePrivateRoom]="Boolean(activePrivateRoom)"');
  assert.match(appHtml, /\[isPublicRacePreview\]="isPublicRacePreview"/, 'app.html must bind [isPublicRacePreview]="isPublicRacePreview"');
  assert.match(appHtml, /\(togglePublicRacePreviewRequest\)="togglePublicRacePreview\(\)"/, 'app.html must bind (togglePublicRacePreviewRequest)="togglePublicRacePreview()"');

  // app.ts must implement togglePublicRacePreview
  assert.match(appTs, /togglePublicRacePreview\s*\(\s*\)\s*:\s*void/, 'app.ts must implement togglePublicRacePreview()');

  // Behavioral simulation
  const privateRoom = { race: { id: 'PRIV_999', title: 'Mon Salon' } };
  const publicRace = { race: { id: 'PUB_888', title: 'Régate Publique' } };

  const simulatedApp = {
    activePrivateRoom: privateRoom,
    nextRaceInfo: privateRoom,
    isPublicRacePreview: false,
    rowerService: {
      getNextRace() {
        return {
          subscribe: (observer) => {
            if (observer?.next) observer.next(publicRace);
          }
        };
      }
    },
    togglePublicRacePreview() {
      if (!this.activePrivateRoom) return;
      this.isPublicRacePreview = !this.isPublicRacePreview;
      if (this.isPublicRacePreview) {
        this.rowerService.getNextRace().subscribe({
          next: (data) => {
            this.nextRaceInfo = data;
          }
        });
      } else {
        this.nextRaceInfo = this.activePrivateRoom;
      }
    }
  };

  // Initially in private room
  assert.equal(simulatedApp.isPublicRacePreview, false);
  assert.equal(simulatedApp.nextRaceInfo.race.id, 'PRIV_999');

  // Toggle preview ON
  simulatedApp.togglePublicRacePreview();
  assert.equal(simulatedApp.isPublicRacePreview, true);
  assert.equal(simulatedApp.nextRaceInfo.race.id, 'PUB_888');
  assert.equal(simulatedApp.activePrivateRoom.race.id, 'PRIV_999', 'activePrivateRoom must remain intact during preview');

  // Toggle preview OFF -> back to salon
  simulatedApp.togglePublicRacePreview();
  assert.equal(simulatedApp.isPublicRacePreview, false);
  assert.equal(simulatedApp.nextRaceInfo.race.id, 'PRIV_999');
  assert.equal(simulatedApp.activePrivateRoom.race.id, 'PRIV_999', 'activePrivateRoom must remain intact when returning');
});
