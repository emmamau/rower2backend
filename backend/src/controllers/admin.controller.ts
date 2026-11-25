import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import raceManager from "../services/race-manager.service";
import socketGateway from "../websocket/socket.gateway";
import { hashPassword, isEmmaAdminUser } from "../services/auth.service";
import subscriptionPlanService from "../services/subscription-plan.service";
import userStore from "../services/user-store.service";
import { ensureCurrentWeek } from "../services/league-db.service";
import antiCheatService from "../services/anti-cheat.service";

const Users = db.users;
const PublicRaceSettings = db.publicRaceSettings;
const SubscriptionPlans = db.subscriptionPlans;
const Races = db.races;
const Activities = db.activities;
const Pairings = db.pairings;
const DuelChallenges = db.duelChallenges;

function sanitizeAdminUser(user: any): Record<string, any> {
  const plain = typeof user.toJSON === "function" ? user.toJSON() : { ...user };
  delete plain.passwordHash;
  delete plain.passwordSalt;
  delete plain.resetPasswordToken;
  delete plain.resetPasswordExpires;
  plain.role = plain.role ? String(plain.role).toUpperCase() : (plain.isAdmin ? "ADMIN" : "USER");
  plain.isRevoked = plain.isRevoked !== undefined ? Boolean(plain.isRevoked) : Boolean(plain.is_revoked);
  plain.subscriptionTier = plain.subscriptionTier || plain.subscription_tier || "free";
  plain.customConcurrentRooms = plain.customConcurrentRooms !== undefined ? plain.customConcurrentRooms : (plain.custom_concurrent_rooms ?? null);
  plain.customWeeklyRooms = plain.customWeeklyRooms !== undefined ? plain.customWeeklyRooms : (plain.custom_weekly_rooms ?? null);
  return plain;
}

export class AdminController {
  // ---------------------------------------------------------------------------
  // 1. Courses Publiques (Pilote Automatique)
  // ---------------------------------------------------------------------------

  public static async getPublicRaceSettings(_req: Request, res: Response): Promise<void> {
    let setting: any = null;
    try {
      setting = await PublicRaceSettings.findByPk(1);
    } catch {}

    if (!setting) {
      setting = {
        id: 1,
        isEnabled: raceManager.isPublicRaceEnabled,
        raceDistanceM: raceManager.publicRaceDistanceM,
        maxDurationSec: raceManager.publicMaxDurationSec,
        maxPlayers: raceManager.publicMaxPlayers,
        botCount: raceManager.publicBotCount,
        interRaceDelaySec: raceManager.publicInterRaceDelaySec,
        overtakeThresholdM: raceManager.overtakeThresholdM,
        inactivityAbandonSec: Math.round(raceManager.inactivityAbandonMs / 1000),
      };
    } else {
      const plain = typeof (setting as any).toJSON === "function" ? (setting as any).toJSON() : setting;
      setting = {
        ...plain,
        overtakeThresholdM: Number(plain.overtakeThresholdM ?? plain.overtake_threshold_m ?? raceManager.overtakeThresholdM ?? 5),
        inactivityAbandonSec: Number(plain.inactivityAbandonSec ?? plain.inactivity_abandon_sec ?? Math.round((raceManager.inactivityAbandonMs || 60000) / 1000)),
      };
    }

    res.status(200).json({
      success: true,
      settings: typeof (setting as any).toJSON === "function" ? (setting as any).toJSON() : setting,
      liveStatus: {
        isEnabled: raceManager.isPublicRaceEnabled,
        currentRaceId: raceManager.getCurrentPublicRace()?.id || null,
        currentRaceStatus: raceManager.getCurrentPublicRace()?.status || (raceManager.isPublicRaceEnabled ? "LOBBY" : "SUSPENDED"),
      },
    });
  }

  public static async updatePublicRaceSettings(req: Request, res: Response): Promise<void> {
    try {
      const {
        race_distance_m,
        raceDistanceM,
        max_duration_sec,
        maxDurationSec,
        max_players,
        maxPlayers,
        bot_count,
        botCount,
        inter_race_delay_sec,
        interRaceDelaySec,
        overtake_threshold_m,
        overtakeThresholdM,
        inactivity_abandon_sec,
        inactivityAbandonSec,
        is_enabled,
        isEnabled,
      } = req.body || {};

      const updates: any = {};
      if (overtake_threshold_m !== undefined || overtakeThresholdM !== undefined) {
        const val = Number(overtake_threshold_m ?? overtakeThresholdM);
        if (isNaN(val) || val < 1 || val > 50) {
          res.status(400).json({ success: false, message: "La distance de dépassement doit être comprise entre 1 et 50 mètres." });
          return;
        }
        updates.overtakeThresholdM = val;
        raceManager.overtakeThresholdM = val;
      }
      if (inactivity_abandon_sec !== undefined || inactivityAbandonSec !== undefined) {
        const val = Number(inactivity_abandon_sec ?? inactivityAbandonSec);
        if (isNaN(val) || val < 15 || val > 600) {
          res.status(400).json({ success: false, message: "Le délai d'inactivité avant abandon doit être compris entre 15 et 600 secondes." });
          return;
        }
        updates.inactivityAbandonSec = val;
        raceManager.inactivityAbandonMs = val * 1000;
      }
      if (race_distance_m !== undefined || raceDistanceM !== undefined) {
        updates.raceDistanceM = Math.max(200, Math.min(50000, Number(race_distance_m ?? raceDistanceM)));
        raceManager.publicRaceDistanceM = updates.raceDistanceM;
        raceManager.adminPublicRaceConfig.targetDistance = updates.raceDistanceM;
      }
      if (max_duration_sec !== undefined || maxDurationSec !== undefined) {
        updates.maxDurationSec = Math.max(60, Math.min(7200, Number(max_duration_sec ?? maxDurationSec)));
        raceManager.publicMaxDurationSec = updates.maxDurationSec;
        raceManager.adminPublicRaceConfig.maxDurationMinutes = Math.max(1, Math.round(updates.maxDurationSec / 60));
      }
      if (max_players !== undefined || maxPlayers !== undefined) {
        updates.maxPlayers = Math.max(2, Math.min(100, Number(max_players ?? maxPlayers)));
        raceManager.publicMaxPlayers = updates.maxPlayers;
        raceManager.adminPublicRaceConfig.maxParticipants = updates.maxPlayers;
      }
      if (bot_count !== undefined || botCount !== undefined) {
        updates.botCount = Math.max(0, Math.min(20, Number(bot_count ?? botCount)));
        raceManager.publicBotCount = updates.botCount;
        raceManager.adminPublicRaceConfig.defaultBotsCount = updates.botCount;
      }
      if (inter_race_delay_sec !== undefined || interRaceDelaySec !== undefined) {
        updates.interRaceDelaySec = Math.max(15, Math.min(3600, Number(inter_race_delay_sec ?? interRaceDelaySec)));
        raceManager.publicInterRaceDelaySec = updates.interRaceDelaySec;
        raceManager.adminPublicRaceConfig.lobbyWaitMinutes = Math.max(1, Math.round(updates.interRaceDelaySec / 60));
      }
      if (is_enabled !== undefined || isEnabled !== undefined) {
        updates.isEnabled = Boolean(is_enabled ?? isEnabled);
        raceManager.isPublicRaceEnabled = updates.isEnabled;
      }

      let row: any = null;
      try {
        const [found] = await PublicRaceSettings.findOrCreate({ where: { id: 1 }, defaults: { id: 1, ...updates } });
        await found.update(updates);
        row = found;
        await raceManager.loadPublicRaceSettingsFromDb();
        socketGateway.broadcast("settings:updated", {
          overtakeThresholdM: raceManager.overtakeThresholdM,
          inactivityAbandonSec: Math.round(raceManager.inactivityAbandonMs / 1000),
        });
      } catch {}

      const plainRow = row && typeof row.toJSON === "function" ? row.toJSON() : { id: 1, ...updates };
      const returnedSettings = {
        ...plainRow,
        overtakeThresholdM: Number(plainRow.overtakeThresholdM ?? plainRow.overtake_threshold_m ?? raceManager.overtakeThresholdM ?? 5),
        inactivityAbandonSec: Number(plainRow.inactivityAbandonSec ?? plainRow.inactivity_abandon_sec ?? Math.round((raceManager.inactivityAbandonMs || 60000) / 1000)),
      };

      res.status(200).json({
        success: true,
        message: "Paramètres des courses publiques mis à jour et appliqués dynamiquement à chaud.",
        settings: returnedSettings,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur mise à jour configuration publique: ${message}` });
    }
  }

  public static async togglePublicRaces(req: Request, res: Response): Promise<void> {
    try {
      const { is_enabled, isEnabled } = req.body || {};
      const targetState = Boolean(is_enabled !== undefined ? is_enabled : isEnabled);

      try {
        const [row] = await PublicRaceSettings.findOrCreate({ where: { id: 1 } });
        await row.update({ isEnabled: targetState });
      } catch {}

      await raceManager.togglePublicRaces(targetState);

      res.status(200).json({
        success: true,
        isEnabled: targetState,
        message: targetState
          ? "Courses publiques réactivées. Cycle de régates relancé."
          : "Courses publiques suspendues. Bannière diffusée aux coureurs.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur bascule courses publiques: ${message}` });
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Gestion des Utilisateurs
  // ---------------------------------------------------------------------------

  public static async getUsers(req: Request, res: Response): Promise<void> {
    try {
      const { search, q, role, tier, status, page = 1, limit = 50 } = req.query as any;

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
      const offset = (pageNum - 1) * limitNum;

      const whereClause: any = {};

      const searchTerm = String(search || q || "").trim();
      if (searchTerm) {
        whereClause[Op.or] = [
          { login: { [Op.iLike]: `%${searchTerm}%` } },
          { name: { [Op.iLike]: `%${searchTerm}%` } },
          { email: { [Op.iLike]: `%${searchTerm}%` } },
          { id: { [Op.iLike]: `%${searchTerm}%` } },
        ];
      }

      if (String(role).toUpperCase() === "GUEST") {
        whereClause[Op.and] = [
          {
            [Op.or]: [
              { id: { [Op.like]: "usr_%" } },
              { id: { [Op.like]: "guest_%" } },
              { id: "anonymous" },
              { login: { [Op.like]: "usr_%" } },
              { login: { [Op.like]: "guest_%" } },
            ],
          },
          {
            [Op.or]: [
              { email: null },
              { email: "" },
            ],
          },
        ];
      } else if (role) {
        whereClause.role = String(role).toUpperCase();
      }

      if (tier) {
        whereClause[Op.or] = [
          { subscriptionTier: String(tier).toLowerCase() },
          { subscription_tier: String(tier).toLowerCase() },
        ];
      }

      if (status === "revoked") {
        whereClause.isRevoked = true;
      } else if (status === "active") {
        whereClause.isRevoked = false;
      }

      let count = 0;
      let sanitizedUsers: any[] = [];

      try {
        const result = await Users.findAndCountAll({
          where: whereClause,
          order: [["createdAt", "DESC"]],
          limit: limitNum,
          offset,
        });
        count = result.count;
        sanitizedUsers = result.rows.map((u) => sanitizeAdminUser(u));
      } catch {
        // Fallback mémoire quand PostgreSQL est hors-ligne
        let all = await userStore.getAllUsers();
        if (searchTerm) {
          const s = searchTerm.toLowerCase();
          all = all.filter((u) => (u.login && u.login.toLowerCase().includes(s)) || (u.name && u.name.toLowerCase().includes(s)) || (u.email && u.email.toLowerCase().includes(s)));
        }
        if (String(role).toUpperCase() === "GUEST") {
          all = all.filter((u) => (!u.email || u.email.trim() === "") && (u.id?.startsWith("usr_") || u.id?.startsWith("guest_") || u.id === "anonymous" || u.login?.startsWith("usr_") || u.login?.startsWith("guest_")));
        } else if (role) {
          all = all.filter((u) => (u.role || (u.isAdmin ? "ADMIN" : "USER")) === String(role).toUpperCase());
        }
        if (tier) {
          all = all.filter((u) => String(u.subscriptionTier || "free").toLowerCase() === String(tier).toLowerCase());
        }
        if (status === "revoked") {
          all = all.filter((u) => Boolean(u.isRevoked || u.is_revoked));
        } else if (status === "active") {
          all = all.filter((u) => !Boolean(u.isRevoked || u.is_revoked));
        }
        count = all.length;
        sanitizedUsers = all.slice(offset, offset + limitNum).map((u) => sanitizeAdminUser(u));
      }

      res.status(200).json({
        success: true,
        total: count,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(count / limitNum),
        users: sanitizedUsers,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur récupération utilisateurs: ${message}` });
    }
  }

  public static async revokeUser(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { is_revoked, isRevoked } = req.body || {};
      const shouldRevoke = Boolean(is_revoked !== undefined ? is_revoked : isRevoked);

      const targetId = String(id).trim();
      const currentAdmin = (req as any).adminUser;

      // Sécurité : interdire à un administrateur de se révoquer lui-même
      if (currentAdmin && (currentAdmin.id === targetId || currentAdmin.login?.toLowerCase() === targetId.toLowerCase())) {
        res.status(400).json({
          success: false,
          message: "Action interdite : vous ne pouvez pas révoquer votre propre compte administrateur.",
        });
        return;
      }

      let user: any = null;
      try {
        user = await Users.findByPk(targetId);
        if (!user) {
          user = await Users.findOne({ where: { login: targetId } });
        }
      } catch {}
      if (!user) {
        user = await userStore.findUser(targetId);
      }

      if (!user) {
        res.status(404).json({ success: false, message: "Utilisateur introuvable." });
        return;
      }

      try {
        if (typeof user.update === "function") {
          await user.update({ isRevoked: shouldRevoke });
        }
      } catch {}
      const targetUserId = String(user.id || (typeof user.get === "function" ? user.get("id") : targetId));
      await userStore.updateUser(targetUserId, { isRevoked: shouldRevoke });

      if (shouldRevoke) {
        // Déconnexion immédiate de toutes les sockets actives de cet utilisateur
        const uid = typeof user.get === "function" ? (user.get("id") as string) : user.id;
        const ulogin = typeof user.get === "function" ? (user.get("login") as string) : user.login;
        socketGateway.disconnectUser(uid);
        if (ulogin) {
          socketGateway.disconnectUser(ulogin);
        }
      }

      const displayLogin = typeof user.get === "function" ? (user.get("login") || user.get("id")) : (user.login || user.id);
      res.status(200).json({
        success: true,
        message: shouldRevoke
          ? `L'accès de l'utilisateur ${displayLogin} a été révoqué.`
          : `L'accès de l'utilisateur ${displayLogin} a été rétabli.`,
        user: sanitizeAdminUser(user),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur révocation utilisateur: ${message}` });
    }
  }

  public static async resetUserPassword(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { newPassword, password } = req.body || {};
      const cleanPassword = String(newPassword || password || "").trim();

      if (!cleanPassword || cleanPassword.length < 4) {
        res.status(400).json({
          success: false,
          message: "Le nouveau mot de passe doit comporter au moins 4 caractères.",
        });
        return;
      }

      const targetId = String(id).trim();
      let user: any = null;
      try {
        user = await Users.findByPk(targetId);
        if (!user) {
          user = await Users.findOne({ where: { login: targetId } });
        }
      } catch {}
      if (!user) {
        user = await userStore.findUser(targetId);
      }

      if (!user) {
        res.status(404).json({ success: false, message: "Utilisateur introuvable." });
        return;
      }

      const { hash, salt } = hashPassword(cleanPassword);
      try {
        if (typeof user.update === "function") {
          await user.update({ passwordHash: hash, passwordSalt: salt });
        }
      } catch {}
      const targetUserId = String(user.id || (typeof user.get === "function" ? user.get("id") : targetId));
      await userStore.updateUser(targetUserId, { passwordHash: hash, passwordSalt: salt });

      const displayLogin = typeof user.get === "function" ? (user.get("login") || user.get("id")) : (user.login || user.id);
      res.status(200).json({
        success: true,
        message: `Mot de passe de l'utilisateur ${displayLogin} réinitialisé avec succès.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur réinitialisation mot de passe: ${message}` });
    }
  }

  public static async updateUserRole(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { role } = req.body || {};
      const cleanRole = String(role || "").trim().toUpperCase();

      if (!["ADMIN", "USER"].includes(cleanRole)) {
        res.status(400).json({ success: false, message: "Le rôle doit être soit 'ADMIN', soit 'USER'." });
        return;
      }

      const targetId = String(id).trim();
      let user: any = null;
      try {
        user = await Users.findByPk(targetId);
        if (!user) {
          user = await Users.findOne({ where: { login: targetId } });
        }
      } catch {}
      if (!user) {
        user = await userStore.findUser(targetId);
      }

      if (!user) {
        res.status(404).json({ success: false, message: "Utilisateur introuvable." });
        return;
      }

      const targetUserId = String(user.id || (typeof user.get === "function" ? user.get("id") : targetId));
      const userLogin = String(user.login || (typeof user.get === "function" ? user.get("login") : targetId));
      const isAdminFlag = cleanRole === "ADMIN";

      // Si on retire le rôle ADMIN, s'assurer qu'il reste au moins un autre administrateur actif
      if (cleanRole === "USER") {
        let activeAdminsCount = 0;
        try {
          const dbCount = await Users.count({
            where: {
              role: "ADMIN",
              isRevoked: false,
              id: { [Op.ne]: targetUserId } as any,
            } as any,
          });
          activeAdminsCount = Number(dbCount);
        } catch {
          const allUsers = await userStore.getAllUsers();
          const otherAdmins = allUsers.filter(
            (u) =>
              (u.id !== targetUserId && u.login !== targetUserId) &&
              (u.role === "ADMIN" || u.isAdmin) &&
              !Boolean(u.isRevoked || (u as any).is_revoked)
          );
          activeAdminsCount = otherAdmins.length;
        }

        if (activeAdminsCount < 1) {
          res.status(400).json({
            success: false,
            message: "Impossible de retirer le rôle ADMIN au dernier administrateur actif de la plateforme.",
          });
          return;
        }
      }

      try {
        if (typeof user.update === "function") {
          await user.update({
            role: cleanRole,
            isAdmin: isAdminFlag,
          });
        }
      } catch {}

      // Double-sauvegarde SQL directe pour garantir l'écriture en base
      try {
        await db.sequelize.query(
          `UPDATE rower_race_users 
           SET role = :role, 
               is_admin = :isAdmin 
           WHERE id = :id OR login = :id`,
          {
            replacements: { role: cleanRole, isAdmin: isAdminFlag, id: targetUserId }
          }
        );
      } catch {}

      await userStore.updateUser(targetUserId, {
        role: cleanRole,
        isAdmin: isAdminFlag,
      });
      if (userLogin && userLogin !== targetUserId) {
        await userStore.updateUser(userLogin, {
          role: cleanRole,
          isAdmin: isAdminFlag,
        });
      }

      const displayLogin = typeof user.get === "function" ? (user.get("login") || user.get("id")) : (user.login || user.id);
      res.status(200).json({
        success: true,
        message: `Rôle mis à jour (${cleanRole}) pour ${displayLogin}.`,
        user: sanitizeAdminUser({ ...user, role: cleanRole, isAdmin: isAdminFlag }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur mise à jour rôle: ${message}` });
    }
  }

  public static async updateUserPlan(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { subscriptionTier, plan, tier } = req.body || {};
      const cleanTier = String(subscriptionTier || plan || tier || "").trim().toLowerCase();

      if (!cleanTier) {
        res.status(400).json({ success: false, message: "Offre d'abonnement requise." });
        return;
      }

      const targetId = String(id).trim();
      let user: any = null;
      try {
        user = await Users.findByPk(targetId);
        if (!user) {
          user = await Users.findOne({ where: { login: targetId } });
        }
      } catch {}
      if (!user) {
        user = await userStore.findUser(targetId);
      }

      if (!user) {
        res.status(404).json({ success: false, message: "Utilisateur introuvable." });
        return;
      }

      const targetUserId = String(user.id || (typeof user.get === "function" ? user.get("id") : targetId));
      const userLogin = String(user.login || (typeof user.get === "function" ? user.get("login") : targetId));
      const isSub = cleanTier !== "free";
      const status = isSub ? "active" : "none";

      try {
        if (typeof user.update === "function") {
          await user.update({
            subscriptionTier: cleanTier as any,
            isSubscriber: isSub,
            subscriptionStatus: status,
          });
        }
      } catch {}

      // Double-sauvegarde SQL directe pour garantir l'écriture en base
      try {
        await db.sequelize.query(
          `UPDATE rower_race_users 
           SET subscription_tier = :tier, 
               is_subscriber = :isSub, 
               subscription_status = :status 
           WHERE id = :id OR login = :id`,
          {
            replacements: { tier: cleanTier, isSub, status, id: targetUserId }
          }
        );
      } catch {}

      await userStore.updateUser(targetUserId, {
        subscriptionTier: cleanTier as any,
        isSubscriber: isSub,
        subscriptionStatus: status,
      });
      if (userLogin && userLogin !== targetUserId) {
        await userStore.updateUser(userLogin, {
          subscriptionTier: cleanTier as any,
          isSubscriber: isSub,
          subscriptionStatus: status,
        });
      }

      const displayLogin = typeof user.get === "function" ? (user.get("login") || user.get("id")) : (user.login || user.id);
      res.status(200).json({
        success: true,
        message: `Offre d'abonnement modifiée vers '${cleanTier}' pour ${displayLogin}.`,
        user: sanitizeAdminUser({ ...user, subscriptionTier: cleanTier, isSubscriber: isSub, subscriptionStatus: status }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur modification offre: ${message}` });
    }
  }

  public static async updateUserRoomQuotas(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { customConcurrentRooms, customWeeklyRooms } = req.body || {};

      const targetId = String(id).trim();
      let user: any = null;
      try {
        user = await Users.findByPk(targetId);
        if (!user) {
          user = await Users.findOne({ where: { login: targetId } });
        }
      } catch {}
      if (!user) {
        user = await userStore.findUser(targetId);
      }

      if (!user) {
        res.status(404).json({ success: false, message: "Utilisateur introuvable." });
        return;
      }

      const targetUserId = String(user.id || (typeof user.get === "function" ? user.get("id") : targetId));
      const userLogin = String(user.login || (typeof user.get === "function" ? user.get("login") : targetId));

      const parsedConcurrent = (customConcurrentRooms === null || customConcurrentRooms === undefined || customConcurrentRooms === "")
        ? null
        : Math.max(0, parseInt(String(customConcurrentRooms), 10));

      const parsedWeekly = (customWeeklyRooms === null || customWeeklyRooms === undefined || customWeeklyRooms === "")
        ? null
        : Math.max(0, parseInt(String(customWeeklyRooms), 10));

      const updates: any = {
        customConcurrentRooms: Number.isFinite(parsedConcurrent as any) ? parsedConcurrent : null,
        customWeeklyRooms: Number.isFinite(parsedWeekly as any) ? parsedWeekly : null,
      };

      try {
        if (typeof user.update === "function") {
          await user.update(updates);
        }
      } catch {}

      try {
        await db.sequelize.query(
          `UPDATE rower_race_users 
           SET custom_concurrent_rooms = :concurrent, 
               custom_weekly_rooms = :weekly 
           WHERE id = :id OR login = :id`,
          {
            replacements: {
              concurrent: updates.customConcurrentRooms,
              weekly: updates.customWeeklyRooms,
              id: targetUserId,
            },
          }
        );
      } catch {}

      await userStore.updateUser(targetUserId, updates);
      if (userLogin && userLogin !== targetUserId) {
        await userStore.updateUser(userLogin, updates);
      }

      const displayLogin = typeof user.get === "function" ? (user.get("login") || user.get("id")) : (user.login || user.id);
      res.status(200).json({
        success: true,
        message: `Quotas de salons mis à jour pour ${displayLogin}.`,
        user: sanitizeAdminUser({
          ...user,
          ...updates,
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur modification quotas salons: ${message}` });
    }
  }

  public static async getUserDetails(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const targetId = String(id).trim();

      let user: any = null;
      try {
        user = await Users.findByPk(targetId);
        if (!user) {
          user = await Users.findOne({ where: { login: targetId } });
        }
      } catch {}
      if (!user) {
        user = await userStore.findUser(targetId);
      }

      if (!user) {
        res.status(404).json({ success: false, message: "Utilisateur introuvable." });
        return;
      }

      const sanitized = sanitizeAdminUser(user);
      const uid = String(user.id || targetId);
      const ulogin = String(user.login || "");

      // Comptage activités
      let activitiesCount = 0;
      try {
        if (Activities) {
          activitiesCount = await Activities.count({
            where: {
              [Op.or]: [{ userId: uid }, ...(ulogin ? [{ userId: ulogin }] : [])],
            },
          });
        }
      } catch {
        activitiesCount = sanitized.totalRaces || 0;
      }

      // Salons actifs hébergés par cet utilisateur
      const activeRooms = raceManager.getAllActivePrivateRaces().filter(
        (r) => r.hostUserId === uid || r.hostUserId === ulogin || r.originalHostUserId === uid || r.originalHostUserId === ulogin
      );

      // Informations d'appairage montre Garmin
      let pairingInfo: any = null;
      try {
        if (Pairings) {
          const p = await Pairings.findOne({
            where: {
              [Op.or]: [{ userId: uid }, ...(ulogin ? [{ userId: ulogin }] : [])],
            },
          });
          if (p) pairingInfo = typeof p.toJSON === "function" ? p.toJSON() : p;
        }
      } catch {}

      res.status(200).json({
        success: true,
        user: {
          ...sanitized,
          activitiesCount,
          activeRoomsCount: activeRooms.length,
          pairingInfo: pairingInfo ? {
            deviceToken: pairingInfo.deviceToken,
            watchUserId: pairingInfo.watchUserId,
            model: pairingInfo.model,
            pairedAt: pairingInfo.createdAt,
          } : null,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur récupération détails utilisateur: ${message}` });
    }
  }

  public static async deleteUser(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const targetId = String(id).trim();
      const currentAdmin = (req as any).adminUser;

      // Sécurité : interdire à un administrateur de se supprimer lui-même
      if (currentAdmin && (currentAdmin.id === targetId || currentAdmin.login?.toLowerCase() === targetId.toLowerCase())) {
        res.status(400).json({
          success: false,
          message: "Action interdite : vous ne pouvez pas supprimer votre propre compte administrateur.",
        });
        return;
      }

      let user: any = null;
      try {
        user = await Users.findByPk(targetId);
        if (!user) {
          user = await Users.findOne({ where: { login: targetId } });
        }
      } catch {}
      if (!user) {
        user = await userStore.findUser(targetId);
      }

      if (!user) {
        res.status(404).json({ success: false, message: "Utilisateur introuvable." });
        return;
      }

      const targetUserId = String(user.id || (typeof user.get === "function" ? user.get("id") : targetId));
      const targetLogin = String(user.login || (typeof user.get === "function" ? user.get("login") : targetId));
      const targetRole = String(user.role || (user.isAdmin ? "ADMIN" : "USER")).toUpperCase();

      if (isEmmaAdminUser(targetUserId, user.name) || isEmmaAdminUser(targetLogin, user.name)) {
        res.status(400).json({
          success: false,
          message: "Action interdite : le compte d'administration principal ne peut pas être supprimé.",
        });
        return;
      }

      // Si on supprime un compte ADMIN, s'assurer qu'il reste au moins un autre administrateur actif
      if (targetRole === "ADMIN") {
        let activeAdminsCount = 0;
        try {
          const dbCount = await Users.count({
            where: {
              role: "ADMIN",
              isRevoked: false,
              id: { [Op.ne]: targetUserId } as any,
            } as any,
          });
          activeAdminsCount = Number(dbCount);
        } catch {
          const allUsers = await userStore.getAllUsers();
          const otherAdmins = allUsers.filter(
            (u) =>
              u.id !== targetUserId &&
              u.login !== targetUserId &&
              (u.role === "ADMIN" || u.isAdmin) &&
              !Boolean(u.isRevoked || (u as any).is_revoked)
          );
          activeAdminsCount = otherAdmins.length;
        }

        if (activeAdminsCount < 1) {
          res.status(400).json({
            success: false,
            message: "Impossible de supprimer le dernier administrateur actif de la plateforme.",
          });
          return;
        }
      }

      // Nettoyage en cascade 1 : Fermer les salons actifs créés par cet utilisateur
      const allActiveRooms = raceManager.getAllActivePrivateRaces();
      for (const room of allActiveRooms) {
        if (
          room.hostUserId === targetUserId ||
          room.hostUserId === targetLogin ||
          room.originalHostUserId === targetUserId ||
          room.originalHostUserId === targetLogin
        ) {
          try {
            raceManager.closePrivateRace(room.code || room.id, undefined, true);
          } catch {}
        }
      }

      // Nettoyage en cascade 2 : Déconnexion immédiate de toutes les sockets actives
      socketGateway.disconnectUser(targetUserId);
      if (targetLogin && targetLogin !== targetUserId) {
        socketGateway.disconnectUser(targetLogin);
      }

      // Nettoyage en cascade 3 : Suppression des appairages montre
      try {
        if (Pairings) {
          await Pairings.destroy({
            where: {
              [Op.or]: [
                { userId: targetUserId },
                ...(targetLogin ? [{ userId: targetLogin }] : []),
              ],
            },
          });
        }
      } catch {}

      // Nettoyage en cascade 4 : Suppression des duels en attente
      try {
        if (DuelChallenges) {
          await DuelChallenges.destroy({
            where: {
              [Op.or]: [
                { challengerUserId: targetUserId },
                { challengedUserId: targetUserId },
                ...(targetLogin ? [{ challengerLogin: targetLogin }, { challengedLogin: targetLogin }] : []),
              ],
            },
          });
        }
      } catch {}

      // Nettoyage en cascade 5 : Suppression du compte en base et store mémoire
      try {
        await userStore.deleteUser(targetUserId);
        if (targetLogin && targetLogin !== targetUserId) {
          await userStore.deleteUser(targetLogin);
        }
      } catch {}

      try {
        await Users.destroy({
          where: {
            [Op.or]: [
              { id: targetUserId },
              ...(targetLogin ? [{ login: targetLogin }] : []),
            ],
          },
        });
      } catch {}

      res.status(200).json({
        success: true,
        message: `L'utilisateur ${targetLogin || targetUserId} a été définitivement supprimé.`,
        deletedUserId: targetUserId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur suppression utilisateur: ${message}` });
    }
  }

  /**
   * POST /api/admin/users/purge-anonymous
   * Purge en masse les comptes invités / anonymes orphelins (sans email, sans mot de passe, non admin).
   * Par défaut, ne supprime que les comptes n'ayant jamais terminé de course (totalRaces = 0).
   * Si includeWithRaces === true, supprime tous les comptes invités orphelins.
   */
  public static async purgeAnonymousUsers(req: Request, res: Response): Promise<void> {
    try {
      const { includeWithRaces = false } = req.body || {};
      const deletedCount = await userStore.purgeAnonymousGuests(Boolean(includeWithRaces));

      res.status(200).json({
        success: true,
        message: `${deletedCount} utilisateur(s) invité(s) purgé(s) avec succès.`,
        purgedCount: deletedCount,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: "Erreur purge utilisateurs anonymes: " + message });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Gestion des Salons (Privés & Historiques)
  // ---------------------------------------------------------------------------

  public static async getActiveRooms(_req: Request, res: Response): Promise<void> {
    try {
      const races = raceManager.getAllActivePrivateRaces();
      const serialized = races.map((r) => {
        const participantsList = r.participants
          ? Array.from(r.participants.values()).map((p) => {
              const isBot = Boolean(p.userId.startsWith("bot_") || p.userName?.toLowerCase().startsWith("bot"));
              return {
                userId: p.userId,
                userName: p.guestName || p.userName || p.userId,
                lane: p.lane,
                isBot,
                ready: Boolean(p.ready),
                connectionState: p.connectionState,
              };
            })
          : [];

        const botsCount = participantsList.filter((p) => p.isBot).length;
        const humansCount = participantsList.filter((p) => !p.isBot).length;

        return {
          id: r.id,
          code: r.code,
          pin: r.pinCode,
          title: r.title,
          status: r.status,
          hostUserId: r.hostUserId,
          hostUserName: r.hostUserName,
          targetDistance: r.targetDistance,
          maxParticipants: r.maxParticipants,
          gameMode: r.gameMode || "multi",
          startMode: r.startMode,
          scheduledStartTime: r.scheduledStartTime,
          participantsCount: participantsList.length,
          humansCount,
          botsCount,
          participants: participantsList,
          createdAt: r.createdAt,
          startedAt: r.startedAt,
        };
      });

      res.status(200).json({
        success: true,
        total: serialized.length,
        rooms: serialized,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur récupération salons actifs: ${message}` });
    }
  }

  public static async terminateRoom(req: Request, res: Response): Promise<void> {
    try {
      const { code } = req.params;
      const targetCode = String(code || "").trim();

      if (!targetCode) {
        res.status(400).json({ success: false, message: "Code ou identifiant de salon requis." });
        return;
      }

      const result = raceManager.closePrivateRace(targetCode, undefined, true);
      if ("error" in result) {
        res.status(result.statusCode || 400).json({ success: false, message: result.error });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Le salon '${targetCode}' a été clôturé avec succès par l'administrateur.`,
        raceId: result.raceId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur fermeture salon: ${message}` });
    }
  }

  public static async purgeInactiveRooms(_req: Request, res: Response): Promise<void> {
    try {
      const purgedCount = raceManager.purgeInactivePrivateRaces(30);
      res.status(200).json({
        success: true,
        message: `${purgedCount} salon(s) inactif(s) ou orphelin(s) purgé(s) avec succès.`,
        purgedCount,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur purge des salons: ${message}` });
    }
  }

  public static async getRoomsHistory(req: Request, res: Response): Promise<void> {
    try {
      const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || 30), 10)));
      let history: any[] = [];
      try {
        if (Races) {
          history = await Races.findAll({
            where: {
              [Op.or]: [
                { id: { [Op.like]: "PRIV_%" } },
                { hostUserId: { [Op.ne]: null } as any },
              ],
            },
            order: [["createdAt", "DESC"]],
            limit,
          });
        }
      } catch {}

      res.status(200).json({
        success: true,
        rooms: history.map((h) => (typeof h.toJSON === "function" ? h.toJSON() : h)),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur historique des salons: ${message}` });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Supervision Globale & Système
  // ---------------------------------------------------------------------------

  public static async getSystemMetrics(_req: Request, res: Response): Promise<void> {
    try {
      const mem = process.memoryUsage();
      const onlineUsersList = socketGateway.getOnlineUsers();
      const activeRooms = raceManager.getAllActivePrivateRaces();

      let dbConnected = true;
      try {
        await db.sequelize.authenticate();
      } catch {
        dbConnected = false;
      }

      res.status(200).json({
        success: true,
        metrics: {
          uptimeSeconds: Math.round(process.uptime()),
          nodeVersion: process.version,
          dbStatus: dbConnected ? "connected" : "offline_fallback",
          memory: {
            heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
            rssMb: Math.round(mem.rss / 1024 / 1024),
          },
          sockets: {
            connectedSockets: socketGateway.getConnectedSocketsCount(),
            onlineUsersCount: socketGateway.getOnlineUsersCount(),
            onlineUsers: onlineUsersList,
          },
          rooms: {
            activePrivateRoomsCount: activeRooms.length,
            isPublicRaceEnabled: raceManager.isPublicRaceEnabled,
            currentPublicRaceId: raceManager.getCurrentPublicRace()?.id || null,
            currentPublicRaceStatus: raceManager.getCurrentPublicRace()?.status || (raceManager.isPublicRaceEnabled ? "LOBBY" : "SUSPENDED"),
          },
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur métriques système: ${message}` });
    }
  }

  public static async triggerLeagueCycle(_req: Request, res: Response): Promise<void> {
    try {
      await ensureCurrentWeek();
      res.status(200).json({
        success: true,
        message: "Cycle hebdomadaire des ligues vérifié et synchronisé avec succès.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur synchronisation ligues: ${message}` });
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Gestion des Offres & Quotas
  // ---------------------------------------------------------------------------

  public static async getPlans(_req: Request, res: Response): Promise<void> {
    try {
      let plansList: any[] = [];
      try {
        const plans = await SubscriptionPlans.findAll({ order: [["priceMonthly", "ASC"]] });
        plansList = plans.map((p) => (typeof p.toJSON === "function" ? p.toJSON() : p));
      } catch {
        plansList = await subscriptionPlanService.loadAllPlans();
      }

      res.status(200).json({
        success: true,
        plans: plansList,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur récupération offres: ${message}` });
    }
  }

  public static async createPlan(req: Request, res: Response): Promise<void> {
    try {
      const {
        code,
        name,
        description,
        priceMonthly,
        priceYearly,
        maxBotsPerRace,
        maxRaceDistanceM,
        maxPlayersPerRoom,
        maxConcurrentRooms,
        maxRoomsPerWeek,
        canCreateDuel1v1,
        canScheduleRaces,
        isActive,
      } = req.body || {};

      const cleanCode = String(code || "").trim().toUpperCase();
      const cleanName = String(name || "").trim();

      if (!cleanCode || !cleanName) {
        res.status(400).json({ success: false, message: "Le code et le nom de l'offre sont obligatoires." });
        return;
      }

      const existing = await SubscriptionPlans.findOne({ where: { code: cleanCode } });
      if (existing) {
        res.status(409).json({ success: false, message: `Une offre avec le code '${cleanCode}' existe déjà.` });
        return;
      }

      const plan = await SubscriptionPlans.create({
        code: cleanCode,
        name: cleanName,
        description: description ? String(description).trim() : "",
        priceMonthly: Number(priceMonthly) || 0,
        priceYearly: Number(priceYearly) || 0,
        maxBotsPerRace: Number(maxBotsPerRace) || 1,
        maxRaceDistanceM: Number(maxRaceDistanceM) || 2000,
        maxPlayersPerRoom: Number(maxPlayersPerRoom) || 2,
        maxConcurrentRooms: Number(maxConcurrentRooms) || 1,
        maxRoomsPerWeek: Number(maxRoomsPerWeek) || 5,
        canCreateDuel1v1: canCreateDuel1v1 !== undefined ? Boolean(canCreateDuel1v1) : true,
        canScheduleRaces: canScheduleRaces !== undefined ? Boolean(canScheduleRaces) : false,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      });

      subscriptionPlanService.invalidateCache();

      res.status(201).json({
        success: true,
        message: `Offre '${cleanName}' créée avec succès.`,
        plan: plan.toJSON(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur création offre: ${message}` });
    }
  }

  public static async updatePlan(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const updates = { ...req.body };
      delete updates.id;

      const plan = await SubscriptionPlans.findByPk(id);
      if (!plan) {
        res.status(404).json({ success: false, message: "Offre introuvable." });
        return;
      }

      await plan.update(updates);
      subscriptionPlanService.invalidateCache();

      res.status(200).json({
        success: true,
        message: `Offre '${plan.get("name")}' mise à jour avec succès.`,
        plan: plan.toJSON(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur mise à jour offre: ${message}` });
    }
  }

  public static async deletePlan(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const plan = await SubscriptionPlans.findByPk(id);
      if (!plan) {
        res.status(404).json({ success: false, message: "Offre introuvable." });
        return;
      }

      // Désactivation de l'offre pour préserver les utilisateurs existants
      await plan.update({ isActive: false });
      subscriptionPlanService.invalidateCache();

      res.status(200).json({
        success: true,
        message: `Offre '${plan.get("name")}' désactivée avec succès.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur suppression offre: ${message}` });
    }
  }

  public static async togglePlan(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { isActive } = req.body || {};
      const cleanCode = (id || "").trim().toUpperCase();

      let plan: any = null;
      try {
        if (/^\d+$/.test(id)) {
          plan = await SubscriptionPlans.findByPk(Number(id));
        }
        if (!plan) {
          plan = await SubscriptionPlans.findOne({
            where: { code: cleanCode }
          });
        }
      } catch {
        // Fallback en mémoire si la base SQL n'est pas connectée (mode test/CI)
      }

      let newActive = false;
      let planName = cleanCode;
      let planJson: any = null;

      if (plan) {
        const currentActive = Boolean(plan.get("isActive") ?? plan.get("is_active") ?? true);
        newActive = isActive !== undefined ? Boolean(isActive) : !currentActive;
        await plan.update({ isActive: newActive });
        planName = plan.get("name") || cleanCode;
        planJson = typeof plan.toJSON === "function" ? plan.toJSON() : plan;
        await subscriptionPlanService.setPlanActive(cleanCode, newActive);
      } else {
        newActive = await subscriptionPlanService.setPlanActive(cleanCode, isActive);
        planName = cleanCode === "STANDARD" ? "Offre Club" : (cleanCode === "PREMIUM" ? "Offre Élite Pro" : cleanCode);
        planJson = { code: cleanCode, name: planName, isActive: newActive };
      }

      subscriptionPlanService.invalidateCache();

      res.status(200).json({
        success: true,
        message: `Offre '${planName}' ${newActive ? "activée" : "désactivée"} avec succès.`,
        plan: planJson,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur bascule offre: ${message}` });
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Statistiques & Analyse de la Plateforme (Jour, Semaine, Mois)
  // ---------------------------------------------------------------------------

  public static async getPlatformStats(req: Request, res: Response): Promise<void> {
    try {
      const period = String(req.query.period || "day").toLowerCase(); // 'day' | 'week' | 'month'
      const requestedLimit = parseInt(String(req.query.limit || ""), 10);
      const defaultLimit = period === "month" ? 12 : (period === "week" ? 12 : 30);
      const limit = Math.max(1, Math.min(90, isNaN(requestedLimit) ? defaultLimit : requestedLimit));

      // 1. Récupération des données en base avec fallback mémoire
      let allUsers: any[] = [];
      try {
        if (Users) {
          allUsers = await Users.findAll();
        }
      } catch {}
      if (!allUsers || allUsers.length === 0) {
        allUsers = await userStore.getAllUsers();
      }

      let allRaces: any[] = [];
      try {
        if (Races) {
          allRaces = await Races.findAll();
        }
      } catch {}

      let allDuels: any[] = [];
      try {
        if (DuelChallenges) {
          allDuels = await DuelChallenges.findAll();
        }
      } catch {}

      let allActivities: any[] = [];
      try {
        if (Activities) {
          allActivities = await Activities.findAll();
        }
      } catch {}

      // Normalisation des objets
      const usersList = allUsers.map((u) => (typeof u.toJSON === "function" ? u.toJSON() : u));
      const racesList = allRaces.map((r) => (typeof r.toJSON === "function" ? r.toJSON() : r));
      const duelsList = allDuels.map((d) => (typeof d.toJSON === "function" ? d.toJSON() : d));
      const activitiesList = allActivities.map((a) => (typeof a.toJSON === "function" ? a.toJSON() : a));

      // KPI Globaux
      const totalUsers = usersList.length;
      const activeUsers = usersList.filter((u) => !(u.isRevoked || u.is_revoked)).length;

      const freeCount = usersList.filter((u) => {
        const tier = (u.subscriptionTier || u.subscription_tier || "free").toLowerCase();
        return tier === "free";
      }).length;
      const intermediateCount = usersList.filter((u) => {
        const tier = (u.subscriptionTier || u.subscription_tier || "").toLowerCase();
        return tier === "intermediate" || tier === "club" || tier === "standard";
      }).length;
      const premiumCount = usersList.filter((u) => {
        const tier = (u.subscriptionTier || u.subscription_tier || "").toLowerCase();
        return tier === "premium" || tier === "pro" || tier === "elite_pro";
      }).length;
      const paidSubscribersCount = intermediateCount + premiumCount;
      const paidSubscribersRatio = totalUsers > 0 ? Math.round((paidSubscribersCount / totalUsers) * 1000) / 10 : 0;

      const publicRacesCount = racesList.filter((r) => !r.id?.startsWith("PRIV_") && !r.hostUserId).length;
      const privateRoomsCount = racesList.filter((r) => r.id?.startsWith("PRIV_") || r.hostUserId).length;
      const totalRacesCount = racesList.length;

      const totalDuelsCompleted = duelsList.filter((d) => (d.status || "").toUpperCase() === "COMPLETED").length;
      const totalDuelsTotal = duelsList.length;

      let totalDistanceMeters = 0;
      let totalParticipantsCount = 0;
      for (const act of activitiesList) {
        if (!act.isBot) {
          totalParticipantsCount++;
          const dist = Number(act.netDistance || act.currentDistance || act.targetDistance || 0);
          totalDistanceMeters += dist;
        }
      }
      const totalDistanceKm = Math.round(totalDistanceMeters / 1000);

      // 2. Découpage chronologique en tranches
      const now = new Date();
      interface Bucket {
        key: string;
        label: string;
        startDate: Date;
        endDate: Date;
        newUsers: number;
        newSubscribers: number;
        publicRaces: number;
        privateRooms: number;
        duelsCompleted: number;
        participants: number;
        distanceMeters: number;
        distanceKm: number;
      }

      const buckets: Bucket[] = [];

      if (period === "month") {
        for (let i = limit - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
          const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
          const yyyy = start.getFullYear();
          const mm = String(start.getMonth() + 1).padStart(2, "0");
          const key = `${yyyy}-${mm}`;
          const monthNames = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
          const label = `${monthNames[start.getMonth()]} ${yyyy}`;
          buckets.push({
            key,
            label,
            startDate: start,
            endDate: end,
            newUsers: 0,
            newSubscribers: 0,
            publicRaces: 0,
            privateRooms: 0,
            duelsCompleted: 0,
            participants: 0,
            distanceMeters: 0,
            distanceKm: 0,
          });
        }
      } else if (period === "week") {
        for (let i = limit - 1; i >= 0; i--) {
          const currentDay = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
          const dayOfWeek = currentDay.getDay();
          const diffToMonday = (dayOfWeek + 6) % 7;
          const start = new Date(currentDay);
          start.setDate(currentDay.getDate() - diffToMonday);
          start.setHours(0, 0, 0, 0);
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          end.setHours(23, 59, 59, 999);

          const startDayStr = String(start.getDate()).padStart(2, "0");
          const startMonthStr = String(start.getMonth() + 1).padStart(2, "0");
          const key = `${start.getFullYear()}-W${startMonthStr}-${startDayStr}`;
          const label = `Sem. ${startDayStr}/${startMonthStr}`;
          buckets.push({
            key,
            label,
            startDate: start,
            endDate: end,
            newUsers: 0,
            newSubscribers: 0,
            publicRaces: 0,
            privateRooms: 0,
            duelsCompleted: 0,
            participants: 0,
            distanceMeters: 0,
            distanceKm: 0,
          });
        }
      } else {
        // 'day'
        for (let i = limit - 1; i >= 0; i--) {
          const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
          const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
          const yyyy = start.getFullYear();
          const mm = String(start.getMonth() + 1).padStart(2, "0");
          const dd = String(d.getDate()).padStart(2, "0");
          const key = `${yyyy}-${mm}-${dd}`;
          const label = `${dd}/${mm}`;
          buckets.push({
            key,
            label,
            startDate: start,
            endDate: end,
            newUsers: 0,
            newSubscribers: 0,
            publicRaces: 0,
            privateRooms: 0,
            duelsCompleted: 0,
            participants: 0,
            distanceMeters: 0,
            distanceKm: 0,
          });
        }
      }

      function getBucket(dateVal: any): Bucket | undefined {
        if (!dateVal) return undefined;
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return undefined;
        return buckets.find((b) => d >= b.startDate && d <= b.endDate);
      }

      for (const u of usersList) {
        const b = getBucket(u.createdAt || u.created_at);
        if (b) {
          b.newUsers++;
          const tier = (u.subscriptionTier || u.subscription_tier || "free").toLowerCase();
          if (tier !== "free") {
            b.newSubscribers++;
          }
        }
      }

      for (const r of racesList) {
        const b = getBucket(r.createdAt || r.startTime);
        if (b) {
          if (r.id?.startsWith("PRIV_") || r.hostUserId) {
            b.privateRooms++;
          } else {
            b.publicRaces++;
          }
        }
      }

      for (const d of duelsList) {
        const b = getBucket(d.createdAt || d.slotStart);
        if (b) {
          if ((d.status || "").toUpperCase() === "COMPLETED") {
            b.duelsCompleted++;
          }
        }
      }

      for (const act of activitiesList) {
        const b = getBucket(act.createdAt || act.finishedAt);
        if (b) {
          if (!act.isBot) {
            b.participants++;
            const dist = Number(act.netDistance || act.currentDistance || act.targetDistance || 0);
            b.distanceMeters += dist;
          }
        }
      }

      for (const b of buckets) {
        b.distanceKm = Math.round(b.distanceMeters / 1000);
      }

      res.status(200).json({
        success: true,
        period,
        limit,
        global: {
          totalUsers,
          activeUsers,
          paidSubscribersCount,
          paidSubscribersRatio,
          subscribersBreakdown: {
            free: freeCount,
            intermediate: intermediateCount,
            premium: premiumCount,
          },
          totalRacesCount,
          publicRacesCount,
          privateRoomsCount,
          totalDuelsCompleted,
          totalDuelsTotal,
          totalParticipantsCount,
          totalDistanceMeters,
          totalDistanceKm,
        },
        timeline: buckets.map((b) => ({
          key: b.key,
          label: b.label,
          startDate: b.startDate.toISOString(),
          endDate: b.endDate.toISOString(),
          newUsers: b.newUsers,
          newSubscribers: b.newSubscribers,
          publicRaces: b.publicRaces,
          privateRooms: b.privateRooms,
          duelsCompleted: b.duelsCompleted,
          participants: b.participants,
          distanceMeters: b.distanceMeters,
          distanceKm: b.distanceKm,
        })),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur statistiques: ${message}` });
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Gestion de l'Anti-Triche & Mode Tests de Charge
  // ---------------------------------------------------------------------------
  public static async getAntiCheatStatus(_req: Request, res: Response): Promise<void> {
    try {
      const status = antiCheatService.getStatus();
      res.status(200).json({ success: true, ...status });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur statut anti-triche: ${message}` });
    }
  }

  public static async openLoadTest(req: Request, res: Response): Promise<void> {
    try {
      const durationMinutes = req.body?.durationMinutes !== undefined ? Number(req.body.durationMinutes) : 120;
      const customKey = req.body?.customKey ? String(req.body.customKey) : undefined;
      const status = antiCheatService.openLoadTest(durationMinutes, customKey);
      res.status(200).json({ success: true, message: `Mode tests de charge ouvert pour ${durationMinutes} minutes.`, ...status });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur ouverture test de charge: ${message}` });
    }
  }

  public static async closeLoadTest(_req: Request, res: Response): Promise<void> {
    try {
      const status = antiCheatService.closeLoadTest();
      res.status(200).json({ success: true, message: "Mode tests de charge fermé. Bouclier anti-triche réarmé.", ...status });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur fermeture test de charge: ${message}` });
    }
  }

  public static async toggleAntiCheat(req: Request, res: Response): Promise<void> {
    try {
      const enabled = Boolean(req.body?.enabled);
      const status = antiCheatService.toggleAntiCheat(enabled);
      res.status(200).json({
        success: true,
        message: enabled ? "Bouclier anti-triche activé avec succès." : "Bouclier anti-triche désactivé (mode permissif).",
        ...status
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur bascule anti-triche: ${message}` });
    }
  }

  public static async resetAntiCheatStats(_req: Request, res: Response): Promise<void> {
    try {
      const status = antiCheatService.resetStats();
      res.status(200).json({ success: true, message: "Statistiques et journal anti-triche réinitialisés.", ...status });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erreur réinitialisation anti-triche: ${message}` });
    }
  }
}

export default AdminController;
