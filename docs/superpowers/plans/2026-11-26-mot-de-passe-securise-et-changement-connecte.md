# Spécification et Plan d'implémentation : Cloisonnement Réinitialisation par Email & Changement de Mot de Passe Connecté

## 1. Objectifs
1. **Cloisonner strictement la réinitialisation de mot de passe oublié :**
   - La saisie d'un nouveau mot de passe est accessible **exclusivement** via le lien unique reçu par email (`/reset-password?token=...`).
   - La demande de mot de passe oublié affiche un message d'instruction clair invitant à consulter ses emails, sans jamais basculer vers les champs de nouveau mot de passe.
   - Si la route `/reset-password` est accédée sans jeton, une alerte invite l'utilisateur à cliquer sur le lien reçu dans son email.
   - L'onglet « Mot de passe oublié » est masqué dans la barre d'onglets de la fenêtre de compte lorsque l'utilisateur est déjà connecté.
2. **Ajouter la fonction de changement de mot de passe pour l'utilisateur connecté :**
   - Dans l'onglet « Mon Profil », ajouter une section « Sécurité » avec un bouton « 🔒 Modifier mon mot de passe ».
   - Le clic déplie un formulaire directement dans la page.
   - Saisie requise : Mot de passe actuel + Nouveau mot de passe + Confirmation du nouveau mot de passe.
   - Validation de sécurité : vérification du mot de passe actuel en base, vérification de la robustesse du nouveau mot de passe, vérification de la concordance.
   - Après succès : l'utilisateur reste connecté, le formulaire se replie et un message de succès vert s'affiche.

---

## 2. Architecture & Modifications

### Backend
1. **Nouvelle route & contrôleur :**
   - Route `PUT /api/user/password` protégée par `requireAuth`.
   - Contrôleur `changePassword(req, res)` dans `backend/src/controllers/user.controller.ts` :
     - Vérifie `currentPassword`, `newPassword`.
     - Valide `currentPassword` contre `passwordHash` et `passwordSalt` de l'utilisateur connecté.
     - Valide la robustesse du `newPassword` via `validateStrongPassword`.
     - Met à jour le mot de passe via `userStore.updateUser`.
     - Renvoie un statut 200 avec message de succès.
2. **Tests backend :**
   - Tests automatisés dans `backend/tests/` pour valider `changePassword` (succès, mot de passe actuel incorrect, nouveau mot de passe non conforme, non authentifié).

### Frontend
1. **Service `RowerService` :**
   - Méthode `changePassword(currentPassword, newPassword): Observable<any>`.
2. **Cloisonnement du flux « Mot de passe oublié » (`app.ts` & `account-modal`) :**
   - `submitForgotPassword()` :
     - Ne définit plus `showResetFields = true`.
     - Affiche un message de confirmation invitant à consulter sa boîte mail.
     - Affiche un bouton « Retour à la connexion ».
   - Protection de `/reset-password` :
     - Si aucun jeton n'est présent dans l'URL, `showResetFields` reste `false` et un message d'erreur ou d'avertissement invite à utiliser le lien présent dans le mail.
   - Barre d'onglets (`account-modal.component.html`) :
     - Masquer l'onglet « ❓ Mot de passe oublié » lorsque `isSubscriber || isUserAdmin || isRegisteredUser || isIdentified`.
3. **Formulaire de changement de mot de passe connecté (`account-modal`) :**
   - Ajout d'une section « Sécurité » dans l'onglet `profile`.
   - Bouton « 🔒 Modifier mon mot de passe » permettant de déplier/replier le formulaire.
   - 3 champs sécurisés :
     - Mot de passe actuel (avec toggle d'affichage).
     - Nouveau mot de passe (avec jauge de robustesse et toggle d'affichage).
     - Confirmer le nouveau mot de passe (avec vérification de correspondance et toggle d'affichage).
   - Boutons « Mettre à jour » et « Annuler ».
4. **Traductions i18n :**
   - Ajout des clés dans les 6 fichiers de langues (`fr`, `en`, `de`, `es`, `it`, `pt`).

---

## 3. Plan d'exécution par étapes
1. **Étape 1 (Backend) :** Implémentation du endpoint `PUT /api/user/password` et des tests unitaires associés.
2. **Étape 2 (Frontend - Flux Oublié) :** Cloisonnement strict du formulaire de réinitialisation (uniquement sur URL avec token), suppression du basculement automatique, masquage de l'onglet si connecté.
3. **Étape 3 (Frontend - Changement Connecté) :** Ajout de la section Sécurité dépliable dans l'onglet Profil, intégration des champs, liaison avec `RowerService`.
4. **Étape 4 (i18n & Vérification) :** Ajout des traductions dans les 6 langues, exécution des tests et validation du build frontend/backend.
