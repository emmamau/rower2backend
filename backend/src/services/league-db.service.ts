import fs from "fs";
import path from "path";
import { QueryTypes } from "sequelize";
import db from "../models";

let sqlInitialized = false;

/**
 * Initialise le schéma des ligues hebdomadaires (types, tables, vue, fonction PL/pgSQL).
 * Idempotent et sans risque de perte de données.
 */
export async function initializeLeagueSchema(): Promise<void> {
  if (sqlInitialized) return;
  try {
    const candidatePaths = [
      path.resolve(__dirname, "../sql/leagues.sql"),
      path.resolve(__dirname, "../../src/sql/leagues.sql"),
      path.resolve(process.cwd(), "src/sql/leagues.sql"),
      path.resolve(process.cwd(), "backend/src/sql/leagues.sql"),
    ];

    let sqlPath = candidatePaths.find((p) => fs.existsSync(p));

    if (sqlPath) {
      const sqlContent = fs.readFileSync(sqlPath, "utf8");
      // Exécution séquentielle ou globale du script SQL
      await db.sequelize.query(sqlContent);
      console.log("[LeagueDB] PostgreSQL League lazy evaluation schema initialized successfully.");
      sqlInitialized = true;
    } else {
      console.warn(`[LeagueDB] SQL file not found in candidates: ${candidatePaths.join(", ")}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[LeagueDB] Schema initialization notice/warning: ${msg}`);
  }
}

/**
 * Compte le nombre de courses BOT déjà rémunérées aujourd'hui (Europe/Paris) pour un utilisateur
 */
export async function getTodayRewardedBotRaces(userId: string): Promise<number> {
  try {
    const res: any = await db.sequelize.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM rower_race_activities
       WHERE "userId" = :userId
         AND ("points_earned" > 0 OR "points" > 0)
         AND "isBot" = FALSE
         AND (UPPER("raceMode") = 'BOT' OR UPPER("raceMode") = 'SOLO')
         AND "finishedAt" >= (CURRENT_DATE AT TIME ZONE 'Europe/Paris')`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
      }
    );
    return res && res.length > 0 ? Number(res[0].count || 0) : 0;
  } catch {
    return 0;
  }
}

/**
 * Déclenche la fonction PL/pgSQL paresseuse ensure_current_week().
 * Coût quasi nul (< 1ms) si la semaine en cours est déjà active.
 */
export async function ensureCurrentWeek(): Promise<void> {
  try {
    await db.sequelize.query("SELECT ensure_current_week();", { type: QueryTypes.SELECT });
  } catch (err: unknown) {
    // Si la fonction n'est pas encore créée (ex: premier run ou tests sans DB réelle), on tente d'initialiser
    if (!sqlInitialized) {
      await initializeLeagueSchema();
      try {
        await db.sequelize.query("SELECT ensure_current_week();", { type: QueryTypes.SELECT });
      } catch {}
    }
  }
}
