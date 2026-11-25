import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');

test('1. resolveRoomFromCurrentUrl calls getMyActiveRace on boot even if no storedRoomId in localStorage', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  const fnStartIndex = appTs.indexOf('resolveRoomFromCurrentUrl(): void {');
  assert.ok(fnStartIndex > 0, 'resolveRoomFromCurrentUrl must exist');
  const fnEndIndex = appTs.indexOf('private activatePrivateRoom(', fnStartIndex);
  const fnBody = appTs.substring(fnStartIndex, fnEndIndex);

  // Must NOT gate getMyActiveRace behind if (storedRoomId)
  assert.doesNotMatch(
    fnBody,
    /if\s*\(\s*storedRoomId\s*\)\s*\{[\s\S]*?getMyActiveRace/,
    'getMyActiveRace must be called unconditionally on boot even without storedRoomId in localStorage'
  );

  assert.match(
    fnBody,
    /this\.rowerService\.getMyActiveRace\(this\.activeUserId,\s*this\.deviceToken\)/,
    'resolveRoomFromCurrentUrl must call getMyActiveRace'
  );
});

test('2. When getMyActiveRace returns an active room, it activates room, sets siteView to regatta, and stores in localStorage', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  const fnStartIndex = appTs.indexOf('resolveRoomFromCurrentUrl(): void {');
  const fnEndIndex = appTs.indexOf('private activatePrivateRoom(', fnStartIndex);
  const fnBody = appTs.substring(fnStartIndex, fnEndIndex);

  // Checks activation and view switch
  assert.match(
    fnBody,
    /this\.activatePrivateRoom\(\s*active,\s*false/i,
    'Must call activatePrivateRoom with active race'
  );
  assert.match(
    fnBody,
    /this\.setSiteView\(['"]regatta['"]\)/,
    'Must switch view to regatta when default race is active'
  );
  assert.match(
    fnBody,
    /isAwaitingWatchPin\s*=\s*Boolean\(active\.isAwaitingWatchPin\)/,
    'Must propagate isAwaitingWatchPin from activeRoom'
  );
  assert.match(
    fnBody,
    /localStorage\.setItem\(['"]rower_active_private_room_id['"]/,
    'Must store active room id in localStorage'
  );
});

test('3. When getMyActiveRace returns a COMPLETED race, it activates room and sets isPrivateRoomCompleted = true', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  const fnStartIndex = appTs.indexOf('resolveRoomFromCurrentUrl(): void {');
  const fnEndIndex = appTs.indexOf('private activatePrivateRoom(', fnStartIndex);
  const fnBody = appTs.substring(fnStartIndex, fnEndIndex);

  // Must not reject COMPLETED status in condition
  assert.doesNotMatch(
    fnBody,
    /active\.status\s*!==\s*['"]COMPLETED['"]\s*&&/,
    'Must NOT reject COMPLETED status'
  );

  // Must set isPrivateRoomCompleted = true when race is COMPLETED
  assert.match(
    fnBody,
    /isPrivateRoomCompleted\s*=\s*true/,
    'Must set isPrivateRoomCompleted = true for COMPLETED race to display rankings/podium'
  );
});

test('4. When getMyActiveRace returns null, app defaults to public race and clears localStorage', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  const fnStartIndex = appTs.indexOf('resolveRoomFromCurrentUrl(): void {');
  const fnEndIndex = appTs.indexOf('private activatePrivateRoom(', fnStartIndex);
  const fnBody = appTs.substring(fnStartIndex, fnEndIndex);

  assert.match(
    fnBody,
    /localStorage\.removeItem\(['"]rower_active_private_room_id['"]\)/,
    'Must clear rower_active_private_room_id when no active room'
  );
  assert.match(
    fnBody,
    /this\.initGameLoop\(\)/,
    'Must initialize public game loop when no active room is returned'
  );
});
