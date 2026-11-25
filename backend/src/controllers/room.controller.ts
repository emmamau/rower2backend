import { Request, Response } from "express";
import { RaceManager, getWaitingStatusMessage } from "../services/race-manager.service";
import pairingService from "../services/pairing.service";
import sessionService from "../services/session.service";
import userStore from "../services/user-store.service";
import db from "../models";
import socketGateway from "../websocket/socket.gateway";
import { IpGeoService } from "../services/ip-geo.service";
import { isEmmaAdminUser } from "../services/auth.service";
import { getLeagueByPoints, isLeagueEligible } from "../utils/league.util";
import { SUBSCRIPTION_TIERS } from "./subscription.controller";
import subscriptionPlanService from "../services/subscription-plan.service";
import emailService, { getEmailConfig } from "../services/email.service";
import duelService from "../services/duel.service";
import { buildShareableRoomUrl } from "../utils/room-link.util";
import {
  CalendarEventParams,
  generateIcsCalendar,
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
} from "../utils/calendar.util";

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

      if (sessionService.getSessionCodeContext(rawCode)) {
        const claimed = await sessionService.claimSessionCode(
          rawCode,
          String(body.deviceId || "GARMIN_DEVICE"),
          userName ? String(userName) : null
        );
        res.status(200).json({ ...claimed, success: true });
        return;
      }

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

      // 2. Recherche du salon privé (avec réhydratation automatique si salon de duel persistant)
      let race = raceManager.findPrivateRace(rawCode);
      let challenge: any = await duelService.getChallengeByRoom(rawCode);
      if (!race) {
        if (challenge && (challenge.status === "PENDING" || challenge.status === "ACCEPTED")) {
          race = raceManager.restoreDuelRaceFromChallenge(challenge);
        }
      }
      if (!race) {
        res.status(404).json({
          success: false,
          error: "Salon introuvable ou expiré",
          message: "Salon introuvable ou expiré"
        });
        return;
      }

      let duelChallengeInfo: any = null;
      if (race.isDuel1v1) {
        if (!challenge) {
          challenge = await duelService.getChallengeByRoom(race.id || race.code || "");
        }
        if (challenge) {
          duelChallengeInfo = {
            id: challenge.id,
            status: challenge.status,
            challengerUserId: challenge.challengerUserId,
            challengerLogin: challenge.challengerLogin,
            challengerName: challenge.challengerName,
            challengedUserId: challenge.challengedUserId,
            challengedLogin: challenge.challengedLogin,
            challengedName: challenge.challengedName,
            challengedEmail: challenge.challengedEmail,
            slotStart: challenge.slotStart,
            slotEnd: challenge.slotEnd,
            timezone: challenge.timezone,
            targetDistance: challenge.targetDistance,
            expiresAt: challenge.expiresAt,
            roomId: challenge.roomId,
            roomCode: challenge.roomCode,
            roomPin: challenge.roomPin,
          };
        }
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
        const tierConfig = await subscriptionPlanService.getLimitsForTier(hostUser || tierKey);
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
      const rawUserTier = String(user?.subscriptionTier || (user as any)?.subscription_tier || "").toLowerCase().trim();
      const isSubscriber = Boolean(
        isAdmin ||
        user?.isSubscriber ||
        (user as any)?.is_subscriber ||
        (rawUserTier && !["free", "none", ""].includes(rawUserTier)) ||
        (user?.subscriptionStatus === "active" && rawUserTier !== "free")
      );
      const userLeague = (user as any)?.league || (user?.points !== undefined ? getLeagueByPoints(user.points).id : "bronze");

      const country = user?.country || user?.pays || (await IpGeoService.resolveCountryFromRequest(req));

      // 1. Contrôle strict créateur pour les duels contre un bot (sauf si saisie du PIN montre par le créateur)
      if (race.isBotDuel && !isHost && !alreadyApproved && !viaPin && !isDeviceAuthenticated) {
        res.status(403).json({
          success: false,
          error: "Ce duel contre un bot est réservé à son créateur",
          message: "Ce duel contre un bot est réservé à son créateur"
        });
        return;
      }

      // 2. Contrôle de prérequis d'abonnement
      if (race.requiresSubscription && !isSubscriber && !isHost && !isAdmin) {
        res.status(403).json({
          success: false,
          error: "Abonnement requis pour ce salon",
          message: "Abonnement requis pour ce salon"
        });
        return;
      }

      // 3. Contrôle de prérequis de niveau de ligue
      if (race.requiredLeague && !isHost && !isAdmin) {
        const eligible = isLeagueEligible(userLeague, undefined, race.requiredLeague);
        if (!eligible) {
          res.status(403).json({
            success: false,
            error: `Niveau de ligue insuffisant pour ce salon (requis : ${race.requiredLeague})`,
            message: `Niveau de ligue insuffisant pour ce salon (requis : ${race.requiredLeague})`
          });
          return;
        }
      }

      const openOnly = Boolean(body.openOnly || query.openOnly);

      // Si l'utilisateur demande une ouverture en mode consultation (openOnly) et n'a pas validé son code PIN sur sa montre,
      // ouvrir le salon en mode consultation / attente sans attribuer de couloir de départ ni verrouiller la grille.
      if (openOnly && !alreadyApproved && !viaPin && !isDeviceAuthenticated) {
        res.status(200).json({
          success: true,
          lane: 0,
          spectator: true,
          waitingWatchPin: true,
          raceId: race.id,
          roomId: race.id,
          code: race.code,
          pinCode: race.pinCode,
          title: race.title,
          status: race.status,
          targetDistance: race.targetDistance,
          maxParticipants: race.maxParticipants,
          organizerCapacity,
          isHost,
          isSubscriber,
          requiresSubscription: race.requiresSubscription,
          requiredLeague: race.requiredLeague,
          isBotDuel: race.isBotDuel,
          isDuel1v1: race.isDuel1v1,
          duelChallenge: duelChallengeInfo,
          isSolo: race.isSolo,
          botStartMode: race.botStartMode,
          scheduledStartTime: race.scheduledStartTime,
          startMode: race.startMode,
          participants: Array.from(race.participants?.values() || []),
          message: "Salon ouvert en mode attente (saisie du code PIN requise sur la montre)."
        });
        return;
      }

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
        if (race.isBotDuel && race.originalHostUserId && race.originalHostUserId !== String(userId)) {
          userStore.deleteActivityById(`${race.id}_${race.originalHostUserId}`);
          try {
            await Activities.destroy({
              where: { id: `${race.id}_${race.originalHostUserId}` }
            });
          } catch {}
        }
        const compositeId = `${race.id}_${userId}`;
        const playerStatus = race.status === "RUNNING" ? "in_progress" : "waiting";
        const actDefaults = {
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
          avgSpeedKmh: 0,
          isBot: false
        };
        if (!userStore.findActivityById(compositeId)) {
          userStore.recordActivity(actDefaults);
        }
        try {
          const existing = await Activities.findByPk(compositeId);
          if (!existing) {
            await Activities.create(actDefaults as any);
          }
          const rows = await Activities.findAll({ where: { activityId: race.id } });
          if (rows.length > 0) {
            const sorted = RaceManager.sortRanking(rows as any);
            socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(sorted, race));
          }
        } catch {
          const memRows = userStore.findActivitiesByRaceId(race.id);
          if (memRows.length > 0) {
            const sorted = RaceManager.sortRanking(memRows as any);
            socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(sorted, race));
          }
        }
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
        duelChallenge: duelChallengeInfo,
        isSolo: Boolean(race.isSolo),
        gameMode: race.gameMode || (race.isSolo ? "solo" : race.isBotDuel ? "bot_duel" : race.isDuel1v1 ? "duel_1v1" : "multi"),
        startMode: race.startMode || "manual",
        scheduledStartTime: race.scheduledStartTime ? race.scheduledStartTime.toISOString() : undefined,
        scheduledStartTimeEpoch: race.scheduledStartTime ? Math.floor(race.scheduledStartTime.getTime() / 1000) : undefined,
        timezone: race.timezone || "Europe/Paris",
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
        duelChallenge: duelChallengeInfo,
        isSolo: Boolean(race.isSolo),
        gameMode: race.gameMode || (race.isSolo ? "solo" : race.isBotDuel ? "bot_duel" : race.isDuel1v1 ? "duel_1v1" : "multi"),
        hasBots: Boolean(race.hasBots || race.isBotDuel),
        totalParticipants,
        secondsRemaining,
        countdownSeconds: secondsRemaining,
        lobbyEndsAt: race.lobbyEndsAt ? race.lobbyEndsAt.toISOString() : undefined,
        startMode: race.startMode || "manual",
        scheduledStartTime: race.scheduledStartTime ? race.scheduledStartTime.toISOString() : undefined,
        scheduledStartTimeEpoch: race.scheduledStartTime ? Math.floor(race.scheduledStartTime.getTime() / 1000) : undefined,
        timezone: race.timezone || "Europe/Paris",
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
      const compositeId = `${race.id}_${ticket.userId}`;
      const ticketActDefaults = {
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
        avgSpeedKmh: 0,
        isBot: false
      };
      if (!userStore.findActivityById(compositeId)) {
        userStore.recordActivity(ticketActDefaults);
      }
      try {
        const existing = await Activities.findByPk(compositeId);
        if (!existing) {
          await Activities.create(ticketActDefaults as any);
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

      const totalParticipants = race.totalParticipants || (race.participants ? race.participants.size : 1);

      res.status(200).json({
        success: true,
        raceId: race.id,
        id: race.id,
        userId: participant?.userId || resolvedUserId,
        lane: participant?.lane || 1,
        totalParticipants,
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
        startMode: race.startMode || "manual",
        scheduledStartTime: race.scheduledStartTime ? race.scheduledStartTime.toISOString() : undefined,
        scheduledStartTimeEpoch: race.scheduledStartTime ? Math.floor(race.scheduledStartTime.getTime() / 1000) : undefined,
        timezone: race.timezone || "Europe/Paris",
        waitingStatusMessage: ready
          ? (race.status === "COUNTDOWN"
              ? waitingStatusMessage
              : (race.startMode === "scheduled" && race.scheduledStartTime
                  ? `Rameur prêt - ${waitingStatusMessage}`
                  : "Rameur prêt - En attente du départ"))
          : waitingStatusMessage,
        message: ready
          ? (race.startMode === "scheduled" && race.scheduledStartTime
              ? `Rameur prêt - ${waitingStatusMessage}`
              : "Rameur prêt - En attente du départ")
          : waitingStatusMessage
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
      const params = req.params || {};

      const code = String(params.identifier || body.code || query.code || body.pin || query.pin || body.roomId || query.roomId || body.roomCode || "").trim();
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

  /**
   * POST /api/rooms/:identifier/invite
   * Envoi d'invitations par e-mail (duel 1v1 ou régate multijoueur)
   * avec respect strict des quotas d'abonnement et option rendez-vous d'agenda iCalendar.
   */
  public static async inviteToRoom(req: Request, res: Response): Promise<void> {
    try {
      const identifier = String(req.params.identifier || req.body?.identifier || req.body?.code || "").trim();
      const body = req.body || {};
      const hostUserId = String(body.hostUserId || req.query.hostUserId || "").trim();
      const rawEmails = body.emails || (body.email ? [body.email] : []);
      const includeCalendarInvite = body.includeCalendarInvite !== undefined ? Boolean(body.includeCalendarInvite) : true;

      if (!identifier) {
        res.status(400).json({ success: false, error: "Identifiant ou code de salon requis." });
        return;
      }

      const race = raceManager.findPrivateRace(identifier);
      if (!race) {
        res.status(404).json({ success: false, error: "Salon privé introuvable ou expiré." });
        return;
      }

      if (race.status === "COMPLETED" || race.status === "ABANDONED" || race.status === "STOPPED") {
        res.status(410).json({ success: false, error: "Ce salon est déjà clôturé." });
        return;
      }

      // Vérification des droits : seul l'organisateur (ou admin Emma) peut inviter
      const hostUser = race.hostUserId ? await userStore.findUser(race.hostUserId) : null;
      const isEmma = isEmmaAdminUser(hostUserId, hostUser?.name);
      const isHost = Boolean(
        isEmma ||
        (race.hostUserId && hostUserId && race.hostUserId === hostUserId) ||
        (race.originalHostUserId && hostUserId && race.originalHostUserId === hostUserId)
      );

      if (!isHost) {
        res.status(403).json({ success: false, error: "Seul l'organisateur du salon peut envoyer des invitations." });
        return;
      }

      // Nettoyage et validation des adresses e-mail
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const cleanEmails: string[] = Array.isArray(rawEmails)
        ? Array.from(new Set(rawEmails.map((e: any) => String(e).trim().toLowerCase()).filter((e: string) => emailRegex.test(e))))
        : [];

      if (cleanEmails.length === 0) {
        res.status(400).json({ success: false, error: "Aucune adresse e-mail valide fournie." });
        return;
      }

      // Vérification des règles selon le mode de jeu (Duel vs Multi-joueurs)
      const isDuel = Boolean(race.isDuel1v1 || (race as any).gameMode === "duel_1v1" || (race as any).gameMode === "duel");

      let maxAllowedInvitations = 1;
      let planName = "Gratuite";

      if (isDuel) {
        if (cleanEmails.length > 1) {
          res.status(400).json({
            success: false,
            error: "En mode Duel 1 vs 1, une seule adresse e-mail peut être invitée à la fois.",
            maxAllowed: 1
          });
          return;
        }
      } else {
        // Multi-joueurs : quota selon l'abonnement de l'organisateur
        const limits = await subscriptionPlanService.getLimitsForTier(hostUser || "free");
        planName = limits.name;
        // Capacité max de participants autorisée pour l'offre, moins l'hôte (1), moins les bots prévus
        const botCount = race.botCount || 0;
        maxAllowedInvitations = Math.max(1, (limits.maxParticipants || 2) - 1 - botCount);

        if (cleanEmails.length > maxAllowedInvitations) {
          res.status(403).json({
            success: false,
            error: `Votre forfait (${planName}) autorise au maximum ${limits.maxParticipants} participants (${maxAllowedInvitations} invitation(s) restante(s)). Veuillez réduire le nombre de destinataires ou surclasser votre abonnement.`,
            maxAllowed: maxAllowedInvitations,
            submittedCount: cleanEmails.length,
            code: "INVITE_QUOTA_EXCEEDED"
          });
          return;
        }
      }

      // Préparation de l'URL canonique (/r/:code) et de la langue de l'organisateur
      const emailConfig = getEmailConfig();
      const origin = emailConfig.frontendUrl;
      const codeOrIdent = race.code || identifier;
      const joinUrl = buildShareableRoomUrl(origin, codeOrIdent);

      // Détection de la langue de l'organisateur (défaut en anglais si non francophone)
      const requestedLang = (req.body.lang || req.body.language || "").toString().toLowerCase().trim();
      let organizerLang = "en"; // Repli par défaut en anglais

      if (requestedLang) {
        organizerLang = requestedLang.startsWith("fr") ? "fr" : "en";
      } else if (hostUser) {
        const userLang = ((hostUser as any).language || (hostUser as any).preferredLanguage || "").toString().toLowerCase().trim();
        const userCountry = ((hostUser as any).country || (hostUser as any).pays || "").toString().toLowerCase().trim();
        const isFrenchCountry = ["france", "fr", "belgique", "belgium", "suisse", "switzerland", "canada", "luxembourg"].some(c => userCountry.includes(c));
        if (userLang.startsWith("fr") || isFrenchCountry) {
          organizerLang = "fr";
        }
      } else {
        const acceptLang = (req.headers["accept-language"] || "").toString().toLowerCase();
        if (acceptLang.startsWith("fr")) {
          organizerLang = "fr";
        }
      }

      // Envoi asynchrone des e-mails avec détection de la langue de chaque joueur ou de l'organisateur
      const organizerDisplayName = race.hostUserName || hostUser?.name || hostUserId || (organizerLang.startsWith("fr") ? "L'organisateur" : "The Organizer");
      const sentRecipients: string[] = [];

      // Pré-génération des invitations calendrier pour FR et EN si planifié
      let frCalIcs: string | undefined;
      let frGoogleCalUrl: string | undefined;
      let frOutlookCalUrl: string | undefined;
      let enCalIcs: string | undefined;
      let enGoogleCalUrl: string | undefined;
      let enOutlookCalUrl: string | undefined;

      if (includeCalendarInvite && race.startMode === "scheduled" && race.scheduledStartTime) {
        const calParamsFr: CalendarEventParams = {
          eventId: race.id,
          title: `Régate Rower Race : ${race.title}`,
          description: `Régate connectée Rower Race (${race.targetDistance}m).\nOrganisée par ${organizerDisplayName}.\nLien direct : ${joinUrl}\nCode salon : ${codeOrIdent}\nCode Garmin : ${race.pinCode}`,
          url: joinUrl,
          startTime: race.scheduledStartTime,
          durationMinutes: 45,
          organizerName: organizerDisplayName,
          organizerEmail: hostUser?.email || "contact@rowerrace.com",
        };
        frCalIcs = generateIcsCalendar(calParamsFr);
        frGoogleCalUrl = generateGoogleCalendarUrl(calParamsFr);
        frOutlookCalUrl = generateOutlookCalendarUrl(calParamsFr);

        const calParamsEn: CalendarEventParams = {
          eventId: race.id,
          title: `Rower Race Regatta: ${race.title}`,
          description: `Connected Rower Race Regatta (${race.targetDistance}m).\nHosted by ${organizerDisplayName}.\nDirect link: ${joinUrl}\nWeb room code: ${codeOrIdent}\nGarmin watch code: ${race.pinCode}`,
          url: joinUrl,
          startTime: race.scheduledStartTime,
          durationMinutes: 45,
          organizerName: organizerDisplayName,
          organizerEmail: hostUser?.email || "contact@rowerrace.com",
        };
        enCalIcs = generateIcsCalendar(calParamsEn);
        enGoogleCalUrl = generateGoogleCalendarUrl(calParamsEn);
        enOutlookCalUrl = generateOutlookCalendarUrl(calParamsEn);
      }

      for (const email of cleanEmails) {
        try {
          // Détection individuelle : joueur enregistré avec langue préférée ou langue de l'organisateur
          let recipientLang = organizerLang;
          const targetPlayer = await userStore.findUserByEmail(email);
          if (targetPlayer) {
            const playerLang = (targetPlayer.language || (targetPlayer as any).preferredLanguage || "").toString().toLowerCase().trim();
            if (playerLang) {
              recipientLang = playerLang.startsWith("fr") ? "fr" : "en";
            }
          }

          const isRecipientFr = recipientLang.startsWith("fr");
          const icsContent = isRecipientFr ? frCalIcs : enCalIcs;
          const googleCalUrl = isRecipientFr ? frGoogleCalUrl : enGoogleCalUrl;
          const outlookCalUrl = isRecipientFr ? frOutlookCalUrl : enOutlookCalUrl;

          await emailService.sendRoomInvitationEmail({
            to: email,
            organizerName: organizerDisplayName,
            roomTitle: race.title,
            targetDistance: race.targetDistance,
            roomCode: race.code || identifier,
            roomPin: race.pinCode || "",
            joinUrl,
            isDuel,
            scheduledStartTime: (race.startMode === "scheduled" && race.scheduledStartTime)
              ? (race.scheduledStartTime instanceof Date ? race.scheduledStartTime.toISOString() : String(race.scheduledStartTime))
              : undefined,
            timezone: race.timezone,
            icsCalendarContent: icsContent,
            googleCalendarUrl: googleCalUrl,
            outlookCalendarUrl: outlookCalUrl,
            lang: recipientLang,
          });
          sentRecipients.push(email);
        } catch (err) {
          console.error(`[RoomController] Erreur envoi invitation vers ${email}:`, err);
        }
      }

      res.status(200).json({
        success: true,
        count: sentRecipients.length,
        recipients: sentRecipients,
        maxAllowed: maxAllowedInvitations,
        hasCalendarInvite: Boolean(frCalIcs || enCalIcs)
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: "Erreur envoi invitations: " + message });
    }
  }
}

export default RoomController;
