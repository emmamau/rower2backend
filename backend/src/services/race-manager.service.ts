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
  country?: string;
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
  totalParticipants?: number;
  createdAt?: Date;
  requireApproval?: boolean;
  participants?: Map<string, PrivateParticipantInfo>;
  pendingParticipants?: Map<string, PrivateParticipantInfo>;
  rejectedParticipants?: Set<string>;
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
}

export class RaceManager {
  /** A human racer who did not send any data for this long is considered gone. */
  private static readonly HUMAN_INACTIVE_MS = 5 * 60 * 1000;

  private static instance: RaceManager;
  private currentPublicRace: RaceState | null = null;
  private privateRaces: Map<string, RaceState> = new Map(); // code -> RaceState
  private privateRacesById: Map<string, RaceState> = new Map(); // raceId -> RaceState
  private pinToRaceMap: Map<string, { raceId: string; lane: number }> = new Map(); // 4 digits PIN -> race
  private loopTimer: NodeJS.Timeout | null = null;
  private loopBusy = false;
  private publicTickChain: Promise<void> = Promise.resolve();

  public adminPublicRaceConfig = {
    targetDistance: 2000,
    maxParticipants: 20,
    maxDurationMinutes: 55,
    defaultBotsCount: 3,
    defaultBotsPace: 120, // 2:00 / 500m
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

  public static toLiveMetrics(sortedRows: any[]): LiveRacerMetric[] {
    return sortedRows.map((r: any, idx: number) => ({
      lane: idx + 1,
      userId: r.get("userId"),
      name: r.get("userName") || r.get("userId"),
      dist: (r.get("netDistance") as number) || 0,
      split: (r.get("lastPace") as number) || (r.get("avgPace") as number) || 120,
      watts: (r.get("lastPower") as number) || (r.get("avgPower") as number) || 0,
      spm: (r.get("lastStrokeRate") as number) || (r.get("avgStrokeRate") as number) || 0,
      heartRate: (r.get("lastHeartRate") as number) || undefined,
      country: r.get("country") || undefined,
      status: r.get("status") || "in_progress"
    }));
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
      return (await Activities.findAll({ where: { activityId: raceId } })) as any[];
    } catch {
      return [];
    }
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

  /** Writes finalRank on every non-abandoned racer and returns the official classification. */
  private async finalizeRanking(raceId: string): Promise<RaceRankingEntry[]> {
    const rows = await this.loadRaceActivities(raceId);
    const ranked = RaceManager.sortRanking(rows.filter((r: any) => r.get("status") !== "abandoned"));
    const result: RaceRankingEntry[] = [];
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i];
      try {
        await r.update({ finalRank: i + 1 });
      } catch {}
      result.push({
        rank: i + 1,
        userId: r.get("userId"),
        userName: r.get("userName") || r.get("userId"),
        netDistance: (r.get("netDistance") as number) || 0,
        status: r.get("status"),
        isBot: r.get("isBot") === true
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
          await this.advanceBots(race, rows, now);

          const live = RaceManager.sortRanking(rows.filter((r: any) => r.get("status") !== "abandoned"));
          if (live.length > 0) {
            socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(live));
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

      if ((race.status === "COUNTDOWN" || (race.status === "LOBBY" && race.autoStart)) && now >= race.lobbyEndsAt) {
        // En mode programmé, départ automatique uniquement s'il y a des participants connectés ou validés
        if (race.status === "LOBBY" && race.autoStart) {
          const rows = await this.loadRaceActivities(race.id);
          const hasParticipants =
            (race.participants && race.participants.size > 0) ||
            rows.some((r: any) => !r.get("isBot") && ["waiting", "in_progress"].includes(r.get("status")));
          if (!hasParticipants) {
            // Pas encore de participant, on laisse le lobby ouvert
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
          await this.advanceBots(race, rows, now);

          const live = RaceManager.sortRanking(rows.filter((r: any) => r.get("status") !== "abandoned"));
          if (live.length > 0) {
            socketGateway.broadcastLeaderboard(race.id, RaceManager.toLiveMetrics(live));

            const allFinished = live.every(
              (act: any) => act.get("status") === "finished" || ((act.get("netDistance") as number) || 0) >= race.targetDistance
            );
            if (allFinished) {
              await this.finishPrivateRace(race, "completed");
              continue;
            }
          }

          const activeHumans = rows.filter((r: any) => this.isActiveHuman(r, now));
          if (activeHumans.length === 0) {
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
    socketGateway.broadcastRaceStatus(race.id, "COMPLETED", { reason, ranking });
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
    if (this.currentPublicRace && (this.currentPublicRace.status === "LOBBY" || this.currentPublicRace.status === "COUNTDOWN")) {
      this.currentPublicRace.targetDistance = this.adminPublicRaceConfig.targetDistance;
      this.currentPublicRace.maxParticipants = this.adminPublicRaceConfig.maxParticipants;
      this.currentPublicRace.maxDurationMinutes = this.adminPublicRaceConfig.maxDurationMinutes;
    }
    return this.adminPublicRaceConfig;
  }

  private async ensureDefaultPublicBots(raceId: string, count: number, pace: number, targetDistance: number): Promise<void> {
    if (count <= 0) return;
    const names = ["Bot Argonaut", "Bot Poseidon", "Bot Nautilus", "Bot Triton", "Bot Thalassa"];
    for (let i = 0; i < count; i++) {
      const botId = `bot_pub_${i + 1}`;
      const compositeId = `${raceId}_${botId}`;
      const name = names[i % names.length];
      const botPace = pace + (i * 3);
      const speedMs = 500 / botPace;
      const power = Math.round(2.80 * Math.pow(speedMs, 3));
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
            lastStrokeRate: 26,
            lastStrokeCount: 0,
            lastHeartRate: 155,
            lastResistance: 4,
            totalStrokes: 0,
            totalEnergy: 0,
            lastPower: power,
            lastPace: botPace,
            avgPower: power,
            avgPace: botPace,
            avgStrokeRate: 26,
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
    if (managed) {
      managed.status = "COMPLETED";
      managed.endedAt = new Date();
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

    socketGateway.broadcastRaceStatus(raceId, "COMPLETED", {
      reason: reason || (timeoutTriggered ? "timeout" : "completed"),
      ranking
    });

    if (this.currentPublicRace && this.currentPublicRace.id === raceId) {
      await this.initNextPublicRace(15);
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
    hostUserId: string;
    hostUserName?: string;
    startMode?: "manual" | "scheduled";
    scheduledStartTime?: Date | string;
    countdownMinutes?: number;
    requireApproval?: boolean;
    botCount?: number;
    botMaxPace?: number;
    isBotDuel?: boolean;
    botCustomName?: string;
  }): RaceState {
    const code = this.generateUniqueMeetCode();
    const pin = this.generateUniquePinCode();
    const raceId = `PRIV_${code.replace(/-/g, "")}`;
    const now = new Date();

    const isBotDuel = Boolean(options.isBotDuel);

    let cleanTitle = String(options.title || (isBotDuel ? "Duel 1v1 contre un Bot" : "Régate Privée"))
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .slice(0, 64) || (isBotDuel ? "Duel 1v1 contre un Bot" : "Régate Privée");

    const rawDist = Number(options.targetDistance);
    const maxDistLimit = isBotDuel ? 10000 : 100000;
    const targetDistance = Number.isFinite(rawDist)
      ? Math.min(maxDistLimit, Math.max(100, Math.round(rawDist)))
      : (isBotDuel ? 2000 : 2000);

    const rawMax = Number(options.maxParticipants);
    const maxParticipants = isBotDuel
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

    const requireApproval = isBotDuel
      ? false
      : (options.requireApproval !== undefined ? Boolean(options.requireApproval) : true);
    const participants = new Map<string, PrivateParticipantInfo>();
    const pendingParticipants = new Map<string, PrivateParticipantInfo>();
    const rejectedParticipants = new Set<string>();

    let botCount = isBotDuel ? 1 : Math.min(10, Math.max(0, Number(options.botCount) || 0));
    let botMaxPace = Math.min(300, Math.max(60, Number(options.botMaxPace) || 120));
    let botCustomName = options.botCustomName;

    if (isBotDuel) {
      // Niveau aléatoire du bot (allure entre 105s et 150s / 500m)
      const randomPace = Math.floor(Math.random() * (150 - 105 + 1)) + 105;
      botMaxPace = randomPace;
      let levelLabel = "Intermédiaire";
      if (randomPace <= 114) {
        levelLabel = "Élite";
      } else if (randomPace <= 124) {
        levelLabel = "Avancé";
      } else if (randomPace <= 138) {
        levelLabel = "Intermédiaire";
      } else {
        levelLabel = "Débutant";
      }
      botCustomName = `Bot ${levelLabel}`;
      cleanTitle = `Duel 1v1 - Bot ${levelLabel} (${targetDistance}m)`;
    }

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
      startMode,
      scheduledStartTime: scheduledDate,
      botCount,
      botMaxPace,
      autoStart,
      hasBots: botCount > 0,
      isBotDuel,
      totalParticipants: 0,
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
    const names = ["Bot Challenger", "Bot Pacer", "Bot Tempo", "Bot Shadow", "Bot Swift"];
    for (let i = 0; i < botCount; i++) {
      const botId = `bot_salon_${i + 1}`;
      const compositeId = `${raceId}_${botId}`;
      const name = customName || names[i % names.length];
      const botPace = botMaxPace + (i * 2);
      const speedMs = 500 / botPace;
      const power = Math.round(2.80 * Math.pow(speedMs, 3));
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
            lastStrokeRate: 26,
            lastStrokeCount: 0,
            lastHeartRate: 155,
            lastResistance: 4,
            totalStrokes: 0,
            totalEnergy: 0,
            lastPower: power,
            lastPace: botPace,
            avgPower: power,
            avgPace: botPace,
            avgStrokeRate: 26,
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

    // 3. Alphanumeric PIN (4 to 8 characters, case-insensitive)
    if (/^[a-zA-Z0-9]{4,8}$/.test(trimmed)) {
      const pinHit = this.pinToRaceMap.get(trimmed.toUpperCase());
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
    userName?: string,
    country?: string
  ): { race: RaceState; alreadyJoined: boolean; pending?: boolean; rejected?: boolean } | { error: string; statusCode: number } {
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

    if (race.rejectedParticipants.has(cleanUserId)) {
      return { error: "Votre demande de participation a été refusée par l'hôte.", statusCode: 403, rejected: true };
    }

    const alreadyApproved = race.participants.has(cleanUserId);
    const isHost = Boolean(cleanUserId && race.hostUserId && cleanUserId === race.hostUserId);

    if (race.isBotDuel && !isHost && !alreadyApproved) {
      return { error: "Ce salon est un duel privé réservé exclusivement contre un bot.", statusCode: 403 };
    }

    // If host requires approval, player is not host, and not yet approved -> put in pending queue
    if (race.requireApproval && !isHost && !alreadyApproved) {
      const pendingInfo: PrivateParticipantInfo = {
        userId: cleanUserId,
        userName: cleanName,
        joinedAt: new Date(),
        country
      };
      race.pendingParticipants.set(cleanUserId, pendingInfo);
      socketGateway.broadcastPrivateRoomUpdate(race.id, {
        type: "PARTICIPANT_PENDING",
        userId: cleanUserId,
        userName: cleanName
      });
      return { race, alreadyJoined: false, pending: true };
    }

    if (!alreadyApproved && race.participants.size >= race.maxParticipants) {
      return { error: `Ce salon privé est complet (${race.maxParticipants} joueurs max).`, statusCode: 409 };
    }

    // Moving to approved: remove from pending
    race.pendingParticipants.delete(cleanUserId);

    race.participants.set(cleanUserId, {
      userId: cleanUserId,
      userName: cleanName,
      joinedAt: new Date(),
      country
    });
    race.totalParticipants = Math.max(race.totalParticipants || 0, race.participants.size);

    return { race, alreadyJoined: alreadyApproved, pending: false };
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
    if (race.hostUserId && cleanUserId === race.hostUserId) {
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

  public canManagePrivateRace(race: RaceState, hostUserId?: string, isAdmin?: boolean): boolean {
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
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const avoidUpper = avoidPin ? avoidPin.toUpperCase() : undefined;
    for (let attempt = 0; attempt < 200; attempt++) {
      let candidate = "";
      for (let i = 0; i < 5; i++) {
        candidate += chars[Math.floor(Math.random() * chars.length)];
      }
      if (candidate !== avoidUpper && !this.pinToRaceMap.has(candidate)) {
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
