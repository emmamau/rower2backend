const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { RaceManager } = require('../dist/services/race-manager.service');
const initRoomRoutes = require('../dist/routes/room.routes').default;
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const initGarminRoutes = require('../dist/routes/garmin.routes').default;
const pairingService = require('../dist/services/pairing.service').default;
const userStore = require('../dist/services/user-store.service').default;
const db = require('../dist/models').default;

function createTestServer() {
  const app = express();
  app.use(express.json());
  initRoomRoutes(app);
  initTelemetryRoutes(app);
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

test('POST /api/rooms/join - Salon "Duel contre un Bot" strict creator-only access', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const raceManager = RaceManager.getInstance();
    const botDuel = raceManager.createPrivateRace({
      isBotDuel: true,
      targetDistance: 2000,
      hostUserId: 'creator_racer_1',
      hostUserName: 'Creator'
    });

    // 1. Creator joins with code -> 200 OK and assigned Lane 1
    const resCreator = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: botDuel.code,
        userId: 'creator_racer_1',
        userName: 'Creator'
      })
    });
    assert.equal(resCreator.status, 200);
    const dataCreator = await resCreator.json();
    assert.equal(dataCreator.success, true);
    assert.equal(dataCreator.lane, 1, 'Creator gets Lane 1');
    assert.equal(dataCreator.isBotDuel, true);

    // 2. Intruder attempts to join bot duel -> 403 Forbidden with exact message
    const resIntruder = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: botDuel.code,
        userId: 'intruder_racer_2',
        userName: 'Intruder'
      })
    });
    assert.equal(resIntruder.status, 403);
    const dataIntruder = await resIntruder.json();
    assert.equal(dataIntruder.success, false);
    assert.equal(dataIntruder.error, 'Ce duel contre un bot est réservé à son créateur');
  } finally {
    await close();
  }
});

test('POST /api/rooms/join - Salon "Duel 1 contre 1" quota enforcement (creator + 1 guest)', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const raceManager = RaceManager.getInstance();
    const duel1v1 = raceManager.createPrivateRace({
      isDuel1v1: true,
      maxParticipants: 2,
      targetDistance: 1000,
      hostUserId: 'player_host_a',
      hostUserName: 'PlayerA'
    });

    // Host joins and gets Lane 1
    const resA = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: duel1v1.pinCode,
        userId: 'player_host_a',
        userName: 'PlayerA'
      })
    });
    assert.equal(resA.status, 200);
    const dataA = await resA.json();
    assert.equal(dataA.lane, 1);

    // 1st guest joins and gets Lane 2
    const resB = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: duel1v1.pinCode,
        userId: 'player_guest_b',
        userName: 'PlayerB'
      })
    });
    assert.equal(resB.status, 200);
    const dataB = await resB.json();
    assert.equal(dataB.lane, 2, 'Invited guest gets Lane 2');

    // Re-joining same user is idempotent
    const resBRejoin = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: duel1v1.pinCode,
        userId: 'player_guest_b',
        userName: 'PlayerB'
      })
    });
    assert.equal(resBRejoin.status, 200);
    const dataBRejoin = await resBRejoin.json();
    assert.equal(dataBRejoin.lane, 2);

    // 3rd player attempts to join -> 409 Conflict with exact message
    const resC = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: duel1v1.pinCode,
        userId: 'player_c',
        userName: 'PlayerC'
      })
    });
    assert.equal(resC.status, 409);
    const dataC = await resC.json();
    assert.equal(dataC.success, false);
    assert.equal(dataC.error, 'Salon complet - quota atteint');
  } finally {
    await close();
  }
});

test('POST /api/rooms/join - Admin role exception: admin acts as spectator, all lanes open for participants', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const raceManager = RaceManager.getInstance();
    // Admin creates 2-player regatta as spectator
    const adminRoom = raceManager.createPrivateRace({
      maxParticipants: 2,
      targetDistance: 2000,
      hostUserId: 'EmmaRacer',
      hostUserName: 'Emma Admin',
      adminAsSpectator: true
    });

    // Participant 1 gets Lane 1 (since admin is spectator)
    const resP1 = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: adminRoom.code,
        userId: 'racer_p1',
        userName: 'Racer1'
      })
    });
    assert.equal(resP1.status, 200);
    const dataP1 = await resP1.json();
    assert.equal(dataP1.lane, 1, '1st racer gets Lane 1 when admin is spectator');

    // Participant 2 gets Lane 2
    const resP2 = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: adminRoom.code,
        userId: 'racer_p2',
        userName: 'Racer2'
      })
    });
    assert.equal(resP2.status, 200);
    const dataP2 = await resP2.json();
    assert.equal(dataP2.lane, 2, '2nd racer gets Lane 2');

    // Participant 3 gets 409 Conflict
    const resP3 = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: adminRoom.code,
        userId: 'racer_p3',
        userName: 'Racer3'
      })
    });
    assert.equal(resP3.status, 409);
    const dataP3 = await resP3.json();
    assert.equal(dataP3.error, 'Salon complet - quota atteint');
  } finally {
    await close();
  }
});

test('POST /api/rooms/join - Garmin watch join with deviceToken authentication', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const raceManager = RaceManager.getInstance();
    const salon = raceManager.createPrivateRace({
      targetDistance: 2000,
      maxParticipants: 4,
      hostUserId: 'coach_123',
      hostUserName: 'Coach'
    });

    // Generate pairing code & pair watch to obtain valid deviceToken
    const pairCode = await pairingService.createPairingCode('garmin_user_77');
    const pairResult = await pairingService.pairDevice(pairCode.pairingCode, 'watch_device_77');
    assert.equal(pairResult.success, true);
    const token = pairResult.deviceToken;

    // Join room using deviceToken
    const resJoin = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: salon.pinCode,
        deviceToken: token
      })
    });
    assert.equal(resJoin.status, 200);
    const joinData = await resJoin.json();
    assert.equal(joinData.success, true);
    assert.ok(joinData.lane >= 1);
    assert.equal(joinData.raceId, salon.id);

    // Join with invalid token returns 401
    const resBadToken = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: salon.pinCode,
        deviceToken: 'invalid_token_999'
      })
    });
    assert.equal(resBadToken.status, 401);
  } finally {
    await close();
  }
});

test('15-second countdown & false start protection (distance forced to 0m during countdown)', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const raceManager = RaceManager.getInstance();
    const botDuel = raceManager.createPrivateRace({
      isBotDuel: true,
      targetDistance: 2000,
      hostUserId: 'solo_challenger',
      hostUserName: 'SoloChallenger'
    });

    assert.equal(botDuel.status, 'LOBBY');

    // Join via PIN triggers 15-second countdown for Bot Duel
    const resJoin = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: botDuel.pinCode,
        userId: 'solo_challenger',
        userName: 'SoloChallenger'
      })
    });
    assert.equal(resJoin.status, 200);
    assert.equal(botDuel.status, 'COUNTDOWN', 'Bot Duel transitions to 15s COUNTDOWN on join');

    // Stroke during 15s countdown -> False start detected, distance forced to 0m
    const resStroke = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceId: botDuel.id,
        userId: 'solo_challenger',
        userName: 'SoloChallenger',
        seq: 1,
        metrics: {
          distanceM: 15,
          splitSec: 125,
          powerWatts: 240,
          strokeRate: 28
        }
      })
    });
    assert.equal(resStroke.status, 200);
    const strokeData = await resStroke.json();
    assert.equal(strokeData.falseStart, true, 'Must detect false start during countdown');
    assert.equal(strokeData.soundAlert, 'false_start');
    assert.equal(strokeData.normDistM, 0, 'Distance must remain at 0m during false start');
  } finally {
    await close();
  }
});

test('Duel 1v1 automatic 15-second countdown when 2nd player joins, and waiting status messages', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const raceManager = RaceManager.getInstance();
    const duel = raceManager.createPrivateRace({
      isDuel1v1: true,
      maxParticipants: 2,
      targetDistance: 2000,
      hostUserId: 'duel_host_1',
      hostUserName: 'DuelHost'
    });

    // Host checks status while alone -> "En attente de l'adversaire..."
    const resHost = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: duel.pinCode,
        userId: 'duel_host_1'
      })
    });
    assert.equal(resHost.status, 200);
    const hostData = await resHost.json();
    assert.equal(hostData.waitingStatusMessage, "En attente de l'adversaire...");
    assert.equal(duel.status, 'LOBBY');

    // 2nd player joins via PIN -> automatically triggers 15-second countdown!
    const resGuest = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: duel.pinCode,
        userId: 'duel_guest_2'
      })
    });
    assert.equal(resGuest.status, 200);
    const guestData = await resGuest.json();
    assert.equal(guestData.lane, 2);
    assert.equal(duel.status, 'COUNTDOWN', 'Must transition to COUNTDOWN as soon as 2nd player joins 1v1 duel');
    assert.ok(guestData.waitingStatusMessage.startsWith('Départ dans '), 'Countdown message returned');
  } finally {
    await close();
  }
});

test('Organizer subscription tier capacity & 410 Gone on completed/running races', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const raceManager = RaceManager.getInstance();

    // Create a Free-tier organizer in userStore (max 2 participants total: host + 1 guest)
    await userStore.createUser({
      id: 'free_host_org',
      login: 'free_host_org',
      name: 'Free Host',
      email: 'free_host@example.com',
      password: 'password123',
      isSubscriber: false,
      subscriptionTier: 'free'
    });

    const freeSalon = raceManager.createPrivateRace({
      targetDistance: 2000,
      maxParticipants: 8, // Even if room requested 8, organizer free tier limits to 2
      hostUserId: 'free_host_org',
      hostUserName: 'Free Host',
      requireApproval: false
    });

    // 1st guest joins -> Lane 2 (200 OK)
    const resG1 = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: freeSalon.pinCode,
        userId: 'guest_one'
      })
    });
    assert.equal(resG1.status, 200);
    const dataG1 = await resG1.json();
    assert.equal(dataG1.lane, 2);
    assert.equal(dataG1.waitingStatusMessage, "En attente du signal de départ de l'organisateur...");

    // 2nd guest tries to join -> Exceeds Free organizer capacity (2) -> 409 with exact message
    const resG2 = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: freeSalon.pinCode,
        userId: 'guest_two'
      })
    });
    assert.equal(resG2.status, 409);
    const dataG2 = await resG2.json();
    assert.equal(dataG2.error, 'Capacité maximale atteinte pour ce salon');

    // Mark race as COMPLETED -> new join returns 410 Gone
    freeSalon.status = 'COMPLETED';
    const resGone = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: freeSalon.pinCode,
        userId: 'guest_three'
      })
    });
    assert.equal(resGone.status, 410);
  } finally {
    await close();
  }
});

test('15-second countdown for multiplayer / scheduled races', async () => {
  const raceManager = RaceManager.getInstance();
  const scheduledTime = new Date(Date.now() + 10000); // starts in 10s (<= 15s)
  const scheduledRace = raceManager.createPrivateRace({
    targetDistance: 2000,
    maxParticipants: 4,
    hostUserId: 'organizer_host',
    hostUserName: 'Organizer',
    startMode: 'scheduled',
    scheduledStartTime: scheduledTime
  });

  assert.equal(scheduledRace.status, 'LOBBY');

  // Trigger ticker
  await raceManager.tickPrivateRaces();

  // Exactly 15s or less before start -> countdown triggered!
  assert.equal(scheduledRace.status, 'COUNTDOWN');
});

test('Organizer automatically occupies Lane 1, preventing guests from claiming Lane 1', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const raceManager = RaceManager.getInstance();
    const duel = raceManager.createPrivateRace({
      isDuel1v1: true,
      maxParticipants: 2,
      targetDistance: 1000,
      hostUserId: 'organizer_boss',
      hostUserName: 'OrganizerBoss'
    });

    // Guest joins FIRST before organizer does any network call
    const resGuest = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: duel.pinCode,
        userId: 'guest_competitor',
        userName: 'GuestCompetitor'
      })
    });
    assert.equal(resGuest.status, 200);
    const guestData = await resGuest.json();
    assert.equal(guestData.lane, 2, 'Guest must get Lane 2 because Organizer already occupies Lane 1');

    // Second guest attempts to join -> 409 Conflict (quota 2 is reached: organizer + 1 guest)
    const resGuest2 = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: duel.pinCode,
        userId: 'intruder_guest_3',
        userName: 'Intruder3'
      })
    });
    assert.equal(resGuest2.status, 409);
    const guest2Data = await resGuest2.json();
    assert.equal(guest2Data.error, 'Salon complet - quota atteint');

    // Organizer joins and confirms Lane 1 without conflict
    const resOrg = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: duel.pinCode,
        userId: 'organizer_boss',
        userName: 'OrganizerBoss'
      })
    });
    assert.equal(resOrg.status, 200);
    const orgData = await resOrg.json();
    assert.equal(orgData.lane, 1);
  } finally {
    await close();
  }
});

test('League requirement enforcement: blocks under-ranked players and admits eligible ones', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const raceManager = RaceManager.getInstance();
    const goldRace = raceManager.createPrivateRace({
      targetDistance: 2000,
      maxParticipants: 4,
      hostUserId: 'coach_pro',
      hostUserName: 'CoachPro',
      requiredLeague: 'gold' // Gold requires >= 300 points
    });

    // Create a bronze user in userStore (< 300 pts)
    await userStore.createUser({
      id: 'bronze_racer_1',
      login: 'bronze_racer_1',
      name: 'Bronze Racer',
      email: 'bronze@example.com',
      password: 'password123',
      points: 50,
      league: 'bronze'
    });

    // Create a platinum user in userStore (>= 600 pts)
    await userStore.createUser({
      id: 'plat_racer_1',
      login: 'plat_racer_1',
      name: 'Plat Racer',
      email: 'plat@example.com',
      password: 'password123',
      points: 750,
      league: 'platinum'
    });

    // 1. Bronze player joins -> 403 Forbidden
    const resBronze = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: goldRace.code,
        userId: 'bronze_racer_1'
      })
    });
    assert.equal(resBronze.status, 403);
    const bronzeData = await resBronze.json();
    assert.ok(bronzeData.error.includes('Niveau de ligue insuffisant'));

    // 2. Platinum player joins -> 200 OK
    const resPlat = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: goldRace.code,
        userId: 'plat_racer_1'
      })
    });
    assert.equal(resPlat.status, 200);
    const platData = await resPlat.json();
    assert.equal(platData.success, true);
    assert.equal(platData.lane, 2);
  } finally {
    await close();
  }
});

test('Admin spectator calling /api/rooms/join gets lane: 0 and leaves Lane 1 to participants', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const raceManager = RaceManager.getInstance();
    const adminSpectatorRace = raceManager.createPrivateRace({
      targetDistance: 2000,
      maxParticipants: 2,
      hostUserId: 'EmmaRacer',
      hostUserName: 'Emma Admin',
      adminAsSpectator: true
    });

    // Admin calls joinRoom -> returns lane 0
    const resAdmin = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: adminSpectatorRace.code,
        userId: 'EmmaRacer',
        userName: 'Emma Admin'
      })
    });
    assert.equal(resAdmin.status, 200);
    const adminData = await resAdmin.json();
    assert.equal(adminData.lane, 0, 'Admin spectator must receive lane 0');

    // Participant 1 calls joinRoom -> returns lane 1
    const resP1 = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: adminSpectatorRace.code,
        userId: 'athlete_1',
        userName: 'Athlete1'
      })
    });
    assert.equal(resP1.status, 200);
    const p1Data = await resP1.json();
    assert.equal(p1Data.lane, 1, '1st athlete gets Lane 1');
  } finally {
    await close();
  }
});

test('Duel 1v1 Bot via POST /api/rooms/join: Garmin watch PIN join accepts creator (guest, paired deviceToken, or Admin), assigns Lane 1 & Bot Lane 2, starts 15s countdown, and auto-launches at T=0', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const raceManager = RaceManager.getInstance();

    // Case A: User creates a Bot Duel on web with usr_xxx session ID, then enters 5-char PIN on Garmin watch (RowIQ_xxx)
    const createResA = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'duel_bot',
        targetDistance: 2000,
        hostUserId: 'usr_web_session_777',
        hostUserName: 'Rameur Solo'
      })
    });
    assert.equal(createResA.status, 201);
    const duelA = await createResA.json();
    assert.equal(duelA.race.isBotDuel, true);
    assert.equal(duelA.race.internalStatus, 'LOBBY', 'Must stay in LOBBY until PIN is validated');

    // Passive web sync (registerLane: false) must NOT trigger countdown prematurely
    const passiveSync = await fetch(`${baseUrl}/api/v1/races/private/${duelA.code}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr_web_session_777',
        userName: 'Rameur Solo',
        registerLane: false
      })
    });
    assert.equal(passiveSync.status, 200);
    const passiveData = await passiveSync.json();
    assert.equal(passiveData.race.internalStatus, 'LOBBY', 'Passive web view sync must not start 15s timer');

    // Garmin watch submits 5-char PIN via POST /api/rooms/join
    const watchJoinA = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: duelA.pinCode,
        code: duelA.pinCode,
        userId: 'RowIQ_watch_777',
        userName: 'RowIQ_watch_777'
      })
    });
    assert.equal(watchJoinA.status, 200, 'Watch PIN join on Bot Duel must succeed immediately without 403');
    const joinDataA = await watchJoinA.json();
    assert.equal(joinDataA.success, true);
    assert.equal(joinDataA.lane, 1, 'Human player must be assigned to Lane 1');
    assert.equal(joinDataA.botLane, 2, 'Bot must be assigned to Lane 2');
    assert.equal(joinDataA.internalStatus, 'COUNTDOWN', 'Must immediately start 15s countdown');
    assert.ok(joinDataA.secondsRemaining > 0 && joinDataA.secondsRemaining <= 15, 'Countdown must be 15s');
    assert.equal(joinDataA.hasBots, true);

    // Original web session hostUserId can still manage/reset the room
    assert.equal(
      raceManager.canManagePrivateRace(raceManager.findPrivateRace(duelA.code), 'usr_web_session_777', false),
      true,
      'Original web host session must retain management rights'
    );

    // Intruder trying to join the same Bot Duel via PIN after creator claimed seat -> 403
    const intruderJoin = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: duelA.pinCode,
        code: duelA.pinCode,
        userId: 'RowIQ_intruder_999',
        userName: 'Intruder'
      })
    });
    assert.equal(intruderJoin.status, 403, 'Second human must be blocked from 1v1 Bot Duel');

    // Case B: Admin (EmmaRacer) creates a 1v1_bot duel -> must NOT be spectator (lane 0), must get Lane 1 and start 15s countdown!
    const createResB = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: '1v1_bot',
        targetDistance: 1000,
        hostUserId: 'EmmaRacer',
        hostUserName: 'EmmaRacer'
      })
    });
    assert.equal(createResB.status, 201);
    const duelB = await createResB.json();

    const adminWatchJoin = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: duelB.pinCode,
        code: duelB.pinCode,
        userId: 'EmmaRacer',
        userName: 'EmmaRacer'
      })
    });
    assert.equal(adminWatchJoin.status, 200);
    const joinDataB = await adminWatchJoin.json();
    assert.equal(joinDataB.lane, 1, 'Admin creating a Bot Duel is a competitor on Lane 1, not spectator on Lane 0');
    assert.equal(joinDataB.botLane, 2);
    assert.equal(joinDataB.internalStatus, 'COUNTDOWN');
    assert.ok(joinDataB.secondsRemaining > 0 && joinDataB.secondsRemaining <= 15);

    // Case C: Paired watch with deviceToken (paired under guest ID) joining registered user's Bot Duel, then T=0 auto-start
    const pairCode = await pairingService.createPairingCode('usr_paired_before_login');
    const paired = await pairingService.pairDevice(pairCode.pairingCode, 'garmin_fenix_duel_device');
    assert.equal(paired.success, true);

    const duelC = raceManager.createPrivateRace({
      isBotDuel: true,
      targetDistance: 500,
      hostUserId: 'registered_login_after_pair',
      hostUserName: 'Athlete Pro'
    });

    const tokenJoinRes = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: duelC.pinCode,
        code: duelC.pinCode,
        userId: 'RowIQ_fenix',
        deviceToken: paired.deviceToken
      })
    });
    assert.equal(tokenJoinRes.status, 200, 'Authenticated Garmin deviceToken must be accepted for Bot Duel creator');
    const tokenJoinData = await tokenJoinRes.json();
    assert.equal(tokenJoinData.lane, 1);
    assert.equal(tokenJoinData.botLane, 2);
    assert.equal(tokenJoinData.internalStatus, 'COUNTDOWN');

    // Simulate end of 15s countdown (T = 0)
    duelC.lobbyEndsAt = new Date(Date.now() - 500);
    await raceManager.tickPrivateRaces();
    assert.equal(duelC.status, 'RUNNING', 'Race must automatically transition to RUNNING at T = 0');
    assert.ok(duelC.startedAt instanceof Date, 'startedAt must be set at T = 0');
  } finally {
    await close();
  }
});
