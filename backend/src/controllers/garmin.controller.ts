import { Request, Response } from "express";
import pairingService from "../services/pairing.service";
import { RaceManager, getWaitingStatusMessage } from "../services/race-manager.service";
import db from "../models";
import socketGateway from "../websocket/socket.gateway";

const Activities = db.activities;
const raceManager = RaceManager.getInstance();

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

  /**
   * POST /api/garmin/claim-ticket
   * Parcours 2 : Validation atomique du Ticket Invité à 5 caractères sur la montre Garmin
   * - Crée/active la session invité au nom de l'invité (ex: Alex)
   * - Appaire la montre et attribue son deviceToken persistant
   * - Place le joueur sur sa ligne d'eau réservée (état CONNECTED, ready=false)
   * - Notifie le front web par WebSocket pour positionner le kayak sur le plan d'eau sans manipulation
   * - Répond HTTP 200 : "Bienvenue [Nom] ! Ligne [X] attribuée"
   */
  public static async claimTicket(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const query = req.query || {};
      const rawPin = String(body.ticketPin || body.pin || body.code || query.ticketPin || query.pin || "").trim().toUpperCase();
      const deviceId = String(body.deviceId || query.deviceId || "GARMIN_GUEST").trim();

      if (!rawPin || rawPin.length < 4 || rawPin.length > 8) {
        res.status(400).json({
          success: false,
          message: "Code ticket à 5 caractères requis (ticketPin)."
        });
        return;
      }

      const ticket = raceManager.getGuestTicket(rawPin);
      let race = ticket ? raceManager.getRaceById(ticket.roomId) : raceManager.findPrivateRace(rawPin);

      if (!race) {
        res.status(404).json({
          success: false,
          error: "Ticket ou salon introuvable ou expiré.",
          message: "Ticket ou salon introuvable ou expiré."
        });
        return;
      }

      if (race.status === "COMPLETED" || race.status === "ABANDONED") {
        res.status(410).json({
          success: false,
          error: "Ce salon est déjà terminé.",
          message: "Ce salon est déjà terminé."
        });
        return;
      }

      const guestName = ticket?.guestName || String(body.guestName || body.userName || `Rameur_${rawPin.slice(0, 3)}`).trim();
      const userId = ticket?.userId || String(body.userId || `guest_${rawPin.toLowerCase()}`).trim();
      const socketId = ticket?.socketId;

      // 1. Appairer la montre et attribuer un deviceToken persistant
      const paired = await pairingService.pairGuestDirect(userId, deviceId, {
        guestName,
        userName: guestName,
        roomId: race.id,
        raceId: race.id,
        code: race.code,
        ticketPin: rawPin,
        lane: ticket?.lane || 1,
        socketId
      });

      // 2. Placer / confirmer le joueur sur sa ligne d'eau réservée en état CONNECTED (ready = false)
      const joinRes = raceManager.joinPrivateRace(race.id, userId, guestName, undefined, {
        isDeviceAuthenticated: true,
        viaPin: true,
        ready: false,
        socketId,
        deviceToken: paired.deviceToken,
        bypassApproval: true
      });

      if ("error" in joinRes) {
        res.status(joinRes.statusCode).json({
          success: false,
          error: joinRes.error,
          message: joinRes.error
        });
        return;
      }

      const assignedLane = ticket?.lane || joinRes.lane || 1;
      if (race.participants && race.participants.has(userId)) {
        const p = race.participants.get(userId)!;
        p.lane = assignedLane;
        p.ready = false;
        p.connectionState = "CONNECTED";
        p.deviceToken = paired.deviceToken;
        if (socketId) p.socketId = socketId;
        race.participants.set(userId, p);
      }

      if (ticket) {
        ticket.claimedAt = new Date();
        ticket.deviceId = deviceId;
        ticket.deviceToken = paired.deviceToken;
      }

      // 3. Créer l'entrée sur la ligne de départ en base de données
      try {
        const compositeId = `${race.id}_${userId}`;
        const existing = await Activities.findByPk(compositeId);
        if (!existing) {
          await Activities.create({
            id: compositeId,
            activityId: race.id,
            userId,
            userName: guestName,
            raceMode: "race",
            targetDistance: race.targetDistance,
            status: "waiting",
            initialDistance: 0,
            currentDistance: 0,
            netDistance: 0,
            progressPercent: 0,
            lastStrokeRate: 0,
            lastStrokeCount: 0,
            lastPower: 0,
            lastPace: 0,
            lastHeartRate: 0,
            lastResistance: 1,
            avgPower: 0,
            avgPace: 0,
            avgStrokeRate: 0,
            totalStrokes: 0,
            totalEnergy: 0,
            elapsedTime: 0,
            avgSpeedKmh: 0
          });
        }
        const rows = await Activities.findAll({ where: { activityId: race.id } });
        if (rows.length > 0) {
          const sorted = RaceManager.sortRanking(rows as any);
          socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(sorted, race));
        }
      } catch {}

      const waitingStatusMessage = `Ligne ${assignedLane} attribuée - Donnez un coup de rame pour réveiller le rameur`;
      const welcomeMessage = `Bienvenue ${guestName} ! Ligne ${assignedLane} attribuée`;

      // 4. Notifier le front web par WebSocket pour positionner le kayak sur le plan d'eau sans manipulation
      socketGateway.broadcastPrivateRoomUpdate(race.id, {
        type: "PARTICIPANT_JOINED",
        ticketClaimed: true,
        ticketPin: rawPin,
        socketId,
        userId,
        userName: guestName,
        guestName,
        deviceToken: paired.deviceToken,
        deviceId,
        lane: assignedLane,
        botLane: race.isBotDuel ? 2 : undefined,
        raceId: race.id,
        code: race.code,
        ready: false,
        connectionState: "CONNECTED",
        isBotDuel: Boolean(race.isBotDuel),
        isDuel1v1: Boolean(race.isDuel1v1),
        startMode: race.startMode || "manual",
        status: race.status,
        waitingStatusMessage
      });

      res.status(200).json({
        success: true,
        deviceToken: paired.deviceToken,
        userId,
        userName: guestName,
        guestName,
        lane: assignedLane,
        botLane: race.isBotDuel ? 2 : undefined,
        id: race.id,
        raceId: race.id,
        code: race.code,
        pinCode: race.pinCode,
        ticketPin: rawPin,
        targetDistance: race.targetDistance,
        status: "waiting",
        internalStatus: race.status,
        connectionState: "CONNECTED",
        ready: false,
        isBotDuel: Boolean(race.isBotDuel),
        isDuel1v1: Boolean(race.isDuel1v1),
        hasBots: Boolean(race.hasBots || race.isBotDuel),
        waitingStatusMessage,
        message: welcomeMessage
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: message, message });
    }
  }
}

export default GarminController;
