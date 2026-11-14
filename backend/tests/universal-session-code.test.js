const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const cors = require('cors');

const initRoutes = require('../dist/routes/index').default;
const socketGateway = require('../dist/websocket/socket.gateway').default;
const raceManager = require('../dist/services/race-manager.service').default;

function createTestServer() {
  return new Promise((resolve) => {
    const app = express();
    const server = http.createServer(app);
    socketGateway.init(server);

    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    initRoutes(app);

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

test('Universal 5-character session code: Generation, claim (account, room, guest), cross-device, migration and ready check', async () => {
  process.env.NODE_ENV = 'test';
  const { baseUrl, close } = await createTestServer();

  try {
    // 1. Generation of Universal 5-char code for guest cockpit
    const resCockpit = await fetch(`${baseUrl}/api/session/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'guest_cockpit', playerName: 'Alex' }),
    });
    assert.equal(resCockpit.status, 200);
    const dataCockpit = await resCockpit.json();
    assert.equal(dataCockpit.success, true);
    assert.equal(typeof dataCockpit.code, 'string');
    assert.equal(dataCockpit.code.length, 5);
    assert.equal(dataCockpit.playerName, 'Alex');
    assert.equal(dataCockpit.type, 'guest_cockpit');

    // 2. Garmin watch claims the cockpit code
    const resClaimCockpit = await fetch(`${baseUrl}/api/session/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: dataCockpit.code, deviceId: 'garmin_hw_cockpit' }),
    });
    assert.equal(resClaimCockpit.status, 200);
    const claimDataCockpit = await resClaimCockpit.json();
    assert.equal(claimDataCockpit.success, true);
    assert.equal(claimDataCockpit.mode, 'cockpit');
    assert.equal(typeof claimDataCockpit.deviceToken, 'string');
    assert.ok(claimDataCockpit.deviceToken.length > 10);

    // Reuse must fail (atomic single use)
    const resClaimAgain = await fetch(`${baseUrl}/api/session/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: dataCockpit.code, deviceId: 'garmin_hw_cockpit' }),
    });
    assert.equal(resClaimAgain.status, 400);

    // 3. Generation of Universal 5-char code for private room
    const hostUser = `host_${Date.now()}`;
    const raceCreated = raceManager.createPrivateRace('Regate 500m', 500, hostUser, 'Host Marc', 6, '1234');
    const roomId = raceCreated.id;

    const resRoomCode = await fetch(`${baseUrl}/api/session/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'room_join', roomId, playerName: 'Invite_Sam' }),
    });
    assert.equal(resRoomCode.status, 200);
    const roomCodeData = await resRoomCode.json();
    assert.equal(roomCodeData.code.length, 5);
    assert.equal(roomCodeData.roomId, roomId);

    // Garmin watch claims room code
    const resClaimRoom = await fetch(`${baseUrl}/api/session/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: roomCodeData.code, deviceId: 'garmin_hw_sam' }),
    });
    assert.equal(resClaimRoom.status, 200);
    const claimDataRoom = await resClaimRoom.json();
    assert.equal(claimDataRoom.success, true);
    assert.equal(claimDataRoom.mode, 'room');
    assert.equal(claimDataRoom.playerName, 'Invite_Sam');
    assert.ok(claimDataRoom.lane >= 1);

    // 4. Register new user with migration of guestPairingToken
    const uniqueLogin = `user_mig_${Date.now()}`;
    const resRegister = await fetch(`${baseUrl}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: uniqueLogin,
        email: `${uniqueLogin}@example.com`,
        password: 'password123',
        nom: 'Dupont',
        prenom: 'Jean',
        anneeNaissance: 1990,
        sexe: 'H',
        pays: 'France',
        guestPairingToken: claimDataCockpit.deviceToken, // migration via deviceToken
      }),
    });
    assert.equal(resRegister.status, 201);
    const regData = await resRegister.json();
    assert.equal(regData.success, true);
    assert.equal(regData.isGarminPaired, true);

    // 5. Cross-Device login persistence
    const resLogin = await fetch(`${baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: uniqueLogin, password: 'password123' }),
    });
    assert.equal(resLogin.status, 200);
    const loginData = await resLogin.json();
    assert.equal(loginData.success, true);
    assert.equal(loginData.isGarminPaired, true);
    assert.ok(loginData.pairedDevice);
    assert.equal(loginData.pairedDevice.deviceToken, claimDataCockpit.deviceToken);

    // 6. Machine à états BLE : Notification ready: true sur la room
    const resStatus = await fetch(`${baseUrl}/api/rooms/${roomId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceToken: claimDataRoom.deviceToken,
        ready: true,
      }),
    });
    assert.equal(resStatus.status, 200);
    const statusData = await resStatus.json();
    assert.equal(statusData.success, true);
    assert.equal(statusData.ready, true);
    assert.equal(statusData.connectionState, 'READY');
  } finally {
    await close();
  }
});
