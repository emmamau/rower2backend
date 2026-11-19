import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appCssPath = path.resolve(__dirname, '../src/app/app.css');
const privRoomCssPath = path.resolve(__dirname, '../src/app/components/private-room-manager/private-room-manager.component.css');

test('Desktop layout spacing: .hud-header has compact padding and reduced gap', () => {
  const css = fs.readFileSync(appCssPath, 'utf8');

  // Verify .hud-header has tightened padding and gap
  const headerMatch = css.match(/\.hud-header\s*\{([^}]+)\}/);
  assert.ok(headerMatch, 'CSS should define .hud-header');
  const headerBody = headerMatch[1];
  assert.match(headerBody, /padding:\s*max\(0\.5rem,\s*var\(--safe-top\)\)/, 'hud-header padding should be 0.5rem vertically');
  assert.match(headerBody, /gap:\s*0\.5rem;/, 'hud-header gap should be 0.5rem');
});

test('Desktop layout spacing: .race-arena has compact padding and 0.65rem flex gap', () => {
  const css = fs.readFileSync(appCssPath, 'utf8');

  // Verify .race-arena has compact padding and gap
  const arenaMatch = css.match(/\.race-arena\s*\{([^}]+)\}/);
  assert.ok(arenaMatch, 'CSS should define .race-arena');
  const arenaBody = arenaMatch[1];
  assert.match(arenaBody, /padding:\s*0\.65rem\s+max\(1\.2rem,\s*var\(--safe-right\)\)/, 'race-arena padding should be tightened');
  assert.match(arenaBody, /gap:\s*0\.65rem;/, 'race-arena flex gap should be 0.65rem');
});

test('Desktop layout spacing: main sections eliminate redundant vertical outer margins', () => {
  const css = fs.readFileSync(appCssPath, 'utf8');

  // .home-welcome-banner should have 0 margin
  const welcomeMatch = css.match(/\.home-welcome-banner\s*\{([^}]+)\}/);
  assert.ok(welcomeMatch, 'CSS should define .home-welcome-banner');
  assert.match(welcomeMatch[1], /margin:\s*0;/, 'home-welcome-banner margin should be 0');

  // .lobby-regatta-preview-section should have 0 margin
  const lobbyMatch = css.match(/\.lobby-regatta-preview-section\s*\{([^}]+)\}/);
  assert.ok(lobbyMatch, 'CSS should define .lobby-regatta-preview-section');
  assert.match(lobbyMatch[1], /margin:\s*0;/, 'lobby-regatta-preview-section margin should be 0');

  // .dual-standings-history-container should have 0 margin and compact column gap
  const dualMatch = css.match(/\.dual-standings-history-container\s*\{([^}]+)\}/);
  assert.ok(dualMatch, 'CSS should define .dual-standings-history-container');
  assert.match(dualMatch[1], /margin:\s*0;/, 'dual-standings-history-container margin should be 0');
  assert.match(dualMatch[1], /gap:\s*0\.85rem;/, 'dual-standings-history-container gap should be 0.85rem');

  // .garmin-pairing-section should have 0 margin (root rule)
  const pairingMatch = css.match(/(?:^|\n)\.garmin-pairing-section\s*\{([^}]+)\}/);
  assert.ok(pairingMatch, 'CSS should define .garmin-pairing-section');
  assert.match(pairingMatch[1], /margin:\s*0;/, 'garmin-pairing-section margin should be 0');

  // .seo-hub-section should have tightened margin-top and padding
  const seoMatch = css.match(/\.seo-hub-section\s*\{([^}]+)\}/);
  assert.ok(seoMatch, 'CSS should define .seo-hub-section');
  assert.match(seoMatch[1], /margin-top:\s*0\.85rem;/, 'seo-hub-section margin-top should be 0.85rem');
  assert.match(seoMatch[1], /padding:\s*1\.25rem\s+1\.25rem\s+1\.25rem;/, 'seo-hub-section padding should be compact');

  // .app-footer should have compact padding
  const footerMatch = css.match(/\.app-footer\s*\{([^}]+)\}/);
  assert.ok(footerMatch, 'CSS should define .app-footer');
  assert.match(footerMatch[1], /padding:\s*0\.75rem\s+0\.75rem\s+0\.85rem;/, 'app-footer padding should be tightened');
});

test('Desktop layout spacing: private-room-manager banner has 0 margin-bottom to avoid doubling race-arena gap', () => {
  const privCss = fs.readFileSync(privRoomCssPath, 'utf8');

  const privBannerMatch = privCss.match(/\.priv-active-banner\s*\{([^}]+)\}/);
  assert.ok(privBannerMatch, 'CSS should define .priv-active-banner');
  assert.match(privBannerMatch[1], /margin-bottom:\s*0;/, 'priv-active-banner margin-bottom should be 0');
  assert.match(privBannerMatch[1], /padding:\s*0\.65rem\s+0\.95rem;/, 'priv-active-banner padding should be 0.65rem 0.95rem');
});
