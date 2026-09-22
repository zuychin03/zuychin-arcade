BEGIN;

DO $migration$
BEGIN
  IF to_regclass('public.game_sessions') IS NOT NULL THEN
    ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow anonymous insert" ON public.game_sessions;
    DROP POLICY IF EXISTS "Allow anonymous read" ON public.game_sessions;
    REVOKE ALL ON TABLE public.game_sessions FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regclass('public.player_results') IS NOT NULL THEN
    ALTER TABLE public.player_results ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow anonymous insert" ON public.player_results;
    DROP POLICY IF EXISTS "Allow anonymous read" ON public.player_results;
    REVOKE ALL ON TABLE public.player_results FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regclass('public.leaderboard') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.leaderboard FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regclass('public.leaderboard_by_game') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.leaderboard_by_game FROM PUBLIC, anon, authenticated;
  END IF;
END
$migration$;

COMMIT;
