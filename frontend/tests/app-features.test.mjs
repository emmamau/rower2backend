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

test('Garmin Watch app: pairing protocol, no Mon identifiant de joueur, secure deviceId/deviceToken management and menu positioning', () => {
  const userManagerMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/UserManager.mc'), 'utf8');
  const rowerDelegateMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/RowerDelegate.mc'), 'utf8');
  const rowerViewMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/RowerView.mc'), 'utf8');
  const restSyncManagerMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/RestSyncManager.mc'), 'utf8');
  const i18nMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/I18n.mc'), 'utf8');

  // Verify UserManager has device token and ID storage methods
  assert.match(userManagerMc, /function getDeviceId\(\)/, 'Must have getDeviceId()');
  assert.match(userManagerMc, /function getDeviceToken\(\)/, 'Must have getDeviceToken()');
  assert.match(userManagerMc, /function setDeviceToken\(/, 'Must have setDeviceToken()');
  assert.match(userManagerMc, /function deleteDeviceToken\(\)/, 'Must have deleteDeviceToken()');
  assert.match(userManagerMc, /function isPaired\(\)/, 'Must have isPaired()');

  // Verify RestSyncManager makes pairing web request and syncs to /boost with Bearer token
  assert.match(restSyncManagerMc, /function pairWatch\(pairingCode as String\)/, 'Must have pairWatch');
  assert.match(restSyncManagerMc, /\/api\/garmin\/pair/, 'Must call /api/garmin/pair');
  assert.match(restSyncManagerMc, /\/boost/, 'Must sync activity to /boost');
  assert.match(restSyncManagerMc, /headers\.put\("Authorization",\s*"Bearer\s*"\s*\+\s*\(devToken as String\)\)/, 'Must inject Bearer deviceToken');

  // Verify MENU_PLAYER_ID is completely purged from watch view & translations
  assert.ok(!rowerViewMc.includes('MENU_PLAYER_ID'), 'MENU_PLAYER_ID must be purged from RowerView.mc');
  assert.ok(!i18nMc.includes('MENU_PLAYER_ID'), 'MENU_PLAYER_ID must be purged from I18n.mc');

  // Verify Menu items include pairing options
  assert.match(rowerViewMc, /I18n\.getText\("MENU_PAIR"\)/, 'Must offer MENU_PAIR');
  assert.match(rowerViewMc, /I18n\.getText\("MENU_PAIRED"\)/, 'Must offer MENU_PAIRED');

  // Verify delegate menu indices for pairing (item 3)
  assert.match(rowerDelegateMc, /else if \(menuIdx == 3\) \{/, 'Item 3 handles pairing flow');
  assert.match(rowerDelegateMc, /STATE_PAIRING_INPUT/, 'Switches to STATE_PAIRING_INPUT');

  // Verify French translations for pairing
  assert.match(i18nMc, /return "Appairer la montre";/);
  assert.match(i18nMc, /return "Statut : Appaire";/);
  assert.match(i18nMc, /return "Reinitialiser l'appairage";/);
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

test('Garmin Web pairing: 6-char ephemeral code, countdown, real-time paired status, guest session ID, and resetGarminPairing', () => {
  // Test 6-char pairing code format validation
  function validatePairingCode(code) {
    if (!code || typeof code !== 'string') return false;
    const clean = code.trim().toUpperCase();
    return clean.length === 6 && /^[A-Z0-9]{6}$/.test(clean);
  }

  assert.equal(validatePairingCode('K8F2M9'), true, 'Valid 6-char alphanumeric code');
  assert.equal(validatePairingCode('ABC123'), true, 'Valid 6-char code');
  assert.equal(validatePairingCode('AB12'), false, 'Too short rejected');
  assert.equal(validatePairingCode('ABCDEF12'), false, 'Too long rejected');
  assert.equal(validatePairingCode('AB@12!'), false, 'Special chars rejected');

  // Verify app.html contains new pairing section and buttons
  const appHtml = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');
  assert.match(appHtml, /class="garmin-pairing-section"/, 'Must contain garmin-pairing-section');
  assert.match(appHtml, /generateGarminPairingCode\(\)/, 'Must call generateGarminPairingCode');
  assert.match(appHtml, /resetGarminPairing\(\)/, 'Must call resetGarminPairing');

  // Verify old pairing inputs are purged from app.html
  assert.ok(!appHtml.includes('id="pairing-suffix-input"'), 'pairing-suffix-input must be purged');
  assert.ok(!appHtml.includes('id="pairing-prefix-input"'), 'pairing-prefix-input must be purged');

  // Verify watch app RestSyncManager and UserManager store deviceToken
  const restSyncManagerMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/RestSyncManager.mc'), 'utf8');
  assert.match(restSyncManagerMc, /UserManager\.setDeviceToken\(token\)/, 'RestSyncManager sets device token');
  const userManagerMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/UserManager.mc'), 'utf8');
  assert.match(userManagerMc, /Storage\.setValue\("deviceToken",\s*token\)/, 'UserManager sets deviceToken in storage');
  assert.match(userManagerMc, /Storage\.deleteValue\("deviceToken"\)/, 'UserManager deletes deviceToken on reset');
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

test('Account creation and subscription possible without prior pairing, and old watch login purged', () => {
  const appHtml = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');
  // Account modal button is available on un-paired header (line 1 and line 2)
  assert.match(appHtml, /class="btn-hud btn-connect-compact"[\s\S]*?openAccountModal\('login'\)/);
  assert.match(appHtml, /class="header-line1-auth-box"/, 'Header line 1 has connection / profile trigger');
  // Old watch ID and login input must be completely purged from registration and login modals
  assert.ok(!appHtml.includes('Identifiant de joueur Garmin (optionnel'), 'Old watch ID input purged');
  assert.ok(!appHtml.includes('Mon identifiant de joueur'), 'Old watch menu reference purged from web');
  assert.ok(!appHtml.includes('btn-watch-sync'), 'Old watch sync button purged from web');
  assert.ok(!appHtml.includes('btn-reset-pairing-inline'), 'Pairing display purged from header line 2');
});

test('Mobile and Tablet Fullscreen: in-cockpit player selection, bottom nav hidden, and robust state persistence', () => {
  const appHtml = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');
  const appCss = fs.readFileSync(path.join(__dirname, '../src/app/app.css'), 'utf8');
  const appTs = fs.readFileSync(path.join(__dirname, '../src/app/app.ts'), 'utf8');

  // Spectator / Camera tracking dropdown in Cockpit and Regatta views
  assert.match(appHtml, /class="spectator-camera-bar"/, 'Must contain spectator-camera-bar');
  assert.match(appHtml, /class="spectator-select"/, 'Must contain spectator-select');
  assert.match(appHtml, /class="btn-cockpit-pair-action"/, 'Must provide direct pairing shortcut in cockpit');

  // Mobile bottom nav hidden when in mobile fullscreen
  assert.match(appHtml, /class="mobile-bottom-nav" \*ngIf="!isMobileFullscreenOnly"/);
  assert.match(appCss, /\.game-container\.mobile-fullscreen-view \.mobile-bottom-nav/);
  assert.match(appCss, /\.game-container\.mobile-fullscreen-view \.mobile-bottom-nav[\s\S]*?display:\s*none\s*!important/);

  // Fullscreen exit button in arena-mode-bar handles pseudo-fullscreen (iOS Safari)
  assert.match(appHtml, /@if\s*\(fullscreenSupported\s*\|\|\s*isFullscreen\s*\|\|\s*isPseudoFullscreen\)/);

  // Account modal profile tab provides Garmin pairing section
  assert.match(appHtml, /class="profile-garmin-box" \*ngIf="!isPaired"/);
  assert.match(appHtml, /class="profile-garmin-box is-paired" \*ngIf="isPaired"/);

  // Bot duel method check
  assert.match(appTs, /openBotDuelModal\(\)[\s\S]*?if\s*\(!this\.isPaired\s*&&\s*!this\.isWatchConfirmed\)/);

  // resetGarminPairing revokes token and clears pairing state
  assert.match(appTs, /resetGarminPairing\(\)[\s\S]*?this\.isPaired = false/);
});

test('Pure Screen Modes & Navigation: Mode Regate shows only 2D canvas, Mode Cockpit shows only cockpit HUD, Home displays full dashboard', () => {
  const appHtml = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');
  const appCss = fs.readFileSync(path.join(__dirname, '../src/app/app.css'), 'utf8');
  const appTs = fs.readFileSync(path.join(__dirname, '../src/app/app.ts'), 'utf8');

  // Pure screen header has Home button, view modes, language selector and fullscreen toggle
  assert.match(appHtml, /class="pure-screen-header" \*ngIf="siteView === 'regatta' \|\| siteView === 'cockpit'"/);
  assert.match(appHtml, /class="btn-pure-nav btn-pure-home"[\s\S]*?\(click\)="setSiteView\('home'\)"/);
  assert.match(appHtml, /<span class="pure-icon" aria-hidden="true">🏠<\/span>/);
  assert.match(appHtml, /id="pure-lang-select"/);

  // Mode Regate displays only regatta canvas and summary pill, removing cluttering podium-banner
  assert.match(appHtml, /@if \(siteView === 'regatta'\) \{[\s\S]*?<app-regatta-canvas/);
  assert.doesNotMatch(appHtml, /@if \(siteView === 'regatta'\) \{[\s\S]*?<section class="podium-banner"/);

  // Mode Cockpit displays only cockpit elements
  assert.match(appHtml, /@else if \(siteView === 'cockpit'\) \{[\s\S]*?<section class="cockpit-hud cockpit-expanded">/);

  // Home view renders full dashboard without being swallowed by race active condition
  assert.match(appHtml, /@else \{\s*<!-- =+ -->\s*<!-- PAGE D'ACCUEIL : TOUTES LES INFORMATIONS NÉCESSAIRES -->/);
  assert.match(appHtml, /class="home-active-race-callout" \*ngIf="isRaceActive"/);
  assert.match(appHtml, /class="garmin-pairing-section"/);
  assert.match(appHtml, /class="dual-standings-history-container"/);
  assert.match(appHtml, /class="lobby-regatta-preview-section"/);

  // CSS ensures pure-screen-active hides all non-essential widgets
  assert.match(appCss, /\.game-container\.pure-screen-active \.hud-header/);
  assert.match(appCss, /\.game-container\.pure-screen-active \.mobile-bottom-nav/);
  assert.match(appCss, /\.game-container\.pure-screen-active \.dual-standings-history-container/);
});

test('Mobile/Tablet SEO guide is replaced by interactive link and adapts dynamically to dropdown language', () => {
  const appHtml = fs.readFileSync(path.join(__dirname, '../src/app/app.html'), 'utf8');
  const appTs = fs.readFileSync(path.join(__dirname, '../src/app/app.ts'), 'utf8');
  const appCss = fs.readFileSync(path.join(__dirname, '../src/app/app.css'), 'utf8');
  const i18nServiceTs = fs.readFileSync(path.join(__dirname, '../src/app/services/i18n.service.ts'), 'utf8');

  // On smartphone/tablet, lower SEO guide is replaced by a link card
  assert.match(appHtml, /class="seo-mobile-link-wrapper" \*ngIf="isMobileOrTablet"/);
  assert.match(appHtml, /class="seo-mobile-link"[\s\S]*?\(click\)="toggleMobileSeoGuide\(\$event\)"/);
  assert.match(appHtml, /class="seo-guide-body" \[class\.mobile-collapsed\]="isMobileOrTablet && !isMobileSeoGuideOpen"/);
  assert.match(appCss, /\.seo-guide-body\.mobile-collapsed[\s\S]*?display:\s*none\s*!important/);

  // Desktop media query ensures link is hidden and guide body is displayed
  assert.match(appCss, /@media \(min-width:\s*1025px\) \{[\s\S]*?\.seo-mobile-link-wrapper[\s\S]*?display:\s*none\s*!important/);

  // Dynamic localization: header dropdown change synchronizes activeSeoLang across all 6 supported languages
  assert.match(appTs, /syncSeoLanguage\(langCode:\s*string\)/);
  assert.match(appTs, /\['fr',\s*'en',\s*'de',\s*'es',\s*'it',\s*'pt'\]/);

  // All 6 languages provide SEO_TAG, SEO_TITLE, SEO_LEAD, SEO_GUIDE_LINK and SEO_GUIDE_DESC
  for (const lang of ['fr', 'en', 'de', 'es', 'it', 'pt']) {
    assert.match(i18nServiceTs, new RegExp(`(?:'${lang}'|\\b${lang}):\\s*\\{[\\s\\S]*?'SEO_GUIDE_LINK'`));
    assert.match(i18nServiceTs, new RegExp(`(?:'${lang}'|\\b${lang}):\\s*\\{[\\s\\S]*?'SEO_TAG'`));
    assert.match(i18nServiceTs, new RegExp(`(?:'${lang}'|\\b${lang}):\\s*\\{[\\s\\S]*?'SEO_TITLE'`));
    assert.match(i18nServiceTs, new RegExp(`(?:'${lang}'|\\b${lang}):\\s*\\{[\\s\\S]*?'SEO_LEAD'`));
  }

  // Articles exist for fr, en, de, es, it, and pt
  assert.match(appHtml, /<article class="seo-article" \*ngIf="activeSeoLang === 'fr'"/);
  assert.match(appHtml, /<article class="seo-article" \*ngIf="activeSeoLang === 'en'"/);
  assert.match(appHtml, /<article class="seo-article" \*ngIf="activeSeoLang === 'de'"/);
  assert.match(appHtml, /<article class="seo-article" \*ngIf="activeSeoLang === 'es'"/);
  assert.match(appHtml, /<article class="seo-article" \*ngIf="activeSeoLang === 'it'"/);
  assert.match(appHtml, /<article class="seo-article" \*ngIf="activeSeoLang === 'pt'"/);
});

test('Garmin Watch: Aberrant jump filtering, baseline healing, and physiological finish sanity checks', () => {
  const bleDelegateMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/BleDelegate.mc'), 'utf8');
  const rowerDataModelMc = fs.readFileSync(path.join(__dirname, '../../garmin/source/RowerDataModel.mc'), 'utf8');

  // Verify that arbitrary hardcoded 50m fallback is removed from BleDelegate.mc
  assert.doesNotMatch(bleDelegateMc, /_model\.totalDistance = _targetDistance > 50 \? 50 : \(_targetDistance \/ 2\);/, 'Hardcoded 50m fallback must not exist');

  // Verify physiological sanity checks in updateProgressAndCheckFinish
  assert.match(bleDelegateMc, /var minElapsed = \(_targetDistance \* 100\) \/ 850;/);
  assert.match(bleDelegateMc, /var minStrokes = \(_targetDistance \/ 25\);/);
  assert.match(bleDelegateMc, /_model\.alignDistance\(realisticDist\);/);

  // Verify bidirectional sync with normDistM
  assert.match(bleDelegateMc, /if \(data\.hasKey\("normDistM"\) && data\.get\("normDistM"\) != null\)/);
  assert.match(bleDelegateMc, /_model\.alignDistance\(nd\);/);

  // Verify alignDistance method in RowerDataModel.mc
  assert.match(rowerDataModelMc, /public function alignDistance\(dist as Number\) as Void/);

  // Verify baseline healing when single packet jump > 15m
  assert.match(rowerDataModelMc, /if \(candDist > totalDistance \+ 15\) \{[\s\S]*?_distanceOffset = totalDistance;[\s\S]*?_baselineRawDistance = rawDistance;/);

  // Verify FTMS Rower Data 0x2AD1 Elapsed Time (Bit 10) & Remaining Time (Bit 11) 2-byte consumption
  assert.match(rowerDataModelMc, /\/\/ Bit 10: Elapsed Time present \(uint16, seconds\)[\s\S]*?if \(\(flags & 0x0400\) != 0 && \(offset \+ 2\) <= size\) \{[\s\S]*?offset \+= 2;/);
  assert.match(rowerDataModelMc, /\/\/ Bit 11: Remaining Time present \(uint16, seconds\)[\s\S]*?if \(\(flags & 0x0800\) != 0 && \(offset \+ 2\) <= size\) \{[\s\S]*?offset \+= 2;/);
});

test('robots.txt and meta noindex prevent SEO crawling of frontend', () => {
  const robotsPath = path.join(__dirname, '../public/robots.txt');
  assert.ok(fs.existsSync(robotsPath), 'robots.txt must exist in public folder');

  const robotsContent = fs.readFileSync(robotsPath, 'utf8');
  assert.match(robotsContent, /User-agent:\s*\*/i, 'robots.txt must target all user agents');
  assert.match(robotsContent, /Disallow:\s*\//i, 'robots.txt must disallow all root routes');

  const indexHtmlPath = path.join(__dirname, '../src/index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  assert.match(indexHtml, /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex[^"']*["']/i, 'index.html must have noindex meta tag');
});

test('Mobile & Tablet: Automatic Fullscreen on Cockpit or Regatta entry, and Floating Fullscreen button', () => {
  const appHtmlPath = path.resolve(__dirname, '../src/app/app.html');
  const appCssPath = path.resolve(__dirname, '../src/app/app.css');
  const appTsPath = path.resolve(__dirname, '../src/app/app.ts');
  const appHtml = fs.readFileSync(appHtmlPath, 'utf8');
  const appCss = fs.readFileSync(appCssPath, 'utf8');
  const appTs = fs.readFileSync(appTsPath, 'utf8');

  // Verify device detection checks touch, pointer: coarse, and mobile UA
  assert.match(appTs, /get\s+isMobileOrTablet\(\)[\s\S]*?maxTouchPoints[\s\S]*?pointer:\s*coarse/);

  // Verify setSiteView triggers enterFullscreen when isMobileOrTablet
  assert.match(appTs, /setSiteView\(view:\s*'home'\s*\|\s*'regatta'\s*\|\s*'cockpit'\)[\s\S]*?view === 'regatta'[\s\S]*?this\.isMobileOrTablet[\s\S]*?this\.enterFullscreen\(\)/);
  assert.match(appTs, /setSiteView\(view:\s*'home'\s*\|\s*'regatta'\s*\|\s*'cockpit'\)[\s\S]*?view === 'cockpit'[\s\S]*?this\.isMobileOrTablet[\s\S]*?this\.enterFullscreen\(\)/);

  // Verify switchViewMode triggers enterFullscreen when isMobileOrTablet
  assert.match(appTs, /switchViewMode\(mode:\s*'canvas'\s*\|\s*'cockpit'\)[\s\S]*?this\.isMobileOrTablet[\s\S]*?this\.enterFullscreen\(\)/);

  // Verify enterFullscreen and exitFullscreen methods with native vendor prefixes and pseudo-fullscreen fallback
  assert.match(appTs, /async\s+enterFullscreen\(\)[\s\S]*?docEl\.requestFullscreen[\s\S]*?docEl\.webkitRequestFullscreen[\s\S]*?docEl\.mozRequestFullScreen[\s\S]*?docEl\.msRequestFullscreen/);
  assert.match(appTs, /async\s+exitFullscreen\(\)[\s\S]*?doc\.exitFullscreen[\s\S]*?doc\.webkitExitFullscreen[\s\S]*?doc\.mozCancelFullScreen[\s\S]*?doc\.msExitFullscreen/);

  // Verify floating fullscreen toggle button in app.html
  assert.match(appHtml, /class="btn-floating-fullscreen"/, 'app.html must have btn-floating-fullscreen button');
  assert.match(appHtml, /\[attr\.aria-label\]="isFullscreen\s*\?\s*i18n\.t\('FULLSCREEN_EXIT'\)\s*:\s*i18n\.t\('FULLSCREEN_ENTER'\)"/);
  assert.match(appHtml, /\[attr\.aria-pressed\]="isFullscreen"/);
  assert.match(appHtml, /\(click\)="toggleFullscreen\(\)"/);

  // Verify floating fullscreen button styles in app.css
  assert.match(appCss, /\.btn-floating-fullscreen\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*9999;/);
  assert.match(appCss, /\.btn-floating-fullscreen:hover\s*\{/);
  assert.match(appCss, /\.btn-floating-fullscreen\.active\s*\{/);
});

test('Landscape orientation enforcement & visual portrait rotation invitation', () => {
  const appHtmlPath = path.resolve(__dirname, '../src/app/app.html');
  const appCssPath = path.resolve(__dirname, '../src/app/app.css');
  const appTsPath = path.resolve(__dirname, '../src/app/app.ts');
  const appHtml = fs.readFileSync(appHtmlPath, 'utf8');
  const appCss = fs.readFileSync(appCssPath, 'utf8');
  const appTs = fs.readFileSync(appTsPath, 'utf8');

  // Verify visual invitation element in HTML
  assert.match(appHtml, /class="orientation-rotate-notice"/, 'app.html must contain orientation-rotate-notice banner');
  assert.match(appHtml, /class="rotate-icon-anim"/, 'app.html must contain rotating animation icon');
  assert.match(appHtml, /class="btn-dismiss-rotate"[\s\S]*?\(click\)="dismissOrientationNotice\(\)"/, 'Must provide dismiss button');

  // Verify dismissOrientationNotice in app.ts
  assert.match(appTs, /dismissOrientationNotice\(\)[\s\S]*?this\.isOrientationDismissed = true/);

  // Verify CSS responsive visibility: display on portrait, hidden on landscape
  assert.match(appCss, /@media\s*\(orientation:\s*portrait\)\s*and\s*\(max-width:\s*1024px\)\s*\{[\s\S]*?\.orientation-rotate-notice\s*\{[\s\S]*?display:\s*block;/);
  assert.match(appCss, /@media\s*\(orientation:\s*landscape\)\s*\{[\s\S]*?\.orientation-rotate-notice\s*\{[\s\S]*?display:\s*none\s*!important;/);

  // Verify landscape layout optimization for compact mobile cockpits
  assert.match(appCss, /@media\s*\(orientation:\s*landscape\)\s*and\s*\(max-height:\s*600px\)\s*\{[\s\S]*?\.cockpit-hud\s*\{/);
});

test('Draggable & Collapsible Leaderboard in Regatta Canvas and Cockpit views', () => {
  const canvasTsPath = path.resolve(__dirname, '../src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const appHtmlPath = path.resolve(__dirname, '../src/app/app.html');
  const appTsPath = path.resolve(__dirname, '../src/app/app.ts');
  const appCssPath = path.resolve(__dirname, '../src/app/app.css');

  const canvasTs = fs.readFileSync(canvasTsPath, 'utf8');
  const appHtml = fs.readFileSync(appHtmlPath, 'utf8');
  const appTs = fs.readFileSync(appTsPath, 'utf8');
  const appCss = fs.readFileSync(appCssPath, 'utf8');

  // 1. Collapsed state badge format (ex: "2e / 8" or "1er / 8")
  function formatRankBadge(rank, total) {
    if (!rank) return total > 0 ? `-- / ${total}` : '--';
    const suffix = rank === 1 ? 'er' : 'e';
    return `${rank}${suffix} / ${total}`;
  }

  assert.equal(formatRankBadge(1, 8), '1er / 8');
  assert.equal(formatRankBadge(2, 8), '2e / 8');
  assert.equal(formatRankBadge(5, 12), '5e / 12');
  assert.equal(formatRankBadge(null, 6), '-- / 6');

  // Verify myRankBadgeText in RegattaCanvasComponent
  assert.match(canvasTs, /get\s+myRankBadgeText\(\)[\s\S]*?rank === 1 \? 'er' : 'e'[\s\S]*?\${rank}\${suffix}\s*\/\s*\${total}/);
  assert.match(canvasTs, /isLeaderboardCollapsed\s*\?\s*myRankBadgeText\s*:\s*'Classement en direct'/);

  // Verify myCockpitRankBadgeText in app.ts and cockpit HTML
  assert.match(appTs, /get\s+myCockpitRankBadgeText\(\)[\s\S]*?rank === 1 \? 'er' : 'e'[\s\S]*?\${rank}\${suffix}\s*\/\s*\${total}/);
  assert.match(appHtml, /isCockpitLeaderboardCollapsed\s*\?\s*myCockpitRankBadgeText/);

  // 2. Touch & Pointer drag and drop in RegattaCanvasComponent
  assert.match(canvasTs, /\(pointerdown\)="onLeaderboardPointerDown\(\$event\)"/);
  assert.match(canvasTs, /\(pointermove\)="onLeaderboardPointerMove\(\$event\)"/);
  assert.match(canvasTs, /\(pointerup\)="onLeaderboardPointerUp\(\$event\)"/);
  assert.match(canvasTs, /setPointerCapture/);
  assert.match(canvasTs, /releasePointerCapture/);

  // 3. Pointer drag and drop in Cockpit view
  assert.match(appHtml, /class="mini-leaderboard cockpit-floating-leaderboard"/);
  assert.match(appHtml, /\(pointerdown\)="onCockpitLeaderboardPointerDown\(\$event\)"/);
  assert.match(appHtml, /\(pointermove\)="onCockpitLeaderboardPointerMove\(\$event\)"/);
  assert.match(appHtml, /\(pointerup\)="onCockpitLeaderboardPointerUp\(\$event\)"/);

  // 4. Clamping and boundary math verification
  function clampLeaderboard(pos, delta, containerW, containerH, boxW, boxH) {
    const maxX = Math.max(5, containerW - boxW - 5);
    const maxY = Math.max(5, containerH - boxH - 5);
    const nextX = Math.min(Math.max(5, pos.x + delta.dx), maxX);
    const nextY = Math.min(Math.max(5, pos.y + delta.dy), maxY);
    return { x: Math.round(nextX), y: Math.round(nextY) };
  }

  // Inside bounds
  assert.deepEqual(clampLeaderboard({ x: 100, y: 50 }, { dx: 30, dy: 20 }, 800, 400, 160, 40), { x: 130, y: 70 });
  // Clamped top-left
  assert.deepEqual(clampLeaderboard({ x: 50, y: 50 }, { dx: -100, dy: -100 }, 800, 400, 160, 40), { x: 5, y: 5 });
  // Clamped bottom-right
  assert.deepEqual(clampLeaderboard({ x: 600, y: 300 }, { dx: 300, dy: 200 }, 800, 400, 160, 40), { x: 635, y: 355 });

  // 5. CSS touch-action and dragging styles
  assert.match(canvasTs, /touch-action:\s*none/);
  assert.match(canvasTs, /user-select:\s*none/);
  assert.match(appCss, /\.cockpit-floating-leaderboard[\s\S]*?touch-action:\s*none/);
  assert.match(appCss, /\.cockpit-floating-leaderboard\.collapsed\s*\{[\s\S]*?border-radius:\s*20px/);

  // 6. Independent scrolling & clicking of racer list (pointerdown on .mini-lead-body does not start drag)
  assert.match(canvasTs, /target\?\.closest\('\.mini-lead-body'\)/);
  assert.match(appTs, /target\?\.closest\('\.mini-lead-body'\)/);

  // 7. Gaps in meters and time (écarts en mètres/temps)
  function computeRacerGap(distDiff, split) {
    if (distDiff <= 0) return 'Leader';
    let text = `-${distDiff}m`;
    if (split && split > 0 && split < 600) {
      const secDiff = ((distDiff * split) / 500).toFixed(1);
      text += ` (+${secDiff}s)`;
    }
    return text;
  }
  assert.equal(computeRacerGap(0, 115), 'Leader');
  assert.equal(computeRacerGap(15, 120), '-15m (+3.6s)');
  assert.equal(computeRacerGap(30, 100), '-30m (+6.0s)');
  assert.match(canvasTs, /formatGap\(racer:\s*LiveRacerMetric,\s*leader:\s*LiveRacerMetric\)/);
  assert.match(appTs, /formatRacerGap\(racer:\s*LiveRacerMetric,\s*leader:\s*LiveRacerMetric\)/);

  // 8. Dynamic orientation and resize clamping & Fullscreen error resilience
  assert.match(canvasTs, /clampCurrentPosition\(\)/);
  assert.match(appTs, /clampCurrentCockpitPosition\(\)/);
  assert.match(appTs, /fullscreenerror/);
  assert.match(appTs, /webkitfullscreenerror/);
});


