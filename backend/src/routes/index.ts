import { Application } from "express";
import activityRoutes from "./activity.routes";
import raceRoutes from "./race.routes";
import userRoutes from "./user.routes";
import telemetryRoutes from "./telemetry.routes";
import subscriptionRoutes from "./subscription.routes";
import garminRoutes from "./garmin.routes";

export default (app: Application): void => {
  garminRoutes(app);
  telemetryRoutes(app);
  activityRoutes(app);
  raceRoutes(app);
  userRoutes(app);
  subscriptionRoutes(app);
};
