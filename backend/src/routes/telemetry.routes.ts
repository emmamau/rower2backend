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

  // GET /api/v1/races/pin/:pin (Watch PIN verification)
  router.get("/races/pin/:pin", TelemetryController.getRaceByPin);

  app.use("/api/v1", router);
};

