import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAppHtmlBundle } from './test-app-bundle.helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Footer has exactly one link/button opening the Legal Terms & CGU modal', () => {
  const html = readAppHtmlBundle();

  // Find the app-footer block
  const footerMatch = html.match(/<footer class="app-footer"[\s\S]*?<\/footer>/);
  assert.ok(footerMatch, 'HTML must contain <footer class="app-footer">');
  const footerHtml = footerMatch[0];

  // Count buttons opening the legal modal (isLegalTermsOpen = true or openLegalTermsRequest.emit())
  const legalButtons = footerHtml.match(/isLegalTermsOpen\s*=\s*true|openLegalTermsRequest\.emit\(\)/g) || [];
  assert.equal(
    legalButtons.length,
    1,
    `Footer must contain exactly 1 button opening the legal terms modal, found ${legalButtons.length}`
  );

  // Ensure there are no duplicate CGU / Conditions Générales d'Utilisation labels in the footer
  const cguLabels = footerHtml.match(/Conditions Générales d'Utilisation|MODAL_LEGAL_TITLE/g) || [];
  assert.equal(
    cguLabels.length,
    1,
    `Footer must have only one reference to CGU / MODAL_LEGAL_TITLE, found ${cguLabels.length}`
  );
});

test('Legal Terms modal contains updated platform evolutions (Flutter, Garmin off-line, Organizer powers, Solo first-stroke, Anti-cheat, RGPD)', () => {
  const html = readAppHtmlBundle();

  // Find the legal terms modal block
  const modalMatch = html.match(/@if\s*\(\s*isLegalTermsOpen\s*\)[\s\S]*?<\/div>\s*<\/div>\s*}/);
  assert.ok(modalMatch, 'HTML must contain @if (isLegalTermsOpen) modal block');
  const modalHtml = modalMatch[0];

  // 1. Multi-platform ecosystem: Web, Flutter mobile, Garmin Connect IQ
  assert.match(modalHtml, /Flutter/i, 'Must mention Flutter mobile application');
  assert.match(modalHtml, /Garmin Connect IQ/i, 'Must mention Garmin Connect IQ');
  assert.match(modalHtml, /Ramer off-line|off-line|hors-ligne/i, 'Must mention Garmin offline solo mode');

  // 2. Organizer powers in private rooms
  assert.match(modalHtml, /organisateur/i, 'Must mention the room organizer role');
  assert.match(modalHtml, /arr[eê]t/i, 'Must mention race stop by organizer');
  assert.match(modalHtml, /classement officiel/i, 'Must mention official ranking freeze on stop');

  // 3. Solo mode & Bot Duel rules
  assert.match(modalHtml, /premier coup de rame/i, 'Must mention first stroke start for solo mode');
  assert.match(modalHtml, /duel/i, 'Must mention 1v1 bot duel');

  // 4. Anti-cheat & Fair-play
  assert.match(modalHtml, /anti-triche|coh[eé]rence/i, 'Must mention telemetry consistency / anti-cheat');
  assert.match(modalHtml, /faux d[eé]part/i, 'Must mention false start detection');

  // 5. Kayak customization
  assert.match(modalHtml, /personnalisation/i, 'Must mention kayak customization');

  // 6. RGPD & Data rights
  assert.match(modalHtml, /RGPD|Règlement Général sur la Protection des Données/i, 'Must mention GDPR / RGPD');
  assert.match(modalHtml, /Art\.?\s*17|droit [aà] l['’]effacement|droit [aà] l['’]oubli/i, 'Must mention right to erasure (Art. 17)');
  assert.match(modalHtml, /contact@rowerrace\.com/i, 'Must mention official contact email');
});
