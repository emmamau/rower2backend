import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('frontend league.util exports calculateRacePointsBreakdown matching backend logic', async () => {
  const leagueUtilPath = path.join(rootDir, 'src/app/utils/league.util.ts');
  const content = fs.readFileSync(leagueUtilPath, 'utf-8');

  assert.match(
    content,
    /export\s+function\s+calculateRacePointsBreakdown/,
    'league.util.ts must export calculateRacePointsBreakdown'
  );
  assert.match(
    content,
    /higherRankedBonus/,
    'calculateRacePointsBreakdown must calculate higherRankedBonus for capped opponents'
  );
  assert.match(
    content,
    /pelotonMultiplier/,
    'calculateRacePointsBreakdown must support pelotonMultiplier'
  );
});

test('regatta-view template displays points and binds pointsBreakdown title tooltip', () => {
  const regattaViewHtmlPath = path.join(rootDir, 'src/app/components/regatta-view/regatta-view.component.html');
  const content = fs.readFileSync(regattaViewHtmlPath, 'utf-8');

  assert.match(
    content,
    /\[title\]="entry\.pointsBreakdown/,
    'regatta-view.component.html must bind [title]="entry.pointsBreakdown || ..."'
  );
});

test('race-history-modal template binds pointsBreakdown tooltip', () => {
  const historyHtmlPath = path.join(rootDir, 'src/app/components/modals/race-history-modal/race-history-modal.component.html');
  const content = fs.readFileSync(historyHtmlPath, 'utf-8');

  assert.match(
    content,
    /\[title\]="entry\.pointsBreakdown/,
    'race-history-modal.component.html must bind [title]="entry.pointsBreakdown || ..."'
  );
});
