import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');

test('1. Email link landing (/r/:code) stays on the room/duel home page (siteView = home) without opening Regatta splash', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  assert.match(
    appTs,
    /else if\s*\(extracted\s*&&\s*extracted\.valid\)\s*\{[\s\S]*?this\.pendingRegattaLaunch\s*=\s*false;[\s\S]*?this\.isRegattaLaunchSplashOpen\s*=\s*false;[\s\S]*?this\.setSiteView\('home'\);/,
    'resolveRoomFromCurrentUrl must navigate to siteView="home" when opening a private room/duel link without ?mode=regatta'
  );

  assert.match(
    appTs,
    /if\s*\(res\.challenge\.roomCode\s*&&\s*!window\.location\.pathname\.startsWith\('\/r\/'\)\)/,
    'duelInviteToken handler must redirect to /r/:roomCode home page when not already on /r/:code'
  );
});

test('2. Stop Race button is strictly restricted to the organizer (or admin) AND only once the race is RUNNING', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');
  const prmTs = fs.readFileSync(
    path.join(frontendAppDir, 'components/private-room-manager/private-room-manager.component.ts'),
    'utf8'
  );
  const prmHtml = fs.readFileSync(
    path.join(frontendAppDir, 'components/private-room-manager/private-room-manager.component.html'),
    'utf8'
  );

  // PrivateRoomManagerComponent.canManageActiveRoom must NOT return true when hostUserId is anonymous or missing
  assert.match(
    prmTs,
    /if\s*\(!uid\s*\|\|\s*uid\s*===\s*'anonymous'\)\s*return\s*false;/,
    'canManageActiveRoom must reject anonymous/missing activeUserId'
  );
  assert.match(
    prmTs,
    /if\s*\(!hostId\s*\|\|\s*hostId\s*===\s*'anonymous'\)\s*return\s*false;/,
    'canManageActiveRoom must reject anonymous/missing hostUserId'
  );

  // PrivateRoomManagerComponent.isActiveRoomRunning checks running status and scheduled start time
  assert.match(
    prmTs,
    /get\s+isActiveRoomRunning\(\):\s*boolean/,
    'PrivateRoomManagerComponent must define isActiveRoomRunning getter'
  );
  assert.match(
    prmHtml,
    /@else if\s*\(isActiveRoomRunning\)\s*\{[\s\S]*?stopActiveRace\(\)/,
    'Stop race button in private room banner and modal must be guarded by canManageActiveRoom and isActiveRoomRunning'
  );

  // AppComponent.isRaceActive verifies scheduled start time is reached
  assert.match(
    appTs,
    /if\s*\(startMode\s*===\s*'scheduled'\s*&&\s*scheduledTime\s*&&\s*!startedAt\)/,
    'AppComponent.isRaceActive must return false if scheduledStartTime is in the future and race has not started'
  );
});

test('3. Private room / duel home screen is decluttered: hides welcome banner, race in progress callout, general standings/history, SEO guide and duplicate header schedule card', () => {
  const homeHtml = fs.readFileSync(
    path.join(frontendAppDir, 'components/home-dashboard/home-dashboard.component.html'),
    'utf8'
  );
  const headerHtml = fs.readFileSync(
    path.join(frontendAppDir, 'components/app-header/app-header.component.html'),
    'utf8'
  );
  const seoHtml = fs.readFileSync(
    path.join(frontendAppDir, 'components/seo-footer/seo-footer.component.html'),
    'utf8'
  );
  const prmHtml = fs.readFileSync(
    path.join(frontendAppDir, 'components/private-room-manager/private-room-manager.component.html'),
    'utf8'
  );

  // 1. Welcome banner ("Ravi de vous revoir") hidden when hasActivePrivateRoom is true
  assert.match(
    homeHtml,
    /class="home-welcome-banner"\s+\*ngIf="!isMobileFullscreenOnly && !hasActivePrivateRoom"/,
    'home-welcome-banner must not be displayed on a private room view'
  );

  // 2. "Course en cours" callout block removed / hidden and lobby live race banner hidden on private rooms
  assert.match(
    homeHtml,
    /class="home-active-race-callout"\s+\*ngIf="false"/,
    'home-active-race-callout must be disabled'
  );
  assert.match(
    homeHtml,
    /class="lobby-live-race-banner"\s+\*ngIf="isRaceActive && !hasActivePrivateRoom"/,
    'lobby-live-race-banner must be hidden on private rooms and when race is not active'
  );

  // 3. General standings & past race history hidden on private room display
  assert.match(
    homeHtml,
    /class="dual-standings-history-container"\s+\*ngIf="!isMobileFullscreenOnly && !hasActivePrivateRoom"/,
    'dual-standings-history-container must be hidden when hasActivePrivateRoom is true'
  );
  assert.match(
    homeHtml,
    /class="smartphone-table-links"\s+\*ngIf="!isMobileFullscreenOnly && !hasActivePrivateRoom"/,
    'smartphone-table-links must be hidden when hasActivePrivateRoom is true'
  );

  // 4. SEO guide hidden when hasActivePrivateRoom is true
  assert.match(
    seoHtml,
    /class="seo-hub-section"[\s\S]*?\*ngIf="siteView === 'home' && !hasActivePrivateRoom"/,
    'seo-hub-section must be hidden when hasActivePrivateRoom is true'
  );

  // 5. Redundant header schedule box hidden when activePrivateRoom is present
  assert.match(
    headerHtml,
    /class="race-schedule-badge hero-schedule"[\s\S]*?\*ngIf="nextRaceInfo && !activePrivateRoom"/,
    'hero-schedule badge in header must be hidden when activePrivateRoom is active'
  );

  // 6. Unregistered duel invitee sees "Créer mon compte gratuit pour accepter le défi" on the duel banner
  assert.match(
    prmHtml,
    /Créer mon compte gratuit pour accepter le défi/,
    'Private room duel banner must display registration CTA for unregistered duel invitees'
  );
});
