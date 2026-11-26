const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const raceManager = require('../dist/services/race-manager.service').default;
const userStore = require('../dist/services/user-store.service').default;
const initRaceRoutes = require('../dist/routes/race.routes').default;
const initRoomRoutes = require('../dist/routes/room.routes').default;
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const initActivityRoutes = require('../dist/routes/activity.routes').default;
const initGarminRoutes = require('../dist/routes/garmin.routes').default;
const initSessionRoutes = require('../dist/routes/session.routes').default;
const db = require('../dist/models').default;

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  initRaceRoutes(app);
  initRoomRoutes(app);
  initTelemetryRoutes(app);
  initActivityRoutes(app);
  initGarminRoutes(app);
  initSessionRoutes(app);
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

test('1. Course publique : respect strict du plafond de joueurs fixé par l’administrateur (hors bots) et rejet des appels HTTPS non engagés', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // Configurer la course publique par l'administrateur : maxParticipants = 2 joueurs humains, defaultBotsCount = 2 bots
    raceManager.updatePublicRaceConfig({
      targetDistance: 1000,
      maxParticipants: 2,
      defaultBotsCount: 2,
      lobbyWaitMinutes: 15,
    });
    const pubRace = await raceManager.initNextPublicRace(15);
    assert.equal(pubRace.maxParticipants, 2);

    // Joueur 1 s'engage -> 200 OK
    const resJ1 = await fetch(`${baseUrl}/api/race/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'pub_player_1',
        userName: 'AlicePub',
        deviceId: 'DEV_PUB_1',
      }),
    });
    assert.equal(resJ1.status, 200);
    const dataJ1 = await resJ1.json();
    assert.equal(dataJ1.success, true);
    assert.equal(dataJ1.lane, 1);

    // Joueur 2 s'engage -> 200 OK (le quota de 2 humains est maintenant atteint malgré la présence de 2 bots)
    const resJ2 = await fetch(`${baseUrl}/api/race/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'pub_player_2',
        userName: 'BobPub',
        deviceId: 'DEV_PUB_2',
      }),
    });
    assert.equal(resJ2.status, 200);
    const dataJ2 = await resJ2.json();
    assert.equal(dataJ2.success, true);
    assert.equal(dataJ2.lane, 2);
    assert.equal(raceManager.getEngagedHumanCount(pubRace), 2);

    // Joueur 3 tente de s'engager -> REFUS HTTP 409 (quota atteint)
    const resJ3 = await fetch(`${baseUrl}/api/race/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'pub_intruder_3',
        userName: 'IntruderPub',
        deviceId: 'DEV_PUB_3',
      }),
    });
    assert.equal(resJ3.status, 409, 'Le 3ème joueur doit être refusé car le plafond admin est fixé à 2');

    // Joueur 3 tente de rejoindre via le code PIN de la course publique -> REFUS HTTP 409
    const resPin3 = await fetch(`${baseUrl}/api/v1/races/pin/${pubRace.pinCode}?userId=pub_intruder_3&userName=IntruderPub`);
    assert.equal(resPin3.status, 409, 'L’accès par PIN à une course publique complète doit être refusé');

    // Joueur 3 (non engagé) tente d'envoyer des appels HTTPS de télémétrie (/api/v1/telemetry et /api/activity/sync) pour s'incruster dans la course
    const resTelemIntruder = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceId: pubRace.id,
        userId: 'pub_intruder_3',
        userName: 'IntruderPub',
        seq: 1,
        elapsedTime: 5,
        metrics: {
          distanceM: 50,
          splitSec: 115,
          powerWatts: 230,
          strokeRate: 28,
        },
      }),
    });
    assert.equal(resTelemIntruder.status, 403, 'L’appel HTTPS /api/v1/telemetry d’un joueur non engagé doit être rejeté (403)');

    const resSyncIntruder = await fetch(`${baseUrl}/api/activity/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activityId: pubRace.id,
        userId: 'pub_intruder_3',
        userName: 'IntruderPub',
        currentDistance: 100,
        lastPower: 220,
        lastPace: 118,
        lastStrokeRate: 27,
      }),
    });
    assert.equal(resSyncIntruder.status, 403, 'L’appel HTTPS /api/activity/sync d’un joueur non engagé doit être rejeté (403)');

    // Vérifier que la course publique n'a PAS été polluée par pub_intruder_3
    assert.equal(pubRace.participants.has('pub_intruder_3'), false, 'Le joueur non engagé ne doit pas apparaître dans participants');
    assert.equal(userStore.findActivityById(`${pubRace.id}_pub_intruder_3`), null, 'Aucune activité ne doit être créée pour le joueur non engagé');

    // Vérifier qu'un joueur légitimement engagé (pub_player_1) peut envoyer sa télémétrie
    pubRace.status = 'RUNNING';
    pubRace.startedAt = new Date();
    const resTelemLegit = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceId: pubRace.id,
        userId: 'pub_player_1',
        userName: 'AlicePub',
        seq: 1,
        elapsedTime: 5,
        metrics: {
          distanceM: 20,
          splitSec: 120,
          powerWatts: 203,
          strokeRate: 26,
        },
      }),
    });
    assert.equal(resTelemLegit.status, 200, 'Le joueur engagé doit pouvoir transmettre sa télémétrie');

    // Même si le plafond était augmenté après le départ, aucun nouveau joueur (join_late) ne peut rejoindre une course RUNNING
    pubRace.maxParticipants = 6;
    const resLateJoin = await fetch(`${baseUrl}/api/race/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'pub_late_4',
        userName: 'LatePlayer',
        action: 'join_late',
      }),
    });
    assert.equal(resLateJoin.status, 409, 'Aucun joueur non engagé ne peut rejoindre une course déjà en cours (RUNNING)');

    // Remettre la config par défaut
    raceManager.updatePublicRaceConfig({ maxParticipants: 6 });
  } finally {
    await close();
  }
});

test('2. Salon privé avec bots et approbation : plafond humain strict (hors bots), purge automatique des demandes en attente et rejet HTTPS des non-engagés', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // Créer un salon privé de 3 joueurs humains max + 2 bots, avec approbation de l'hôte activée
    // L'hôte (host_cap_1) occupe la Ligne 1 -> il reste 2 places humaines malgré les 2 bots
    const salon = raceManager.createPrivateRace({
      title: 'Salon Capacité & Bots',
      targetDistance: 2000,
      maxParticipants: 3,
      botCount: 2,
      hostUserId: 'host_cap_1',
      hostUserName: 'HostCap',
      adminAsSpectator: false,
      hostParticipates: true,
      requireApproval: true,
    });

    // Vérifier que les 2 bots ne réduisent pas les places humaines : 1 seul humain engagé (l'hôte)
    assert.equal(raceManager.getEngagedHumanCount(salon), 1, 'Les bots ne doivent pas compter dans le quota de joueurs humains');
    assert.equal(raceManager.getEffectiveMaxHumanParticipants(salon), 3);

    // 3 joueurs demandent à rejoindre -> mis en file d'attente (pendingParticipants) tant que le salon n'est pas complet
    for (const [uid, name] of [
      ['cand_1', 'Candidat 1'],
      ['cand_2', 'Candidat 2'],
      ['cand_3', 'Candidat 3'],
    ]) {
      const r = await fetch(`${baseUrl}/api/rooms/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: salon.code, userId: uid, userName: name }),
      });
      assert.equal(r.status, 200);
      assert.equal(salon.pendingParticipants.has(uid), true);
    }

    // Tant que cand_1 est en attente (non approuvé), ses appels HTTPS de télémétrie et de statut BLE doivent être rejetés (403)
    const resPendingTelem = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceId: salon.id,
        userId: 'cand_1',
        seq: 1,
        metrics: { distanceM: 15, powerWatts: 200, splitSec: 120, strokeRate: 25 },
      }),
    });
    assert.equal(resPendingTelem.status, 403, 'Un joueur en attente de validation ne doit pas pouvoir envoyer de télémétrie');

    const resPendingStatus = await fetch(`${baseUrl}/api/rooms/${salon.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'cand_1', ready: true }),
    });
    assert.equal(resPendingStatus.status, 403, 'Un joueur non engagé ne doit pas pouvoir modifier le statut BLE du salon');

    // L'hôte approuve cand_1 (2/3 humains) et cand_2 (3/3 humains -> quota atteint !)
    const app1 = await fetch(`${baseUrl}/api/v1/races/private/${salon.id}/approve-participant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostUserId: 'host_cap_1', targetUserId: 'cand_1', approve: true }),
    });
    assert.equal(app1.status, 200);
    assert.equal(raceManager.getEngagedHumanCount(salon), 2);

    const app2 = await fetch(`${baseUrl}/api/v1/races/private/${salon.id}/approve-participant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostUserId: 'host_cap_1', targetUserId: 'cand_2', approve: true }),
    });
    assert.equal(app2.status, 200);
    assert.equal(raceManager.getEngagedHumanCount(salon), 3);

    // Dès que le quota de 3 humains est atteint, cand_3 qui était en attente doit avoir été automatiquement rejeté et purgé
    assert.equal(salon.pendingParticipants.size, 0, 'La file d’attente doit être purgée dès que le salon est complet');
    assert.equal(salon.rejectedParticipants.has('cand_3'), true, 'Les demandes excédentaires doivent être marquées rejetées');

    // Toute nouvelle demande (join, ticket invité, claim PIN) sur ce salon complet doit être refusée avec HTTP 409
    const resJoin4 = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: salon.code, userId: 'cand_4', userName: 'Candidat 4' }),
    });
    assert.equal(resJoin4.status, 409);

    const resTicketFull = await fetch(`${baseUrl}/api/rooms/${salon.id}/guest-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestName: 'TicketIntruder' }),
    });
    assert.equal(resTicketFull.status, 409, 'La génération de ticket invité doit être refusée quand le salon est complet');

    const resClaimFull = await fetch(`${baseUrl}/api/session/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: salon.pinCode, deviceId: 'WATCH_INTRUDER_99', pseudo: 'WatchIntruder' }),
    });
    assert.equal(resClaimFull.status, 409, 'La réclamation du code PIN montre sur un salon complet doit être refusée (409)');

    // Un inconnu tente d'envoyer un appel HTTPS /api/rooms/:id/status ou /api/v1/telemetry sur le salon -> 403 Forbidden
    const resUnknownStatus = await fetch(`${baseUrl}/api/rooms/${salon.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'ghost_hacker', ready: true }),
    });
    assert.equal(resUnknownStatus.status, 403);
    assert.equal(salon.participants.has('ghost_hacker'), false, 'ghost_hacker ne doit jamais être ajouté aux participants');

    const resUnknownTelem = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceId: salon.id,
        userId: 'ghost_hacker',
        seq: 1,
        metrics: { distanceM: 100, powerWatts: 300, splitSec: 105, strokeRate: 32 },
      }),
    });
    assert.equal(resUnknownTelem.status, 403);
    assert.equal(userStore.findActivityById(`${salon.id}_ghost_hacker`), null);
  } finally {
    await close();
  }
});
