BEGIN;
SET LOCAL statement_timeout = '5s';

DO $verification$
DECLARE
  first_id UUID := gen_random_uuid();
  rematch_id UUID := gen_random_uuid();
  invalid_id UUID := gen_random_uuid();
  players JSONB := '[{"player_id":"qa-one","display_name":"QA One","score":7,"won":true},{"player_id":"qa-two","display_name":"QA Two","score":2,"won":false}]';
BEGIN
  PERFORM public.record_game_result(first_id, 'QA-ONLY', 'not_alone', 4, players);
  PERFORM public.record_game_result(first_id, 'QA-ONLY', 'not_alone', 4, players);
  PERFORM public.record_game_result(rematch_id, 'QA-ONLY', 'not_alone', 4, players);
  IF (SELECT count(*) FROM public.game_sessions WHERE id IN (first_id, rematch_id)) <> 2
    OR (SELECT count(*) FROM public.player_results WHERE session_id = first_id) <> 2
    OR (SELECT count(*) FROM public.player_results WHERE session_id = rematch_id) <> 2 THEN
    RAISE EXCEPTION 'Atomic result retry or rematch verification failed';
  END IF;
  BEGIN
    PERFORM public.record_game_result(invalid_id, 'QA-ONLY', 'not_alone', 4,
      '[{"player_id":"qa-one","display_name":"QA One","score":null,"won":true}]');
    RAISE EXCEPTION 'Invalid result was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.game_sessions WHERE id = invalid_id) THEN
    RAISE EXCEPTION 'Invalid result left a partial session';
  END IF;
  RAISE NOTICE 'Result retries, rematches and invalid payload checks passed';
END
$verification$;

ROLLBACK;
