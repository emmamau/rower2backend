import crypto from "crypto";
import pairingService from "./pairing.service";
import raceManager, { RaceManager, getWaitingStatusMessage } from "./race-manager.service";
import userStore from "./user-store.service";
import socketGateway from "../websocket/socket.gateway";
import db from "../models";

const Activities = db.activities;

// Alphabet de 32 caractères lisibles (sans ambiguïté 0/O, 1/I)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface UniversalSessionCodeContext {
  code: string;
  type: "account_link" | "room_join" | "guest_cockpit";
  userId?: string | null;
  roomId?: string | null;
  playerName: string;
  assignedLane?: number;
  socketId?: string | null;
  guestPairingToken?: string;
  expiresAt: Date;
  createdAt: Date;
  claimedAt?: Date | null;
  deviceId?: string | null;
  deviceToken?: string | null;
}

export class SessionService {
  private codes: Map<string, UniversalSessionCodeContext> = new Map();

  constructor() {
    // Nettoyage régulier des codes expirés (TTL 10 min)
    const cleanupTimer = setInterval(() => {
      this.cleanupExpiredCodes();
    }, 60000);
    if (cleanupTimer.unref) {
      cleanupTimer.unref();
    }
  }

  /**
   * Génère un code alphanumérique unique de 5 caractères
   */
  public generateUniqueCode5(): string {
    let attempts = 0;
    while (attempts < 20) {
      const bytes = crypto.randomBytes(5);
      let code = "";
      for (let i = 0; i < 5; i++) {
        code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
      }
      if (!this.codes.has(code)) {
        return code;
      }
      attempts++;
    }
    // Fallback avec random simple
    let code = "";
    for (let i = 0; i < 5; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  /**
   * Crée un code universel à 5 caractères associé à son contexte
   */
  public createSessionCode(options: {
    type: "account_link" | "room_join" | "guest_cockpit";
    userId?: string | null;
    roomId?: string | null;
    playerName?: string | null;
    socketId?: string | null;
    assignedLane?: number;
  }): UniversalSessionCodeContext {
    const code = this.generateUniqueCode5();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const cleanUserId = options.userId ? String(options.userId).trim() : null;
    const cleanRoomId = options.roomId ? String(options.roomId).trim() : null;
    let cleanPlayerName = options.playerName ? String(options.playerName).trim() : "";

    if (!cleanPlayerName) {
      if (cleanUserId) {
        const matched = userStore.findUserSync(cleanUserId);
        cleanPlayerName = matched?.login || matched?.name || cleanUserId;
      } else {
        cleanPlayerName = `Rameur_${code.slice(0, 3)}`;
      }
    }

    let assignedLane = options.assignedLane;

    // Si room présente, calculer la prochaine ligne d'eau disponible si non spécifiée
    if (cleanRoomId) {
      const race = raceManager.getRaceById(cleanRoomId);
      if (race && !assignedLane) {
        const usedLanes = new Set<number>();
        if (race.participants) {
          for (const p of race.participants.values()) {
            if (p.lane) usedLanes.add(p.lane);
          }
        }
        for (let l = 1; l <= (race.maxParticipants || 8); l++) {
          if (!usedLanes.has(l)) {
            assignedLane = l;
            break;
          }
        }
        assignedLane = assignedLane || (race.participants ? race.participants.size + 1 : 1);
      }
    }

    const context: UniversalSessionCodeContext = {
      code,
      type: options.type,
      userId: cleanUserId,
      roomId: cleanRoomId,
      playerName: cleanPlayerName,
      assignedLane: assignedLane || 1,
      socketId: options.socketId || null,
      guestPairingToken: crypto.randomUUID(),
      expiresAt,
      createdAt: new Date(),
    };

    this.codes.set(code, context);

    // Enregistrement également dans pairingService pour compatibilité
    try {
      if (cleanUserId) {
        pairingService.createCustomPairingCode(code, cleanUserId, expiresAt);
      }
    } catch {}

    return context;
  }

  /**
   * Récupère le contexte d'un code universel 5 caractères
   */
  public getSessionCodeContext(code: string): UniversalSessionCodeContext | null {
    const cleanCode = String(code || "").trim().toUpperCase();
    const ctx = this.codes.get(cleanCode);
    if (!ctx) return null;
    if (new Date(ctx.expiresAt).getTime() < Date.now()) {
      this.codes.delete(cleanCode);
      return null;
    }
    return ctx;
  }

  /**
   * Résolution atomique appelée par la montre Garmin (POST /api/session/claim)
   */
  public async claimSessionCode(
    code: string,
    deviceId: string,
    customGuestPseudo?: string | null
  ): Promise<{
    success: boolean;
    deviceToken?: string;
    mode: "room" | "cockpit" | "paired";
    type?: string;
    isLinkCode?: boolean;
    login?: string;
    userName?: string;
    playerName: string;
    lane: number;
    userId?: string;
    roomId?: string | null;
    guestPairingToken?: string;
    message: string;
    race?: any;
    id?: string;
    raceId?: string;
    code?: string;
    pinCode?: string;
    botLane?: number;
    status?: string;
    internalStatus?: string;
    secondsRemaining?: number;
    countdownSeconds?: number;
    waitingForHost?: boolean;
    hasBots?: boolean;
    targetDistance?: number;
    totalParticipants?: number;
    isSolo?: boolean;
    isBotDuel?: boolean;
    isDuel1v1?: boolean;
    gameMode?: string;
    waitingStatusMessage?: string;
  }> {
    const cleanCode = String(code || "").trim().toUpperCase();
    const cleanDeviceId = String(deviceId || "GARMIN_DEVICE").trim();

    if (!cleanCode || cleanCode.length !== 5) {
      throw new Error("Code universel à 5 caractères requis.");
    }
    if (!cleanDeviceId) {
      throw new Error("Identifiant matériel de la montre (deviceId) requis.");
    }

    const context = this.getSessionCodeContext(cleanCode);

    // Fallback : vérifier si c'est un ticket de salon ou un code de course existant dans raceManager
    if (!context) {
      const ticket = raceManager.getGuestTicket(cleanCode);
      const privateRace = raceManager.findPrivateRace(cleanCode);
      if (ticket || privateRace) {
        const race = ticket ? raceManager.getRaceById(ticket.roomId) : privateRace;
        if (!race) {
          throw new Error("Salon introuvable ou expiré.");
        }
        if (race.status === "COMPLETED" || race.status === "ABANDONED") {
          throw new Error("Ce salon est déjà terminé.");
        }

        const existingPairing = !ticket ? await pairingService.findPairingByDeviceId(cleanDeviceId) : null;
        let guestName =
          ticket?.guestName ||
          (existingPairing?.userId && !existingPairing.userId.startsWith("guest_") ? existingPairing.userId : "") ||
          ((race.isSolo || race.isBotDuel) && race.hostUserName ? race.hostUserName : "") ||
          `Rameur_${cleanCode.slice(0, 3)}`;
        if (customGuestPseudo && String(customGuestPseudo).trim().length > 0 && String(customGuestPseudo).trim() !== "Rameur_42") {
          guestName = String(customGuestPseudo).trim();
        }

        let userId = ticket?.userId || "";
        if (!userId) {
          if (existingPairing && existingPairing.userId && !existingPairing.userId.startsWith("guest_")) {
            userId = existingPairing.userId;
          } else if ((race.isSolo || race.isBotDuel) && race.hostUserId && race.hostUserId !== "anonymous") {
            userId = race.hostUserId;
          } else {
            userId = `guest_${cleanCode.toLowerCase()}`;
          }
        }

        let deviceToken = "";
        if (!ticket && existingPairing && existingPairing.userId === userId && existingPairing.deviceToken) {
          deviceToken = existingPairing.deviceToken;
        } else {
          const paired = await pairingService.pairGuestDirect(userId, cleanDeviceId, {
            guestName,
            userName: guestName,
            roomId: race.id,
            raceId: race.id,
            ticketPin: cleanCode,
            lane: ticket?.lane || 1,
            socketId: ticket?.socketId || undefined,
          });
          deviceToken = paired.deviceToken;
        }

        const joinRes = raceManager.joinPrivateRace(race.id, userId, guestName, undefined, {
          isDeviceAuthenticated: true,
          viaPin: true,
          ready: false,
          socketId: ticket?.socketId || undefined,
          deviceToken,
          bypassApproval: true,
        });

        if ("error" in joinRes) {
          throw new Error(joinRes.error);
        }

        const lane = ticket?.lane || joinRes.lane || 1;
        if (race.participants && race.participants.has(userId)) {
          const p = race.participants.get(userId)!;
          p.lane = lane;
          p.ready = false;
          p.connectionState = "CONNECTED";
          p.deviceToken = deviceToken;
          if (ticket?.socketId) p.socketId = ticket.socketId;
          race.participants.set(userId, p);
        }

        if (ticket) {
          ticket.claimedAt = new Date();
          ticket.deviceId = cleanDeviceId;
          ticket.deviceToken = deviceToken;
        }

        // Enregistrement en mémoire + base de données pour la ligne de départ
        if (lane > 0) {
          if (race.isBotDuel && race.originalHostUserId && race.originalHostUserId !== userId) {
            userStore.deleteActivityById(`${race.id}_${race.originalHostUserId}`);
            try {
              await Activities.destroy({ where: { id: `${race.id}_${race.originalHostUserId}` } });
            } catch {}
          }
          const compositeId = `${race.id}_${userId}`;
          const playerStatus = race.status === "RUNNING" ? "in_progress" : "waiting";
          const actDefaults = {
            id: compositeId,
            activityId: race.id,
            userId,
            userName: guestName,
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
            isBot: false,
          };
          if (!userStore.findActivityById(compositeId)) {
            userStore.recordActivity(actDefaults);
          }
          try {
            const existing = await Activities.findByPk(compositeId);
            if (!existing) {
              await Activities.create(actDefaults as any);
            }
          } catch {}
          try {
            const memRows = userStore.findActivitiesByRaceId(race.id);
            let rows: any[] = memRows;
            try {
              const dbRows = await Activities.findAll({ where: { activityId: race.id } });
              if (dbRows.length > 0) rows = dbRows;
            } catch {}
            if (rows.length > 0) {
              const sorted = RaceManager.sortRanking(rows as any);
              socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(sorted, race));
            }
          } catch {}
        }

        const timing = raceManager.getRaceTiming(race, new Date());
        const waitingForHost = race.status === "LOBBY" && !race.autoStart;
        const secondsRemaining = (!waitingForHost && (race.status === "LOBBY" || race.status === "COUNTDOWN"))
          ? timing.secondsUntilStart
          : 0;
        const totalParticipants = (race.participants ? race.participants.size : 1) + (race.botCount || (race.isBotDuel ? 1 : 0));
        const waitingStatusMessage = getWaitingStatusMessage(race) || `Ligne ${lane} attribuée - Donnez un coup de rame pour réveiller le rameur`;

        try {
          socketGateway.broadcastPrivateRoomUpdate(race.id, {
            type: "PARTICIPANT_JOINED",
            ticketClaimed: Boolean(ticket),
            ticketPin: cleanCode,
            code: race.code,
            socketId: ticket?.socketId,
            userId,
            hostUserId: race.originalHostUserId || race.hostUserId,
            userName: guestName,
            guestName,
            deviceToken,
            deviceId: cleanDeviceId,
            lane,
            botLane: race.isBotDuel ? 2 : undefined,
            raceId: race.id,
            ready: false,
            connectionState: "CONNECTED",
            isBotDuel: Boolean(race.isBotDuel),
            isDuel1v1: Boolean(race.isDuel1v1),
            isSolo: Boolean(race.isSolo),
            gameMode: race.gameMode || (race.isSolo ? "solo" : race.isBotDuel ? "bot_duel" : race.isDuel1v1 ? "duel_1v1" : "multi"),
            startMode: race.startMode || "manual",
            status: race.status,
            secondsRemaining,
            countdownSeconds: secondsRemaining,
            lobbyEndsAt: race.lobbyEndsAt ? race.lobbyEndsAt.toISOString() : undefined,
            waitingStatusMessage,
          });
        } catch {}

        return {
          success: true,
          deviceToken,
          mode: "room",
          playerName: guestName,
          lane,
          botLane: race.isBotDuel ? 2 : undefined,
          userId,
          roomId: race.id,
          id: race.id,
          raceId: race.id,
          code: race.code,
          pinCode: race.pinCode,
          targetDistance: race.targetDistance,
          status: race.status === "RUNNING" ? "in_progress" : "waiting",
          internalStatus: race.status,
          secondsRemaining,
          countdownSeconds: secondsRemaining,
          waitingForHost,
          hasBots: Boolean(race.hasBots || race.isBotDuel),
          totalParticipants,
          isSolo: Boolean(race.isSolo),
          isBotDuel: Boolean(race.isBotDuel),
          isDuel1v1: Boolean(race.isDuel1v1),
          gameMode: race.gameMode || (race.isSolo ? "solo" : race.isBotDuel ? "bot_duel" : race.isDuel1v1 ? "duel_1v1" : "multi"),
          waitingStatusMessage,
          message: `Bienvenue ${guestName} ! Ligne ${lane} attribuée`,
          race,
        };
      }

      const pairFallback = await pairingService.pairDevice(cleanCode, cleanDeviceId);
      if (pairFallback.success && pairFallback.deviceToken) {
        const matchedUser = pairFallback.userId ? await userStore.findUser(pairFallback.userId) : null;
        const userLogin = matchedUser?.login || matchedUser?.name || pairFallback.userId || "Rameur";
        return {
          success: true,
          deviceToken: pairFallback.deviceToken,
          mode: "paired",
          type: "account_link",
          isLinkCode: true,
          login: userLogin,
          userName: userLogin,
          playerName: userLogin,
          lane: 1,
          userId: userLogin,
          roomId: null,
          message: `Bienvenue ${userLogin} !`,
        };
      }

      throw new Error("Code universel invalide, déjà utilisé ou expiré (validité 10 min).");
    }

    const { type, roomId, playerName, assignedLane, socketId } = context;
    const lane = assignedLane || 1;

    let targetUserId = context.userId;
    let mode: "room" | "cockpit" | "paired" = "paired";
    let deviceToken = "";
    let finalPlayerName = playerName;
    if (!context.userId && customGuestPseudo && String(customGuestPseudo).trim().length > 0 && String(customGuestPseudo).trim() !== "Rameur_42") {
      finalPlayerName = String(customGuestPseudo).trim();
    }

    // Cas 1 : Compte Authentifié ou Liaison de compte (type == "account_link" ou userId présent)
    if (type === "account_link" || context.userId) {
      const matchedUser = context.userId ? await userStore.findUser(context.userId) : null;
      const canonicalLogin = matchedUser?.login || matchedUser?.name || context.playerName || context.userId || "Rameur";
      targetUserId = canonicalLogin;
      finalPlayerName = canonicalLogin;

      const pairRes = await pairingService.pairDeviceDirectly(targetUserId, cleanDeviceId);
      deviceToken = pairRes.deviceToken;
      // Pour une liaison de compte (account_link), interdiction formelle d'entrer dans un salon
      mode = (type !== "account_link" && roomId) ? "room" : "paired";

      // Si salon présent et NON liaison de compte, inscrire / confirmer le joueur sur sa ligne d'eau
      if (mode === "room" && roomId) {
        const race = raceManager.getRaceById(roomId);
        if (race) {
          raceManager.joinPrivateRace(race.id, targetUserId, finalPlayerName, undefined, {
            isDeviceAuthenticated: true,
            viaPin: true,
            ready: false,
            socketId: socketId || undefined,
            deviceToken,
            bypassApproval: true,
          });
        }
      }
    }
    // Cas 2 : Invité Salon Privé (roomId présent, sans userId)
    else if (roomId || type === "room_join") {
      targetUserId = `guest_${cleanCode.toLowerCase()}`;
      mode = "room";
      const paired = await pairingService.pairGuestDirect(targetUserId, cleanDeviceId, {
        guestName: finalPlayerName,
        userName: finalPlayerName,
        roomId: roomId || undefined,
        code: cleanCode,
        lane,
        socketId: socketId || undefined,
      });
      deviceToken = paired.deviceToken;

      if (roomId) {
        const race = raceManager.getRaceById(roomId);
        if (race) {
          raceManager.joinPrivateRace(race.id, targetUserId, finalPlayerName, undefined, {
            isDeviceAuthenticated: true,
            viaPin: true,
            ready: false,
            socketId: socketId || undefined,
            deviceToken,
            bypassApproval: true,
          });
        }
      }
    }
    // Cas 3 : Cockpit Libre (guest_cockpit)
    else {
      targetUserId = `guest_${cleanCode.toLowerCase()}`;
      mode = "cockpit";
      const paired = await pairingService.pairGuestDirect(targetUserId, cleanDeviceId, {
        guestName: finalPlayerName,
        userName: finalPlayerName,
        code: cleanCode,
        lane: 1,
        socketId: socketId || undefined,
      });
      deviceToken = paired.deviceToken;
    }

    context.claimedAt = new Date();
    context.deviceId = cleanDeviceId;
    context.deviceToken = deviceToken;

    pairingService.markCustomCodePaired(cleanCode, {
      userId: targetUserId || cleanDeviceId,
      deviceId: cleanDeviceId,
      deviceToken,
    });

    // Notification WebSocket immédiate vers le front web
    try {
      socketGateway.broadcast("session_claimed", {
        code: cleanCode,
        type,
        mode,
        userId: targetUserId,
        playerName,
        lane,
        roomId,
        deviceId: cleanDeviceId,
        deviceToken,
        guestPairingToken: context.guestPairingToken,
        socketId,
      });

      if (roomId) {
        socketGateway.broadcastPrivateRoomUpdate(roomId, {
          type: "PARTICIPANT_JOINED",
          code: cleanCode,
          userId: targetUserId,
          userName: playerName,
          deviceToken,
          deviceId: cleanDeviceId,
          lane,
          ready: false,
          connectionState: "CONNECTED",
          status: "waiting",
          waitingStatusMessage: `Ligne ${lane} attribuée - Donnez un coup de rame pour réveiller le rameur`,
        });
      }
    } catch (wsErr) {
      console.warn("[SessionService] Socket broadcast error:", wsErr);
    }

    // Retrait du code actif pour garantir l'atomicité
    this.codes.delete(cleanCode);

    let attachedRace: any = null;
    let roomTotalParticipants: number | undefined = undefined;
    let secondsRemaining = 0;
    let waitingForHost = false;
    if (roomId) {
      attachedRace = raceManager.getRaceById(roomId);
      if (attachedRace) {
        roomTotalParticipants = (attachedRace.participants ? attachedRace.participants.size : 1) + (attachedRace.botCount || (attachedRace.isBotDuel ? 1 : 0));
        const timing = raceManager.getRaceTiming(attachedRace, new Date());
        waitingForHost = attachedRace.status === "LOBBY" && !attachedRace.autoStart;
        secondsRemaining = (!waitingForHost && (attachedRace.status === "LOBBY" || attachedRace.status === "COUNTDOWN"))
          ? timing.secondsUntilStart
          : 0;
        if (targetUserId) {
          const compositeId = `${attachedRace.id}_${targetUserId}`;
          const actDefaults = {
            id: compositeId,
            activityId: attachedRace.id,
            userId: targetUserId,
            userName: finalPlayerName,
            raceMode: "race",
            targetDistance: attachedRace.targetDistance,
            status: attachedRace.status === "RUNNING" ? "in_progress" : "waiting",
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
            isBot: false,
          };
          if (!userStore.findActivityById(compositeId)) {
            userStore.recordActivity(actDefaults);
          }
          try {
            const existing = await Activities.findByPk(compositeId);
            if (!existing) {
              await Activities.create(actDefaults as any);
            }
          } catch {}
        }
      }
    }

    const isLinkCode = (type === "account_link" || mode === "paired");
    const effectiveRoomId = isLinkCode ? null : roomId;

    return {
      success: true,
      deviceToken,
      mode,
      type,
      isLinkCode,
      login: finalPlayerName,
      userName: finalPlayerName,
      playerName: finalPlayerName,
      lane,
      botLane: attachedRace?.isBotDuel ? 2 : undefined,
      userId: targetUserId,
      roomId: effectiveRoomId,
      id: effectiveRoomId || undefined,
      raceId: effectiveRoomId || undefined,
      code: isLinkCode ? undefined : attachedRace?.code,
      pinCode: isLinkCode ? undefined : attachedRace?.pinCode,
      targetDistance: isLinkCode ? undefined : attachedRace?.targetDistance,
      status: isLinkCode ? undefined : (attachedRace ? (attachedRace.status === "RUNNING" ? "in_progress" : "waiting") : undefined),
      internalStatus: isLinkCode ? undefined : attachedRace?.status,
      secondsRemaining: isLinkCode ? undefined : (attachedRace ? secondsRemaining : undefined),
      countdownSeconds: isLinkCode ? undefined : (attachedRace ? secondsRemaining : undefined),
      waitingForHost: isLinkCode ? undefined : (attachedRace ? waitingForHost : undefined),
      hasBots: isLinkCode ? undefined : (attachedRace ? Boolean(attachedRace.hasBots || attachedRace.isBotDuel) : undefined),
      totalParticipants: isLinkCode ? undefined : roomTotalParticipants,
      isSolo: isLinkCode ? undefined : Boolean(attachedRace?.isSolo),
      isBotDuel: isLinkCode ? undefined : Boolean(attachedRace?.isBotDuel),
      isDuel1v1: isLinkCode ? undefined : Boolean(attachedRace?.isDuel1v1),
      gameMode: isLinkCode ? undefined : (attachedRace?.gameMode || (attachedRace?.isSolo ? "solo" : attachedRace?.isBotDuel ? "bot_duel" : attachedRace?.isDuel1v1 ? "duel_1v1" : (mode === "room" ? "multi" : undefined))),
      waitingStatusMessage: effectiveRoomId ? `Ligne ${lane} attribuée - Donnez un coup de rame pour réveiller le rameur` : undefined,
      guestPairingToken: context.guestPairingToken,
      message: isLinkCode ? `Bienvenue ${finalPlayerName} !` : `Bienvenue ${finalPlayerName} ! Mode ${mode} activé (Ligne ${lane})`,
      race: isLinkCode ? undefined : (attachedRace || undefined),
    };
  }

  /**
   * Transfère un appairage invité vers un compte utilisateur nouvellement créé
   */
  public async migrateGuestPairingToUser(guestPairingToken: string, newUserId: string): Promise<boolean> {
    if (!guestPairingToken || !newUserId) return false;
    return pairingService.transferPairingTokenToUser(guestPairingToken, newUserId);
  }

  /**
   * Nettoie les codes expirés
   */
  public cleanupExpiredCodes(): void {
    const now = Date.now();
    for (const [code, ctx] of this.codes.entries()) {
      if (new Date(ctx.expiresAt).getTime() < now) {
        this.codes.delete(code);
      }
    }
  }
}

export const sessionService = new SessionService();
export default sessionService;
