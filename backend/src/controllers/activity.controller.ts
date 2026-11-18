import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import { getOrCreateCurrentRace } from "./race.controller";
import raceManager, { RaceManager } from "../services/race-manager.service";
import { calculateRacePoints, calculateRacePointsEarned, getLeagueByPoints } from "../utils/league.util";
import { ensureCurrentWeek, getTodayRewardedBotRaces } from "../services/league-db.service";
import socketGateway from "../websocket/socket.gateway";
import pairingService from "../services/pairing.service";
import userStore from "../services/user-store.service";
import { TelemetryValidator } from "../services/telemetry-validator.service";

const Activities = db.activities;
const Races = db.races;
const Users = db.users;

/**
 * POST /api/activity/sync
 * Met à jour OU crée l'unique ligne de l'activité en base pour cet utilisateur.
 * Gère le statut 'abandoned' si l'utilisateur quitte avant la fin.
 */
export const syncActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      activityId,
      userId: rawUserId = "anonymous",
      userName: rawUserName,
      deviceId,
      deviceToken: bodyDeviceToken,
      raceMode = "race",
      targetDistance = 10000,
      status = "in_progress",
      currentDistance = 0,
      lastStrokeRate = 0,
      lastStrokeCount = 0,
      lastPower = 0,
      lastPace = 0,
      lastHeartRate = 0,
      lastResistance = 1,
      totalEnergy = 0,
      elapsedTime = 0,
    } = req.body || {};

    const authHeader = String(req.headers.authorization || "");
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const headerToken = req.headers["x-device-token"] ? String(req.headers["x-device-token"]).trim() : "";
    const rawToken = bodyDeviceToken ? String(bodyDeviceToken).trim() : (bearerToken || headerToken);

    const identity = await pairingService.resolvePairedIdentity({
      userId: rawUserId,
      userName: rawUserName,
      deviceToken: rawToken,
      deviceId,
    });
    const userId = identity.userId;
    const userName = identity.userName;

    const actualActivityId = activityId || (await getOrCreateCurrentRace()).id;
    const compositeId = `${actualActivityId}_${userId}`;

    // Récupération de l'unique ligne de cette activité
    let activity = await Activities.findByPk(compositeId);

    // Détection d'abandon : si le statut envoyé est "abandoned" ou "paused" ou si abandonné
    const isAbandoned = status === "abandoned" || status === "discarded";

    // Mode "Duel contre un Bot" : Départ réactif instantané ("Go" automatique) au premier coup de rame
    const matchedPrivate = raceManager.findPrivateRace(actualActivityId);
    if (matchedPrivate && matchedPrivate.isBotDuel && (matchedPrivate.status === "LOBBY" || matchedPrivate.status === "COUNTDOWN")) {
      const isRowing = Number(lastPower) > 0 || Number(lastStrokeRate) > 0 || (Number(lastPace) > 0 && Number(lastPace) < 360);
      if (isRowing) {
        const startNow = new Date();
        matchedPrivate.status = "RUNNING";
        matchedPrivate.autoStart = true;
        matchedPrivate.startedAt = startNow;
        matchedPrivate.endedAt = undefined;
        matchedPrivate.lobbyEndsAt = startNow;
        try {
          await Races.update({ status: "in_progress", startTime: startNow }, { where: { id: matchedPrivate.id } });
          await Activities.update(
            { status: "in_progress" },
            { where: { activityId: matchedPrivate.id, status: "waiting" } }
          );
        } catch {}
        socketGateway.broadcastRaceStatus(matchedPrivate.id, "RUNNING", { startedAt: startNow });
      }
    }

    if (!activity) {
      const initialDist = Number(currentDistance) || 0;
      const netDist = 0;
      const speedKmh = lastPace > 0 ? Number(((500 / lastPace) * 3.6).toFixed(1)) : 0;

      activity = await Activities.create({
        id: compositeId,
        activityId: actualActivityId,
        userId,
        userName: userName || `Racer_${userId.slice(-4)}`,
        raceMode,
        targetDistance: Number(targetDistance),
        status: isAbandoned ? "abandoned" : status,
        initialDistance: initialDist,
        currentDistance: initialDist,
        netDistance: netDist,
        progressPercent: 0,
        lastStrokeRate: Number(lastStrokeRate),
        lastStrokeCount: Number(lastStrokeCount),
        lastPower: Number(lastPower),
        lastPace: Number(lastPace),
        lastHeartRate: Number(lastHeartRate),
        lastResistance: Number(lastResistance),
        avgPower: Number(lastPower),
        avgPace: Number(lastPace),
        avgStrokeRate: Number(lastStrokeRate),
        totalStrokes: 0,
        totalEnergy: Number(totalEnergy),
        elapsedTime: Number(elapsedTime),
        avgSpeedKmh: speedKmh,
      });

      if (raceMode === "race") {
        const count = await Activities.count({
          where: { activityId: actualActivityId, status: { [Op.ne]: "abandoned" } },
        });
        await Races.update({ totalParticipants: count }, { where: { id: actualActivityId } });
      }
    } else {
      // Mise à jour de la ligne existante
      const currentDistNum = Number(currentDistance);
      const initialDist = (activity.get("initialDistance") as number) || 0;
      const targetDist = (activity.get("targetDistance") as number) || targetDistance;
      const prevTime = (activity.get("elapsedTime") as number) || 0;
      const newTime = Number(elapsedTime) || (prevTime + 1);
      const deltaSec = Math.max(0, Math.min(10, newTime - prevTime));

      const numPower = Number(lastPower);
      const numPace = Number(lastPace);
      const derivedPower = (numPower <= 0 && numPace >= 60 && numPace < 360)
        ? Math.round(2.80 / Math.pow(numPace / 500, 3))
        : Math.min(1200, Math.max(0, Math.round(numPower)));
      const normalizedPace = TelemetryValidator.computeConcept2Split(derivedPower, numPace);
      const c2Speed = TelemetryValidator.computeConcept2Speed(derivedPower, normalizedPace);

      const rawNetDist = Math.max(0, Math.round(currentDistNum - initialDist));
      const prevNetDist = Number(activity.get("netDistance") || 0);
      const wasAlreadyFinished = activity.get("status") === "finished" || (targetDist > 0 && prevNetDist >= targetDist);
      const clientReportsFinished = status === "finished" || status === "completed";
      const c2NetDist = (c2Speed > 0 && deltaSec > 0) ? Math.round(prevNetDist + c2Speed * deltaSec) : rawNetDist;
      let effectiveRawDist = Math.max(prevNetDist, c2NetDist);
      if (targetDist > 0 && !isAbandoned) {
        if (wasAlreadyFinished || clientReportsFinished || (rawNetDist >= targetDist && effectiveRawDist >= targetDist - 15)) {
          effectiveRawDist = targetDist;
        }
      }
      const netDist = targetDist > 0 ? Math.min(targetDist, effectiveRawDist) : effectiveRawDist;
      const progress = Math.min(100, Number(((netDist / targetDist) * 100).toFixed(1)));

      const prevAvgPower = (activity.get("avgPower") as number) || derivedPower;
      const computedAvgPower = derivedPower > 0 ? Math.round((prevAvgPower + derivedPower) / 2) : prevAvgPower;

      const prevAvgPace = (activity.get("avgPace") as number) || normalizedPace;
      const computedAvgPace = normalizedPace > 0 ? Math.round((prevAvgPace + normalizedPace) / 2) : prevAvgPace;

      const prevAvgSpm = (activity.get("avgStrokeRate") as number) || lastStrokeRate;
      const computedAvgSpm = Number(((prevAvgSpm + Number(lastStrokeRate)) / 2).toFixed(1));

      const speedKmh = normalizedPace > 0 ? Number(((500 / normalizedPace) * 3.6).toFixed(1)) : (newTime > 0 ? Number(((netDist / newTime) * 3.6).toFixed(1)) : 0);
      const isFinished = netDist >= targetDist || clientReportsFinished || wasAlreadyFinished;
      const prevLastPower = (activity.get("lastPower") as number) || 0;
      const effectiveLastPower = derivedPower > 0 ? derivedPower : (isFinished ? prevLastPower : 0);

      let finalStatus = status;
      if (isAbandoned) {
        finalStatus = "abandoned";
      } else if (isFinished) {
        finalStatus = "finished";
      }

      await activity.update({
        currentDistance: Math.max(currentDistNum, netDist),
        netDistance: netDist,
        progressPercent: progress,
        status: finalStatus,
        lastStrokeRate: Number(lastStrokeRate),
        lastStrokeCount: Number(lastStrokeCount),
        lastPower: effectiveLastPower,
        lastPace: normalizedPace,
        lastHeartRate: Number(lastHeartRate),
        lastResistance: Number(lastResistance),
        avgPower: computedAvgPower,
        avgPace: computedAvgPace,
        avgStrokeRate: computedAvgSpm,
        totalStrokes: Number(lastStrokeCount),
        totalEnergy: Number(totalEnergy),
        elapsedTime: newTime,
        avgSpeedKmh: speedKmh,
        finishedAt: isFinished ? new Date() : (activity.get("finishedAt") as Date),
      });

      // Mettre à jour les stats du coureur s'il termine pour la première fois
      if (isFinished && !wasAlreadyFinished) {
        await ensureCurrentWeek();
        let user = await Users.findByPk(userId);
        if (user) {
          await user.increment("totalRaces");

          const humanFinishers = (await Activities.count({
            where: {
              activityId: actualActivityId,
              isBot: false,
              status: "finished",
            },
          })) || 1;

          const assignedRank = (activity.get("finalRank") as number) || 1;
          const actRaceMode = String(activity.get("raceMode") || "MULTIPLAYER");
          const todayBots = await getTodayRewardedBotRaces(userId);

          const ptsEarned = calculateRacePointsEarned({
            raceMode: actRaceMode,
            playerRank: assignedRank,
            totalHumanFinishers: humanFinishers,
            isFinisher: true,
            isDnf: false,
            todayRewardedBotRacesCount: todayBots,
          });

          if (assignedRank === 1) {
            await user.increment("totalWins");
            await user.increment("podiums");
          } else if (assignedRank <= 3) {
            await user.increment("podiums");
          }

          const existingActPoints = Number(activity.get("pointsEarned") || activity.get("points") || 0);
          if (existingActPoints === 0 && ptsEarned >= 0) {
            const currentPts = (user.get("points") as number) || 0;
            const currentCareerPts = (user.get("totalCareerPoints") as number) || currentPts;
            const newPts = currentPts + ptsEarned;
            const newCareerPts = currentCareerPts + ptsEarned;
            const league = getLeagueByPoints(newPts);
            const bestR = (user.get("bestRank") as number) || 0;
            const newBestRank = (bestR === 0 || assignedRank < bestR) ? assignedRank : bestR;

            await user.update({
              points: newPts,
              totalCareerPoints: newCareerPts,
              league: league.id,
              lastRank: assignedRank,
              bestRank: newBestRank,
            });
            await activity.update({
              points: ptsEarned,
              pointsEarned: ptsEarned,
              isDnf: false,
              totalHumanFinishers: humanFinishers,
              avgPaceMs: ((activity.get("avgPace") as number) || 0) * 1000,
            } as any);
          }
        }
      }
    }

    // NB : la progression des bots est exclusivement pilotée par le RaceManager (tick 1s basé sur l'horloge).

    // Calcul du classement et des deltas de distance
    const leaderboard = await Activities.findAll({
      where: { activityId: actualActivityId },
      order: [
        ["status", "ASC"], // in_progress & finished devant abandoned
        ["netDistance", "DESC"],
        ["elapsedTime", "ASC"],
      ],
      attributes: [
        "id",
        "userId",
        "userName",
        "netDistance",
        "progressPercent",
        "avgSpeedKmh",
        "lastPower",
        "lastStrokeRate",
        "status",
      ],
    });

    const activeRacers = leaderboard.filter((item) => item.get("status") !== "abandoned");
    const myIndex = activeRacers.findIndex((item) => item.get("userId") === userId);
    const currentRank = myIndex >= 0 ? myIndex + 1 : null;

    let distToLeader = 0;
    let distToPrev = 0;
    let distToNext = 0;

    if (myIndex >= 0 && activeRacers.length > 0) {
      const myDist = (activeRacers[myIndex].get("netDistance") as number) || 0;
      const leaderDist = (activeRacers[0].get("netDistance") as number) || 0;
      distToLeader = Math.max(0, leaderDist - myDist);

      if (myIndex > 0) {
        // Joueur qui le précède (au-dessus au classement)
        const prevDist = (activeRacers[myIndex - 1].get("netDistance") as number) || 0;
        distToPrev = Math.max(0, prevDist - myDist);
      }

      if (myIndex < activeRacers.length - 1) {
        // Joueur qui le suit (en dessous au classement)
        const nextDist = (activeRacers[myIndex + 1].get("netDistance") as number) || 0;
        distToNext = Math.max(0, myDist - nextDist);
      }
    }

    const top3 = activeRacers.slice(0, 3).map((item, index) => ({
      rank: index + 1,
      userId: item.get("userId"),
      userName: item.get("userName"),
      netDistance: item.get("netDistance"),
      progressPercent: item.get("progressPercent"),
      speedKmh: item.get("avgSpeedKmh"),
    }));

    res.status(200).json({
      success: true,
      activity,
      rank: currentRank,
      totalRacers: activeRacers.length,
      distToLeader,
      distToPrev,
      distToNext,
      top3,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur synchronisation activité: " + message });
  }
};

/**
 * GET /api/activity/latest
 * Retourne la dernière activité d'un utilisateur par son userId
 */
export const getLatestUserActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, activityId } = req.query;
    const whereClause: any = {};
    if (userId) whereClause.userId = String(userId);
    if (activityId) whereClause.activityId = String(activityId);

    let activity: any = null;
    try {
      activity = await Activities.findOne({
        where: whereClause,
        order: [["updatedAt", "DESC"]],
      });
    } catch {}

    if (!activity && userId) {
      const memList = userStore.findActivitiesForUser(String(userId));
      const filtered = activityId
        ? memList.filter((a) => String(a.activityId) === String(activityId))
        : memList;
      if (filtered.length > 0) {
        activity = filtered[filtered.length - 1];
      }
    }

    if (!activity) {
      res.status(404).json({ message: "Aucune activité trouvée." });
      return;
    }

    res.status(200).json(activity);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur récupération activité: " + message });
  }
};

/**
 * GET /api/activity/race/:activityId/leaderboard
 */
export const getRaceLeaderboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const { activityId } = req.params;
    const targetRaceId = activityId || (await getOrCreateCurrentRace()).id;

    const mergedMap = new Map<string, any>();
    for (const mem of userStore.findActivitiesByRaceId(String(targetRaceId))) {
      const uid = String((typeof mem.get === "function" ? mem.get("userId") : mem.userId) || "");
      if (uid) mergedMap.set(uid, mem);
    }

    try {
      const dbRows = (await Activities.findAll({ where: { activityId: targetRaceId } })) as any[];
      for (const r of dbRows) {
        const uid = String((typeof r.get === "function" ? r.get("userId") : r.userId) || "");
        if (uid) {
          const mem = mergedMap.get(uid);
          const rDist = Number((typeof r.get === "function" ? r.get("netDistance") : (r as any).netDistance) || 0);
          const memDist = mem ? Number((typeof mem.get === "function" ? mem.get("netDistance") : mem.netDistance) || 0) : 0;
          if (!mem || rDist >= memDist) {
            mergedMap.set(uid, r);
          }
        }
      }
    } catch {}

    const rows: any[] = Array.from(mergedMap.values());

    const managed = raceManager.getRaceById(String(targetRaceId)) || raceManager.getCurrentPublicRace();
    if (managed && managed.id === String(targetRaceId) && managed.participants) {
      const existingIds = new Set(rows.map((r: any) => (typeof r.get === "function" ? r.get("userId") : r.userId)));
      for (const p of managed.participants.values()) {
        if (!existingIds.has(p.userId)) {
          const fallbackObj: Record<string, any> = {
            id: `${targetRaceId}_${p.userId}`,
            activityId: targetRaceId,
            userId: p.userId,
            userName: p.userName || p.userId,
            country: p.country,
            lane: p.lane || 1,
            status: managed.status === "RUNNING" ? "in_progress" : "waiting",
            netDistance: 0,
            currentDistance: 0,
            progressPercent: 0,
            lastPower: 0,
            lastStrokeRate: 0,
            lastPace: 0,
            avgPower: 0,
            avgPace: 0,
            avgStrokeRate: 0,
            elapsedTime: 0,
            isBot: false,
          };
          fallbackObj.get = (k: string) => fallbackObj[k];
          rows.push(fallbackObj);
        }
      }
    }

    // Abandons en fin de tableau, finishers d'abord puis distance décroissante
    const abandoned = rows.filter((r) => (typeof r.get === "function" ? r.get("status") : r.status) === "abandoned");
    const ranked = RaceManager.sortRanking(rows.filter((r) => (typeof r.get === "function" ? r.get("status") : r.status) !== "abandoned"));
    const rawList = [...ranked, ...abandoned];

    const list = await Promise.all(
      rawList.map(async (act: any) => {
        const getVal = (field: string) => (typeof act.get === "function" ? act.get(field) : act[field]);
        const uid = String(getVal("userId") || "");
        const isBot = Boolean(getVal("isBot"));
        const participantInfo = managed?.participants?.get(uid);
        const userObj = !isBot && uid ? (userStore.findUserSync(uid) || (await userStore.findUser(uid))) : null;
        const kayak = userObj?.kayakCustomization || participantInfo?.kayak;

        const toPlain = (a: any) => {
          if (!a) return {};
          if (typeof a.toJSON === "function") return a.toJSON();
          if (a.dataValues) return typeof a.get === "function" ? a.get({ plain: true }) : { ...a.dataValues };
          const plain: Record<string, any> = {};
          for (const [k, v] of Object.entries(a)) {
            if (typeof v !== "function") plain[k] = v;
          }
          return plain;
        };
        const base = toPlain(act);
        return {
          ...base,
          kayak,
        };
      })
    );

    const timing = managed ? raceManager.getRaceTiming(managed) : null;

    res.status(200).json({
      activityId: targetRaceId,
      totalParticipants: ranked.length,
      leaderboard: list,
      raceStatus: managed ? managed.status : "COMPLETED",
      remainingSeconds: timing ? timing.remainingSeconds : 0,
      elapsedSeconds: timing ? timing.elapsedSeconds : 0,
      maxDurationSeconds: timing ? timing.maxDurationSeconds : 55 * 60,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur leaderboard: " + message });
  }
};

/**
 * GET /api/activity/history
 */
export const getAll = async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const data = await Activities.findAll({
      order: [["updatedAt", "DESC"]],
      limit: Number(limit),
      offset: Number(offset),
    });
    res.status(200).json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur liste activités: " + message });
  }
};

export default {
  syncActivity,
  getLatestUserActivity,
  getRaceLeaderboard,
  getAll,
};
