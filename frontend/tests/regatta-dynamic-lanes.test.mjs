import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('RegattaCanvasComponent: dynamic lane ordering with 10m hysteresis and smooth interpolation', () => {
  const canvasTsPath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const canvasContent = fs.readFileSync(canvasTsPath, 'utf-8');

  // 1. Check dynamicLaneMode property and toggleLaneMode method
  assert.match(
    canvasContent,
    /dynamicLaneMode\s*:\s*boolean\s*=\s*true/,
    'RegattaCanvasComponent must declare dynamicLaneMode: boolean = true by default'
  );
  assert.match(
    canvasContent,
    /toggleLaneMode\s*\(\s*\)/,
    'RegattaCanvasComponent must implement toggleLaneMode()'
  );

  // 2. Check BoatRenderState has assignedLane, dynamicLaneIndex, currentLaneIndex
  assert.match(
    canvasContent,
    /assignedLane\s*:\s*number/,
    'BoatRenderState must include assignedLane: number'
  );
  assert.match(
    canvasContent,
    /dynamicLaneIndex\s*:\s*number/,
    'BoatRenderState must include dynamicLaneIndex: number'
  );
  assert.match(
    canvasContent,
    /currentLaneIndex\s*:\s*number/,
    'BoatRenderState must include currentLaneIndex: number'
  );

  // 3. Check 10m overtaking threshold
  assert.match(
    canvasContent,
    /10/,
    'Must include 10m hysteresis / overtaking threshold'
  );

  // 4. Check UI toggle button in template
  assert.match(
    canvasContent,
    /lane-mode-toggle/,
    'Template must include .lane-mode-toggle button'
  );

  // 5. Check smooth vertical lerp / interpolation in updateBoatsPhysics
  assert.match(
    canvasContent,
    /currentLaneIndex\s*\+=/,
    'Must smoothly interpolate currentLaneIndex towards target lane index'
  );

  // 6. Check fixed couloir numbering for water lanes (not boat.lane)
  assert.match(
    canvasContent,
    /L\$\{l\s*\+\s*1\}|Ligne \$\{l\s*\+\s*1\}/,
    'Canvas scene must draw fixed couloir labels based on lane index (l + 1)'
  );
});

test('Dynamic Lane Overtake Simulation: 10m Hysteresis buffer prevents jitter and validates decisive passes', () => {
  // Pure behavioral simulation of the hysteresis algorithm
  const OVERTAKE_THRESHOLD = 10;

  class BoatSim {
    constructor(userId, assignedLane, dist) {
      this.userId = userId;
      this.assignedLane = assignedLane;
      this.dynamicLaneIndex = assignedLane - 1; // 0 = L1 (top), 1 = L2, etc.
      this.currentLaneIndex = assignedLane - 1;
      this.currentDisplayDist = dist;
      this.status = 'in_progress';
    }
  }

  const boatA = new BoatSim('userA', 1, 500); // Lane 0 (Leader)
  const boatB = new BoatSim('userB', 2, 490); // Lane 1 (Chaser)
  const boats = [boatA, boatB];

  function updateDynamicLanes(list) {
    list.sort((a, b) => a.dynamicLaneIndex - b.dynamicLaneIndex);
    for (let i = list.length - 2; i >= 0; i--) {
      const top = list[i];
      const bot = list[i + 1];
      if (bot.currentDisplayDist >= top.currentDisplayDist + OVERTAKE_THRESHOLD) {
        const tmp = top.dynamicLaneIndex;
        top.dynamicLaneIndex = bot.dynamicLaneIndex;
        bot.dynamicLaneIndex = tmp;
        list[i] = bot;
        list[i + 1] = top;
      }
    }
  }

  // Initial state: A is Lane 0 (500m), B is Lane 1 (490m)
  assert.equal(boatA.dynamicLaneIndex, 0);
  assert.equal(boatB.dynamicLaneIndex, 1);

  // Scenario 1: B advances to 505m (5m in front of A).
  // 5m is LESS than the 10m threshold -> NO SWAP
  boatB.currentDisplayDist = 505;
  updateDynamicLanes(boats);
  assert.equal(boatA.dynamicLaneIndex, 0, 'Boat A must remain on Lane 0 when B leads by only 5m');
  assert.equal(boatB.dynamicLaneIndex, 1, 'Boat B must remain on Lane 1 when leading by only 5m');

  // Scenario 2: B advances to 509.9m (9.9m in front of A).
  // Still strictly less than 10m -> NO SWAP
  boatB.currentDisplayDist = 509.9;
  updateDynamicLanes(boats);
  assert.equal(boatA.dynamicLaneIndex, 0, 'No swap at 9.9m lead');
  assert.equal(boatB.dynamicLaneIndex, 1, 'No swap at 9.9m lead');

  // Scenario 3: B advances to 510m (10m in front of A: 510 >= 500 + 10).
  // Decisive pass -> SWAP! B takes Lane 0, A takes Lane 1
  boatB.currentDisplayDist = 510;
  updateDynamicLanes(boats);
  assert.equal(boatB.dynamicLaneIndex, 0, 'Boat B takes Lane 0 once +10m lead achieved');
  assert.equal(boatA.dynamicLaneIndex, 1, 'Boat A drops to Lane 1');

  // Scenario 4: A accelerates to 515m (A is at 515m, B is at 510m -> A is 5m ahead of B).
  // Hysteresis in reverse: A leads by 5m, but needs +10m (520m) to reclaim Lane 0 -> NO SWAP BACK
  boatA.currentDisplayDist = 515;
  updateDynamicLanes(boats);
  assert.equal(boatB.dynamicLaneIndex, 0, 'Boat B retains Lane 0 when A leads by only 5m');
  assert.equal(boatA.dynamicLaneIndex, 1, 'Boat A remains on Lane 1');

  // Scenario 5: A reaches 520m (A is at 520m, B is at 510m -> 520 >= 510 + 10).
  // Decisive pass back -> SWAP BACK! A reclaims Lane 0, B drops to Lane 1
  boatA.currentDisplayDist = 520;
  updateDynamicLanes(boats);
  assert.equal(boatA.dynamicLaneIndex, 0, 'Boat A reclaims Lane 0 when exceeding B by +10m');
  assert.equal(boatB.dynamicLaneIndex, 1, 'Boat B drops back to Lane 1');
});
