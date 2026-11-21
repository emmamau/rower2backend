# Mise en page sur 2 lignes des onglets Salon Privé sur smartphone en mode portrait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapter la barre d'onglets de la fenêtre modale des salons privés (`app-private-room-manager`) afin que sur smartphone en vue portrait uniquement, les 4 boutons ("Créer un salon", "Codes & URL", "Rejoindre / Mes Salons", "Duels") soient disposés sur 2 lignes (2 boutons par ligne) avec une lisibilité et accessibilité optimales, tout en conservant une seule ligne avec défilement horizontal en mode paysage et sur ordinateur.

**Architecture:**
1. **Règles CSS adaptatives ciblées** dans `frontend/src/app/components/private-room-manager/private-room-manager.component.css` :
   - Remplacement de la règle générique `grid-template-columns: repeat(auto-fit, minmax(105px, 1fr))` sous `@media (max-width: 640px)` par une règle spécifique au mode portrait `@media (max-width: 768px) and (orientation: portrait)` (et `< 640px`) configurant `grid-template-columns: repeat(2, 1fr)`.
   - Ajustement de `.priv-tab-btn` en mode portrait (`white-space: normal`, `line-height: 1.2`, `min-height: 44px`, centrage vertical/horizontal flex) pour éviter tout rognage de texte sur les écrans étroits (ex. 360px - 430px).
   - En mode paysage sur smartphone (`orientation: landscape`), maintien des onglets sur une seule ligne (`flex-wrap: nowrap`, `overflow-x: auto`) pour préserver l'espace vertical critique (hauteurs d'écran de 360-400px).
2. **Vérification de non-régression** :
   - Desktop inchangé : conservation de `flex-wrap: nowrap` et de la largeur de boîte de dialogue (`min(95dvw, 890px)`).
   - Les badges de notification (codes actifs, compteurs de salons et de duels urgents) restent lisibles et intégrés.
3. **Tests automatisés** :
   - Création de `frontend/tests/private-room-tabs-portrait.test.mjs` vérifiant les règles CSS pour le portrait (2 colonnes / 2 lignes), le comportement en paysage (1 ligne), la taille cible tactile (min 44px) et l'absence de régression sur les tests existants.

**Tech Stack:** CSS3 (Media Queries, CSS Grid, Flexbox), Angular (PrivateRoomManagerComponent), Node.js Test Runner (`node:test`, `node:assert/strict`).

**Spec:** Exigence utilisateur : "dans la fenetre modal salon privées sur smartphone en vue portrait uniquement mettre les boutons "creer un salon" "code " URL" "rejoindre mes salons" et "duels" sur 2 lignes car sinon c'est pas lisible".

## Global Constraints
- La disposition sur 2 lignes doit s'appliquer **uniquement** sur smartphone en vue portrait (`(orientation: portrait)`).
- En vue paysage sur smartphone (`(orientation: landscape)`) et sur ordinateur, les boutons doivent rester sur une seule ligne.
- Ne pas altérer la structure HTML ni les attributs ARIA d'accessibilité du `role="tablist"` et `role="tab"`.
- Conserver la taille tactile minimale de 44px conforme aux directives d'accessibilité mobile (WCAG 2.5.5 / 2.5.8).
- Tous les tests de la suite `frontend/tests/private-room*.test.mjs` doivent continuer à passer sans régression.

---

### Task 1: Création du test automatisé pour la disposition responsive des onglets

**Files:**
- Create: `frontend/tests/private-room-tabs-portrait.test.mjs`

**Interfaces:**
- Consumes: `frontend/src/app/components/private-room-manager/private-room-manager.component.css`
- Produces: Test automatisé validant la présence de la media query `(orientation: portrait)` avec `grid-template-columns: repeat(2, 1fr)` et la conservation de 1 seule ligne en paysage/desktop.

- [ ] **Step 1: Écrire le test unitaire `private-room-tabs-portrait.test.mjs`**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cssPath = path.resolve(
  __dirname,
  '../src/app/components/private-room-manager/private-room-manager.component.css'
);

test('PrivateRoomManager Tabs: Portrait smartphone query arranges 4 tabs on exactly 2 lines (2 columns)', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  // Verify there is a portrait media query for smartphone (< 768px or <= 640px)
  assert.match(
    css,
    /@media[^{]*?orientation:\s*portrait[^{]*?\{[\s\S]*?\.priv-tablist\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*1fr\)/,
    'Expected .priv-tablist to have repeat(2, 1fr) in smartphone portrait media query'
  );

  // Verify .priv-tab-btn in portrait allows text wrapping and touch min-height
  assert.match(
    css,
    /@media[^{]*?orientation:\s*portrait[^{]*?\{[\s\S]*?\.priv-tab-btn\s*\{[\s\S]*?white-space:\s*normal/,
    'Expected .priv-tab-btn to allow white-space: normal in portrait query'
  );
});

test('PrivateRoomManager Tabs: Landscape and desktop preserve single line tablist without forced 2-column grid', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  // Desktop tablist has flex-wrap: nowrap
  assert.match(
    css,
    /\.priv-tablist\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*nowrap;/,
    'Expected base .priv-tablist to have display: flex and flex-wrap: nowrap'
  );

  // Ensure generic max-width: 640px does not blindly apply repeat(2, 1fr) without portrait condition
  const genericMobileMatch = css.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*?)\}/);
  if (genericMobileMatch) {
    const genericRules = genericMobileMatch[1];
    // If repeat(2, 1fr) is present, it must be guarded by orientation: portrait
    assert.ok(
      !genericRules.includes('repeat(2, 1fr)') || genericRules.includes('orientation: portrait'),
      'repeat(2, 1fr) must be restricted to portrait orientation'
    );
  }
});
```

- [ ] **Step 2: Exécuter le test pour vérifier son échec préalable**

Exécuter : `node --test frontend/tests/private-room-tabs-portrait.test.mjs`
Résultat attendu : FAIL (la règle `repeat(2, 1fr)` avec `orientation: portrait` n'est pas encore présente).

---

### Task 2: Implémentation des règles CSS responsive dans `private-room-manager.component.css`

**Files:**
- Modify: `frontend/src/app/components/private-room-manager/private-room-manager.component.css:1050-1070`

**Interfaces:**
- Consumes: Classes `.priv-tablist`, `.priv-tab-btn`, `.priv-tab-badge`, `.priv-tab-count`
- Produces: Grille 2x2 en mode portrait mobile (`repeat(2, 1fr)`), boutons avec retour à la ligne automatique (`white-space: normal`), et conservation d'une seule ligne en mode paysage (`orientation: landscape`).

- [ ] **Step 1: Modifier `private-room-manager.component.css` pour cibler le smartphone portrait**

Dans la section responsive de `frontend/src/app/components/private-room-manager/private-room-manager.component.css` :
1. Définir explicitement le comportement en mode portrait sur smartphone (`@media (max-width: 768px) and (orientation: portrait)`) :
   ```css
   /* Smartphone en vue portrait uniquement : 4 boutons répartis sur 2 lignes de 2 */
   @media (max-width: 768px) and (orientation: portrait) {
     .priv-tablist {
       display: grid;
       grid-template-columns: repeat(2, 1fr);
       gap: 0.5rem;
     }

     .priv-tab-btn {
       display: flex;
       align-items: center;
       justify-content: center;
       text-align: center;
       min-height: 44px;
       padding: 0.45rem 0.35rem;
       font-size: 0.78rem;
       line-height: 1.25;
       white-space: normal;
       word-break: normal;
     }
   }
   ```
2. Pour les écrans mobiles en mode paysage (`@media (max-width: 900px) and (orientation: landscape)` et sous `@media (max-width: 640px)` lorsque l'orientation n'est pas portrait) :
   Garantir que `.priv-tablist` reste sur une seule ligne (`flex-wrap: nowrap; overflow-x: auto;`) avec hauteur optimisée pour préserver l'espace vertical.

- [ ] **Step 2: Exécuter le test `private-room-tabs-portrait.test.mjs`**

Exécuter : `node --test frontend/tests/private-room-tabs-portrait.test.mjs`
Résultat attendu : PASS (les 2 tests réussissent).

- [ ] **Step 3: Exécuter l'ensemble des tests de la suite `private-room` pour valider l'absence de régression**

Exécuter :
```bash
node --test frontend/tests/private-rooms-improvements.test.mjs
node --test frontend/tests/private-rooms-badge-and-icons.test.mjs
node --test frontend/tests/private-room-completed-buttons.test.mjs
node --test frontend/tests/private-room-creation-quotas.test.mjs
node --test frontend/tests/private-room-timezone.test.mjs
```
Résultat attendu : Tous les tests PASSent sans avertissement ni régression.

---

### Task 3: Validation visuelle et vérification de la compilation frontend

**Files:**
- Verify: `frontend/src/app/components/private-room-manager/private-room-manager.component.css`

- [ ] **Step 1: Vérifier le build ou linter frontend pour s'assurer de l'absence d'erreurs de syntaxe**

Exécuter : `npm run build --if-present` ou `npm run lint --if-present` (ou commande de test équivalente dans le repo).

- [ ] **Step 2: Validation du rendu sur les résolutions cibles**
- Portrait smartphone (360x740, 390x844, 412x915) :
  - Ligne 1 : [ ➕ Créer un salon ] [ 🔑 Codes & URL ]
  - Ligne 2 : [ 🚪 Rejoindre / Mes Salons ] [ ⚔️ Duels ]
  - Largeur de chaque bouton : ~50% de la largeur du modal, texte parfaitement lisible sans chevauchement.
- Paysage smartphone (ex: 844x390, 667x375) :
  - Les 4 boutons restent sur 1 seule ligne horizontale compacte pour ne pas masquer le contenu du formulaire.
- Desktop (> 768px) :
  - Boîte de dialogue centrée de 890px, onglets sur une seule ligne.
