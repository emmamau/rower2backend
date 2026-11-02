import { Request, Response } from "express";
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

    // Comptage des participants connectés
    const count = await Activities.count({ where: { activityId: race.get("id") } });
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

export default {
  getNextRace,
  updateRaceConfig,
};

