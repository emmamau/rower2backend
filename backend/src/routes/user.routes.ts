import { Application, Router } from "express";
import userController from "../controllers/user.controller";

export default (app: Application): void => {
  const router = Router();

  // Inscription & Connexion avec mot de passe pour les abonnés
  router.post("/register", userController.registerUser);
  router.post("/login", userController.loginUser);
  router.post("/forgot-password", userController.forgotPassword);
  router.post("/reset-password", userController.resetPassword);
  router.get("/account/:identifier", userController.getUserAccount);

  // Authentification front web sécurisée par la montre Garmin
  router.post("/auth/request", userController.requestWebLogin);
  router.get("/auth/status/:requestId", userController.checkWebLoginStatus);
  router.get("/auth/pending", userController.getPendingLoginRequest);
  router.post("/auth/respond", userController.respondLoginRequest);

  // Profil et historique des courses (uniquement les classements)
  router.get("/profile/:userId", userController.getUserProfile);
  router.put("/prefix", userController.updateUserPrefix);
  router.get("/leaderboard", userController.getGeneralLeaderboard);

  app.use("/api/user", router);
  app.use("/api/users", router);
};
