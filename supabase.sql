-- zuychin-arcade — run this in the Supabase SQL editor (Section 6 of the spec)

-- Game session results (written at end of each completed game)
CREATE TABLE game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL,
  game_name TEXT NOT NULL DEFAULT 'saboteur',
  played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rounds_played INT NOT NULL,
  player_count INT NOT NULL
);

-- Per-player results within a session
CREATE TABLE player_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,         -- the uuid issued by server (not a supabase user)
  display_name TEXT NOT NULL,
  total_nuggets INT NOT NULL DEFAULT 0,
  won BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leaderboard view (all-time top players across every game — fuzzy, for fun only)
CREATE VIEW leaderboard AS
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
CREATE VIEW leaderboard_by_game AS
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

-- Row-level security: anonymous insert + read (server uses the anon key)
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous insert" ON game_sessions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anonymous insert" ON player_results
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anonymous read" ON game_sessions
  FOR SELECT USING (true);

CREATE POLICY "Allow anonymous read" ON player_results
  FOR SELECT USING (true);
