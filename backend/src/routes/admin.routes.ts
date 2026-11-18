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

  // 2. Gestion des utilisateurs
  router.get("/users", AdminController.getUsers);
  router.patch("/users/:id/revoke", AdminController.revokeUser);
  router.patch("/users/:id/password", AdminController.resetUserPassword);
  router.patch("/users/:id/role", AdminController.updateUserRole);
  router.patch("/users/:id/plan", AdminController.updateUserPlan);
  router.patch("/users/:id/room-quotas", AdminController.updateUserRoomQuotas);

  // 3. Gestion des offres & quotas
  router.get("/plans", AdminController.getPlans);
  router.post("/plans", AdminController.createPlan);
  router.put("/plans/:id", AdminController.updatePlan);
  router.delete("/plans/:id", AdminController.deletePlan);

  app.use("/api/admin", router);
};
