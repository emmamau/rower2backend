import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import config from "../config";
import raceManager, { RaceState } from "../services/race-manager.service";
import { isEmmaAdminUser } from "../services/auth.service";
import userStore from "../services/user-store.service";

const Activities = db.activities;
const Races = db.races;
const Users = db.users;

/**
 * Course publique unique, pilotée par le RaceManager (source de vérité) :
 * - Lobby (compte à rebours 15 min) -> RUNNING dès qu'au moins un joueur humain est inscrit.
 * - Durée maximale de 55 minutes : à l'échéance la partie se termine automatiquement et le classement
 *   est établi selon la distance parcourue pour ceux qui n'ont pas franchi la ligne.
 * - Si tous les joueurs humains ont abandonné (il ne reste que des bots), la partie se termine et un
 *   nouveau lobby public est ouvert avec son compte à rebours.
 * Les contrôleurs HTTP (montre, web) lisent et alimentent cette même course, il n'existe plus de second
 * cycle de vie concurrent côté base de données.
 */
export async function ensurePublicRaceRow(state: RaceState): Promise<any> {
  let row = await Races.findByPk(state.id);
  if (!row) {
    row = await Races.create({
      id: state.id,
      title: state.title,
      targetDistance: state.targetDistance,
      startTime: state.startedAt || state.lobbyEndsAt,
      intervalMinutes: config.raceIntervalMinutes || 15,
      maxDurationMinutes: state.maxDurationMinutes || 55,
      status: state.status === "RUNNING" ? "in_progress" : "waiting",
      totalParticipants: 0,
    });
  }
  return row;
}

export async function getOrCreateCurrentRace(): Promise<any> {
  const state = await raceManager.tickPublicRace();
  return ensurePublicRaceRow(state);
}

function formatMinSec(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function mapStateToApiStatus(status: RaceState["status"]): string {
  if (status === "RUNNING") return "in_progress";
  if (status === "COMPLETED") return "finished";
  if (status === "ABANDONED") return "cancelled";
  return "waiting";
}

/**
 * Payload commun (web + montre) décrivant la course publique courante, avec le compte à rebours
 * de départ et le temps restant de la partie.
 */
export async function buildPublicRacePayload(): Promise<any> {
  const state = await raceManager.tickPublicRace();
  const row = await ensurePublicRaceRow(state);
  const timing = raceManager.getRaceTiming(state);
  const apiStatus = mapStateToApiStatus(state.status);

  const count = await Activities.count({
    where: { activityId: state.id, status: { [Op.ne]: "abandoned" } },
  });
  try {
    await row.update({ totalParticipants: count });
  } catch {
    // Non-blocking
  }

  const plainRow = typeof row.toJSON === "function" ? row.toJSON() : row;
  const race = {
    ...plainRow,
    id: state.id,
    type: state.type,
    title: state.title,
    pinCode: state.pinCode,
    targetDistance: state.targetDistance,
    startTime: (state.startedAt || state.lobbyEndsAt).toISOString(),
    maxDurationMinutes: state.maxDurationMinutes || 55,
    hasBots: Boolean(state.hasBots),
    internalStatus: state.status,
    status: apiStatus,
    totalParticipants: count,
  };

  return {
    race,
    secondsRemaining: timing.secondsUntilStart,
    remainingSeconds: timing.remainingSeconds,
    elapsedSeconds: timing.elapsedSeconds,
    maxDurationSeconds: timing.maxDurationSeconds,
    formattedCountdown: formatMinSec(state.status === "RUNNING" ? timing.remainingSeconds : timing.secondsUntilStart),
    totalParticipants: count,
    status: apiStatus,
    pinCode: state.pinCode,
  };
}

/**
 * GET /api/race/next
 */
export const getNextRace = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json(await buildPublicRacePayload());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur récupération prochaine course: " + message });
  }
};

/**
 * POST /api/race/join
 * Quand un joueur se connecte :
 * - Si une course est déjà "in_progress", il peut soit :
 *     * action="join_late" : rejoindre la course en cours et partir après le départ
 *     * action="wait_next" : attendre la fin de la course pour prendre le prochain départ
 *     * action="solo" : ramer en solo
 */
export const joinRace = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId = "anonymous", userName, action = "join" } = req.body;
    const state = await raceManager.tickPublicRace();
    const now = new Date();
    const isRunning = state.status === "RUNNING";
    const timing = raceManager.getRaceTiming(state, now);

    if (isRunning && action === "wait_next") {
      // La prochaine partie publique démarre après la fin de celle-ci ; on indique le temps restant
      res.status(200).json({
        success: true,
        action: "wait_next",
        currentRaceRunning: true,
        remainingSeconds: timing.remainingSeconds,
        secondsRemaining: timing.remainingSeconds + (config.raceIntervalMinutes || 15) * 60,
        formattedCountdown: formatMinSec(timing.remainingSeconds + (config.raceIntervalMinutes || 15) * 60),
        message: "En attente de la fin de la partie en cours.",
      });
      return;
    }

    const actualRaceId = state.id;
    const compositeId = `${actualRaceId}_${userId}`;

    const currentCount = await Activities.count({
      where: { activityId: actualRaceId, status: { [Op.ne]: "abandoned" }, isBot: false },
    });
    const maxAllowed = state.maxParticipants || 20;
    if (currentCount >= maxAllowed && !(await Activities.findByPk(compositeId))) {
      res.status(409).json({
        success: false,
        message: `La course publique est complète (${maxAllowed} participants maximum).`,
      });
      return;
    }

    // Le statut de départ : si rejoint en retard dans une course en cours -> in_progress immédiat
    const playerStatus = isRunning && action === "join_late" ? "in_progress" : "waiting";

    let activity = await Activities.findByPk(compositeId);
    if (!activity) {
      activity = await Activities.create({
        id: compositeId,
        activityId: actualRaceId,
        userId,
        userName: userName || `Racer_${String(userId).slice(-4)}`,
        raceMode: "race",
        targetDistance: state.targetDistance || 10000,
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
        avgSpeedKmh: 0,
      });
    } else {
      await activity.update({
        status: playerStatus,
        userName: userName || activity.get("userName"),
      });
    }

    if (!isRunning && (state.status === "LOBBY" || state.status === "COUNTDOWN")) {
      raceManager.notifyPlayerJoinedPublic(userId);
    }

    // Inscrire/actualiser l'utilisateur sans données personnelles
    const user = await Users.findByPk(userId);
    if (!user) {
      await Users.create({
        id: userId,
        name: userName || `Racer_${String(userId).slice(-4)}`,
        totalRaces: 0,
        totalWins: 0,
        podiums: 0,
      });
    }

    const payload = await buildPublicRacePayload();
    res.status(200).json({
      success: true,
      raceId: actualRaceId,
      race: payload.race,
      isRaceInProgress: isRunning,
      secondsRemaining: payload.secondsRemaining,
      remainingSeconds: payload.remainingSeconds,
      elapsedSeconds: payload.elapsedSeconds,
      totalParticipants: payload.totalParticipants,
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
 * Dédié au mode administrateur
 */
export const updateRaceConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetDistance, intervalMinutes, adminUserId } = req.body;

    if (adminUserId) {
      if (String(adminUserId).toLowerCase() !== "admin" && !isEmmaAdminUser(adminUserId)) {
        const user = await userStore.findUser(adminUserId);
        const isAdmin = user ? Boolean(user.isAdmin) : false;
        if (!user || !isAdmin) {
          res.status(403).json({ message: "Action réservée aux administrateurs habilités." });
          return;
        }
      }
    }

    if (targetDistance) config.defaultRaceDistanceMeters = Number(targetDistance);
    if (intervalMinutes) config.raceIntervalMinutes = Number(intervalMinutes);

    // Mettre également à jour la course publique active en attente si présente
    const activeRace = await Races.findOne({
      where: { id: { [Op.notLike]: "PRIV_%" }, status: "waiting" },
      order: [["createdAt", "DESC"]],
    });
    if (activeRace) {
      if (targetDistance) await activeRace.update({ targetDistance: Number(targetDistance) });
      if (intervalMinutes) await activeRace.update({ intervalMinutes: Number(intervalMinutes) });
    }

    res.status(200).json({
      message: "Configuration mise à jour par l'administrateur",
      defaultRaceDistanceMeters: config.defaultRaceDistanceMeters,
      raceIntervalMinutes: config.raceIntervalMinutes,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur mise à jour config: " + message });
  }
};

/**
 * Pool de prénoms variés pour les rameurs virtuels (bots).
 * Chaque bot porte un prénom bien spécifique.
 */
const BOT_FIRSTNAMES = [
  "Lucas", "Thomas", "Alexandre", "Maxime", "Antoine",
  "Nicolas", "Julien", "Romain", "Clément", "Mathieu",
  "Camille", "Léa", "Manon", "Chloé", "Sarah",
  "Emma", "Hugo", "Nathan", "Gabriel", "Arthur",
  "Théo", "Louis", "Raphaël", "Enzo", "Paul",
  "Océane", "Juliette", "Laura", "Marie", "Lucie"
];

/**
 * Génère des bots adaptés au niveau du joueur (établi par ses points).
 * Les allures s'échelonnent entre 1min50s (110s) et 2min30s (150s) pour 500m.
 */
function generateTunedBots(playerPoints: number, botCount: number = 3) {
  let minPace = 110; // 1m50s
  let maxPace = 150; // 2m30s

  if (playerPoints >= 250) {
    minPace = 110; // 1m50s
    maxPace = 128; // 2m08s
  } else if (playerPoints >= 80) {
    minPace = 118; // 1m58s
    maxPace = 138; // 2m18s
  } else {
    minPace = 125; // 2m05s
    maxPace = 150; // 2m30s
  }

  // Tirage au sort de prénoms uniques
  const shuffledNames = [...BOT_FIRSTNAMES].sort(() => 0.5 - Math.random());
  const selectedBots = [];

  for (let i = 0; i < botCount; i++) {
    const firstName = shuffledNames[i % shuffledNames.length];
    const pace = Math.floor(minPace + Math.random() * (maxPace - minPace));
    const ratio = (150 - pace) / (150 - 110);
    const power = Math.round(135 + ratio * 145);
    const spm = Math.round(22 + ratio * 9);

    selectedBots.push({
      id: `bot_${firstName.toLowerCase()}_${Math.floor(Math.random() * 900 + 100)}`,
      name: `${firstName} (Bot)`,
      pace,
      spm,
      power,
    });
  }

  return selectedBots;
}

/**
 * POST /api/race/bots
 * Permet d'ajouter ou activer des bots virtuels quand le joueur est seul (course publique ou salon privé)
 */
export const toggleBots = async (req: Request, res: Response): Promise<void> => {
  try {
    const { enable = true, raceId, botCount = 3, userId } = req.body;
    const managedPrivate = raceId ? raceManager.findPrivateRace(String(raceId)) : null;

    if (managedPrivate && !raceManager.canManagePrivateRace(managedPrivate, userId)) {
      res.status(403).json({ message: "Seul l'organisateur du salon peut configurer les bots." });
      return;
    }

    let race = raceId ? await Races.findByPk(managedPrivate ? managedPrivate.id : String(raceId)) : await getOrCreateCurrentRace();
    if (!race && managedPrivate) {
      race = await Races.create({
        id: managedPrivate.id,
        title: managedPrivate.title,
        targetDistance: managedPrivate.targetDistance,
        startTime: managedPrivate.lobbyEndsAt,
        intervalMinutes: 0,
        maxDurationMinutes: managedPrivate.maxDurationMinutes || 55,
        status: managedPrivate.status === "RUNNING" ? "in_progress" : "waiting",
        hasBots: Boolean(enable),
        totalParticipants: managedPrivate.totalParticipants || 0,
      });
    }

    if (!race) {
      res.status(404).json({ message: "Aucune course trouvée." });
      return;
    }

    const actualRaceId = String(race.get("id"));
    // Course pilotée par le RaceManager (publique courante ou salon privé) : source de vérité de l'état
    const managedRace = raceManager.getRaceById(actualRaceId);
    const targetDist = managedRace?.targetDistance || (race.get("targetDistance") as number) || 10000;
    const isRunning = managedRace ? managedRace.status === "RUNNING" : race.get("status") === "in_progress";
    const clampedBotCount = Math.min(12, Math.max(1, Number(botCount) || 3));

    if (enable) {
      let playerPoints = 0;
      if (userId) {
        const u = await Users.findByPk(userId);
        if (u) {
          playerPoints = (u.get("points") as number) || 0;
        }
      }

      const existingBots = (await Activities.findAll({ where: { activityId: actualRaceId, isBot: true } })).length;
      const botsToAdd = generateTunedBots(playerPoints, clampedBotCount).slice(0, Math.max(0, clampedBotCount - existingBots));
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
            status: isRunning ? "in_progress" : "waiting",
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
            status: isRunning ? "in_progress" : "waiting",
            isBot: true,
          });
        }
      }
      await race.update({ hasBots: true });
      if (managedRace) managedRace.hasBots = true;
    } else {
      await Activities.destroy({
        where: {
          activityId: actualRaceId,
          isBot: true,
        },
      });
      await race.update({ hasBots: false });
      if (managedRace) managedRace.hasBots = false;
    }

    const count = await Activities.count({
      where: {
        activityId: actualRaceId,
        status: { [Op.ne]: "abandoned" },
      },
    });
    await race.update({ totalParticipants: count });
    if (managedRace) managedRace.totalParticipants = count;

    res.status(200).json({
      success: true,
      hasBots: Boolean(enable),
      totalParticipants: count,
      message: enable ? "Joueurs virtuels engagés dans la course !" : "Joueurs virtuels retirés.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur gestion des bots: " + message });
  }
};

/**
 * GET /api/race/admin/config
 * Consultation de la configuration des courses publiques
 */
export const getPublicRaceAdminConfig = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    success: true,
    config: raceManager.adminPublicRaceConfig,
  });
};

/**
 * PUT /api/race/admin/config
 * Configuration des courses publiques par l'administrateur
 * Nombre et niveau des bots par défaut, nombre max de joueur, durée et distance de la course.
 */
export const updatePublicRaceAdminConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      userId,
      targetDistance,
      maxParticipants,
      maxDurationMinutes,
      defaultBotsCount,
      defaultBotsPace,
      countdownAfterLastJoinSeconds,
    } = req.body || {};

    const user = await userStore.findUser(userId);
    const isEmma = isEmmaAdminUser(userId, user?.name);
    if (!isEmma && !user?.isAdmin) {
      res.status(403).json({ success: false, message: "Action réservée aux administrateurs." });
      return;
    }

    const updated = raceManager.updatePublicRaceConfig({
      targetDistance,
      maxParticipants,
      maxDurationMinutes,
      defaultBotsCount,
      defaultBotsPace,
      countdownAfterLastJoinSeconds,
    });

    res.status(200).json({
      success: true,
      message: "Configuration des courses publiques mise à jour avec succès.",
      config: updated,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur config publique: " + message });
  }
};

export default {
  getNextRace,
  joinRace,
  getRaceHistory,
  updateRaceConfig,
  toggleBots,
  getPublicRaceAdminConfig,
  updatePublicRaceAdminConfig,
};
