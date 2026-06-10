export type Tool = 'lantern' | 'cart' | 'pickaxe';
export type Role = 'miner' | 'saboteur';
export type CardSuit = 'path' | 'action' | 'nugget' | 'role';

// --- PATH CARD ---
export type EdgeState = 'open' | 'closed';

export interface PathCardEdges {
  top: EdgeState;
  right: EdgeState;
  bottom: EdgeState;
  left: EdgeState;
  center: boolean;   // true if the openings connect through the card centre
}

export interface PathCard {
  id: string;
  type: 'path';
  subtype: 'tunnel' | 'start' | 'goal_gold' | 'goal_stone';
  edges: PathCardEdges;
  isDeadEnd: boolean;
}

// --- ACTION CARD ---
export type ActionSubtype =
  | 'sabotage_lantern'
  | 'sabotage_cart'
  | 'sabotage_pickaxe'
  | 'repair_lantern'
  | 'repair_cart'
  | 'repair_pickaxe'
  | 'repair_lantern_cart'
  | 'repair_lantern_pickaxe'
  | 'repair_cart_pickaxe'
  | 'map'
  | 'rockfall';

export interface ActionCard {
  id: string;
  type: 'action';
  subtype: ActionSubtype;
}

export type GameCard = PathCard | ActionCard;

// --- BOARD POSITION ---
export interface BoardPosition {
  row: number;
  col: number;
}

export interface PlacedCard {
  card: PathCard;          // edges already reflect any 180° rotation applied
  position: BoardPosition;
  placedBy: string;        // playerId ('' for the start/goal cards)
}

// --- PLAYER GAME STATE (server-side, never sent in full to clients) ---
export interface PlayerGameState {
  playerId: string;
  displayName: string;
  role: Role;                    // SECRET — only sent to that player
  hand: GameCard[];              // SECRET — only sent to that player
  brokenTools: Tool[];           // PUBLIC — visible to all
  goldCollected: number;         // running total across rounds
  peekedGoals: PeekedGoal[];     // SECRET — goals seen via map cards
}

export interface PeekedGoal {
  position: BoardPosition;
  isGold: boolean;
}

// --- PUBLIC PLAYER STATE (safe to broadcast to all) ---
export interface PublicPlayerState {
  playerId: string;
  displayName: string;
  handSize: number;              // card count only, not the cards
  brokenTools: Tool[];
  isCurrentTurn: boolean;
  goldCollected: number;
}

// --- GOAL CARD STATUS (public) ---
export interface GoalStatus {
  position: BoardPosition;
  revealed: boolean;
  isGold: boolean | null;        // null while face-down
}

// --- GOLD DISTRIBUTION ---
export interface GoldDistributionStep {
  playerId: string;
  chosenCard: number | null;     // null until chosen
}

export interface GoldDistributionPublic {
  order: string[];               // playerIds, winning placer first, counter-clockwise
  currentPickerId: string | null;
  availableCards: number[];      // nugget values still on offer
  steps: GoldDistributionStep[];
}

export interface RoleReveal {
  playerId: string;
  displayName: string;
  role: Role;
}

// --- GAME STATE (public board state broadcast to all) ---
export interface SaboteurPublicState {
  roomCode: string;
  round: number;                 // 1, 2, or 3
  status: 'playing' | 'round_end' | 'game_over';
  board: PlacedCard[];           // start card + placed tunnels + revealed goals
  goals: GoalStatus[];
  deckSize: number;
  discardSize: number;
  players: PublicPlayerState[];  // in turn order
  currentTurnPlayerId: string | null;
  revealedGoalPositions: BoardPosition[];   // publicly revealed goals
  roundWinner: 'miners' | 'saboteurs' | null;
  goldDistribution: GoldDistributionPublic | null;   // set during round_end (miners win)
  revealedRoles: RoleReveal[] | null;       // set during round_end / game_over
  winnerIds: string[] | null;               // set at game_over (ties share victory)
}

// --- PRIVATE STATE SENT TO INDIVIDUAL PLAYERS ---
export interface SaboteurPrivateState {
  playerId: string;
  role: Role;
  hand: GameCard[];
  peekedGoals: PeekedGoal[];     // goals this player has seen via map
}

// --- SOCKET EVENT PAYLOADS (client → server) ---
export interface PlaceCardPayload {
  cardId: string;
  position: BoardPosition;
  rotated: boolean;              // true if card is rotated 180°
}

export interface PlayActionPayload {
  cardId: string;
  targetPlayerId?: string;       // for sabotage/repair
  targetPosition?: BoardPosition; // for rockfall/map
  chosenTool?: Tool;             // for dual-repair cards
}

export interface PassTurnPayload {
  discardCardId?: string;        // omitted only when hand is empty
}

export interface ChooseGoldPayload {
  cardValue: number;             // 1, 2, or 3
}

export interface ActionRejected {
  reason: string;
}

// --- LEADERBOARD ---
export interface LeaderboardRow {
  display_name: string;
  games_played: number;
  total_nuggets: number;
  wins: number;
}
