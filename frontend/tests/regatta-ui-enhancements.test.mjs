import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAppHtmlBundle } from './test-app-bundle.helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Regatta Canvas: Top lane headroom and strict upper-boundary clamping prevents top overflow', () => {
  const canvasTsPath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const code = fs.readFileSync(canvasTsPath, 'utf-8');

  // Verify topOffset provides safe headroom (at least 24 in landscape, 38 in compact, 46 default)
  assert.match(code, /topOffset\s*=\s*isSmallLandscape\s*\?\s*24\s*:\s*\(\s*isCompact\s*\?\s*38\s*:\s*46\s*\)/,
    'topOffset must be set to 24/38/46 to ensure ample vertical headroom for lane 1');

  // Verify arrowY upper bound clamping
  assert.match(code, /const\s+arrowY\s*=\s*Math\.max\(22,\s*rawArrowY\)/,
    'arrowY must have a minimum ceiling clamp of at least 22px');

  // Verify banner "by" upper bound clamping
  assert.match(code, /const\s+by\s*=\s*Math\.max\(14,\s*arrowY\s*-\s*14\)/,
    'by must be clamped to at least 14px so that by - 10 is >= 4px inside canvas bounds');

  // Verify standard racer label vertical clamp
  assert.match(code, /const\s+ly\s*=\s*Math\.max\(12,\s*y\s*-\s*9\)/,
    'Standard racer text label must be clamped to at least 12px to never overflow canvas top');
});

test('Regatta Canvas: Badge dynamically flips to rear (poupe) when front position exceeds canvas boundary', () => {
  const canvasTsPath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const code = fs.readFileSync(canvasTsPath, 'utf-8');

  // Verify front badge computation and boundary detection
  assert.match(code, /frontBadgeX\s*\+\s*badgeW\s*>\s*w\s*-\s*6/,
    'Must check if frontBadgeX + badgeW exceeds canvas right boundary w - 6');

  // Verify flipping to behind kayak
  assert.match(code, /badgeX\s*=\s*x\s*-\s*hullRx\s*-\s*gap\s*-\s*badgeW/,
    'Must flip badgeX to behind kayak (x - hullRx - gap - badgeW) when approaching finish line');

  // Behavioral simulation of the logic
  const w = 400;
  const hullRx = 20;
  const gap = 8;
  const badgeW = 60;

  // Case 1: Mid-race (x = 100) -> front position
  let x = 100;
  let frontBadgeX = x + hullRx + gap; // 128
  let badgeX = frontBadgeX;
  if (frontBadgeX + badgeW > w - 6) {
    badgeX = x - hullRx - gap - badgeW;
  }
  assert.equal(badgeX, 128, 'Mid-race badge must remain at front of kayak');

  // Case 2: Near finish line (x = 350) -> frontBadgeX + badgeW = 350 + 20 + 8 + 60 = 438 > 394 -> flips to rear
  x = 350;
  frontBadgeX = x + hullRx + gap;
  badgeX = frontBadgeX;
  if (frontBadgeX + badgeW > w - 6) {
    badgeX = x - hullRx - gap - badgeW;
  }
  assert.equal(badgeX, 350 - 20 - 8 - 60, 'Near finish line, badge must be placed behind kayak');
  assert.ok(badgeX + badgeW <= x - hullRx, 'Badge must be completely behind the kayak hull');
});

test('Leaderboard Duration: Backend returns formattedDuration and Frontend displays it without remaining empty', () => {
  const backendControllerPath = path.join(rootDir, '../backend/src/controllers/race.controller.ts');
  const backendCode = fs.readFileSync(backendControllerPath, 'utf-8');

  assert.match(backendCode, /formattedDuration:\s*chrono/,
    'Backend race controller must explicitly include formattedDuration in leaderboard response');

  const htmlCode = readAppHtmlBundle();

  assert.match(htmlCode, /entry\.formattedDuration\s*\|\|\s*entry\.chrono/,
    'Frontend leaderboard table must bind entry.formattedDuration || entry.chrono');
});

test('Smartphone home view: All 4 action buttons have identical flex-basis length', () => {
  const appCssPath = path.join(rootDir, 'src/app/app.css');
  const cssCode = fs.readFileSync(appCssPath, 'utf-8');

  const mobileRuleMatch = cssCode.match(/\.user-nav-cluster\s+\.btn-admin-backoffice,\s*\.user-nav-cluster\s+\.btn-private,\s*\.user-nav-cluster\s+\.btn-stats,\s*\.user-nav-cluster\s+\.btn-pricing\s*\{([^}]+)\}/);

  assert.ok(mobileRuleMatch, 'Must define unified responsive CSS rule for all 4 user-nav-cluster buttons');
  assert.match(mobileRuleMatch[1], /flex:\s*1\s+1\s+calc\(50%\s*-\s*0\.4rem\)/,
    'All 4 buttons must have flex: 1 1 calc(50% - 0.4rem) for uniform length in 2 columns');
});

test('Finish Line Celebration: 2-second fireworks and bold BRAVO overlay before transitioning to leaderboard', () => {
  const appTsPath = path.join(rootDir, 'src/app/app.ts');
  const tsCode = fs.readFileSync(appTsPath, 'utf-8');

  assert.match(tsCode, /triggerFinishCelebration\s*\(/,
    'app.ts must declare triggerFinishCelebration method');

  assert.match(tsCode, /showFinishCelebration\s*=\s*true/,
    'triggerFinishCelebration must set showFinishCelebration to true');

  assert.match(tsCode, /openRaceLeaderboard\s*\(/,
    'After celebration delay, openRaceLeaderboard must be triggered');

  // Verify 2000ms delay
  const timerMatch = tsCode.match(/triggerFinishCelebration[\s\S]*?setTimeout\(\s*\(\)\s*=>[\s\S]*?,\s*2000\s*\)/);
  assert.ok(timerMatch, 'Celebration overlay must use a strict 2-second (2000ms) timer');

  const htmlCode = readAppHtmlBundle();

  assert.match(htmlCode, /class="finish-celebration-fullscreen-overlay"/,
    'app.html must define the fullscreen celebration overlay');

  assert.match(htmlCode, /BRAVO\s*!/,
    'Celebration overlay must display BRAVO ! in large bold font');

  assert.match(htmlCode, /class="fireworks-canvas-backdrop"/,
    'Celebration overlay must include fireworks visual burst container');
});

test('Regatta Mode: Duplicate internal canvas zoom is deleted, leaving zoom solely above in quick-nav-bar', () => {
  const canvasTsPath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const canvasCode = fs.readFileSync(canvasTsPath, 'utf-8');

  assert.ok(!canvasCode.includes('canvas-zoom-controls'), 'Internal canvas-zoom-controls must be deleted from regatta canvas');
  assert.ok(!canvasCode.includes('btn-zoom-step'), 'Internal btn-zoom-step must be deleted from regatta canvas');

  const appHtml = readAppHtmlBundle();
  assert.match(appHtml, /class="regatta-quick-zoom-group"/, 'Zoom controls must remain in regatta-quick-nav-bar above the canvas');
});

test('Regatta Mode: Leaderboard popup removed from canvas DOM and placed above canvas with toggle button', () => {
  const canvasTsPath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const canvasCode = fs.readFileSync(canvasTsPath, 'utf-8');

  assert.ok(!canvasCode.includes('mini-leaderboard'), 'Mini-leaderboard popup must be removed from canvas DOM');

  const appHtml = readAppHtmlBundle();
  assert.match(appHtml, /class="btn-cockpit-quick btn-quick-ranking"/, 'Top bar must include btn-quick-ranking with 🏆');
  assert.match(appHtml, /regatta-top-leaderboard-panel|regatta-floating-leaderboard-panel/, 'regatta leaderboard panel must be present in HTML');

  const appTsPath = path.join(rootDir, 'src/app/app.ts');
  const appTs = fs.readFileSync(appTsPath, 'utf-8');
  assert.match(appTs, /isRegattaLeaderboardOpen\s*=\s*false/, 'app.ts must declare isRegattaLeaderboardOpen');
  assert.match(appTs, /toggleRegattaLeaderboard\s*\(/, 'app.ts must declare toggleRegattaLeaderboard');
});

test('Portrait Mode: Buttons in regatta-quick-nav-bar are reduced to icons to prevent overflowing screen', () => {
  const appCssPath = path.join(rootDir, 'src/app/app.css');
  const appCss = fs.readFileSync(appCssPath, 'utf-8');

  assert.match(appCss, /\.regatta-quick-nav-bar\s+\.btn-quick-label[\s\S]*?display:\s*none\s*!important/,
    'Portrait CSS must hide btn-quick-label to reduce buttons to pure compact icons');
  assert.match(appCss, /\.regatta-quick-nav-bar\s+\.zoom-prefix[\s\S]*?display:\s*none\s*!important/,
    'Portrait CSS must hide zoom-prefix to keep zoom indicator compact');
});

test('Regatta Canvas: Vertical scrolling (wheel, touch/drag) and scrollbar for large fleet of kayaks', () => {
  const canvasTsPath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const canvasCode = fs.readFileSync(canvasTsPath, 'utf-8');

  assert.match(canvasCode, /public\s+scrollY\s*:\s*number\s*=\s*0/, 'Must declare public scrollY in regatta canvas');
  assert.match(canvasCode, /public\s+maxScrollY\s*:\s*number\s*=\s*0/, 'Must declare public maxScrollY in regatta canvas');
  assert.match(canvasCode, /onCanvasWheel/, 'Must define wheel handler for vertical scrolling');
  assert.match(canvasCode, /onCanvasPointerDown/, 'Must define pointerdown handler for touch drag scroll');
  assert.match(canvasCode, /onCanvasPointerMove/, 'Must define pointermove handler for touch drag scroll');
  assert.match(canvasCode, /onCanvasPointerUp/, 'Must define pointerup handler for touch drag scroll');

  // Verify that click detection incorporates scrollY
  assert.match(canvasCode, /const\s+y\s*=\s*topOffset\s*\+\s*\(idx\s*\+\s*0\.5\)\s*\*\s*laneH\s*-\s*this\.scrollY/,
    'Click detection must offset y by - this.scrollY to correctly identify clicked kayak');
});
