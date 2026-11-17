import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Home page on smartphone screen is scrollable and not constrained by cockpit/regatta zero-scroll locks', () => {
  const cssPath = path.join(rootDir, 'src/app/app.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  // 1. .race-arena must allow growing naturally to fit home content
  assert.match(
    cssContent,
    /\.race-arena\s*\{[^}]*flex:\s*1\s+0\s+auto/s,
    '.race-arena must specify flex: 1 0 auto so it does not shrink to 0 basis and cut off vertical scroll content'
  );

  // 2. The portrait cockpit zero-scroll rule for .race-arena must be scoped to :has(.cockpit-hud)
  assert.match(
    cssContent,
    /\.game-container(?::has\(\.cockpit-hud\)|\[class\*="cockpit"\])[^{]*\.race-arena\s*\{[^}]*overflow:\s*hidden/s,
    'Cockpit portrait zero-scroll on .race-arena must be scoped to :has(.cockpit-hud) so home page remains scrollable'
  );

  // 3. Landscape zero-scroll on .game-container must be scoped to rigid-viewport or pure-screen-active
  assert.match(
    cssContent,
    /@media[^{]*max-height:\s*500px[^{]*landscape[^{]*\{[\s\S]*?\.game-container\.(?:rigid-viewport|pure-screen-active)[\s\S]*?position:\s*fixed/s,
    'Landscape smartphone zero-scroll on .game-container must be scoped to pure-screen-active / rigid-viewport'
  );

  // 4. In app.ts, isMobileFullscreenOnly must ensure siteView !== "home"
  const tsPath = path.join(rootDir, 'src/app/app.ts');
  const tsContent = fs.readFileSync(tsPath, 'utf-8');
  assert.match(
    tsContent,
    /get\s+isMobileFullscreenOnly\(\)\s*:\s*boolean\s*\{[\s\S]*?this\.siteView\s*!==\s*'home'/s,
    'isMobileFullscreenOnly must check this.siteView !== "home" so home page remains scrollable'
  );

  // 5. In smartphone view (<=768px), .smartphone-table-links must be display: flex !important
  assert.match(
    cssContent,
    /\.smartphone-table-links\s*\{[^}]*display:\s*flex\s*!important/s,
    '.smartphone-table-links must use display: flex !important on mobile'
  );
});
