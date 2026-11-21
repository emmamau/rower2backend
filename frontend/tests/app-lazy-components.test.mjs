import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '../src/app');

test('1. AppComponent is decomposed into smaller functional standalone components', () => {
  const expectedSubcomponents = [
    'components/app-header/app-header.component.ts',
    'components/app-header/app-header.component.html',
    'components/race-overlays/race-overlays.component.ts',
    'components/race-overlays/race-overlays.component.html',
    'components/home-dashboard/home-dashboard.component.ts',
    'components/home-dashboard/home-dashboard.component.html',
    'components/regatta-view/regatta-view.component.ts',
    'components/regatta-view/regatta-view.component.html',
    'components/cockpit-view/cockpit-view.component.ts',
    'components/cockpit-view/cockpit-view.component.html',
    'components/seo-footer/seo-footer.component.ts',
    'components/seo-footer/seo-footer.component.html',
    'components/modals/account-modal/account-modal.component.ts',
    'components/modals/account-modal/account-modal.component.html',
    'components/modals/standings-modal/standings-modal.component.ts',
    'components/modals/standings-modal/standings-modal.component.html',
    'components/modals/race-history-modal/race-history-modal.component.ts',
    'components/modals/race-history-modal/race-history-modal.component.html',
    'components/modals/statistics-modal/statistics-modal.component.ts',
    'components/modals/statistics-modal/statistics-modal.component.html',
    'components/modals/subscription-modal/subscription-modal.component.ts',
    'components/modals/subscription-modal/subscription-modal.component.html',
    'components/modals/unified-config-modal/unified-config-modal.component.ts',
    'components/modals/unified-config-modal/unified-config-modal.component.html',
    'components/modals/legal-terms-modal/legal-terms-modal.component.ts',
    'components/modals/legal-terms-modal/legal-terms-modal.component.html'
  ];

  for (const relPath of expectedSubcomponents) {
    const fullPath = path.join(appDir, relPath);
    assert.ok(fs.existsSync(fullPath), `Subcomponent file must exist: ${relPath}`);
  }

  // Verify app.html is now a clean, compact orchestrator (< 600 lines instead of 4461 lines)
  const appHtml = fs.readFileSync(path.join(appDir, 'app.html'), 'utf8');
  const appHtmlLines = appHtml.split('\n').length;
  assert.ok(appHtmlLines < 600, `app.html should be compact (< 600 lines), found ${appHtmlLines}`);
});

test('2. AppComponent template uses Angular @defer blocks for lazy-loading views and modals', () => {
  const appHtml = fs.readFileSync(path.join(appDir, 'app.html'), 'utf8');

  const deferredSelectors = [
    '<app-account-modal',
    '<app-race-history-modal',
    '<app-unified-config-modal',
    '<app-standings-modal',
    '<app-legal-terms-modal',
    '<app-subscription-modal',
    '<app-statistics-modal',
    '<app-admin-dashboard',
    '<app-private-room-manager',
    '<app-regatta-view',
    '<app-cockpit-view',
    '<app-seo-footer'
  ];

  for (const selector of deferredSelectors) {
    assert.ok(appHtml.includes(selector), `app.html must include ${selector}`);
  }

  const deferBlocks = appHtml.match(/@defer\s*\(/g) || [];
  assert.ok(deferBlocks.length >= 11, `app.html must contain at least 11 @defer blocks for lazy loading, found ${deferBlocks.length}`);
});

test('3. Angular Router configuration (app.routes.ts) uses loadComponent for lazy route resolution', () => {
  const routesContent = fs.readFileSync(path.join(appDir, 'app.routes.ts'), 'utf8');
  assert.match(routesContent, /loadComponent:\s*\(\)\s*=>\s*import\(/, 'app.routes.ts must configure lazy loading with loadComponent: () => import(...)');
});
