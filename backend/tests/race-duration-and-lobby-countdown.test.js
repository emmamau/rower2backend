const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const cors = require('cors');

const socketGateway = require('../dist/websocket/socket.gateway').default;
const initRoutes = require('../dist/routes/index').default;
const { RaceManager } = require('../dist/services/race-manager.service');

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
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

test('Race Duration & Lobby Countdown: Accessing a room or duel does NOT start the countdown or 55m race timer', async (t) => {
  const { baseUrl, close } = await createTestServer();
  const raceManager = RaceManager.getInstance();

  try {
    await t.test('1. Room creation adds host as ready: false and connectionState: CONNECTED', async () => {
      const resCreate = await fetch(`${baseUrl}/api/v1/races/private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostUserId: 'EmmaRacer',
          hostUserName: 'EmmaRacer',
          title: 'Duel 1v1 Test',
          targetDistance: 1000,
          isDuel1v1: true,
          mode: 'duel_1v1',
          adminAsSpectator: false,
          hostParticipates: true
        })
      });
      assert.equal(resCreate.status, 201);
      const data = await resCreate.json();
      assert.equal(data.success, true);
      const room = raceManager.findPrivateRace(data.race.id);
      assert.ok(room);
      assert.equal(room.status, 'LOBBY');

      const hostParticipant = room.participants.get('EmmaRacer');
      assert.ok(hostParticipant);
      assert.equal(hostParticipant.ready, false, 'Host must NOT be marked ready on creation');
      assert.equal(hostParticipant.connectionState, 'CONNECTED', 'Host connection state must be CONNECTED');

      const timing = raceManager.getRaceTiming(room);
      assert.equal(timing.elapsedSeconds, 0, 'No elapsed time while in LOBBY');
      assert.equal(timing.remainingSeconds, 3300, 'Full 55m duration preserved while in LOBBY');
    });

    await t.test('2. Opponent accessing / joining room on Web via Meet code does NOT start 15s countdown or 55m timer', async () => {
      const resCreate = await fetch(`${baseUrl}/api/v1/races/private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostUserId: 'EmmaRacer',
          hostUserName: 'EmmaRacer',
          title: 'Duelist 1v1',
          targetDistance: 2000,
          isDuel1v1: true,
          mode: 'duel_1v1',
          adminAsSpectator: false,
          hostParticipates: true
        })
      });
      assert.equal(resCreate.status, 201);
      const created = await resCreate.json();
      const code = created.code;
      const room = raceManager.findPrivateRace(code);
      assert.equal(room.status, 'LOBBY');

      // Player B opens salon in browser (calls /api/rooms/join with 9-letter code)
      const resJoinWeb = await fetch(`${baseUrl}/api/rooms/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code,
          userId: 'guest_player_b',
          userName: 'Duelist B'
        })
      });
      assert.equal(resJoinWeb.status, 200);
      const joinData = await resJoinWeb.json();
      assert.equal(joinData.success, true);
      assert.equal(joinData.ready, false, 'Web join must NOT default to ready: true');
      assert.equal(joinData.connectionState, 'CONNECTED');

      // Critical assertion: Room MUST remain in LOBBY, NOT COUNTDOWN!
      assert.equal(room.status, 'LOBBY', 'Duel 1v1 MUST remain in LOBBY when 2nd player accesses salon on web');
      assert.equal(room.participants.size, 2);

      const timing = raceManager.getRaceTiming(room);
      assert.equal(timing.elapsedSeconds, 0);
      assert.equal(timing.remainingSeconds, 3300, 'Game duration countdown MUST stay at 55m (3300s)');
    });

    await t.test('3. Countdown triggers ONLY when both players report ready: true (rowers connected)', async () => {
      const resCreate = await fetch(`${baseUrl}/api/v1/races/private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostUserId: 'EmmaRacer',
          hostUserName: 'EmmaRacer',
          title: 'Ready Duel',
          targetDistance: 500,
          isDuel1v1: true,
          mode: 'duel_1v1',
          adminAsSpectator: false,
          hostParticipates: true
        })
      });
      const created = await resCreate.json();
      const roomId = created.race.id;
      const room = raceManager.findPrivateRace(roomId);

      // Join player 2
      await fetch(`${baseUrl}/api/rooms/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: created.code,
          userId: 'player_ready_2',
          userName: 'Racer Two'
        })
      });
      assert.equal(room.status, 'LOBBY');

      // Player 1 rower awakens (ready: true) -> still LOBBY because player 2 is not ready yet
      const resStatus1 = await fetch(`${baseUrl}/api/rooms/${roomId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'EmmaRacer',
          ready: true
        })
      });
      assert.equal(resStatus1.status, 200);
      assert.equal(room.status, 'LOBBY', 'Must wait until both players are ready');

      // Player 2 rower awakens (ready: true) -> Now both are ready, 15s countdown triggers
      const resStatus2 = await fetch(`${baseUrl}/api/rooms/${roomId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'player_ready_2',
          ready: true
        })
      });
      assert.equal(resStatus2.status, 200);
      const statusData2 = await resStatus2.json();
      assert.equal(statusData2.countdownTriggered, true);
      assert.equal(room.status, 'COUNTDOWN', 'Room transitions to COUNTDOWN only when both are READY');

      // Even in COUNTDOWN, race duration timer (remainingSeconds) is STILL 55m!
      const timingCountdown = raceManager.getRaceTiming(room);
      assert.equal(timingCountdown.remainingSeconds, 3300, '55m duration is preserved during COUNTDOWN');
      assert.equal(timingCountdown.elapsedSeconds, 0);
    });

    await t.test('4. Bot Duel in first_stroke mode stays in LOBBY when player enters', async () => {
      const room = raceManager.createPrivateRace({
        isBotDuel: true,
        botStartMode: 'first_stroke',
        targetDistance: 1000,
        hostUserId: 'human_bot_challenger',
        hostUserName: 'Bot Challenger'
      });
      assert.equal(room.status, 'LOBBY');
      assert.equal(room.botStartMode, 'first_stroke');

      // Accessing room via join
      const joinResult = raceManager.joinPrivateRace(room.code, 'human_bot_challenger', 'Bot Challenger', undefined, {
        viaPin: false,
        ready: false
      });
      assert.equal(joinResult.race.status, 'LOBBY', 'Bot duel with first_stroke mode remains in LOBBY');
      const timing = raceManager.getRaceTiming(room);
      assert.equal(timing.remainingSeconds, 3300);
      assert.equal(timing.elapsedSeconds, 0);
    });
  } finally {
    await close();
  }
});
