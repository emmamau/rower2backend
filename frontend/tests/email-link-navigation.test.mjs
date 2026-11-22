import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appTsPath = path.resolve(__dirname, '../src/app/app.ts');
const emailServiceTsPath = path.resolve(__dirname, '../../backend/src/services/email.service.ts');

test('Email & link navigation: Backend email service generates duel link with duelChallenge & email query parameters', () => {
  const emailServiceContent = fs.readFileSync(emailServiceTsPath, 'utf8');
  assert.ok(
    emailServiceContent.includes('duelChallenge='),
    'email.service.ts doit contenir le paramètre duelChallenge='
  );
  assert.ok(
    emailServiceContent.includes('email='),
    'email.service.ts doit inclure le paramètre email='
  );
});

test('Email & link navigation: app.ts neutralizes regatta direct launch from URL or email links', () => {
  const appTs = fs.readFileSync(appTsPath, 'utf8');

  // Verify resolveRoomFromCurrentUrl always sets home view and never pendingRegattaLaunch
  assert.ok(
    appTs.includes("this.pendingRegattaLaunch = false;") &&
    appTs.includes("this.isRegattaLaunchSplashOpen = false;") &&
    appTs.includes("this.setSiteView('home');"),
    'resolveRoomFromCurrentUrl doit désactiver pendingRegattaLaunch et forcer siteView vers home'
  );

  // Verify activatePrivateRoom does NOT jump to regatta
  const activateIdx = appTs.indexOf('private activatePrivateRoom(');
  const leaveIdx = appTs.indexOf('leaveCompletedPrivateRoom(');
  const activatePrivateRoomBlock = appTs.slice(activateIdx, leaveIdx);
  assert.ok(
    !activatePrivateRoomBlock.includes("this.setSiteView('regatta')"),
    'activatePrivateRoom ne doit jamais basculer directement sur siteView regatta'
  );
});

test('Email & link navigation: Private room link opens private modal on share tab', () => {
  const appTs = fs.readFileSync(appTsPath, 'utf8');

  const joinIdx = appTs.indexOf('this.rowerService.joinRoom(');
  assert.ok(joinIdx !== -1, 'joinRoom doit être présent dans app.ts');
  const formatIdx = appTs.indexOf('formatDetailedCountdown(', joinIdx);
  const joinPrivateRoomBlock = appTs.slice(joinIdx, formatIdx);

  assert.ok(
    joinPrivateRoomBlock.includes('this.isPrivateModalOpen = true;'),
    'joinRoom doit ouvrir la modale de salon privé'
  );
  assert.ok(
    joinPrivateRoomBlock.includes("this.privateModalTab = 'share';"),
    'joinRoom doit ouvrir l’onglet share du salon privé'
  );
  assert.ok(
    joinPrivateRoomBlock.includes("this.setSiteView('home');"),
    'joinRoom doit maintenir la vue sur home'
  );
});

test('Email & link navigation: Duel challenge handler opens duel decision card or prompts login for guests', () => {
  const appTs = fs.readFileSync(appTsPath, 'utf8');

  const startIdx = appTs.indexOf('handleIncomingDuelChallenge(challengeId: string): void {');
  assert.ok(startIdx !== -1, 'handleIncomingDuelChallenge doit être défini dans app.ts');
  const duelHandlerBlock = appTs.slice(startIdx, startIdx + 2500);

  assert.ok(
    duelHandlerBlock.includes('if (!this.isIdentified)'),
    'handleIncomingDuelChallenge doit vérifier si l’utilisateur est identifié'
  );
  assert.ok(
    duelHandlerBlock.includes("this.openAccountModal('login');"),
    'handleIncomingDuelChallenge doit ouvrir la modale de login pour les invités non identifiés'
  );
  assert.ok(
    duelHandlerBlock.includes("this.setSiteView('home');"),
    'handleIncomingDuelChallenge doit garantir le maintien sur siteView home'
  );
  assert.ok(
    duelHandlerBlock.includes('this.isPrivateModalOpen = true;') &&
    duelHandlerBlock.includes("this.privateModalTab = 'share';"),
    'handleIncomingDuelChallenge doit ouvrir la modale de salon sur l’onglet share (carte de validation du duel)'
  );
});

test('Email & link navigation: Post-login and post-register resume pending duel challenge or open private room', () => {
  const appTs = fs.readFileSync(appTsPath, 'utf8');

  const loginIdx = appTs.indexOf('submitAccountLogin(): void');
  const regIdx = appTs.indexOf('submitAccountRegister(): void');
  const forgotIdx = appTs.indexOf('submitForgotPassword(): void');

  const loginBlock = appTs.slice(loginIdx, regIdx);
  assert.ok(
    loginBlock.includes('this.pendingDuelChallengeId') &&
    loginBlock.includes('this.handleIncomingDuelChallenge('),
    'submitAccountLogin doit relancer handleIncomingDuelChallenge si pendingDuelChallengeId est présent'
  );
  assert.ok(
    loginBlock.includes('this.isPrivateModalOpen = true;') &&
    loginBlock.includes("this.privateModalTab = 'share';"),
    'submitAccountLogin doit ouvrir le salon privé s’il est actif ou sur route /r/'
  );

  const registerBlock = appTs.slice(regIdx, forgotIdx);
  assert.ok(
    registerBlock.includes('this.pendingDuelChallengeId') &&
    registerBlock.includes('this.handleIncomingDuelChallenge('),
    'submitAccountRegister doit relancer handleIncomingDuelChallenge si pendingDuelChallengeId est présent'
  );
  assert.ok(
    registerBlock.includes('this.isPrivateModalOpen = true;') &&
    registerBlock.includes("this.privateModalTab = 'share';"),
    'submitAccountRegister doit ouvrir le salon privé s’il est actif ou sur route /r/'
  );
});
