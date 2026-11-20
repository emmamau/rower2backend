import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendSrcDir = path.resolve(__dirname, '../src');

test('UI Rule 1: canShareOrInvite is false for solo or bot_duel, true for duel_1v1 or multi', () => {
  function getCanShareOrInvite(room) {
    const isBotDuelRoom = Boolean(room?.race?.isBotDuel || room?.isBotDuel);
    const isSoloRoom = Boolean(room?.race?.isSolo || room?.isSolo);
    return !isSoloRoom && !isBotDuelRoom;
  }

  const soloRoom = { race: { id: 'PRIV_1', isSolo: true } };
  const botDuelRoom = { race: { id: 'PRIV_2', isBotDuel: true } };
  const duelFriendRoom = { race: { id: 'PRIV_3', isDuel1v1: true } };
  const multiRoom = { race: { id: 'PRIV_4', maxParticipants: 8 } };

  assert.equal(getCanShareOrInvite(soloRoom), false, 'Solo room should not allow smartphone/social share or email invites');
  assert.equal(getCanShareOrInvite(botDuelRoom), false, 'Bot duel room should not allow smartphone/social share or email invites');
  assert.equal(getCanShareOrInvite(duelFriendRoom), true, 'Duel vs friend room should allow sharing and invites');
  assert.equal(getCanShareOrInvite(multiRoom), true, 'Multiplayer room should allow sharing and invites');

  // Verify private-room-manager.component.ts contains getter canShareOrInvite
  const privTs = fs.readFileSync(path.join(frontendSrcDir, 'app/components/private-room-manager/private-room-manager.component.ts'), 'utf8');
  assert.ok(privTs.includes('get canShareOrInvite(): boolean'), 'private-room-manager.component.ts must expose canShareOrInvite getter');
  assert.ok(privTs.includes('!this.isSoloRoom && !this.isBotDuelRoom'), 'canShareOrInvite must check !isSoloRoom && !isBotDuelRoom');

  // Verify private-room-manager.component.html guards smartphone share and email invite with canShareOrInvite
  const privHtml = fs.readFileSync(path.join(frontendSrcDir, 'app/components/private-room-manager/private-room-manager.component.html'), 'utf8');
  assert.ok(privHtml.includes('@if (canShareOrInvite)'), 'private-room-manager.component.html must guard sharing sections with @if (canShareOrInvite)');
  assert.ok(privHtml.includes('priv-solo-notice-card'), 'private-room-manager.component.html must show solo/bot notice card when sharing is restricted');
});

test('UI Rule 2: Home button in private room returns to public home page and exits room', () => {
  const appTs = fs.readFileSync(path.join(frontendSrcDir, 'app/app.ts'), 'utf8');
  assert.ok(
    appTs.includes("if (view === 'home' && this.activePrivateRoom)"),
    'setSiteView must check view === "home" && this.activePrivateRoom'
  );
  assert.ok(
    appTs.includes('this.exitPrivateRoomToPublic(true);') && appTs.includes('this.initGameLoop();'),
    'setSiteView must call exitPrivateRoomToPublic(true) and initGameLoop() when navigating to home from private room'
  );
});

test('UI Rule 3: Mouseover active feedback on private room buttons (ouvrir, copier URL, supprimer croix) and global buttons', () => {
  const privCss = fs.readFileSync(path.join(frontendSrcDir, 'app/components/private-room-manager/private-room-manager.component.css'), 'utf8');
  assert.ok(privCss.includes('.priv-btn-mini:hover'), '.priv-btn-mini must have :hover styles in CSS');
  assert.ok(privCss.includes('.priv-btn-mini-primary:hover'), '.priv-btn-mini-primary (Ouvrir) must have :hover styles in CSS');
  assert.ok(privCss.includes('.priv-btn-mini-danger:hover'), '.priv-btn-mini-danger (Supprimer ✕) must have :hover styles in CSS');
  assert.ok(privCss.includes('.priv-close-btn:hover'), '.priv-close-btn must have :hover styles');

  const stylesCss = fs.readFileSync(path.join(frontendSrcDir, 'styles.css'), 'utf8');
  assert.ok(stylesCss.includes('button:hover:not(:disabled)'), 'styles.css must include global button hover styles');
  assert.ok(stylesCss.includes('cursor: pointer;'), 'styles.css must enforce cursor: pointer for buttons');
});

test('UI Rule 4: No automatic modal closing on outside backdrop click for any modal', () => {
  const appHtml = fs.readFileSync(path.join(frontendSrcDir, 'app/app.html'), 'utf8');
  const privHtml = fs.readFileSync(path.join(frontendSrcDir, 'app/components/private-room-manager/private-room-manager.component.html'), 'utf8');

  // Verify priv-dialog-overlay does not have click handler
  assert.ok(!privHtml.includes('class="priv-dialog-overlay" (click)='), 'priv-dialog-overlay must not close on click');

  // Verify modal-overlay in appHtml does not have click handlers
  const overlayClickRegex = /class="[^"]*modal-overlay[^"]*"[^>]*\(click\)=/g;
  const overlayMatches = appHtml.match(overlayClickRegex);
  assert.equal(overlayMatches, null, 'No modal-overlay in app.html should have a (click) handler closing the modal');

  // Verify onBackdropClick and onAdminBackdropClick do not close modals
  const appTs = fs.readFileSync(path.join(frontendSrcDir, 'app/app.ts'), 'utf8');
  const privTs = fs.readFileSync(path.join(frontendSrcDir, 'app/components/private-room-manager/private-room-manager.component.ts'), 'utf8');

  assert.ok(!privTs.includes('this.closeModal()') || privTs.indexOf('this.closeModal()') !== privTs.indexOf('onBackdropClick'), 'onBackdropClick in private room manager must not close the modal');
});
