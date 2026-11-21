const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const express = require("express");

const {
  calculateRacePointsEarned,
  WEEKLY_LEAGUES,
  getLeagueByTier,
  getLeagueByPoints,
} = require("../dist/utils/league.util");
const initLeagueRoutes = require("../dist/routes/league.routes").default;
const userStore = require("../dist/services/user-store.service").default;

function createTestApp() {
  const app = express();
  app.use(express.json());
  initLeagueRoutes(app);
  return app;
}

test("Points Rules: DNF (abandoned) always awards 0 points regardless of mode or rank", () => {
  assert.strictEqual(
    calculateRacePointsEarned({ raceMode: "BOT", playerRank: 1, isDnf: true }),
    0
  );
  assert.strictEqual(
    calculateRacePointsEarned({ raceMode: "DUEL_1V1", playerRank: 1, isDnf: true }),
    0
  );
  assert.strictEqual(
    calculateRacePointsEarned({ raceMode: "MULTIPLAYER", playerRank: 1, isDnf: true }),
    0
  );
  assert.strictEqual(
    calculateRacePointsEarned({ raceMode: "MULTIPLAYER", playerRank: 1, isFinisher: false }),
    0
  );
});

test("Points Rules: BOT mode awards 10 pts for win, 5 pts for defeat, capped at 3 rewarded races per day", () => {
  // 1st place under cap: 10 pts
  assert.strictEqual(
    calculateRacePointsEarned({
      raceMode: "BOT",
      playerRank: 1,
      todayRewardedBotRacesCount: 0,
    }),
    10
  );
  assert.strictEqual(
    calculateRacePointsEarned({
      raceMode: "BOT",
      playerRank: 1,
      todayRewardedBotRacesCount: 2,
    }),
    10
  );

  // 2nd+ place under cap: 5 pts
  assert.strictEqual(
    calculateRacePointsEarned({
      raceMode: "BOT",
      playerRank: 2,
      todayRewardedBotRacesCount: 1,
    }),
    5
  );
  assert.strictEqual(
    calculateRacePointsEarned({
      raceMode: "BOT",
      playerRank: 4,
      todayRewardedBotRacesCount: 2,
    }),
    5
  );

  // Beyond daily cap (3+ rewarded bot races already done today): 0 pts
  assert.strictEqual(
    calculateRacePointsEarned({
      raceMode: "BOT",
      playerRank: 1,
      todayRewardedBotRacesCount: 3,
    }),
    0
  );
  assert.strictEqual(
    calculateRacePointsEarned({
      raceMode: "BOT",
      playerRank: 1,
      todayRewardedBotRacesCount: 5,
    }),
    0
  );
});

test("Points Rules: Human DUEL_1V1 awards 40 pts for win and 10 pts for loss (standard)", () => {
  // DUEL_1V1 standard (2 finishers)
  // Rank 1: base(10) + (2 - 1)*10 (10) + podium 1st(20) = 40 pts
  const winPts = calculateRacePointsEarned({
    raceMode: "DUEL_1V1",
    playerRank: 1,
    totalHumanFinishers: 2,
  });
  assert.strictEqual(winPts, 40);

  // Rank 2: base(10) = 10 pts
  const secondPts = calculateRacePointsEarned({
    raceMode: "DUEL_1V1",
    playerRank: 2,
    totalHumanFinishers: 2,
  });
  assert.strictEqual(secondPts, 10);
});

test("Points Rules: Human MULTIPLAYER awards base 10 + 10 per beaten racer + podium, with 1.25 peloton multiplier when > 4", () => {
  // 5 human finishers (finishers > 4 -> multiplier 1.25)
  // Rank 1: (base 10 + 4*10 + podium 20) * 1.25 = 70 * 1.25 = 87.5 -> 88 pts
  const first = calculateRacePointsEarned({
    raceMode: "MULTIPLAYER",
    playerRank: 1,
    totalHumanFinishers: 5,
  });
  assert.strictEqual(first, 88);

  // Rank 2: (base 10 + 3*10 + podium 10) * 1.25 = 50 * 1.25 = 62.5 -> 63 pts
  const second = calculateRacePointsEarned({
    raceMode: "MULTIPLAYER",
    playerRank: 2,
    totalHumanFinishers: 5,
  });
  assert.strictEqual(second, 63);

  // Rank 3: (base 10 + 2*10 + podium 5) * 1.25 = 35 * 1.25 = 43.75 -> 44 pts
  const third = calculateRacePointsEarned({
    raceMode: "MULTIPLAYER",
    playerRank: 3,
    totalHumanFinishers: 5,
  });
  assert.strictEqual(third, 44);

  // Rank 4: (base 10 + 1*10 + 0) * 1.25 = 20 * 1.25 = 25 pts
  const fourth = calculateRacePointsEarned({
    raceMode: "MULTIPLAYER",
    playerRank: 4,
    totalHumanFinishers: 5,
  });
  assert.strictEqual(fourth, 25);
});

test("League Tiers: 3 Official Weekly Leagues (Gold, Silver, Bronze)", () => {
  assert.strictEqual(WEEKLY_LEAGUES.GOLD.name, "Or");
  assert.strictEqual(WEEKLY_LEAGUES.GOLD.badge, "🥇");

  assert.strictEqual(WEEKLY_LEAGUES.SILVER.name, "Argent");
  assert.strictEqual(WEEKLY_LEAGUES.SILVER.badge, "🥈");

  assert.strictEqual(WEEKLY_LEAGUES.BRONZE.name, "Bronze");
  assert.strictEqual(WEEKLY_LEAGUES.BRONZE.badge, "🥉");

  assert.strictEqual(getLeagueByTier("GOLD").tier, "GOLD");
  assert.strictEqual(getLeagueByTier("SILVER").tier, "SILVER");
  assert.strictEqual(getLeagueByTier("BRONZE").tier, "BRONZE");
  assert.strictEqual(getLeagueByTier("UNKNOWN").tier, "BRONZE");
});

test("API: GET /api/leagues/standings returns standings, zones, and cutoffs", async () => {
  const app = createTestApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/leagues/standings?tier=BRONZE`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.tier, "BRONZE");
    assert.ok(Array.isArray(data.standings));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("API: PATCH /api/users/resting-mode activates and deactivates vacation mode", async () => {
  const app = createTestApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const testUser = await userStore.createUser({
      id: "resting_test_user_1",
      name: "Resting Tester",
      login: "resting_tester",
    });

    // 1. Activer le mode vacances
    const patchRes = await fetch(`http://127.0.0.1:${port}/api/users/resting-mode`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: testUser.id, isResting: true }),
    });
    assert.strictEqual(patchRes.status, 200);
    const patchJson = await patchRes.json();
    assert.strictEqual(patchJson.success, true);
    assert.strictEqual(patchJson.isResting, true);

    const fetchedUser = await userStore.findUser(testUser.id);
    assert.strictEqual(fetchedUser.isResting, true);

    // 2. Désactiver le mode vacances
    const deactRes = await fetch(`http://127.0.0.1:${port}/api/users/resting-mode`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: testUser.id, isResting: false }),
    });
    assert.strictEqual(deactRes.status, 200);
    const deactJson = await deactRes.json();
    assert.strictEqual(deactJson.success, true);
    assert.strictEqual(deactJson.isResting, false);

    const activeUser = await userStore.findUser(testUser.id);
    assert.strictEqual(activeUser.isResting, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
