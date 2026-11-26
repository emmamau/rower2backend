import { Op } from "sequelize";
import db from "../models";
import { KayakCustomization } from "../models/user.model";
import socketGateway, { LiveRacerMetric } from "../websocket/socket.gateway";
import config from "../config";
import userStore from "./user-store.service";
import { isEmmaAdminUser } from "./auth.service";
import { calculateRacePoints, calculateRacePointsEarned, getLeagueByPoints, generateRealisticBotPace, calculateBotPhysics, isLeagueEligible } from "../utils/league.util";
import { ensureCurrentWeek, getTodayRewardedBotRaces } from "./league-db.service";

const Races = db.races;
const Activities = db.activities;
const Users = db.users;

/** Plage d'allure autorisée pour un bot de duel : 1:45 (105 s) à 2:45 (165 s) aux 500 m */
export const BOT_PACE_MIN = 105;
export const BOT_PACE_MAX = 165;

export interface PrivateParticipantInfo {
  userId: string;
  userName: string;
  guestName?: string;
  joinedAt: Date;
  country?: string;
  lane?: number;
  ready?: boolean;
  pinValidated?: boolean;
  connectionState?: "CONNECTED" | "READY" | "PENDING_PIN";
  socketId?: string;
  deviceToken?: string;
  deviceId?: string;
  exactDistance?: number;
  lastTelemetryAtMs?: number;
  lastRowedAtMs?: number;
  lastElapsedSec?: number;
  isPaired?: boolean;
  kayak?: KayakCustomization;
  hasLeft?: boolean;
  status?: string;
}

let _pairingService: any = null;
function getPairingService(): any {
  if (!_pairingService) {
    try {
      _pairingService = require("./pairing.service").default;
    } catch {
      _pairingService = null;
    }
  }
  return _pairingService;
}

export interface GuestBoardingTicket {
  ticketPin: string;
  roomId: string;
  guestName: string;
  userId: string;
  socketId?: string;
  lane: number;
  expiresAt: Date;
  claimedAt?: Date;
  deviceId?: string;
  deviceToken?: string;
}

export interface RaceState {
  id: string;
  code?: string;
  title: string;
  type: "PUBLIC_HOURLY" | "PRIVATE_INVITE";
  status: "LOBBY" | "COUNTDOWN" | "RUNNING" | "COMPLETED" | "ABANDONED" | "STOPPED" | "CANCELLED";
  targetDistance: number;
  maxParticipants: number;
  maxDurationMinutes: number;
  lobbyEndsAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  pauseEndsAt?: Date;
  finalRanking?: RaceRankingEntry[];
  pinCode?: string; // Alphanumeric PIN (5 chars) for Garmin watch & quick join
  hostUserId?: string;
  hostUserName?: string;
  startMode?: "manual" | "scheduled";
  scheduledStartTime?: Date;
  timezone?: string;
  botCount?: number;
  botMinPace?: number;
  botMaxPace?: number;
  /** Mode de départ d'un duel contre un bot : décompte automatique ou attente du premier coup de rame */
  botStartMode?: "countdown" | "first_stroke";
  autoStart?: boolean;
  hasBots?: boolean;
  isBotDuel?: boolean;
  isDuel1v1?: boolean;
  isSolo?: boolean;
  gameMode?: "solo" | "bot_duel" | "duel_1v1" | "multi";
  adminAsSpectator?: boolean;
  hostParticipates?: boolean;
  originalHostUserId?: string;
  botDuelSeatClaimed?: boolean;
  requiredLeague?: string;
  requiresSubscription?: boolean;
  organizerCapacity?: number;
  totalParticipants?: number;
  createdAt?: Date;
  requireApproval?: boolean;
  participants?: Map<string, PrivateParticipantInfo>;
  pendingParticipants?: Map<string, PrivateParticipantInfo>;
  rejectedParticipants?: Set<string>;
  hostHasLeft?: boolean;
}

export function formatTimezoneAbbr(date: Date, timeZone: string): string {
  try {
    const dtf = new Intl.DateTimeFormat("fr-FR", { timeZone, timeZoneName: "short" });
    const part = dtf.formatToParts(date).find((p) => p.type === "timeZoneName")?.value;
    if (part) return ` ${part}`;
    return timeZone === "UTC" ? " UTC" : "";
  } catch {
    return timeZone === "UTC" ? " UTC" : "";
  }
}

export function parseDateTimeInTimezone(dateInput: Date | string, timeZone: string = "Europe/Paris"): Date {
  if (dateInput instanceof Date) {
    return Number.isFinite(dateInput.getTime()) ? dateInput : new Date();
  }
  if (!dateInput || typeof dateInput !== "string") {
    return new Date();
  }
  const clean = dateInput.trim();
  // If it already contains timezone offset (+HH:MM, -HH:MM or Z)
  if (/([+-]\d{2}:?\d{2}|Z)$/i.test(clean)) {
    const d = new Date(clean);
    if (Number.isFinite(d.getTime())) return d;
  }

  // Naive datetime format: YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) {
    const d = new Date(clean);
    return Number.isFinite(d.getTime()) ? d : new Date();
  }

  const [_, yStr, mStr, dStr, hStr, minStr, sStr] = match;
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  const hour = parseInt(hStr, 10);
  const minute = parseInt(minStr, 10);
  const second = sStr ? parseInt(sStr, 10) : 0;

  try {
    const utcRef = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "Europe/Paris",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const parts = dtf.formatToParts(utcRef);
    const getVal = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
    const tzYear = getVal("year");
    const tzMonth = getVal("month");
    const tzDay = getVal("day");
    let tzHour = getVal("hour");
    if (tzHour === 24) tzHour = 0;
    const tzMin = getVal("minute");
    const tzSec = getVal("second");

    const tzTimeAsUtc = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMin, tzSec);
    const offsetMs = tzTimeAsUtc - utcRef.getTime();

    return new Date(utcRef.getTime() - offsetMs);
  } catch {
    return new Date(clean);
  }
}

export function formatDetailedCountdown(msUntilStart: number): string {
  if (msUntilStart <= 0) return "imminent";
  const totalSec = Math.max(0, Math.ceil(msUntilStart / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (days > 0) {
    return `${days}j ${hours}h ${minutes}m ${seconds}s`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (seconds > 0 && minutes > 0) {
    return `${minutes}m ${seconds < 10 ? "0" : ""}${seconds}s`;
  }
  if (seconds > 0 && minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes} min`;
}

export function getWaitingStatusMessage(race: RaceState, now: Date = new Date()): string {
  if (race.status === "RUNNING") {
    return "Course en cours";
  }
  if (race.status === "COMPLETED" || race.status === "ABANDONED") {
    return "Course terminée";
  }
  if (race.status === "COUNTDOWN") {
    const sec = Math.max(0, Math.ceil((race.lobbyEndsAt.getTime() - now.getTime()) / 1000));
    return `Départ dans ${sec}s`;
  }
  if (race.isDuel1v1) {
    const count = race.participants ? race.participants.size : 0;
    if (count < 2) {
      return "En attente de l'adversaire...";
    }
    const anyNotReady = race.participants
      ? Array.from(race.participants.values()).some((p) => p.ready === false)
      : false;
    if (anyNotReady) {
      return "Adversaire en cours de connexion au rameur...";
    }
    return "Adversaire connecté - Préparez-vous (départ dans 15s)";
  }
  if (race.isSolo) {
    return "Ligne 1 attribuée - Donnez un coup de rame pour démarrer";
  }
  if (race.isBotDuel) {
    const anyNotReady = race.participants
      ? Array.from(race.participants.values()).some((p) => p.ready === false)
      : false;
    if (anyNotReady) {
      return "Ligne 1 attribuée - Donnez un coup de rame pour démarrer";
    }
    return "Donnez un coup de rame pour déclencher le départ contre le bot";
  }
  if (race.startMode === "scheduled" && race.scheduledStartTime) {
    const msUntilStart = race.scheduledStartTime.getTime() - now.getTime();
    const targetTz = race.timezone || "Europe/Paris";

    const timeFmt = new Intl.DateTimeFormat("fr-FR", {
      timeZone: targetTz,
      hour: "2-digit",
      minute: "2-digit"
    });
    const dateFmt = new Intl.DateTimeFormat("fr-FR", {
      timeZone: targetTz,
      weekday: "short",
      day: "numeric",
      month: "short"
    });

    const timeStr = timeFmt.format(race.scheduledStartTime);
    const todayStr = dateFmt.format(now);
    const raceDateStr = dateFmt.format(race.scheduledStartTime);
    const isSameDay = todayStr === raceDateStr;
    const tzLabel = formatTimezoneAbbr(race.scheduledStartTime, targetTz);

    if (msUntilStart <= 0) {
      return `Départ imminent (prévu à ${timeStr}${tzLabel})`;
    }

    const durationStr = formatDetailedCountdown(msUntilStart);
    if (isSameDay) {
      return `Départ prévu à ${timeStr}${tzLabel} (dans ${durationStr})`;
    } else {
      return `Départ prévu ${raceDateStr} à ${timeStr}${tzLabel} (dans ${durationStr})`;
    }
  }
  if (race.autoStart && race.lobbyEndsAt) {
    const msUntilStart = race.lobbyEndsAt.getTime() - now.getTime();
    if (msUntilStart > 0) {
      const durationStr = formatDetailedCountdown(msUntilStart);
      return `Départ dans ${durationStr}`;
    }
  }
  return "En attente du signal de départ de l'organisateur...";
}

export interface RaceTiming {
  /** Seconds before the start (lobby / countdown only, 0 once running). */
  secondsUntilStart: number;
  /** Seconds since the start (0 until the race is running). */
  elapsedSeconds: number;
  /** Seconds left before the automatic end of the game (max duration - elapsed). */
  remainingSeconds: number;
  maxDurationSeconds: number;
}

export interface RaceRankingEntry {
  rank: number;
  userId: string;
  userName: string;
  netDistance: number;
  status: string;
  isBot: boolean;
  points?: number;
  isEstimated?: boolean;
  estimatedTime?: number;
}

export class RaceManager {
  /** A human racer who did not send any data for this long is considered gone. */
  private static readonly HUMAN_INACTIVE_MS = 5 * 60 * 1000;
  /** Un coureur n'ayant plus ramé (inactivité / rupture) depuis 1 minute (60s) est considéré comme ayant abandonné (DNF). */
  public static readonly INACTIVITY_ABANDON_MS = 60 * 1000;
  /** Délai d'inactivité avant abandon (configurable dynamiquement par l'admin). */
  public inactivityAbandonMs: number = 60 * 1000;
  /** Distance minimale de dépassement pour le changement d'eau (configurable dynamiquement par l'admin). */
  public overtakeThresholdM: number = 5;

  private static instance: RaceManager;
  private currentPublicRace: RaceState | null = null;
  private privateRaces: Map<string, RaceState> = new Map(); // code -> RaceState
  private privateRacesById: Map<string, RaceState> = new Map(); // raceId -> RaceState
  private pinToRaceMap: Map<string, { raceId: string; lane: number }> = new Map(); // 4-5 chars PIN -> race
  private guestTicketsByPin: Map<string, GuestBoardingTicket> = new Map(); // 5-char ticketPin -> GuestBoardingTicket
  private loopTimer: NodeJS.Timeout | null = null;
  private loopBusy = false;
  private publicTickChain: Promise<void> = Promise.resolve();

  public isPublicRaceEnabled: boolean = true;
  public publicRaceDistanceM: number = 1000;
  public publicMaxDurationSec: number = 600;
  public publicMaxPlayers: number = 6;
  public publicBotCount: number = 2;
  public publicInterRaceDelaySec: number = 120;

  public adminPrivateRaceConfig = {
    maxDurationMinutes: 55,
  };

  public adminPublicRaceConfig = {
    targetDistance: 1000,
    maxParticipants: 6,
    maxDurationMinutes: 10,
    privateMaxDurationMinutes: 55,
    defaultBotsCount: 2,
    defaultBotsPace: 145, // 2:25 / 500m (palier débutant/loisir 2m20s - 2m45s)
    countdownAfterLastJoinSeconds: 15,
    lobbyWaitMinutes: 2,
  };

  private constructor() {
    this.loadPublicRaceSettingsFromDb().catch(() => {});
    this.startOrchestratorLoop();
  }

  /**
   * Recharge les paramètres dynamiques depuis la table PostgreSQL public_race_settings
   */
  public async loadPublicRaceSettingsFromDb(): Promise<void> {
    try {
      if (db.publicRaceSettings) {
        const row = await db.publicRaceSettings.findByPk(1);
        if (row) {
          const plain: any = typeof row.toJSON === "function" ? row.toJSON() : row;
          this.isPublicRaceEnabled = Boolean(plain.isEnabled ?? plain.is_enabled ?? true);
          this.publicRaceDistanceM = Number(plain.raceDistanceM ?? plain.race_distance_m ?? 1000);
          this.publicMaxDurationSec = Number(plain.maxDurationSec ?? plain.max_duration_sec ?? 600);
          this.publicMaxPlayers = Number(plain.maxPlayers ?? plain.max_players ?? 6);
          this.publicBotCount = Number(plain.botCount ?? plain.bot_count ?? 2);
          this.publicInterRaceDelaySec = Number(plain.interRaceDelaySec ?? plain.inter_race_delay_sec ?? 120);

          const customOvertake = Number(plain.overtakeThresholdM ?? plain.overtake_threshold_m ?? 5);
          if (!isNaN(customOvertake) && customOvertake >= 1 && customOvertake <= 50) {
            this.overtakeThresholdM = customOvertake;
          }
          const customInactivity = Number(plain.inactivityAbandonSec ?? plain.inactivity_abandon_sec ?? 60);
          if (!isNaN(customInactivity) && customInactivity >= 15 && customInactivity <= 600) {
            this.inactivityAbandonMs = customInactivity * 1000;
          }

          this.adminPublicRaceConfig.targetDistance = this.publicRaceDistanceM;
          this.adminPublicRaceConfig.maxParticipants = this.publicMaxPlayers;
          this.adminPublicRaceConfig.defaultBotsCount = this.publicBotCount;
          this.adminPublicRaceConfig.maxDurationMinutes = Math.max(1, Math.round(this.publicMaxDurationSec / 60));
          this.adminPublicRaceConfig.lobbyWaitMinutes = Math.max(1, Math.round(this.publicInterRaceDelaySec / 60));

          if (this.currentPublicRace && (this.currentPublicRace.status === "LOBBY" || this.currentPublicRace.status === "COUNTDOWN")) {
            this.currentPublicRace.targetDistance = this.publicRaceDistanceM;
            this.currentPublicRace.maxParticipants = this.publicMaxPlayers;
            this.currentPublicRace.maxDurationMinutes = Math.max(1, Math.round(this.publicMaxDurationSec / 60));
            this.currentPublicRace.botCount = this.publicBotCount;
          }
        }
      }
    } catch (err) {
      // Tolérance DB
    }
  }

  /**
   * Interrupteur maître marche/arrêt des courses publiques
   */
  public async togglePublicRaces(enabled: boolean): Promise<boolean> {
    this.isPublicRaceEnabled = Boolean(enabled);
    try {
      if (db.publicRaceSettings) {
        await db.publicRaceSettings.update({ isEnabled: this.isPublicRaceEnabled }, { where: { id: 1 } });
      }
    } catch {}

    if (!this.isPublicRaceEnabled) {
      console.log("[RaceManager] Courses publiques suspendues par l'administrateur.");
      socketGateway.broadcastRaceStatus("PUBLIC", "PUBLIC_RACES_SUSPENDED", {
        message: "Les courses publiques sont temporairement suspendues",
        isSuspended: true,
        timestamp: Date.now(),
      });
      if (this.currentPublicRace && this.currentPublicRace.status === "LOBBY") {
        this.currentPublicRace.status = "ABANDONED";
        this.currentPublicRace = null;
      }
    } else {
      console.log("[RaceManager] Courses publiques réactivées par l'administrateur.");
      socketGateway.broadcastRaceStatus("PUBLIC", "PUBLIC_RACES_RESUMED", {
        message: "Les courses publiques ont repris.",
        isSuspended: false,
        timestamp: Date.now(),
      });
      if (!this.currentPublicRace || this.currentPublicRace.status === "COMPLETED" || this.currentPublicRace.status === "ABANDONED") {
        await this.initNextPublicRace();
      }
    }
    return this.isPublicRaceEnabled;
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
   * Main state machine ticker running every 1 second.
   * The loop is re-entrancy safe: a slow DB round-trip never overlaps the next tick.
   */
  private startOrchestratorLoop(): void {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = setInterval(async () => {
      if (this.loopBusy) return;
      this.loopBusy = true;
      try {
        if (this.currentPublicRace) {
          await this.tickPublicRace();
        }
        await this.tickPrivateRaces();
      } catch (err) {
        console.error("[RaceManager] Error in tick:", err);
      } finally {
        this.loopBusy = false;
      }
    }, 1000);
    if (typeof this.loopTimer.unref === "function") {
      this.loopTimer.unref();
    }
  }

  // ---------------------------------------------------------------------------
  // Shared helpers (ranking, timing, bots)
  // ---------------------------------------------------------------------------

  /**
   * Race timing snapshot used by every client (web, watch) to display the countdown before the start
   * and the remaining duration of the game once it is running (max 55 minutes).
   */
  public getRaceTiming(race: RaceState, now: Date = new Date()): RaceTiming {
    const maxDurationSeconds = Math.round((race.maxDurationMinutes || 55) * 60);
    let secondsUntilStart = 0;
    let elapsedSeconds = 0;
    let remainingSeconds = maxDurationSeconds;

    if (race.status === "LOBBY" || race.status === "COUNTDOWN") {
      secondsUntilStart = Math.max(0, Math.ceil((race.lobbyEndsAt.getTime() - now.getTime()) / 1000));
    } else if (race.status === "RUNNING") {
      const startMs = (race.startedAt || now).getTime();
      elapsedSeconds = Math.max(0, Math.floor((now.getTime() - startMs) / 1000));
      remainingSeconds = Math.max(0, maxDurationSeconds - elapsedSeconds);
    } else {
      if (race.pauseEndsAt && race.pauseEndsAt.getTime() > now.getTime()) {
        secondsUntilStart = Math.max(0, Math.ceil((race.pauseEndsAt.getTime() - now.getTime()) / 1000));
      }
      if (race.startedAt) {
        const endMs = (race.endedAt || now).getTime();
        elapsedSeconds = Math.max(0, Math.floor((endMs - race.startedAt.getTime()) / 1000));
      }
      remainingSeconds = 0;
    }

    return { secondsUntilStart, elapsedSeconds, remainingSeconds, maxDurationSeconds };
  }

  /**
   * Official ranking: racers who crossed the line come first (earliest finish first);
   * everybody else is ranked on the distance covered when the race ends.
   */
  public static sortRanking<T extends { get: (key: string) => any }>(rows: T[]): T[] {
    const toMs = (v: any): number => {
      if (!v) return Number.MAX_SAFE_INTEGER;
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
    };
    return [...rows].sort((a, b) => {
      const aAb = a.get("status") === "abandoned" ? 1 : 0;
      const bAb = b.get("status") === "abandoned" ? 1 : 0;
      if (aAb !== bAb) return aAb - bAb;
      const aFin = a.get("status") === "finished" ? 0 : 1;
      const bFin = b.get("status") === "finished" ? 0 : 1;
      if (aFin !== bFin) return aFin - bFin;
      if (aFin === 0) {
        const byFinish = toMs(a.get("finishedAt")) - toMs(b.get("finishedAt"));
        if (byFinish !== 0) return byFinish;
        return ((a.get("elapsedTime") as number) || 0) - ((b.get("elapsedTime") as number) || 0);
      }
      const byDist = ((b.get("netDistance") as number) || 0) - ((a.get("netDistance") as number) || 0);
      if (byDist !== 0) return byDist;
      return ((a.get("elapsedTime") as number) || 0) - ((b.get("elapsedTime") as number) || 0);
    });
  }

  public static toLiveMetrics(sortedRows: any[], race?: RaceState | null): LiveRacerMetric[] {
    const usedLanes = new Set<number>();
    const preassignedLanes = new Map<string, number>();

    if (race?.participants) {
      for (const [uid, p] of race.participants.entries()) {
        if (p.lane && p.lane > 0) {
          preassignedLanes.set(uid, p.lane);
          usedLanes.add(p.lane);
        }
      }
    }

    let nextFreeLane = 1;
    const allocNextLane = (): number => {
      while (usedLanes.has(nextFreeLane)) {
        nextFreeLane++;
      }
      const chosen = nextFreeLane;
      usedLanes.add(chosen);
      nextFreeLane++;
      return chosen;
    };

    const filteredRows = sortedRows.filter((r: any) => {
      const getVal = (f: string) => (typeof r.get === "function" ? r.get(f) : r[f]);
      const userId = getVal("userId");
      const isBot = Boolean(getVal("isBot")) || String(userId || "").startsWith("bot_");
      if (isBot) return true;
      if (race && race.type === "PRIVATE_INVITE") {
        const dist = Number(getVal("netDistance") || 0);
        const watts = Number(getVal("lastPower") || 0);
        const spm = Number(getVal("lastStrokeRate") || 0);
        if (dist > 0 || watts > 0 || spm > 0) return true;
        const pInfo = race.participants?.get(userId);
        if (pInfo && (pInfo.connectionState === "PENDING_PIN" || pInfo.pinValidated === false)) {
          return false;
        }
      }
      return true;
    });

    return filteredRows.map((r: any, idx: number) => {
      const getVal = (f: string) => (typeof r.get === "function" ? r.get(f) : r[f]);
      const userId = getVal("userId");
      const isBot = Boolean(getVal("isBot")) || String(userId || "").startsWith("bot_");

      let lane = preassignedLanes.get(userId) || 0;
      if (!lane) {
        if (race?.isBotDuel) {
          lane = isBot ? 2 : allocNextLane();
          usedLanes.add(lane);
        } else if (race) {
          lane = allocNextLane();
        } else {
          lane = idx + 1;
        }
      }

      const participantInfo = race?.participants?.get(userId);
      if (participantInfo && (!participantInfo.lane || participantInfo.lane <= 0)) {
        participantInfo.lane = lane;
      }
      const userObj = !isBot ? (userStore.findUserSync(userId) || (userStore as any).getUserByIdSync?.(userId)) : null;

      // Résolution unifiée et déterministe des pseudos (Fin de l'alternance compte / montre) :
      // Priorité 1 : Le username / login enregistré sur le compte utilisateur (si authentifié)
      // Priorité 2 : Le pseudo invité choisi lors de l'entrée dans le salon (participantInfo?.guestName ou participantInfo?.userName)
      // Fallback ultime : L'identifiant technique de la montre uniquement si aucun nom/compte n'est associé
      let name = "";
      if (userObj && (userObj.login || userObj.name)) {
        name = userObj.login || userObj.name;
      } else if (participantInfo && (participantInfo.guestName || participantInfo.userName)) {
        const pCandidate = String(participantInfo.guestName || participantInfo.userName).trim();
        if (!pCandidate.startsWith("Garmin_") && !pCandidate.startsWith("fenix") && !pCandidate.startsWith("forerunner")) {
          name = pCandidate;
        }
      }

      if (!name) {
        const actName = String(getVal("userName") || "").trim();
        if (actName && !actName.startsWith("Garmin_") && !actName.startsWith("fenix") && !actName.startsWith("forerunner")) {
          name = actName;
        } else {
          name = actName || userId || "Rameur";
        }
      }

      // Figer le pseudo validé dans les métadonnées du participant pour toute la durée de la course
      if (participantInfo && (!participantInfo.userName || participantInfo.userName.startsWith("Garmin_"))) {
        participantInfo.userName = name;
      }

      const dist = Number.isFinite(Number(getVal("netDistance"))) ? Math.max(0, Number(getVal("netDistance"))) : 0;
      const rawSplit = Number(getVal("lastPace")) || Number(getVal("avgPace")) || 120;
      const split = Number.isFinite(rawSplit) && rawSplit > 0 ? rawSplit : 120;
      const rawWatts = Number(getVal("lastPower")) || Number(getVal("avgPower")) || 0;
      const watts = Number.isFinite(rawWatts) && rawWatts >= 0 ? rawWatts : 0;
      const rawSpm = Number(getVal("lastStrokeRate")) || Number(getVal("avgStrokeRate")) || 0;
      const spm = Number.isFinite(rawSpm) && rawSpm >= 0 ? rawSpm : 0;
      const heartRate = (getVal("lastHeartRate") as number) || undefined;
      const country = getVal("country") || undefined;
      const status = getVal("status") || "in_progress";
      const elapsedTime = Number.isFinite(Number(getVal("elapsedTime"))) ? Math.max(0, Number(getVal("elapsedTime"))) : 0;

      const isParticipantReady = isBot
        ? true
        : (participantInfo?.ready !== undefined ? participantInfo.ready : (watts > 0 || spm > 0 || dist > 0 || true));
      const connectionState: "CONNECTED" | "READY" | "PENDING_PIN" = isBot
        ? "READY"
        : (participantInfo?.connectionState || (participantInfo?.ready === false ? "CONNECTED" : "READY"));

      const isPaired = !isBot && Boolean(
        getVal("isPaired") ||
        participantInfo?.isPaired ||
        participantInfo?.deviceToken ||
        (getPairingService()?.isParticipantPaired?.({
          userId,
          deviceToken: participantInfo?.deviceToken,
          deviceId: participantInfo?.deviceId
        }))
      );

      const kayak = participantInfo?.kayak || userObj?.kayakCustomization;

      return {
        lane,
        userId,
        name,
        dist,
        split,
        watts,
        spm,
        heartRate,
        country,
        status,
        elapsedTime,
        ready: isParticipantReady,
        connectionState,
        isBot,
        isPaired,
        kayak,
      };
    });
  }

  /** A human racer still taking part in the race (not abandoned / finished, and still sending data). */
  private isActiveHuman(row: any, now: Date): boolean {
    if (Boolean(row.get("isBot"))) return false;
    const status = row.get("status");
    if (status !== "in_progress" && status !== "waiting" && status !== "paused") return false;
    const updatedAt = row.get("updatedAt");
    if (!updatedAt) return true;
    const age = now.getTime() - new Date(updatedAt).getTime();
    return !(age > RaceManager.HUMAN_INACTIVE_MS);
  }

  private async loadRaceActivities(raceId: string): Promise<any[]> {
    const mergedMap = new Map<string, any>();
    const memRows = userStore.findActivitiesByRaceId(raceId);
    for (const m of memRows) {
      const uid = String(typeof m.get === "function" ? m.get("userId") : m.userId);
      if (uid) mergedMap.set(uid, m);
    }
    try {
      const rows = (await Activities.findAll({ where: { activityId: raceId } })) as any[];
      if (rows && rows.length > 0) {
        for (const r of rows) {
          const uid = String(typeof r.get === "function" ? r.get("userId") : r.userId);
          if (uid) {
            const mem = mergedMap.get(uid);
            const rDist = Number((typeof r.get === "function" ? r.get("netDistance") : r.netDistance) || 0);
            const memDist = mem ? Number((typeof mem.get === "function" ? mem.get("netDistance") : mem.netDistance) || 0) : 0;
            if (!mem || rDist >= memDist) {
              mergedMap.set(uid, r);
            }
          }
        }
      }
    } catch {
      // Tolérance DB hors ligne
    }
    return Array.from(mergedMap.values());
  }

  /**
   * Virtual rowers simulation. The distance is derived from the wall clock (time elapsed since the start of
   * the race, or since the bot joined if later) so it never drifts or freezes if a tick is late.
   */
  private async advanceBots(race: RaceState, rows: any[], now: Date): Promise<number> {
    if (!race.startedAt) {
      race.startedAt = now;
    }
    const startMs = race.startedAt.getTime();
    const target = race.targetDistance || 2000;
    let advanced = 0;
    for (const bot of rows) {
      if (!bot.get("isBot")) continue;
      const status = bot.get("status");
      if (status !== "in_progress" && status !== "waiting") continue;

      const isSalonBot = race.type === "PRIVATE_INVITE" || String(bot.get("userId") || "").startsWith("bot_salon_");
      const createdMs = bot.get("createdAt") ? new Date(bot.get("createdAt")).getTime() : startMs;
      const botStartMs = (isSalonBot || createdMs <= startMs + 1000) ? startMs : createdMs;
      const elapsedSec = Math.max(0, (now.getTime() - botStartMs) / 1000);
      const pace = (bot.get("avgPace") as number) || (bot.get("lastPace") as number) || 120;
      const speedMs = 500 / Math.max(60, pace);
      const dist = Math.min(target, Math.floor(elapsedSec * speedMs));
      const finished = dist >= target;
      const botPower = finished ? 0 : ((bot.get("lastPower") as number) || (bot.get("avgPower") as number) || 180);
      const botSpm = finished ? 0 : ((bot.get("lastStrokeRate") as number) || (bot.get("avgStrokeRate") as number) || 24);

      try {
        await bot.update({
          netDistance: dist,
          currentDistance: dist,
          elapsedTime: Math.floor(elapsedSec),
          progressPercent: Math.min(100, Number(((dist / target) * 100).toFixed(1))),
          status: finished ? "finished" : "in_progress",
          finishedAt: finished ? (bot.get("finishedAt") || now) : bot.get("finishedAt"),
          lastPower: botPower,
          lastStrokeRate: botSpm,
          lastPace: finished ? 0 : pace,
          avgSpeedKmh: Number((speedMs * 3.6).toFixed(1))
        } as any);
      } catch {
        // Fallback for offline DB / test mock
        if (typeof bot.setDataValue === "function") {
          bot.setDataValue("netDistance", dist);
          bot.setDataValue("currentDistance", dist);
          bot.setDataValue("lastPower", botPower);
          bot.setDataValue("lastStrokeRate", botSpm);
        }
      }
      advanced++;
    }
    if (advanced > 0) race.hasBots = true;
    return advanced;
  }

  /**
   * Estime le chrono d'arrivée et positionne le statut des bots restants dès que tous les humains ont franchi la ligne.
   * La durée totale est calculée d'après l'allure du bot (sec/500m) et garantie >= dernier humain.
   */
  private async estimateAndFinishRemainingBots(
    race: RaceState,
    botsInProgress: any[],
    humanFinishers: any[],
    now: Date
  ): Promise<void> {
    const target = race.targetDistance || 2000;
    const startMs = race.startedAt ? race.startedAt.getTime() : now.getTime();
    const maxHumanElapsed = Math.max(
      1,
      ...humanFinishers.map((h: any) => Number(h.get("elapsedTime")) || 0)
    );

    for (const bot of botsInProgress) {
      const pace = Number(bot.get("avgPace") || bot.get("lastPace") || 120);
      const safePace = Math.max(60, Math.min(300, pace));
      const createdMs = bot.get("createdAt") ? new Date(bot.get("createdAt")).getTime() : startMs;
      const isSalonBot = race.type === "PRIVATE_INVITE" || String(bot.get("userId") || "").startsWith("bot_salon_");
      const botStartMs = (isSalonBot || createdMs <= startMs + 1000) ? startMs : createdMs;

      // Durée totale théorique pour parcourir targetDistance à cette allure (en secondes)
      let estimatedElapsed = Math.round((target * safePace) / 500);

      // Le bot arrivant après le dernier humain, son temps estimé doit être >= dernier humain + 1s
      if (estimatedElapsed <= maxHumanElapsed) {
        estimatedElapsed = maxHumanElapsed + 1;
      }

      const estimatedFinishedAt = new Date(botStartMs + estimatedElapsed * 1000);

      try {
        await bot.update({
          status: "finished",
          netDistance: target,
          currentDistance: target,
          progressPercent: 100,
          elapsedTime: estimatedElapsed,
          finishedAt: estimatedFinishedAt,
          lastPower: 0,
          lastStrokeRate: 0,
          lastPace: 0,
          isEstimated: true,
        } as any);
      } catch {
        if (typeof bot.setDataValue === "function") {
          bot.setDataValue("status", "finished");
          bot.setDataValue("netDistance", target);
          bot.setDataValue("currentDistance", target);
          bot.setDataValue("elapsedTime", estimatedElapsed);
          bot.setDataValue("finishedAt", estimatedFinishedAt);
        }
      }

      userStore.recordActivity({
        id: bot.get("id"),
        activityId: race.id,
        userId: bot.get("userId"),
        status: "finished",
        netDistance: target,
        currentDistance: target,
        progressPercent: 100,
        elapsedTime: estimatedElapsed,
        finishedAt: estimatedFinishedAt,
        lastPower: 0,
        lastStrokeRate: 0,
        lastPace: 0,
        isEstimated: true,
      });

      try {
        await Activities.update(
          {
            status: "finished",
            netDistance: target,
            currentDistance: target,
            progressPercent: 100,
            elapsedTime: estimatedElapsed,
            finishedAt: estimatedFinishedAt,
            lastPower: 0,
            lastStrokeRate: 0,
            lastPace: 0,
          },
          { where: { activityId: race.id, userId: bot.get("userId") } }
        );
      } catch {}
    }
  }

  /** Writes finalRank on every non-abandoned racer, calculates points/leagues and returns the official classification. */
  private async finalizeRanking(raceId: string): Promise<RaceRankingEntry[]> {
    await ensureCurrentWeek();
    const rows = await this.loadRaceActivities(raceId);
    const ranked = RaceManager.sortRanking(rows.filter((r: any) => r.get("status") !== "abandoned"));
    const totalParticipants = ranked.length;
    const humanFinishers = ranked.filter((x: any) => !x.get("isBot") && x.get("status") === "finished").length;
    const hasBots = ranked.some((x: any) => x.get("isBot"));
    const result: RaceRankingEntry[] = [];
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i];
      const rank = i + 1;
      const isFinisher = r.get("status") === "finished";
      const isBot = r.get("isBot") === true;
      let pts = 0;

      if (!isBot && r.get("userId")) {
        const rMode = r.get("raceMode") || (hasBots ? "BOT" : (humanFinishers > 2 ? "MULTIPLAYER" : "DUEL_1V1"));
        const todayBots = await getTodayRewardedBotRaces(r.get("userId"));
        pts = calculateRacePointsEarned({
          raceMode: rMode,
          playerRank: rank,
          totalHumanFinishers: humanFinishers,
          isFinisher,
          isDnf: !isFinisher,
          todayRewardedBotRacesCount: todayBots,
        });
      } else {
        pts = calculateRacePoints(rank, totalParticipants, isFinisher);
      }

      const alreadyAwarded = Number(r.get("pointsEarned") || r.get("points") || 0) > 0;
      try {
        await r.update({
          finalRank: rank,
          points: pts,
          pointsEarned: pts,
          isDnf: !isFinisher,
          totalHumanFinishers: humanFinishers,
          avgPaceMs: ((r.get("avgPace") as number) || 0) * 1000,
        } as any);
      } catch {}

      // Mettre à jour les points et le statut de ligue du joueur humain si non déjà comptabilisés
      let resolvedUserName = r.get("userName") || r.get("userId");
      if (!isBot && r.get("userId")) {
        try {
          const u = await userStore.findUser(r.get("userId"));
          if (u) {
            resolvedUserName = u.login || u.name;
            const currentPts = (u.points as number) || 0;
            const currentCareerPts = (u.totalCareerPoints as number) || currentPts;
            const newPts = alreadyAwarded ? currentPts : (currentPts + pts);
            const newCareerPts = alreadyAwarded ? currentCareerPts : (currentCareerPts + pts);
            const league = getLeagueByPoints(newPts);
            const totalWins = (u.totalWins || 0) + (rank === 1 && isFinisher ? 1 : 0);
            const podiums = (u.podiums || 0) + (rank <= 3 && isFinisher ? 1 : 0);
            const bestRank = !u.bestRank || rank < u.bestRank ? rank : u.bestRank;
            await userStore.updateUser(u.id, {
              points: newPts,
              totalCareerPoints: newCareerPts,
              league: league.id,
              totalWins,
              podiums,
              lastRank: rank,
              bestRank,
            });
          }
        } catch {}
      }

      result.push({
        rank,
        userId: r.get("userId"),
        userName: resolvedUserName,
        netDistance: (r.get("netDistance") as number) || 0,
        status: r.get("status"),
        isBot: r.get("isBot") === true,
        points: pts,
        isEstimated: r.get("isEstimated") === true,
        estimatedTime: r.get("isEstimated") ? ((r.get("elapsedTime") as number) || 0) : undefined
      });
    }

    // Inclusion explicite des abandons (DNF) : 0 points et statut "abandoned"
    const abandoned = rows.filter((r: any) => r.get("status") === "abandoned");
    for (const ab of abandoned) {
      try {
        await ab.update({ finalRank: 0, points: 0, pointsEarned: 0, isDnf: true } as any);
      } catch {}
      result.push({
        rank: 0,
        userId: ab.get("userId"),
        userName: ab.get("userName") || ab.get("userId"),
        netDistance: (ab.get("netDistance") as number) || 0,
        status: "abandoned",
        isBot: ab.get("isBot") === true,
        points: 0
      });
    }
    return result;
  }

  /**
   * Public Rotating Race Lifecycle
   * LOBBY (15 min) -> If >= 1 human participant -> RUNNING (max 55 min) -> COMPLETED -> new LOBBY
   * A running race also ends when every human racer is gone (abandoned / finished / disconnected):
   * remaining virtual rowers never keep a race alive.
   * Calls are serialised so the 1s loop and HTTP requests never run the state machine concurrently.
   */
  public tickPublicRace(): Promise<RaceState> {
    const run = this.publicTickChain.then(() => this.runPublicTick());
    this.publicTickChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async runPublicTick(): Promise<RaceState> {
    const now = new Date();

    if (!this.isPublicRaceEnabled) {
      if (!this.currentPublicRace || this.currentPublicRace.status === "COMPLETED" || (this.currentPublicRace.status as any) === "POST_RACE_PAUSE" || this.currentPublicRace.status === "ABANDONED") {
        this.currentPublicRace = null;
        return null as any;
      }
    }

    if (!this.currentPublicRace) {
      if (this.isPublicRaceEnabled) {
        await this.initNextPublicRace();
      }
      return this.currentPublicRace!;
    }

    const race = this.currentPublicRace;

    if (race.status === "COMPLETED" || (race.status as any) === "POST_RACE_PAUSE") {
      if (race.pauseEndsAt) {
        if (now.getTime() >= race.pauseEndsAt.getTime()) {
          console.log(`[RaceManager] Fin des 2 minutes de pause post-course pour ${race.id}. Enchaînement vers le nouveau lobby.`);
          if (this.isPublicRaceEnabled) {
            await this.initNextPublicRace();
          } else {
            this.currentPublicRace = null;
          }
        } else {
          const pauseRemainingSec = Math.max(0, Math.ceil((race.pauseEndsAt.getTime() - now.getTime()) / 1000));
          socketGateway.broadcastRaceStatus(race.id, "POST_RACE_PAUSE", {
            pauseSeconds: pauseRemainingSec,
            pauseEndsAt: race.pauseEndsAt,
            ranking: race.finalRanking || []
          });
        }
      }
      return this.currentPublicRace!;
    }

    if (race.status === "LOBBY" || race.status === "COUNTDOWN") {
      const remainingSec = Math.max(0, Math.floor((race.lobbyEndsAt.getTime() - now.getTime()) / 1000));
      const participantHumans = race.participants ? Array.from(race.participants.values()).length : 0;
      const maxPart = race.maxParticipants || this.adminPublicRaceConfig.maxParticipants || 20;

      // Condition 1 : Nombre maxi de coureurs connecté -> déclenchement immédiat du départ
      if (participantHumans >= maxPart && race.status === "LOBBY") {
        console.log(`[RaceManager] Capacité maxi atteinte (${participantHumans}/${maxPart}). Lancement anticipé du départ de la course ${race.id} !`);
        const countdownSec = 15;
        race.status = "COUNTDOWN";
        race.lobbyEndsAt = new Date(now.getTime() + countdownSec * 1000);
        socketGateway.broadcastRaceStatus(race.id, "COUNTDOWN", {
          lobbyEndsAt: race.lobbyEndsAt,
          secondsUntilStart: countdownSec,
          countdownSeconds: countdownSec,
          reason: "max_participants_reached"
        });
      }
      // Condition 2 : Entrée dans les 15 dernières secondes du timer d'attente prévu (15mn par défaut)
      else if (remainingSec <= 15 && remainingSec > 0 && race.status === "LOBBY") {
        race.status = "COUNTDOWN";
        socketGateway.broadcastRaceStatus(race.id, "COUNTDOWN", {
          lobbyEndsAt: race.lobbyEndsAt,
          secondsUntilStart: remainingSec,
          countdownSeconds: remainingSec
        });
      }

      if (now.getTime() >= race.lobbyEndsAt.getTime()) {
        let humans = 0;
        try {
          const rows = await this.loadRaceActivities(race.id);
          humans = rows.filter(
            (r: any) =>
              !r.get("isBot") &&
              ["waiting", "in_progress", "paused"].includes(r.get("status"))
          ).length;
        } catch (err) {
          console.error("[RaceManager] Unable to count participants:", err);
        }

        const participantHumans = race.participants ? Array.from(race.participants.values()).length : 0;
        if (humans > 0 || participantHumans > 0) {
          race.status = "RUNNING";
          race.startedAt = new Date();
          console.log(`[RaceManager] Public Race ${race.id} started with ${Math.max(humans, participantHumans)} racer(s)!`);
          try {
            await Races.update({ status: "in_progress", startTime: race.startedAt }, { where: { id: race.id } });
            await Activities.update(
              { status: "in_progress" },
              { where: { activityId: race.id, status: "waiting" } }
            );
          } catch (err) {
            console.error("[RaceManager] Unable to persist race start:", err);
          }
          socketGateway.broadcastRaceStatus(race.id, "RUNNING", { startedAt: race.startedAt });
        } else {
          console.log(`[RaceManager] 0 human participants in Lobby at expiration. Silent reset.`);
          try {
            await Races.update({ status: "cancelled" }, { where: { id: race.id } });
          } catch (err) {
            console.error("[RaceManager] Unable to cancel empty race:", err);
          }
          if (race.pinCode) {
            this.pinToRaceMap.delete(race.pinCode);
          }
          race.status = "ABANDONED";
          if (this.isPublicRaceEnabled) {
            await this.initNextPublicRace();
          } else {
            this.currentPublicRace = null;
          }
        }
      }
    } else if (race.status === "RUNNING") {
      const startTime = race.startedAt || now;
      const elapsedMinutes = (now.getTime() - startTime.getTime()) / (60 * 1000);

      if (elapsedMinutes >= (race.maxDurationMinutes || 55)) {
        console.log(`[RaceManager] Max duration (${race.maxDurationMinutes || 55}m) reached for race ${race.id}. Finishing.`);
        await this.finishRace(race.id, true, "timeout");
      } else {
        try {
          const rows = await this.loadRaceActivities(race.id);

          // Détection d'inactivité post-départ (> 60s sans ramer / rupture de flux) -> passage en Abandon (DNF)
          for (const row of rows) {
            if (!row.get("isBot") && (row.get("status") === "in_progress" || row.get("status") === "paused")) {
              const uid = String(row.get("userId") || "");
              const participant = race.participants?.get(uid);
              const memAct = userStore.findActivityById(row.get("id"));
              const lastRowedMs = Number(
                participant?.lastRowedAtMs ||
                (typeof row.get === "function" ? row.get("lastRowedAtMs") : (row as any).lastRowedAtMs) ||
                memAct?.lastRowedAtMs ||
                0
              );
              const updatedAtMs = row.get("updatedAt") ? new Date(row.get("updatedAt")).getTime() : 0;
              const startMs = race.startedAt ? race.startedAt.getTime() : 0;
              const baselineMs = Math.max(lastRowedMs, updatedAtMs, startMs);
              const ageMs = now.getTime() - baselineMs;

              if (ageMs > this.inactivityAbandonMs) {
                console.log(`[RaceManager] Rupture de flux / inactivité détectée pour ${uid} (${Math.round(ageMs / 1000)}s > ${Math.round(this.inactivityAbandonMs / 1000)}s). Marquage Abandon (DNF).`);
                if (participant) {
                  participant.status = "abandoned";
                }
                await row.update({ status: "abandoned", isDnf: true, speed: 0, powerWatts: 0, strokeRate: 0 } as any);
                userStore.recordActivity({
                  id: row.get("id"),
                  activityId: race.id,
                  userId: uid,
                  status: "abandoned",
                  isDnf: true,
                  lastPower: 0,
                  lastStrokeRate: 0,
                });
                try {
                  await Activities.update(
                    { status: "abandoned", isDnf: true, lastPower: 0, lastStrokeRate: 0 },
                    { where: { activityId: race.id, userId: uid } }
                  );
                } catch {}
              }
            }
          }

          await this.advanceBots(race, rows, now);

          const live = RaceManager.sortRanking(rows);
          if (live.length > 0) {
            socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(live, race));

            const nonAbandoned = live.filter((act: any) => act.get("status") !== "abandoned");
            const nonAbandonedHumans = nonAbandoned.filter((act: any) => !act.get("isBot"));
            const botsInProgress = nonAbandoned.filter(
              (act: any) => Boolean(act.get("isBot")) && act.get("status") !== "finished" && ((act.get("netDistance") as number) || 0) < race.targetDistance
            );
            const allFinished =
              nonAbandoned.length > 0 &&
              nonAbandoned.every(
                (act: any) =>
                  act.get("status") === "finished" ||
                  ((act.get("netDistance") as number) || 0) >= race.targetDistance
              );
            if (allFinished) {
              await this.finishRace(race.id, false, "completed");
              return this.currentPublicRace!;
            }

            // Règle: Lorsque tous les humains sont arrivés et qu'il ne reste plus que des bots, la course se termine
            // et le chrono des bots restants est estimé par rapport à leur allure.
            const allHumansFinished =
              nonAbandonedHumans.length > 0 &&
              nonAbandonedHumans.every(
                (act: any) =>
                  act.get("status") === "finished" ||
                  ((act.get("netDistance") as number) || 0) >= race.targetDistance
              );

            if (allHumansFinished && botsInProgress.length > 0) {
              console.log(`[RaceManager] Tous les humains sont arrivés en course publique ${race.id}. Clôture immédiate avec extrapolation des bots.`);
              await this.estimateAndFinishRemainingBots(race, botsInProgress, nonAbandonedHumans, now);
              await this.finishRace(race.id, false, "all_humans_finished");
              return this.currentPublicRace!;
            }
          }

          const activeHumans = rows.filter((r: any) => this.isActiveHuman(r, now));
          const hasFinishedHuman = rows.some((r: any) => !r.get("isBot") && r.get("status") === "finished");
          if (activeHumans.length === 0 && !hasFinishedHuman) {
            console.log(`[RaceManager] No human racer left in race ${race.id} (only bots, no finisher). Closing race.`);
            await this.finishRace(race.id, false, "no_active_humans");
          }
        } catch (err) {
          console.error(`[RaceManager] Public race tick failed for ${race.id}:`, err);
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

    for (const race of Array.from(this.privateRacesById.values())) {
      // 1. Si la course est terminée ou clôturée, conservation 24h après la fin pour consultation
      if (["COMPLETED", "STOPPED", "CANCELLED", "ABANDONED"].includes(race.status)) {
        const finishedAt = race.endedAt || race.createdAt || now;
        if (now.getTime() - finishedAt.getTime() > ttlMs) {
          this.removePrivateRaceInternal(race);
        }
        continue;
      }

      // 2. Si la course est programmée ou en attente : conservation jusqu'à 24h après l'heure prévue (ou 24h après création)
      const referenceTime = (race.startMode === "scheduled" && race.scheduledStartTime && race.scheduledStartTime > (race.createdAt || now))
        ? race.scheduledStartTime
        : (race.createdAt || now);

      if (now.getTime() - referenceTime.getTime() > ttlMs) {
        // Ne pas purger prématurément un salon de duel 1v1 tant que son défi est actif
        if (race.isDuel1v1) {
          continue;
        }
        this.removePrivateRaceInternal(race);
        continue;
      }

      // Course planifiée : déclenchement automatique du compte à rebours 15s avant l'heure prévue
      // Verrouillé par le statut BLE "READY" de tous les compétiteurs connectés (Section 4.2 & 7.3)
      if ((race.status === "LOBBY" || race.status === "COUNTDOWN") && race.startMode === "scheduled" && race.scheduledStartTime) {
        const msUntilStart = race.scheduledStartTime.getTime() - now.getTime();
        const hasConnectedParticipants = Boolean(race.participants && race.participants.size > 0);
        const allParticipantsReady =
          hasConnectedParticipants &&
          Array.from(race.participants!.values()).every((p) => p.ready !== false);
        if (race.status === "COUNTDOWN" && !allParticipantsReady) {
          race.status = "LOBBY";
          race.autoStart = false;
        } else if (race.status === "LOBBY" && msUntilStart <= 15000 && msUntilStart > 0 && allParticipantsReady) {
          race.status = "COUNTDOWN";
          race.autoStart = true;
          race.lobbyEndsAt = race.scheduledStartTime;
          socketGateway.broadcastRaceStatus(race.id, "COUNTDOWN", {
            lobbyEndsAt: race.lobbyEndsAt,
            countdownSeconds: Math.max(1, Math.ceil(msUntilStart / 1000))
          });
        }
      }

      if ((race.status === "COUNTDOWN" || (race.status === "LOBBY" && race.autoStart)) && now >= race.lobbyEndsAt) {
        // En mode programmé, départ automatique uniquement s'il y a des participants connectés ET tous à l'état READY
        if ((race.status === "LOBBY" && race.autoStart) || race.startMode === "scheduled") {
          const rows = await this.loadRaceActivities(race.id);
          const hasParticipants =
            (race.participants && race.participants.size > 0) ||
            rows.some((r: any) => !r.get("isBot") && ["waiting", "in_progress"].includes(r.get("status")));
          const allParticipantsReady =
            Boolean(race.participants && race.participants.size > 0) &&
            Array.from(race.participants!.values()).every((p) => p.ready !== false);
          if (!hasParticipants || !allParticipantsReady) {
            // Pas encore de participant ou au moins un rameur en veille (CONNECTED), on laisse le lobby ouvert
            if (race.startMode === "scheduled") {
              race.status = "LOBBY";
            }
            continue;
          }
        }

        race.status = "RUNNING";
        race.startedAt = now;
        if (race.participants) {
          for (const p of race.participants.values()) {
            p.ready = true;
            p.connectionState = "READY";
          }
        }
        userStore.updateActivitiesWhere(race.id, "waiting", { status: "in_progress", updatedAt: now });
        try {
          await Races.update({ status: "in_progress", startTime: now }, { where: { id: race.id } });
          await Activities.update(
            { status: "in_progress" },
            { where: { activityId: race.id, status: "waiting" } }
          );
          const startRows = await this.loadRaceActivities(race.id);
          await this.advanceBots(race, startRows, now);
          const liveStart = RaceManager.sortRanking(startRows);
          if (liveStart.length > 0) {
            socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(liveStart, race));
          }
        } catch (err) {
          console.error("[RaceManager] Unable to persist private race start:", err);
        }
        socketGateway.broadcastRaceStatus(race.id, "RUNNING", { startedAt: now });
      } else if (race.status === "RUNNING") {
        const startTime = race.startedAt || now;
        const elapsedMinutes = (now.getTime() - startTime.getTime()) / (60 * 1000);

        if (elapsedMinutes >= (race.maxDurationMinutes || 55)) {
          await this.finishPrivateRace(race, "timeout");
          continue;
        }

        try {
          const rows = await this.loadRaceActivities(race.id);

          // Détection d'inactivité post-départ (> 60s sans ramer / rupture de flux) -> passage en Abandon (DNF)
          for (const row of rows) {
            if (!row.get("isBot") && (row.get("status") === "in_progress" || row.get("status") === "paused")) {
              const uid = String(row.get("userId") || "");
              const participant = race.participants?.get(uid);
              const memAct = userStore.findActivityById(row.get("id"));
              const lastRowedMs = Number(
                participant?.lastRowedAtMs ||
                (typeof row.get === "function" ? row.get("lastRowedAtMs") : (row as any).lastRowedAtMs) ||
                memAct?.lastRowedAtMs ||
                0
              );
              const updatedAtMs = row.get("updatedAt") ? new Date(row.get("updatedAt")).getTime() : 0;
              const startMs = race.startedAt ? race.startedAt.getTime() : 0;
              const baselineMs = Math.max(lastRowedMs, updatedAtMs, startMs);
              const ageMs = now.getTime() - baselineMs;

              if (ageMs > this.inactivityAbandonMs) {
                console.log(`[RaceManager] Rupture de flux / inactivité détectée pour ${uid} (${Math.round(ageMs / 1000)}s > ${Math.round(this.inactivityAbandonMs / 1000)}s). Marquage Abandon (DNF).`);
                if (participant) {
                  participant.status = "abandoned";
                }
                await row.update({ status: "abandoned", isDnf: true, speed: 0, powerWatts: 0, strokeRate: 0 } as any);
                userStore.recordActivity({
                  id: row.get("id"),
                  activityId: race.id,
                  userId: uid,
                  status: "abandoned",
                  isDnf: true,
                  lastPower: 0,
                  lastStrokeRate: 0,
                });
                try {
                  await Activities.update(
                    { status: "abandoned", isDnf: true, lastPower: 0, lastStrokeRate: 0 },
                    { where: { activityId: race.id, userId: uid } }
                  );
                } catch {}
              }
            }
          }

          await this.advanceBots(race, rows, now);

          const live = RaceManager.sortRanking(rows);
          if (live.length > 0) {
            socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(live, race));

            const nonAbandoned = live.filter((act: any) => act.get("status") !== "abandoned");
            const nonAbandonedHumans = nonAbandoned.filter((act: any) => !act.get("isBot"));
            const botsInProgress = nonAbandoned.filter(
              (act: any) => Boolean(act.get("isBot")) && act.get("status") !== "finished" && ((act.get("netDistance") as number) || 0) < race.targetDistance
            );
            const allFinished =
              nonAbandoned.length > 0 &&
              nonAbandoned.every(
                (act: any) =>
                  act.get("status") === "finished" ||
                  ((act.get("netDistance") as number) || 0) >= race.targetDistance
              );
            if (allFinished) {
              await this.finishPrivateRace(race, "completed");
              continue;
            }

            // Règle: Lorsque tous les humains sont arrivés et qu'il ne reste plus que des bots, la course se termine
            // et le chrono des bots restants est estimé par rapport à leur allure.
            const allHumansFinished =
              nonAbandonedHumans.length > 0 &&
              nonAbandonedHumans.every(
                (act: any) =>
                  act.get("status") === "finished" ||
                  ((act.get("netDistance") as number) || 0) >= race.targetDistance
              );

            if (allHumansFinished && botsInProgress.length > 0) {
              console.log(`[RaceManager] Tous les humains sont arrivés dans le salon ${race.id}. Clôture immédiate avec extrapolation des bots.`);
              await this.estimateAndFinishRemainingBots(race, botsInProgress, nonAbandonedHumans, now);
              await this.finishPrivateRace(race, "all_humans_finished");
              continue;
            }
          }

          const activeHumans = rows.filter((r: any) => this.isActiveHuman(r, now));
          const hasMemoryHumans = Boolean(race.participants && race.participants.size > 0);
          const hasFinishedHuman = rows.some((r: any) => !r.get("isBot") && r.get("status") === "finished");
          const justStarted = race.startedAt ? (now.getTime() - race.startedAt.getTime() < 10000) : true;
          if (activeHumans.length === 0 && !hasFinishedHuman && !hasMemoryHumans && !justStarted) {
            console.log(`[RaceManager] No active human racer left in private race ${race.id} (only bots, no finisher). Closing race.`);
            await this.finishPrivateRace(race, "no_active_humans");
          }
        } catch (err) {
          console.error(`[RaceManager] Private race tick failed for ${race.id}:`, err);
        }
      }
    }
  }

  public async finishPrivateRace(race: RaceState, reason: string): Promise<void> {
    if (race.status === "COMPLETED" || race.status === "STOPPED" || race.status === "CANCELLED") return;
    const isStopped = reason === "organizer_stopped" || reason === "stopped";
    const isCancelled = reason === "cancelled" || reason === "aborted";
    race.status = isStopped ? "STOPPED" : (isCancelled ? "CANCELLED" : "COMPLETED");
    race.endedAt = new Date();
    let ranking: RaceRankingEntry[] = [];

    // Sauvegarde d'équité : tout rameur actif à moins de 5m de la ligne d'arrivée au moment de la clôture
    // est promu automatiquement au statut "finished" avec la distance cible exacte.
    if (!isStopped && !isCancelled && race.targetDistance > 0) {
      const snapThreshold = Math.max(0, race.targetDistance - 5);
      const closeActivities = userStore.findActivitiesByRaceId(race.id).filter(
        (a: any) => ["in_progress", "waiting", "paused"].includes(a.status) && Number(a.netDistance || a.currentDistance || 0) >= snapThreshold
      );
      for (const a of closeActivities) {
        a.status = "finished";
        a.netDistance = race.targetDistance;
        a.currentDistance = race.targetDistance;
        a.progressPercent = 100;
        try {
          await Activities.update(
            { status: "finished", netDistance: race.targetDistance, currentDistance: race.targetDistance, progressPercent: 100 },
            { where: { id: a.id } }
          );
        } catch {}
      }
    }

    userStore.updateActivitiesWhere(race.id, ["in_progress", "waiting", "paused"], { status: "out_of_time" });
    try {
      await Activities.update(
        { status: "out_of_time" },
        { where: { activityId: race.id, status: { [Op.in]: ["in_progress", "waiting", "paused"] } } }
      );
    } catch { /* ignore when DB offline */ }
    try {
      ranking = await this.finalizeRanking(race.id);
    } catch (err) {
      console.error(`[RaceManager] Unable to finalise private race ${race.id}:`, err);
    }
    try {
      const dbStatus = isStopped ? "stopped" : (isCancelled ? "cancelled" : "finished");
      await Races.update({ status: dbStatus }, { where: { id: race.id } });
    } catch { /* ignore when DB offline */ }
    race.finalRanking = ranking;
    if (race.isDuel1v1 && ranking.length > 0) {
      try {
        const duelSvc = require("./duel.service").default;
        if (duelSvc && typeof duelSvc.resolveDuelByRoomId === "function") {
          await duelSvc.resolveDuelByRoomId(race.id, ranking);
        }
      } catch {}
    }
    if (race.status !== "COMPLETED") {
      this.removePrivateRaceInternal(race, race.status);
      socketGateway.broadcastRaceStatus(race.id, race.status, { reason, ranking, roomClosed: true });
    } else {
      if (race.pinCode) {
        this.pinToRaceMap.delete(race.pinCode.toUpperCase());
      }
      socketGateway.broadcastRaceStatus(race.id, "COMPLETED", { reason, ranking, roomClosed: false });
    }
  }

  /**
   * Initializes the next scheduled public race (new lobby with its countdown so players have time to connect)
   */
  public async initNextPublicRace(delayMinutes?: number): Promise<RaceState> {
    const now = new Date();
    const intervalMin = delayMinutes || this.adminPublicRaceConfig.lobbyWaitMinutes || config.raceIntervalMinutes || 15;
    const lobbyEndsAt = new Date(now.getTime() + intervalMin * 60 * 1000);
    let raceId = `RACE_${lobbyEndsAt.toISOString().replace(/[-:T.]/g, "").slice(0, 14)}`;
    if ((this.currentPublicRace && this.currentPublicRace.id === raceId) || this.getRaceById(raceId)) {
      raceId = `${raceId}_${Math.floor(Math.random() * 900 + 100)}`;
    }
    const pin = this.generateUniquePinCode();

    const title = `Régate Publique ${lobbyEndsAt.getHours().toString().padStart(2, "0")}h${lobbyEndsAt.getMinutes().toString().padStart(2, "0")}`;
    const targetDistance = this.adminPublicRaceConfig.targetDistance || 2000;
    const maxParticipants = this.adminPublicRaceConfig.maxParticipants || 20;
    const maxDurationMinutes = this.adminPublicRaceConfig.maxDurationMinutes || 55;

    try {
      await Races.create({
        id: raceId,
        title,
        targetDistance,
        startTime: lobbyEndsAt,
        intervalMinutes: intervalMin,
        maxDurationMinutes,
        status: "waiting",
        totalParticipants: 0,
        hasBots: this.adminPublicRaceConfig.defaultBotsCount > 0
      });
    } catch (err) {
      console.error(`[RaceManager] Unable to persist public race ${raceId}:`, err);
    }

    if (this.currentPublicRace?.pinCode) {
      this.pinToRaceMap.delete(this.currentPublicRace.pinCode);
    }

    this.currentPublicRace = {
      id: raceId,
      title,
      type: "PUBLIC_HOURLY",
      status: "LOBBY",
      targetDistance,
      maxParticipants,
      maxDurationMinutes,
      lobbyEndsAt,
      pinCode: pin,
      hasBots: this.adminPublicRaceConfig.defaultBotsCount > 0,
      createdAt: now
    };

    this.pinToRaceMap.set(pin, { raceId, lane: 1 });

    // Injecter automatiquement les bots configurés pour la course publique
    if (this.adminPublicRaceConfig.defaultBotsCount > 0) {
      this.ensureDefaultPublicBots(
        raceId,
        this.adminPublicRaceConfig.defaultBotsCount,
        this.adminPublicRaceConfig.defaultBotsPace,
        targetDistance
      ).catch(() => {});
    }

    console.log(`[RaceManager] New Public Race scheduled: ${raceId} | PIN: ${pin} | Target: ${targetDistance}m | Lobby until: ${lobbyEndsAt.toISOString()}`);
    socketGateway.broadcastRaceStatus(raceId, "LOBBY", { lobbyEndsAt });
    return this.currentPublicRace;
  }

  /**
   * Arrêt d'urgence de la course publique en direct par l'administrateur :
   * - Arrête immédiatement tous les participants
   * - Annule les activités sans aucun classement ni attribution de points
   * - Vide la course de ses participants
   * - Clôture la course en base (statut 'stopped')
   * - Redémarre un nouveau cycle avec un nouveau salon d'attente (lobby)
   */
  public async abortAndResetPublicRace(reason: string = "admin_stopped"): Promise<{
    success: boolean;
    oldRaceId: string | null;
    newRace: RaceState | null;
  }> {
    const oldRace = this.currentPublicRace;
    const oldRaceId = oldRace?.id || null;

    if (oldRace) {
      console.log(`[RaceManager] Arrêt immédiat de la course publique ${oldRaceId} par l'administrateur (${reason}).`);
      oldRace.status = "STOPPED";
      oldRace.endedAt = new Date();
      delete oldRace.pauseEndsAt;
      oldRace.finalRanking = [];

      // Annuler les activités en mémoire et en DB sans attribuer de points
      userStore.updateActivitiesWhere(oldRace.id, ["in_progress", "waiting", "paused"], {
        status: "abandoned",
        isDnf: true,
        lastPower: 0,
        lastStrokeRate: 0,
      });

      try {
        await Activities.update(
          { status: "abandoned", isDnf: true, lastPower: 0, lastStrokeRate: 0 },
          {
            where: {
              activityId: oldRace.id,
              status: { [Op.in]: ["in_progress", "waiting", "paused"] }
            }
          }
        );
      } catch (err) {
        console.error(`[RaceManager] Erreur annulation activités DB pour ${oldRace.id}:`, err);
      }

      try {
        await Races.update({ status: "stopped" }, { where: { id: oldRace.id } });
      } catch (err) {
        console.error(`[RaceManager] Erreur mise à jour statut course DB pour ${oldRace.id}:`, err);
      }

      if (oldRace.pinCode) {
        this.pinToRaceMap.delete(oldRace.pinCode);
      }

      // Vider tous les participants
      if (oldRace.participants) {
        oldRace.participants.clear();
      }

      // Diffuser l'arrêt immédiat sans classement
      socketGateway.broadcastRaceStatus(oldRace.id, "STOPPED", {
        reason: "admin_stopped_public",
        message: "Course arrêtée par l'administrateur. Aucun classement n'est retenu.",
        hasRanking: false,
        ranking: [],
        pauseSeconds: 0,
        isPublic: true
      });

      socketGateway.broadcast("race:public_stopped", {
        raceId: oldRace.id,
        message: "Course arrêtée par l'administrateur. Aucun classement n'est retenu.",
        timestamp: Date.now()
      });
    }

    this.currentPublicRace = null;
    let newRace: RaceState | null = null;
    if (this.isPublicRaceEnabled) {
      newRace = await this.initNextPublicRace();
      if (newRace && oldRaceId && newRace.id === oldRaceId) {
        newRace.id = `${newRace.id}_${Math.floor(Math.random() * 900 + 100)}`;
      }
      console.log(`[RaceManager] Nouveau cycle de course publique relancé : ${newRace?.id} (lobby jusqu'à ${newRace?.lobbyEndsAt?.toISOString()})`);
    }

    return {
      success: true,
      oldRaceId,
      newRace
    };
  }

  public notifyPlayerJoinedPublic(userId: string, userName?: string, deviceId?: string, deviceToken?: string, isPaired?: boolean): void {
    if (!this.currentPublicRace || !userId) return;
    if (this.currentPublicRace.status === "LOBBY" || this.currentPublicRace.status === "COUNTDOWN") {
      if (!this.currentPublicRace.participants) {
        this.currentPublicRace.participants = new Map();
      }

      // DÉDOUBLONNAGE STRICT : Éviter qu'un joueur ou une même montre n'occupe 2 lignes d'eau
      const cleanDeviceId = deviceId ? String(deviceId).trim() : undefined;
      const cleanDeviceToken = deviceToken ? String(deviceToken).trim() : undefined;
      const cleanName = userName && userName.trim().length > 0 && userName.trim() !== "Rameur_42"
        ? userName.trim()
        : `Racer_${userId.slice(-4)}`;

      // Recherche d'un éventuel doublon antérieur pour cette même montre physique ou ce même utilisateur
      for (const [existingId, p] of this.currentPublicRace.participants.entries()) {
        if (existingId !== userId) {
          const matchDevice = Boolean(cleanDeviceId && p.deviceId && p.deviceId === cleanDeviceId);
          const matchToken = Boolean(cleanDeviceToken && p.deviceToken && p.deviceToken === cleanDeviceToken);
          // Si même montre physique ou même token de session/device
          if (matchDevice || matchToken) {
            console.log(`[RaceManager] Détection tentative multiple pour montre ${cleanDeviceId}. Remplacement de ${existingId} par ${userId}`);
            this.currentPublicRace.participants.delete(existingId);
            // Libération asynchrone de l'ancienne activité en DB
            Activities.update(
              { status: "abandoned" },
              { where: { activityId: this.currentPublicRace.id, userId: existingId } }
            ).catch(() => {});
          }
        }
      }

      const existingPart = this.currentPublicRace.participants.get(userId);
      this.currentPublicRace.participants.set(userId, {
        userId,
        userName: cleanName || existingPart?.userName || `Racer_${userId.slice(-4)}`,
        joinedAt: existingPart?.joinedAt || new Date(),
        deviceId: cleanDeviceId || existingPart?.deviceId,
        deviceToken: cleanDeviceToken || existingPart?.deviceToken,
        isPaired: isPaired !== undefined ? isPaired : (existingPart?.isPaired ?? false)
      });

      const maxParticipants = this.currentPublicRace.maxParticipants || this.adminPublicRaceConfig.maxParticipants || 20;
      const count = this.currentPublicRace.participants.size;

      // Condition de départ anticipé : si le nombre maxi de coureurs connectés est atteint
      if (count >= maxParticipants) {
        console.log(`[RaceManager] Capacité maxi atteinte (${count}/${maxParticipants}) pour la course ${this.currentPublicRace.id}. Déclenchement du départ !`);
        const now = new Date();
        const countdownSec = 15; // 15 secondes pour se placer sur le rameur
        this.currentPublicRace.status = "COUNTDOWN";
        this.currentPublicRace.lobbyEndsAt = new Date(now.getTime() + countdownSec * 1000);
        socketGateway.broadcastRaceStatus(this.currentPublicRace.id, "COUNTDOWN", {
          lobbyEndsAt: this.currentPublicRace.lobbyEndsAt,
          secondsUntilStart: countdownSec,
          countdownSeconds: countdownSec,
          lastJoinedUserId: userId,
          reason: "max_participants_reached"
        });
      } else {
        // Le nombre maxi n'est pas encore atteint : on conserve le timer d'attente prévu (15mn par défaut)
        console.log(`[RaceManager] Joueur ${userId} connecté en course publique (${count}/${maxParticipants}). Attente du timer prévu (fin à ${this.currentPublicRace.lobbyEndsAt.toISOString()}).`);
        socketGateway.broadcastRaceStatus(this.currentPublicRace.id, this.currentPublicRace.status, {
          lobbyEndsAt: this.currentPublicRace.lobbyEndsAt,
          participantsCount: count,
          maxParticipants,
          lastJoinedUserId: userId
        });
      }
    }
  }

  public updatePublicRaceConfig(newCfg: Partial<typeof this.adminPublicRaceConfig>): typeof this.adminPublicRaceConfig {
    if (newCfg.targetDistance !== undefined && Number.isFinite(Number(newCfg.targetDistance))) {
      this.adminPublicRaceConfig.targetDistance = Math.min(100000, Math.max(500, Math.round(Number(newCfg.targetDistance))));
    }
    if (newCfg.maxParticipants !== undefined && Number.isFinite(Number(newCfg.maxParticipants))) {
      this.adminPublicRaceConfig.maxParticipants = Math.min(100, Math.max(2, Math.round(Number(newCfg.maxParticipants))));
    }
    if (newCfg.maxDurationMinutes !== undefined && Number.isFinite(Number(newCfg.maxDurationMinutes))) {
      this.adminPublicRaceConfig.maxDurationMinutes = Math.min(180, Math.max(5, Math.round(Number(newCfg.maxDurationMinutes))));
    }
    if (newCfg.defaultBotsCount !== undefined && Number.isFinite(Number(newCfg.defaultBotsCount))) {
      this.adminPublicRaceConfig.defaultBotsCount = Math.min(20, Math.max(0, Math.round(Number(newCfg.defaultBotsCount))));
    }
    if (newCfg.defaultBotsPace !== undefined && Number.isFinite(Number(newCfg.defaultBotsPace))) {
      this.adminPublicRaceConfig.defaultBotsPace = Math.min(300, Math.max(60, Math.round(Number(newCfg.defaultBotsPace))));
    }
    if (newCfg.countdownAfterLastJoinSeconds !== undefined && Number.isFinite(Number(newCfg.countdownAfterLastJoinSeconds))) {
      this.adminPublicRaceConfig.countdownAfterLastJoinSeconds = Math.min(300, Math.max(5, Math.round(Number(newCfg.countdownAfterLastJoinSeconds))));
    }
    if (newCfg.lobbyWaitMinutes !== undefined && Number.isFinite(Number(newCfg.lobbyWaitMinutes))) {
      this.adminPublicRaceConfig.lobbyWaitMinutes = Math.min(120, Math.max(1, Math.round(Number(newCfg.lobbyWaitMinutes))));
    }
    if (newCfg.privateMaxDurationMinutes !== undefined && Number.isFinite(Number(newCfg.privateMaxDurationMinutes))) {
      const clamped = Math.min(180, Math.max(5, Math.round(Number(newCfg.privateMaxDurationMinutes))));
      this.adminPublicRaceConfig.privateMaxDurationMinutes = clamped;
      this.adminPrivateRaceConfig.maxDurationMinutes = clamped;
    }
    if (this.currentPublicRace && (this.currentPublicRace.status === "LOBBY" || this.currentPublicRace.status === "COUNTDOWN")) {
      this.currentPublicRace.targetDistance = this.adminPublicRaceConfig.targetDistance;
      this.currentPublicRace.maxParticipants = this.adminPublicRaceConfig.maxParticipants;
      this.currentPublicRace.maxDurationMinutes = this.adminPublicRaceConfig.maxDurationMinutes;
    }
    return this.adminPublicRaceConfig;
  }

  private async ensureDefaultPublicBots(raceId: string, count: number, pace: number, targetDistance: number): Promise<void> {
    if (count <= 0) return;
    const names = ["Bot Argonaut", "Bot Poseidon", "Bot Nautilus", "Bot Triton", "Bot Thalassa", "Bot Albatros", "Bot Sirius", "Bot Orion"];
    for (let i = 0; i < count; i++) {
      const botId = `bot_pub_${i + 1}`;
      const compositeId = `${raceId}_${botId}`;
      const name = names[i % names.length];
      // Distribution réaliste pondérée : 60% entre 140s et 165s, 30% entre 125s et 140s, 10% entre 110s et 125s
      const botPace = generateRealisticBotPace();
      const { power, spm, speedMs } = calculateBotPhysics(botPace);
      const botDefaults = {
        id: compositeId,
        activityId: raceId,
        userId: botId,
        userName: name,
        isBot: true,
        raceMode: "race",
        targetDistance,
        status: "waiting",
        initialDistance: 0,
        currentDistance: 0,
        netDistance: 0,
        progressPercent: 0,
        lastStrokeRate: spm,
        lastStrokeCount: 0,
        lastHeartRate: 155,
        lastResistance: 4,
        totalStrokes: 0,
        totalEnergy: 0,
        lastPower: power,
        lastPace: botPace,
        avgPower: power,
        avgPace: botPace,
        avgStrokeRate: spm,
        elapsedTime: 0,
        avgSpeedKmh: Number((speedMs * 3.6).toFixed(1)),
      };
      if (!userStore.findActivityById(compositeId)) {
        userStore.recordActivity(botDefaults);
      }
      try {
        await Activities.findOrCreate({
          where: { id: compositeId },
          defaults: botDefaults as any
        });
      } catch {}
    }
  }

  /**
   * Finishes a race: remaining racers are classified as out of time, the official ranking is written
   * (finishers first, then by distance covered) and the next public lobby is prepared.
   * Idempotent: calling it twice for the same race has no further effect.
   */
  public async finishRace(raceId: string, timeoutTriggered: boolean, reason?: string): Promise<RaceRankingEntry[]> {
    const managed = this.getRaceById(raceId) || this.findPrivateRace(raceId);
    if (managed && (managed.status === "COMPLETED" || managed.status === "STOPPED" || managed.status === "CANCELLED" || managed.status === "ABANDONED")) {
      return [];
    }
    const isPublic = Boolean(this.currentPublicRace && this.currentPublicRace.id === raceId);
    const isStopped = reason === "organizer_stopped" || reason === "stopped";
    const isCancelled = reason === "cancelled" || reason === "aborted";
    if (managed) {
      managed.status = isStopped ? "STOPPED" : (isCancelled ? "CANCELLED" : "COMPLETED");
      managed.endedAt = new Date();
      if (isPublic && reason !== "no_active_humans" && !isStopped && !isCancelled) {
        managed.pauseEndsAt = new Date(Date.now() + 120 * 1000); // 2 minutes post-race restitution pause
      }
    }

    let ranking: RaceRankingEntry[] = [];

    // Sauvegarde d'équité : tout rameur actif à moins de 5m de la ligne d'arrivée au moment de la clôture
    // est promu automatiquement au statut "finished" avec la distance cible exacte.
    const targetDist = managed?.targetDistance || 2000;
    if (!isStopped && !isCancelled && targetDist > 0) {
      const snapThreshold = Math.max(0, targetDist - 5);
      const closeActivities = userStore.findActivitiesByRaceId(raceId).filter(
        (a: any) => ["in_progress", "waiting", "paused"].includes(a.status) && Number(a.netDistance || a.currentDistance || 0) >= snapThreshold
      );
      for (const a of closeActivities) {
        a.status = "finished";
        a.netDistance = targetDist;
        a.currentDistance = targetDist;
        a.progressPercent = 100;
        try {
          await Activities.update(
            { status: "finished", netDistance: targetDist, currentDistance: targetDist, progressPercent: 100 },
            { where: { id: a.id } }
          );
        } catch {}
      }
    }

    userStore.updateActivitiesWhere(raceId, ["in_progress", "waiting", "paused"], { status: "out_of_time" });
    try {
      await Activities.update(
        { status: "out_of_time" },
        {
          where: {
            activityId: raceId,
            status: { [Op.in]: ["in_progress", "waiting", "paused"] }
          }
        }
      );
    } catch { /* ignore when DB offline */ }
    try {
      ranking = await this.finalizeRanking(raceId);
    } catch (err) {
      console.error(`[RaceManager] Unable to finalise race ${raceId}:`, err);
    }
    try {
      const dbStatus = isStopped ? "stopped" : (isCancelled ? "cancelled" : "finished");
      await Races.update({ status: dbStatus }, { where: { id: raceId } });
    } catch { /* ignore when DB offline */ }

    if (managed) {
      managed.finalRanking = ranking;
      if (managed.type === "PRIVATE_INVITE") {
        this.removePrivateRaceInternal(managed, managed.status);
      }
    }

    socketGateway.broadcastRaceStatus(raceId, managed?.status || "COMPLETED", {
      reason: reason || (timeoutTriggered ? "timeout" : "completed"),
      pauseSeconds: managed?.pauseEndsAt ? 120 : 0,
      pauseEndsAt: managed?.pauseEndsAt,
      ranking,
      roomClosed: managed?.type === "PRIVATE_INVITE" ? true : undefined
    });

    if (isPublic) {
      if (reason === "no_active_humans") {
        await this.initNextPublicRace(15);
      }
    }
    return ranking;
  }

  /**
   * Create Private Room with Google Meet style invite code (e.g. krm-wzx-qpl) + Alphanumeric PIN (5 chars)
   */
  public createPrivateRace(options: {
    title: string;
    targetDistance: number;
    maxParticipants?: number;
    maxDurationMinutes?: number;
    hostUserId: string;
    hostUserName?: string;
    startMode?: "manual" | "scheduled";
    scheduledStartTime?: Date | string;
    timezone?: string;
    countdownMinutes?: number;
    requireApproval?: boolean;
    botCount?: number;
    botMinPace?: number;
    botMaxPace?: number;
    botStartMode?: "countdown" | "first_stroke";
    isBotDuel?: boolean;
    isDuel1v1?: boolean;
    isSolo?: boolean;
    gameMode?: "solo" | "bot_duel" | "duel_1v1" | "multi";
    adminAsSpectator?: boolean;
    hostParticipates?: boolean;
    requiredLeague?: string;
    requiresSubscription?: boolean;
    botCustomName?: string;
  }): RaceState {
    const code = this.generateUniqueMeetCode();
    const pin = this.generateUniquePinCode();
    const raceId = `PRIV_${code.replace(/-/g, "")}`;
    const now = new Date();

    const rawMode = String((options as any).mode || (options as any).type || options.gameMode || "").trim().toLowerCase();
    const isSolo = Boolean(
      options.isSolo ||
      rawMode === "solo"
    );
    const isBotDuel = !isSolo && Boolean(
      options.isBotDuel ||
      rawMode === "bot_duel" ||
      rawMode === "duel_bot" ||
      rawMode === "1v1_bot"
    );
    const isDuel1v1 = !isSolo && !isBotDuel && Boolean(options.isDuel1v1 || rawMode === "duel_1v1" || rawMode === "duel");
    const gameMode: "solo" | "bot_duel" | "duel_1v1" | "multi" = isSolo
      ? "solo"
      : isBotDuel
      ? "bot_duel"
      : isDuel1v1
      ? "duel_1v1"
      : "multi";

    let cleanTitle = String(
      options.title ||
      (isSolo ? "Entraînement Solo" : isBotDuel ? "Duel 1v1 contre un Bot" : isDuel1v1 ? "Duel 1v1 Joueur" : "Régate Privée")
    )
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .slice(0, 64) || (isSolo ? "Entraînement Solo" : isBotDuel ? "Duel 1v1 contre un Bot" : "Régate Privée");

    const rawDist = Number(options.targetDistance);
    const maxDistLimit = isSolo || isBotDuel ? 10000 : 100000;
    const targetDistance = Number.isFinite(rawDist)
      ? Math.min(maxDistLimit, Math.max(100, Math.round(rawDist)))
      : (isSolo || isBotDuel ? 2000 : 2000);

    const rawMax = Number(options.maxParticipants);
    const maxParticipants = isSolo
      ? 1
      : isBotDuel || isDuel1v1
      ? 2
      : (Number.isFinite(rawMax) ? Math.min(30, Math.max(2, Math.round(rawMax))) : 8);

    const startMode: "manual" | "scheduled" = options.startMode === "scheduled" ? "scheduled" : "manual";
    let scheduledDate: Date | undefined;
    let autoStart = false;
    let lobbyEndsAt: Date;

    const targetTz = options.timezone || "Europe/Paris";
    if (startMode === "scheduled" && options.scheduledStartTime) {
      scheduledDate = parseDateTimeInTimezone(options.scheduledStartTime, targetTz);
      if (Number.isFinite(scheduledDate.getTime()) && scheduledDate.getTime() > now.getTime()) {
        lobbyEndsAt = scheduledDate;
        autoStart = true;
      } else {
        lobbyEndsAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 min par défaut
        autoStart = true;
      }
    } else {
      const rawCountdownMin = Number(options.countdownMinutes);
      const hasCountdown = Number.isFinite(rawCountdownMin) && rawCountdownMin > 0;
      if (hasCountdown) {
        const clampedCountdownMin = Math.min(180, rawCountdownMin);
        lobbyEndsAt = new Date(now.getTime() + clampedCountdownMin * 60 * 1000);
        autoStart = true;
      } else {
        // Mode manuel : L'organisateur donne le top départ quand il le décide
        lobbyEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        autoStart = false;
      }
    }

    const hostUserId = String(options.hostUserId || "anonymous").trim().slice(0, 64) || "anonymous";
    const hostUserName = options.hostUserName
      ? String(options.hostUserName).trim().slice(0, 64)
      : undefined;

    const isEmma = isEmmaAdminUser(hostUserId, hostUserName);
    const adminAsSpectator = isSolo || isBotDuel
      ? false
      : Boolean(options.adminAsSpectator !== undefined ? options.adminAsSpectator : isEmma);

    const requireApproval = (isSolo || isBotDuel || isDuel1v1 || adminAsSpectator)
      ? false
      : (options.requireApproval !== undefined ? Boolean(options.requireApproval) : true);
    const participants = new Map<string, PrivateParticipantInfo>();
    const pendingParticipants = new Map<string, PrivateParticipantInfo>();
    const rejectedParticipants = new Set<string>();

    const hostParticipates = isSolo || isBotDuel
      ? true
      : Boolean(options.hostParticipates !== undefined ? options.hostParticipates : !adminAsSpectator);
    if (!adminAsSpectator && hostParticipates && hostUserId && hostUserId !== "anonymous") {
      participants.set(hostUserId, {
        userId: hostUserId,
        userName: hostUserName || hostUserId,
        joinedAt: now,
        lane: 1,
        ready: false,
        pinValidated: false,
        connectionState: "PENDING_PIN"
      });
    }

    let botCount = isSolo ? 0 : isBotDuel ? 1 : Math.min(20, Math.max(0, Number(options.botCount) || 0));
    let botMinPace = Number.isFinite(Number(options.botMinPace)) ? Math.min(300, Math.max(60, Number(options.botMinPace))) : 165;
    let botMaxPace = Number.isFinite(Number(options.botMaxPace)) ? Math.min(300, Math.max(60, Number(options.botMaxPace))) : 120;
    let botCustomName = options.botCustomName;

    if (isBotDuel) {
      // Allure du bot : plage autorisée 1:45 (105 s) -> 2:45 (165 s) par 500m ; aléatoire si non fournie
      if (!options.botMaxPace || Number(options.botMaxPace) <= 0) {
        botMaxPace = Math.floor(Math.random() * (BOT_PACE_MAX - BOT_PACE_MIN + 1)) + BOT_PACE_MIN;
      }
      botMaxPace = Math.min(BOT_PACE_MAX, Math.max(BOT_PACE_MIN, Math.round(botMaxPace)));
      botMinPace = botMaxPace;
      let levelLabel = "Intermédiaire";
      if (botMaxPace <= 115) {
        levelLabel = "Expert";
      } else if (botMaxPace <= 135) {
        levelLabel = "Avancé";
      } else if (botMaxPace <= 150) {
        levelLabel = "Régulier";
      } else {
        levelLabel = "Loisir";
      }
      botCustomName = options.botCustomName || `Bot ${levelLabel}`;
      cleanTitle = `Duel 1v1 - ${botCustomName} (${targetDistance}m)`;
    } else if (isSolo) {
      botCount = 0;
      cleanTitle = `Solo - Entraînement (${targetDistance}m)`;
    }

    const privateRace: RaceState = {
      id: raceId,
      code,
      title: cleanTitle,
      type: "PRIVATE_INVITE",
      status: "LOBBY",
      targetDistance,
      maxParticipants,
      maxDurationMinutes: options.maxDurationMinutes || this.adminPrivateRaceConfig?.maxDurationMinutes || 55,
      lobbyEndsAt,
      pinCode: pin,
      hostUserId,
      originalHostUserId: hostUserId,
      botDuelSeatClaimed: false,
      hostUserName,
      startMode,
      scheduledStartTime: scheduledDate,
      timezone: targetTz,
      botCount,
      botMinPace,
      botMaxPace,
      botStartMode: (isBotDuel || isSolo) && options.botStartMode === "first_stroke"
        ? "first_stroke"
        : (isSolo && options.botStartMode === undefined ? "first_stroke" : (options.botStartMode || "countdown")),
      autoStart,
      hasBots: botCount > 0,
      isBotDuel,
      isDuel1v1,
      isSolo,
      gameMode,
      adminAsSpectator,
      hostParticipates,
      requiredLeague: options.requiredLeague,
      requiresSubscription: options.requiresSubscription,
      totalParticipants: participants.size,
      createdAt: now,
      requireApproval,
      participants,
      pendingParticipants,
      rejectedParticipants
    };

    this.privateRaces.set(code, privateRace);
    this.privateRacesById.set(raceId, privateRace);
    this.pinToRaceMap.set(pin.toUpperCase(), { raceId, lane: 1 });

    // Persistance dans la base SQL pour comptabilisation exacte des quotas hebdomadaires
    const maxDurationMinutes = options.maxDurationMinutes || this.adminPrivateRaceConfig?.maxDurationMinutes || 55;
    Races.create({
      id: raceId,
      title: cleanTitle,
      targetDistance,
      startTime: scheduledDate || now,
      intervalMinutes: 0,
      maxDurationMinutes,
      status: "waiting",
      totalParticipants: participants.size,
      hasBots: botCount > 0,
      hostUserId: options.hostUserId || undefined,
    }).catch((err: any) => {
      // Ignorer silencieusement si la DB n'est pas encore connectée ou en mode mémoire fallback
    });

    if (botCount > 0) {
      this.ensureSalonBots(raceId, botCount, botMaxPace, targetDistance, botCustomName, botMinPace).catch(() => {});
    }

    return privateRace;
  }

  /**
   * Reconstitue en mémoire vive (RAM) un salon de duel 1v1 à partir d'un défi persisté en base SQL.
   * Conserve à l'identique l'identifiant (PRIV_...), le code Meet (krm-wzx-qpl) et le code PIN montre Garmin.
   */
  public restoreDuelRaceFromChallenge(challenge: {
    id: string;
    roomId?: string;
    roomCode?: string;
    roomPin?: string;
    slotStart: Date | string;
    slotEnd: Date | string;
    targetDistance: number;
    title?: string;
    challengerUserId: string;
    challengerName?: string;
    challengerLogin?: string;
    status: string;
    timezone?: string;
  }): RaceState | null {
    if (!challenge.roomId || !challenge.roomCode) return null;

    // Déjà présent en mémoire
    if (this.privateRacesById.has(challenge.roomId)) {
      return this.privateRacesById.get(challenge.roomId)!;
    }
    const normalizedCode = RaceManager.normalizeMeetCode(challenge.roomCode);
    if (normalizedCode && this.privateRaces.has(normalizedCode)) {
      return this.privateRaces.get(normalizedCode)!;
    }
    if (this.privateRaces.has(challenge.roomCode)) {
      return this.privateRaces.get(challenge.roomCode)!;
    }

    const now = new Date();
    const scheduledStart = new Date(challenge.slotStart);
    const scheduledEnd = new Date(challenge.slotEnd);

    // Si le créneau est dépassé ou que le duel est déjà clos/refusé/annulé, ne pas réhydrater
    if (
      (Number.isFinite(scheduledEnd.getTime()) && scheduledEnd.getTime() <= now.getTime()) ||
      !["PENDING", "ACCEPTED"].includes(challenge.status)
    ) {
      return null;
    }

    const participants = new Map<string, PrivateParticipantInfo>();
    const pin = (challenge.roomPin || this.generateUniquePinCode()).toUpperCase();

    const restoredRace: RaceState = {
      id: challenge.roomId,
      code: challenge.roomCode,
      pinCode: pin,
      type: "PRIVATE_INVITE",
      status: "LOBBY",
      startMode: "scheduled",
      scheduledStartTime: scheduledStart,
      lobbyEndsAt: scheduledStart,
      autoStart: true,
      startedAt: undefined,
      endedAt: undefined,
      title: challenge.title || `Duel 1v1`,
      targetDistance: challenge.targetDistance || 2000,
      maxParticipants: 2,
      maxDurationMinutes: 55,
      hostUserId: challenge.challengerUserId,
      originalHostUserId: challenge.challengerUserId,
      hostUserName: challenge.challengerName || challenge.challengerLogin,
      isSolo: false,
      isBotDuel: false,
      isDuel1v1: true,
      gameMode: "duel_1v1",
      hostParticipates: true,
      totalParticipants: 0,
      createdAt: now,
      requireApproval: false,
      participants,
      pendingParticipants: new Map(),
      rejectedParticipants: new Set(),
    };

    this.privateRaces.set(challenge.roomCode, restoredRace);
    if (normalizedCode) {
      this.privateRaces.set(normalizedCode, restoredRace);
    }
    this.privateRacesById.set(challenge.roomId, restoredRace);
    this.pinToRaceMap.set(pin, { raceId: challenge.roomId, lane: 1 });

    return restoredRace;
  }

  private async ensureSalonBots(
    raceId: string,
    botCount: number,
    botMaxPace: number,
    targetDistance: number,
    customName?: string,
    botMinPace?: number
  ): Promise<void> {
    const names = [
      "Bot Challenger", "Bot Pacer", "Bot Tempo", "Bot Shadow",
      "Bot Swift", "Bot Titan", "Bot Veloce", "Bot Atlas", "Bot Orion", "Bot Phoenix",
      "Bot Lynx", "Bot Neptune", "Bot Zephyr", "Bot Sirius", "Bot Pulsar"
    ];
    const race = this.getRaceById(raceId) || this.findPrivateRace(raceId);
    if (race && !race.participants) {
      race.participants = new Map();
    }

    const minP = Math.min(Number(botMinPace) || 165, Number(botMaxPace) || 105);
    const maxP = Math.max(Number(botMinPace) || 165, Number(botMaxPace) || 105);

    for (let i = 0; i < botCount; i++) {
      const botId = `bot_salon_${i + 1}`;
      const compositeId = `${raceId}_${botId}`;
      const name = customName && botCount === 1 ? customName : (customName ? `${customName} ${i + 1}` : names[i % names.length]);

      let botPace: number;
      if (race?.isBotDuel || (botCount === 1 && !botMinPace)) {
        botPace = botMaxPace && botMaxPace > 0 ? Math.max(BOT_PACE_MIN, Math.min(BOT_PACE_MAX, botMaxPace)) : generateRealisticBotPace();
      } else {
        // Tirage aléatoire uniforme au sein de la plage [minP, maxP] définie par l'organisateur
        botPace = Math.floor(minP + Math.random() * (maxP - minP + 1));
      }
      const { power, spm, speedMs } = calculateBotPhysics(botPace);

      let assignedBotLane = race?.isBotDuel ? 2 : 1;
      if (race && race.participants) {
        if (race.participants.has(botId)) {
          assignedBotLane = race.participants.get(botId)!.lane || (race.isBotDuel ? 2 : 1);
        } else {
          const usedLanes = new Set<number>();
          if (race.isBotDuel) {
            usedLanes.add(1); // Couloir 1 réservé pour l'utilisateur humain
          }
          for (const p of race.participants.values()) {
            if (p.lane && p.lane > 0) usedLanes.add(p.lane);
          }
          while (usedLanes.has(assignedBotLane)) {
            assignedBotLane++;
          }
          race.participants.set(botId, {
            userId: botId,
            userName: name,
            joinedAt: new Date(),
            lane: assignedBotLane,
            ready: true,
            connectionState: "READY"
          });
        }
      }

      const botDefaults = {
        id: compositeId,
        activityId: raceId,
        userId: botId,
        userName: name,
        lane: assignedBotLane,
        isBot: true,
        raceMode: "race",
        targetDistance,
        status: "waiting",
        initialDistance: 0,
        currentDistance: 0,
        netDistance: 0,
        progressPercent: 0,
        lastStrokeRate: spm,
        lastStrokeCount: 0,
        lastHeartRate: 155,
        lastResistance: 4,
        totalStrokes: 0,
        totalEnergy: 0,
        lastPower: power,
        lastPace: botPace,
        avgPower: power,
        avgPace: botPace,
        avgStrokeRate: spm,
        elapsedTime: 0,
        avgSpeedKmh: Number((speedMs * 3.6).toFixed(1)),
      };
      userStore.recordActivity(botDefaults);
      Activities.upsert(botDefaults as any).catch(() => {});
    }
  }

  /**
   * Permet à l'organisateur de modifier le nombre et les allures des bots dans un salon privé
   */
  public async updateSalonBots(
    raceId: string,
    botCount: number,
    botMinPace?: number,
    botMaxPace?: number
  ): Promise<RaceState | null> {
    const race = this.getRaceById(raceId) || this.findPrivateRace(raceId);
    if (!race) return null;
    if (race.status === "RUNNING" || race.status === "COUNTDOWN") {
      return null;
    }

    const clampedCount = Math.max(0, Math.min(20, Math.floor(Number(botCount) || 0)));
    race.botCount = clampedCount;
    race.hasBots = clampedCount > 0;
    if (botMinPace !== undefined) race.botMinPace = botMinPace;
    if (botMaxPace !== undefined) race.botMaxPace = botMaxPace;

    // Supprimer les bots existants du salon
    if (race.participants) {
      for (const [pId, p] of Array.from(race.participants.entries())) {
        if (pId.startsWith("bot_") || (p as any).isBot) {
          race.participants.delete(pId);
          userStore.deleteActivityById(`${race.id}_${pId}`);
        }
      }
    }

    try {
      await Activities.destroy({
        where: {
          activityId: race.id,
          isBot: true
        }
      });
    } catch {}

    if (clampedCount > 0) {
      await this.ensureSalonBots(
        race.id,
        clampedCount,
        race.botMaxPace || 120,
        race.targetDistance || 2000,
        undefined,
        race.botMinPace
      );
    }

    // Recalculer le total des participants
    race.totalParticipants = race.participants ? race.participants.size : 1;

    try {
      await Races.update(
        { hasBots: race.hasBots, totalParticipants: race.totalParticipants },
        { where: { id: race.id } }
      );
    } catch {}

    socketGateway.broadcastPrivateRoomUpdate(race.id, race);
    return race;
  }

  public getRaceByPin(pin: string): { raceId: string; lane: number; race?: RaceState } | null {
    if (!pin) return null;
    const cleanPin = String(pin).trim().toUpperCase();
    const matched = this.pinToRaceMap.get(cleanPin);
    if (!matched) return null;
    const race = this.getRaceById(matched.raceId) || this.findPrivateRace(matched.raceId) || undefined;
    let assignedLane = matched.lane || 1;
    if (race && race.participants) {
      const usedLanes = new Set<number>();
      for (const p of race.participants.values()) {
        if (p.lane && p.connectionState !== "PENDING_PIN" && p.pinValidated !== false) {
          usedLanes.add(p.lane);
        }
      }
      while (usedLanes.has(assignedLane)) {
        assignedLane++;
      }
    }
    return { ...matched, lane: assignedLane, race };
  }

  public getCurrentPublicRace(): RaceState | null {
    return this.currentPublicRace;
  }

  public isRacerActive(userId: string): boolean {
    if (!userId) return false;
    const pub = this.getCurrentPublicRace();
    if (pub && pub.participants && pub.participants.has(userId)) return true;
    for (const priv of this.privateRacesById.values()) {
      if (priv.status === "RUNNING" || priv.status === "LOBBY") {
        if (priv.participants && priv.participants.has(userId)) return true;
        if (priv.hostUserId === userId) return true;
      }
    }
    return false;
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
   * Resolves a private salon by Meet code (with or without dashes, case-insensitive), raceId (PRIV_...), or Alphanumeric PIN
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

    // 3. Alphanumeric PIN (4 to 8 characters, case-insensitive) or Guest Boarding Ticket
    if (/^[a-zA-Z0-9]{4,8}$/.test(trimmed)) {
      const upper = trimmed.toUpperCase();
      const ticketHit = this.guestTicketsByPin.get(upper);
      if (ticketHit && ticketHit.expiresAt.getTime() > Date.now()) {
        const priv = this.privateRacesById.get(ticketHit.roomId);
        if (priv && priv.status !== "ABANDONED") return priv;
      }
      const pinHit = this.pinToRaceMap.get(upper);
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
      const isHostMatch = Boolean(
        cleanHost && (race.hostUserId === cleanHost || race.originalHostUserId === cleanHost)
      );
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

  public getAllActivePrivateRaces(): RaceState[] {
    const list: RaceState[] = [];
    for (const race of this.privateRacesById.values()) {
      if (race.status === "ABANDONED" || race.status === "CANCELLED") continue;
      list.push(race);
    }
    return list.sort((a, b) => {
      const ta = a.createdAt ? a.createdAt.getTime() : 0;
      const tb = b.createdAt ? b.createdAt.getTime() : 0;
      return tb - ta;
    });
  }

  public purgeInactivePrivateRaces(maxAgeMinutes: number = 60): number {
    const now = Date.now();
    let purged = 0;
    for (const race of Array.from(this.privateRacesById.values())) {
      const ageMs = race.createdAt ? now - race.createdAt.getTime() : 0;
      const humanCount = race.participants ? Array.from(race.participants.values()).filter(p => !p.userId.startsWith("bot_")).length : 0;
      
      // Si la course est abandonnée, terminée, ou en LOBBY depuis plus de maxAgeMinutes avec 0 participant actif
      if (
        race.status === "ABANDONED" ||
        race.status === "CANCELLED" ||
        race.status === "COMPLETED" ||
        (race.status === "LOBBY" && (ageMs > maxAgeMinutes * 60 * 1000 || humanCount === 0 && ageMs > 15 * 60 * 1000))
      ) {
        this.removePrivateRaceInternal(race);
        purged++;
      }
    }
    return purged;
  }

  /**
   * Trouve la course privée ou le duel actif pour un utilisateur ou sa montre (deviceToken).
   * Renvoie :
   * 1. Une course en cours (RUNNING ou COUNTDOWN) où l'utilisateur n'a pas abandonné ni quitté.
   * 2. Une course programmée imminente (départ <= 15 min ou déjà ouverte) où l'utilisateur est présent (hôte ou inscrit).
   *    Si plusieurs courses sont éligibles, priorité au départ le plus proche chronologiquement.
   * 3. Une course ouverte (LOBBY).
   * 4. Une course terminée (COMPLETED) tant que le joueur n'a pas quitté le salon (hasLeft !== true) et n'a pas abandonné.
   */
  public findActiveRaceForUser(userId?: string, deviceToken?: string): RaceState | null {
    const cleanUserId = userId ? String(userId).trim() : "";
    const cleanToken = deviceToken ? String(deviceToken).trim() : "";
    if (!cleanUserId && !cleanToken) return null;

    // Tentative de restauration d'un duel imminent non encore en RAM
    if (cleanUserId) {
      try {
        const duelSvc = require("./duel.service").default;
        if (duelSvc && typeof duelSvc.getUpcomingChallengesForUser === "function") {
          const upcomingChallenges = duelSvc.getUpcomingChallengesForUser(cleanUserId);
          const nowMs = Date.now();
          for (const ch of upcomingChallenges) {
            if (ch.roomId && !this.privateRacesById.has(ch.roomId)) {
              const startMs = new Date(ch.slotStart).getTime();
              const endMs = new Date(ch.slotEnd).getTime();
              if (Number.isFinite(startMs) && Number.isFinite(endMs) && nowMs <= endMs) {
                const diffMs = startMs - nowMs;
                if (diffMs <= 15 * 60 * 1000) {
                  this.restoreDuelRaceFromChallenge(ch);
                }
              }
            }
          }
        }
      } catch {}
    }

    const races = Array.from(this.privateRacesById.values());
    const nowMs = Date.now();

    // Catégories de courses
    const runningRaces: RaceState[] = [];
    const scheduledUpcomingRaces: { race: RaceState; scheduledMs: number }[] = [];
    const openLobbyRaces: RaceState[] = [];
    const completedRaces: RaceState[] = [];

    for (let i = races.length - 1; i >= 0; i--) {
      const race = races[i];
      if (
        race.status === "STOPPED" ||
        race.status === "CANCELLED" ||
        race.status === "ABANDONED"
      ) {
        continue;
      }

      // Recherche du participant associé à cet utilisateur ou token
      let participant: PrivateParticipantInfo | null = null;
      if (race.participants) {
        for (const [pUserId, p] of race.participants.entries()) {
          if (cleanUserId && (pUserId === cleanUserId || p.userId === cleanUserId)) {
            participant = p;
            break;
          }
          if (cleanToken && p.deviceToken === cleanToken) {
            participant = p;
            break;
          }
        }
      }

      if (!participant && race.pendingParticipants) {
        for (const [pUserId, p] of race.pendingParticipants.entries()) {
          if (cleanUserId && (pUserId === cleanUserId || p.userId === cleanUserId)) {
            participant = p;
            break;
          }
          if (cleanToken && p.deviceToken === cleanToken) {
            participant = p;
            break;
          }
        }
      }

      const isHost = Boolean(cleanUserId && (race.hostUserId === cleanUserId || race.originalHostUserId === cleanUserId));

      if (!participant && !isHost) {
        continue;
      }

      // Si le participant ou l'hôte a déjà quitté ou abandonné
      if (participant) {
        if (participant.hasLeft === true || participant.status === "abandoned") {
          continue;
        }
      } else if (isHost) {
        if (race.hostHasLeft === true) {
          continue;
        }
      }

      // 1. Course en direct
      if (race.status === "RUNNING" || race.status === "COUNTDOWN") {
        runningRaces.push(race);
        continue;
      }

      // 2. Course programmée (startMode === 'scheduled')
      if (race.startMode === "scheduled" && race.scheduledStartTime) {
        const scheduledMs = new Date(race.scheduledStartTime).getTime();
        const diffMs = scheduledMs - nowMs;

        if (race.status === "COMPLETED") {
          completedRaces.push(race);
        } else if (diffMs >= -15 * 60 * 1000 && diffMs <= 15 * 60 * 1000) {
          // Imminente (dans <= 15 min ou jusqu'à 15 min après l'heure si encore en LOBBY)
          scheduledUpcomingRaces.push({ race, scheduledMs });
        }
        continue;
      }

      // 3. Course terminée
      if (race.status === "COMPLETED") {
        completedRaces.push(race);
        continue;
      }

      // 4. Salon ouvert (LOBBY)
      if (race.status === "LOBBY") {
        openLobbyRaces.push(race);
        continue;
      }
    }

    // Priorité 1 : Course en direct
    if (runningRaces.length > 0) {
      return runningRaces[0];
    }

    // Priorité 2 : Course programmée imminente (triée par heure de départ la plus proche de maintenant)
    if (scheduledUpcomingRaces.length > 0) {
      scheduledUpcomingRaces.sort((a, b) => Math.abs(a.scheduledMs - nowMs) - Math.abs(b.scheduledMs - nowMs));
      return scheduledUpcomingRaces[0].race;
    }

    // Priorité 3 : Salon ouvert (LOBBY)
    if (openLobbyRaces.length > 0) {
      return openLobbyRaces[0];
    }

    // Priorité 4 : Course terminée non quittée
    if (completedRaces.length > 0) {
      return completedRaces[0];
    }

    return null;
  }

  /**
   * Compte le nombre de salons privés actifs (en attente ou en cours) ouverts par un hôte
   */
  public getActiveRoomsCount(hostUserId: string): number {
    const cleanHost = hostUserId ? hostUserId.trim() : "";
    if (!cleanHost || cleanHost === "anonymous") return 0;
    let count = 0;
    for (const race of this.privateRacesById.values()) {
      if (race.status === "COMPLETED" || race.status === "ABANDONED") continue;
      const isHost = race.hostUserId === cleanHost || race.originalHostUserId === cleanHost;
      if (isHost && (race.status === "LOBBY" || race.status === "COUNTDOWN" || race.status === "RUNNING")) {
        count++;
      }
    }
    return count;
  }

  /**
   * Calcule le début de la semaine calendaire en cours (Lundi 00:00:00.000 UTC)
   */
  public static getStartOfWeek(date: Date = new Date()): Date {
    const d = new Date(date);
    const day = d.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Ajuster pour le lundi
    const monday = new Date(d.setUTCDate(diff));
    monday.setUTCHours(0, 0, 0, 0);
    return monday;
  }

  /**
   * Compte le nombre de salons créés par l'utilisateur depuis le début de la semaine
   */
  public async getWeeklyRoomsCount(hostUserId: string): Promise<number> {
    const cleanHost = hostUserId ? hostUserId.trim() : "";
    if (!cleanHost || cleanHost === "anonymous") return 0;

    const startOfWeek = RaceManager.getStartOfWeek();

    // 1. Dénombrement dans la mémoire vive
    const memoryCountIds = new Set<string>();
    for (const race of this.privateRacesById.values()) {
      const isHost = race.hostUserId === cleanHost || race.originalHostUserId === cleanHost;
      if (isHost && race.createdAt && race.createdAt >= startOfWeek) {
        memoryCountIds.add(race.id);
      }
    }

    // 2. Dénombrement dans la persistance DB si disponible
    try {
      const dbRaces = await Races.findAll({
        where: {
          hostUserId: cleanHost,
          createdAt: {
            [Op.gte]: startOfWeek,
          },
        },
        attributes: ["id"],
      });
      for (const r of dbRaces) {
        const idVal = (r as any).id || (r as any).get?.("id");
        if (idVal) memoryCountIds.add(String(idVal));
      }
    } catch {
      // Si la DB n'est pas accessible, la mémoire vive fait foi
    }

    return memoryCountIds.size;
  }

  public joinPrivateRace(
    identifier: string,
    userId: string,
    userName?: string,
    country?: string,
    options?: {
      isSubscriber?: boolean;
      isAdmin?: boolean;
      userRole?: string;
      userLeague?: string;
      isDeviceAuthenticated?: boolean;
      viaPin?: boolean;
      sameAccountAsHost?: boolean;
      fallbackUserId?: string;
      ready?: boolean;
      socketId?: string;
      deviceToken?: string;
      bypassApproval?: boolean;
    }
  ): { race: RaceState; lane: number; alreadyJoined: boolean; pending?: boolean; rejected?: boolean; ready?: boolean; connectionState?: "CONNECTED" | "READY" } | { error: string; statusCode: number } {
    const race = this.findPrivateRace(identifier);
    if (!race) {
      return { error: "Salon privé introuvable ou expiré.", statusCode: 404 };
    }

    if (!race.participants) {
      race.participants = new Map();
    }
    if (!race.pendingParticipants) {
      race.pendingParticipants = new Map();
    }
    if (!race.rejectedParticipants) {
      race.rejectedParticipants = new Set();
    }

    const cleanUserId = String(userId || "anonymous").trim().slice(0, 64) || "anonymous";
    const cleanName = String(userName || `Racer_${cleanUserId.slice(-4)}`).trim().slice(0, 64);
    const cleanFallbackId = options?.fallbackUserId ? String(options.fallbackUserId).trim() : "";

    if (race.rejectedParticipants.has(cleanUserId)) {
      return { error: "Votre demande de participation a été refusée par l'hôte.", statusCode: 403, rejected: true };
    }

    if (race.status === "COMPLETED" || race.status === "ABANDONED") {
      return { error: "Ce salon est déjà terminé.", statusCode: 410 };
    }

    let alreadyApproved = race.participants.has(cleanUserId);
    let isHost = Boolean(
      (cleanUserId && race.hostUserId && cleanUserId.toLowerCase() === race.hostUserId.toLowerCase()) ||
      (cleanUserId && race.originalHostUserId && cleanUserId.toLowerCase() === race.originalHostUserId.toLowerCase()) ||
      (cleanFallbackId && race.hostUserId && cleanFallbackId.toLowerCase() === race.hostUserId.toLowerCase()) ||
      (cleanFallbackId && race.originalHostUserId && cleanFallbackId.toLowerCase() === race.originalHostUserId.toLowerCase()) ||
      (cleanName && race.hostUserName && cleanName.toLowerCase() === race.hostUserName.toLowerCase()) ||
      options?.sameAccountAsHost
    );

    // En mode Duel 1v1 Bot, le créateur est le seul compétiteur humain attendu.
    // Si le créateur rejoint depuis sa montre Garmin (authentifiée par deviceToken ou via le code PIN sur un salon créé en session web),
    // rattacher immédiatement son identifiant de montre au siège Ligne 1 du créateur.
    if (race.isBotDuel && !isHost && !alreadyApproved) {
      const currentHost = String(race.hostUserId || "");
      const isWebSessionHost =
        !currentHost ||
        currentHost === "anonymous" ||
        currentHost.startsWith("guest_") ||
        currentHost.startsWith("usr_");
      const canClaimCreatorSeat =
        !race.botDuelSeatClaimed &&
        (Boolean(options?.isDeviceAuthenticated) || (isWebSessionHost && Boolean(options?.viaPin)));

      if (canClaimCreatorSeat) {
        isHost = true;
      }
    }

    if (race.isBotDuel && isHost) {
      const oldHostId = race.hostUserId;
      if (!race.originalHostUserId && oldHostId) {
        race.originalHostUserId = oldHostId;
      }
      if (oldHostId && oldHostId !== cleanUserId && race.participants.has(oldHostId)) {
        const oldEntry = race.participants.get(oldHostId);
        race.participants.delete(oldHostId);
        race.participants.set(cleanUserId, {
          userId: cleanUserId,
          userName: cleanName || oldEntry?.userName || race.hostUserName || cleanUserId,
          joinedAt: oldEntry?.joinedAt || new Date(),
          country: country || oldEntry?.country,
          lane: 1
        });
      }
      race.hostUserId = cleanUserId;
      race.botDuelSeatClaimed = true;
      alreadyApproved = race.participants.has(cleanUserId);
    }

    // Exception Administrateur : le créateur avec rôle Admin peut agir en pur régulateur/spectateur sans occuper de ligne d'eau (hors Duel 1v1 Bot)
    if (!race.isBotDuel && race.adminAsSpectator && (isHost || options?.isAdmin)) {
      return { race, lane: 0, alreadyJoined: true, pending: false };
    }

    // 1. Salon "Duel contre un Bot" : strictement réservé au joueur qui a créé le salon
    if (race.isBotDuel && !isHost && !alreadyApproved) {
      return { error: "Ce duel contre un bot est réservé à son créateur", statusCode: 403 };
    }

    // 2. Salon "Duel 1 contre 1" (Joueur vs Joueur) : capacité maximale fixée à 2 joueurs (créateur + 1 invité)
    const isDuel1v1 = Boolean(race.isDuel1v1);
    if (isDuel1v1 && !alreadyApproved && race.participants.size >= 2) {
      return { error: "Salon complet - quota atteint", statusCode: 409 };
    }

    // Contrôle de la jauge maximale permise par l'abonnement de l'organisateur
    if (!alreadyApproved && !isHost && race.organizerCapacity && race.participants.size >= race.organizerCapacity) {
      return { error: "Capacité maximale atteinte pour ce salon", statusCode: 409 };
    }

    // 3. Salon Régate Multijoueur / Privé standard : contrôle quota maximum de lignes d'eau
    if (!alreadyApproved && race.participants.size >= race.maxParticipants) {
      return { error: "Salon complet - quota atteint", statusCode: 409 };
    }

    if (race.status === "RUNNING" && !alreadyApproved && !isHost) {
      return { error: "Cette course a déjà été lancée.", statusCode: 410 };
    }

    // 4. Contrôle du profil du joueur et prérequis (niveau de ligue, abonnement)
    if (race.requiresSubscription && !options?.isSubscriber && !isHost && !options?.isAdmin) {
      return { error: "Abonnement requis pour ce salon", statusCode: 403 };
    }
    if (race.requiredLeague && !isHost && !options?.isAdmin) {
      const eligible = isLeagueEligible(options?.userLeague, undefined, race.requiredLeague);
      if (!eligible) {
        return { error: `Niveau de ligue insuffisant pour ce salon (requis : ${race.requiredLeague})`, statusCode: 403 };
      }
    }

    // 5. Attribution automatique et immédiate d'une ligne d'eau unique (Lane 1, Lane 2, etc.)
    let assignedLane = 1;
    if (race.isBotDuel) {
      // En Duel 1v1 Bot, le joueur humain est sur la Ligne d'eau 1 et le Bot sur la Ligne d'eau 2
      assignedLane = 1;
      race.botCount = Math.max(1, race.botCount || 1);
      race.hasBots = true;
      this.ensureSalonBots(race.id, race.botCount, race.botMaxPace || 125, race.targetDistance, undefined, race.botMinPace).catch(() => {});
    } else if (alreadyApproved) {
      const existing = race.participants.get(cleanUserId);
      assignedLane = existing?.lane || 1;
      if (existing) {
        if (options?.viaPin) existing.pinValidated = true;
        if (options?.deviceToken) existing.deviceToken = options.deviceToken;
        if (options?.socketId) existing.socketId = options.socketId;
      }
    } else {
      const usedLanes = new Set<number>();
      for (const p of race.participants.values()) {
        if (p.lane && p.connectionState !== "PENDING_PIN" && p.pinValidated !== false) {
          usedLanes.add(p.lane);
        }
      }
      if (race.pendingParticipants) {
        for (const p of race.pendingParticipants.values()) {
          if (p.lane) usedLanes.add(p.lane);
        }
      }
      while (usedLanes.has(assignedLane)) {
        assignedLane++;
      }
    }

    // If host requires approval, player is not host, and not yet approved -> put in pending queue
    if (race.requireApproval && !isHost && !alreadyApproved && !options?.bypassApproval) {
      const pendingInfo: PrivateParticipantInfo = {
        userId: cleanUserId,
        userName: cleanName,
        joinedAt: new Date(),
        country,
        lane: assignedLane
      };
      race.pendingParticipants.set(cleanUserId, pendingInfo);
      socketGateway.broadcastPrivateRoomUpdate(race.id, {
        type: "PARTICIPANT_PENDING",
        userId: cleanUserId,
        userName: cleanName,
        lane: assignedLane
      });
      return { race, lane: assignedLane, alreadyJoined: false, pending: true };
    }

    // Moving to approved: remove from pending
    race.pendingParticipants.delete(cleanUserId);

    const isReady = options?.ready !== undefined
      ? Boolean(options.ready)
      : (Boolean(options?.viaPin) && race.isBotDuel && race.botStartMode !== "first_stroke" ? true : false);
    const connectionState: "CONNECTED" | "READY" = isReady ? "READY" : "CONNECTED";
    const isPinValidated = options?.viaPin !== undefined ? Boolean(options.viaPin) : true;

    race.participants.set(cleanUserId, {
      userId: cleanUserId,
      userName: cleanName,
      joinedAt: new Date(),
      country,
      lane: assignedLane,
      ready: isReady,
      pinValidated: isPinValidated,
      connectionState,
      socketId: options?.socketId,
      deviceToken: options?.deviceToken
    });
    race.totalParticipants = Math.max(race.totalParticipants || 0, race.participants.size);
    if (race.pinCode) {
      this.pinToRaceMap.set(race.pinCode.toUpperCase(), { raceId: race.id, lane: assignedLane });
    }

    const allParticipantsReady = race.participants.size > 0 && Array.from(race.participants.values()).every((p) => Boolean(p.ready));

    // 4. Logiques de départ
    // Duel 1v1 Joueur vs Joueur : déclenchement automatique du décompte de 15 s dès que les 2 joueurs sont READY sur leur ligne
    if (isDuel1v1 && race.participants.size === 2 && allParticipantsReady && race.status === "LOBBY") {
      const startNow = new Date();
      race.status = "COUNTDOWN";
      race.autoStart = true;
      race.lobbyEndsAt = new Date(startNow.getTime() + 15 * 1000);
      socketGateway.broadcastRaceStatus(race.id, "COUNTDOWN", {
        lobbyEndsAt: race.lobbyEndsAt,
        secondsUntilStart: 15,
        countdownSeconds: 15
      });
    } else if (race.isBotDuel && race.botStartMode !== "first_stroke" && (options?.viaPin || options?.isDeviceAuthenticated) && race.status === "LOBBY") {
      const startNow = new Date();
      race.status = "COUNTDOWN";
      race.autoStart = true;
      race.lobbyEndsAt = new Date(startNow.getTime() + 15 * 1000);
      socketGateway.broadcastRaceStatus(race.id, "COUNTDOWN", {
        lobbyEndsAt: race.lobbyEndsAt,
        secondsUntilStart: 15,
        countdownSeconds: 15
      });
    }

    return {
      race,
      lane: assignedLane,
      alreadyJoined: alreadyApproved,
      pending: false,
      ready: isReady,
      connectionState
    };
  }

  /**
   * Parcours 2 : Génère un Ticket Invité à 5 caractères pour un salon privé (valide 10 min)
   * Réserve immédiatement une ligne d'eau libre dans le salon en état CONNECTED (ready = false)
   */
  public createGuestTicket(
    identifier: string,
    guestName?: string,
    socketId?: string,
    existingUserId?: string,
    country?: string
  ): { ticket: GuestBoardingTicket; race: RaceState } | { error: string; statusCode: number } {
    const race = this.findPrivateRace(identifier);
    if (!race) {
      return { error: "Salon privé introuvable ou expiré.", statusCode: 404 };
    }
    if (race.status === "COMPLETED" || race.status === "ABANDONED") {
      return { error: "Ce salon est déjà terminé.", statusCode: 410 };
    }

    if (!race.participants) {
      race.participants = new Map();
    }

    const cleanGuestName =
      String(guestName || "").trim().slice(0, 32) ||
      `Rameur_${Math.floor(Math.random() * 90 + 10)}`;
    const cleanUserId =
      existingUserId && String(existingUserId).trim() && String(existingUserId).trim() !== "anonymous"
        ? String(existingUserId).trim()
        : `guest_${Math.random().toString(36).slice(2, 8)}`;

    const joinRes = this.joinPrivateRace(race.id, cleanUserId, cleanGuestName, country, {
      ready: false,
      socketId,
      viaPin: false,
      bypassApproval: true
    });
    if ("error" in joinRes) {
      return joinRes;
    }

    const ticketPin = this.generateUniquePinCode(race.pinCode);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const ticket: GuestBoardingTicket = {
      ticketPin,
      roomId: race.id,
      guestName: cleanGuestName,
      userId: cleanUserId,
      socketId,
      lane: joinRes.lane,
      expiresAt
    };

    this.guestTicketsByPin.set(ticketPin.toUpperCase(), ticket);
    return { ticket, race };
  }

  /**
   * Parcours 2 : Validation atomique du Ticket Invité 5 caractères saisi sur la montre Garmin
   */
  public getGuestTicket(ticketPin: string): GuestBoardingTicket | null {
    if (!ticketPin) return null;
    const clean = String(ticketPin).trim().toUpperCase();
    const ticket = this.guestTicketsByPin.get(clean);
    if (!ticket) return null;
    if (ticket.expiresAt.getTime() < Date.now()) {
      this.guestTicketsByPin.delete(clean);
      return null;
    }
    return ticket;
  }

  /**
   * Machine à états BLE : Met à jour le statut READY d'un compétiteur dans le salon
   * Déclenche le compte à rebours de 15 s si les conditions du mode de jeu sont réunies
   */
  public setParticipantReadyStatus(
    identifier: string,
    userIdOrTokenUser: string | undefined,
    ready: boolean
  ): {
    race: RaceState;
    participant?: PrivateParticipantInfo;
    countdownTriggered: boolean;
    allReady: boolean;
    waitingStatusMessage: string;
  } | { error: string; statusCode: number } {
    const race = this.findPrivateRace(identifier) || this.getRaceById(identifier);
    if (!race) {
      return { error: "Salon introuvable ou expiré.", statusCode: 404 };
    }
    if (!race.participants) {
      race.participants = new Map();
    }

    let targetParticipant: PrivateParticipantInfo | undefined;
    const cleanUser = userIdOrTokenUser ? String(userIdOrTokenUser).trim() : "";

    if (cleanUser && race.participants.has(cleanUser)) {
      targetParticipant = race.participants.get(cleanUser);
    } else if (cleanUser) {
      for (const p of race.participants.values()) {
        if (p.userId.toLowerCase() === cleanUser.toLowerCase() || p.deviceToken === cleanUser) {
          targetParticipant = p;
          break;
        }
      }
    }

    // Si un seul participant humain (ex: Duel contre un Bot) et userId non fourni, cibler ce participant
    if (!targetParticipant && race.participants.size === 1) {
      targetParticipant = Array.from(race.participants.values())[0];
    }

    if (targetParticipant) {
      targetParticipant.ready = Boolean(ready);
      targetParticipant.connectionState = ready ? "READY" : "CONNECTED";
      race.participants.set(targetParticipant.userId, targetParticipant);
    } else if (cleanUser) {
      targetParticipant = {
        userId: cleanUser,
        userName: `Rameur_${cleanUser.slice(-4)}`,
        joinedAt: new Date(),
        lane: 1,
        ready: Boolean(ready),
        connectionState: ready ? "READY" : "CONNECTED"
      };
      race.participants.set(cleanUser, targetParticipant);
    }

    const participantsList = Array.from(race.participants.values());
    const allReady =
      participantsList.length > 0 && participantsList.every((p) => Boolean(p.ready));

    let countdownTriggered = false;
    const now = new Date();

    if (race.status === "LOBBY" && ready) {
      // Mode 1 : Duel 1v1 Joueur vs Joueur -> dès que les DEUX joueurs humains sont à l'état READY, décompte 15s automatique
      if (race.isDuel1v1 && race.participants.size === 2 && allReady) {
        race.status = "COUNTDOWN";
        race.autoStart = true;
        race.lobbyEndsAt = new Date(now.getTime() + 15 * 1000);
        countdownTriggered = true;
        socketGateway.broadcastRaceStatus(race.id, "COUNTDOWN", {
          lobbyEndsAt: race.lobbyEndsAt,
          secondsUntilStart: 15,
          countdownSeconds: 15,
          reason: "both_players_ble_ready"
        });
      }
      // Mode 2 : Salon Privé programmé -> si l'heure programmée (-15s) est déjà atteinte et que tous les compétiteurs passent à READY
      else if (race.startMode === "scheduled" && race.scheduledStartTime && allReady) {
        const msUntilScheduled = race.scheduledStartTime.getTime() - now.getTime();
        if (msUntilScheduled <= 15000) {
          const countdownSec = msUntilScheduled > 0 ? Math.max(1, Math.ceil(msUntilScheduled / 1000)) : 15;
          race.status = "COUNTDOWN";
          race.autoStart = true;
          race.lobbyEndsAt = new Date(now.getTime() + countdownSec * 1000);
          countdownTriggered = true;
          socketGateway.broadcastRaceStatus(race.id, "COUNTDOWN", {
            lobbyEndsAt: race.lobbyEndsAt,
            secondsUntilStart: countdownSec,
            countdownSeconds: countdownSec,
            reason: "scheduled_all_players_ble_ready"
          });
        }
      }
    }

    const waitingStatusMessage = getWaitingStatusMessage(race, now);

    socketGateway.broadcastPrivateRoomUpdate(race.id, {
      type: "PARTICIPANT_STATUS_UPDATED",
      userId: targetParticipant?.userId,
      userName: targetParticipant?.userName,
      lane: targetParticipant?.lane,
      ready: Boolean(ready),
      connectionState: ready ? "READY" : "CONNECTED",
      allReady,
      countdownTriggered,
      status: race.status,
      lobbyEndsAt: race.lobbyEndsAt ? race.lobbyEndsAt.toISOString() : undefined,
      countdownSeconds: countdownTriggered ? 15 : undefined,
      waitingStatusMessage
    });

    return {
      race,
      participant: targetParticipant,
      countdownTriggered,
      allReady,
      waitingStatusMessage
    };
  }

  public toggleApprovalRequirement(
    identifier: string,
    requireApproval: boolean,
    hostUserId?: string,
    isAdmin?: boolean
  ): { race: RaceState } | { error: string; statusCode: number } {
    const race = this.findPrivateRace(identifier);
    if (!race) {
      return { error: "Salon privé introuvable ou expiré.", statusCode: 404 };
    }
    if (!this.canManagePrivateRace(race, hostUserId, isAdmin)) {
      return { error: "Seul le créateur du salon peut modifier les paramètres d'approbation.", statusCode: 403 };
    }

    race.requireApproval = Boolean(requireApproval);

    if (!race.participants) {
      race.participants = new Map();
    }
    if (!race.pendingParticipants) {
      race.pendingParticipants = new Map();
    }

    // If approval is turned OFF, automatically accept all currently waiting players!
    if (!race.requireApproval && race.pendingParticipants.size > 0) {
      for (const [uid, p] of race.pendingParticipants.entries()) {
        if (race.participants.size < race.maxParticipants) {
          race.participants.set(uid, p);
        }
      }
      race.pendingParticipants.clear();
      race.totalParticipants = Math.max(race.totalParticipants || 0, race.participants.size);
    }

    socketGateway.broadcastPrivateRoomUpdate(race.id, {
      type: "APPROVAL_CONFIG_CHANGED",
      requireApproval: race.requireApproval,
      totalParticipants: race.participants.size
    });

    return { race };
  }

  public approveParticipant(
    identifier: string,
    targetUserId: string,
    approve: boolean,
    hostUserId?: string,
    isAdmin?: boolean
  ): { race: RaceState; participant?: PrivateParticipantInfo } | { error: string; statusCode: number } {
    const race = this.findPrivateRace(identifier);
    if (!race) {
      return { error: "Salon privé introuvable ou expiré.", statusCode: 404 };
    }
    if (!this.canManagePrivateRace(race, hostUserId, isAdmin)) {
      return { error: "Seul le créateur du salon peut valider les participants.", statusCode: 403 };
    }

    if (!race.participants) {
      race.participants = new Map();
    }
    if (!race.pendingParticipants) {
      race.pendingParticipants = new Map();
    }
    if (!race.rejectedParticipants) {
      race.rejectedParticipants = new Set();
    }

    const cleanTargetId = String(targetUserId || "").trim();
    if (!cleanTargetId) {
      return { error: "ID joueur manquant.", statusCode: 400 };
    }

    if (approve) {
      if (race.participants.size >= race.maxParticipants) {
        return { error: `Le salon est complet (${race.maxParticipants} max).`, statusCode: 409 };
      }
      const pending = race.pendingParticipants.get(cleanTargetId);
      const participantInfo: PrivateParticipantInfo = pending || {
        userId: cleanTargetId,
        userName: `Racer_${cleanTargetId.slice(-4)}`,
        joinedAt: new Date()
      };
      race.pendingParticipants.delete(cleanTargetId);
      race.rejectedParticipants.delete(cleanTargetId);
      race.participants.set(cleanTargetId, participantInfo);
      race.totalParticipants = Math.max(race.totalParticipants || 0, race.participants.size);

      socketGateway.broadcastPrivateRoomUpdate(race.id, {
        type: "PARTICIPANT_APPROVED",
        userId: cleanTargetId,
        participant: participantInfo
      });

      return { race, participant: participantInfo };
    } else {
      // Host rejected player
      race.pendingParticipants.delete(cleanTargetId);
      race.participants.delete(cleanTargetId);
      race.rejectedParticipants.add(cleanTargetId);
      race.totalParticipants = race.participants.size;

      socketGateway.broadcastPrivateRoomUpdate(race.id, {
        type: "PARTICIPANT_REJECTED",
        userId: cleanTargetId
      });

      return { race };
    }
  }

  public getParticipantApprovalStatus(
    identifier: string,
    userId: string
  ): {
    raceId: string;
    status: "approved" | "pending" | "rejected" | "unknown";
    requireApproval: boolean;
    targetDistance?: number;
    title?: string;
  } {
    const race = this.findPrivateRace(identifier);
    if (!race) {
      return { raceId: "", status: "unknown", requireApproval: false };
    }

    const cleanUserId = String(userId || "").trim();
    if (
      (race.hostUserId && cleanUserId === race.hostUserId) ||
      (race.originalHostUserId && cleanUserId === race.originalHostUserId)
    ) {
      return {
        raceId: race.id,
        status: "approved",
        requireApproval: Boolean(race.requireApproval),
        targetDistance: race.targetDistance,
        title: race.title
      };
    }

    if (race.rejectedParticipants && race.rejectedParticipants.has(cleanUserId)) {
      return {
        raceId: race.id,
        status: "rejected",
        requireApproval: Boolean(race.requireApproval),
        targetDistance: race.targetDistance,
        title: race.title
      };
    }

    if (race.participants && race.participants.has(cleanUserId)) {
      return {
        raceId: race.id,
        status: "approved",
        requireApproval: Boolean(race.requireApproval),
        targetDistance: race.targetDistance,
        title: race.title
      };
    }

    if (race.pendingParticipants && race.pendingParticipants.has(cleanUserId)) {
      return {
        raceId: race.id,
        status: "pending",
        requireApproval: Boolean(race.requireApproval),
        targetDistance: race.targetDistance,
        title: race.title
      };
    }

    if (!race.requireApproval) {
      return {
        raceId: race.id,
        status: "approved",
        requireApproval: false,
        targetDistance: race.targetDistance,
        title: race.title
      };
    }

    return {
      raceId: race.id,
      status: "unknown",
      requireApproval: Boolean(race.requireApproval),
      targetDistance: race.targetDistance,
      title: race.title
    };
  }

  public startOrResetPrivateRace(
    identifier: string,
    options: {
      hostUserId?: string;
      isAdmin?: boolean;
      countdownSeconds?: number;
      reset?: boolean;
      targetDistance?: number;
      botStartMode?: "countdown" | "first_stroke";
    }
  ): { race: RaceState } | { error: string; statusCode: number } {
    const race = this.findPrivateRace(identifier);
    if (!race) {
      return { error: "Salon privé introuvable ou expiré.", statusCode: 404 };
    }

    if (!this.canManagePrivateRace(race, options.hostUserId, options.isAdmin)) {
      return { error: "Seul le créateur du salon peut contrôler le départ.", statusCode: 403 };
    }

    if (race.status === "COMPLETED" || race.status === "ABANDONED") {
      return { error: "Ce salon est définitivement fermé et ne peut plus être réutilisé.", statusCode: 410 };
    }

    if (options.targetDistance !== undefined) {
      const dist = Number(options.targetDistance);
      if (Number.isFinite(dist) && dist >= 100 && dist <= 100000) {
        race.targetDistance = Math.round(dist);
      }
    }

    const now = new Date();

    if (!options.reset && race.startMode === "scheduled" && race.scheduledStartTime) {
      const scheduledMs = race.scheduledStartTime.getTime();
      const earliestStartMs = scheduledMs - 5 * 60 * 1000; // Déverrouillage 5 minutes avant
      if (now.getTime() < earliestStartMs) {
        const diffMs = earliestStartMs - now.getTime();
        const diffMin = Math.ceil(diffMs / 60000);
        return {
          error: `Ce salon est programmé pour ${race.scheduledStartTime.toLocaleString('fr-FR')}. Le démarrage est verrouillé jusqu'à 5 minutes avant l'épreuve (dans ${diffMin} min).`,
          statusCode: 403
        };
      }
    }

    if (options.reset) {
      race.status = "LOBBY";
      race.autoStart = false;
      race.startedAt = undefined;
      race.endedAt = undefined;
      race.lobbyEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      if (race.participants) {
        for (const p of race.participants.values()) {
          p.exactDistance = 0;
          p.lastTelemetryAtMs = 0;
          p.lastElapsedSec = 0;
        }
      }
      userStore.updateActivitiesWhere(race.id, undefined, {
        status: "waiting",
        netDistance: 0,
        exactDistance: 0,
        lastTelemetryAtMs: 0,
        currentDistance: 0,
        progressPercent: 0,
        elapsedTime: 0,
        updatedAt: now
      });
      socketGateway.broadcastRaceStatus(race.id, "LOBBY", { reset: true });
      return { race };
    }

    const rawSec = options.countdownSeconds !== undefined ? Number(options.countdownSeconds) : 15;
    const countdownSec = Number.isFinite(rawSec) ? Math.min(3600, Math.max(0, Math.round(rawSec))) : 15;

    // Duel contre un bot ou Solo : départ « Au premier coup de rame » (aucun décompte, la course attend le joueur)
    if ((race.isBotDuel || race.isSolo) && options.botStartMode === "first_stroke") {
      race.botStartMode = "first_stroke";
      race.status = "LOBBY";
      race.autoStart = false;
      race.startedAt = undefined;
      race.endedAt = undefined;
      race.lobbyEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      socketGateway.broadcastRaceStatus(race.id, "LOBBY", { botStartMode: "first_stroke" });
      return { race };
    }
    if ((race.isBotDuel || race.isSolo) && options.botStartMode === "countdown") {
      race.botStartMode = "countdown";
    }

    // Verrouillage du démarrage à 15s (ou avec décompte > 0) tant que le nombre requis de kayaks n'est pas engagé sur une ligne d'eau
    if (countdownSec > 0) {
      const partsList = race.participants ? Array.from(race.participants.values()) : [];
      const engagedHumans = partsList.filter((p) => {
        const isBot = Boolean((p as any).isBot) || String(p.userId || "").startsWith("bot_");
        if (isBot) return false;
        if (p.hasLeft || p.status === "abandoned") return false;
        if (!p.lane || p.lane <= 0) return false;
        return p.connectionState !== "PENDING_PIN" && p.pinValidated !== false;
      }).length;
      const botPartsCount = partsList.filter((p) => Boolean((p as any).isBot) || String(p.userId || "").startsWith("bot_")).length;
      const effectiveBots = Math.max(botPartsCount, Number(race.botCount || (race.isBotDuel ? 1 : 0)));
      const totalEngagedKayaks = engagedHumans + effectiveBots;
      const minRequiredKayaks = race.isSolo ? 1 : 2;

      if (totalEngagedKayaks < minRequiredKayaks) {
        return {
          error: race.isSolo
            ? "Votre kayak doit être engagé sur une ligne d'eau (code PIN saisi sur votre montre) avant de démarrer."
            : `Au moins 2 kayaks doivent être engagés sur une ligne d'eau pour lancer le départ à 15s (actuellement ${totalEngagedKayaks}/2).`,
          statusCode: 409
        };
      }
    }

    // Si départ immédiat (0s) et des compétiteurs connectés via montre sont encore non prêts
    if (countdownSec <= 0 && race.participants && race.participants.size > 0) {
      const anyNotReady = Array.from(race.participants.values()).some((p) => p.deviceToken && p.ready === false);
      if (anyNotReady) {
        return {
          error: "Tous les compétiteurs connectés doivent avoir leur rameur prêt (READY) pour un départ immédiat sans décompte. Utilisez le départ dans 10s ou 3s.",
          statusCode: 409
        };
      }
    }

    if (countdownSec <= 0) {
      race.status = "RUNNING";
      race.autoStart = true;
      race.startedAt = now;
      race.endedAt = undefined;
      race.lobbyEndsAt = now;
      userStore.updateActivitiesWhere(race.id, "waiting", { status: "in_progress", updatedAt: now });
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

  public leavePrivateRace(
    identifier: string,
    userId: string
  ): { success: boolean; roomClosed: boolean; remainingParticipants: number } | { error: string; statusCode: number } {
    let race = this.findPrivateRace(identifier);
    let isPublic = false;
    if (!race && this.currentPublicRace && (this.currentPublicRace.id === identifier || this.currentPublicRace.pinCode === identifier || this.currentPublicRace.code === identifier)) {
      race = this.currentPublicRace;
      isPublic = true;
    }
    if (!race) {
      return { error: "Salon ou course introuvable ou déjà fermé.", statusCode: 404 };
    }

    const cleanUserId = String(userId || "").trim();

    const p = race.participants?.get(cleanUserId);
    if (p) {
      p.hasLeft = true;
    }
    const pendingP = race.pendingParticipants?.get(cleanUserId);
    if (pendingP) {
      pendingP.hasLeft = true;
    }
    if (race.hostUserId === cleanUserId || race.originalHostUserId === cleanUserId) {
      race.hostHasLeft = true;
    }

    if (race.status === "COMPLETED") {
      const remainingParticipants = race.participants
        ? Array.from(race.participants.values()).filter((part) => !part.hasLeft).length
        : 0;
      race.totalParticipants = remainingParticipants;

      if (!isPublic && remainingParticipants === 0) {
        this.removePrivateRaceInternal(race);
        return { success: true, roomClosed: true, remainingParticipants: 0 };
      }

      socketGateway.broadcastPrivateRoomUpdate(race.id, {
        type: "PARTICIPANT_LEFT",
        userId: cleanUserId,
        remainingParticipants
      });

      return { success: true, roomClosed: false, remainingParticipants };
    }

    if (race.participants) {
      race.participants.delete(cleanUserId);
    }
    if (race.pendingParticipants) {
      race.pendingParticipants.delete(cleanUserId);
    }

    const isRunning = race.status === "RUNNING";
    if (isRunning) {
      // Course commencée : marquer l'activité en abandoned
      (Activities as any).update(
        { status: "abandoned", speed: 0, powerWatts: 0, strokeRate: 0 },
        { where: { activityId: race.id, userId: cleanUserId } }
      ).catch((err: any) => {
        console.error(`[RaceManager] Error marking activity abandoned for user ${cleanUserId} in race ${race.id}:`, err);
      });
    } else {
      // Course non commencée : libérer le couloir sans considérer que c'est un abandon
      (Activities as any).destroy({
        where: { activityId: race.id, userId: cleanUserId }
      }).catch((err: any) => {
        console.error(`[RaceManager] Error removing activity for user ${cleanUserId} before race start:`, err);
      });
    }

    const remainingParticipants = race.participants ? race.participants.size : 0;
    race.totalParticipants = remainingParticipants;

    // Si d'autres participants restent ou si le salon reste ouvert en attente
    socketGateway.broadcastPrivateRoomUpdate(race.id, {
      type: "PARTICIPANT_LEFT",
      userId: cleanUserId,
      remainingParticipants
    });

    return { success: true, roomClosed: false, remainingParticipants };
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

  public canManagePrivateRace(race: RaceState, hostUserId?: string, isAdmin?: boolean): boolean {
    if (isAdmin) return true;
    if (!race.hostUserId || race.hostUserId === "anonymous") return true;
    const clean = hostUserId ? hostUserId.trim() : "";
    if (!clean) return false;
    if (clean === race.hostUserId || (race.originalHostUserId && clean === race.originalHostUserId)) {
      return true;
    }
    const cleanLower = clean.toLowerCase();
    if (race.hostUserId.toLowerCase() === cleanLower || (race.originalHostUserId && race.originalHostUserId.toLowerCase() === cleanLower)) {
      return true;
    }
    if (race.hostUserName && race.hostUserName.toLowerCase() === cleanLower) {
      return true;
    }
    const user = userStore.findUserSync(clean);
    if (user && (user.id === race.hostUserId || user.login?.toLowerCase() === race.hostUserId.toLowerCase())) {
      return true;
    }
    const hostUser = userStore.findUserSync(race.hostUserId);
    if (hostUser && (hostUser.login?.toLowerCase() === cleanLower || hostUser.name?.toLowerCase() === cleanLower)) {
      return true;
    }
    return false;
  }

  public updateParticipantKayak(userId: string, kayak: KayakCustomization): void {
    const cleanId = String(userId || "").trim();
    if (!cleanId) return;

    const pub = this.getCurrentPublicRace();
    if (pub && pub.participants && pub.participants.has(cleanId)) {
      const p = pub.participants.get(cleanId);
      if (p) {
        p.kayak = kayak;
      }
    }

    for (const race of this.privateRacesById.values()) {
      if (race?.participants?.has(cleanId)) {
        const p = race.participants.get(cleanId);
        if (p) {
          p.kayak = kayak;
        }
      }
    }
  }

  private removePrivateRaceInternal(race: RaceState, finalStatus: RaceState["status"] = "ABANDONED"): void {
    race.status = finalStatus;
    if (race.pinCode) {
      this.pinToRaceMap.delete(race.pinCode);
    }
    if (race.code) {
      this.privateRaces.delete(race.code);
    }
    this.privateRacesById.delete(race.id);
  }

  private generateUniquePinCode(avoidPin?: string): string {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const avoidUpper = avoidPin ? avoidPin.toUpperCase() : undefined;
    for (let attempt = 0; attempt < 200; attempt++) {
      let candidate = "";
      for (let i = 0; i < 5; i++) {
        candidate += chars[Math.floor(Math.random() * chars.length)];
      }
      if (candidate !== avoidUpper && !this.pinToRaceMap.has(candidate) && !this.guestTicketsByPin.has(candidate)) {
        return candidate;
      }
    }
    let fallback = "";
    for (let i = 0; i < 5; i++) {
      fallback += chars[Math.floor(Math.random() * chars.length)];
    }
    return fallback;
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
