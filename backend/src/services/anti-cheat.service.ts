import crypto from "crypto";
import { Request } from "express";
import { RaceManager } from "./race-manager.service";

export interface BlockedAttemptLog {
  timestamp: Date;
  ip: string;
  path: string;
  deviceId?: string;
  reason: string;
}

export interface AntiCheatStatus {
  antiCheatEnabled: boolean;
  loadTestModeEnabled: boolean;
  loadTestExpiresAt: string | null;
  loadTestRemainingMinutes: number;
  loadTestKey: string | null;
  blockedAttemptsCount: number;
  recentBlocked: BlockedAttemptLog[];
}

export class AntiCheatService {
  private static instance: AntiCheatService;

  // Par défaut, actif en production, désactivable en test/dev si souhaité
  private antiCheatEnabled: boolean = process.env.NODE_ENV === "production" || process.env.ANTI_CHEAT_DEFAULT === "true";
  private loadTestModeEnabled: boolean = false;
  private loadTestExpiresAt: Date | null = null;
  private loadTestKey: string | null = null;

  private blockedAttemptsCount: number = 0;
  private blockedAttemptsLog: BlockedAttemptLog[] = [];
  private consecutiveFailuresByDevice: Map<string, number> = new Map();

  private readonly GARMIN_SECRET = process.env.GARMIN_CONNECTIQ_SECRET || "ROWER_GARMIN_CIQ_SECURE_KEY_2026";

  private constructor() {}

  public static getInstance(): AntiCheatService {
    if (!AntiCheatService.instance) {
      AntiCheatService.instance = new AntiCheatService();
    }
    return AntiCheatService.instance;
  }

  public isAntiCheatActive(): boolean {
    return this.antiCheatEnabled;
  }

  public isLoadTestOpen(): boolean {
    if (!this.loadTestModeEnabled || !this.loadTestExpiresAt) {
      return false;
    }
    const isOpen = new Date() < this.loadTestExpiresAt;
    if (!isOpen) {
      // Auto-réarmement du bouclier dès expiration de la fenêtre de test
      this.closeLoadTest();
    }
    return isOpen;
  }

  public getStatus(): AntiCheatStatus {
    const isTestOpen = this.isLoadTestOpen();
    let remainingMinutes = 0;
    if (isTestOpen && this.loadTestExpiresAt) {
      remainingMinutes = Math.max(0, Math.ceil((this.loadTestExpiresAt.getTime() - Date.now()) / (60 * 1000)));
    }

    return {
      antiCheatEnabled: this.antiCheatEnabled,
      loadTestModeEnabled: isTestOpen,
      loadTestExpiresAt: isTestOpen && this.loadTestExpiresAt ? this.loadTestExpiresAt.toISOString() : null,
      loadTestRemainingMinutes: remainingMinutes,
      loadTestKey: isTestOpen ? this.loadTestKey : null,
      blockedAttemptsCount: this.blockedAttemptsCount,
      recentBlocked: this.blockedAttemptsLog.slice(-15).reverse(),
    };
  }

  public openLoadTest(durationMinutes: number = 120, customKey?: string): AntiCheatStatus {
    const duration = Math.max(5, Math.min(720, Number(durationMinutes) || 120)); // entre 5min et 12h
    this.loadTestModeEnabled = true;
    this.loadTestExpiresAt = new Date(Date.now() + duration * 60 * 1000);
    this.loadTestKey = customKey ? String(customKey).trim() : `LTK-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    return this.getStatus();
  }

  public closeLoadTest(): AntiCheatStatus {
    this.loadTestModeEnabled = false;
    this.loadTestExpiresAt = null;
    this.loadTestKey = null;
    return this.getStatus();
  }

  public toggleAntiCheat(enabled: boolean): AntiCheatStatus {
    this.antiCheatEnabled = Boolean(enabled);
    return this.getStatus();
  }

  public resetStats(): AntiCheatStatus {
    this.blockedAttemptsCount = 0;
    this.blockedAttemptsLog = [];
    this.consecutiveFailuresByDevice.clear();
    return this.getStatus();
  }

  /**
   * Génère la signature officielle attendue pour une montre Garmin Connect IQ
   */
  public generateGarminSignature(deviceId: string, timestampSec?: number): string {
    const cleanDev = String(deviceId || "").trim();
    // Fenêtre temporelle de 5 minutes pour tolérer le léger décalage d'horloge de la montre
    const tBucket = Math.floor((timestampSec || Math.floor(Date.now() / 1000)) / 300);
    const hmac = crypto.createHmac("sha256", this.GARMIN_SECRET);
    hmac.update(`GARMIN_CIQ:${cleanDev}:${tBucket}`);
    return hmac.digest("hex");
  }

  /**
   * Vérifie la validité d'une requête Garmin / télémétrie
   */
  public verifyRequest(req: Request): { allowed: boolean; reason?: string; mode?: string } {
    // 1. Si le bouclier est inactif, tout flux est autorisé (environnement dev/test libre)
    if (!this.antiCheatEnabled) {
      return { allowed: true, mode: "disabled" };
    }

    const deviceId = String(req.body?.deviceId || req.headers["x-device-id"] || req.query?.deviceId || "").trim();
    const loadTestHeader = String(req.headers["x-load-test-key"] || req.body?.loadTestKey || "").trim();
    const garminSignatureHeader = String(req.headers["x-garmin-signature"] || req.body?.garminSignature || "").trim();

    // 2. Vérification du Mode Tests de Charge autorisé
    if (this.isLoadTestOpen() && this.loadTestKey) {
      if (loadTestHeader && loadTestHeader.toUpperCase() === this.loadTestKey.toUpperCase()) {
        if (deviceId) {
          this.consecutiveFailuresByDevice.delete(deviceId);
        }
        return { allowed: true, mode: "load_test" };
      }
    }

    // 3. Vérification de la signature officielle de la montre Garmin Connect IQ
    if (garminSignatureHeader) {
      // Tolérance sur la fenêtre actuelle ou la fenêtre précédente (-5 minutes)
      const nowSec = Math.floor(Date.now() / 1000);
      const expectedCurr = this.generateGarminSignature(deviceId, nowSec);
      const expectedPrev = this.generateGarminSignature(deviceId, nowSec - 300);

      // Supporte également une signature universelle officielle ou HMAC direct
      const directHmac = crypto.createHmac("sha256", this.GARMIN_SECRET).update(`GARMIN_CIQ:${deviceId}`).digest("hex");
      const isOfficialStatic = garminSignatureHeader === "CIQ_OFFICIAL_ROWER_V1";

      if (
        garminSignatureHeader === expectedCurr ||
        garminSignatureHeader === expectedPrev ||
        garminSignatureHeader === directHmac ||
        isOfficialStatic
      ) {
        if (deviceId) {
          this.consecutiveFailuresByDevice.delete(deviceId);
        }
        return { allowed: true, mode: "garmin_official" };
      }
    }

    // 4. Échec : journalisation et détection de récidive
    this.blockedAttemptsCount++;
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "inconnu");
    const reason = this.isLoadTestOpen()
      ? "Clé de test de charge invalide ou manquante."
      : "Signature matérielle Garmin Connect IQ requise (Mode Anti-Triche actif).";

    this.blockedAttemptsLog.push({
      timestamp: new Date(),
      ip,
      path: req.originalUrl || req.url,
      deviceId: deviceId || undefined,
      reason,
    });
    if (this.blockedAttemptsLog.length > 50) {
      this.blockedAttemptsLog.shift();
    }

    if (deviceId) {
      const fails = (this.consecutiveFailuresByDevice.get(deviceId) || 0) + 1;
      this.consecutiveFailuresByDevice.set(deviceId, fails);

      // Disqualification automatique de la course en cas de récidive (>10 tentatives illicites)
      if (fails >= 10) {
        try {
          const raceManager = RaceManager.getInstance();
          const raceId = req.body?.raceId || req.query?.raceId;
          const userId = req.body?.userId || deviceId;
          if (raceId && userId) {
            raceManager.leavePrivateRace(String(raceId), String(userId));
          }
        } catch {}
      }
    }

    return { allowed: false, reason };
  }
}

export const antiCheatService = AntiCheatService.getInstance();
export default antiCheatService;

