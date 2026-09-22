export type SkullKingSuit = 'green' | 'purple' | 'yellow' | 'black';
export type SkullKingCardKind = 'number' | 'pirate' | 'tigress' | 'skull_king' | 'mermaid' | 'escape';
export type SkullKingTigressMode = 'pirate' | 'escape';
export type SkullKingPhase = 'bidding' | 'trick_play' | 'game_over';

export interface SkullKingCard {
  id: string;
  kind: SkullKingCardKind;
  suit?: SkullKingSuit;
  rank?: number;
  copy?: number;
}

export interface SkullKingPlayedCard extends SkullKingCard {
  playerId: string;
  tigressMode?: SkullKingTigressMode;
}

export interface SkullKingPlayerPublic {
  playerId: string;
  displayName: string;
  cardCount: number;
  bid: number | null;
  bidSubmitted: boolean;
  tricksWon: number;
  roundScore: number;
  totalScore: number;
  exactLastRound: boolean | null;
  forfeited: boolean;
}

export interface SkullKingTrickResult {
  roundNumber: number;
  trickNumber: number;
  winnerId: string;
  winnerName: string;
  reason: string;
  bonus: number;
  cards: SkullKingPlayedCard[];
}

export interface SkullKingLogEntry { id: number; text: string }

export interface SkullKingRoundScore {
  roundNumber: number;
  cardsPerPlayer: number;
  players: {
    playerId: string;
    displayName: string;
    bid: number;
    tricksWon: number;
    baseScore: number;
    bonus: number;
    roundScore: number;
    totalScore: number;
    forfeited: boolean;
  }[];
}

export interface SkullKingPublicState {
  gameId: 'skull_king';
  roomCode: string;
  revision: number;
  rulesVersion: string;
  modeDescription: string;
  status: 'playing' | 'game_over';
  terminationReason: 'not_enough_players' | null;
  phase: SkullKingPhase;
  roundNumber: number;
  cardsPerPlayer: number;
  trickNumber: number;
  dealerId: string;
  leaderId: string | null;
  currentPlayerId: string | null;
  bidsRevealed: boolean;
  players: SkullKingPlayerPublic[];
  turnOrder: string[];
  currentTrick: SkullKingPlayedCard[];
  lastTrick: SkullKingTrickResult | null;
  scoreHistory: SkullKingRoundScore[];
  winnerIds: string[];
  log: SkullKingLogEntry[];
}

export interface SkullKingPrivateState {
  gameId: 'skull_king';
  roomCode: string;
  revision: number;
  playerId: string;
  hand: SkullKingCard[];
  legalCardIds: string[];
  submittedBid: number | null;
}

export type SkullKingStartPayload = Record<string, never>;
export type SkullKingActionKind = 'start' | 'bid' | 'play';
export interface SkullKingActionAccepted {
  action: SkullKingActionKind;
  revision: number;
}
export interface SkullKingBidPayload { bid: number; expectedRevision: number }
export interface SkullKingPlayPayload {
  cardId: string;
  tigressMode?: SkullKingTigressMode;
  expectedRevision: number;
}
