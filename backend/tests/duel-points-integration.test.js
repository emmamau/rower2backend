const { test, describe } = require("node:test");
const assert = require("node:assert");
const { calculateRacePointsBreakdown } = require("../dist/utils/league.util");

describe("Duel 1v1 Points Integration avec Adversaire Capé", () => {
  test("Victoire contre un joueur d'une ligue supérieure (Bronze contre Or)", () => {
    // Joueur Bronze (tier BRONZE, 2 victoires) bat Joueur Or (tier GOLD, 2 victoires)
    const breakdown = calculateRacePointsBreakdown({
      raceMode: "DUEL_1V1",
      playerRank: 1,
      totalHumanFinishers: 2,
      playerLeagueTier: "BRONZE",
      playerWins: 2,
      opponentLeagueTier: "GOLD",
      opponentWins: 2
    });

    // 40 base/podium + 25 ligue sup = 65 pts
    assert.strictEqual(breakdown.higherRankedBonus, 25);
    assert.strictEqual(breakdown.totalPoints, 65);
    assert.match(breakdown.description, /ligue sup/i);
  });

  test("Victoire contre un adversaire ayant un meilleur palmarès de victoires", () => {
    // Joueur Bronze (5 victoires) bat Joueur Bronze (20 victoires)
    const breakdown = calculateRacePointsBreakdown({
      raceMode: "DUEL_1V1",
      playerRank: 1,
      totalHumanFinishers: 2,
      playerLeagueTier: "BRONZE",
      playerWins: 5,
      opponentLeagueTier: "BRONZE",
      opponentWins: 20
    });

    // 40 base/podium + 15 palmarès sup = 55 pts
    assert.strictEqual(breakdown.higherRankedBonus, 15);
    assert.strictEqual(breakdown.totalPoints, 55);
    assert.match(breakdown.description, /palmarès sup/i);
  });

  test("Cumul : Victoire contre un joueur de ligue supérieure ET palmarès supérieur (Or + 30 victoires)", () => {
    // Joueur Bronze (1 victoire) bat Joueur Or (30 victoires)
    const breakdown = calculateRacePointsBreakdown({
      raceMode: "DUEL_1V1",
      playerRank: 1,
      totalHumanFinishers: 2,
      playerLeagueTier: "BRONZE",
      playerWins: 1,
      opponentLeagueTier: "GOLD",
      opponentWins: 30
    });

    // 40 base/podium + 25 ligue sup + 15 palmarès sup = 80 pts
    assert.strictEqual(breakdown.higherRankedBonus, 40);
    assert.strictEqual(breakdown.totalPoints, 80);
    assert.match(breakdown.description, /ligue sup.*palmarès sup/i);
  });

  test("Défaite contre un joueur plus capé : 10 pts garantis de participation (pas de malus)", () => {
    const breakdown = calculateRacePointsBreakdown({
      raceMode: "DUEL_1V1",
      playerRank: 2,
      totalHumanFinishers: 2,
      playerLeagueTier: "BRONZE",
      playerWins: 1,
      opponentLeagueTier: "GOLD",
      opponentWins: 30
    });

    assert.strictEqual(breakdown.totalPoints, 10);
    assert.match(breakdown.description, /participation/i);
  });
});
