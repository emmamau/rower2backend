# Plan d'Implémentation : Réinitialisation Simplifiée du Mot de Passe par E-mail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger et simplifier le parcours de réinitialisation de mot de passe afin que le clic sur le lien contenu dans le courriel ouvre directement une fenêtre dédiée de saisie du nouveau mot de passe (avec confirmation et jeton appliqué automatiquement), sans perturbation par la détection automatique de course ni masquage intempestif.

**Architecture:** 
1. **Backend** : `EmailService` génère une URL sémantique claire `/reset-password?token=...` vers le frontend.
2. **Frontend Routing & Boot** : La route `reset-password` est enregistrée dans `app.routes.ts`. Au boot (`ngOnInit`), `app.ts` extrait le jeton (`token` ou `resetToken`), active la vue de réinitialisation directe, empêche `resolveRoomFromCurrentUrl` de basculer sur la vue régate ou d'ouvrir une modale concurrente, et applique le jeton de manière transparente.
3. **Frontend UI & Validation** : La modale propose un écran dédié et épuré avec saisie du nouveau mot de passe, confirmation du mot de passe avec validation de concordance, indicateur de force, masquage du jeton technique, transition réussie vers la connexion, et gestion explicite des jetons expirés avec bouton de redemande.

**Tech Stack:** TypeScript, Angular 21 (Zoneless, Standalone Components), Node.js / Express, i18n multilingue (FR, EN, DE, ES, IT, PT), Node Test Runner (`node --test`).

---

## Global Constraints
- Le jeton technique de réinitialisation ne doit pas être affiché comme un champ de saisie manuel à l'utilisateur : il est géré automatiquement.
- La route `/reset-password?token=...` doit être prise en charge tout en préservant la rétrocompatibilité complète avec `/?resetToken=...` et `/?token=...`.
- La détection de course par défaut ne doit en aucun cas masquer ou fermer la modale de réinitialisation ni forcer la vue régate tant que l'utilisateur est sur ce parcours.
- En cas de succès, basculer sur la modale de connexion avec un message de succès vert clair.
- En cas de lien expiré ou invalide, afficher un message d'erreur clair avec un bouton « Demander un nouveau lien » et un bouton « Retour à la connexion ».

---

### Task 1: Backend - Génération du lien sémantique `/reset-password?token=`

**Files:**
- Modify: `backend/src/services/email.service.ts`
- Test: `backend/tests/transactional-emails.test.js`

**Interfaces:**
- Produces: `sendPasswordResetEmail(to, login, resetToken, lang)` générant `resetUrl = ${config.frontendUrl}/reset-password?token=${encodeURIComponent(resetToken)}`

- [ ] **Step 1: Mettre à jour le test backend pour vérifier le format de l'URL**
Vérifier dans `backend/tests/transactional-emails.test.js` que `resetMail.html` et `resetMail.text` contiennent `/reset-password?token=`.

- [ ] **Step 2: Exécuter le test pour observer l'échec initial**
Run: `npm --prefix backend test`
Expected: FAIL sur l'assertion d'URL `/reset-password?token=`.

- [ ] **Step 3: Mettre à jour `email.service.ts`**
Dans `backend/src/services/email.service.ts` :
Remplacer :
`const resetUrl = \`\${config.frontendUrl}/?resetToken=\${encodeURIComponent(resetToken)}\`;`
par :
`const resetUrl = \`\${config.frontendUrl}/reset-password?token=\${encodeURIComponent(resetToken)}\`;`

- [ ] **Step 4: Exécuter le test backend et valider le succès**
Run: `npm --prefix backend test`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add backend/src/services/email.service.ts backend/tests/transactional-emails.test.js && git commit -m "feat(backend): generation d url /reset-password?token dans l email de reinitialisation"`

---

### Task 2: Frontend Route & Neutralisation des Interférences au Boot

**Files:**
- Modify: `frontend/src/app/app.routes.ts`
- Modify: `frontend/src/app/app.ts`
- Test: `frontend/tests/reset-password-navigation.test.mjs`

**Interfaces:**
- Route: `/reset-password` -> `AppComponent`
- State: `showResetFields = true`, `resetToken = token`, protection de `resolveRoomFromCurrentUrl()` quand un jeton de réinitialisation est actif.

- [ ] **Step 1: Écrire le test d'intégration frontend pour la navigation et la route**
Créer `frontend/tests/reset-password-navigation.test.mjs` testant :
1. `app.routes.ts` définit la route `reset-password`.
2. `app.ts` intercepte `/reset-password` et extrait `token` ou `resetToken` depuis l'URL.
3. `resolveRoomFromCurrentUrl()` ne force pas `siteView = 'regatta'` et n'ouvre pas le classement si un jeton de réinitialisation est en cours de traitement.
4. `app.ts` conserve la rétrocompatibilité avec `/?resetToken=` et `/?token=`.

- [ ] **Step 2: Exécuter le test pour constater l'échec**
Run: `node --test frontend/tests/reset-password-navigation.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implémenter la route et la logique dans `app.routes.ts` et `app.ts`**
Dans `frontend/src/app/app.routes.ts` :
- Ajouter `{ path: 'reset-password', loadComponent: () => import('./app').then((m) => m.AppComponent) }`.
Dans `frontend/src/app/app.ts` :
- Dans `ngOnInit` : détecter si le chemin est `/reset-password` ou s'il y a un paramètre `resetToken` ou `token`.
- Positionner `this.resetToken`, `this.showResetFields = true`, `this.setSiteView('home')`, `this.openAccountModal('forgot')`.
- Dans `resolveRoomFromCurrentUrl()` : si `this.resetToken && this.showResetFields`, ne pas basculer sur `regatta` et ne pas ouvrir `openRaceLeaderboard`.

- [ ] **Step 4: Exécuter le test et vérifier son passage**
Run: `node --test frontend/tests/reset-password-navigation.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add frontend/src/app/app.routes.ts frontend/src/app/app.ts frontend/tests/reset-password-navigation.test.mjs && git commit -m "feat(frontend): support de la route /reset-password et protection du flux de reinitialisation"`

---

### Task 3: Modale Dédiée, Champ Confirmation et Expérience Utilisateur

**Files:**
- Modify: `frontend/src/app/components/modals/account-modal/account-modal.component.html`
- Modify: `frontend/src/app/components/modals/account-modal/account-modal.component.ts`
- Modify: `frontend/src/app/app.html`
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/i18n/locales/fr.ts` (et `en.ts`, `de.ts`, `es.ts`, `it.ts`, `pt.ts`)
- Test: `frontend/tests/reset-password-ui.test.mjs`

**Interfaces:**
- Propriétés: `resetPasswordConfirm`, `showResetPasswordConfirm`, validation de concordance.
- UI: En-tête dédié "Réinitialisation du mot de passe", jeton masqué, mot de passe + confirmation, message d'erreur si lien expiré avec bouton "Demander un nouveau lien".

- [ ] **Step 1: Écrire le test unitaire pour l'UI et les traductions**
Créer `frontend/tests/reset-password-ui.test.mjs` testant :
1. Présence du champ `resetPasswordConfirm` dans `account-modal.component.ts` et `app.ts`.
2. Masquage du champ textuel `resetToken` (champ masqué ou stocké en variable sans affichage de champ éditable).
3. Présence des clés d'internationalisation pour la confirmation et les actions d'expiration.
4. Validation de la concordance des deux mots de passe avant soumission.
5. Présence des boutons d'action d'erreur (Demander un nouveau lien / Retour connexion).

- [ ] **Step 2: Exécuter le test pour constater l'échec**
Run: `node --test frontend/tests/reset-password-ui.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implémenter l'UI et la logique de confirmation**
1. Dans `account-modal.component.html` :
   - Quand `showResetFields` est actif dans l'onglet `forgot` :
     - Afficher un titre spécifique : `ACCOUNT_RESET_TITLE` ("Réinitialiser votre mot de passe").
     - Remplacer le descriptif de demande par `ACCOUNT_RESET_SUBTITLE` ("Choisissez un nouveau mot de passe sécurisé pour votre compte.").
     - Masquer le champ `reset-token-input` (le jeton reste bindé dans le composant).
     - Ajouter le champ `reset-pwd-confirm-input` avec bascule `showResetPasswordConfirm`.
     - Afficher un message d'avertissement en direct si `resetPasswordConfirm && resetNewPassword !== resetPasswordConfirm`.
     - Si une erreur est présente (ex: token expiré), afficher le bouton "Demander un nouveau lien" qui repasse `showResetFields = false`.
2. Dans `account-modal.component.ts` et `app.ts` :
   - Ajouter `resetPasswordConfirm = ''`, `showResetPasswordConfirm = false`.
   - Dans `submitResetPassword()` : vérifier la concordance de `resetNewPassword` et `resetPasswordConfirm`.
   - À la réussite : fermer la réinitialisation, passer sur l'onglet `login`, afficher `accountAuthSuccess`.
3. Dans `locales/*.ts` (les 6 langues) :
   - Ajouter les clés `ACCOUNT_RESET_TITLE`, `ACCOUNT_RESET_SUBTITLE`, `ACCOUNT_RESET_CONFIRM_LABEL`, `ACCOUNT_RESET_CONFIRM_PH`, `ERR_PASSWORDS_DO_NOT_MATCH`, `ACCOUNT_RESET_REQUEST_NEW_LINK`.

- [ ] **Step 4: Exécuter les tests frontend**
Run: `node --test frontend/tests/reset-password-ui.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add frontend/src/app/components/modals/account-modal/ frontend/src/app/app.ts frontend/src/app/app.html frontend/src/app/i18n/locales/ frontend/tests/reset-password-ui.test.mjs && git commit -m "feat(frontend): modale de reinitialisation dediee avec confirmation et jeton transparent"`

---

### Task 4: Vérification Globale et Validation Finale

**Files:**
- Test: Toutes les suites de tests frontend et backend

- [ ] **Step 1: Exécuter les tests backend**
Run: `npm --prefix backend test`
Expected: PASS.

- [ ] **Step 2: Exécuter les tests frontend ciblés et généraux**
Run: `node --test frontend/tests/reset-password-*.test.mjs frontend/tests/app-features.test.mjs`
Expected: PASS.

- [ ] **Step 3: Vérification de non-régression**
Valider la conformité avec l'ensemble des règles UI et l'absence d'erreurs TypeScript.
