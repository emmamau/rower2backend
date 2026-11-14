import { Op } from "sequelize";
import db from "../models";
import socketGateway, { LiveRacerMetric } from "../websocket/socket.gateway";
import config from "../config";
import userStore from "./user-store.service";
import { isEmmaAdminUser } from "./auth.service";
import { calculateRacePoints, getLeagueByPoints, generateRealisticBotPace, calculateBotPhysics, isLeagueEligible } from "../utils/league.util";

const Races = db.races;
const Activities = db.activities;
const Users = db.users;

export interface PrivateParticipantInfo {
  userId: string;
  userName: string;
  joinedAt: Date;
  country?: string;
  lane?: number;
  ready?: boolean;
  connectionState?: "CONNECTED" | "READY";
  socketId?: string;
  deviceToken?: string;
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
  status: "LOBBY" | "COUNTDOWN" | "RUNNING" | "COMPLETED" | "ABANDONED";
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
  botCount?: number;
  botMaxPace?: number;
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
    const minUntilStart = Math.max(0, Math.ceil(msUntilStart / 60000));
    const pad = (n: number) => n.toString().padStart(2, "0");
    const d = new Date(race.scheduledStartTime);
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    if (minUntilStart > 0) {
      return `Départ prévu dans ${minUntilStart} min / à ${hh}:${mm}`;
    } else {
      return `Départ prévu à ${hh}:${mm}`;
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
}

export class RaceManager {
  /** A human racer who did not send any data for this long is considered gone. */
  private static readonly HUMAN_INACTIVE_MS = 5 * 60 * 1000;

  private static instance: RaceManager;
  private currentPublicRace: RaceState | null = null;
  private privateRaces: Map<string, RaceState> = new Map(); // code -> RaceState
  private privateRacesById: Map<string, RaceState> = new Map(); // raceId -> RaceState
  private pinToRaceMap: Map<string, { raceId: string; lane: number }> = new Map(); // 4-5 chars PIN -> race
  private guestTicketsByPin: Map<string, GuestBoardingTicket> = new Map(); // 5-char ticketPin -> GuestBoardingTicket
  private loopTimer: NodeJS.Timeout | null = null;
  private loopBusy = false;
  private publicTickChain: Promise<void> = Promise.resolve();

  public adminPrivateRaceConfig = {
    maxDurationMinutes: 55,
  };

  public adminPublicRaceConfig = {
    targetDistance: 2000,
    maxParticipants: 20,
    maxDurationMinutes: 55,
    privateMaxDurationMinutes: 55,
    defaultBotsCount: 3,
    defaultBotsPace: 145, // 2:25 / 500m (palier débutant/loisir 2m20s - 2m45s)
    countdownAfterLastJoinSeconds: 15,
    lobbyWaitMinutes: 15,
  };

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

    return sortedRows.map((r: any, idx: number) => {
      const getVal = (f: string) => (typeof r.get === "function" ? r.get(f) : r[f]);
      const userId = getVal("userId");
      const isBot = Boolean(getVal("isBot")) || String(userId || "").startsWith("bot_");
      const name = getVal("userName") || userId;
      const dist = (getVal("netDistance") as number) || 0;
      const split = (getVal("lastPace") as number) || (getVal("avgPace") as number) || 120;
      const watts = (getVal("lastPower") as number) || (getVal("avgPower") as number) || 0;
      const spm = (getVal("lastStrokeRate") as number) || (getVal("avgStrokeRate") as number) || 0;
      const heartRate = (getVal("lastHeartRate") as number) || undefined;
      const country = getVal("country") || undefined;
      const status = getVal("status") || "in_progress";
      const elapsedTime = (getVal("elapsedTime") as number) || 0;

      let lane = preassignedLanes.get(userId) || 0;
      if (!lane) {
        if (race?.isBotDuel) {
          lane = isBot ? 2 : 1;
          usedLanes.add(lane);
        } else if (race) {
          lane = allocNextLane();
        } else {
          lane = idx + 1;
        }
      }

      const participantInfo = race?.participants?.get(userId);
      const isParticipantReady = isBot
        ? true
        : (participantInfo?.ready !== undefined ? participantInfo.ready : (watts > 0 || spm > 0 || dist > 0 || true));
      const connectionState: "CONNECTED" | "READY" = isBot
        ? "READY"
        : (participantInfo?.connectionState || (participantInfo?.ready === false ? "CONNECTED" : "READY"));

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
        connectionState
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
    try {
      const rows = (await Activities.findAll({ where: { activityId: raceId } })) as any[];
      if (rows && rows.length > 0) return rows;
    } catch {
      // Tolérance DB hors ligne
    }
    return userStore.findActivitiesByRaceId(raceId);
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

      const createdMs = bot.get("createdAt") ? new Date(bot.get("createdAt")).getTime() : startMs;
      const botStartMs = (createdMs <= startMs + 1000) ? startMs : createdMs;
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

  /** Writes finalRank on every non-abandoned racer, calculates points/leagues and returns the official classification. */
  private async finalizeRanking(raceId: string): Promise<RaceRankingEntry[]> {
    const rows = await this.loadRaceActivities(raceId);
    const ranked = RaceManager.sortRanking(rows.filter((r: any) => r.get("status") !== "abandoned"));
    const totalParticipants = ranked.length;
    const result: RaceRankingEntry[] = [];
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i];
      const rank = i + 1;
      const isFinisher = r.get("status") === "finished";
      const pts = calculateRacePoints(rank, totalParticipants, isFinisher);

      const alreadyAwarded = Number(r.get("points") || 0) > 0;
      try {
        await r.update({ finalRank: rank, points: pts } as any);
      } catch {}

      // Mettre à jour les points et le statut de ligue du joueur humain si non déjà comptabilisés
      let resolvedUserName = r.get("userName") || r.get("userId");
      if (!r.get("isBot") && r.get("userId")) {
        try {
          const u = await userStore.findUser(r.get("userId"));
          if (u) {
            resolvedUserName = u.login || u.name;
            const currentPts = (u.points as number) || 0;
            const newPts = alreadyAwarded ? currentPts : (currentPts + pts);
            const league = getLeagueByPoints(newPts);
            const totalWins = (u.totalWins || 0) + (rank === 1 && isFinisher ? 1 : 0);
            const podiums = (u.podiums || 0) + (rank <= 3 && isFinisher ? 1 : 0);
            const bestRank = !u.bestRank || rank < u.bestRank ? rank : u.bestRank;
            await userStore.updateUser(u.id, {
              points: newPts,
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
        points: pts
      });
    }

    // Inclusion explicite des abandons (DNF) : 0 points et statut "abandoned"
    const abandoned = rows.filter((r: any) => r.get("status") === "abandoned");
    for (const ab of abandoned) {
      try {
        await ab.update({ finalRank: 0, points: 0 } as any);
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

    if (!this.currentPublicRace) {
      await this.initNextPublicRace();
      return this.currentPublicRace!;
    }

    const race = this.currentPublicRace;

    if (race.status === "COMPLETED" || (race.status as any) === "POST_RACE_PAUSE") {
      if (race.pauseEndsAt) {
        if (now.getTime() >= race.pauseEndsAt.getTime()) {
          console.log(`[RaceManager] Fin des 2 minutes de pause post-course pour ${race.id}. Enchaînement vers le nouveau lobby.`);
          await this.initNextPublicRace(15);
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
          await this.initNextPublicRace(15);
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

          // Détection de rupture de flux post-départ (déconnexion / fermeture app Garmin) -> passage en Abandon (DNF)
          for (const row of rows) {
            if (!row.get("isBot") && (row.get("status") === "in_progress" || row.get("status") === "paused")) {
              const updatedAt = row.get("updatedAt");
              if (updatedAt) {
                const ageMs = now.getTime() - new Date(updatedAt).getTime();
                if (ageMs > 25000) {
                  console.log(`[RaceManager] Rupture de flux détectée pour ${row.get("userId")} (${Math.round(ageMs / 1000)}s). Marquage Abandon (DNF).`);
                  await row.update({ status: "abandoned", speed: 0, powerWatts: 0, strokeRate: 0 } as any);
                }
              }
            }
          }

          await this.advanceBots(race, rows, now);

          const live = RaceManager.sortRanking(rows);
          if (live.length > 0) {
            socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(live, race));
          }

          const activeHumans = rows.filter((r: any) => this.isActiveHuman(r, now));
          if (activeHumans.length === 0) {
            console.log(`[RaceManager] No human racer left in race ${race.id} (only bots). Closing race.`);
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
      if (race.createdAt && now.getTime() - race.createdAt.getTime() > ttlMs) {
        this.removePrivateRaceInternal(race);
        continue;
      }

      // Course planifiée : déclenchement automatique du compte à rebours 15s avant l'heure prévue
      // Verrouillé par le statut BLE "READY" de tous les compétiteurs connectés (Section 4.2 & 7.3)
      if (race.status === "LOBBY" && race.startMode === "scheduled" && race.scheduledStartTime) {
        const msUntilStart = race.scheduledStartTime.getTime() - now.getTime();
        const allParticipantsReady =
          !race.participants ||
          race.participants.size === 0 ||
          Array.from(race.participants.values()).every((p) => p.ready !== false);
        if (msUntilStart <= 15000 && msUntilStart > 0 && allParticipantsReady) {
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
        if (race.status === "LOBBY" && race.autoStart) {
          const rows = await this.loadRaceActivities(race.id);
          const hasParticipants =
            (race.participants && race.participants.size > 0) ||
            rows.some((r: any) => !r.get("isBot") && ["waiting", "in_progress"].includes(r.get("status")));
          const allParticipantsReady =
            !race.participants ||
            race.participants.size === 0 ||
            Array.from(race.participants.values()).every((p) => p.ready !== false);
          if (!hasParticipants || !allParticipantsReady) {
            // Pas encore de participant ou au moins un rameur en veille (CONNECTED), on laisse le lobby ouvert
            continue;
          }
        }

        race.status = "RUNNING";
        race.startedAt = now;
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

          // Détection de rupture de flux post-départ (déconnexion / fermeture app Garmin) -> passage en Abandon (DNF)
          for (const row of rows) {
            if (!row.get("isBot") && (row.get("status") === "in_progress" || row.get("status") === "paused")) {
              const updatedAt = row.get("updatedAt");
              if (updatedAt) {
                const ageMs = now.getTime() - new Date(updatedAt).getTime();
                if (ageMs > 25000) {
                  console.log(`[RaceManager] Rupture de flux détectée pour ${row.get("userId")} (${Math.round(ageMs / 1000)}s). Marquage Abandon (DNF).`);
                  await row.update({ status: "abandoned", speed: 0, powerWatts: 0, strokeRate: 0 } as any);
                }
              }
            }
          }

          await this.advanceBots(race, rows, now);

          const live = RaceManager.sortRanking(rows);
          if (live.length > 0) {
            socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(live, race));

            const nonAbandoned = live.filter((act: any) => act.get("status") !== "abandoned");
            const allFinished = nonAbandoned.length > 0 && nonAbandoned.every(
              (act: any) => act.get("status") === "finished" || ((act.get("netDistance") as number) || 0) >= race.targetDistance
            );
            if (allFinished) {
              await this.finishPrivateRace(race, "completed");
              continue;
            }
          }

          const activeHumans = rows.filter((r: any) => this.isActiveHuman(r, now));
          const hasMemoryHumans = Boolean(race.participants && race.participants.size > 0);
          const justStarted = race.startedAt ? (now.getTime() - race.startedAt.getTime() < 10000) : true;
          if (activeHumans.length === 0 && !hasMemoryHumans && !justStarted) {
            console.log(`[RaceManager] No active human racer left in private race ${race.id} (only bots). Closing race.`);
            await this.finishPrivateRace(race, "no_active_humans");
          }
        } catch (err) {
          console.error(`[RaceManager] Private race tick failed for ${race.id}:`, err);
        }
      }
    }
  }

  private async finishPrivateRace(race: RaceState, reason: string): Promise<void> {
    if (race.status === "COMPLETED") return;
    race.status = "COMPLETED";
    race.endedAt = new Date();
    let ranking: RaceRankingEntry[] = [];
    try {
      await Activities.update(
        { status: "out_of_time" },
        { where: { activityId: race.id, status: { [Op.in]: ["in_progress", "waiting", "paused"] } } }
      );
      ranking = await this.finalizeRanking(race.id);
      await Races.update({ status: "finished" }, { where: { id: race.id } });
    } catch (err) {
      console.error(`[RaceManager] Unable to finalise private race ${race.id}:`, err);
    }
    this.removePrivateRaceInternal(race, "COMPLETED");
    socketGateway.broadcastRaceStatus(race.id, "COMPLETED", { reason, ranking, roomClosed: true });
  }

  /**
   * Initializes the next scheduled public race (new lobby with its countdown so players have time to connect)
   */
  public async initNextPublicRace(delayMinutes?: number): Promise<RaceState> {
    const now = new Date();
    const intervalMin = delayMinutes || this.adminPublicRaceConfig.lobbyWaitMinutes || config.raceIntervalMinutes || 15;
    const lobbyEndsAt = new Date(now.getTime() + intervalMin * 60 * 1000);
    let raceId = `RACE_${lobbyEndsAt.toISOString().replace(/[-:T.]/g, "").slice(0, 14)}`;
    if (this.currentPublicRace && this.currentPublicRace.id === raceId) {
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

  public notifyPlayerJoinedPublic(userId: string): void {
    if (!this.currentPublicRace || !userId) return;
    if (this.currentPublicRace.status === "LOBBY" || this.currentPublicRace.status === "COUNTDOWN") {
      if (!this.currentPublicRace.participants) {
        this.currentPublicRace.participants = new Map();
      }
      this.currentPublicRace.participants.set(userId, {
        userId,
        userName: `Racer_${userId.slice(-4)}`,
        joinedAt: new Date()
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
      try {
        await Activities.findOrCreate({
          where: { id: compositeId },
          defaults: {
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
          }
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
    const managed = this.getRaceById(raceId);
    if (managed && (managed.status === "COMPLETED" || managed.status === "ABANDONED")) {
      return [];
    }
    const isPublic = Boolean(this.currentPublicRace && this.currentPublicRace.id === raceId);
    if (managed) {
      managed.status = "COMPLETED";
      managed.endedAt = new Date();
      if (isPublic && reason !== "no_active_humans") {
        managed.pauseEndsAt = new Date(Date.now() + 120 * 1000); // 2 minutes post-race restitution pause
      }
    }

    let ranking: RaceRankingEntry[] = [];
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
      ranking = await this.finalizeRanking(raceId);
      await Races.update({ status: "finished" }, { where: { id: raceId } });
    } catch (err) {
      console.error(`[RaceManager] Unable to finalise race ${raceId}:`, err);
    }

    if (managed) {
      managed.finalRanking = ranking;
    }

    socketGateway.broadcastRaceStatus(raceId, "COMPLETED", {
      reason: reason || (timeoutTriggered ? "timeout" : "completed"),
      pauseSeconds: managed?.pauseEndsAt ? 120 : 0,
      pauseEndsAt: managed?.pauseEndsAt,
      ranking
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
    countdownMinutes?: number;
    requireApproval?: boolean;
    botCount?: number;
    botMaxPace?: number;
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

    if (startMode === "scheduled" && options.scheduledStartTime) {
      scheduledDate = new Date(options.scheduledStartTime);
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
        lane: 1
      });
    }

    let botCount = isSolo ? 0 : isBotDuel ? 1 : Math.min(10, Math.max(0, Number(options.botCount) || 0));
    let botMaxPace = Math.min(300, Math.max(60, Number(options.botMaxPace) || 120));
    let botCustomName = options.botCustomName;

    if (isBotDuel) {
      // Allure du bot : si explicitement fournie par l'utilisateur (botMaxPace valide), on la conserve, sinon aléatoire
      if (!options.botMaxPace || Number(options.botMaxPace) <= 0) {
        const randomPace = Math.floor(Math.random() * (150 - 105 + 1)) + 105;
        botMaxPace = randomPace;
      }
      let levelLabel = "Intermédiaire";
      if (botMaxPace <= 100) {
        levelLabel = "Champion";
      } else if (botMaxPace <= 110) {
        levelLabel = "Élite";
      } else if (botMaxPace <= 115) {
        levelLabel = "Avancé";
      } else if (botMaxPace <= 130) {
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
      botCount,
      botMaxPace,
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

    if (botCount > 0) {
      this.ensureSalonBots(raceId, botCount, botMaxPace, targetDistance, botCustomName).catch(() => {});
    }

    return privateRace;
  }

  private async ensureSalonBots(raceId: string, botCount: number, botMaxPace: number, targetDistance: number, customName?: string): Promise<void> {
    const names = ["Bot Challenger", "Bot Pacer", "Bot Tempo", "Bot Shadow", "Bot Swift", "Bot Titan", "Bot Veloce"];
    for (let i = 0; i < botCount; i++) {
      const botId = `bot_salon_${i + 1}`;
      const compositeId = `${raceId}_${botId}`;
      const name = customName || names[i % names.length];
      const botPace = botMaxPace && botMaxPace > 0 && botCount === 1 ? Math.max(110, Math.min(165, botMaxPace)) : generateRealisticBotPace();
      const { power, spm, speedMs } = calculateBotPhysics(botPace);
      try {
        await Activities.findOrCreate({
          where: { id: compositeId },
          defaults: {
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
          }
        });
      } catch {}
    }
  }

  public getRaceByPin(pin: string): { raceId: string; lane: number; race?: RaceState } | null {
    if (!pin) return null;
    const cleanPin = String(pin).trim().toUpperCase();
    const matched = this.pinToRaceMap.get(cleanPin);
    if (!matched) return null;
    const race = this.getRaceById(matched.raceId) || undefined;
    return { ...matched, race };
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
      this.ensureSalonBots(race.id, race.botCount, race.botMaxPace || 125, race.targetDistance).catch(() => {});
    } else if (alreadyApproved) {
      const existing = race.participants.get(cleanUserId);
      assignedLane = existing?.lane || 1;
    } else {
      const usedLanes = new Set<number>();
      for (const p of race.participants.values()) {
        if (p.lane) usedLanes.add(p.lane);
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

    const isReady = options?.ready === false ? false : true;
    const connectionState: "CONNECTED" | "READY" = isReady ? "READY" : "CONNECTED";

    race.participants.set(cleanUserId, {
      userId: cleanUserId,
      userName: cleanName,
      joinedAt: new Date(),
      country,
      lane: assignedLane,
      ready: isReady,
      connectionState,
      socketId: options?.socketId,
      deviceToken: options?.deviceToken
    });
    race.totalParticipants = Math.max(race.totalParticipants || 0, race.participants.size);
    if (race.pinCode) {
      this.pinToRaceMap.set(race.pinCode.toUpperCase(), { raceId: race.id, lane: assignedLane });
    }

    const allParticipantsReady = Array.from(race.participants.values()).every((p) => p.ready !== false);

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
    }

    // Remarque : Pour Solo et BotDuel, le départ n'est PAS un timer auto de 15s : c'est le joueur qui déclenche le départ au 1er coup de rame !

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
      participantsList.length > 0 && participantsList.every((p) => p.ready !== false);

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

    // Verrouillage du départ par le statut "READY" (Section 4.2) :
    // Si au moins un compétiteur connecté est en état CONNECTED (ready === false), empêcher le lancement
    if (race.participants && race.participants.size > 0) {
      const anyNotReady = Array.from(race.participants.values()).some((p) => p.ready === false);
      if (anyNotReady) {
        return {
          error: "Tous les compétiteurs connectés doivent avoir leur rameur prêt (READY) avant de lancer le départ.",
          statusCode: 409
        };
      }
    }

    const rawSec = options.countdownSeconds !== undefined ? Number(options.countdownSeconds) : 15;
    const countdownSec = Number.isFinite(rawSec) ? Math.min(3600, Math.max(0, Math.round(rawSec))) : 15;

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

  public canManagePrivateRace(race: RaceState, hostUserId?: string, isAdmin?: boolean): boolean {
    if (isAdmin) return true;
    if (!race.hostUserId || race.hostUserId === "anonymous") return true;
    const clean = hostUserId ? hostUserId.trim() : "";
    return Boolean(
      clean && (clean === race.hostUserId || (race.originalHostUserId && clean === race.originalHostUserId))
    );
  }

  private removePrivateRaceInternal(race: RaceState, finalStatus: "ABANDONED" | "COMPLETED" = "ABANDONED"): void {
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
