import { Application, Router } from "express";
import LeagueController from "../controllers/league.controller";

export default (app: Application): void => {
  const router = Router();

  // 1. Classements hebdomadaires par ligue
  router.get("/standings", LeagueController.getStandings);

  // 2. Bilan hebdomadaire non lu & acquittement
  router.get("/unseen-summary", LeagueController.getUnseenSummary);
  router.patch("/history/:id/seen", LeagueController.markSummarySeen);

  app.use("/api/leagues", router);

  // 3. Route pour basculer le mode vacances / repos
  app.patch("/api/users/resting-mode", LeagueController.toggleRestingMode);
};
