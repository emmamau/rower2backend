# Améliorations Vue Régate : Distance Restante Tous Kayaks, Stabilité Nom Bot & Hystérésis Lignes 5m

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajuster la vue régate pour afficher la distance restante devant chaque kayak (avec bascule automatique derrière si l'espace restant devant est insuffisant), supprimer l'intermittence de nom du bot entre "Bot Régulier" et "Bot Challenger", et stabiliser les changements de lignes dynamiques avec un écart minimum de 5 m.

**Architecture:** 
1. Côté Canvas/Frontend (`regatta-canvas.component.ts`) : étendre l'indicateur de distance restante à tous les kayaks (au lieu du seul joueur connecté), avec détection d'espace restant devant (`x + hullRx + gap + badgeW > w - 6`) pour basculer derrière (`x - hullRx - gap - badgeW`).
2. Côté Backend (`race-manager.service.ts`) : stocker explicitement `botCustomName` dans `RaceState`, réutiliser systématiquement le nom existant du bot dans `ensureSalonBots` et `toLiveMetrics` au lieu de générer `Bot Challenger` lors des re-synchronisations de salon ou de départ, et synchroniser fidèlement `Activities` et `race.participants`. Côté frontend (`app.ts`), sanctuariser le nom du bot pour éviter tout écrasement lors des polls HTTP ou push WebSocket.
3. Côté Hystérésis de dépassement (`regatta-canvas.component.ts` et `regatta_water_painter.dart`) : abaisser et caler le seuil de dépassement net à 5 m (`OVERTAKE_THRESHOLD_M = 5`), appliquer ce seuil minimum de 5 m lors des résolutions d'unicité de lignes et en mode zoom (`zoom > 1`), empêchant tout clignotement ou alternance rapide quand deux rameurs sont à distance proche.

**Tech Stack:** Angular 21 (Canvas 2D HTML5, TypeScript), Node.js (TypeScript, Express, Sequelize/SQLite, Socket.io), Flutter (Dart, CustomPainter).

**Spec:** Directives de l'utilisateur exprimées dans le prompt :
- Distance affichée devant chaque kayak = distance restante à parcourir pour tous les kayaks.
- Si l'espace restant devant n'est pas suffisant, afficher la distance derrière le kayak.
- Correction du bug d'intermittence du nom du bot (passage intempestif entre "Bot Régulier" et "Bot Challenger").
- Écart minimum de 5 m avant tout changement de ligne entre deux concurrents.

## Global Constraints

- Respect strict de la monotonie de distance : aucun kayak ne doit reculer visuellement sur l'eau.
- Ne pas dégrader les performances à 60 FPS du canvas HTML5 et du CustomPainter Flutter.
- Préserver la distinction visuelle du joueur connecté (halo cyan, mise en valeur spécifique) tout en affichant l'indicateur d'information pour tous les kayaks.
- Zéro régression sur la suite de tests backend et frontend.

---

### Task 1: Affichage de la distance restante devant tous les kayaks et bascule derrière

**Files:**
- Modify: `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts`
- Modify: `frontend/tests/regatta-canvas-rank-badge.test.mjs`

**Interfaces:**
- Consumes: `boat: BoatRenderState`, `targetDistance: number`, `isUser: boolean`, `getRacerRank(userId: string)`
- Produces: Rendu du badge de distance restante pour l'ensemble des kayaks visibles dans `drawCanvasScene()`, avec calcul d'espace restant et bascule devant/derrière.

- [ ] **Step 1: Mettre à jour le test unitaire pour exiger le badge sur tous les kayaks et la bascule arrière**

Dans `frontend/tests/regatta-canvas-rank-badge.test.mjs` :
- Remplacer l'assertion limitant le badge à `isUser` par une assertion vérifiant que le badge de distance restante est généré pour tous les kayaks (avec distinction de style pour `isUser`).
- Ajouter un cas de test vérifiant le calcul de position `badgeX` :
  - Si `frontBadgeX + badgeW > w - 6`, `badgeX` doit basculer derrière le kayak (`x - hullRx - gap - badgeW`).
  - Si l'espace devant est suffisant, `badgeX` reste devant (`frontBadgeX`).

- [ ] **Step 2: Exécuter le test pour constater l'échec attendu**

Lancer :
```powershell
node --test frontend/tests/regatta-canvas-rank-badge.test.mjs
```
Vérifier que le test échoue en constatant que le code actuel restreint encore l'affichage à `if (isUser && ...)`.

- [ ] **Step 3: Implémenter l'indicateur de distance restante pour tous les kayaks dans `regatta-canvas.component.ts`**

Dans `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts` :
- Localiser la section `// INDICATEUR DEVANT LE RAMEUR` dans `drawCanvasScene()`.
- Remplacer la condition restrictive `if (isUser && ...)` par :
  ```typescript
  if (this.targetDistance > 0 && (this.isRaceActive || boat.currentDisplayDist > 0 || boat.status === 'finished'))
  ```
- Calculer la distance restante pour le bateau courant :
  ```typescript
  const remainingDist = Math.max(0, Math.round((this.targetDistance || 2000) - boat.targetPacketDist));
  const distLabel = remainingDist > 0 ? `${remainingDist}m` : 'Arrivé !';
  ```
- Composer le texte du badge :
  ```typescript
  const rankInfo = this.getRacerRank(boat.userId);
  let badgeText = '';
  if (rankInfo) {
    badgeText = rankInfo.medal ? `${rankInfo.medal} ${rankInfo.label} · ${distLabel}` : `${rankInfo.label} · ${distLabel}`;
  } else {
    badgeText = distLabel;
  }
  ```
- Calculer la géométrie et la position :
  ```typescript
  const gap = Math.round((isCompact ? 8 : 12) * boatScale);
  const frontBadgeX = x + hullRx + gap;
  let badgeX = frontBadgeX;

  // Si l'espace restant devant n'est pas suffisant pour afficher la distance, alors l'afficher derrière
  if (frontBadgeX + badgeW > w - 6) {
    badgeX = x - hullRx - gap - badgeW;
    if (badgeX < 4) {
      badgeX = 4;
    }
  }
  ```
- Adapter les styles visuels :
  - Si `isUser` : bordure cyan `#00f0ff`, halo lumineux (`shadowBlur`), texte blanc éclatant.
  - Si autre rameur : bordure aux couleurs du bateau ou de son rang (`rankInfo?.color || boat.color || 'rgba(0, 240, 255, 0.6)'`), fond sombre semi-transparent `rgba(6, 15, 33, 0.90)`, pas de halo excessif pour préserver la clarté visuelle.

- [ ] **Step 4: Exécuter le test unitaire pour confirmer le passage au vert**

Lancer :
```powershell
node --test frontend/tests/regatta-canvas-rank-badge.test.mjs
```
Vérifier que tous les tests de `regatta-canvas-rank-badge.test.mjs` passent avec succès.

- [ ] **Step 5: Valider et commiter**

```powershell
git add frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts frontend/tests/regatta-canvas-rank-badge.test.mjs
git commit -m "feat(regatta): display remaining distance badge for all kayaks with front/back auto-placement"
```

---

### Task 2: Élimination de l'intermittence de nom du bot ("Bot Régulier" vs "Bot Challenger")

**Files:**
- Modify: `backend/src/services/race-manager.service.ts`
- Modify: `frontend/src/app/app.ts`
- Create: `backend/tests/bot-name-persistence.test.js`

**Interfaces:**
- Consumes: `RaceState.botCustomName`, `ensureSalonBots()`, `joinPrivateRace()`, `toLiveMetrics()`
- Produces: Nom de bot persistant et invariable dans `race.participants`, `Activities` et `liveMetricsList`.

- [ ] **Step 1: Écrire le test unitaire reproduisant le bug de nom de bot intermittent**

Créer `backend/tests/bot-name-persistence.test.js` :
- Créer une course privée duel bot avec allure correspondant à "Régulier" (ex: 145s/500m).
- Vérifier que le bot s'appelle initialement `Bot Régulier`.
- Simuler l'appel à `joinPrivateRace` ou `ensureSalonBots` (qui passait précédemment `undefined` comme customName).
- Constater que sans le correctif, `Activities` recevait `Bot Challenger` tandis que `race.participants` conservait `Bot Régulier`, provoquant une divergence entre WebSocket et HTTP poll.
- Affirmer que le bot conserve fidèlement `Bot Régulier` dans tous les états et appels ultérieurs.

- [ ] **Step 2: Lancer le test pour confirmer la détection du bug**

Lancer :
```powershell
node --test backend/tests/bot-name-persistence.test.js
```
Vérifier l'échec du test sur la divergence du nom du bot.

- [ ] **Step 3: Corriger la persistance du nom du bot dans `backend/src/services/race-manager.service.ts`**

Dans `backend/src/services/race-manager.service.ts` :
1. Ajouter `botCustomName?: string;` à l'interface `RaceState`.
2. Dans `createPrivateRace` :
   - Stocker `botCustomName` dans l'objet `privateRace` :
     ```typescript
     botCustomName,
     ```
3. Dans `ensureSalonBots` :
   - Avant de choisir `names[i % names.length]`, vérifier si le bot existe déjà dans `race.participants` ou si `race.botCustomName` est défini :
     ```typescript
     const existingParticipantName = race?.participants?.get(botId)?.userName;
     const effectiveCustomName = customName || race?.botCustomName || existingParticipantName;
     const name = effectiveCustomName && botCount === 1
       ? effectiveCustomName
       : (effectiveCustomName ? `${effectiveCustomName} ${i + 1}` : (existingParticipantName || names[i % names.length]));
     ```
4. Dans `joinPrivateRace` (vers ligne 2460) :
   - Remplacer `undefined` par `race.botCustomName || race.participants?.get('bot_salon_1')?.userName` :
     ```typescript
     this.ensureSalonBots(race.id, race.botCount, race.botMaxPace || 125, race.targetDistance, race.botCustomName || race.participants?.get("bot_salon_1")?.userName, race.botMinPace).catch(() => {});
     ```
5. Dans `updateSalonBotConfig` (vers ligne 2050) :
   - Remplacer `undefined` par `race.botCustomName`.

- [ ] **Step 4: Sécuriser la stabilité du nom du bot côté frontend dans `frontend/src/app/app.ts`**

Dans `frontend/src/app/app.ts` :
- Dans le mapping du polling HTTP (`lb.subscribe`) et des messages WebSocket (`broadcastLeaderboard`) :
  - Si `r.userId` commence par `bot_` et qu'un `existingMetric?.name` existe déjà sans être générique (ex: `existingMetric.name` est `Bot Régulier`), conserver ce nom établi plutôt que de l'écraser si un paquet temporaire contenait `Bot Challenger`.
  - Assurer la cohérence stricte entre `racers` et `liveMetricsList`.

- [ ] **Step 5: Exécuter le test unitaire et compiler le backend**

Lancer :
```powershell
node --test backend/tests/bot-name-persistence.test.js
npm --prefix backend run build
```
Vérifier que le test passe au vert et que la compilation TypeScript réussit sans erreur.

- [ ] **Step 6: Valider et commiter**

```powershell
git add backend/src/services/race-manager.service.ts frontend/src/app/app.ts backend/tests/bot-name-persistence.test.js
git commit -m "fix(bot): persist custom bot name and prevent intermittent switching to Bot Challenger"
```

---

### Task 3: Seuil d'écart minimum de 5 m pour les changements de lignes dynamiques

**Files:**
- Modify: `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts`
- Modify: `frontend/tests/regatta-dynamic-lanes.test.mjs`
- Modify: `mobile_flutter/lib/features/race/widgets/regatta_water_painter.dart`

**Interfaces:**
- Consumes: `boat.currentDisplayDist`, `OVERTAKE_THRESHOLD_M = 5`
- Produces: Changements de lignes fluides sans clignotement ni oscillation à distance égale.

- [ ] **Step 1: Adapter le test unitaire pour valider le seuil de 5 m**

Dans `frontend/tests/regatta-dynamic-lanes.test.mjs` :
- Mettre à jour les assertions et simulations pour un seuil d'hystérésis de 5 mètres :
  - À 4.9 m d'avance : aucun changement de ligne (`dynamicLaneIndex` inchangé).
  - À 5.0 m d'avance : dépassement validé, permutation nette des lignes.
  - En sens inverse : le poursuivant doit dépasser de 5.0 m pour reprendre la ligne.
  - Vérifier que le code source déclare `OVERTAKE_THRESHOLD_M = 5`.

- [ ] **Step 2: Lancer le test pour constater l'échec sur le seuil précédent (10m)**

Lancer :
```powershell
node --test frontend/tests/regatta-dynamic-lanes.test.mjs
```
Vérifier que le test échoue en attendant 5 m au lieu de 10 m.

- [ ] **Step 3: Ajuster le seuil et la logique de tri dans `regatta-canvas.component.ts`**

Dans `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts` :
1. Mettre à jour `OVERTAKE_THRESHOLD_M` à `5` :
   ```typescript
   // Seuil de dépassement net (écart minimum de 5 m pour éviter toute intermittence)
   const OVERTAKE_THRESHOLD_M = 5;
   ```
2. Dans `updateDynamicLanes()` :
   - Lors de la vérification de collision des indices (`laneIndexSet.size !== boatsList.length`) :
     ```typescript
     if (Math.abs(b.currentDisplayDist - a.currentDisplayDist) >= OVERTAKE_THRESHOLD_M) {
       return b.currentDisplayDist - a.currentDisplayDist;
     }
     return (a.assignedLane || 1) - (b.assignedLane || 1);
     ```
   - Empêcher la permutation si les deux bateaux sont arrivés (`if (topFinished && botFinished) return;`).
3. Dans `getVisibleBoats(zoom)` :
   - En mode zoom (`zoom > 1`), si `dynamicLaneMode` est activé, aligner l'ordre des bateaux sur `dynamicLaneIndex` (qui bénéficie de l'hystérésis de 5 m et de l'interpolation fluide) plutôt que sur un tri brut avec `> 0.1` :
     ```typescript
     if (this.dynamicLaneMode) {
       return (a.dynamicLaneIndex ?? 0) - (b.dynamicLaneIndex ?? 0);
     }
     if (Math.abs(b.currentDisplayDist - a.currentDisplayDist) >= 5) {
       return b.currentDisplayDist - a.currentDisplayDist;
     }
     return (a.assignedLane || a.lane || 1) - (b.assignedLane || b.lane || 1);
     ```
4. Mettre à jour le texte du bouton / infobulle :
   - Remplacer `seuil 10m` par `seuil 5m`.

- [ ] **Step 4: Mettre à jour le CustomPainter Flutter dans `regatta_water_painter.dart`**

Dans `mobile_flutter/lib/features/race/widgets/regatta_water_painter.dart` :
- Dans `_updatePhysics` :
  - Remplacer le tri instantané brut `list.sort((a, b) => b.currentDisplayDist.compareTo(a.currentDisplayDist))` par une logique avec seuil d'hystérésis de 5 m :
    ```dart
    const overtakeThresholdM = 5.0;
    // Les changements de couloirs nécessitent un écart supérieur à 5m
    list.sort((a, b) => a.dynamicLaneIndex.compareTo(b.dynamicLaneIndex));
    for (int i = list.length - 2; i >= 0; i--) {
      final top = list[i];
      final bot = list[i + 1];
      if (bot.currentDisplayDist >= top.currentDisplayDist + overtakeThresholdM) {
        final tmp = top.dynamicLaneIndex;
        top.dynamicLaneIndex = bot.dynamicLaneIndex;
        bot.dynamicLaneIndex = tmp;
        list[i] = bot;
        list[i + 1] = top;
      }
    }
    ```

- [ ] **Step 5: Exécuter le test unitaire pour confirmer le passage au vert**

Lancer :
```powershell
node --test frontend/tests/regatta-dynamic-lanes.test.mjs
```
Vérifier que tous les tests de `regatta-dynamic-lanes.test.mjs` passent avec succès.

- [ ] **Step 6: Valider et commiter**

```powershell
git add frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts frontend/tests/regatta-dynamic-lanes.test.mjs mobile_flutter/lib/features/race/widgets/regatta_water_painter.dart
git commit -m "feat(regatta): enforce 5m minimum gap threshold for dynamic lane switches to prevent jitter"
```

---

### Task 4: Vérification globale, tests de non-régression et recette

**Files:**
- Test verification: `backend/tests/`
- Test verification: `frontend/tests/`

- [ ] **Step 1: Exécuter la suite complète de tests backend**

```powershell
npm --prefix backend test
```
Vérifier que les 20+ fichiers de tests backend s'exécutent avec 0 échec.

- [ ] **Step 2: Exécuter les tests frontend ciblés sur la régate et les couloirs**

```powershell
node --test frontend/tests/regatta-canvas-rank-badge.test.mjs frontend/tests/regatta-dynamic-lanes.test.mjs frontend/tests/canvas-monotony.test.mjs frontend/tests/regatta-canvas-customization.test.mjs
```
Vérifier que tous les tests régate passent à 100%.

- [ ] **Step 3: Vérifier le statut git et la propreté du dépôt**

```powershell
git status
```
S'assurer qu'aucun fichier temporaire ou déchet n'est laissé dans le working tree.
