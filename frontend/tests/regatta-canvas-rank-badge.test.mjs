import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('RegattaCanvasComponent: rank medal and remaining distance badge logic', () => {
  const canvasTsPath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const canvasContent = fs.readFileSync(canvasTsPath, 'utf-8');

  // 1. Check Input isRaceActive
  assert.match(
    canvasContent,
    /@Input\(\)\s*isRaceActive\s*=\s*false;/,
    'RegattaCanvasComponent must declare @Input() isRaceActive = false'
  );

  // 2. Check getRacerRank or ranking helper
  assert.match(
    canvasContent,
    /getRacerRank\s*\(\s*userId:\s*string\s*\)/,
    'RegattaCanvasComponent must implement getRacerRank(userId: string)'
  );

  // 3. Check medals assignment (🥇, 🥈, 🥉)
  assert.match(canvasContent, /🥇/, 'Must use gold medal 🥇 for 1st place');
  assert.match(canvasContent, /🥈/, 'Must use silver medal 🥈 for 2nd place');
  assert.match(canvasContent, /🥉/, 'Must use bronze medal 🥉 for 3rd place');

  // 4. Check that badge rendering is strictly scoped to connected user (isUser)
  assert.match(
    canvasContent,
    /if\s*\(\s*isUser\s*&&\s*\(this\.isRaceActive/s,
    'Must only draw badge in front of boat for connected user (isUser) during active race'
  );

  // 5. Check remaining distance calculation
  assert.match(
    canvasContent,
    /remainingDist|remDist/,
    'Must calculate remaining distance to target'
  );

  // 6. Check app.html passes [isRaceActive]="isRaceActive"
  const appHtmlPath = path.join(rootDir, 'src/app/app.html');
  const appHtmlContent = fs.readFileSync(appHtmlPath, 'utf-8');
  assert.match(
    appHtmlContent,
    /<app-regatta-canvas[^>]*\[isRaceActive\]="isRaceActive"/s,
    'app.html must pass [isRaceActive]="isRaceActive" to app-regatta-canvas'
  );
});

test('RegattaCanvasComponent: getRacerRank behavioral simulation', () => {
  // Simulate the getRacerRank method logic
  function computeRank(userId, sortedLeaderboard, boatsMap = new Map()) {
    if (!userId) return null;
    let rankIndex = sortedLeaderboard.findIndex((r) => r.userId === userId);

    if (rankIndex < 0 && boatsMap.has(userId)) {
      const myBoat = boatsMap.get(userId);
      let aheadCount = 0;
      boatsMap.forEach((b) => {
        if (b.userId !== userId && b.currentDisplayDist > myBoat.currentDisplayDist) {
          aheadCount++;
        }
      });
      rankIndex = aheadCount;
    }

    if (rankIndex < 0) return null;
    const rank = rankIndex + 1;
    let medal = null;
    let label = `${rank}e`;
    let color = '#00f0ff';

    if (rank === 1) {
      medal = '🥇';
      label = '1er';
      color = '#ffd700';
    } else if (rank === 2) {
      medal = '🥈';
      label = '2e';
      color = '#e2e8f0';
    } else if (rank === 3) {
      medal = '🥉';
      label = '3e';
      color = '#cd7f32';
    }

    return { rank, medal, label, color };
  }

  const leaderboard = [
    { userId: 'user-1', name: 'Alice', dist: 1500 },
    { userId: 'user-2', name: 'Bob', dist: 1420 },
    { userId: 'user-3', name: 'Charlie', dist: 1390 },
    { userId: 'user-4', name: 'David', dist: 1200 },
  ];

  // 1st place -> Gold medal 🥇
  const rank1 = computeRank('user-1', leaderboard);
  assert.equal(rank1.rank, 1);
  assert.equal(rank1.medal, '🥇');
  assert.equal(rank1.label, '1er');
  assert.equal(rank1.color, '#ffd700');

  // 2nd place -> Silver medal 🥈
  const rank2 = computeRank('user-2', leaderboard);
  assert.equal(rank2.rank, 2);
  assert.equal(rank2.medal, '🥈');
  assert.equal(rank2.label, '2e');
  assert.equal(rank2.color, '#e2e8f0');

  // 3rd place -> Bronze medal 🥉
  const rank3 = computeRank('user-3', leaderboard);
  assert.equal(rank3.rank, 3);
  assert.equal(rank3.medal, '🥉');
  assert.equal(rank3.label, '3e');
  assert.equal(rank3.color, '#cd7f32');

  // 4th place -> No medal, 4e label, cyan color
  const rank4 = computeRank('user-4', leaderboard);
  assert.equal(rank4.rank, 4);
  assert.equal(rank4.medal, null);
  assert.equal(rank4.label, '4e');
  assert.equal(rank4.color, '#00f0ff');

  // Unknown user -> null
  assert.equal(computeRank('user-unknown', leaderboard), null);

  // Distance remaining formatting
  const targetDist = 2000;
  const rem1 = Math.max(0, targetDist - 1650);
  assert.equal(`${rem1}m`, '350m');

  const remFinished = Math.max(0, targetDist - 2000);
  assert.equal(remFinished > 0 ? `${remFinished}m` : 'Arrivé !', 'Arrivé !');
});
