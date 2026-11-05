import { Op } from "sequelize";
import db from "../models";
import socketGateway, { LiveRacerMetric } from "../websocket/socket.gateway";
import config from "../config";

const Races = db.races;
const Activities = db.activities;
const Users = db.users;

export interface PrivateParticipantInfo {
  userId: string;
  userName: string;
  joinedAt: Date;
}

export interface RaceState {
  id: string;
  code?: string;
  title: string;
  type: "PUBLIC_HOURLY" | "PRIVATE_INVITE";
  status: "LOBBY" | "COUNTDOWN" | "RUNNING" | "COMPLETED" | "ABANDONED";
  targetDistance: number;
  maxParticipants: number;
  maxDurationMinutes: number;
  lobbyEndsAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  pinCode?: string; // 4 digits PIN for Garmin watch
  hostUserId?: string;
  hostUserName?: string;
  autoStart?: boolean;
  hasBots?: boolean;
  totalParticipants?: number;
  createdAt?: Date;
  participants?: Map<string, PrivateParticipantInfo>;
}

export class RaceManager {
  private static instance: RaceManager;
  private currentPublicRace: RaceState | null = null;
  private privateRaces: Map<string, RaceState> = new Map(); // code -> RaceState
  private privateRacesById: Map<string, RaceState> = new Map(); // raceId -> RaceState
  private pinToRaceMap: Map<string, { raceId: string; lane: number }> = new Map(); // 4 digits PIN -> race
  private loopTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.startOrchestratorLoop();
  }

  public static getInstance(): RaceManager {
    if (!RaceManager.instance) {
      RaceManager.instance = new RaceManager();
    }
    return RaceManager.instance;
  }

  public static normalizeMeetCode(raw: string): string | null {
    if (!raw || typeof raw !== "string") return null;
    const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (/^[a-z]{9}$/.test(cleaned)) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6, 9)}`;
    }
    return null;
  }

  /**
   * Main state machine ticker running every 1 second
   */
  private startOrchestratorLoop(): void {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = setInterval(async () => {
      try {
        if (this.currentPublicRace) {
          await this.tickPublicRace();
        }
        await this.tickPrivateRaces();
      } catch (err) {
        console.error("[RaceManager] Error in tick:", err);
      }
    }, 1000);
    if (typeof this.loopTimer.unref === "function") {
      this.loopTimer.unref();
    }
  }

  /**
   * Public Rotating Race Lifecycle
   * LOBBY (15 min) -> If >= 1 participant -> RUNNING (max 55 min) -> COMPLETED -> Reset
   */
  public async tickPublicRace(): Promise<RaceState> {
    const now = new Date();

    if (!this.currentPublicRace) {
      await this.initNextPublicRace();
      return this.currentPublicRace!;
    }

    const race = this.currentPublicRace;

    if (race.status === "LOBBY") {
      const remainingSec = Math.max(0, Math.floor((race.lobbyEndsAt.getTime() - now.getTime()) / 1000));

      if (remainingSec <= 0) {
        const participantCount = await Activities.count({
          where: { activityId: race.id, status: { [Op.ne]: "abandoned" } }
        });

        if (participantCount > 0) {
          race.status = "RUNNING";
          race.startedAt = new Date();
          console.log(`[RaceManager] Public Race ${race.id} started with ${participantCount} racers!`);
          await Races.update({ status: "in_progress", startTime: race.startedAt }, { where: { id: race.id } });
          socketGateway.broadcastRaceStatus(race.id, "RUNNING", { startedAt: race.startedAt });
        } else {
          console.log(`[RaceManager] 0 participants in Lobby at expiration. Silent reset 15m.`);
          await Races.update({ status: "cancelled" }, { where: { id: race.id } });
          if (race.pinCode) {
            this.pinToRaceMap.delete(race.pinCode);
          }
          await this.initNextPublicRace(15);
        }
      }
    } else if (race.status === "RUNNING") {
      const startTime = race.startedAt || now;
      const elapsedMinutes = (now.getTime() - startTime.getTime()) / (60 * 1000);

      if (elapsedMinutes >= (race.maxDurationMinutes || 55)) {
        console.log(`[RaceManager] Max duration (55m) reached for race ${race.id}. Finishing.`);
        await this.finishRace(race.id, true);
      } else {
        const activeActivities = await Activities.findAll({
          where: { activityId: race.id, status: { [Op.ne]: "abandoned" } }
        });

        if (activeActivities.length > 0) {
          const allFinished = activeActivities.every(
            (act: any) => act.get("status") === "finished" || (act.get("netDistance") as number) >= race.targetDistance
          );
          if (allFinished) {
            console.log(`[RaceManager] All racers finished race ${race.id}. Closing race.`);
            await this.finishRace(race.id, false);
          }
        }
      }
    }

    return this.currentPublicRace!;
  }

  /**
   * Private Salons Lifecycle Ticker (countdown -> RUNNING -> bot simulation -> COMPLETED & TTL cleanup)
   */
  public async tickPrivateRaces(): Promise<void> {
    const now = new Date();
    const ttlMs = 24 * 60 * 60 * 1000;

    for (const race of this.privateRacesById.values()) {
      if (race.createdAt && now.getTime() - race.createdAt.getTime() > ttlMs) {
        this.removePrivateRaceInternal(race);
        continue;
      }

      if ((race.status === "COUNTDOWN" || (race.status === "LOBBY" && race.autoStart)) && now >= race.lobbyEndsAt) {
        race.status = "RUNNING";
        race.startedAt = now;
        try {
          await Races.update({ status: "in_progress", startTime: now }, { where: { id: race.id } });
          await Activities.update(
            { status: "in_progress" },
            { where: { activityId: race.id, status: "waiting" } }
          );
        } catch {
          // In-memory state remains authoritative if DB is unavailable
        }
        socketGateway.broadcastRaceStatus(race.id, "RUNNING", { startedAt: now });
      } else if (race.status === "RUNNING") {
        const startTime = race.startedAt || now;
        const elapsedMinutes = (now.getTime() - startTime.getTime()) / (60 * 1000);

        if (elapsedMinutes >= (race.maxDurationMinutes || 55)) {
          race.status = "COMPLETED";
          race.endedAt = now;
          try {
            await Activities.update(
              { status: "out_of_time" },
              { where: { activityId: race.id, status: { [Op.in]: ["in_progress", "waiting", "paused"] } } }
            );
            await Races.update({ status: "finished" }, { where: { id: race.id } });
          } catch {
            // Ignore DB error in fallback mode
          }
          socketGateway.broadcastRaceStatus(race.id, "COMPLETED");
          continue;
        }

        try {
          if (race.hasBots) {
            const activeBots = await Activities.findAll({
              where: { activityId: race.id, isBot: true, status: { [Op.in]: ["in_progress", "waiting"] } }
            });
            for (const bot of activeBots) {
              const botPace = (bot.get("avgPace") as number) || 120;
              const botSpeedMs = 500 / botPace;
              const botPrevTime = (bot.get("elapsedTime") as number) || 0;
              const botNewTime = botPrevTime + 1;
              const botTarget = race.targetDistance || 2000;
              const botNetDist = Math.min(botTarget, Math.floor(botNewTime * botSpeedMs));
              const botProgress = Math.min(100, Number(((botNetDist / botTarget) * 100).toFixed(1)));
              await bot.update({
                netDistance: botNetDist,
                currentDistance: botNetDist,
                elapsedTime: botNewTime,
                progressPercent: botProgress,
                status: botNetDist >= botTarget ? "finished" : "in_progress",
                updatedAt: now
              });
            }
          }

          const activeActivities = await Activities.findAll({
            where: { activityId: race.id, status: { [Op.ne]: "abandoned" } }
          });

          if (activeActivities.length > 0) {
            const allFinished = activeActivities.every(
              (act: any) => act.get("status") === "finished" || (act.get("netDistance") as number) >= race.targetDistance
            );
            if (allFinished) {
              race.status = "COMPLETED";
              race.endedAt = now;
              await Races.update({ status: "finished" }, { where: { id: race.id } });
              socketGateway.broadcastRaceStatus(race.id, "COMPLETED");
            }
          }
        } catch {
          // Ignore DB error when running pure in-memory
        }
      }
    }
  }

  /**
   * Initializes the next scheduled public race
   */
  public async initNextPublicRace(delayMinutes?: number): Promise<RaceState> {
    const now = new Date();
    const intervalMin = delayMinutes || config.raceIntervalMinutes || 15;
    const lobbyEndsAt = new Date(now.getTime() + intervalMin * 60 * 1000);
    const raceId = `RACE_${lobbyEndsAt.toISOString().replace(/[-:T.]/g, "").slice(0, 12)}`;
    const pin = this.generateUniquePinCode();

    const title = `Régate Publique ${lobbyEndsAt.getHours().toString().padStart(2, "0")}h${lobbyEndsAt.getMinutes().toString().padStart(2, "0")}`;

    await Races.create({
      id: raceId,
      title,
      targetDistance: config.defaultRaceDistanceMeters || 2000,
      startTime: lobbyEndsAt,
      intervalMinutes: intervalMin,
      maxDurationMinutes: 55,
      status: "waiting",
      totalParticipants: 0
    });

    if (this.currentPublicRace?.pinCode) {
      this.pinToRaceMap.delete(this.currentPublicRace.pinCode);
    }

    this.currentPublicRace = {
      id: raceId,
      title,
      type: "PUBLIC_HOURLY",
      status: "LOBBY",
      targetDistance: config.defaultRaceDistanceMeters || 2000,
      maxParticipants: 20,
      maxDurationMinutes: 55,
      lobbyEndsAt,
      pinCode: pin,
      createdAt: now
    };

    this.pinToRaceMap.set(pin, { raceId, lane: 1 });
    console.log(`[RaceManager] New Public Race scheduled: ${raceId} | PIN: ${pin} | Lobby until: ${lobbyEndsAt.toISOString()}`);
    return this.currentPublicRace;
  }

  /**
   * Finishes race and prepares the next slot
   */
  public async finishRace(raceId: string, timeoutTriggered: boolean): Promise<void> {
    if (timeoutTriggered) {
      await Activities.update(
        { status: "out_of_time" },
        {
          where: {
            activityId: raceId,
            status: { [Op.in]: ["in_progress", "waiting", "paused"] }
          }
        }
      );
    }

    await Races.update({ status: "finished" }, { where: { id: raceId } });
    socketGateway.broadcastRaceStatus(raceId, "COMPLETED");

    await this.initNextPublicRace(15);
  }

  /**
   * Create Private Room with Google Meet style invite code (e.g. krm-wzx-qpl) + 4-digit PIN
   */
  public createPrivateRace(options: {
    title: string;
    targetDistance: number;
    maxParticipants?: number;
    hostUserId: string;
    hostUserName?: string;
    countdownMinutes?: number;
  }): RaceState {
    const code = this.generateUniqueMeetCode();
    const pin = this.generateUniquePinCode();
    const raceId = `PRIV_${code.replace(/-/g, "")}`;
    const now = new Date();

    const cleanTitle = String(options.title || "Régate Privée")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .slice(0, 64) || "Régate Privée";

    const rawDist = Number(options.targetDistance);
    const targetDistance = Number.isFinite(rawDist)
      ? Math.min(100000, Math.max(100, Math.round(rawDist)))
      : 2000;

    const rawMax = Number(options.maxParticipants);
    const maxParticipants = Number.isFinite(rawMax)
      ? Math.min(30, Math.max(2, Math.round(rawMax)))
      : 8;

    const rawCountdownMin = Number(options.countdownMinutes);
    const hasScheduledStart = Number.isFinite(rawCountdownMin) && rawCountdownMin > 0;
    const clampedCountdownMin = hasScheduledStart ? Math.min(180, rawCountdownMin) : 0;

    const lobbyEndsAt = hasScheduledStart
      ? new Date(now.getTime() + clampedCountdownMin * 60 * 1000)
      : new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const hostUserId = String(options.hostUserId || "anonymous").trim().slice(0, 64) || "anonymous";
    const hostUserName = options.hostUserName
      ? String(options.hostUserName).trim().slice(0, 64)
      : undefined;

    const participants = new Map<string, PrivateParticipantInfo>();

    const privateRace: RaceState = {
      id: raceId,
      code,
      title: cleanTitle,
      type: "PRIVATE_INVITE",
      status: "LOBBY",
      targetDistance,
      maxParticipants,
      maxDurationMinutes: 55,
      lobbyEndsAt,
      pinCode: pin,
      hostUserId,
      hostUserName,
      autoStart: hasScheduledStart,
      hasBots: false,
      totalParticipants: 0,
      createdAt: now,
      participants
    };

    this.privateRaces.set(code, privateRace);
    this.privateRacesById.set(raceId, privateRace);
    this.pinToRaceMap.set(pin, { raceId, lane: 1 });

    return privateRace;
  }

  public getRaceByPin(pin: string): { raceId: string; lane: number; race?: RaceState } | null {
    if (!pin) return null;
    const cleanPin = String(pin).trim();
    const matched = this.pinToRaceMap.get(cleanPin);
    if (!matched) return null;
    const race = this.getRaceById(matched.raceId) || undefined;
    return { ...matched, race };
  }

  public getCurrentPublicRace(): RaceState | null {
    return this.currentPublicRace;
  }

  public getRaceById(raceId: string): RaceState | null {
    if (!raceId) return null;
    if (this.currentPublicRace && this.currentPublicRace.id === raceId) {
      return this.currentPublicRace;
    }
    return this.privateRacesById.get(raceId) || null;
  }

  public getPrivateRaceByCode(code: string): RaceState | null {
    const normalized = RaceManager.normalizeMeetCode(code);
    if (normalized && this.privateRaces.has(normalized)) {
      return this.privateRaces.get(normalized)!;
    }
    return this.privateRaces.get(code) || null;
  }

  /**
   * Resolves a private salon by Meet code (with or without dashes, case-insensitive), raceId (PRIV_...), or 4-digit PIN
   */
  public findPrivateRace(identifier: string): RaceState | null {
    if (!identifier || typeof identifier !== "string") return null;
    const trimmed = identifier.trim();
    if (!trimmed) return null;

    // 1. Direct or normalized Meet code
    const byCode = this.getPrivateRaceByCode(trimmed);
    if (byCode && byCode.status !== "ABANDONED") return byCode;

    // 2. Direct raceId (PRIV_...)
    const byId = this.privateRacesById.get(trimmed);
    if (byId && byId.status !== "ABANDONED") return byId;

    // 3. 4-digit PIN
    if (/^\d{4}$/.test(trimmed)) {
      const pinHit = this.pinToRaceMap.get(trimmed);
      if (pinHit) {
        const priv = this.privateRacesById.get(pinHit.raceId);
        if (priv && priv.status !== "ABANDONED") return priv;
      }
    }

    return null;
  }

  public listPrivateRaces(hostUserId?: string, knownCodes?: string[]): RaceState[] {
    const cleanHost = hostUserId ? hostUserId.trim() : "";
    const normalizedCodes = new Set<string>();
    if (Array.isArray(knownCodes)) {
      for (const c of knownCodes) {
        const norm = RaceManager.normalizeMeetCode(c);
        if (norm) normalizedCodes.add(norm);
      }
    }

    if (!cleanHost && normalizedCodes.size === 0) {
      return [];
    }

    const matches: RaceState[] = [];
    for (const race of this.privateRacesById.values()) {
      if (race.status === "ABANDONED") continue;
      const isHostMatch = Boolean(cleanHost && race.hostUserId === cleanHost);
      const isCodeMatch = Boolean(race.code && normalizedCodes.has(race.code));
      if (isHostMatch || isCodeMatch) {
        matches.push(race);
      }
    }

    return matches.sort((a, b) => {
      const ta = a.createdAt ? a.createdAt.getTime() : 0;
      const tb = b.createdAt ? b.createdAt.getTime() : 0;
      return tb - ta;
    });
  }

  public joinPrivateRace(
    identifier: string,
    userId: string,
    userName?: string
  ): { race: RaceState; alreadyJoined: boolean } | { error: string; statusCode: number } {
    const race = this.findPrivateRace(identifier);
    if (!race) {
      return { error: "Salon privé introuvable ou expiré.", statusCode: 404 };
    }

    if (!race.participants) {
      race.participants = new Map();
    }

    const cleanUserId = String(userId || "anonymous").trim().slice(0, 64) || "anonymous";
    const cleanName = String(userName || `Racer_${cleanUserId.slice(-4)}`).trim().slice(0, 64);
    const alreadyJoined = race.participants.has(cleanUserId);

    if (!alreadyJoined && race.participants.size >= race.maxParticipants) {
      return { error: `Ce salon privé est complet (${race.maxParticipants} joueurs max).`, statusCode: 409 };
    }

    race.participants.set(cleanUserId, {
      userId: cleanUserId,
      userName: cleanName,
      joinedAt: new Date()
    });
    race.totalParticipants = Math.max(race.totalParticipants || 0, race.participants.size);

    return { race, alreadyJoined };
  }

  public startOrResetPrivateRace(
    identifier: string,
    options: {
      hostUserId?: string;
      isAdmin?: boolean;
      countdownSeconds?: number;
      reset?: boolean;
      targetDistance?: number;
    }
  ): { race: RaceState } | { error: string; statusCode: number } {
    const race = this.findPrivateRace(identifier);
    if (!race) {
      return { error: "Salon privé introuvable ou expiré.", statusCode: 404 };
    }

    if (!this.canManagePrivateRace(race, options.hostUserId, options.isAdmin)) {
      return { error: "Seul le créateur du salon peut contrôler le départ.", statusCode: 403 };
    }

    if (options.targetDistance !== undefined) {
      const dist = Number(options.targetDistance);
      if (Number.isFinite(dist) && dist >= 100 && dist <= 100000) {
        race.targetDistance = Math.round(dist);
      }
    }

    const now = new Date();
    if (options.reset) {
      race.status = "LOBBY";
      race.autoStart = false;
      race.startedAt = undefined;
      race.endedAt = undefined;
      race.lobbyEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      socketGateway.broadcastRaceStatus(race.id, "LOBBY", { reset: true });
      return { race };
    }

    const rawSec = options.countdownSeconds !== undefined ? Number(options.countdownSeconds) : 10;
    const countdownSec = Number.isFinite(rawSec) ? Math.min(3600, Math.max(0, Math.round(rawSec))) : 10;

    if (countdownSec <= 0) {
      race.status = "RUNNING";
      race.autoStart = true;
      race.startedAt = now;
      race.endedAt = undefined;
      race.lobbyEndsAt = now;
      socketGateway.broadcastRaceStatus(race.id, "RUNNING", { startedAt: now });
    } else {
      race.status = "COUNTDOWN";
      race.autoStart = true;
      race.startedAt = undefined;
      race.endedAt = undefined;
      race.lobbyEndsAt = new Date(now.getTime() + countdownSec * 1000);
      socketGateway.broadcastRaceStatus(race.id, "COUNTDOWN", {
        lobbyEndsAt: race.lobbyEndsAt,
        countdownSeconds: countdownSec
      });
    }

    return { race };
  }

  public regeneratePrivatePin(
    identifier: string,
    hostUserId?: string,
    isAdmin?: boolean
  ): { race: RaceState; pinCode: string } | { error: string; statusCode: number } {
    const race = this.findPrivateRace(identifier);
    if (!race) {
      return { error: "Salon privé introuvable ou expiré.", statusCode: 404 };
    }
    if (!this.canManagePrivateRace(race, hostUserId, isAdmin)) {
      return { error: "Seul le créateur du salon peut régénérer le code PIN.", statusCode: 403 };
    }

    const previousPin = race.pinCode;
    if (previousPin) {
      this.pinToRaceMap.delete(previousPin);
    }

    let nextPin = this.generateUniquePinCode();
    if (nextPin === previousPin) {
      nextPin = this.generateUniquePinCode(previousPin);
    }

    race.pinCode = nextPin;
    this.pinToRaceMap.set(nextPin, { raceId: race.id, lane: 1 });
    return { race, pinCode: nextPin };
  }

  public regeneratePrivateCode(
    identifier: string,
    hostUserId?: string,
    isAdmin?: boolean
  ): { race: RaceState; code: string } | { error: string; statusCode: number } {
    const race = this.findPrivateRace(identifier);
    if (!race) {
      return { error: "Salon privé introuvable ou expiré.", statusCode: 404 };
    }
    if (!this.canManagePrivateRace(race, hostUserId, isAdmin)) {
      return { error: "Seul le créateur du salon peut renouveler le lien du salon.", statusCode: 403 };
    }

    const previousCode = race.code;
    if (previousCode) {
      this.privateRaces.delete(previousCode);
    }

    let nextCode = this.generateUniqueMeetCode();
    while (nextCode === previousCode) {
      nextCode = this.generateUniqueMeetCode();
    }

    race.code = nextCode;
    this.privateRaces.set(nextCode, race);
    return { race, code: nextCode };
  }

  public closePrivateRace(
    identifier: string,
    hostUserId?: string,
    isAdmin?: boolean
  ): { success: true; raceId: string } | { error: string; statusCode: number } {
    const race = this.findPrivateRace(identifier);
    if (!race) {
      return { error: "Salon privé introuvable ou déjà fermé.", statusCode: 404 };
    }
    if (!this.canManagePrivateRace(race, hostUserId, isAdmin)) {
      return { error: "Seul le créateur du salon peut fermer ce salon.", statusCode: 403 };
    }

    this.removePrivateRaceInternal(race);
    socketGateway.broadcastRaceStatus(race.id, "ABANDONED");
    return { success: true, raceId: race.id };
  }

  private canManagePrivateRace(race: RaceState, hostUserId?: string, isAdmin?: boolean): boolean {
    if (isAdmin) return true;
    if (!race.hostUserId || race.hostUserId === "anonymous") return true;
    return Boolean(hostUserId && hostUserId.trim() === race.hostUserId);
  }

  private removePrivateRaceInternal(race: RaceState): void {
    race.status = "ABANDONED";
    if (race.pinCode) {
      this.pinToRaceMap.delete(race.pinCode);
    }
    if (race.code) {
      this.privateRaces.delete(race.code);
    }
    this.privateRacesById.delete(race.id);
  }

  private generateUniquePinCode(avoidPin?: string): string {
    for (let attempt = 0; attempt < 200; attempt++) {
      const candidate = Math.floor(1000 + Math.random() * 9000).toString();
      if (candidate !== avoidPin && !this.pinToRaceMap.has(candidate)) {
        return candidate;
      }
    }
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  private generateUniqueMeetCode(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz";
    const segment = (len: number) =>
      Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = `${segment(3)}-${segment(3)}-${segment(3)}`;
      if (!this.privateRaces.has(candidate)) {
        return candidate;
      }
    }
    return `${segment(3)}-${segment(3)}-${segment(3)}`;
  }
}

export default RaceManager.getInstance();
