import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import config from "../config";
import raceManager, { RaceState, RaceManager } from "../services/race-manager.service";
import { isEmmaAdminUser } from "../services/auth.service";
import userStore from "../services/user-store.service";
import { IpGeoService } from "../services/ip-geo.service";
import { generateRealisticBotPace, calculateBotPhysics, getLeagueByPoints, calculateRacePoints } from "../utils/league.util";

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
  try {
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
  } catch (err) {
    return {
      id: state.id,
      title: state.title,
      targetDistance: state.targetDistance,
      startTime: state.startedAt || state.lobbyEndsAt,
      intervalMinutes: config.raceIntervalMinutes || 15,
      maxDurationMinutes: state.maxDurationMinutes || 55,
      status: state.status === "RUNNING" ? "in_progress" : "waiting",
      totalParticipants: 0,
      update: async () => {},
      toJSON: () => ({ id: state.id })
    };
  }
}

export async function getOrCreateCurrentRace(): Promise<any> {
  const state = await raceManager.tickPublicRace();
  return ensurePublicRaceRow(state);
}

export function formatMinSec(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function formatRaceStateResponse(race: RaceState, now: Date = new Date()): any {
  const timing = raceManager.getRaceTiming(race, now);
  const isPostRacePause = Boolean(race.pauseEndsAt && race.pauseEndsAt.getTime() > now.getTime());
  const pauseRemaining = isPostRacePause
    ? Math.max(0, Math.ceil((race.pauseEndsAt!.getTime() - now.getTime()) / 1000))
    : 0;

  const apiStatus = isPostRacePause ? "post_race_pause" : mapStateToApiStatus(race.status);

  return {
    race: {
      id: race.id,
      code: race.code,
      pinCode: race.pinCode,
      type: race.type,
      title: race.title,
      targetDistance: race.targetDistance,
      startTime: (race.startedAt || race.lobbyEndsAt).toISOString(),
      maxDurationMinutes: race.maxDurationMinutes || 55,
      hasBots: Boolean(race.hasBots),
      internalStatus: race.status,
      status: apiStatus,
      totalParticipants: race.totalParticipants || (race.participants ? race.participants.size : 0),
    },
    timing,
    secondsRemaining: isPostRacePause ? pauseRemaining : timing.secondsUntilStart,
    remainingSeconds: isPostRacePause ? pauseRemaining : timing.remainingSeconds,
    elapsedSeconds: timing.elapsedSeconds,
    maxDurationSeconds: timing.maxDurationSeconds,
    formattedCountdown: formatMinSec(
      isPostRacePause
        ? pauseRemaining
        : (race.status === "RUNNING" ? timing.remainingSeconds : timing.secondsUntilStart)
    ),
    status: apiStatus,
    pinCode: race.pinCode,
    isPostRacePause,
    pauseRemainingSeconds: pauseRemaining,
  };
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

  const isPostRacePause = Boolean(state.pauseEndsAt && state.pauseEndsAt.getTime() > Date.now());
  const pauseRemaining = isPostRacePause
    ? Math.max(0, Math.ceil((state.pauseEndsAt!.getTime() - Date.now()) / 1000))
    : 0;

  const apiStatus = isPostRacePause ? "post_race_pause" : mapStateToApiStatus(state.status);

  let count = 0;
  try {
    count = await Activities.count({
      where: { activityId: state.id, status: { [Op.ne]: "abandoned" } },
    });
    await row.update({ totalParticipants: count });
  } catch {
    // Non-blocking fallback when DB offline
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
    secondsRemaining: isPostRacePause ? pauseRemaining : timing.secondsUntilStart,
    remainingSeconds: isPostRacePause ? pauseRemaining : timing.remainingSeconds,
    elapsedSeconds: timing.elapsedSeconds,
    maxDurationSeconds: timing.maxDurationSeconds,
    formattedCountdown: formatMinSec(isPostRacePause ? pauseRemaining : (state.status === "RUNNING" ? timing.remainingSeconds : timing.secondsUntilStart)),
    totalParticipants: count,
    status: apiStatus,
    pinCode: state.pinCode,
    isPostRacePause,
    pauseRemainingSeconds: pauseRemaining,
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

    if (state.pauseEndsAt && state.pauseEndsAt.getTime() > now.getTime()) {
      const pauseRemaining = Math.max(0, Math.ceil((state.pauseEndsAt.getTime() - now.getTime()) / 1000));
      res.status(200).json({
        success: true,
        action: "wait_next",
        isPostRacePause: true,
        pauseRemainingSeconds: pauseRemaining,
        secondsRemaining: pauseRemaining,
        formattedCountdown: formatMinSec(pauseRemaining),
        message: `Pause d'après-course en cours (2 minutes). Prochaine épreuve dans ${pauseRemaining}s.`,
      });
      return;
    }

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
      const user = await userStore.findUser(String(userId));
      const country = user?.country || user?.pays || (await IpGeoService.resolveCountryFromRequest(req));

      activity = await Activities.create({
        id: compositeId,
        activityId: actualRaceId,
        userId,
        userName: userName || `Racer_${String(userId).slice(-4)}`,
        country,
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
 * GET /api/races/:id/leaderboard ou GET /api/race/:id/leaderboard
 * Fournit le classement complet et détaillé d'une session passée
 * (position, pseudos, chronos, allure moyenne /500m, écarts, statut, ligue).
 */
export const getRaceLeaderboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const cleanId = String(id || "").trim();
    if (!cleanId) {
      res.status(400).json({ success: false, message: "Identifiant de course requis." });
      return;
    }

    let race: any = null;
    try {
      race = await Races.findByPk(cleanId);
    } catch {
      // Tolérance DB hors-ligne
    }

    let targetDistance = 2000;
    let raceInfo: any = null;

    if (race) {
      targetDistance = (race.get("targetDistance") as number) || 2000;
      raceInfo = {
        id: race.get("id"),
        targetDistance,
        status: race.get("status"),
        startTime: race.get("startTime"),
        endedAt: race.get("endedAt"),
      };
    } else {
      const managed = raceManager.getRaceById(cleanId) || raceManager.findPrivateRace(cleanId);
      if (managed) {
        targetDistance = managed.targetDistance || 2000;
        raceInfo = {
          id: managed.id,
          title: managed.title,
          targetDistance,
          status: managed.status,
          startTime: managed.startedAt || managed.createdAt,
          endedAt: managed.endedAt,
        };
      }
    }

    let activities: any[] = [];
    try {
      activities = await Activities.findAll({
        where: { activityId: cleanId },
      });
    } catch {
      // Tolérance DB hors-ligne
    }

    if (activities.length === 0) {
      // Tolérance in-memory / userStore
      const memActs = userStore.findActivitiesByRaceId(cleanId);
      if (memActs.length > 0) {
        activities = memActs as any;
      }
    }

    if (!race && !raceInfo) {
      if (activities.length > 0) {
        const first = activities[0];
        targetDistance = (typeof first.get === "function" ? first.get("targetDistance") : first.targetDistance) || 2000;
        raceInfo = {
          id: cleanId,
          title: "Régate officielle",
          targetDistance,
          status: "finished",
          startTime: (typeof first.get === "function" ? first.get("date") : first.date) || new Date(),
        };
      } else {
        res.status(404).json({ success: false, message: "Course introuvable." });
        return;
      }
    }

    const nonAbandoned = activities.filter((a: any) => (typeof a.get === "function" ? a.get("status") : a.status) !== "abandoned");
    const abandoned = activities.filter((a: any) => (typeof a.get === "function" ? a.get("status") : a.status) === "abandoned");
    const sortedActive = RaceManager.sortRanking(nonAbandoned);
    const sortedAll = [...sortedActive, ...abandoned];

    const leaderRow = sortedActive[0] as any;
    const leaderTime = leaderRow && (typeof leaderRow.get === "function" ? leaderRow.get("status") : leaderRow.status) === "finished"
      ? (typeof leaderRow.get === "function" ? leaderRow.get("elapsedTime") : leaderRow.elapsedTime) || 0
      : null;
    const leaderDist = leaderRow ? (typeof leaderRow.get === "function" ? leaderRow.get("netDistance") : leaderRow.netDistance) || 0 : 0;

    const leaderboard = await Promise.all(
      sortedAll.map(async (act: any, idx: number) => {
        const getVal = (field: string) => (typeof act.get === "function" ? act.get(field) : act[field]);
        const status = getVal("status") || "in_progress";
        const isFinisher = status === "finished";
        const elapsed = Number(getVal("elapsedTime")) || 0;
        const dist = Number(getVal("netDistance")) || 0;
        const rank = Number(getVal("finalRank")) || (idx + 1);
        const isBot = Boolean(getVal("isBot"));
        const userId = getVal("userId") || `athlete_${idx + 1}`;
        const storedUser = !isBot ? await userStore.findUser(userId) : null;
        const userName = storedUser ? storedUser.login : (getVal("userName") || userId);

        // Allure moyenne /500m
        let rawPace = Number(getVal("avgPace")) || Number(getVal("lastPace")) || 0;
        if (!rawPace && dist > 0 && elapsed > 0) {
          rawPace = Math.round((elapsed / dist) * 500);
        }
        const paceM = Math.floor(rawPace / 60);
        const paceS = Math.floor(rawPace % 60);
        const formattedPace = rawPace > 0 ? `${paceM}'${paceS.toString().padStart(2, "0")}"` : "--";

        // Chrono mm:ss
        const mins = Math.floor(elapsed / 60);
        const secs = Math.floor(elapsed % 60);
        const chrono = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;

        // Calcul de l'écart (gap)
        let gap = "-";
        if (status === "abandoned") {
          gap = "Abandon";
        } else if (idx === 0) {
          gap = isFinisher ? "Vainqueur" : (sortedActive.length > 0 ? "Leader" : "Non classé");
        } else if (isFinisher && leaderTime !== null) {
          const deltaSec = Math.max(0, elapsed - leaderTime);
          const m = Math.floor(deltaSec / 60);
          const s = Math.floor(deltaSec % 60);
          gap = `+${m > 0 ? `${m}m ` : ""}${s.toString().padStart(2, "0")}s`;
        } else if (leaderDist > dist) {
          const deltaM = Math.round(leaderDist - dist);
          gap = `-${deltaM}m`;
        }

        // Ligue du joueur
        let league = null;
        if (!isBot) {
          const pts = storedUser ? storedUser.points || 0 : 0;
          league = getLeagueByPoints(pts);
        }

        // Points attribués pour la course (0 si abandon)
        const rawPoints = getVal("points");
        const earnedPoints = status === "abandoned"
          ? 0
          : (rawPoints !== undefined && rawPoints !== null ? Number(rawPoints) : calculateRacePoints(rank, sortedAll.length, isFinisher));

        return {
          position: rank,
          userId,
          userName,
          isBot,
          status,
          chrono,
          elapsedTime: elapsed,
          avgPace: formattedPace,
          avgPaceSec: rawPace,
          netDistance: dist,
          gap,
          points: earnedPoints,
          league,
        };
      })
    );

    res.status(200).json({
      success: true,
      race: raceInfo || { id: cleanId, targetDistance, status: "finished" },
      leaderboard,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur récupération classement: " + message });
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
 * Équilibrage des Bots (Allures réalistes et distribution asymétrique) :
 * - Plage d'allure : 1 min 50 s / 500 m (110s) à 2 min 45 s / 500 m (165s)
 * - Distribution pondérée :
 *   - 60 % de bots entre 2m20s (140s) et 2m45s (165s) (niveau loisir / modéré)
 *   - 30 % de bots entre 2m05s (125s) et 2m20s (140s) (niveau intermédiaire)
 *   - 10 % de bots rapides entre 1m50s (110s) et 2m05s (125s) (challenge de tête)
 */
function generateTunedBots(playerPoints: number, botCount: number = 3) {
  // Tirage au sort de prénoms uniques
  const shuffledNames = [...BOT_FIRSTNAMES].sort(() => 0.5 - Math.random());
  const selectedBots = [];

  for (let i = 0; i < botCount; i++) {
    const firstName = shuffledNames[i % shuffledNames.length];
    const pace = generateRealisticBotPace();
    const { power, spm } = calculateBotPhysics(pace);

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

    if (managedPrivate && managedPrivate.isBotDuel) {
      let isRegisteredUser = false;
      if (userId) {
        const cleanId = String(userId).trim();
        if (cleanId && cleanId !== "anonymous" && !cleanId.startsWith("guest_")) {
          const userObj = await userStore.findUser(cleanId);
          if (userObj) {
            isRegisteredUser = true;
          }
        }
      }
      if (!isRegisteredUser) {
        res.status(403).json({
          success: false,
          message: "En mode duel 1v1 contre un bot, seul un utilisateur inscrit avec un compte peut ajouter ou retirer un bot."
        });
        return;
      }
    }

    let race: any = null;
    try {
      race = raceId ? await Races.findByPk(managedPrivate ? managedPrivate.id : String(raceId)) : await getOrCreateCurrentRace();
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
    } catch {
      // Tolérance DB hors-ligne (pilotage en mémoire par RaceManager)
    }

    const actualRaceId = race ? String(race.get("id")) : (raceId ? String(raceId) : "RACE_DEFAULT");
    // Course pilotée par le RaceManager (publique courante ou salon privé) : source de vérité de l'état
    const managedRace = raceManager.getRaceById(actualRaceId);
    const targetDist = managedRace?.targetDistance || (race ? (race.get("targetDistance") as number) : 10000) || 10000;
    const isRunning = managedRace ? managedRace.status === "RUNNING" : (race ? race.get("status") === "in_progress" : false);
    const clampedBotCount = managedPrivate?.isBotDuel ? 1 : Math.min(12, Math.max(1, Number(botCount) || 3));

    if (enable) {
      let playerPoints = 0;
      if (userId) {
        try {
          const u = await Users.findByPk(userId);
          if (u) {
            playerPoints = (u.get("points") as number) || 0;
          }
        } catch {
          const uMem = await userStore.findUser(userId);
          if (uMem) playerPoints = uMem.points || 0;
        }
      }

      try {
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
        if (race) await race.update({ hasBots: true });
      } catch {
        // Tolérance DB
      }
      if (managedRace) {
        managedRace.hasBots = true;
        managedRace.botCount = managedPrivate?.isBotDuel ? 1 : clampedBotCount;
      }
    } else {
      try {
        await Activities.destroy({
          where: {
            activityId: actualRaceId,
            isBot: true,
          },
        });
        if (race) await race.update({ hasBots: false });
      } catch {
        // Tolérance DB
      }
      if (managedRace) {
        managedRace.hasBots = false;
        managedRace.botCount = 0;
      }
    }

    let count = 0;
    try {
      count = await Activities.count({
        where: {
          activityId: actualRaceId,
          status: { [Op.ne]: "abandoned" },
        },
      });
      if (race) await race.update({ totalParticipants: count });
    } catch {
      count = managedRace?.participants ? managedRace.participants.size : 1;
    }
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
    config: {
      ...raceManager.adminPublicRaceConfig,
      privateMaxDurationMinutes: raceManager.adminPrivateRaceConfig?.maxDurationMinutes ?? raceManager.adminPublicRaceConfig?.privateMaxDurationMinutes ?? 55,
    },
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
      privateMaxDurationMinutes,
      defaultBotsCount,
      defaultBotsPace,
      countdownAfterLastJoinSeconds,
      lobbyWaitMinutes,
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
      privateMaxDurationMinutes,
      defaultBotsCount,
      defaultBotsPace,
      countdownAfterLastJoinSeconds,
      lobbyWaitMinutes,
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

/**
 * POST /api/race/stop
 * L'organisateur d'un salon ou l'administrateur peut arrêter la course en direct.
 * Le classement officiel final est immédiatement établi selon la position des coureurs.
 */
export const stopRace = async (req: Request, res: Response): Promise<void> => {
  try {
    const { raceId, userId } = req.body;
    if (!raceId || !userId) {
      res.status(400).json({ success: false, message: "raceId et userId requis pour arrêter la course." });
      return;
    }

    const cleanRaceId = String(raceId).trim();
    const cleanUserId = String(userId).trim();

    const managedPrivate = raceManager.findPrivateRace(cleanRaceId);
    const managedPublic = raceManager.getCurrentPublicRace();
    const user = await Users.findByPk(cleanUserId);
    const isAdmin = Boolean(
      cleanUserId.toLowerCase() === "emmaracer" ||
      user?.get("isAdmin") === true ||
      (user as any)?.role === "admin"
    );

    const isHostOfPrivate = Boolean(managedPrivate && managedPrivate.hostUserId === cleanUserId);

    if (!isAdmin && !isHostOfPrivate) {
      res.status(403).json({
        success: false,
        message: "Action non autorisée. Seul l'organisateur du salon ou un administrateur peut arrêter la course."
      });
      return;
    }

    const targetRaceId = managedPrivate
      ? managedPrivate.id
      : (managedPublic && managedPublic.id === cleanRaceId ? managedPublic.id : cleanRaceId);

    console.log(`[RaceController] Stopping race ${targetRaceId} requested by ${cleanUserId} (isAdmin=${isAdmin}, isHost=${isHostOfPrivate})`);
    const ranking = await raceManager.finishRace(targetRaceId, false, "organizer_stopped");

    res.status(200).json({
      success: true,
      message: "La course a été arrêtée. Le classement officiel a été établi selon la position des rameurs.",
      ranking
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur arrêt course: " + message });
  }
};

export default {
  getNextRace,
  joinRace,
  getRaceHistory,
  getRaceLeaderboard,
  updateRaceConfig,
  toggleBots,
  getPublicRaceAdminConfig,
  updatePublicRaceAdminConfig,
  stopRace,
  formatRaceStateResponse,
  formatMinSec,
};
