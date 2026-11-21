import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAppHtmlBundle, readAppTsBundle } from './test-app-bundle.helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');

test('Frontend Models, RowerService & SocketService expose complete 1v1 Duel Challenge API and real-time events', () => {
  const userModelTs = fs.readFileSync(path.join(frontendAppDir, 'models/user.model.ts'), 'utf8');
  const rowerServiceTs = fs.readFileSync(path.join(frontendAppDir, 'services/rower.service.ts'), 'utf8');
  const socketServiceTs = fs.readFileSync(path.join(frontendAppDir, 'services/socket.service.ts'), 'utf8');

  assert.match(userModelTs, /export interface DuelPreferences/);
  assert.match(userModelTs, /export interface DuelChallenge/);
  assert.match(userModelTs, /export interface DuelLeaderboardItem/);
  assert.match(userModelTs, /duelsWon\?:\s*number/);
  assert.match(userModelTs, /duelsLost\?:\s*number/);
  assert.match(userModelTs, /duelPoints\?:\s*number/);

  assert.match(rowerServiceTs, /updateDuelPreferences\(/);
  assert.match(rowerServiceTs, /getAvailableDuelPlayers\(/);
  assert.match(rowerServiceTs, /createDuelChallenge\(/);
  assert.match(rowerServiceTs, /getMyDuelChallenges\(/);
  assert.match(rowerServiceTs, /respondToDuelChallenge\(/);
  assert.match(rowerServiceTs, /cancelDuelChallenge\(/);
  assert.match(rowerServiceTs, /getDuelLeaderboard\(/);

  assert.match(socketServiceTs, /duel:challenge_received/);
  assert.match(socketServiceTs, /duel:challenge_responded/);
  assert.match(socketServiceTs, /duel:challenge_cancelled/);
  assert.match(socketServiceTs, /public onDuelEvent\(\)/);
});

test('AccountModal & AppComponent: duel availability preferences at registration and in subscriber profile', () => {
  const appHtml = readAppHtmlBundle();
  const appTs = readAppTsBundle();
  const rawAppHtml = fs.readFileSync(path.join(frontendAppDir, 'app.html'), 'utf8');

  assert.ok(rawAppHtml.split('\n').length < 600, `app.html must stay under 600 lines (got ${rawAppHtml.split('\n').length})`);
  assert.match(appHtml, /regAcceptsDuels/);
  assert.match(appHtml, /regDuelStartTime/);
  assert.match(appHtml, /regDuelRefusedDays/);
  assert.match(appHtml, /profile-duel-card/);
  assert.match(appHtml, /duelIsAbsent/);
  assert.match(appHtml, /saveDuelPreferencesRequest\.emit\(\)/);
  assert.match(appTs, /saveDuelPreferences\(\):\s*void/);
  assert.match(appTs, /duelPreferences:\s*\{[\s\S]*?acceptsDuels:\s*Boolean\(this\.regAcceptsDuels\)/);
});

test('PrivateRoomManager, StandingsModal & HomeDashboard: 1v1 challenge creation, player finder, accept/refuse/cancel and filtered duel leaderboard', () => {
  const privHtml = fs.readFileSync(
    path.join(frontendAppDir, 'components/private-room-manager/private-room-manager.component.html'),
    'utf8'
  );
  const privTs = fs.readFileSync(
    path.join(frontendAppDir, 'components/private-room-manager/private-room-manager.component.ts'),
    'utf8'
  );
  const appHtml = readAppHtmlBundle();
  const appTs = readAppTsBundle();

  assert.match(privTs, /@Input\(\)\s*prefilledDuelLogin\s*=\s*''/);
  assert.match(privTs, /onSendDuelChallenge\(\):\s*void/);
  assert.match(privTs, /searchAvailableDuelPlayers\(\):\s*void/);
  assert.match(privTs, /respondToDuel\(/);
  assert.match(privTs, /cancelDuel\(/);
  assert.match(privHtml, /name="duelTargetLogin"/);
  assert.match(privHtml, /name="duelSlotStartLocal"/);
  assert.match(privHtml, /searchAvailableDuelPlayers\(\)/);
  assert.match(privHtml, /Mes Défis en Duel 1v1/);
  assert.match(privHtml, /isDuelWithin24h\(d\.slotStart\)/);
  assert.match(privHtml, /priv-duel-salon-card/);
  assert.match(privHtml, /acceptActiveDuel\(\)/);
  assert.match(privHtml, /refuseActiveDuel\(\)/);
  assert.match(privHtml, /72 heures/);
  assert.match(privTs, /activeDuelChallenge/);
  assert.match(privTs, /acceptActiveDuel\(\)/);
  assert.match(privTs, /refuseActiveDuel\(\)/);

  // Dedicated duels tab & dynamic submit button checks
  assert.match(privTs, /export type PrivateModalTab = 'create' \| 'share' \| 'join' \| 'duels'/);
  assert.match(privTs, /get submitButtonLabel\(\):\s*string/);
  assert.match(privTs, /get isSubmitDisabled\(\):\s*boolean/);
  assert.match(privHtml, /id="priv-tab-duels"/);
  assert.match(privHtml, /id="priv-panel-duels"/);
  assert.match(privHtml, /\{\{\s*submitButtonLabel\s*\}\}/);
  assert.doesNotMatch(privHtml, /class="priv-duel-actions-row"[\s\S]*?onSendDuelChallenge\(\)/);

  assert.match(appHtml, /standingsActiveTab\s*=\s*'duels'/);
  assert.match(appHtml, /id="filter-duel-league"/);
  assert.match(appHtml, /id="filter-duel-cat"/);
  assert.match(appHtml, /id="filter-duel-country"/);
  assert.match(appHtml, /id="filter-duel-gender"/);
  assert.match(appHtml, /id="filter-duel-age"/);
  assert.match(appHtml, /challengePlayerRequest\.emit\(/);
  assert.match(appTs, /openDuelChallengeForPlayer\(login:\s*string\):\s*void/);
});

test('AccountModal CSS: widens .modal-account to 720px and keeps duel absence & refused days on a single line', () => {
  const appCss = fs.readFileSync(path.join(frontendAppDir, 'app.css'), 'utf8');

  assert.match(
    appCss,
    /\.modal-account\s*\{[^}]*inline-size:\s*min\(94dvw,\s*720px\);[^}]*max-inline-size:\s*720px;[^}]*width:\s*min\(94dvw,\s*720px\);/s,
    '.modal-account must be widened to 720px'
  );
  assert.match(
    appCss,
    /\.duel-window-row,\s*\.duel-days-row\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*white-space:\s*nowrap;/s,
    '.duel-window-row and .duel-days-row must enforce single-line layout (flex-wrap: nowrap; white-space: nowrap;)'
  );
});

test('Duel Email Invitations: models, service, private-room-manager resend UI and account-modal onboarding', () => {
  const userModelTs = fs.readFileSync(path.join(frontendAppDir, 'models/user.model.ts'), 'utf8');
  const rowerServiceTs = fs.readFileSync(path.join(frontendAppDir, 'services/rower.service.ts'), 'utf8');
  const privHtml = fs.readFileSync(
    path.join(frontendAppDir, 'components/private-room-manager/private-room-manager.component.html'),
    'utf8'
  );
  const privTs = fs.readFileSync(
    path.join(frontendAppDir, 'components/private-room-manager/private-room-manager.component.ts'),
    'utf8'
  );
  const appHtml = readAppHtmlBundle();
  const appTs = readAppTsBundle();

  assert.match(userModelTs, /challengedEmail\?:\s*string/);
  assert.match(userModelTs, /inviteToken\?:\s*string/);
  assert.match(userModelTs, /referredBy\?:\s*string/);
  assert.match(userModelTs, /duelInviteToken\?:\s*string/);

  assert.match(rowerServiceTs, /resendDuelInvite\(/);
  assert.match(rowerServiceTs, /\/api\/duels\/\$\{encodeURIComponent\(challengeId\)\}\/resend-invite/);
  assert.match(rowerServiceTs, /getDuelInviteInfo\(/);
  assert.match(rowerServiceTs, /\/api\/duels\/invite-info\?token=/);

  assert.match(privHtml, /Login RowerRace ou E-mail d'un ami/);
  assert.match(privHtml, /ami@email\.com/);
  assert.match(privHtml, /priv-chip-pending-reg/);
  assert.match(privHtml, /En attente d'inscription/);
  assert.match(privHtml, /resendDuelInvite\(d\)/);
  assert.match(privTs, /resendingDuelInviteId\s*=\s*''/);
  assert.match(privTs, /resendDuelInvite\(challenge:\s*DuelChallenge\):\s*void/);

  assert.match(appTs, /pendingDuelInviteToken\s*=\s*''/);
  assert.match(appTs, /pendingRegistrationEmail\s*=\s*''/);
  assert.match(appTs, /urlParams\.get\('duelInviteToken'\)\s*\|\|\s*urlParams\.get\('inviteToken'\)/);
  assert.match(appTs, /getDuelInviteInfo\(/);
  assert.match(appTs, /if\s*\(this\.isIdentified\)/);
  assert.match(appTs, /Invitation expirée ou introuvable/);
  assert.match(appTs, /duelInviteToken:\s*this\.pendingDuelInviteToken\s*\|\|\s*undefined/);
  assert.match(appHtml, /account-duel-banner/);
  assert.match(appHtml, /\[pendingDuelInviteToken\]="pendingDuelInviteToken"/);
  assert.match(appHtml, /\[pendingRegistrationEmail\]="pendingRegistrationEmail"/);
  assert.match(privHtml, /Invité\s*:\s*\{\{\s*activeDuelChallenge\.challengedEmail\s*\}\}/);
});
