import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import config from "../config";
import raceManager, { RaceState, RaceManager } from "../services/race-manager.service";
import { isEmmaAdminUser } from "../services/auth.service";
import userStore from "../services/user-store.service";
import { IpGeoService } from "../services/ip-geo.service";
import { generateRealisticBotPace, calculateBotPhysics, getLeagueByPoints, calculateRacePoints } from "../utils/league.util";
import pairingService from "../services/pairing.service";
import socketGateway from "../websocket/socket.gateway";

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
  const rawParts = state.participants ? Array.from(state.participants.values()) : [];
  const participantsList = rawParts.map((p: any) => {
    const isBot = Boolean(p.isBot) || String(p.userId || "").startsWith("bot_");
    const isPaired = !isBot && Boolean(
      p.isPaired ||
      p.deviceToken ||
      pairingService.isParticipantPaired({ userId: p.userId, deviceToken: p.deviceToken, deviceId: p.deviceId })
    );
    return {
      ...p,
      isBot,
      isPaired,
    };
  });
  count = Math.max(count, participantsList.length);

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
    participants: participantsList,
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
    const { userId: rawUserId = "anonymous", userName: rawUserName, action = "join", deviceId: rawDeviceId, deviceToken: bodyDeviceToken } = req.body || {};
    const authHeader = String(req.headers.authorization || "");
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const headerToken = req.headers["x-device-token"] ? String(req.headers["x-device-token"]).trim() : "";
    const rawToken = bodyDeviceToken ? String(bodyDeviceToken).trim() : (bearerToken || headerToken);

    const state = await raceManager.tickPublicRace();
    const now = new Date();
    const isRunning = state.status === "RUNNING";
    const timing = raceManager.getRaceTiming(state, now);

    // Résolution automatique de l'identité canonique (lien montre appairée <-> compte utilisateur)
    const identity = await pairingService.resolvePairedIdentity({
      userId: rawUserId,
      userName: rawUserName,
      deviceToken: rawToken,
      deviceId: rawDeviceId,
    });
    const userId = identity.userId;
    const cleanUserName = identity.userName;
    const deviceId = identity.deviceId || rawDeviceId;
    const deviceToken = identity.deviceToken || rawToken;

    if (state.pauseEndsAt && state.pauseEndsAt.getTime() > now.getTime()) {
      const pauseRemaining = Math.max(0, Math.ceil((state.pauseEndsAt.getTime() - now.getTime()) / 1000));
      res.status(200).json({
        success: true,
        action: "wait_next",
        userId,
        userName: cleanUserName,
        isPaired: identity.isPaired,
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
        userId,
        userName: cleanUserName,
        isPaired: identity.isPaired,
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

    let currentCount = 0;
    try {
      currentCount = await Activities.count({
        where: { activityId: actualRaceId, status: { [Op.ne]: "abandoned" }, isBot: false },
      });
    } catch {
      currentCount = state.participants ? state.participants.size : 0;
    }

    const maxAllowed = state.maxParticipants || 20;
    let existingActivity: any = null;
    try {
      existingActivity = await Activities.findByPk(compositeId);
    } catch {}

    if (currentCount >= maxAllowed && !existingActivity) {
      res.status(409).json({
        success: false,
        message: `La course publique est complète (${maxAllowed} participants maximum).`,
      });
      return;
    }

    // Le statut de départ : si rejoint en retard dans une course en cours -> in_progress immédiat
    const playerStatus = isRunning && action === "join_late" ? "in_progress" : "waiting";

    let activity = existingActivity;
    if (!activity) {
      const user = await userStore.findUser(String(userId));
      const country = user?.country || user?.pays || (await IpGeoService.resolveCountryFromRequest(req));
      const finalName = cleanUserName || user?.name || `Racer_${String(userId).slice(-4)}`;

      try {
        activity = await Activities.create({
          id: compositeId,
          activityId: actualRaceId,
          userId,
          userName: finalName,
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
      } catch {
        activity = {
          id: compositeId,
          activityId: actualRaceId,
          userId,
          userName: finalName,
          status: playerStatus,
          netDistance: 0,
          update: async () => {},
          toJSON: () => ({ id: compositeId, userId, userName: finalName, status: playerStatus })
        };
      }
    } else {
      const finalName = cleanUserName || activity.userName || activity.get?.("userName");
      try {
        await activity.update({
          status: playerStatus,
          userName: finalName,
        });
      } catch {}
    }

    // Dédoublonnage et notification dans le gestionnaire de course (avec deviceId et login Garmin)
    if (!isRunning && (state.status === "LOBBY" || state.status === "COUNTDOWN")) {
      raceManager.notifyPlayerJoinedPublic(userId, cleanUserName, deviceId, deviceToken, identity.isPaired);
    } else if (state.participants) {
      // Si course déjà lancée, assurer le dédoublonnage de lignes d'eau
      raceManager.notifyPlayerJoinedPublic(userId, cleanUserName, deviceId, deviceToken, identity.isPaired);
    }

    const assignedLane = state.participants?.get(userId)?.lane || 1;

    // Diffuser immédiatement la liste des kayaks mise à jour aux clients web via WebSocket
    try {
      const rows = await Activities.findAll({
        where: { activityId: actualRaceId, status: { [Op.ne]: "abandoned" } },
      });
      if (rows.length > 0) {
        const sorted = RaceManager.sortRanking(rows as any);
        socketGateway.broadcastLeaderboard(actualRaceId, RaceManager.toLiveMetrics(sorted, state));
      }
    } catch {}

    // Inscrire/actualiser l'utilisateur sans données personnelles (tolérant au mode offline DB)
    try {
      const user = await Users.findByPk(userId);
      if (!user) {
        await Users.create({
          id: userId,
          name: cleanUserName || `Racer_${String(userId).slice(-4)}`,
          totalRaces: 0,
          totalWins: 0,
          podiums: 0,
        });
      }
    } catch {}

    const payload = await buildPublicRacePayload();
    res.status(200).json({
      success: true,
      raceId: actualRaceId,
      userId,
      userName: cleanUserName,
      lane: assignedLane,
      isPaired: identity.isPaired,
      deviceToken: deviceToken || undefined,
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
        title: race.get("title"),
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

    const managedForParts = raceManager.getRaceById(cleanId) || raceManager.findPrivateRace(cleanId);
    if (managedForParts && managedForParts.participants) {
      const existingIds = new Set(
        activities.map((a: any) => (typeof a.get === "function" ? a.get("userId") : a.userId))
      );
      for (const p of managedForParts.participants.values()) {
        if (!existingIds.has(p.userId)) {
          const fallbackObj: Record<string, any> = {
            id: `${cleanId}_${p.userId}`,
            activityId: cleanId,
            userId: p.userId,
            userName: p.userName || p.userId,
            country: p.country,
            lane: p.lane || 1,
            status: managedForParts.status === "RUNNING" ? "in_progress" : "waiting",
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
          activities.push(fallbackObj);
        }
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
        const isPaired = !isBot && Boolean(
          getVal("isPaired") ||
          pairingService.isParticipantPaired({ userId, deviceId: getVal("deviceId"), deviceToken: getVal("deviceToken") }) ||
          Boolean(storedUser)
        );

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
          isPaired,
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
