import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Task 4: RowerService has updateKayakCustomization method', () => {
  const serviceFile = path.join(rootDir, 'src/app/services/rower.service.ts');
  const content = fs.readFileSync(serviceFile, 'utf8');

  assert.match(
    content,
    /updateKayakCustomization\s*\(\s*userId:\s*string,\s*kayakCustomization:\s*KayakCustomization\s*\)/,
    'RowerService must declare updateKayakCustomization(userId, kayakCustomization)'
  );
  assert.match(
    content,
    /\/api\/user\/kayak/,
    'RowerService must call /api/user/kayak endpoint'
  );
});

test('Task 4: app.ts defines kayak customization state and controller methods', () => {
  const appTsFile = path.join(rootDir, 'src/app/app.ts');
  const content = fs.readFileSync(appTsFile, 'utf8');

  // Account modal tab extension
  assert.match(
    content,
    /accountModalTab:\s*['"]login['"]\s*\|\s*['"]register['"]\s*\|\s*['"]profile['"]\s*\|\s*['"]forgot['"]\s*\|\s*['"]kayak-customizer['"]/,
    'accountModalTab must include kayak-customizer'
  );

  // State properties
  assert.match(content, /customKayakHullColor\s*=\s*['"]#[0-9a-fA-F]{6}['"]/, 'customKayakHullColor defined');
  assert.match(content, /customKayakBladeColor\s*=\s*['"]#[0-9a-fA-F]{6}['"]/, 'customKayakBladeColor defined');
  assert.match(content, /customKayakPattern:\s*KayakPattern/, 'customKayakPattern defined');
  assert.match(content, /customKayakGlowColor\s*=\s*['"]#[0-9a-fA-F]{6}['"]/, 'customKayakGlowColor defined');
  assert.match(content, /isSavingKayak\s*=\s*false/, 'isSavingKayak defined');
  assert.match(content, /isPostRegisterOnboarding\s*=\s*false/, 'isPostRegisterOnboarding defined');
  assert.match(content, /presetColors\s*=/, 'presetColors defined');
  assert.match(content, /patternOptions:\s*\{/, 'patternOptions defined');

  // Controller methods
  assert.match(content, /currentKayakCustomization\s*\(\s*\):\s*KayakCustomization/, 'currentKayakCustomization getter defined');
  assert.match(content, /getLocalKayakCustomization\s*\(\s*\)/, 'getLocalKayakCustomization defined');
  assert.match(content, /syncKayakCustomizationFromUser\s*\(/, 'syncKayakCustomizationFromUser defined');
  assert.match(content, /openKayakCustomizer\s*\(\s*\)/, 'openKayakCustomizer defined');
  assert.match(content, /saveKayakCustomization\s*\(\s*\)/, 'saveKayakCustomization defined');
  assert.match(content, /skipKayakCustomization\s*\(\s*\)/, 'skipKayakCustomization defined');
  assert.match(content, /drawKayakCustomizerPreview\s*\(\s*\)/, 'drawKayakCustomizerPreview defined');

  // Registration onboarding flow
  assert.match(content, /isPostRegisterOnboarding\s*=\s*true/, 'submitAccountRegister sets isPostRegisterOnboarding = true');
  assert.match(content, /accountModalTab\s*=\s*['"]kayak-customizer['"]/, 'submitAccountRegister transitions to kayak-customizer');
});

test('Task 4: app.html includes kayak customizer tab, onboarding banner, preview canvas, and profile card', () => {
  const appHtmlFile = path.join(rootDir, 'src/app/app.html');
  const content = fs.readFileSync(appHtmlFile, 'utf8');

  // Tab button
  assert.match(content, /openKayakCustomizer\(\)/, 'Tab button opens kayak customizer');
  assert.match(content, /🛶 Mon Kayak/, 'Mon Kayak tab title present');

  // Customizer section
  assert.match(content, /@if\s*\(\s*accountModalTab\s*===\s*['"]kayak-customizer['"]\s*\)/, 'kayak-customizer tab content present');
  assert.match(content, /customizer-onboarding-banner/, 'Onboarding banner present');
  assert.match(content, /#kayakPreviewCanvas/, 'Preview canvas reference present');
  assert.match(content, /pattern-tiles-grid/, 'Pattern tiles grid present');
  assert.match(content, /kayak-hull-color-picker/, 'Hull color picker present');
  assert.match(content, /kayak-blade-color-picker/, 'Blade color picker present');
  assert.match(content, /kayak-glow-color-picker/, 'Glow color picker present');
  assert.match(content, /saveKayakCustomization\(\)/, 'Save kayak button present');
  assert.match(content, /skipKayakCustomization\(\)/, 'Skip kayak button present');

  // Profile integration
  assert.match(content, /profile-kayak-card/, 'Profile kayak card present');
  assert.match(content, /mini-kayak-svg/, 'Mini kayak SVG preview present');
  assert.match(content, /btn-custom-kayak/, 'Personaliser mon kayak button present in profile');

  // Binding to regatta canvas
  assert.match(content, /\[myKayakCustomization\]="currentKayakCustomization"/, 'Canvas bound to currentKayakCustomization');
});

test('Task 4: app.css provides styling for kayak customizer and profile integration', () => {
  const appCssFile = path.join(rootDir, 'src/app/app.css');
  const content = fs.readFileSync(appCssFile, 'utf8');

  assert.match(content, /\.kayak-customizer-form/, 'Customizer form CSS present');
  assert.match(content, /\.customizer-onboarding-banner/, 'Onboarding banner CSS present');
  assert.match(content, /\.kayak-preview-card/, 'Preview card CSS present');
  assert.match(content, /\.pattern-tile/, 'Pattern tile CSS present');
  assert.match(content, /\.color-swatch-btn/, 'Color swatch button CSS present');
  assert.match(content, /\.profile-kayak-card/, 'Profile kayak card CSS present');
  assert.match(content, /\.mini-kayak-svg/, 'Mini kayak SVG CSS present');
});
