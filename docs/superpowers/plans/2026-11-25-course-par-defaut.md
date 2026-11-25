# Plan d'Implémentation : Gestion de la Course par Défaut

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à une course (salon privé ou duel confirmé) de devenir la course par défaut sur le front web en remplacement de la régate publique, dès l'engagement du kayak par PIN ou dès qu'une course associée va bientôt débuter ($\le 15$ min), jusqu'à la sortie explicite après consultation du classement ou abandon.

**Architecture:** Approche hybride réactive : le backend (`RaceManager` & `/api/v1/races/my-active`) détecte les courses associées imminentes ou actives non quittées. Le frontend Angular active ce salon par défaut, affiche un encart visible avec le code PIN pour la montre Garmin, engage automatiquement le kayak au ponton dès la saisie, maintient l'affichage après l'arrivée tant que le coureur n'a pas quitté, et gère le retour propre vers la course publique après consultation ou abandon (DNF).

**Tech Stack:** TypeScript, Node.js / Express, PostgreSQL / Sequelize, Angular 21, Socket.io, Node Test Runner (`node --test`).

**Spec:** [`docs/superpowers/specs/2026-11-25-course-par-defaut-design.md`](file:///c:/Users/Emma/repos/connectiq/rower2backend/docs/superpowers/specs/2026-11-25-course-par-defaut-design.md)

## Global Constraints
- Le code PIN de la montre doit être clairement affiché en très grand format avec instructions sur le front web.
- La course par défaut doit rester affichée au rechargement de page même après la fin de la course, tant que l'athlète n'a pas cliqué sur « Quitter le salon ».
- En cas d'abandon, afficher un récapitulatif DNF puis réactiver la course publique.
- Un bouton discret dans l'en-tête doit permettre d'observer la course publique en mode spectateur sans perdre sa place dans le salon.

---

### Task 1: Backend - Évolution de `findActiveRaceForUser` et détection des courses imminentes

**Files:**
- Modify: `backend/src/services/race-manager.service.ts`
- Modify: `backend/src/controllers/telemetry.controller.ts`
- Modify: `backend/src/controllers/room.controller.ts`
- Test: `backend/tests/default-race-detection.test.ts`

**Interfaces:**
- Consumes: `DuelChallenges` table, `this.privateRacesById`, `race.participants`, `race.pendingParticipants`
- Produces: `findActiveRaceForUser(userId?: string, deviceToken?: string): RaceState | null` avec support courses $\le 15$ min et courses terminées non quittées, plus payload `activeRoom` enrichi de `isAwaitingWatchPin` et `pinCode`.

- [ ] **Step 1: Écrire le test unitaire pour `findActiveRaceForUser`**
Créer `backend/tests/default-race-detection.test.ts` testant :
1. Détection d'un salon débutant dans 10 minutes pour un participant invité.
2. Maintien d'un salon au statut `COMPLETED` si le participant n'a pas `hasLeft = true`.
3. Retour de `null` si le participant a `hasLeft = true` ou `status = 'abandoned'`.
4. Priorité à la course dont le départ est le plus proche si deux courses futures existent.

- [ ] **Step 2: Exécuter le test pour vérifier son échec initial**
Run: `cd backend; npx ts-node --transpile-only node_modules/typescript/bin/tsc; node --test dist/tests/default-race-detection.test.js`
Expected: FAIL car la logique d'anticipation $\le 15$ min et de persistance `COMPLETED` n'est pas encore implémentée.

- [ ] **Step 3: Implémenter la détection dans `RaceManager` et `TelemetryController`**
Dans `backend/src/services/race-manager.service.ts` :
- Mettre à jour `findActiveRaceForUser` pour :
  - Accepter les courses `COMPLETED` / `FINISHED` dont le participant n'a pas `hasLeft` ni `abandoned`.
  - Chercher dans les salons privés et duels programmés (`startMode === 'scheduled'`) où l'utilisateur est présent et dont le départ est prévu dans moins de 15 minutes ($0 \le \text{slotStart} - \text{now} \le 15 \times 60 \times 1000$).
  - Trier par `scheduledStartTime` le plus proche.
Dans `backend/src/controllers/telemetry.controller.ts` :
- Dans `getMyActiveRace`, calculer `isAwaitingWatchPin = !isPlayerOnWaterLane(race, userId, deviceToken)`.
- Renvoyer `isAwaitingWatchPin` et `pinCode` dans le payload `activeRoom`.
Dans `backend/src/controllers/room.controller.ts` :
- Dans `leaveRoom`, marquer `participant.hasLeft = true` pour que le coureur soit considéré comme ayant quitté le salon.

- [ ] **Step 4: Exécuter le test backend et vérifier son succès**
Run: `cd backend; npm test dist/tests/default-race-detection.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add backend/src/services/race-manager.service.ts backend/src/controllers/telemetry.controller.ts backend/src/controllers/room.controller.ts backend/tests/default-race-detection.test.ts; git commit -m "feat(backend): detection de la course par defaut et gestion des courses imminentes"`

---

### Task 2: Frontend - Résolution au boot et remplacement de la course publique

**Files:**
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/services/rower.service.ts`
- Test: `frontend/tests/default-race-activation.test.mjs`

**Interfaces:**
- Consumes: `rowerService.getMyActiveRace(userId, deviceToken)`
- Produces: `activePrivateRoom` configuré comme course par défaut, `siteView = 'regatta'`, persistance `localStorage` et initialisation du salon sans écrasement par la course publique.

- [ ] **Step 1: Écrire le test frontend pour l'activation de la course par défaut**
Créer `frontend/tests/default-race-activation.test.mjs` validant :
1. Si `getMyActiveRace` renvoie une `activeRoom`, elle remplace la course publique au boot.
2. Si la course renvoyée est `COMPLETED`, elle est tout de même activée tant que l'utilisateur n'a pas quitté.
3. Le rechargement de page préserve l'écran de salon et de fin de course.

- [ ] **Step 2: Exécuter le test pour constater l'échec**
Run: `node frontend/tests/default-race-activation.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Mettre à jour `app.ts` pour activer la course par défaut**
- Dans `initGameLoop()` et `ngOnInit()` :
  - Toujours solliciter `getMyActiveRace` (même sans `storedRoomId` en `localStorage`).
  - Si une `activeRoom` est renvoyée :
    - Appeler `activatePrivateRoom(activeRoom, false, false)`.
    - Sauvegarder l'ID dans `localStorage` (`rower_active_private_room_id`).
    - Basculer sur `this.setSiteView('regatta')`.
    - Initialiser les variables de course et la synchronisation WebSocket.

- [ ] **Step 4: Exécuter le test et vérifier le succès**
Run: `node frontend/tests/default-race-activation.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add frontend/src/app/app.ts frontend/tests/default-race-activation.test.mjs; git commit -m "feat(frontend): activation automatique de la course par defaut au boot"`

---

### Task 3: Frontend - Encart d'invitation avec Code PIN montre Garmin et engagement automatique du kayak

**Files:**
- Modify: `frontend/src/app/components/race-overlays/race-overlays.component.ts`
- Modify: `frontend/src/app/components/race-overlays/race-overlays.component.html`
- Modify: `frontend/src/app/components/race-overlays/race-overlays.component.css`
- Modify: `frontend/src/app/app.html`
- Modify: `frontend/src/app/app.ts`
- Test: `frontend/tests/watch-pin-prompt.test.mjs`

**Interfaces:**
- Consumes: `isAwaitingWatchPin`, `activeFullscreenPinCode`, `hasPlayerJoinedWaterLane`
- Produces: Composant visuel d'invitation PIN montre, son de notification, fermeture automatique dès engagement du kayak.

- [ ] **Step 1: Écrire le test d'affichage et de masquage de l'encart PIN montre**
Créer `frontend/tests/watch-pin-prompt.test.mjs` vérifiant :
1. L'encart est actif lorsque `isAwaitingWatchPin` est vrai et `hasPlayerJoinedWaterLane` est faux.
2. Dès réception de l'événement montre `PARTICIPANT_JOINED`, `hasPlayerJoinedWaterLane` devient vrai et l'encart se masque.

- [ ] **Step 2: Exécuter le test pour constater l'échec**
Run: `node frontend/tests/watch-pin-prompt.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implémenter l'encart et la réaction réactive**
- Dans `race-overlays.component.html` & `css` :
  - Ajouter la section d'encart d'invitation `watch-pin-invitation-overlay` stylisée avec le logo montre, le code PIN géant en police monospace, le décompte avant départ et le message explicatif.
- Dans `app.ts` :
  - Lier `isAwaitingWatchPin` aux propriétés d'état de l'application.
  - Déclencher un son discret à l'apparition de l'encart.
  - À la réception du PIN par la montre, appeler `installKayakOnWaterLane` qui passe `isAwaitingWatchPin = false` et masque l'encart.

- [ ] **Step 4: Exécuter le test et vérifier le succès**
Run: `node frontend/tests/watch-pin-prompt.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add frontend/src/app/components/race-overlays/ frontend/src/app/app.ts frontend/src/app/app.html frontend/tests/watch-pin-prompt.test.mjs; git commit -m "feat(frontend): encart d invitation saisie pin montre garmin"`

---

### Task 4: Frontend - Clôture après classement, aperçu course publique & gestion de l'abandon

**Files:**
- Modify: `frontend/src/app/components/app-header/app-header.component.ts`
- Modify: `frontend/src/app/components/app-header/app-header.component.html`
- Modify: `frontend/src/app/components/app-header/app-header.component.css`
- Modify: `frontend/src/app/app.ts`
- Test: `frontend/tests/leave-and-abandon-lifecycle.test.mjs`

**Interfaces:**
- Consumes: Action utilisateur « Quitter le salon », événement d'abandon, bouton « Aperçu course publique »
- Produces: Transition fluide vers la course publique, nettoyage d'état, affichage récapitulatif DNF.

- [ ] **Step 1: Écrire le test du cycle de vie de sortie et d'abandon**
Créer `frontend/tests/leave-and-abandon-lifecycle.test.mjs` vérifiant :
1. Franchir la ligne laisse le salon actif.
2. Cliquer sur « Quitter le salon » appelle `leaveRoom`, purge `localStorage` et repasse sur la course publique.
3. Abandonner affiche un récapitulatif DNF puis bascule sur la course publique après court délai.
4. L'aperçu temporaire de la course publique permet d'observer la course sans perdre son salon par défaut.

- [ ] **Step 2: Exécuter le test pour constater l'échec**
Run: `node frontend/tests/leave-and-abandon-lifecycle.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implémenter les flux de sortie, abandon et aperçu public**
- Dans `app.ts` :
  - Dans `leaveCompletedPrivateRoom()` et `exitPrivateRoomToPublic()`, assurer la notification backend `leaveRoom` et la remise à zéro de la course par défaut.
  - Dans `abandonActiveRace()`, afficher le toast / modalité DNF avant la transition vers la course publique.
  - Implémenter `togglePublicRacePreview()` permettant de basculer temporairement `nextRaceInfo` sur la course publique tout en gardant `activePrivateRoom` en mémoire.
- Dans `app-header.component.html` :
  - Ajouter le bouton discret *« Aperçu course publique »* lorsque `activePrivateRoom` est actif.

- [ ] **Step 4: Exécuter le test et vérifier le succès**
Run: `node frontend/tests/leave-and-abandon-lifecycle.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add frontend/src/app/components/app-header/ frontend/src/app/app.ts frontend/tests/leave-and-abandon-lifecycle.test.mjs; git commit -m "feat(frontend): cycle de cloture classement abandon et apercu public"`

---

### Task 5: Intégration globale et tests de régression

**Files:**
- Test: Suite complète backend (`npm test` dans `backend`)
- Test: Suite de tests frontend (`npm test` dans `frontend`)

- [ ] **Step 1: Exécuter l'ensemble des tests automatisés du backend**
Run: `cd backend; npm test`
Expected: Tous les tests passent avec succès.

- [ ] **Step 2: Exécuter le build frontend et les tests frontend**
Run: `cd frontend; npm run build; npm test`
Expected: Build sans erreur TypeScript et tous les tests passent.

- [ ] **Step 3: Commit final d'intégration**
`git commit --allow-empty -m "chore: validation globale de la gestion de la course par defaut"`
