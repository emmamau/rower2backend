import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');

test('1. RowerService defines getMyActiveRace targeting /api/v1/races/my-active', () => {
  const serviceTs = fs.readFileSync(
    path.join(frontendAppDir, 'services/rower.service.ts'),
    'utf8'
  );

  assert.match(
    serviceTs,
    /getMyActiveRace\(\s*userId\?: string,\s*deviceToken\?: string\):\s*Observable<\{\s*activeRoom:\s*PrivateRacePayload\s*\|\s*null\s*\}>/
  );
  assert.match(serviceTs, /\/api\/v1\/races\/my-active/);
});

test('2. app.ts persists active private room in localStorage and clears it on exit/leave', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  // activatePrivateRoom saves room id and code
  assert.match(appTs, /localStorage\.setItem\('rower_active_private_room_id',\s*room\.race\.id\)/);
  assert.match(appTs, /localStorage\.setItem\('rower_active_private_room_code',\s*room\.code\s*\|\|\s*room\.race(?:\.|\?\.)code\)/);

  // exitPrivateRoomToPublic clears localStorage
  assert.match(appTs, /localStorage\.removeItem\('rower_active_private_room_id'\)/);
  assert.match(appTs, /localStorage\.removeItem\('rower_active_private_room_code'\)/);
});

test('3. app.ts resolveRoomFromCurrentUrl queries getMyActiveRace when no room code in URL', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  // When !extracted, queries getMyActiveRace and activates if room is still running
  assert.match(appTs, /this\.rowerService\.getMyActiveRace\(this\.activeUserId,\s*this\.deviceToken\)/);
  assert.match(appTs, /this\.activatePrivateRoom\(active,\s*false\)/);
});

test('4. app.ts onWatchPairedSuccess checks getMyActiveRace to immediately activate room on PIN claim', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  // In onWatchPairedSuccess, queries getMyActiveRace if !activePrivateRoom
  assert.match(appTs, /if\s*\(!this\.activePrivateRoom\)\s*\{[\s\S]*?this\.rowerService\.getMyActiveRace\(this\.activeUserId,\s*deviceToken\)/);
});
