import { Application, Router } from "express";
import DuelController from "../controllers/duel.controller";

export default (app: Application): void => {
  const router = Router();

  router.get("/preferences/:userId", DuelController.getPreferences);
  router.put("/preferences", DuelController.updatePreferences);
  router.get("/available-players", DuelController.findAvailablePlayers);
  router.post("/challenge", DuelController.createChallenge);
  router.get("/my-challenges", DuelController.getMyChallenges);
  router.get("/leaderboard", DuelController.getDuelLeaderboard);
  router.get("/invite-info", DuelController.getInviteInfo);
  router.get("/:id", DuelController.getChallenge);
  router.post("/:id/resend-invite", DuelController.resendInvite);
  router.post("/:id/respond", DuelController.respondToChallenge);
  router.post("/:id/cancel", DuelController.cancelChallenge);
  router.post("/:id/resolve", DuelController.resolveChallenge);
  router.delete("/:id", DuelController.deleteChallenge);
  router.post("/:id/delete", DuelController.deleteChallenge);

  app.use("/api/duels", router);
  app.use("/api/v1/duels", router);
};
