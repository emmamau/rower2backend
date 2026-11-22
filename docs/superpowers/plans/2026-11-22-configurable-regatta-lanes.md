# Configuration des Lignes d'Eau Durant la Course : Données Kayak, Encart Login, Concurrents & Incrustation Géante

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre entièrement configurable l'affichage des données sur les lignes d'eau de la régate : 2 données personnalisables devant/derrière le kayak du joueur avec bascule intelligente, encart login adaptatif (au-dessus ou en-dessous sur la ligne 1) avec métrique choisie, 2 données configurables pour les kayaks concurrents (bots/adversaires), incrustation géante transparente (watermark) au milieu de l'écran sous le kayak du joueur, et application stricte du seuil de dépassement de 5 m pour les changements de lignes d'eau dynamiques.

**Architecture:**
1. **Modèle de données & Persistance (`user.model.ts` frontend et backend)** : Enrichir `RegattaPreferences` avec `myLaneMetrics` [key1, key2], `myLanePosition` ('auto' | 'front' | 'back'), `myHeaderMetric`, `opponentLaneMetrics` [key1, key2], `opponentLanePosition`, `opponentHeaderMetric`, et `watermarkMetric`. Étendre le catalogue avec `chrono` et `spm`. Synchronisation BDD via `rowerService.updateRegattaPreferences` et réplication miroir `localStorage`.
2. **Rendu Canvas du Plan d'Eau (`regatta-canvas.component.ts`)** :
   - Abaisser `OVERTAKE_THRESHOLD_M` de 10 m à 5 m.
   - Incrustation géante transparente (Watermark) : dessinée en couche d'arrière-plan sous les kayaks, fixée horizontalement à 50 % de la largeur du plan d'eau et verticalement calée au centre de la ligne d'eau du joueur connecté.
   - Encart « VOUS : {login} · {data} » : affichage au-dessus par défaut avec flèche pointant vers le bas, et bascule automatique en-dessous avec flèche vers le haut quand le joueur rame sur la ligne 1 (index 0).
   - Données de ligne d'eau joueur & concurrents : rendu de deux badges distincts (ou badge double) positionnés selon la préférence utilisateur ('front', 'back', 'auto'), avec détection des bordures gauche (départ) et droite (arrivée) pour basculer automatiquement de côté si l'espace est insuffisant.
3. **UI de Réglages (`account-modal.component.html`, `regatta-view.component.html`, `i18n`)** :
   - Nouvelle section dédiée « Affichage des lignes d'eau » dans les réglages de régate.
   - Sélecteurs intuitifs des 2 métriques joueur, du positionnement, de la métrique d'encart login, des 2 métriques concurrents, de leur positionnement et de l'incrustation géante.
   - Traductions i18n multilingues complètes (fr, en, de, es, it, pt).

**Tech Stack:** Angular 21 (Canvas 2D HTML5, TypeScript), Node.js (TypeScript, Express, Sequelize/SQLite, Socket.io), node:test.

**Spec:** Directives de l'utilisateur issues de l'échange `/grill-me` :
- 2 données configurables sur la ligne d'eau du joueur, placées devant ou derrière selon la place disponible.
- Encart « VOUS + login » : placé au-dessus par défaut, en-dessous si sur la ligne 1 ; donnée configurable à droite du login.
- 2 données configurables pour les kayaks concurrents (bots/adversaires), avec placement devant/derrière adaptable selon l'espace (début/fin de course).
- Donnée géante en incrustation transparente sous le kayak au milieu de l'écran dans sa ligne d'eau (chrono ou puissance, etc.).
- Seuil de dépassement des lignes d'eau fixé à 5 m d'écart minimum.

## Global Constraints

- Respect absolu de la monotonie de distance : aucun kayak ne doit reculer sur l'eau.
- Préservation des performances à 60 FPS du canvas HTML5 sans allocations superflues dans la boucle de rendu.
- Rétro-compatibilité intégrale avec les préférences utilisateurs existantes.
- Couverture de tests automatisés validée via `node --test`.

---

### Task 1: Modèle de Données & Catalogue des Métriques (Frontend & Backend)

**Files:**
- Modify: `frontend/src/app/models/user.model.ts`
- Modify: `backend/src/models/user.model.ts`
- Modify: `backend/src/controllers/user.controller.ts`
- Create: `frontend/tests/regatta-configurable-lanes.test.mjs`

**Interfaces:**
- Consumes: `RegattaMetricKey`, `RegattaPreferences`
- Produces: `LaneDataPosition = 'auto' | 'front' | 'back'`, `RegattaPreferences` étendu avec `myLaneMetrics`, `myLanePosition`, `myHeaderMetric`, `opponentLaneMetrics`, `opponentLanePosition`, `opponentHeaderMetric`, `watermarkMetric`. Métriques `chrono` et `spm` ajoutées à `REGATTA_METRICS_CATALOG`.

- [ ] **Step 1: Écrire le test unitaire pour les types, le catalogue et la fonction `sanitizeRegattaPreferences`**

Dans `frontend/tests/regatta-configurable-lanes.test.mjs` :
- Vérifier que `REGATTA_METRICS_CATALOG` contient `chrono` et `spm`.
- Vérifier que `sanitizeRegattaPreferences` initialise et valide correctement :
  - `myLaneMetrics` (tableau de 2 clés valides, fallback `['position', 'distRemaining']`).
  - `myLanePosition` ('auto', 'front', 'back', fallback 'auto').
  - `myHeaderMetric` (fallback 'distCovered').
  - `opponentLaneMetrics` (tableau de 2 clés valides, fallback `['distRemaining', 'pace']`).
  - `opponentLanePosition` ('auto', 'front', 'back', fallback 'auto').
  - `opponentHeaderMetric` (fallback 'distCovered').
  - `watermarkMetric` (clé valide ou 'none', fallback 'chrono').

- [ ] **Step 2: Exécuter le test pour constater l'échec attendu**

```powershell
node --test frontend/tests/regatta-configurable-lanes.test.mjs
```

- [ ] **Step 3: Mettre à jour `frontend/src/app/models/user.model.ts`**

- Ajouter `'chrono' | 'spm' | 'none'` à `RegattaMetricKey`.
- Définir `export type LaneDataPosition = 'auto' | 'front' | 'back';`.
- Étendre l'interface `RegattaPreferences`.
- Ajouter les options `chrono` (⏱️, "Chrono", "CHRONO", "Temps écoulé") et `spm` (🚣, "Cadence", "SPM", "Coups par minute", unit "spm") dans `REGATTA_METRICS_CATALOG`.
- Mettre à jour `DEFAULT_REGATTA_PREFERENCES` et `sanitizeRegattaPreferences`.

- [ ] **Step 4: Mettre à jour `backend/src/models/user.model.ts` et `backend/src/controllers/user.controller.ts`**

- Aligner `RegattaMetricKey` et `RegattaPreferences` dans le backend.
- Mettre à jour `sanitizeRegattaPreferences` dans `user.controller.ts` pour préserver et valider ces champs lors de la mise à jour du profil.

- [ ] **Step 5: Valider le test unitaire du modèle**

```powershell
node --test frontend/tests/regatta-configurable-lanes.test.mjs
```

---

### Task 2: Seuil de Dépassement 5 m & Formatage des Métriques dans le Canvas

**Files:**
- Modify: `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts`
- Modify: `frontend/tests/regatta-dynamic-lanes.test.mjs`
- Modify: `frontend/tests/regatta-configurable-lanes.test.mjs`

**Interfaces:**
- Consumes: `RegattaPreferences`, `BoatRenderState`, `LiveRacerMetric`
- Produces: `OVERTAKE_THRESHOLD_M = 5`, méthode `formatMetricValue(key: RegattaMetricKey, boat: BoatRenderState): string`.

- [ ] **Step 1: Mettre à jour le test de seuil de dépassement à 5 m**

Dans `frontend/tests/regatta-dynamic-lanes.test.mjs` :
- Mettre à jour l'assertion pour exiger `OVERTAKE_THRESHOLD_M = 5` (au lieu de 10).

- [ ] **Step 2: Exécuter le test dynamique pour constater l'échec sur le seuil**

```powershell
node --test frontend/tests/regatta-dynamic-lanes.test.mjs
```

- [ ] **Step 3: Modifier `OVERTAKE_THRESHOLD_M` et ajouter `formatMetricValue` dans `regatta-canvas.component.ts`**

- Dans `updateDynamicLanes()` : passer `const OVERTAKE_THRESHOLD_M = 5;`.
- Ajouter la méthode d'aide `public formatMetricValue(key: RegattaMetricKey, boat: BoatRenderState): string` :
  - `speed` : `${((500 / Math.max(1, boat.splitSec)) * 3.6 * (boat.splitSec > 0 ? 1 : 0)).toFixed(1)} km/h` (ou vitesse calculée).
  - `pace` : temps au 500m formaté `m:ss/500m`.
  - `power` : `${Math.round(boat.watts || 0)} W`.
  - `position` : `${rankInfo ? (rankInfo.medal ? rankInfo.medal + ' ' : '') + rankInfo.label : '--'}`.
  - `distToLeader` : `${this.formatGap(boat, leader)}`.
  - `distToPrev` : écart avec le kayak immédiatement devant.
  - `distToNext` : écart avec le kayak immédiatement derrière.
  - `distRemaining` : `${Math.max(0, Math.round(targetDistance - boat.targetPacketDist))}m`.
  - `distCovered` : `${Math.round(boat.targetPacketDist)}m`.
  - `chrono` : temps écoulé de course formaté (`mm:ss`).
  - `spm` : `${Math.round(boat.spm || 0)} spm`.
  - `force` / `work` / `avg*` : valeurs associées formatées.

- [ ] **Step 4: Valider que le test `regatta-dynamic-lanes.test.mjs` passe avec succès**

```powershell
node --test frontend/tests/regatta-dynamic-lanes.test.mjs
```

---

### Task 3: Rendu de l'Incrustation Géante Transparente (Watermark) sous le Kayak

**Files:**
- Modify: `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts`
- Modify: `frontend/tests/regatta-configurable-lanes.test.mjs`

**Interfaces:**
- Consumes: `regattaPreferences.watermarkMetric`, `effectiveLaneIdx`, `cssWidth`, `cssHeight`, `laneH`
- Produces: Rendu en filigrane centré à 50% de la largeur, calé verticalement dans la ligne d'eau du joueur, sous les kayaks.

- [ ] **Step 1: Écrire le test unitaire pour le rendu du Watermark**

Dans `frontend/tests/regatta-configurable-lanes.test.mjs` :
- Vérifier que `drawCanvasScene()` calcule la position Y de la ligne d'eau du joueur actif et dessine le texte au milieu de l'écran avec une opacité légère (`rgba(0, 240, 255, 0.16)` ou similaire) lorsque `watermarkMetric !== 'none'`.

- [ ] **Step 2: Implémenter le dessin du Watermark dans `regatta-canvas.component.ts`**

Dans `drawCanvasScene()`, juste avant la boucle de dessin des kayaks (étape 3.5) :
- Si un joueur actif est présent et que `this.regattaPreferences?.watermarkMetric && this.regattaPreferences.watermarkMetric !== 'none'` :
  - Trouver le bateau du joueur actif et calculer son `effectiveLaneIdx`.
  - Calculer `watermarkY = topOffset + (effectiveLaneIdx + 0.5) * laneH - this.scrollY`.
  - Vérifier que `watermarkY` est visible à l'écran.
  - Formater la valeur choisie via `formatMetricValue(watermarkMetric, activeBoat)`.
  - Configurer `ctx.font = 'bold ${watermarkFontPx}px monospace'`, `ctx.textAlign = 'center'`, `ctx.textBaseline = 'middle'`.
  - Définir `ctx.fillStyle = 'rgba(0, 240, 255, 0.16)'` (ou glow subtil).
  - Dessiner le texte géant centré à `x = w * 0.5`, `y = watermarkY`.

- [ ] **Step 3: Vérifier le passage du test**

```powershell
node --test frontend/tests/regatta-configurable-lanes.test.mjs
```

---

### Task 4: Encart « VOUS : {login} » Adaptatif & Données de Lignes d'Eau

**Files:**
- Modify: `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts`
- Modify: `frontend/tests/regatta-configurable-lanes.test.mjs`

**Interfaces:**
- Consumes: `myHeaderMetric`, `myLaneMetrics`, `myLanePosition`, `opponentHeaderMetric`, `opponentLaneMetrics`, `opponentLanePosition`
- Produces: Positionnement haut/bas de l'encart login (bascule en-dessous si ligne 1), bascule dynamique avant/arrière des données de ligne d'eau avec détection des bordures.

- [ ] **Step 1: Écrire les assertions de test pour l'encart adaptatif et les données de ligne d'eau**

Dans `frontend/tests/regatta-configurable-lanes.test.mjs` :
- Vérifier que pour la ligne 1 (index 0), la flèche et la bannière du joueur sont inversées et positionnées en-dessous (`y + hullRy + ...`).
- Vérifier que le texte de bannière joueur utilise `myHeaderMetric`.
- Vérifier que le label des concurrents utilise `opponentHeaderMetric`.
- Vérifier l'algorithme de positionnement des données de ligne d'eau (détection de l'espace devant et bascule derrière si trop près du bord droit, et inversement au départ).

- [ ] **Step 2: Implémenter l'encart adaptatif pour le joueur connecté**

Dans `regatta-canvas.component.ts` :
- Détecter si l'encart doit être positionné en-dessous : `const isBelow = effectiveLaneIdx === 0 || (y - 32 < topOffset);`.
- Si `isBelow` :
  - Flèche inversée pointant vers le haut à `y + hullRy + 8 * boatScale`.
  - Fond et texte de bannière placés en-dessous à `y + hullRy + 22 * boatScale`.
- Si `!isBelow` : conserver le positionnement au-dessus actuel.
- Remplacer la distance en dur par la métrique choisie `myHeaderMetric` (ex: `formatMetricValue(myHeaderMetric, boat)`).

- [ ] **Step 3: Implémenter l'affichage des 2 données de ligne d'eau (Joueur et Concurrents)**

Dans `regatta-canvas.component.ts` :
- Récupérer les 2 métriques à afficher : `isUser ? myLaneMetrics : opponentLaneMetrics`.
- Récupérer la position préférentielle : `isUser ? myLanePosition : opponentLanePosition`.
- Déterminer si les badges doivent être placés devant ou derrière :
  - Calculer `frontX` et `backX`.
  - Si position = 'auto' : privilégier devant, sauf si `frontX + totalBadgeW > w - 10`, basculer derrière (`x - hullRx - gap - totalBadgeW`). Si au départ `backX < 10`, basculer devant.
  - Si position = 'front' : placer devant, basculer derrière si manque de place à droite.
  - Si position = 'back' : placer derrière, basculer devant si manque de place à gauche.
- Dessiner les deux badges de données lisibles et stylisés avec liseré contrasté.

- [ ] **Step 4: Exécuter le test de validation du canvas**

```powershell
node --test frontend/tests/regatta-configurable-lanes.test.mjs
```

---

### Task 5: Interface de Configuration dans `account-modal`, `regatta-view` & `i18n`

**Files:**
- Modify: `frontend/src/app/components/modals/account-modal/account-modal.component.html`
- Modify: `frontend/src/app/components/modals/account-modal/account-modal.component.ts`
- Modify: `frontend/src/app/components/regatta-view/regatta-view.component.html`
- Modify: `frontend/src/app/components/regatta-view/regatta-view.component.ts`
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/app.html`
- Modify: `frontend/src/app/i18n/locales/*.ts` (fr, en, de, es, it, pt)
- Modify: `frontend/tests/regatta-configurable-lanes.test.mjs`

**Interfaces:**
- Consumes: `regattaPreferences: RegattaPreferences`, `regattaMetricsCatalog: RegattaMetricOption[]`
- Produces: Section UI interactive dans l'onglet `regatta-settings` avec sélecteurs de métriques et positions, boutons radio/pills élégants, sauvegarde automatique et persistante.

- [ ] **Step 1: Écrire le test d'intégration UI vérifiant les contrôles de configuration**

Dans `frontend/tests/regatta-configurable-lanes.test.mjs` :
- Vérifier la présence des sections « Ma Ligne d'eau », « Kayaks Concurrents » et « Incrustation Géante » dans `account-modal.component.html`.
- Vérifier la présence des clés de traduction dans `fr.ts` et `en.ts`.
- Vérifier que `app-regatta-canvas` reçoit `[regattaPreferences]="regattaPreferences"` depuis `regatta-view`.

- [ ] **Step 2: Ajouter les traductions i18n dans les 6 langues**

Dans `frontend/src/app/i18n/locales/` (`fr.ts`, `en.ts`, `de.ts`, `es.ts`, `it.ts`, `pt.ts`) :
- Ajouter les clés pour les métriques `chrono` et `spm`.
- Ajouter les libellés de configuration :
  - `REGATTA_LANE_CONFIG_TITLE` : "Configuration des Lignes d'Eau"
  - `REGATTA_MY_LANE_TITLE` : "Ma Ligne d'Eau (Mon Kayak)"
  - `REGATTA_MY_METRIC_1` : "Donnée 1 (Ligne d'eau)"
  - `REGATTA_MY_METRIC_2` : "Donnée 2 (Ligne d'eau)"
  - `REGATTA_POSITION_PREF` : "Positionnement des données"
  - `REGATTA_POS_AUTO` : "Auto (selon espace)"
  - `REGATTA_POS_FRONT` : "Devant le kayak"
  - `REGATTA_POS_BACK` : "Derrière le kayak"
  - `REGATTA_MY_HEADER_METRIC` : "Donnée dans l'encart VOUS"
  - `REGATTA_OPPONENTS_TITLE` : "Lignes d'Eau Concurrents (Bots & Adversaires)"
  - `REGATTA_OPPONENTS_METRIC_1` : "Donnée 1 concurrents"
  - `REGATTA_OPPONENTS_METRIC_2` : "Donnée 2 concurrents"
  - `REGATTA_OPPONENTS_HEADER_METRIC` : "Donnée à droite du nom adverse"
  - `REGATTA_WATERMARK_TITLE` : "Incrustation Géante Transparente (Watermark)"
  - `REGATTA_WATERMARK_DESC` : "Donnée affichée en grand format au milieu de l'écran dans votre ligne d'eau"
  - `REGATTA_WATERMARK_NONE` : "Aucune (désactivée)"

- [ ] **Step 3: Mettre en place l'UI dans `account-modal.component.html` & `.ts`**

- Dans l'onglet `regatta-settings` :
  - Ajouter la section « Affichage des lignes d'eau » structurée en 3 blocs clairs :
    1. *Mon Kayak & Ma Ligne d'eau* (2 sélecteurs de métriques, toggle de position Devant / Derrière / Auto, sélecteur de donnée dans l'encart login).
    2. *Kayaks Concurrents* (2 sélecteurs de métriques, toggle de position Devant / Derrière / Auto, sélecteur de donnée à côté du nom).
    3. *Incrustation Géante Transparente* (sélecteur de métrique ou désactivé).
  - Émettre les changements vers `app.ts` pour persistance automatique dans `UserProfile` et `localStorage`.

- [ ] **Step 4: Propager les préférences vers `regatta-canvas.component.ts` via `regatta-view`**

- Dans `regatta-view.component.ts` : ajouter `@Input() regattaPreferences?: RegattaPreferences`.
- Dans `regatta-view.component.html` : binder `[regattaPreferences]="regattaPreferences"` sur `<app-regatta-canvas>`.
- Dans `app.html` : passer `[regattaPreferences]="userRegattaPreferences"` à `app-regatta-view`.

- [ ] **Step 5: Valider le test d'intégration UI**

```powershell
node --test frontend/tests/regatta-configurable-lanes.test.mjs
```

---

### Task 6: Exécution de la Suite de Tests & Vérification Globale

**Files:**
- Test: `frontend/tests/regatta-configurable-lanes.test.mjs`
- Test: `frontend/tests/regatta-dynamic-lanes.test.mjs`
- Test: `frontend/tests/full-i18n-multilang.test.mjs`
- Test: `frontend/tests/app-features.test.mjs`

- [ ] **Step 1: Exécuter l'ensemble des tests frontend**

```powershell
npm --prefix frontend test
```

- [ ] **Step 2: Vérifier le build frontend**

```powershell
npm --prefix frontend run build
```

- [ ] **Step 3: Vérifier l'absence d'erreurs TypeScript et la conformité git status**

```powershell
git status --short
```
