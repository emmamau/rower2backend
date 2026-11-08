import { Request, Response, NextFunction } from "express";
import pairingService from "../services/pairing.service";

export interface AuthenticatedDeviceRequest extends Request {
  deviceToken?: string;
  deviceUser?: string;
  deviceId?: string;
}

/**
 * Middleware vérifiant que la requête de métriques provient d'une montre Garmin appairée et valide
 */
export const verifyDeviceToken = async (
  req: AuthenticatedDeviceRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Récupération du deviceToken depuis :
  // 1. Authorization: Bearer <deviceToken>
  // 2. Corps JSON (body.deviceToken)
  // 3. En-tête X-Device-Token
  const authHeader = req.headers.authorization;
  let token = authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!token && req.body?.deviceToken) {
    token = String(req.body.deviceToken).trim();
  }

  if (!token && req.headers["x-device-token"]) {
    token = String(req.headers["x-device-token"]).trim();
  }

  // Si aucun token fourni :
  if (!token) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Authentification requise : Jeton de montre (deviceToken) manquant. Veuillez appairer votre montre Garmin.",
    });
    return;
  }

  const check = await pairingService.validateDeviceToken(token);
  if (!check.valid || !check.pairing) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Jeton de montre invalide, expiré ou révoqué. Veuillez réappairer votre montre Garmin.",
    });
    return;
  }

  req.deviceToken = token;
  req.deviceUser = check.pairing.userId;
  req.deviceId = check.pairing.deviceId || undefined;

  // Si userId n'était pas précisé dans le body, on injecte celui validé par le token
  if (!req.body.userId) {
    req.body.userId = check.pairing.userId;
  }

  next();
};

export default verifyDeviceToken;
