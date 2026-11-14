import { Request, Response } from "express";
import sessionService from "../services/session.service";

export class SessionController {
  /**
   * POST /api/session/code
   * Génère un Code Unique Universel à 5 caractères alphanumériques (valide 10 min)
   */
  public static async generateCode(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const query = req.query || {};

      const type = (body.type || query.type || "guest_cockpit") as "account_link" | "room_join" | "guest_cockpit";
      const roomId = body.roomId || query.roomId || null;
      const playerName = body.playerName || query.playerName || body.userName || null;
      const socketId = body.socketId || query.socketId || null;
      const assignedLane = body.assignedLane ? Number(body.assignedLane) : undefined;

      // Détection du compte utilisateur si authentifié
      const userId =
        body.userId ||
        query.userId ||
        (req as any).user?.id ||
        (req as any).user?.login ||
        null;

      const context = sessionService.createSessionCode({
        type: userId ? "account_link" : type,
        userId,
        roomId,
        playerName,
        socketId,
        assignedLane,
      });

      res.status(200).json({
        success: true,
        code: context.code,
        type: context.type,
        userId: context.userId,
        roomId: context.roomId,
        playerName: context.playerName,
        assignedLane: context.assignedLane,
        guestPairingToken: context.guestPairingToken,
        expiresAt: context.expiresAt,
        expiresInSeconds: Math.round((context.expiresAt.getTime() - Date.now()) / 1000),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: message, message });
    }
  }

  /**
   * POST /api/session/claim
   * Résolution atomique appelée par la montre Garmin avec { code: "K8F2M", deviceId: "..." }
   */
  public static async claimCode(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const query = req.query || {};

      const code = String(body.code || query.code || body.pairingCode || body.ticketPin || "").trim().toUpperCase();
      const deviceId = String(body.deviceId || query.deviceId || "GARMIN_DEVICE").trim();

      if (!code) {
        res.status(400).json({
          success: false,
          error: "Code universel à 5 caractères requis.",
          message: "Code universel à 5 caractères requis.",
        });
        return;
      }

      const result = await sessionService.claimSessionCode(code, deviceId);

      res.status(200).json({
        success: true,
        deviceToken: result.deviceToken,
        mode: result.mode,
        playerName: result.playerName,
        lane: result.lane,
        userId: result.userId,
        roomId: result.roomId,
        guestPairingToken: result.guestPairingToken,
        message: result.message,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({
        success: false,
        error: message,
        message,
      });
    }
  }
}

export default SessionController;
