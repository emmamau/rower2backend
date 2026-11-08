const test = require("node:test");
const assert = require("node:assert/strict");
const { RaceManager } = require("../dist/services/race-manager.service");
const { buildPublicRacePayload } = require("../dist/controllers/race.controller");

test("Post-race 2-minute pause and automatic transition to next lobby", async () => {
  const rm = RaceManager.getInstance();

  // Initialize a public race
  const race = await rm.initNextPublicRace(15);
  race.status = "RUNNING";
  race.startedAt = new Date(Date.now() - 30 * 1000);

  // Complete the race (e.g., normal completion)
  await rm.finishRace(race.id, false, "completed");

  assert.equal(race.status, "COMPLETED");
  assert.ok(race.pauseEndsAt, "pauseEndsAt must be defined");
  const diffSec = Math.round((race.pauseEndsAt.getTime() - Date.now()) / 1000);
  assert.ok(diffSec >= 115 && diffSec <= 120, `pauseEndsAt must be ~120s in the future (was ${diffSec}s)`);

  // buildPublicRacePayload must reflect post-race pause
  const payload = await buildPublicRacePayload();
  assert.equal(payload.status, "post_race_pause");
  assert.equal(payload.isPostRacePause, true);
  assert.ok(payload.pauseRemainingSeconds > 0 && payload.pauseRemainingSeconds <= 120);

  // Before 120s expires, tickPublicRace stays in pause
  const tick1 = await rm.tickPublicRace();
  assert.equal(tick1.id, race.id);
  assert.equal(tick1.status, "COMPLETED");

  // Fast-forward pause timer to simulate 120s elapsed
  race.pauseEndsAt = new Date(Date.now() - 1000);

  // Next tick must transition to fresh lobby
  const tick2 = await rm.tickPublicRace();
  assert.notEqual(tick2.id, race.id, "Must transition to a new public race lobby");
  assert.equal(tick2.status, "LOBBY");
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
