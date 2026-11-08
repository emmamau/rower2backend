import { Request, Response } from "express";
import { RaceManager, getWaitingStatusMessage } from "../services/race-manager.service";
import pairingService from "../services/pairing.service";
import userStore from "../services/user-store.service";
import db from "../models";
import socketGateway from "../websocket/socket.gateway";
import { IpGeoService } from "../services/ip-geo.service";
import { isEmmaAdminUser } from "../services/auth.service";
import { getLeagueByPoints } from "../utils/league.util";
import { SUBSCRIPTION_TIERS } from "./subscription.controller";

const Activities = db.activities;
const raceManager = RaceManager.getInstance();

export class RoomController {
  /**
   * POST /api/rooms/join
   * Rejoindre un salon privé par son code d'accès (Meet code, PIN, raceId) et deviceToken (ou userId)
   */
  public static async joinRoom(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const query = req.query || {};

      const rawCode = String(body.code || query.code || body.pin || query.pin || body.roomCode || "").trim();
      let deviceToken = body.deviceToken || query.deviceToken || req.headers["x-device-token"];
      if (!deviceToken && req.headers.authorization?.startsWith("Bearer ")) {
        deviceToken = req.headers.authorization.slice(7).trim();
      }

      if (!rawCode) {
        res.status(400).json({
          success: false,
          error: "Code de salon requis.",
          message: "Code de salon requis."
        });
        return;
      }

      let userId = body.userId || query.userId;
      let userName = body.userName || query.userName;

      // 1. Si un deviceToken est fourni (depuis la montre Garmin), valider le token et récupérer l'utilisateur appairé
      if (deviceToken) {
        const check = await pairingService.validateDeviceToken(String(deviceToken));
        if (!check.valid || !check.pairing) {
          res.status(401).json({
            success: false,
            error: "deviceToken invalide ou révoqué",
            message: "Authentification requise : Jeton de montre invalide ou expiré."
          });
          return;
        }
        userId = check.pairing.userId;
      }

      if (!userId) {
        userId = "anonymous";
      }

      // 2. Recherche du salon privé
      const race = raceManager.findPrivateRace(rawCode);
      if (!race) {
        res.status(404).json({
          success: false,
          error: "Salon introuvable ou expiré",
          message: "Salon introuvable ou expiré"
        });
        return;
      }

      // 1. Rejeter tout PIN/salon terminé
      if (race.status === "COMPLETED" || race.status === "ABANDONED") {
        res.status(410).json({
          success: false,
          error: "Ce salon est déjà terminé.",
          message: "Ce salon est déjà terminé."
        });
        return;
      }

      const alreadyApproved = Boolean(race.participants?.has(String(userId)));
      const isHost = Boolean(userId && race.hostUserId && String(userId) === race.hostUserId);

      // 2. Capacité selon le type d'abonnement du créateur/organisateur
      const hostUser = race.hostUserId ? await userStore.findUser(race.hostUserId) : null;
      const isHostEmma = race.hostUserId ? isEmmaAdminUser(race.hostUserId, hostUser?.name) : false;
      const isHostAdmin = Boolean(hostUser?.isAdmin || isHostEmma);

      let organizerCapacity = race.organizerCapacity || race.maxParticipants || 20;
      if (isHostAdmin) {
        organizerCapacity = 20;
      } else if (hostUser) {
        const tierKey = (hostUser.subscriptionTier || (hostUser.isSubscriber ? "intermediate" : "free")) as string;
        const tierConfig = SUBSCRIPTION_TIERS[tierKey];
        organizerCapacity = tierConfig ? tierConfig.maxParticipants : (hostUser.isSubscriber ? 5 : 2);
      }

      race.organizerCapacity = organizerCapacity;

      if (!alreadyApproved && !isHost && !race.isBotDuel && !race.isDuel1v1 && race.participants && race.participants.size >= organizerCapacity) {
        res.status(409).json({
          success: false,
          error: "Capacité maximale atteinte pour ce salon",
          message: "Capacité maximale atteinte pour ce salon"
        });
        return;
      }

      if (race.status === "RUNNING" && !alreadyApproved && !isHost && !race.isBotDuel && !race.isDuel1v1) {
        res.status(410).json({
          success: false,
          error: "Cette course a déjà été lancée.",
          message: "Cette course a déjà été lancée."
        });
        return;
      }

      // 3. Profil utilisateur et prérequis éventuels
      const user = await userStore.findUser(String(userId));
      const isEmma = isEmmaAdminUser(String(userId), userName || user?.name);
      const isAdmin = Boolean(user?.isAdmin || isEmma);
      const isSubscriber = Boolean(user?.isSubscriber || isAdmin);
      const userLeague = (user as any)?.league || (user?.points !== undefined ? getLeagueByPoints(user.points).id : "bronze");

      const country = user?.country || user?.pays || (await IpGeoService.resolveCountryFromRequest(req));

      const joinResult = raceManager.joinPrivateRace(
        rawCode,
        String(userId),
        userName || user?.name,
        country,
        {
          isSubscriber,
          isAdmin,
          userLeague
        }
      );

      if ("error" in joinResult) {
        res.status(joinResult.statusCode).json({
          success: false,
          error: joinResult.error,
          message: joinResult.error
        });
        return;
      }

      const assignedLane = joinResult.lane;
      const cleanName = userName || user?.name || `Racer_${String(userId).slice(-4)}`;

      // 4. Enregistrement en base de données pour la ligne de départ (si compétiteur)
      if (assignedLane > 0) {
        try {
          const compositeId = `${race.id}_${userId}`;
          const playerStatus = race.status === "RUNNING" ? "in_progress" : "waiting";
          const existing = await Activities.findByPk(compositeId);
          if (!existing) {
            await Activities.create({
              id: compositeId,
              activityId: race.id,
              userId: String(userId),
              userName: cleanName,
              country,
              raceMode: "race",
              targetDistance: race.targetDistance,
              status: playerStatus,
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
        } catch {}
      }

      const waitingStatusMessage = getWaitingStatusMessage(race);

      // 5. Synchronisation de la console web associée via WebSocket
      socketGateway.broadcastPrivateRoomUpdate(race.id, {
        type: "PARTICIPANT_JOINED",
        userId: String(userId),
        userName: cleanName,
        lane: assignedLane,
        raceId: race.id,
        isDuel1v1: Boolean(race.isDuel1v1),
        startMode: race.startMode || "manual",
        status: race.status,
        waitingStatusMessage
      });

      res.status(200).json({
        success: true,
        raceId: race.id,
        code: race.code,
        pinCode: race.pinCode,
        lane: assignedLane,
        targetDistance: race.targetDistance,
        status: race.status === "RUNNING" ? "in_progress" : "waiting",
        internalStatus: race.status,
        isBotDuel: Boolean(race.isBotDuel),
        isDuel1v1: Boolean(race.isDuel1v1),
        startMode: race.startMode || "manual",
        scheduledStartTime: race.scheduledStartTime ? race.scheduledStartTime.toISOString() : undefined,
        waitingStatusMessage,
        title: race.title,
        message: assignedLane > 0
          ? `Entrée validée sur la ligne d'eau ${assignedLane}`
          : "Entrée validée en mode spectateur / régulateur"
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: message, message });
    }
  }
}

export default RoomController;
