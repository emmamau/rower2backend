# Résolution et Sécurisation des Identifiants de Prix Stripe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Résoudre l'erreur Stripe `No such price: 'prod_VfBWa2FbP9UtWP'` en expliquant la correction de configuration immédiate dans les variables d'environnement (remplacement du Product ID `prod_` par le Price ID `price_`), et en fiabilisant le backend pour qu'il détecte, résolve automatiquement ou bascule en sécurité sans jamais bloquer l'utilisateur.

**Architecture:** 
1. Diagnostic et correction de configuration : explication claire du distinguo Stripe entre Produit (`prod_...`) et Tarif (`price_...`), avec les étapes pour mettre à jour `STRIPE_PRICE_CLUB` / `STRIPE_PRICE_PREMIUM` sur Render ou laisser vide pour le mode dynamique.
2. Résilience du backend : enrichissement de `StripeService.createCheckoutSession` et ajout d'une méthode de résolution `resolveLineItem(stripe, configuredPriceId, tierConfig)`. Si un ID commençant par `prod_` est renseigné par inadvertance, le backend interroge Stripe pour récupérer automatiquement le `price_...` associé (ou default_price) au lieu de crasher. En cas d'échec ou d'absence, repli gracieux et immédiat sur `price_data`.
3. Tests automatisés : tests unitaires et d'intégration validant le comportement avec `price_...`, `prod_...` (résolution réussie et fallback gracieux), et variables vides.

**Tech Stack:** Node.js, TypeScript, Stripe Node SDK (v23), Express, Node Test Runner (`node:test`, `node:assert/strict`).

**Spec:** Correction de l'erreur `No such price: 'prod_...'` survenue lors de l'accès à Stripe Checkout, survenue car un identifiant de Produit Stripe (`prod_...`) a été passé au paramètre `line_items[0].price` qui n'accepte que des identifiants de Prix (`price_...`).

## Global Constraints
- Ne jamais casser la compatibilité existante des abonnements ou de l'API `/api/v1/subscriptions/stripe/checkout`.
- Maintenir l'API Stripe à jour selon les standards Stripe (aucun payment_method_types hardcodé, integration_identifier conservé).
- Le backend doit fonctionner même si la variable d'environnement contient un `prod_` ou si elle est vide (fallback sur `price_data`).

---

### Task 1: Diagnostic et Guide de Configuration pour la Plateforme (Render / Production)

**Files:**
- Modify: `backend/.env.example`
- Documentation utilisateur: Guide de résolution des variables d'environnement Render

**Interfaces:**
- Configuration: `STRIPE_PRICE_CLUB`, `STRIPE_PRICE_PREMIUM`

- [ ] **Step 1: Mettre à jour `backend/.env.example` avec les explications sur les préfixes Stripe (`price_` vs `prod_`)**
Clarifier dans `.env.example` que Stripe Checkout requiert un identifiant de Tarif (`price_...`) et non de Produit (`prod_...`), ou bien laisser vide pour que Stripe Checkout génère le tarif dynamiquement.

- [ ] **Step 2: Rédiger les instructions précises pour corriger l'erreur sur Render**
1. Option A (Recommandée) : Aller sur le Dashboard Stripe > Catalogue Produits > Sélectionner le produit `prod_VfBWa2FbP9UtWP` > Descendre à la section "Tarifs / Prix" > Copier l'ID du tarif commençant par `price_...` (ex: `price_1Qxxx...`) > Le coller dans Render (`STRIPE_PRICE_CLUB` ou `STRIPE_PRICE_PREMIUM`).
2. Option B (Ultra simple) : Supprimer ou vider la variable d'environnement `STRIPE_PRICE_CLUB` ou `STRIPE_PRICE_PREMIUM` sur Render. Le backend créera automatiquement et proprement le tarif Checkout récurrent mensuel à 5,99 € ou 8,99 € via `price_data`.

---

### Task 2: Sécurisation et Auto-résolution des Prix dans `StripeService`

**Files:**
- Modify: `backend/src/services/stripe.service.ts`
- Test: `backend/tests/stripe-price-resolution.test.js`

**Interfaces:**
- Consumes: `Stripe`, `SUBSCRIPTION_TIERS`
- Produces: `resolveLineItem(stripe: Stripe, configuredPriceId: string | undefined, tierConfig: SubscriptionTierConfig): Promise<Stripe.Checkout.SessionCreateParams.LineItem>`

- [ ] **Step 1: Écrire le test unitaire pour la résolution de ligne d'article Stripe**
Créer `backend/tests/stripe-price-resolution.test.js` pour tester :
1. `configuredPriceId` avec un `price_...` valide -> renvoie `{ price: 'price_...', quantity: 1 }`.
2. `configuredPriceId` avec un `prod_...` -> interroge le mock/Stripe et résout vers `price_...`.
3. `configuredPriceId` avec un `prod_...` introuvable -> logue un avertissement et bascule proprement sur `price_data` sans lever d'exception.
4. `configuredPriceId` non défini / vide -> génère `price_data` avec le montant exact en centimes et l'intervalle mensuel.

- [ ] **Step 2: Implémenter `resolveLineItem` dans `StripeService`**
Dans `backend/src/services/stripe.service.ts` :
1. Détecter si `configuredPriceId` commence par `prod_`.
2. Si oui, tenter de récupérer `product.default_price` via `stripe.products.retrieve(configuredPriceId)`. Si `default_price` est un `price_...`, l'utiliser. Sinon, appeler `stripe.prices.list({ product: configuredPriceId, active: true, limit: 5 })` et sélectionner le tarif récurrent mensuel.
3. Si la résolution réussit, utiliser ce `price_...`.
4. Si la résolution échoue (ex: produit archivé ou erreur d'API Stripe), intercepter l'erreur, afficher un log explicatif (`[StripeService] Impossible de résoudre le produit prod_..., fallback sur price_data`) et retourner le `price_data` par défaut.
5. Si `configuredPriceId` commence par `price_` ou `plan_`, l'utiliser directement.
6. Si aucun ID n'est configuré, renvoyer `price_data`.

- [ ] **Step 3: Mettre à jour `createCheckoutSession` pour appeler `resolveLineItem`**
Remplacer le bloc ternaire simple par `await this.resolveLineItem(stripe, configuredPriceId, tierConfig)`.

- [ ] **Step 4: Compiler TypeScript et exécuter les tests**
Exécuter `npm --prefix backend run build` puis `node --test backend/tests/stripe-price-resolution.test.js` et la suite complète `npm --prefix backend test`.

---

### Task 3: Vérification de bout en bout et validation

**Files:**
- Modify: `backend/dist/*` (via build)
- Test: `backend/tests/stripe-subscription.test.js`, `backend/tests/stripe-price-resolution.test.js`

- [ ] **Step 1: Vérifier le comportement en simulation et avec variables d'environnement mockées**
Valider que la route `/api/v1/subscriptions/stripe/checkout` ne renvoie plus d'erreur 500 lorsque `STRIPE_PRICE_CLUB=prod_VfBWa2FbP9UtWP`.

- [ ] **Step 2: Exécuter l'ensemble de la suite de tests backend**
Vérifier que tous les tests (133+ sous-tests) passent à 100%.
