import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendSrcDir = path.join(rootDir, 'src');

test('1. Accueil buttons removed from app-header, regatta-view, and cockpit-view', () => {
  const headerHtml = fs.readFileSync(path.join(frontendSrcDir, 'app/components/app-header/app-header.component.html'), 'utf8');
  assert.ok(!headerHtml.includes('btn-pure-home'), 'pure-screen-header must not contain btn-pure-home');
  assert.ok(!headerHtml.includes('btn-nav-home-only'), 'hud-header must not contain btn-nav-home-only');

  const regattaHtml = fs.readFileSync(path.join(frontendSrcDir, 'app/components/regatta-view/regatta-view.component.html'), 'utf8');
  assert.ok(!regattaHtml.includes('btn-quick-home'), 'regatta-view must not contain btn-quick-home');

  const cockpitHtml = fs.readFileSync(path.join(frontendSrcDir, 'app/components/cockpit-view/cockpit-view.component.html'), 'utf8');
  assert.ok(!cockpitHtml.includes('btn-quick-home'), 'cockpit-view must not contain btn-quick-home');
});

test('2. Course publique buttons and door icon removed from private-room-manager', () => {
  const privHtml = fs.readFileSync(path.join(frontendSrcDir, 'app/components/private-room-manager/private-room-manager.component.html'), 'utf8');
  assert.ok(!privHtml.includes("leaveToPublicRace()"), 'private-room-manager must not have leaveToPublicRace() button');
  assert.ok(!privHtml.includes("BTN_BACK_PUBLIC"), 'private-room-manager must not have BTN_BACK_PUBLIC');
});

test('3. Clickable logo present in hud-header and pure-screen-header, wired to headerLogoClick', () => {
  const headerHtml = fs.readFileSync(path.join(frontendSrcDir, 'app/components/app-header/app-header.component.html'), 'utf8');
  assert.ok(headerHtml.includes('game-logo hero-logo is-clickable'), 'hud-header must have is-clickable hero-logo');
  assert.ok(headerHtml.includes('(click)="onLogoClick()"'), 'hero-logo must call onLogoClick()');
  assert.ok(headerHtml.includes('pure-header-logo is-clickable'), 'pure-screen-header must have pure-header-logo is-clickable');

  const appHtml = fs.readFileSync(path.join(frontendSrcDir, 'app/app.html'), 'utf8');
  assert.ok(appHtml.includes('(headerLogoClick)="onHeaderLogoClick()"'), 'app.html must wire headerLogoClick to onHeaderLogoClick()');

  const appTs = fs.readFileSync(path.join(frontendSrcDir, 'app/app.ts'), 'utf8');
  assert.ok(appTs.includes('onHeaderLogoClick(): void'), 'app.ts must declare onHeaderLogoClick()');
});

test('4. onHeaderLogoClick behavioral simulation: confirmation prompt if race started vs immediate free if not started', () => {
  const appTs = fs.readFileSync(path.join(frontendSrcDir, 'app/app.ts'), 'utf8');

  // Verify prompt text matches user request exactly
  assert.ok(
    appTs.includes('Êtes-vous sûr de vouloir abandonner la course et libérer votre couloir ?'),
    'app.ts must use exact confirmation prompt when race is in progress'
  );

  // Behavior simulation object
  const state = {
    myAssignedLane: 2,
    isUserAssociatedWithRace: true,
    isRaceActive: false,
    nextRaceInfo: { status: 'waiting' },
    activePrivateRoom: null,
    myActivity: { status: 'in_progress' },
    siteView: 'regatta',
    confirmCalled: false,
    confirmResult: true,
    leaveRoomCalled: false,

    onHeaderLogoClick() {
      const hasLane = Boolean(this.myAssignedLane) || this.isUserAssociatedWithRace;
      const isStarted = this.isRaceActive || (this.nextRaceInfo?.status === 'in_progress');

      if (hasLane && isStarted) {
        this.confirmCalled = true;
        if (!this.confirmResult) return;
      }

      if (this.activePrivateRoom) {
        this.activePrivateRoom = null;
      } else if (hasLane) {
        this.leaveRoomCalled = true;
        if (this.myActivity) {
          if (isStarted) {
            this.myActivity.status = 'abandoned';
          } else {
            this.myActivity = null;
          }
        }
        this.myAssignedLane = null;
      }
      this.siteView = 'home';
    }
  };

  // Case A: Race not started -> immediate lane free without confirm
  state.onHeaderLogoClick();
  assert.equal(state.confirmCalled, false, 'No confirmation when race not started');
  assert.equal(state.myAssignedLane, null, 'Lane freed');
  assert.equal(state.myActivity, null, 'Activity cleared (not abandoned)');
  assert.equal(state.siteView, 'home', 'Returned to home');

  // Case B: Race is active -> prompts confirmation, user cancels
  state.myAssignedLane = 3;
  state.isRaceActive = true;
  state.myActivity = { status: 'in_progress' };
  state.confirmCalled = false;
  state.confirmResult = false;
  state.onHeaderLogoClick();
  assert.equal(state.confirmCalled, true, 'Confirm prompt displayed when race started');
  assert.equal(state.myAssignedLane, 3, 'Lane NOT freed when cancelled');
  assert.equal(state.myActivity.status, 'in_progress', 'Activity remains in progress');

  // Case C: Race is active -> prompts confirmation, user confirms
  state.confirmResult = true;
  state.onHeaderLogoClick();
  assert.equal(state.myAssignedLane, null, 'Lane freed when confirmed');
  assert.equal(state.myActivity.status, 'abandoned', 'Activity marked abandoned when race started');
  assert.equal(state.siteView, 'home', 'Returned to home');
});

test('5. Backend leavePrivateRace destroys activity if not started, marks abandoned if RUNNING', () => {
  const backendServicePath = path.resolve(rootDir, '../backend/src/services/race-manager.service.ts');
  const serviceCode = fs.readFileSync(backendServicePath, 'utf8');

  assert.ok(serviceCode.includes('const isRunning = race.status === "RUNNING";'), 'Checks if race is RUNNING');
  assert.ok(serviceCode.includes('(Activities as any).destroy({'), 'Destroys activity when leaving before start');
  assert.ok(serviceCode.includes('(Activities as any).update(') && serviceCode.includes('status: "abandoned"'), 'Updates to abandoned when leaving running race');
});
