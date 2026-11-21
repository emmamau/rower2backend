import crypto from "crypto";
import { Op } from "sequelize";
import db from "../models";
import { PairingAttributes } from "../models/pairing.model";
import socketGateway from "../websocket/socket.gateway";
import userStore from "./user-store.service";
import raceManager, { RaceManager } from "./race-manager.service";

const Pairings = db.pairings;
const Activities = db.activities;

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 caractères lisibles sans ambiguïté O/0, I/1

export interface StoredPairing extends PairingAttributes {}

export class PairingService {
  private inMemoryPairings: Map<string, StoredPairing> = new Map(); // key = id
  private codeIndex: Map<string, string> = new Map(); // key = pairingCode, value = id
  private tokenIndex: Map<string, string> = new Map(); // key = deviceToken, value = id

  constructor() {
    // Nettoyage périodique des codes expirés toutes les 2 minutes
    const cleanupTimer = setInterval(() => {
      this.cleanupExpiredCodes();
    }, 120000);
    if (cleanupTimer.unref) {
      cleanupTimer.unref();
    }
  }

  /**
   * Génère un code alphanumérique unique de 6 caractères
   */
  private generateRandomCode(): string {
    let code = "";
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    }
    return code;
  }

  /**
   * Génère une demande d'appairage avec code à 6 caractères (TTL 5 minutes)
   */
  public async createPairingCode(userId: string): Promise<{
    pairingCode: string;
    expiresAt: Date;
    expiresInSeconds: number;
    userId: string;
  }> {
    const cleanUserId = String(userId || "").trim();
    if (!cleanUserId) {
      throw new Error("L'identifiant utilisateur ou invité est requis.");
    }

    // Révoquer les anciens codes pending pour cet utilisateur pour éviter les doublons
    for (const [id, item] of this.inMemoryPairings.entries()) {
      if (item.userId === cleanUserId && item.status === "pending") {
        item.status = "expired";
        if (item.pairingCode) {
          this.codeIndex.delete(item.pairingCode);
        }
      }
    }

    // Trouver un code unique non utilisé
    let pairingCode = this.generateRandomCode();
    let attempts = 0;
    while (this.codeIndex.has(pairingCode) && attempts < 10) {
      pairingCode = this.generateRandomCode();
      attempts++;
    }

    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const record: StoredPairing = {
      id,
      pairingCode,
      userId: cleanUserId,
      deviceId: null,
      deviceToken: null,
      status: "pending",
      expiresAt,
      pairedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.inMemoryPairings.set(id, record);
    this.codeIndex.set(pairingCode, id);

    try {
      await Pairings.create(record as any);
    } catch (err) {
      // Tolérance offline DB
      console.warn("[PairingService] DB create pairing fallback:", err);
    }

    return {
      pairingCode,
      expiresAt,
      expiresInSeconds: 300,
      userId: cleanUserId,
    };
  }

  /**
   * Valide le code 6 caractères saisi sur la montre Garmin et enregistre le deviceId et génère le deviceToken
   */
  public async pairDevice(
    pairingCode: string,
    deviceId: string
  ): Promise<{
    success: boolean;
    deviceToken?: string;
    userId?: string;
    login?: string;
    userName?: string;
    playerName?: string;
    deviceId?: string;
    isLinkCode?: boolean;
    mode?: string;
    message?: string;
  }> {
    const cleanCode = String(pairingCode || "").trim().toUpperCase();
    const cleanDeviceId = String(deviceId || "").trim();

    if (!cleanCode || (cleanCode.length !== 5 && cleanCode.length !== 6)) {
      return { success: false, message: "Code d'appairage invalide (5 ou 6 caractères requis)." };
    }
    if (!cleanDeviceId) {
      return { success: false, message: "Identifiant matériel de la montre (deviceId) requis." };
    }

    let id = this.codeIndex.get(cleanCode);
    let record: StoredPairing | null = null;

    if (id) {
      record = this.inMemoryPairings.get(id) || null;
    }

    if (!record) {
      try {
        const dbRec = await Pairings.findOne({ where: { pairingCode: cleanCode } });
        if (dbRec) {
          record = dbRec.toJSON() as StoredPairing;
          this.inMemoryPairings.set(record.id, record);
          id = record.id;
        }
      } catch (err) {
        console.warn("[PairingService] DB find pairing error:", err);
      }
    }

    if (!record) {
      return { success: false, message: "Code d'appairage introuvable ou déjà utilisé." };
    }

    if (record.status !== "pending") {
      return { success: false, message: `Cet appairage est déjà ${record.status}.` };
    }

    if (new Date(record.expiresAt).getTime() < Date.now()) {
      record.status = "expired";
      this.codeIndex.delete(cleanCode);
      return { success: false, message: "Le code d'appairage a expiré (validité 5 min)." };
    }

    // Génération du deviceToken cryptographique persistant UUID v4
    const deviceToken = crypto.randomUUID();
    const now = new Date();

    // Canonicalisation de l'utilisateur si un compte existe (ex: usr_... -> login)
    const matchedUser = await userStore.findUser(record.userId);
    const canonicalUserId = matchedUser ? (matchedUser.login || matchedUser.id) : record.userId;
    const canonicalUserName = matchedUser ? (matchedUser.login || matchedUser.name) : record.userId;

    // Mise à jour de l'appairage : destruction du code éphémère et sauvegarde
    record.userId = canonicalUserId;
    record.deviceId = cleanDeviceId;
    record.deviceToken = deviceToken;
    record.status = "paired";
    record.pairedAt = now;
    record.updatedAt = now;
    record.pairingCode = null; // Destruction du code éphémère

    this.codeIndex.delete(cleanCode);
    this.tokenIndex.set(deviceToken, record.id);
    this.inMemoryPairings.set(record.id, record);

    try {
      await Pairings.update(
        {
          userId: canonicalUserId,
          deviceId: cleanDeviceId,
          deviceToken,
          status: "paired",
          pairedAt: now,
          pairingCode: null,
        } as any,
        { where: { id: record.id } }
      );
    } catch (err) {
      console.warn("[PairingService] DB update pairing error:", err);
    }

    // Migrer tout kayak déjà présent dans la course publique pour cette montre vers le compte / userId appairé
    await this.migratePublicRaceParticipant({
      deviceId: cleanDeviceId,
      deviceToken,
      newUserId: canonicalUserId,
      newUserName: canonicalUserName,
    });

    // Diffusion temps réel via WebSocket pour notifier le front web instantanément
    try {
      socketGateway.broadcast("garmin:paired", {
        userId: canonicalUserId,
        userName: canonicalUserName,
        deviceId: cleanDeviceId,
        deviceToken,
      });
    } catch (wsErr) {
      console.warn("[PairingService] Socket broadcast garmin:paired warning:", wsErr);
    }

    return {
      success: true,
      deviceToken,
      userId: canonicalUserId,
      login: canonicalUserId,
      userName: canonicalUserName,
      playerName: canonicalUserName,
      deviceId: cleanDeviceId,
      isLinkCode: true,
      mode: "paired",
      message: `Bienvenue ${canonicalUserName} !`,
    };
  }

  /**
   * Vérifie de manière synchrone et rapide si un participant est appairé
   * (montre liée par token/PIN, ou utilisateur enregistré/abonné ayant un compte).
   */
  public isParticipantPaired(params: {
    userId?: string;
    deviceToken?: string;
    deviceId?: string;
  }): boolean {
    const rawUserId = String(params.userId || "").trim();
    const cleanUserId = rawUserId.toLowerCase();
    const rawToken = String(params.deviceToken || "").trim();
    const rawDeviceId = String(params.deviceId || "").trim();

    if (rawToken) {
      const pairingId = this.tokenIndex.get(rawToken);
      if (pairingId) {
        const pairing = this.inMemoryPairings.get(pairingId);
        if (pairing && pairing.status === "paired") return true;
      }
    }

    if (rawDeviceId && rawDeviceId !== "GARMIN_DEVICE" && rawDeviceId !== "GARMIN_GUEST") {
      for (const p of this.inMemoryPairings.values()) {
        if (p.deviceId === rawDeviceId && p.status === "paired") return true;
      }
    }

    if (rawUserId && rawUserId !== "anonymous" && !cleanUserId.startsWith("bot_")) {
      for (const p of this.inMemoryPairings.values()) {
        if (
          p.status === "paired" &&
          (p.userId?.toLowerCase() === cleanUserId || p.deviceId?.toLowerCase() === cleanUserId)
        ) {
          return true;
        }
      }
      const user = userStore.findUserSync(rawUserId);
      if (user) {
        return true;
      }
    }

    return false;
  }

  /**
   * Vérifie le statut d'appairage pour un utilisateur ou une session
   */
  public async getPairingStatus(filter: {
    userId?: string;
    pairingCode?: string;
    deviceToken?: string;
  }): Promise<{
    success: boolean;
    paired: boolean;
    status: string;
    userId?: string;
    deviceId?: string;
    deviceToken?: string;
  }> {
    const { userId, pairingCode, deviceToken } = filter;

    if (deviceToken) {
      const pairing = await this.validateDeviceToken(deviceToken);
      if (pairing.valid && pairing.pairing) {
        const matchedUser = await userStore.findUser(pairing.pairing.userId);
        const canonicalUserId = matchedUser ? (matchedUser.login || matchedUser.id) : pairing.pairing.userId;
        return {
          success: true,
          paired: true,
          status: "paired",
          userId: canonicalUserId,
          deviceId: pairing.pairing.deviceId || undefined,
          deviceToken: pairing.pairing.deviceToken || undefined,
        };
      }
    }

    if (userId) {
      const cleanUserId = String(userId).trim();
      const matchedUser = await userStore.findUser(cleanUserId);
      const candidateIds = Array.from(
        new Set(
          [
            cleanUserId,
            matchedUser?.id,
            matchedUser?.login,
            matchedUser?.watchUserId,
          ].filter((v): v is string => Boolean(v && String(v).trim()))
        )
      );
      const canonicalUserId = matchedUser ? (matchedUser.login || matchedUser.id) : cleanUserId;

      // Chercher en mémoire d'abord parmi tous les identifiants liés au compte
      for (const item of this.inMemoryPairings.values()) {
        if (item.status === "paired" && candidateIds.some((cid) => cid.toLowerCase() === String(item.userId).toLowerCase())) {
          if (item.userId !== canonicalUserId) {
            item.userId = canonicalUserId;
          }
          return {
            success: true,
            paired: true,
            status: "paired",
            userId: canonicalUserId,
            deviceId: item.deviceId || undefined,
            deviceToken: item.deviceToken || undefined,
          };
        }
      }

      try {
        const dbRec = await Pairings.findOne({
          where: { userId: { [Op.in]: candidateIds }, status: "paired" },
          order: [["updatedAt", "DESC"]],
        });
        if (dbRec) {
          const plain = dbRec.toJSON() as StoredPairing;
          plain.userId = canonicalUserId;
          this.inMemoryPairings.set(plain.id, plain);
          if (plain.deviceToken) this.tokenIndex.set(plain.deviceToken, plain.id);
          return {
            success: true,
            paired: true,
            status: "paired",
            userId: canonicalUserId,
            deviceId: plain.deviceId || undefined,
            deviceToken: plain.deviceToken || undefined,
          };
        }
      } catch (err) {
        console.warn("[PairingService] DB getPairingStatus by userId error:", err);
      }
    }

    if (pairingCode) {
      const cleanCode = String(pairingCode).trim().toUpperCase();
      const id = this.codeIndex.get(cleanCode);
      if (id) {
        const item = this.inMemoryPairings.get(id);
        if (item) {
          return {
            success: true,
            paired: item.status === "paired",
            status: item.status,
            userId: item.userId,
            deviceId: item.deviceId || undefined,
            deviceToken: item.deviceToken || undefined,
          };
        }
      }
    }

    return {
      success: true,
      paired: false,
      status: "unpaired",
    };
  }

  /**
   * Valide un deviceToken (utilisé par le middleware /boost et les métriques)
   */
  public async validateDeviceToken(token: string): Promise<{
    valid: boolean;
    pairing?: StoredPairing;
  }> {
    const cleanToken = String(token || "").trim();
    if (!cleanToken) return { valid: false };

    let id = this.tokenIndex.get(cleanToken);
    let record: StoredPairing | null = null;

    if (id) {
      record = this.inMemoryPairings.get(id) || null;
    }

    if (!record) {
      try {
        const dbRec = await Pairings.findOne({
          where: { deviceToken: cleanToken, status: "paired" },
        });
        if (dbRec) {
          record = dbRec.toJSON() as StoredPairing;
          this.inMemoryPairings.set(record.id, record);
          this.tokenIndex.set(cleanToken, record.id);
        }
      } catch (err) {
        console.warn("[PairingService] DB validateDeviceToken error:", err);
      }
    }

    if (record && record.status === "paired") {
      return { valid: true, pairing: record };
    }

    return { valid: false };
  }

  /**
   * Associe directement une montre Garmin (deviceId) à un utilisateur ou invité (Parcours 2 Ticket Invité Salon)
   * Génère un deviceToken persistant UUID v4 et le stocke
   */
  public async pairGuestDirect(
    userId: string,
    deviceId: string,
    extraPayload?: Record<string, any>
  ): Promise<{
    success: boolean;
    deviceToken: string;
    userId: string;
    deviceId: string;
  }> {
    const cleanUserId = String(userId || "").trim() || `guest_${crypto.randomBytes(4).toString("hex")}`;
    const cleanDeviceId = String(deviceId || "GARMIN_GUEST").trim();
    const deviceToken = crypto.randomUUID();
    const now = new Date();
    const id = crypto.randomUUID();

    const record: StoredPairing = {
      id,
      pairingCode: null,
      userId: cleanUserId,
      deviceId: cleanDeviceId,
      deviceToken,
      status: "paired",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      pairedAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.inMemoryPairings.set(id, record);
    this.tokenIndex.set(deviceToken, id);

    try {
      await Pairings.create(record as any);
    } catch (err) {
      console.warn("[PairingService] DB pairGuestDirect fallback:", err);
    }

    try {
      socketGateway.broadcast("garmin:paired", {
        userId: cleanUserId,
        deviceId: cleanDeviceId,
        deviceToken,
        ...(extraPayload || {}),
      });
    } catch (wsErr) {
      console.warn("[PairingService] Socket broadcast garmin:paired warning:", wsErr);
    }

    return {
      success: true,
      deviceToken,
      userId: cleanUserId,
      deviceId: cleanDeviceId,
    };
  }

  /**
   * Révoque un token d'appairage depuis le web ou la montre
   */
  public async revokePairing(identifier: {
    deviceToken?: string;
    userId?: string;
  }): Promise<{ success: boolean; message: string }> {
    const { deviceToken, userId } = identifier;
    let targetId: string | null = null;

    if (deviceToken) {
      targetId = this.tokenIndex.get(deviceToken) || null;
    }

    const now = new Date();

    if (targetId) {
      const rec = this.inMemoryPairings.get(targetId);
      if (rec) {
        rec.status = "revoked";
        rec.revokedAt = now;
        if (rec.deviceToken) this.tokenIndex.delete(rec.deviceToken);
      }
      try {
        await Pairings.update({ status: "revoked", revokedAt: now } as any, {
          where: { id: targetId },
        });
      } catch (err) {
        console.warn("[PairingService] DB revokePairing error:", err);
      }
      try {
        const pubRace = raceManager.getCurrentPublicRace();
        if (pubRace && pubRace.participants) {
          for (const p of pubRace.participants.values()) {
            if ((deviceToken && p.deviceToken === deviceToken) || (rec?.userId && p.userId === rec.userId)) {
              p.isPaired = false;
              p.deviceToken = undefined;
            }
          }
        }
      } catch {}
      return { success: true, message: "Appairage révoqué avec succès." };
    }

    if (userId) {
      const cleanUserId = String(userId).trim();
      for (const item of this.inMemoryPairings.values()) {
        if (item.userId === cleanUserId && item.status === "paired") {
          item.status = "revoked";
          item.revokedAt = now;
          if (item.deviceToken) this.tokenIndex.delete(item.deviceToken);
        }
      }
      try {
        await Pairings.update(
          { status: "revoked", revokedAt: now } as any,
          { where: { userId: cleanUserId, status: "paired" } }
        );
      } catch (err) {
        console.warn("[PairingService] DB revokePairing by userId error:", err);
      }
      try {
        const pubRace = raceManager.getCurrentPublicRace();
        if (pubRace && pubRace.participants) {
          for (const p of pubRace.participants.values()) {
            if (p.userId === cleanUserId) {
              p.isPaired = false;
              p.deviceToken = undefined;
            }
          }
        }
      } catch {}
      return { success: true, message: "Appairage révoqué avec succès pour l'utilisateur." };
    }

    return { success: false, message: "Identifiant ou jeton manquant pour la révocation." };
  }

  /**
   * Enregistre un code personnalisé (ex: code 5 caractères universel) pour un userId
   */
  public createCustomPairingCode(code: string, userId: string, expiresAt: Date): StoredPairing {
    const cleanUserId = String(userId || "").trim();
    const cleanCode = String(code || "").trim().toUpperCase();

    // Révoquer les anciens codes pending
    for (const [id, item] of this.inMemoryPairings.entries()) {
      if (item.userId === cleanUserId && item.status === "pending") {
        item.status = "expired";
        if (item.pairingCode) {
          this.codeIndex.delete(item.pairingCode);
        }
      }
    }

    const id = crypto.randomUUID();
    const record: StoredPairing = {
      id,
      pairingCode: cleanCode,
      userId: cleanUserId,
      deviceId: null,
      deviceToken: null,
      status: "pending",
      expiresAt,
      pairedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.inMemoryPairings.set(id, record);
    this.codeIndex.set(cleanCode, id);

    Pairings.create(record as any).catch((err) => {
      console.warn("[PairingService] DB createCustomPairingCode fallback:", err);
    });

    return record;
  }

  /**
   * Marque un code personnalisé (ex: code universel 5 caractères) comme appairé avec le deviceToken attribué
   * afin que le polling GET /api/garmin/pairing-status?pairingCode=... détecte immédiatement l'association.
   */
  public markCustomCodePaired(
    code: string,
    details: { userId: string; deviceId: string; deviceToken: string }
  ): void {
    const cleanCode = String(code || "").trim().toUpperCase();
    if (!cleanCode) return;

    const now = new Date();
    const existingId = this.codeIndex.get(cleanCode);
    let record = existingId ? this.inMemoryPairings.get(existingId) : undefined;

    if (record) {
      record.status = "paired";
      record.userId = details.userId;
      record.deviceId = details.deviceId;
      record.deviceToken = details.deviceToken;
      record.pairedAt = now;
      record.updatedAt = now;
      this.inMemoryPairings.set(record.id, record);
      this.codeIndex.set(cleanCode, record.id);
      this.tokenIndex.set(details.deviceToken, record.id);
      Pairings.update(
        {
          userId: details.userId,
          deviceId: details.deviceId,
          deviceToken: details.deviceToken,
          status: "paired",
          pairedAt: now,
        } as any,
        { where: { id: record.id } }
      ).catch(() => {});
      return;
    }

    const id = crypto.randomUUID();
    const newRecord: StoredPairing = {
      id,
      pairingCode: cleanCode,
      userId: details.userId,
      deviceId: details.deviceId,
      deviceToken: details.deviceToken,
      status: "paired",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      pairedAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.inMemoryPairings.set(id, newRecord);
    this.codeIndex.set(cleanCode, id);
    this.tokenIndex.set(details.deviceToken, id);
  }

  /**
   * Lie immédiatement une montre avec son deviceId à un compte utilisateur et génère le deviceToken
   */
  public async pairDeviceDirectly(
    userId: string,
    deviceId: string
  ): Promise<{
    success: boolean;
    deviceToken: string;
    userId: string;
    login?: string;
    userName?: string;
    playerName?: string;
    deviceId: string;
    isLinkCode?: boolean;
    mode?: string;
    message?: string;
  }> {
    const cleanUserId = String(userId || "").trim();
    const cleanDeviceId = String(deviceId || "").trim();
    const now = new Date();

    const matchedUser = await userStore.findUser(cleanUserId);
    const canonicalUserId = matchedUser ? (matchedUser.login || matchedUser.id) : cleanUserId;
    const canonicalUserName = matchedUser ? (matchedUser.login || matchedUser.name) : cleanUserId;
    const candidateIds = new Set(
      [cleanUserId, canonicalUserId, matchedUser?.id, matchedUser?.login].filter(Boolean)
    );

    // Révoquer les anciens appairages de l'utilisateur pour maintenir 1 montre active par compte
    for (const item of this.inMemoryPairings.values()) {
      if (candidateIds.has(item.userId) && item.status === "paired") {
        item.status = "revoked";
        item.revokedAt = now;
        if (item.deviceToken) this.tokenIndex.delete(item.deviceToken);
      }
    }

    const deviceToken = crypto.randomUUID();
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 an

    const record: StoredPairing = {
      id,
      pairingCode: null,
      userId: canonicalUserId,
      deviceId: cleanDeviceId,
      deviceToken,
      status: "paired",
      expiresAt,
      pairedAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.inMemoryPairings.set(id, record);
    this.tokenIndex.set(deviceToken, id);

    try {
      await Pairings.create(record as any);
    } catch (err) {
      console.warn("[PairingService] DB pairDeviceDirectly fallback:", err);
    }

    await this.migratePublicRaceParticipant({
      deviceId: cleanDeviceId,
      deviceToken,
      newUserId: canonicalUserId,
      newUserName: canonicalUserName,
    });

    try {
      socketGateway.broadcast("garmin:paired", {
        userId: canonicalUserId,
        userName: canonicalUserName,
        deviceId: cleanDeviceId,
        deviceToken,
      });
    } catch (wsErr) {
      console.warn("[PairingService] Socket broadcast garmin:paired warning:", wsErr);
    }

    return {
      success: true,
      deviceToken,
      userId: canonicalUserId,
      login: canonicalUserId,
      userName: canonicalUserName,
      playerName: canonicalUserName,
      deviceId: cleanDeviceId,
      isLinkCode: true,
      mode: "paired",
      message: `Bienvenue ${canonicalUserName} !`,
    };
  }

  /**
   * Transfère un appairage (ou token) invité vers un compte nouvellement créé ou connecté
   */
  public async transferPairingTokenToUser(guestPairingTokenOrUserId: string, newUserId: string): Promise<boolean> {
    const cleanFrom = String(guestPairingTokenOrUserId || "").trim();
    const cleanTo = String(newUserId || "").trim();
    if (!cleanFrom || !cleanTo) return false;

    const matchedUser = await userStore.findUser(cleanTo);
    const canonicalTo = matchedUser ? (matchedUser.login || matchedUser.id) : cleanTo;
    const canonicalName = matchedUser ? (matchedUser.login || matchedUser.name) : canonicalTo;

    let targetRecord: StoredPairing | null = null;

    // Recherche par deviceToken
    const idByToken = this.tokenIndex.get(cleanFrom);
    if (idByToken) {
      targetRecord = this.inMemoryPairings.get(idByToken) || null;
    }

    // Recherche par userId/guest_id
    if (!targetRecord) {
      for (const rec of this.inMemoryPairings.values()) {
        if ((rec.userId === cleanFrom || rec.deviceToken === cleanFrom) && rec.status === "paired") {
          targetRecord = rec;
          break;
        }
      }
    }

    if (!targetRecord) {
      try {
        const dbRec = await Pairings.findOne({
          where: {
            status: "paired",
            [Op.or]: [{ userId: cleanFrom }, { deviceToken: cleanFrom }],
          },
        });
        if (dbRec) {
          targetRecord = dbRec.toJSON() as StoredPairing;
          if (targetRecord.deviceToken) {
            this.tokenIndex.set(targetRecord.deviceToken, targetRecord.id);
          }
        }
      } catch {}
    }

    if (targetRecord && targetRecord.status === "paired") {
      const previousUserId = targetRecord.userId;
      targetRecord.userId = canonicalTo;
      targetRecord.updatedAt = new Date();
      this.inMemoryPairings.set(targetRecord.id, targetRecord);

      try {
        await Pairings.update({ userId: canonicalTo, updatedAt: new Date() } as any, {
          where: { id: targetRecord.id },
        });
      } catch (err) {
        console.warn("[PairingService] DB transfer error:", err);
      }

      await this.migratePublicRaceParticipant({
        oldUserId: previousUserId,
        deviceId: targetRecord.deviceId || undefined,
        deviceToken: targetRecord.deviceToken || undefined,
        newUserId: canonicalTo,
        newUserName: canonicalName,
      });

      try {
        socketGateway.broadcast("garmin:paired", {
          userId: canonicalTo,
          userName: canonicalName,
          deviceId: targetRecord.deviceId,
          deviceToken: targetRecord.deviceToken,
        });
      } catch {}

      return true;
    }

    // Même sans record d'appairage trouvé, si cleanFrom était un identifiant de session présent dans la course publique, le migrer
    await this.migratePublicRaceParticipant({
      oldUserId: cleanFrom,
      newUserId: canonicalTo,
      newUserName: canonicalName,
    });

    return false;
  }

  /**
   * Recherche un appairage actif par l'identifiant matériel de la montre (deviceId)
   */
  public async findPairingByDeviceId(deviceId: string): Promise<StoredPairing | null> {
    const cleanDeviceId = String(deviceId || "").trim();
    if (
      !cleanDeviceId ||
      cleanDeviceId === "GARMIN_DEVICE" ||
      cleanDeviceId === "GARMIN_GUEST" ||
      cleanDeviceId === "UNKNOWN"
    ) {
      return null;
    }

    let latestRecord: StoredPairing | null = null;
    for (const item of this.inMemoryPairings.values()) {
      if (item.status === "paired" && item.deviceId === cleanDeviceId) {
        if (
          !latestRecord ||
          new Date(item.updatedAt || 0).getTime() >= new Date(latestRecord.updatedAt || 0).getTime()
        ) {
          latestRecord = item;
        }
      }
    }

    if (latestRecord) {
      return latestRecord;
    }

    try {
      const dbRec = await Pairings.findOne({
        where: { deviceId: cleanDeviceId, status: "paired" },
        order: [["updatedAt", "DESC"]],
      });
      if (dbRec) {
        const plain = dbRec.toJSON() as StoredPairing;
        this.inMemoryPairings.set(plain.id, plain);
        if (plain.deviceToken) this.tokenIndex.set(plain.deviceToken, plain.id);
        return plain;
      }
    } catch (err) {
      console.warn("[PairingService] DB findPairingByDeviceId error:", err);
    }

    return null;
  }

  /**
   * Résout automatiquement l'identité canonique d'un joueur à partir de son deviceToken, deviceId ou userId
   * Fait automatiquement le lien entre la montre appairée et le compte utilisateur.
   */
  public async resolvePairedIdentity(params: {
    userId?: string;
    userName?: string;
    deviceToken?: string;
    deviceId?: string;
  }): Promise<{
    userId: string;
    userName: string;
    isPaired: boolean;
    deviceToken?: string;
    deviceId?: string;
    previousUserId?: string;
  }> {
    const rawUserId = String(params.userId || "").trim();
    const rawUserName = String(params.userName || "").trim();
    const rawToken = String(params.deviceToken || "").trim();
    const rawDeviceId = String(params.deviceId || "").trim();

    let pairing: StoredPairing | null = null;
    if (rawToken) {
      const check = await this.validateDeviceToken(rawToken);
      if (check.valid && check.pairing) {
        pairing = check.pairing;
      }
    }
    if (!pairing && rawDeviceId) {
      pairing = await this.findPairingByDeviceId(rawDeviceId);
    }

    const pairedUserId = pairing?.userId ? String(pairing.userId).trim() : "";

    // Rechercher le compte utilisateur via le userId de l'appairage, ou via le userId fourni
    let user = pairedUserId ? await userStore.findUser(pairedUserId) : undefined;
    if (!user && rawUserId && rawUserId !== "anonymous") {
      user = await userStore.findUser(rawUserId);
    }

    let canonicalUserId = rawUserId || "anonymous";
    let canonicalUserName = rawUserName;

    if (user) {
      canonicalUserId = user.login || user.id;
      canonicalUserName = user.login || user.name || rawUserName || canonicalUserId;

      // Synchroniser l'identifiant d'appairage avec le login canonique du compte
      if (pairing && pairing.userId !== canonicalUserId) {
        pairing.userId = canonicalUserId;
        this.inMemoryPairings.set(pairing.id, pairing);
        Pairings.update({ userId: canonicalUserId } as any, { where: { id: pairing.id } }).catch(() => {});
      }

      // Lier automatiquement watchUserId sur le compte si la montre envoyait un ID local différent
      if (
        rawUserId &&
        rawUserId !== "anonymous" &&
        rawUserId !== "Rameur_42" &&
        rawUserId !== canonicalUserId &&
        rawUserId !== user.id &&
        user.watchUserId !== rawUserId
      ) {
        userStore.updateUser(user.id, { watchUserId: rawUserId }).catch(() => {});
      }
    } else if (pairedUserId) {
      canonicalUserId = pairedUserId;
      if (
        rawUserName &&
        rawUserName !== "Rameur_42" &&
        rawUserName !== "anonymous" &&
        rawUserName !== rawUserId
      ) {
        canonicalUserName = rawUserName;
      } else if (
        pairedUserId.startsWith("usr_") ||
        pairedUserId.startsWith("guest_")
      ) {
        canonicalUserName = `Racer_${pairedUserId.slice(-4)}`;
      } else {
        canonicalUserName = pairedUserId;
      }
    } else {
      canonicalUserId = rawUserId || "anonymous";
      if (!canonicalUserName) {
        canonicalUserName =
          canonicalUserId !== "anonymous"
            ? canonicalUserId.startsWith("usr_") || canonicalUserId.startsWith("guest_")
              ? `Racer_${canonicalUserId.slice(-4)}`
              : canonicalUserId
            : "Rameur";
      }
    }

    const previousUserId =
      rawUserId && rawUserId !== "anonymous" && rawUserId !== canonicalUserId
        ? rawUserId
        : undefined;

    if (previousUserId || pairing) {
      await this.migratePublicRaceParticipant({
        oldUserId: previousUserId,
        deviceId: pairing?.deviceId || rawDeviceId || undefined,
        deviceToken: pairing?.deviceToken || rawToken || undefined,
        newUserId: canonicalUserId,
        newUserName: canonicalUserName,
      });
    }

    return {
      userId: canonicalUserId,
      userName: canonicalUserName,
      isPaired: Boolean(pairing || user?.watchUserId || user),
      deviceToken: pairing?.deviceToken || rawToken || undefined,
      deviceId: pairing?.deviceId || rawDeviceId || undefined,
      previousUserId,
    };
  }

  /**
   * Migre un kayak déjà présent dans la course publique en cours (sous un ancien userId ou deviceId)
   * vers l'identifiant canonique lié à l'appairage ou au compte utilisateur.
   */
  public async migratePublicRaceParticipant(options: {
    oldUserId?: string;
    deviceId?: string;
    deviceToken?: string;
    newUserId: string;
    newUserName?: string;
  }): Promise<void> {
    try {
      const publicRace = raceManager.getCurrentPublicRace();
      if (!publicRace) return;

      const cleanNewId = String(options.newUserId || "").trim();
      if (!cleanNewId || cleanNewId === "anonymous") return;

      const cleanOldId = options.oldUserId ? String(options.oldUserId).trim() : "";
      const cleanDevId = options.deviceId ? String(options.deviceId).trim() : "";
      const cleanToken = options.deviceToken ? String(options.deviceToken).trim() : "";

      const staleUserIds = new Set<string>();
      if (cleanOldId && cleanOldId !== cleanNewId) {
        staleUserIds.add(cleanOldId);
      }

      if (publicRace.participants) {
        for (const [uid, p] of publicRace.participants.entries()) {
          if (uid === cleanNewId) continue;
          const sameDevice =
            cleanDevId &&
            cleanDevId !== "GARMIN_DEVICE" &&
            cleanDevId !== "GARMIN_GUEST" &&
            p.deviceId === cleanDevId;
          const sameToken = cleanToken && p.deviceToken === cleanToken;
          if (sameDevice || sameToken) {
            staleUserIds.add(uid);
          }
        }
      }

      if (staleUserIds.size === 0) return;

      let migratedEntry: any = publicRace.participants?.get(cleanNewId);
      for (const staleId of staleUserIds) {
        const oldP = publicRace.participants?.get(staleId);
        if (oldP && publicRace.participants) {
          if (!migratedEntry) {
            migratedEntry = {
              ...oldP,
              userId: cleanNewId,
              userName: options.newUserName || oldP.userName || cleanNewId,
              deviceId: cleanDevId || oldP.deviceId,
              deviceToken: cleanToken || oldP.deviceToken,
              isPaired: true,
            };
          }
          publicRace.participants.delete(staleId);
        }

        // Migrer ou supprimer l'entrée correspondante dans Activities
        try {
          const oldCompId = `${publicRace.id}_${staleId}`;
          const newCompId = `${publicRace.id}_${cleanNewId}`;
          const oldAct = await Activities.findByPk(oldCompId);
          const newAct = await Activities.findByPk(newCompId);
          if (oldAct && !newAct) {
            const plain = oldAct.toJSON() as any;
            await oldAct.destroy();
            await Activities.create({
              ...plain,
              id: newCompId,
              userId: cleanNewId,
              userName: options.newUserName || plain.userName || cleanNewId,
            });
          } else if (oldAct && newAct) {
            await oldAct.destroy();
          }
        } catch {}
      }

      if (migratedEntry && publicRace.participants) {
        migratedEntry.isPaired = true;
        publicRace.participants.set(cleanNewId, migratedEntry);
      }

      // Diffuser la mise à jour du classement en direct aux clients web
      try {
        const rows = await Activities.findAll({
          where: { activityId: publicRace.id, status: { [Op.ne]: "abandoned" } },
        });
        if (rows.length > 0) {
          const sorted = RaceManager.sortRanking(rows as any);
          socketGateway.broadcastLeaderboard(
            publicRace.id,
            RaceManager.toLiveMetrics(sorted, publicRace)
          );
        }
      } catch {}
    } catch (err) {
      console.warn("[PairingService] migratePublicRaceParticipant warning:", err);
    }
  }

  /**
   * Nettoie les codes d'appairage expirés
   */
  public cleanupExpiredCodes(): void {
    const now = Date.now();
    for (const [id, item] of this.inMemoryPairings.entries()) {
      if (item.status === "pending" && new Date(item.expiresAt).getTime() < now) {
        item.status = "expired";
        if (item.pairingCode) {
          this.codeIndex.delete(item.pairingCode);
        }
      }
    }
  }
}

export const pairingService = new PairingService();
export default pairingService;
