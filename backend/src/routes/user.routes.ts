import { Application, Router } from "express";
import userController from "../controllers/user.controller";
import { requireAuth } from "../middleware/auth.middleware";

export default (app: Application): void => {
  const router = Router();

  // Inscription & Connexion avec mot de passe pour les abonnés
  router.post("/register", userController.registerUser);
  router.post("/login", userController.loginUser);
  router.get("/me", userController.getMe);
  router.post("/forgot-password", userController.forgotPassword);
  router.post("/reset-password", userController.resetPassword);
  router.get("/account/:identifier", userController.getUserAccount);

  // Profil et historique des courses (uniquement les classements)
  router.get("/profile/:userId", userController.getUserProfile);
  router.get("/leaderboard", userController.getGeneralLeaderboard);
  router.put("/kayak", requireAuth, userController.updateKayakCustomization);
  router.put("/regatta-preferences", requireAuth, userController.updateRegattaPreferences);
  router.put("/duel-preferences", requireAuth, userController.updateDuelPreferences);
  router.put("/language", requireAuth, userController.updateUserLanguage);

  // Espace Statistiques & Analyses de courses (abonnés = illimité, gratuits = 10 jours)
  router.get("/statistics", userController.getUserStatistics);
  router.get("/statistics/:userId", userController.getUserStatistics);

  // Gestion de l'abonnement & Conformité RGPD (résiliation et suppression de compte)
  router.post("/unsubscribe", requireAuth, userController.unsubscribeUser);
  router.delete("/account", requireAuth, userController.deleteUserAccount);
  router.delete("/account/:userId", requireAuth, userController.deleteUserAccount);

  app.use("/api/user", router);
  app.use("/api/users", router);
};
