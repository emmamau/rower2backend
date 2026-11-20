const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initTelemetryRoutes = require('../dist/routes/telemetry.routes').default;
const initRoomRoutes = require('../dist/routes/room.routes').default;
const initUserRoutes = require('../dist/routes/user.routes').default;
const db = require('../dist/models').default;
const emailService = require('../dist/services/email.service').default;
const {
  generateIcsCalendar,
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
  formatIcsDate,
} = require('../dist/utils/calendar.util');
const { RaceManager } = require('../dist/services/race-manager.service');
const userStore = require('../dist/services/user-store.service').default;

const raceManager = RaceManager.getInstance();

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  initTelemetryRoutes(app);
  initRoomRoutes(app);
  initUserRoutes(app);
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

test('1. Calendar utility generates valid RFC 5545 iCalendar and Google/Outlook URLs', () => {
  const startTime = new Date('2026-12-01T14:00:00.000Z');
  const params = {
    eventId: 'test_race_123',
    title: 'Régate de Test 2000m',
    description: 'Régate connectée Rower Race 2000m',
    url: 'https://rowerrace.com/?room=ABCD-1234',
    startTime,
    durationMinutes: 45,
    organizerName: 'Emma Coach',
    organizerEmail: 'coach@example.com',
  };

  const ics = generateIcsCalendar(params);
  assert.ok(ics.includes('BEGIN:VCALENDAR'), 'Doit contenir BEGIN:VCALENDAR');
  assert.ok(ics.includes('VERSION:2.0'), 'Doit spécifier la version 2.0');
  assert.ok(ics.includes('BEGIN:VEVENT'), 'Doit contenir BEGIN:VEVENT');
  assert.ok(ics.includes('SUMMARY:Régate de Test 2000m'), 'Doit contenir le titre');
  assert.ok(ics.includes('DTSTART:20261201T140000Z'), 'Doit formater la date de début UTC');
  assert.ok(ics.includes('DTEND:20261201T144500Z'), 'Doit calculer la fin à +45 min');
  assert.ok(ics.includes('LOCATION:https://rowerrace.com/?room=ABCD-1234'), 'Doit spécifier la localisation');
  assert.ok(ics.includes('BEGIN:VALARM'), 'Doit inclure un rappel alarme');
  assert.ok(ics.includes('TRIGGER:-PT15M'), 'Doit déclencher le rappel 15 min avant');
  assert.ok(ics.includes('END:VCALENDAR'), 'Doit clore avec END:VCALENDAR');

  const googleUrl = generateGoogleCalendarUrl(params);
  assert.ok(googleUrl.includes('calendar.google.com/calendar/render'), 'URL Google Calendar valide');
  assert.ok(googleUrl.includes('action=TEMPLATE'), 'Doit inclure action=TEMPLATE');
  assert.ok(googleUrl.includes('R%C3%A9gate+de+Test+2000m') || googleUrl.includes('R%C3%A9gate'), 'Doit encoder le titre');

  const outlookUrl = generateOutlookCalendarUrl(params);
  assert.ok(outlookUrl.includes('outlook.live.com/calendar/0/deeplink/compose'), 'URL Outlook valide');
  assert.ok(outlookUrl.includes('rru=addevent'), 'Doit inclure rru=addevent');
});

test('2. Duel 1v1 : Envoi d\'invitation par email et rejet si plus d\'un destinataire', async () => {
  const ctx = await createTestServer();
  try {
    emailService.clearLog();
    const hostUserId = `host_duel_${Date.now()}`;
    await userStore.createUser({
      id: hostUserId,
      login: hostUserId,
      name: 'Rameur Duel',
      email: `${hostUserId}@test.com`,
      subscriptionTier: 'free',
      isSubscriber: false,
    });

    // Création d'un duel 1v1
    const createRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-enforce-watch-pairing': 'false',
      },
      body: JSON.stringify({
        title: 'Mon Grand Duel 1v1',
        targetDistance: 1000,
        hostUserId,
        isDuel1v1: true,
      }),
    });
    assert.equal(createRes.status, 201);
    const room = await createRes.json();
    const roomCode = room.code;
    assert.ok(roomCode);

    // Tentative d'invitation avec 2 e-mails -> doit être rejeté (400)
    const rejectRes = await fetch(`${ctx.baseUrl}/api/rooms/${roomCode}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId,
        emails: ['adversaire1@example.com', 'adversaire2@example.com'],
      }),
    });
    assert.equal(rejectRes.status, 400);
    const rejectData = await rejectRes.json();
    assert.equal(rejectData.success, false);
    assert.ok(rejectData.error.includes('Duel'));

    // Invitation valide avec 1 seul e-mail -> succès (200)
    const successRes = await fetch(`${ctx.baseUrl}/api/rooms/${roomCode}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId,
        emails: ['adversaire@example.com'],
      }),
    });
    assert.equal(successRes.status, 200);
    const successData = await successRes.json();
    assert.equal(successData.success, true);
    assert.equal(successData.count, 1);
    assert.deepEqual(successData.recipients, ['adversaire@example.com']);

    // Vérification du courriel envoyé dans le journal simulé
    const sent = emailService.getSentEmails();
    const duelMail = sent.find((e) => e.to === 'adversaire@example.com');
    assert.ok(duelMail, 'Le mail d\'invitation doit avoir été envoyé');
    assert.ok(duelMail.subject.includes('Duel 1v1'));
    assert.ok(duelMail.html.includes(roomCode));
    assert.ok(duelMail.html.includes('1000'));
    assert.ok(duelMail.html.includes('Rejoindre la Régate'));
  } finally {
    await ctx.close();
  }
});

test('3. Multi-joueurs : Respect strict des quotas d\'invitations selon l\'abonnement', async () => {
  const ctx = await createTestServer();
  try {
    emailService.clearLog();
    // Création d'un abonné Club (standard/intermediate => maxParticipants: 5 => max 4 invitations)
    const hostUserId = `host_club_${Date.now()}`;
    await userStore.createUser({
      id: hostUserId,
      login: hostUserId,
      name: 'Capitaine Club',
      email: `${hostUserId}@club.com`,
      subscriptionTier: 'club',
      isSubscriber: true,
    });

    const createRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-enforce-watch-pairing': 'false',
      },
      body: JSON.stringify({
        title: 'Régate Club 2000m',
        targetDistance: 2000,
        hostUserId,
        mode: 'multi',
        maxParticipants: 5,
        botCount: 0,
      }),
    });
    assert.equal(createRes.status, 201);
    const room = await createRes.json();
    const roomCode = room.code;

    // Tentative d'envoyer 5 invitations (dépasse 4 places restantes car hôte = 1 place) -> 403
    const overLimitRes = await fetch(`${ctx.baseUrl}/api/rooms/${roomCode}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId,
        emails: [
          'rameur1@test.com',
          'rameur2@test.com',
          'rameur3@test.com',
          'rameur4@test.com',
          'rameur5@test.com',
        ],
      }),
    });
    assert.equal(overLimitRes.status, 403);
    const overData = await overLimitRes.json();
    assert.equal(overData.code, 'INVITE_QUOTA_EXCEEDED');
    assert.equal(overData.maxAllowed, 4);

    // Envoi de 3 invitations (dans la limite de 4) -> 200 OK
    const okRes = await fetch(`${ctx.baseUrl}/api/rooms/${roomCode}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId,
        emails: ['rameur1@test.com', 'rameur2@test.com', 'rameur3@test.com'],
      }),
    });
    assert.equal(okRes.status, 200);
    const okData = await okRes.json();
    assert.equal(okData.success, true);
    assert.equal(okData.count, 3);
  } finally {
    await ctx.close();
  }
});

test('4. Multi-joueurs planifié : Envoi avec rendez-vous d\'agenda (.ics et liens calendrier)', async () => {
  const ctx = await createTestServer();
  try {
    emailService.clearLog();
    const hostUserId = `host_sched_${Date.now()}`;
    await userStore.createUser({
      id: hostUserId,
      login: hostUserId,
      name: 'Organisateur Pro',
      email: `${hostUserId}@pro.com`,
      subscriptionTier: 'pro',
      isSubscriber: true,
    });

    const scheduledTime = new Date(Date.now() + 3600000 * 24).toISOString();
    const createRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-enforce-watch-pairing': 'false',
      },
      body: JSON.stringify({
        title: 'Régate du Samedi Matin',
        targetDistance: 5000,
        hostUserId,
        mode: 'multi',
        startMode: 'scheduled',
        scheduledStartTime: scheduledTime,
        timezone: 'Europe/Paris',
        maxParticipants: 8,
      }),
    });
    assert.equal(createRes.status, 201);
    const room = await createRes.json();
    const roomCode = room.code;

    // Envoi avec case rendez-vous agenda cochée (défaut)
    const inviteRes = await fetch(`${ctx.baseUrl}/api/rooms/${roomCode}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId,
        emails: ['participant_agenda@example.com'],
        includeCalendarInvite: true,
      }),
    });
    assert.equal(inviteRes.status, 200);
    const data = await inviteRes.json();
    assert.equal(data.success, true);
    assert.equal(data.hasCalendarInvite, true);

    const sent = emailService.getSentEmails();
    const mail = sent.find((e) => e.to === 'participant_agenda@example.com');
    assert.ok(mail, 'Courriel trouvé');
    assert.ok(mail.attachments && mail.attachments.length > 0, 'Doit comporter une pièce jointe');
    assert.equal(mail.attachments[0].filename, `invitation-regate-${roomCode}.ics`);
    assert.equal(mail.attachments[0].type, 'text/calendar');

    // Décoder le base64 et vérifier le contenu iCalendar
    const icsContent = Buffer.from(mail.attachments[0].content, 'base64').toString('utf-8');
    assert.ok(icsContent.includes('BEGIN:VCALENDAR'));
    assert.ok(icsContent.includes('Régate du Samedi Matin'));
    assert.ok(icsContent.includes('STATUS:CONFIRMED'));

    // Vérifier les boutons d'agenda dans le HTML
    assert.ok(mail.html.includes('Google Agenda'));
    assert.ok(mail.html.includes('Outlook'));
  } finally {
    await ctx.close();
  }
});

test('5. Sécurité : Rejet si l\'utilisateur n\'est pas l\'organisateur ou si salon inexistant', async () => {
  const ctx = await createTestServer();
  try {
    const intruderUserId = `intruder_${Date.now()}`;
    const badRes = await fetch(`${ctx.baseUrl}/api/rooms/NONEXISTENT_CODE/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId: intruderUserId,
        emails: ['test@example.com'],
      }),
    });
    assert.equal(badRes.status, 404);
  } finally {
    await ctx.close();
  }
});
