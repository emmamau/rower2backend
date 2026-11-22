import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');

test('1. PrivateRoomManager CSS widens .priv-dialog to 890px and keeps tab buttons on a single row', () => {
  const css = fs.readFileSync(
    path.join(frontendAppDir, 'components/private-room-manager/private-room-manager.component.css'),
    'utf8'
  );

  // Check dialog inline-size is widened to 890px
  assert.match(css, /\.priv-dialog\s*\{[\s\S]*?inline-size:\s*min\(95dvw,\s*890px\);/);

  // Check .priv-tablist has flex-wrap: nowrap on desktop
  assert.match(css, /\.priv-tablist\s*\{[\s\S]*?flex-wrap:\s*nowrap;/);

  // Check .priv-tab-btn has white-space: nowrap
  assert.match(css, /\.priv-tab-btn\s*\{[\s\S]*?white-space:\s*nowrap;/);
});

test('2. RowerService & PrivateRoomManager allow deleting refused, cancelled, or expired duels', () => {
  const rowerServiceTs = fs.readFileSync(
    path.join(frontendAppDir, 'services/rower.service.ts'),
    'utf8'
  );
  const managerTs = fs.readFileSync(
    path.join(frontendAppDir, 'components/private-room-manager/private-room-manager.component.ts'),
    'utf8'
  );
  const managerHtml = fs.readFileSync(
    path.join(frontendAppDir, 'components/private-room-manager/private-room-manager.component.html'),
    'utf8'
  );

  // RowerService exposes deleteDuelChallenge
  assert.match(rowerServiceTs, /deleteDuelChallenge\(\s*challengeId:\s*string,\s*userId:\s*string\s*\)/);
  assert.match(rowerServiceTs, /this\.http\.delete[\s\S]*?\/api\/duels\//);

  // PrivateRoomManagerComponent defines deleteDuel
  assert.match(managerTs, /deleteDuel\(challenge:\s*DuelChallenge\):\s*void/);
  assert.match(managerTs, /this\.rowerService\.deleteDuelChallenge/);

  // HTML displays delete button with cross for REFUSED, CANCELLED, or EXPIRED duels
  assert.match(managerHtml, /\(click\)="deleteDuel\(d\)"/);
  assert.match(managerHtml, /✕/);

  // PrivateRoomManagerComponent defines copyDuelSalonUrl and removeOrCancelDuel
  assert.match(managerTs, /copyDuelSalonUrl\(\s*challenge:\s*DuelChallenge/);
  assert.match(managerTs, /removeOrCancelDuel\(\s*challenge:\s*DuelChallenge/);

  // HTML provides Open, Copy URL and Cross options on duels matching saved salons
  assert.match(managerHtml, /\(click\)="openDuelSalon\(d\)"/);
  assert.match(managerHtml, /\(click\)="copyDuelSalonUrl\(d,\s*\$event\)"/);
  assert.match(managerHtml, /\(click\)="removeOrCancelDuel\(d,\s*true\)"/);
  assert.match(managerHtml, /\(click\)="removeOrCancelDuel\(d,\s*false\)"/);
});

test('3. app.ts refreshPendingPrivateAndDuels counts active/open private rooms and PENDING + ACCEPTED duels', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');
  const headerTs = fs.readFileSync(
    path.join(frontendAppDir, 'components/app-header/app-header.component.ts'),
    'utf8'
  );

  // app.ts counts both PENDING and ACCEPTED duels
  assert.match(appTs, /d\.status === 'PENDING' \|\| d\.status === 'ACCEPTED'/);

  // app-header tooltip mentions active/ouvert duels
  assert.match(headerTs, /duel\$\{duels > 1 \? 's' : ''\} actif\$\{duels > 1 \? 's' : ''\}\/ouvert\$\{duels > 1 \? 's' : ''\}/);
});

test('4. app.ts formatDetailedCountdown handles days, hours, minutes, seconds and defaults to minutes', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  // Verify formatDetailedCountdown method exists in app.ts
  assert.match(appTs, /formatDetailedCountdown\(msUntilStart:\s*number\):\s*string/);

  // Extract the function body and evaluate it in test sandbox
  const match = appTs.match(/formatDetailedCountdown\(msUntilStart:\s*number\):\s*string\s*\{([\s\S]*?)\n\s*getWaitingStatusText/);
  assert.ok(match, 'formatDetailedCountdown must be defined before getWaitingStatusText');
  const body = match[1].trim().replace(/\}$/, '');

  const fn = new Function('msUntilStart', body);

  // 1. Duration >= 1 day
  const twoDaysMs = (2 * 86400 + 4 * 3600 + 10 * 60 + 15) * 1000;
  assert.equal(fn(twoDaysMs), '2j 4h 10m 15s');

  // 2. Duration >= 1 hour
  const twoHoursMs = (2 * 3600 + 15 * 60 + 30) * 1000;
  assert.equal(fn(twoHoursMs), '2h 15m 30s');

  // 3. Duration < 1 hour with seconds
  const tenMinMs = (10 * 60 + 45) * 1000;
  assert.equal(fn(tenMinMs), '10m 45s');

  // 4. Duration < 1 hour with zero seconds: default is in minutes
  const exactFiveMinMs = 5 * 60 * 1000;
  assert.equal(fn(exactFiveMinMs), '5 min');

  // 5. Zero or negative ms: imminent
  assert.equal(fn(0), 'imminent');
});
