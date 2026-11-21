import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cssPath = path.resolve(
  __dirname,
  '../src/app/components/private-room-manager/private-room-manager.component.css'
);

test('PrivateRoomManager Tabs: Portrait smartphone query arranges 4 tabs on exactly 2 lines (2 columns)', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  // Verify there is a portrait media query for smartphone (< 768px or <= 640px)
  assert.match(
    css,
    /@media[^{]*?orientation:\s*portrait[^{]*?\{[\s\S]*?\.priv-tablist\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*1fr\)/,
    'Expected .priv-tablist to have repeat(2, 1fr) in smartphone portrait media query'
  );

  // Verify .priv-tab-btn in portrait allows text wrapping and touch min-height
  assert.match(
    css,
    /@media[^{]*?orientation:\s*portrait[^{]*?\{[\s\S]*?\.priv-tab-btn\s*\{[\s\S]*?white-space:\s*normal/,
    'Expected .priv-tab-btn to allow white-space: normal in portrait query'
  );
});

test('PrivateRoomManager Tabs: Landscape and desktop preserve single line tablist without forced 2-column grid', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  // Desktop tablist has flex-wrap: nowrap
  assert.match(
    css,
    /\.priv-tablist\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*nowrap;/,
    'Expected base .priv-tablist to have display: flex and flex-wrap: nowrap'
  );

  // Ensure generic max-width: 640px does not blindly apply repeat(2, 1fr) without portrait condition
  const genericMobileMatch = css.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*?)\}/);
  if (genericMobileMatch) {
    const genericRules = genericMobileMatch[1];
    // If repeat(2, 1fr) is present, it must be restricted to portrait orientation
    assert.ok(
      !genericRules.includes('repeat(2, 1fr)') || genericRules.includes('orientation: portrait'),
      'repeat(2, 1fr) must be restricted to portrait orientation'
    );
  }
});
