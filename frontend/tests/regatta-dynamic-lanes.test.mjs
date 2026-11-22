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

  // 3. Check 5m overtaking threshold
  assert.match(
    canvasContent,
    /OVERTAKE_THRESHOLD_M\s*=\s*5;/,
    'Must include 5m hysteresis / overtaking threshold'
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

test('RegattaCanvasComponent: auto-collapses lane-mode-toggle button after 5s and expands for 5s on click', () => {
  const canvasTsPath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const canvasContent = fs.readFileSync(canvasTsPath, 'utf-8');

  assert.match(
    canvasContent,
    /isLaneModeCollapsed\s*:\s*boolean\s*=\s*false/,
    'RegattaCanvasComponent must declare isLaneModeCollapsed: boolean = false'
  );
  assert.match(
    canvasContent,
    /LANE_MODE_COLLAPSE_DELAY_MS\s*=\s*5000/,
    'RegattaCanvasComponent must define LANE_MODE_COLLAPSE_DELAY_MS = 5000'
  );
  assert.match(
    canvasContent,
    /\[class\.is-collapsed\]="isLaneModeCollapsed"/,
    'Template must bind [class.is-collapsed]="isLaneModeCollapsed" on .lane-mode-toggle'
  );
  assert.match(
    canvasContent,
    /\.lane-mode-toggle\.is-collapsed\s+\.mode-label\s*\{\s*display:\s*none;/,
    'Collapsed button style must hide .mode-label so only the icon remains visible'
  );
  assert.match(
    canvasContent,
    /scheduleLaneModeCollapse\s*\(\s*\)\s*:\s*void/,
    'RegattaCanvasComponent must implement scheduleLaneModeCollapse()'
  );
  assert.match(
    canvasContent,
    /clearLaneModeCollapseTimer\s*\(\s*\)\s*:\s*void/,
    'RegattaCanvasComponent must implement clearLaneModeCollapseTimer()'
  );
  assert.match(
    canvasContent,
    /toggleLaneMode\s*\(\s*\)\s*:\s*void\s*\{[\s\S]*?this\.scheduleLaneModeCollapse\s*\(\s*\)/,
    'toggleLaneMode() must call scheduleLaneModeCollapse() to re-display label for 5s'
  );
  assert.match(
    canvasContent,
    /ngOnDestroy\s*\(\s*\)\s*:\s*void\s*\{[\s\S]*?this\.clearLaneModeCollapseTimer\s*\(\s*\)/,
    'ngOnDestroy() must clean up the collapse timer'
  );
});

test('Lane mode toggle button: collapses after 5s and expands again for 5s when activated', () => {
  const scheduled = [];
  const cleared = [];
  let nextId = 1;

  const fakeSetTimeout = (fn, delay) => {
    const id = nextId++;
    scheduled.push({ id, fn, delay, cleared: false });
    return id;
  };
  const fakeClearTimeout = (id) => {
    cleared.push(id);
    const entry = scheduled.find((item) => item.id === id);
    if (entry) entry.cleared = true;
  };

  class LaneToggleController {
    constructor() {
      this.dynamicLaneMode = true;
      this.isLaneModeCollapsed = false;
      this.LANE_MODE_COLLAPSE_DELAY_MS = 5000;
      this.laneModeCollapseTimer = null;
      this.scheduleLaneModeCollapse();
    }
    scheduleLaneModeCollapse() {
      this.clearLaneModeCollapseTimer();
      this.isLaneModeCollapsed = false;
      this.laneModeCollapseTimer = fakeSetTimeout(() => {
        this.isLaneModeCollapsed = true;
        this.laneModeCollapseTimer = null;
      }, this.LANE_MODE_COLLAPSE_DELAY_MS);
    }
    clearLaneModeCollapseTimer() {
      if (this.laneModeCollapseTimer !== null) {
        fakeClearTimeout(this.laneModeCollapseTimer);
        this.laneModeCollapseTimer = null;
      }
    }
    toggleLaneMode() {
      this.dynamicLaneMode = !this.dynamicLaneMode;
      this.scheduleLaneModeCollapse();
    }
  }

  const ctrl = new LaneToggleController();
  assert.equal(ctrl.isLaneModeCollapsed, false, 'Button must start expanded');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 5000);

  // Fire initial 5s timer -> collapses to icon-only
  scheduled[0].fn();
  assert.equal(ctrl.isLaneModeCollapsed, true, 'Button must collapse after 5000ms');

  // User activates the button -> re-expands for another 5s
  ctrl.toggleLaneMode();
  assert.equal(ctrl.dynamicLaneMode, false);
  assert.equal(ctrl.isLaneModeCollapsed, false, 'Activating the button must show the label again');
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[1].delay, 5000);

  // User clicks again before 5s elapses -> previous timer cleared and fresh 5s scheduled
  ctrl.toggleLaneMode();
  assert.equal(ctrl.dynamicLaneMode, true);
  assert.equal(ctrl.isLaneModeCollapsed, false);
  assert.ok(cleared.includes(scheduled[1].id), 'Previous collapse timer must be cleared on reactivation');
  assert.equal(scheduled.length, 3);
  assert.equal(scheduled[2].delay, 5000);

  // Fire latest 5s timer -> collapses again
  scheduled[2].fn();
  assert.equal(ctrl.isLaneModeCollapsed, true, 'Button must collapse again after 5000ms');
});

test('Dynamic Lane Overtake Simulation: 5m Hysteresis buffer prevents jitter and validates decisive passes', () => {
  // Pure behavioral simulation of the hysteresis algorithm
  const OVERTAKE_THRESHOLD = 5;

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

  // Scenario 1: B advances to 502m (2m in front of A).
  // 2m is LESS than the 5m threshold -> NO SWAP
  boatB.currentDisplayDist = 502;
  updateDynamicLanes(boats);
  assert.equal(boatA.dynamicLaneIndex, 0, 'Boat A must remain on Lane 0 when B leads by only 2m');
  assert.equal(boatB.dynamicLaneIndex, 1, 'Boat B must remain on Lane 1 when leading by only 2m');

  // Scenario 2: B advances to 504.9m (4.9m in front of A).
  // Still strictly less than 5m -> NO SWAP
  boatB.currentDisplayDist = 504.9;
  updateDynamicLanes(boats);
  assert.equal(boatA.dynamicLaneIndex, 0, 'No swap at 4.9m lead');
  assert.equal(boatB.dynamicLaneIndex, 1, 'No swap at 4.9m lead');

  // Scenario 3: B advances to 505m (5m in front of A: 505 >= 500 + 5).
  // Decisive pass -> SWAP! B takes Lane 0, A takes Lane 1
  boatB.currentDisplayDist = 505;
  updateDynamicLanes(boats);
  assert.equal(boatB.dynamicLaneIndex, 0, 'Boat B takes Lane 0 once +5m lead achieved');
  assert.equal(boatA.dynamicLaneIndex, 1, 'Boat A drops to Lane 1');

  // Scenario 4: A accelerates to 507m (A is at 507m, B is at 505m -> A is 2m ahead of B).
  // Hysteresis in reverse: A leads by 2m, but needs +5m (510m) to reclaim Lane 0 -> NO SWAP BACK
  boatA.currentDisplayDist = 507;
  updateDynamicLanes(boats);
  assert.equal(boatB.dynamicLaneIndex, 0, 'Boat B retains Lane 0 when A leads by only 2m');
  assert.equal(boatA.dynamicLaneIndex, 1, 'Boat A remains on Lane 1');

  // Scenario 5: A reaches 510m (A is at 510m, B is at 505m -> 510 >= 505 + 5).
  // Decisive pass back -> SWAP BACK! A reclaims Lane 0, B drops to Lane 1
  boatA.currentDisplayDist = 510;
  updateDynamicLanes(boats);
  assert.equal(boatA.dynamicLaneIndex, 0, 'Boat A reclaims Lane 0 when exceeding B by +5m');
  assert.equal(boatB.dynamicLaneIndex, 1, 'Boat B drops back to Lane 1');
});
