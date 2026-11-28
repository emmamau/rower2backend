import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf-8');

async function loadCamera() {
  const source = read('src/app/components/regatta-canvas/race-camera.ts');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}

test('Caméra suiveuse : échelle 16 px/m et kayak suivi à 25 % de l\'écran', async () => {
  const cam = await loadCamera();
  assert.equal(cam.PIXELS_PER_METER, 16);
  // Kayak à 500 m, canevas 800 px : 500*16 - 800*0.25 = 7800
  assert.equal(cam.computeFollowCameraTarget(500, 2000, 800), 7800);
  assert.equal(cam.boatScreenX(500, 7800), 200); // 25 % de 800
});

test('Caméra suiveuse : bornée au départ (>= 0) et à l\'arrivée (<= raceDistance*16 - 85 % largeur)', async () => {
  const cam = await loadCamera();
  assert.equal(cam.computeFollowCameraTarget(0, 2000, 800), 0);
  assert.equal(cam.computeFollowCameraTarget(5, 2000, 800), 0);
  const maxCam = 2000 * 16 - 800 * 0.85;
  assert.equal(cam.computeFollowCameraTarget(2000, 2000, 800), maxCam);
  assert.equal(cam.computeFollowCameraTarget(1999, 2000, 800), maxCam);
  // Course très courte par rapport à l'écran : jamais négatif
  assert.equal(cam.computeFollowCameraTarget(10, 20, 4000), 0);
});

test('Caméra suiveuse : lissage exponentiel sans dépassement de la cible', async () => {
  const cam = await loadCamera();
  const one = cam.smoothCameraX(0, 100, 0.016);
  assert.ok(one > 0 && one < 100);
  assert.equal(cam.smoothCameraX(0, 100, 0), 0);
  assert.ok(Math.abs(cam.smoothCameraX(0, 100, 10) - 100) < 0.01);
});

test('Repères : bouées tous les 25 m (rouges 100 premiers / 250 derniers mètres) et culling', async () => {
  const cam = await loadCamera();
  assert.equal(cam.buoyColorAt(50, 2000), 'red');
  assert.equal(cam.buoyColorAt(1800, 2000), 'red');
  assert.notEqual(cam.buoyColorAt(1000, 2000), 'red');
  assert.deepEqual(cam.multiplesInRange(25, 100, 175, 2000), [100, 125, 150, 175]);
  assert.deepEqual(cam.multiplesInRange(500, -50, 4000, 2000), [0, 500, 1000, 1500, 2000]);
});

test('Badges hors-champ : côté, écart relatif et limite par côté', async () => {
  const cam = await loadCamera();
  const boats = [
    { userId: 'me', name: 'Moi', dist: 500 },
    { userId: 'alex', name: 'Alex', dist: 472 },
    { userId: 'lea', name: 'Léa', dist: 519 },
    { userId: 'near', name: 'Near', dist: 505 },
  ];
  // Caméra : moi à 25 % sur 800 px → 28 m = 448 px hors champ à gauche ; 19 m = 304 px, mais à droite 200 + 304 = 504 < 800 (visible)
  const cameraX = 7800;
  const res = cam.computeOffscreenBadges(boats, 'me', 500, cameraX, 800, 3);
  assert.deepEqual(res.left.map((b) => b.userId), ['alex']);
  assert.equal(res.left[0].label, '◀ Alex (-28 m)');
  assert.equal(res.right.length, 0);
  const far = cam.computeOffscreenBadges([...boats, { userId: 'far', name: 'Far', dist: 600 }], 'me', 500, cameraX, 800, 3);
  assert.equal(far.right[0].label, 'Far (+100 m) ▶');
  const many = Array.from({ length: 6 }, (_, i) => ({ userId: `r${i}`, name: `R${i}`, dist: 700 + i * 10 }));
  const capped = cam.computeOffscreenBadges([{ userId: 'me', name: 'Moi', dist: 500 }, ...many], 'me', 500, cameraX, 800, 3);
  assert.equal(capped.right.length, 3);
  assert.equal(capped.hiddenRight, 3);
});

test('Canevas : double moteur de rendu, global_fit conservé et interactions follow_camera', () => {
  const canvas = read('src/app/components/regatta-canvas/regatta-canvas.component.ts');
  assert.match(canvas, /isFollowMode/);
  assert.match(canvas, /followedBoatId\s*=\s*signal/);
  assert.match(canvas, /onFollowSelect/);
  assert.match(canvas, /Recentrer sur mon kayak/);
  assert.match(canvas, /showRecenterButton/);
  assert.match(canvas, /app-race-minimap/);
  assert.match(canvas, /offscreenHits/);
  assert.match(canvas, /updateFollowCamera/);
  assert.match(canvas, /drawFollowWake/);
  // Projection globale classique conservée (0 m à gauche, raceDistance à droite)
  assert.match(canvas, /Math\.max\(120, w - marginX - rightPad\)/);
  assert.match(canvas, /marginX \+ trackW \* progress/);
  // Anti-régression de monotonie
  assert.match(canvas, /Math\.max\(\s*boat\.targetPacketDist/i);
});

test('Back-office : sélecteur de mode avec les deux cartes et enregistrement immédiat', () => {
  const html = read('src/app/components/admin-dashboard/admin-dashboard.component.html');
  const ts_ = read('src/app/components/admin-dashboard/admin-dashboard.component.ts');
  assert.match(html, /Mode de rendu du bassin \(Canevas de course\)/);
  assert.match(html, /selectCanvasMode\('follow_camera'\)/);
  assert.match(html, /selectCanvasMode\('global_fit'\)/);
  assert.match(html, /Recommandé/);
  assert.match(ts_, /updatePublicRaceSettings\(\{ raceCanvasMode: mode \}\)/);
  assert.match(ts_, /canvasModeService\.set\(/);
});

test('Service de mode : chargement public + mise à jour WebSocket settings:updated', () => {
  const svc = read('src/app/services/race-canvas-mode.service.ts');
  assert.match(svc, /\/api\/race\/canvas-mode/);
  assert.match(svc, /onSettingsUpdated\(\)/);
  assert.match(svc, /DEFAULT_RACE_CANVAS_MODE: RaceCanvasMode = 'follow_camera'/);
});

test('Classements en direct : ligne du kayak suivi surlignée et cliquable', () => {
  for (const rel of [
    'src/app/components/cockpit-view/cockpit-view.component.html',
    'src/app/components/regatta-view/regatta-view.component.html',
  ]) {
    const html = read(rel);
    assert.match(html, /followed-racer/);
    assert.match(html, /spectatorSelect\.emit\(racer\.userId\)/);
  }
});

