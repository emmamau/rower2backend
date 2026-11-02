import { Application, Router } from "express";
import activityController from "../controllers/activity.controller";

export default (app: Application): void => {
  const router = Router();

  // POST /api/activity/sync (Met à jour l'unique ligne de l'activité pour cet utilisateur)
  router.post("/sync", activityController.syncActivity);

  // GET /api/activity/latest (Dernière activité & état d'un utilisateur)
  router.get("/latest", activityController.getLatestUserActivity);

  // GET /api/activity/race/:activityId/leaderboard (Classement en direct de la course)
  router.get("/race/:activityId/leaderboard", activityController.getRaceLeaderboard);

  // GET /api/activity/history
  router.get("/history", activityController.getAll);

  // Routes compatibles singulier / pluriel
  app.use("/api/activity", router);
  app.use("/api/activities", router);

  // Alias rétrocompatibilité avec la version initiale
  app.use("/api/rower/data", activityController.syncActivity);
  app.use("/api/rower/latest", activityController.getLatestUserActivity);
  app.use("/api/rower/history", activityController.getAll);
};

