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

test('SubscriptionModalComponent injects I18nService and translates all UI labels across all 6 languages', () => {
  const modalTsPath = path.resolve(__dirname, '../src/app/components/modals/subscription-modal/subscription-modal.component.ts');
  const modalHtmlPath = path.resolve(__dirname, '../src/app/components/modals/subscription-modal/subscription-modal.component.html');
  const modalTs = fs.readFileSync(modalTsPath, 'utf8');
  const modalHtml = fs.readFileSync(modalHtmlPath, 'utf8');

  assert.match(modalTs, /import\s+\{\s*I18nService\s*\}\s+from\s+['"]\.\.\/\.\.\/\.\.\/services\/i18n\.service['"]/);
  assert.match(modalTs, /constructor\s*\(\s*public\s+i18n:\s*I18nService\s*\)/);

  const expectedKeys = [
    'SUB_TITLE', 'SUB_SECURE_BADGE', 'SUB_DESC',
    'SUB_FREE_TITLE', 'SUB_FREE_PERIOD',
    'SUB_FREE_FEAT_1', 'SUB_FREE_FEAT_2', 'SUB_FREE_FEAT_3', 'SUB_FREE_FEAT_4', 'SUB_FREE_FEAT_5', 'SUB_FREE_FEAT_6',
    'PLAN_CURRENT', 'PLAN_SELECT', 'PLAN_RECOMMENDED', 'PLAN_DISABLED',
    'SUB_CLUB_TITLE', 'SUB_PER_MONTH',
    'SUB_CLUB_FEAT_1', 'SUB_CLUB_FEAT_2', 'SUB_CLUB_FEAT_3', 'SUB_CLUB_FEAT_4', 'SUB_CLUB_FEAT_5', 'SUB_CLUB_FEAT_6', 'SUB_CLUB_FEAT_7',
    'SUB_PRO_TITLE',
    'SUB_PRO_FEAT_1', 'SUB_PRO_FEAT_2', 'SUB_PRO_FEAT_3', 'SUB_PRO_FEAT_4', 'SUB_PRO_FEAT_5', 'SUB_PRO_FEAT_6', 'SUB_PRO_FEAT_7',
    'SUB_STRIPE_DISABLED_TIP', 'SUB_CURRENT_PLAN_TIP', 'SUB_SUBSCRIBE_CLUB_TIP', 'SUB_SUBSCRIBE_PRO_TIP',
    'SUB_CHOOSE_CLUB', 'SUB_CHOOSE_PRO'
  ];

  const { service } = loadI18nServiceRuntime({ savedLang: 'fr' });
  for (const key of expectedKeys) {
    assert.ok(modalHtml.includes(`i18n.t('${key}')`), `SubscriptionModal HTML must reference i18n.t('${key}')`);
    for (const lang of ['fr', 'en', 'de', 'es', 'it', 'pt']) {
      service.setLang(lang);
      const val = service.t(key);
      assert.notEqual(val, key, `Key ${key} must resolve to a translated string in ${lang}`);
      assert.ok(val.trim().length > 0, `Key ${key} must be non-empty in ${lang}`);
    }
  }
});

test('AdminDashboardComponent uses I18nService for headers, tabs, forms, modals, and action buttons', () => {
  const adminHtmlPath = path.resolve(__dirname, '../src/app/components/admin-dashboard/admin-dashboard.component.html');
  const adminTsPath = path.resolve(__dirname, '../src/app/components/admin-dashboard/admin-dashboard.component.ts');
  const html = fs.readFileSync(adminHtmlPath, 'utf8');
  const ts = fs.readFileSync(adminTsPath, 'utf8');

  assert.match(ts, /import\s+\{\s*I18nService\s*\}\s+from\s+['"]\.\.\/\.\.\/services\/i18n\.service['"]/);
  assert.ok(ts.includes('public i18n: I18nService'), 'AdminDashboardComponent must inject public i18n: I18nService');
  assert.ok(ts.includes('this.i18n.t('), 'AdminDashboardComponent TS must use this.i18n.t()');
  assert.ok(ts.includes('this.i18n.translateError('), 'AdminDashboardComponent TS must use this.i18n.translateError()');

  assert.ok(html.includes('i18n.t('), 'AdminDashboard HTML template must use i18n.t()');
  assert.ok(html.includes("i18n.t('ADMIN_TITLE')"), 'AdminDashboard must translate title');

  const expectedHtmlKeys = [
    'ADMIN_TITLE', 'ADMIN_BADGE', 'BTN_CLOSE',
    'ADMIN_TAB_PUBLIC', 'ADMIN_TAB_USERS', 'ADMIN_TAB_PLANS',
    'ADMIN_PUBLIC_TOGGLE_TITLE', 'ADMIN_PUBLIC_ENGINE_STATE',
    'ADMIN_PUBLIC_ACTIVE', 'ADMIN_PUBLIC_SUSPENDED',
    'ADMIN_PUBLIC_BTN_SUSPEND', 'ADMIN_PUBLIC_BTN_ACTIVATE',
    'ADMIN_PUBLIC_SETTINGS_TITLE', 'ADMIN_PUBLIC_DIST_LABEL',
    'ADMIN_PUBLIC_DURATION_LABEL', 'ADMIN_PUBLIC_MAX_PLAYERS_LABEL',
    'ADMIN_PUBLIC_BOT_COUNT_LABEL', 'ADMIN_PUBLIC_DELAY_LABEL',
    'ADMIN_PUBLIC_SAVING', 'ADMIN_PUBLIC_SAVE_BTN',
    'ADMIN_USERS_SEARCH_PLACEHOLDER', 'ADMIN_USERS_ALL_ROLES',
    'ADMIN_USERS_ALL_TIERS', 'ADMIN_USERS_TIER_FREE',
    'ADMIN_USERS_TIER_CLUB', 'ADMIN_USERS_TIER_PRO',
    'ADMIN_USERS_ALL_STATUSES', 'ADMIN_USERS_STATUS_ACTIVE',
    'ADMIN_USERS_STATUS_REVOKED', 'ADMIN_USERS_BTN_FILTER',
    'ADMIN_COL_ACCOUNT', 'ADMIN_COL_EMAIL', 'ADMIN_COL_ROLE',
    'ADMIN_COL_PLAN', 'ADMIN_COL_QUOTAS', 'ADMIN_COL_LEAGUE',
    'ADMIN_COL_STATUS', 'ADMIN_COL_ACTIONS',
    'ADMIN_USERS_ROLE_TIP', 'ADMIN_USERS_PLAN_TIP',
    'ADMIN_USERS_QUOTA_TIP', 'ADMIN_USERS_QUOTA_EDIT_TIP',
    'ADMIN_USERS_BTN_RESTORE', 'ADMIN_USERS_BTN_REVOKE',
    'ADMIN_USERS_BTN_PWD', 'ADMIN_USERS_BTN_ROOMS', 'ADMIN_USERS_ROOMS_TIP',
    'ADMIN_USERS_LOADING', 'ADMIN_USERS_EMPTY',
    'ADMIN_PAGINATION_PREV', 'ADMIN_PAGINATION_NEXT', 'ADMIN_PAGINATION_INFO',
    'ADMIN_QUOTA_MAX_SUFFIX', 'ADMIN_QUOTA_WEEK_SUFFIX',
    'ADMIN_PLANS_TITLE', 'ADMIN_PLANS_BTN_NEW', 'ADMIN_PLANS_NO_DESC',
    'ADMIN_PLANS_FREE_PRICE', 'ADMIN_PLANS_MAX_BOTS', 'ADMIN_PLANS_MAX_DIST',
    'ADMIN_PLANS_MAX_PLAYERS', 'ADMIN_PLANS_MAX_CONCURRENT', 'ADMIN_PLANS_MAX_WEEKLY',
    'ADMIN_PLANS_DUEL_1V1', 'ADMIN_PLANS_SCHEDULE', 'ADMIN_PLANS_STATUS',
    'ADMIN_PLANS_ENABLED', 'ADMIN_PLANS_DISABLED',
    'ADMIN_PLANS_SCHED_ON', 'ADMIN_PLANS_SCHED_OFF',
    'ADMIN_PLANS_ACTIVE', 'ADMIN_PLANS_INACTIVE',
    'ADMIN_PLANS_BTN_DEACTIVATE', 'ADMIN_PLANS_BTN_ACTIVATE',
    'ADMIN_PLANS_BTN_EDIT_QUOTAS', 'ADMIN_PLANS_DEACTIVATE_TIP', 'ADMIN_PLANS_ACTIVATE_TIP',
    'ADMIN_MODAL_CANCEL', 'ADMIN_MODAL_CONFIRM',
    'ADMIN_REVOKE_TITLE_RESTORE', 'ADMIN_REVOKE_TITLE_REVOKE',
    'ADMIN_REVOKE_CONFIRM_MSG', 'ADMIN_REVOKE_ACTION_RESTORE',
    'ADMIN_REVOKE_ACTION_REVOKE', 'ADMIN_REVOKE_WARNING',
    'ADMIN_ROLE_TITLE_PROMOTE', 'ADMIN_ROLE_TITLE_DEMOTE',
    'ADMIN_ROLE_CONFIRM_MSG', 'ADMIN_ROLE_ADMIN_WARN',
    'ADMIN_ROLE_USER_WARN', 'ADMIN_ROLE_BTN_CONFIRM',
    'ADMIN_PWD_TITLE', 'ADMIN_PWD_DESC', 'ADMIN_PWD_LABEL',
    'ADMIN_PWD_PLACEHOLDER', 'ADMIN_PWD_BTN_SAVE',
    'ADMIN_QUOTA_MODAL_TITLE', 'ADMIN_QUOTA_MODAL_DESC',
    'ADMIN_QUOTA_ACTIVE_PLAN', 'ADMIN_QUOTA_DEFAULT_VALUES',
    'ADMIN_QUOTA_CONCURRENT_UNIT', 'ADMIN_QUOTA_WEEKLY_UNIT',
    'ADMIN_QUOTA_EMPTY_HINT', 'ADMIN_QUOTA_CONCURRENT_LABEL',
    'ADMIN_QUOTA_CONCURRENT_HINT', 'ADMIN_QUOTA_WEEKLY_LABEL',
    'ADMIN_QUOTA_WEEKLY_HINT', 'ADMIN_QUOTA_SAVING', 'ADMIN_QUOTA_SAVE_BTN',
    'ADMIN_PLAN_MODAL_EDIT', 'ADMIN_PLAN_MODAL_CREATE',
    'ADMIN_PLAN_FIELD_CODE', 'ADMIN_PLAN_FIELD_NAME',
    'ADMIN_PLAN_FIELD_PRICE_M', 'ADMIN_PLAN_FIELD_PRICE_Y',
    'ADMIN_PLAN_FIELD_BOTS', 'ADMIN_PLAN_FIELD_DIST',
    'ADMIN_PLAN_FIELD_PLAYERS', 'ADMIN_PLAN_FIELD_CONCURRENT',
    'ADMIN_PLAN_FIELD_WEEKLY', 'ADMIN_PLAN_CHECK_DUEL',
    'ADMIN_PLAN_CHECK_SCHED', 'ADMIN_PLAN_CHECK_ACTIVE', 'ADMIN_PLAN_BTN_SAVE',
    'ADMIN_PLANS_CODE_PREFIX',
    'ADMIN_QUOTA_CONCURRENT_PLACEHOLDER', 'ADMIN_QUOTA_WEEKLY_PLACEHOLDER',
    'ADMIN_PLAN_CODE_PLACEHOLDER', 'ADMIN_PLAN_NAME_PLACEHOLDER'
  ];

  const expectedTsKeys = [
    'ADMIN_PUBLIC_SAVED_OK',
    'ADMIN_PWD_ERR_MIN',
    'ADMIN_PLAN_ERR_REQUIRED',
    'ADMIN_PLAN_STANDARD_LABEL',
    'SUB_FREE_TITLE',
    'SUB_CLUB_TITLE',
    'SUB_PRO_TITLE',
    'ADMIN_ERR_LOAD_PUBLIC',
    'ADMIN_ERR_SAVE_PUBLIC',
    'ADMIN_ERR_TOGGLE_PUBLIC',
    'ADMIN_ERR_LOAD_USERS',
    'ADMIN_ERR_REVOKE_USER',
    'ADMIN_ERR_RESET_PWD',
    'ADMIN_ERR_UPDATE_ROLE',
    'ADMIN_ERR_UPDATE_PLAN',
    'ADMIN_ERR_UPDATE_QUOTAS',
    'ADMIN_ERR_LOAD_PLANS',
    'ADMIN_ERR_EDIT_PLAN',
    'ADMIN_ERR_CREATE_PLAN',
    'ADMIN_ERR_TOGGLE_PLAN'
  ];

  const { service } = loadI18nServiceRuntime({ savedLang: 'fr' });
  for (const key of expectedHtmlKeys) {
    assert.ok(html.includes(`i18n.t('${key}'`), `AdminDashboard HTML must reference i18n.t('${key}')`);
  }
  for (const key of expectedTsKeys) {
    assert.ok(ts.includes(`'${key}'`), `AdminDashboard TS must reference '${key}'`);
  }
  for (const key of [...expectedHtmlKeys, ...expectedTsKeys]) {
    for (const lang of ['fr', 'en', 'de', 'es', 'it', 'pt']) {
      service.setLang(lang);
      const val = service.t(key);
      assert.notEqual(val, key, `Key ${key} must resolve to a translated string in ${lang}`);
      assert.ok(val.trim().length > 0, `Key ${key} must be non-empty in ${lang}`);
    }
  }
});

test('RegattaCanvasComponent, RaceOverlaysComponent, RegattaViewComponent and CockpitViewComponent use I18nService across all 6 languages', () => {
  const canvasTs = fs.readFileSync(
    path.resolve(__dirname, '../src/app/components/regatta-canvas/regatta-canvas.component.ts'),
    'utf8'
  );
  const overlaysHtml = fs.readFileSync(
    path.resolve(__dirname, '../src/app/components/race-overlays/race-overlays.component.html'),
    'utf8'
  );
  const overlaysTs = fs.readFileSync(
    path.resolve(__dirname, '../src/app/components/race-overlays/race-overlays.component.ts'),
    'utf8'
  );
  const regattaHtml = fs.readFileSync(
    path.resolve(__dirname, '../src/app/components/regatta-view/regatta-view.component.html'),
    'utf8'
  );
  const regattaTs = fs.readFileSync(
    path.resolve(__dirname, '../src/app/components/regatta-view/regatta-view.component.ts'),
    'utf8'
  );
  const cockpitHtml = fs.readFileSync(
    path.resolve(__dirname, '../src/app/components/cockpit-view/cockpit-view.component.html'),
    'utf8'
  );
  const cockpitTs = fs.readFileSync(
    path.resolve(__dirname, '../src/app/components/cockpit-view/cockpit-view.component.ts'),
    'utf8'
  );

  for (const [name, ts] of [
    ['RegattaCanvasComponent', canvasTs],
    ['RaceOverlaysComponent', overlaysTs],
    ['RegattaViewComponent', regattaTs],
    ['CockpitViewComponent', cockpitTs],
  ]) {
    assert.ok(ts.includes('public i18n: I18nService'), `${name} must inject public i18n: I18nService`);
  }

  // Canvas 2D i18n assertions
  assert.ok(canvasTs.includes('this.i18n.formatRankOrdinal('), 'RegattaCanvasComponent must use formatRankOrdinal for rank badges');
  const canvasKeys = [
    'CANVAS_WAITING', 'CANVAS_LANE', 'FINISH_ARRIVED',
    'CANVAS_DYNAMIC_LANES', 'CANVAS_FIXED_LANES',
    'CANVAS_DYNAMIC_MODE_TIP', 'CANVAS_FIXED_MODE_TIP',
    'CANVAS_CLAIM_MY_KAYAK', 'CANVAS_FOLLOW_KAYAK',
    'CANVAS_LEADER', 'CANVAS_BADGE_YOU', 'CANVAS_BADGE_FOLLOWING'
  ];
  for (const key of canvasKeys) {
    assert.ok(canvasTs.includes(`'${key}'`), `RegattaCanvasComponent must reference i18n key ${key}`);
  }

  // Overlays i18n assertions
  assert.match(overlaysHtml, /BRAVO\s*!/, 'RaceOverlays must preserve BRAVO ! contract');
  const overlayKeys = [
    'OVERLAY_FINISH_CELEBRATION_ARIA', 'OVERLAY_BRAVO_TITLE', 'FINISH_CROSSED',
    'OVERLAY_DISMISS_ROTATE_TIP', 'OVERLAY_CONNECTED_LABEL', 'OVERLAY_WATCH_PAIRING_BADGE',
    'OVERLAY_ROOM_PIN_LABEL', 'OVERLAY_LOGIN_FORM_TITLE', 'OVERLAY_EMAIL_PLACEHOLDER',
    'OVERLAY_LOGIN_AND_JOIN', 'OVERLAY_REGISTER_BADGE', 'OVERLAY_REGISTER_FORM_TITLE',
    'OVERLAY_PUBLIC_PSEUDO_LABEL', 'OVERLAY_PSEUDO_PLACEHOLDER', 'OVERLAY_EMAIL_LABEL',
    'OVERLAY_PWD_MIN6_PLACEHOLDER', 'OVERLAY_REGISTER_AND_JOIN', 'OVERLAY_FULL_REGISTER_LINK',
    'OVERLAY_DRAG_TIMER_TIP', 'OVERLAY_DRAG_HANDLE', 'OVERLAY_RECENTER_TIMER_TIP',
    'OVERLAY_RECENTER_BTN', 'OVERLAY_CLOSE_TIMER_TIP', 'OVERLAY_PRESTART_SUB',
    'OVERLAY_PENDING_PLAYERS', 'OVERLAY_BTN_APPROVE', 'OVERLAY_BTN_REJECT',
    'OVERLAY_PIN_ARIA', 'OVERLAY_WATCH_PIN_BADGE', 'OVERLAY_WATCH_PIN_DESC',
    'OVERLAY_WATCH_PIN_AUTO_HIDE'
  ];
  for (const key of overlayKeys) {
    assert.ok(overlaysHtml.includes(`i18n.t('${key}'`), `RaceOverlays HTML must reference i18n.t('${key}')`);
  }

  // RegattaView i18n assertions
  const regattaHtmlKeys = [
    'RACE_FINISH_ARIA', 'RACE_STOPPED_OFFICIAL_TITLE', 'RACE_FINISHED_BRAVO_TITLE',
    'RACE_PODIUM_CONGRATS', 'RACE_STAT_RANKING', 'RACE_STAT_OFFICIAL_TIME',
    'RACE_STAT_AVG_PACE', 'RACE_STAT_AVG_POWER', 'RACE_VIEW_FULL_TABLE_TIP',
    'RACE_VIEW_FULL_DETAILS', 'RACE_COL_GAP', 'RACE_COL_POINTS', 'RACE_BOT_TIP',
    'RACE_ESTIMATED_TIP', 'RACE_ESTIMATED_BADGE', 'RACE_RETURN_HOME_TIP',
    'RACE_VIEW_FULL_MODAL_TIP', 'RACE_FULL_RANKING_DETAILS', 'RACE_SHORT_COCKPIT',
    'RACE_SHORT_RANKING', 'RACE_BTN_STOP', 'RACE_BTN_START', 'RACE_STOP_TIP',
    'RACE_START_TIP', 'REGATTA_SELECT_KAYAK_LABEL', 'REGATTA_SELECT_KAYAK_ARIA',
    'REGATTA_SELECT_KAYAK_OPTION', 'REGATTA_LINKED_KAYAK', 'REGATTA_FOLLOW_BOAT_LABEL',
    'REGATTA_MY_BOAT_FOCUS', 'REGATTA_CAMERA_CENTERED', 'REGATTA_QUICK_NAV_ARIA',
    'REGATTA_HOME_TIP', 'REGATTA_COCKPIT_TIP', 'REGATTA_RANKING_TIP',
    'REGATTA_ZOOM_ARIA', 'REGATTA_ZOOM_OUT_TIP', 'REGATTA_ZOOM_PREFIX',
    'REGATTA_ZOOM_IN_TIP', 'REGATTA_DATA_SETTINGS_TIP', 'REGATTA_DATA_BTN_ARIA',
    'REGATTA_DATA_BTN', 'REGATTA_END_PREFIX', 'REGATTA_START_PREFIX',
    'REGATTA_LIVE_RANKING_ARIA', 'REGATTA_DRAG_RANKING_TIP', 'REGATTA_CLICK_FOCUS_TIP',
    'REGATTA_ROWER_WAITING', 'REGATTA_ROWER_READY', 'REGATTA_WAITING_ROWERS',
    'REGATTA_HUD_ARIA', 'FAIRNESS_ARIA', 'FAIRNESS_TITLE',
    'FAIRNESS_DESC_BEFORE', 'FAIRNESS_DESC_AFTER'
  ];
  for (const key of regattaHtmlKeys) {
    assert.ok(regattaHtml.includes(`i18n.t('${key}'`), `RegattaView HTML must reference i18n.t('${key}')`);
  }

  const regattaTsKeys = [
    'CANVAS_LEADER', 'RACE_AVG_PREFIX', 'RACE_INST_PREFIX', 'RACE_TARGET_PREFIX',
    'METRIC_SHORT_SPEED', 'METRIC_SHORT_PACE', 'METRIC_SHORT_POWER', 'METRIC_SHORT_POSITION',
    'METRIC_SHORT_DISTTOPREV', 'METRIC_SHORT_DISTTOLEADER', 'METRIC_SHORT_DISTTONEXT',
    'METRIC_SHORT_DISTREMAINING', 'METRIC_SHORT_DISTCOVERED', 'METRIC_SHORT_FORCE',
    'METRIC_SHORT_WORK', 'METRIC_SHORT_AVGSPEED', 'METRIC_SHORT_AVGPOWER', 'METRIC_SHORT_AVGPACE',
    'METRIC_IN_LEAD', 'METRIC_GAP_FIRST_FMT', 'METRIC_RANKING', 'METRIC_PCT_DONE', 'METRIC_PER_STROKE'
  ];
  for (const key of regattaTsKeys) {
    assert.ok(regattaTs.includes(`'${key}'`), `RegattaView TS must reference i18n key '${key}'`);
  }

  // CockpitView i18n assertions
  const cockpitHtmlKeys = [
    'COCKPIT_TOGGLE_LEAD_TIP', 'COCKPIT_LINK_WATCH_ARIA', 'COCKPIT_LINK_WATCH_TITLE',
    'COCKPIT_LINK_WATCH_SUB', 'COCKPIT_PIN_PREFIX', 'COCKPIT_PAIR_BTN',
    'COCKPIT_PIN_INSTRUCTION', 'COCKPIT_MY_KAYAK_LABEL', 'COCKPIT_SELECT_KAYAK_ARIA',
    'COCKPIT_IDENTIFY_KAYAK_OPT', 'COCKPIT_LINKED_KAYAK', 'COCKPIT_RACER_TELEMETRY_LABEL',
    'COCKPIT_MY_COCKPIT_OPT', 'COCKPIT_SHOWING_GAUGES', 'COCKPIT_PROGRESS_ARIA',
    'COCKPIT_QUICK_NAV_ARIA', 'COCKPIT_REGATTA_TIP', 'RACE_SHORT_REGATTA',
    'COCKPIT_RACE_ABANDONED', 'COCKPIT_START_DIST_PREFIX', 'COCKPIT_TOTAL_STROKES',
    'COCKPIT_AVG_PACE_LABEL', 'COCKPIT_AVG_SPEED_TITLE', 'COCKPIT_HR_CALORIES_TITLE',
    'COCKPIT_CALORIES_LABEL', 'RACE_PAUSE_PREFIX', 'RACE_ENDS_IN_PREFIX'
  ];
  for (const key of cockpitHtmlKeys) {
    assert.ok(cockpitHtml.includes(`i18n.t('${key}'`), `CockpitView HTML must reference i18n.t('${key}')`);
  }
  assert.ok(cockpitTs.includes("'CANVAS_LEADER'"), 'CockpitView TS formatRacerGap must use CANVAS_LEADER');

  // Verify every referenced key resolves non-empty across all 6 languages
  const allCheckedKeys = Array.from(new Set([
    ...canvasKeys, ...overlayKeys, ...regattaHtmlKeys, ...regattaTsKeys, ...cockpitHtmlKeys
  ]));
  const { service } = loadI18nServiceRuntime({ savedLang: 'fr' });
  for (const key of allCheckedKeys) {
    for (const lang of ['fr', 'en', 'de', 'es', 'it', 'pt']) {
      service.setLang(lang);
      const val = service.t(key);
      assert.notEqual(val, key, `Key ${key} must resolve to a translated string in ${lang}`);
      assert.ok(val.trim().length > 0, `Key ${key} must be non-empty in ${lang}`);
    }
  }
});

test('Remaining modals (Account, UnifiedConfig, RaceHistory, Standings, Statistics, LegalTerms) use I18nService across all 6 languages', () => {
  const modalNames = [
    'account-modal',
    'unified-config-modal',
    'race-history-modal',
    'standings-modal',
    'statistics-modal',
    'legal-terms-modal'
  ];

  const htmlContents = {};
  const tsContents = {};
  for (const name of modalNames) {
    const base = path.resolve(__dirname, `../src/app/components/modals/${name}/${name}.component`);
    const ts = fs.readFileSync(`${base}.ts`, 'utf8');
    const html = fs.readFileSync(`${base}.html`, 'utf8');
    tsContents[name] = ts;
    htmlContents[name] = html;

    assert.ok(ts.includes('public i18n: I18nService'), `${name} TS must inject public i18n: I18nService`);
    assert.ok(html.includes('i18n.t('), `${name} HTML must use i18n.t()`);
  }

  const accountKeys = [
    'ACCOUNT_TITLE', 'ACCOUNT_TAB_LOGIN', 'ACCOUNT_TAB_REGISTER', 'ACCOUNT_TAB_PROFILE',
    'ACCOUNT_TAB_KAYAK', 'ACCOUNT_TAB_REGATTA_SETTINGS', 'ACCOUNT_TAB_FORGOT',
    'ACCOUNT_VACATION_TITLE', 'ACCOUNT_DUEL_CARD_TITLE', 'ACCOUNT_SAVE_DUEL_PREFS',
    'ACCOUNT_KAYAK_CARD_TITLE', 'ACCOUNT_KAYAK_SAVE_BTN', 'ACCOUNT_REGATTA_SAVE_BTN',
    'DAY_MON_SHORT', 'DAY_SUN_SHORT', 'PWD_STRENGTH_WEAK', 'PWD_STRENGTH_STRONG',
    'PATTERN_SOLID_LABEL', 'PATTERN_GRADIENT_LABEL', 'COLOR_CYAN_NEON'
  ];
  for (const key of accountKeys) {
    assert.ok(
      htmlContents['account-modal'].includes(`'${key}'`) || tsContents['account-modal'].includes(`'${key}'`),
      `account-modal must reference key ${key}`
    );
  }

  const configKeys = [
    'CFG_TITLE', 'CFG_TAB_PUBLIC', 'CFG_TAB_ACTIVE', 'CFG_ADMIN_SAVE_BTN',
    'CFG_PRIVILEGES_TITLE', 'CFG_GUEST_PUBLIC_TITLE', 'CFG_DISCOVER_PLANS_BTN',
    'BOT_DUEL_TITLE', 'BOT_DUEL_DIST_LABEL', 'BTN_LAUNCH_BOT_DUEL'
  ];
  for (const key of configKeys) {
    assert.ok(htmlContents['unified-config-modal'].includes(`'${key}'`), `unified-config-modal must reference key ${key}`);
  }

  const historyKeys = [
    'MODAL_HISTORY_TITLE', 'HIST_OFFICIAL_RANKING_TITLE', 'HIST_COL_RANK',
    'HIST_COL_POINTS', 'HIST_GUEST_SAVE_BTN', 'BTN_LEAVE_ROOM_TO_PUBLIC'
  ];
  for (const key of historyKeys) {
    assert.ok(htmlContents['race-history-modal'].includes(`'${key}'`), `race-history-modal must reference key ${key}`);
  }

  const standingsKeys = [
    'STANDINGS_MODAL_TITLE', 'STANDINGS_TAB_LEAGUES', 'STANDINGS_TAB_GENERAL', 'STANDINGS_TAB_DUELS',
    'LEAGUE_GOLD_LABEL', 'LEAGUE_SILVER_LABEL', 'LEAGUE_BRONZE_LABEL',
    'STANDINGS_FILTER_COUNTRY', 'STANDINGS_FILTER_GENDER', 'STANDINGS_FILTER_CATEGORY',
    'STANDINGS_BTN_CHALLENGE', 'STANDINGS_DUELS_EMPTY', 'STANDINGS_GENERAL_EMPTY'
  ];
  for (const key of standingsKeys) {
    assert.ok(
      htmlContents['standings-modal'].includes(`'${key}'`) || tsContents['standings-modal'].includes(`'${key}'`),
      `standings-modal must reference key ${key}`
    );
  }

  const statsKeys = [
    'STATS_MODAL_TITLE', 'STATS_BADGE_FREE_10D', 'STATS_LOCKED_NOTICE', 'STATS_UNLOCK_BTN',
    'KPI_ANALYZED_RACES', 'STATS_KPI_TOTAL_DIST', 'KPI_TOTAL_TIME', 'STATS_KPI_AVG_POWER',
    'STATS_KPI_BEST_PACE', 'STATS_KPI_WINS_PODIUMS', 'STATS_EMPTY'
  ];
  for (const key of statsKeys) {
    assert.ok(htmlContents['statistics-modal'].includes(`'${key}'`), `statistics-modal must reference key ${key}`);
  }
  assert.ok(htmlContents['statistics-modal'].includes('i18n.formatRankOrdinal('), 'statistics-modal must localize rank ordinals');

  const legalKeys = [
    'MODAL_LEGAL_TITLE', 'LEGAL_S1_TITLE', 'LEGAL_S6_TITLE',
    'GUIDE_TITLE', 'GUIDE_WATCH_STEP1', 'BTN_SHOW_PIN',
    'WEEKLY_PROMOTED_TITLE', 'WEEKLY_BTN_CONTINUE'
  ];
  for (const key of legalKeys) {
    assert.ok(
      htmlContents['legal-terms-modal'].includes(`'${key}'`) || tsContents['legal-terms-modal'].includes(`'${key}'`),
      `legal-terms-modal must reference key ${key}`
    );
  }

  const allModalKeys = Array.from(new Set([
    ...accountKeys, ...configKeys, ...historyKeys, ...standingsKeys, ...statsKeys, ...legalKeys
  ]));
  const { service } = loadI18nServiceRuntime({ savedLang: 'fr' });
  for (const key of allModalKeys) {
    for (const lang of ['fr', 'en', 'de', 'es', 'it', 'pt']) {
      service.setLang(lang);
      const val = service.t(key);
      assert.notEqual(val, key, `Key ${key} must resolve to a translated string in ${lang}`);
      assert.ok(val.trim().length > 0, `Key ${key} must be non-empty in ${lang}`);
    }
  }
});
