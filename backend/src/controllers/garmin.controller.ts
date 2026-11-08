import { Request, Response } from "express";
import pairingService from "../services/pairing.service";

export class GarminController {
  /**
   * POST /api/garmin/pairing-code
   * Génère un code d'appairage à 6 caractères pour l'utilisateur connecté ou une session invité
   */
  public static async generatePairingCode(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const query = req.query || {};

      // Récupération de l'identité : compte connecté, session invité, ou en-tête
      const userId =
        body.userId ||
        query.userId ||
        body.guestSessionId ||
        query.guestSessionId ||
        (req as any).user?.id ||
        (req as any).user?.login;

      if (!userId) {
        res.status(400).json({
          success: false,
          message: "Identifiant utilisateur ou session invité requis pour générer le code d'appairage.",
        });
        return;
      }

      const result = await pairingService.createPairingCode(String(userId));
      res.status(200).json({
        success: true,
        pairingCode: result.pairingCode,
        expiresAt: result.expiresAt,
        expiresInSeconds: result.expiresInSeconds,
        userId: result.userId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }

  /**
   * POST /api/garmin/pair
   * La montre Garmin envoie le code à 6 caractères et son identifiant matériel
   */
  public static async pairWatch(req: Request, res: Response): Promise<void> {
    try {
      const { pairingCode, deviceId } = req.body || {};

      if (!pairingCode || !deviceId) {
        res.status(400).json({
          success: false,
          message: "Champs 'pairingCode' (6 caractères) et 'deviceId' obligatoires.",
        });
        return;
      }

      const result = await pairingService.pairDevice(String(pairingCode), String(deviceId));

      if (!result.success) {
        res.status(400).json(result);
        return;
      }

      res.status(200).json({
        success: true,
        deviceToken: result.deviceToken,
        userId: result.userId,
        deviceId: result.deviceId,
        message: "Montre associée avec succès !",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }

  /**
   * GET /api/garmin/pairing-status
   * Vérifie si le code a été validé ou si l'utilisateur est appairé
   */
  public static async getPairingStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req.query.userId || req.query.guestSessionId) as string | undefined;
      const pairingCode = req.query.pairingCode as string | undefined;
      const deviceToken = (req.query.deviceToken || req.headers.authorization?.replace(/^Bearer\s+/i, "")) as string | undefined;

      const result = await pairingService.getPairingStatus({
        userId,
        pairingCode,
        deviceToken,
      });

      res.status(200).json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }

  /**
   * POST /api/garmin/reset ou DELETE /api/garmin/pairing
   * Révoque l'appairage depuis la montre ou le web
   */
  public static async resetPairing(req: Request, res: Response): Promise<void> {
    try {
      const tokenFromHeader = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      const deviceToken = req.body?.deviceToken || (req.query?.deviceToken as string) || tokenFromHeader;
      const userId = req.body?.userId || (req.query?.userId as string);

      if (!deviceToken && !userId) {
        res.status(400).json({
          success: false,
          message: "Jeton de montre (deviceToken) ou identifiant utilisateur requis pour réinitialiser.",
        });
        return;
      }

      const result = await pairingService.revokePairing({ deviceToken, userId });
      res.status(200).json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }

  /**
   * GET /api/garmin/status
   * Statut du token montre
   */
  public static async getDeviceStatus(req: Request, res: Response): Promise<void> {
    try {
      const token =
        (req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
          req.headers["x-device-token"] ||
          req.query.deviceToken) as string;

      if (!token) {
        res.status(401).json({ success: false, message: "Jeton de montre manquant." });
        return;
      }

      const check = await pairingService.validateDeviceToken(token);
      if (!check.valid || !check.pairing) {
        res.status(401).json({ success: false, message: "Jeton de montre invalide ou révoqué." });
        return;
      }

      res.status(200).json({
        success: true,
        userId: check.pairing.userId,
        deviceId: check.pairing.deviceId,
        pairedAt: check.pairing.pairedAt,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }
}

export default GarminController;
