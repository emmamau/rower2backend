import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Private Room Creation Quotas: Template contains user offer, concurrent available, and weekly available rooms', () => {
  const htmlPath = path.join(rootDir, 'src/app/components/private-room-manager/private-room-manager.component.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  // Verify prominent quota summary card is placed inside the creation tab
  assert.match(html, /class="priv-quota-summary-card"/, 'Creation panel must include priv-quota-summary-card');

  // Verify display of the user offer
  assert.match(html, /Votre offre\s*:\s*<\/span>\s*<strong[^>]*>\s*\{\{\s*userOfferName\s*\}\}\s*<\/strong>/,
    'Must display the user offer name in the quota header');

  // Verify display of concurrent parallel rooms available
  assert.match(html, /Salons en parallèle disponibles\s*:\s*<\/span>/,
    'Must display label "Salons en parallèle disponibles :"');
  assert.match(html, /\{\{\s*concurrentRoomsAvailable\s*\}\}/,
    'Must bind concurrentRoomsAvailable value');

  // Verify display of weekly rooms that can still be opened
  assert.match(html, /Salons dans la semaine pouvant encore être ouverts\s*:\s*<\/span>/,
    'Must display label "Salons dans la semaine pouvant encore être ouverts :"');
  assert.match(html, /\{\{\s*weeklyRoomsAvailable\s*\}\}/,
    'Must bind weeklyRoomsAvailable value');

  // Verify warning strip when quota is reached
  assert.match(html, /class="priv-quota-warning-strip"/,
    'Must provide a warning strip when concurrent or weekly quota is reached');
});

test('Private Room Creation Quotas: Component logic correctly derives offer and remaining rooms', () => {
  const tsPath = path.join(rootDir, 'src/app/components/private-room-manager/private-room-manager.component.ts');
  const ts = fs.readFileSync(tsPath, 'utf-8');

  // Verify userOfferName getter
  assert.match(ts, /get\s+userOfferName\s*\(\)\s*:\s*string/, 'Must define userOfferName getter');
  assert.match(ts, /Administrateur/, 'userOfferName must handle admin');
  assert.match(ts, /Offre Élite Pro/, 'userOfferName must handle elite pro');
  assert.match(ts, /Offre Club/, 'userOfferName must handle club');
  assert.match(ts, /Offre Gratuite/, 'userOfferName must handle free');

  // Verify concurrent and weekly getters
  assert.match(ts, /get\s+concurrentRoomsAvailable\s*\(\)/, 'Must define concurrentRoomsAvailable getter');
  assert.match(ts, /get\s+concurrentRoomsMax\s*\(\)/, 'Must define concurrentRoomsMax getter');
  assert.match(ts, /get\s+weeklyRoomsAvailable\s*\(\)/, 'Must define weeklyRoomsAvailable getter');
  assert.match(ts, /get\s+weeklyRoomsMax\s*\(\)/, 'Must define weeklyRoomsMax getter');

  // Verify isConcurrentQuotaReached and isWeeklyQuotaReached
  assert.match(ts, /get\s+isConcurrentQuotaReached\s*\(\)/, 'Must define isConcurrentQuotaReached getter');
  assert.match(ts, /get\s+isWeeklyQuotaReached\s*\(\)/, 'Must define isWeeklyQuotaReached getter');

  // Verify switchTab triggers refreshRoomLimits when switching to create tab
  assert.match(ts, /tab\s*===\s*'create'[\s\S]*?this\.refreshRoomLimits\(\)/,
    'switchTab must call refreshRoomLimits() when switching to create tab');
});

test('Private Room Creation Quotas: CSS provides modern styling and responsive layout', () => {
  const cssPath = path.join(rootDir, 'src/app/components/private-room-manager/private-room-manager.component.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  assert.match(css, /\.priv-quota-summary-card\s*\{/, 'Must define .priv-quota-summary-card styles');
  assert.match(css, /\.priv-quota-header-row\s*\{/, 'Must define .priv-quota-header-row styles');
  assert.match(css, /\.priv-quota-pill\s*\{/, 'Must define .priv-quota-pill styles');
  assert.match(css, /\.priv-quota-pill\.is-exhausted\s*\{/, 'Must style exhausted state');
  assert.match(css, /\.priv-quota-warning-strip\s*\{/, 'Must style quota warning strip');
});

test('Private Room Creation Quotas: Simulation of limits and availability rules', () => {
  // Pure logic simulation matching component getters
  function getQuotas(isUserAdmin, quotaInfo, userSubscriptionTier, isSubscriber) {
    const userOfferName = isUserAdmin
      ? 'Administrateur'
      : (quotaInfo?.tierName || (
          ['pro', 'elite_pro', 'premium'].includes(String(userSubscriptionTier).toLowerCase())
            ? 'Offre Élite Pro'
            : (['club', 'standard', 'intermediate'].includes(String(userSubscriptionTier).toLowerCase()) || isSubscriber
                ? 'Offre Club'
                : 'Offre Gratuite')
        ));

    const concurrentRoomsAvailable = isUserAdmin
      ? 'Illimités'
      : (quotaInfo?.concurrent ? quotaInfo.concurrent.remaining : (
          ['pro', 'elite_pro', 'premium'].includes(String(userSubscriptionTier).toLowerCase()) ? 5 :
          (['club', 'standard', 'intermediate'].includes(String(userSubscriptionTier).toLowerCase()) || isSubscriber ? 3 : 1)
        ));

    const weeklyRoomsAvailable = isUserAdmin
      ? 'Illimités'
      : (quotaInfo?.weekly ? quotaInfo.weekly.remaining : (
          ['pro', 'elite_pro', 'premium'].includes(String(userSubscriptionTier).toLowerCase()) ? 15 :
          (['club', 'standard', 'intermediate'].includes(String(userSubscriptionTier).toLowerCase()) || isSubscriber ? 10 : 5)
        ));

    const isConcurrentQuotaReached = !isUserAdmin && quotaInfo?.concurrent && quotaInfo.concurrent.remaining <= 0;
    const isWeeklyQuotaReached = !isUserAdmin && quotaInfo?.weekly && quotaInfo.weekly.remaining <= 0;

    return {
      userOfferName,
      concurrentRoomsAvailable,
      weeklyRoomsAvailable,
      isConcurrentQuotaReached,
      isWeeklyQuotaReached
    };
  }

  // Case 1: Free tier user with 0 active rooms, 2 weekly rooms used (3 left)
  const freeUser = getQuotas(false, {
    tierName: 'Offre Gratuite',
    concurrent: { current: 0, max: 1, remaining: 1 },
    weekly: { current: 2, max: 5, remaining: 3 }
  }, 'free', false);

  assert.equal(freeUser.userOfferName, 'Offre Gratuite');
  assert.equal(freeUser.concurrentRoomsAvailable, 1);
  assert.equal(freeUser.weeklyRoomsAvailable, 3);
  assert.equal(freeUser.isConcurrentQuotaReached, false);
  assert.equal(freeUser.isWeeklyQuotaReached, false);

  // Case 2: Club subscriber at parallel limit (3 rooms open, 0 left)
  const clubUserAtLimit = getQuotas(false, {
    tierName: 'Offre Club',
    concurrent: { current: 3, max: 3, remaining: 0 },
    weekly: { current: 4, max: 10, remaining: 6 }
  }, 'club', true);

  assert.equal(clubUserAtLimit.userOfferName, 'Offre Club');
  assert.equal(clubUserAtLimit.concurrentRoomsAvailable, 0);
  assert.equal(clubUserAtLimit.weeklyRoomsAvailable, 6);
  assert.equal(clubUserAtLimit.isConcurrentQuotaReached, true);
  assert.equal(clubUserAtLimit.isWeeklyQuotaReached, false);

  // Case 3: Administrator (unlimited)
  const adminUser = getQuotas(true, {
    tierName: 'Administrateur',
    concurrent: { current: 5, max: 999, remaining: 994 },
    weekly: { current: 20, max: 999, remaining: 979 }
  }, 'premium', true);

  assert.equal(adminUser.userOfferName, 'Administrateur');
  assert.equal(adminUser.concurrentRoomsAvailable, 'Illimités');
  assert.equal(adminUser.weeklyRoomsAvailable, 'Illimités');
  assert.equal(adminUser.isConcurrentQuotaReached, false);
  assert.equal(adminUser.isWeeklyQuotaReached, false);
});
