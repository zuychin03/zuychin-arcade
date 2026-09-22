import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { supabase } from './supabase.js';

interface GameResult {
  gameName: string;
  roomCode: string;
  roundsPlayed?: number;
  players: Array<{ playerId: string; displayName: string; score: number; won: boolean }>;
}

interface ResultResponse {
  data: unknown;
  error: { code?: string } | null;
  status?: number;
}

interface ResultClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<ResultResponse> & {
    abortSignal?: (signal: AbortSignal) => PromiseLike<ResultResponse>;
  };
}

export type ResultSaveStatus = 'saved' | 'disabled' | 'failed';

export function createGameResultWriter(
  client: ResultClient | null,
  wait: (milliseconds: number) => Promise<unknown> = delay,
  reportFailure: (resultId: string) => void = (resultId) => console.error(`[results] could not persist result ${resultId} after bounded retries`),
) {
  return async (params: GameResult): Promise<ResultSaveStatus> => {
    if (!client) return 'disabled';
    const resultId = randomUUID();
    // Reuse one ID when a committed response is lost in transit.
    const args = {
      p_result_id: resultId,
      p_room_code: params.roomCode,
      p_game_name: params.gameName,
      p_rounds_played: params.roundsPlayed ?? 1,
      p_players: params.players.map((player) => ({
        player_id: player.playerId,
        display_name: player.displayName,
        score: player.score,
        won: player.won,
      })),
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let retry = true;
      try {
        const request = client.rpc('record_game_result', args);
        const response = await (request.abortSignal ? request.abortSignal(AbortSignal.timeout(10_000)) : request);
        if (!response.error && response.data === resultId) return 'saved';
        retry = response.error !== null && (
          response.status === undefined || response.status === 0 || response.status === 408
          || response.status === 429 || response.status >= 500
        );
      } catch {
        // A transport failure may happen before or after the transaction commits.
      }
      if (!retry || attempt === 2) break;
      await wait(250 * 2 ** attempt);
    }
    reportFailure(resultId);
    return 'failed';
  };
}

export const saveGameResult = createGameResultWriter(supabase);
