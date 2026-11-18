import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";
import raceManager from "../services/race-manager.service";
import socketGateway from "../websocket/socket.gateway";
import { hashPassword } from "../services/auth.service";
import subscriptionPlanService from "../services/subscription-plan.service";
import userStore from "../services/user-store.service";

const Users = db.users;
const PublicRaceSettings = db.publicRaceSettings;
const SubscriptionPlans = db.subscriptionPlans;

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
        is_enabled,
        isEnabled,
      } = req.body || {};

      const updates: any = {};
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
      } catch {}

      res.status(200).json({
        success: true,
        message: "Paramètres des courses publiques mis à jour et appliqués dynamiquement à chaud.",
        settings: row && typeof row.toJSON === "function" ? row.toJSON() : { id: 1, ...updates },
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

      if (role) {
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
        if (role) {
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

  // ---------------------------------------------------------------------------
  // 3. Gestion des Offres & Quotas
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
}

export default AdminController;
