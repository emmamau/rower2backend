import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appTsPath = path.resolve(__dirname, '../src/app/app.ts');
const appHtmlPath = path.resolve(__dirname, '../src/app/app.html');
const prmTsPath = path.resolve(__dirname, '../src/app/components/private-room-manager/private-room-manager.component.ts');

test('Smartphone Salon Regatta Start: PrivateRoomManagerComponent declares raceStartTriggered output', () => {
  const prmSource = fs.readFileSync(prmTsPath, 'utf8').replace(/\r\n/g, '\n');

  assert.ok(
    prmSource.includes('raceStartTriggered = new EventEmitter'),
    'PrivateRoomManagerComponent doit déclarer @Output() raceStartTriggered'
  );
  assert.ok(
    prmSource.includes('this.raceStartTriggered.emit({ countdownSeconds });'),
    'triggerStart doit émettre raceStartTriggered immédiatement avec countdownSeconds'
  );
  assert.ok(
    prmSource.includes('this.raceStartTriggered.emit({ countdownSeconds: 0, isFirstStroke: true });'),
    'triggerStartOnFirstStroke doit émettre raceStartTriggered'
  );
});

test('Smartphone Salon Regatta Start: app.html binds raceStartTriggered to onPrivateRaceStartTriggered', () => {
  const appHtml = fs.readFileSync(appHtmlPath, 'utf8').replace(/\r\n/g, '\n');

  assert.ok(
    appHtml.includes('(raceStartTriggered)="onPrivateRaceStartTriggered($event)"'),
    'app.html doit écouter (raceStartTriggered)="onPrivateRaceStartTriggered($event)" sur app-private-room-manager'
  );
});

test('Smartphone Salon Regatta Start: app.ts defines onPrivateRaceStartTriggered and switches to regatta landscape fullscreen', () => {
  const appTs = fs.readFileSync(appTsPath, 'utf8').replace(/\r\n/g, '\n');

  const methodIdx = appTs.indexOf('onPrivateRaceStartTriggered(event?:');
  assert.ok(methodIdx > 0, 'app.ts doit implémenter la méthode onPrivateRaceStartTriggered(event?:');

  const onStartBlock = appTs.slice(methodIdx, methodIdx + 400);

  assert.ok(
    onStartBlock.includes("this.isPrivateModalOpen = false;"),
    'onPrivateRaceStartTriggered doit fermer la modale du salon'
  );
  assert.ok(
    onStartBlock.includes("this.setSiteView('regatta');"),
    'onPrivateRaceStartTriggered doit basculer sur la vue régate'
  );
  assert.ok(
    onStartBlock.includes("this.enterFullscreen()"),
    'onPrivateRaceStartTriggered doit appeler enterFullscreen()'
  );
  assert.ok(
    onStartBlock.includes("this.lockLandscape()"),
    'onPrivateRaceStartTriggered doit appeler lockLandscape()'
  );
});

test('Smartphone Salon Regatta Start: startActivePrivateRace triggers regatta fullscreen landscape', () => {
  const appTs = fs.readFileSync(appTsPath, 'utf8').replace(/\r\n/g, '\n');

  const startIdx = appTs.indexOf('startActivePrivateRace(): void {');
  assert.ok(startIdx > 0, 'app.ts doit définir startActivePrivateRace(): void {');

  const startBlock = appTs.slice(startIdx, startIdx + 800);

  assert.ok(
    startBlock.includes('this.onPrivateRaceStartTriggered('),
    'startActivePrivateRace doit invoquer onPrivateRaceStartTriggered lors du clic utilisateur'
  );
});

test('Smartphone Salon Regatta Start: statusSub and onPrivateRoomUpdated auto-switch to regatta landscape on smartphone for private salons', () => {
  const appTs = fs.readFileSync(appTsPath, 'utf8').replace(/\r\n/g, '\n');

  // statusSub COUNTDOWN check
  assert.ok(
    appTs.includes("if (this.isSmartphone || this.isMobileOrTablet) {\n            this.isPrivateModalOpen = false;"),
    'statusSub COUNTDOWN sur salon privé doit basculer les smartphones/mobiles en régate'
  );

  // onPrivateRoomUpdated check
  assert.ok(
    appTs.includes("(updatedStatus === 'COUNTDOWN' || updatedStatus === 'RUNNING' || (updated?.secondsRemaining && updated.secondsRemaining > 0)) &&\n      (this.isSmartphone || this.isMobileOrTablet)"),
    'onPrivateRoomUpdated doit basculer automatiquement les smartphones/mobiles en régate'
  );

  // isRaceOrCountdownActive check
  assert.ok(
    appTs.includes("statusUpper === 'COUNTDOWN'"),
    'isRaceOrCountdownActive doit reconnaître le statut COUNTDOWN en majuscules'
  );
});
