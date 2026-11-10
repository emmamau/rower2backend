import { Application, Router } from "express";
import GarminController from "../controllers/garmin.controller";
import TelemetryController from "../controllers/telemetry.controller";
import { verifyDeviceToken } from "../middleware/device-auth.middleware";

export default (app: Application): void => {
  const router = Router();

  // 1. Protocole d'appairage Garmin <-> Web
  // POST /api/garmin/pairing-code (Génération code 6 caractères)
  router.post("/pairing-code", GarminController.generatePairingCode);

  // POST /api/garmin/pair (Validation du code saisi sur la montre et remise du deviceToken)
  router.post("/pair", GarminController.pairWatch);

  // GET /api/garmin/pairing-status (Détection de la validation par le web)
  router.get("/pairing-status", GarminController.getPairingStatus);

  // POST /api/garmin/reset ou DELETE /api/garmin/pairing (Révocation de la montre)
  router.post("/reset", GarminController.resetPairing);
  router.delete("/pairing", GarminController.resetPairing);

  // GET /api/garmin/status (Vérification validité token)
  router.get("/status", GarminController.getDeviceStatus);

  // POST /api/garmin/claim-ticket (Parcours 2 : Validation atomique du Ticket Invité 5 caractères)
  router.post("/claim-ticket", GarminController.claimTicket);

  // 2. Envoi des données d'activité avec middleware /boost sécurisé par deviceToken
  router.post("/boost", verifyDeviceToken, TelemetryController.ingestTelemetry);

  app.use("/api/garmin", router);

  // Routes globales /boost de premier niveau conformes à la spécification
  app.post("/boost", verifyDeviceToken, TelemetryController.ingestTelemetry);
  app.post("/api/boost", verifyDeviceToken, TelemetryController.ingestTelemetry);
  app.post("/api/v1/boost", verifyDeviceToken, TelemetryController.ingestTelemetry);
};
