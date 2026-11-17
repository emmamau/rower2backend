const test = require("node:test");
const assert = require("node:assert/strict");
const raceManagerModule = require("../dist/services/race-manager.service");
const RaceManager = raceManagerModule.RaceManager;
const { getRaceHistory } = require("../dist/controllers/race.controller");
const userStore = require("../dist/services/user-store.service").default;

test("1. Unified Pseudo Resolution: Account user takes precedence over guest name and technical watch ID", async () => {
  const rm = RaceManager.getInstance();

  // Add in-memory account user with login
  userStore.inMemoryUsers.set("usr_athlete_123", {
    id: "usr_athlete_123",
    login: "SuperRameur",
    name: "Super Rameur",
    email: "athlete@example.com",
    isSubscriber: true,
    isConfirmed: true,
    totalRaces: 0,
    totalWins: 0,
    podiums: 0,
    points: 50,
    bestRank: 1,
    lastRank: 1,
    isAdmin: false
  });

  const mockRace = {
    id: "RACE_TEST_PSEUDO",
    type: "PRIVATE_INVITE",
    status: "RUNNING",
    participants: new Map([
      ["usr_athlete_123", {
        userId: "usr_athlete_123",
        userName: "Garmin_Fenix7", // Technical watch ID originally attached
        joinedAt: new Date(),
        ready: true
      }]
    ])
  };

  const rows = [
    {
      get: (field) => {
        if (field === "userId") return "usr_athlete_123";
        if (field === "userName") return "Garmin_Fenix7";
        if (field === "netDistance") return 500;
        if (field === "lastPace") return 115;
        if (field === "lastPower") return 220;
        if (field === "lastStrokeRate") return 28;
        return null;
      }
    }
  ];

  const live = RaceManager.toLiveMetrics(rows, mockRace);
  assert.equal(live.length, 1);
  assert.equal(live[0].name, "SuperRameur", "Account login must take precedence over technical Garmin device ID");
  assert.equal(live[0].dist, 500);
  assert.equal(live[0].split, 115);
  assert.equal(Number.isFinite(live[0].split), true, "Split must be a finite number");
  assert.equal(Number.isFinite(live[0].watts), true, "Watts must be a finite number");
});

test("2. Unified Pseudo Resolution: Guest name takes precedence over technical watch ID when not authenticated", async () => {
  const mockRace = {
    id: "RACE_TEST_GUEST",
    type: "PRIVATE_INVITE",
    status: "RUNNING",
    participants: new Map([
      ["guest_456", {
        userId: "guest_456",
        userName: "Garmin_955",
        guestName: "CapitaineAviron",
        joinedAt: new Date(),
        ready: true
      }]
    ])
  };

  const rows = [
    {
      get: (field) => {
        if (field === "userId") return "guest_456";
        if (field === "userName") return "Garmin_955";
        if (field === "netDistance") return 250;
        return null;
      }
    }
  ];

  const live = RaceManager.toLiveMetrics(rows, mockRace);
  assert.equal(live.length, 1);
  assert.equal(live[0].name, "CapitaineAviron", "Guest pseudo must take precedence over Garmin watch ID");
});

test("3. Private Room Start: 10s countdown succeeds even when participants are in CONNECTED (ready=false) state", async () => {
  const rm = RaceManager.getInstance();
  const race = rm.createPrivateRace({
    title: "10s Start Test Room",
    targetDistance: 1000,
    hostUserId: "host_organizer_99",
    startMode: "manual"
  });

  // Add participant who just arrived (ready === false)
  race.participants.set("competitor_1", {
    userId: "competitor_1",
    userName: "Rameur_Un",
    ready: false,
    connectionState: "CONNECTED",
    joinedAt: new Date()
  });

  const result = rm.startOrResetPrivateRace(race.id, {
    hostUserId: "host_organizer_99",
    countdownSeconds: 10,
    reset: false
  });

  assert.ok(result.race, "10s countdown start must return { race } object without 409 blockage");
  assert.equal(result.race.status, "COUNTDOWN");
  assert.equal(race.status, "COUNTDOWN");
  const timing = rm.getRaceTiming(race);
  assert.ok(timing.secondsUntilStart <= 10 && timing.secondsUntilStart >= 9);
});

test("4. History Filtering & NaN-safe Leaderboard: Exclude stopped/cancelled/empty races and sanitize numeric outputs", async () => {
  const req = {};
  let resStatus = 200;
  let resJson = null;
  const res = {
    status: (s) => { resStatus = s; return res; },
    json: (j) => { resJson = j; return res; }
  };

  await getRaceHistory(req, res);
  assert.equal(resStatus, 200);
  assert.ok(Array.isArray(resJson));

  // Verify none of the history entries have status STOPPED, CANCELLED, ABORTED, ABANDONED
  const excluded = new Set(["stopped", "cancelled", "aborted", "abandoned", "STOPPED", "CANCELLED", "ABORTED", "ABANDONED"]);
  for (const item of resJson) {
    assert.equal(excluded.has(item.status), false, `Race status ${item.status} must be excluded from history`);
    if (item.podium) {
      assert.ok(item.podium.length > 0, "Podium should not be empty for finished races in history");
    }
  }
});
