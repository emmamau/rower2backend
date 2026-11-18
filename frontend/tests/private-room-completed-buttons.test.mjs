import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('PrivateRoomManagerComponent: No duplicate Ranking and Leave buttons when room is completed', () => {
  const htmlPath = path.join(rootDir, 'src/app/components/private-room-manager/private-room-manager.component.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  // Locate .priv-banner-nav section inside the template
  const bannerNavMatch = htmlContent.match(/<div class="priv-banner-nav">([\s\S]*?)<\/div>/);
  assert.ok(bannerNavMatch, 'Template must contain .priv-banner-nav section');
  const bannerNavContent = bannerNavMatch[1];

  // 1. .priv-banner-nav must NOT have a completed condition displaying ranking or leave buttons
  assert.doesNotMatch(
    bannerNavContent,
    /@if\s*\(\s*isRoomCompleted\s*\)/,
    '.priv-banner-nav must NOT have an @if (isRoomCompleted) block that duplicates buttons'
  );
  assert.doesNotMatch(
    bannerNavContent,
    /viewRankingRequest\.emit/,
    '.priv-banner-nav must NOT render viewRankingRequest button in the top bar'
  );

  // 2. .priv-banner-nav should show normal navigation only when room is NOT completed
  assert.match(
    bannerNavContent,
    /@if\s*\(\s*!isRoomCompleted\s*\)/,
    '.priv-banner-nav must wrap active management buttons inside @if (!isRoomCompleted)'
  );

  // 3. .priv-banner-completed-box must exist and contain the single official set of action buttons in expanded view
  const completedBoxMatch = htmlContent.match(/<div class="priv-banner-completed-box">([\s\S]*?)<\/div>\s*\}\s*@else/);
  assert.ok(completedBoxMatch, 'Template must contain .priv-banner-completed-box');
  const completedBoxContent = completedBoxMatch[1];

  assert.match(
    completedBoxContent,
    /viewRankingRequest\.emit\(activeRoom\.race\.id\)/,
    '.priv-banner-completed-box must contain viewRankingRequest action'
  );
  assert.match(
    completedBoxContent,
    /leaveToPublicRace\(\)/,
    '.priv-banner-completed-box must contain leaveToPublicRace action'
  );
});
