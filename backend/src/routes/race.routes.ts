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

  // PUT /api/race/config (Mise à jour distance / intervalle)
  router.put("/config", raceController.updateRaceConfig);

  // POST /api/race/bots (Activer / désactiver des bots virtuels)
  router.post("/bots", raceController.toggleBots);

  app.use("/api/race", router);
  app.use("/api/races", router);
};
