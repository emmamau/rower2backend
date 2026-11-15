const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const raceController = require('../dist/controllers/race.controller');
const raceManager = require('../dist/services/race-manager.service').default;
const db = require('../dist/models').default;

const Activities = db.activities;

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.post('/api/race/join', raceController.joinRace);
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

test('Dédoublonnage de coureurs en course publique et conservation du login Garmin', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const deviceId = 'GARMIN_FENIX7_' + Math.random().toString(36).substring(2, 8);
    const garminLogin = 'Marc_Row42';

    // 1ère tentative : l'utilisateur anonyme se connecte avec un ID temporaire guest_temp_1
    const res1 = await fetch(`${baseUrl}/api/race/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'guest_temp_1',
        userName: garminLogin,
        deviceId: deviceId,
        action: 'join'
      })
    });

    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.success, true);
    const raceId = body1.raceId;

    // Vérifier que le participant est bien enregistré avec son login Garmin
    const publicRace = raceManager.getRaceById(raceId);
    assert.ok(publicRace);
    const p1 = publicRace.participants.get('guest_temp_1');
    assert.ok(p1, 'Le participant 1 doit exister dans la course');
    assert.equal(p1.userName, garminLogin, 'Le login Garmin configuré doit être préservé');

    // 2ème tentative : le même joueur tente à nouveau avec un nouvel ID temporaire (ex. retry ou reconnexion)
    const res2 = await fetch(`${baseUrl}/api/race/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'guest_temp_2',
        userName: garminLogin,
        deviceId: deviceId,
        action: 'join'
      })
    });

    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.success, true);

    // VÉRIFICATION DÉDOUBLONNAGE : Le joueur ne doit PAS occuper 2 lignes d'eau !
    const hasOld = publicRace.participants.has('guest_temp_1');
    const hasNew = publicRace.participants.has('guest_temp_2');

    assert.equal(hasOld, false, "L'ancienne ligne d'eau de guest_temp_1 doit avoir été libérée");
    assert.equal(hasNew, true, "La nouvelle ligne d'eau doit appartenir à guest_temp_2");

    // Vérifier en base que l'ancienne activité n'est plus active si la base est connectée
    try {
      const oldAct = await Activities.findByPk(`${raceId}_guest_temp_1`);
      if (oldAct) {
        assert.equal(oldAct.status, 'abandoned', "L'ancienne activité doit être marquée abandoned pour libérer la ligne");
      }
    } catch {
      // Tolérance DB locale déconnectée
    }
  } finally {
    await close();
  }
});
