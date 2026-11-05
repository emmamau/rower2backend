import { Op } from "sequelize";
import db from "../models";
import socketGateway, { LiveRacerMetric } from "../websocket/socket.gateway";
import config from "../config";

const Races = db.races;
const Activities = db.activities;
const Users = db.users;

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
}

export class RaceManager {
  private static instance: RaceManager;
  private currentPublicRace: RaceState | null = null;
  private privateRaces: Map<string, RaceState> = new Map(); // code -> RaceState
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

  /**
   * Main state machine ticker running every 1 second
   */
  private startOrchestratorLoop(): void {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = setInterval(async () => {
      try {
        await this.tickPublicRace();
      } catch (err) {
        console.error("[RaceManager] Error in tick:", err);
      }
    }, 1000);
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
        // Check active participants
        const participantCount = await Activities.count({
          where: { activityId: race.id, status: { [Op.ne]: "abandoned" } }
        });

        if (participantCount > 0) {
          // Launch race
          race.status = "RUNNING";
          race.startedAt = new Date();
          console.log(`[RaceManager] Public Race ${race.id} started with ${participantCount} racers!`);
          await Races.update({ status: "in_progress", startTime: race.startedAt }, { where: { id: race.id } });
          socketGateway.broadcastRaceStatus(race.id, "RUNNING", { startedAt: race.startedAt });
        } else {
          // Silent reset
          console.log(`[RaceManager] 0 participants in Lobby at expiration. Silent reset 15m.`);
          await Races.update({ status: "cancelled" }, { where: { id: race.id } });
          await this.initNextPublicRace(15);
        }
      }
    } else if (race.status === "RUNNING") {
      const startTime = race.startedAt || now;
      const elapsedMinutes = (now.getTime() - startTime.getTime()) / (60 * 1000);

      // 55 minutes max duration limit
      if (elapsedMinutes >= (race.maxDurationMinutes || 55)) {
        console.log(`[RaceManager] Max duration (55m) reached for race ${race.id}. Finishing.`);
        await this.finishRace(race.id, true);
      } else {
        // Check if all active non-abandoned participants have finished
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
   * Initializes the next scheduled public race
   */
  public async initNextPublicRace(delayMinutes?: number): Promise<RaceState> {
    const now = new Date();
    const intervalMin = delayMinutes || config.raceIntervalMinutes || 15;
    const lobbyEndsAt = new Date(now.getTime() + intervalMin * 60 * 1000);
    const raceId = `RACE_${lobbyEndsAt.toISOString().replace(/[-:T.]/g, "").slice(0, 12)}`;
    const pin = this.generatePinCode();

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

    this.currentPublicRace = {
      id: raceId,
      title,
      type: "PUBLIC_HOURLY",
      status: "LOBBY",
      targetDistance: config.defaultRaceDistanceMeters || 2000,
      maxParticipants: 20,
      maxDurationMinutes: 55,
      lobbyEndsAt,
      pinCode: pin
    };

    this.pinToRaceMap.set(pin, { raceId, lane: 1 });
    console.log(`[RaceManager] New Public Race scheduled: ${raceId} | PIN: ${pin} | Lobby until: ${lobbyEndsAt.toISOString()}`);
    return this.currentPublicRace;
  }

  /**
   * Finishes race and prepares the next slot
   */
  public async finishRace(raceId: string, timeoutTriggered: boolean): Promise<void> {
    const now = new Date();

    if (timeoutTriggered) {
      // Mark remaining racers as out_of_time
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

    // The next race takes place 1 hour after the start of this race, or in 15 min if delayed
    const nextSlot = new Date(now.getTime() + 15 * 60 * 1000);
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
  }): RaceState {
    const code = this.generateMeetCode();
    const pin = this.generatePinCode();
    const raceId = `PRIV_${code.replace(/-/g, "")}`;
    const now = new Date();

    const privateRace: RaceState = {
      id: raceId,
      code,
      title: options.title || "Régate Privée",
      type: "PRIVATE_INVITE",
      status: "LOBBY",
      targetDistance: options.targetDistance || 2000,
      maxParticipants: options.maxParticipants || 8,
      maxDurationMinutes: 55,
      lobbyEndsAt: new Date(now.getTime() + 60 * 60 * 1000), // Host triggers start manually
      pinCode: pin
    };

    this.privateRaces.set(code, privateRace);
    this.pinToRaceMap.set(pin, { raceId, lane: 1 });

    return privateRace;
  }

  public getRaceByPin(pin: string): { raceId: string; lane: number } | null {
    return this.pinToRaceMap.get(pin) || null;
  }

  public getCurrentPublicRace(): RaceState | null {
    return this.currentPublicRace;
  }

  public getPrivateRaceByCode(code: string): RaceState | null {
    return this.privateRaces.get(code) || null;
  }

  private generatePinCode(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  private generateMeetCode(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz";
    const segment = (len: number) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    return `${segment(3)}-${segment(3)}-${segment(3)}`;
  }
}

export default RaceManager.getInstance();
