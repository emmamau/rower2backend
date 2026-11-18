import { Request, Response, NextFunction } from "express";
import JwtService from "../services/jwt.service";
import db from "../models";
import userStore from "../services/user-store.service";

const Users = db.users;

export interface AuthenticatedUserRequest extends Request {
  user?: any;
}

/**
 * Middleware d'authentification pour les routes utilisateur sensibles.
 * Valide le Bearer token JWT via JwtService.verify(token) et injecte l'utilisateur dans req.user.
 * IMPORTANT : Les montres Garmin Connect IQ n'utilisent JAMAIS ce middleware, elles s'authentifient via verifyDeviceToken.
 */
export const requireAuth = async (
  req: AuthenticatedUserRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;

    if (!token && req.headers["x-access-token"]) {
      token = String(req.headers["x-access-token"]).trim();
    }

    if (!token) {
      res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "Authentification requise : Jeton de connexion manquant.",
      });
      return;
    }

    const verification = JwtService.verify(token);
    if (!verification.valid || !verification.payload) {
      res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: `Jeton invalide ou expiré : ${verification.error || "Jeton corrompu"}.`,
      });
      return;
    }

    const { userId } = verification.payload;

    let user: any = null;
    try {
      user = await Users.findByPk(userId);
    } catch {}

    if (!user) {
      user = await userStore.findUser(userId);
    }

    if (!user) {
      res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "Utilisateur introuvable.",
      });
      return;
    }

    const isRevoked = Boolean(user.isRevoked || user.is_revoked);
    if (isRevoked) {
      res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Compte révoqué. Accès refusé.",
      });
      return;
    }

    req.user = user;
    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      error: "InternalServerError",
      message: `Erreur vérification authentification : ${message}`,
    });
  }
};

export default requireAuth;
