import { Application, Router } from "express";
import raceController from "../controllers/race.controller";

export default (app: Application): void => {
  const router = Router();

  // GET /api/race/next (Prochaine course planifiée avec décompte)
  router.get("/next", raceController.getNextRace);

  // POST /api/race/join (Rejoindre la prochaine course et lancer l'attente)
  router.post("/join", raceController.joinRace);

  // GET /api/race/history (Historique des résultats des précédentes courses)
  router.get("/history", raceController.getRaceHistory);

  // GET /api/races/:id/leaderboard & /api/race/:id/leaderboard (Classement complet d'une régate passée)
  router.get("/:id/leaderboard", raceController.getRaceLeaderboard);

  // PUT /api/race/config (Mise à jour distance / intervalle)
  router.put("/config", raceController.updateRaceConfig);

  // Configuration admin de la course publique (distance, max participants, bots, durée)
  router.get("/admin/config", raceController.getPublicRaceAdminConfig);
  router.put("/admin/config", raceController.updatePublicRaceAdminConfig);

  // POST /api/race/bots (Activer / désactiver des bots virtuels)
  router.post("/bots", raceController.toggleBots);

  // POST /api/race/stop (Arrêt de la course par l'organisateur ou l'administrateur avec classement immédiat)
  router.post("/stop", raceController.stopRace);

  app.use("/api/race", router);
  app.use("/api/races", router);
};
