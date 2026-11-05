import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import { getOrCreateCurrentRace } from "./race.controller";

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
      userId = "anonymous",
      userName,
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
    } = req.body;

    const actualActivityId = activityId || (await getOrCreateCurrentRace()).id;
    const compositeId = `${actualActivityId}_${userId}`;

    // Récupération de l'unique ligne de cette activité
    let activity = await Activities.findByPk(compositeId);

    // Détection d'abandon : si le statut envoyé est "abandoned" ou "paused" ou si abandonné
    const isAbandoned = status === "abandoned" || status === "discarded";

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
      const netDist = Math.max(0, currentDistNum - initialDist);
      const targetDist = (activity.get("targetDistance") as number) || targetDistance;
      const progress = Math.min(100, Number(((netDist / targetDist) * 100).toFixed(1)));

      const prevTime = (activity.get("elapsedTime") as number) || 1;
      const newTime = Number(elapsedTime) || prevTime;

      const numPower = Number(lastPower);
      const numPace = Number(lastPace);
      const derivedPower = (numPower <= 0 && numPace >= 60 && numPace < 360)
        ? Math.round(2.80 / Math.pow(numPace / 500, 3))
        : numPower;

      const prevAvgPower = (activity.get("avgPower") as number) || derivedPower;
      const computedAvgPower = derivedPower > 0 ? Math.round((prevAvgPower + derivedPower) / 2) : prevAvgPower;

      const prevAvgPace = (activity.get("avgPace") as number) || numPace;
      const computedAvgPace = numPace > 0 ? Math.round((prevAvgPace + numPace) / 2) : prevAvgPace;

      const prevAvgSpm = (activity.get("avgStrokeRate") as number) || lastStrokeRate;
      const computedAvgSpm = Number(((prevAvgSpm + Number(lastStrokeRate)) / 2).toFixed(1));

      const speedKmh = newTime > 0 ? Number(((netDist / newTime) * 3.6).toFixed(1)) : 0;
      const isFinished = netDist >= targetDist || status === "finished";
      const prevLastPower = (activity.get("lastPower") as number) || 0;
      const effectiveLastPower = derivedPower > 0 ? derivedPower : (isFinished ? prevLastPower : 0);

      let finalStatus = status;
      if (isAbandoned) {
        finalStatus = "abandoned";
      } else if (isFinished) {
        finalStatus = "finished";
      }

      await activity.update({
        currentDistance: currentDistNum,
        netDistance: netDist,
        progressPercent: progress,
        status: finalStatus,
        lastStrokeRate: Number(lastStrokeRate),
        lastStrokeCount: Number(lastStrokeCount),
        lastPower: effectiveLastPower,
        lastPace: numPace,
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

      // Mettre à jour les stats du coureur s'il termine
      if (isFinished && activity.get("status") !== "finished") {
        let user = await Users.findByPk(userId);
        if (user) {
          await user.increment("totalRaces");

          // Calcul des points collectés lors de cette course :
          // 1ère place : 100 pts
          // 2ème place : 70 pts
          // 3ème place : 50 pts
          // Finisher hors podium : 25 pts
          // Abandon : 5 pts de participation
          let ptsEarned = 25;
          const assignedRank = (activity.get("finalRank") as number) || 1;
          if (assignedRank === 1) {
            ptsEarned = 100;
            await user.increment("totalWins");
            await user.increment("podiums");
          } else if (assignedRank === 2) {
            ptsEarned = 70;
            await user.increment("podiums");
          } else if (assignedRank === 3) {
            ptsEarned = 50;
            await user.increment("podiums");
          }

          const currentPts = (user.get("points") as number) || 0;
          const newPts = currentPts + ptsEarned;
          const bestR = (user.get("bestRank") as number) || 0;
          const newBestRank = (bestR === 0 || assignedRank < bestR) ? assignedRank : bestR;

          await user.update({
            points: newPts,
            lastRank: assignedRank,
            bestRank: newBestRank,
          });
        }
      }
    }

    // Progression réaliste des bots si actifs dans la course
    const activeBots = await Activities.findAll({
      where: { activityId: actualActivityId, isBot: true, status: "in_progress" },
    });
    for (const bot of activeBots) {
      const botPace = (bot.get("avgPace") as number) || 120; // sec per 500m
      const botSpeedMs = 500 / botPace; // m/s
      const botPrevTime = (bot.get("elapsedTime") as number) || 0;
      const botNewTime = botPrevTime + 1; // 1s tick
      const botNetDist = Math.min((bot.get("targetDistance") as number) || 10000, Math.floor(botNewTime * botSpeedMs));
      const botTarget = (bot.get("targetDistance") as number) || 10000;
      const botProgress = Math.min(100, Number(((botNetDist / botTarget) * 100).toFixed(1)));
      const botFinished = botNetDist >= botTarget;

      await bot.update({
        netDistance: botNetDist,
        currentDistance: botNetDist,
        elapsedTime: botNewTime,
        progressPercent: botProgress,
        status: botFinished ? "finished" : "in_progress",
        updatedAt: new Date(),
      });
    }

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

    const activity = await Activities.findOne({
      where: whereClause,
      order: [["updatedAt", "DESC"]],
    });

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
    const isPrivate = Boolean(activityId && activityId.startsWith("PRIV_"));
    const targetRaceId = isPrivate
      ? activityId
      : (activityId || (await getOrCreateCurrentRace()).id);

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const whereClause = isPrivate
      ? { activityId: targetRaceId }
      : {
          [Op.or]: [
            { activityId: targetRaceId },
            { activityId: { [Op.notLike]: "PRIV_%" }, updatedAt: { [Op.gte]: tenMinutesAgo } },
          ],
        };

    const list = await Activities.findAll({
      where: whereClause,
      order: [
        ["status", "ASC"], // les abandons se retrouvent classés en fin de tableau
        ["netDistance", "DESC"],
        ["elapsedTime", "ASC"],
        ["updatedAt", "DESC"],
      ],
    });

    res.status(200).json({
      activityId: targetRaceId,
      totalParticipants: list.filter((r) => r.get("status") !== "abandoned").length,
      leaderboard: list,
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
