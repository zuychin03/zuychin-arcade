import { supabase } from './supabase.js';

// Persist a finished game. Game-agnostic: `score` carries whatever the game
// ranks by (Saboteur nuggets; Coup uses 0 — it ranks by wins). `gameName`
// drives the per-game leaderboard filter.
export async function saveGameResult(params: {
  gameName: string;
  roomCode: string;
  roundsPlayed?: number;
  players: Array<{ playerId: string; displayName: string; score: number; won: boolean }>;
}): Promise<void> {
  if (!supabase) return;
  try {
    const { data: session, error } = await supabase
      .from('game_sessions')
      .insert({
        room_code: params.roomCode,
        game_name: params.gameName,
        rounds_played: params.roundsPlayed ?? 1,
        player_count: params.players.length,
      })
      .select('id')
      .single();

    if (error || !session) {
      console.error('[supabase] failed to save game session', error);
      return;
    }

    const { error: resultsError } = await supabase.from('player_results').insert(
      params.players.map((p) => ({
        session_id: session.id,
        player_id: p.playerId,
        display_name: p.displayName,
        total_nuggets: p.score,
        won: p.won,
      })),
    );
    if (resultsError) console.error('[supabase] failed to save player results', resultsError);
  } catch (err) {
    console.error('[supabase] saveGameResult error', err);
  }
}
