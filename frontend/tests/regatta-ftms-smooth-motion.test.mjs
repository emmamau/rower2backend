import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Backend & Socket: LiveRacerMetric preserves decimal exactDist and FTMS speedMs without integer rounding', () => {
  const raceManagerPath = path.resolve(rootDir, '../backend/src/services/race-manager.service.ts');
  const raceManagerCode = fs.readFileSync(raceManagerPath, 'utf8');

  assert.match(
    raceManagerCode,
    /exactDist:\s*exactDistVal/,
    'RaceManager.toLiveMetrics must include exactDist in LiveRacerMetric'
  );
  assert.match(
    raceManagerCode,
    /speedMs/,
    'RaceManager.toLiveMetrics must include speedMs derived from FTMS Watts/Pace'
  );

  const telemetryCtrlPath = path.resolve(rootDir, '../backend/src/controllers/telemetry.controller.ts');
  const telemetryCtrlCode = fs.readFileSync(telemetryCtrlPath, 'utf8');

  assert.match(
    telemetryCtrlCode,
    /if\s*\(field\s*===\s*"exactDistance"\)\s*return\s*exactDistance/,
    'TelemetryController must pass exactDistance to RaceManager.toLiveMetrics'
  );

  const appTsPath = path.resolve(rootDir, 'src/app/app.ts');
  const appTsCode = fs.readFileSync(appTsPath, 'utf8');

  assert.match(
    appTsCode,
    /Number\(m\.exactDist\s*\?\?\s*m\.dist\s*\?\?\s*0\)/,
    'app.ts WebSocket leaderboard listener must preserve decimal exactDist instead of Math.round'
  );
});

test('RegattaCanvas: Continuous FTMS kinematic dead-reckoning eliminates stepped stops between packets', () => {
  const canvasTsPath = path.resolve(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const canvasTs = fs.readFileSync(canvasTsPath, 'utf8');

  // 1. Verify computeFtmsTargetSpeedMs method
  assert.match(
    canvasTs,
    /computeFtmsTargetSpeedMs\s*\(/,
    'RegattaCanvasComponent must implement computeFtmsTargetSpeedMs from FTMS Watts/Pace/SPM'
  );

  // 2. Verify BoatRenderState tracks currentSpeedMs and targetSpeedMs
  assert.match(
    canvasTs,
    /currentSpeedMs:\s*number/,
    'BoatRenderState must track currentSpeedMs'
  );
  assert.match(
    canvasTs,
    /targetSpeedMs:\s*number/,
    'BoatRenderState must track targetSpeedMs'
  );

  // 3. Verify time-based continuous integration (currentSpeedMs * deltaT)
  assert.match(
    canvasTs,
    /boat\.currentDisplayDist\s*\+\s*boat\.currentSpeedMs\s*\*\s*deltaT/,
    'updateBoatsPhysics must integrate position continuously using currentSpeedMs * deltaT'
  );

  // 4. Verify hydrodynamic decay after packet silence (> 2.2s)
  assert.match(
    canvasTs,
    /timeSincePacketSec\s*>\s*2\.2/,
    'updateBoatsPhysics must apply hydrodynamic deceleration if no packet arrives after 2.2s'
  );

  // 5. Verify lane metric badges use currentDisplayDist for smooth meter progression
  assert.match(
    canvasTs,
    /case\s*'distCovered'[\s\S]*?boat\.currentDisplayDist/,
    'formatMetricValue distCovered must use boat.currentDisplayDist'
  );
  assert.match(
    canvasTs,
    /case\s*'distRemaining'[\s\S]*?boat\.currentDisplayDist/,
    'formatMetricValue distRemaining must use boat.currentDisplayDist'
  );
});

test('FTMS Kinematic Simulation: Kayak advances smoothly on every 60 FPS frame without stall or backward jump', () => {
  // Simulate a rower at 200 Watts (Concept2 speed = (200 / 2.80)^(1/3) ≈ 4.149 m/s)
  // receiving FTMS telemetry packets every 1.5 seconds over a 6-second window at 60 FPS
  const watts = 200;
  const c2Speed = Math.cbrt(watts / 2.80); // ~4.1491 m/s
  const dt = 1 / 60;

  const boat = {
    currentDisplayDist: 0,
    targetPacketDist: 0,
    currentSpeedMs: c2Speed,
    targetSpeedMs: c2Speed,
    watts,
    splitSec: Math.round(500 / c2Speed),
    spm: 26,
    lastPacketTime: 0,
    isBot: false,
    status: 'in_progress',
  };

  const targetDistance = 2000;
  let simNowSec = 0;
  const frameDeltas = [];

  for (let frame = 1; frame <= 360; frame++) {
    simNowSec += dt;

    // Every 90 frames (1.5s), a new FTMS packet arrives from the rower/server
    if (frame % 90 === 0) {
      // Simulate slight network jitter on packet arrival distance
      const jitter = (frame === 180) ? -0.35 : (frame === 270 ? 0.4 : 0);
      const packetDist = Math.max(boat.targetPacketDist, simNowSec * c2Speed + jitter);
      boat.targetPacketDist = packetDist;
      boat.targetSpeedMs = c2Speed;
      boat.lastPacketTime = simNowSec;
    }

    const prevDisplay = boat.currentDisplayDist;
    const diff = boat.targetPacketDist - boat.currentDisplayDist;
    const timeSincePacketSec = Math.max(0, simNowSec - boat.lastPacketTime);

    let desiredSpeedMs = boat.targetSpeedMs;
    if (timeSincePacketSec > 2.2) {
      desiredSpeedMs *= Math.exp(-(timeSincePacketSec - 2.2) * 1.4);
    }

    const projectedElapsedSec = Math.min(2.2, timeSincePacketSec);
    const projectedTargetDist = Math.min(targetDistance, boat.targetPacketDist + desiredSpeedMs * projectedElapsedSec);
    const trackingErrorM = projectedTargetDist - boat.currentDisplayDist;

    const maxLeadOverProjectedM = Math.max(2.0, desiredSpeedMs * 0.8);
    let effectiveTargetSpeedMs = desiredSpeedMs;

    if (trackingErrorM > 0) {
      const catchupBoost = Math.min(effectiveTargetSpeedMs * 0.85 + 2.5, trackingErrorM * 1.35);
      effectiveTargetSpeedMs += catchupBoost;
    } else if (trackingErrorM < 0) {
      const leadM = -trackingErrorM;
      if (leadM >= maxLeadOverProjectedM) {
        effectiveTargetSpeedMs = 0;
      } else {
        const leadRatio = leadM / maxLeadOverProjectedM;
        effectiveTargetSpeedMs *= Math.max(0.15, 1 - leadRatio * 0.85);
      }
    }

    const speedResponseRate = effectiveTargetSpeedMs >= boat.currentSpeedMs ? 6.5 : 4.5;
    const alphaSpeed = 1 - Math.exp(-speedResponseRate * dt);
    boat.currentSpeedMs = Math.max(0, boat.currentSpeedMs + (effectiveTargetSpeedMs - boat.currentSpeedMs) * alphaSpeed);

    let nextDist = boat.currentDisplayDist + boat.currentSpeedMs * dt;
    if (targetDistance > 0 && boat.targetPacketDist < targetDistance) {
      nextDist = Math.min(nextDist, Math.max(boat.targetPacketDist, targetDistance - 0.2));
    }
    boat.currentDisplayDist = Math.max(prevDisplay, nextDist);

    const frameStep = boat.currentDisplayDist - prevDisplay;
    frameDeltas.push(frameStep);

    // Monotonicity: never moves backward
    assert.ok(frameStep >= 0, `Frame ${frame}: kayak must never move backward (delta=${frameStep})`);
    // Fluidity: while actively rowing at 200W, kayak advances on EVERY single frame (never stalls at 0 between 1.5s packets)
    assert.ok(frameStep > 0.015, `Frame ${frame}: kayak must advance smoothly on every frame without stalling (delta=${frameStep})`);
    // No jerky snap: a single 60fps frame step at 200W (~0.069m/frame) must never jump by > 0.20m
    assert.ok(frameStep < 0.20, `Frame ${frame}: kayak must not jump abruptly in a single frame (delta=${frameStep})`);
  }

  // After 6 seconds at ~4.15 m/s, total distance should be closely aligned with ~24.9m
  assert.ok(
    Math.abs(boat.currentDisplayDist - 6 * c2Speed) < 1.0,
    `After 6s at 200W, display distance (${boat.currentDisplayDist.toFixed(2)}m) must closely track physical FTMS distance (${(6 * c2Speed).toFixed(2)}m)`
  );
});
