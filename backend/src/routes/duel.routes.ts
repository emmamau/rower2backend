import { Application, Router } from "express";
import DuelController from "../controllers/duel.controller";

export default (app: Application): void => {
  const router = Router();

  router.get("/preferences/:userId", DuelController.getPreferences);
  router.put("/preferences", DuelController.updatePreferences);
  router.get("/available-players", DuelController.findAvailablePlayers);
  router.post("/challenge", DuelController.createChallenge);
  router.get("/my-challenges", DuelController.getMyChallenges);
  router.post("/:id/respond", DuelController.respondToChallenge);
  router.post("/:id/cancel", DuelController.cancelChallenge);
  router.post("/:id/resolve", DuelController.resolveChallenge);
  router.get("/leaderboard", DuelController.getDuelLeaderboard);

  app.use("/api/duels", router);
  app.use("/api/v1/duels", router);
};
