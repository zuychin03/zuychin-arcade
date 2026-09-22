import type {
  SkullKingCard, SkullKingPlayedCard, SkullKingRoundScore, SkullKingTigressMode, SkullKingTrickResult,
} from '@zuychin-arcade/types';
import {
  SKULL_KING_MAX_PLAYERS, SKULL_KING_MIN_PLAYERS, SKULL_KING_ROUNDS,
  SKULL_KING_RULES_VERSION, skullKingCardsPerPlayer,
} from '@zuychin-arcade/types';
import { createSkullKingDeck, shuffleSkullKingDeck, type RandomSource } from './deck.js';
import { isTigressMode, legalCardIds, resolveTrick } from './resolver.js';

export interface SkullKingServerPlayer {
  playerId: string;
  displayName: string;
  hand: SkullKingCard[];
  bid: number | null;
  tricksWon: number;
  pendingBonus: number;
  roundScore: number;
  totalScore: number;
  exactLastRound: boolean | null;
  forfeited: boolean;
}

export interface SkullKingServerState {
  roomCode: string;
  revision: number;
  biddingRevision: number;
  rulesVersion: string;
  status: 'playing' | 'game_over';
  terminationReason: 'not_enough_players' | null;
  phase: 'bidding' | 'trick_play' | 'game_over';
  roundNumber: number;
  cardsPerPlayer: number;
  trickNumber: number;
  players: Map<string, SkullKingServerPlayer>;
  turnOrder: string[];
  dealerIndex: number;
  leaderId: string | null;
  currentPlayerId: string | null;
  currentTrick: SkullKingPlayedCard[];
  lastTrick: SkullKingTrickResult | null;
  scoreHistory: SkullKingRoundScore[];
  winnerIds: string[];
  log: { id: number; text: string }[];
  nextLogId: number;
  rng: RandomSource;
}

export type EngineResult = { ok: true } | { ok: false; reason: string };
const RECOVERY_ACTION_LIMIT = 1_024;
const CANONICAL_CARDS = new Map(createSkullKingDeck().map((card) => [card.id, card]));
const ok = (): EngineResult => ({ ok: true });
const reject = (reason: string): EngineResult => ({ ok: false, reason });

function addLog(state: SkullKingServerState, text: string): void {
  state.log.push({ id: state.nextLogId++, text });
  if (state.log.length > 40) state.log.shift();
}

function nextIndex(state: SkullKingServerState, index: number): number {
  return (index + 1) % state.turnOrder.length;
}

function nextPlayerId(state: SkullKingServerState, playerId: string): string {
  return state.turnOrder[nextIndex(state, state.turnOrder.indexOf(playerId))]!;
}

function isRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function stale(state: SkullKingServerState, expectedRevision: number): EngineResult | null {
  return !isRevision(expectedRevision) || expectedRevision !== state.revision
    ? reject('Game state changed. Please try again.')
    : null;
}

function staleBid(state: SkullKingServerState, expectedRevision: number): EngineResult | null {
  return !isRevision(expectedRevision)
    || expectedRevision < state.biddingRevision
    || expectedRevision > state.revision
    ? reject('Game state changed. Please try again.')
    : null;
}

function dealRound(state: SkullKingServerState, biddingRevision: number): void {
  state.biddingRevision = biddingRevision;
  state.cardsPerPlayer = skullKingCardsPerPlayer(state.roundNumber, state.turnOrder.length);
  const deck = shuffleSkullKingDeck(state.rng);
  for (const player of state.players.values()) {
    player.hand = [];
    player.bid = null;
    player.tricksWon = 0;
    player.pendingBonus = 0;
  }
  const firstRecipient = nextIndex(state, state.dealerIndex);
  for (let card = 0; card < state.cardsPerPlayer; card += 1) {
    for (let offset = 0; offset < state.turnOrder.length; offset += 1) {
      const playerId = state.turnOrder[(firstRecipient + offset) % state.turnOrder.length]!;
      state.players.get(playerId)!.hand.push(deck.pop()!);
    }
  }
  for (const player of state.players.values()) {
    player.hand.sort((a, b) => {
      if (a.kind === 'number' && b.kind === 'number') {
        return (a.suit ?? '').localeCompare(b.suit ?? '') || a.rank! - b.rank!;
      }
      if (a.kind === 'number') return -1;
      if (b.kind === 'number') return 1;
      return a.kind.localeCompare(b.kind);
    });
  }
  state.phase = 'bidding';
  state.trickNumber = 1;
  state.leaderId = state.turnOrder[firstRecipient]!;
  state.currentPlayerId = null;
  state.currentTrick = [];
  addLog(
    state,
    `${state.roundNumber > SKULL_KING_ROUNDS ? 'Tiebreaker' : `Round ${state.roundNumber}`} begins with ${state.cardsPerPlayer} ${state.cardsPerPlayer === 1 ? 'card' : 'cards'} each.`,
  );
}

export function initSkullKingGame(
  roomCode: string,
  playerList: { playerId: string; displayName: string }[],
  rng: RandomSource = Math.random,
): SkullKingServerState {
  if (playerList.length < SKULL_KING_MIN_PLAYERS || playerList.length > SKULL_KING_MAX_PLAYERS) {
    throw new Error(`Skull King needs ${SKULL_KING_MIN_PLAYERS}-${SKULL_KING_MAX_PLAYERS} players`);
  }
  if (new Set(playerList.map((player) => player.playerId)).size !== playerList.length) {
    throw new Error('Skull King player IDs must be unique');
  }
  if (playerList.some((player) => !player.playerId || !player.displayName)) {
    throw new Error('Skull King players need an ID and display name');
  }

  const state: SkullKingServerState = {
    roomCode,
    revision: 0,
    biddingRevision: 0,
    rulesVersion: SKULL_KING_RULES_VERSION,
    status: 'playing',
    terminationReason: null,
    phase: 'bidding',
    roundNumber: 1,
    cardsPerPlayer: 1,
    trickNumber: 1,
    players: new Map(playerList.map((player) => [player.playerId, {
      ...player,
      hand: [],
      bid: null,
      tricksWon: 0,
      pendingBonus: 0,
      roundScore: 0,
      totalScore: 0,
      exactLastRound: null,
      forfeited: false,
    }])),
    turnOrder: playerList.map((player) => player.playerId),
    dealerIndex: Math.floor(rng() * playerList.length),
    leaderId: null,
    currentPlayerId: null,
    currentTrick: [],
    lastTrick: null,
    scoreHistory: [],
    winnerIds: [],
    log: [],
    nextLogId: 1,
    rng,
  };
  dealRound(state, 0);
  validateSkullKingState(state);
  return state;
}

function beginTrickPlayIfReady(state: SkullKingServerState): void {
  if (!state.turnOrder.every((id) => state.players.get(id)!.bid !== null)) return;
  state.phase = 'trick_play';
  state.currentPlayerId = state.leaderId;
  addLog(
    state,
    `All bids revealed: ${state.turnOrder.map((id) => `${state.players.get(id)!.displayName} ${state.players.get(id)!.bid}`).join(' · ')}`,
  );
}

function recordBid(
  state: SkullKingServerState,
  player: SkullKingServerPlayer,
  bid: number,
): void {
  player.bid = bid;
  addLog(state, `${player.displayName} locked a bid.`);
  beginTrickPlayIfReady(state);
}

function finishFromForfeitures(state: SkullKingServerState): boolean {
  const eligible = state.turnOrder.filter((id) => !state.players.get(id)!.forfeited);
  if (eligible.length >= SKULL_KING_MIN_PLAYERS) return false;
  state.status = 'game_over';
  state.phase = 'game_over';
  state.currentPlayerId = null;
  state.leaderId = null;
  state.currentTrick = [];
  state.winnerIds = [];
  state.terminationReason = 'not_enough_players';
  addLog(state, 'The voyage ended without a winner: fewer than three eligible captains remain. The unfinished round is not scored.');
  return true;
}

function scoreRound(state: SkullKingServerState, nextRevision: number): void {
  const round: SkullKingRoundScore = {
    roundNumber: state.roundNumber, cardsPerPlayer: state.cardsPerPlayer, players: [],
  };
  for (const playerId of state.turnOrder) {
    const player = state.players.get(playerId)!;
    if (player.forfeited) {
      player.roundScore = 0;
      player.exactLastRound = null;
      round.players.push({ playerId, displayName: player.displayName, bid: player.bid!, tricksWon: player.tricksWon,
        baseScore: 0, bonus: 0, roundScore: 0, totalScore: player.totalScore, forfeited: true });
      addLog(state, `${player.displayName}'s forfeited seat scores 0.`);
      continue;
    }
    const exact = player.bid === player.tricksWon;
    const base = player.bid === 0
      ? (exact ? 10 * state.cardsPerPlayer : -10 * state.cardsPerPlayer)
      : (exact ? 20 * player.tricksWon : -10 * Math.abs(player.bid! - player.tricksWon));
    const bonus = exact ? player.pendingBonus : 0;
    player.roundScore = base + bonus;
    player.totalScore += player.roundScore;
    player.exactLastRound = exact;
    round.players.push({ playerId, displayName: player.displayName, bid: player.bid!, tricksWon: player.tricksWon,
      baseScore: base, bonus, roundScore: player.roundScore, totalScore: player.totalScore, forfeited: false });
    addLog(
      state,
      `${player.displayName}: ${player.roundScore >= 0 ? '+' : ''}${player.roundScore} (${player.tricksWon}/${player.bid} tricks${bonus ? `, +${bonus} bonus` : ''}).`,
    );
  }

  state.scoreHistory.push(round);

  if (state.roundNumber >= SKULL_KING_ROUNDS) {
    const eligible = state.turnOrder.filter((id) => !state.players.get(id)!.forfeited);
    if (eligible.length < SKULL_KING_MIN_PLAYERS) {
      finishFromForfeitures(state);
      return;
    }
    const topScore = Math.max(...eligible.map((id) => state.players.get(id)!.totalScore));
    const leaders = eligible.filter((id) => state.players.get(id)!.totalScore === topScore);
    if (leaders.length === 1) {
      state.status = 'game_over';
      state.phase = 'game_over';
      state.currentPlayerId = null;
      state.winnerIds = leaders;
      addLog(state, `${state.players.get(leaders[0]!)!.displayName} rules the high seas with ${topScore} points!`);
      return;
    }
    addLog(state, 'The lead is tied. All eligible captains sail into another round.');
  }

  state.roundNumber += 1;
  // Locate the next eligible dealer in the old clockwise order before removing ghosts.
  let nextDealerIndex = nextIndex(state, state.dealerIndex);
  while (state.players.get(state.turnOrder[nextDealerIndex]!)!.forfeited) {
    nextDealerIndex = nextIndex(state, nextDealerIndex);
  }
  const nextDealerId = state.turnOrder[nextDealerIndex]!;
  state.turnOrder = state.turnOrder.filter((id) => !state.players.get(id)!.forfeited);
  state.dealerIndex = state.turnOrder.indexOf(nextDealerId);
  dealRound(state, nextRevision);
}

function playCardUnchecked(
  state: SkullKingServerState,
  player: SkullKingServerPlayer,
  cardIndex: number,
  tigressMode: SkullKingTigressMode | undefined,
  nextRevision: number,
  automatic: boolean,
): void {
  const [card] = player.hand.splice(cardIndex, 1);
  const played: SkullKingPlayedCard = { ...card!, playerId: player.playerId };
  if (card!.kind === 'tigress') played.tigressMode = tigressMode;
  state.currentTrick.push(played);
  addLog(
    state,
    automatic
      ? `${player.displayName}'s forfeited seat played ${describeCard(played)}.`
      : `${player.displayName} played ${describeCard(played)}.`,
  );

  if (state.currentTrick.length < state.turnOrder.length) {
    state.currentPlayerId = nextPlayerId(state, player.playerId);
    return;
  }

  const resolved = resolveTrick(state.currentTrick);
  const winner = state.players.get(resolved.winnerId)!;
  winner.tricksWon += 1;
  winner.pendingBonus += resolved.bonus;
  state.lastTrick = {
    roundNumber: state.roundNumber,
    trickNumber: state.trickNumber,
    winnerId: winner.playerId,
    winnerName: winner.displayName,
    reason: resolved.reason,
    bonus: resolved.bonus,
    cards: state.currentTrick.map((playedCard) => ({ ...playedCard })),
  };
  addLog(
    state,
    `${winner.displayName} wins trick ${state.trickNumber}${resolved.bonus ? ` and banks a ${resolved.bonus}-point bonus` : ''}.`,
  );
  state.currentTrick = [];
  if (state.turnOrder.every((id) => state.players.get(id)!.hand.length === 0)) {
    scoreRound(state, nextRevision);
  } else {
    state.trickNumber += 1;
    state.leaderId = winner.playerId;
    state.currentPlayerId = winner.playerId;
  }
}

function settleForfeitedPlayers(state: SkullKingServerState, nextRevision: number): void {
  for (let step = 0; step < RECOVERY_ACTION_LIMIT && state.status === 'playing'; step += 1) {
    if (state.phase === 'bidding') {
      const forfeitedBidder = state.turnOrder
        .map((id) => state.players.get(id)!)
        .find((player) => player.forfeited && player.bid === null);
      if (!forfeitedBidder) return;
      recordBid(state, forfeitedBidder, 0);
      continue;
    }
    if (state.phase === 'trick_play') {
      const actor = state.players.get(state.currentPlayerId!);
      if (!actor?.forfeited) return;
      const legalIds = legalCardIds(actor.hand, state.currentTrick);
      const cardIndex = actor.hand.findIndex((card) => card.id === legalIds[0]);
      if (cardIndex < 0) throw new Error('Forfeited Skull King seat has no legal card');
      const mode = actor.hand[cardIndex]!.kind === 'tigress' ? 'escape' : undefined;
      playCardUnchecked(state, actor, cardIndex, mode, nextRevision, true);
      continue;
    }
    return;
  }
  if (state.status === 'playing') throw new Error('Skull King forfeiture recovery exceeded its action limit');
}

export function submitBid(
  state: SkullKingServerState,
  playerId: string,
  bid: number,
  expectedRevision: number,
): EngineResult {
  const staleResult = staleBid(state, expectedRevision);
  if (staleResult) return staleResult;
  if (state.phase !== 'bidding') return reject('Bidding is closed');
  const player = state.players.get(playerId);
  if (!player) return reject('Player is not in this game');
  if (player.forfeited) return reject('This seat has forfeited');
  if (player.bid !== null) return reject('Your bid is already locked');
  if (!Number.isSafeInteger(bid) || bid < 0 || bid > state.cardsPerPlayer) {
    return reject('Bid is outside the valid range');
  }

  const nextRevision = state.revision + 1;
  recordBid(state, player, bid);
  settleForfeitedPlayers(state, nextRevision);
  state.revision = nextRevision;
  validateSkullKingState(state);
  return ok();
}

export function playCard(
  state: SkullKingServerState,
  playerId: string,
  cardId: string,
  tigressMode: unknown,
  expectedRevision: number,
): EngineResult {
  const staleResult = stale(state, expectedRevision);
  if (staleResult) return staleResult;
  if (state.phase !== 'trick_play') return reject('Cards cannot be played right now');
  if (state.currentPlayerId !== playerId) return reject('It is not your turn');
  const player = state.players.get(playerId);
  if (!player) return reject('Player is not in this game');
  if (player.forfeited) return reject('This seat has forfeited');
  const handIndex = player.hand.findIndex((card) => card.id === cardId);
  if (handIndex < 0) return reject('That card is not in your hand');
  const card = player.hand[handIndex]!;
  if (!legalCardIds(player.hand, state.currentTrick).includes(cardId)) {
    return reject('You must follow the lead suit');
  }
  if (card.kind === 'tigress' && !isTigressMode(tigressMode)) {
    return reject('Choose Pirate or Escape for the Tigress');
  }
  if (card.kind !== 'tigress' && tigressMode !== undefined) {
    return reject('Only the Tigress needs a mode');
  }

  const nextRevision = state.revision + 1;
  playCardUnchecked(
    state,
    player,
    handIndex,
    card.kind === 'tigress' ? tigressMode as SkullKingTigressMode : undefined,
    nextRevision,
    false,
  );
  settleForfeitedPlayers(state, nextRevision);
  state.revision = nextRevision;
  validateSkullKingState(state);
  return ok();
}

export function forfeitPlayers(
  state: SkullKingServerState,
  playerIds: readonly string[],
  expectedRevision: number,
): EngineResult {
  const staleResult = stale(state, expectedRevision);
  if (staleResult) return staleResult;
  if (state.status !== 'playing') return reject('Game is already over');
  const uniquePlayerIds = [...new Set(playerIds)];
  if (uniquePlayerIds.length === 0) return reject('No seats were selected for forfeiture');
  const players = uniquePlayerIds.map((playerId) => state.players.get(playerId));
  if (players.some((player) => !player)) return reject('Player is not in this game');
  const newlyForfeited = players.filter((player) => !player!.forfeited) as SkullKingServerPlayer[];
  if (newlyForfeited.length === 0) return reject('Every selected seat has already forfeited');

  const nextRevision = state.revision + 1;
  for (const player of newlyForfeited) {
    player.forfeited = true;
    player.roundScore = 0;
    player.exactLastRound = null;
    addLog(state, `${player.displayName} forfeited and cannot score or win. Their seat finishes only this round with deterministic legal cards, then leaves the rotation.`);
  }
  if (!finishFromForfeitures(state)) settleForfeitedPlayers(state, nextRevision);
  state.revision = nextRevision;
  state.biddingRevision = nextRevision;
  validateSkullKingState(state);
  return ok();
}

export function forfeitPlayer(
  state: SkullKingServerState,
  playerId: string,
  expectedRevision: number,
): EngineResult {
  return forfeitPlayers(state, [playerId], expectedRevision);
}

function describeCard(card: SkullKingPlayedCard): string {
  if (card.kind === 'number') return `${card.suit} ${card.rank}`;
  if (card.kind === 'tigress') return `Tigress as ${card.tigressMode}`;
  return card.kind.replace('_', ' ');
}

export function validateSkullKingState(state: SkullKingServerState): void {
  const playerCount = state.turnOrder.length;
  if (playerCount < SKULL_KING_MIN_PLAYERS || playerCount > SKULL_KING_MAX_PLAYERS) {
    throw new Error('Skull King player count is outside the supported mode');
  }
  if (state.players.size < playerCount || state.players.size > SKULL_KING_MAX_PLAYERS) {
    throw new Error('Turn order/player mismatch');
  }
  if (new Set(state.turnOrder).size !== playerCount) throw new Error('Duplicate player in turn order');
  if (state.turnOrder.some((id) => !state.players.has(id))) throw new Error('Turn order contains a missing player');
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error('Invalid game revision');
  if (
    !Number.isSafeInteger(state.biddingRevision)
    || state.biddingRevision < 0
    || state.biddingRevision > state.revision
  ) throw new Error('Invalid bidding revision');
  if (!Number.isSafeInteger(state.roundNumber) || state.roundNumber < 1) throw new Error('Invalid round number');
  if (state.cardsPerPlayer !== skullKingCardsPerPlayer(state.roundNumber, playerCount)) {
    throw new Error('Wrong hand size for this round');
  }
  if (!Number.isInteger(state.dealerIndex) || state.dealerIndex < 0 || state.dealerIndex >= playerCount) {
    throw new Error('Invalid dealer');
  }
  if (state.leaderId !== null && !state.turnOrder.includes(state.leaderId)) throw new Error('Invalid trick leader');
  if (state.currentPlayerId !== null && !state.turnOrder.includes(state.currentPlayerId)) {
    throw new Error('Invalid current player');
  }
  if (state.currentTrick.length > playerCount) throw new Error('Trick contains too many cards');
  if (new Set(state.currentTrick.map((card) => card.playerId)).size !== state.currentTrick.length) {
    throw new Error('Player acted twice in a trick');
  }
  if (state.currentTrick.some((card) => !state.turnOrder.includes(card.playerId))) {
    throw new Error('Trick contains a missing player');
  }
  if (state.leaderId && state.currentTrick.some((card, index) => (
    card.playerId !== state.turnOrder[
      (state.turnOrder.indexOf(state.leaderId!) + index) % playerCount
    ]
  ))) throw new Error('Cards were played out of turn order');

  for (const player of state.players.values()) {
    if (!state.turnOrder.includes(player.playerId) && (!player.forfeited || player.hand.length !== 0
      || player.bid !== null || player.tricksWon !== 0 || player.pendingBonus !== 0)) {
      throw new Error('Archived seat retains active round state');
    }
    if (player.bid !== null && (
      !Number.isSafeInteger(player.bid) || player.bid < 0 || player.bid > state.cardsPerPlayer
    )) throw new Error('Player has an invalid bid');
    if (!Number.isSafeInteger(player.tricksWon) || player.tricksWon < 0) {
      throw new Error('Player has an invalid trick count');
    }
    if (!Number.isSafeInteger(player.pendingBonus) || player.pendingBonus < 0) {
      throw new Error('Player has an invalid pending bonus');
    }
    if (!Number.isSafeInteger(player.roundScore) || !Number.isSafeInteger(player.totalScore)) {
      throw new Error('Player has an invalid score');
    }
  }

  const liveCards = [
    ...[...state.players.values()].flatMap((player) => player.hand),
    ...state.currentTrick,
  ];
  if (new Set(liveCards.map((card) => card.id)).size !== liveCards.length) {
    throw new Error('A live card appears more than once');
  }
  for (const card of [...liveCards, ...state.lastTrick?.cards ?? []]) {
    const canonical = CANONICAL_CARDS.get(card.id);
    if (!canonical || card.kind !== canonical.kind || card.suit !== canonical.suit
      || card.rank !== canonical.rank || card.copy !== canonical.copy) {
      throw new Error('Card identity differs from the canonical deck');
    }
  }
  for (const card of [...state.currentTrick, ...state.lastTrick?.cards ?? []]) {
    if (card.kind === 'tigress' ? !isTigressMode(card.tigressMode) : card.tigressMode !== undefined) {
      throw new Error('Played card has an invalid Tigress mode');
    }
  }

  if (state.status === 'playing') {
    if (state.terminationReason !== null) throw new Error('Playing game cannot have a termination reason');
    if (state.phase === 'game_over') throw new Error('Playing game cannot use the game-over phase');
    if (state.winnerIds.length !== 0) throw new Error('Playing game cannot have a winner');
    if (state.turnOrder.filter((id) => !state.players.get(id)!.forfeited).length < SKULL_KING_MIN_PLAYERS) {
      throw new Error('Playing game needs at least three eligible captains');
    }
  } else if (state.phase !== 'game_over') {
    throw new Error('Finished game must use the game-over phase');
  }

  if (state.phase === 'bidding') {
    if (state.currentPlayerId !== null || state.currentTrick.length !== 0) {
      throw new Error('Bidding cannot expose an actor or active trick');
    }
    if (state.turnOrder.some((id) => state.players.get(id)!.hand.length !== state.cardsPerPlayer)) {
      throw new Error('Bidding hands have the wrong size');
    }
    if (state.turnOrder.some((id) => state.players.get(id)!.forfeited && state.players.get(id)!.bid === null)) {
      throw new Error('Forfeited seats must bid automatically');
    }
    if (state.turnOrder.every((id) => state.players.get(id)!.bid !== null)) {
      throw new Error('Completed bidding must advance to trick play');
    }
  }

  if (state.phase === 'trick_play') {
    if (!state.currentPlayerId || !state.leaderId) throw new Error('Trick play needs an actor and leader');
    if (state.turnOrder.some((id) => state.players.get(id)!.bid === null)) {
      throw new Error('Trick play needs every bid');
    }
    if (state.players.get(state.currentPlayerId)!.forfeited) {
      throw new Error('A forfeited seat cannot remain the active actor');
    }
    const completedTricks = state.trickNumber - 1;
    if (completedTricks < 0 || completedTricks >= state.cardsPerPlayer) {
      throw new Error('Invalid trick number');
    }
    const expectedTricks = state.turnOrder.reduce((sum, id) => sum + state.players.get(id)!.tricksWon, 0);
    if (expectedTricks !== completedTricks) throw new Error('Completed trick count mismatch');
    const remainingBeforeTrick = state.cardsPerPlayer - completedTricks;
    const playedIds = new Set(state.currentTrick.map((card) => card.playerId));
    for (const id of state.turnOrder) {
      const player = state.players.get(id)!;
      const expectedHand = remainingBeforeTrick - (playedIds.has(player.playerId) ? 1 : 0);
      if (player.hand.length !== expectedHand) throw new Error('Player hand size is inconsistent with the trick');
    }
    const expectedActor = state.turnOrder[
      (state.turnOrder.indexOf(state.leaderId) + state.currentTrick.length) % playerCount
    ];
    if (state.currentPlayerId !== expectedActor) throw new Error('Wrong actor for the active trick');
  }

  if (state.status === 'game_over') {
    if (state.currentPlayerId !== null || state.currentTrick.length !== 0) {
      throw new Error('Finished game cannot retain a pending trick or actor');
    }
    if (new Set(state.winnerIds).size !== state.winnerIds.length) {
      throw new Error('Finished game repeats a winner');
    }
    const eligible = state.turnOrder.filter((id) => !state.players.get(id)!.forfeited);
    const abandoned = state.terminationReason === 'not_enough_players';
    if (abandoned !== (eligible.length < SKULL_KING_MIN_PLAYERS)) {
      throw new Error('Termination reason does not match eligible captain count');
    }
    if (state.terminationReason !== null && !abandoned) throw new Error('Invalid termination reason');
    const expectedWinnerCount = abandoned ? 0 : 1;
    if (state.winnerIds.length !== expectedWinnerCount) {
      throw new Error('Finished game has the wrong number of winners');
    }
    if (state.winnerIds.some((id) => !state.players.has(id) || state.players.get(id)!.forfeited)) {
      throw new Error('Finished game winner is not eligible');
    }
  }
}
