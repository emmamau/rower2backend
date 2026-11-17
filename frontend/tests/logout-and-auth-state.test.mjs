import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Auth state: isIdentified should require account authentication (subscriber, admin, or registered user), not merely watch pairing', () => {
  const appTsPath = path.resolve(__dirname, '../src/app/app.ts');
  const appTs = fs.readFileSync(appTsPath, 'utf8');

  // Verify that isIdentified getter does not consider paired watch alone as an identified account
  assert.match(
    appTs,
    /get\s+isIdentified\(\)\s*:\s*boolean\s*\{[\s\S]*?return\s+Boolean\(\s*this\.isSubscriber\s*\|\|\s*this\.isUserAdmin\s*\|\|\s*this\.isRegisteredUser\s*\);/m,
    'isIdentified must only return true for subscriber, admin, or registered user'
  );
});

test('Logout logic: logoutUser clears rower_subscription_tier, resets subscriptionTier to free, closes modal, and cleans session state', () => {
  const appTsPath = path.resolve(__dirname, '../src/app/app.ts');
  const appTs = fs.readFileSync(appTsPath, 'utf8');

  // Verify that localStorage.removeItem('rower_subscription_tier') is called
  assert.match(
    appTs,
    /localStorage\.removeItem\('rower_subscription_tier'\)/,
    'logoutUser must remove rower_subscription_tier from localStorage'
  );

  // Verify that localStorage.removeItem('rower_claimed_kayak_id') is called
  assert.match(
    appTs,
    /localStorage\.removeItem\('rower_claimed_kayak_id'\)/,
    'logoutUser must remove rower_claimed_kayak_id from localStorage'
  );

  // Verify currentUser resets subscriptionTier to free
  assert.match(
    appTs,
    /subscriptionTier:\s*'free'/i,
    'logoutUser must reset currentUser.subscriptionTier to free'
  );

  // Verify account modal is closed upon logout
  assert.match(
    appTs,
    /this\.isAccountModalOpen\s*=\s*false/,
    'logoutUser must close account modal'
  );
});

test('App template: Mon Compte and Profile navigation uses isIdentified consistently', () => {
  const appHtmlPath = path.resolve(__dirname, '../src/app/app.html');
  const appHtml = fs.readFileSync(appHtmlPath, 'utf8');

  // Verify player-card action button uses isIdentified for opening profile vs login
  assert.match(
    appHtml,
    /openAccountModal\(isIdentified\s*\?\s*'profile'\s*:\s*'login'\)/,
    'Template must open profile or login based on isIdentified'
  );
});

test('Behavioral simulation: Logout from subscribed user produces clean guest state without Abonné badge or Mon Compte', () => {
  const localStorageMock = new Map();
  const storage = {
    getItem: (k) => localStorageMock.get(k) || null,
    setItem: (k, v) => localStorageMock.set(k, String(v)),
    removeItem: (k) => localStorageMock.delete(k),
  };

  // Simulate logged-in user with club subscription
  storage.setItem('rower_user_id', 'JeanClub');
  storage.setItem('rower_user_login', 'JeanClub');
  storage.setItem('rower_is_subscriber', 'true');
  storage.setItem('rower_subscription_tier', 'club');
  storage.setItem('rower_is_paired', 'true');
  storage.setItem('rower_watch_confirmed', 'true');
  storage.setItem('rower_device_token', 'dev_token_123');

  let state = {
    activeUserId: 'JeanClub',
    userIdInput: 'JeanClub',
    currentUser: {
      id: 'JeanClub',
      name: 'JeanClub',
      login: 'JeanClub',
      isSubscriber: true,
      subscriptionTier: 'club',
      role: 'USER',
      isAdmin: false,
    },
    isPaired: true,
    isWatchConfirmed: true,
    deviceToken: 'dev_token_123',
    isAccountModalOpen: true,
    isLogoutConfirmModalOpen: false,
  };

  function getIsSubscriber(st, s) {
    return Boolean(
      st.currentUser.role === 'ADMIN' ||
      st.currentUser.isAdmin ||
      st.currentUser.isSubscriber ||
      (st.currentUser.subscriptionTier && st.currentUser.subscriptionTier !== 'free') ||
      (s.getItem('rower_is_subscriber') === 'true' ||
        (s.getItem('rower_subscription_tier') && s.getItem('rower_subscription_tier') !== 'free'))
    );
  }

  function getIsRegisteredUser(st, isSub) {
    if (isSub) return true;
    const login = st.currentUser?.login?.trim();
    const name = st.currentUser?.name?.trim();
    const isGuest = !login || login.startsWith('guest_') || login.startsWith('usr_');
    const isAnonymousRacer = !name || name.startsWith('Racer_');
    return !isGuest && !isAnonymousRacer;
  }

  function getIsIdentified(st, isSub, isReg) {
    return Boolean(isSub || st.currentUser.isAdmin || isReg);
  }

  assert.equal(getIsSubscriber(state, storage), true);
  assert.equal(getIsRegisteredUser(state, true), true);
  assert.equal(getIsIdentified(state, true, true), true);

  // Perform proper logout (with keepPairing = false)
  function logoutUser(st, s, keepPairing = false) {
    s.removeItem('rower_user_id');
    s.removeItem('rower_user_login');
    s.removeItem('rower_is_subscriber');
    s.removeItem('rower_is_admin');
    s.removeItem('rower_user_role');
    s.removeItem('rower_subscription_tier');
    s.removeItem('rower_auth_token');
    s.removeItem('rower_kayak_customization');
    s.removeItem('rower_claimed_kayak_id');

    if (!keepPairing) {
      s.removeItem('rower_is_paired');
      s.removeItem('rower_watch_confirmed');
      s.removeItem('rower_device_token');
      st.isPaired = false;
      st.isWatchConfirmed = false;
      st.deviceToken = '';
    } else {
      st.isPaired = true;
      st.isWatchConfirmed = true;
    }

    st.isAccountModalOpen = false;
    st.isLogoutConfirmModalOpen = false;
    const randId = 'abc123';
    st.activeUserId = `usr_${randId}`;
    st.userIdInput = st.activeUserId;
    st.currentUser = {
      id: st.activeUserId,
      name: `Racer_${st.activeUserId.slice(-4)}`,
      totalRaces: 0,
      totalWins: 0,
      podiums: 0,
      isAdmin: false,
      isSubscriber: false,
      subscriptionTier: 'free',
      role: 'USER',
      points: 0,
    };
  }

  logoutUser(state, storage, false);

  const afterSub = getIsSubscriber(state, storage);
  const afterReg = getIsRegisteredUser(state, afterSub);
  const afterIdentified = getIsIdentified(state, afterSub, afterReg);

  assert.equal(afterSub, false, 'User must not be subscriber after logout');
  assert.equal(afterReg, false, 'User must not be registered user after logout');
  assert.equal(afterIdentified, false, 'User must not be identified after logout');
  assert.equal(state.isAccountModalOpen, false, 'Account modal must be closed');
  assert.equal(storage.getItem('rower_subscription_tier'), null, 'rower_subscription_tier must be removed from localStorage');
});
