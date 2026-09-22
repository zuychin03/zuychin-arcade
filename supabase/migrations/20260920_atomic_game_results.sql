BEGIN;

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
  IF jsonb_array_length(p_players) NOT BETWEEN 1 AND 10 THEN
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

COMMIT;
