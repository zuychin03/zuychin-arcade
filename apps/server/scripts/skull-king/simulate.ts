import type {
  SkullKingCard,
  SkullKingPlayedCard,
  SkullKingTigressMode,
} from '@zuychin-arcade/types';
import {
  SKULL_KING_MODE_DESCRIPTION,
  SKULL_KING_RULES_VERSION,
  skullKingCardsPerPlayer,
} from '@zuychin-arcade/types';
import { createSkullKingDeck } from '../../src/game/skull-king/deck.js';
import {
  forfeitPlayer,
  forfeitPlayers,
  initSkullKingGame,
  playCard,
  submitBid,
  validateSkullKingState,
  type EngineResult,
  type SkullKingServerState,
} from '../../src/game/skull-king/engine.js';
import {
  toSkullKingPrivateState,
  toSkullKingPublicState,
} from '../../src/game/skull-king/publicState.js';
import {
  deriveLeadSuit,
  legalCardIds,
  resolveTrick,
} from '../../src/game/skull-king/resolver.js';

let assertions = 0;

function assert(value: unknown, message: string): asserts value {
  assertions += 1;
  if (!value) throw new Error(message);
}

function assertThrows(action: () => unknown, message: string): void {
  let threw = false;
  try {
    action();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

function rngFor(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

const players = (count: number) => Array.from({ length: count }, (_, index) => ({
  playerId: 'p' + index,
  displayName: 'Captain ' + index,
}));

const card = (
  playerId: string,
  props: Omit<SkullKingPlayedCard, 'playerId' | 'id'> & { id?: string },
): SkullKingPlayedCard => ({
  id: props.id ?? playerId + '-' + props.kind,
  playerId,
  ...props,
});

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) => (
    permutations(values.filter((_candidate, candidateIndex) => candidateIndex !== index))
      .map((tail) => [value, ...tail])
  ));
}

function expectOk(result: EngineResult, message: string): void {
  assert(result.ok, message + (result.ok ? '' : ': ' + result.reason));
}

function fingerprint(state: SkullKingServerState): string {
  return JSON.stringify({
    public: toSkullKingPublicState(state),
    private: state.turnOrder.map((id) => toSkullKingPrivateState(state, id)),
  });
}

function expectRejectedWithoutMutation(
  state: SkullKingServerState,
  action: () => EngineResult,
  message: string,
): void {
  const before = fingerprint(state);
  const result = action();
  assert(!result.ok, message + ' should reject');
  assert(fingerprint(state) === before, message + ' must not mutate projections');
}

function focusedRules(): void {
  const deck = createSkullKingDeck();
  assert(deck.length === 70, 'classic-core deck must contain 70 cards');
  assert(new Set(deck.map((item) => item.id)).size === 70, 'deck IDs must be unique');
  assert(deck.filter((item) => item.kind === 'number').length === 56, 'deck must have 56 numbers');
  assert(deck.filter((item) => item.kind === 'pirate').length === 5, 'deck must have five pirates');
  assert(deck.filter((item) => item.kind === 'tigress').length === 1, 'deck must have Tigress');
  assert(deck.filter((item) => item.kind === 'skull_king').length === 1, 'deck must have Skull King');
  assert(deck.filter((item) => item.kind === 'mermaid').length === 2, 'deck must have two mermaids');
  assert(deck.filter((item) => item.kind === 'escape').length === 5, 'deck must have five escapes');
  for (const suit of ['green', 'purple', 'yellow', 'black']) {
    const ranks = deck
      .filter((item) => item.kind === 'number' && item.suit === suit)
      .map((item) => item.rank)
      .sort((a, b) => a! - b!);
    assert(JSON.stringify(ranks) === JSON.stringify(Array.from({ length: 14 }, (_, i) => i + 1)), suit + ' ranks must be 1-14');
  }

  assert(skullKingCardsPerPlayer(8, 8) === 8, 'eight players receive eight cards in round eight');
  assert(skullKingCardsPerPlayer(9, 8) === 8, 'eight-player round nine is capped at eight');
  assert(skullKingCardsPerPlayer(10, 8) === 8, 'eight-player round ten is capped at eight');
  assert(skullKingCardsPerPlayer(11, 8) === 8, 'eight-player tiebreakers remain capped at eight');
  assert(skullKingCardsPerPlayer(10, 7) === 10, 'seven players receive ten cards in round ten');

  const allEscapes = [
    card('p0', { id: 'escape-1', kind: 'escape' }),
    card('p1', { id: 'escape-2', kind: 'escape' }),
    card('p2', { id: 'tigress', kind: 'tigress', tigressMode: 'escape' }),
  ];
  assert(resolveTrick(allEscapes).winnerId === 'p0', 'first escape wins an all-escape trick');

  const deferredLead = [
    card('p0', { id: 'escape-1', kind: 'escape' }),
    card('p1', { id: 'tigress', kind: 'tigress', tigressMode: 'escape' }),
    card('p2', { id: 'green-4', kind: 'number', suit: 'green', rank: 4 }),
  ];
  assert(deriveLeadSuit(deferredLead) === 'green', 'escapes defer lead suit to the first number');
  assert(deriveLeadSuit([
    card('p0', { kind: 'pirate' }),
    card('p1', { kind: 'number', suit: 'green', rank: 4 }),
  ]) === null, 'a led character means there is no lead suit');
  assert(deriveLeadSuit([
    card('p0', { kind: 'tigress', tigressMode: 'pirate' }),
    card('p1', { kind: 'number', suit: 'green', rank: 4 }),
  ]) === null, 'Tigress as Pirate means there is no lead suit');

  const hand: SkullKingCard[] = [
    { id: 'g', kind: 'number', suit: 'green', rank: 1 },
    { id: 'y', kind: 'number', suit: 'yellow', rank: 14 },
    { id: 'e', kind: 'escape' },
    { id: 'p', kind: 'pirate' },
  ];
  const legal = legalCardIds(hand, deferredLead);
  assert(legal.includes('g'), 'lead-suit number is legal');
  assert(!legal.includes('y'), 'off-suit number is illegal when lead suit is held');
  assert(legal.includes('e') && legal.includes('p'), 'special cards remain legal while following suit');
  assert(legalCardIds(hand, [card('p0', { kind: 'pirate' })]).length === hand.length, 'no lead suit permits every card');

  const numbered = [
    card('p0', { id: 'green-4', kind: 'number', suit: 'green', rank: 4 }),
    card('p1', { id: 'green-13', kind: 'number', suit: 'green', rank: 13 }),
    card('p2', { id: 'yellow-14', kind: 'number', suit: 'yellow', rank: 14 }),
  ];
  assert(resolveTrick(numbered).winnerId === 'p1', 'highest lead-suit number beats off-suit numbers');
  const trump = [
    card('p0', { id: 'yellow-14', kind: 'number', suit: 'yellow', rank: 14 }),
    card('p1', { id: 'black-2', kind: 'number', suit: 'black', rank: 2 }),
    card('p2', { id: 'black-14', kind: 'number', suit: 'black', rank: 14 }),
  ];
  const trumpResult = resolveTrick(trump);
  assert(trumpResult.winnerId === 'p2', 'highest black trump wins');
  assert(trumpResult.bonus === 30, 'captured coloured and black 14s award 10 and 20');

  const royalCards = [
    card('pirate', { kind: 'pirate' }),
    card('king', { kind: 'skull_king' }),
    card('mermaid', { kind: 'mermaid' }),
  ];
  for (const ordering of permutations(royalCards)) {
    const result = resolveTrick(ordering);
    assert(result.winnerId === 'mermaid', 'mermaid wins every pirate/Skull King ordering');
    assert(result.bonus === 40, 'mermaid earns 40 for capturing Skull King');
  }
  assert(resolveTrick([
    card('p0', { id: 'pirate-1', kind: 'pirate' }),
    card('p1', { id: 'pirate-2', kind: 'pirate' }),
  ]).winnerId === 'p0', 'first pirate wins among pirates');
  assert(resolveTrick([
    card('p0', { id: 'mermaid-1', kind: 'mermaid' }),
    card('p1', { id: 'mermaid-2', kind: 'mermaid' }),
  ]).winnerId === 'p0', 'first mermaid wins among mermaids');

  const kingCapture = resolveTrick([
    card('p0', { id: 'pirate-1', kind: 'pirate' }),
    card('p1', { id: 'skull-king', kind: 'skull_king' }),
    card('p2', { id: 'tigress', kind: 'tigress', tigressMode: 'pirate' }),
  ]);
  assert(kingCapture.winnerId === 'p1' && kingCapture.bonus === 60, 'Skull King captures pirates including Tigress as Pirate');
  const noTigressBonus = resolveTrick([
    card('p0', { id: 'skull-king', kind: 'skull_king' }),
    card('p1', { id: 'tigress', kind: 'tigress', tigressMode: 'escape' }),
  ]);
  assert(noTigressBonus.bonus === 0, 'Tigress as Escape is not a captured pirate');
  const pirateCapture = resolveTrick([
    card('p0', { id: 'mermaid-1', kind: 'mermaid' }),
    card('p1', { id: 'pirate-1', kind: 'pirate' }),
    card('p2', { id: 'mermaid-2', kind: 'mermaid' }),
  ]);
  assert(pirateCapture.winnerId === 'p1' && pirateCapture.bonus === 40, 'pirate earns 20 per captured mermaid');
}

function focusedEngineGuards(): void {
  assertThrows(
    () => initSkullKingGame('TWO', players(2), () => 0.25),
    'unsupported two-player mode must reject',
  );
  assertThrows(
    () => initSkullKingGame('NINE', players(9), () => 0.25),
    'nine players must reject',
  );
  assertThrows(
    () => initSkullKingGame('DUP', [players(3)[0]!, players(3)[0]!, players(3)[2]!], () => 0.25),
    'duplicate player IDs must reject',
  );

  const state = initSkullKingGame('GUARDS', players(3), () => 0.25);
  expectRejectedWithoutMutation(state, () => submitBid(state, 'p0', -1, 0), 'negative bid');
  expectRejectedWithoutMutation(state, () => submitBid(state, 'p0', 2, 0), 'bid above hand size');
  expectRejectedWithoutMutation(state, () => submitBid(state, 'missing', 0, 0), 'missing bidder');
  expectRejectedWithoutMutation(state, () => submitBid(state, 'p0', 0, 1), 'future bid revision');

  const leaderIndex = state.turnOrder.indexOf(state.leaderId!);
  const order = Array.from({ length: 3 }, (_, offset) => (
    state.turnOrder[(leaderIndex + offset) % 3]!
  ));
  state.players.get(order[0]!)!.hand = [{ id: 'green-1', kind: 'number', suit: 'green', rank: 1 }];
  state.players.get(order[1]!)!.hand = [{ id: 'tigress', kind: 'tigress' }];
  state.players.get(order[2]!)!.hand = [{ id: 'escape-1', kind: 'escape', copy: 1 }];
  for (const id of state.turnOrder) expectOk(submitBid(state, id, 0, 0), 'shared-revision bid');
  expectRejectedWithoutMutation(
    state,
    () => playCard(state, order[1]!, 'tigress', 'escape', state.revision),
    'out-of-turn play',
  );
  expectRejectedWithoutMutation(
    state,
    () => playCard(state, order[0]!, 'green-1', 'pirate', state.revision),
    'mode on non-Tigress',
  );
  expectOk(playCard(state, order[0]!, 'green-1', undefined, state.revision), 'valid lead');
  expectRejectedWithoutMutation(
    state,
    () => playCard(state, order[1]!, 'tigress', undefined, state.revision),
    'Tigress without mode',
  );
  expectRejectedWithoutMutation(
    state,
    () => playCard(state, order[1]!, 'tigress', 'invalid', state.revision),
    'Tigress with invalid mode',
  );

  const follow = initSkullKingGame('FOLLOW', players(3), () => 0.25);
  follow.roundNumber = 2;
  follow.cardsPerPlayer = 2;
  follow.phase = 'trick_play';
  follow.trickNumber = 1;
  follow.leaderId = 'p0';
  follow.currentPlayerId = 'p1';
  follow.currentTrick = [
    card('p0', { id: 'green-5', kind: 'number', suit: 'green', rank: 5 }),
  ];
  follow.players.get('p0')!.hand = [{ id: 'black-1', kind: 'number', suit: 'black', rank: 1 }];
  follow.players.get('p1')!.hand = [
    { id: 'green-1', kind: 'number', suit: 'green', rank: 1 },
    { id: 'yellow-14', kind: 'number', suit: 'yellow', rank: 14 },
  ];
  follow.players.get('p2')!.hand = [
    { id: 'green-2', kind: 'number', suit: 'green', rank: 2 },
    { id: 'escape-1', kind: 'escape', copy: 1 },
  ];
  for (const player of follow.players.values()) player.bid = 0;
  expectRejectedWithoutMutation(
    follow,
    () => playCard(follow, 'p1', 'yellow-14', undefined, follow.revision),
    'failure to follow suit',
  );
}

function freshCanonicalResolverCases(): void {
  const deck = createSkullKingDeck();
  const variants = deck.flatMap((item): SkullKingPlayedCard[] => item.kind === 'tigress'
    ? [{ ...item, playerId: 'a', tigressMode: 'escape' }, { ...item, playerId: 'a', tigressMode: 'pirate' }]
    : [{ ...item, playerId: 'a' }]);
  const kind = (item: SkullKingPlayedCard) => item.kind === 'tigress' ? item.tigressMode! : item.kind;
  const beats: Record<string, string[]> = {
    escape: [], number: ['escape'], pirate: ['escape', 'number', 'mermaid'],
    skull_king: ['escape', 'number', 'pirate'], mermaid: ['escape', 'number', 'skull_king'],
  };
  for (const first of variants) {
    for (const second of variants) {
      if (first.id === second.id) continue;
      let secondWins = beats[kind(second)]!.includes(kind(first));
      if (kind(first) === 'number' && kind(second) === 'number') {
        secondWins = second.suit === first.suit ? second.rank! > first.rank! : second.suit === 'black';
      }
      const result = resolveTrick([{ ...first, playerId: 'a' }, { ...second, playerId: 'b' }]);
      assert(result.winnerId === (secondWins ? 'b' : 'a'), 'canonical ordered pair follows publisher hierarchy');
    }
  }

  const royal = ['skull-king', 'mermaid-1', 'pirate-1', 'tigress', 'black-14', 'purple-14']
    .map((id, index) => ({ ...deck.find((item) => item.id === id)!, playerId: 'p' + index,
      ...(id === 'tigress' ? { tigressMode: 'pirate' as const } : {}) }));
  for (const ordering of permutations(royal)) {
    const result = resolveTrick(ordering);
    assert(result.winnerId === 'p1', 'Mermaid beats the royal combination in every six-card ordering');
    assert(result.bonus === 70, 'Mermaid capture stacks both fourteen bonuses but not captured pirate bonuses');
  }
  for (const lead of variants) {
    const prefix = [{ ...deck.find((item) => item.id === 'escape-1')!, playerId: 'first' }, lead];
    if (lead.id === 'escape-1') continue;
    const legal = legalCardIds(deck.filter((item) => item.id !== lead.id && item.id !== 'escape-1'), prefix);
    for (const held of deck.filter((item) => item.id !== lead.id && item.id !== 'escape-1')) {
      const expected = lead.kind !== 'number' || held.kind !== 'number' || held.suit === lead.suit;
      assert(legal.includes(held.id) === expected, 'deferred lead permits specials and enforces only a numbered lead suit');
    }
  }
}

function freshScoringCases(): void {
  for (const bid of [0, 1, 2]) {
    const state = initSkullKingGame('SCORE-8', players(8), rngFor(73));
    state.roundNumber = 10;
    state.cardsPerPlayer = 8;
    state.trickNumber = 8;
    state.phase = 'trick_play';
    state.leaderId = 'p0';
    state.currentPlayerId = 'p7';
    const ids = ['escape-1', 'escape-2', 'escape-3', 'escape-4', 'escape-5', 'tigress', 'green-1', 'black-14'];
    const finalCards = ids.map((id, index) => ({ ...createSkullKingDeck().find((item) => item.id === id)!,
      playerId: 'p' + index, ...(id === 'tigress' ? { tigressMode: 'escape' as const } : {}) }));
    state.currentTrick = finalCards.slice(0, 7);
    for (const [index, player] of [...state.players.values()].entries()) {
      player.hand = index === 7 ? [createSkullKingDeck().find((item) => item.id === 'black-14')!] : [];
      player.bid = index === 7 ? bid : 0;
      player.tricksWon = index === 0 ? 7 : 0;
      player.totalScore = index === 1 ? 1000 : 0;
    }
    validateSkullKingState(state);
    expectOk(playCard(state, 'p7', 'black-14', undefined, state.revision), 'canonical eight-player scoring checkpoint');
    assert(state.players.get('p0')!.roundScore === -80, 'failed zero loses eight-card stake even in round ten');
    assert(state.players.get('p1')!.roundScore === 80, 'exact zero earns eight-card stake even in round ten');
    assert(state.players.get('p7')!.roundScore === (bid === 1 ? 40 : bid === 0 ? -80 : -10),
      'exact positive bid adds own fourteen bonus; missed bids discard the bonus');
    const earned = state.scoreHistory[0]!.players.find((player) => player.playerId === 'p7')!;
    assert(earned.baseScore === (bid === 1 ? 20 : bid === 0 ? -80 : -10)
      && earned.bonus === (bid === 1 ? 20 : 0), 'completed history separates base and earned bonus');
    const before = fingerprint(state);
    const projection = toSkullKingPublicState(state);
    projection.scoreHistory[0]!.players[0]!.totalScore = 999999;
    projection.scoreHistory[0]!.players.pop();
    assert(fingerprint(state) === before, 'public history is a deep copy of completed scoring');
  }
}

function freshInvariantCases(): void {
  const state = initSkullKingGame('CANONICAL', players(3), rngFor(83));
  const original = { ...state.players.get('p0')!.hand[0]! };
  state.players.get('p0')!.hand[0] = { ...original, kind: 'number', suit: 'black', rank: 99 };
  assertThrows(() => validateSkullKingState(state), 'a canonical ID must not disguise a different card face');
  state.players.get('p0')!.hand[0] = original;
  state.players.get('p0')!.totalScore = Number.NaN;
  assertThrows(() => validateSkullKingState(state), 'non-finite score must violate the state invariant');
}

function approvedDepartureCases(): void {
  const short = initSkullKingGame('BELOW-MINIMUM', players(3), rngFor(903));
  expectOk(forfeitPlayer(short, 'p0', short.revision), 'three-to-two departure');
  assert(short.status === 'game_over' && short.winnerIds.length === 0,
    'fewer than three eligible captains immediately ends without a winner');
  assert(short.scoreHistory.length === 0, 'an abandoned round is never scored');

  const state = initSkullKingGame('ROUND-GHOST', players(4), rngFor(904));
  const departed = state.turnOrder[state.dealerIndex]!;
  expectOk(forfeitPlayer(state, departed, state.revision), 'four-to-three departure');
  assert(state.turnOrder.includes(departed), 'ghost retains its current round seat');
  for (let actions = 0; state.roundNumber === 1 && actions < 20; actions += 1) step(state, rngFor(actions + 55));
  assert(state.roundNumber === 2, 'remaining captains finish the current round');
  assert(!state.turnOrder.includes(departed), 'forfeited seat is removed before the next deal');
  assert(state.players.get(departed)!.hand.length === 0, 'archived seat is not redealt');

  for (let count = 4; count <= 8; count += 1) {
    for (const timing of ['unbid', 'locked_bid', 'actor', 'leader', 'dealer', 'already_played'] as const) {
      const random = rngFor(1500 + count * 10);
      const game = initSkullKingGame('DEPARTURE-MATRIX', players(count), random);
      while (game.roundNumber < 3) step(game, random);
      const history = JSON.stringify(game.scoreHistory);
      const oldOrder = [...game.turnOrder];
      const oldDealer = game.dealerIndex;
      let leaving = oldOrder[oldDealer]!;
      if (timing === 'locked_bid') expectOk(submitBid(game, leaving, 2, game.revision), 'lock departing bid');
      if (['actor', 'leader', 'dealer', 'already_played'].includes(timing)) {
        while (game.phase === 'bidding') step(game, random);
        leaving = timing === 'dealer' ? oldOrder[oldDealer]! : game.currentPlayerId!;
        if (timing === 'leader' || timing === 'already_played') step(game, random);
      }
      const bid = game.players.get(leaving)!.bid;
      const score = game.players.get(leaving)!.totalScore;
      const existingCard = game.currentTrick.find((item) => item.playerId === leaving);
      const beforeRevision = game.revision;
      expectOk(forfeitPlayer(game, leaving, game.revision), `depart ${count} ${timing}`);
      assert(game.status === 'playing', 'at least three eligible captains preserve the round');
      assert(game.turnOrder.length === count && game.turnOrder.includes(leaving), 'ghost remains only in current rotation');
      assert(game.players.get(leaving)!.bid === (bid ?? 0), 'locked bid survives; only an unbid ghost gets zero');
      assert(game.players.get(leaving)!.totalScore === score, 'forfeiture preserves already earned total');
      assert(JSON.stringify(game.scoreHistory) === history, 'departure cannot rewrite completed rounds');
      if (game.phase === 'bidding') {
        const remainingBidder = game.turnOrder.find((id) => id !== leaving && game.players.get(id)!.bid === null)!;
        expectRejectedWithoutMutation(game, () => submitBid(game, remainingBidder, 0, beforeRevision),
          'pre-forfeiture bid revision cannot cross the membership change');
      }
      if (existingCard) assert(game.currentTrick.some((item) => item.id === existingCard.id), 'already played card stays in the active trick');
      expectRejectedWithoutMutation(game, () => submitBid(game, leaving, 0, game.revision), 'departed bidder cannot act');
      for (let actions = 0; game.roundNumber === 3 && actions < 100; actions += 1) step(game, random);
      assert(game.roundNumber === 4, 'ghost round settles normally');
      let nextDealer = (oldDealer + 1) % count;
      while (oldOrder[nextDealer] === leaving) nextDealer = (nextDealer + 1) % count;
      assert(game.turnOrder[game.dealerIndex] === oldOrder[nextDealer], 'dealer advances in the old clockwise order');
      assert(game.turnOrder.length === count - 1 && !game.turnOrder.includes(leaving), 'next deal removes ghost from rotation');
      assert(game.players.size === count && toSkullKingPublicState(game).players.length === count, 'historical seat remains public');
      const archived = game.players.get(leaving)!;
      assert(archived.hand.length === 0 && archived.bid === null && archived.tricksWon === 0 && archived.pendingBonus === 0,
        'archived seat holds no active round state');
      assert(toSkullKingPrivateState(game, leaving).hand.length === 0, 'archived private view receives no new hand');
      const ghostRow = game.scoreHistory.at(-1)!.players.find((row) => row.playerId === leaving)!;
      assert(ghostRow.forfeited && ghostRow.roundScore === 0 && ghostRow.totalScore === score, 'completed ghost round earns no reward');
      const completed = JSON.stringify(game.scoreHistory);
      while (game.roundNumber === 4) step(game, random);
      assert(!game.scoreHistory.at(-1)!.players.some((row) => row.playerId === leaving), 'later score history excludes archived seats');
      assert(JSON.stringify(game.scoreHistory.slice(0, -1)) === completed, 'later scoring cannot rewrite earlier history');
      assert(archived.totalScore === score && archived.hand.length === 0, 'archived total and empty hand remain stable');
      const publicCopy = toSkullKingPublicState(game);
      publicCopy.scoreHistory[0]!.players[0]!.totalScore = 123456;
      assert(JSON.stringify(game.scoreHistory.slice(0, -1)) === completed, 'archived history remains deeply isolated from projections');
    }
  }

  for (const round of [1, 8, 9, 10, 11]) {
    const game = departureFinalTrick(8, round);
    const leaving = game.turnOrder[game.dealerIndex]!;
    const oldOrder = [...game.turnOrder];
    expectOk(forfeitPlayer(game, leaving, game.revision), 'eight-to-seven final-trick departure');
    step(game, rngFor(round));
    if (round < 10) {
      assert(game.roundNumber === round + 1 && game.turnOrder.length === 7, 'eight-to-seven removes before next deal');
      assert(game.cardsPerPlayer === skullKingCardsPerPlayer(round + 1, 7), 'hand cap uses the next active count');
      assert(game.turnOrder[game.dealerIndex] === oldOrder[1], 'departed dealer still advances clockwise');
      assert(game.players.get(leaving)!.hand.length === 0, 'departed dealer never receives the enlarged deal');
    } else {
      assert(game.status === 'game_over' && game.terminationReason === null, 'eligible final round ends normally');
      assert(!game.winnerIds.includes(leaving), 'departed high scorer is excluded from final standings');
    }
  }

  for (const count of [3, 4, 5, 8]) {
    for (const phase of ['unbid', 'locked_bid', 'partial', 'final', 'round10', 'tiebreak'] as const) {
      const game = ['final', 'round10', 'tiebreak'].includes(phase)
        ? departureFinalTrick(count, phase === 'round10' ? 10 : phase === 'tiebreak' ? 11 : 2)
        : initSkullKingGame('ABANDON-MATRIX', players(count), rngFor(81));
      if (phase === 'locked_bid') expectOk(submitBid(game, 'p0', 1, game.revision), 'partially locked bidding');
      if (phase === 'partial') {
        while (game.phase === 'bidding') step(game, rngFor(91));
        step(game, rngFor(92));
      }
      const beforeHistory = JSON.stringify(game.scoreHistory);
      const beforeTotals = [...game.players.values()].map((player) => player.totalScore);
      const beforeRound = game.roundNumber;
      const leaving = game.turnOrder.slice(0, count - 2);
      expectOk(forfeitPlayers(game, leaving, game.revision), 'batch crosses three-player minimum');
      assert(game.status === 'game_over' && game.terminationReason === 'not_enough_players' && game.winnerIds.length === 0,
        'every below-minimum phase immediately abandons without a winner');
      assert(game.currentPlayerId === null && game.currentTrick.length === 0 && game.leaderId === null, 'abandonment clears pending play');
      assert(game.roundNumber === beforeRound && JSON.stringify(game.scoreHistory) === beforeHistory,
        'abandoned final trick cannot score or advance the round');
      assert(JSON.stringify([...game.players.values()].map((player) => player.totalScore)) === JSON.stringify(beforeTotals),
        'abandonment preserves every completed total');
      if (phase === 'locked_bid') assert(!toSkullKingPublicState(game).bidsRevealed
        && toSkullKingPublicState(game).players.every((player) => player.bid === null), 'abandoned hidden bids remain private');
      expectRejectedWithoutMutation(game, () => forfeitPlayers(game, game.turnOrder, game.revision), 'terminal departure cannot rewrite result');
      validateSkullKingState(game);
    }
  }
  const all = initSkullKingGame('ALL-LEFT', players(5), rngFor(93));
  expectRejectedWithoutMutation(all, () => forfeitPlayers(all, ['p0', 'missing'], all.revision), 'invalid batch is atomic');
  expectOk(forfeitPlayers(all, [...all.turnOrder, 'p0'], all.revision), 'all seats depart in one deduplicated batch');
  assert(all.winnerIds.length === 0 && [...all.players.values()].every((player) => player.forfeited), 'no phantom last absent winner');

  for (const round of [2, 10, 11]) {
    const game = departureFinalTrick(4, round);
    expectOk(forfeitPlayer(game, 'p3', game.revision), 'final actor departs with three eligible remaining');
    assert(game.lastTrick?.roundNumber === round, 'last-card ghost resolves the committed trick');
    assert(game.scoreHistory.length === 1 && game.scoreHistory[0]!.players.find((row) => row.playerId === 'p3')!.roundScore === 0,
      'last-card ghost earns no score when its automatic play completes the round');
    assert(round < 10 ? game.roundNumber === 3 && !game.turnOrder.includes('p3') : game.status === 'game_over',
      'automatic final card either removes ghost before redeal or completes a normal eligible result');
  }
  const tied = departureFinalTrick(4, 10);
  tied.players.get('p1')!.totalScore = tied.players.get('p2')!.totalScore = 500;
  tied.players.get('p3')!.totalScore = 0;
  expectOk(forfeitPlayer(tied, 'p0', tied.revision), 'departed high scorer before tied finish');
  step(tied, rngFor(22));
  assert(tied.roundNumber === 11 && tied.turnOrder.length === 3 && !tied.turnOrder.includes('p0'),
    'tie-break deal removes ghost and keeps all remaining eligible captains');
  assert(tied.players.get('p0')!.hand.length === 0 && tied.terminationReason === null, 'archived seat cannot re-enter tie-break');

  for (const duringTrick of [false, true]) {
    const game = initSkullKingGame('MULTI-GHOST', players(6), rngFor(131));
    if (duringTrick) {
      while (game.phase === 'bidding') step(game, rngFor(41));
      step(game, rngFor(42));
    }
    const departures = game.turnOrder.slice(0, 3);
    const oldOrder = [...game.turnOrder];
    const oldDealer = game.dealerIndex;
    expectOk(forfeitPlayers(game, departures, game.revision), 'batch leaves three eligible captains');
    while (game.roundNumber === 1) step(game, rngFor(43));
    assert(game.turnOrder.length === 3 && departures.every((id) => !game.turnOrder.includes(id)), 'all batch ghosts leave the next rotation together');
    let index = (oldDealer + 1) % oldOrder.length;
    while (departures.includes(oldOrder[index]!)) index = (index + 1) % oldOrder.length;
    assert(game.turnOrder[game.dealerIndex] === oldOrder[index], 'dealer skips a contiguous batch in old clockwise order');
    assert(departures.every((id) => game.players.get(id)!.hand.length === 0), 'batch archives receive no replacement cards');
  }
}

function departureFinalTrick(count: number, round: number): SkullKingServerState {
  const game = initSkullKingGame('DEPART-FINAL', players(count), rngFor(31));
  game.roundNumber = round;
  game.cardsPerPlayer = skullKingCardsPerPlayer(round, count);
  game.trickNumber = game.cardsPerPlayer;
  game.dealerIndex = 0;
  game.leaderId = 'p0';
  game.currentPlayerId = 'p' + (count - 1);
  game.phase = 'trick_play';
  const deck = createSkullKingDeck();
  game.currentTrick = deck.slice(0, count - 1).map((item, index) => ({ ...item, playerId: 'p' + index }));
  for (const [index, player] of [...game.players.values()].entries()) {
    player.hand = index === count - 1 ? [{ ...deck[count - 1]! }] : [];
    player.bid = 0;
    player.tricksWon = index === 0 ? game.cardsPerPlayer - 1 : 0;
    player.totalScore = index === 0 ? 10000 : index * 100;
  }
  validateSkullKingState(game);
  return game;
}

function prepareFinalTrickFixture(
  state: SkullKingServerState,
  roundNumber: number,
  totals: [number, number, number],
): void {
  const [first, second, third] = state.turnOrder;
  state.roundNumber = roundNumber;
  state.cardsPerPlayer = 10;
  state.status = 'playing';
  state.phase = 'trick_play';
  state.trickNumber = 10;
  state.leaderId = first!;
  state.currentPlayerId = third!;
  state.currentTrick = [
    card(first!, { id: 'escape-1', kind: 'escape', copy: 1 }),
    card(second!, { id: 'escape-2', kind: 'escape', copy: 2 }),
  ];
  state.winnerIds = [];
  state.biddingRevision = state.revision;
  const bids = [4, 3, 3];
  state.turnOrder.forEach((id, index) => {
    const player = state.players.get(id)!;
    player.hand = index === 2 ? [{ id: 'escape-3', kind: 'escape', copy: 3 }] : [];
    player.bid = bids[index]!;
    player.tricksWon = 3;
    player.pendingBonus = 0;
    player.totalScore = totals[index]!;
    player.forfeited = false;
  });
  validateSkullKingState(state);
}

function focusedTiebreaker(): void {
  const state = initSkullKingGame('TIE', players(3), () => 0.25);
  prepareFinalTrickFixture(state, 10, [920, 940, -1_000]);
  expectOk(
    playCard(state, state.turnOrder[2]!, 'escape-3', undefined, state.revision),
    'round ten final trick',
  );
  assert(state.status === 'playing', 'a tied lead continues after round ten');
  assert(state.roundNumber === 11, 'tie creates round eleven');
  assert(state.cardsPerPlayer === 10, 'three-player tiebreaker deals ten cards');
  assert(state.players.get(state.turnOrder[0]!)!.totalScore === 1_000, 'first leader tied at 1000');
  assert(state.players.get(state.turnOrder[1]!)!.totalScore === 1_000, 'second leader tied at 1000');
  assert(state.lastTrick?.roundNumber === 10, 'last trick identifies its completed round');

  prepareFinalTrickFixture(state, 11, [1_000, 1_000, -1_000]);
  expectOk(
    playCard(state, state.turnOrder[2]!, 'escape-3', undefined, state.revision),
    'tiebreaker final trick',
  );
  assert((state.status as string) === 'game_over', 'unique tiebreak lead ends the match');
  assert(state.winnerIds[0] === state.turnOrder[0], 'unique tiebreak leader wins');
  assert(Number(state.lastTrick?.roundNumber) === 11, 'tiebreaker last trick identifies round eleven');
}

interface ExpectedRoundScore {
  roundScore: number;
  totalScore: number;
}

function previewFinalRoundScores(
  state: SkullKingServerState,
  selected: SkullKingCard,
  mode: SkullKingTigressMode | undefined,
): Map<string, ExpectedRoundScore> {
  const actorId = state.currentPlayerId!;
  const played: SkullKingPlayedCard = { ...selected, playerId: actorId };
  if (selected.kind === 'tigress') played.tigressMode = mode;
  const resolved = resolveTrick([...state.currentTrick, played]);
  return new Map(state.turnOrder.map((id) => {
    const player = state.players.get(id)!;
    if (player.forfeited) {
      return [id, { roundScore: 0, totalScore: player.totalScore }];
    }
    const tricksWon = player.tricksWon + (resolved.winnerId === id ? 1 : 0);
    const pendingBonus = player.pendingBonus + (resolved.winnerId === id ? resolved.bonus : 0);
    const exact = player.bid === tricksWon;
    const base = player.bid === 0
      ? (exact ? 10 * state.cardsPerPlayer : -10 * state.cardsPerPlayer)
      : (exact ? 20 * tricksWon : -10 * Math.abs(player.bid! - tricksWon));
    const roundScore = base + (exact ? pendingBonus : 0);
    return [id, { roundScore, totalScore: player.totalScore + roundScore }];
  }));
}

const roundLedgers = new WeakMap<SkullKingServerState, {
  round: number; dealt: Set<string>; completed: Map<number, SkullKingPlayedCard[]>;
}>();

function checkProjections(state: SkullKingServerState): void {
  validateSkullKingState(state);
  let ledger = roundLedgers.get(state);
  if (!ledger || ledger.round !== state.roundNumber) {
    assert(state.phase === 'bidding', 'fresh conservation ledger starts at a complete deal');
    ledger = { round: state.roundNumber, dealt: new Set([...state.players.values()].flatMap((player) =>
      player.hand.map((item) => item.id))), completed: new Map() };
    roundLedgers.set(state, ledger);
  }
  if (state.lastTrick?.roundNumber === state.roundNumber) {
    ledger.completed.set(state.lastTrick.trickNumber, state.lastTrick.cards);
  }
  if (state.status === 'playing' || ![...state.players.values()].some((player) => player.forfeited)) {
    const roundCards = [...state.players.values()].flatMap((player) => player.hand)
      .concat(state.currentTrick, [...ledger.completed.values()].flat());
    assert(roundCards.length === ledger.dealt.size, 'dealt cards persist in hands, current trick or completed tricks');
    assert(new Set(roundCards.map((item) => item.id)).size === roundCards.length,
      'no physical card repeats anywhere in the round');
    assert(roundCards.every((item) => ledger.dealt.has(item.id)), 'no undealt card enters the round');
  }
  const publicState = toSkullKingPublicState(state);
  assert(publicState.revision === state.revision, 'public revision matches server');
  assert(publicState.rulesVersion === SKULL_KING_RULES_VERSION, 'rules contract is projected');
  assert(publicState.modeDescription === SKULL_KING_MODE_DESCRIPTION, 'mode exclusions are projected');
  assert(!('biddingRevision' in publicState), 'bidding revision fence remains internal');
  assert(!('rng' in publicState), 'random source remains internal');
  assert(publicState.players.length === state.players.size, 'active and archived seats remain public');
  assert(publicState.scoreHistory.length === state.scoreHistory.length, 'completed score rows are projected');
  for (const round of state.scoreHistory) {
    assert(round.roundNumber < state.roundNumber || state.phase === 'game_over', 'current bids never enter score history');
    for (const player of round.players) {
      assert(player.roundScore === player.baseScore + player.bonus, 'history total reconciles base and bonus');
      assert(player.bid === player.tricksWon || player.bonus === 0, 'missed bids never publish an earned bonus');
    }
  }
  assert(
    publicState.players.reduce((sum, player) => sum + player.cardCount, 0)
      === [...state.players.values()].reduce((sum, player) => sum + player.hand.length, 0),
    'public hand counts match without exposing hands',
  );
  if (state.phase === 'bidding') {
    assert(publicState.players.every((player) => player.bid === null), 'bids stay hidden while bidding');
    const roundLabel = state.roundNumber > 10 ? 'Tiebreaker' : `Round ${state.roundNumber}`;
    assert(state.log.some((entry) => entry.text === `${roundLabel} begins with ${state.cardsPerPlayer} ${state.cardsPerPlayer === 1 ? 'card' : 'cards'} each.`),
      'round-deal log uses singular or plural card wording');
  }
  for (const id of state.players.keys()) {
    const privateState = toSkullKingPrivateState(state, id);
    const serverPlayer = state.players.get(id)!;
    assert(privateState.revision === publicState.revision, 'public/private revisions match');
    assert(privateState.roomCode === publicState.roomCode && privateState.roomCode === state.roomCode,
      'public/private room identities match');
    assert(privateState.playerId === id, 'private identity belongs to the requested seat');
    assert(
      JSON.stringify(privateState.hand) === JSON.stringify(serverPlayer.hand),
      'private projection contains exactly the owner hand',
    );
    const expectedLegal = state.phase === 'trick_play' && state.currentPlayerId === id
      ? legalCardIds(serverPlayer.hand, state.currentTrick)
      : [];
    assert(
      JSON.stringify(privateState.legalCardIds) === JSON.stringify(expectedLegal),
      'only current actor receives legal card IDs',
    );
    assert(privateState.submittedBid === serverPlayer.bid, 'private bid projection matches owner');
  }
  if (state.roundNumber === 1 && state.phase === 'bidding') {
    const publicJson = JSON.stringify(publicState);
    for (const player of state.players.values()) {
      for (const privateCard of player.hand) {
        assert(!publicJson.includes(privateCard.id), 'opening private card cannot leak publicly');
      }
    }
  }
}

function step(state: SkullKingServerState, random: () => number): void {
  if (state.phase === 'bidding') {
    const player = [...state.players.values()]
      .find((candidate) => !candidate.forfeited && candidate.bid === null)!;
    const bid = Math.floor(random() * (state.cardsPerPlayer + 1));
    expectOk(
      submitBid(state, player.playerId, bid, state.biddingRevision),
      'valid same-round shared-revision bid',
    );
    return;
  }

  if (state.phase !== 'trick_play') return;
  const actor = state.players.get(state.currentPlayerId!)!;
  assert(!actor.forfeited, 'forfeiture recovery cannot leave an autopilot actor pending');
  const ids = legalCardIds(actor.hand, state.currentTrick);
  const chosen = ids[Math.floor(random() * ids.length)]!;
  const selected = actor.hand.find((candidate) => candidate.id === chosen)!;
  const mode = selected.kind === 'tigress'
    ? (random() < 0.5 ? 'pirate' : 'escape')
    : undefined;
  const completesRound = actor.hand.length === 1
    && state.currentTrick.length === state.turnOrder.length - 1;
  const expectedScores = completesRound
    ? previewFinalRoundScores(state, selected, mode)
    : null;
  expectOk(
    playCard(state, actor.playerId, chosen, mode, state.revision),
    'legal card should be accepted',
  );
  if (expectedScores) {
    for (const [id, expected] of expectedScores) {
      const player = state.players.get(id)!;
      assert(player.roundScore === expected.roundScore, 'round score follows classic scoring');
      assert(player.totalScore === expected.totalScore, 'total score applies round score once');
    }
  }
}

function simulate(playerCount: number, seed: number): void {
  const random = rngFor(seed);
  const state = initSkullKingGame('SIM-' + seed, players(playerCount), random);
  assert(state.cardsPerPlayer === 1, 'game starts with one card');
  assert(state.log.at(-1)?.text === 'Round 1 begins with 1 card each.', 'opening round uses singular card copy');
  checkProjections(state);

  expectOk(submitBid(state, 'p0', 0, state.biddingRevision), 'first bid accepted');
  const afterBid = fingerprint(state);
  const rejected = submitBid(state, 'p0', 1, state.biddingRevision);
  assert(!rejected.ok && fingerprint(state) === afterBid, 'duplicate bid is atomic');
  assert(toSkullKingPrivateState(state, 'p0').submittedBid === 0, 'bidder sees private bid');

  let actions = 0;
  while (state.status === 'playing' && actions < 4_000) {
    step(state, random);
    checkProjections(state);
    actions += 1;
  }
  assert(state.status === 'game_over', 'seeded game ' + seed + ' should finish');
  assert(state.winnerIds.length === 1, 'normal game has a unique winner');
  assert(state.roundNumber >= 10, 'normal game plays all ten rounds');
  assert(!state.players.get(state.winnerIds[0]!)!.forfeited, 'winner remains eligible');
}

function simulateForfeit(playerCount: number, seed: number): void {
  const random = rngFor(seed);
  const state = initSkullKingGame('FORFEIT-' + seed, players(playerCount), random);
  checkProjections(state);
  for (let warmup = 0; warmup < playerCount + 2; warmup += 1) {
    step(state, random);
    checkProjections(state);
  }
  const candidateIds = state.turnOrder.filter((id) => !state.players.get(id)!.forfeited);
  const departedId = candidateIds[seed % candidateIds.length]!;
  const totalAtForfeit = state.players.get(departedId)!.totalScore;
  expectOk(forfeitPlayer(state, departedId, state.revision), 'forfeit should be accepted');
  assert(state.players.get(departedId)!.forfeited, 'departed seat is marked forfeited');
  checkProjections(state);

  let actions = 0;
  while (state.status === 'playing' && actions < 4_000) {
    step(state, random);
    checkProjections(state);
    actions += 1;
  }
  assert(state.status === 'game_over', 'forfeit game should finish');
  assert(!state.winnerIds.includes(departedId), 'forfeited seat cannot win');
  assert(state.players.get(departedId)!.totalScore === totalAtForfeit, 'forfeited total stops changing');
  assert(state.players.get(departedId)!.roundScore === 0, 'forfeited seat scores zero');
  assert(playerCount === 3 ? state.terminationReason === 'not_enough_players' && state.winnerIds.length === 0
    : state.terminationReason === null && !state.turnOrder.includes(departedId),
  'forfeiture either abandons below minimum or removes the ghost before future deals');
}

function main(): void {
  freshCanonicalResolverCases();
  freshScoringCases();
  freshInvariantCases();
  approvedDepartureCases();
  focusedRules();
  focusedEngineGuards();
  focusedTiebreaker();

  let games = 0;
  for (let count = 3; count <= 8; count += 1) {
    for (let index = 0; index < Number(process.env.SK_GAMES_PER_COUNT ?? 250); index += 1) {
      simulate(count, Number(process.env.SK_SEED_OFFSET ?? 0) + count * 100_000 + index + 1);
      games += 1;
    }
  }

  let forfeitGames = 0;
  for (let count = 3; count <= 8; count += 1) {
    for (let index = 0; index < Number(process.env.SK_FORFEIT_GAMES_PER_COUNT ?? 10); index += 1) {
      simulateForfeit(count, Number(process.env.SK_SEED_OFFSET ?? 0) + 900_000 + count * 100 + index);
      forfeitGames += 1;
    }
  }
  console.log(
    'SKULL KING SIM PASS: '
      + games
      + ' complete seeded games plus '
      + forfeitGames
      + ' complete forfeiture games (3-8 players), '
      + assertions
      + ' assertions.',
  );
}

main();
