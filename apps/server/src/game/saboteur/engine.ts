import type {
  ActionCard,
  BoardPosition,
  GameCard,
  PathCard,
  PlacedCard,
  PlayerGameState,
  Role,
  Tool,
} from '@zuychin-arcade/types';
import { BOARD, ROLE_TABLE, ROUNDS_PER_GAME, getHandSize } from '@zuychin-arcade/types';
import {
  buildFullDeck,
  buildGoldDeck,
  makeGoalCard,
  makeStartCard,
  shuffle,
} from './deck.js';
import {
  isGoalReached,
  rotateEdges,
  validatePlacement,
} from './boardValidator.js';
import {
  applySaboteurRewards,
  initGoldDistribution,
  type GoldDistributionState,
} from './goldDistribution.js';

export type EngineResult = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): EngineResult => ({ ok: false, reason });
const OK: EngineResult = { ok: true };

export interface GoalState {
  index: number;
  position: BoardPosition;
  isGold: boolean;
  revealed: boolean;
}

export interface SaboteurServerState {
  roomCode: string;
  round: number;
  status: 'playing' | 'round_end' | 'game_over';
  deck: GameCard[];
  discard: GameCard[];
  board: PlacedCard[];                 // start + tunnels + revealed goals
  goals: GoalState[];
  players: Map<string, PlayerGameState>;
  turnOrder: string[];                 // playerIds, lobby join order
  currentTurnIndex: number;
  roundWinner: 'miners' | 'saboteurs' | null;
  goldDeck: number[];                  // shared nugget deck, persists across rounds
  goldDistribution: GoldDistributionState | null;
  lastPlacerId: string | null;         // last player to place a path card this round
  roundStarterIndex: number;
  winnerIds: string[] | null;
}

// ---------------------------------------------------------------------------
// Game / round setup
// ---------------------------------------------------------------------------

export function initGame(
  roomCode: string,
  players: Array<{ playerId: string; displayName: string }>,
): SaboteurServerState {
  const state: SaboteurServerState = {
    roomCode,
    round: 0,
    status: 'playing',
    deck: [],
    discard: [],
    board: [],
    goals: [],
    players: new Map(
      players.map((p) => [
        p.playerId,
        {
          playerId: p.playerId,
          displayName: p.displayName,
          role: 'miner' as Role,
          hand: [],
          brokenTools: [],
          goldCollected: 0,
          peekedGoals: [],
        },
      ]),
    ),
    turnOrder: players.map((p) => p.playerId),
    currentTurnIndex: 0,
    roundWinner: null,
    goldDeck: buildGoldDeck(),
    goldDistribution: null,
    lastPlacerId: null,
    roundStarterIndex: 0,
    winnerIds: null,
  };
  setupRound(state, 1, 0);
  return state;
}

function setupRound(state: SaboteurServerState, round: number, starterIndex: number): void {
  const n = state.turnOrder.length;

  // Roles: exactly ROLE_TABLE[n].saboteurs saboteurs each round, the rest
  // miners. (The tabletop "deal n of n+1 role cards" variant can produce a
  // round with zero saboteurs, which plays badly in a digital game.)
  const ratio = ROLE_TABLE[n];
  const roleDeck = shuffle<Role>([
    ...Array<Role>(n - ratio.saboteurs).fill('miner'),
    ...Array<Role>(ratio.saboteurs).fill('saboteur'),
  ]);

  state.deck = buildFullDeck();
  state.discard = [];
  state.board = [{ card: makeStartCard(), position: { ...BOARD.startPos }, placedBy: '' }];

  const goldIndex = Math.floor(Math.random() * BOARD.goalPositions.length);
  state.goals = BOARD.goalPositions.map((pos, i) => ({
    index: i,
    position: { ...pos },
    isGold: i === goldIndex,
    revealed: false,
  }));

  const handSize = getHandSize(n);
  state.turnOrder.forEach((pid, i) => {
    const p = state.players.get(pid)!;
    p.role = roleDeck[i];
    p.hand = state.deck.splice(0, handSize);
    p.brokenTools = [];
    p.peekedGoals = [];
  });

  state.round = round;
  state.status = 'playing';
  state.roundWinner = null;
  state.goldDistribution = null;
  state.lastPlacerId = null;
  state.roundStarterIndex = starterIndex;
  state.currentTurnIndex = starterIndex;
}

// ---------------------------------------------------------------------------
// Turn helpers
// ---------------------------------------------------------------------------

function currentPlayerId(state: SaboteurServerState): string {
  return state.turnOrder[state.currentTurnIndex];
}

function requireTurn(state: SaboteurServerState, playerId: string): EngineResult {
  if (state.status !== 'playing') return fail('The round is not in progress');
  if (currentPlayerId(state) !== playerId) return fail('It is not your turn');
  return OK;
}

function takeFromHand(player: PlayerGameState, cardId: string): GameCard | null {
  const idx = player.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) return null;
  return player.hand.splice(idx, 1)[0];
}

function drawCard(state: SaboteurServerState, player: PlayerGameState): void {
  const card = state.deck.shift();
  if (card) player.hand.push(card);
}

function advanceTurn(state: SaboteurServerState): void {
  if (state.status !== 'playing') return;

  // Round ends (saboteurs win) when the deck is exhausted and nobody has
  // cards left to play or discard.
  const anyCards = [...state.players.values()].some((p) => p.hand.length > 0);
  if (state.deck.length === 0 && !anyCards) {
    endRound(state, 'saboteurs');
    return;
  }

  const n = state.turnOrder.length;
  for (let i = 1; i <= n; i++) {
    const idx = (state.currentTurnIndex + i) % n;
    if (state.players.get(state.turnOrder[idx])!.hand.length > 0) {
      state.currentTurnIndex = idx;
      return;
    }
  }
}

function unrevealedGoalPositions(state: SaboteurServerState): BoardPosition[] {
  return state.goals.filter((g) => !g.revealed).map((g) => g.position);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function placeCard(
  state: SaboteurServerState,
  playerId: string,
  cardId: string,
  position: BoardPosition,
  rotated: boolean,
): EngineResult {
  const turn = requireTurn(state, playerId);
  if (!turn.ok) return turn;

  const player = state.players.get(playerId)!;
  if (player.brokenTools.length > 0) {
    return fail('You cannot place path cards while any of your tools is broken');
  }

  const card = player.hand.find((c) => c.id === cardId);
  if (!card) return fail('Card is not in your hand');
  if (card.type !== 'path') return fail('Only path cards can be placed on the board');

  const oriented: PathCard = { ...card, edges: rotateEdges(card.edges, rotated) };
  const verdict = validatePlacement(state.board, oriented, position, unrevealedGoalPositions(state));
  if (!verdict.valid) return fail(verdict.reason ?? 'Invalid placement');

  takeFromHand(player, cardId);
  state.board.push({ card: oriented, position: { ...position }, placedBy: playerId });
  state.lastPlacerId = playerId;
  drawCard(state, player);

  revealReachedGoals(state, playerId);
  advanceTurn(state);
  return OK;
}

/**
 * Reveal any face-down goal now reached by the tunnel network. Revealing a
 * stone goal adds it to the board as a path node, which can in turn reach
 * further goals — hence the loop.
 */
function revealReachedGoals(state: SaboteurServerState, placerId: string): void {
  let changed = true;
  while (changed && state.status === 'playing') {
    changed = false;
    for (const goal of state.goals) {
      if (goal.revealed) continue;
      if (!isGoalReached(state.board, goal.position)) continue;
      goal.revealed = true;
      state.board.push({
        card: makeGoalCard(goal.isGold, goal.index),
        position: { ...goal.position },
        placedBy: '',
      });
      changed = true;
      if (goal.isGold) {
        state.lastPlacerId = placerId;
        endRound(state, 'miners');
        return;
      }
    }
  }
}

export function playAction(
  state: SaboteurServerState,
  playerId: string,
  cardId: string,
  targetPlayerId?: string,
  targetPosition?: BoardPosition,
  chosenTool?: Tool,
): EngineResult {
  const turn = requireTurn(state, playerId);
  if (!turn.ok) return turn;

  const player = state.players.get(playerId)!;
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) return fail('Card is not in your hand');
  if (card.type !== 'action') return fail('That is not an action card');

  const result = dispatchAction(state, player, card, targetPlayerId, targetPosition, chosenTool);
  if (!result.ok) return result;

  takeFromHand(player, cardId);
  state.discard.push(card);
  drawCard(state, player);
  advanceTurn(state);
  return OK;
}

const SABOTAGE_TOOL: Partial<Record<ActionCard['subtype'], Tool>> = {
  sabotage_lantern: 'lantern',
  sabotage_cart: 'cart',
  sabotage_pickaxe: 'pickaxe',
};

const REPAIR_TOOLS: Partial<Record<ActionCard['subtype'], Tool[]>> = {
  repair_lantern: ['lantern'],
  repair_cart: ['cart'],
  repair_pickaxe: ['pickaxe'],
  repair_lantern_cart: ['lantern', 'cart'],
  repair_lantern_pickaxe: ['lantern', 'pickaxe'],
  repair_cart_pickaxe: ['cart', 'pickaxe'],
};

function dispatchAction(
  state: SaboteurServerState,
  player: PlayerGameState,
  card: ActionCard,
  targetPlayerId?: string,
  targetPosition?: BoardPosition,
  chosenTool?: Tool,
): EngineResult {
  const sabotageTool = SABOTAGE_TOOL[card.subtype];
  if (sabotageTool) {
    if (!targetPlayerId) return fail('Sabotage needs a target player');
    if (targetPlayerId === player.playerId) return fail('You cannot sabotage yourself');
    const target = state.players.get(targetPlayerId);
    if (!target) return fail('Unknown target player');
    if (target.brokenTools.includes(sabotageTool)) {
      return fail(`${target.displayName}'s ${sabotageTool} is already broken`);
    }
    target.brokenTools.push(sabotageTool);
    return OK;
  }

  const repairTools = REPAIR_TOOLS[card.subtype];
  if (repairTools) {
    if (!targetPlayerId) return fail('Repair needs a target player');
    const target = state.players.get(targetPlayerId);
    if (!target) return fail('Unknown target player');
    let tool: Tool;
    if (repairTools.length === 1) {
      tool = repairTools[0];
    } else {
      if (!chosenTool) return fail('Choose which tool to repair');
      if (!repairTools.includes(chosenTool)) return fail('That tool is not on this repair card');
      tool = chosenTool;
    }
    if (!target.brokenTools.includes(tool)) {
      return fail(`${target.displayName}'s ${tool} is not broken`);
    }
    target.brokenTools = target.brokenTools.filter((t) => t !== tool);
    return OK;
  }

  if (card.subtype === 'map') {
    if (!targetPosition) return fail('Pick a goal card to peek at');
    const goal = state.goals.find(
      (g) => g.position.row === targetPosition.row && g.position.col === targetPosition.col,
    );
    if (!goal) return fail('That is not a goal position');
    if (goal.revealed) return fail('That goal is already revealed');
    if (!player.peekedGoals.some((p) => p.position.row === goal.position.row && p.position.col === goal.position.col)) {
      player.peekedGoals.push({ position: { ...goal.position }, isGold: goal.isGold });
    }
    return OK;
  }

  if (card.subtype === 'rockfall') {
    if (!targetPosition) return fail('Pick a path card to remove');
    const idx = state.board.findIndex(
      (p) => p.position.row === targetPosition.row && p.position.col === targetPosition.col,
    );
    if (idx === -1) return fail('There is no card at that position');
    if (state.board[idx].card.subtype !== 'tunnel') {
      return fail('The start and goal cards cannot be removed');
    }
    const [removed] = state.board.splice(idx, 1);
    state.discard.push(removed.card);
    return OK;
  }

  return fail('Unknown action card');
}

export function passTurn(state: SaboteurServerState, playerId: string, discardCardId?: string): EngineResult {
  const turn = requireTurn(state, playerId);
  if (!turn.ok) return turn;

  const player = state.players.get(playerId)!;
  if (player.hand.length > 0) {
    if (!discardCardId) return fail('Choose a card to discard');
    const card = takeFromHand(player, discardCardId);
    if (!card) return fail('Card is not in your hand');
    state.discard.push(card);
    // Official rules: every turn — including a pass — ends by drawing a card.
    drawCard(state, player);
  }
  advanceTurn(state);
  return OK;
}

export function chooseGold(state: SaboteurServerState, playerId: string, cardIndex: number): EngineResult {
  if (state.status !== 'round_end' || !state.goldDistribution) {
    return fail('Gold is not being distributed right now');
  }
  const dist = state.goldDistribution;
  const picker = dist.order[dist.currentIndex];
  if (picker !== playerId) return fail('It is not your turn to pick gold');

  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= dist.availableCards.length) {
    return fail('That nugget card is not available');
  }

  const [cardValue] = dist.availableCards.splice(cardIndex, 1);
  dist.assignments.set(playerId, cardValue);
  state.players.get(playerId)!.goldCollected += cardValue;
  dist.currentIndex += 1;
  return OK;
}

export function isGoldDistributionComplete(state: SaboteurServerState): boolean {
  if (state.status !== 'round_end') return false;
  if (!state.goldDistribution) return true;   // saboteur win — nothing to pick
  return state.goldDistribution.currentIndex >= state.goldDistribution.order.length;
}

// ---------------------------------------------------------------------------
// Round / game end
// ---------------------------------------------------------------------------

function endRound(state: SaboteurServerState, winner: 'miners' | 'saboteurs'): void {
  state.status = 'round_end';
  state.roundWinner = winner;
  if (winner === 'miners') {
    state.goldDistribution = initGoldDistribution(state.players, state.turnOrder, state.lastPlacerId, state.goldDeck);
  } else {
    applySaboteurRewards(state.players);
  }
}

/** Move to the next round, or finish the game after round 3. */
export function advanceRound(state: SaboteurServerState): void {
  if (state.status !== 'round_end') return;
  if (state.round >= ROUNDS_PER_GAME) {
    endGame(state);
    return;
  }
  // Player to the left of whoever placed the last path card starts next round
  const lastIdx = state.lastPlacerId
    ? state.turnOrder.indexOf(state.lastPlacerId)
    : state.roundStarterIndex;
  setupRound(state, state.round + 1, (lastIdx + 1) % state.turnOrder.length);
}

function endGame(state: SaboteurServerState): void {
  state.status = 'game_over';
  const players = [...state.players.values()];
  const max = Math.max(...players.map((p) => p.goldCollected));
  state.winnerIds = players.filter((p) => p.goldCollected === max).map((p) => p.playerId);
}
