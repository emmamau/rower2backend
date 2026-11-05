import { Application } from "express";
import activityRoutes from "./activity.routes";
import raceRoutes from "./race.routes";
import userRoutes from "./user.routes";
import telemetryRoutes from "./telemetry.routes";

export default (app: Application): void => {
  telemetryRoutes(app);
  activityRoutes(app);
  raceRoutes(app);
  userRoutes(app);
};
