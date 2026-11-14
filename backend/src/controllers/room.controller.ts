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
      const bodyUserId = userId ? String(userId).trim() : "";
      let userName = body.userName || query.userName;
      let isDeviceAuthenticated = false;

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
        isDeviceAuthenticated = true;
        userId = check.pairing.userId;
      }

      if (!userId) {
        userId = "anonymous";
      }

      const viaPin = Boolean(
        body.pin ||
        query.pin ||
        /^[a-zA-Z0-9]{4,8}$/.test(rawCode)
      );

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

      const alreadyApproved = Boolean(
        race.participants?.has(String(userId)) ||
        (bodyUserId && race.participants?.has(bodyUserId))
      );

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

      // 3. Profil utilisateur et prérequis éventuels
      const user = (await userStore.findUser(String(userId))) || (bodyUserId ? await userStore.findUser(bodyUserId) : null);
      const sameAccountAsHost = Boolean(
        user &&
        hostUser &&
        (user.id === hostUser.id || (user.login && hostUser.login && user.login.toLowerCase() === hostUser.login.toLowerCase()))
      );
      const isHost = Boolean(
        sameAccountAsHost ||
        (userId && race.hostUserId && String(userId).toLowerCase() === race.hostUserId.toLowerCase()) ||
        (userId && race.originalHostUserId && String(userId).toLowerCase() === race.originalHostUserId.toLowerCase()) ||
        (bodyUserId && race.hostUserId && bodyUserId.toLowerCase() === race.hostUserId.toLowerCase()) ||
        (bodyUserId && race.originalHostUserId && bodyUserId.toLowerCase() === race.originalHostUserId.toLowerCase()) ||
        (userName && race.hostUserName && String(userName).trim().toLowerCase() === race.hostUserName.toLowerCase())
      );

      if (!alreadyApproved && !isHost && !race.isSolo && !race.isBotDuel && !race.isDuel1v1 && race.participants && race.participants.size >= organizerCapacity) {
        res.status(409).json({
          success: false,
          error: "Capacité maximale atteinte pour ce salon",
          message: "Capacité maximale atteinte pour ce salon"
        });
        return;
      }

      if (race.status === "RUNNING" && !alreadyApproved && !isHost && !race.isSolo && !race.isBotDuel && !race.isDuel1v1) {
        res.status(410).json({
          success: false,
          error: "Cette course a déjà été lancée.",
          message: "Cette course a déjà été lancée."
        });
        return;
      }

      const isEmma = isEmmaAdminUser(String(userId), userName || user?.name);
      const isAdmin = Boolean(user?.isAdmin || isEmma);
      const isSubscriber = Boolean(user?.isSubscriber || isAdmin);
      const userLeague = (user as any)?.league || (user?.points !== undefined ? getLeagueByPoints(user.points).id : "bronze");

      const country = user?.country || user?.pays || (await IpGeoService.resolveCountryFromRequest(req));

      const explicitReady = body.ready !== undefined ? Boolean(body.ready) : undefined;
      const joinResult = raceManager.joinPrivateRace(
        rawCode,
        String(userId),
        userName || user?.name,
        country,
        {
          isSubscriber,
          isAdmin,
          userLeague,
          isDeviceAuthenticated,
          viaPin,
          sameAccountAsHost,
          fallbackUserId: bodyUserId || undefined,
          ready: explicitReady,
          socketId: body.socketId ? String(body.socketId) : undefined,
          deviceToken: deviceToken ? String(deviceToken) : undefined
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
          if (race.isBotDuel && race.originalHostUserId && race.originalHostUserId !== String(userId)) {
            await Activities.destroy({
              where: { id: `${race.id}_${race.originalHostUserId}` }
            });
          }
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
          const rows = await Activities.findAll({ where: { activityId: race.id } });
          if (rows.length > 0) {
            const sorted = RaceManager.sortRanking(rows as any);
            socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(sorted, race));
          }
        } catch {}
      }

      const waitingStatusMessage = getWaitingStatusMessage(race);
      const timing = raceManager.getRaceTiming(race, new Date());
      const waitingForHost = race.status === "LOBBY" && !race.autoStart;
      const secondsRemaining = (!waitingForHost && (race.status === "LOBBY" || race.status === "COUNTDOWN"))
        ? timing.secondsUntilStart
        : 0;
      const totalParticipants = (race.participants ? race.participants.size : 1) + (race.botCount || (race.isBotDuel ? 1 : 0));

      // 5. Synchronisation de la console web associée via WebSocket
      socketGateway.broadcastPrivateRoomUpdate(race.id, {
        type: "PARTICIPANT_JOINED",
        userId: String(userId),
        hostUserId: race.originalHostUserId || race.hostUserId,
        userName: cleanName,
        lane: assignedLane,
        botLane: race.isBotDuel ? 2 : undefined,
        raceId: race.id,
        ready: joinResult.ready !== false,
        connectionState: joinResult.connectionState || (joinResult.ready === false ? "CONNECTED" : "READY"),
        isBotDuel: Boolean(race.isBotDuel),
        isDuel1v1: Boolean(race.isDuel1v1),
        isSolo: Boolean(race.isSolo),
        gameMode: race.gameMode || (race.isSolo ? "solo" : race.isBotDuel ? "bot_duel" : race.isDuel1v1 ? "duel_1v1" : "multi"),
        startMode: race.startMode || "manual",
        status: race.status,
        secondsRemaining,
        countdownSeconds: secondsRemaining,
        lobbyEndsAt: race.lobbyEndsAt ? race.lobbyEndsAt.toISOString() : undefined,
        waitingStatusMessage
      });

      res.status(200).json({
        success: true,
        id: race.id,
        raceId: race.id,
        code: race.code,
        pinCode: race.pinCode,
        lane: assignedLane,
        botLane: race.isBotDuel ? 2 : undefined,
        targetDistance: race.targetDistance,
        status: race.status === "RUNNING" ? "in_progress" : "waiting",
        internalStatus: race.status,
        ready: joinResult.ready !== false,
        connectionState: joinResult.connectionState || (joinResult.ready === false ? "CONNECTED" : "READY"),
        isBotDuel: Boolean(race.isBotDuel),
        isDuel1v1: Boolean(race.isDuel1v1),
        isSolo: Boolean(race.isSolo),
        gameMode: race.gameMode || (race.isSolo ? "solo" : race.isBotDuel ? "bot_duel" : race.isDuel1v1 ? "duel_1v1" : "multi"),
        hasBots: Boolean(race.hasBots || race.isBotDuel),
        totalParticipants,
        secondsRemaining,
        countdownSeconds: secondsRemaining,
        lobbyEndsAt: race.lobbyEndsAt ? race.lobbyEndsAt.toISOString() : undefined,
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

  /**
   * POST /api/rooms/:roomId/guest-ticket
   * Parcours 2 : Génère un code d'embarquement invité à 5 caractères (valide 10 min)
   * Réserve immédiatement une ligne d'eau libre dans le salon privé
   */
  public static async createGuestTicket(req: Request, res: Response): Promise<void> {
    try {
      const roomId = String(req.params.roomId || req.body?.roomId || "").trim();
      const { guestName, socketId, userId } = req.body || {};

      if (!roomId) {
        res.status(400).json({
          success: false,
          error: "Identifiant de salon requis (roomId).",
          message: "Identifiant de salon requis (roomId)."
        });
        return;
      }

      const country = await IpGeoService.resolveCountryFromRequest(req);
      const outcome = raceManager.createGuestTicket(
        roomId,
        guestName ? String(guestName) : undefined,
        socketId ? String(socketId) : undefined,
        userId ? String(userId) : undefined,
        country
      );

      if ("error" in outcome) {
        res.status(outcome.statusCode).json({
          success: false,
          error: outcome.error,
          message: outcome.error
        });
        return;
      }

      const { ticket, race } = outcome;

      // Créer l'entrée en attente en base de données pour réserver la ligne d'eau
      try {
        const compositeId = `${race.id}_${ticket.userId}`;
        const existing = await Activities.findByPk(compositeId);
        if (!existing) {
          await Activities.create({
            id: compositeId,
            activityId: race.id,
            userId: ticket.userId,
            userName: ticket.guestName,
            country,
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
      } catch {}

      res.status(200).json({
        success: true,
        ticketPin: ticket.ticketPin,
        code: ticket.ticketPin,
        pinCode: ticket.ticketPin,
        roomId: race.id,
        raceId: race.id,
        roomCode: race.code,
        guestName: ticket.guestName,
        userId: ticket.userId,
        socketId: ticket.socketId,
        lane: ticket.lane,
        expiresAt: ticket.expiresAt.toISOString(),
        expiresInSeconds: 600,
        message: `Ticket d'embarquement ${ticket.ticketPin} généré (Ligne ${ticket.lane} réservée).`
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: message, message });
    }
  }

  /**
   * POST /api/rooms/:roomId/status
   * Machine à États BLE : Notification par la montre Garmin que le rameur FTMS/SmartRow est réveillé (ready: true)
   */
  public static async updateParticipantStatus(req: Request, res: Response): Promise<void> {
    try {
      const roomId = String(req.params.roomId || req.body?.roomId || req.body?.raceId || "").trim();
      const body = req.body || {};
      const ready = body.ready !== undefined ? Boolean(body.ready) : true;

      if (!roomId) {
        res.status(400).json({
          success: false,
          error: "Identifiant de salon requis (roomId).",
          message: "Identifiant de salon requis (roomId)."
        });
        return;
      }

      let deviceToken = body.deviceToken || req.headers["x-device-token"];
      if (!deviceToken && req.headers.authorization?.startsWith("Bearer ")) {
        deviceToken = req.headers.authorization.slice(7).trim();
      }

      let resolvedUserId = body.userId ? String(body.userId).trim() : undefined;
      if (deviceToken) {
        const check = await pairingService.validateDeviceToken(String(deviceToken));
        if (check.valid && check.pairing) {
          resolvedUserId = check.pairing.userId;
        } else {
          // If not in pairing DB, search participants in the room with matching deviceToken
          const raceObj = raceManager.getRaceById(roomId);
          if (raceObj?.participants) {
            for (const p of raceObj.participants.values()) {
              if (p.deviceToken === deviceToken) {
                resolvedUserId = p.userId;
                break;
              }
            }
          }
        }
      }

      const outcome = raceManager.setParticipantReadyStatus(
        roomId,
        resolvedUserId || (deviceToken ? String(deviceToken) : undefined),
        ready
      );

      if ("error" in outcome) {
        res.status(outcome.statusCode).json({
          success: false,
          error: outcome.error,
          message: outcome.error
        });
        return;
      }

      const { race, participant, countdownTriggered, allReady, waitingStatusMessage } = outcome;

      // Mettre à jour et diffuser le leaderboard live avec l'état READY
      try {
        const rows = await Activities.findAll({ where: { activityId: race.id } });
        if (rows.length > 0) {
          const sorted = RaceManager.sortRanking(rows as any);
          socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(sorted, race));
        }
      } catch {}

      const timing = raceManager.getRaceTiming(race, new Date());
      const waitingForHost = race.status === "LOBBY" && !race.autoStart;
      const secondsRemaining = (!waitingForHost && (race.status === "LOBBY" || race.status === "COUNTDOWN"))
        ? timing.secondsUntilStart
        : 0;

      res.status(200).json({
        success: true,
        raceId: race.id,
        userId: participant?.userId || resolvedUserId,
        lane: participant?.lane || 1,
        ready: Boolean(ready),
        connectionState: ready ? "READY" : "CONNECTED",
        allReady,
        allHumansReady: allReady,
        countdownTriggered,
        status: race.status === "RUNNING" ? "in_progress" : "waiting",
        internalStatus: race.status,
        secondsRemaining,
        countdownSeconds: secondsRemaining,
        lobbyEndsAt: race.lobbyEndsAt ? race.lobbyEndsAt.toISOString() : undefined,
        waitingStatusMessage: ready
          ? (race.status === "COUNTDOWN" ? waitingStatusMessage : "Rameur prêt - En attente du départ")
          : waitingStatusMessage,
        message: ready ? "Rameur prêt - En attente du départ" : waitingStatusMessage
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: message, message });
    }
  }
  /**
   * POST /api/rooms/leave
   * Quitter un salon privé et libérer la place/ligne
   */
  public static async leaveRoom(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const query = req.query || {};

      const code = String(body.code || query.code || body.pin || query.pin || body.roomId || query.roomId || body.roomCode || "").trim();
      let deviceToken = body.deviceToken || query.deviceToken || req.headers["x-device-token"];
      if (!deviceToken && req.headers.authorization?.startsWith("Bearer ")) {
        deviceToken = req.headers.authorization.slice(7).trim();
      }

      let userId = body.userId || query.userId;

      if (!userId && deviceToken) {
        const check = await pairingService.validateDeviceToken(String(deviceToken));
        if (check.valid && check.pairing) {
          userId = check.pairing.userId;
        }
      }

      if (!code) {
        res.status(400).json({
          success: false,
          error: "Identifiant de salon requis.",
          message: "Identifiant de salon requis."
        });
        return;
      }

      if (!userId) {
        res.status(400).json({
          success: false,
          error: "Identifiant d'utilisateur requis.",
          message: "Identifiant d'utilisateur requis."
        });
        return;
      }

      const outcome = raceManager.leavePrivateRace(code, String(userId));
      if ("error" in outcome) {
        res.status(outcome.statusCode).json({
          success: false,
          error: outcome.error,
          message: outcome.error
        });
        return;
      }

      res.status(200).json({
        success: true,
        roomClosed: outcome.roomClosed,
        remainingParticipants: outcome.remainingParticipants
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: message, message });
    }
  }
}

export default RoomController;
