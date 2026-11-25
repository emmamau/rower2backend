import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');
const localesDir = path.resolve(frontendAppDir, 'i18n/locales');

test('1. AccountModalComponent and AppComponent expose resetPasswordConfirm properties', () => {
  const accountModalTs = fs.readFileSync(path.join(frontendAppDir, 'components/modals/account-modal/account-modal.component.ts'), 'utf8');
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');
  const appHtml = fs.readFileSync(path.join(frontendAppDir, 'app.html'), 'utf8');

  assert.match(
    accountModalTs,
    /@Input\(\)\s*resetPasswordConfirm\s*=/,
    'AccountModalComponent must have @Input() resetPasswordConfirm'
  );
  assert.match(
    accountModalTs,
    /@Output\(\)\s*resetPasswordConfirmChange\s*=/,
    'AccountModalComponent must have @Output() resetPasswordConfirmChange'
  );
  assert.match(
    accountModalTs,
    /showResetPasswordConfirm\s*=/,
    'AccountModalComponent must declare showResetPasswordConfirm toggle'
  );

  assert.match(
    appTs,
    /resetPasswordConfirm\s*=\s*['"]['"]/,
    'AppComponent must declare resetPasswordConfirm'
  );

  assert.match(
    appHtml,
    /\[\(resetPasswordConfirm\)\]\s*=\s*['"]resetPasswordConfirm['"]/,
    'app.html must two-way bind [(resetPasswordConfirm)] to app-account-modal'
  );
});

test('2. account-modal.component.html hides manual token input and provides password confirmation and error recovery', () => {
  const accountModalHtml = fs.readFileSync(path.join(frontendAppDir, 'components/modals/account-modal/account-modal.component.html'), 'utf8');

  // Should NOT display a visible text input for the reset token
  assert.doesNotMatch(
    accountModalHtml,
    /<label[^>]*for="reset-token-input"/,
    'Manual reset token input label must not be displayed to the user'
  );

  // Must have confirmation field
  assert.match(
    accountModalHtml,
    /id="reset-pwd-confirm-input"/,
    'Must contain reset-pwd-confirm-input'
  );

  // Must have mismatch warning and disabled submit button when mismatched
  assert.match(
    accountModalHtml,
    /resetNewPassword\s*!==\s*resetPasswordConfirm/,
    'Must check mismatch between resetNewPassword and resetPasswordConfirm'
  );

  // Error recovery button to request a new link
  assert.match(
    accountModalHtml,
    /showResetFields\s*=\s*false/,
    'Must provide button to request a new link resetting showResetFields to false'
  );
});

test('3. submitResetPassword validates password matching and clears reset state on success', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  const fnStartIndex = appTs.indexOf('submitResetPassword(): void {');
  assert.ok(fnStartIndex > 0, 'submitResetPassword must exist');
  const fnEndIndex = appTs.indexOf('promptLogout(): void', fnStartIndex);
  const fnBody = appTs.substring(fnStartIndex, fnEndIndex);

  assert.match(
    fnBody,
    /this\.resetNewPassword\.trim\(\)\s*!==\s*this\.resetPasswordConfirm\.trim\(\)/,
    'submitResetPassword must verify matching password and confirmation'
  );

  assert.match(
    fnBody,
    /this\.showResetFields\s*=\s*false/,
    'submitResetPassword must set showResetFields = false on success'
  );
  assert.match(
    fnBody,
    /this\.resetToken\s*=\s*['"]['"]/,
    'submitResetPassword must clear resetToken on success'
  );
  assert.match(
    fnBody,
    /this\.resetPasswordConfirm\s*=\s*['"]['"]/,
    'submitResetPassword must clear resetPasswordConfirm on success'
  );
});

test('4. All 6 locales contain the new i18n keys for password reset', () => {
  const languages = ['fr', 'en', 'de', 'es', 'it', 'pt'];
  const requiredKeys = [
    'ACCOUNT_RESET_TITLE',
    'ACCOUNT_RESET_SUBTITLE',
    'ACCOUNT_RESET_CONFIRM_LABEL',
    'ACCOUNT_RESET_CONFIRM_PH',
    'ERR_PASSWORDS_DO_NOT_MATCH',
    'ACCOUNT_RESET_REQUEST_NEW_LINK'
  ];

  for (const lang of languages) {
    const localePath = path.join(localesDir, `${lang}.ts`);
    assert.ok(fs.existsSync(localePath), `Locale file must exist for ${lang}`);
    const content = fs.readFileSync(localePath, 'utf8');
    for (const key of requiredKeys) {
      assert.ok(
        content.includes(`'${key}':`) || content.includes(`"${key}":`),
        `Locale ${lang}.ts must contain key ${key}`
      );
    }
  }
});
