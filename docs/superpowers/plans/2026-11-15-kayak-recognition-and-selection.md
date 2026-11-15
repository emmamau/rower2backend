# Plan d'implémentation : Reconnaissance et Sélection de Kayak en Course Publique

Ce document détaille les spécifications et les tâches d'implémentation pour permettre la reconnaissance du kayak d'un rameur (connecté ou anonyme) et la sélection manuelle de kayak en mode régate.

---

## 1. Contexte & Objectifs

Lorsqu'un joueur participe à une course publique :
1. **Reconnaissance automatique par login** :
   - Si le joueur est **connecté** sur le web : son kayak doit porter son login (nom d'utilisateur).
   - S'il est **non connecté / anonyme** : le système doit reprendre le login configuré sur l'application Garmin (via `UserManager.getUserId()`, `userLogin` dans les propriétés Garmin ou `guestPseudo`), au lieu d'un nom générique comme `Racer_xxxx` si un login est présent.
2. **Reconnaissance visuelle facile en mode Régate** :
   - Même s'il est anonyme ou non appairé formellement, le kayak du joueur actif doit être mis en valeur de manière évidente sur le plan d'eau (badge distinctif « ★ VOUS », halo lumineux cyan clignotant / pulsant, ligne de couloir soulignée, sillage lumineux).
3. **Sélection manuelle du kayak correspondant (« À défaut, permettre au joueur de choisir le kayak qui lui correspond »)** :
   - Si la détection automatique échoue ou si le joueur souhaite s'associer à un kayak précis (par exemple s'il voit son rameur émettre sous un autre identifiant ou dans un couloir particulier), lui offrir la possibilité de cliquer directement sur un kayak sur le canvas ou dans le classement/sélecteur pour déclarer « *C'est mon kayak* » (`claim/assign as my boat`).
   - L'association met à jour instantanément `activeUserId` / le focus du joueur dans le frontend (avec persistance de session), recalcule les écarts, réoriente la caméra et active tous les indicateurs visuels du joueur actif.

---

## 2. Architecture des modifications

### A. Garmin Connect IQ (`garmin/source/`)
- **`BleDelegate.mc` & `RestSyncManager.mc`** :
  - Actuellement : `_syncManager.joinRace(_userId, _userId, "join")` et `syncActivity(...)` transmettent `_userId`.
  - Lors de la jonction de course publique et de l'envoi télémétrique, s'assurer que le pseudo/login configuré dans Garmin (`UserManager.getDisplayPseudo()` / `UserManager.getUserId()`) est toujours transmis proprement dans le champ `userName` de la requête REST si l'utilisateur n'est pas encore appairé via compte web.

### B. Backend Node.js / TypeScript (`backend/src/`)
- **`backend/src/controllers/race.controller.ts` (`joinRace`)** :
  - Si un joueur rejoint avec `userId = "anonymous"` ou `guest_...` ou `usr_...`, mais fournit un `userName` configuré (non vide et non par défaut `Rameur_42`), attribuer et diffuser ce nom au lieu de `Racer_xxxx`.
- **`backend/src/services/race-manager.service.ts`** :
  - Dans `notifyPlayerJoinedPublic` et la gestion des participants publics, conserver le `userName` réel transmis lors du join ou du premier ping télémétrique au lieu de le réécraser avec `Racer_${userId.slice(-4)}`.
- **`backend/src/controllers/telemetry.controller.ts`** :
  - Dans `ingestTelemetry`, lors de l'enregistrement ou de la découverte d'un participant dans la course publique, privilégier le `userName` transmis par la montre Garmin (ou le deviceToken/pairing) sur les valeurs génériques.

### C. Frontend Angular (`frontend/src/app/`)
- **Composant `RegattaCanvasComponent` (`regatta-canvas.component.ts`)** :
  - **Reconnaissance visuelle renforcée** :
    - Améliorer la visibilité du kayak actif : halo pulsant cyan/or plus net, étiquette bien lisible « ★ MON KAYAK », ligne d'eau numérotée mise en évidence.
  - **Interaction de sélection manuelle de kayak** :
    - Écouter les clics / taps sur le canvas (détection de frappe / raycasting sur les kayaks des couloirs).
    - Lors d'un clic sur un kayak ou depuis la liste : offrir une action rapide « *C'est mon kayak* » / « *Sélectionner comme mon kayak* » en plus de « *Suivre en spectateur* ».
    - Émettre un évènement `@Output() kayakClaimed = new EventEmitter<string>()`.
- **Composant Principal `AppComponent` (`app.ts` & `app.html`)** :
  - Gérer l'événement `kayakClaimed(userId)` :
    - Assigner `this.activeUserId = userId` pour que toute l'UI (télémétrie, badges, classement, caméra) bascule sur ce kayak.
    - Sauvegarder dans le stockage local de session (`localStorage.setItem('rower_user_id', userId)`).
    - Afficher une notification toast / confirmation claire : « Kayak sélectionné : [Nom du kayak] ».
  - Dans le menu / bandeau régate : ajouter un sélecteur déroulant ou bouton rapide « *Changer mon kayak* » permettant de choisir parmi les kayaks en lice.

---

## 3. Plan de travail détaillé (Bite-Sized Tasks)

### Tâche 1 : Backend - Préservation du login Garmin pour les participants anonymes
- **Fichiers à modifier :**
  - `backend/src/controllers/race.controller.ts`
  - `backend/src/services/race-manager.service.ts`
  - `backend/src/controllers/telemetry.controller.ts`
  - `backend/tests/public-race-login.test.js` (nouveau test unitaire)
- **Actions :**
  1. Écrire un test unitaire validant que `POST /api/race/join` avec un `userId` anonyme et un `userName` configuré (ex. "GarminRower99") nomme bien l'activité et le participant avec ce nom.
  2. Adapter `race.controller.ts` et `raceManager.notifyPlayerJoinedPublic` pour accepter et propager `userName`.
  3. Mettre à jour `telemetry.controller.ts` pour que la création de participant public garde le `userName` de la montre si disponible.
  4. Exécuter le test et vérifier qu'il passe.

### Tâche 2 : Garmin Connect IQ - Envoi systématique du login configuré
- **Fichiers à modifier :**
  - `garmin/source/BleDelegate.mc`
  - `garmin/source/RestSyncManager.mc`
- **Actions :**
  1. Vérifier que `_syncManager.joinRace(_userId, UserManager.getDisplayPseudo(), "join")` transmet le pseudo affiché (propriété `userLogin` ou `guestPseudo`) au lieu de passer deux fois un ID technique.
  2. Vérifier que `syncActivity` transmet `UserManager.getDisplayPseudo()` dans le champ `userName`.

### Tâche 3 : Frontend - Amélioration du repérage visuel du kayak en mode Régate
- **Fichiers à modifier :**
  - `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts`
- **Actions :**
  1. Ajouter un repère visuel immédiat même en début de course (bannière lumineuse au-dessus du kayak avec contraste renforcé, flèche colorée pulsante, balise de couloir « MON COULOIR »).
  2. Veiller à ce que la caméra se centre automatiquement sur le kayak actif si la vue est restreinte ou sur mobile.

### Tâche 4 : Frontend - Fonctionnalité de choix manuel du kayak (« C'est mon kayak »)
- **Fichiers à modifier :**
  - `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts`
  - `frontend/src/app/app.ts`
  - `frontend/src/app/app.html`
  - `frontend/src/app/app.css`
- **Actions :**
  1. Dans `regatta-canvas.component.ts`, ajouter la détection du clic sur les kayaks du canvas ou sur les lignes du mini-leaderboard avec une boîte d'action ou un double-clic / bouton pour s'attribuer le kayak (`claimKayak`).
  2. Dans `app.html` & `app.ts`, ajouter un menu ou dialogue rapide « Choisir mon kayak » permettant de sélectionner son bateau parmi les lignes d'eau actives de la régate en cours.
  3. Réagir au choix en mettant à jour `activeUserId`, `myAssignedLane`, les jauges télémétriques et notifier l'utilisateur.

### Tâche 5 : Tests de régression et vérification finale
- **Actions :**
  1. Exécuter les tests backend (`node --test tests/public-race-login.test.js`).
  2. Exécuter la compilation frontend (`npm run build --prefix frontend`).
  3. Tester manuellement le parcours avec les différents cas de figure (connecté, anonyme avec login Garmin, sélection manuelle de kayak).
