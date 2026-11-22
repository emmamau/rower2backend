import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ts = require(path.resolve(__dirname, '../node_modules/typescript'));

function loadI18nServiceRuntime({ savedLang = null, browserLang = 'fr-FR' } = {}) {
  const servicePath = path.resolve(__dirname, '../src/app/services/i18n.service.ts');
  const appDir = path.resolve(__dirname, '../src/app');
  const storage = new Map();
  if (savedLang) {
    storage.set('rower_app_lang', savedLang);
  }

  const localStorageMock = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v))
  };

  const moduleCache = new Map();

  function compileAndLoad(tsFilePath) {
    const resolved = path.resolve(tsFilePath);
    if (moduleCache.has(resolved)) {
      return moduleCache.get(resolved).exports;
    }

    const source = fs.readFileSync(resolved, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
        esModuleInterop: true
      }
    }).outputText;

    const mod = { exports: {} };
    moduleCache.set(resolved, mod);

    const localRequire = (specifier) => {
      if (specifier === '@angular/core') {
        return {
          Injectable: () => (target) => target,
          signal: (initial) => {
            let value = initial;
            const fn = () => value;
            fn.set = (next) => {
              value = next;
            };
            return fn;
          }
        };
      }
      if (specifier.startsWith('.')) {
        const base = path.resolve(path.dirname(resolved), specifier);
        if (fs.existsSync(`${base}.ts`)) {
          return compileAndLoad(`${base}.ts`);
        }
        if (fs.existsSync(path.join(base, 'index.ts'))) {
          return compileAndLoad(path.join(base, 'index.ts'));
        }
      }
      throw new Error(`Unexpected import "${specifier}" from ${resolved}`);
    };

    const fn = new vm.Script(
      `(function(exports, require, module, __filename, __dirname, localStorage, navigator) {\n${transpiled}\n})`,
      { filename: resolved }
    ).runInThisContext();

    fn(
      mod.exports,
      localRequire,
      mod,
      resolved,
      path.dirname(resolved),
      localStorageMock,
      { language: browserLang }
    );

    return mod.exports;
  }

  const { I18nService } = compileAndLoad(servicePath);
  assert.ok(typeof I18nService === 'function', 'I18nService class must be exported');
  const service = new I18nService();
  return { service, storage, appDir };
}

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


test('I18nService imports modular locales from ../i18n and persists setLang', () => {
  const servicePath = path.resolve(__dirname, '../src/app/services/i18n.service.ts');
  const content = fs.readFileSync(servicePath, 'utf8');

  assert.ok(content.includes('../i18n'), 'I18nService must import modular locales from ../i18n');
  assert.ok(content.includes('formatDetailedCountdown'), 'Must define formatDetailedCountdown');
  assert.ok(content.includes('formatRankOrdinal'), 'Must define formatRankOrdinal');
  assert.ok(content.includes('translateError'), 'Must define translateError');

  const { service, storage } = loadI18nServiceRuntime({ savedLang: null, browserLang: 'de-DE' });
  assert.equal(service.getCurrentLang(), 'de');
  assert.equal(service.languages.length, 6);

  service.setLang('es');
  assert.equal(service.getCurrentLang(), 'es');
  assert.equal(storage.get('rower_app_lang'), 'es');
});

test('I18nService.t supports {{param}} interpolation and fallback chain currentLang -> en -> fr -> key', () => {
  const { service } = loadI18nServiceRuntime({ savedLang: 'fr' });

  assert.equal(
    service.t('ADMIN_PAGINATION_INFO', { page: 2, totalPages: 5, total: 42 }),
    'Page 2 sur 5 (42 utilisateurs)'
  );

  service.setLang('en');
  assert.equal(
    service.t('ADMIN_PAGINATION_INFO', { page: 2, totalPages: 5, total: 42 }),
    'Page 2 of 5 (42 users)'
  );

  assert.equal(
    service.t('ADMIN_ROLE_CONFIRM_MSG', { user: 'Alice', role: 'ADMIN' }),
    'Are you sure you want to change the role of Alice to ADMIN?'
  );

  // Unknown key falls back to the key itself
  assert.equal(service.t('NON_EXISTENT_I18N_KEY'), 'NON_EXISTENT_I18N_KEY');
});

test('I18nService.formatDetailedCountdown localizes units across languages and ranges', () => {
  const { service } = loadI18nServiceRuntime({ savedLang: 'fr' });

  assert.equal(service.formatDetailedCountdown(2 * 86400 + 5 * 3600 + 120), '2j 5h');
  assert.equal(service.formatDetailedCountdown(3 * 3600 + 15 * 60 + 20), '3h 15m');
  assert.equal(service.formatDetailedCountdown(4 * 60 + 9), '4m 9s');
  assert.equal(service.formatDetailedCountdown(42), '42s');
  assert.equal(service.formatDetailedCountdown(-5), '0s');

  service.setLang('en');
  assert.equal(service.formatDetailedCountdown(2 * 86400 + 5 * 3600), '2d 5h');
  assert.equal(service.formatDetailedCountdown(3665), '1h 1m');

  service.setLang('es');
  assert.equal(service.formatDetailedCountdown(86400 + 3600), '1d 1h');

  service.setLang('pt');
  assert.equal(service.formatDetailedCountdown(86400 + 3600), '1d 1h');

  service.setLang('it');
  assert.equal(service.formatDetailedCountdown(86400 + 3600), '1g 1h');

  service.setLang('de');
  assert.equal(service.formatDetailedCountdown(86400 + 3600), '1T 1Std');
  assert.equal(service.formatDetailedCountdown(3660), '1Std 1m');
});

test('I18nService.formatRankOrdinal formats ordinals accurately per language', () => {
  const { service } = loadI18nServiceRuntime({ savedLang: 'fr' });
  assert.equal(service.formatRankOrdinal(1), '1er');
  assert.equal(service.formatRankOrdinal(2), '2e');
  assert.equal(service.formatRankOrdinal(3), '3e');
  assert.equal(service.formatRankOrdinal(4), '4e');

  service.setLang('en');
  assert.equal(service.formatRankOrdinal(1), '1st');
  assert.equal(service.formatRankOrdinal(2), '2nd');
  assert.equal(service.formatRankOrdinal(3), '3rd');
  assert.equal(service.formatRankOrdinal(4), '4th');
  assert.equal(service.formatRankOrdinal(11), '11th');
  assert.equal(service.formatRankOrdinal(12), '12th');
  assert.equal(service.formatRankOrdinal(13), '13th');
  assert.equal(service.formatRankOrdinal(21), '21st');

  service.setLang('es');
  assert.equal(service.formatRankOrdinal(1), '1º');
  assert.equal(service.formatRankOrdinal(2), '2º');
  assert.equal(service.formatRankOrdinal(3), '3º');

  service.setLang('pt');
  assert.equal(service.formatRankOrdinal(1), '1º');
  assert.equal(service.formatRankOrdinal(2), '2º');

  service.setLang('it');
  assert.equal(service.formatRankOrdinal(1), '1°');
  assert.equal(service.formatRankOrdinal(2), '2°');

  service.setLang('de');
  assert.equal(service.formatRankOrdinal(1), '1.');
  assert.equal(service.formatRankOrdinal(2), '2.');
  assert.equal(service.formatRankOrdinal(3), '3.');
});

test('I18nService.translateError maps error codes and server messages with safe fallback', () => {
  const { service } = loadI18nServiceRuntime({ savedLang: 'en' });

  // Direct error codes
  assert.equal(service.translateError('ERR_INVALID_CREDENTIALS'), service.t('ERR_INVALID_CREDENTIALS'));
  assert.equal(service.translateError({ error: { code: 'ERR_PASSWORDS_DONT_MATCH' } }), service.t('ERR_PASSWORDS_DONT_MATCH'));

  // Known server messages
  assert.equal(service.translateError({ error: { message: 'Mot de passe incorrect' } }), service.t('ERR_INVALID_CREDENTIALS'));
  assert.equal(service.translateError({ message: 'Salon introuvable' }), service.t('ERR_ROOM_NOT_FOUND'));
  assert.equal(service.translateError('Identifiants invalides'), service.t('ERR_INVALID_CREDENTIALS'));
  const emailUsedEn = service.translateError('Email déjà utilisé');
  assert.notEqual(emailUsedEn, 'Email déjà utilisé', 'Email déjà utilisé must be translated in English');
  assert.match(emailUsedEn.toLowerCase(), /email|already/);

  // Language switching updates translated error
  service.setLang('de');
  assert.equal(service.translateError('ERR_ROOM_FULL'), service.t('ERR_ROOM_FULL'));
  assert.equal(service.translateError({ error: { message: 'Salon introuvable' } }), service.t('ERR_ROOM_NOT_FOUND'));

  // Unknown errors fall back cleanly
  assert.equal(service.translateError({ error: { message: 'Custom backend failure' } }), 'Custom backend failure');
  assert.equal(service.translateError({ message: 'Network timeout 504' }), 'Network timeout 504');
  assert.equal(service.translateError('Raw error text'), 'Raw error text');
  assert.equal(service.translateError(null), service.t('ERR_GENERIC'));
});
