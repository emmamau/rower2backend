import { Application, Router } from "express";
import requireAdmin from "../middleware/admin-auth.middleware";
import AdminController from "../controllers/admin.controller";

export default (app: Application): void => {
  const router = Router();

  // Toutes les routes /api/admin/* sont protégées par le middleware strict RBAC requireAdmin
  router.use(requireAdmin);

  // 1. Gestion des courses publiques (Pilote Automatique)
  router.get("/public-races/settings", AdminController.getPublicRaceSettings);
  router.put("/public-races/settings", AdminController.updatePublicRaceSettings);
  router.post("/public-races/toggle", AdminController.togglePublicRaces);
  router.post("/public-races/abort-and-reset", AdminController.abortAndResetPublicRace);

  // 2. Gestion des utilisateurs
  router.get("/users", AdminController.getUsers);
  router.post("/users/purge-anonymous", AdminController.purgeAnonymousUsers);
  router.get("/users/:id/details", AdminController.getUserDetails);
  router.delete("/users/:id", AdminController.deleteUser);
  router.patch("/users/:id/revoke", AdminController.revokeUser);
  router.patch("/users/:id/password", AdminController.resetUserPassword);
  router.patch("/users/:id/role", AdminController.updateUserRole);
  router.patch("/users/:id/plan", AdminController.updateUserPlan);
  router.patch("/users/:id/room-quotas", AdminController.updateUserRoomQuotas);

  // 3. Gestion des salons (privés & historiques)
  router.get("/rooms/active", AdminController.getActiveRooms);
  router.post("/rooms/:code/terminate", AdminController.terminateRoom);
  router.post("/rooms/purge-inactive", AdminController.purgeInactiveRooms);
  router.get("/rooms/history", AdminController.getRoomsHistory);

  // 4. Supervision globale & Système
  router.get("/system/metrics", AdminController.getSystemMetrics);
  router.post("/system/trigger-league-cycle", AdminController.triggerLeagueCycle);

  // 5. Statistiques & Analyse Plateforme
  router.get("/stats", AdminController.getPlatformStats);

  // 6. Gestion des offres & quotas
  router.get("/plans", AdminController.getPlans);
  router.post("/plans", AdminController.createPlan);
  router.put("/plans/:id", AdminController.updatePlan);
  router.patch("/plans/:id/toggle", AdminController.togglePlan);
  router.delete("/plans/:id", AdminController.deletePlan);

  // 7. Gestion de l'Anti-Triche & Mode Tests de Charge
  router.get("/anti-cheat/status", AdminController.getAntiCheatStatus);
  router.post("/anti-cheat/open-load-test", AdminController.openLoadTest);
  router.post("/anti-cheat/close-load-test", AdminController.closeLoadTest);
  router.post("/anti-cheat/toggle", AdminController.toggleAntiCheat);
  router.post("/anti-cheat/reset-stats", AdminController.resetAntiCheatStats);

  app.use("/api/admin", router);
};
