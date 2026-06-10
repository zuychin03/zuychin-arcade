import { ROUNDS_PER_GAME } from '@zuychin-arcade/types';
import { supabase } from './supabase.js';

// Call this at the end of round 3 once gold is fully distributed
export async function saveGameResult(params: {
  roomCode: string;
  players: Array<{ playerId: string; displayName: string; totalNuggets: number; won: boolean }>;
}): Promise<void> {
  if (!supabase) return;
  try {
    const { data: session, error } = await supabase
      .from('game_sessions')
      .insert({
        room_code: params.roomCode,
        rounds_played: ROUNDS_PER_GAME,
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
        total_nuggets: p.totalNuggets,
        won: p.won,
      })),
    );
    if (resultsError) console.error('[supabase] failed to save player results', resultsError);
  } catch (err) {
    console.error('[supabase] saveGameResult error', err);
  }
}
