-- Migration & Initialisation du système de Ligues Hebdomadaires et Points
-- Conforme Render.com Free Tier (PostgreSQL Lazy Evaluation)

-- 1. Types énumérés
DO $$ BEGIN
  CREATE TYPE league_tier AS ENUM ('BRONZE', 'SILVER', 'GOLD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE league_outcome AS ENUM ('PROMOTED', 'RELEGATED', 'MAINTAINED', 'FROZEN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Colonnes incrémentales sur rower_race_users
ALTER TABLE rower_race_users 
  ADD COLUMN IF NOT EXISTS current_league league_tier DEFAULT 'BRONZE',
  ADD COLUMN IF NOT EXISTS total_career_points INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_resting BOOLEAN DEFAULT FALSE;

-- Initialisation de total_career_points à partir de points existants si présent
UPDATE rower_race_users 
SET total_career_points = COALESCE(points, 0) 
WHERE total_career_points IS NULL OR (total_career_points = 0 AND COALESCE(points, 0) > 0);

-- 3. Colonnes incrémentales sur rower_race_activities
ALTER TABLE rower_race_activities 
  ADD COLUMN IF NOT EXISTS points_earned INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_dnf BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS total_human_finishers INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_pace_ms INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_activities_user_finished 
  ON rower_race_activities ("userId", "finishedAt" DESC);

CREATE INDEX IF NOT EXISTS idx_activities_finished_at 
  ON rower_race_activities ("finishedAt");

-- 4. Table d'état de la semaine active
CREATE TABLE IF NOT EXISTS league_system_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_week_start DATE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO league_system_state (id, active_week_start)
VALUES (1, (DATE_TRUNC('week', NOW() AT TIME ZONE 'Europe/Paris'))::DATE)
ON CONFLICT (id) DO NOTHING;

-- 5. Table d'historique hebdomadaire
CREATE TABLE IF NOT EXISTS league_weekly_history (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES rower_race_users(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  previous_league league_tier NOT NULL,
  new_league league_tier NOT NULL,
  outcome league_outcome NOT NULL,
  final_points INTEGER NOT NULL DEFAULT 0,
  final_rank INTEGER,
  seen_by_user BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_user_week UNIQUE (user_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_league_history_user_unseen 
  ON league_weekly_history (user_id, seen_by_user) 
  WHERE seen_by_user = FALSE;

-- 6. Vue temps réel des classements de la semaine en cours
CREATE OR REPLACE VIEW current_week_standings AS
WITH current_week_bounds AS (
  SELECT (DATE_TRUNC('week', NOW() AT TIME ZONE 'Europe/Paris')) AS week_start
),
user_week_stats AS (
  SELECT 
    a."userId" AS user_id,
    COALESCE(SUM(a.points_earned), 0)::INTEGER AS weekly_points,
    COUNT(a.id) FILTER (WHERE a.status = 'finished' AND a.is_dnf = FALSE)::INTEGER AS weekly_races_count,
    MIN(
      CASE 
        WHEN a.status = 'finished' AND a.is_dnf = FALSE AND a.avg_pace_ms > 0 THEN a.avg_pace_ms
        WHEN a.status = 'finished' AND a.is_dnf = FALSE AND a."avgPace" > 0 THEN (a."avgPace" * 1000)::INTEGER
        ELSE NULL 
      END
    ) AS weekly_best_pace_ms
  FROM rower_race_activities a
  CROSS JOIN current_week_bounds b
  WHERE a."finishedAt" >= b.week_start
    AND a."isBot" = FALSE
  GROUP BY a."userId"
)
SELECT 
  u.id AS user_id,
  COALESCE(u.login, u.name) AS user_name,
  u.name AS display_name,
  COALESCE(u.current_league, 'BRONZE'::league_tier) AS current_league,
  COALESCE(u.is_resting, FALSE) AS is_resting,
  COALESCE(s.weekly_points, 0) AS weekly_points,
  COALESCE(s.weekly_races_count, 0) AS weekly_races_count,
  s.weekly_best_pace_ms,
  COALESCE(u.total_career_points, 0) AS total_career_points,
  u.country,
  DENSE_RANK() OVER (
    PARTITION BY COALESCE(u.current_league, 'BRONZE'::league_tier)
    ORDER BY 
      COALESCE(s.weekly_points, 0) DESC,
      s.weekly_best_pace_ms ASC NULLS LAST,
      COALESCE(s.weekly_races_count, 0) DESC
  ) AS tier_rank
FROM rower_race_users u
LEFT JOIN user_week_stats s ON s.user_id = u.id;

-- 7. Fonction PL/pgSQL de clôture paresseuse
CREATE OR REPLACE FUNCTION ensure_current_week()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_stored_week DATE;
  v_actual_week DATE;
  v_target_week DATE;
BEGIN
  -- Calcul du lundi de la semaine courante en Europe/Paris
  v_actual_week := (DATE_TRUNC('week', NOW() AT TIME ZONE 'Europe/Paris'))::DATE;

  SELECT active_week_start INTO v_stored_week
  FROM league_system_state
  WHERE id = 1;

  -- 1. Sortie immédiate si la semaine active correspond à la date courante
  IF v_stored_week IS NOT NULL AND v_stored_week = v_actual_week THEN
    RETURN;
  END IF;

  -- 2. Poser un verrou transactionnel consultatif pour bloquer les requêtes concurrentes du lundi matin
  PERFORM pg_advisory_xact_lock(hashtext('rower_race_ensure_current_week_lock'));

  -- Re-vérification avec le verrou acquis
  SELECT active_week_start INTO v_stored_week
  FROM league_system_state
  WHERE id = 1;

  IF v_stored_week IS NOT NULL AND v_stored_week = v_actual_week THEN
    RETURN;
  END IF;

  IF v_stored_week IS NULL THEN
    INSERT INTO league_system_state (id, active_week_start)
    VALUES (1, v_actual_week)
    ON CONFLICT (id) DO UPDATE SET active_week_start = v_actual_week;
    RETURN;
  END IF;

  -- 3. Clôture séquentielle de chaque semaine écoulée
  v_target_week := v_stored_week;
  WHILE v_target_week < v_actual_week LOOP
    DECLARE
      v_next_week DATE := v_target_week + 7;
    BEGIN
      -- A. Joueurs gelés : Mode repos actif OU 0 course terminée sur la semaine écoulée
      INSERT INTO league_weekly_history (
        user_id, week_start_date, previous_league, new_league, outcome, final_points, final_rank, seen_by_user
      )
      SELECT 
        u.id,
        v_target_week,
        COALESCE(u.current_league, 'BRONZE'::league_tier),
        COALESCE(u.current_league, 'BRONZE'::league_tier),
        'FROZEN'::league_outcome,
        COALESCE(sub.pts, 0),
        NULL,
        FALSE
      FROM rower_race_users u
      LEFT JOIN (
        SELECT "userId", SUM(points_earned) AS pts, COUNT(*) AS races_cnt
        FROM rower_race_activities
        WHERE "finishedAt" >= v_target_week::TIMESTAMP AT TIME ZONE 'Europe/Paris'
          AND "finishedAt" < v_next_week::TIMESTAMP AT TIME ZONE 'Europe/Paris'
          AND status = 'finished'
          AND is_dnf = FALSE
          AND "isBot" = FALSE
        GROUP BY "userId"
      ) sub ON sub."userId" = u.id
      WHERE u.is_resting = TRUE OR COALESCE(sub.races_cnt, 0) = 0
      ON CONFLICT (user_id, week_start_date) DO NOTHING;

      -- B. Joueurs actifs : calcul des rangs et transitions
      WITH active_stats AS (
        SELECT 
          u.id AS user_id,
          COALESCE(u.current_league, 'BRONZE'::league_tier) AS current_league,
          COALESCE(sub.pts, 0)::INTEGER AS pts,
          COALESCE(sub.best_pace, 999999)::INTEGER AS best_pace,
          COALESCE(sub.races_cnt, 0)::INTEGER AS races_cnt
        FROM rower_race_users u
        JOIN (
          SELECT 
            "userId", 
            SUM(points_earned) AS pts, 
            COUNT(*) AS races_cnt,
            MIN(COALESCE(NULLIF(avg_pace_ms, 0), "avgPace" * 1000)) AS best_pace
          FROM rower_race_activities
          WHERE "finishedAt" >= v_target_week::TIMESTAMP AT TIME ZONE 'Europe/Paris'
            AND "finishedAt" < v_next_week::TIMESTAMP AT TIME ZONE 'Europe/Paris'
            AND status = 'finished'
            AND is_dnf = FALSE
            AND "isBot" = FALSE
          GROUP BY "userId"
        ) sub ON sub."userId" = u.id
        WHERE COALESCE(u.is_resting, FALSE) = FALSE AND sub.races_cnt > 0
      ),
      ranked_players AS (
        SELECT 
          user_id,
          current_league,
          pts,
          best_pace,
          races_cnt,
          ROW_NUMBER() OVER (
            PARTITION BY current_league 
            ORDER BY pts DESC, best_pace ASC, races_cnt DESC
          ) AS rank_in_tier,
          COUNT(*) OVER (PARTITION BY current_league) AS total_active_in_tier
        FROM active_stats
      ),
      tier_transitions AS (
        SELECT 
          user_id,
          current_league,
          pts,
          rank_in_tier,
          CASE 
            -- BRONZE : Top 25% (min 4 actifs) monte en SILVER
            WHEN current_league = 'BRONZE' THEN
              CASE 
                WHEN total_active_in_tier >= 4 AND rank_in_tier <= CEIL(total_active_in_tier * 0.25)
                  THEN 'SILVER'::league_tier
                ELSE 'BRONZE'::league_tier
              END
            -- SILVER : Top 20% (min 5 actifs) monte en GOLD, Derniers 20% descend en BRONZE
            WHEN current_league = 'SILVER' THEN
              CASE 
                WHEN total_active_in_tier >= 5 AND rank_in_tier <= CEIL(total_active_in_tier * 0.20)
                  THEN 'GOLD'::league_tier
                WHEN total_active_in_tier >= 5 AND rank_in_tier > (total_active_in_tier - CEIL(total_active_in_tier * 0.20))
                  THEN 'BRONZE'::league_tier
                ELSE 'SILVER'::league_tier
              END
            -- GOLD : Derniers 20% (min 5 actifs) descend en SILVER
            WHEN current_league = 'GOLD' THEN
              CASE 
                WHEN total_active_in_tier >= 5 AND rank_in_tier > (total_active_in_tier - CEIL(total_active_in_tier * 0.20))
                  THEN 'SILVER'::league_tier
                ELSE 'GOLD'::league_tier
              END
            ELSE current_league
          END AS next_league
        FROM ranked_players
      ),
      evaluated_outcomes AS (
        SELECT 
          user_id,
          current_league,
          next_league,
          pts,
          rank_in_tier,
          CASE 
            WHEN (current_league = 'BRONZE' AND next_league = 'SILVER') 
              OR (current_league = 'SILVER' AND next_league = 'GOLD') THEN 'PROMOTED'::league_outcome
            WHEN (current_league = 'GOLD' AND next_league = 'SILVER') 
              OR (current_league = 'SILVER' AND next_league = 'BRONZE') THEN 'RELEGATED'::league_outcome
            ELSE 'MAINTAINED'::league_outcome
          END AS outcome
        FROM tier_transitions
      )
      -- Insertion dans l'historique hebdomadaire
      INSERT INTO league_weekly_history (
        user_id, week_start_date, previous_league, new_league, outcome, final_points, final_rank, seen_by_user
      )
      SELECT 
        user_id,
        v_target_week,
        current_league,
        next_league,
        outcome,
        pts,
        rank_in_tier,
        FALSE
      FROM evaluated_outcomes
      ON CONFLICT (user_id, week_start_date) DO NOTHING;

      -- Mise à jour de la ligue courante des utilisateurs concernés
      UPDATE rower_race_users u
      SET current_league = h.new_league
      FROM league_weekly_history h
      WHERE h.user_id = u.id AND h.week_start_date = v_target_week;

      v_target_week := v_next_week;
    END;
  END LOOP;

  -- 4. Actualiser la semaine active sur league_system_state
  UPDATE league_system_state
  SET active_week_start = v_actual_week, updated_at = NOW()
  WHERE id = 1;

END;
$$;
