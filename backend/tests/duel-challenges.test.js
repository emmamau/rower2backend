const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const initUserRoutes = require('../dist/routes/user.routes').default;
const initDuelRoutes = require('../dist/routes/duel.routes').default;
const initRoomRoutes = require('../dist/routes/room.routes').default;
const db = require('../dist/models').default;
const emailService = require('../dist/services/email.service').default;
const duelService = require('../dist/services/duel.service').default;
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

function futureUtcSlot(daysAhead, hourUtc = 14, durationMinutes = 60) {
  const base = new Date();
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + daysAhead, hourUtc, 0, 0, 0));
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    dayOfWeek: start.getUTCDay(),
    dateYmd: start.toISOString().slice(0, 10),
  };
}

async function registerTestPlayer(baseUrl, overrides) {
  const res = await fetch(`${baseUrl}/api/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nom: overrides.nom || 'Test',
      prenom: overrides.prenom || 'Player',
      anneeNaissance: overrides.anneeNaissance ?? 1990,
      sexe: overrides.sexe || 'M',
      pays: overrides.pays || 'France',
      login: overrides.login,
      email: overrides.email || `${overrides.login}@example.com`,
      password: overrides.password || 'SecretPass123!',
      duelPreferences: overrides.duelPreferences,
    }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

test('Duel 1v1: preferences at registration, availability filtering, email, accept & slot blocking, cancel >24h', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();
  const ctx = await createTestServer();

  try {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const slot = futureUtcSlot(10, 14, 60);
    const otherDay = (slot.dayOfWeek + 1) % 7;

    // 1. Inscription avec préférences de duel
    const p1Res = await registerTestPlayer(ctx.baseUrl, {
      login: `challenger_${suffix}`,
      nom: 'Martin',
      prenom: 'Alice',
      sexe: 'F',
      pays: 'France',
      anneeNaissance: 1995,
      duelPreferences: {
        acceptsDuels: true,
        isAbsent: false,
        refusedDays: [otherDay],
        availableWindows: [{ startTime: '09:00', endTime: '20:00' }],
        timezone: 'UTC',
      },
    });
    assert.equal(p1Res.status, 201);
    assert.equal(p1Res.data.user.duelPreferences.acceptsDuels, true);

    const p2Res = await registerTestPlayer(ctx.baseUrl, {
      login: `defender_${suffix}`,
      nom: 'Durand',
      prenom: 'Bob',
      sexe: 'M',
      pays: 'France',
      anneeNaissance: 1992,
      duelPreferences: {
        acceptsDuels: true,
        isAbsent: false,
        refusedDays: [otherDay],
        availableWindows: [{ startTime: '10:00', endTime: '18:00' }],
        timezone: 'UTC',
      },
    });
    assert.equal(p2Res.status, 201);

    // Joueur 3 qui refuse les duels
    const pRefuseAll = await registerTestPlayer(ctx.baseUrl, {
      login: `refuser_${suffix}`,
      duelPreferences: {
        acceptsDuels: false,
        timezone: 'UTC',
      },
    });
    assert.equal(pRefuseAll.status, 201);

    // Joueur 4 absent
    const pAbsent = await registerTestPlayer(ctx.baseUrl, {
      login: `absent_${suffix}`,
      duelPreferences: {
        acceptsDuels: true,
        isAbsent: true,
        timezone: 'UTC',
      },
    });
    assert.equal(pAbsent.status, 201);

    // Joueur 5 qui refuse précisément le jour du créneau
    const pWrongDay = await registerTestPlayer(ctx.baseUrl, {
      login: `wrongday_${suffix}`,
      duelPreferences: {
        acceptsDuels: true,
        refusedDays: [slot.dayOfWeek],
        availableWindows: [{ startTime: '08:00', endTime: '22:00' }],
        timezone: 'UTC',
      },
    });
    assert.equal(pWrongDay.status, 201);

    // Joueur 6 disponible seulement le soir (19h-22h)
    const pEvening = await registerTestPlayer(ctx.baseUrl, {
      login: `evening_${suffix}`,
      duelPreferences: {
        acceptsDuels: true,
        availableWindows: [{ startTime: '19:00', endTime: '22:00' }],
        timezone: 'UTC',
      },
    });
    assert.equal(pEvening.status, 201);

    const p1 = p1Res.data.user;
    const p2 = p2Res.data.user;

    // 2. Recherche de joueurs disponibles pour le créneau 14h-15h UTC
    const availRes = await fetch(
      `${ctx.baseUrl}/api/duels/available-players?slotStart=${encodeURIComponent(slot.startIso)}&slotEnd=${encodeURIComponent(slot.endIso)}&userId=${encodeURIComponent(p1.id)}`
    );
    assert.equal(availRes.status, 200);
    const availData = await availRes.json();
    const availLogins = availData.players.map((p) => p.login);
    assert.ok(availLogins.includes(p2.login), 'Defender should be available');
    assert.ok(!availLogins.includes(pRefuseAll.data.user.login), 'Refuser should not be available');
    assert.ok(!availLogins.includes(pAbsent.data.user.login), 'Absent player should not be available');
    assert.ok(!availLogins.includes(pWrongDay.data.user.login), 'Wrong-day player should not be available');
    assert.ok(!availLogins.includes(pEvening.data.user.login), 'Out-of-window player should not be available');

    // 3. Rejets de défi directs quand indisponible
    const rejectDay = await fetch(`${ctx.baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId: p1.id,
        challengedLogin: pWrongDay.data.user.login,
        slotStart: slot.startIso,
        slotEnd: slot.endIso,
      }),
    });
    assert.equal(rejectDay.status, 409);

    const rejectWindow = await fetch(`${ctx.baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId: p1.id,
        challengedLogin: pEvening.data.user.login,
        slotStart: slot.startIso,
        slotEnd: slot.endIso,
      }),
    });
    assert.equal(rejectWindow.status, 409);

    // 4. Envoi du défi valide à p2 -> crée salon 1v1 + envoie e-mail
    emailService.clearLog();
    const challengeRes = await fetch(`${ctx.baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId: p1.id,
        challengedLogin: p2.login,
        slotStart: slot.startIso,
        slotEnd: slot.endIso,
        targetDistance: 2000,
      }),
    });
    assert.equal(challengeRes.status, 201);
    const challengeData = await challengeRes.json();
    const challenge = challengeData.challenge;
    assert.equal(challenge.status, 'PENDING');
    assert.ok(challenge.roomCode, 'Challenge must have a 1v1 room code');

    const emailsAfterSend = emailService.getSentEmails();
    assert.ok(
      emailsAfterSend.some((e) => e.to === p2.email && /Défi|Duel/i.test(e.subject)),
      'Challenged player must receive an email notification'
    );

    // 5. p2 consulte ses défis dans ses salons privés
    const myRes = await fetch(`${ctx.baseUrl}/api/duels/my-challenges?userId=${encodeURIComponent(p2.id)}`);
    assert.equal(myRes.status, 200);
    const myData = await myRes.json();
    assert.equal(myData.received.length, 1);
    assert.equal(myData.received[0].id, challenge.id);

    // 6. p2 accepte le défi -> p1 notifié par email + créneau bloqué pour les deux joueurs
    emailService.clearLog();
    const acceptRes = await fetch(`${ctx.baseUrl}/api/duels/${challenge.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: p2.id, action: 'accept' }),
    });
    assert.equal(acceptRes.status, 200);
    const acceptData = await acceptRes.json();
    assert.equal(acceptData.challenge.status, 'ACCEPTED');

    const emailsAfterAccept = emailService.getSentEmails();
    assert.ok(
      emailsAfterAccept.some((e) => e.to === p1.email && /accepté/i.test(e.subject)),
      'Challenger must receive acceptance email'
    );

    // 7. Un 3e joueur ne doit plus pouvoir défier p1 ou p2 sur un créneau qui chevauche (14h30-15h30)
    const p3Res = await registerTestPlayer(ctx.baseUrl, {
      login: `third_${suffix}`,
      duelPreferences: { acceptsDuels: true, timezone: 'UTC' },
    });
    assert.equal(p3Res.status, 201);
    const p3 = p3Res.data.user;

    const overlapStart = new Date(slot.start.getTime() + 30 * 60 * 1000).toISOString();
    const overlapEnd = new Date(slot.start.getTime() + 90 * 60 * 1000).toISOString();

    const blockedRes = await fetch(`${ctx.baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId: p3.id,
        challengedLogin: p2.login,
        slotStart: overlapStart,
        slotEnd: overlapEnd,
      }),
    });
    assert.equal(blockedRes.status, 409, 'Accepted duel must block overlapping challenges to challenged player');

    const blockedChallengerRes = await fetch(`${ctx.baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId: p3.id,
        challengedLogin: p1.login,
        slotStart: overlapStart,
        slotEnd: overlapEnd,
      }),
    });
    assert.equal(blockedChallengerRes.status, 409, 'Accepted duel must block overlapping challenges to challenger too');

    const availBlocked = await fetch(
      `${ctx.baseUrl}/api/duels/available-players?slotStart=${encodeURIComponent(overlapStart)}&slotEnd=${encodeURIComponent(overlapEnd)}&userId=${encodeURIComponent(p3.id)}`
    );
    const availBlockedData = await availBlocked.json();
    const blockedLogins = availBlockedData.players.map((p) => p.login);
    assert.ok(!blockedLogins.includes(p1.login), 'Blocked challenger must be hidden from available players');
    assert.ok(!blockedLogins.includes(p2.login), 'Blocked defender must be hidden from available players');

    // 8. Annulation > 24h avant le créneau -> libère les créneaux sans forfait + notifie l'adversaire
    emailService.clearLog();
    const cancelRes = await fetch(`${ctx.baseUrl}/api/duels/${challenge.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: p1.id }),
    });
    assert.equal(cancelRes.status, 200);
    const cancelData = await cancelRes.json();
    assert.equal(cancelData.isForfeit, false);
    assert.equal(cancelData.challenge.status, 'CANCELLED');

    const emailsAfterCancel = emailService.getSentEmails();
    assert.ok(
      emailsAfterCancel.some((e) => e.to === p2.email && /annulé/i.test(e.subject)),
      'Opponent must be notified on cancellation'
    );

    // Vérifier que le créneau est libéré
    const availAfterCancel = await fetch(
      `${ctx.baseUrl}/api/duels/available-players?slotStart=${encodeURIComponent(overlapStart)}&slotEnd=${encodeURIComponent(overlapEnd)}&userId=${encodeURIComponent(p3.id)}`
    );
    const availAfterCancelData = await availAfterCancel.json();
    assert.ok(
      availAfterCancelData.players.some((p) => p.login === p2.login),
      'Defender must be available again after cancellation'
    );
  } finally {
    await ctx.close();
  }
});

test('Duel 1v1: refuse notification, 72h expiration, <24h cancel forfeit (-10/+10), scoring (+10 win, +2 draw) & filtered leaderboard', async () => {
  duelService.clearInMemoryChallenges();
  emailService.clearLog();
  const ctx = await createTestServer();

  try {
    const suffix = `s2_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Création de 4 profils variés pour tester les filtres du classement (catégorie, ligue, pays, sexe, âge)
    const uA = (
      await registerTestPlayer(ctx.baseUrl, {
        login: `uA_${suffix}`,
        pays: 'France',
        sexe: 'M',
        anneeNaissance: new Date().getFullYear() - 34, // 30-39 / 34 ans
        duelPreferences: { acceptsDuels: true, availableWindows: [{ startTime: '00:00', endTime: '23:59' }], timezone: 'UTC' },
      })
    ).data.user;

    const uB = (
      await registerTestPlayer(ctx.baseUrl, {
        login: `uB_${suffix}`,
        pays: 'Canada',
        sexe: 'F',
        anneeNaissance: new Date().getFullYear() - 25, // 19-29 / 25 ans
        duelPreferences: { acceptsDuels: true, availableWindows: [{ startTime: '00:00', endTime: '23:59' }], timezone: 'UTC' },
      })
    ).data.user;

    const uC = (
      await registerTestPlayer(ctx.baseUrl, {
        login: `uC_${suffix}`,
        pays: 'France',
        sexe: 'F',
        anneeNaissance: new Date().getFullYear() - 45, // 40-49 / 45 ans
        duelPreferences: { acceptsDuels: true, availableWindows: [{ startTime: '00:00', endTime: '23:59' }], timezone: 'UTC' },
      })
    ).data.user;

    // Attribuer ligues distinctes pour tester le filtre ligue
    await userStore.updateUser(uA.id, { currentLeague: 'GOLD', league: 'GOLD', points: 50 });
    await userStore.updateUser(uB.id, { currentLeague: 'SILVER', league: 'SILVER', points: 50 });
    await userStore.updateUser(uC.id, { currentLeague: 'BRONZE', league: 'BRONZE', points: 50 });

    // A. Refus d'un défi -> statut REFUSED + email au challenger
    const slot10d = futureUtcSlot(10, 12, 60);
    const chRefuseRes = await fetch(`${ctx.baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId: uA.id,
        challengedLogin: uB.login,
        slotStart: slot10d.startIso,
        slotEnd: slot10d.endIso,
      }),
    });
    const chRefuse = (await chRefuseRes.json()).challenge;
    emailService.clearLog();
    const refuseResp = await fetch(`${ctx.baseUrl}/api/duels/${chRefuse.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uB.id, action: 'refuse' }),
    });
    assert.equal(refuseResp.status, 200);
    const refuseData = await refuseResp.json();
    assert.equal(refuseData.challenge.status, 'REFUSED');
    assert.ok(emailService.getSentEmails().some((e) => e.to === uA.email && /refusé/i.test(e.subject)));

    // B. Expiration après 72h sans réponse
    const chExpireRes = await fetch(`${ctx.baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId: uA.id,
        challengedLogin: uB.login,
        slotStart: futureUtcSlot(15, 12, 60).startIso,
      }),
    });
    const chExpire = (await chExpireRes.json()).challenge;
    const after73h = new Date(Date.now() + 73 * 60 * 60 * 1000);
    const expiredCount = await duelService.expireOverdueChallenges(after73h);
    assert.ok(expiredCount >= 1, 'Pending challenge older than 72h must auto-expire');

    const respondExpiredRes = await fetch(`${ctx.baseUrl}/api/duels/${chExpire.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uB.id, action: 'accept' }),
    });
    assert.equal(respondExpiredRes.status, 410);

    // C. Annulation dans les 24h => forfait (-10 pts pour l'annulant, +10 pts pour l'adversaire)
    const soonStart = new Date(Date.now() + 6 * 60 * 60 * 1000); // +6h (< 24h)
    const soonEnd = new Date(soonStart.getTime() + 60 * 60 * 1000);
    const chForfeitRes = await fetch(`${ctx.baseUrl}/api/duels/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengerId: uA.id,
        challengedLogin: uB.login,
        slotStart: soonStart.toISOString(),
        slotEnd: soonEnd.toISOString(),
      }),
    });
    assert.equal(chForfeitRes.status, 201);
    const chForfeit = (await chForfeitRes.json()).challenge;

    await fetch(`${ctx.baseUrl}/api/duels/${chForfeit.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uB.id, action: 'accept' }),
    });

    const lateCancelRes = await fetch(`${ctx.baseUrl}/api/duels/${chForfeit.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uB.id }),
    });
    assert.equal(lateCancelRes.status, 200);
    const lateCancelData = await lateCancelRes.json();
    assert.equal(lateCancelData.isForfeit, true);
    assert.equal(lateCancelData.challenge.status, 'FORFEIT');
    assert.equal(lateCancelData.challenge.forfeitUserId, uB.id);
    assert.equal(lateCancelData.challenge.winnerUserId, uA.id);
    assert.equal(lateCancelData.challenge.challengerPointsDelta, 10);
    assert.equal(lateCancelData.challenge.challengedPointsDelta, -10);

    // Vérifier les stats des deux joueurs après forfait: uA (+10 pts, 1 win), uB (-10 pts, 1 loss)
    const uAAfterForfeit = await userStore.findUser(uA.id);
    const uBAfterForfeit = await userStore.findUser(uB.id);
    assert.equal(uAAfterForfeit.duelPoints, 10);
    assert.equal(uAAfterForfeit.duelsWon, 1);
    assert.equal(uBAfterForfeit.duelPoints, -10);
    assert.equal(uBAfterForfeit.duelsLost, 1);

    // D. Résolution d'un duel avec victoire (+10 pts)
    const slotWin = futureUtcSlot(12, 16, 60);
    const chWin = (
      await (
        await fetch(`${ctx.baseUrl}/api/duels/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengerId: uA.id,
            challengedLogin: uC.login,
            slotStart: slotWin.startIso,
            slotEnd: slotWin.endIso,
          }),
        })
      ).json()
    ).challenge;

    await fetch(`${ctx.baseUrl}/api/duels/${chWin.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uC.id, action: 'accept' }),
    });

    const resolveWinRes = await fetch(`${ctx.baseUrl}/api/duels/${chWin.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winnerUserId: uA.id }),
    });
    assert.equal(resolveWinRes.status, 200);

    // E. Résolution avec égalité (+2 pts chacun)
    const slotDraw = futureUtcSlot(13, 16, 60);
    const chDraw = (
      await (
        await fetch(`${ctx.baseUrl}/api/duels/challenge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengerId: uB.id,
            challengedLogin: uC.login,
            slotStart: slotDraw.startIso,
            slotEnd: slotDraw.endIso,
          }),
        })
      ).json()
    ).challenge;

    await fetch(`${ctx.baseUrl}/api/duels/${chDraw.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uC.id, action: 'accept' }),
    });

    const resolveDrawRes = await fetch(`${ctx.baseUrl}/api/duels/${chDraw.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDraw: true }),
    });
    assert.equal(resolveDrawRes.status, 200);

    const finalA = await userStore.findUser(uA.id);
    const finalB = await userStore.findUser(uB.id);
    const finalC = await userStore.findUser(uC.id);
    assert.equal(finalA.duelsWon, 2);
    assert.equal(finalA.duelPoints, 20);
    assert.equal(finalB.duelsDrawn, 1);
    assert.equal(finalB.duelsLost, 1);
    assert.equal(finalB.duelPoints, -8); // -10 + 2
    assert.equal(finalC.duelsLost, 1);
    assert.equal(finalC.duelsDrawn, 1);
    assert.equal(finalC.duelPoints, 2);

    // F. Classement duel trié par victoires & filtrable par catégorie, ligue, pays, sexe, âge
    const lbAll = await (await fetch(`${ctx.baseUrl}/api/duels/leaderboard`)).json();
    assert.equal(lbAll.success, true);
    const topLogin = lbAll.players.find((p) => p.login === uA.login || p.login === uB.login || p.login === uC.login);
    assert.equal(topLogin.login, uA.login, 'Player with most duel wins must rank first');

    const lbCat = await (await fetch(`${ctx.baseUrl}/api/duels/leaderboard?category=30-39`)).json();
    assert.ok(lbCat.players.some((p) => p.login === uA.login));
    assert.ok(!lbCat.players.some((p) => p.login === uB.login));

    const lbLeague = await (await fetch(`${ctx.baseUrl}/api/duels/leaderboard?league=SILVER`)).json();
    assert.ok(lbLeague.players.some((p) => p.login === uB.login));
    assert.ok(!lbLeague.players.some((p) => p.login === uA.login));

    const lbCountryGender = await (
      await fetch(`${ctx.baseUrl}/api/duels/leaderboard?country=France&gender=F`)
    ).json();
    assert.ok(lbCountryGender.players.some((p) => p.login === uC.login));
    assert.ok(!lbCountryGender.players.some((p) => p.login === uA.login));
    assert.ok(!lbCountryGender.players.some((p) => p.login === uB.login));

    const lbExactAge = await (await fetch(`${ctx.baseUrl}/api/duels/leaderboard?age=34`)).json();
    assert.ok(lbExactAge.players.some((p) => p.login === uA.login));
    assert.ok(!lbExactAge.players.some((p) => p.login === uC.login));
  } finally {
    await ctx.close();
  }
});
