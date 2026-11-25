import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('AdminService: interface AdminPublicRaceSettings contains overtakeThresholdM and inactivityAbandonSec', () => {
  const adminServicePath = path.join(rootDir, 'src/app/services/admin.service.ts');
  const content = fs.readFileSync(adminServicePath, 'utf-8');

  assert.match(
    content,
    /overtakeThresholdM\??\s*:\s*number;/,
    'AdminPublicRaceSettings must declare overtakeThresholdM?: number'
  );
  assert.match(
    content,
    /inactivityAbandonSec\??\s*:\s*number;/,
    'AdminPublicRaceSettings must declare inactivityAbandonSec?: number'
  );
});

test('AdminDashboardComponent: includes form controls for race arbitrage and water change distance', () => {
  const htmlPath = path.join(rootDir, 'src/app/components/admin-dashboard/admin-dashboard.component.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  assert.match(
    htmlContent,
    /ADMIN_SECTION_ARBITRAGE/,
    'Admin dashboard template must include section header for course rules and arbitrage'
  );
  assert.match(
    htmlContent,
    /\[\(ngModel\)\]="publicSettings\.overtakeThresholdM"/,
    'Admin dashboard template must bind publicSettings.overtakeThresholdM'
  );
  assert.match(
    htmlContent,
    /\[\(ngModel\)\]="publicSettings\.inactivityAbandonSec"/,
    'Admin dashboard template must bind publicSettings.inactivityAbandonSec'
  );
});

test('RegattaCanvasComponent: accepts overtakeThresholdM and uses it in dynamic lane overtaking', () => {
  const canvasPath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const canvasContent = fs.readFileSync(canvasPath, 'utf-8');

  assert.match(
    canvasContent,
    /@Input\(\)\s+overtakeThresholdM\s*:\s*number\s*=\s*5;?/,
    'RegattaCanvasComponent must declare @Input() overtakeThresholdM: number = 5'
  );
  assert.match(
    canvasContent,
    /OVERTAKE_THRESHOLD_M\s*=\s*Math\.max\(1,\s*this\.overtakeThresholdM/,
    'updateDynamicLanes must dynamically use this.overtakeThresholdM'
  );
});

test('RegattaViewComponent & App: pass overtakeThresholdM to RegattaCanvasComponent', () => {
  const regattaViewHtmlPath = path.join(rootDir, 'src/app/components/regatta-view/regatta-view.component.html');
  const regattaViewHtml = fs.readFileSync(regattaViewHtmlPath, 'utf-8');

  assert.match(
    regattaViewHtml,
    /\[overtakeThresholdM\]="[^"]+"/,
    'regatta-view.component.html must pass [overtakeThresholdM] to app-regatta-canvas'
  );
});

test('I18n: all 6 locales contain the new admin keys for arbitrage rules', () => {
  const locales = ['fr', 'en', 'de', 'es', 'it', 'pt'];
  const requiredKeys = [
    'ADMIN_SECTION_ARBITRAGE',
    'ADMIN_OVERTAKE_THRESHOLD_LABEL',
    'ADMIN_OVERTAKE_THRESHOLD_DESC',
    'ADMIN_INACTIVITY_ABANDON_LABEL',
    'ADMIN_INACTIVITY_ABANDON_DESC',
  ];

  for (const loc of locales) {
    const locPath = path.join(rootDir, `src/app/i18n/locales/${loc}.ts`);
    const locContent = fs.readFileSync(locPath, 'utf-8');
    for (const key of requiredKeys) {
      assert.ok(
        locContent.includes(`'${key}'`) || locContent.includes(`"${key}"`),
        `Locale ${loc} must contain key ${key}`
      );
    }
  }
});
