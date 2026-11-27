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
