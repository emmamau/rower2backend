const test = require("node:test");
const assert = require("node:assert/strict");

const { RaceManager } = require("../dist/services/race-manager.service");

test.describe("Bot Simulation, 55m Timeout, Ranking by Distance, and Sole-Bots Auto-End", () => {
  const raceManager = RaceManager.getInstance();

  test("RaceManager.sortRanking places finishers first, and non-finishers by netDistance descending", () => {
    const makeRow = (id, status, netDist, elapsed, finishedAt) => ({
      get: (key) => {
        if (key === "userId") return id;
        if (key === "status") return status;
        if (key === "netDistance") return netDist;
        if (key === "elapsedTime") return elapsed;
        if (key === "finishedAt") return finishedAt;
        return null;
      }
    });

    const racerA = makeRow("racerA", "in_progress", 4500, 3300, null);
    const racerB = makeRow("racerB", "in_progress", 8200, 3300, null);
    const racerFinisher = makeRow("racerFinisher", "finished", 10000, 1500, new Date("2026-11-05T12:25:00Z"));
    const racerBot = makeRow("bot_lucas", "in_progress", 6100, 3300, null);
    const racerAbandoned = makeRow("quitter", "abandoned", 200, 100, null);

    const activeRows = [racerA, racerB, racerFinisher, racerBot];
    const ranked = RaceManager.sortRanking(activeRows);

    assert.equal(ranked[0].get("userId"), "racerFinisher", "Finisher must be ranked #1");
    assert.equal(ranked[1].get("userId"), "racerB", "Leader among non-finishers (8200m) must be #2");
    assert.equal(ranked[2].get("userId"), "bot_lucas", "Bot with 6100m must be #3");
    assert.equal(ranked[3].get("userId"), "racerA", "Racer with 4500m must be #4");
  });

  test("RaceManager.getRaceTiming computes 55-minute limit, elapsed seconds, and remaining seconds", () => {
    const now = new Date();
    const race = raceManager.createPrivateRace({
      title: "Timing Test Salon",
      targetDistance: 5000,
      hostUserId: "host_test",
      countdownMinutes: 0
    });

    // In LOBBY mode:
    race.status = "LOBBY";
    race.lobbyEndsAt = new Date(now.getTime() + 10 * 60 * 1000);
    const lobbyTiming = raceManager.getRaceTiming(race, now);
    assert.ok(lobbyTiming.secondsUntilStart > 0, "Lobby timing has secondsUntilStart > 0");
    assert.equal(lobbyTiming.maxDurationSeconds, 55 * 60, "Max duration of game is 55 minutes (3300s)");

    // In RUNNING mode (started 10 minutes ago):
    race.status = "RUNNING";
    race.startedAt = new Date(now.getTime() - 10 * 60 * 1000);
    const runningTiming = raceManager.getRaceTiming(race, now);
    assert.equal(runningTiming.secondsUntilStart, 0, "secondsUntilStart is 0 once running");
    assert.equal(runningTiming.elapsedSeconds, 600, "10 minutes elapsed = 600 seconds");
    assert.equal(runningTiming.remainingSeconds, 2700, "55 min max - 10 min elapsed = 45 min remaining (2700s)");

    // When 55 minutes have elapsed:
    race.startedAt = new Date(now.getTime() - 55 * 60 * 1000);
    const timeoutTiming = raceManager.getRaceTiming(race, now);
    assert.equal(timeoutTiming.remainingSeconds, 0, "0 seconds remaining once 55 minutes reached");
  });

  test("RaceManager.toLiveMetrics maps bot and human metrics with Watts, SPM, Pace, and Distance", () => {
    const makeRow = (id, name, dist, pace, watts, spm, isBot) => ({
      get: (key) => {
        if (key === "userId") return id;
        if (key === "userName") return name;
        if (key === "netDistance") return dist;
        if (key === "lastPace") return pace;
        if (key === "lastPower") return watts;
        if (key === "lastStrokeRate") return spm;
        if (key === "isBot") return isBot;
        if (key === "status") return "in_progress";
        return null;
      }
    });

    const rows = [
      makeRow("human1", "Athlete 1", 1250, 118, 220, 26, false),
      makeRow("bot_lucas", "Lucas (Bot)", 1180, 122, 195, 24, true)
    ];

    const metrics = RaceManager.toLiveMetrics(rows);
    assert.equal(metrics.length, 2);
    assert.equal(metrics[0].lane, 1);
    assert.equal(metrics[0].name, "Athlete 1");
    assert.equal(metrics[0].dist, 1250);
    assert.equal(metrics[0].watts, 220);

    assert.equal(metrics[1].lane, 2);
    assert.equal(metrics[1].name, "Lucas (Bot)");
    assert.equal(metrics[1].dist, 1180);
    assert.equal(metrics[1].watts, 195);
  });

  test("Public race transition: when only bots remain, race ends and new public race is prepared with countdown", async () => {
    const pub = await raceManager.initNextPublicRace(15);
    pub.status = "RUNNING";
    pub.startedAt = new Date(Date.now() - 60 * 1000);
    const pubId = pub.id;

    // Trigger tickPublicRace when there are 0 active humans
    await raceManager.tickPublicRace();

    // The previous race must be COMPLETED
    assert.equal(pub.status, "COMPLETED", "Public race must finish when no active humans remain");

    // The current public race must be newly scheduled in LOBBY with future countdown
    const current = raceManager.getCurrentPublicRace();
    assert.notEqual(current.id, pubId, "A fresh public race must be generated");
    assert.equal(current.status, "LOBBY", "New race must start in LOBBY mode");
    assert.ok(current.lobbyEndsAt.getTime() > Date.now(), "Lobby countdown must be in the future");
    const timing = raceManager.getRaceTiming(current);
    assert.ok(timing.secondsUntilStart > 0, "Countdown timer before start must be active");
    assert.equal(timing.maxDurationSeconds, 55 * 60, "Max duration of game must be 55 minutes");
  });
});
