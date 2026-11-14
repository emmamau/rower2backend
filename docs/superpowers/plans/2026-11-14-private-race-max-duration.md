# Plan d'Implémentation : Durée Maximale Configurable, Compte à Rebours et Fermeture Automatique des Salons Privés

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'administrateur de configurer la durée maximale d'une course privée (par défaut 55 min), afficher un compte à rebours précis avant fin de course dès que le départ est lancé, et fermer automatiquement le salon privé après la fin de la course ou dès le départ de tous les joueurs.

**Architecture:** 
1. **Backend Configuration & Modèle :** Ajouter la configuration administrative de durée max pour les salons privés dans `RaceManager` (`adminPrivateRaceConfig` ou fusionner dans la config de course administrable) avec persistance/contrôleur, initialiser `maxDurationMinutes` sur les courses privées à partir de cette valeur, et inclure `remainingSeconds` et `formattedCountdown` dans les payloads d'état de salon privé.
2. **Backend Cycle de Vie & Auto-Clôture :** Lors de la fin de course (timeout ou complétion) et lors de la détection qu'il ne reste aucun participant humain dans le salon ou en activité, nettoyer automatiquement le salon de `privateRaces` et `privateRacesById` (comme lors d'une fermeture manuelle) et diffuser le statut `COMPLETED` / `ABANDONED`.
3. **Frontend Affichage & Admin UI :** Assurer que le compte à rebours de fin de course s'affiche côté frontend dès que le statut passe à `in_progress` / `RUNNING` pour le salon privé actif, ajouter l'option dans l'onglet de configuration Admin pour régler la durée max des courses privées, et gérer la redirection propre des clients vers la vue publique dès la fermeture du salon.

**Tech Stack:** TypeScript, Node.js, Express, Sequelize, Socket.io, Angular, RxJS.

**Spec:** Spécification de la demande utilisateur :
- Une course privée ne peut pas durer plus de 55 min par défaut.
- Durée max configurable par l'administrateur.
- Dès que le départ est lancé, un compte à rebours est lancé avant la fin automatique de la course.
- Le salon privé sera fermé après la fin de course ou après le départ de tous les joueurs.

---

### Task 1: Configuration Administrateur de la Durée Maximale des Courses Privées

**Files:**
- Modify: `backend/src/services/race-manager.service.ts`
- Modify: `backend/src/controllers/race.controller.ts`
- Test: `backend/tests/race-manager-duration.test.js` (ou nouveau fichier de test dédié)

**Interfaces:**
- Consumes: `adminPublicRaceConfig` ou nouvelle structure `adminRaceConfig`
- Produces: `adminPrivateRaceConfig.maxDurationMinutes` accessible et modifiable via `/api/race/admin/config` (ou route admin dédiée).

- [ ] **Step 1: Écrire le test unitaire pour la configuration de la durée max privée**

Ajouter un test vérifiant que `updatePublicRaceConfig` (ou `updateRaceAdminConfig`) permet de définir `privateMaxDurationMinutes` (ou `maxDurationMinutesPrivate`), borné par exemple entre 5 et 180 minutes avec une valeur par défaut de 55 minutes, et que `createPrivateRace` utilise cette valeur par défaut.

- [ ] **Step 2: Exécuter le test pour vérifier son échec**

Run: `node --test tests/race-manager-duration.test.js`
Expected: FAIL

- [ ] **Step 3: Implémenter la configuration côté Backend**

1. Dans `backend/src/services/race-manager.service.ts` :
   - Ajouter `adminPrivateRaceConfig = { maxDurationMinutes: 55 }` (ou l'intégrer dans `adminPublicRaceConfig` comme `privateMaxDurationMinutes: 55`).
   - Mettre à jour `updatePublicRaceConfig` pour accepter `privateMaxDurationMinutes`.
   - Dans `createPrivateRace(...)`, initialiser `maxDurationMinutes: this.adminPrivateRaceConfig.maxDurationMinutes || 55`.
2. Dans `backend/src/controllers/race.controller.ts` :
   - Renvoyer et accepter `privateMaxDurationMinutes` dans `getPublicRaceAdminConfig` et `updatePublicRaceAdminConfig`.

- [ ] **Step 4: Exécuter les tests pour vérifier la conformité**

Run: `node --test tests/race-manager-duration.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/race-manager.service.ts backend/src/controllers/race.controller.ts tests/race-manager-duration.test.js
git commit -m "feat(backend): configure max duration for private races"
```

---

### Task 2: Compte à Rebours de Fin de Course et Auto-Clôture dans `tickPrivateRaces`

**Files:**
- Modify: `backend/src/services/race-manager.service.ts`
- Modify: `backend/src/controllers/race.controller.ts`
- Test: `backend/tests/private-race-lifecycle.test.js`

**Interfaces:**
- Consumes: `race.startedAt`, `race.maxDurationMinutes`, `finishPrivateRace`
- Produces: Clôture complète (`removePrivateRaceInternal`) lors de `finishPrivateRace` (ou après un court délai pour lecture du podium) et détection de la désertion complète du salon.

- [ ] **Step 1: Écrire le test d'auto-clôture et de calcul du temps restant**

Tester que :
1. Une course privée en statut `RUNNING` calcule correctement `remainingSeconds` basé sur `maxDurationMinutes * 60 - elapsedSeconds`.
2. Lorsque `elapsedMinutes >= maxDurationMinutes`, la course est terminée (`finishPrivateRace`) et le salon est retiré des salons actifs.
3. Si tous les joueurs humains quittent le salon (plus aucun participant dans `race.participants` ni dans les activités humaines actives), le salon est automatiquement fermé et supprimé de `privateRacesById` / `privateRaces`.

- [ ] **Step 2: Exécuter le test pour vérifier son échec**

Run: `node --test tests/private-race-lifecycle.test.js`
Expected: FAIL

- [ ] **Step 3: Implémenter l'auto-clôture et le countdown dans `RaceManager`**

1. Dans `backend/src/services/race-manager.service.ts` :
   - Dans `tickPrivateRaces()` :
     - Vérifier la présence de joueurs : si `race.status === "LOBBY"` ou `"RUNNING"`, si `race.participants.size === 0` et qu'aucune activité humaine n'est active (après un délai de grâce de 10-15s post-démarrage), fermer le salon via `this.removePrivateRaceInternal(race)`.
     - Lorsque `finishPrivateRace(race, reason)` est appelé :
       - Supprimer le code PIN et le code salon de la mémoire afin que le salon soit fermé aux nouveaux arrivants (`this.removePrivateRaceInternal(race)`).
       - Émettre via `socketGateway.broadcastRaceStatus(race.id, "COMPLETED", { reason, ranking, roomClosed: true })`.
   - Dans `backend/src/controllers/race.controller.ts` :
     - Dans `formatRaceStateResponse(race)` : s'assurer que pour un salon privé en `RUNNING`, `timing.remainingSeconds` est bien retourné et correspond à `Math.max(0, (race.maxDurationMinutes * 60) - elapsedSeconds)`.

- [ ] **Step 4: Exécuter les tests pour vérifier la réussite**

Run: `node --test tests/private-race-lifecycle.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/race-manager.service.ts backend/src/controllers/race.controller.ts tests/private-race-lifecycle.test.js
git commit -m "feat(backend): countdown and automatic closure of private races"
```

---

### Task 3: Départ de Joueur & Clôture Immédiate quand le Dernier Joueur Part

**Files:**
- Modify: `backend/src/controllers/room.controller.ts`
- Modify: `backend/src/services/race-manager.service.ts`
- Modify: `backend/src/routes/room.routes.ts`
- Modify: `frontend/src/app/services/rower.service.ts`
- Modify: `frontend/src/app/components/private-room-manager/private-room-manager.component.ts`
- Modify: `frontend/src/app/app.ts`

**Interfaces:**
- Consumes: endpoint `POST /api/rooms/leave` ou appel websocket/HTTP lors de la sortie d'un salon
- Produces: Déconnexion propre d'un joueur, mise à jour du lobby, et fermeture automatique du salon si `participants.size === 0`.

- [ ] **Step 1: Créer l'endpoint `leaveRoom` côté backend**

Dans `backend/src/controllers/room.controller.ts` et `backend/src/services/race-manager.service.ts` :
- Méthode `leavePrivateRace(identifier: string, userId: string)` :
  - Retire le participant de `race.participants` et marque son activité en `abandoned` si la course est en cours.
  - Diffuse la mise à jour des participants aux autres joueurs du salon.
  - Si le nombre de participants restants est 0, appelle `this.removePrivateRaceInternal(race)` et diffuse `ABANDONED` / `ROOM_CLOSED`.
- Ajouter la route `POST /api/rooms/leave` (et `/api/v1/races/private/:identifier/leave`).

- [ ] **Step 2: Connecter le départ côté frontend**

- Dans `frontend/src/app/services/rower.service.ts` :
  - Ajouter `leavePrivateRace(identifier: string, userId: string)`.
- Dans `frontend/src/app/components/private-room-manager/private-room-manager.component.ts` :
  - Dans `leaveToPublicRace()` : appeler `rowerService.leavePrivateRace` avant d'émettre `roomClosedOrLeft`.
- Dans `frontend/src/app/app.ts` :
  - Lors de la sortie d'un salon privé (`exitPrivateRoomToPublic`), envoyer la notification de départ au backend si un salon était actif.

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/room.controller.ts backend/src/services/race-manager.service.ts backend/src/routes/room.routes.ts frontend/src/app/services/rower.service.ts frontend/src/app/components/private-room-manager/private-room-manager.component.ts frontend/src/app/app.ts
git commit -m "feat: handle player departure and auto-close empty rooms"
```

---

### Task 4: Interface Utilisateur : Compte à Rebours de Course Privée & Configuration Admin

**Files:**
- Modify: `frontend/src/app/app.html`
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/services/rower.service.ts`

**Interfaces:**
- Consumes: `adminConfig.privateMaxDurationMinutes`, `activePrivateRoom`, `formattedGameRemaining`
- Produces: Affichage en direct du compte à rebours de fin de course dans le bandeau du salon privé et champ de configuration dans le modal Admin.

- [ ] **Step 1: Afficher le compte à rebours de fin de course pour le salon privé**

Dans `frontend/src/app/app.html` et `frontend/src/app/app.ts` :
- Dans le bloc `#badge-timer` et dans l'en-tête (ligne ~239 de `app.html`) :
  - Si `activePrivateRoom` et que la course est `in_progress`, afficher le compte à rebours avant la fin de la course (`formattedGameRemaining` au lieu de simplement le texte statique `'Course en cours'`).
  - Exemple : `⏱️ Fin dans : {{ formattedGameRemaining }}`.
- S'assurer que le ticker de décompte (`countdownTickerSub` dans `app.ts`) décrémente `gameRemainingSeconds` de manière identique pour une course privée que pour une course publique, et que si `gameRemainingSeconds === 0`, le statut passe automatiquement à terminée.

- [ ] **Step 2: Ajouter la configuration de durée max des salons privés dans le modal Admin**

Dans `frontend/src/app/app.html` (section `#admin-unified-modal`) :
- Ajouter un champ input dans l'onglet de configuration générale/publique pour la durée maximale des salons privés :
  - Label : "Durée maximale des salons privés (minutes) :"
  - `[(ngModel)]="adminConfig.privateMaxDurationMinutes"`
  - `min="5" max="180" step="5"`
  - Hint : "Défaut : 55 minutes. La course privée s'arrêtera automatiquement à expiration."

- [ ] **Step 3: Gérer la réception de l'événement de fermeture du salon (`COMPLETED` ou `ABANDONED`)**

Dans `frontend/src/app/app.ts` (`onRaceStatusChange` et `onPrivateRoomUpdate`) :
- Si le salon privé actif reçoit un statut `COMPLETED` ou `ABANDONED`, fermer automatiquement le salon privé après un bref affichage du podium / notification, et rediriger l'utilisateur vers le salon public (`exitPrivateRoomToPublic(true)`).

- [ ] **Step 4: Vérifier la compilation frontend**

Run: `cd frontend; npm run build` (ou équivalent)
Expected: Build success sans erreur TypeScript ni template.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/app.html frontend/src/app/app.ts frontend/src/app/services/rower.service.ts
git commit -m "feat(frontend): display private race remaining countdown and admin duration setting"
```

---

### Task 5: Tests de Validation de Bout en Bout & Scénarios Limites

**Files:**
- Test: `backend/tests/private-room-auto-close.test.js`

**Scénarios à valider :**
1. Création d'un salon privé avec la durée configurée par l'admin (ex: 55 min).
2. Lancement du départ : le compte à rebours est lancé avec `remainingSeconds` décrémenté chaque seconde.
3. Arrivée à 0s (timeout) : la course se termine automatiquement avec la raison `"timeout"`, le statut passe à `COMPLETED`, et le salon est fermé / supprimé de la liste des salons joignables.
4. Abandon / départ de tous les joueurs en cours de partie ou en lobby : dès que le dernier joueur quitte, le salon passe en fermeture immédiate et libère les ressources.

- [ ] **Step 1: Écrire et lancer les tests d'intégration**
- [ ] **Step 2: Valider que tous les tests passent**
- [ ] **Step 3: Commit**

```bash
git add backend/tests/private-room-auto-close.test.js
git commit -m "test: add e2e tests for private room auto-close and countdown"
```
