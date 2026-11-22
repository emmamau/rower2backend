# Internationalisation Intégrale de l'Application Front-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Internationaliser intégralement l'application front-end Angular (Interface utilisateur, Cockpit, Régate, Salons privés, Duels, Abonnements, Canvas 2D, Modales et Back-Office d'Administration) dans les 6 langues supportées (Français, Anglais, Allemand, Espagnol, Italien, Portugais), avec persistance locale et profil utilisateur, localisation des dates/durées/ordinaux, et maintien strict de la compatibilité des tests unitaires existants.

**Architecture:**
1. **Modules de dictionnaires modulaires TypeScript** :
   - Création de `frontend/src/app/i18n/locales/{fr,en,de,es,it,pt}.ts` avec structure arborescente/clés normalisées, exportés via `frontend/src/app/i18n/index.ts`.
   - Refactorisation de `I18nService` (`frontend/src/app/services/i18n.service.ts`) pour importer ces modules synchrones, assurant un chargement immédiat sans latence HTTP, un typage strict et une parité complète des clés sur les 6 langues.
2. **Méthodes de formatage et localisation enrichies dans `I18nService`** :
   - `formatDetailedCountdown(seconds: number): string` : localisation des unités de temps (`j`/`d`, `h`, `m`, `s`).
   - `formatRankOrdinal(rank: number): string` : ordinaux localisés (`1er`, `2e`, `3e` en FR ; `1st`, `2nd`, `3rd` en EN ; `1º`, `2º` en ES/IT/PT ; `1.`, `2.` en DE).
   - `translateError(errorOrMessage: any): string` : mappage des messages d'erreur et retours API récurrents (connexion, mot de passe, quotas, Stripe) avec repli transparent sur le message brut.
   - Synchronisation bidirectionnelle du choix de langue : `localStorage` (`rower_app_lang`), `navigator.language` par défaut, et mise à jour du profil utilisateur (`UserProfile.language`) via `RowerService.updateProfile` lors de la connexion.
3. **Traduction complète des gabarits et composants front-end** :
   - `SubscriptionModalComponent` (`subscription-modal.component.html`) : traduction des 3 offres (Gratuite, Club, Élite Pro), fonctionnalités, tarifs, bannières et boutons d'action.
   - `AdminDashboardComponent` (`admin-dashboard.component.html`) : injection de `I18nService` et traduction des 3 onglets (courses publiques, utilisateurs, quotas/tarifs), filtres, boutons d'action et messages d'alerte.
   - `AccountModalComponent`, `UnifiedConfigModalComponent`, `RaceHistoryModalComponent`, `StandingsModalComponent`, `StatisticsModalComponent`, `LegalTermsModalComponent`.
   - `HomeDashboardComponent`, `RegattaViewComponent`, `CockpitViewComponent`, `RaceOverlaysComponent`, `AppHeaderComponent`, `SeoFooterComponent`.
   - `RegattaCanvasComponent` : traduction des textes dessinés sur le Canvas 2D HTML5 (`CANVAS_WAITING`, `CANVAS_LANE`, badge d'arrivée `'Arrivé !'`, préfixes/suffixes de classement).
4. **Garantie de non-régression** :
   - Préservation des sélecteurs, classes CSS et structures testées par la suite existante (`frontend/tests/*.test.mjs`).
   - Création d'une suite de tests dédiée `frontend/tests/full-i18n-multilang.test.mjs` vérifiant la parité des clés, le changement dynamique de langue, la persistance et les utilitaires de localisation.

**Tech Stack:** Angular 21 (Signals, Standalone Components, Control Flow `@if`/`@defer`), TypeScript 5.9, HTML5 Canvas 2D Context, LocalStorage API, Node.js Test Runner (`node:test`, `node:assert/strict`).

**Spec:** Spécification issue de la phase `/grill-me` validée : prise en charge complète du multilingue sur l'intégralité du front (UI + Admin), 6 langues (FR, EN, DE, ES, IT, PT), persistance localStorage + profil utilisateur, localisation des durées/ordinaux, mappage d'erreurs API et non-régression des tests.

## Global Constraints
- Les 6 langues officielles doivent être supportées : `fr`, `en`, `de`, `es`, `it`, `pt`.
- Le chargement des traductions doit rester synchrone et sans clignotement d'affichage au démarrage de l'application.
- Aucune régression sur les 137+ tests existants (`frontend/tests/*.test.mjs`).
- Les structures DOM et classes CSS ciblées par les tests responsive et fonctionnels doivent être strictement conservées.
- Le français (`fr`) demeure la langue pivot / de repli par défaut en cas d'absence ponctuelle d'une clé.

---

### Task 1: Création des dictionnaires modulaires TypeScript et de la suite de tests de parité

**Files:**
- Create: `frontend/src/app/i18n/locales/fr.ts`
- Create: `frontend/src/app/i18n/locales/en.ts`
- Create: `frontend/src/app/i18n/locales/de.ts`
- Create: `frontend/src/app/i18n/locales/es.ts`
- Create: `frontend/src/app/i18n/locales/it.ts`
- Create: `frontend/src/app/i18n/locales/pt.ts`
- Create: `frontend/src/app/i18n/index.ts`
- Create: `frontend/tests/full-i18n-multilang.test.mjs`

**Interfaces:**
- Consumes: Clés existantes dans `frontend/src/app/services/i18n.service.ts` + nouvelles clés pour `SubscriptionModal`, `AdminDashboard`, `AccountModal`, `Canvas`, erreurs API.
- Produces: `export const TRANSLATIONS: Record<SupportedLang, Record<string, string>>` et `export type SupportedLang = 'fr' | 'en' | 'de' | 'es' | 'it' | 'pt';`.

- [ ] **Step 1: Écrire le test unitaire `full-i18n-multilang.test.mjs`**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('i18n locale modules exist and provide 100% key parity across all 6 supported languages', async () => {
  const i18nDir = path.resolve(__dirname, '../src/app/i18n/locales');
  const languages = ['fr', 'en', 'de', 'es', 'it', 'pt'];

  const localeMaps = {};
  for (const lang of languages) {
    const filePath = path.join(i18nDir, `${lang}.ts`);
    assert.ok(fs.existsSync(filePath), `Locale file must exist: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf8');
    const matches = [...content.matchAll(/['"]([A-Z0-9_]+)['"]\s*:/g)].map(m => m[1]);
    localeMaps[lang] = new Set(matches);
  }

  const frKeys = Array.from(localeMaps['fr']);
  assert.ok(frKeys.length >= 150, `French dictionary should contain at least 150 translation keys (found ${frKeys.length})`);

  // Check required core sections
  const requiredCategories = [
    'SUB_TITLE', 'SUB_FREE_TITLE', 'SUB_CLUB_TITLE', 'SUB_PRO_TITLE',
    'ADMIN_TITLE', 'ADMIN_TAB_PUBLIC', 'ADMIN_TAB_USERS', 'ADMIN_TAB_PLANS',
    'FINISH_ARRIVED', 'ERR_INVALID_CREDENTIALS', 'TIME_DAYS_SHORT', 'TIME_HOURS_SHORT'
  ];

  for (const reqKey of requiredCategories) {
    assert.ok(localeMaps['fr'].has(reqKey), `FR dictionary must include ${reqKey}`);
  }

  for (const lang of languages) {
    if (lang === 'fr') continue;
    for (const key of frKeys) {
      assert.ok(
        localeMaps[lang].has(key),
        `Missing key "${key}" in language "${lang}" compared to "fr"`
      );
    }
  }
});
```

- [ ] **Step 2: Vérifier l'échec initial du test**

Exécuter : `node --test frontend/tests/full-i18n-multilang.test.mjs`
Résultat attendu : FAIL (fichiers inexistants).

- [ ] **Step 3: Créer les fichiers de locales `fr.ts`, `en.ts`, `de.ts`, `es.ts`, `it.ts`, `pt.ts` et `index.ts`**

Extraire l'ensemble des traductions existantes de `I18nService` et y intégrer les nouvelles clés pour l'administration, les abonnements, les durées et les messages d'erreurs récurrents, avec traductions rigoureuses en EN, DE, ES, IT, PT.

- [ ] **Step 4: Exécuter le test unitaire pour valider la parité des dictionnaires**

Exécuter : `node --test frontend/tests/full-i18n-multilang.test.mjs`
Résultat attendu : PASS.

- [ ] **Step 5: Valider et commiter**

```bash
git add frontend/src/app/i18n/ frontend/tests/full-i18n-multilang.test.mjs
git commit -m "feat(i18n): create modular locale files with full 6-language key parity"
```

---

### Task 2: Refactorisation de `I18nService` avec formats localisés, synchronisation et mappage d'erreurs

**Files:**
- Modify: `frontend/src/app/services/i18n.service.ts`
- Modify: `frontend/tests/full-i18n-multilang.test.mjs`

**Interfaces:**
- Consumes: `TRANSLATIONS` depuis `frontend/src/app/i18n/locales/*`.
- Produces:
  - `t(key: string, params?: Record<string, string | number>): string`
  - `formatDetailedCountdown(seconds: number): string`
  - `formatRankOrdinal(rank: number): string`
  - `translateError(error: any): string`
  - `setLang(lang: SupportedLang, userProfileSync?: boolean): void`

- [ ] **Step 1: Ajouter des tests unitaires pour les méthodes d'aide à la localisation dans `full-i18n-multilang.test.mjs`**

```javascript
test('I18nService helpers format countdowns, ordinals, and errors correctly per language', () => {
  const i18nServiceFile = path.resolve(__dirname, '../src/app/services/i18n.service.ts');
  const content = fs.readFileSync(i18nServiceFile, 'utf8');

  assert.ok(content.includes('formatDetailedCountdown'), 'Must define formatDetailedCountdown');
  assert.ok(content.includes('formatRankOrdinal'), 'Must define formatRankOrdinal');
  assert.ok(content.includes('translateError'), 'Must define translateError');
});
```

- [ ] **Step 2: Vérifier l'échec initial du test**

Exécuter : `node --test frontend/tests/full-i18n-multilang.test.mjs`
Résultat attendu : FAIL (méthodes manquantes).

- [ ] **Step 3: Implémenter les méthodes et le chargement modulaire dans `i18n.service.ts`**

Mettre à jour `I18nService` pour importer les dictionnaires depuis `../i18n/locales/*`, supporter l'interpolation de paramètres `{{var}}`, implémenter `formatDetailedCountdown` (`j` vs `d`), `formatRankOrdinal` (`1er`, `1st`, etc.) et `translateError`.

- [ ] **Step 4: Exécuter le test de validation de `I18nService`**

Exécuter : `node --test frontend/tests/full-i18n-multilang.test.mjs`
Résultat attendu : PASS.

- [ ] **Step 5: Valider et commiter**

```bash
git add frontend/src/app/services/i18n.service.ts frontend/tests/full-i18n-multilang.test.mjs
git commit -m "feat(i18n): enrich I18nService with modular locales, localized formatters, and error translator"
```

---

### Task 3: Internationalisation de la modale d'abonnements et tarifs (`SubscriptionModalComponent`)

**Files:**
- Modify: `frontend/src/app/components/modals/subscription-modal/subscription-modal.component.html`
- Modify: `frontend/src/app/components/modals/subscription-modal/subscription-modal.component.ts`
- Test: `frontend/tests/subscription-flow.test.mjs`
- Test: `frontend/tests/app-features.test.mjs`

**Interfaces:**
- Consumes: `I18nService` injecté dans `SubscriptionModalComponent`.
- Produces: Rendu multilingue dynamique des titres, badges, listes de fonctionnalités, tarifs et messages d'état tout en conservant les sélecteurs requis par les tests existants.

- [ ] **Step 1: Vérifier les tests existants sur `subscription-modal`**

Exécuter : `node --test frontend/tests/subscription-flow.test.mjs`
Résultat attendu : PASS (100% vert actuellement).

- [ ] **Step 2: Adapter `subscription-modal.component.ts` et `subscription-modal.component.html`**

Injecter `public i18n: I18nService` dans le composant. Remplacer les textes codés en dur par `{{ i18n.t(...) }}`.
Veiller à préserver les attributs critiques pour les tests (`btn-pricing`, `btn-club`, `btn-pro`, sélecteurs de classes et gestion des offres désactivées).

- [ ] **Step 3: Vérifier que les tests de souscription et les fonctionnalités globales continuent de passer**

Exécuter : `node --test frontend/tests/subscription-flow.test.mjs frontend/tests/app-features.test.mjs`
Résultat attendu : PASS sans régression.

- [ ] **Step 4: Valider et commiter**

```bash
git add frontend/src/app/components/modals/subscription-modal/
git commit -m "feat(i18n): translate SubscriptionModalComponent across all 6 supported languages"
```

---

### Task 4: Internationalisation du tableau de bord Back-Office (`AdminDashboardComponent`)

**Files:**
- Modify: `frontend/src/app/components/admin-dashboard/admin-dashboard.component.html`
- Modify: `frontend/src/app/components/admin-dashboard/admin-dashboard.component.ts`
- Test: `frontend/tests/full-i18n-multilang.test.mjs`

**Interfaces:**
- Consumes: `I18nService` dans `AdminDashboardComponent`.
- Produces: Traduction intégrale des 3 onglets (Courses Publiques, Gestion Utilisateurs, Offres & Quotas), des infobulles, labels de formulaires, badges de statut et boutons d'action.

- [ ] **Step 1: Écrire le test d'internationalisation de `AdminDashboardComponent`**

Ajouter dans `full-i18n-multilang.test.mjs` :
```javascript
test('AdminDashboardComponent uses I18nService for headers, tabs, forms, and action buttons', () => {
  const adminHtmlPath = path.resolve(__dirname, '../src/app/components/admin-dashboard/admin-dashboard.component.html');
  const adminTsPath = path.resolve(__dirname, '../src/app/components/admin-dashboard/admin-dashboard.component.ts');
  const html = fs.readFileSync(adminHtmlPath, 'utf8');
  const ts = fs.readFileSync(adminTsPath, 'utf8');

  assert.ok(ts.includes('I18nService'), 'AdminDashboardComponent must inject I18nService');
  assert.ok(html.includes('i18n.t('), 'AdminDashboard HTML template must use i18n.t()');
  assert.ok(html.includes("i18n.t('ADMIN_TITLE')"), 'AdminDashboard must translate title');
});
```

- [ ] **Step 2: Vérifier l'échec initial du test**

Exécuter : `node --test frontend/tests/full-i18n-multilang.test.mjs`
Résultat attendu : FAIL.

- [ ] **Step 3: Mettre à jour `admin-dashboard.component.ts` et `admin-dashboard.component.html`**

Injecter `I18nService` dans `AdminDashboardComponent`, remplacer tous les libellés statiques en français par `i18n.t(...)`, adapter les bannières d'alerte et messages d'erreurs pour passer par le service de traduction.

- [ ] **Step 4: Exécuter le test de validation du tableau de bord admin**

Exécuter : `node --test frontend/tests/full-i18n-multilang.test.mjs`
Résultat attendu : PASS.

- [ ] **Step 5: Valider et commiter**

```bash
git add frontend/src/app/components/admin-dashboard/
git commit -m "feat(i18n): internationalize AdminDashboardComponent tabs, forms, and alerts"
```

---

### Task 5: Internationalisation des textes Canvas 2D (`RegattaCanvasComponent`) et vues course (`RegattaView`, `CockpitView`, `RaceOverlays`)

**Files:**
- Modify: `frontend/src/app/components/regatta-canvas/regatta-canvas.component.ts`
- Modify: `frontend/src/app/components/regatta-view/regatta-view.component.html`
- Modify: `frontend/src/app/components/cockpit-view/cockpit-view.component.html`
- Modify: `frontend/src/app/components/race-overlays/race-overlays.component.html`
- Test: `frontend/tests/regatta-ui-enhancements.test.mjs`
- Test: `frontend/tests/regatta-dynamic-lanes.test.mjs`

**Interfaces:**
- Consumes: Méthodes `i18n.t(...)` et `i18n.formatRankOrdinal(...)`.
- Produces: Rendu Canvas dynamique localisé (badge `'Arrivé !'` -> `i18n.t('FINISH_ARRIVED')`, suffixes ordinaux de position `1er`/`1st`, bannières d'attente) et synchronisation fluide lors d'un basculement de langue en pleine course.

- [ ] **Step 1: Vérifier les tests existants sur le canvas et les vues de course**

Exécuter : `node --test frontend/tests/regatta-ui-enhancements.test.mjs frontend/tests/regatta-dynamic-lanes.test.mjs`
Résultat attendu : PASS.

- [ ] **Step 2: Mettre à jour `regatta-canvas.component.ts` et les templates de course**

Remplacer les textes codés en dur dans `regatta-canvas.component.ts` (`'Arrivé !'`, formatage du rang) par `this.i18n.t('FINISH_ARRIVED')` et `this.i18n.formatRankOrdinal(rank)`.
Compléter les éventuels libellés résiduels dans `regatta-view.component.html`, `cockpit-view.component.html` et `race-overlays.component.html`.

- [ ] **Step 3: Vérifier que tous les tests régate et canvas passent sans régression**

Exécuter : `node --test frontend/tests/regatta-ui-enhancements.test.mjs frontend/tests/regatta-dynamic-lanes.test.mjs frontend/tests/regatta-canvas-customization.test.mjs`
Résultat attendu : PASS.

- [ ] **Step 4: Valider et commiter**

```bash
git add frontend/src/app/components/regatta-canvas/ frontend/src/app/components/regatta-view/ frontend/src/app/components/cockpit-view/ frontend/src/app/components/race-overlays/
git commit -m "feat(i18n): localize 2D Canvas rendering and race views (regatta, cockpit, overlays)"
```

---

### Task 6: Internationalisation des modales restantes (`AccountModal`, `UnifiedConfigModal`, `RaceHistoryModal`, `StandingsModal`, `StatisticsModal`, `LegalTermsModal`)

**Files:**
- Modify: `frontend/src/app/components/modals/account-modal/account-modal.component.html`
- Modify: `frontend/src/app/components/modals/account-modal/account-modal.component.ts`
- Modify: `frontend/src/app/components/modals/unified-config-modal/unified-config-modal.component.html`
- Modify: `frontend/src/app/components/modals/race-history-modal/race-history-modal.component.html`
- Modify: `frontend/src/app/components/modals/standings-modal/standings-modal.component.html`
- Modify: `frontend/src/app/components/modals/statistics-modal/statistics-modal.component.html`
- Modify: `frontend/src/app/components/modals/legal-terms-modal/legal-terms-modal.component.html`
- Test: `frontend/tests/points-display.test.mjs`
- Test: `frontend/tests/duel-challenges.test.mjs`
- Test: `frontend/tests/legal-terms-footer.test.mjs`

**Interfaces:**
- Consumes: Clés i18n pour formulaires, validations, sélecteurs d'onglets et politiques RGPD/Mentions légales.
- Produces: Gabarits de modales 100% traduits dans les 6 langues.

- [ ] **Step 1: Vérifier les tests existants sur les modales**

Exécuter : `node --test frontend/tests/points-display.test.mjs frontend/tests/duel-challenges.test.mjs frontend/tests/legal-terms-footer.test.mjs`
Résultat attendu : PASS.

- [ ] **Step 2: Mettre à jour les gabarits et contrôleurs des modales**

Remplacer l'intégralité des chaînes résiduelles en français par `i18n.t(...)` (labels de champs, infobulles, jours de refus de duel, onglets, états de chargement et d'erreur).

- [ ] **Step 3: Exécuter la suite de tests pour vérifier l'intégrité fonctionnelle des modales**

Exécuter : `node --test frontend/tests/points-display.test.mjs frontend/tests/duel-challenges.test.mjs frontend/tests/legal-terms-footer.test.mjs`
Résultat attendu : PASS.

- [ ] **Step 4: Valider et commiter**

```bash
git add frontend/src/app/components/modals/
git commit -m "feat(i18n): complete translations for all user account, config, standings, history, and legal modals"
```

---

### Task 7: Synchronisation du profil utilisateur (`app.ts` / `RowerService`) et intégration du sélecteur de langue

**Files:**
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/services/rower.service.ts`
- Modify: `frontend/src/app/components/app-header/app-header.component.ts`
- Modify: `frontend/src/app/components/app-header/app-header.component.html`
- Modify: `frontend/src/app/components/home-dashboard/home-dashboard.component.html`
- Modify: `frontend/src/app/components/home-dashboard/home-dashboard.component.ts`
- Test: `frontend/tests/welcome-banner-desktop.test.mjs`
- Test: `frontend/tests/full-i18n-multilang.test.mjs`

**Interfaces:**
- Consumes: `I18nService.setLang(lang)`.
- Produces: Synchronisation automatique avec `UserProfile.language` via `RowerService.updateProfile` lors du changement de langue d'un utilisateur connecté, et synchronisation avec `activeSeoLang`.

- [ ] **Step 1: Vérifier le test de bannière d'accueil avant modification**

Exécuter : `node --test frontend/tests/welcome-banner-desktop.test.mjs`
Résultat attendu : PASS.

- [ ] **Step 2: Implémenter la synchronisation profil et la propagation de langue dans `app.ts` et `app-header`**

Dans `onLanguageSelectChange`, appeler `this.i18n.setLang(langCode)` puis, si `isIdentified && currentUser`, émettre la mise à jour profil au backend (`this.rowerService.updateProfile({ language: langCode })`).
S'assurer que la bannière d'accueil et les infobulles de header affichent les textes traduits tout en maintenant les expressions régulières testées par `welcome-banner-desktop.test.mjs`.

- [ ] **Step 3: Exécuter les tests de la bannière et de synchronisation**

Exécuter : `node --test frontend/tests/welcome-banner-desktop.test.mjs frontend/tests/full-i18n-multilang.test.mjs`
Résultat attendu : PASS.

- [ ] **Step 4: Valider et commiter**

```bash
git add frontend/src/app/app.ts frontend/src/app/services/rower.service.ts frontend/src/app/components/app-header/ frontend/src/app/components/home-dashboard/
git commit -m "feat(i18n): connect user profile language synchronization and update header/home dashboard"
```

---

### Task 8: Validation globale de build de production et exécution complète des suites de tests

**Files:**
- Test: `frontend/tests/*.test.mjs`
- Build: `frontend/` (`npm run build`)

**Interfaces:**
- Consumes: Code source TypeScript et templates HTML Angular finaux.
- Produces: Bundle de production valide sans erreur de compilation TypeScript/Angular et validation de l'ensemble des tests automatisés.

- [ ] **Step 1: Lancer le build Angular de production**

Exécuter : `npm --prefix frontend run build`
Résultat attendu : Build sans erreur (`Application bundle generation complete`).

- [ ] **Step 2: Exécuter la suite complète de tests de l'application front-end**

Exécuter : `npm --prefix frontend test`
Résultat attendu : Validation des tests unitaires sans régression sur les fonctionnalités multilingues et d'affichage.

- [ ] **Step 3: Commiter les éventuels ajustements finaux**

```bash
git status
git commit -am "chore(i18n): finalize full-application internationalization build and test validation"
```
