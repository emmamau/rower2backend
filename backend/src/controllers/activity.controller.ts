import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import config from "../config";

const Activities = db.activities;
const Races = db.races;
const Users = db.users;

/**
 * Helper : calcule ou récupère la prochaine course programmée (toutes les X minutes, ex: 15 min)
 */
export async function getOrCreateCurrentRace(): Promise<any> {
  const now = new Date();
  const intervalMs = (config.raceIntervalMinutes || 15) * 60 * 1000;

  // Calcul du slot de la prochaine course
  const currentSlotTime = new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);
  const nextSlotTime = new Date(currentSlotTime.getTime() + intervalMs);

  const raceId = `RACE_${nextSlotTime.toISOString().replace(/[-:T.]/g, "").slice(0, 12)}`;

  let race = await Races.findByPk(raceId);
  if (!race) {
    race = await Races.create({
      id: raceId,
      title: `Rower Race ${nextSlotTime.getHours().toString().padStart(2, "0")}h${nextSlotTime.getMinutes().toString().padStart(2, "0")}`,
      targetDistance: config.defaultRaceDistanceMeters || 10000,
      startTime: nextSlotTime,
      intervalMinutes: config.raceIntervalMinutes || 15,
      status: "waiting",
      totalParticipants: 0,
    });
  }

  return race;
}

/**
 * POST /api/activity/sync
 * Met à jour OU crée l'unique ligne de l'activité en base pour cet utilisateur.
 * Gère le calcul : netDistance = currentDistance - initialDistance.
 */
export const syncActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      activityId,
      userId = "anonymous",
      userName,
      avatarUrl,
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

    if (!activity) {
      // Première mesure de l'activité : initialDistance = currentDistance reçue du rameur
      // Ainsi, netDistance démarrera exactement à 0 mètre !
      const initialDist = Number(currentDistance) || 0;
      const netDist = 0;
      const speedKmh = lastPace > 0 ? Number((500 / lastPace * 3.6).toFixed(1)) : 0;

      activity = await Activities.create({
        id: compositeId,
        activityId: actualActivityId,
        userId,
        userName: userName || `Racer_${userId.slice(-4)}`,
        avatarUrl,
        raceMode,
        targetDistance: Number(targetDistance),
        status,
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

      // Met à jour le nombre de participants sur la course
      if (raceMode === "race") {
        const count = await Activities.count({ where: { activityId: actualActivityId } });
        await Races.update({ totalParticipants: count }, { where: { id: actualActivityId } });
      }
    } else {
      // Mise à jour de l'unique ligne existante
      const currentDistNum = Number(currentDistance);
      const initialDist = (activity.get("initialDistance") as number) || 0;
      const netDist = Math.max(0, currentDistNum - initialDist);
      const targetDist = (activity.get("targetDistance") as number) || targetDistance;
      const progress = Math.min(100, Number(((netDist / targetDist) * 100).toFixed(1)));

      const prevTime = (activity.get("elapsedTime") as number) || 1;
      const newTime = Number(elapsedTime) || prevTime;

      // Calcul des moyennes cumulées
      const prevAvgPower = (activity.get("avgPower") as number) || lastPower;
      const computedAvgPower = Math.round((prevAvgPower + Number(lastPower)) / 2);

      const prevAvgPace = (activity.get("avgPace") as number) || lastPace;
      const computedAvgPace = lastPace > 0 ? Math.round((prevAvgPace + Number(lastPace)) / 2) : prevAvgPace;

      const prevAvgSpm = (activity.get("avgStrokeRate") as number) || lastStrokeRate;
      const computedAvgSpm = Number(((prevAvgSpm + Number(lastStrokeRate)) / 2).toFixed(1));

      const speedKmh = newTime > 0 ? Number(((netDist / newTime) * 3.6).toFixed(1)) : 0;

      const isFinished = netDist >= targetDist || status === "finished";

      await activity.update({
        currentDistance: currentDistNum,
        netDistance: netDist,
        progressPercent: progress,
        status: isFinished ? "finished" : status,
        lastStrokeRate: Number(lastStrokeRate),
        lastStrokeCount: Number(lastStrokeCount),
        lastPower: Number(lastPower),
        lastPace: Number(lastPace),
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
    }

    // Calcul du classement en temps réel dans cette course
    const leaderboard = await Activities.findAll({
      where: { activityId: actualActivityId },
      order: [
        ["netDistance", "DESC"],
        ["elapsedTime", "ASC"],
      ],
      attributes: ["id", "userId", "userName", "netDistance", "progressPercent", "avgSpeedKmh", "lastPower", "lastStrokeRate", "status"],
    });

    const currentRank = leaderboard.findIndex((item) => item.get("userId") === userId) + 1;
    const top3 = leaderboard.slice(0, 3).map((item, index) => ({
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
      totalRacers: leaderboard.length,
      top3,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur lors de la synchronisation de l'activité: " + message });
  }
};

/**
 * GET /api/activity/latest?userId=...&activityId=...
 * Retourne la synthèse et le dernier coup de rame pour un utilisateur
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
 * Retourne le classement complet des coureurs engagés dans une course
 */
export const getRaceLeaderboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const { activityId } = req.params;
    const currentRace = await getOrCreateCurrentRace();
    const targetRaceId = activityId || currentRace.id;

    // Récupérer les activités rattachées à cette course OU actives dans les dernières 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const list = await Activities.findAll({
      where: {
        [Op.or]: [
          { activityId: targetRaceId },
          { updatedAt: { [Op.gte]: tenMinutesAgo } }
        ]
      },
      order: [
        ["netDistance", "DESC"],
        ["elapsedTime", "ASC"],
        ["updatedAt", "DESC"],
      ],
    });

    res.status(200).json({
      activityId: targetRaceId,
      totalParticipants: list.length,
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

