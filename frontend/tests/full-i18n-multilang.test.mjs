import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('i18n locale modules exist and provide 100% key parity across all 6 supported languages', async () => {
  const i18nRoot = path.resolve(__dirname, '../src/app/i18n');
  const i18nDir = path.join(i18nRoot, 'locales');
  const indexPath = path.join(i18nRoot, 'index.ts');
  const languages = ['fr', 'en', 'de', 'es', 'it', 'pt'];

  assert.ok(fs.existsSync(indexPath), `Index file must exist: ${indexPath}`);
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  assert.ok(indexContent.includes('SupportedLang'), 'index.ts must export SupportedLang');
  assert.ok(indexContent.includes('TRANSLATIONS'), 'index.ts must export TRANSLATIONS');

  const localeMaps = {};
  for (const lang of languages) {
    const filePath = path.join(i18nDir, `${lang}.ts`);
    assert.ok(fs.existsSync(filePath), `Locale file must exist: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf8');
    const matches = [...content.matchAll(/['"]([A-Z0-9_]+)['"]\s*:/g)].map(m => m[1]);
    localeMaps[lang] = new Set(matches);

    const emptyMatches = [...content.matchAll(/['"]([A-Z0-9_]+)['"]\s*:\s*['"]\s*['"]/g)].map(m => m[1]);
    assert.equal(emptyMatches.length, 0, `Locale "${lang}" has empty translation values: ${emptyMatches.join(', ')}`);
  }

  const frKeys = Array.from(localeMaps['fr']);
  assert.ok(frKeys.length >= 150, `French dictionary should contain at least 150 translation keys (found ${frKeys.length})`);

  // Check required core sections
  const requiredCategories = [
    'SUB_TITLE', 'SUB_FREE_TITLE', 'SUB_CLUB_TITLE', 'SUB_PRO_TITLE',
    'ADMIN_TITLE', 'ADMIN_TAB_PUBLIC', 'ADMIN_TAB_USERS', 'ADMIN_TAB_PLANS',
    'FINISH_ARRIVED', 'CANVAS_WAITING', 'CANVAS_LANE',
    'ERR_INVALID_CREDENTIALS', 'ERR_ROOM_NOT_FOUND', 'ERR_PASSWORDS_DONT_MATCH',
    'TIME_DAYS_SHORT', 'TIME_HOURS_SHORT', 'TIME_MINUTES_SHORT', 'TIME_SECONDS_SHORT'
  ];

  for (const reqKey of requiredCategories) {
    assert.ok(localeMaps['fr'].has(reqKey), `FR dictionary must include ${reqKey}`);
  }

  for (const lang of languages) {
    if (lang === 'fr') continue;
    for (const key of frKeys) {
      assert.ok(
        localeMaps[lang].has(key),
        `Missing key "${key}" in language "${lang}" compared to "fr"`
      );
    }
    for (const key of localeMaps[lang]) {
      assert.ok(
        localeMaps['fr'].has(key),
        `Extra key "${key}" in language "${lang}" not present in "fr"`
      );
    }
  }
});
