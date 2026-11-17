import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Regatta mode smartphone layout: buttons above water lines, telemetry data below water lines', () => {
  const cssPath = path.join(rootDir, 'src/app/app.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  // 1. Verify flex order definitions for smartphone views
  // .regatta-quick-nav-bar has order: 1 (above water lines)
  assert.match(
    cssContent,
    /\.regatta-quick-nav-bar\s*\{[^}]*order:\s*1/s,
    '.regatta-quick-nav-bar must have order: 1 on smartphone to be placed above water lines'
  );

  // .regatta-canvas-section has order: 2 (water lines in middle)
  assert.match(
    cssContent,
    /\.regatta-canvas-section\s*\{[^}]*order:\s*2/s,
    '.regatta-canvas-section must have order: 2 on smartphone'
  );

  // .regatta-unified-hud has order: 3 (telemetry data below water lines)
  assert.match(
    cssContent,
    /\.regatta-unified-hud\s*\{[^}]*order:\s*3/s,
    '.regatta-unified-hud must have order: 3 on smartphone to be placed below water lines'
  );

  // 2. Verify landscape smartphone media query includes this ordering
  assert.match(
    cssContent,
    /@media[^{]*max-height:\s*(?:500|600)px[^{]*landscape[^{]*\{[\s\S]*?\.regatta-quick-nav-bar[\s\S]*?order:\s*1/s,
    'Smartphone landscape media query must order buttons above water lines'
  );

  // 3. Verify HTML keeps Accueil & Cockpit in regatta-quick-nav-bar
  const htmlPath = path.join(rootDir, 'src/app/app.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  assert.match(
    htmlContent,
    /<aside class="regatta-quick-nav-bar"[\s\S]*?btn-quick-home[\s\S]*?btn-quick-cockpit[\s\S]*?<\/aside>/s,
    'regatta-quick-nav-bar must contain both Accueil and Cockpit buttons'
  );
});
