import crypto from "crypto";
import db from "../models";
import { PairingAttributes } from "../models/pairing.model";
import socketGateway from "../websocket/socket.gateway";

const Pairings = db.pairings;

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
    deviceId?: string;
    message?: string;
  }> {
    const cleanCode = String(pairingCode || "").trim().toUpperCase();
    const cleanDeviceId = String(deviceId || "").trim();

    if (!cleanCode || cleanCode.length !== 6) {
      return { success: false, message: "Code d'appairage invalide (6 caractères requis)." };
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

    // Mise à jour de l'appairage : destruction du code éphémère et sauvegarde
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

    // Diffusion temps réel via WebSocket pour notifier le front web instantanément
    try {
      socketGateway.broadcast("garmin:paired", {
        userId: record.userId,
        deviceId: cleanDeviceId,
        deviceToken,
      });
    } catch (wsErr) {
      console.warn("[PairingService] Socket broadcast garmin:paired warning:", wsErr);
    }

    return {
      success: true,
      deviceToken,
      userId: record.userId,
      deviceId: cleanDeviceId,
    };
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
        return {
          success: true,
          paired: true,
          status: "paired",
          userId: pairing.pairing.userId,
          deviceId: pairing.pairing.deviceId || undefined,
          deviceToken: pairing.pairing.deviceToken || undefined,
        };
      }
    }

    if (userId) {
      const cleanUserId = String(userId).trim();
      // Chercher en mémoire d'abord
      for (const item of this.inMemoryPairings.values()) {
        if (item.userId === cleanUserId && item.status === "paired") {
          return {
            success: true,
            paired: true,
            status: "paired",
            userId: item.userId,
            deviceId: item.deviceId || undefined,
            deviceToken: item.deviceToken || undefined,
          };
        }
      }

      try {
        const dbRec = await Pairings.findOne({
          where: { userId: cleanUserId, status: "paired" },
          order: [["updatedAt", "DESC"]],
        });
        if (dbRec) {
          const plain = dbRec.toJSON() as StoredPairing;
          this.inMemoryPairings.set(plain.id, plain);
          if (plain.deviceToken) this.tokenIndex.set(plain.deviceToken, plain.id);
          return {
            success: true,
            paired: true,
            status: "paired",
            userId: plain.userId,
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
   * Lie immédiatement une montre avec son deviceId à un compte utilisateur et génère le deviceToken
   */
  public async pairDeviceDirectly(
    userId: string,
    deviceId: string
  ): Promise<{
    success: boolean;
    deviceToken: string;
    userId: string;
    deviceId: string;
  }> {
    const cleanUserId = String(userId || "").trim();
    const cleanDeviceId = String(deviceId || "").trim();
    const now = new Date();

    // Révoquer les anciens appairages de l'utilisateur pour maintenir 1 montre active par compte
    for (const item of this.inMemoryPairings.values()) {
      if (item.userId === cleanUserId && item.status === "paired") {
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
      userId: cleanUserId,
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

    try {
      socketGateway.broadcast("garmin:paired", {
        userId: cleanUserId,
        deviceId: cleanDeviceId,
        deviceToken,
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
   * Transfère un appairage (ou token) invité vers un compte nouvellement créé
   */
  public async transferPairingTokenToUser(guestPairingTokenOrUserId: string, newUserId: string): Promise<boolean> {
    const cleanFrom = String(guestPairingTokenOrUserId || "").trim();
    const cleanTo = String(newUserId || "").trim();
    if (!cleanFrom || !cleanTo) return false;

    let targetRecord: StoredPairing | null = null;

    // Recherche par deviceToken
    const idByToken = this.tokenIndex.get(cleanFrom);
    if (idByToken) {
      targetRecord = this.inMemoryPairings.get(idByToken) || null;
    }

    // Recherche par userId/guest_id
    if (!targetRecord) {
      for (const rec of this.inMemoryPairings.values()) {
        if (rec.userId === cleanFrom && rec.status === "paired") {
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
            userId: cleanFrom,
          },
        });
        if (dbRec) {
          targetRecord = dbRec.toJSON() as StoredPairing;
        }
      } catch {}
    }

    if (targetRecord && targetRecord.status === "paired") {
      targetRecord.userId = cleanTo;
      targetRecord.updatedAt = new Date();
      this.inMemoryPairings.set(targetRecord.id, targetRecord);

      try {
        await Pairings.update({ userId: cleanTo, updatedAt: new Date() } as any, {
          where: { id: targetRecord.id },
        });
      } catch (err) {
        console.warn("[PairingService] DB transfer error:", err);
      }

      try {
        socketGateway.broadcast("garmin:paired", {
          userId: cleanTo,
          deviceId: targetRecord.deviceId,
          deviceToken: targetRecord.deviceToken,
        });
      } catch {}

      return true;
    }

    return false;
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
