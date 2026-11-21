import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAppHtmlBundle, readAppTsBundle } from './test-app-bundle.helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');

test('i18n.service: BTN_PRIVATE_ROOMS does not contain 🔒 lock emoji in any supported language', () => {
  const i18nTs = fs.readFileSync(path.join(frontendAppDir, 'services/i18n.service.ts'), 'utf8');

  // Match all BTN_PRIVATE_ROOMS entries
  const matches = [...i18nTs.matchAll(/'BTN_PRIVATE_ROOMS':\s*'([^']+)'/g)];
  assert.ok(matches.length >= 6, `Expected at least 6 translations for BTN_PRIVATE_ROOMS, got ${matches.length}`);

  for (const m of matches) {
    const val = m[1];
    assert.ok(!val.includes('🔒'), `BTN_PRIVATE_ROOMS must not contain padlock emoji, got "${val}"`);
  }

  // Check French exact text
  assert.match(i18nTs, /fr:\s*\{[\s\S]*?'BTN_PRIVATE_ROOMS':\s*'Salons Privés'/);
  assert.match(i18nTs, /en:\s*\{[\s\S]*?'BTN_PRIVATE_ROOMS':\s*'Private Rooms'/);
});

test('app-header: Single lock icon on left and compact badge on right with total pending private salons + duels', () => {
  const headerHtml = fs.readFileSync(
    path.join(frontendAppDir, 'components/app-header/app-header.component.html'),
    'utf8'
  );
  const headerTs = fs.readFileSync(
    path.join(frontendAppDir, 'components/app-header/app-header.component.ts'),
    'utf8'
  );

  // Button structure in HTML
  assert.match(headerHtml, /class="btn-hud btn-private"/);
  assert.match(headerHtml, /<span class="btn-icon">🔒<\/span>\s*\{\{\s*i18n\.t\('BTN_PRIVATE_ROOMS'\)\s*\}\}/);
  assert.match(headerHtml, /class="badge-pending"\s*\*ngIf="totalPendingPrivateAndDuelsCount\s*>\s*0"/);
  assert.match(headerHtml, /\{\{\s*totalPendingPrivateAndDuelsCount\s*\}\}/);
  assert.match(headerHtml, /\[title\]="privateRoomsAndDuelsTooltip"/);

  // Inputs & getters in TypeScript
  assert.match(headerTs, /@Input\(\)\s*totalPendingPrivateAndDuelsCount\s*=\s*0/);
  assert.match(headerTs, /@Input\(\)\s*pendingPrivateSalonsCount\s*=\s*0/);
  assert.match(headerTs, /@Input\(\)\s*pendingDuelsCount\s*=\s*0/);
  assert.match(headerTs, /get privateRoomsAndDuelsTooltip\(\):\s*string/);
});

test('app.ts and app.html: computes total pending count and passes to app-header under 600 lines limit', () => {
  const appHtml = readAppHtmlBundle();
  const appTs = readAppTsBundle();
  const rawAppHtml = fs.readFileSync(path.join(frontendAppDir, 'app.html'), 'utf8');

  // Verify app.html stays under 600 lines
  const lineCount = rawAppHtml.split('\n').length;
  assert.ok(lineCount < 600, `app.html must stay under 600 lines (current: ${lineCount})`);

  // Verify inputs passed to app-header in app.html
  assert.match(appHtml, /\[totalPendingPrivateAndDuelsCount\]="totalPendingPrivateAndDuelsCount"/);
  assert.match(appHtml, /\[pendingPrivateSalonsCount\]="pendingPrivateSalonsCount"/);
  assert.match(appHtml, /\[pendingDuelsCount\]="pendingDuelsCount"/);

  // Verify app.ts state and methods
  assert.match(appTs, /pendingPrivateSalonsCount\s*=\s*0/);
  assert.match(appTs, /pendingDuelsCount\s*=\s*0/);
  assert.match(appTs, /get totalPendingPrivateAndDuelsCount\(\):\s*number/);
  assert.match(appTs, /refreshPendingPrivateAndDuels\(\):\s*void/);
  assert.match(appTs, /this\.refreshPendingPrivateAndDuels\(\)/);
});
