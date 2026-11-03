import { Request, Response } from "express";
import { Op } from "sequelize";
import db from "../models";

const LoginRequests = db.loginRequests;
const Activities = db.activities;
const Users = db.users;

/**
 * POST /api/user/auth/request
 * Déclenché quand le joueur entre son login et son identifiant sur le front web.
 * Vérifie que la montre est active (activité récente).
 * Si oui, crée une demande d'autorisation pour la montre.
 */
export const requestWebLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, login } = req.body;

    if (!userId || !login) {
      res.status(400).json({ success: false, message: "userId et login requis" });
      return;
    }

    // Vérifier si la montre a lancé l'application (présence d'une activité au cours des 10 dernières minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const activeActivity = await Activities.findOne({
      where: {
        userId,
        updatedAt: { [Op.gte]: tenMinutesAgo },
      },
      order: [["updatedAt", "DESC"]],
    });

    if (!activeActivity) {
      res.status(403).json({
        success: false,
        error: "WATCH_NOT_CONNECTED",
        message: "L'application Garmin Rower Race doit être lancée sur votre montre pour vous connecter.",
      });
      return;
    }

    // Créer ou renouveler la demande d'authentification
    const requestId = `REQ_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const loginReq = await LoginRequests.create({
      id: requestId,
      userId,
      login,
      status: "pending",
      requestedAt: new Date(),
    });

    res.status(200).json({
      success: true,
      requestId: loginReq.get("id"),
      message: "Demande envoyée à votre montre. Veuillez accepter sur votre montre Garmin.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur demande login: " + message });
  }
};

/**
 * GET /api/user/auth/status/:requestId
 * Le front Angular consulte si la montre a accepté la connexion
 */
export const checkWebLoginStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const loginReq = await LoginRequests.findByPk(requestId);

    if (!loginReq) {
      res.status(404).json({ success: false, message: "Demande de connexion introuvable" });
      return;
    }

    res.status(200).json({
      success: true,
      status: loginReq.get("status"),
      userId: loginReq.get("userId"),
      login: loginReq.get("login"),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur statut login: " + message });
  }
};

/**
 * GET /api/user/auth/pending?userId=...
 * La montre Garmin consulte régulièrement s'il y a une demande de connexion du front web
 */
export const getPendingLoginRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.query;
    if (!userId) {
      res.status(400).json({ success: false, message: "userId requis" });
      return;
    }

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const pending = await LoginRequests.findOne({
      where: {
        userId: String(userId),
        status: "pending",
        requestedAt: { [Op.gte]: twoMinutesAgo },
      },
      order: [["requestedAt", "DESC"]],
    });

    if (!pending) {
      res.status(200).json({ hasPending: false });
      return;
    }

    res.status(200).json({
      hasPending: true,
      requestId: pending.get("id"),
      login: pending.get("login"),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur attente login: " + message });
  }
};

/**
 * POST /api/user/auth/respond
 * La montre Garmin accepte ou refuse la connexion
 */
export const respondLoginRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestId, approved } = req.body;
    const pending = await LoginRequests.findByPk(requestId);

    if (!pending) {
      res.status(404).json({ success: false, message: "Demande introuvable" });
      return;
    }

    await pending.update({
      status: approved ? "approved" : "rejected",
      respondedAt: new Date(),
    });

    if (approved) {
      const uId = String(pending.get("userId"));
      const uLogin = String(pending.get("login"));

      let user = await Users.findByPk(uId);
      if (!user) {
        await Users.create({
          id: uId,
          name: uLogin,
          totalRaces: 0,
          totalWins: 0,
          podiums: 0,
        });
      } else {
        await user.update({ name: uLogin });
      }
    }

    res.status(200).json({ success: true, status: pending.get("status") });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: "Erreur réponse login: " + message });
  }
};

/**
 * GET /api/user/profile/:userId
 * Retourne uniquement les classements et stats de courses, aucune donnée personnelle
 */
export const getUserProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    let user = await Users.findByPk(userId);

    if (!user) {
      user = await Users.create({
        id: userId,
        name: `Racer_${userId.slice(-4)}`,
        totalRaces: 0,
        totalWins: 0,
        podiums: 0,
      });
    }

    // Récupérer les classements passés
    const pastActivities = await Activities.findAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
      limit: 10,
      attributes: ["activityId", "targetDistance", "netDistance", "elapsedTime", "status", "finalRank", "createdAt"],
    });

    res.status(200).json({
      user,
      history: pastActivities,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ message: "Erreur profil: " + message });
  }
};

export default {
  requestWebLogin,
  checkWebLoginStatus,
  getPendingLoginRequest,
  respondLoginRequest,
  getUserProfile,
};
