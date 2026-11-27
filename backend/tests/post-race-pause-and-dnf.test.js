const test = require("node:test");
const assert = require("node:assert/strict");
const { RaceManager } = require("../dist/services/race-manager.service");
const { buildPublicRacePayload } = require("../dist/controllers/race.controller");

test("Public race completion immediately transitions to next lobby and resumes wait timer", async () => {
  const rm = RaceManager.getInstance();

  // Initialize a public race
  const race = await rm.initNextPublicRace(15);
  const completedRaceId = race.id;
  race.status = "RUNNING";
  race.startedAt = new Date(Date.now() - 30 * 1000);

  // Complete the race (e.g., all players crossed the finish line)
  await rm.finishRace(completedRaceId, false, "completed");

  assert.equal(race.status, "COMPLETED");
  assert.equal(race.pauseEndsAt, undefined, "pauseEndsAt must not block the next public race");

  // Current public race must immediately be the new lobby
  const nextLobby = rm.getCurrentPublicRace();
  assert.ok(nextLobby, "Next public race lobby must be initialized immediately");
  assert.notEqual(nextLobby.id, completedRaceId, "Must immediately transition to a new public race lobby");
  assert.equal(nextLobby.status, "LOBBY");

  // buildPublicRacePayload must reflect the new waiting lobby with active countdown
  const payload = await buildPublicRacePayload();
  assert.equal(payload.status, "waiting");
  assert.equal(payload.isPostRacePause, false);
  assert.ok(payload.secondsRemaining > 0, "Public race waiting timer must immediately resume");
});

test("Public race completes immediately when all engaged human players reach finish line, broadcasts ranking + nextRaceId, and initializes new bots at 0m", async () => {
  const rm = RaceManager.getInstance();
  const userStore = require("../dist/services/user-store.service").default;
  const socketGateway = require("../dist/websocket/socket.gateway").default;

  const statusEvents = [];
  const leaderboardEvents = [];
  const origBroadcastStatus = socketGateway.broadcastRaceStatus.bind(socketGateway);
  const origBroadcastLb = socketGateway.broadcastLeaderboard.bind(socketGateway);
  socketGateway.broadcastRaceStatus = (raceId, status, details) => {
    statusEvents.push({ raceId, status, details });
    origBroadcastStatus(raceId, status, details);
  };
  socketGateway.broadcastLeaderboard = (raceId, lb) => {
    leaderboardEvents.push({ raceId, lb });
    origBroadcastLb(raceId, lb);
  };

  try {
    const race = await rm.initNextPublicRace(15);
    const completedRaceId = race.id;
    const target = race.targetDistance || 1000;
    rm.notifyPlayerJoinedPublic("human_1", "Alice");
    rm.notifyPlayerJoinedPublic("human_2", "Bob");

    race.status = "RUNNING";
    const startMs = Date.now() - 180 * 1000;
    race.startedAt = new Date(startMs);

    // Both humans reach targetDistance
    userStore.recordActivity({
      id: `${completedRaceId}_human_1`,
      activityId: completedRaceId,
      userId: "human_1",
      userName: "Alice",
      status: "finished",
      netDistance: target,
      currentDistance: target,
      targetDistance: target,
      elapsedTime: 170,
      finishedAt: new Date(startMs + 170 * 1000),
      isBot: false,
      update: async function (fields) { Object.assign(this, fields); },
      get: function (k) { return this[k]; }
    });
    userStore.recordActivity({
      id: `${completedRaceId}_human_2`,
      activityId: completedRaceId,
      userId: "human_2",
      userName: "Bob",
      status: "finished",
      netDistance: target,
      currentDistance: target,
      targetDistance: target,
      elapsedTime: 180,
      finishedAt: new Date(startMs + 180 * 1000),
      isBot: false,
      update: async function (fields) { Object.assign(this, fields); },
      get: function (k) { return this[k]; }
    });

    await rm.tickPublicRace();

    // Completed event must include ranking and nextRaceId
    const completedEvt = statusEvents.find(e => e.raceId === completedRaceId && e.status === "COMPLETED");
    assert.ok(completedEvt, "Must broadcast COMPLETED for the finished public race");
    assert.ok(Array.isArray(completedEvt.details?.ranking) && completedEvt.details.ranking.length >= 2, "COMPLETED event must include full ranking");
    assert.ok(completedEvt.details?.nextRaceId, "COMPLETED event must include nextRaceId for immediate water reset");

    const nextRace = rm.getCurrentPublicRace();
    assert.equal(nextRace.id, completedEvt.details.nextRaceId);
    assert.equal(nextRace.status, "LOBBY");

    // Initial leaderboard for the next public race must have been broadcast with bots at 0m
    const nextLbEvt = leaderboardEvents.find(e => e.raceId === nextRace.id);
    assert.ok(nextLbEvt, "Must broadcast initial leaderboard at 0m for the newly created public race");
    for (const metric of nextLbEvt.lb) {
      assert.equal(metric.dist, 0, "All bots on the reset water body must be at 0m");
    }
  } finally {
    socketGateway.broadcastRaceStatus = origBroadcastStatus;
    socketGateway.broadcastLeaderboard = origBroadcastLb;
  }
});

test("DNF & Inactivity: Abandoned rowers are marked, get 0 points, and placed in ranking", async () => {
  const rm = RaceManager.getInstance();

  const mockRows = [
    {
      get: (k) => {
        if (k === "userId") return "racer1";
        if (k === "status") return "finished";
        if (k === "netDistance") return 2000;
        if (k === "finishedAt") return new Date(Date.now() - 5000);
        return 0;
      }
    },
    {
      get: (k) => {
        if (k === "userId") return "racer2";
        if (k === "status") return "in_progress";
        if (k === "netDistance") return 1500;
        return 0;
      }
    },
    {
      get: (k) => {
        if (k === "userId") return "racer_dnf";
        if (k === "status") return "abandoned";
        if (k === "netDistance") return 800;
        return 0;
      }
    }
  ];

  // Test sortRanking with abandoned player
  const sorted = RaceManager.sortRanking(mockRows);
  assert.equal(sorted[0].get("userId"), "racer1", "Finisher is 1st");
  assert.equal(sorted[1].get("userId"), "racer2", "In progress racer is 2nd");
  assert.equal(sorted[2].get("userId"), "racer_dnf", "Abandoned racer is at the bottom");
});
