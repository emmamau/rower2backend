import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilTsPath = path.resolve(__dirname, '../src/app/utils/room-link.util.ts');

function loadTranspiledRoomLinkUtil() {
  const source = fs.readFileSync(utilTsPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true
    }
  });
  const moduleObj = { exports: {} };
  const fn = new vm.Script(
    `(function(exports, module) { ${transpiled.outputText} })`,
    { filename: 'room-link.util.js' }
  ).runInThisContext();
  fn(moduleObj.exports, moduleObj);
  return moduleObj.exports;
}

const { buildRoomInviteMessage } = loadTranspiledRoomLinkUtil();

test('1. buildRoomInviteMessage includes scheduledInfo with international date and time when present', () => {
  const invite = buildRoomInviteMessage({
    headerLabel: 'Rejoignez la régate',
    title: 'Régate Internationale Paris-Tokyo',
    targetDistance: 2000,
    urlLabel: 'Lien direct',
    shareUrl: 'https://rower-race.com/r/krm-wzx-qpl',
    codeLabel: 'Code salon',
    code: 'krm-wzx-qpl',
    pinLabel: 'Code PIN Garmin',
    pinCode: 'X7K2M',
    scheduledInfo: 'Mercredi 18 nov. 18:00 (Europe/Paris) / 17:00 UTC'
  });

  assert.match(invite, /Régate Internationale Paris-Tokyo/);
  assert.match(invite, /📅 Départ : Mercredi 18 nov\. 18:00 \(Europe\/Paris\) \/ 17:00 UTC/);
  assert.match(invite, /krm-wzx-qpl/);
  assert.match(invite, /X7K2M/);
});

test('2. Timezone conversion logic accurately maps local wall clock times to universal UTC', () => {
  function formatScheduledDateTimeForUtc(naiveDateTime, timeZone) {
    const match = naiveDateTime.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    const [_, yStr, mStr, dStr, hStr, minStr] = match;
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    const day = parseInt(dStr, 10);
    const hour = parseInt(hStr, 10);
    const minute = parseInt(minStr, 10);

    const utcRef = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'Europe/Paris',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const parts = dtf.formatToParts(utcRef);
    const getVal = (type) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
    const tzYear = getVal('year');
    const tzMonth = getVal('month');
    const tzDay = getVal('day');
    let tzHour = getVal('hour');
    if (tzHour === 24) tzHour = 0;
    const tzMin = getVal('minute');
    const tzSec = getVal('second');

    const tzTimeAsUtc = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMin, tzSec);
    const offsetMs = tzTimeAsUtc - utcRef.getTime();
    return new Date(utcRef.getTime() - offsetMs).toISOString();
  }

  // Paris 18:00 in November (CET, UTC+1) => 17:00:00.000Z
  const parisUtc = formatScheduledDateTimeForUtc('2026-11-20T18:00', 'Europe/Paris');
  assert.equal(parisUtc, '2026-11-20T17:00:00.000Z');

  // New York 18:00 in November (EST, UTC-5) => 23:00:00.000Z
  const nyUtc = formatScheduledDateTimeForUtc('2026-11-20T18:00', 'America/New_York');
  assert.equal(nyUtc, '2026-11-20T23:00:00.000Z');

  // Tokyo 18:00 in November (JST, UTC+9) => 09:00:00.000Z
  const tokyoUtc = formatScheduledDateTimeForUtc('2026-11-20T18:00', 'Asia/Tokyo');
  assert.equal(tokyoUtc, '2026-11-20T09:00:00.000Z');
});
