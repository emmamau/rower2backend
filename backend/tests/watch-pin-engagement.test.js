const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const raceManager = require('../dist/services/race-manager.service').default;
const initRoomRoutes = require('../dist/routes/room.routes').default;
const initGarminRoutes = require('../dist/routes/garmin.routes').default;
const initSessionRoutes = require('../dist/routes/session.routes').default;
const userStore = require('../dist/services/user-store.service').default;
const db = require('../dist/models').default;

test.before(async () => {
  await userStore.createUser({
    id: 'usr_emma_pin',
    login: 'emma_pin',
    name: 'EmmaPin',
    isSubscriber: true,
  });
  await userStore.createUser({
    id: 'usr_guest_consult',
    login: 'guest_consult',
    name: 'GuestConsult',
    isSubscriber: true,
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

test('1. Consultation d’un salon web via joinRoom sans PIN ne doit pas engager de couloir (lane 0, spectator)', async () => {
  const race = raceManager.createPrivateRace({
    title: 'Salon Consultation Test',
    targetDistance: 2000,
    maxParticipants: 4,
    hostUserId: 'usr_emma_pin',
    hostUserName: 'EmmaPin',
  });

  const { baseUrl, close } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: race.code,
        userId: 'usr_guest_consult',
        userName: 'GuestConsult',
        openOnly: true,
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.lane, 0, 'La consultation web sans PIN donne le couloir 0');
    assert.equal(data.waitingWatchPin, true, 'Indique que le salon attend la saisie du code PIN montre');
    assert.equal(race.participants.has('usr_guest_consult'), false, 'La consultation web ne doit pas ajouter l’invité aux participants');
  } finally {
    await close();
  }
});

test('2. Saisie du code PIN par la montre engage l’utilisateur sur la ligne de départ', async () => {
  const race = raceManager.createPrivateRace({
    title: 'Salon Validation PIN Montre',
    targetDistance: 2000,
    maxParticipants: 4,
    hostUserId: 'usr_emma_pin',
    hostUserName: 'EmmaPin',
  });

  const pin = race.pinCode;
  assert.ok(pin, 'Un code PIN doit exister pour le salon');

  const { baseUrl, close } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/garmin/claim-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketPin: pin,
        deviceId: 'WATCH_DEVICE_PIN_123',
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.lane >= 1, 'Un couloir de départ doit être attribué');
    assert.equal(data.ready, false, 'Le couloir est initialement en attente de READY');
  } finally {
    await close();
  }
});
