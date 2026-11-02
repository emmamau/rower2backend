import { Application, Router, Request, Response } from "express";
import userController from "../controllers/user.controller";

export default (app: Application): void => {
  const router = Router();

  router.get("/profile/:userId", userController.getUserProfile);
  router.put("/profile/:userId", userController.updateUserProfile);

  // Alias /api/user/me
  router.get("/me", (req: Request, res: Response) => {
    (req.params as any).userId = (req.query.userId as string) || "anonymous";
    userController.getUserProfile(req, res);
  });

  router.put("/me", (req: Request, res: Response) => {
    (req.params as any).userId = (req.body.userId as string) || (req.query.userId as string) || "anonymous";
    userController.updateUserProfile(req, res);
  });

  app.use("/api/user", router);
  app.use("/api/users", router);
};
