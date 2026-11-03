import { Application, Router } from "express";
import userController from "../controllers/user.controller";

export default (app: Application): void => {
  const router = Router();

  // Authentification front web sécurisée par la montre Garmin
  router.post("/auth/request", userController.requestWebLogin);
  router.get("/auth/status/:requestId", userController.checkWebLoginStatus);
  router.get("/auth/pending", userController.getPendingLoginRequest);
  router.post("/auth/respond", userController.respondLoginRequest);

  // Profil et historique des courses (uniquement les classements)
  router.get("/profile/:userId", userController.getUserProfile);

  app.use("/api/user", router);
  app.use("/api/users", router);
};
