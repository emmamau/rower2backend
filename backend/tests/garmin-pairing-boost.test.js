const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const cors = require('cors');

const initRoutes = require('../dist/routes/index').default;
const socketGateway = require('../dist/websocket/socket.gateway').default;

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

test('Garmin Pairing Protocol: 6-char code generation, watch pairing, deviceToken, and revocation', async () => {
  process.env.NODE_ENV = 'test';
  const { baseUrl, close } = await createTestServer();

  try {
    const userId = `athlete_${Date.now()}`;
    const deviceId = `fenix7_hw_${Date.now()}`;

    // 1. Generation without identity is rejected
    const resNoId = await fetch(`${baseUrl}/api/garmin/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(resNoId.status, 400);

    // 2. Generate pairing code for athlete
    const resCode = await fetch(`${baseUrl}/api/garmin/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    assert.equal(resCode.status, 200);
    const codeData = await resCode.json();
    assert.equal(codeData.success, true);
    assert.equal(codeData.userId, userId);
    assert.equal(typeof codeData.pairingCode, 'string');
    assert.equal(codeData.pairingCode.length, 6);
    assert.equal(codeData.expiresInSeconds, 300);

    const pairingCode = codeData.pairingCode;

    // 3. Status before pairing
    const resStatusBefore = await fetch(`${baseUrl}/api/garmin/pairing-status?userId=${userId}`);
    assert.equal(resStatusBefore.status, 200);
    const statusBeforeData = await resStatusBefore.json();
    assert.equal(statusBeforeData.paired, false);

    // 4. Watch pairing with bad input rejected
    const resBadCode = await fetch(`${baseUrl}/api/garmin/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: 'WRONG1', deviceId }),
    });
    assert.equal(resBadCode.status, 400);

    // 5. Watch pairs with legitimate 6-character code
    const resPair = await fetch(`${baseUrl}/api/garmin/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, deviceId }),
    });
    assert.equal(resPair.status, 200);
    const pairData = await resPair.json();
    assert.equal(pairData.success, true);
    assert.equal(pairData.userId, userId);
    assert.equal(pairData.deviceId, deviceId);
    assert.ok(pairData.deviceToken);
    // UUID v4 format verification
    assert.match(
      pairData.deviceToken,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const deviceToken = pairData.deviceToken;

    // 6. Ephemeral code is destroyed: second attempt must fail
    const resPairAgain = await fetch(`${baseUrl}/api/garmin/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, deviceId }),
    });
    assert.equal(resPairAgain.status, 400);

    // 7. Web detects pairing in real time via polling/status
    const resStatusAfter = await fetch(`${baseUrl}/api/garmin/pairing-status?userId=${userId}`);
    assert.equal(resStatusAfter.status, 200);
    const statusAfterData = await resStatusAfter.json();
    assert.equal(statusAfterData.paired, true);
    assert.equal(statusAfterData.status, 'paired');
    assert.equal(statusAfterData.deviceId, deviceId);
    assert.equal(statusAfterData.deviceToken, deviceToken);

    // 8. Device status endpoint
    const resDevStatus = await fetch(`${baseUrl}/api/garmin/status`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    assert.equal(resDevStatus.status, 200);
    const devStatusData = await resDevStatus.json();
    assert.equal(devStatusData.success, true);
    assert.equal(devStatusData.userId, userId);
    assert.equal(devStatusData.deviceId, deviceId);

    // 9. Reset / Revoke pairing
    const resReset = await fetch(`${baseUrl}/api/garmin/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken }),
    });
    assert.equal(resReset.status, 200);
    const resetData = await resReset.json();
    assert.equal(resetData.success, true);

    // 10. Status after reset: device token is no longer valid
    const resDevStatusAfter = await fetch(`${baseUrl}/api/garmin/status`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    assert.equal(resDevStatusAfter.status, 401);
  } finally {
    await close();
  }
});

test('/boost Activity Telemetry Middleware: strict token enforcement and metric ingestion', async () => {
  process.env.NODE_ENV = 'test';
  const { baseUrl, close } = await createTestServer();

  try {
    const userId = `racer_${Date.now()}`;
    const deviceId = `venu3_hw_${Date.now()}`;

    // Generate code & pair device
    const resCode = await fetch(`${baseUrl}/api/garmin/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const { pairingCode } = await resCode.json();

    const resPair = await fetch(`${baseUrl}/api/garmin/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, deviceId }),
    });
    const { deviceToken } = await resPair.json();

    // 1. Missing or invalid token is rejected (401)
    const resUnauth = await fetch(`${baseUrl}/boost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        raceId: 'RACE_TEST',
        metrics: { distanceM: 50, powerWatts: 200 },
      }),
    });
    assert.equal(resUnauth.status, 401);

    const resBadToken = await fetch(`${baseUrl}/boost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-dummy-token',
        'x-enforce-device-token': 'true',
      },
      body: JSON.stringify({
        raceId: 'RACE_TEST',
        metrics: { distanceM: 50, powerWatts: 200 },
      }),
    });
    assert.equal(resBadToken.status, 401);

    // 2. Legitimate transmission with Bearer deviceToken is accepted
    const resAuthBearer = await fetch(`${baseUrl}/boost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify({
        raceId: 'RACE_TEST',
        metrics: { distanceM: 100, splitSec: 110, powerWatts: 250, strokeRate: 28 },
      }),
    });
    assert.equal(resAuthBearer.status, 200);

    // 3. Legitimate transmission via /api/garmin/boost with JSON body deviceToken is accepted
    const resAuthBody = await fetch(`${baseUrl}/api/garmin/boost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceToken,
        raceId: 'RACE_TEST',
        metrics: { distanceM: 200, splitSec: 108, powerWatts: 260, strokeRate: 29 },
      }),
    });
    assert.equal(resAuthBody.status, 200);
  } finally {
    await close();
  }
});

test('Guest Spectator & Guest Pairing: guest_session_id works seamlessly for pairing', async () => {
  process.env.NODE_ENV = 'test';
  const { baseUrl, close } = await createTestServer();

  try {
    const guestSessionId = `guest_sess_${Date.now()}`;
    const deviceId = `forerunner_hw_${Date.now()}`;

    // Guest gets pairing code
    const resCode = await fetch(`${baseUrl}/api/garmin/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestSessionId }),
    });
    assert.equal(resCode.status, 200);
    const { pairingCode } = await resCode.json();
    assert.equal(pairingCode.length, 6);

    // Watch pairs
    const resPair = await fetch(`${baseUrl}/api/garmin/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, deviceId }),
    });
    assert.equal(resPair.status, 200);
    const pairData = await resPair.json();
    assert.equal(pairData.userId, guestSessionId);
    assert.ok(pairData.deviceToken);

    // Ingest telemetry as guest via deviceToken
    const resBoost = await fetch(`${baseUrl}/boost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pairData.deviceToken}`,
      },
      body: JSON.stringify({
        raceId: 'RACE_GUEST_TEST',
        metrics: { distanceM: 150, powerWatts: 180, splitSec: 125, strokeRate: 24 },
      }),
    });
    assert.equal(resBoost.status, 200);
  } finally {
    await close();
  }
});
