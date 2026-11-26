const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const raceManager = require('../dist/services/race-manager.service').default;
const initRoomRoutes = require('../dist/routes/room.routes').default;
const initGarminRoutes = require('../dist/routes/garmin.routes').default;
const initSessionRoutes = require('../dist/routes/session.routes').default;
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const initRaceRoutes = require('../dist/routes/race.routes').default;
const initDuelRoutes = require('../dist/routes/duel.routes').default;
const userStore = require('../dist/services/user-store.service').default;
const duelService = require('../dist/services/duel.service').default;
const db = require('../dist/models').default;

test.before(async () => {
  await userStore.createUser({
    id: 'usr_host_rules',
    login: 'host_rules',
    name: 'HostRules',
    isSubscriber: true,
    subscriptionTier: 'pro',
    customConcurrentRooms: 20,
    customWeeklyRooms: 50,
  });
  await userStore.createUser({
    id: 'usr_player2_rules',
    login: 'player2_rules',
    name: 'Player2Rules',
    isSubscriber: true,
    subscriptionTier: 'pro',
  });
});

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  initRoomRoutes(app);
  initGarminRoutes(app);
  initSessionRoutes(app);
  initTelemetryRoutes(app);
  initRaceRoutes(app);
  initDuelRoutes(app);
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

test('1. Ouverture d’un duel ou salon depuis le front web n’engage PAS le kayak sur une ligne d’eau avant la saisie du PIN sur la montre', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // Création d'un salon privé par l'hôte depuis le web
    const createRes = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Duel Test Sans PIN',
        targetDistance: 2000,
        maxParticipants: 2,
        hostUserId: 'usr_host_rules',
        hostUserName: 'HostRules',
        gameMode: 'multi',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.lane, 0, 'Le créateur ne doit pas avoir de couloir actif avant la saisie du PIN montre');

    // Aussi tester un duel 1v1 créé via RaceManager (comme lors d'un défi duel)
    const duelRace = raceManager.createPrivateRace({
      title: 'Duel 1v1 Test Web',
      targetDistance: 2000,
      maxParticipants: 2,
      hostUserId: 'usr_host_rules',
      hostUserName: 'HostRules',
      isDuel1v1: true,
      gameMode: 'duel_1v1',
    });

    // Ouverture du duel depuis le front web par le créateur (openOnly: true)
    const openDuelRes = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: duelRace.code,
        userId: 'usr_host_rules',
        userName: 'HostRules',
        openOnly: true,
      }),
    });
    assert.equal(openDuelRes.status, 200);
    const openDuelData = await openDuelRes.json();
    assert.equal(openDuelData.lane, 0, 'openOnly sur un duel 1v1 ne doit pas engager le kayak du créateur sur une ligne d’eau');
    assert.equal(openDuelData.waitingWatchPin, true);

    // Ouverture du salon depuis le front web par le créateur (openOnly: true)
    const openHostRes = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: created.code,
        userId: 'usr_host_rules',
        userName: 'HostRules',
        openOnly: true,
      }),
    });
    assert.equal(openHostRes.status, 200);
    const openHostData = await openHostRes.json();
    assert.equal(openHostData.lane, 0, 'openOnly par le créateur ne doit pas engager son kayak sur une ligne d’eau');
    assert.equal(openHostData.waitingWatchPin, true);

    // Le leaderboard de la course ne doit contenir AUCUN kayak humain tant que le PIN n'est pas saisi sur la montre
    const lbBeforePinRes = await fetch(`${baseUrl}/api/race/${created.race.id}/leaderboard`);
    assert.equal(lbBeforePinRes.status, 200);
    const lbBeforePin = await lbBeforePinRes.json();
    assert.equal(lbBeforePin.leaderboard.length, 0, 'Aucun kayak ne doit être engagé sur une ligne d’eau avant la saisie du PIN');

    // Saisie du code PIN sur la montre par le joueur 1
    const claim1Res = await fetch(`${baseUrl}/api/session/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: created.pinCode,
        deviceId: 'WATCH_DUEL_P1',
        playerName: 'HostRules',
      }),
    });
    assert.equal(claim1Res.status, 200);
    const claim1 = await claim1Res.json();
    assert.equal(claim1.lane, 1, 'Après saisie du PIN sur la montre, le kayak est engagé sur la ligne 1');

    const lbAfterPin1Res = await fetch(`${baseUrl}/api/race/${created.race.id}/leaderboard`);
    const lbAfterPin1 = await lbAfterPin1Res.json();
    assert.equal(lbAfterPin1.leaderboard.length, 1, 'Le kayak du joueur 1 est maintenant visible sur sa ligne d’eau');
  } finally {
    await close();
  }
});

test('2. Verrouillage du démarrage à 15s tant qu’il n’y a pas au moins 2 kayaks engagés sur une ligne d’eau', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // Création d'un salon privé multijoueur sans bot
    const createRes = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Salon Min 2 Kayaks',
        targetDistance: 2000,
        maxParticipants: 4,
        hostUserId: 'usr_host_rules',
        hostUserName: 'HostRules',
        gameMode: 'multi',
        botCount: 0,
        requireApproval: false,
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    // 0 kayak engagé -> tentative de démarrage à 15s refusée (409)
    const start0Res = await fetch(`${baseUrl}/api/v1/races/private/${created.code}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: 'usr_host_rules',
        countdownSeconds: 15,
      }),
    });
    assert.equal(start0Res.status, 409, 'Démarrage 15s refusé avec 0 kayak engagé');

    // 1er joueur saisit le PIN sur sa montre -> 1 seul kayak engagé
    const claim1Res = await fetch(`${baseUrl}/api/session/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: created.pinCode,
        deviceId: 'WATCH_MULTI_1',
        playerName: 'HostRules',
      }),
    });
    assert.equal(claim1Res.status, 200);

    // 1 seul kayak engagé -> tentative de démarrage à 15s toujours refusée (409), même par un admin !
    const start1Res = await fetch(`${baseUrl}/api/v1/races/private/${created.code}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: 'EmmaRacer',
        countdownSeconds: 15,
      }),
    });
    assert.equal(start1Res.status, 409, 'Démarrage 15s refusé avec 1 seul kayak engagé (y compris pour admin)');

    // 2e joueur saisit le PIN sur sa montre -> 2 kayaks engagés
    const claim2Res = await fetch(`${baseUrl}/api/session/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: created.pinCode,
        deviceId: 'WATCH_MULTI_2',
        playerName: 'Player2Rules',
      }),
    });
    assert.equal(claim2Res.status, 200);
    const claim2Data = await claim2Res.json();
    assert.equal(claim2Data.lane, 2);

    // 2 kayaks engagés -> démarrage à 15s autorisé (200)
    const start2Res = await fetch(`${baseUrl}/api/v1/races/private/${created.code}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: 'usr_host_rules',
        countdownSeconds: 15,
      }),
    });
    assert.equal(start2Res.status, 200, 'Démarrage 15s autorisé dès que 2 kayaks sont engagés sur une ligne d’eau');
    const start2Data = await start2Res.json();
    assert.equal(start2Data.internalStatus, 'COUNTDOWN');
  } finally {
    await close();
  }
});

test('3. Interdiction d’ajouter ou de retirer des bots à la volée lorsqu’une course est lancée (COUNTDOWN ou RUNNING)', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // Création d'un salon privé avec 1 bot
    const createRes = await fetch(`${baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Salon Lock Bots',
        targetDistance: 2000,
        maxParticipants: 4,
        hostUserId: 'usr_host_rules',
        hostUserName: 'HostRules',
        gameMode: 'multi',
        botCount: 1,
        requireApproval: false,
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    // L'hôte engage son kayak via PIN montre (1 humain + 1 bot = 2 kayaks engagés)
    await fetch(`${baseUrl}/api/session/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: created.pinCode,
        deviceId: 'WATCH_BOT_LOCK_1',
        playerName: 'HostRules',
      }),
    });

    // Lancement du décompte à 15s -> statut COUNTDOWN
    const startRes = await fetch(`${baseUrl}/api/v1/races/private/${created.code}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: 'usr_host_rules',
        countdownSeconds: 15,
      }),
    });
    assert.equal(startRes.status, 200);

    // Tentative d'ajout de bots pendant COUNTDOWN -> 409
    const botsDuringCountdown = await fetch(`${baseUrl}/api/race/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enable: true,
        raceId: created.race.id,
        userId: 'usr_host_rules',
        botCount: 3,
      }),
    });
    assert.equal(botsDuringCountdown.status, 409, 'Impossible d’ajouter des bots pendant le décompte de départ');

    // Passage en RUNNING
    const race = raceManager.findPrivateRace(created.race.id);
    race.status = 'RUNNING';

    // Tentative d'ajout ou retrait de bots pendant RUNNING -> 409
    const botsDuringRunning = await fetch(`${baseUrl}/api/race/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enable: false,
        raceId: created.race.id,
        userId: 'usr_host_rules',
        botCount: 0,
      }),
    });
    assert.equal(botsDuringRunning.status, 409, 'Impossible de modifier les bots pendant que la course est en cours');

    // updateSalonBots direct doit aussi refuser toute modification
    const directUpdate = await raceManager.updateSalonBots(created.race.id, 3);
    assert.equal(directUpdate, null, 'updateSalonBots doit retourner null quand la course est lancée');
  } finally {
    await close();
  }
});
