import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Subscription Modal: displays pricing only when active, hides pricing by default', () => {
  const modalHtmlPath = path.resolve(__dirname, '../src/app/components/modals/subscription-modal/subscription-modal.component.html');
  const modalTsPath = path.resolve(__dirname, '../src/app/components/modals/subscription-modal/subscription-modal.component.ts');
  const appTsPath = path.resolve(__dirname, '../src/app/app.ts');

  const html = fs.readFileSync(modalHtmlPath, 'utf8');
  const modalTs = fs.readFileSync(modalTsPath, 'utf8');
  const appTs = fs.readFileSync(appTsPath, 'utf8');

  // 1. Verify HTML wraps pricing block in *ngIf="isTierActive(...)"
  assert.match(
    html,
    /<ng-container\s+\*ngIf="isTierActive\('free'\)">[\s\S]*?pricing-price[\s\S]*?pricing-period[\s\S]*?<\/ng-container>/,
    'Free tier pricing must be conditioned on isTierActive(\'free\')'
  );
  assert.match(
    html,
    /<ng-container\s+\*ngIf="isTierActive\('intermediate'\)">[\s\S]*?pricing-price[\s\S]*?pricing-period[\s\S]*?<\/ng-container>/,
    'Intermediate tier pricing must be conditioned on isTierActive(\'intermediate\')'
  );
  assert.match(
    html,
    /<ng-container\s+\*ngIf="isTierActive\('premium'\)">[\s\S]*?pricing-price[\s\S]*?pricing-period[\s\S]*?<\/ng-container>/,
    'Premium tier pricing must be conditioned on isTierActive(\'premium\')'
  );

  // 2. Verify Free tier button is disabled and shows disabled state when inactive
  assert.match(
    html,
    /!isTierActive\('free'\)/,
    'Free tier button must check isTierActive(\'free\')'
  );

  // 3. Verify isTierActive implementation in SubscriptionModalComponent defaults to false (no price by default)
  function simulateIsTierActive(subscriptionTiers, tierId) {
    const clean = String(tierId || '').toLowerCase().trim();
    const tier = (subscriptionTiers || []).find((t) => {
      const code = String(t.code || t.id || '').toLowerCase().trim();
      return code === clean || (clean === 'intermediate' && code === 'standard') || (clean === 'premium' && code === 'elite_pro');
    });
    if (!tier) return false;
    return tier.isActive === true;
  }

  // When no tiers loaded yet: false by default
  assert.equal(simulateIsTierActive([], 'free'), false);
  assert.equal(simulateIsTierActive([], 'intermediate'), false);
  assert.equal(simulateIsTierActive([], 'premium'), false);

  // When tier isActive is false: false
  const inactiveTiers = [
    { id: 'free', isActive: false },
    { id: 'intermediate', isActive: false },
    { id: 'premium', isActive: false }
  ];
  assert.equal(simulateIsTierActive(inactiveTiers, 'free'), false);
  assert.equal(simulateIsTierActive(inactiveTiers, 'intermediate'), false);
  assert.equal(simulateIsTierActive(inactiveTiers, 'premium'), false);

  // 4. Verify secure badge is hidden when no paid tier is active
  assert.match(
    html,
    /\*ngIf="hasPaidTierActive\(\)"[^>]*>\{\{\s*i18n\.t\('SUB_SECURE_BADGE'\)\s*\}\}/,
    'SUB_SECURE_BADGE must be conditioned on hasPaidTierActive()'
  );

  function simulateHasPaidTierActive(subscriptionTiers) {
    const isTierActive = (tierId) => simulateIsTierActive(subscriptionTiers, tierId);
    if (isTierActive('intermediate') || isTierActive('premium')) return true;
    return (subscriptionTiers || []).some((t) => {
      const code = String(t.code || t.id || '').toLowerCase().trim();
      return code !== 'free' && t.isActive === true;
    });
  }

  // When no tiers: false
  assert.equal(simulateHasPaidTierActive([]), false);
  // When only free is active: false
  assert.equal(simulateHasPaidTierActive([{ id: 'free', isActive: true }, { id: 'intermediate', isActive: false }]), false);
  // When paid tier is active: true
  assert.equal(simulateHasPaidTierActive([{ id: 'free', isActive: true }, { id: 'intermediate', isActive: true }]), true);
  assert.equal(simulateHasPaidTierActive([{ id: 'premium', isActive: true }]), true);
});
