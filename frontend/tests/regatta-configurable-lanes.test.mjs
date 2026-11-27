import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Task 1: Frontend and Backend models declare configurable lane metrics and preferences', () => {
  const userModelPath = path.join(rootDir, 'src/app/models/user.model.ts');
  const userModelContent = fs.readFileSync(userModelPath, 'utf-8');

  // 1. RegattaMetricKey must include 'chrono', 'spm', and 'none'
  assert.match(userModelContent, /'chrono'/, "RegattaMetricKey must include 'chrono'");
  assert.match(userModelContent, /'spm'/, "RegattaMetricKey must include 'spm'");
  assert.match(userModelContent, /'none'/, "RegattaMetricKey must include 'none'");

  // 2. LaneDataPosition type
  assert.match(
    userModelContent,
    /type\s+LaneDataPosition\s*=\s*'auto'\s*\|\s*'front'\s*\|\s*'back'/,
    "LaneDataPosition must be defined as 'auto' | 'front' | 'back'"
  );

  // 3. RegattaPreferences must include lane configuration fields
  assert.match(userModelContent, /myLaneMetrics\s*:\s*\[\s*RegattaMetricKey\s*,\s*RegattaMetricKey\s*\]/);
  assert.match(userModelContent, /myLanePosition\s*:\s*LaneDataPosition/);
  assert.match(userModelContent, /myHeaderMetric\s*:\s*RegattaMetricKey/);
  assert.match(userModelContent, /opponentLaneMetrics\s*:\s*\[\s*RegattaMetricKey\s*,\s*RegattaMetricKey\s*\]/);
  assert.match(userModelContent, /opponentLanePosition\s*:\s*LaneDataPosition/);
  assert.match(userModelContent, /opponentHeaderMetric\s*:\s*RegattaMetricKey/);
  assert.match(userModelContent, /watermarkMetric\s*:\s*RegattaMetricKey/);

  // 4. REGATTA_METRICS_CATALOG has chrono and spm
  assert.match(userModelContent, /key:\s*'chrono'/);
  assert.match(userModelContent, /key:\s*'spm'/);

  // 5. Backend user.model.ts and user.controller.ts must mirror these fields
  const backendModelPath = path.join(rootDir, '../backend/src/models/user.model.ts');
  const backendModelContent = fs.readFileSync(backendModelPath, 'utf-8');
  assert.match(backendModelContent, /'chrono'/);
  assert.match(backendModelContent, /myLaneMetrics/);
  assert.match(backendModelContent, /watermarkMetric/);

  const backendControllerPath = path.join(rootDir, '../backend/src/controllers/user.controller.ts');
  const backendControllerContent = fs.readFileSync(backendControllerPath, 'utf-8');
  assert.match(backendControllerContent, /myLaneMetrics/);
  assert.match(backendControllerContent, /watermarkMetric/);
});

test('Task 2: RegattaCanvasComponent defines 5m overtake threshold, regattaPreferences input, and formatMetricValue', () => {
  const canvasPath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const canvasContent = fs.readFileSync(canvasPath, 'utf-8');

  // 1. Overtake threshold must be 5 (not 10)
  assert.match(
    canvasContent,
    /OVERTAKE_THRESHOLD_M\s*=\s*5;/,
    'OVERTAKE_THRESHOLD_M must be 5m'
  );

  // 2. regattaPreferences input
  assert.match(
    canvasContent,
    /@Input\(\)\s*regattaPreferences\?:\s*RegattaPreferences/,
    'RegattaCanvasComponent must declare @Input() regattaPreferences?: RegattaPreferences'
  );

  // 3. formatMetricValue method
  assert.match(
    canvasContent,
    /formatMetricValue\s*\(/,
    'RegattaCanvasComponent must implement formatMetricValue(key, boat)'
  );
});

test('Task 3: RegattaCanvasComponent renders giant watermark in player water lane', () => {
  const canvasPath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const canvasContent = fs.readFileSync(canvasPath, 'utf-8');

  // Must check watermarkMetric and draw at center of screen width
  assert.match(canvasContent, /watermarkMetric/);
  assert.match(canvasContent, /w\s*\*\s*0\.5/);
});

test('Task 4: Adaptive VOUS banner defaults to front in water lane and configurable lane data badges with auto-flip', () => {
  const canvasPath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const canvasContent = fs.readFileSync(canvasPath, 'utf-8');

  // Default resolvedNamePos in auto mode is 'front' (in front of the kayak in the water lane)
  assert.match(canvasContent, /let\s+resolvedNamePos\s*:\s*'above'\s*\|\s*'below'\s*\|\s*'front'\s*\|\s*'back'\s*\|\s*'none'\s*=\s*'front'/);

  // Lane 1 / index 0 banner below detection when 'above' is chosen
  assert.match(canvasContent, /effectiveLaneIdx\s*===\s*0|topOffset/);

  // Header metric display for player and opponents
  assert.match(canvasContent, /myHeaderMetric/);
  assert.match(canvasContent, /opponentHeaderMetric/);

  // Lane metrics display
  assert.match(canvasContent, /myLaneMetrics/);
  assert.match(canvasContent, /opponentLaneMetrics/);
});

test('Task 5: AccountModalComponent and RegattaViewComponent wire lane configuration and i18n keys exist across all 6 languages', () => {
  const accountHtmlPath = path.join(rootDir, 'src/app/components/modals/account-modal/account-modal.component.html');
  const accountHtmlContent = fs.readFileSync(accountHtmlPath, 'utf-8');

  assert.match(accountHtmlContent, /ACCOUNT_REGATTA_LANES_SECTION_TITLE/);
  assert.match(accountHtmlContent, /ACCOUNT_REGATTA_MY_LANE_TITLE/);
  assert.match(accountHtmlContent, /ACCOUNT_REGATTA_OPPONENTS_SECTION_TITLE/);
  assert.match(accountHtmlContent, /ACCOUNT_REGATTA_WATERMARK_TITLE/);
  assert.match(accountHtmlContent, /setMyLaneMetric/);
  assert.match(accountHtmlContent, /setOpponentLaneMetric/);
  assert.match(accountHtmlContent, /setWatermarkMetric/);

  // Check regatta-view bindings
  const regattaViewHtmlPath = path.join(rootDir, 'src/app/components/regatta-view/regatta-view.component.html');
  const regattaViewHtmlContent = fs.readFileSync(regattaViewHtmlPath, 'utf-8');
  assert.match(regattaViewHtmlContent, /\[regattaPreferences\]="regattaPreferences"/);

  // Check 100% key parity for new keys across all 6 languages
  const locales = ['fr', 'en', 'de', 'es', 'it', 'pt'];
  const expectedKeys = [
    'REGATTA_METRIC_NAME_CHRONO',
    'REGATTA_METRIC_NAME_SPM',
    'REGATTA_METRIC_NAME_NONE',
    'ACCOUNT_REGATTA_LANES_SECTION_TITLE',
    'ACCOUNT_REGATTA_MY_LANE_TITLE',
    'ACCOUNT_REGATTA_MY_LANE_DATA1',
    'ACCOUNT_REGATTA_MY_LANE_DATA2',
    'ACCOUNT_REGATTA_POS_LABEL',
    'ACCOUNT_REGATTA_POS_AUTO',
    'ACCOUNT_REGATTA_POS_FRONT',
    'ACCOUNT_REGATTA_POS_BACK',
    'ACCOUNT_REGATTA_MY_HEADER_METRIC',
    'ACCOUNT_REGATTA_OPPONENTS_SECTION_TITLE',
    'ACCOUNT_REGATTA_OPPONENTS_DATA1',
    'ACCOUNT_REGATTA_OPPONENTS_DATA2',
    'ACCOUNT_REGATTA_OPPONENTS_POS_LABEL',
    'ACCOUNT_REGATTA_OPPONENTS_HEADER_METRIC',
    'ACCOUNT_REGATTA_WATERMARK_TITLE',
    'ACCOUNT_REGATTA_WATERMARK_DESC',
    'ACCOUNT_REGATTA_WATERMARK_METRIC',
  ];

  for (const lang of locales) {
    const locPath = path.join(rootDir, `src/app/i18n/locales/${lang}.ts`);
    const content = fs.readFileSync(locPath, 'utf-8');
    for (const key of expectedKeys) {
      assert.ok(content.includes(`'${key}':`), `Language '${lang}' must include key '${key}'`);
    }
  }
});
