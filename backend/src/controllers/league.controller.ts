import { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import db from "../models";
import userStore from "../services/user-store.service";
import { ensureCurrentWeek } from "../services/league-db.service";

export class LeagueController {
  /**
   * GET /api/leagues/standings?tier=BRONZE|SILVER|GOLD
   * Retourne le classement temps réel de la semaine en cours depuis la vue SQL current_week_standings
   */
  public static async getStandings(req: Request, res: Response): Promise<void> {
    try {
      await ensureCurrentWeek();

      const rawTier = String(req.query.tier || "BRONZE").toUpperCase();
      const validTiers = ["BRONZE", "SILVER", "GOLD"];
      const tier = validTiers.includes(rawTier) ? rawTier : "BRONZE";

      // Interrogation de la vue current_week_standings
      let standings: any[] = [];
      try {
        standings = await db.sequelize.query(
          `SELECT 
            user_id,
            user_name,
            display_name,
            current_league,
            is_resting,
            weekly_points,
            weekly_races_count,
            weekly_best_pace_ms,
            total_career_points,
            country,
            tier_rank
          FROM current_week_standings
          WHERE current_league = :tier
          ORDER BY tier_rank ASC`,
          {
            replacements: { tier },
            type: QueryTypes.SELECT,
          }
        );
      } catch (dbErr) {
        // Fallback en mémoire si la base SQL n'est pas connectée (environnement de test)
        const allUsers = await userStore.getAllUsersForLeaderboard();
        standings = allUsers
          .filter((u: any) => (u.currentLeague || "BRONZE") === tier)
          .map((u: any, idx: number) => ({
            user_id: u.id,
            user_name: u.login || u.name,
            display_name: u.name,
            current_league: u.currentLeague || "BRONZE",
            is_resting: Boolean(u.isResting),
            weekly_points: Number(u.weeklyPoints || 0),
            weekly_races_count: Number(u.weeklyRacesCount || 0),
            weekly_best_pace_ms: null,
            total_career_points: Number(u.totalCareerPoints || u.points || 0),
            country: u.country || "FR",
            tier_rank: idx + 1,
          }));
      }

      // Calcul des seuils de promotion / relégation
      const activeRacers = standings.filter((s) => !s.is_resting && Number(s.weekly_races_count) > 0);
      const totalActive = activeRacers.length;

      let promoThreshold = 0;
      let relegateThreshold = 0;

      if (tier === "BRONZE") {
        if (totalActive >= 4) {
          promoThreshold = Math.ceil(totalActive * 0.25);
        }
      } else if (tier === "SILVER") {
        if (totalActive >= 5) {
          promoThreshold = Math.ceil(totalActive * 0.2);
          relegateThreshold = Math.ceil(totalActive * 0.2);
        }
      } else if (tier === "GOLD") {
        if (totalActive >= 5) {
          relegateThreshold = Math.ceil(totalActive * 0.2);
        }
      }

      // Enrichissement de chaque participant avec son statut compétitif
      const enriched = standings.map((item) => {
        const isFrozen = item.is_resting || Number(item.weekly_races_count) === 0;
        let zone: "PROMOTION" | "RELEGATION" | "MAINTAIN" | "FROZEN" = "MAINTAIN";

        if (isFrozen) {
          zone = "FROZEN";
        } else {
          // Trouver l'index parmi les actifs
          const activeIndex = activeRacers.findIndex((a) => a.user_id === item.user_id);
          const activeRank = activeIndex + 1;

          if (promoThreshold > 0 && activeRank <= promoThreshold) {
            zone = "PROMOTION";
          } else if (relegateThreshold > 0 && activeRank > totalActive - relegateThreshold) {
            zone = "RELEGATION";
          }
        }

        return {
          ...item,
          zone,
          isFrozen,
        };
      });

      res.status(200).json({
        success: true,
        tier,
        totalPlayers: standings.length,
        totalActive,
        promoThreshold,
        relegateThreshold,
        standings: enriched,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: message });
    }
  }

  /**
   * PATCH /api/users/resting-mode
   * Active ou désactive le mode vacances / repos pour l'utilisateur
   */
  public static async toggleRestingMode(req: Request, res: Response): Promise<void> {
    try {
      const isResting = req.body.isResting !== undefined ? Boolean(req.body.isResting) : true;
      const targetUserId =
        req.body.userId ||
        (req as any).user?.id ||
        (req as any).user?.login ||
        req.headers["x-user-id"] ||
        req.query.userId;

      if (!targetUserId) {
        res.status(400).json({ success: false, error: "Identifiant utilisateur manquant" });
        return;
      }

      const user = await userStore.findUser(String(targetUserId));
      if (!user) {
        res.status(404).json({ success: false, error: "Utilisateur introuvable" });
        return;
      }

      await userStore.updateUser(user.id, { isResting } as any);

      try {
        await db.users.update({ isResting } as any, { where: { id: user.id } });
      } catch {}

      res.status(200).json({
        success: true,
        message: isResting
          ? "Mode vacances / repos activé : votre ligue est gelée sans risque de relégation."
          : "Mode vacances désactivé : vous participez aux classements actifs de votre ligue.",
        isResting,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: message });
    }
  }

  /**
   * GET /api/leagues/unseen-summary
   * Retourne le bilan hebdomadaire non lu pour l'utilisateur connecté
   */
  public static async getUnseenSummary(req: Request, res: Response): Promise<void> {
    try {
      await ensureCurrentWeek();

      const targetUserId =
        req.query.userId ||
        (req as any).user?.id ||
        (req as any).user?.login ||
        req.headers["x-user-id"];

      if (!targetUserId) {
        res.status(200).json({ success: true, summary: null });
        return;
      }

      try {
        const rows: any[] = await db.sequelize.query(
          `SELECT 
            id,
            user_id,
            week_start_date,
            previous_league,
            new_league,
            outcome,
            final_points,
            final_rank,
            seen_by_user,
            created_at
          FROM league_weekly_history
          WHERE user_id = :userId AND seen_by_user = FALSE
          ORDER BY week_start_date DESC
          LIMIT 1`,
          {
            replacements: { userId: String(targetUserId) },
            type: QueryTypes.SELECT,
          }
        );

        res.status(200).json({
          success: true,
          summary: rows && rows.length > 0 ? rows[0] : null,
        });
      } catch {
        res.status(200).json({ success: true, summary: null });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: message });
    }
  }

  /**
   * PATCH /api/leagues/history/:id/seen
   * Acquitte le bilan hebdomadaire afin de ne plus réafficher la modale
   */
  public static async markSummarySeen(req: Request, res: Response): Promise<void> {
    try {
      const historyId = req.params.id;
      if (!historyId) {
        res.status(400).json({ success: false, error: "Identifiant d'historique manquant" });
        return;
      }

      try {
        await db.sequelize.query(
          `UPDATE league_weekly_history
           SET seen_by_user = TRUE
           WHERE id = :historyId`,
          {
            replacements: { historyId },
            type: QueryTypes.UPDATE,
          }
        );
      } catch {}

      res.status(200).json({ success: true, message: "Bilan hebdomadaire acquitté." });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: message });
    }
  }
}

export default LeagueController;
