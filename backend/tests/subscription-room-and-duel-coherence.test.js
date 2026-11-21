const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initUserRoutes = require('../dist/routes/user.routes').default;
const initDuelRoutes = require('../dist/routes/duel.routes').default;
const initRoomRoutes = require('../dist/routes/room.routes').default;
const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const db = require('../dist/models').default;
const userStore = require('../dist/services/user-store.service').default;

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  initUserRoutes(app);
  initDuelRoutes(app);
  initRoomRoutes(app);
  initTelemetryRoutes(app);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}

function futureUtcSlot(daysAhead = 2, hourUtc = 14, durationMinutes = 60) {
  const base = new Date();
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + daysAhead, hourUtc, 0, 0, 0));
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

test('Cohérence Abonnement & Salons / Duels', async (t) => {
  const { baseUrl, close } = await createTestServer();

  t.after(async () => {
    await close();
  });

  // Création des profils de test :
  // 1. Joueur Gratuit
  const freeUser = {
    id: `usr_free_${Date.now()}`,
    login: `free_user_${Date.now()}`,
    name: 'Free Racer',
    email: `free_${Date.now()}@example.com`,
    subscriptionTier: 'free',
    isSubscriber: false,
    isAdmin: false,
  };
  await userStore.createUser(freeUser);

  // 2. Joueur Club (Standard - 5000m, 5 participants, 3 bots)
  const clubUser = {
    id: `usr_club_${Date.now()}`,
    login: `club_user_${Date.now()}`,
    name: 'Club Racer',
    email: `club_${Date.now()}@example.com`,
    subscriptionTier: 'club',
    isSubscriber: true,
    isAdmin: false,
  };
  await userStore.createUser(clubUser);

  // 3. Joueur Élite Pro (Premium - 10000m, 10 participants, 5 bots)
  const proUser = {
    id: `usr_pro_${Date.now()}`,
    login: `pro_user_${Date.now()}`,
    name: 'Elite Racer',
    email: `pro_${Date.now()}@example.com`,
    subscriptionTier: 'elite_pro',
    isSubscriber: true,
    isAdmin: false,
  };
  await userStore.createUser(proUser);

  // 4. Joueur Admin
  const adminUser = {
    id: `usr_admin_${Date.now()}`,
    login: `admin_user_${Date.now()}`,
    name: 'Admin Racer',
    email: `admin_${Date.now()}@example.com`,
    subscriptionTier: 'elite_pro',
    isSubscriber: true,
    isAdmin: true,
  };
  await userStore.createUser(adminUser);

  await t.test('1. Joueur Gratuit : duel 1v1 à 2000m réussi, rejet à 5000m', async () => {
    const slot = futureUtcSlot(1, 10);

    // Tentative de défi 1v1 à 5000m -> doit être rejeté (403)
    const resOver = await fetch(`${baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId: freeUser.id,
        challengedLogin: clubUser.login,
        slotStart: slot.startIso,
        slotEnd: slot.endIso,
        targetDistance: 5000,
      }),
    });
    assert.strictEqual(resOver.status, 403);
    const bodyOver = await resOver.json();
    assert.strictEqual(bodyOver.success, false);
    assert.match(bodyOver.error || bodyOver.message, /limite la distance des duels à 2000m/i);

    // Défi 1v1 à 2000m -> doit réussir (201)
    const slot2 = futureUtcSlot(1, 14);
    const resOk = await fetch(`${baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId: freeUser.id,
        challengedLogin: clubUser.login,
        slotStart: slot2.startIso,
        slotEnd: slot2.endIso,
        targetDistance: 2000,
      }),
    });
    assert.strictEqual(resOk.status, 201);
    const bodyOk = await resOk.json();
    assert.strictEqual(bodyOk.success, true);
    assert.strictEqual(bodyOk.challenge.targetDistance, 2000);
  });

  await t.test('2. Joueur Gratuit : rejet de création de salon multi-joueurs', async () => {
    const res = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: freeUser.id,
        title: 'Salon Interdit Gratuit',
        targetDistance: 2000,
        maxParticipants: 4,
        mode: 'multi',
      }),
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'SUBSCRIBER_REQUIRED');
  });

  await t.test('3. Joueur Club : création réussie (5000m, 5 joueurs, 3 bots), rejets sur dépassements', async () => {
    // Dépassement distance : 10000m demandé
    const resDistOver = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: clubUser.id,
        title: 'Club Salon 10k',
        targetDistance: 10000,
        maxParticipants: 5,
        mode: 'multi',
      }),
    });
    assert.strictEqual(resDistOver.status, 403);
    const bodyDist = await resDistOver.json();
    assert.strictEqual(bodyDist.code, 'DISTANCE_LIMIT_EXCEEDED');

    // Dépassement participants : 8 demandés (> 5)
    const resPartOver = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: clubUser.id,
        title: 'Club Salon 8 Joueurs',
        targetDistance: 5000,
        maxParticipants: 8,
        mode: 'multi',
      }),
    });
    assert.strictEqual(resPartOver.status, 403);
    const bodyPart = await resPartOver.json();
    assert.strictEqual(bodyPart.code, 'MAX_PARTICIPANTS_EXCEEDED');

    // Dépassement bots : 4 demandés (> 3)
    const resBotsOver = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: clubUser.id,
        title: 'Club Salon 4 Bots',
        targetDistance: 5000,
        maxParticipants: 5,
        botCount: 4,
        mode: 'multi',
      }),
    });
    assert.strictEqual(resBotsOver.status, 403);
    const bodyBots = await resBotsOver.json();
    assert.strictEqual(bodyBots.code, 'BOT_LIMIT_EXCEEDED');

    // Conforme : 5000m, 5 participants, 3 bots -> Succès (201)
    const resOk = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: clubUser.id,
        title: 'Club Salon Valide',
        targetDistance: 5000,
        maxParticipants: 5,
        botCount: 3,
        mode: 'multi',
      }),
    });
    assert.strictEqual(resOk.status, 201);
    const bodyOk = await resOk.json();
    assert.strictEqual(bodyOk.success, true);
    assert.strictEqual(bodyOk.race.targetDistance, 5000);
    assert.strictEqual(bodyOk.race.maxParticipants, 5);
  });

  await t.test('4. Règle Invité : le joueur Gratuit peut rejoindre un duel de 10000m créé par un joueur Élite Pro', async () => {
    const slot = futureUtcSlot(2, 16);

    // Élite Pro crée un défi de 10 000m
    const resCreate = await fetch(`${baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId: proUser.id,
        challengedLogin: freeUser.login,
        slotStart: slot.startIso,
        slotEnd: slot.endIso,
        targetDistance: 10000,
      }),
    });
    assert.strictEqual(resCreate.status, 201);
    const createdChallenge = (await resCreate.json()).challenge;
    assert.strictEqual(createdChallenge.targetDistance, 10000);

    // Le joueur Gratuit (invité) accepte le duel -> Succès sans blocage de distance !
    const resRespond = await fetch(`${baseUrl}/api/duels/${createdChallenge.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: freeUser.id,
        action: 'accept',
      }),
    });
    assert.strictEqual(resRespond.status, 200);
    const respBody = await resRespond.json();
    assert.strictEqual(respBody.success, true);
    assert.strictEqual(respBody.challenge.status, 'ACCEPTED');

    // Le joueur Gratuit rejoint la course de 10000m via /api/rooms/join -> Succès !
    const resJoin = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: createdChallenge.roomCode,
        userId: freeUser.id,
        userName: freeUser.name,
      }),
    });
    assert.strictEqual(resJoin.status, 200);
    const joinBody = await resJoin.json();
    assert.strictEqual(joinBody.success, true);
    assert.strictEqual(joinBody.targetDistance, 10000);
  });

  await t.test('5. Administrateur : création sans restriction de distance et participants', async () => {
    const resAdmin = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: adminUser.id,
        title: 'Course Géante Admin',
        targetDistance: 50000,
        maxParticipants: 20,
        botCount: 10,
        mode: 'multi',
      }),
    });
    assert.strictEqual(resAdmin.status, 201);
    const bodyAdmin = await resAdmin.json();
    assert.strictEqual(bodyAdmin.success, true);
    assert.strictEqual(bodyAdmin.race.targetDistance, 50000);
    assert.strictEqual(bodyAdmin.race.maxParticipants, 20);
  });
});
