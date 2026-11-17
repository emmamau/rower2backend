import { Application } from "express";
import activityRoutes from "./activity.routes";
import raceRoutes from "./race.routes";
import userRoutes from "./user.routes";
import telemetryRoutes from "./telemetry.routes";
import subscriptionRoutes from "./subscription.routes";
import garminRoutes from "./garmin.routes";
import roomRoutes from "./room.routes";
import sessionRoutes from "./session.routes";
import leagueRoutes from "./league.routes";
import authRoutes from "./auth.routes";
import adminRoutes from "./admin.routes";

export default (app: Application): void => {
  authRoutes(app);
  adminRoutes(app);
  sessionRoutes(app);
  garminRoutes(app);
  telemetryRoutes(app);
  roomRoutes(app);
  activityRoutes(app);
  raceRoutes(app);
  userRoutes(app);
  subscriptionRoutes(app);
  leagueRoutes(app);
};
