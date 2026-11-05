import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import raceManager from "../services/race-manager.service";
import socketGateway, { LiveRacerMetric } from "../websocket/socket.gateway";
import { TelemetryValidator, TelemetryPayload } from "../services/telemetry-validator.service";

const Activities = db.activities;
const Races = db.races;
const Users = db.users;

export class TelemetryController {
  /**
   * POST /api/v1/telemetry
   * Stroke-by-Stroke ingestion endpoint according to specification:
   * Input: { raceId, userId, seq, timestamp, metrics: { distanceM, splitSec, powerWatts, strokeRate, heartRate } }
   * Output (compact sync): { rk, tot, gapM, leadDistM, status }
   */
  public static async ingestTelemetry(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body;
      const raceId = body.raceId || (await raceManager.getCurrentPublicRace())?.id;
      const userId = body.userId || "anonymous";

      if (!raceId) {
        res.status(400).json({ error: "Missing raceId" });
        return;
      }

      // Extract metrics either from standard format or legacy flat format
      const distanceM = Number(body.metrics?.distanceM ?? body.currentDistance ?? 0);
      const splitSec = Number(body.metrics?.splitSec ?? body.instantPace ?? 0);
      const powerWatts = Number(body.metrics?.powerWatts ?? body.instantPower ?? 0);
      const strokeRate = Number(body.metrics?.strokeRate ?? 0);
      const heartRate = Number(body.metrics?.heartRate ?? body.heartRate ?? 0);

      const compositeId = `${raceId}_${userId}`;
      let activity = await Activities.findByPk(compositeId);

      const prevDistance = activity ? (activity.get("currentDistance") as number) : 0;
      const prevTime = activity ? (activity.get("elapsedTime") as number) : 0;

      const validation = TelemetryValidator.validate(
        {
          raceId,
          userId,
          seq: body.seq,
          timestamp: body.timestamp || Date.now(),
          metrics: { distanceM, splitSec, powerWatts, strokeRate, heartRate }
        },
        prevDistance,
        prevTime
      );

      const actualDistance = validation.sanitizedDistance;
      const actualPower = validation.sanitizedPower;
      const actualSplit = validation.sanitizedSplit;
      const actualSpm = validation.sanitizedSpm;

      const race = raceManager.getCurrentPublicRace();
      const targetDist = race?.targetDistance || 2000;
      const isFinished = actualDistance >= targetDist;
      const activityStatus = isFinished ? "finished" : "in_progress";

      if (!activity) {
        activity = await Activities.create({
          id: compositeId,
          activityId: raceId,
          userId,
          userName: body.userName || `Racer_${userId.slice(-4)}`,
          raceMode: "race",
          targetDistance: targetDist,
          status: activityStatus,
          initialDistance: 0,
          currentDistance: actualDistance,
          netDistance: actualDistance,
          progressPercent: Math.min(100, Number(((actualDistance / targetDist) * 100).toFixed(1))),
          lastStrokeRate: actualSpm,
          lastPower: actualPower,
          lastPace: actualSplit,
          lastHeartRate: heartRate,
          avgPower: actualPower,
          avgPace: actualSplit,
          avgStrokeRate: actualSpm,
          totalStrokes: Number(body.seq || 1),
          elapsedTime: Number(body.elapsedTime || 1),
          lastStrokeCount: Number(body.seq || 1),
          lastResistance: 1,
          totalEnergy: 0,
          avgSpeedKmh: actualSplit > 0 ? Number(((500 / actualSplit) * 3.6).toFixed(1)) : 0
        });
      } else {
        const prevAvgP = (activity.get("avgPower") as number) || actualPower;
        const newAvgP = actualPower > 0 ? Math.round((prevAvgP + actualPower) / 2) : prevAvgP;
        const prevLastP = (activity.get("lastPower") as number) || 0;
        const effectiveLastP = actualPower > 0 ? actualPower : (isFinished ? prevLastP : 0);

        const prevAvgSplit = (activity.get("avgPace") as number) || actualSplit;
        const newAvgSplit = actualSplit > 0 ? Math.round((prevAvgSplit + actualSplit) / 2) : prevAvgSplit;

        await activity.update({
          currentDistance: actualDistance,
          netDistance: actualDistance,
          progressPercent: Math.min(100, Number(((actualDistance / targetDist) * 100).toFixed(1))),
          status: activityStatus,
          lastStrokeRate: actualSpm,
          lastPower: effectiveLastP,
          lastPace: actualSplit,
          lastHeartRate: heartRate,
          avgPower: newAvgP,
          avgPace: newAvgSplit,
          totalStrokes: Number(body.seq || (activity.get("totalStrokes") as number) + 1),
          elapsedTime: Number(body.elapsedTime || (activity.get("elapsedTime") as number) + 2),
          avgSpeedKmh: actualSplit > 0 ? Number(((500 / actualSplit) * 3.6).toFixed(1)) : 0,
          finishedAt: isFinished ? new Date() : (activity.get("finishedAt") as Date)
        });
      }

      // Compute rank & gaps
      const activeRacers = await Activities.findAll({
        where: { activityId: raceId, status: { [Op.ne]: "abandoned" } },
        order: [
          ["status", "ASC"], // finished first
          ["netDistance", "DESC"],
          ["elapsedTime", "ASC"]
        ]
      });

      const totalRacers = activeRacers.length;
      const myIdx = activeRacers.findIndex((a: any) => a.get("userId") === userId);
      const myRank = myIdx >= 0 ? myIdx + 1 : 1;
      const leaderDist = activeRacers.length > 0 ? (activeRacers[0].get("netDistance") as number) : actualDistance;
      const gapM = -Math.max(0, Number((leaderDist - actualDistance).toFixed(1)));

      // Broadcast WebSocket leaderboard update to web clients
      const liveList: LiveRacerMetric[] = activeRacers.map((r: any, idx: number) => ({
        lane: idx + 1,
        userId: r.get("userId"),
        name: r.get("userName") || r.get("userId"),
        dist: r.get("netDistance") as number,
        split: (r.get("lastPace") as number) || 120,
        watts: (r.get("lastPower") as number) || 0,
        spm: (r.get("lastStrokeRate") as number) || 0,
        heartRate: r.get("lastHeartRate") as number,
        status: r.get("status")
      }));
      socketGateway.broadcastLeaderboard(raceId, liveList);

      // Return compact synchronous JSON response required by spec (7.1.B)
      res.status(200).json({
        rk: myRank,
        tot: totalRacers,
        gapM,
        leadDistM: leaderDist,
        status: (race?.status === "RUNNING" ? "RUNNING" : race?.status) || "RUNNING"
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Telemetry ingestion failure: " + message });
    }
  }

  /**
   * GET /api/v1/races/current
   * State and PIN info for lobby / connection
   */
  public static async getCurrentRace(req: Request, res: Response): Promise<void> {
    const race = await raceManager.tickPublicRace();
    const remainingSec = Math.max(0, Math.floor((race.lobbyEndsAt.getTime() - Date.now()) / 1000));
    res.status(200).json({
      race,
      secondsRemaining: remainingSec,
      pinCode: race.pinCode,
      formattedCountdown: `${Math.floor(remainingSec / 60)}:${(remainingSec % 60).toString().padStart(2, "0")}`
    });
  }

  /**
   * POST /api/v1/races/private
   * Create Google Meet style private race
   */
  public static createPrivateRace(req: Request, res: Response): void {
    const { title, targetDistance, maxParticipants, hostUserId } = req.body;
    const race = raceManager.createPrivateRace({
      title: title || "Régate Privée",
      targetDistance: Number(targetDistance) || 2000,
      maxParticipants: Number(maxParticipants) || 8,
      hostUserId: hostUserId || "admin"
    });
    res.status(201).json({
      success: true,
      race,
      inviteUrl: `/r/${race.code}`,
      pinCode: race.pinCode
    });
  }

  /**
   * GET /api/v1/races/pin/:pin
   * Quick join by 4-digit PIN for Garmin watch
   */
  public static getRaceByPin(req: Request, res: Response): void {
    const pin = req.params.pin;
    const matched = raceManager.getRaceByPin(pin);
    if (!matched) {
      res.status(404).json({ error: "Invalid PIN code" });
      return;
    }
    res.status(200).json(matched);
  }
}

export default TelemetryController;
