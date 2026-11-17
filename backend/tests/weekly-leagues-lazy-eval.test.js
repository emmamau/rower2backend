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

test("Points Rules: BOT mode awards 5 pts for win, 2 pts for defeat, capped at 3 rewarded races per day", () => {
  // 1st place under cap: 5 pts
  assert.strictEqual(
    calculateRacePointsEarned({
      raceMode: "BOT",
      playerRank: 1,
      todayRewardedBotRacesCount: 0,
    }),
    5
  );
  assert.strictEqual(
    calculateRacePointsEarned({
      raceMode: "BOT",
      playerRank: 1,
      todayRewardedBotRacesCount: 2,
    }),
    5
  );

  // 2nd+ place under cap: 2 pts
  assert.strictEqual(
    calculateRacePointsEarned({
      raceMode: "BOT",
      playerRank: 2,
      todayRewardedBotRacesCount: 1,
    }),
    2
  );
  assert.strictEqual(
    calculateRacePointsEarned({
      raceMode: "BOT",
      playerRank: 4,
      todayRewardedBotRacesCount: 2,
    }),
    2
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

test("Points Rules: Human DUEL_1V1 awards exact base + rank bonus + podium with 1.0 multiplier", () => {
  // DUEL_1V1 (2 finishers)
  // Rank 1: base(10) + (2 - 1)*15 (15) + podium 1st(20) = 45 * 1.0 = 45 pts
  const winPts = calculateRacePointsEarned({
    raceMode: "DUEL_1V1",
    playerRank: 1,
    totalHumanFinishers: 2,
  });
  assert.strictEqual(winPts, 45);

  // Rank 2: base(10) + (2 - 2)*15 (0) + podium 2nd(10) = 20 * 1.0 = 20 pts
  const secondPts = calculateRacePointsEarned({
    raceMode: "DUEL_1V1",
    playerRank: 2,
    totalHumanFinishers: 2,
  });
  assert.strictEqual(secondPts, 20);
});

test("Points Rules: Human MULTIPLAYER awards exact base + rank bonus + podium with 1.2 multiplier", () => {
  // 5 human finishers
  // Rank 1: base(10) + (5 - 1)*15 (60) + podium 1st(20) = 90 * 1.2 = 108 pts
  const first = calculateRacePointsEarned({
    raceMode: "MULTIPLAYER",
    playerRank: 1,
    totalHumanFinishers: 5,
  });
  assert.strictEqual(first, 108);

  // Rank 2: base(10) + (5 - 2)*15 (45) + podium 2nd(10) = 65 * 1.2 = 78 pts
  const second = calculateRacePointsEarned({
    raceMode: "MULTIPLAYER",
    playerRank: 2,
    totalHumanFinishers: 5,
  });
  assert.strictEqual(second, 78);

  // Rank 3: base(10) + (5 - 3)*15 (30) + podium 3rd(5) = 45 * 1.2 = 54 pts
  const third = calculateRacePointsEarned({
    raceMode: "MULTIPLAYER",
    playerRank: 3,
    totalHumanFinishers: 5,
  });
  assert.strictEqual(third, 54);

  // Rank 4: base(10) + (5 - 4)*15 (15) + podium 4th(0) = 25 * 1.2 = 30 pts
  const fourth = calculateRacePointsEarned({
    raceMode: "MULTIPLAYER",
    playerRank: 4,
    totalHumanFinishers: 5,
  });
  assert.strictEqual(fourth, 30);
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
