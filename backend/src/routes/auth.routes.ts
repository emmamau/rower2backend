import { Application, Router } from "express";
import userController from "../controllers/user.controller";

export default (app: Application): void => {
  const router = Router();

  router.post("/login", userController.loginUser);
  router.get("/me", userController.getMe);

  app.use("/api/auth", router);
};
