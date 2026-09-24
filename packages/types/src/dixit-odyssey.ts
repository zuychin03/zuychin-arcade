export type DixitCardId = `dream-${string}`;
export type DixitPhase = 'clue' | 'submit' | 'vote' | 'reveal' | 'game_over';

export interface DixitRoundScore {
  playerId: string;
  correctVotes: number;
  cluePoints: number;
  guessPoints: number;
  decoyPoints: number;
  total: number;
}

export interface DixitRoundResult {
  storytellerId: string;
  storytellerCardId: DixitCardId;
  outcome: 'all' | 'some' | 'none';
  submissions: Array<{ playerId: string; cardIds: DixitCardId[] }>;
  votes: Array<{ playerId: string; slots: [number, number] }>;
  scores: DixitRoundScore[];
}

export interface DixitPublicState {
  gameId: 'dixit_odyssey';
  roomCode: string;
  rulesVersion: string;
  revision: number;
  status: 'playing' | 'game_over';
  phase: DixitPhase;
  terminationReason: 'not_enough_players' | null;
  roundNumber: number;
  storytellerId: string | null;
  clue: string | null;
  players: Array<{
    playerId: string;
    displayName: string;
    score: number;
    handCount: number;
    forfeited: boolean;
    submitted: boolean;
    voted: boolean;
    ready: boolean;
  }>;
  table: Array<{ slot: number; cardId: DixitCardId }>;
  result: DixitRoundResult | null;
  winnerIds: string[];
  drawCount: number;
  discardCount: number;
  log: Array<{ id: number; text: string }>;
}

export interface DixitPrivateState {
  gameId: 'dixit_odyssey';
  roomCode: string;
  revision: number;
  playerId: string;
  hand: DixitCardId[];
  submittedCardIds: DixitCardId[];
  votes: [number, number] | null;
  submissionCount: number;
}

export type DixitAction =
  | { type: 'clue'; cardId: DixitCardId; clue: string }
  | { type: 'submit'; cardIds: DixitCardId[] }
  | { type: 'vote'; slots: [number, number] }
  | { type: 'ready' };

export interface DixitActionPayload {
  expectedRevision: number;
  roundNumber: number;
  action: DixitAction;
}
