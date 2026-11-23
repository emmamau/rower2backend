import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');

test('1. app.ts immediately installs kayak on water lane upon watch PIN claim in onGarminPaired', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  // Vérifier que la saisie du code PIN installe immédiatement le kayak sur sa ligne d'eau dans liveMetricsList
  assert.match(
    appTs,
    /installKayakOnWaterLane\s*\(/,
    'app.ts doit définir une méthode dédiée installKayakOnWaterLane'
  );

  // Vérifier que onGarminPaired appelle installKayakOnWaterLane
  assert.match(
    appTs,
    /this\.garminPairedSub\s*=\s*this\.socketService\.onGarminPaired\(\)\.subscribe\([\s\S]*?installKayakOnWaterLane\s*\(/,
    'onGarminPaired doit appeler installKayakOnWaterLane pour positionner le kayak sur sa ligne d eau dès la validation du PIN'
  );
});

test('2. app.ts installKayakOnWaterLane sets default room, switches to regatta view, and closes overlays', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  // installKayakOnWaterLane doit :
  // - positionner la ligne d'eau (myAssignedLane)
  // - définir activeUserId et claimedRacerUserId (fermant l'overlay PIN smartphone)
  // - insérer / mettre à jour l'entrée du kayak dans liveMetricsList avec ses couleurs et sa ligne
  // - basculer sur siteView = 'regatta'
  // - afficher un toast de bienvenue indiquant la ligne attribuée
  const fnStartIndex = appTs.indexOf('installKayakOnWaterLane(');
  assert.ok(fnStartIndex > 0, 'installKayakOnWaterLane doit exister');
  const fnEndIndex = appTs.indexOf('resetGarminPairing()', fnStartIndex);
  const fnBody = appTs.substring(fnStartIndex, fnEndIndex);

  assert.match(fnBody, /myAssignedLane\s*=/, 'Doit définir myAssignedLane');
  assert.match(fnBody, /claimedRacerUserId\s*=/, 'Doit définir claimedRacerUserId pour hasPlayerJoinedWaterLane');
  assert.match(fnBody, /liveMetricsList/, 'Doit inscrire le kayak dans liveMetricsList');
  assert.match(fnBody, /setSiteView\(['"]regatta['"]\)/, 'Doit basculer sur la vue régate');
  assert.match(fnBody, /triggerFinishToast\(/, 'Doit déclencher un toast de confirmation de ligne attribuée');
});

test('3. app.ts activatePrivateRoom hydrates liveMetricsList with room participants on starting pontoon', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  // Dans activatePrivateRoom, les participants du salon doivent être immédiatement pré-remplis sur leurs lignes d'eau
  assert.match(
    appTs,
    /activatePrivateRoom[\s\S]*?liveMetricsList[\s\S]*?participants/,
    'activatePrivateRoom doit synchroniser immédiatement les participants du salon sur leurs lignes d eau au ponton de départ'
  );
});

test('4. onGarminPaired checks isPinMatch and isDeviceMatch to avoid dropping PIN events when already paired', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  assert.match(
    appTs,
    /isPinMatch\s*=\s*Boolean\([\s\S]*?incomingPin[\s\S]*?currentPin/,
    'onGarminPaired doit calculer isPinMatch'
  );
  assert.match(
    appTs,
    /if\s*\(!this\.isPaired\s*\|\|\s*data\.userId === currentId\s*\|\|\s*isMyTicket\s*\|\|\s*isPinMatch\s*\|\|\s*isDeviceMatch\)/,
    'onGarminPaired doit accepter l événement si le code PIN ou le device correspond même si isPaired est vrai'
  );
});

test('5. pollActiveRaceSource preserves participant with pinValidated in duel and private rooms', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  assert.match(
    appTs,
    /pinValidated[\s\S]*?connectionState === 'READY'/,
    'pollActiveRaceSource doit vérifier pinValidated pour ne pas filtrer le participant sur l eau'
  );
  assert.match(
    appTs,
    /installKayakOnWaterLane[\s\S]*?pinValidated:\s*true/,
    'installKayakOnWaterLane doit définir pinValidated: true'
  );
});
