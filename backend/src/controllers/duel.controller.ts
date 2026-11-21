import { Request, Response } from "express";
import duelService, { sanitizeDuelPreferences } from "../services/duel.service";
import userStore from "../services/user-store.service";

function resolveRequestUserId(req: Request): string {
  const authUser = (req as any).user;
  const fromAuth = authUser?.id || authUser?.login || authUser?.userId;
  const fromBody = req.body?.userId || req.body?.challengerId || req.body?.challengerUserId;
  const fromQuery = req.query?.userId;
  const fromParams = req.params?.userId;
  const fromHeader = req.headers["x-user-id"];
  return String(fromBody || fromQuery || fromParams || fromAuth || fromHeader || "").trim();
}

export class DuelController {
  /**
   * GET /api/duels/preferences/:userId
   */
  public static async getPreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) {
        res.status(400).json({ success: false, message: "Identifiant utilisateur requis." });
        return;
      }
      const user = await userStore.findUser(userId);
      if (!user) {
        res.status(404).json({ success: false, message: "Abonné introuvable." });
        return;
      }
      res.status(200).json({
        success: true,
        duelPreferences: sanitizeDuelPreferences(user.duelPreferences),
        stats: {
          duelsWon: user.duelsWon || 0,
          duelsLost: user.duelsLost || 0,
          duelsDrawn: user.duelsDrawn || 0,
          duelPoints: user.duelPoints || 0,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }

  /**
   * PUT /api/duels/preferences
   * PUT /api/user/duel-preferences
   */
  public static async updatePreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) {
        res.status(400).json({ success: false, message: "Identifiant utilisateur requis." });
        return;
      }
      const user = await userStore.findUser(userId);
      if (!user) {
        res.status(404).json({ success: false, message: "Abonné introuvable." });
        return;
      }

      const rawPrefs = req.body?.duelPreferences || req.body;
      const cleanPrefs = sanitizeDuelPreferences(rawPrefs);
      const updated = await userStore.updateUser(user.id, { duelPreferences: cleanPrefs });

      res.status(200).json({
        success: true,
        message: "Préférences de duel enregistrées avec succès.",
        duelPreferences: cleanPrefs,
        user: updated
          ? {
              id: updated.id,
              login: updated.login,
              name: updated.name,
              duelPreferences: cleanPrefs,
              duelsWon: updated.duelsWon || 0,
              duelsLost: updated.duelsLost || 0,
              duelsDrawn: updated.duelsDrawn || 0,
              duelPoints: updated.duelPoints || 0,
            }
          : undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }

  /**
   * GET /api/duels/available-players?slotStart=...&slotEnd=...&durationMinutes=60
   */
  public static async findAvailablePlayers(req: Request, res: Response): Promise<void> {
    try {
      const slotStart = String(req.query.slotStart || "").trim();
      const slotEnd = req.query.slotEnd ? String(req.query.slotEnd).trim() : undefined;
      const durationMinutes = req.query.durationMinutes ? Number(req.query.durationMinutes) : 60;
      const requesterId = resolveRequestUserId(req);

      if (!slotStart) {
        res.status(400).json({ success: false, message: "Le début du créneau (slotStart) est requis." });
        return;
      }

      const players = await duelService.findAvailablePlayersForSlot({
        slotStart,
        slotEnd,
        durationMinutes,
        requesterId: requesterId || undefined,
        league: req.query.league ? String(req.query.league) : undefined,
        country: req.query.country ? String(req.query.country) : undefined,
        gender: req.query.gender ? String(req.query.gender) : undefined,
        ageCategory: (req.query.category || req.query.ageCategory)
          ? String(req.query.category || req.query.ageCategory)
          : undefined,
      });

      res.status(200).json({
        success: true,
        count: players.length,
        players,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ success: false, message });
    }
  }

  /**
   * POST /api/duels/challenge
   */
  public static async createChallenge(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const authUser = (req as any).user;
      const challengerId = String(
        body.challengerId || body.challengerUserId || body.userId || authUser?.id || authUser?.login || ""
      ).trim();
      const challengedLoginOrId = String(
        body.challengedLogin || body.opponentLogin || body.challengedUserId || body.targetLogin || ""
      ).trim();

      if (!challengerId) {
        res.status(400).json({ success: false, message: "Identifiant de l'initiateur requis." });
        return;
      }
      if (!challengedLoginOrId) {
        res.status(400).json({ success: false, message: "Le login de l'abonné à défier est requis." });
        return;
      }
      if (!body.slotStart) {
        res.status(400).json({ success: false, message: "Le créneau horaire du duel (slotStart) est requis." });
        return;
      }

      const outcome = await duelService.createChallenge({
        challengerId,
        challengedLoginOrId,
        slotStart: body.slotStart,
        slotEnd: body.slotEnd,
        durationMinutes: body.durationMinutes ? Number(body.durationMinutes) : 60,
        targetDistance: body.targetDistance ? Number(body.targetDistance) : 2000,
        timezone: body.timezone ? String(body.timezone) : undefined,
        title: body.title ? String(body.title) : undefined,
      });

      if ("error" in outcome) {
        res.status(outcome.statusCode).json({ success: false, message: outcome.error, error: outcome.error });
        return;
      }

      res.status(201).json({
        success: true,
        message: "Défi envoyé avec succès ! Un e-mail a été transmis à votre adversaire.",
        challenge: outcome.challenge,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }

  /**
   * GET /api/duels/my-challenges?userId=...
   */
  public static async getMyChallenges(req: Request, res: Response): Promise<void> {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) {
        res.status(400).json({ success: false, message: "Identifiant utilisateur requis." });
        return;
      }

      const data = await duelService.getMyChallenges(userId);
      res.status(200).json({
        success: true,
        ...data,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }

  /**
   * POST /api/duels/:id/respond
   */
  public static async respondToChallenge(req: Request, res: Response): Promise<void> {
    try {
      const challengeId = String(req.params.id || "").trim();
      const body = req.body || {};
      const authUser = (req as any).user;
      const responderUserId = String(
        body.userId || body.responderId || authUser?.id || authUser?.login || ""
      ).trim();
      const rawAction = String(body.action || "").trim().toLowerCase();
      const action: "accept" | "refuse" | null =
        rawAction === "accept" || rawAction === "accepted"
          ? "accept"
          : rawAction === "refuse" || rawAction === "refused" || rawAction === "decline"
          ? "refuse"
          : null;

      if (!challengeId) {
        res.status(400).json({ success: false, message: "Identifiant du défi requis." });
        return;
      }
      if (!responderUserId) {
        res.status(400).json({ success: false, message: "Identifiant utilisateur requis." });
        return;
      }
      if (!action) {
        res.status(400).json({ success: false, message: "Action invalide ('accept' ou 'refuse' attendu)." });
        return;
      }

      const outcome = await duelService.respondToChallenge({
        challengeId,
        responderUserId,
        action,
      });

      if ("error" in outcome) {
        res.status(outcome.statusCode).json({ success: false, message: outcome.error, error: outcome.error });
        return;
      }

      res.status(200).json({
        success: true,
        message:
          action === "accept"
            ? "Défi accepté ! Le créneau est bloqué pour les deux joueurs et votre adversaire a été notifié."
            : "Défi refusé. Votre adversaire a été notifié.",
        challenge: outcome.challenge,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }

  /**
   * POST /api/duels/:id/cancel
   */
  public static async cancelChallenge(req: Request, res: Response): Promise<void> {
    try {
      const challengeId = String(req.params.id || "").trim();
      const body = req.body || {};
      const authUser = (req as any).user;
      const userId = String(body.userId || req.query.userId || authUser?.id || authUser?.login || "").trim();

      if (!challengeId) {
        res.status(400).json({ success: false, message: "Identifiant du défi requis." });
        return;
      }
      if (!userId) {
        res.status(400).json({ success: false, message: "Identifiant utilisateur requis." });
        return;
      }

      const outcome = await duelService.cancelChallenge({
        challengeId,
        userId,
      });

      if ("error" in outcome) {
        res.status(outcome.statusCode).json({ success: false, message: outcome.error, error: outcome.error });
        return;
      }

      res.status(200).json({
        success: true,
        isForfeit: outcome.isForfeit,
        message: outcome.isForfeit
          ? "Annulation tardive (< 24h) : forfait appliqué (-10 points). Le créneau est libéré et l'adversaire notifié."
          : "Duel annulé avec succès. Le créneau est libéré et votre adversaire a été notifié.",
        challenge: outcome.challenge,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }

  /**
   * POST /api/duels/:id/resolve
   */
  public static async resolveChallenge(req: Request, res: Response): Promise<void> {
    try {
      const challengeId = String(req.params.id || "").trim();
      const body = req.body || {};
      if (!challengeId) {
        res.status(400).json({ success: false, message: "Identifiant du défi requis." });
        return;
      }

      const outcome = await duelService.resolveChallenge({
        challengeId,
        winnerUserId: body.winnerUserId ? String(body.winnerUserId) : undefined,
        isDraw: Boolean(body.isDraw),
        forfeitUserId: body.forfeitUserId ? String(body.forfeitUserId) : undefined,
      });

      if ("error" in outcome) {
        res.status(outcome.statusCode).json({ success: false, message: outcome.error, error: outcome.error });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Résultat du duel enregistré et points mis à jour.",
        challenge: outcome.challenge,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }

  /**
   * GET /api/duels/leaderboard
   */
  public static async getDuelLeaderboard(req: Request, res: Response): Promise<void> {
    try {
      const players = await duelService.getDuelLeaderboard({
        category: req.query.category ? String(req.query.category) : undefined,
        ageCategory: req.query.ageCategory ? String(req.query.ageCategory) : undefined,
        league: req.query.league ? String(req.query.league) : undefined,
        country: req.query.country ? String(req.query.country) : undefined,
        gender: req.query.gender ? String(req.query.gender) : undefined,
        age: req.query.age !== undefined ? String(req.query.age) : undefined,
        minAge: req.query.minAge !== undefined ? String(req.query.minAge) : undefined,
        maxAge: req.query.maxAge !== undefined ? String(req.query.maxAge) : undefined,
        includeAll: req.query.includeAll === "true",
      });

      res.status(200).json({
        success: true,
        count: players.length,
        players,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message });
    }
  }
}

export default DuelController;
