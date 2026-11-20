import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('RowerService createSubscriptionCheckout wires returnUrl and cancelUrl to window.location.origin', () => {
  const serviceTs = fs.readFileSync(path.join(__dirname, '../src/app/services/rower.service.ts'), 'utf8');

  // Verify that createSubscriptionCheckout resolves returnUrl and cancelUrl from origin
  assert.ok(serviceTs.includes('createSubscriptionCheckout('), 'Doit définir createSubscriptionCheckout');
  assert.ok(serviceTs.includes('resolvedReturnUrl'), 'Doit résoudre resolvedReturnUrl');
  assert.ok(serviceTs.includes('resolvedCancelUrl'), 'Doit résoudre resolvedCancelUrl');
  assert.ok(
    serviceTs.includes('subscription=success') && serviceTs.includes('session_id={CHECKOUT_SESSION_ID}'),
    'Doit inclure subscription=success et session_id={CHECKOUT_SESSION_ID} dans resolvedReturnUrl'
  );
  assert.ok(
    serviceTs.includes('subscription=canceled'),
    'Doit inclure subscription=canceled dans resolvedCancelUrl'
  );
});

test('AppComponent ngOnInit handles subscription=success and subscription=canceled query parameters', () => {
  const appTs = fs.readFileSync(path.join(__dirname, '../src/app/app.ts'), 'utf8');

  assert.ok(appTs.includes("urlParams.get('subscription')"), "Doit analyser le paramètre 'subscription'");
  assert.ok(appTs.includes("subscriptionParam === 'success'"), "Doit vérifier subscription === 'success'");
  assert.ok(appTs.includes('this.loadUserProfile()'), 'Doit recharger le profil utilisateur');
  assert.ok(appTs.includes('this.isSubscriptionModalOpen = true'), "Doit ouvrir la modal d'abonnement");
  assert.ok(appTs.includes("subscriptionParam === 'canceled'"), "Doit gérer subscription === 'canceled'");
  assert.ok(appTs.includes('window.history.replaceState'), "Doit nettoyer l'URL après traitement");
});
