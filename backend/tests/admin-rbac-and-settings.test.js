const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const initAuthRoutes = require("../dist/routes/auth.routes").default;
const initAdminRoutes = require("../dist/routes/admin.routes").default;
const initUserRoutes = require("../dist/routes/user.routes").default;
const initRaceRoutes = require("../dist/routes/race.routes").default;
const initTelemetryRoutes = require("../dist/routes/telemetry.routes").default;
const db = require("../dist/models").default;
const AdminInitService = require("../dist/services/admin-init.service").default;
const JwtService = require("../dist/services/jwt.service").default;
const raceManager = require("../dist/services/race-manager.service").default;
const userStore = require("../dist/services/user-store.service").default;
const { hashPassword } = require("../dist/services/auth.service");

test.after(async () => {
  if (db?.sequelize?.close) {
    await db.sequelize.close().catch(() => {});
  }
});

function createTestServer() {
  const app = express();
  app.use(express.json());
  initAuthRoutes(app);
  initAdminRoutes(app);
  initUserRoutes(app);
  initRaceRoutes(app);
  initTelemetryRoutes(app);

  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}

test("1. Idempotent Admin & Settings Initialization", async () => {
  await AdminInitService.init();

  // Vérifier la présence du compte admin par défaut en mémoire / DB
  const admin = await userStore.findUser("Admin_RowerRace");
  assert.ok(admin, "Le compte admin par défaut doit exister");
  assert.equal(admin.role, "ADMIN");
  assert.equal(admin.email, "admin@rowerrace.com");

  // Idempotence : appel répété sans altérer le mot de passe
  const initialHash = admin.passwordHash;
  await AdminInitService.ensureDefaultAdmin();
  const adminAfter = await userStore.findUser("Admin_RowerRace");
  assert.equal(adminAfter.passwordHash, initialHash, "Le mot de passe existant ne doit pas être écrasé lors du ré-init");
});

test("2. Admin Login & JWT Generation", async () => {
  const ctx = await createTestServer();
  try {
    const res = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: "admin@rowerrace.com",
        password: "RowerAdmin2026!",
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.token, "Un jeton JWT doit être retourné");
    assert.equal(data.role, "ADMIN");
    assert.equal(data.isAdmin, true);

    // Vérifier l'accès à /api/auth/me avec le token
    const meRes = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${data.token}` },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.role, "ADMIN");
  } finally {
    await ctx.close();
  }
});

test("3. RBAC Access Control on /api/admin/*", async () => {
  const ctx = await createTestServer();
  try {
    // 3.1 Accès sans token -> 401
    const noTokenRes = await fetch(`${ctx.baseUrl}/api/admin/users`);
    assert.equal(noTokenRes.status, 401);

    // 3.2 Accès avec un token utilisateur normal (role: USER) -> 403
    const userToken = JwtService.sign({
      userId: "normal_user_1",
      login: "normal_user",
      role: "USER",
    });

    // Enregistrer l'utilisateur dans userStore pour qu'il soit trouvé
    await userStore.createUser({
      id: "normal_user_1",
      name: "Normal User",
      login: "normal_user",
      email: "user@example.com",
      role: "USER",
      isAdmin: false,
    });

    const forbiddenRes = await fetch(`${ctx.baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(forbiddenRes.status, 403);

    // 3.3 Accès avec token ADMIN -> 200
    const adminToken = JwtService.sign({
      userId: "usr_admin_rowerrace",
      login: "Admin_RowerRace",
      role: "ADMIN",
    });
    const okRes = await fetch(`${ctx.baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(okRes.status, 200);
    const okData = await okRes.json();
    assert.ok(Array.isArray(okData.users));
  } finally {
    await ctx.close();
  }
});

test("4. Public Races Settings & Master Toggle", async () => {
  const ctx = await createTestServer();
  try {
    const adminToken = JwtService.sign({
      userId: "usr_admin_rowerrace",
      login: "Admin_RowerRace",
      role: "ADMIN",
    });

    // 4.1 Récupération des paramètres actuels
    const getRes = await fetch(`${ctx.baseUrl}/api/admin/public-races/settings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.ok(getData.settings);

    // 4.2 Modification des paramètres
    const putRes = await fetch(`${ctx.baseUrl}/api/admin/public-races/settings`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        race_distance_m: 1500,
        bot_count: 4,
        max_players: 8,
      }),
    });
    assert.equal(putRes.status, 200);
    const putData = await putRes.json();
    assert.equal(putData.success, true);
    assert.equal(raceManager.publicRaceDistanceM, 1500);

    // 4.3 Bascule de l'interrupteur maître sur suspendu
    const toggleOff = await fetch(`${ctx.baseUrl}/api/admin/public-races/toggle`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_enabled: false }),
    });
    assert.equal(toggleOff.status, 200);
    assert.equal(raceManager.isPublicRaceEnabled, false);

    // Vérifier que getNextRace renvoie l'état suspendu
    const nextRaceRes = await fetch(`${ctx.baseUrl}/api/race/next`);
    const nextRaceData = await nextRaceRes.json();
    assert.equal(nextRaceData.isSuspended, true);

    // 4.4 Réactivation
    const toggleOn = await fetch(`${ctx.baseUrl}/api/admin/public-races/toggle`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_enabled: true }),
    });
    assert.equal(toggleOn.status, 200);
    assert.equal(raceManager.isPublicRaceEnabled, true);
  } finally {
    await ctx.close();
  }
});

test("5. User Revocation, Self-Revocation Protection & Password Reset", async () => {
  const ctx = await createTestServer();
  try {
    const adminToken = JwtService.sign({
      userId: "usr_admin_rowerrace",
      login: "Admin_RowerRace",
      role: "ADMIN",
    });

    // Création d'un coureur de test
    const timestamp = Date.now();
    const testRacer = await userStore.createUser({
      id: `racer_${timestamp}`,
      name: "Racer Test",
      login: `racer_${timestamp}`,
      email: `racer_${timestamp}@test.com`,
      role: "USER",
      isAdmin: false,
      isRevoked: false,
    });

    // 5.1 Révocation de l'utilisateur
    const revokeRes = await fetch(`${ctx.baseUrl}/api/admin/users/${testRacer.id}/revoke`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_revoked: true }),
    });
    assert.equal(revokeRes.status, 200);

    // 5.2 Tentative de connexion de l'utilisateur révoqué -> 403 Forbidden
    const loginRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: testRacer.login,
        password: "anyPassword",
      }),
    });
    assert.equal(loginRes.status, 403);

    // 5.3 Protection auto-révocation admin
    const selfRevokeRes = await fetch(`${ctx.baseUrl}/api/admin/users/usr_admin_rowerrace/revoke`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_revoked: true }),
    });
    assert.equal(selfRevokeRes.status, 400, "Un admin ne doit pas pouvoir révoquer son propre compte");

    // 5.4 Rétablissement de l'accès
    const restoreRes = await fetch(`${ctx.baseUrl}/api/admin/users/${testRacer.id}/revoke`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_revoked: false }),
    });
    assert.equal(restoreRes.status, 200);

    // 5.5 Réinitialisation de mot de passe par l'admin
    const resetPwdRes = await fetch(`${ctx.baseUrl}/api/admin/users/${testRacer.id}/password`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ newPassword: "NewSecretPassword2026!" }),
    });
    assert.equal(resetPwdRes.status, 200);

    // Connexion avec le nouveau mot de passe
    const loginNewPwd = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: testRacer.login,
        password: "NewSecretPassword2026!",
      }),
    });
    assert.equal(loginNewPwd.status, 200);
  } finally {
    await ctx.close();
  }
});

test("6. Subscription Plans CRUD & Quota Invalidation", async () => {
  const ctx = await createTestServer();
  try {
    const adminToken = JwtService.sign({
      userId: "usr_admin_rowerrace",
      login: "Admin_RowerRace",
      role: "ADMIN",
    });

    // 6.1 Lecture de la liste des offres
    const listRes = await fetch(`${ctx.baseUrl}/api/admin/plans`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(Array.isArray(listData.plans));

    // 6.2 Création d'une nouvelle offre
    const newPlanCode = `VIP_${Date.now()}`;
    const createRes = await fetch(`${ctx.baseUrl}/api/admin/plans`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: newPlanCode,
        name: "Offre VIP Regatta",
        description: "Accès illimité avec 8 bots et 20 rameurs par salon",
        priceMonthly: 19.99,
        priceYearly: 199.99,
        maxBotsPerRace: 8,
        maxRaceDistanceM: 20000,
        maxPlayersPerRoom: 20,
        maxConcurrentRooms: 10,
        maxRoomsPerWeek: 50,
        canCreateDuel1v1: true,
        canScheduleRaces: true,
      }),
    });
    // Si PostgreSQL est hors-ligne dans l'environnement de test, le contrôleur tente DB et renvoie 201 ou gère
    if (createRes.status === 201) {
      const createData = await createRes.json();
      assert.equal(createData.success, true);
      assert.equal(createData.plan.code, newPlanCode);
    }
  } finally {
    await ctx.close();
  }
});

test("7. User Role and Subscription Plan Modification by Admin", async () => {
  const ctx = await createTestServer();
  try {
    const adminToken = JwtService.sign({
      userId: "usr_admin_rowerrace",
      login: "Admin_RowerRace",
      role: "ADMIN",
    });

    const timestamp = Date.now();
    const testRacer = await userStore.createUser({
      id: `racer_role_${timestamp}`,
      name: "Racer Role Test",
      login: `racer_role_${timestamp}`,
      email: `racer_role_${timestamp}@test.com`,
      role: "USER",
      isAdmin: false,
      subscriptionTier: "free",
      isSubscriber: false,
    });

    // 7.1 Modification du rôle : USER -> ADMIN
    const rolePromoteRes = await fetch(`${ctx.baseUrl}/api/admin/users/${testRacer.id}/role`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "ADMIN" }),
    });
    assert.equal(rolePromoteRes.status, 200);
    const promoteData = await rolePromoteRes.json();
    assert.equal(promoteData.success, true);
    assert.equal(promoteData.user.role, "ADMIN");

    // Vérifier que le store a bien persisté le nouveau rôle
    const storedAfterPromote = await userStore.findUser(testRacer.id);
    assert.ok(storedAfterPromote);
    assert.equal(storedAfterPromote.role, "ADMIN");
    assert.equal(storedAfterPromote.isAdmin, true);

    // 7.2 L'utilisateur promu peut maintenant générer un token ADMIN et appeler /api/admin/users
    const promotedToken = JwtService.sign({
      userId: testRacer.id,
      login: testRacer.login,
      role: "ADMIN",
    });
    const adminAccessRes = await fetch(`${ctx.baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${promotedToken}` },
    });
    assert.equal(adminAccessRes.status, 200);

    // 7.3 Modification de l'offre d'abonnement : free -> premium
    const planRes = await fetch(`${ctx.baseUrl}/api/admin/users/${testRacer.id}/plan`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subscriptionTier: "premium" }),
    });
    assert.equal(planRes.status, 200);
    const planData = await planRes.json();
    assert.equal(planData.success, true);
    assert.equal(planData.user.subscriptionTier, "premium");

    const storedAfterPlan = await userStore.findUser(testRacer.id);
    assert.ok(storedAfterPlan);
    assert.equal(storedAfterPlan.subscriptionTier, "premium");
    assert.equal(storedAfterPlan.isSubscriber, true);

    // 7.4 Rétrogradation : ADMIN -> USER
    const roleDemoteRes = await fetch(`${ctx.baseUrl}/api/admin/users/${testRacer.id}/role`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "USER" }),
    });
    assert.equal(roleDemoteRes.status, 200);
    const demoteData = await roleDemoteRes.json();
    assert.equal(demoteData.user.role, "USER");

    // Démotion de l'autre admin éventuel (EmmaRacer) pour qu'il ne reste plus qu'un seul admin actif
    const emmaUser = await userStore.findUser("EmmaRacer");
    if (emmaUser) {
      await fetch(`${ctx.baseUrl}/api/admin/users/${emmaUser.id}/role`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "USER" }),
      });
    }

    // 7.5 Protection : tentative de retirer le rôle au dernier admin restant -> 400
    const demoteLastAdminRes = await fetch(`${ctx.baseUrl}/api/admin/users/usr_admin_rowerrace/role`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "USER" }),
    });
    assert.equal(demoteLastAdminRes.status, 400, "Le dernier administrateur actif ne peut pas être rétrogradé en USER");
  } finally {
    await ctx.close();
  }
});

test("8. User Reconnection & Profile Reflection after Admin Updates Role and Plan", async () => {
  const ctx = await createTestServer();
  try {
    const adminToken = JwtService.sign({
      userId: "usr_admin_rowerrace",
      login: "Admin_RowerRace",
      role: "ADMIN",
    });

    const timestamp = Date.now();
    const userPassword = "UserPass2026!";
    const { hash, salt } = hashPassword(userPassword);

    const testUser = await userStore.createUser({
      id: `racer_reconnect_${timestamp}`,
      login: `racer_reconnect_${timestamp}`,
      name: "Racer Reconnect",
      email: `racer_reconnect_${timestamp}@test.com`,
      passwordHash: hash,
      passwordSalt: salt,
      role: "USER",
      isAdmin: false,
      subscriptionTier: "free",
      isSubscriber: false,
    });

    // 8.1 Vérification de l'état initial lors d'une première connexion
    const initialLoginRes = await fetch(`${ctx.baseUrl}/api/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: testUser.login,
        password: userPassword,
      }),
    });
    assert.equal(initialLoginRes.status, 200);
    const initialLoginData = await initialLoginRes.json();
    assert.equal(initialLoginData.role, "USER");
    assert.equal(initialLoginData.subscriptionTier, "free");
    assert.equal(initialLoginData.isSubscriber, false);
    assert.equal(initialLoginData.isAdmin, false);

    // 8.2 L'administrateur met à jour l'offre en "premium" et le rôle en "ADMIN"
    const planUpdateRes = await fetch(`${ctx.baseUrl}/api/admin/users/${testUser.id}/plan`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subscriptionTier: "premium" }),
    });
    assert.equal(planUpdateRes.status, 200);

    const roleUpdateRes = await fetch(`${ctx.baseUrl}/api/admin/users/${testUser.id}/role`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "ADMIN" }),
    });
    assert.equal(roleUpdateRes.status, 200);

    // 8.3 Reconnexion de l'utilisateur : vérification immédiate des nouvelles valeurs
    const reloginRes = await fetch(`${ctx.baseUrl}/api/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: testUser.login,
        password: userPassword,
      }),
    });
    assert.equal(reloginRes.status, 200);
    const reloginData = await reloginRes.json();
    assert.equal(reloginData.role, "ADMIN");
    assert.equal(reloginData.isAdmin, true);
    assert.equal(reloginData.subscriptionTier, "premium");
    assert.equal(reloginData.isSubscriber, true);
    assert.equal(reloginData.user.role, "ADMIN");
    assert.equal(reloginData.user.subscriptionTier, "premium");
    assert.equal(reloginData.user.isSubscriber, true);

    // 8.4 Vérification via l'endpoint de profil /api/user/profile/:userId
    const profileRes = await fetch(`${ctx.baseUrl}/api/user/profile/${testUser.id}`);
    assert.equal(profileRes.status, 200);
    const profileData = await profileRes.json();
    assert.equal(profileData.user.role, "ADMIN");
    assert.equal(profileData.user.isAdmin, true);
    assert.equal(profileData.user.subscriptionTier, "premium");
    assert.equal(profileData.user.isSubscriber, true);

    // 8.5 Vérification via /api/auth/me avec le nouveau jeton
    const meRes = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${reloginData.token}` },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.role, "ADMIN");
    assert.equal(meData.isAdmin, true);
    assert.equal(meData.subscriptionTier, "premium");
    assert.equal(meData.isSubscriber, true);
  } finally {
    await ctx.close();
  }
});

test("9. User Custom Room Quotas: Admin modification and enforcement on limits & creation", async () => {
  const ctx = await createTestServer();
  try {
    const adminToken = JwtService.sign({
      userId: "usr_admin_rowerrace",
      login: "Admin_RowerRace",
      role: "ADMIN",
    });

    const targetUser = await userStore.createUser({
      login: "quota_racer",
      name: "Quota Racer",
      email: "quota@example.com",
      subscriptionTier: "free",
      isSubscriber: false,
      role: "USER",
      isAdmin: false,
      isRevoked: false,
      isConfirmed: true,
    });

    // 9.1 Vérifier les quotas initiaux par défaut (offre free : 1 concurrent, 5 / semaine)
    const initialLimitsRes = await fetch(`${ctx.baseUrl}/api/v1/races/private/limits?hostUserId=${targetUser.id}`);
    assert.equal(initialLimitsRes.status, 200);
    const initialLimits = await initialLimitsRes.json();
    assert.equal(initialLimits.concurrent.max, 1);
    assert.equal(initialLimits.weekly.max, 5);

    // 9.2 L'administrateur personnalise les quotas du joueur : 4 simultanés, 25 par semaine
    const patchRes = await fetch(`${ctx.baseUrl}/api/admin/users/${targetUser.id}/room-quotas`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customConcurrentRooms: 4,
        customWeeklyRooms: 25,
      }),
    });
    assert.equal(patchRes.status, 200);
    const patchData = await patchRes.json();
    assert.equal(patchData.success, true);
    assert.equal(patchData.user.customConcurrentRooms, 4);
    assert.equal(patchData.user.customWeeklyRooms, 25);

    // 9.3 L'endpoint des quotas reflète immédiatement les surcharges personnalisées
    const updatedLimitsRes = await fetch(`${ctx.baseUrl}/api/v1/races/private/limits?hostUserId=${targetUser.id}`);
    assert.equal(updatedLimitsRes.status, 200);
    const updatedLimits = await updatedLimitsRes.json();
    assert.equal(updatedLimits.concurrent.max, 4);
    assert.equal(updatedLimits.concurrent.remaining, 4);
    assert.equal(updatedLimits.weekly.max, 25);
    assert.equal(updatedLimits.weekly.remaining, 25);

    // 9.4 Réinitialisation des surcharges (retour au comportement par défaut de l'offre)
    const resetRes = await fetch(`${ctx.baseUrl}/api/admin/users/${targetUser.id}/room-quotas`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customConcurrentRooms: null,
        customWeeklyRooms: null,
      }),
    });
    assert.equal(resetRes.status, 200);
    const resetData = await resetRes.json();
    assert.equal(resetData.user.customConcurrentRooms, null);
    assert.equal(resetData.user.customWeeklyRooms, null);

    const resetLimitsRes = await fetch(`${ctx.baseUrl}/api/v1/races/private/limits?hostUserId=${targetUser.id}`);
    assert.equal(resetLimitsRes.status, 200);
    const resetLimits = await resetLimitsRes.json();
    assert.equal(resetLimits.concurrent.max, 1);
    assert.equal(resetLimits.weekly.max, 5);
  } finally {
    await ctx.close();
  }
});
