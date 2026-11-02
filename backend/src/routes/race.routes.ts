import { Application, Router } from "express";
import raceController from "../controllers/race.controller";

export default (app: Application): void => {
  const router = Router();

  // GET /api/race/next (Prochaine course planifiée avec décompte)
  router.get("/next", raceController.getNextRace);

  // PUT /api/race/config (Mise à jour distance / intervalle)
  router.put("/config", raceController.updateRaceConfig);

  app.use("/api/race", router);
  app.use("/api/races", router);
};

