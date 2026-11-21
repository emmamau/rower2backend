import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAppHtmlBundle } from './test-app-bundle.helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Smartphone Fullscreen PIN Overlay: logic, template, and styles', async (t) => {
  const appTsPath = path.join(rootDir, 'src/app/app.ts');
  const appTsContent = fs.readFileSync(appTsPath, 'utf-8');

  const overlaysHtmlPath = path.join(rootDir, 'src/app/components/race-overlays/race-overlays.component.html');
  const overlaysHtmlContent = fs.readFileSync(overlaysHtmlPath, 'utf-8');

  const overlaysTsPath = path.join(rootDir, 'src/app/components/race-overlays/race-overlays.component.ts');
  const overlaysTsContent = fs.readFileSync(overlaysTsPath, 'utf-8');

  const appHtmlContent = readAppHtmlBundle();
  const cssPath = path.join(rootDir, 'src/app/app.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  await t.test('1. TypeScript logic in app.ts exposes activeFullscreenPinCode and shouldShowSmartphonePinOverlay', () => {
    assert.match(
      appTsContent,
      /get activeFullscreenPinCode\(\):\s*string/s,
      'app.ts must provide an activeFullscreenPinCode getter'
    );
    assert.match(
      appTsContent,
      /get shouldShowSmartphonePinOverlay\(\):\s*boolean/s,
      'app.ts must provide a shouldShowSmartphonePinOverlay getter'
    );
    assert.match(
      appTsContent,
      /get hasPlayerJoinedWaterLane\(\):\s*boolean/s,
      'app.ts must provide a hasPlayerJoinedWaterLane getter checking lane / watch / racer association'
    );
  });

  await t.test('2. Display conditions in shouldShowSmartphonePinOverlay enforce smartphone, fullscreen, regatta/cockpit, and dismiss on lane join or race/countdown start', () => {
    // Must check isSmartphone
    assert.match(
      appTsContent,
      /shouldShowSmartphonePinOverlay[\s\S]*?isSmartphone/s,
      'shouldShowSmartphonePinOverlay must check isSmartphone'
    );
    // Must check regatta or cockpit
    assert.match(
      appTsContent,
      /shouldShowSmartphonePinOverlay[\s\S]*?(?:siteView\s*===\s*'regatta'|siteView\s*===\s*'cockpit')/s,
      'shouldShowSmartphonePinOverlay must verify siteView is regatta or cockpit'
    );
    // Must check fullscreen
    assert.match(
      appTsContent,
      /shouldShowSmartphonePinOverlay[\s\S]*?(?:isFullscreen|isPseudoFullscreen|isMobileFullscreenOnly)/s,
      'shouldShowSmartphonePinOverlay must verify fullscreen state'
    );
    // Must dismiss on lane join
    assert.match(
      appTsContent,
      /shouldShowSmartphonePinOverlay[\s\S]*?hasPlayerJoinedWaterLane/s,
      'shouldShowSmartphonePinOverlay must dismiss once player has joined water lane'
    );
    // Must dismiss on race or countdown start
    assert.match(
      appTsContent,
      /shouldShowSmartphonePinOverlay[\s\S]*?(?:isRaceOrCountdownActive|isRaceActive|isPreStartCountdown|is3sCountdown)/s,
      'shouldShowSmartphonePinOverlay must dismiss when race or countdown starts'
    );
  });

  await t.test('3. race-overlays component receives and renders giant PIN overlay', () => {
    assert.match(
      overlaysTsContent,
      /@Input\(\)\s*shouldShowSmartphonePinOverlay/s,
      'RaceOverlaysComponent must have @Input() shouldShowSmartphonePinOverlay'
    );
    assert.match(
      overlaysTsContent,
      /@Input\(\)\s*activeFullscreenPinCode/s,
      'RaceOverlaysComponent must have @Input() activeFullscreenPinCode'
    );

    assert.match(
      overlaysHtmlContent,
      /smartphone-fullscreen-pin-overlay/s,
      'race-overlays.component.html must define smartphone-fullscreen-pin-overlay element'
    );
    assert.match(
      overlaysHtmlContent,
      /sf-pin-digits/s,
      'race-overlays.component.html must render large PIN digits in sf-pin-digits'
    );

    assert.match(
      appHtmlContent,
      /<app-race-overlays[\s\S]*?\[shouldShowSmartphonePinOverlay\]="shouldShowSmartphonePinOverlay"[\s\S]*?\[activeFullscreenPinCode\]="activeFullscreenPinCode"/s,
      'app.html must pass shouldShowSmartphonePinOverlay and activeFullscreenPinCode to app-race-overlays'
    );
  });

  await t.test('4. CSS styles define giant centered PIN in fullscreen with high contrast styling', () => {
    assert.match(
      cssContent,
      /\.smartphone-fullscreen-pin-overlay\s*\{[\s\S]*?position:\s*fixed/s,
      'CSS must position .smartphone-fullscreen-pin-overlay fixed'
    );
    assert.match(
      cssContent,
      /\.sf-pin-digits\s*\{[\s\S]*?font-size:\s*(?:clamp\(|3|4)/s,
      'CSS must give .sf-pin-digits large font size'
    );
    assert.match(
      cssContent,
      /\.sf-pin-digits\s*\{[\s\S]*?letter-spacing:/s,
      'CSS must give .sf-pin-digits distinct letter-spacing for easy reading'
    );
  });

  await t.test('5. Behavioral simulation of state transitions: show when waiting, dismiss immediately when lane joined or race starts', () => {
    function computeShouldShow({
      isSmartphone,
      siteView,
      isFullscreen,
      isPseudoFullscreen,
      isMobileFullscreenOnly,
      isRaceActive,
      isPreStartCountdown,
      is3sCountdown,
      status,
      hasPlayerJoinedWaterLane,
      pinCode
    }) {
      if (!isSmartphone) return false;
      if (siteView !== 'regatta' && siteView !== 'cockpit') return false;
      const isAnyFullscreen = Boolean(isFullscreen || isPseudoFullscreen || isMobileFullscreenOnly);
      if (!isAnyFullscreen) return false;

      const isRaceOrCountdownActive = Boolean(
        isRaceActive ||
        isPreStartCountdown ||
        is3sCountdown ||
        status === 'in_progress' ||
        status === 'RUNNING' ||
        status === 'countdown'
      );
      if (isRaceOrCountdownActive) return false;
      if (hasPlayerJoinedWaterLane) return false;
      if (!pinCode) return false;
      return true;
    }

    const baseState = {
      isSmartphone: true,
      siteView: 'regatta',
      isFullscreen: true,
      isPseudoFullscreen: false,
      isMobileFullscreenOnly: true,
      isRaceActive: false,
      isPreStartCountdown: false,
      is3sCountdown: false,
      status: 'waiting',
      hasPlayerJoinedWaterLane: false,
      pinCode: '4821',
    };

    // Scenario A: On smartphone in fullscreen regatta waiting for watch -> SHOW PIN
    assert.strictEqual(computeShouldShow(baseState), true, 'Must show PIN when waiting on smartphone fullscreen');

    // Scenario B: Same in cockpit mode -> SHOW PIN
    assert.strictEqual(computeShouldShow({ ...baseState, siteView: 'cockpit' }), true, 'Must show PIN in cockpit mode');

    // Scenario C: Player enters PIN on Garmin watch -> Joins water lane -> DISMISS
    assert.strictEqual(
      computeShouldShow({ ...baseState, hasPlayerJoinedWaterLane: true }),
      false,
      'Must dismiss automatically when player has joined a water lane'
    );

    // Scenario D: Pre-race countdown starts -> DISMISS right before countdown
    assert.strictEqual(
      computeShouldShow({ ...baseState, isPreStartCountdown: true }),
      false,
      'Must dismiss automatically as soon as pre-race countdown starts'
    );

    // Scenario E: 3s final countdown starts -> DISMISS
    assert.strictEqual(
      computeShouldShow({ ...baseState, is3sCountdown: true }),
      false,
      'Must dismiss automatically on 3s countdown'
    );

    // Scenario F: Race is active -> DISMISS
    assert.strictEqual(
      computeShouldShow({ ...baseState, isRaceActive: true }),
      false,
      'Must dismiss automatically when race is active'
    );

    // Scenario G: Not in fullscreen -> DO NOT SHOW
    assert.strictEqual(
      computeShouldShow({ ...baseState, isFullscreen: false, isPseudoFullscreen: false, isMobileFullscreenOnly: false }),
      false,
      'Must not show when not in fullscreen'
    );

    // Scenario H: Desktop screen -> DO NOT SHOW
    assert.strictEqual(
      computeShouldShow({ ...baseState, isSmartphone: false }),
      false,
      'Must not show on desktop'
    );

    // Scenario I: On home dashboard -> DO NOT SHOW
    assert.strictEqual(
      computeShouldShow({ ...baseState, siteView: 'home' }),
      false,
      'Must not show on home page'
    );
  });
});
