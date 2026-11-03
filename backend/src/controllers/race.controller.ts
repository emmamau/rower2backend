import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import config from "../config";

const Activities = db.activities;
const Races = db.races;
const Users = db.users;

/**
 * Gestion du cycle unique des courses :
 * - Une seule course active ou en attente à la fois.
 * - Durée maximale de 55 minutes.
 * - Si aucun participant au départ (countdown <= 0 et totalParticipants === 0) -> annulée.
 * - Quand un joueur se connecte -> démarre l'attente pour la course.
 */
export async function getOrCreateCurrentRace(): Promise<any> {
  const now = new Date();

  // 1. Chercher s'il existe une course active (in_progress) ou en attente (waiting)
  let activeRace = await Races.findOne({
    where: {
      status: { [Op.in]: ["in_progress", "waiting"] },
    },
    order: [["createdAt", "DESC"]],
  });

  if (activeRace) {
    const startTime = new Date(activeRace.get("startTime") as Date);
    const maxDurationMin = (activeRace.get("maxDurationMinutes") as number) || 55;
    const maxEndTime = new Date(startTime.getTime() + maxDurationMin * 60 * 1000);

    // Vérifier si la course en cours a dépassé les 55 minutes max
    if (activeRace.get("status") === "in_progress" && now > maxEndTime) {
      await activeRace.update({ status: "finished" });
      activeRace = null;
    } else if (activeRace.get("status") === "waiting") {
      // Vérifier le départ de la course en attente
      if (now >= startTime) {
        // Compter les participants connectés
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
        const count = (await Activities.count({
          where: {
            activityId: String(activeRace.get("id")),
            updatedAt: { [Op.gte]: fiveMinutesAgo },
          },
        })) as number;

        if (count === 0) {
          // Aucun joueur au départ -> la course est annulée
          await activeRace.update({ status: "cancelled", totalParticipants: 0 });
          activeRace = null;
        } else {
          // Des joueurs sont présents -> démarrage de la course
          await activeRace.update({ status: "in_progress", totalParticipants: count });
        }
      }
    }
  }

  // 2. Si aucune course en cours ou en attente, et qu'on doit en préparer une
  if (!activeRace) {
    const intervalMs = (config.raceIntervalMinutes || 15) * 60 * 1000;
    const nextSlotTime = new Date(now.getTime() + intervalMs);
    const raceId = `RACE_${nextSlotTime.toISOString().replace(/[-:T.]/g, "").slice(0, 12)}`;

    activeRace = await Races.create({
      id: raceId,
      title: `Rower Race ${nextSlotTime.getHours().toString().padStart(2, "0")}h${nextSlotTime.getMinutes().toString().padStart(2, "0")}`,
      targetDistance: config.defaultRaceDistanceMeters || 10000,
      startTime: nextSlotTime,
      intervalMinutes: config.raceIntervalMinutes || 15,
      maxDurationMinutes: 55,
      status: "waiting",
      totalParticipants: 0,
    });
  }

  return activeRace;
}

/**
 * GET /api/race/next
 */
export const getNextRace = async (_req: Request, res: Response): Promise<void> => {
  try {
    const race = await getOrCreateCurrentRace();
    const now = new Date();
    const startTime = new Date(race.get("startTime") as Date);
    const secondsRemaining = Math.max(0, Math.floor((startTime.getTime() - now.getTime()) / 1000));

    // Comptage des participants connectés
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const count = await Activities.count({
      where: {
        [Op.or]: [
          { activityId: race.get("id") },
          { updatedAt: { [Op.gte]: fiveMinutesAgo } },
        ],
        status: { [Op.ne]: "abandoned" },
      },
    });
    await race.update({ totalParticipants: count });

    res.status(200).json({
      race,
      secondsRemaining,
      formattedCountdown: `${Math.floor(secondsRemaining / 60)}m ${secondsRemaining % 60}s`,
      totalParticipants: count,
      status: race.get("status"),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur récupération prochaine course: " + message });
  }
};

/**
 * POST /api/race/join
 * Quand un joueur se connecte, il lance l'attente pour la prochaine course
 */
export const joinRace = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId = "anonymous", userName } = req.body;
    let race = await getOrCreateCurrentRace();

    // Si la course était en attente sans date ou expirée, relancer un compte à rebours dès la connexion
    const now = new Date();
    const startTime = new Date(race.get("startTime") as Date);
    if (race.get("status") === "waiting" && now >= startTime) {
      const intervalMs = (config.raceIntervalMinutes || 15) * 60 * 1000;
      const newStart = new Date(now.getTime() + intervalMs);
      await race.update({ startTime: newStart });
    }

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

    // Inscrire/actualiser l'utilisateur sans données personnelles
    let user = await Users.findByPk(userId);
    if (!user) {
      await Users.create({
        id: userId,
        name: userName || `Racer_${userId.slice(-4)}`,
        totalRaces: 0,
        totalWins: 0,
        podiums: 0,
      });
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const count = await Activities.count({
      where: {
        activityId: actualRaceId,
        updatedAt: { [Op.gte]: fiveMinutesAgo },
        status: { [Op.ne]: "abandoned" },
      },
    });
    await race.update({ totalParticipants: count });

    const secondsRemaining = Math.max(0, Math.floor((new Date(race.get("startTime") as Date).getTime() - now.getTime()) / 1000));

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

/**
 * GET /api/race/history
 * Visualiser les résultats des précédentes courses
 */
export const getRaceHistory = async (_req: Request, res: Response): Promise<void> => {
  try {
    const finishedRaces = await Races.findAll({
      where: {
        status: { [Op.in]: ["finished", "cancelled"] },
      },
      order: [["startTime", "DESC"]],
      limit: 15,
    });

    const result = [];
    for (const r of finishedRaces) {
      const top3Activities = await Activities.findAll({
        where: {
          activityId: String(r.get("id")),
        },
        order: [
          ["status", "ASC"], // finished avant abandoned
          ["netDistance", "DESC"],
          ["elapsedTime", "ASC"],
        ],
        limit: 3,
        attributes: ["userId", "userName", "netDistance", "elapsedTime", "avgSpeedKmh", "status", "finalRank"],
      });

      result.push({
        race: r,
        podium: top3Activities,
      });
    }

    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur historique courses: " + message });
  }
};

/**
 * PUT /api/race/config
 */
export const updateRaceConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetDistance, intervalMinutes } = req.body;
    if (targetDistance) config.defaultRaceDistanceMeters = Number(targetDistance);
    if (intervalMinutes) config.raceIntervalMinutes = Number(intervalMinutes);

    res.status(200).json({
      message: "Configuration mise à jour",
      defaultRaceDistanceMeters: config.defaultRaceDistanceMeters,
      raceIntervalMinutes: config.raceIntervalMinutes,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur mise à jour config: " + message });
  }
};

/**
 * POST /api/race/bots
 * Permet d'ajouter ou activer des bots virtuels quand le joueur est seul
 */
export const toggleBots = async (req: Request, res: Response): Promise<void> => {
  try {
    const { enable = true, raceId, botCount = 3 } = req.body;
    const race = raceId ? await Races.findByPk(raceId) : await getOrCreateCurrentRace();
    if (!race) {
      res.status(404).json({ message: "Aucune course trouvée." });
      return;
    }

    const actualRaceId = String(race.get("id"));
    const targetDist = (race.get("targetDistance") as number) || 10000;

    const BOT_NAMES = [
      { id: "bot_olympic", name: "Kayaker_Thor (Bot)", pace: 110, spm: 30, power: 280 },
      { id: "bot_shadow", name: "Cyber_Paddle (Bot)", pace: 118, spm: 28, power: 240 },
      { id: "bot_challenger", name: "Aqua_Racer (Bot)", pace: 125, spm: 26, power: 210 },
      { id: "bot_rookie", name: "Viking_Stream (Bot)", pace: 132, spm: 24, power: 190 },
    ];

    if (enable) {
      const botsToAdd = BOT_NAMES.slice(0, Math.min(botCount, BOT_NAMES.length));
      for (const b of botsToAdd) {
        const botCompositeId = `${actualRaceId}_${b.id}`;
        let botAct = await Activities.findByPk(botCompositeId);
        if (!botAct) {
          await Activities.create({
            id: botCompositeId,
            activityId: actualRaceId,
            userId: b.id,
            userName: b.name,
            isBot: true,
            raceMode: "race",
            targetDistance: targetDist,
            status: race.get("status") === "in_progress" ? "in_progress" : "waiting",
            initialDistance: 0,
            currentDistance: 0,
            netDistance: 0,
            progressPercent: 0,
            lastStrokeRate: b.spm,
            lastStrokeCount: 0,
            lastPower: b.power,
            lastPace: b.pace,
            lastHeartRate: 155,
            lastResistance: 4,
            avgPower: b.power,
            avgPace: b.pace,
            avgStrokeRate: b.spm,
            totalStrokes: 0,
            totalEnergy: 0,
            elapsedTime: 0,
            avgSpeedKmh: Number(((500 / b.pace) * 3.6).toFixed(1)),
          });
        } else {
          await botAct.update({
            status: race.get("status") === "in_progress" ? "in_progress" : "waiting",
            isBot: true,
          });
        }
      }
      await race.update({ hasBots: true });
    } else {
      // Désactiver les bots
      await Activities.destroy({
        where: {
          activityId: actualRaceId,
          isBot: true,
        },
      });
      await race.update({ hasBots: false });
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const count = await Activities.count({
      where: {
        activityId: actualRaceId,
        updatedAt: { [Op.gte]: fiveMinutesAgo },
        status: { [Op.ne]: "abandoned" },
      },
    });
    await race.update({ totalParticipants: count });

    res.status(200).json({
      success: true,
      hasBots: enable,
      totalParticipants: count,
      message: enable ? "Joueurs virtuels engagés dans la course !" : "Joueurs virtuels retirés.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur gestion des bots: " + message });
  }
};

export default {
  getNextRace,
  joinRace,
  getRaceHistory,
  updateRaceConfig,
  toggleBots,
};
