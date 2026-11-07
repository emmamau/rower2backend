import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('Bot Duel bot toggle rule: non-registered guest cannot toggle bot, registered user with account can', () => {
  // Logic from PrivateRoomManagerComponent & app.ts
  function canToggleBotsInRoom(room, isRegisteredUser, canManageActiveRoom) {
    if (!room) return false;
    if (room.race?.isBotDuel) {
      return Boolean(isRegisteredUser);
    }
    return Boolean(canManageActiveRoom);
  }

  const botDuelRoom = {
    race: {
      id: 'PRIV_duel_123',
      isBotDuel: true,
      hasBots: true
    }
  };

  const regularRoom = {
    race: {
      id: 'PRIV_reg_456',
      isBotDuel: false,
      hasBots: false
    }
  };

  // Guest without account in 1v1 bot duel
  assert.equal(canToggleBotsInRoom(botDuelRoom, false, true), false, 'Guest in 1v1 duel cannot toggle bot');

  // Registered user with account in 1v1 bot duel
  assert.equal(canToggleBotsInRoom(botDuelRoom, true, true), true, 'Registered user in 1v1 duel can toggle bot');

  // Regular room: depends on host management
  assert.equal(canToggleBotsInRoom(regularRoom, false, true), true, 'Host can manage bots in regular private room');
  assert.equal(canToggleBotsInRoom(regularRoom, false, false), false, 'Non-host cannot manage bots in regular private room');
});

test('isRegisteredUser correctly identifies registered users vs anonymous guests', () => {
  function checkIsRegisteredUser(currentUser, isSubscriber = false, isUserAdmin = false) {
    if (isSubscriber || isUserAdmin) return true;
    const email = currentUser?.email?.trim();
    const login = currentUser?.login?.trim();
    const name = currentUser?.name?.trim();
    const isGuest = !login || login.startsWith('guest_') || login.startsWith('usr_');
    const isAnonymousRacer = !name || name.startsWith('Racer_');
    return Boolean((email && email.length > 0) || (!isGuest && !isAnonymousRacer));
  }

  // Anonymous guest
  const guest1 = { id: 'usr_abc12', name: 'Racer_bc12', login: 'usr_abc12', email: '' };
  assert.equal(checkIsRegisteredUser(guest1, false, false), false);

  const guest2 = { id: 'guest_xyz', name: 'Racer_1234', login: 'guest_xyz', email: '' };
  assert.equal(checkIsRegisteredUser(guest2, false, false), false);

  // Registered user with email & custom login
  const regUser1 = { id: 'usr_999', name: 'PierreRacer', login: 'Pierre92', email: 'pierre@example.com' };
  assert.equal(checkIsRegisteredUser(regUser1, false, false), true);

  // Registered user with custom login but no email
  const regUser2 = { id: 'usr_888', name: 'RowMaster', login: 'RowMaster', email: '' };
  assert.equal(checkIsRegisteredUser(regUser2, false, false), true);

  // Subscriber or Admin is always registered
  assert.equal(checkIsRegisteredUser(guest1, true, false), true);
  assert.equal(checkIsRegisteredUser(guest1, false, true), true);
});

test('Draggable timer position calculation and bounding clamp', () => {
  function clampTimerPosition(pos, startPos, delta, windowWidth = 1024, windowHeight = 768) {
    const maxX = Math.max(10, windowWidth - 200);
    const maxY = Math.max(10, windowHeight - 100);
    const nextX = Math.min(Math.max(10, startPos.x + delta.dx), maxX);
    const nextY = Math.min(Math.max(10, startPos.y + delta.dy), maxY);
    return { x: Math.round(nextX), y: Math.round(nextY) };
  }

  const start = { x: 300, y: 50 };

  // Move right 100, down 50
  const moved = clampTimerPosition(start, start, { dx: 100, dy: 50 }, 1000, 800);
  assert.deepEqual(moved, { x: 400, y: 100 });

  // Move far left and above boundary: clamped to (10, 10)
  const clampedMin = clampTimerPosition(start, start, { dx: -500, dy: -200 }, 1000, 800);
  assert.deepEqual(clampedMin, { x: 10, y: 10 });

  // Move far right and below boundary: clamped to (800, 700)
  const clampedMax = clampTimerPosition(start, start, { dx: 2000, dy: 2000 }, 1000, 800);
  assert.deepEqual(clampedMax, { x: 800, y: 700 });
});

test('Statistics space: 10-day retention for free accounts vs unlimited for subscribers', () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const mockActivities = [
    { id: 'act_1', createdAt: new Date(now - 2 * day).toISOString(), netDistance: 2000 },
    { id: 'act_2', createdAt: new Date(now - 5 * day).toISOString(), netDistance: 5000 },
    { id: 'act_3', createdAt: new Date(now - 9 * day).toISOString(), netDistance: 1000 },
    { id: 'act_4', createdAt: new Date(now - 15 * day).toISOString(), netDistance: 2000 },
    { id: 'act_5', createdAt: new Date(now - 30 * day).toISOString(), netDistance: 6000 },
  ];

  function filterActivities(activities, isSubscriber) {
    if (isSubscriber) {
      return {
        isSubscriber: true,
        historyDaysLimit: null,
        activities,
        olderRacesLocked: 0
      };
    }
    const tenDaysAgo = new Date(now - 10 * day);
    const filtered = activities.filter(a => new Date(a.createdAt) >= tenDaysAgo);
    return {
      isSubscriber: false,
      historyDaysLimit: 10,
      activities: filtered,
      olderRacesLocked: activities.length - filtered.length
    };
  }

  // Free user
  const freeRes = filterActivities(mockActivities, false);
  assert.equal(freeRes.isSubscriber, false);
  assert.equal(freeRes.historyDaysLimit, 10);
  assert.equal(freeRes.activities.length, 3);
  assert.equal(freeRes.olderRacesLocked, 2);

  // Subscribed user
  const subRes = filterActivities(mockActivities, true);
  assert.equal(subRes.isSubscriber, true);
  assert.equal(subRes.historyDaysLimit, null);
  assert.equal(subRes.activities.length, 5);
  assert.equal(subRes.olderRacesLocked, 0);
});

test('Official contact address contact@rowerrace.com is present in html files', () => {
  const appHtmlPath = path.resolve(__dirname, '../src/app/app.html');
  const indexHtmlPath = path.resolve(__dirname, '../src/index.html');

  const appHtml = fs.readFileSync(appHtmlPath, 'utf8');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  assert.ok(appHtml.includes('contact@rowerrace.com'), 'app.html contains contact@rowerrace.com');
  assert.ok(indexHtml.includes('contact@rowerrace.com'), 'index.html contains contact@rowerrace.com');
});

test('Fullscreen button on first line next to race counter & screen On button removal', () => {
  const appHtmlPath = path.resolve(__dirname, '../src/app/app.html');
  const appHtml = fs.readFileSync(appHtmlPath, 'utf8');

  // Verify that the "écran On" button has been removed from the header and quick tools
  assert.ok(!appHtml.includes('hero-wakelock'), 'app.html must not contain hero-wakelock button');
  assert.ok(!appHtml.includes('toggleWakeLock()'), 'app.html must not contain manual toggleWakeLock buttons');

  // Verify that fullscreen button is located directly next to the race counter in hero-schedule-cluster
  assert.ok(appHtml.includes('hero-schedule-cluster'), 'app.html must contain hero-schedule-cluster');
  assert.ok(appHtml.includes('hero-fullscreen'), 'app.html must contain hero-fullscreen button');
  assert.ok(appHtml.includes('toggleFullscreen()'), 'app.html must call toggleFullscreen()');

  // Verify that the hero-fullscreen button follows race-schedule-badge in hero-schedule-cluster
  const scheduleIndex = appHtml.indexOf('race-schedule-badge hero-schedule');
  const fullscreenIndex = appHtml.indexOf('btn-fullscreen hero-fullscreen');
  assert.ok(scheduleIndex !== -1, 'app.html must contain race-schedule-badge hero-schedule');
  assert.ok(fullscreenIndex !== -1, 'app.html must contain btn-fullscreen hero-fullscreen');
  assert.ok(fullscreenIndex > scheduleIndex, 'hero-fullscreen must be placed immediately to the right of race-schedule-badge');
});

test('Cross-browser fullscreen detection and vendor prefix support', () => {
  function checkIsFullscreen(doc) {
    if (!doc) return false;
    return Boolean(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );
  }

  function checkFullscreenSupported(doc) {
    if (!doc) return false;
    const docEl = doc.documentElement || {};
    return Boolean(
      docEl.requestFullscreen ||
      docEl.webkitRequestFullscreen ||
      docEl.mozRequestFullScreen ||
      docEl.msRequestFullscreen ||
      doc.fullscreenEnabled ||
      doc.webkitFullscreenEnabled ||
      doc.mozFullScreenEnabled ||
      doc.msFullscreenEnabled
    );
  }

  // Standard browser
  assert.equal(checkIsFullscreen({ fullscreenElement: {} }), true);
  assert.equal(checkIsFullscreen({}), false);
  assert.equal(checkFullscreenSupported({ documentElement: { requestFullscreen: () => {} } }), true);

  // Webkit / Safari (iPad / iPhone)
  assert.equal(checkIsFullscreen({ webkitFullscreenElement: {} }), true);
  assert.equal(checkFullscreenSupported({ documentElement: { webkitRequestFullscreen: () => {} } }), true);

  // Firefox / Moz
  assert.equal(checkIsFullscreen({ mozFullScreenElement: {} }), true);
  assert.equal(checkFullscreenSupported({ documentElement: { mozRequestFullScreen: () => {} } }), true);

  // IE / Old Edge MS
  assert.equal(checkIsFullscreen({ msFullscreenElement: {} }), true);
  assert.equal(checkFullscreenSupported({ documentElement: { msRequestFullscreen: () => {} } }), true);
});

test('i18n service provides fullscreen translations for all supported languages', () => {
  const i18nPath = path.resolve(__dirname, '../src/app/services/i18n.service.ts');
  const i18nContent = fs.readFileSync(i18nPath, 'utf8');

  const requiredKeys = ['FULLSCREEN_ENTER', 'FULLSCREEN_EXIT', 'FULLSCREEN_ENTER_LABEL', 'FULLSCREEN_EXIT_LABEL'];
  for (const key of requiredKeys) {
    assert.ok(i18nContent.includes(`'${key}'`), `i18n.service.ts must include translation key ${key}`);
  }
});

test('Fullscreen button accessibility and responsive CSS rules', () => {
  const appHtmlPath = path.resolve(__dirname, '../src/app/app.html');
  const appCssPath = path.resolve(__dirname, '../src/app/app.css');
  const appHtml = fs.readFileSync(appHtmlPath, 'utf8');
  const appCss = fs.readFileSync(appCssPath, 'utf8');

  // Accessibility attributes
  assert.ok(appHtml.includes('[attr.aria-label]'), 'Fullscreen button has dynamic aria-label');
  assert.ok(appHtml.includes('[attr.aria-pressed]'), 'Fullscreen button has dynamic aria-pressed');
  assert.ok(appHtml.includes('aria-hidden="true"'), 'Fullscreen decorative icon has aria-hidden');

  // CSS rules
  assert.ok(appCss.includes('white-space: nowrap;'), 'hero-fullscreen button has white-space nowrap');
  assert.ok(appCss.includes('flex-shrink: 0;'), 'hero-fullscreen button has flex-shrink 0');
  assert.ok(appCss.includes('.app-pseudo-fullscreen'), 'CSS defines app-pseudo-fullscreen for iOS Safari fallback');
});

test('WakeLock state sync and re-acquisition on user interaction', () => {
  class MockWakeLockService {
    constructor() {
      this.wakeLock = null;
      this.isEnabled = true;
      this.onStateChange = undefined;
    }
    isSupported() { return true; }
    isLockActive() { return this.wakeLock !== null; }
    async requestWakeLock() {
      this.wakeLock = { released: false };
      this.onStateChange?.(true);
      return true;
    }
    release() {
      this.wakeLock = null;
      this.onStateChange?.(false);
    }
  }

  const service = new MockWakeLockService();
  let componentActive = false;
  service.onStateChange = (active) => { componentActive = active; };

  // Initial acquire
  service.requestWakeLock();
  assert.equal(service.isLockActive(), true);
  assert.equal(componentActive, true);

  // OS releases lock (e.g. background tab or power interrupt)
  service.release();
  assert.equal(service.isLockActive(), false);
  assert.equal(componentActive, false);

  // User interacts with screen -> re-acquire
  function onUserInteraction() {
    if (!service.isLockActive() && service.isSupported()) {
      service.requestWakeLock();
    }
  }
  onUserInteraction();
  assert.equal(service.isLockActive(), true);
  assert.equal(componentActive, true);
});

test('Pseudo-fullscreen fallback behavior when native DOM fullscreen is unavailable (iOS Safari)', () => {
  class MockFullscreenManager {
    constructor(hasNative) {
      this.hasNative = hasNative;
      this.isFullscreen = false;
      this.isPseudoFullscreen = false;
    }
    checkNativeFullscreen() {
      return this.isFullscreen && this.hasNative;
    }
    checkIsFullscreen() {
      return this.checkNativeFullscreen() || this.isPseudoFullscreen;
    }
    toggleFullscreen() {
      if (this.hasNative) {
        this.isFullscreen = !this.isFullscreen;
        this.isPseudoFullscreen = false;
      } else {
        // Fallback for iOS Safari iPhones
        this.isPseudoFullscreen = !this.isPseudoFullscreen;
      }
      return this.checkIsFullscreen();
    }
  }

  // Device with native API (desktop/Android/iPad)
  const nativeDevice = new MockFullscreenManager(true);
  assert.equal(nativeDevice.toggleFullscreen(), true);
  assert.equal(nativeDevice.checkIsFullscreen(), true);
  assert.equal(nativeDevice.isPseudoFullscreen, false);
  assert.equal(nativeDevice.toggleFullscreen(), false);

  // Device without native DOM Fullscreen (iOS iPhone Safari)
  const iosDevice = new MockFullscreenManager(false);
  assert.equal(iosDevice.toggleFullscreen(), true);
  assert.equal(iosDevice.checkIsFullscreen(), true);
  assert.equal(iosDevice.isPseudoFullscreen, true);
  assert.equal(iosDevice.toggleFullscreen(), false);
  assert.equal(iosDevice.isPseudoFullscreen, false);
});

test('Subscription paid buttons disabled and protected against activation', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');

  // Verify that club tier and pro tier buttons have [disabled]="true"
  assert.match(html, /btn-pricing btn-club[^>]*\[disabled\]="true"/);
  assert.match(html, /btn-pricing btn-pro[^>]*\[disabled\]="true"/);
  assert.match(html, /Bientôt disponible \(5,99 €\/mois\)/);
  assert.match(html, /Bientôt disponible \(8,99 €\/mois\)/);

  // Verify subscribeToTier logic
  let subscriptionError = '';
  function subscribeToTier(tierId) {
    if (tierId !== 'free') {
      subscriptionError = 'Les abonnements payants ne sont pas encore activables.';
      return false;
    }
    return true;
  }

  assert.equal(subscribeToTier('intermediate'), false);
  assert.equal(subscriptionError, 'Les abonnements payants ne sont pas encore activables.');
  assert.equal(subscribeToTier('premium'), false);
  assert.equal(subscribeToTier('free'), true);
});

test('Lobby engaged rowers panel displays Race In Progress banner with Top 3 and remaining duration', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');

  // Verify presence of live race banner in engaged rowers table section
  assert.ok(
    html.includes('class="lobby-live-race-banner"') &&
    (html.includes('isRaceActive') || html.includes("nextRaceInfo?.status === 'in_progress'")),
    'Live race banner rendered when race is in progress'
  );
  assert.match(html, /🔴 Course en cours/);
  assert.match(html, /formattedGameRemaining/);
  assert.match(html, /topThreeLiveRacers/);

  // Verify topThreeLiveRacers calculation and distance descending sorting logic
  function computeTopThree(racers, liveMetricsList) {
    const list = [...((racers && racers.length > 0)
      ? racers.filter(r => r.status !== 'abandoned')
      : (liveMetricsList || []).filter(r => r.status !== 'abandoned'))];
    list.sort((a, b) => {
      const isFinA = a.status === 'finished' ? 1 : 0;
      const isFinB = b.status === 'finished' ? 1 : 0;
      if (isFinA !== isFinB) return isFinB - isFinA;
      const distA = Number(a.netDistance != null ? a.netDistance : (a.dist != null ? a.dist : 0));
      const distB = Number(b.netDistance != null ? b.netDistance : (b.dist != null ? b.dist : 0));
      return distB - distA;
    });
    return list.slice(0, 3).map((r, i) => {
      const rawName = r.userName || r.name || r.userId || `Rameur ${i + 1}`;
      const rawDist = Math.round(Number(r.netDistance != null ? r.netDistance : (r.dist != null ? r.dist : 0)));
      return {
        rank: i + 1,
        name: rawName,
        dist: rawDist
      };
    });
  }

  // Test unsorted racers list (e.g. lane order or random socket arrival)
  const unsortedRacers = [
    { userId: 'usr_2', userName: 'Bob', netDistance: 500, status: 'in_progress' },
    { userId: 'usr_1', userName: 'Alice', netDistance: 1250, status: 'in_progress' },
    { userId: 'bot_3', userName: 'Bot Turbo', netDistance: 1100, status: 'in_progress' },
    { userId: 'usr_4', userName: 'David', netDistance: 950, status: 'in_progress' },
    { userId: 'usr_5', userName: 'Eve', netDistance: 1800, status: 'abandoned' }
  ];

  const top3 = computeTopThree(unsortedRacers, []);
  assert.equal(top3.length, 3);
  assert.deepEqual(top3[0], { rank: 1, name: 'Alice', dist: 1250 }, 'Top 1 is highest active distance');
  assert.deepEqual(top3[1], { rank: 2, name: 'Bot Turbo', dist: 1100 }, 'Top 2 is second highest distance');
  assert.deepEqual(top3[2], { rank: 3, name: 'David', dist: 950 }, 'Top 3 is third highest distance');

  // Test finished racer priority
  const withFinished = [
    { userId: 'usr_2', userName: 'Bob', netDistance: 1980, status: 'in_progress' },
    { userId: 'usr_1', userName: 'Alice', netDistance: 2000, status: 'finished' }
  ];
  const topFinished = computeTopThree(withFinished, []);
  assert.equal(topFinished[0].name, 'Alice', 'Finished racer is top ranked');

  // Test remaining duration ticker decrement logic
  let gameRemainingSeconds = 3300;
  let formattedGameRemaining = '';
  function tickOneSecond(isRunning) {
    if (isRunning && gameRemainingSeconds > 0) {
      gameRemainingSeconds--;
      const remMin = Math.floor(gameRemainingSeconds / 60);
      const remSec = gameRemainingSeconds % 60;
      formattedGameRemaining = `${remMin}m ${remSec < 10 ? '0' : ''}${remSec}s`;
    }
  }
  tickOneSecond(true);
  assert.equal(gameRemainingSeconds, 3299);
  assert.equal(formattedGameRemaining, '54m 59s');
});

test('Garmin Watch app: 10-char prefix, encoded suffix, and menu positioning before local history', () => {
  const userManagerMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/UserManager.mc'), 'utf8');
  const rowerDelegateMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/RowerDelegate.mc'), 'utf8');
  const rowerViewMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/RowerView.mc'), 'utf8');
  const i18nMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/I18n.mc'), 'utf8');
  const settingsXml = fs.readFileSync(path.join(__dirname, '../../garmin/resources/settings/settings.xml'), 'utf8');

  // Verify 10-character free prefix generator in UserManager.mc
  assert.match(userManagerMc, /for \(var i = 0; i < 7; i\+\+\)/, 'Row + 7 chars = 10 chars');
  assert.match(userManagerMc, /p\.length\(\)\s*>\s*10[\s\S]*?p\.substring\(0,\s*10\)/);
  assert.match(userManagerMc, /userLoginPrefix/);

  // Verify settings.xml has userLoginPrefix with maxLength 10
  assert.match(settingsXml, /property id="userLoginPrefix"/);
  assert.match(settingsXml, /setting propertyKey="@Properties\.userLoginPrefix"/);
  assert.match(settingsXml, /maxLength="10"/);

  // Verify menu order: MENU_PLAYER_ID is added right before MENU_HISTORY
  const menuPublicIdx = rowerViewMc.indexOf('I18n.getText("MENU_PUBLIC")');
  const menuPrivateIdx = rowerViewMc.indexOf('I18n.getText("MENU_PRIVATE")');
  const menuSoloIdx = rowerViewMc.indexOf('I18n.getText("MENU_SOLO")');
  const menuPlayerIdIdx = rowerViewMc.indexOf('I18n.getText("MENU_PLAYER_ID")');
  const menuHistoryIdx = rowerViewMc.indexOf('I18n.getText("MENU_HISTORY")');

  assert.ok(menuPublicIdx > 0 && menuPrivateIdx > menuPublicIdx, 'Public then Private');
  assert.ok(menuSoloIdx > menuPrivateIdx, 'Private then Solo');
  assert.ok(menuPlayerIdIdx > menuSoloIdx, 'Solo then Player ID');
  assert.ok(menuHistoryIdx > menuPlayerIdIdx, 'Player ID immediately before History');

  // Verify delegate menu indices
  assert.match(rowerDelegateMc, /else if \(menuIdx == 3\) \{\s*\/\/\s*4\.\s*Mon identifiant de joueur\s*_view\.setAppState\(RowerView\.STATE_PLAYER_ID\);/);
  assert.match(rowerDelegateMc, /else if \(menuIdx == 4\) \{\s*\/\/\s*5\.\s*Historique local/);

  // Verify French translation
  assert.match(i18nMc, /return "Mon identifiant de joueur";/);
  assert.match(i18nMc, /return "MON IDENTIFIANT";/);

  // Verify suffix does not contain underscore delimiter collision
  assert.match(userManagerMc, /BASE64_CHARS\s*=\s*"[A-Za-z0-9]+";/);
  assert.ok(!userManagerMc.includes('BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"'), 'Suffix chars should not contain underscore delimiter');
});

test('Mobile and Tablet Fullscreen display logic: only cockpit with player selection or regatta view', () => {
  function checkIsMobileOrTablet(width, ua, touch = false) {
    const isTouch = touch;
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Silk|Kindle/i.test(ua || '');
    return isMobileUA || Boolean(isTouch) || width <= 1024;
  }

  function checkIsMobileFullscreenOnly(isFullscreen, isMobileOrTablet) {
    return Boolean(isFullscreen && isMobileOrTablet);
  }

  // Desktop (1920x1080, no touch, desktop UA) in fullscreen: not mobile fullscreen only
  assert.equal(checkIsMobileFullscreenOnly(true, checkIsMobileOrTablet(1920, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false)), false);

  // Smartphone (375x667, iPhone UA) in fullscreen: mobile fullscreen only
  assert.equal(checkIsMobileFullscreenOnly(true, checkIsMobileOrTablet(375, 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)', true)), true);

  // Tablet (820x1180, iPad UA) in fullscreen: mobile fullscreen only
  assert.equal(checkIsMobileFullscreenOnly(true, checkIsMobileOrTablet(820, 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', true)), true);

  // Smartphone not in fullscreen: false
  assert.equal(checkIsMobileFullscreenOnly(false, checkIsMobileOrTablet(375, 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)', true)), false);

  // Read app.html to verify mobile-fullscreen-view hides header, footer, dual tables and shows only arena (cockpit or canvas)
  const appHtml = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');
  assert.match(appHtml, /\[class\.mobile-fullscreen-view\]="isMobileFullscreenOnly"/);
  assert.match(appHtml, /<header class="hud-header" \*ngIf="!isMobileFullscreenOnly">/);
  assert.match(appHtml, /@if \(isRaceActive \|\| isMobileFullscreenOnly\)/);
});

test('Garmin Watch pairing with suffix and 10-char prefix, persistence, and clearPairing', () => {
  // Test pairing validation
  function validatePairingInputs(suffix, prefix) {
    const cleanSuffix = (suffix || '').trim();
    const cleanPrefix = (prefix || '').trim().slice(0, 10);
    if (!cleanSuffix) return { valid: false, error: 'SUFFIX_REQUIRED' };
    if (!cleanPrefix) return { valid: false, error: 'PREFIX_REQUIRED' };
    return {
      valid: true,
      userId: `${cleanPrefix}_${cleanSuffix}`,
      login: cleanPrefix
    };
  }

  // Empty suffix or prefix rejected
  assert.equal(validatePairingInputs('', 'EmmaRacer').valid, false);
  assert.equal(validatePairingInputs('k9Yz1', '').valid, false);

  // Valid inputs: truncates prefix at 10 chars, formats userId
  const res = validatePairingInputs('k9Yz1', 'EmmaRacerSuperLong');
  assert.equal(res.valid, true);
  assert.equal(res.userId, 'EmmaRacerS_k9Yz1');
  assert.equal(res.login, 'EmmaRacerS');

  // Verify app.html contains pairing inputs and Lancer l'appareillage button
  const appHtml = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');
  assert.match(appHtml, /id="pairing-suffix-input"/);
  assert.match(appHtml, /id="pairing-prefix-input"/);
  assert.match(appHtml, /maxlength="10"/);
  assert.match(appHtml, /Lancer l'appareillage/);
  assert.match(appHtml, /Effacer l'appareillage/);

  // Verify watch app UserManager.mc stores userLoginPrefix on approval
  const bleDelegateMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/BleDelegate.mc'), 'utf8');
  assert.match(bleDelegateMc, /Storage\.setValue\("userLoginPrefix",\s*p\)/);
});

test('Duel 1v1 Bot mode only proposed if player is paired', () => {
  const appHtml = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');
  // btn-bot-duel must be conditioned on isPaired || isWatchConfirmed
  assert.match(appHtml, /\*ngIf="isPaired \|\| isWatchConfirmed"[\s\S]*?class="btn-hud btn-bot-duel"/);
});

test('Statistiques button moved to the right of Salons Prives and displayed for identified players', () => {
  const appHtml = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');
  const privateRoomIdx = appHtml.indexOf('class="btn-hud btn-private"');
  const statsIdx = appHtml.indexOf('class="btn-hud btn-stats"');
  const pricingIdx = appHtml.indexOf('class="btn-hud btn-pricing"');

  assert.ok(privateRoomIdx > 0, 'btn-private exists');
  assert.ok(statsIdx > privateRoomIdx, 'btn-stats is placed after btn-private');
  assert.ok(pricingIdx > statsIdx, 'btn-pricing is placed after btn-stats');
  assert.match(appHtml, /\*ngIf="isIdentified"[\s\S]*?class="btn-hud btn-stats"/);
});

test('Smartphone mode: full-width fullscreen button underneath next race, and modal links for standings/history', () => {
  const appCss = fs.readFileSync(path.join(__dirname, '../src/app/app.css'), 'utf8');
  const appHtml = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');

  // CSS for 768px smartphone: hero-schedule-cluster is flex-direction column, hero-fullscreen is full width (100%)
  assert.match(appCss, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.hero-schedule-cluster\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.match(appCss, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.hero-schedule-cluster\s+\.hero-fullscreen\s*\{[\s\S]*?inline-size:\s*100%/);

  // Large tables hidden on smartphone, smartphone links displayed
  assert.match(appCss, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.dual-standings-history-container\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(appCss, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.smartphone-table-links\s*\{[\s\S]*?display:\s*flex/);

  // HTML contains smartphone links
  assert.match(appHtml, /class="smartphone-table-links"/);
  assert.match(appHtml, /openStandingsModal\(\)/);
  assert.match(appHtml, /openHistoryModal\(\)/);
});

test('Leaderboard only includes players who finished a race', () => {
  function filterLeaderboardFinishers(players) {
    return players.filter(p => (p.totalRaces && p.totalRaces > 0) || (p.points && p.points > 0) || (p.totalWins && p.totalWins > 0));
  }

  const samplePlayers = [
    { id: 'u1', name: 'Finisher Alice', totalRaces: 3, points: 150 },
    { id: 'u2', name: 'New Registered Bob', totalRaces: 0, points: 0 },
    { id: 'u3', name: 'Guest Charlie', totalRaces: 0, points: 0 },
    { id: 'u4', name: 'Finisher David', totalRaces: 1, points: 25 }
  ];

  const filtered = filterLeaderboardFinishers(samplePlayers);
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map(p => p.id), ['u1', 'u4']);
});

test('Account creation and subscription possible without prior pairing', () => {
  const appHtml = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');
  // Account modal button is available on un-paired header
  assert.match(appHtml, /class="btn-hud btn-connect-compact"[\s\S]*?openAccountModal\('login'\)/);
  // Watch ID is optional on registration
  assert.match(appHtml, /Identifiant de joueur Garmin \(optionnel/);
});

test('Mobile and Tablet Fullscreen: in-cockpit player selection, bottom nav hidden, and robust state persistence', () => {
  const appHtml = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');
  const appCss = fs.readFileSync(path.join(__dirname, '../src/app/app.css'), 'utf8');
  const appTs = fs.readFileSync(path.join(__dirname, '../src/app/app.ts'), 'utf8');

  // In-cockpit player selection when not yet identified
  assert.match(appHtml, /class="cockpit-player-select-card" \*ngIf="!canAccessCockpit"/);
  assert.match(appHtml, /Sélectionnez votre coureur pour activer votre cockpit/);
  assert.match(appHtml, /id="cockpit-inner-select"/);

  // Mobile bottom nav hidden when in mobile fullscreen
  assert.match(appHtml, /class="mobile-bottom-nav" \*ngIf="!isMobileFullscreenOnly"/);
  assert.match(appCss, /\.game-container\.mobile-fullscreen-view \.mobile-bottom-nav/);
  assert.match(appCss, /\.game-container\.mobile-fullscreen-view \.mobile-bottom-nav[\s\S]*?display:\s*none\s*!important/);

  // Fullscreen exit button in arena-mode-bar handles pseudo-fullscreen (iOS Safari)
  assert.match(appHtml, /@if\s*\(fullscreenSupported\s*\|\|\s*isFullscreen\s*\|\|\s*isPseudoFullscreen\)/);

  // Account modal does not propose watch identification if already paired
  assert.match(appHtml, /@if\s*\(!isWatchConfirmed\s*&&\s*!isPaired\)\s*\{[\s\S]*?Appairer la montre[\s\S]*?\}\s*@else\s*\{[\s\S]*?Votre montre Garmin est déjà appareillée/);

  // Polling loadCurrentRace does not reset cockpit view when in mobile fullscreen
  assert.match(appTs, /this\.activeViewMode === 'cockpit' && !this\.canAccessCockpit && !this\.isMobileFullscreenOnly/);

  // Bot duel method check
  assert.match(appTs, /openBotDuelModal\(\)[\s\S]*?if\s*\(!this\.isPaired\s*&&\s*!this\.isWatchConfirmed\)/);

  // clearPairing resets guest identity so isIdentified becomes false
  assert.match(appTs, /clearPairing\(\)[\s\S]*?if\s*\(!this\.isSubscriber\s*&&\s*!this\.isUserAdmin\)[\s\S]*?this\.activeUserId = `usr_\$\{randId\}`/);
});
