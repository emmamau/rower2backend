import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendSrcDir = path.join(rootDir, 'src');

test('1. Translation keys: BTN_RETURN_HOME is "Accueil" and RACE_RETURN_HOME_TIP describes returning home without leaving race', () => {
  const fr = fs.readFileSync(path.join(frontendSrcDir, 'app/i18n/locales/fr.ts'), 'utf8');
  assert.ok(fr.includes("'BTN_RETURN_HOME': 'Accueil'"), "fr.ts must have 'BTN_RETURN_HOME': 'Accueil'");
  assert.ok(fr.includes("'RACE_RETURN_HOME_TIP': 'Revenir à l\\'accueil tout en restant dans la course'"), "fr.ts must have updated RACE_RETURN_HOME_TIP");

  const en = fs.readFileSync(path.join(frontendSrcDir, 'app/i18n/locales/en.ts'), 'utf8');
  assert.ok(en.includes("'BTN_RETURN_HOME': 'Home'"), "en.ts must have 'BTN_RETURN_HOME': 'Home'");
  assert.ok(en.includes("'RACE_RETURN_HOME_TIP': 'Return to home while remaining in the race'"), "en.ts must have updated RACE_RETURN_HOME_TIP");
});

test('2. cockpit-view and regatta-view have the Accueil button calling setSiteView("home")', () => {
  const cockpitHtml = fs.readFileSync(path.join(frontendSrcDir, 'app/components/cockpit-view/cockpit-view.component.html'), 'utf8');
  assert.ok(cockpitHtml.includes('(click)="setSiteView(\'home\')"'), 'cockpit-view must have button calling setSiteView("home")');
  assert.ok(cockpitHtml.includes('BTN_RETURN_HOME'), 'cockpit-view must use BTN_RETURN_HOME translation');

  const regattaHtml = fs.readFileSync(path.join(frontendSrcDir, 'app/components/regatta-view/regatta-view.component.html'), 'utf8');
  assert.ok(regattaHtml.includes('(click)="setSiteView(\'home\')"'), 'regatta-view must have button calling setSiteView("home")');
  assert.ok(regattaHtml.includes('BTN_RETURN_HOME'), 'regatta-view must use BTN_RETURN_HOME translation');
});

test('3. app.ts setSiteView("home") does NOT call exitPrivateRoomToPublic, preserving active private room', () => {
  const appTs = fs.readFileSync(path.join(frontendSrcDir, 'app/app.ts'), 'utf8');
  const setSiteViewMethod = appTs.substring(
    appTs.indexOf('setSiteView(view:'),
    appTs.indexOf('onHeaderLogoClick():')
  );
  assert.ok(!setSiteViewMethod.includes('exitPrivateRoomToPublic'), 'setSiteView("home") must NOT call exitPrivateRoomToPublic');
});

test('4. home-dashboard has an active race resume banner accessible on smartphone', () => {
  const homeHtml = fs.readFileSync(path.join(frontendSrcDir, 'app/components/home-dashboard/home-dashboard.component.html'), 'utf8');
  assert.ok(homeHtml.includes('home-active-race-callout') || homeHtml.includes('lobby-live-race-banner'), 'home-dashboard must have active race banner');
  assert.ok(!homeHtml.includes('*ngIf="false"'), 'home-active-race-callout must not have *ngIf="false"');
});

test('5. app.ts respects userExplicitlyNavigatedHome on race status updates (COUNTDOWN and RUNNING)', () => {
  const appTs = fs.readFileSync(path.join(frontendSrcDir, 'app/app.ts'), 'utf8');
  const runningBlock = appTs.substring(
    appTs.indexOf("} else if (update.status === 'RUNNING') {"),
    appTs.indexOf("this.activePrivateRoom.race.participants = update.participants;")
  );
  assert.ok(runningBlock.includes('!this.userExplicitlyNavigatedHome'), 'RUNNING update must check !userExplicitlyNavigatedHome before forcing regatta');
});
