import { Application, Router } from "express";
import RoomController from "../controllers/room.controller";
import TelemetryController from "../controllers/telemetry.controller";

export default (app: Application): void => {
  const router = Router();

  // POST /api/rooms (Create private salon alias)
  router.post("/", TelemetryController.createPrivateRace);

  // POST /api/rooms/join (Validation du code de salon avec quota, profil et attribution immédiate de ligne d'eau)
  router.post("/join", RoomController.joinRoom);

  // POST /api/rooms/:roomId/guest-ticket (Parcours 2 : Génération du code d'embarquement invité à 5 caractères)
  router.post("/:roomId/guest-ticket", RoomController.createGuestTicket);

  // POST /api/rooms/:roomId/status (Machine à États BLE : Notification READY du rameur)
  router.post("/:roomId/status", RoomController.updateParticipantStatus);

  // POST /api/rooms/:identifier/start (Host starts countdown or resets private salon)
  router.post("/:identifier/start", TelemetryController.startPrivateRace);

  app.use("/api/rooms", router);
  app.use("/api/v1/rooms", router);
};
