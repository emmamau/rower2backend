import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendAppDir = path.resolve(__dirname, '../src/app');
const localesDir = path.resolve(frontendAppDir, 'i18n/locales');

test('1. account-modal.component.html hides the forgot password tab for authenticated users', () => {
  const accountModalHtml = fs.readFileSync(path.join(frontendAppDir, 'components/modals/account-modal/account-modal.component.html'), 'utf8');

  // Verify that the forgot tab button is wrapped in a condition checking user is not authenticated
  assert.match(
    accountModalHtml,
    /@if\s*\(!isSubscriber\s*&&\s*!isUserAdmin\s*&&\s*!isRegisteredUser\s*&&\s*!isIdentified\)\s*\{\s*<button[^>]*accountModalTab === 'forgot'/,
    'L\'onglet "Mot de passe oublié" doit être masqué si l\'utilisateur est connecté'
  );
});

test('2. account-modal.component.html has collapsible security section with change password form in profile tab', () => {
  const accountModalHtml = fs.readFileSync(path.join(frontendAppDir, 'components/modals/account-modal/account-modal.component.html'), 'utf8');

  assert.match(
    accountModalHtml,
    /class="[^"]*profile-security-box[^"]*"/,
    'L\'onglet profil doit contenir la boîte profile-security-box'
  );

  assert.match(
    accountModalHtml,
    /id="current-pwd-input"/,
    'Le formulaire doit contenir le champ current-pwd-input'
  );

  assert.match(
    accountModalHtml,
    /id="change-new-pwd-input"/,
    'Le formulaire doit contenir le champ change-new-pwd-input'
  );

  assert.match(
    accountModalHtml,
    /id="change-pwd-confirm-input"/,
    'Le formulaire doit contenir le champ change-pwd-confirm-input'
  );

  assert.match(
    accountModalHtml,
    /changeNewPassword\s*!==\s*changePasswordConfirm/,
    'Le formulaire doit vérifier la concordance entre nouveau mot de passe et confirmation'
  );

  assert.match(
    accountModalHtml,
    /\(ngSubmit\)="submitChangePasswordRequest\.emit\(\)"/,
    'Le formulaire doit émettre submitChangePasswordRequest'
  );
});

test('3. account-modal.component.html isolates forgot password confirmation without revealing reset inputs', () => {
  const accountModalHtml = fs.readFileSync(path.join(frontendAppDir, 'components/modals/account-modal/account-modal.component.html'), 'utf8');

  assert.match(
    accountModalHtml,
    /class="forgot-sent-success-box"/,
    'Le formulaire oublié doit afficher la boîte de confirmation forgot-sent-success-box'
  );
});

test('4. account-modal.component.ts declares inputs and outputs for changing password', () => {
  const accountModalTs = fs.readFileSync(path.join(frontendAppDir, 'components/modals/account-modal/account-modal.component.ts'), 'utf8');

  assert.match(accountModalTs, /@Input\(\)\s*currentPassword\s*=/);
  assert.match(accountModalTs, /@Input\(\)\s*changeNewPassword\s*=/);
  assert.match(accountModalTs, /@Input\(\)\s*changePasswordConfirm\s*=/);
  assert.match(accountModalTs, /@Input\(\)\s*isChangePasswordOpen\s*=/);

  assert.match(accountModalTs, /@Output\(\)\s*currentPasswordChange\s*=/);
  assert.match(accountModalTs, /@Output\(\)\s*changeNewPasswordChange\s*=/);
  assert.match(accountModalTs, /@Output\(\)\s*changePasswordConfirmChange\s*=/);
  assert.match(accountModalTs, /@Output\(\)\s*isChangePasswordOpenChange\s*=/);
  assert.match(accountModalTs, /@Output\(\)\s*submitChangePasswordRequest\s*=/);

  assert.match(accountModalTs, /toggleChangePassword\(\):\s*void/);
});

test('5. app.ts strictly isolates forgot password and implements submitChangePassword', () => {
  const appTs = fs.readFileSync(path.join(frontendAppDir, 'app.ts'), 'utf8');

  // Check submitForgotPassword does NOT set showResetFields = true
  const forgotFnIndex = appTs.indexOf('submitForgotPassword(): void {');
  const forgotFnEnd = appTs.indexOf('submitChangePassword(): void {', forgotFnIndex);
  const forgotFnBody = appTs.substring(forgotFnIndex, forgotFnEnd);

  assert.ok(
    forgotFnBody.includes('this.showResetFields = false;'),
    'submitForgotPassword doit impérativement forcer showResetFields = false'
  );
  assert.ok(
    !forgotFnBody.includes('this.showResetFields = true;'),
    'submitForgotPassword ne doit JAMAIS définir showResetFields = true'
  );

  // Check submitChangePassword exists and validates matching passwords
  const changeFnIndex = appTs.indexOf('submitChangePassword(): void {');
  const changeFnEnd = appTs.indexOf('submitResetPassword(): void {', changeFnIndex);
  const changeFnBody = appTs.substring(changeFnIndex, changeFnEnd);

  assert.match(changeFnBody, /this\.currentPassword\.trim\(\)\s*===\s*this\.changeNewPassword\.trim\(\)/);
  assert.match(changeFnBody, /this\.changeNewPassword\.trim\(\)\s*!==\s*this\.changePasswordConfirm\.trim\(\)/);
  assert.match(changeFnBody, /this\.rowerService\.changePassword\(/);

  // Check /reset-password route without token warns user
  assert.ok(
    appTs.includes("this.accountAuthError = this.i18n.t('ACCOUNT_RESET_MISSING_TOKEN');"),
    'app.ts doit afficher ACCOUNT_RESET_MISSING_TOKEN en l\'absence de jeton dans l\'URL'
  );
});

test('6. All 6 locales contain all the new change password and forgot confirmation keys', () => {
  const languages = ['fr', 'en', 'de', 'es', 'it', 'pt'];
  const expectedKeys = [
    'ACCOUNT_SECURITY_TITLE',
    'ACCOUNT_BTN_CHANGE_PWD',
    'ACCOUNT_CURRENT_PWD_LABEL',
    'ACCOUNT_CURRENT_PWD_PH',
    'ACCOUNT_NEW_PWD_LABEL',
    'ACCOUNT_NEW_PWD_CONFIRM_LABEL',
    'ACCOUNT_BTN_UPDATE_PWD',
    'ACCOUNT_PWD_CHANGED_SUCCESS',
    'ERR_CURRENT_PWD_INVALID',
    'ERR_NEW_PWD_SAME_AS_CURRENT',
    'ACCOUNT_FORGOT_SENT_CONFIRMATION',
    'ACCOUNT_RESET_MISSING_TOKEN'
  ];

  for (const lang of languages) {
    const filePath = path.join(localesDir, `${lang}.ts`);
    const content = fs.readFileSync(filePath, 'utf8');
    for (const key of expectedKeys) {
      assert.ok(
        content.includes(`'${key}':`),
        `Le fichier ${lang}.ts doit contenir la clé ${key}`
      );
    }
  }
});
