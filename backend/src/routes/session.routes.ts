import { Application, Router } from "express";
import SessionController from "../controllers/session.controller";

export default (app: Application): void => {
  const router = Router();

  // POST /api/session/code (Génération du Code Unique Universel à 5 caractères)
  router.post("/code", SessionController.generateCode);

  // POST /api/session/claim (Résolution atomique par la montre Garmin)
  router.post("/claim", SessionController.claimCode);

  app.use("/api/session", router);
};
