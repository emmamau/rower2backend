# Plan d'implémentation : Prévention de la duplication de lignes d'eau & Unicité du kayak en course publique

Ce plan d'implémentation s'ajoute à la reconnaissance et sélection du kayak pour garantir la **règle stricte d'unicité d'occupation des couloirs** : **un joueur (et une montre) ne doit jamais pouvoir occuper 2 lignes d'eau différentes** lors de multiples tentatives de connexion ou reconnexions à une course publique.

---

## 1. Analyse du Problème

### Symptôme
Lorsqu'un joueur anonyme (ou sur montre Garmin) rejoint ou réessaie de rejoindre une course publique :
- Chaque essai peut générer ou utiliser un identifiant temporaire différent (ex. `usr_abc123`, `guest_xyz789`, ou `anonymous` sans token lié, ou nouvel ID après redémarrage/reconnexion réseau).
- Côté Garmin, `RestSyncManager.joinRace` envoyait jusqu'ici `{ "userId": _userId, "userName": _userId, "action": "join" }` sans transmettre le `deviceId` matériel persistant (`UserManager.getDeviceId()`) ni le `deviceToken`.
- Côté Backend (`backend/src/controllers/race.controller.ts` et `telemetry.controller.ts`) :
  - La course publique stocke les participants sous la clé `userId` (`compositeId = ${actualRaceId}_${userId}`).
  - Si un même joueur/montre émet sous un nouvel identifiant (ou avec un `userId` différent mais le même `deviceId`, même pseudo/login Garmin, ou même `deviceToken`), le backend créait une deuxième entrée `Activity` et une deuxième entrée dans `matchedRace.participants`.
  - Résultat dans le frontend : **plusieurs kayaks/lignes d'eau assignés à la même personne ou à la même montre physique**, faussant la grille de départ et polluant la régate.

---

## 2. Règles Métier & Solution Architecturale

1. **Transmission de l'empreinte matérielle persistante de la montre (`deviceId`) et/ou du `deviceToken`** :
   - `RestSyncManager.joinRace` et `syncActivity` doivent systématiquement inclure `deviceId: UserManager.getDeviceId()` et `deviceToken: UserManager.getDeviceToken()`.
   - Même si le joueur est anonyme et n'a pas de compte web, son `deviceId` matériel (unique à la montre) est constant sur tous ses essais de connexion.

2. **Dédoublonnage & Nettoyage atomique côté Backend (`race.controller.ts`, `race-manager.service.ts`, `telemetry.controller.ts`)** :
   - Lors d'une demande de `join` ou d'un paquet de télémétrie sur une course publique :
     - Vérifier si un participant existe déjà dans la course avec :
       1. Le même `userId` **OU**
       2. Le même `deviceId` **OU**
       3. Le même `deviceToken` **OU**
       4. Le même pseudo non-anonyme / non-par-défaut (ex. login Garmin configuré).
     - Si une correspondance est trouvée avec un ancien `userId` (ex: précédente tentative avortée ou ID transitoire) :
       - **Remplacer/migrer l'ancien participant** vers le nouvel ID ou réutiliser l'ancien enregistrement.
       - Marquer l'ancienne entrée `Activity` orpheline comme `abandoned` ou supprimer l'ancienne ligne d'eau de `matchedRace.participants`.
       - Réaffecter la ligne d'eau (`lane`) sans en consommer une deuxième.
   - Si un utilisateur envoie plusieurs fois `joinRace` pour la même course publique, la requête est idempotente : elle renvoie son couloir existant sans incrémenter le nombre de coureurs ni créer de doublon.

3. **Protection & Nettoyage côté Frontend (`app.ts` & `regatta-canvas.component.ts`)** :
   - Dans `syncRacersData` et le calcul de `liveMetricsList` :
     - Filtrer les doublons potentiels : s'il existe plusieurs entrées partageant le même `deviceId` ou le même nom non-générique dans les participants non-abandonnés, ne conserver que l'entrée la plus récente / active.
     - Garantir que chaque ligne d'eau (Lane 1, Lane 2, ...) n'a qu'un seul kayak physique.

---

## 3. Plan de travail détaillé (Bite-Sized Tasks)

### Tâche 1 : Garmin Connect IQ - Transmission de `deviceId` et `deviceToken` dans `joinRace`
- **Fichiers :**
  - `garmin/source/RestSyncManager.mc`
  - `garmin/source/BleDelegate.mc`
- **Actions :**
  1. Dans `RestSyncManager.joinRace(userId, userName, action)`, ajouter au payload JSON :
     - `"deviceId" => UserManager.getDeviceId()`
     - `"deviceToken" => UserManager.getDeviceToken()` (si non nul)
  2. S'assurer que `userName` utilise `UserManager.getDisplayPseudo()` pour que le nom configuré soit transmis dès la première tentative.

### Tâche 2 : Backend - Dédoublonnage des participants en course publique (`race.controller.ts` & `race-manager.service.ts`)
- **Fichiers :**
  - `backend/src/controllers/race.controller.ts`
  - `backend/src/services/race-manager.service.ts`
  - `backend/src/controllers/telemetry.controller.ts`
  - `backend/tests/public-race-deduplication.test.js` (nouveau test)
- **Actions :**
  1. Écrire un test vérifiant que 2 appels successifs à `POST /api/race/join` avec le même `deviceId` (ou même `deviceToken` / login) mais 2 `userId` différents (tentatives répétées) ne créent qu'UN seul participant actif dans la course publique.
  2. Dans `race.controller.ts` (`joinRace`) :
     - Extraire `deviceId` et `deviceToken` de la requête.
     - Rechercher dans la course publique en cours si un participant actif (`status != 'abandoned'`) possède déjà ce `deviceId`, ce `deviceToken`, ou ce `userId`.
     - Si trouvé avec un ancien `userId`, clôturer / marquer l'ancienne activité comme `abandoned` et nettoyer `race.participants`, puis rattacher le couloir au participant courant.
  3. Dans `telemetry.controller.ts` (`ingestTelemetry`) :
     - Si un `deviceId` est présent et qu'une autre entrée sans télémétrie active existe pour ce même `deviceId`, la purger pour ne pas dédoubler le kayak.
  4. Exécuter le test unitaire et valider le passage au vert.

### Tâche 3 : Backend - Mécanisme de libération automatique de ligne d'eau
- **Fichiers :**
  - `backend/src/services/race-manager.service.ts`
- **Actions :**
  1. Ajouter une méthode `deduplicatePublicParticipants(race: RaceState, newUserId: string, deviceId?: string, deviceToken?: string, userName?: string)` qui assainit la carte des participants en mémoire et en base de données.
  2. Vérifier que la capacité de la course (`totalParticipants`) reflète fidèlement le nombre réel de coureurs physiques uniques.

### Tâche 4 : Frontend - Détection et filtrage préventif des doublons sur le Canvas
- **Fichiers :**
  - `frontend/src/app/app.ts`
  - `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts`
- **Actions :**
  1. Dans `app.ts` (`liveMetricsList` synchronisation) :
     - Si deux participants portent le même identifiant ou le même `userId` / nom, ne conserver que le plus avancé ou le plus récemment actif.
  2. Dans `regatta-canvas.component.ts` :
     - S'assurer que l'index de couloir `lane` est strictement unique par bateau pour éviter tout chevauchement de kayaks sur la même ligne d'eau.

### Tâche 5 : Validation & Non-régression
- **Actions :**
  1. Exécuter la suite de tests backend (`node --test tests/public-race-deduplication.test.js` et tests d'intégration existants).
  2. Vérifier la compilation TypeScript du backend et du frontend.
  3. Vérifier les scénarios de test Garmin.
