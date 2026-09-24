import {
  DIXIT_CARD_IDS, DIXIT_CLUE_MAX_LENGTH, DIXIT_MAX_PLAYERS, DIXIT_MIN_PLAYERS,
  DIXIT_RULES_VERSION, DIXIT_WIN_SCORE,
  type DixitAction, type DixitCardId, type DixitPhase, type DixitRoundResult,
} from '@zuychin-arcade/types';

export interface DixitServerPlayer {
  playerId: string;
  displayName: string;
  hand: DixitCardId[];
  score: number;
  forfeited: boolean;
}

export interface DixitServerState {
  roomCode: string;
  rulesVersion: string;
  revision: number;
  status: 'playing' | 'game_over';
  terminationReason: 'not_enough_players' | null;
  phase: DixitPhase;
  roundNumber: number;
  roundStartedRevision: number;
  players: Map<string, DixitServerPlayer>;
  turnOrder: string[];
  roundPlayers: string[];
  storytellerId: string | null;
  clue: string | null;
  drawPile: DixitCardId[];
  discardPile: DixitCardId[];
  submissions: Map<string, DixitCardId[]>;
  votes: Map<string, [number, number]>;
  table: DixitCardId[];
  ready: Set<string>;
  result: DixitRoundResult | null;
  winnerIds: string[];
  log: Array<{ id: number; text: string }>;
  nextLogId: number;
  rng: () => number;
}

export type DixitEngineResult = { ok: true } | { ok: false; reason: string };
const reject = (reason: string): DixitEngineResult => ({ ok: false, reason });

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function log(state: DixitServerState, text: string): void {
  state.log.push({ id: state.nextLogId++, text });
  if (state.log.length > 60) state.log.shift();
}

function activeIds(state: DixitServerState): string[] {
  return state.turnOrder.filter(id => !state.players.get(id)!.forfeited);
}

function nextStoryteller(state: DixitServerState): string {
  const start = state.storytellerId === null ? -1 : state.turnOrder.indexOf(state.storytellerId);
  for (let offset = 1; offset <= state.turnOrder.length; offset++) {
    const id = state.turnOrder[(start + offset) % state.turnOrder.length]!;
    if (!state.players.get(id)!.forfeited) return id;
  }
  throw new Error('Dixit has no active storyteller');
}

function refillHands(state: DixitServerState): void {
  const active = activeIds(state);
  const size = active.length === 3 ? 7 : 6;
  const needed = active.reduce((total, id) => total + Math.max(0, size - state.players.get(id)!.hand.length), 0);
  if (state.drawPile.length < needed) {
    state.drawPile = shuffled([...state.drawPile, ...state.discardPile], state.rng);
    state.discardPile = [];
  }
  for (const id of active) {
    const hand = state.players.get(id)!.hand;
    while (hand.length < size) {
      const card = state.drawPile.shift();
      if (!card) throw new Error('Dixit card conservation failed');
      hand.push(card);
    }
  }
}

function resetRound(state: DixitServerState): void {
  state.storytellerId = nextStoryteller(state);
  state.roundNumber++;
  state.roundStartedRevision = state.revision + 1;
  state.roundPlayers = activeIds(state);
  state.clue = null;
  state.submissions.clear();
  state.votes.clear();
  state.ready.clear();
  state.table = [];
  state.result = null;
  state.phase = 'clue';
  refillHands(state);
}

export function initDixitGame(
  roomCode: string,
  players: Array<{ playerId: string; displayName: string }>,
  rng: () => number = Math.random,
): DixitServerState {
  if (players.length < DIXIT_MIN_PLAYERS || players.length > DIXIT_MAX_PLAYERS
    || new Set(players.map(p => p.playerId)).size !== players.length) {
    throw new Error('Dixit Odyssey requires 3–12 unique players');
  }
  const state: DixitServerState = {
    roomCode, rulesVersion: DIXIT_RULES_VERSION, revision: 0, status: 'playing',
    terminationReason: null, phase: 'clue', roundNumber: 1, roundStartedRevision: 0,
    players: new Map(players.map(p => [p.playerId, { ...p, hand: [], score: 0, forfeited: false }])),
    turnOrder: players.map(p => p.playerId), roundPlayers: players.map(p => p.playerId),
    storytellerId: null, clue: null, drawPile: shuffled(DIXIT_CARD_IDS, rng), discardPile: [],
    submissions: new Map(), votes: new Map(), table: [], ready: new Set(), result: null,
    winnerIds: [], log: [], nextLogId: 1, rng,
  };
  refillHands(state);
  log(state, 'The first player with an idea may offer the opening clue.');
  return state;
}

export function dixitSubmissionCount(state: DixitServerState, playerId: string): number {
  return playerId === state.storytellerId ? 1 : state.roundPlayers.length === 3 ? 2 : 1;
}

function moveCardsToSubmission(state: DixitServerState, player: DixitServerPlayer, cards: DixitCardId[]): void {
  state.submissions.set(player.playerId, [...cards]);
  player.hand = player.hand.filter(card => !cards.includes(card));
}

function revealTableWhenReady(state: DixitServerState): void {
  if (!state.roundPlayers.every(id => state.submissions.has(id))) return;
  state.table = shuffled([...state.submissions.values()].flat(), state.rng);
  state.phase = 'vote';
  log(state, 'All illustrations are on the table. Cast both votes in secret.');
}

function scoreRound(state: DixitServerState): void {
  const storytellerId = state.storytellerId!;
  const storytellerCardId = state.submissions.get(storytellerId)![0]!;
  const correctSlot = state.table.indexOf(storytellerCardId) + 1;
  const totalVotes = [...state.votes.values()].flat().length;
  const correctVotes = [...state.votes.values()].flat().filter(slot => slot === correctSlot).length;
  const outcome = correctVotes === 0 ? 'none' : correctVotes === totalVotes ? 'all' : 'some';
  const scores = state.roundPlayers.map(playerId => {
    const storyteller = playerId === storytellerId;
    const ownCorrect = (state.votes.get(playerId) ?? []).filter(slot => slot === correctSlot).length;
    const ownSlots = (state.submissions.get(playerId) ?? []).map(card => state.table.indexOf(card) + 1);
    const decoyPoints = storyteller ? 0 : [...state.votes.values()].flat().filter(slot => ownSlots.includes(slot)).length;
    const cluePoints = storyteller && outcome === 'some' ? 3 : 0;
    const guessPoints = storyteller ? 0 : outcome === 'all' ? 4 : outcome === 'none' ? 2 : ownCorrect * 3;
    const total = cluePoints + guessPoints + decoyPoints;
    state.players.get(playerId)!.score += total;
    return { playerId, correctVotes: ownCorrect, cluePoints, guessPoints, decoyPoints, total };
  });
  state.result = {
    storytellerId, storytellerCardId, outcome,
    submissions: [...state.submissions].map(([playerId, cardIds]) => ({ playerId, cardIds: [...cardIds] })),
    votes: [...state.votes].map(([playerId, slots]) => ({ playerId, slots: [...slots] })), scores,
  };
  const highest = Math.max(...activeIds(state).map(id => state.players.get(id)!.score));
  if (highest >= DIXIT_WIN_SCORE) {
    state.winnerIds = activeIds(state).filter(id => state.players.get(id)!.score === highest);
    state.status = 'game_over';
    state.phase = 'game_over';
    log(state, 'The final scores are revealed.');
  } else {
    state.phase = 'reveal';
    log(state, 'Compare the clues and votes, then ready up for the next storyteller.');
  }
}

export function applyDixitAction(
  state: DixitServerState, playerId: string, action: DixitAction, expectedRevision: number,
  roundNumber?: number,
): DixitEngineResult {
  const simultaneous = action.type !== 'clue' && roundNumber === state.roundNumber;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < state.roundStartedRevision
    || expectedRevision > state.revision || (roundNumber !== undefined && roundNumber !== state.roundNumber)
    || (!simultaneous && expectedRevision !== state.revision)) {
    return reject('Game state changed. Please try again.');
  }
  const player = state.players.get(playerId);
  if (!player || player.forfeited || state.status !== 'playing') return reject('This seat cannot act.');
  if (action.type === 'clue') {
    if (state.phase !== 'clue' || (state.storytellerId !== null && state.storytellerId !== playerId)) {
      return reject('Wait for your turn as storyteller.');
    }
    if (typeof action.clue !== 'string') return reject('Enter a clue.');
    const clue = action.clue.trim();
    if (!clue || clue.length > DIXIT_CLUE_MAX_LENGTH || /[\u0000-\u001f\u007f]/u.test(clue)) {
      return reject(`Use a clue of 1–${DIXIT_CLUE_MAX_LENGTH} characters without control characters.`);
    }
    if (!player.hand.includes(action.cardId)) return reject('Choose an illustration from your hand.');
    state.storytellerId = playerId;
    state.clue = clue;
    moveCardsToSubmission(state, player, [action.cardId]);
    state.phase = 'submit';
    log(state, `${player.displayName} has shared a clue.`);
  } else if (action.type === 'submit') {
    if (state.phase !== 'submit' || playerId === state.storytellerId || state.submissions.has(playerId)) {
      return reject('You cannot submit illustrations now.');
    }
    if (!Array.isArray(action.cardIds) || action.cardIds.length !== dixitSubmissionCount(state, playerId)
      || new Set(action.cardIds).size !== action.cardIds.length
      || !action.cardIds.every(card => player.hand.includes(card))) {
      return reject('Choose the required number of different illustrations from your hand.');
    }
    moveCardsToSubmission(state, player, action.cardIds);
    revealTableWhenReady(state);
  } else if (action.type === 'vote') {
    if (state.phase !== 'vote' || playerId === state.storytellerId || state.votes.has(playerId)) {
      return reject('You cannot vote now.');
    }
    if (!Array.isArray(action.slots) || action.slots.length !== 2 || !action.slots.every(slot =>
      Number.isSafeInteger(slot) && slot >= 1 && slot <= state.table.length
      && !state.submissions.get(playerId)!.includes(state.table[slot - 1]!))) {
      return reject('Cast two votes, together or separately, without choosing your own illustrations.');
    }
    state.votes.set(playerId, [...action.slots]);
    if (state.votes.size === state.roundPlayers.length - 1) scoreRound(state);
  } else if (action.type === 'ready') {
    if (state.phase !== 'reveal' || state.ready.has(playerId)) return reject('You cannot ready up now.');
    state.ready.add(playerId);
    if (activeIds(state).every(id => state.ready.has(id))) {
      state.discardPile.push(...state.table);
      resetRound(state);
    }
  } else {
    return reject('Unknown action.');
  }
  state.revision++;
  return { ok: true };
}

export function forfeitDixitPlayers(
  state: DixitServerState, playerIds: string[], expectedRevision: number,
): DixitEngineResult {
  if (expectedRevision !== state.revision) return reject('Game state changed. Please try again.');
  if (state.status !== 'playing') return reject('This game has ended.');
  const departing = [...new Set(playerIds)].filter(id => state.players.has(id) && !state.players.get(id)!.forfeited);
  if (!departing.length) return reject('No active seats to forfeit.');
  for (const id of departing) state.players.get(id)!.forfeited = true;
  const scored = state.phase === 'reveal';
  for (const [id, cards] of state.submissions) {
    if (scored || state.players.get(id)!.forfeited) state.discardPile.push(...cards);
    else state.players.get(id)!.hand.push(...cards);
  }
  for (const id of departing) {
    const player = state.players.get(id)!;
    state.discardPile.push(...player.hand);
    player.hand = [];
    log(state, `${player.displayName} forfeited and left the voyage.`);
  }
  state.submissions.clear();
  state.votes.clear();
  state.table = [];
  state.ready.clear();
  state.result = null;
  if (activeIds(state).length < DIXIT_MIN_PLAYERS) {
    state.status = 'game_over';
    state.phase = 'game_over';
    state.terminationReason = 'not_enough_players';
    state.winnerIds = [];
    log(state, 'Fewer than three players remain. The game ends without a winner.');
  } else {
    if (!scored) log(state, 'The unfinished round is cancelled without points after a departure.');
    resetRound(state);
  }
  state.revision++;
  return { ok: true };
}
