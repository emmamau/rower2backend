const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const { RaceManager, getWaitingStatusMessage, parseDateTimeInTimezone } = require("../dist/services/race-manager.service");
const initTelemetryRoutes = require("../dist/routes/telemetry.routes").default;
const initRoomRoutes = require("../dist/routes/room.routes").default;
const userStore = require("../dist/services/user-store.service").default;
const db = require("../dist/models").default;

function createTestServer() {
  const app = express();
  app.use(express.json());
  initTelemetryRoutes(app);
  initRoomRoutes(app);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((resClose) => server.close(resClose))
      });
    });
  });
}

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

test("1. parseDateTimeInTimezone parses naive date strings with target timezone and preserves ISO UTC strings", () => {
  // Test naive string with Europe/Paris (CET = UTC+1 in winter)
  const parisWinter = parseDateTimeInTimezone("2026-11-20T18:00", "Europe/Paris");
  // 18:00 in Paris in November is 17:00 UTC
  assert.equal(parisWinter.toISOString(), "2026-11-20T17:00:00.000Z");

  // Test naive string with America/New_York (EST = UTC-5 in winter)
  const nyWinter = parseDateTimeInTimezone("2026-11-20T18:00", "America/New_York");
  // 18:00 in New York in November is 23:00 UTC
  assert.equal(nyWinter.toISOString(), "2026-11-20T23:00:00.000Z");

  // Test naive string with Asia/Tokyo (JST = UTC+9)
  const tokyo = parseDateTimeInTimezone("2026-11-20T18:00", "Asia/Tokyo");
  // 18:00 in Tokyo is 09:00 UTC
  assert.equal(tokyo.toISOString(), "2026-11-20T09:00:00.000Z");

  // Test naive string with explicit UTC
  const utc = parseDateTimeInTimezone("2026-11-20T18:00", "UTC");
  assert.equal(utc.toISOString(), "2026-11-20T18:00:00.000Z");

  // Explicit UTC ISO string must NOT be shifted by timezone parameter
  const explicitUtc = parseDateTimeInTimezone("2026-11-20T14:30:00.000Z", "America/New_York");
  assert.equal(explicitUtc.toISOString(), "2026-11-20T14:30:00.000Z");

  // Explicit ISO string with offset (+02:00)
  const explicitOffset = parseDateTimeInTimezone("2026-11-20T14:30:00+02:00", "Europe/Paris");
  assert.equal(explicitOffset.toISOString(), "2026-11-20T12:30:00.000Z");
});

test("2. getWaitingStatusMessage formats scheduled races with timezone and relative time", () => {
  const baseNow = new Date("2026-11-20T12:00:00.000Z");

  // 1. Same-day race in Paris (13:00 Paris = 12:00 UTC, starts in 30 min)
  const raceParis30m = {
    id: "TEST_PARIS",
    status: "LOBBY",
    startMode: "scheduled",
    scheduledStartTime: new Date("2026-11-20T12:30:00.000Z"), // 13:30 Paris
    timezone: "Europe/Paris"
  };
  const msgParis30m = getWaitingStatusMessage(raceParis30m, baseNow);
  assert.match(msgParis30m, /13:30/);
  assert.match(msgParis30m, /30 min/);

  // 2. Same-day race in New York (12:00 UTC = 07:00 NY, starts in 2 hours at 09:00 NY = 14:00 UTC)
  const raceNY2h = {
    id: "TEST_NY",
    status: "LOBBY",
    startMode: "scheduled",
    scheduledStartTime: new Date("2026-11-20T14:00:00.000Z"),
    timezone: "America/New_York"
  };
  const msgNY = getWaitingStatusMessage(raceNY2h, baseNow);
  assert.match(msgNY, /09:00/);
  assert.match(msgNY, /2h/);

  // 3. Multi-day / International race (e.g. 2 days later)
  const raceFuture = {
    id: "TEST_FUTURE",
    status: "LOBBY",
    startMode: "scheduled",
    scheduledStartTime: new Date("2026-11-22T15:00:00.000Z"), // 16:00 Paris on Nov 22
    timezone: "Europe/Paris"
  };
  const msgFuture = getWaitingStatusMessage(raceFuture, baseNow);
  assert.match(msgFuture, /16:00/);
  assert.match(msgFuture, /nov/i);
});

test("3. Private room creation with scheduledStartTime and timezone returns synchronized metadata", async () => {
  const rm = RaceManager.getInstance();

  const race = rm.createPrivateRace({
    title: "International Regatta Tokyo",
    targetDistance: 2000,
    hostUserId: "organizer_intl",
    startMode: "scheduled",
    scheduledStartTime: "2026-11-20T18:00",
    timezone: "Asia/Tokyo"
  });

  assert.equal(race.startMode, "scheduled");
  assert.equal(race.timezone, "Asia/Tokyo");
  assert.equal(race.scheduledStartTime.toISOString(), "2026-11-20T09:00:00.000Z");
});

test("4. HTTP endpoints return startMode, scheduledStartTime, scheduledStartTimeEpoch, and timezone", async () => {
  const rm = RaceManager.getInstance();
  const testDate = new Date(Date.now() + 3600 * 1000); // in 1 hour
  const race = rm.createPrivateRace({
    title: "Championship Live Sync",
    targetDistance: 2000,
    hostUserId: "sync_host",
    startMode: "scheduled",
    scheduledStartTime: testDate.toISOString(),
    timezone: "Europe/Paris"
  });

  const { baseUrl, close } = await createTestServer();

  try {
    const res = await fetch(`${baseUrl}/api/v1/races/private/${race.id}`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.success, true);
    assert.equal(data.race.startMode, "scheduled");
    assert.equal(data.race.timezone, "Europe/Paris");
    assert.equal(typeof data.race.scheduledStartTimeEpoch, "number");
    assert.equal(data.race.scheduledStartTimeEpoch, Math.floor(testDate.getTime() / 1000));
    assert.equal(data.startMode, "scheduled");
    assert.equal(data.timezone, "Europe/Paris");
    assert.equal(data.scheduledStartTimeEpoch, Math.floor(testDate.getTime() / 1000));
    assert.ok(data.secondsRemaining > 3500 && data.secondsRemaining <= 3600);

    // Join room via POST /api/rooms/join
    const joinRes = await fetch(`${baseUrl}/api/rooms/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pin: race.pinCode,
        userId: "athlete_watch",
        userName: "Athlète Montre"
      })
    });
    assert.equal(joinRes.status, 200);
    const joinData = await joinRes.json();
    assert.equal(joinData.startMode, "scheduled");
    assert.equal(joinData.timezone, "Europe/Paris");
    assert.equal(joinData.scheduledStartTimeEpoch, Math.floor(testDate.getTime() / 1000));
    assert.ok(joinData.secondsRemaining > 3500 && joinData.secondsRemaining <= 3600);
  } finally {
    await close();
  }
});
