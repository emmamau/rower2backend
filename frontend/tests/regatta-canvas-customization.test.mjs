import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('RegattaCanvasComponent: kayak customization rendering logic', () => {
  const filePath = path.join(rootDir, 'src/app/components/regatta-canvas/regatta-canvas.component.ts');
  const content = fs.readFileSync(filePath, 'utf-8');

  // 1. BoatRenderState and imports
  assert.match(content, /import\s*\{[^}]*KayakCustomization[^}]*\}\s*from\s*['"]\.\.\/\.\.\/models\/user\.model['"];/, 'Must import KayakCustomization');
  assert.match(content, /interface BoatRenderState\s*\{[^}]*kayak\?: KayakCustomization;[^}]*\}/s, 'BoatRenderState must have kayak?: KayakCustomization');

  // 2. Component Input
  assert.match(content, /@Input\(\)\s*myKayakCustomization\?: KayakCustomization;/, 'Must have @Input() myKayakCustomization');

  // 3. syncRacersData priority
  assert.match(content, /r\.userId === this\.activeUserId && this\.myKayakCustomization/, 'Must prioritize myKayakCustomization for active user');

  // 4. drawCanvasScene customization resolution
  assert.match(content, /boat\.kayak \|\| \(isUser \? this\.myKayakCustomization : undefined\)/, 'Must resolve custom from boat or myKayakCustomization');
  assert.match(content, /sanitizeKayakCustomization/, 'Must sanitize kayak customization');
  assert.match(content, /const effectiveHullColor = custom\?\.hullColor \|\| \(isUser \? '#00e5ff' : boat\.color\);/, 'Must resolve effectiveHullColor');
  assert.match(content, /const effectiveBladeColor = custom\?\.bladeColor \|\| \(isUser \? '#00f0ff' : boat\.color\);/, 'Must resolve effectiveBladeColor');
  assert.match(content, /const effectiveGlowColor = custom\?\.glowColor \|\| \(isUser \? '#00f0ff' : '#ffe600'\);/, 'Must resolve effectiveGlowColor');
  assert.match(content, /const effectivePattern = custom\?\.pattern \|\| \(isUser \? 'racing-stripe' : 'solid'\);/, 'Must resolve effectivePattern');
  assert.match(content, /hexToRgba\(effectiveGlowColor/, 'Must tint boat wake with effectiveGlowColor');

  // 5. Glow / Halo
  assert.match(content, /if\s*\(isUser \|\| isFocused \|\| custom\)\s*\{[^}]*ctx\.shadowColor = effectiveGlowColor;/s, 'Must apply dynamic halo with effectiveGlowColor');

  // 6. Blades
  assert.match(content, /ctx\.fillStyle = effectiveBladeColor;/, 'Oar blades must be filled with effectiveBladeColor');

  // 7. Patterns
  assert.match(content, /effectivePattern === 'gradient'/, 'Must support gradient pattern');
  assert.match(content, /ctx\.createLinearGradient\(x - hullRx, y, x \+ hullRx, y\)/, 'Must create horizontal linear gradient');
  assert.match(content, /effectivePattern === 'dual-tone'/, 'Must support dual-tone pattern');
  assert.match(content, /effectivePattern === 'racing-stripe'/, 'Must support racing-stripe pattern');
  assert.match(content, /ctx\.strokeStyle = 'rgba\(255, 255, 255, 0\.85\)';/, 'Must draw contrasting white stripes');
});
