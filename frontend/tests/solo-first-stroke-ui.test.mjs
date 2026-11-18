import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('PrivateRoomManagerComponent: Solo start mode "Au premier coup de rame" support in TS & HTML', () => {
  const tsPath = path.join(rootDir, 'src/app/components/private-room-manager/private-room-manager.component.ts');
  const tsContent = fs.readFileSync(tsPath, 'utf-8');

  // 1. Check soloStartMode declaration
  assert.match(
    tsContent,
    /soloStartMode\s*:\s*('first_stroke'\s*\|\s*'countdown'|'countdown'\s*\|\s*'first_stroke')\s*=\s*'first_stroke'/,
    'PrivateRoomManagerComponent must declare soloStartMode defaulting to first_stroke'
  );

  // 2. Check isFirstStrokeMode getter
  assert.match(
    tsContent,
    /get\s+isFirstStrokeMode\s*\(\s*\)/,
    'PrivateRoomManagerComponent must provide isFirstStrokeMode getter'
  );

  // 3. Check createRoom passes botStartMode for solo
  assert.match(
    tsContent,
    /botStartMode\s*:\s*(isBotDuel|isSolo)/,
    'createPrivateRace options must pass botStartMode for solo mode'
  );

  const htmlPath = path.join(rootDir, 'src/app/components/private-room-manager/private-room-manager.component.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  // 4. Creation form must NOT configure start mode for solo (deferred to room)
  assert.doesNotMatch(htmlContent, /Mode de départ pour l'entraînement Solo/, "Creation form for solo must not present start mode choice");
  // 5. Check banner and quick actions support solo for first stroke
  assert.match(
    htmlContent,
    /@if\s*\(\s*isBotDuelRoom\s*\|\|\s*isSoloRoom\s*\)/,
    'Action controls must include isSoloRoom alongside isBotDuelRoom'
  );
});
