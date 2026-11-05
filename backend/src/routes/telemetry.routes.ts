import { Application, Router } from "express";
import TelemetryController from "../controllers/telemetry.controller";

export default (app: Application): void => {
  const router = Router();

  // POST /api/v1/telemetry (Stroke-by-stroke ingestion with compact sync response)
  router.post("/telemetry", TelemetryController.ingestTelemetry);

  // GET /api/v1/races/current (Status + PIN + countdown)
  router.get("/races/current", TelemetryController.getCurrentRace);

  // POST /api/v1/races/private (Meet-style private race generator)
  router.post("/races/private", TelemetryController.createPrivateRace);

  // GET /api/v1/races/private (List private salons for host or known codes)
  router.get("/races/private", TelemetryController.listPrivateRaces);

  // GET /api/v1/races/private/:identifier (Lookup private salon by Meet code, raceId, or 4-digit PIN)
  router.get("/races/private/:identifier", TelemetryController.getPrivateRace);

  // POST /api/v1/races/private/:identifier/join (Join private salon / register starting lane)
  router.post("/races/private/:identifier/join", TelemetryController.joinPrivateRace);

  // POST /api/v1/races/private/:identifier/start (Host starts countdown or resets private salon)
  router.post("/races/private/:identifier/start", TelemetryController.startPrivateRace);

  // POST /api/v1/races/private/:identifier/regenerate-pin (Rotate 4-digit Garmin PIN)
  router.post("/races/private/:identifier/regenerate-pin", TelemetryController.regeneratePrivatePin);

  // POST /api/v1/races/private/:identifier/regenerate-code (Rotate Meet code & share URL)
  router.post("/races/private/:identifier/regenerate-code", TelemetryController.regeneratePrivateCode);

  // DELETE /api/v1/races/private/:identifier (Close private salon & revoke codes)
  router.delete("/races/private/:identifier", TelemetryController.closePrivateRace);

  // GET /api/v1/races/pin/:pin (Watch PIN verification)
  router.get("/races/pin/:pin", TelemetryController.getRaceByPin);

  app.use("/api/v1", router);
};

