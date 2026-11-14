import crypto from "crypto";
import pairingService from "./pairing.service";
import raceManager from "./race-manager.service";
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
      cleanPlayerName = cleanUserId ? cleanUserId : `Rameur_${code.slice(0, 3)}`;
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
    deviceId: string
  ): Promise<{
    success: boolean;
    deviceToken?: string;
    mode: "room" | "cockpit" | "paired";
    playerName: string;
    lane: number;
    userId?: string;
    roomId?: string | null;
    guestPairingToken?: string;
    message: string;
    race?: any;
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
        const guestName = ticket?.guestName || `Rameur_${cleanCode.slice(0, 3)}`;
        const userId = ticket?.userId || `guest_${cleanCode.toLowerCase()}`;
        const lane = ticket?.lane || 1;

        const paired = await pairingService.pairGuestDirect(userId, cleanDeviceId, {
          guestName,
          userName: guestName,
          roomId: race.id,
          raceId: race.id,
          ticketPin: cleanCode,
          lane,
        });

        raceManager.joinPrivateRace(race.id, userId, guestName, undefined, {
          isDeviceAuthenticated: true,
          viaPin: true,
          ready: false,
          deviceToken: paired.deviceToken,
          bypassApproval: true,
        });

        return {
          success: true,
          deviceToken: paired.deviceToken,
          mode: "room",
          playerName: guestName,
          lane,
          userId,
          roomId: race.id,
          message: `Bienvenue ${guestName} ! Ligne ${lane} attribuée`,
          race,
        };
      }

      throw new Error("Code universel invalide, déjà utilisé ou expiré (validité 10 min).");
    }

    const { type, roomId, playerName, assignedLane, socketId } = context;
    const lane = assignedLane || 1;

    let targetUserId = context.userId;
    let mode: "room" | "cockpit" | "paired" = "paired";
    let deviceToken = "";

    // Cas 1 : Compte Authentifié (userId présent)
    if (context.userId) {
      targetUserId = context.userId;
      const pairRes = await pairingService.pairDeviceDirectly(targetUserId, cleanDeviceId);
      deviceToken = pairRes.deviceToken;
      mode = roomId ? "room" : "paired";

      // Si salon présent, inscrire / confirmer le joueur sur sa ligne d'eau
      if (roomId) {
        const race = raceManager.getRaceById(roomId);
        if (race) {
          raceManager.joinPrivateRace(race.id, targetUserId, playerName, undefined, {
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
        guestName: playerName,
        userName: playerName,
        roomId: roomId || undefined,
        code: cleanCode,
        lane,
        socketId: socketId || undefined,
      });
      deviceToken = paired.deviceToken;

      if (roomId) {
        const race = raceManager.getRaceById(roomId);
        if (race) {
          raceManager.joinPrivateRace(race.id, targetUserId, playerName, undefined, {
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
        guestName: playerName,
        userName: playerName,
        code: cleanCode,
        lane: 1,
        socketId: socketId || undefined,
      });
      deviceToken = paired.deviceToken;
    }

    context.claimedAt = new Date();
    context.deviceId = cleanDeviceId;
    context.deviceToken = deviceToken;

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

    return {
      success: true,
      deviceToken,
      mode,
      playerName,
      lane,
      userId: targetUserId,
      roomId,
      guestPairingToken: context.guestPairingToken,
      message: `Bienvenue ${playerName} ! Mode ${mode} activé (Ligne ${lane})`,
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
