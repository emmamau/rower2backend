import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilTsPath = path.resolve(__dirname, '../src/app/utils/room-link.util.ts');
const appHtmlPath = path.resolve(__dirname, '../src/app/app.html');
const appCssPath = path.resolve(__dirname, '../src/app/app.css');

function loadTranspiledRoomLinkUtil() {
  const source = fs.readFileSync(utilTsPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true
    }
  });
  const moduleObj = { exports: {} };
  const fn = new vm.Script(
    `(function(exports, module) { ${transpiled.outputText} })`,
    { filename: 'room-link.util.js' }
  ).runInThisContext();
  fn(moduleObj.exports, moduleObj);
  return moduleObj.exports;
}

const {
  buildRegattaLaunchUrl,
  withRegattaMode,
  isRegattaModeRequested,
  extractRoomFromLocation
} = loadTranspiledRoomLinkUtil();

test('1. Room link utility builds launch URL with ?mode=regatta and detects it in search params', () => {
  const url = buildRegattaLaunchUrl('https://rowerrace.com', 'abc-def-ghi');
  assert.equal(url, 'https://rowerrace.com/r/abc-def-ghi?mode=regatta');

  const withMode = withRegattaMode('https://rowerrace.com/r/krm-wzx-qpl');
  assert.equal(withMode, 'https://rowerrace.com/r/krm-wzx-qpl?mode=regatta');

  assert.equal(isRegattaModeRequested('?mode=regatta'), true);
  assert.equal(isRegattaModeRequested('?code=krm-wzx-qpl&mode=regatta'), true);
  assert.equal(isRegattaModeRequested('?mode=other'), false);
  assert.equal(isRegattaModeRequested(''), false);
});

test('2. HTML template contains the Regatta Launch Splash overlay with logo and action button', () => {
  const html = fs.readFileSync(appHtmlPath, 'utf8');
  assert.ok(html.includes('regatta-launch-overlay'), 'Le template doit comporter la classe regatta-launch-overlay');
  assert.ok(html.includes('isRegattaLaunchSplashOpen'), 'L\'overlay doit être conditionné par isRegattaLaunchSplashOpen');
  assert.ok(html.includes('regatta-launch-svg'), 'L\'overlay doit contenir le logo SVG du site');
  assert.ok(html.includes('btn-regatta-launch-action'), 'Le bouton principal doit être présent');
  assert.ok(html.includes('launchRegattaFromSplash()'), 'Le bouton doit appeler launchRegattaFromSplash()');
  assert.ok(html.includes('dismissRegattaLaunchSplash()'), 'Le bouton secondaire doit appeler dismissRegattaLaunchSplash()');
});

test('3. CSS contains branding colors and animations for the Regatta Launch Splash', () => {
  const css = fs.readFileSync(appCssPath, 'utf8');
  assert.ok(css.includes('.regatta-launch-overlay'), 'Le CSS doit définir .regatta-launch-overlay');
  assert.ok(css.includes('#00f0ff'), 'Le CSS doit intégrer le cyan néon (#00f0ff)');
  assert.ok(css.includes('#ff0055'), 'Le CSS doit intégrer le rose fuchsia (#ff0055)');
  assert.ok(css.includes('.btn-regatta-launch-action'), 'Le bouton de lancement doit être stylisé');
});

test('4. Regatta Launch State Machine: ?mode=regatta sets regatta view and opens splash', async () => {
  let fullscreenCalled = false;
  let orientationLockCalled = false;
  let lockedOrientation = null;

  // Simulate component state machine
  class MockAppComponent {
    siteView = 'home';
    isRegattaLaunchSplashOpen = false;
    pendingRegattaLaunch = false;
    isFullscreen = false;

    checkIsFullscreen() {
      return this.isFullscreen;
    }

    setSiteView(view) {
      this.siteView = view;
    }

    async enterFullscreen() {
      fullscreenCalled = true;
      this.isFullscreen = true;
      if (this.siteView === 'regatta') {
        await this.lockLandscape();
      }
    }

    async lockLandscape() {
      orientationLockCalled = true;
      lockedOrientation = 'landscape';
    }

    resolveRoomFromCurrentUrl(pathname, search) {
      const extracted = extractRoomFromLocation(pathname, search);
      const isRegattaRequested = isRegattaModeRequested(search);
      if (isRegattaRequested) {
        this.pendingRegattaLaunch = true;
      }
      return { extracted, isRegattaRequested };
    }

    activatePrivateRoom(room) {
      if (this.pendingRegattaLaunch) {
        this.pendingRegattaLaunch = false;
        this.setSiteView('regatta');
        if (!this.checkIsFullscreen()) {
          this.isRegattaLaunchSplashOpen = true;
        }
        this.enterFullscreen().catch(() => {});
      }
    }

    async launchRegattaFromSplash() {
      this.isRegattaLaunchSplashOpen = false;
      this.setSiteView('regatta');
      await this.enterFullscreen();
      await this.lockLandscape();
    }

    dismissRegattaLaunchSplash() {
      this.isRegattaLaunchSplashOpen = false;
      this.setSiteView('regatta');
    }
  }

  const comp = new MockAppComponent();
  assert.equal(comp.siteView, 'home');
  assert.equal(comp.isRegattaLaunchSplashOpen, false);

  // Step 1: User navigates from email with /r/abc-def-ghi?mode=regatta
  const res = comp.resolveRoomFromCurrentUrl('/r/abc-def-ghi', '?mode=regatta');
  assert.equal(res.isRegattaRequested, true);
  assert.equal(comp.pendingRegattaLaunch, true);

  // Step 2: Room is loaded and activated
  comp.activatePrivateRoom({ code: 'abc-def-ghi', race: { id: 'r1', title: 'Régate 2000m' } });
  assert.equal(comp.siteView, 'regatta', 'La vue doit être passée en mode régate');
  assert.equal(comp.pendingRegattaLaunch, false);
  assert.equal(comp.isRegattaLaunchSplashOpen, true, 'L\'écran d\'accueil doit s\'ouvrir pour le geste utilisateur');

  // Step 3: User taps the big CTA button on screen
  await comp.launchRegattaFromSplash();
  assert.equal(comp.isRegattaLaunchSplashOpen, false, 'Le splash doit être fermé');
  assert.equal(comp.siteView, 'regatta', 'La vue reste bien en mode régate');
  assert.equal(fullscreenCalled, true, 'Le plein écran doit avoir été demandé');
  assert.equal(orientationLockCalled, true, 'Le verrouillage en paysage doit avoir été appelé');
  assert.equal(lockedOrientation, 'landscape');
});
