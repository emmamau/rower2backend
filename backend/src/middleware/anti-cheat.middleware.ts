import { Request, Response, NextFunction } from "express";
import antiCheatService from "../services/anti-cheat.service";

/**
 * Middleware vérifiant l'authenticité matérielle des requêtes de montres Garmin
 * ou l'autorisation de test de charge via x-load-test-key
 */
export const verifyAntiCheat = (req: Request, res: Response, next: NextFunction): void => {
  const result = antiCheatService.verifyRequest(req);

  if (result.allowed) {
    (req as any).antiCheatMode = result.mode;
    next();
    return;
  }

  res.status(403).json({
    success: false,
    error: "AntiCheatEnforced",
    message: result.reason,
    antiCheatActive: true,
    loadTestModeOpen: antiCheatService.isLoadTestOpen(),
    hint: "Pour les tests de charge, activez le Mode Tests de Charge dans le Dashboard Admin et transmettez l'en-tête 'x-load-test-key'."
  });
};

export default verifyAntiCheat;
