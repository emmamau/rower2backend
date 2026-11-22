import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Frontend Race Duration & Countdown Lock: Ticker never starts duration countdown or pre-start overlay in LOBBY', () => {
  const appTsPath = path.join(rootDir, 'src/app/app.ts');
  const appTsContent = fs.readFileSync(appTsPath, 'utf-8');

  // 1. isRaceActive must explicitly return false when activePrivateRoom is in LOBBY or COUNTDOWN
  assert.match(
    appTsContent,
    /get\s+isRaceActive\(\)\s*:\s*boolean\s*\{[\s\S]*?if\s*\(\s*this\.activePrivateRoom\s*\)\s*\{[\s\S]*?roomStatus\s*===\s*'LOBBY'\s*\|\|\s*roomStatus\s*===\s*'COUNTDOWN'[\s\S]*?return\s+false;/,
    'isRaceActive must return false when activePrivateRoom is in LOBBY or COUNTDOWN'
  );

  // 2. initGameLoop must maintain full duration (gameMaxDurationSeconds) and 0 countdown while in LOBBY
  assert.match(
    appTsContent,
    /isRoomWaiting[\s\S]*?this\.countdownSeconds\s*=\s*0;[\s\S]*?this\.is3sCountdown\s*=\s*false;[\s\S]*?this\.isPreStartCountdown\s*=\s*false;[\s\S]*?this\.gameRemainingSeconds\s*=\s*this\.gameMaxDurationSeconds;/,
    'initGameLoop must lock gameRemainingSeconds to gameMaxDurationSeconds and clear pre-start overlays while room is waiting in LOBBY'
  );

  // 3. initCountdownTicker must NEVER decrement countdownSeconds or gameRemainingSeconds while room is waiting in LOBBY
  assert.match(
    appTsContent,
    /if\s*\(\s*!isRunning\s*&&\s*!isRoomWaiting\s*&&\s*this\.countdownSeconds\s*>\s*0\s*\)/,
    'initCountdownTicker must only decrement countdownSeconds when room is NOT waiting in LOBBY'
  );

  // 4. initCountdownTicker must lock duration countdown while waiting
  assert.match(
    appTsContent,
    /} else if \(isRoomWaiting\) \{[\s\S]*?this\.gameRemainingSeconds = this\.gameMaxDurationSeconds/,
    'initCountdownTicker must reset and hold gameRemainingSeconds to full duration while room is waiting'
  );

  // 5. initCountdownTicker countdownSeconds === 0 must NEVER locally force nextRaceInfo.status = in_progress or RUNNING
  const tickerFnMatch = appTsContent.match(/private initCountdownTicker\(\): void \{([\s\S]*?)\n  \}/);
  assert.ok(tickerFnMatch, 'Must find initCountdownTicker implementation');
  const tickerBody = tickerFnMatch[1];
  assert.doesNotMatch(
    tickerBody,
    /this\.nextRaceInfo\.status\s*=\s*['"]in_progress['"]/,
    'initCountdownTicker must never locally force status = in_progress without server confirmation'
  );
  assert.doesNotMatch(
    tickerBody,
    /this\.nextRaceInfo\.race\.status\s*=\s*['"]RUNNING['"]/,
    'initCountdownTicker must never locally force race.status = RUNNING without server confirmation'
  );

  // 6. syncCountdownUI must suppress pre-start overlay when room is waiting or when countdown > 15 for private room
  assert.match(
    appTsContent,
    /if\s*\(\s*this\.activePrivateRoom\s*&&\s*this\.countdownSeconds\s*>\s*15\s*\)\s*\{[\s\S]*?this\.isPreStartCountdown\s*=\s*false;/,
    'syncCountdownUI must not show pre-start countdown overlay when countdown is > 15s for private rooms'
  );

  // 7. startBotDuel must default to botStartMode: first_stroke
  assert.match(
    appTsContent,
    /startBotDuel\(\)[\s\S]*?botStartMode\s*:\s*['"]first_stroke['"]/,
    'startBotDuel must pass botStartMode: first_stroke to prevent auto-starting countdown on join'
  );
});
