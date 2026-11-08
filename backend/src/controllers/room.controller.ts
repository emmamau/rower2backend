import { Request, Response } from "express";
import { RaceManager } from "../services/race-manager.service";
import pairingService from "../services/pairing.service";
import userStore from "../services/user-store.service";
import db from "../models";
import socketGateway from "../websocket/socket.gateway";
import { IpGeoService } from "../services/ip-geo.service";
import { isEmmaAdminUser } from "../services/auth.service";
import { getLeagueByPoints } from "../utils/league.util";

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

      // 5. Synchronisation de la console web associée via WebSocket
      socketGateway.broadcastPrivateRoomUpdate(race.id, {
        type: "PARTICIPANT_JOINED",
        userId: String(userId),
        userName: cleanName,
        lane: assignedLane,
        raceId: race.id
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
