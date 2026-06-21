// Coup (+ Reformation) shared contracts.
//
// Two variants, chosen by the room owner at creation:
//   'base'        — 5 characters (Duke/Assassin/Captain/Ambassador/Contessa), 2–6 players
//   'reformation' — adds allegiances, Convert/Embezzle/Treasury, Inquisitor
//                   replaces Ambassador, 2–10 players
//
// As with Saboteur, the server is authoritative: a player's face-down
// influence characters live only on the server and are sent solely to that
// player via `CoupPrivateState`. Everything in `CoupPublicState` is safe to
// broadcast to the whole room.

export type CoupVariant = 'base' | 'reformation';

export type CoupCharacter =
  | 'duke'
  | 'assassin'
  | 'captain'
  | 'ambassador'
  | 'contessa'
  | 'inquisitor';

export type Allegiance = 'loyalist' | 'reformist';

export type CoupActionType =
  | 'income'
  | 'foreign_aid'
  | 'coup'
  | 'tax'
  | 'assassinate'
  | 'steal'
  | 'exchange'
  // reformation only:
  | 'convert'
  | 'embezzle'
  | 'inquisitor_exchange'
  | 'inquisitor_examine';

// --- INFLUENCE (a player's character cards) ---
export interface Influence {
  character: CoupCharacter;
  revealed: boolean; // true once lost (flipped face-up) — then public and dead
}

// --- SERVER-ONLY player state (never serialized to clients in full) ---
export interface CoupPlayerState {
  playerId: string;
  displayName: string;
  influences: Influence[]; // SECRET while face-down
  coins: number;
  allegiance: Allegiance | null; // null in the base variant
  eliminated: boolean;
}

// ---------------------------------------------------------------------------
// Phase machine (see COUP_PLAN.md §3). The game spends most of its time
// *between* turns, waiting on other players' challenge/block responses.
// ---------------------------------------------------------------------------
export type CoupPhase =
  | 'awaiting_action' // current player chooses an action
  | 'awaiting_action_challenge' // others may challenge the claimed character
  | 'awaiting_block' // eligible blocker(s) may block
  | 'awaiting_block_challenge' // others may challenge the block
  | 'awaiting_lose_influence' // a player picks which card to reveal/lose
  | 'awaiting_exchange' // actor picks which cards to keep (Ambassador/Inquisitor)
  | 'awaiting_examine' // Inquisitor decides keep/force-swap (reformation)
  | 'game_over';

// Why a player must lose an influence (drives the UI copy).
export type LoseInfluenceReason =
  | 'coup'
  | 'assassinate'
  | 'failed_challenge' // challenged and was wrong
  | 'failed_bluff'; // got challenged on a claim they couldn't back

// --- PUBLIC view of the pending window (safe to broadcast) ---
export interface CoupPendingPublic {
  phase: CoupPhase;
  actorId: string | null; // who initiated the action in flight
  action: CoupActionType | null;
  targetId: string | null; // action target (assassinate/coup/steal/convert/examine)
  claimedCharacter: CoupCharacter | null; // character the actor is claiming (challenge windows)
  blockerId: string | null; // who declared a block
  blockCharacter: CoupCharacter | null; // character the blocker is claiming
  waitingOn: string[]; // playerIds the engine is waiting on for input
  responded: string[]; // playerIds who have already passed/responded (UI ticks)
  deadline: number | null; // epoch ms when the auto-pass timer fires (countdown)
  losingPlayerId: string | null; // set during awaiting_lose_influence
  loseReason: LoseInfluenceReason | null;
}

// --- PUBLIC per-player state ---
export interface CoupPublicPlayer {
  playerId: string;
  displayName: string;
  coins: number;
  allegiance: Allegiance | null;
  influenceCount: number; // face-down (alive) cards remaining
  revealedCharacters: CoupCharacter[]; // face-up (lost) cards — public
  eliminated: boolean;
  isCurrentTurn: boolean;
}

export interface CoupLogEntry {
  id: number;
  text: string;
}

// --- PUBLIC game state (broadcast to the room) ---
export interface CoupPublicState {
  roomCode: string;
  variant: CoupVariant;
  status: 'playing' | 'game_over';
  players: CoupPublicPlayer[]; // in turn order
  currentTurnPlayerId: string | null;
  treasuryReserve: number; // reformation Treasury Reserve (0 in base)
  deckSize: number;
  pending: CoupPendingPublic;
  log: CoupLogEntry[];
  winnerId: string | null;
}

// --- PRIVATE per-player decision context ---
export interface CoupExchangeOption {
  // The pool the actor chooses from during an Exchange: their current
  // face-down characters plus the freshly drawn ones. They keep `keepCount`.
  pool: CoupCharacter[];
  keepCount: number;
}

export interface CoupExamineResult {
  targetId: string;
  targetName: string;
  character: CoupCharacter; // the card the examined player revealed to the Inquisitor
}

export interface CoupPrivateState {
  playerId: string;
  influences: Influence[]; // this player's own cards (face-down + revealed)
  exchange: CoupExchangeOption | null; // set during this player's awaiting_exchange
  examine: CoupExamineResult | null; // set during this player's awaiting_examine
}

// ---------------------------------------------------------------------------
// SOCKET EVENT PAYLOADS (client → server)
// ---------------------------------------------------------------------------
export interface CoupActionPayload {
  action: CoupActionType;
  targetPlayerId?: string; // assassinate/coup/steal/convert(other)/examine
}

export type CoupResponse = 'challenge' | 'block' | 'pass';

export interface CoupRespondPayload {
  response: CoupResponse;
  // required when response === 'block' and more than one character could block
  // (Steal: Captain / Ambassador / Inquisitor)
  blockCharacter?: CoupCharacter;
}

export interface CoupLoseInfluencePayload {
  character: CoupCharacter; // which face-down card to reveal
}

export interface CoupExchangePayload {
  keep: CoupCharacter[]; // characters to keep (length must equal alive influence count)
}

export interface CoupExaminePayload {
  forceSwap: boolean; // Inquisitor: force the examined player to redraw
}
