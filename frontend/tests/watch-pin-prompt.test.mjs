import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');
const raceOverlaysDir = path.join(frontendAppDir, 'components/race-overlays');

test('1. race-overlays.component.ts declares isAwaitingWatchPin, activeRoomPin, and hasPlayerJoinedWaterLane inputs', () => {
  const compTs = fs.readFileSync(path.join(raceOverlaysDir, 'race-overlays.component.ts'), 'utf8');

  assert.match(
    compTs,
    /@Input\(\)\s*isAwaitingWatchPin\s*=\s*false/,
    'race-overlays must declare @Input() isAwaitingWatchPin'
  );
  assert.match(
    compTs,
    /@Input\(\)\s*activeRoomPin\s*=\s*['"]/,
    'race-overlays must declare @Input() activeRoomPin'
  );
  assert.match(
    compTs,
    /@Input\(\)\s*hasPlayerJoinedWaterLane\s*=\s*false/,
    'race-overlays must declare @Input() hasPlayerJoinedWaterLane'
  );
  assert.match(
    compTs,
    /shouldShowWatchPinInvitationOverlay/,
    'race-overlays must provide getter or logic for showing watch PIN prompt'
  );
});

test('2. race-overlays.component.html renders watch-pin-invitation-overlay with badge, large PIN digits, and instructions', () => {
  const compHtml = fs.readFileSync(path.join(raceOverlaysDir, 'race-overlays.component.html'), 'utf8');

  assert.match(
    compHtml,
    /class="[^"]*watch-pin-invitation-overlay[^"]*"/,
    'race-overlays template must include an element with class watch-pin-invitation-overlay'
  );
  assert.match(
    compHtml,
    /role=["']dialog["']/,
    'overlay must have role="dialog" for accessibility'
  );
  assert.match(
    compHtml,
    /OVERLAY_WATCH_PIN_BADGE/,
    'overlay must display OVERLAY_WATCH_PIN_BADGE'
  );
  assert.match(
    compHtml,
    /OVERLAY_WATCH_PIN_DESC/,
    'overlay must display OVERLAY_WATCH_PIN_DESC'
  );
  assert.match(
    compHtml,
    /font-mono/,
    'overlay must display PIN digits with font-mono class for large monospace display'
  );
});

test('3. app.html binds isAwaitingWatchPin, activeRoomPin, and hasPlayerJoinedWaterLane to <app-race-overlays>', () => {
  const appHtml = fs.readFileSync(path.join(frontendAppDir, 'app.html'), 'utf8');

  const startIdx = appHtml.indexOf('<app-race-overlays');
  assert.ok(startIdx >= 0, '<app-race-overlays> must be present in app.html');
  const endIdx = appHtml.indexOf('</app-race-overlays>', startIdx);
  const tagContent = appHtml.substring(startIdx, endIdx);

  assert.match(
    tagContent,
    /\[isAwaitingWatchPin\]="isAwaitingWatchPin"/,
    'app.html must bind [isAwaitingWatchPin]="isAwaitingWatchPin"'
  );
  assert.match(
    tagContent,
    /\[activeRoomPin\]="activeRoomPin"/,
    'app.html must bind [activeRoomPin]="activeRoomPin"'
  );
  assert.match(
    tagContent,
    /\[hasPlayerJoinedWaterLane\]="hasPlayerJoinedWaterLane"/,
    'app.html must bind [hasPlayerJoinedWaterLane]="hasPlayerJoinedWaterLane"'
  );
});

test('4. app.ts implements playDiscreteNotificationChime using Web AudioContext and triggers it on isAwaitingWatchPin', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  assert.match(
    appTs,
    /playDiscreteNotificationChime\s*\(\s*\)/,
    'app.ts must implement playDiscreteNotificationChime()'
  );
  assert.match(
    appTs,
    /AudioContext/,
    'playDiscreteNotificationChime must utilize Web AudioContext'
  );
  assert.match(
    appTs,
    /playDiscreteNotificationChime\(\)/,
    'app.ts must call playDiscreteNotificationChime when isAwaitingWatchPin is set'
  );
});

test('5. app.ts installKayakOnWaterLane sets isAwaitingWatchPin = false and triggers ready toast', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  const fnStartIndex = appTs.indexOf('installKayakOnWaterLane(');
  assert.ok(fnStartIndex > 0, 'installKayakOnWaterLane must exist');
  const fnEndIndex = appTs.indexOf('resetGarminPairing()', fnStartIndex);
  const fnBody = appTs.substring(fnStartIndex, fnEndIndex);

  assert.match(
    fnBody,
    /this\.isAwaitingWatchPin\s*=\s*false/,
    'installKayakOnWaterLane must set isAwaitingWatchPin to false'
  );
  assert.match(
    fnBody,
    /triggerFinishToast\([\s\S]*?Prêt pour le départ/i,
    'installKayakOnWaterLane must display ready toast with "Prêt pour le départ !"'
  );
});
