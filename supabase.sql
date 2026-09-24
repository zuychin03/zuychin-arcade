-- zuychin-arcade - run this in the Supabase SQL editor (Section 6 of the spec)

-- Game session results (written at end of each completed game)
CREATE TABLE IF NOT EXISTS game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL,
  game_name TEXT NOT NULL DEFAULT 'saboteur',
  played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rounds_played INT NOT NULL,
  player_count INT NOT NULL
);

-- Per-player results within a session
CREATE TABLE IF NOT EXISTS player_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,         -- the uuid issued by server (not a supabase user)
  display_name TEXT NOT NULL,
  total_nuggets INT NOT NULL DEFAULT 0,
  won BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leaderboard view (all-time top players across every game - fuzzy, for fun only)
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  display_name,
  COUNT(DISTINCT session_id) AS games_played,
  SUM(total_nuggets) AS total_nuggets,
  SUM(CASE WHEN won THEN 1 ELSE 0 END) AS wins
FROM player_results
GROUP BY display_name
ORDER BY total_nuggets DESC;

-- Per-game leaderboard. The server filters by game_name (GET /leaderboard?game=).
-- Saboteur ranks by nuggets; Coup has no score so it ranks by wins.
CREATE OR REPLACE VIEW leaderboard_by_game AS
SELECT
  gs.game_name,
  pr.display_name,
  COUNT(DISTINCT pr.session_id) AS games_played,
  SUM(pr.total_nuggets) AS total_nuggets,
  SUM(CASE WHEN pr.won THEN 1 ELSE 0 END) AS wins
FROM player_results pr
JOIN game_sessions gs ON gs.id = pr.session_id
GROUP BY gs.game_name, pr.display_name
ORDER BY wins DESC, total_nuggets DESC;

-- Only the backend writes or reads result rows. The public anon and authenticated
-- roles have no raw-table or leaderboard-view access, preventing score forgery and
-- exposure of per-session player identifiers. The server uses SUPABASE_SECRET_KEY.
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous insert" ON game_sessions;
DROP POLICY IF EXISTS "Allow anonymous insert" ON player_results;
DROP POLICY IF EXISTS "Allow anonymous read" ON game_sessions;
DROP POLICY IF EXISTS "Allow anonymous read" ON player_results;

REVOKE ALL ON TABLE game_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE player_results FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE leaderboard FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE leaderboard_by_game FROM PUBLIC, anon, authenticated;

-- One transaction and one retry-safe ID for a complete result.
CREATE OR REPLACE FUNCTION public.record_game_result(
  p_result_id UUID,
  p_room_code TEXT,
  p_game_name TEXT,
  p_rounds_played INT,
  p_players JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_result_id IS NULL OR p_room_code IS NULL OR length(trim(p_room_code)) = 0
    OR p_game_name IS NULL OR length(trim(p_game_name)) = 0
    OR p_rounds_played IS NULL OR p_rounds_played < 1 THEN
    RAISE EXCEPTION 'Invalid game result metadata' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_players) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Players must be an array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_players) NOT BETWEEN 1 AND
    CASE p_game_name
      WHEN 'cartographers_heroes' THEN 100
      WHEN 'dixit_odyssey' THEN 12
      WHEN 'telestrations' THEN 12
      WHEN 'feed_the_kraken' THEN 11
      ELSE 10
    END THEN
    RAISE EXCEPTION 'Invalid result player count' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_players)
      AS p(player_id TEXT, display_name TEXT, score INT, won BOOLEAN)
    WHERE p.player_id IS NULL OR length(trim(p.player_id)) = 0
      OR p.display_name IS NULL OR length(trim(p.display_name)) = 0
      OR p.score IS NULL OR p.won IS NULL
  ) OR (
    SELECT count(DISTINCT p.player_id) FROM jsonb_to_recordset(p_players)
      AS p(player_id TEXT)
  ) <> jsonb_array_length(p_players) THEN
    RAISE EXCEPTION 'Invalid or duplicate player result' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.game_sessions (id, room_code, game_name, rounds_played, player_count)
  VALUES (p_result_id, p_room_code, p_game_name, p_rounds_played, jsonb_array_length(p_players))
  ON CONFLICT (id) DO NOTHING;

  IF FOUND THEN
    INSERT INTO public.player_results (session_id, player_id, display_name, total_nuggets, won)
    SELECT p_result_id, p.player_id, p.display_name, p.score, p.won
    FROM jsonb_to_recordset(p_players)
      AS p(player_id TEXT, display_name TEXT, score INT, won BOOLEAN);
  END IF;
  RETURN p_result_id;
END
$function$;

REVOKE ALL ON FUNCTION public.record_game_result(UUID, TEXT, TEXT, INT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_game_result(UUID, TEXT, TEXT, INT, JSONB)
  TO service_role;
GRANT SELECT, INSERT ON TABLE public.game_sessions, public.player_results TO service_role;
GRANT SELECT ON TABLE public.leaderboard, public.leaderboard_by_game TO service_role;
