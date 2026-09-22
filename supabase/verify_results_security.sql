WITH roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), relations(relation_name) AS (
  VALUES
    ('public.game_sessions'),
    ('public.player_results'),
    ('public.leaderboard'),
    ('public.leaderboard_by_game')
)
SELECT
  role_name,
  relation_name,
  has_table_privilege(role_name, relation_name, 'SELECT') AS can_select,
  has_table_privilege(role_name, relation_name, 'INSERT') AS can_insert,
  has_table_privilege(role_name, relation_name, 'UPDATE') AS can_update,
  has_table_privilege(role_name, relation_name, 'DELETE') AS can_delete
FROM roles
CROSS JOIN relations
ORDER BY role_name, relation_name;

SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('game_sessions', 'player_results')
ORDER BY tablename, policyname;

-- Expected: every privilege column above is false, and the policy query returns
-- no anonymous result policies. Run this in Supabase after applying the migration.

SELECT role_name, has_function_privilege(
  role_name, 'public.record_game_result(uuid,text,text,integer,jsonb)', 'EXECUTE'
) AS can_record_result
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name);

-- Expected: only service_role can execute the result transaction.
