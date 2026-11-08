import { Application, Router } from "express";
import RoomController from "../controllers/room.controller";

export default (app: Application): void => {
  const router = Router();

  // POST /api/rooms/join (Validation du code de salon avec quota, profil et attribution immédiate de ligne d'eau)
  router.post("/join", RoomController.joinRoom);

  app.use("/api/rooms", router);
  app.use("/api/v1/rooms", router);
};
