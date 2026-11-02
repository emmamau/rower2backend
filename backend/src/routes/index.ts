import { Application } from "express";
import activityRoutes from "./activity.routes";
import raceRoutes from "./race.routes";
import userRoutes from "./user.routes";

export default (app: Application): void => {
  activityRoutes(app);
  raceRoutes(app);
  userRoutes(app);
};

