# Spécification Technique & Conception : Gestion de la Course par Défaut

- **Date :** 25 novembre 2026
- **Auteur :** Antigravity & Équipe Rower Race
- **Statut :** Validé / En attente d'implémentation
- **Dépôt :** `rower2backend` (Backend Express, Frontend Angular 21, App Garmin Connect IQ)

---

## 1. Contexte & Objectifs

Par défaut, l'application Rower Race affiche sur le front web la « course publique » (régate collective cyclique pilotée par le `RaceManager`).
Ce document formalise la gestion d'une **course par défaut personnalisée** qui se substitue temporairement à la course publique dans deux scénarios précis :

1. **Cas A (Engagement direct)** : Le joueur a saisi le code PIN d'une course (sur le web ou sur sa montre Garmin) et son kayak a été engagé sur une ligne d'eau.
2. **Cas B (Course imminente)** : Le système détecte qu'une course à laquelle le joueur est associé (salon privé ou duel confirmé) va bientôt commencer (départ dans $\le 15$ minutes ou salon déjà ouvert).

Cette course par défaut reste active jusqu'à ce que :
- Le joueur ait franchi la ligne d'arrivée, consulté son classement / podium final et décidé explicitement de **quitter le salon** (ou « Retour aux courses publiques ») ;
- **OU** le joueur ait **abandonné** la course (action manuelle, arrêt de la montre ou timeout d'inactivité).

Dès la sortie ou l'abandon, l'application réactive immédiatement et automatiquement la course publique comme course par défaut.

---

## 2. Architecture Globale & Flux de Données

```
                       ┌───────────────────────────────────────────────┐
                       │          Montre Garmin Connect IQ             │
                       │   - Saisie Code PIN (ex: 4829)               │
                       │   - Télémétrie BLE FTMS (Watts, SPM, Allure)  │
                       └───────────────────────┬───────────────────────┘
                                               │ POST /api/rooms/join (PIN)
                                               ▼
┌─────────────────────────┐             ┌───────────────────────────────────────────────┐
│       Navigateur        │◄──Socket.io─┤             Serveur Backend Node.js           │
│    Front Web Angular    │  Événements │   - RaceManager (RAM + Postgres)              │
│                         ├─HTTP REST──►│   - GET /api/v1/races/my-active               │
│ - Course par défaut     │             │   - Détection départ imminent (<= 15 min)     │
│ - Encart PIN Montre     │             │   - Maintien statut jusqu'à leaveRoom/abandon │
│ - Vue Régate / Salon    │             └───────────────────────────────────────────────┘
└─────────────────────────┘
```

---

## 3. Spécifications Détaillées

### 3.1. Côté Backend

#### A. Extension de `findActiveRaceForUser` (`backend/src/services/race-manager.service.ts`)
La méthode `findActiveRaceForUser(userId?: string, deviceToken?: string): RaceState | null` est enrichie pour évaluer deux sources de courses :

1. **Courses actives ou terminées non quittées** :
   - Recherche dans `this.privateRacesById.values()`.
   - Correspondance avec `cleanUserId` ou `cleanToken` dans `race.participants`, `race.pendingParticipants`, ou `race.hostUserId`.
   - **Condition de persistance post-course** : Si `race.status === "COMPLETED"` ou `"FINISHED"`, la course reste retournée tant que le coureur concerné n'a pas quitté le salon (`participant.hasLeft !== true`) et n'a pas abandonné (`participant.status !== "abandoned"`).
   - Exclusion si le coureur a le statut `"abandoned"`.

2. **Courses programmées imminentes ($\le 15$ min)** :
   - Parcours des salons privés programmés (`startMode === "scheduled"` avec `scheduledStartTime`) et des duels confirmés (`DuelChallenges` avec statut `ACCEPTED` ou `PENDING` où l'utilisateur est le challenger ou le défié).
   - Calcul du délai avant le départ : $0 \le (\text{heureDépart} - \text{Date.now()}) \le 15 \times 60 \times 1000$ ms (ou salon déjà déverrouillé 5 min avant).
   - Si plusieurs courses sont éligibles, priorité est donnée à celle dont le départ est **le plus proche chronologiquement**.

#### B. Enrichissement du Payload `/api/v1/races/my-active` (`backend/src/controllers/telemetry.controller.ts`)
La réponse JSON de `GET /api/v1/races/my-active` renvoie :
```json
{
  "activeRoom": {
    "race": {
      "id": "PRIV_ABC123",
      "title": "Duel 1v1 ou Salon Privé",
      "status": "LOBBY",
      "targetDistance": 2000,
      "pinCode": "4829",
      "code": "krm-wzx-qpl",
      "scheduledStartTime": "2026-11-25T19:00:00.000Z"
    },
    "isDefaultRace": true,
    "isAwaitingWatchPin": true,
    "hasPlayerJoinedWaterLane": false,
    "pinCode": "4829"
  }
}
```
- `isAwaitingWatchPin` : `true` si le joueur fait partie de la course mais n'a pas encore de ligne d'eau confirmée avec montre connectée (`isPaired` ou `lane` assignée).

#### C. Notification de Sortie & Abandon (`backend/src/controllers/room.controller.ts`)
- `POST /api/rooms/:identifier/leave` : marque le participant comme `hasLeft = true` et libère son couloir.
- En cas d'abandon (via arrêt télémétrie montre ou API `POST /api/rooms/:identifier/abandon`), le statut passe à `abandoned`.
- Les appels suivants à `findActiveRaceForUser` ignorent cette course, rétablissant la course publique.

---

### 3.2. Côté Frontend (Angular 21)

#### A. Initialisation & Résolution de la Course par Défaut (`frontend/src/app/app.ts`)
- Lors de l'initialisation (`ngOnInit`) et après identification utilisateur ou appairage de montre :
  - Appel systématique de `rowerService.getMyActiveRace(this.activeUserId, this.deviceToken)`.
  - Si une `activeRoom` est renvoyée :
    - Activation du salon : `this.activatePrivateRoom(activeRoom, false, false)`.
    - Sauvegarde locale pour résilience : `localStorage.setItem('rower_active_private_room_id', activeRoom.race.id)`.
    - Bascule vers la vue Régate : `this.setSiteView('regatta')`.
    - Le salon privé ou duel remplace la course publique en tant que vue par défaut.

#### B. Encart d'Invitation PIN Montre (`frontend/src/app/components/race-overlays/`)
- Si `isAwaitingWatchPin === true` (kayak non encore engagé) :
  - Affichage direct sur le plan d'eau d'un encart visible et centré :
    - Badge : `⌚ CODE PIN MONTRE GARMIN`.
    - Code PIN affiché en très grand format (ex: `4829` ou `K9B2D`).
    - Instruction : *« Saisissez ce code PIN sur votre montre Garmin pour engager votre kayak sur votre ligne d'eau. »*
    - Émission d'un son d'invitation discret (Web AudioContext).
    - Compte à rebours avant départ de la régate.

#### C. Réception de l'Engagement du Kayak
- Dès que le joueur saisit le code sur sa montre ou confirme sur le web :
  - Réception de l'événement WebSocket `PARTICIPANT_JOINED` / confirmation HTTP.
  - Exécution de `installKayakOnWaterLane(...)` :
    - Attribution du numéro de ligne d'eau.
    - Fermeture automatique de l'encart d'invitation PIN.
    - Affichage du kayak du joueur au ponton de départ.
    - Toast de confirmation : *« Kayak installé sur la ligne X — Prêt pour le départ ! »*.

#### D. Bouton Discret « Aperçu Course Publique » (`frontend/src/app/components/app-header/`)
- Dans l'en-tête, lorsque la course par défaut est un salon privé ou un duel :
  - Présence d'un bouton discret *« 👁️ Aperçu course publique »*.
  - Permet d'ouvrir temporairement la course publique en mode spectateur sans quitter son salon.
  - Présence d'un bandeau de rappel avec bouton *« ↩️ Revenir à mon salon »*.

#### E. Fin de Course & Consultation du Classement
- Dès franchissement de la ligne (`currentDistance >= targetDistance`) :
  - Statut coureur `'finished'`.
  - Ouverture de la modale du classement complet et podium.
  - La course par défaut **reste active** même si le joueur ferme la modale pour observer le plan d'eau ou recharge sa page web.
  - Présence du bouton explicite : **« 🚪 Quitter le salon & Retour aux courses publiques »**.
  - Au clic :
    1. Appel à `rowerService.leaveRoom(roomId, userId)`.
    2. Nettoyage de `rower_active_private_room_id` dans `localStorage`.
    3. Exécution de `exitPrivateRoomToPublic(true)`.
    4. Réactivation de la course publique comme course par défaut.

#### F. Gestion de l'Abandon (DNF)
- Si le joueur abandonne (via le web, arrêt montre, ou timeout d'inactivité) :
  - Statut passé à `'abandoned'`.
  - Affichage d'un encart récapitulatif DNF (distance parcourue, temps) avec le bouton *« Retour aux courses publiques »*.
  - Après 5 secondes (ou au clic sur le bouton) : retour automatique à la course publique.

---

## 4. Stratégie de Vérification & Tests

### Tests Backend (`backend/tests/`)
1. **Détection course imminente** : Créer un salon programmé débutant dans 10 minutes pour un utilisateur. Vérifier que `findActiveRaceForUser` le renvoie avec `isAwaitingWatchPin: true`.
2. **Priorité temporelle** : Créer deux courses pour le même utilisateur (début dans 5 min et dans 12 min). Vérifier que la course de 5 min est sélectionnée en premier.
3. **Persistance post-arrivée** : Passer une course au statut `COMPLETED`. Vérifier qu'elle est toujours renvoyée tant que le joueur n'a pas appelé `leaveRoom`.
4. **Exclusion après départ/abandon** : Vérifier qu'après appel à `leaveRoom` ou marquage `abandoned`, `findActiveRaceForUser` renvoie `null`.
5. **Validation HTTP** : Tester `GET /api/v1/races/my-active` avec et sans course associée.

### Tests Frontend (`frontend/tests/`)
1. **Remplacement par défaut** : Simuler `getMyActiveRace` renvoyant une course active. Vérifier que le front bascule en vue Régate sur ce salon et non sur la course publique.
2. **Affichage de l'invitation PIN** : Vérifier que l'encart PIN s'affiche tant que le kayak n'est pas engagé.
3. **Engagement du kayak** : Émettre `PARTICIPANT_JOINED` et vérifier la disparition de l'encart et l'affichage du toast avec le numéro de couloir.
4. **Persistance au rechargement après l'arrivée** : Simuler un rechargement avec course terminée et vérifier le maintien du salon avec le classement.
5. **Sortie explicite & Abandon** : Vérifier que le clic sur « Quitter le salon » ou un abandon réactive la course publique.
