const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { RaceManager } = require('../dist/services/race-manager.service');
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const initUserRoutes = require('../dist/routes/user.routes').default;
const initRaceRoutes = require('../dist/routes/race.routes').default;
const initGarminRoutes = require('../dist/routes/garmin.routes').default;
const userStore = require('../dist/services/user-store.service').default;
const { IpGeoService } = require('../dist/services/ip-geo.service');
const db = require('../dist/models').default;

function createTestServer() {
  const app = express();
  app.use(express.json());
  initTelemetryRoutes(app);
  initUserRoutes(app);
  initRaceRoutes(app);
  initGarminRoutes(app);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((resClose) => server.close(resClose)),
      });
    });
  });
}

test('1v1 Bot Duel mode for unauthenticated guest, distance up to 10000m, exclusive 1v1', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // 1. Unauthenticated guest user creates 1v1 Bot Duel
    const resCreate = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isBotDuel: true,
        targetDistance: 5000,
        hostUserId: 'guest_bot_challenger_99',
        hostUserName: 'GuestChallenger'
      })
    });

    assert.equal(resCreate.status, 201, 'Guest must be allowed to create 1v1 Bot Duel');
    const duelData = await resCreate.json();
    assert.ok(duelData.race?.id || duelData.id, 'Should have race ID');
    assert.ok(duelData.pinCode || duelData.race?.pinCode, 'Should have PIN code for watch');
    assert.equal(duelData.race?.targetDistance, 5000, 'Distance should match requested 5000m');
    assert.equal(duelData.race?.maxParticipants, 2, 'Should strictly allow 2 racers (host + bot)');
    assert.ok(duelData.race?.hasBots, 'Room must have bot enabled');

    // 2. Distance clamping up to 10 000m
    const resOverDist = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isBotDuel: true,
        targetDistance: 25000, // beyond 10 000m
        hostUserId: 'guest_bot_challenger_99',
        hostUserName: 'GuestChallenger'
      })
    });
    assert.equal(resOverDist.status, 201);
    const clampedData = await resOverDist.json();
    assert.equal(clampedData.race?.targetDistance, 10000, 'Distance must be capped at 10000m');

    // 3. Exclusivity: Another human trying to join the bot duel room is rejected
    const resIntruder = await fetch(`${baseUrl}/api/v1/races/private/${duelData.code}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'intruder_racer_88',
        userName: 'Intruder',
        registerLane: true
      })
    });
    assert.equal(resIntruder.status, 403, 'Other humans cannot join a 1v1 Bot Duel room');

  } finally {
    await close();
  }
});

test('IpGeoService resolves country from headers and loopback', async () => {
  // Test CDN header extraction
  const mockReqCH = {
    headers: { 'cf-ipcountry': 'CH' },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const countryCH = await IpGeoService.resolveCountryFromRequest(mockReqCH);
  assert.equal(countryCH, 'Suisse');

  const mockReqBE = {
    headers: { 'x-country-code': 'BE' },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const countryBE = await IpGeoService.resolveCountryFromRequest(mockReqBE);
  assert.equal(countryBE, 'Belgique');

  // Loopback fallback
  const mockReqLocal = {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' }
  };
  const countryLocal = await IpGeoService.resolveCountryFromRequest(mockReqLocal);
  assert.equal(countryLocal, 'France');
});

test('Leaderboard filters by country, gender, and ageCategory', async () => {
  const currentYear = new Date().getFullYear();
  // Create sample users with known country, gender, and birthYear
  await userStore.createUser({
    id: 'user_filter_fr_f_25',
    login: 'user_filter_fr_f_25',
    name: 'Alice FR',
    country: 'France',
    gender: 'F',
    birthYear: currentYear - 25, // 25 years old -> 19-29
    points: 850
  });

  await userStore.createUser({
    id: 'user_filter_ch_m_45',
    login: 'user_filter_ch_m_45',
    name: 'Bob CH',
    country: 'Suisse',
    gender: 'M',
    birthYear: currentYear - 45, // 45 years old -> 40-49
    points: 920
  });

  const { baseUrl, close } = await createTestServer();
  try {
    // 1. Filter by country=Suisse
    const resCH = await fetch(`${baseUrl}/api/user/leaderboard?country=Suisse`);
    assert.equal(resCH.status, 200);
    const dataCH = await resCH.json();
    assert.ok(dataCH.players.some(p => p.id === 'user_filter_ch_m_45'));
    assert.ok(!dataCH.players.some(p => p.id === 'user_filter_fr_f_25'));

    // 2. Filter by gender=F
    const resF = await fetch(`${baseUrl}/api/user/leaderboard?gender=F`);
    assert.equal(resF.status, 200);
    const dataF = await resF.json();
    assert.ok(dataF.players.some(p => p.id === 'user_filter_fr_f_25'));
    assert.ok(!dataF.players.some(p => p.id === 'user_filter_ch_m_45'));

    // 3. Filter by ageCategory=19-29
    const resAge = await fetch(`${baseUrl}/api/user/leaderboard?ageCategory=19-29`);
    assert.equal(resAge.status, 200);
    const dataAge = await resAge.json();
    assert.ok(dataAge.players.some(p => p.id === 'user_filter_fr_f_25'));
    assert.ok(!dataAge.players.some(p => p.id === 'user_filter_ch_m_45'));
  } finally {
    await close();
  }
});

test('1v1 Bot Duel PIN connection allows guest watch pairing and blocks third-party athletes', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // 1. Unauthenticated web guest creates a 1v1 bot duel
    const resCreate = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isBotDuel: true,
        targetDistance: 2000,
        hostUserId: 'guest_unpaired_web_123',
        hostUserName: 'WebGuest'
      })
    });
    assert.equal(resCreate.status, 201);
    const duel = await resCreate.json();
    const pin = duel.pinCode || duel.race?.pinCode;
    assert.ok(pin, 'Should return PIN code');

    // 2. Athlete enters PIN on Garmin watch with watch ID RowIQ_99999
    const resWatchJoin = await fetch(`${baseUrl}/api/v1/races/pin/${pin}?userId=RowIQ_99999&userName=GarminAthlete`);
    assert.equal(resWatchJoin.status, 200, 'Athlete watch must be allowed to claim the guest bot duel seat');
    const watchData = await resWatchJoin.json();
    assert.ok(watchData.raceId || watchData.id);

    // 3. Third-party intruder tries to join via PIN and must be strictly blocked
    const resIntruderWatch = await fetch(`${baseUrl}/api/v1/races/pin/${pin}?userId=RowIntruder_888&userName=Intruder`);
    assert.equal(resIntruderWatch.status, 403, 'Intruder must be rejected from 1v1 bot duel');
  } finally {
    await close();
  }
});

test('Telemetry ingestion for guest player resolves country via IP headers', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const uniqueUserId = `guest_rower_${Date.now()}`;
    const raceId = `PRIV_TEST_${Date.now()}`;

    // Create a private race so raceManager tracks it
    const resCreate = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isBotDuel: true,
        targetDistance: 1000,
        hostUserId: uniqueUserId,
        hostUserName: 'SpanishGuest'
      })
    });
    assert.equal(resCreate.status, 201);
    const created = await resCreate.json();

    const resTelemetry = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-ipcountry': 'ES'
      },
      body: JSON.stringify({
        raceId: created.race.id,
        userId: uniqueUserId,
        userName: 'SpanishGuest',
        seq: 1,
        metrics: {
          distanceM: 50,
          splitSec: 120,
          powerWatts: 200,
          strokeRate: 26
        }
      })
    });

    assert.equal(resTelemetry.status, 200);
    const telemetryData = await resTelemetry.json();
    assert.ok(telemetryData.rk >= 1);
  } finally {
    await close();
  }
});

test('In-race Garmin 6-character code pairing flow and real-time status check', async () => {
  process.env.NODE_ENV = 'test';
  const { baseUrl, close } = await createTestServer();
  try {
    const watchUserId = `RowTest_${Date.now()}`;
    const deviceId = `fenix7_${Date.now()}`;

    // 1. Web front requests ephemeral 6-char code
    const resReq = await fetch(`${baseUrl}/api/garmin/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: watchUserId,
      })
    });
    assert.equal(resReq.status, 200);
    const reqData = await resReq.json();
    assert.equal(reqData.success, true);
    assert.equal(typeof reqData.pairingCode, 'string');
    assert.equal(reqData.pairingCode.length, 6);

    // 2. Watch enters code and submits
    const resPair = await fetch(`${baseUrl}/api/garmin/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: reqData.pairingCode,
        deviceId: deviceId,
      })
    });
    assert.equal(resPair.status, 200);
    const pairData = await resPair.json();
    assert.equal(pairData.success, true);
    assert.ok(pairData.deviceToken);

    // 3. Web front checks status and detects watch is paired
    const resStatus = await fetch(`${baseUrl}/api/garmin/pairing-status?userId=${watchUserId}`);
    assert.equal(resStatus.status, 200);
    const statusData = await resStatus.json();
    assert.equal(statusData.paired, true);
    assert.equal(statusData.status, 'paired');
  } finally {
    await close();
  }
});

test('1v1 Bot Duel bot toggle rule: unauthenticated guest cannot add or remove bot, registered user can', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // 1. Guest creates 1v1 Bot Duel
    const resGuestDuel = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isBotDuel: true,
        targetDistance: 2000,
        hostUserId: 'guest_athlete_42',
        hostUserName: 'Guest42'
      })
    });
    assert.equal(resGuestDuel.status, 201);
    const guestData = await resGuestDuel.json();
    const guestRaceId = guestData.race?.id || guestData.id;

    // 2. Guest attempts to toggle/remove bot -> MUST BE REJECTED 403
    const resGuestToggleOff = await fetch(`${baseUrl}/api/race/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceId: guestRaceId,
        userId: 'guest_athlete_42',
        enable: false
      })
    });
    assert.equal(resGuestToggleOff.status, 403, 'Guest must NOT be allowed to remove bot in 1v1 bot duel');
    const guestErr = await resGuestToggleOff.json();
    assert.match(guestErr.message, /seul un utilisateur inscrit/i);

    // 3. Registered user creates/hosts 1v1 Bot Duel
    const regLogin = `reg_challenger_${Date.now()}`;
    await userStore.createUser({
      id: regLogin,
      login: regLogin,
      name: 'Registered Challenger',
      isSubscriber: false,
      subscriptionTier: 'free',
      totalRaces: 0,
      totalWins: 0,
      podiums: 0,
      points: 0,
      bestRank: 0,
      lastRank: 0
    });

    const resRegDuel = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isBotDuel: true,
        targetDistance: 2000,
        hostUserId: regLogin,
        hostUserName: 'Registered Challenger'
      })
    });
    assert.equal(resRegDuel.status, 201);
    const regDuelData = await resRegDuel.json();
    const regRaceId = regDuelData.race?.id || regDuelData.id;

    // 4. Registered user removes bot -> MUST SUCCEED (enable: false)
    const resRegToggleOff = await fetch(`${baseUrl}/api/race/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceId: regRaceId,
        userId: regLogin,
        enable: false
      })
    });
    assert.equal(resRegToggleOff.status, 200, 'Registered user must be allowed to remove bot');
    const toggleOffData = await resRegToggleOff.json();
    assert.equal(toggleOffData.hasBots, false);

    // 5. Registered user re-adds bot -> MUST SUCCEED (enable: true)
    const resRegToggleOn = await fetch(`${baseUrl}/api/race/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceId: regRaceId,
        userId: regLogin,
        enable: true,
        botCount: 1
      })
    });
    assert.equal(resRegToggleOn.status, 200, 'Registered user must be allowed to re-add bot');
    const toggleOnData = await resRegToggleOn.json();
    assert.equal(toggleOnData.hasBots, true);
  } finally {
    await close();
  }
});
