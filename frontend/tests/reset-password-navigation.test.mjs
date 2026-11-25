import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');

test('1. app.routes.ts declares route for reset-password', () => {
  const routesContent = fs.readFileSync(path.join(frontendAppDir, 'app.routes.ts'), 'utf8');
  assert.match(
    routesContent,
    /path:\s*['"]reset-password['"]/,
    'app.routes.ts doit déclarer la route reset-password'
  );
});

test('2. app.ts intercepts /reset-password route and handles token or resetToken query param', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  // Verify support for reset-password pathname and query param token / resetToken
  assert.ok(
    appTs.includes("window.location.pathname.startsWith('/reset-password')") ||
    appTs.includes("window.location.pathname === '/reset-password'"),
    'app.ts doit intercepter le chemin /reset-password'
  );

  assert.ok(
    appTs.includes("urlParams.get('resetToken')") &&
    appTs.includes("urlParams.get('token')"),
    'app.ts doit extraire indifféremment token ou resetToken'
  );

  assert.ok(
    appTs.includes("this.showResetFields = true;") &&
    appTs.includes("this.openAccountModal('forgot');"),
    'app.ts doit activer showResetFields et ouvrir la modale forgot'
  );
});

test('3. resolveRoomFromCurrentUrl protects reset-password flow from being overwritten by active race or leaderboard', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  const fnStartIndex = appTs.indexOf('resolveRoomFromCurrentUrl(): void {');
  assert.ok(fnStartIndex > 0, 'resolveRoomFromCurrentUrl must exist');
  const fnEndIndex = appTs.indexOf('private activatePrivateRoom(', fnStartIndex);
  const fnBody = appTs.substring(fnStartIndex, fnEndIndex);

  // Must guard against switching to regatta view if reset password is in progress
  assert.ok(
    fnBody.includes('this.showResetFields') || fnBody.includes('resetToken'),
    'resolveRoomFromCurrentUrl doit vérifier showResetFields / resetToken avant de basculer en vue régate ou d’ouvrir le classement'
  );
});
