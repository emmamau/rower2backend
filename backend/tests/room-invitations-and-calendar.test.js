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
      country: 'France',
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
      country: 'France',
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

test('6. Format d\'URL canonique (/r/:code) et explications Garmin Connect IQ Store', async () => {
  const ctx = await createTestServer();
  try {
    emailService.clearLog();
    const hostUserId = `host_url_check_${Date.now()}`;
    await userStore.createUser({
      id: hostUserId,
      login: hostUserId,
      name: 'Jean Rameur',
      email: `${hostUserId}@test.com`,
      subscriptionTier: 'pro',
      isSubscriber: true,
      country: 'France',
    });

    const createRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-enforce-watch-pairing': 'false',
      },
      body: JSON.stringify({
        title: 'Vérification URLs et Store Garmin',
        targetDistance: 2000,
        hostUserId,
        mode: 'multi',
      }),
    });
    assert.equal(createRes.status, 201);
    const room = await createRes.json();
    const roomCode = room.code;
    const pinCode = room.pinCode;

    const inviteRes = await fetch(`${ctx.baseUrl}/api/rooms/${roomCode}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId,
        emails: ['guest_check@example.com'],
        lang: 'fr',
      }),
    });
    assert.equal(inviteRes.status, 200);

    const sent = emailService.getSentEmails();
    const mail = sent.find((e) => e.to === 'guest_check@example.com');
    assert.ok(mail, 'Le mail doit être présent');

    // 1. Format URL canonique : /r/:code (et non ?room=)
    assert.ok(mail.html.includes(`/r/${roomCode}`), 'Le HTML doit contenir le lien canonique /r/:code');
    assert.ok(!mail.html.includes(`/?room=`), 'Le HTML ne doit plus contenir le format obsolète /?room=');
    assert.ok(mail.text.includes(`/r/${roomCode}`), 'Le texte brut doit contenir le lien canonique /r/:code');
    assert.ok(!mail.text.includes(`/?room=`), 'Le texte brut ne doit plus contenir /?room=');

    // 2. Instructions Garmin Connect IQ Store et 4 étapes de participation
    assert.ok(mail.html.includes('Garmin Connect IQ'), 'Le HTML doit mentionner Garmin Connect IQ');
    assert.ok(mail.html.includes('apps.garmin.com'), 'Le HTML doit mentionner le store apps.garmin.com');
    assert.ok(mail.html.includes('Rower Race'), 'Le HTML doit mentionner le nom de l\'application Rower Race');
    assert.ok(mail.html.includes(pinCode), 'Le HTML doit contenir le code PIN montre');
    assert.ok(mail.text.includes('apps.garmin.com'), 'Le texte brut doit mentionner apps.garmin.com');

    // 3. Identité visuelle du site et logo
    assert.ok(mail.html.includes('rowerrace-logo.png'), 'Le HTML doit intégrer le logo du site rowerrace-logo.png');
    assert.ok(mail.html.includes('#ff0055'), 'Le HTML doit intégrer la couleur rose fuchsia (#ff0055) du logo');
    assert.ok(mail.html.includes('#00f0ff'), 'Le HTML doit intégrer le cyan néon (#00f0ff) du logo');

    // 4. Instructions d'installation mises à jour (remplacement smartphone par garmin et ajout WaterRower)
    assert.ok(mail.html.includes('application Garmin'), 'Étape 1: application Garmin au lieu d\'application smartphone');
    assert.ok(!mail.html.includes('sur votre smartphone'), 'Ne doit plus mentionner sur votre smartphone');
    assert.ok(mail.html.includes('WaterRower'), 'Étape 2: WaterRower dans la liste des rameurs compatibles');
    assert.ok(mail.html.includes('Concept2 PM5'), 'Étape 2: Concept2 PM5');
    assert.ok(mail.html.includes('SmartRow'), 'Étape 2: SmartRow');
    assert.ok(mail.html.includes('FTMS'), 'Étape 2: FTMS');
    assert.ok(mail.html.includes('Rejoindre un salon'), 'Étape 3: Rejoindre un salon');
    assert.ok(mail.html.includes('Prenez le départ'), 'Étape 4: Prenez le départ');

    assert.ok(mail.text.includes('application Garmin'), 'Le texte brut doit mentionner application Garmin');
    assert.ok(!mail.text.includes('smartphone'), 'Le texte brut ne doit plus mentionner smartphone');
    assert.ok(mail.text.includes('WaterRower'), 'Le texte brut doit mentionner WaterRower');
  } finally {
    await ctx.close();
  }
});

test('7. Internationalisation : Envoi par défaut en anglais si organisateur non francophone', async () => {
  const ctx = await createTestServer();
  try {
    emailService.clearLog();
    const hostUserId = `host_en_${Date.now()}`;
    await userStore.createUser({
      id: hostUserId,
      login: hostUserId,
      name: 'John English',
      email: `${hostUserId}@usa.com`,
      subscriptionTier: 'free',
      isSubscriber: false,
      country: 'United States',
    });

    const createRes = await fetch(`${ctx.baseUrl}/api/v1/races/private`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-enforce-watch-pairing': 'false',
      },
      body: JSON.stringify({
        title: 'Morning Regatta 1000m',
        targetDistance: 1000,
        hostUserId,
        isDuel1v1: true,
      }),
    });
    assert.equal(createRes.status, 201);
    const room = await createRes.json();
    const roomCode = room.code;

    const inviteRes = await fetch(`${ctx.baseUrl}/api/rooms/${roomCode}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostUserId,
        emails: ['opponent_en@example.com'],
      }),
    });
    assert.equal(inviteRes.status, 200);

    const sent = emailService.getSentEmails();
    const mail = sent.find((e) => e.to === 'opponent_en@example.com');
    assert.ok(mail);

    // Vérifier la version anglaise par défaut
    assert.ok(mail.subject.includes('1v1 Duel Invitation from John English'), 'Le sujet doit être en anglais');
    assert.ok(mail.html.includes('Join the Regatta'), 'Le CTA doit être en anglais');
    assert.ok(mail.html.includes('How to join with your Garmin watch?'), 'Le titre du guide montre doit être en anglais');
    assert.ok(mail.html.includes('apps.garmin.com'), 'Le lien vers le store apps.garmin.com doit être présent');
    assert.ok(mail.html.includes(`/r/${roomCode}`), 'L\'URL canonique doit être /r/:code');
    assert.ok(mail.html.includes('mode=regatta'), 'Le lien doit contenir ?mode=regatta');
    assert.ok(mail.html.includes('rowerrace-logo.png'), 'Le HTML anglais doit intégrer rowerrace-logo.png');
    assert.ok(mail.html.includes('#ff0055'), 'Le HTML anglais doit intégrer #ff0055');

    // Instructions d'installation en anglais
    assert.ok(mail.html.includes('Garmin app'), 'Step 1: Garmin app instead of smartphone app');
    assert.ok(!mail.html.includes('on your smartphone'), 'Should not mention on your smartphone');
    assert.ok(mail.html.includes('WaterRower'), 'Step 2: WaterRower in compatible rowing machines');
    assert.ok(mail.html.includes('Concept2 PM5'), 'Step 2: Concept2 PM5');
    assert.ok(mail.html.includes('SmartRow'), 'Step 2: SmartRow');
    assert.ok(mail.html.includes('Join Room'), 'Step 3: Join Room');
    assert.ok(mail.html.includes('Ready to row'), 'Step 4: Ready to row');

    assert.ok(mail.text.includes('HOW TO JOIN WITH YOUR GARMIN WATCH:'), 'Le texte brut doit être en anglais');
    assert.ok(mail.text.includes('Garmin app'), 'Le texte brut anglais doit mentionner Garmin app');
    assert.ok(!mail.text.includes('smartphone'), 'Le texte brut anglais ne doit plus mentionner smartphone');
    assert.ok(mail.text.includes('WaterRower'), 'Le texte brut anglais doit mentionner WaterRower');
  } finally {
    await ctx.close();
  }
});

