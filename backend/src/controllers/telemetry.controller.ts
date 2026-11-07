import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import raceManager, { RaceState } from "../services/race-manager.service";
import socketGateway, { LiveRacerMetric } from "../websocket/socket.gateway";
import { TelemetryValidator } from "../services/telemetry-validator.service";
import { isEmmaAdminUser } from "../services/auth.service";
import userStore from "../services/user-store.service";
import { SUBSCRIPTION_TIERS } from "./subscription.controller";

const Activities = db.activities;
const Races = db.races;
const Users = db.users;

function mapRaceStatusToApi(status: RaceState["status"]): string {
  if (status === "RUNNING") return "in_progress";
  if (status === "COMPLETED") return "finished";
  if (status === "ABANDONED") return "cancelled";
  return "waiting";
}

async function isUserAdminHelper(userId?: string): Promise<boolean> {
  if (!userId) return false;
  if (isEmmaAdminUser(userId)) return true;
  const u = await userStore.findUser(userId);
  if (!u) return false;
  return Boolean(u.isAdmin);
}

async function isUserSubscriberOrAdmin(userId?: string, userName?: string): Promise<{ authorized: boolean; reason?: string }> {
  // EmmaRacer est administratrice en dur (droits de création complets)
  if (isEmmaAdminUser(userId, userName)) {
    return { authorized: true };
  }

  const cleanId = String(userId || "").trim();

  // Les utilisateurs invités / anonymes non connectés ne peuvent pas créer de salons privés
  if (!cleanId || cleanId === "anonymous" || cleanId.startsWith("guest_") || cleanId.startsWith("usr_")) {
    return {
      authorized: false,
      reason: "La création de salon privé est réservée aux abonnés. Veuillez vous connecter avec votre compte abonné."
    };
  }

  const user = await userStore.findUser(cleanId);
  if (user) {
    if (user.isAdmin || user.isSubscriber) {
      return { authorized: true };
    }
    return {
      authorized: false,
      reason: "Votre compte n'a pas d'abonnement actif pour créer des salons privés."
    };
  }

  return {
    authorized: false,
    reason: "La création de salon privé est réservée aux abonnés. Veuillez vous connecter avec votre compte abonné."
  };
}

async function countPrivateParticipants(race: RaceState): Promise<number> {
  const memCount = race.participants ? race.participants.size : 0;
  try {
    const dbCount = await Activities.count({
      where: {
        activityId: race.id,
        status: { [Op.ne]: "abandoned" }
      }
    });
    const total = Math.max(memCount, dbCount);
    race.totalParticipants = total;
    return total;
  } catch {
    return Math.max(memCount, race.totalParticipants || 0);
  }
}

async function buildPrivateRacePayload(race: RaceState) {
  const nowMs = Date.now();
  const apiStatus = mapRaceStatusToApi(race.status);
  const waitingForHost = race.status === "LOBBY" && !race.autoStart;
  const timing = raceManager.getRaceTiming(race, new Date(nowMs));

  let secondsRemaining = 0;
  if (!waitingForHost && (race.status === "LOBBY" || race.status === "COUNTDOWN")) {
    secondsRemaining = timing.secondsUntilStart;
  }

  const elapsedSeconds = timing.elapsedSeconds;
  const remainingSeconds = timing.remainingSeconds;
  const maxDurationSeconds = timing.maxDurationSeconds;

  let formattedCountdown = `${Math.floor(secondsRemaining / 60)}m ${secondsRemaining % 60}s`;
  if (waitingForHost) {
    formattedCountdown = "PRÊT";
  } else if (race.status === "RUNNING") {
    formattedCountdown = `${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s`;
  } else if (race.status === "COMPLETED") {
    formattedCountdown = "TERMINÉ";
  }

  const totalParticipants = await countPrivateParticipants(race);
  const participantsList = race.participants
    ? Array.from(race.participants.values())
    : [];
  const pendingList = race.pendingParticipants
    ? Array.from(race.pendingParticipants.values())
    : [];

  const serializedRace = {
    id: race.id,
    code: race.code,
    pinCode: race.pinCode,
    type: race.type,
    title: race.title,
    targetDistance: race.targetDistance,
    startTime: (race.startedAt || race.lobbyEndsAt).toISOString(),
    intervalMinutes: 0,
    maxDurationMinutes: race.maxDurationMinutes || 55,
    maxParticipants: race.maxParticipants,
    hostUserId: race.hostUserId,
    hostUserName: race.hostUserName,
    startMode: race.startMode || "manual",
    scheduledStartTime: race.scheduledStartTime ? race.scheduledStartTime.toISOString() : undefined,
    botCount: race.botCount || 0,
    botMaxPace: race.botMaxPace || 120,
    autoStart: Boolean(race.autoStart),
    hasBots: Boolean(race.hasBots),
    status: apiStatus,
    internalStatus: race.status,
    totalParticipants,
    requireApproval: race.requireApproval !== undefined ? race.requireApproval : true,
    participants: participantsList,
    pendingParticipants: pendingList,
    createdAt: race.createdAt ? race.createdAt.toISOString() : undefined
  };

  return {
    success: true,
    race: serializedRace,
    code: race.code,
    pinCode: race.pinCode,
    inviteUrl: race.code ? `/r/${race.code}` : undefined,
    secondsRemaining,
    remainingSeconds,
    elapsedSeconds,
    maxDurationSeconds,
    waitingForHost,
    formattedCountdown,
    totalParticipants,
    requireApproval: race.requireApproval !== undefined ? race.requireApproval : true,
    pendingParticipants: pendingList,
    status: apiStatus
  };
}

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
      const raceId = body.raceId || raceManager.getCurrentPublicRace()?.id;
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

      const watchModel = String(body.watchModel || "Garmin Connect IQ").slice(0, 64);
      const rowerModel = String(body.rowerModel || body.deviceName || "FTMS / SmartRow").slice(0, 64);

      // Algorithme Concept2 officiel basé sur la puissance en Watts :
      // Vitesse (m/s) = (Watts / 2.80)^(1/3)
      let effectiveDistance = actualDistance;
      const currentElapsed = Number(body.elapsedTime || (activity ? Number(activity.get("elapsedTime")) + 1 : 1));
      const prevElapsed = activity ? Number(activity.get("elapsedTime") || 0) : 0;
      const deltaSec = Math.max(0, Math.min(10, currentElapsed - prevElapsed));

      if (actualPower > 0 && deltaSec > 0 && deltaSec <= 10) {
        const c2Speed = Math.cbrt(actualPower / 2.80);
        const prevNetDist = activity ? Number(activity.get("netDistance") || 0) : 0;
        effectiveDistance = Math.round(prevNetDist + (c2Speed * deltaSec));
      }

      const matchedRace = raceManager.getRaceById(raceId) || raceManager.getCurrentPublicRace();
      const targetDist = matchedRace?.targetDistance || Number(body.targetDistance) || 2000;
      const isFinished = effectiveDistance >= targetDist;
      const activityStatus = body.status === "abandoned" ? "abandoned" : (isFinished ? "finished" : "in_progress");

      if (matchedRace && userId !== "anonymous") {
        if (!matchedRace.participants) {
          matchedRace.participants = new Map();
        }
        const isNewParticipant = !matchedRace.participants.has(userId);
        if (isNewParticipant) {
          matchedRace.participants.set(userId, {
            userId,
            userName: body.userName || `Racer_${userId.slice(-4)}`,
            joinedAt: new Date()
          });
          if (matchedRace.type === "PUBLIC_HOURLY" && (matchedRace.status === "LOBBY" || matchedRace.status === "COUNTDOWN")) {
            raceManager.notifyPlayerJoinedPublic(userId);
          }
        }
      }

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
          netDistance: effectiveDistance,
          progressPercent: Math.min(100, Number(((effectiveDistance / targetDist) * 100).toFixed(1))),
          lastStrokeRate: actualSpm,
          lastPower: actualPower,
          lastPace: actualSplit,
          lastHeartRate: heartRate,
          avgPower: actualPower,
          avgPace: actualSplit,
          avgStrokeRate: actualSpm,
          totalStrokes: Number(body.seq || 1),
          elapsedTime: currentElapsed,
          lastStrokeCount: Number(body.seq || 1),
          lastResistance: 1,
          totalEnergy: 0,
          avgSpeedKmh: actualSplit > 0 ? Number(((500 / actualSplit) * 3.6).toFixed(1)) : 0,
          watchModel,
          rowerModel
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
          netDistance: effectiveDistance,
          progressPercent: Math.min(100, Number(((effectiveDistance / targetDist) * 100).toFixed(1))),
          status: activityStatus,
          lastStrokeRate: actualSpm,
          lastPower: effectiveLastP,
          lastPace: actualSplit,
          lastHeartRate: heartRate,
          avgPower: newAvgP,
          avgPace: newAvgSplit,
          totalStrokes: Number(body.seq || (activity.get("totalStrokes") as number) + 1),
          elapsedTime: currentElapsed,
          avgSpeedKmh: actualSplit > 0 ? Number(((500 / actualSplit) * 3.6).toFixed(1)) : 0,
          finishedAt: isFinished ? new Date() : (activity.get("finishedAt") as Date),
          watchModel,
          rowerModel
        });
      }

      // Sync equipment to user profile if user exists
      if (userId && userId !== "anonymous") {
        try {
          await Users.update(
            { watchModel, rowerModel },
            { where: { [Op.or]: [{ id: userId }, { login: userId }, { watchUserId: userId }] } }
          );
        } catch {}
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

      let distToPrev = 0;
      let distToNext = 0;
      if (myIdx >= 0 && activeRacers.length > 0) {
        if (myIdx > 0) {
          const prevDist = (activeRacers[myIdx - 1].get("netDistance") as number) || 0;
          distToPrev = Math.max(0, Math.round(prevDist - actualDistance));
        }
        if (myIdx < activeRacers.length - 1) {
          const nextDist = (activeRacers[myIdx + 1].get("netDistance") as number) || 0;
          distToNext = Math.max(0, Math.round(actualDistance - nextDist));
        }
      }

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

      res.status(200).json({
        rk: myRank,
        tot: totalRacers,
        gapM,
        leadDistM: leaderDist,
        distToLeader: Math.max(0, leaderDist - effectiveDistance),
        distToPrev,
        distToNext,
        normalized: true,
        fairnessNotice: "La distance est normalisée selon la formule Concept2 basée sur votre puissance en Watts pour garantir l'égalité sportive entre tous les modèles de rameurs.",
        watchModel,
        rowerModel,
        status: (matchedRace?.status === "RUNNING" ? "RUNNING" : matchedRace?.status) || "RUNNING"
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
  public static async getCurrentRace(_req: Request, res: Response): Promise<void> {
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
   * Create Google Meet style private race + 4-digit PIN
   */
  public static async createPrivateRace(req: Request, res: Response): Promise<void> {
    try {
      const {
        title,
        targetDistance,
        maxParticipants,
        hostUserId,
        hostUserName,
        countdownMinutes,
        requireApproval,
        startMode,
        scheduledStartTime,
        botCount,
        botMaxPace
      } = req.body || {};

      const authCheck = await isUserSubscriberOrAdmin(hostUserId, hostUserName);
      if (!authCheck.authorized) {
        res.status(403).json({
          success: false,
          error: authCheck.reason || "La création de salon privé est réservée aux abonnés.",
          code: "SUBSCRIBER_REQUIRED"
        });
        return;
      }

      // Valider et borner les quotas selon le forfait d'abonnement
      const user = await userStore.findUser(hostUserId);
      const isEmma = isEmmaAdminUser(hostUserId, hostUserName);

      let maxAllowed = 30;
      let distAllowed = 100000;
      let botsAllowed = 5;

      if (user && !isEmma && !user.isAdmin && user.subscriptionTier) {
        const tierId: string = user.subscriptionTier;
        const limits = SUBSCRIPTION_TIERS[tierId] || SUBSCRIPTION_TIERS.intermediate;
        maxAllowed = limits.maxParticipants;
        distAllowed = limits.maxDistance;
        botsAllowed = limits.maxBots;
      }

      const rawDist = Number(targetDistance) || 2000;
      const finalDist = Math.min(distAllowed, Math.max(100, rawDist));

      const rawMax = Number(maxParticipants) || maxAllowed;
      const finalMax = Math.min(maxAllowed, Math.max(2, rawMax));

      const rawBots = Number(botCount) || 0;
      const finalBots = Math.min(botsAllowed, Math.max(0, rawBots));
      const finalBotPace = Math.min(300, Math.max(60, Number(botMaxPace) || 120));

      const race = raceManager.createPrivateRace({
        title: title || "Régate Privée",
        targetDistance: finalDist,
        maxParticipants: finalMax,
        hostUserId: hostUserId || "anonymous",
        hostUserName,
        startMode: startMode === "scheduled" ? "scheduled" : "manual",
        scheduledStartTime,
        countdownMinutes: countdownMinutes !== undefined ? Number(countdownMinutes) : 0,
        requireApproval: requireApproval !== undefined ? Boolean(requireApproval) : true,
        botCount: finalBots,
        botMaxPace: finalBotPace
      });

      // Best-effort persistence in PostgreSQL Races table so bots & history work seamlessly
      try {
        await Races.upsert({
          id: race.id,
          title: race.title,
          targetDistance: race.targetDistance,
          startTime: race.lobbyEndsAt,
          intervalMinutes: 0,
          maxDurationMinutes: race.maxDurationMinutes || 55,
          status: "waiting",
          hasBots: false,
          totalParticipants: 0
        });
      } catch {
        // Non-blocking if DB is offline during standalone/local execution
      }

      const payload = await buildPrivateRacePayload(race);
      res.status(201).json(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erreur création salon privé: " + message });
    }
  }

  /**
   * GET /api/v1/races/private
   * List private races for a hostUserId or known invite codes
   */
  public static async listPrivateRaces(req: Request, res: Response): Promise<void> {
    try {
      const hostUserId = typeof req.query.hostUserId === "string" ? req.query.hostUserId : undefined;
      const codesParam = typeof req.query.codes === "string" ? req.query.codes : "";
      const knownCodes = codesParam
        ? codesParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 30)
        : [];

      const list = raceManager.listPrivateRaces(hostUserId, knownCodes);
      const serialized = [];
      for (const r of list) {
        serialized.push(await buildPrivateRacePayload(r));
      }
      res.status(200).json({ success: true, races: serialized });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erreur liste salons privés: " + message });
    }
  }

  /**
   * GET /api/v1/races/private/:identifier
   * Retrieve private salon state by Meet code (krm-wzx-qpl), raceId (PRIV_...), or 4-digit PIN
   */
  public static async getPrivateRace(req: Request, res: Response): Promise<void> {
    try {
      const identifier = String(req.params.identifier || "");
      const race = raceManager.findPrivateRace(identifier);
      if (!race) {
        res.status(404).json({ error: "Salon privé introuvable ou expiré." });
        return;
      }
      const payload = await buildPrivateRacePayload(race);
      res.status(200).json(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erreur lecture salon privé: " + message });
    }
  }

  /**
   * POST /api/v1/races/private/:identifier/join
   * Join a private salon (and optionally register a starting lane)
   */
  public static async joinPrivateRace(req: Request, res: Response): Promise<void> {
    try {
      const identifier = String(req.params.identifier || "");
      const { userId, userName, registerLane = false } = req.body || {};

      const race = raceManager.findPrivateRace(identifier);
      if (!race) {
        res.status(404).json({ error: "Salon privé introuvable ou expiré." });
        return;
      }

      if (registerLane && userId) {
        const joined = raceManager.joinPrivateRace(identifier, String(userId), userName);
        if ("error" in joined) {
          res.status(joined.statusCode).json({ error: joined.error });
          return;
        }

        // Best-effort DB registration on starting line
        try {
          const cleanUserId = String(userId).trim();
          const compositeId = `${race.id}_${cleanUserId}`;
          const playerStatus = race.status === "RUNNING" ? "in_progress" : "waiting";
          const existing = await Activities.findByPk(compositeId);
          if (!existing) {
            await Activities.create({
              id: compositeId,
              activityId: race.id,
              userId: cleanUserId,
              userName: userName || `Racer_${cleanUserId.slice(-4)}`,
              raceMode: "race",
              targetDistance: race.targetDistance,
              status: playerStatus,
              initialDistance: 0,
              currentDistance: 0,
              netDistance: 0,
              progressPercent: 0,
              lastStrokeRate: 0,
              lastStrokeCount: 0,
              lastPower: 0,
              lastPace: 0,
              lastHeartRate: 0,
              lastResistance: 1,
              avgPower: 0,
              avgPace: 0,
              avgStrokeRate: 0,
              totalStrokes: 0,
              totalEnergy: 0,
              elapsedTime: 0,
              avgSpeedKmh: 0
            });
          } else if (existing.get("status") === "abandoned") {
            await existing.update({ status: playerStatus, userName: userName || existing.get("userName") });
          }
        } catch {
          // Non-blocking if DB is unavailable
        }
      }

      const payload = await buildPrivateRacePayload(race);
      res.status(200).json(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erreur connexion salon privé: " + message });
    }
  }

  /**
   * POST /api/v1/races/private/:identifier/start
   * Host launches countdown / immediate start or resets salon for a new heat
   */
  public static async startPrivateRace(req: Request, res: Response): Promise<void> {
    try {
      const identifier = String(req.params.identifier || "");
      const { hostUserId, countdownSeconds, reset, targetDistance } = req.body || {};
      const isAdmin = await isUserAdminHelper(hostUserId);

      const outcome = raceManager.startOrResetPrivateRace(identifier, {
        hostUserId,
        isAdmin,
        countdownSeconds: countdownSeconds !== undefined ? Number(countdownSeconds) : 10,
        reset: Boolean(reset),
        targetDistance: targetDistance !== undefined ? Number(targetDistance) : undefined
      });

      if ("error" in outcome) {
        res.status(outcome.statusCode).json({ error: outcome.error });
        return;
      }

      const { race } = outcome;
      try {
        if (reset) {
          await Races.update(
            { status: "waiting", targetDistance: race.targetDistance, startTime: race.lobbyEndsAt },
            { where: { id: race.id } }
          );
          await Activities.update(
            {
              status: "waiting",
              initialDistance: 0,
              currentDistance: 0,
              netDistance: 0,
              progressPercent: 0,
              elapsedTime: 0,
              targetDistance: race.targetDistance
            },
            { where: { activityId: race.id } }
          );
        } else {
          const dbStatus = race.status === "RUNNING" ? "in_progress" : "waiting";
          await Races.update(
            {
              status: dbStatus,
              targetDistance: race.targetDistance,
              startTime: race.startedAt || race.lobbyEndsAt
            },
            { where: { id: race.id } }
          );
          if (race.status === "RUNNING") {
            await Activities.update(
              { status: "in_progress" },
              { where: { activityId: race.id, status: "waiting" } }
            );
          }
        }
      } catch {
        // Non-blocking if DB is unavailable
      }

      const payload = await buildPrivateRacePayload(race);
      res.status(200).json(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erreur démarrage salon privé: " + message });
    }
  }

  /**
   * POST /api/v1/races/private/:identifier/regenerate-pin
   * Host rotates the 4-digit Garmin PIN
   */
  public static async regeneratePrivatePin(req: Request, res: Response): Promise<void> {
    try {
      const identifier = String(req.params.identifier || "");
      const { hostUserId } = req.body || {};
      const isAdmin = await isUserAdminHelper(hostUserId);

      const outcome = raceManager.regeneratePrivatePin(identifier, hostUserId, isAdmin);
      if ("error" in outcome) {
        res.status(outcome.statusCode).json({ error: outcome.error });
        return;
      }

      const payload = await buildPrivateRacePayload(outcome.race);
      res.status(200).json(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erreur régénération PIN: " + message });
    }
  }

  /**
   * POST /api/v1/races/private/:identifier/regenerate-code
   * Host rotates the Meet-style room code and shareable URL while keeping connected racers in the salon
   */
  public static async regeneratePrivateCode(req: Request, res: Response): Promise<void> {
    try {
      const identifier = String(req.params.identifier || "");
      const { hostUserId } = req.body || {};
      const isAdmin = await isUserAdminHelper(hostUserId);

      const outcome = raceManager.regeneratePrivateCode(identifier, hostUserId, isAdmin);
      if ("error" in outcome) {
        res.status(outcome.statusCode).json({ error: outcome.error });
        return;
      }

      const payload = await buildPrivateRacePayload(outcome.race);
      res.status(200).json(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erreur régénération code salon: " + message });
    }
  }

  /**
   * DELETE /api/v1/races/private/:identifier
   * Close private salon and revoke its PIN and invite URL
   */
  public static async closePrivateRace(req: Request, res: Response): Promise<void> {
    try {
      const identifier = String(req.params.identifier || "");
      const hostUserId =
        (typeof req.body?.hostUserId === "string" && req.body.hostUserId) ||
        (typeof req.query.hostUserId === "string" ? req.query.hostUserId : undefined);
      const isAdmin = await isUserAdminHelper(hostUserId);

      const outcome = raceManager.closePrivateRace(identifier, hostUserId, isAdmin);
      if ("error" in outcome) {
        res.status(outcome.statusCode).json({ error: outcome.error });
        return;
      }

      try {
        await Races.update({ status: "cancelled" }, { where: { id: outcome.raceId } });
      } catch {
        // Non-blocking
      }

      res.status(200).json({ success: true, raceId: outcome.raceId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erreur fermeture salon privé: " + message });
    }
  }

  /**
   * POST /api/v1/races/private/:identifier/toggle-approval
   * Host toggles mandatory organizer approval (default: true) or auto-accepts all
   */
  public static async toggleApprovalRequirement(req: Request, res: Response): Promise<void> {
    try {
      const identifier = String(req.params.identifier || "");
      const { hostUserId, requireApproval } = req.body || {};
      const isAdmin = await isUserAdminHelper(hostUserId);

      const outcome = raceManager.toggleApprovalRequirement(
        identifier,
        Boolean(requireApproval),
        hostUserId,
        isAdmin
      );

      if ("error" in outcome) {
        res.status(outcome.statusCode).json({ error: outcome.error });
        return;
      }

      const payload = await buildPrivateRacePayload(outcome.race);
      res.status(200).json(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erreur modification validation salon: " + message });
    }
  }

  /**
   * POST /api/v1/races/private/:identifier/approve-participant
   * Host approves or rejects a player waiting in the pending queue
   */
  public static async approveParticipant(req: Request, res: Response): Promise<void> {
    try {
      const identifier = String(req.params.identifier || "");
      const { hostUserId, targetUserId, approve } = req.body || {};
      const isAdmin = await isUserAdminHelper(hostUserId);

      const outcome = raceManager.approveParticipant(
        identifier,
        targetUserId,
        approve !== undefined ? Boolean(approve) : true,
        hostUserId,
        isAdmin
      );

      if ("error" in outcome) {
        res.status(outcome.statusCode).json({ error: outcome.error });
        return;
      }

      const payload = await buildPrivateRacePayload(outcome.race);
      res.status(200).json({ ...payload, approvedParticipant: outcome.participant });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erreur approbation participant: " + message });
    }
  }

  /**
   * GET /api/v1/races/private/:identifier/participant-status
   * Polling endpoint for watch & web to check if participant is approved, pending, or rejected
   */
  public static async getParticipantStatus(req: Request, res: Response): Promise<void> {
    try {
      const identifier = String(req.params.identifier || "");
      const userId = String(req.query.userId || req.body?.userId || "").trim();

      if (!userId) {
        res.status(400).json({ error: "Paramètre userId manquant." });
        return;
      }

      const result = raceManager.getParticipantApprovalStatus(identifier, userId);
      res.status(200).json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erreur statut participant: " + message });
    }
  }

  /**
   * GET /api/v1/races/pin/:pin
   * Quick join by alphanumeric PIN (4-8 chars) for Garmin watch and web lookup
   */
  public static async getRaceByPin(req: Request, res: Response): Promise<void> {
    const rawPin = String(req.params.pin || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(rawPin)) {
      res.status(400).json({ error: "Invalid PIN format" });
      return;
    }

    const matched = raceManager.getRaceByPin(rawPin);
    if (!matched) {
      res.status(404).json({ error: "Invalid PIN code" });
      return;
    }

    const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    const userName = typeof req.query.userName === "string" ? req.query.userName.trim() : "";

    if (matched.race && matched.race.type === "PRIVATE_INVITE") {
      const race = matched.race;
      const isHost = Boolean(userId && race.hostUserId && userId === race.hostUserId);

      if (userId && !isHost) {
        if (race.rejectedParticipants && race.rejectedParticipants.has(userId)) {
          res.status(403).json({
            error: "Demande de connexion refusée par l'organisateur",
            status: "rejected",
            approvalStatus: "rejected",
            raceId: race.id
          });
          return;
        }

        const isApproved = race.participants && race.participants.has(userId);

        if (race.requireApproval && !isApproved) {
          // Register in pending participants queue
          if (!race.pendingParticipants) {
            race.pendingParticipants = new Map();
          }
          const pendingInfo = {
            userId,
            userName: userName || `Racer_${userId.slice(-4)}`,
            joinedAt: new Date()
          };
          race.pendingParticipants.set(userId, pendingInfo);
          socketGateway.broadcastPrivateRoomUpdate(race.id, {
            type: "PARTICIPANT_PENDING",
            userId,
            userName: pendingInfo.userName
          });

          res.status(200).json({
            success: true,
            status: "pending_approval",
            approvalStatus: "pending",
            id: race.id,
            raceId: race.id,
            title: race.title,
            targetDistance: race.targetDistance,
            requireApproval: true,
            pinCode: race.pinCode,
            message: "En attente de validation par l'hôte"
          });
          return;
        }
      }

      const payload = await buildPrivateRacePayload(matched.race);
      res.status(200).json({
        ...payload,
        id: matched.raceId,
        raceId: matched.raceId,
        lane: matched.lane,
        targetDistance: matched.race.targetDistance,
        approvalStatus: "approved"
      });
      return;
    }

    const pubRace = matched.race;
    const remainingSec = pubRace
      ? Math.max(0, Math.floor((pubRace.lobbyEndsAt.getTime() - Date.now()) / 1000))
      : 600;
    res.status(200).json({
      id: matched.raceId,
      raceId: matched.raceId,
      lane: matched.lane,
      targetDistance: pubRace?.targetDistance || 2000,
      secondsRemaining: remainingSec,
      pinCode: rawPin,
      race: pubRace,
      approvalStatus: "approved"
    });
  }
}

export default TelemetryController;
