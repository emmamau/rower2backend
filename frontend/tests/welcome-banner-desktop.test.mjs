import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appHtmlPath = path.resolve(__dirname, '../src/app/app.html');
const appTsPath = path.resolve(__dirname, '../src/app/app.ts');
const appCssPath = path.resolve(__dirname, '../src/app/app.css');

test('Desktop welcome banner: HTML contains single-line structure with greeting, league, last race/invite and garmin status', () => {
  const html = fs.readFileSync(appHtmlPath, 'utf8');

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
  assert.match(html, /scrollToNextRace\(\)/, 'HTML should allow scrolling to next race on invitation click');

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
