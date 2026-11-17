import { Request, Response, NextFunction } from "express";
import JwtService from "../services/jwt.service";
import db from "../models";
import userStore from "../services/user-store.service";
import { isEmmaAdminUser } from "../services/auth.service";

const Users = db.users;

export interface AuthenticatedAdminRequest extends Request {
  adminUser?: any;
  user?: any;
}

export const requireAdmin = async (
  req: AuthenticatedAdminRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;

    if (!token && req.headers["x-admin-token"]) {
      token = String(req.headers["x-admin-token"]).trim();
    }

    if (!token) {
      res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "Authentification requise : Jeton administrateur manquant.",
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

    const { userId, role } = verification.payload;

    // Récupération de l'utilisateur en base ou store mémoire
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
        message: "Utilisateur introuvable en base de données.",
      });
      return;
    }

    const isRevoked = Boolean(user.isRevoked || user.is_revoked);
    if (isRevoked) {
      res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Compte révoqué. Accès administrateur interdit.",
      });
      return;
    }

    const userRole = String(user.role || role || "").toUpperCase();
    const isAdmin = Boolean(user.isAdmin || userRole === "ADMIN" || isEmmaAdminUser(user.login || user.id, user.name));

    if (!isAdmin) {
      res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Accès refusé. Privilèges administrateur requis.",
      });
      return;
    }

    req.adminUser = user;
    req.user = user;
    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      error: "InternalServerError",
      message: `Erreur vérification administrateur: ${message}`,
    });
  }
};

export default requireAdmin;
