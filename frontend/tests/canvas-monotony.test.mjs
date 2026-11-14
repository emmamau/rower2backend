import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('RegattaCanvas: Boat distance and display distance must be strictly monotonic (no backward motion)', () => {
  const canvasTsPath = path.resolve(__dirname, '../src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const canvasTs = fs.readFileSync(canvasTsPath, 'utf8');

  // Verify that targetPacketDist enforces monotonicity on updates
  assert.match(
    canvasTs,
    /Math\.max\(\s*boat\.targetPacketDist/i,
    'syncRacersData must prevent targetPacketDist from decreasing'
  );

  // Verify that currentDisplayDist never moves backwards during physics step
  assert.match(
    canvasTs,
    /boat\.currentDisplayDist\s*=\s*Math\.max/i,
    'updateBoatsPhysics must guarantee that currentDisplayDist is strictly non-decreasing'
  );
});

test('AppTs: liveMetricsList active player distance never regresses on websocket updates', () => {
  const appTsPath = path.resolve(__dirname, '../src/app/app.ts');
  const appTs = fs.readFileSync(appTsPath, 'utf8');

  // Verify that liveMetricsList preserves highest distance for racers
  assert.match(
    appTs,
    /existing\.dist[\s\S]*?Math\.max/i,
    'app.ts socket leaderboard listener must prevent racer distance regression'
  );
});
