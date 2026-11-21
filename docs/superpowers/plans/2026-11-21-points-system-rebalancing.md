# Système de Points Équilibré : Motivation à la Course, Bonus Adversaire Capé & Multiplicateur de Peloton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rééquilibrer le système d'attribution des points pour encourager l'activité de course : valoriser l'entraînement Solo/Bot (10 pts victoire / 5 pts finisher, max 3/jour), récompenser les victoires en Duel contre des joueurs plus capés (+25 pts ligue supérieure, +15 pts palmarès supérieur), et appliquer un barème multijoueur proportionnel simple (Base 10 + 10 par rameur battu + Bonus Podium, majoré de +25% si peloton > 4 participants), avec affichage décomposé des gains.

**Architecture:**
1. Côté Core Logic (`backend/src/utils/league.util.ts`) : refondre `calculateRacePointsEarned` et ajouter `calculateRacePointsBreakdown` pour calculer de manière déterministe les points et leur détail textuel/structuré (Base, Classement, Podium, Bonus Adversaire Capé, Multiplicateur Peloton).
2. Côté Contrôleurs Backend (`telemetry.controller.ts`, `activity.controller.ts`, `race.controller.ts`) : lors de l'enregistrement de fin de course, récupérer les informations de profil de l'adversaire en duel (Ligue et victoires) pour alimenter le calcul de points, et stocker/transmettre `pointsEarned` et `pointsBreakdown`.
3. Côté Frontend (`frontend/src/app/utils/league.util.ts`, `app.ts`, `regatta-view.component.html`) : synchroniser la logique utilitaire de calcul des points, afficher la décomposition des points dans le toast d'arrivée et enrichir le tableau de classement de fin de course avec le détail des points gagnés.

**Tech Stack:** Node.js (TypeScript, Sequelize/PostgreSQL/SQLite, Express), Angular 21 (TypeScript, HTML5), suites de tests `node:test`.

**Spec:** Directives validées lors de la phase d'alignement `/grill-me` :
- **Intégrité sportive :** 0 point si DNF / abandon.
- **Solo & Duel Bot :** 10 points si victoire, 5 points si défaite/finisher. Plafond maintenu à 3 courses bot rémunérées par jour (0 pt au-delà).
- **Duels 1v1 Humains :**
  - Base perdant : 10 points.
  - Vainqueur standard : 40 points (10 base + 10 battu + 20 podium 1er).
  - Bonus Prestige en cas de Victoire contre un joueur plus capé :
    - +25 points si l'adversaire est d'une ligue supérieure (ex : Bronze battant Argent ou Or, Argent battant Or).
    - +15 points si l'adversaire possède un palmarès de victoires supérieur (total victoires supérieur).
- **Courses Multijoueurs :**
  - Base de participation : 10 points pour tout finisher.
  - Rameurs battus : +10 points par concurrent arrivé derrière soi.
  - Bonus Podium : 1er: +20 pts, 2e: +10 pts, 3e: +5 pts.
  - Multiplicateur de peloton : si participants > 4, multiplier le total par 1,25 (+25%).
- **Transparence UX :** Affichage décomposé des points gagnés à l'arrivée.

## Global Constraints

- Rétrocompatibilité : les fonctions historiques `calculateRacePoints` et les colonnes de base de données (`points_earned`, `points`, `weekly_points`, `total_career_points`) doivent rester intactes.
- Aucun calcul à virgule flottante non arrondi : les points finaux doivent être systématiquement arrondis avec `Math.round()` et être `>= 0`.
- Zéro régression sur les classements de ligue hebdomadaires et les tests existants.

---

### Task 1: Refonte du moteur de calcul des points dans `backend/src/utils/league.util.ts`

**Files:**
- Modify: `backend/src/utils/league.util.ts`
- Create: `backend/tests/points-system-rebalanced.test.js`

**Interfaces:**
- Consumes:
  ```typescript
  export interface CalculateRacePointsOptions {
    raceMode: "BOT" | "SOLO" | "DUEL_1V1" | "MULTIPLAYER" | "RACE" | string;
    playerRank: number;
    totalHumanFinishers?: number;
    isFinisher?: boolean;
    isDnf?: boolean;
    todayRewardedBotRacesCount?: number;
    // Nouveaux paramètres pour évaluer l'enjeu et les duels :
    playerLeagueTier?: "BRONZE" | "SILVER" | "GOLD" | string;
    playerWins?: number;
    opponentLeagueTier?: "BRONZE" | "SILVER" | "GOLD" | string;
    opponentWins?: number;
  }
  ```
- Produces:
  ```typescript
  export interface PointsBreakdown {
    basePoints: number;
    rankPoints: number;
    podiumBonus: number;
    higherRankedBonus: number;
    pelotonMultiplier: number;
    totalPoints: number;
    description: string;
  }
  export function calculateRacePointsBreakdown(options: CalculateRacePointsOptions): PointsBreakdown;
  export function calculateRacePointsEarned(options: CalculateRacePointsOptions): number;
  ```

- [ ] **Step 1: Écrire les tests unitaires pour chaque règle du nouveau système**

Créer `backend/tests/points-system-rebalanced.test.js` avec les cas de test :
1. DNF / Abandon = 0 point.
2. Mode BOT / SOLO :
   - Victoire (1er) = 10 points.
   - Défaite / Finisher (2e+) = 5 points.
   - Plafond dépassé (>= 3 courses bot aujourd'hui) = 0 point.
3. Duel 1v1 standard :
   - Perdant (2e) = 10 points.
   - Vainqueur (1er) = 40 points (10 base + 10 battu + 20 podium).
4. Duel 1v1 contre joueur plus capé :
   - Vainqueur Bronze battant adversaire Argent : 40 + 25 = 65 points.
   - Vainqueur Bronze battant adversaire Or avec plus de victoires : 40 + 25 (ligue) + 15 (palmarès) = 80 points.
   - Perdant contre joueur plus capé : 10 points (pas de pénalité, base de participation).
5. Multijoueur petit peloton (<= 4 participants, ex: 4 joueurs) :
   - 1er : (10 + 3*10 + 20) * 1.0 = 60 points.
   - 2e : (10 + 2*10 + 10) * 1.0 = 40 points.
   - 3e : (10 + 1*10 + 5) * 1.0 = 25 points.
   - 4e : (10 + 0*10 + 0) * 1.0 = 10 points.
6. Multijoueur grand peloton (> 4 participants, ex: 6 joueurs, multiplicateur 1.25) :
   - 1er : Math.round((10 + 5*10 + 20) * 1.25) = Math.round(80 * 1.25) = 100 points.
   - 2e : Math.round((10 + 4*10 + 10) * 1.25) = Math.round(60 * 1.25) = 75 points.
   - 6e : Math.round(10 * 1.25) = 13 points.
7. Validation de la chaîne descriptive `description` dans `PointsBreakdown`.

- [ ] **Step 2: Exécuter les tests pour constater les échecs attendus**

```powershell
node --test backend/tests/points-system-rebalanced.test.js
```
Vérifier que les tests échouent car les nouvelles options et formules ne sont pas encore codées.

- [ ] **Step 3: Implémenter le calcul revalorisé et `calculateRacePointsBreakdown` dans `backend/src/utils/league.util.ts`**

Dans `backend/src/utils/league.util.ts` :
1. Enrichir `CalculateRacePointsOptions` avec les champs `playerLeagueTier`, `playerWins`, `opponentLeagueTier`, `opponentWins`.
2. Implémenter `calculateRacePointsBreakdown(options)` :
   - Traiter DNF : total 0, description "Abandon / DNF".
   - Traiter BOT / SOLO :
     - Si `todayRewardedBotRacesCount >= 3` : total 0, description "Plafond bot atteint (max 3/jour)".
     - Si 1er : base 10, total 10, description "+10 pts : Victoire contre bot".
     - Sinon : base 5, total 5, description "+5 pts : Entraînement bot terminé".
   - Traiter DUEL_1V1 :
     - Base : 10 pts.
     - Si 1er : rankPoints = 10, podiumBonus = 20.
       - Comparer les ligues : Or (3) > Argent (2) > Bronze (1). Si `opponentTierVal > playerTierVal` : `higherRankedBonus += 25`.
       - Comparer les palmarès : si `opponentWins > playerWins` : `higherRankedBonus += 15`.
       - Total = 10 + 10 + 20 + higherRankedBonus.
     - Si 2e : total = 10 pts.
   - Traiter MULTIPLAYER :
     - Base = 10 pts.
     - RankPoints = `Math.max(0, (totalHumanFinishers - playerRank) * 10)`.
     - PodiumBonus = 1er: 20, 2e: 10, 3e: 5, autre: 0.
     - Multiplier = `totalHumanFinishers > 4 ? 1.25 : 1.0`.
     - Total = `Math.round((basePoints + rankPoints + podiumBonus) * multiplier)`.
3. Faire déléguer `calculateRacePointsEarned(options)` à `calculateRacePointsBreakdown(options).totalPoints`.

- [ ] **Step 4: Exécuter les tests unitaires pour confirmer le passage au vert**

```powershell
node --test backend/tests/points-system-rebalanced.test.js
```
Vérifier que tous les cas de tests passent avec succès.

- [ ] **Step 5: Valider et commiter**

```powershell
git add backend/src/utils/league.util.ts backend/tests/points-system-rebalanced.test.js
git commit -m "feat(points): rebalance race points formula with bot training, peloton multiplier, and capped opponent bonus"
```

---

### Task 2: Intégration du profil adverse et persistance du breakdown dans les contrôleurs backend

**Files:**
- Modify: `backend/src/controllers/telemetry.controller.ts`
- Modify: `backend/src/controllers/activity.controller.ts`
- Modify: `backend/src/controllers/race.controller.ts`

**Interfaces:**
- Consumes: `userStore.findUser()`, `calculateRacePointsBreakdown()`, `Activities.update()`
- Produces: Points calculés avec contexte de l'adversaire (ligue/victoires) et `pointsBreakdown` retourné dans les réponses de classement / telemetry.

- [ ] **Step 1: Écrire le test d'intégration pour le duel avec adversaire capé dans `backend/tests/duel-points-integration.test.js`**

Créer `backend/tests/duel-points-integration.test.js` :
- Créer deux utilisateurs : Joueur A (Bronze, 2 victoires) et Joueur B (Or, 25 victoires).
- Simuler la fin d'une course duel 1v1 où le Joueur A bat le Joueur B.
- Vérifier que les points attribués au Joueur A sont de 80 points (40 base/podium + 25 ligue supérieure + 15 palmarès supérieur).
- Vérifier que le Joueur B (perdant) reçoit 10 points.

- [ ] **Step 2: Lancer le test pour constater l'échec**

```powershell
node --test backend/tests/duel-points-integration.test.js
```
Vérifier que le test échoue car le contrôleur ne passait pas les informations de l'adversaire.

- [ ] **Step 3: Mettre à jour `telemetry.controller.ts` et `activity.controller.ts`**

Dans `backend/src/controllers/telemetry.controller.ts` et `backend/src/controllers/activity.controller.ts` :
1. Identifier si la course est un duel 1v1 humain (`rMode === "DUEL_1V1" || (humanFinishers === 2 && !hasBots)`).
2. Si duel 1v1, extraire l'autre participant humain :
   - Récupérer son objet utilisateur (`userStore.findUser(opponentId)` ou DB).
   - Déterminer `opponentLeagueTier` (`opponent.league` ou déduit de ses points) et `opponentWins` (`opponent.totalWins || 0`).
   - Déterminer `playerLeagueTier` et `playerWins` pour le joueur actif.
3. Passer ces variables à `calculateRacePointsBreakdown` / `calculateRacePointsEarned`.
4. Sauvegarder `points` et `pointsEarned` sur l'activité.
5. Inclure `pointsBreakdown: breakdown.description` dans la réponse de télémétrie de fin de course.

- [ ] **Step 4: Mettre à jour `race.controller.ts` pour inclure les points et breakdown dans le classement**

Dans `backend/src/controllers/race.controller.ts` :
- S'assurer que `getRaceLeaderboard` renvoie les points calculés cohérents avec la nouvelle formule et le champ `pointsBreakdown` s'il est présent sur l'activité ou calculé à la volée.

- [ ] **Step 5: Exécuter les tests d'intégration et recompiler le backend**

```powershell
node --test backend/tests/duel-points-integration.test.js
npm --prefix backend run build
```
Vérifier que le test d'intégration passe et que la compilation TypeScript est propre.

- [ ] **Step 6: Valider et commiter**

```powershell
git add backend/src/controllers/telemetry.controller.ts backend/src/controllers/activity.controller.ts backend/src/controllers/race.controller.ts backend/tests/duel-points-integration.test.js
git commit -m "feat(telemetry): inject opponent league and wins context for duel points calculation"
```

---

### Task 3: Alignement frontend et affichage décomposé des points à l'arrivée

**Files:**
- Modify: `frontend/src/app/utils/league.util.ts`
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/components/regatta-view/regatta-view.component.html`
- Modify: `frontend/src/app/components/modals/race-history-modal/race-history-modal.component.html`
- Create: `frontend/tests/points-display.test.mjs`

**Interfaces:**
- Consumes: `pointsEarned`, `pointsBreakdown`, `triggerFinishToast`
- Produces: Toast d'arrivée valorisant les points avec le détail et colonne explicative dans le tableau de classement.

- [ ] **Step 1: Écrire le test unitaire frontend dans `frontend/tests/points-display.test.mjs`**

Créer `frontend/tests/points-display.test.mjs` :
- Vérifier que `frontend/src/app/utils/league.util.ts` exporte `calculateRacePointsBreakdown` avec la même logique que le backend.
- Vérifier que `triggerFinishToast` ou l'overlay de fin de course formate le message en incluant les points gagnés (ex: `+75 pts : ...`).
- Vérifier que le template HTML du classement affiche le badge de points et le détail descriptif au survol ou sous le score.

- [ ] **Step 2: Exécuter le test frontend pour constater l'échec**

```powershell
node --test frontend/tests/points-display.test.mjs
```
Vérifier l'échec attendu.

- [ ] **Step 3: Mettre à jour `frontend/src/app/utils/league.util.ts` et `app.ts`**

Dans `frontend/src/app/utils/league.util.ts` :
- Synchroniser l'implémentation de `calculateRacePointsBreakdown` et `CalculateRacePointsOptions`.

Dans `frontend/src/app/app.ts` :
- Lors du franchissement de ligne (`this.finisherCount` / `isMe`) :
  - Calculer ou récupérer le détail des points gagnés.
  - Enrichir le message du toast :
    ```typescript
    const toastMsg = `${medal} : ${racer.name} - ${formattedChrono} - Ligne franchie ! (+${pointsEarned} pts)`;
    ```
  - Exposer `lastRacePointsBreakdown` pour la bannière ou célébration d'arrivée.

Dans `frontend/src/app/components/regatta-view/regatta-view.component.html` et `race-history-modal.component.html` :
- Dans la colonne "Points" du tableau de classement, afficher la valeur en gras avec une infobulle `[title]="entry.pointsBreakdown || ''"`.

- [ ] **Step 4: Exécuter le test unitaire frontend**

```powershell
node --test frontend/tests/points-display.test.mjs
```
Vérifier le succès du test.

- [ ] **Step 5: Valider et commiter**

```powershell
git add frontend/src/app/utils/league.util.ts frontend/src/app/app.ts frontend/src/app/components/regatta-view/regatta-view.component.html frontend/src/app/components/modals/race-history-modal/race-history-modal.component.html frontend/tests/points-display.test.mjs
git commit -m "feat(ui): display detailed points breakdown in finish toast and race rankings"
```

---

### Task 4: Validation de non-régression et recette complète

**Files:**
- Test verification: `backend/tests/`
- Test verification: `frontend/tests/`

- [ ] **Step 1: Exécuter les tests existants sur les ligues et points**

```powershell
node --test backend/tests/points-system-rebalanced.test.js backend/tests/duel-points-integration.test.js backend/tests/security-and-hardening.test.js
node --test frontend/tests/points-display.test.mjs
```
Vérifier que tous les tests spécifiques aux points passent avec 0 erreur.

- [ ] **Step 2: Exécuter la suite complète de tests backend**

```powershell
npm --prefix backend test
```
Vérifier que les 20+ suites de tests backend s'exécutent proprement.

- [ ] **Step 3: Vérifier le statut git final**

```powershell
git status
```
S'assurer que l'arbre de travail est propre et sans fichiers parasites.
