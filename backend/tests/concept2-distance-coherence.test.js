const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { TelemetryValidator } = require('../dist/services/telemetry-validator.service');
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const initRaceRoutes = require('../dist/routes/race.routes').default;
const db = require('../dist/models').default;

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  initTelemetryRoutes(app);
  initRaceRoutes(app);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((resClose) => server.close(resClose)),
      });
    });
  });
}

test('Concept2 formula unit check: Power <-> Speed <-> Split coherence across all rower models', () => {
  // At 203W: v = (203 / 2.80)^(1/3) = 4.1698 m/s -> split = 500 / 4.1698 = 120s (2:00/500m)
  const speed203 = TelemetryValidator.computeConcept2Speed(203);
  assert.ok(Math.abs(speed203 - 4.17) < 0.02, `Expected ~4.17 m/s for 203W, got ${speed203}`);
  assert.equal(TelemetryValidator.computeConcept2Split(203), 120);

  // Even if a non-Concept2 rower sends a mismatched splitSec (e.g. 155s for 203W), validate() normalizes splitSec to 120s
  const valMerach = TelemetryValidator.validate(
    {
      raceId: 'R1',
      userId: 'u_merach',
      seq: 1,
      timestamp: Date.now(),
      metrics: {
        distanceM: 2,
        splitSec: 155,
        powerWatts: 203,
        strokeRate: 26,
      },
    },
    0,
    0,
    1
  );
  assert.equal(valMerach.sanitizedPower, 203);
  assert.equal(valMerach.sanitizedSplit, 120, 'Split must be normalized to Concept2 120s (2:00/500m) for 203W');
});

test('Salon race: strict speed and distance coherence across different rower models at equal power (203W -> 2:00/500m -> 4.17m/s)', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // Create a private salon race
    const resCreate = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Salon Multi-Modèles Concept2',
        targetDistance: 2000,
        maxParticipants: 4,
        hostUserId: 'emmaRacer',
        hostUserName: 'EmmaRacer',
        requireApproval: false,
      }),
    });
    assert.equal(resCreate.status, 201);
    const salon = await resCreate.json();
    const raceId = salon.race.id;
    const code = salon.code;

    // Start the salon race immediately (countdownSeconds: 0 -> RUNNING)
    const resStart = await fetch(`${baseUrl}/api/v1/races/private/${code}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: 'emmaRacer',
        countdownSeconds: 0,
      }),
    });
    assert.equal(resStart.status, 200);

    // Simulate 12 seconds of rowing at 203W (2:00/500m = 4.17 m/s -> 50m in 12s) on 3 different rower models:
    // - Rower A (under-calibrated magnetic rower): sends distanceM += 1m/s and wrong splitSec = 160s, but powerWatts = 203W
    // - Rower B (Concept2 PM5): sends distanceM += 4m/s, splitSec = 120s, powerWatts = 203W
    // - Rower C (over-calibrated wheel rower): sends distanceM += 9m/s and wrong splitSec = 95s, but powerWatts = 203W
    let lastResA, lastResB, lastResC;
    for (let sec = 1; sec <= 12; sec++) {
      const [rA, rB, rC] = await Promise.all([
        fetch(`${baseUrl}/api/v1/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            raceId,
            userId: 'racer_merach',
            userName: 'MerachRower',
            rowerModel: 'Merach MR-R02',
            seq: sec,
            elapsedTime: sec,
            metrics: {
              distanceM: sec * 1, // severely under-reported hardware distance (12m in 12s)
              splitSec: 160,      // uncalibrated native split
              powerWatts: 203,
              strokeRate: 26,
            },
          }),
        }).then((r) => r.json()),
        fetch(`${baseUrl}/api/v1/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            raceId,
            userId: 'racer_c2',
            userName: 'Concept2Rower',
            rowerModel: 'Concept2 PM5',
            seq: sec,
            elapsedTime: sec,
            metrics: {
              distanceM: Math.round(sec * 4.17),
              splitSec: 120,
              powerWatts: 203,
              strokeRate: 26,
            },
          }),
        }).then((r) => r.json()),
        fetch(`${baseUrl}/api/v1/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            raceId,
            userId: 'racer_generic',
            userName: 'GenericFTMS',
            rowerModel: 'Generic FTMS',
            seq: sec,
            elapsedTime: sec,
            metrics: {
              distanceM: sec * 9, // over-reported hardware distance
              splitSec: 95,
              powerWatts: 203,
              strokeRate: 26,
            },
          }),
        }).then((r) => r.json()),
      ]);
      lastResA = rA;
      lastResB = rB;
      lastResC = rC;
    }

    // Expected Concept2 distance after 12s at 203W (4.17 m/s): 12 * 4.1699 = 50.04m -> 50m
    assert.equal(lastResA.normDistM, 50, `Under-reporting rower must advance to 50m via Concept2 formula, got ${lastResA.normDistM}`);
    assert.equal(lastResB.normDistM, 50, `Concept2 PM5 rower must advance to 50m, got ${lastResB.normDistM}`);
    assert.equal(lastResC.normDistM, 50, `Over-reporting rower must be normalized to 50m via Concept2 formula, got ${lastResC.normDistM}`);
  } finally {
    await close();
  }
});

test('1v1 Bot Duel in COUNTDOWN starts immediately on first stroke without false-start distance reset', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const guestId = `guest_duel_start_${Date.now()}`;
    const resCreate = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isBotDuel: true,
        botStartMode: 'first_stroke',
        targetDistance: 2000,
        hostUserId: guestId,
        hostUserName: 'BotDuelRacer',
      }),
    });
    assert.equal(resCreate.status, 201);
    const duel = await resCreate.json();
    const raceId = duel.race.id;
    const pin = duel.pinCode || duel.race.pinCode;

    // Watch claims PIN -> transitions bot duel room into COUNTDOWN
    const resPin = await fetch(`${baseUrl}/api/v1/races/pin/${pin}?userId=${guestId}&userName=BotDuelRacer`);
    assert.equal(resPin.status, 200);

    // Athlete takes first strokes right away while room is in COUNTDOWN
    const resStroke1 = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceId,
        userId: guestId,
        userName: 'BotDuelRacer',
        seq: 1,
        elapsedTime: 1,
        metrics: {
          distanceM: 4,
          splitSec: 120,
          powerWatts: 203,
          strokeRate: 28,
        },
      }),
    });
    assert.equal(resStroke1.status, 200);
    const stroke1Data = await resStroke1.json();
    assert.equal(stroke1Data.falseStart, false, 'Must not trigger false start in Bot Duel');
    assert.equal(stroke1Data.status, 'RUNNING', 'Bot Duel must transition to RUNNING on first stroke');
    assert.equal(stroke1Data.normDistM, 4, 'First second at 203W must record 4m');
  } finally {
    await close();
  }
});

test('Finish line synchronization: watch reaching targetDistance in same second as 999m packet completes race at 1000m without staying stuck at 999m', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const userStore = require('../dist/services/user-store.service').default;
    const initActivityRoutes = require('../dist/routes/activity.routes').default;
    const racerId = `finish_sync_${Date.now()}`;

    const resCreate = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isSolo: true,
        targetDistance: 1000,
        hostUserId: racerId,
        hostUserName: 'FinishLineRacer',
      }),
    });
    assert.equal(resCreate.status, 201);
    const created = await resCreate.json();
    const raceId = created.race.id;

    // Seed racer at 995m at elapsed 238s
    userStore.recordActivity({
      id: `${raceId}_${racerId}`,
      activityId: raceId,
      userId: racerId,
      userName: 'FinishLineRacer',
      targetDistance: 1000,
      currentDistance: 995,
      netDistance: 995,
      exactDistance: 995.0,
      exactElapsedSec: 238,
      lastTelemetryAtMs: Date.now() - 1000,
      elapsedTime: 238,
      status: 'in_progress',
      isBot: false,
    });

    // 1. Tick at 239s: 203W (~4.17 m/s) -> 995 + 4.17 = 999.17m -> rounds to 999m
    const res999 = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceId,
        userId: racerId,
        userName: 'FinishLineRacer',
        status: 'in_progress',
        targetDistance: 1000,
        seq: 99,
        elapsedTime: 239,
        currentDistance: 999,
        metrics: {
          distanceM: 999,
          splitSec: 120,
          powerWatts: 203,
          strokeRate: 28,
        },
      }),
    });
    assert.equal(res999.status, 200);
    const data999 = await res999.json();
    assert.equal(data999.normDistM, 999);
    assert.equal(data999.isFinished, false);

    // 2. A few milliseconds later (still elapsedTime: 239), watch stroke crosses 1000m and sends status: "completed"
    const res1000 = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceId,
        userId: racerId,
        userName: 'FinishLineRacer',
        status: 'completed',
        targetDistance: 1000,
        seq: 100,
        elapsedTime: 239,
        currentDistance: 1000,
        metrics: {
          distanceM: 1000,
          splitSec: 120,
          powerWatts: 203,
          strokeRate: 28,
        },
      }),
    });
    assert.equal(res1000.status, 200);
    const data1000 = await res1000.json();
    assert.equal(data1000.normDistM, 1000, 'Server must snap normDistM to 1000m when watch completes race');
    assert.equal(data1000.isFinished, true, 'isFinished must be true');

    // 3. Even if an out-of-order in_progress packet at 999m arrives late, distance and status must stay finished at 1000m
    const resLate = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceId,
        userId: racerId,
        userName: 'FinishLineRacer',
        status: 'in_progress',
        targetDistance: 1000,
        seq: 99,
        elapsedTime: 239,
        currentDistance: 999,
        metrics: {
          distanceM: 999,
          splitSec: 120,
          powerWatts: 203,
          strokeRate: 28,
        },
      }),
    });
    assert.equal(resLate.status, 200);
    const dataLate = await resLate.json();
    assert.equal(dataLate.normDistM, 1000, 'Late packet must not roll back finished distance to 999m');
    assert.equal(dataLate.isFinished, true);
  } finally {
    await close();
  }
});
