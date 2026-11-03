import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import config from "../config";
import { getOrCreateCurrentRace } from "./activity.controller";

const Races = db.races;
const Activities = db.activities;

/**
 * GET /api/race/next
 * Retourne les détails de la prochaine course planifiée (avec décompte avant le départ)
 */
export const getNextRace = async (_req: Request, res: Response): Promise<void> => {
  try {
    const race = await getOrCreateCurrentRace();
    const now = new Date();
    const startTime = new Date(race.get("startTime") as Date);
    const secondsRemaining = Math.max(0, Math.floor((startTime.getTime() - now.getTime()) / 1000));

    // Comptage des participants connectés (actifs récemment ou inscrits sur le créneau)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const count = await Activities.count({
      where: {
        [Op.or]: [
          { activityId: race.get("id") },
          { updatedAt: { [Op.gte]: fiveMinutesAgo } }
        ]
      }
    });
    await race.update({ totalParticipants: count });

    res.status(200).json({
      race,
      secondsRemaining,
      formattedCountdown: `${Math.floor(secondsRemaining / 60)}m ${secondsRemaining % 60}s`,
      totalParticipants: count,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur récupération prochaine course: " + message });
  }
};

/**
 * PUT /api/race/config
 * Permet de configurer la distance par défaut ou la fréquence des courses depuis le front
 */
export const updateRaceConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetDistance, intervalMinutes } = req.body;
    if (targetDistance) config.defaultRaceDistanceMeters = Number(targetDistance);
    if (intervalMinutes) config.raceIntervalMinutes = Number(intervalMinutes);

    res.status(200).json({
      message: "Configuration des courses mise à jour avec succès",
      defaultRaceDistanceMeters: config.defaultRaceDistanceMeters,
      raceIntervalMinutes: config.raceIntervalMinutes,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur mise à jour config: " + message });
  }
};

/**
 * POST /api/race/join
 * Permet à un joueur de s'inscrire / se déclarer en attente pour la prochaine course
 */
export const joinRace = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId = "anonymous", userName } = req.body;
    const race = await getOrCreateCurrentRace();
    const actualRaceId = race.get("id");
    const compositeId = `${actualRaceId}_${userId}`;

    let activity = await Activities.findByPk(compositeId);
    if (!activity) {
      activity = await Activities.create({
        id: compositeId,
        activityId: actualRaceId,
        userId,
        userName: userName || `Racer_${userId.slice(-4)}`,
        raceMode: "race",
        targetDistance: race.get("targetDistance") || 10000,
        status: "waiting",
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
        avgSpeedKmh: 0,
      });
    } else {
      await activity.update({
        status: "waiting",
        userName: userName || activity.get("userName"),
      });
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const count = await Activities.count({
      where: {
        [Op.or]: [
          { activityId: actualRaceId },
          { updatedAt: { [Op.gte]: fiveMinutesAgo } }
        ]
      }
    });
    await race.update({ totalParticipants: count });

    const now = new Date();
    const startTime = new Date(race.get("startTime") as Date);
    const secondsRemaining = Math.max(0, Math.floor((startTime.getTime() - now.getTime()) / 1000));

    res.status(200).json({
      success: true,
      raceId: actualRaceId,
      race,
      secondsRemaining,
      totalParticipants: count,
      activity,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur inscription course: " + message });
  }
};

export default {
  getNextRace,
  updateRaceConfig,
  joinRace,
};

