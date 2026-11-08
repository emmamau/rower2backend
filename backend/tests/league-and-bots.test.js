const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

const express = require("express");
const {
  calculateRacePoints,
  getLeagueByPoints,
  generateRealisticBotPace,
  calculateBotPhysics,
  LEAGUES
} = require("../dist/utils/league.util");
const initRaceRoutes = require("../dist/routes/race.routes").default;
const raceManager = require("../dist/services/race-manager.service").default;

function createTestApp() {
  const app = express();
  app.use(express.json());
  initRaceRoutes(app);
  return app;
}

test("League & Points: calculateRacePoints formula matches specification", () => {
  // Non-finishers / abandoned get 0 points
  assert.strictEqual(calculateRacePoints(1, 10, false), 0);
  assert.strictEqual(calculateRacePoints(0, 10, true), 0);

  // Single racer: BaseFinish (10) + (1 - 1 + 1)/1 * (5 * 1) = 10 + 5 = 15
  assert.strictEqual(calculateRacePoints(1, 1, true), 15);

  // 10 racers:
  // 1st place: 10 + (10 - 1 + 1)/10 * (5 * 10) = 10 + 1 * 50 = 60
  assert.strictEqual(calculateRacePoints(1, 10, true), 60);

  // 10th place: 10 + (10 - 10 + 1)/10 * 50 = 10 + 1/10 * 50 = 10 + 5 = 15
  assert.strictEqual(calculateRacePoints(10, 10, true), 15);

  // 5th place of 10: 10 + (10 - 5 + 1)/10 * 50 = 10 + 6/10 * 50 = 10 + 30 = 40
  assert.strictEqual(calculateRacePoints(5, 10, true), 40);

  // Guarantee: victory against large pack (10 participants => 60 pts) yields significantly more than duel (2 participants => 20 pts)
  const duelWinPoints = calculateRacePoints(1, 2, true);
  const largePackWinPoints = calculateRacePoints(1, 10, true);
  assert.strictEqual(duelWinPoints, 20); // 10 + (2/2) * 10 = 20
  assert.ok(largePackWinPoints > duelWinPoints * 2, "Victory in 10-boat regatta should earn at least double a 2-boat duel");
});

test("League & Points: getLeagueByPoints tiers and badges", () => {
  assert.strictEqual(getLeagueByPoints(0).id, "bronze");
  assert.strictEqual(getLeagueByPoints(50).badge, "🥉");
  assert.strictEqual(getLeagueByPoints(99).id, "bronze");

  assert.strictEqual(getLeagueByPoints(100).id, "silver");
  assert.strictEqual(getLeagueByPoints(200).badge, "🥈");
  assert.strictEqual(getLeagueByPoints(299).id, "silver");

  assert.strictEqual(getLeagueByPoints(300).id, "gold");
  assert.strictEqual(getLeagueByPoints(450).badge, "🥇");
  assert.strictEqual(getLeagueByPoints(599).id, "gold");

  assert.strictEqual(getLeagueByPoints(600).id, "platinum");
  assert.strictEqual(getLeagueByPoints(800).badge, "💎");
  assert.strictEqual(getLeagueByPoints(999).id, "platinum");

  assert.strictEqual(getLeagueByPoints(1000).id, "diamond");
  assert.strictEqual(getLeagueByPoints(2500).badge, "👑");
});

test("Bot Balancing: Realistic pace range and asymmetric probability tiers", () => {
  const sampleCount = 2000;
  let fastTier = 0; // 110s - 125s (1m50s - 2m05s)
  let midTier = 0;  // 125s - 140s (2m05s - 2m20s)
  let slowTier = 0; // 140s - 165s (2m20s - 2m45s)

  for (let i = 0; i < sampleCount; i++) {
    const pace = generateRealisticBotPace();

    // Check bounds: [110, 165]
    assert.ok(pace >= 110, `Pace ${pace} should be >= 110s (1m50s)`);
    assert.ok(pace <= 165, `Pace ${pace} should be <= 165s (2m45s)`);

    if (pace < 125) {
      fastTier++;
    } else if (pace < 140) {
      midTier++;
    } else {
      slowTier++;
    }
  }

  const fastRatio = fastTier / sampleCount;
  const midRatio = midTier / sampleCount;
  const slowRatio = slowTier / sampleCount;

  // Expected: fast ~10% (5% - 15%), mid ~30% (22% - 38%), slow ~60% (52% - 68%)
  assert.ok(fastRatio >= 0.05 && fastRatio <= 0.16, `Fast ratio ${fastRatio} should be ~10%`);
  assert.ok(midRatio >= 0.22 && midRatio <= 0.38, `Mid ratio ${midRatio} should be ~30%`);
  assert.ok(slowRatio >= 0.52 && slowRatio <= 0.68, `Slow ratio ${slowRatio} should be ~60%`);

  // Verify Concept2 physics derivation: 500 / pace = speed, Watts = 2.80 * speed^3
  const physics = calculateBotPhysics(120); // 2m00s / 500m => speed = 4.1667 m/s
  assert.ok(Math.abs(physics.speedMs - (500 / 120)) < 0.01);
  const expectedWatts = Math.round(2.80 * Math.pow(500 / 120, 3));
  assert.strictEqual(physics.power, expectedWatts);
});

test("API: GET /api/races/:id/leaderboard returns complete detailed past race standings", async () => {
  const userStore = require("../dist/services/user-store.service").default;
  const app = createTestApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. Non-existent race returns 404
    const notFoundRes = await fetch(`http://127.0.0.1:${port}/api/races/non-existent-race-id/leaderboard`);
    assert.strictEqual(notFoundRes.status, 404);
    const notFoundJson = await notFoundRes.json();
    assert.strictEqual(notFoundJson.success, false);

    // 2. Active or finished race: create a race via raceManager
    const newRace = { id: "race_test_123", title: "Régate Test Championnat", targetDistance: 2000, status: "finished" };
    
    await userStore.recordActivity({
      id: "act_1",
      activityId: newRace.id,
      userId: "racer_1",
      userName: "Alice Championne",
      netDistance: 2000,
      elapsedTime: 480,
      avgPace: 120,
      finalRank: 1,
      status: "finished",
      isBot: false,
    });
    await userStore.recordActivity({
      id: "act_2",
      activityId: newRace.id,
      userId: "racer_2",
      userName: "Bob Challenger",
      netDistance: 1950,
      elapsedTime: 510,
      avgPace: 130,
      finalRank: 2,
      status: "finished",
      isBot: false,
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/races/${newRace.id}/leaderboard`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.success, true);
    assert.ok(data.race);
    assert.strictEqual(data.race.id, newRace.id);
    assert.ok(Array.isArray(data.leaderboard));
    assert.strictEqual(data.leaderboard.length, 2);

    // Leaderboard details
    const winner = data.leaderboard[0];
    assert.strictEqual(winner.position, 1);
    assert.strictEqual(winner.userId, "racer_1");
    assert.strictEqual(winner.userName, "Alice Championne");
    assert.ok(winner.points > 0, "Winner should receive points");
    assert.strictEqual(winner.points, 20);
    assert.ok(winner.league, "Winner should have league badge info");
    assert.ok(winner.gap, "Winner should have a gap/status string");

    const second = data.leaderboard[1];
    assert.strictEqual(second.position, 2);
    assert.strictEqual(second.userId, "racer_2");
    assert.ok(second.gap.startsWith("+"), "Second place gap should be positive seconds");

    // 3. Edge case: 100% of participants abandon the race
    const abandonedRace = { id: "race_abandoned_999", title: "Régate Tempête", targetDistance: 2000, status: "finished" };
    await userStore.recordActivity({
      id: "act_ab_1",
      activityId: abandonedRace.id,
      userId: "racer_ab_1",
      userName: "Racer Abandons",
      netDistance: 450,
      elapsedTime: 120,
      avgPace: 133,
      finalRank: 1,
      status: "abandoned",
      isBot: false,
    });

    const abRes = await fetch(`http://127.0.0.1:${port}/api/races/${abandonedRace.id}/leaderboard`);
    assert.strictEqual(abRes.status, 200);
    const abData = await abRes.json();
    assert.strictEqual(abData.success, true);
    assert.strictEqual(abData.leaderboard.length, 1);
    const abPlayer = abData.leaderboard[0];
    assert.strictEqual(abPlayer.status, "abandoned");
    assert.strictEqual(abPlayer.points, 0, "Abandoned participant must receive 0 points");
    assert.strictEqual(abPlayer.gap, "Abandon", "Gap should indicate abandonment rather than Leader or Vainqueur");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
