const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const raceManager = require('../dist/services/race-manager.service').default;
const initRoomRoutes = require('../dist/routes/room.routes').default;
const initGarminRoutes = require('../dist/routes/garmin.routes').default;
const initSessionRoutes = require('../dist/routes/session.routes').default;
const userStore = require('../dist/services/user-store.service').default;
const socketGateway = require('../dist/websocket/socket.gateway').default;
const db = require('../dist/models').default;

test.before(async () => {
  await userStore.createUser({
    id: 'usr_host_default',
    login: 'host_default',
    name: 'HostDefault',
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

test('Saisie du code PIN sur la montre définit le salon par défaut et assigne une ligne d eau', async () => {
  const race = raceManager.createPrivateRace({
    title: 'Salon Pin Default Room Test',
    targetDistance: 2000,
    maxParticipants: 4,
    hostUserId: 'usr_host_default',
    hostUserName: 'HostDefault',
  });

  const pin = race.pinCode;
  assert.ok(pin, 'Le salon doit posséder un code PIN');
  assert.equal(pin.length, 5, 'Le code PIN doit comporter 5 caractères');

  // Capturer les diffusions socketGateway pour session_claimed et PARTICIPANT_JOINED
  const capturedBroadcasts = [];
  const originalBroadcast = socketGateway.broadcast.bind(socketGateway);
  const originalBroadcastPrivateRoomUpdate = socketGateway.broadcastPrivateRoomUpdate.bind(socketGateway);
  socketGateway.broadcast = (event, data) => {
    capturedBroadcasts.push({ event, data });
    return originalBroadcast(event, data);
  };
  socketGateway.broadcastPrivateRoomUpdate = (raceId, data) => {
    capturedBroadcasts.push({ event: 'private_room_update', raceId, data });
    return originalBroadcastPrivateRoomUpdate(raceId, data);
  };

  const { baseUrl, close } = await createTestServer();
  try {
    // 1. L'hôte saisit le PIN sur sa montre : il doit récupérer le siège Ligne 1
    const res1 = await fetch(`${baseUrl}/api/session/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: pin,
        deviceId: 'WATCH_DEVICE_HOST',
        playerName: 'HostDefault',
      }),
    });

    const data1 = await res1.json();
    assert.equal(res1.status, 200);
    assert.equal(data1.success, true);
    assert.equal(data1.mode, 'room');
    assert.equal(data1.roomId, race.id);
    assert.equal(data1.lane, 1, 'L hôte doit occuper la ligne 1');
    assert.ok(data1.deviceToken, 'Un deviceToken doit être généré');

    // Vérifier que le salon est désormais le salon actif / par défaut de ce joueur dans le backend
    const activeForHost = raceManager.findActiveRaceForUser(data1.userId, data1.deviceToken);
    assert.ok(activeForHost, 'findActiveRaceForUser doit retrouver le salon actif pour l hôte');
    assert.equal(activeForHost.id, race.id);

    // 2. Un invité saisit le même PIN sur sa montre : il doit recevoir la première ligne libre (Ligne 2)
    const res2 = await fetch(`${baseUrl}/api/session/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: pin,
        deviceId: 'WATCH_DEVICE_GUEST_2',
        playerName: 'Kayakiste_2',
      }),
    });

    const data2 = await res2.json();
    assert.equal(res2.status, 200);
    assert.equal(data2.success, true);
    assert.equal(data2.mode, 'room');
    assert.equal(data2.roomId, race.id);
    assert.equal(data2.lane, 2, 'L invité doit recevoir la première ligne libre (Ligne 2)');

    const activeForGuest = raceManager.findActiveRaceForUser(data2.userId, data2.deviceToken);
    assert.ok(activeForGuest, 'findActiveRaceForUser doit retrouver le salon actif pour l invité');
    assert.equal(activeForGuest.id, race.id);

    // 3. Vérifier les notifications Socket.IO
    const sessionClaimedEvents = capturedBroadcasts.filter(b => b.event === 'session_claimed');
    assert.ok(sessionClaimedEvents.length >= 2, 'session_claimed doit être diffusé pour chaque saisie de code PIN');
    assert.equal(sessionClaimedEvents[0].data.lane, 1);
    assert.equal(sessionClaimedEvents[0].data.roomId, race.id);
    assert.equal(sessionClaimedEvents[1].data.lane, 2);
    assert.equal(sessionClaimedEvents[1].data.roomId, race.id);

    const roomUpdates = capturedBroadcasts.filter(b => b.event === 'private_room_update' && b.data?.type === 'PARTICIPANT_JOINED');
    assert.ok(roomUpdates.length >= 2, 'PARTICIPANT_JOINED doit être diffusé pour installer le kayak');
  } finally {
    socketGateway.broadcast = originalBroadcast;
    socketGateway.broadcastPrivateRoomUpdate = originalBroadcastPrivateRoomUpdate;
    await close();
  }
});
