const { test, describe } = require("node:test");
const assert = require("node:assert");
const {
  calculateRacePointsEarned,
  calculateRacePointsBreakdown,
  WEEKLY_LEAGUES
} = require("../dist/utils/league.util");

describe("Système de Points Rééquilibré (league.util)", () => {
  test("1. Règle DNF / Abandon : toujours 0 point quel que soit le mode", () => {
    const ptsDnf = calculateRacePointsEarned({
      raceMode: "MULTIPLAYER",
      playerRank: 1,
      totalHumanFinishers: 6,
      isFinisher: false,
      isDnf: true
    });
    assert.strictEqual(ptsDnf, 0);

    const breakdown = calculateRacePointsBreakdown({
      raceMode: "DUEL_1V1",
      playerRank: 1,
      totalHumanFinishers: 2,
      isFinisher: false,
      isDnf: true
    });
    assert.strictEqual(breakdown.totalPoints, 0);
    assert.match(breakdown.description, /abandon|dnf/i);
  });

  test("2. Mode BOT / SOLO : 10 pts si victoire, 5 pts si défaite/finisher, max 3 par jour", () => {
    // 1ère course bot : Victoire (1er) -> 10 pts
    const win1 = calculateRacePointsBreakdown({
      raceMode: "BOT",
      playerRank: 1,
      todayRewardedBotRacesCount: 0
    });
    assert.strictEqual(win1.totalPoints, 10);
    assert.match(win1.description, /10 pts/);

    // 2ème course bot : Défaite / 2e -> 5 pts
    const loss2 = calculateRacePointsBreakdown({
      raceMode: "BOT",
      playerRank: 2,
      todayRewardedBotRacesCount: 1
    });
    assert.strictEqual(loss2.totalPoints, 5);
    assert.match(loss2.description, /5 pts/);

    // 3ème course bot : Défaite / 3e -> 5 pts
    const loss3 = calculateRacePointsEarned({
      raceMode: "SOLO",
      playerRank: 3,
      todayRewardedBotRacesCount: 2
    });
    assert.strictEqual(loss3, 5);

    // 4ème course bot : Plafond dépassé (>= 3) -> 0 pt
    const capped = calculateRacePointsBreakdown({
      raceMode: "BOT",
      playerRank: 1,
      todayRewardedBotRacesCount: 3
    });
    assert.strictEqual(capped.totalPoints, 0);
    assert.match(capped.description, /plafond/i);
  });

  test("3. Duel 1v1 standard (même niveau) : 40 pts si vainqueur, 10 pts si perdant", () => {
    // Vainqueur standard (1er sur 2)
    const winner = calculateRacePointsBreakdown({
      raceMode: "DUEL_1V1",
      playerRank: 1,
      totalHumanFinishers: 2,
      playerLeagueTier: "BRONZE",
      playerWins: 5,
      opponentLeagueTier: "BRONZE",
      opponentWins: 4
    });
    // Base 10 + 1 battu * 10 + Podium 1er 20 = 40 pts
    assert.strictEqual(winner.basePoints, 10);
    assert.strictEqual(winner.rankPoints, 10);
    assert.strictEqual(winner.podiumBonus, 20);
    assert.strictEqual(winner.higherRankedBonus, 0);
    assert.strictEqual(winner.totalPoints, 40);

    // Perdant standard (2e sur 2)
    const loser = calculateRacePointsBreakdown({
      raceMode: "DUEL_1V1",
      playerRank: 2,
      totalHumanFinishers: 2,
      playerLeagueTier: "BRONZE",
      opponentLeagueTier: "BRONZE"
    });
    assert.strictEqual(loser.totalPoints, 10);
  });

  test("4. Duel 1v1 contre joueur plus capé : bonus prestige en cas de victoire", () => {
    // Cas A : Joueur Bronze bat joueur Argent (ligue supérieure -> +25 pts)
    const winTierDiff = calculateRacePointsBreakdown({
      raceMode: "DUEL_1V1",
      playerRank: 1,
      totalHumanFinishers: 2,
      playerLeagueTier: "BRONZE",
      playerWins: 10,
      opponentLeagueTier: "SILVER",
      opponentWins: 8
    });
    // 40 standard + 25 ligue sup = 65 pts
    assert.strictEqual(winTierDiff.higherRankedBonus, 25);
    assert.strictEqual(winTierDiff.totalPoints, 65);

    // Cas B : Joueur Bronze bat joueur Or très capé (ligue sup +25 ET palmarès supérieur +15)
    const winHuge = calculateRacePointsBreakdown({
      raceMode: "DUEL_1V1",
      playerRank: 1,
      totalHumanFinishers: 2,
      playerLeagueTier: "BRONZE",
      playerWins: 3,
      opponentLeagueTier: "GOLD",
      opponentWins: 25
    });
    // 40 standard + 25 ligue sup + 15 palmarès sup = 80 pts
    assert.strictEqual(winHuge.higherRankedBonus, 40);
    assert.strictEqual(winHuge.totalPoints, 80);

    // Cas C : Joueur Bronze perd contre joueur Or -> Base normale de 10 pts (pas de bonus ni pénalité)
    const lossHuge = calculateRacePointsBreakdown({
      raceMode: "DUEL_1V1",
      playerRank: 2,
      totalHumanFinishers: 2,
      playerLeagueTier: "BRONZE",
      playerWins: 3,
      opponentLeagueTier: "GOLD",
      opponentWins: 25
    });
    assert.strictEqual(lossHuge.totalPoints, 10);
  });

  test("5. Multijoueur petit peloton (<= 4 participants) : Base 10 + 10 par rameur battu + Podium, mult 1.0", () => {
    // Course à 4 rameurs
    const p1 = calculateRacePointsBreakdown({ raceMode: "MULTIPLAYER", playerRank: 1, totalHumanFinishers: 4 });
    // (10 base + 3 battus * 10 + 20 podium) * 1.0 = 60 pts
    assert.strictEqual(p1.totalPoints, 60);

    const p2 = calculateRacePointsBreakdown({ raceMode: "MULTIPLAYER", playerRank: 2, totalHumanFinishers: 4 });
    // (10 base + 2 battus * 10 + 10 podium) * 1.0 = 40 pts
    assert.strictEqual(p2.totalPoints, 40);

    const p3 = calculateRacePointsBreakdown({ raceMode: "MULTIPLAYER", playerRank: 3, totalHumanFinishers: 4 });
    // (10 base + 1 battu * 10 + 5 podium) * 1.0 = 25 pts
    assert.strictEqual(p3.totalPoints, 25);

    const p4 = calculateRacePointsBreakdown({ raceMode: "MULTIPLAYER", playerRank: 4, totalHumanFinishers: 4 });
    // (10 base + 0 battus + 0 podium) * 1.0 = 10 pts
    assert.strictEqual(p4.totalPoints, 10);
  });

  test("6. Multijoueur grand peloton (> 4 participants) : multiplicateur de peloton x1.25", () => {
    // Course à 6 rameurs
    const p1 = calculateRacePointsBreakdown({ raceMode: "MULTIPLAYER", playerRank: 1, totalHumanFinishers: 6 });
    // (10 base + 5 battus * 10 + 20 podium) * 1.25 = 80 * 1.25 = 100 pts
    assert.strictEqual(p1.pelotonMultiplier, 1.25);
    assert.strictEqual(p1.totalPoints, 100);

    const p2 = calculateRacePointsBreakdown({ raceMode: "MULTIPLAYER", playerRank: 2, totalHumanFinishers: 6 });
    // (10 base + 4 battus * 10 + 10 podium) * 1.25 = 60 * 1.25 = 75 pts
    assert.strictEqual(p2.totalPoints, 75);

    const p3 = calculateRacePointsBreakdown({ raceMode: "MULTIPLAYER", playerRank: 3, totalHumanFinishers: 6 });
    // (10 base + 3 battus * 10 + 5 podium) * 1.25 = 45 * 1.25 = 56.25 -> 56 pts
    assert.strictEqual(p3.totalPoints, 56);

    const p6 = calculateRacePointsBreakdown({ raceMode: "MULTIPLAYER", playerRank: 6, totalHumanFinishers: 6 });
    // (10 base + 0 battus + 0 podium) * 1.25 = 10 * 1.25 = 12.5 -> 13 pts
    assert.strictEqual(p6.totalPoints, 13);
  });
});
