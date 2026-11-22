import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAppHtmlBundle } from './test-app-bundle.helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appTsPath = path.resolve(__dirname, '../src/app/app.ts');
const appCssPath = path.resolve(__dirname, '../src/app/app.css');

test('Desktop welcome banner: HTML contains single-line structure with greeting, league, last race/invite and garmin status', () => {
  const html = readAppHtmlBundle();

  // Must have connected welcome card
  assert.match(html, /welcome-banner-card\s+is-connected/, 'HTML should contain .welcome-banner-card.is-connected');

  // Must have greeting with medal
  assert.match(html, /welcome-league-badge/, 'HTML should display league medal badge');
  assert.match(html, /Ravi de vous revoir/, 'HTML should contain welcome greeting');

  // Must have league & points
  assert.match(html, /currentUserLeague\.name/, 'HTML should display league name');
  assert.match(html, /currentUser\.points/, 'HTML should display points');

  // Must have last race / invite block
  assert.match(html, /lastRaceSummary\.hasRaced/, 'HTML should check lastRaceSummary.hasRaced');
  assert.match(html, /Derni[eè]re course/, 'HTML should display last race label');
  assert.match(html, /Prenez votre 1.+d[eé]part/i, 'HTML should display invitation when no race completed');
  assert.match(html, /scrollToNextRace(?:Request\.emit)?\(\)/, 'HTML should allow scrolling to next race on invitation click');

  // Must have Garmin status
  assert.match(html, /Montre Garmin li[eé]e/, 'HTML should display linked Garmin watch status');
  assert.match(html, /Montre non li[eé]e/, 'HTML should display unlinked Garmin watch status');
});

test('Desktop welcome banner: TypeScript exposes lastRaceSummary and scrollToNextRace', () => {
  const ts = fs.readFileSync(appTsPath, 'utf8');

  // Must define lastRaceSummary getter
  assert.match(ts, /get\s+lastRaceSummary\s*\(\)/, 'app.ts should have lastRaceSummary getter');

  // Must check userHistory or totalRaces / lastRank
  assert.match(ts, /userHistory/, 'lastRaceSummary should inspect userHistory');

  // Must define scrollToNextRace method
  assert.match(ts, /scrollToNextRace\s*\(/, 'app.ts should define scrollToNextRace');
});

test('Desktop welcome banner: CSS contains desktop single-line styles and reduced height', () => {
  const css = fs.readFileSync(appCssPath, 'utf8');

  // Must style .welcome-banner-card.is-connected for desktop
  assert.match(css, /\.welcome-banner-card/, 'CSS should define .welcome-banner-card');
  assert.match(css, /welcome-inline-user|welcome-inline-race|welcome-race-pill/, 'CSS should have styles for inline banner items');
});

test('Last race banner display: HTML renders date, rank, duration, and distance', () => {
  const html = readAppHtmlBundle();

  // Must render date in visible pill
  assert.match(html, /pill-date/, 'HTML should have .pill-date for displaying the race date');
  assert.match(html, /lastRaceSummary\.date/, 'HTML should display lastRaceSummary.date');

  // Must render rank
  assert.match(html, /pill-rank/, 'HTML should have .pill-rank for displaying the rank');
  assert.match(html, /lastRaceSummary\.rankDisplay/, 'HTML should display lastRaceSummary.rankDisplay');

  // Must render duration and distance in details
  assert.match(html, /pill-details/, 'HTML should have .pill-details');
  assert.match(html, /lastRaceSummary\.timeFormatted/, 'HTML should display duration via timeFormatted');
  assert.match(html, /lastRaceSummary\.distance/, 'HTML should display distance');

  // Must have flag icon
  assert.match(html, /🏁/, 'HTML should display the finish flag icon');
  // Must condition pill-label on smartphone
  assert.match(html, /\*ngIf="!isSmartphone"[^>]*>Dernière course/, 'HTML should suppress Dernière course label on smartphone');
});

test('Last race banner smartphone responsive CSS: hides pill-label on smartphone', () => {
  const css = fs.readFileSync(appCssPath, 'utf8');

  // Under @media (max-width: 768px), .welcome-race-pill.is-completed .pill-label must be display: none
  assert.match(css, /\.welcome-race-pill\.is-completed\s+\.pill-label\s*\{[^}]*display:\s*none\s*!important/s, 'CSS should hide .pill-label on smartphone');
});

test('Last race getter: filters only finished races and extracts date, rank, duration, and distance', () => {
  const ts = fs.readFileSync(appTsPath, 'utf8');

  // Must filter userHistory for finished races
  assert.match(ts, /finished|completed/, 'lastRaceSummary should filter for finished or completed races');

  // Must extract date, rank, distance and duration
  assert.match(ts, /dateFormatted|createdAt/, 'lastRaceSummary should format/extract date');
  assert.match(ts, /timeFormatted/, 'lastRaceSummary should extract timeFormatted duration');
  assert.match(ts, /rankDisplay/, 'lastRaceSummary should compute rankDisplay');
  assert.match(ts, /targetDistance|netDistance/, 'lastRaceSummary should extract distance');
});

test('Last race behavioral simulation: ignores abandoned/in_progress races and selects latest finished race with all 4 fields', () => {
  function formatTime(val) {
    const sec = Number(val) || 0;
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function computeLastRaceSummary(userHistory, currentUser) {
    if (userHistory && userHistory.length > 0) {
      const finishedRaces = userHistory.filter(
        (h) => h && (String(h.status || '').toLowerCase() === 'finished' || String(h.status || '').toLowerCase() === 'completed')
      );
      if (finishedRaces.length > 0) {
        finishedRaces.sort((a, b) => {
          const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tB - tA;
        });
        const last = finishedRaces[0];
        const r = Number(last.finalRank || currentUser?.lastRank || 0);
        const rankDisplay = r === 1 ? '🥇 1ᵉʳ' : r === 2 ? '🥈 2ᵉ' : r === 3 ? '🥉 3ᵉ' : r > 0 ? `#${r}` : 'Terminée';
        const dist = Number(last.targetDistance || last.netDistance || 0);
        const time = last.elapsedTime ? formatTime(last.elapsedTime) : '';
        let dateFormatted = '';
        if (last.createdAt) {
          const d = new Date(last.createdAt);
          if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            dateFormatted = `${day}/${month}/${year}`;
          }
        }
        return {
          hasRaced: true,
          rank: r,
          rankDisplay,
          distance: dist > 0 ? dist : undefined,
          timeFormatted: time || undefined,
          date: last.createdAt,
          dateFormatted: dateFormatted || undefined,
        };
      }
    }
    return { hasRaced: false };
  }

  // Case 1: User has 2 activities: latest was abandoned, previous was finished
  const history1 = [
    { activityId: 'act-2', status: 'abandoned', finalRank: 0, netDistance: 500, elapsedTime: 90, createdAt: '2026-11-22T08:00:00.000Z' },
    { activityId: 'act-1', status: 'finished', finalRank: 2, targetDistance: 2000, elapsedTime: 435, createdAt: '2026-11-21T10:00:00.000Z' },
  ];
  const res1 = computeLastRaceSummary(history1, { lastRank: 2 });
  assert.equal(res1.hasRaced, true);
  assert.equal(res1.rankDisplay, '🥈 2ᵉ');
  assert.equal(res1.distance, 2000);
  assert.equal(res1.timeFormatted, '7:15');
  assert.equal(res1.dateFormatted, '21/11/2026');

  // Case 2: User has only abandoned/waiting activities -> hasRaced should be false
  const history2 = [
    { activityId: 'act-3', status: 'abandoned', finalRank: 0, netDistance: 200, elapsedTime: 40, createdAt: '2026-11-22T08:00:00.000Z' },
    { activityId: 'act-4', status: 'waiting', finalRank: 0, netDistance: 0, elapsedTime: 0, createdAt: '2026-11-20T08:00:00.000Z' },
  ];
  const res2 = computeLastRaceSummary(history2, { totalRaces: 2, lastRank: 0 });
  assert.equal(res2.hasRaced, false);

  // Case 3: User has empty history -> hasRaced should be false even if totalRaces > 0
  const res3 = computeLastRaceSummary([], { totalRaces: 5, lastRank: 1 });
  assert.equal(res3.hasRaced, false);
});
