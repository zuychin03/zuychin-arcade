/**
 * Deterministic Coup regression suite and full-game simulation. Run with:
 *   pnpm --filter @zuychin-arcade/server simulate:coup
 */
import type { CoupActionPayload, CoupCharacter } from '@zuychin-arcade/types';
import { ACTION_META, charactersForVariant, copiesPerCharacter } from '@zuychin-arcade/types';
import {
  chooseExchange,
  declareAction,
  expireWindow,
  forfeitPlayer,
  forfeitPlayers,
  initGame,
  loseInfluence,
  resolveAbsentDecision,
  resolveChallenge,
  respond,
  type CoupServerState,
  type EngineResult,
} from '../../src/game/coup/engine.js';
import { toPrivateState, toPublicState } from '../../src/game/coup/publicState.js';

let assertions = 0;
function assert(condition: boolean, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

function expectOk(result: EngineResult, message: string): void {
  assert(result.ok, `${message}: ${result.ok ? '' : result.reason}`);
}

const INITIAL_SEED = Number(process.env.COUP_SEED ?? 0xc0a7_2026);
if (!Number.isSafeInteger(INITIAL_SEED) || INITIAL_SEED < 0 || INITIAL_SEED > 0xffff_ffff) throw new Error('COUP_SEED must be an unsigned 32-bit integer');
let seed = INITIAL_SEED;
function random(): number {
  seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
  return seed / 4_294_967_296;
}

const rand = <T,>(values: T[]): T => values[Math.floor(random() * values.length)]!;
const chance = (probability: number): boolean => random() < probability;
const aliveCards = (influences: { revealed: boolean }[]): number =>
  influences.filter((influence) => !influence.revealed).length;

function players(count: number): { playerId: string; displayName: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `p${index}`,
    displayName: `P${index}`,
  }));
}

function newState(count = 3): CoupServerState {
  return initGame('TEST-1', 'base', players(count));
}

function snapshot(state: CoupServerState): string {
  return JSON.stringify({
    ...state,
    players: [...state.players.entries()],
    pending: {
      ...state.pending,
      passed: [...state.pending.passed],
      exchangePool: state.pending.exchangePool ? [...state.pending.exchangePool] : null,
    },
    deck: [...state.deck],
    log: state.log.map((entry) => ({ ...entry })),
  });
}

function expectRejectedWithoutMutation(
  state: CoupServerState,
  operation: () => EngineResult,
  message: string,
): void {
  const before = snapshot(state);
  const revision = state.revision;
  const result = operation();
  assert(!result.ok, `${message} should be rejected`);
  assert(state.revision === revision, `${message} changed revision`);
  assert(snapshot(state) === before, `${message} mutated state`);
}

function expectOneRevision(state: CoupServerState, operation: () => EngineResult, message: string): void {
  const revision = state.revision;
  expectOk(operation(), message);
  assert(state.revision === revision + 1, `${message} increments revision exactly once`);
}

function rigHands(state: CoupServerState, hands: Record<string, CoupCharacter[]>): void {
  const locked = new Set<object>();
  for (const [playerId, characters] of Object.entries(hands)) {
    const player = state.players.get(playerId)!;
    assert(characters.length === player.influences.length, `rigged hand length for ${playerId}`);
    characters.forEach((character, index) => {
      const target = player.influences[index]!;
      if (target.character !== character) {
        const deckIndex = state.deck.indexOf(character);
        if (deckIndex >= 0) {
          state.deck[deckIndex] = target.character;
          target.character = character;
        } else {
          const source = [...state.players.values()]
            .flatMap((candidate) => candidate.influences)
            .find((influence) => influence !== target && !locked.has(influence) && influence.character === character);
          assert(Boolean(source), `unable to rig ${character} for ${playerId}`);
          const old = target.character;
          target.character = source!.character;
          source!.character = old;
        }
      }
      locked.add(target);
    });
  }
}

function revealForScenario(state: CoupServerState, playerId: string, index: number): void {
  const player = state.players.get(playerId)!;
  player.influences[index]!.revealed = true;
  player.eliminated = aliveCards(player.influences) === 0;
}

function totalCardCount(state: CoupServerState): number {
  return copiesPerCharacter(state.turnOrder.length) * charactersForVariant(state.variant).length;
}

function assertCardConservation(state: CoupServerState, message: string): void {
  const influenceEntries = [...state.players.values()].reduce(
    (total, player) => total + player.influences.length,
    0,
  );
  const exchangeDraw =
    state.pending.phase === 'awaiting_exchange' && state.pending.exchangePool
      ? state.pending.exchangePool.length - state.pending.exchangeKeep
      : 0;
  assert(
    state.deck.length + influenceEntries + exchangeDraw === totalCardCount(state),
    `${message}: card conservation`,
  );
  const cards = [...state.deck, ...[...state.players.values()].flatMap((player) => player.influences.map((card) => card.character))];
  if (state.pending.phase === 'awaiting_exchange' && state.pending.exchangePool) {
    cards.push(...state.pending.exchangePool.slice(state.pending.exchangeKeep));
    const original = state.players.get(state.pending.actorId)!.influences.filter((card) => !card.revealed).map((card) => card.character).sort();
    assert(JSON.stringify(original) === JSON.stringify(state.pending.exchangePool.slice(0, state.pending.exchangeKeep).sort()), `${message}: Exchange retains the original hand prefix`);
  }
  for (const character of charactersForVariant(state.variant)) {
    assert(cards.filter((card) => card === character).length === copiesPerCharacter(state.turnOrder.length), `${message}: exact ${character} multiplicity`);
  }
}

function passCurrentWindow(state: CoupServerState): void {
  const responder = toPublicState(state).pending.waitingOn[0];
  assert(Boolean(responder), `phase ${state.pending.phase} has a responder`);
  expectOk(
    respond(state, responder!, { response: 'pass', expectedRevision: state.revision }),
    `${responder} passes ${state.pending.phase}`,
  );
}

function passUntilPhaseChanges(state: CoupServerState, phase: CoupServerState['pending']['phase']): void {
  while (state.pending.phase === phase) passCurrentWindow(state);
}

function testSetupAndProjection(): void {
  for (let count = 2; count <= 6; count += 1) {
    const state = newState(count);
    assert(state.revision === 0, `${count}-player game starts at revision zero`);
    assert(state.turnOrder.length === count, `${count}-player turn order`);
    assert(state.deck.length === 15 - count * 2, `${count}-player deck size`);
    assertCardConservation(state, `${count}-player deal`);
    for (const character of charactersForVariant('base')) {
      const copies = [
        ...state.deck,
        ...[...state.players.values()].flatMap((player) => player.influences.map((influence) => influence.character)),
      ].filter((candidate) => candidate === character).length;
      assert(copies === 3, `${count}-player deck has three ${character} cards`);
    }
    for (const [index, id] of state.turnOrder.entries()) {
      const expected = count === 2 && index === 0 ? 1 : 2;
      assert(state.players.get(id)!.coins === expected, `${count}-player starting coins for ${id}`);
    }
    const pub = toPublicState(state);
    const priv = toPrivateState(state, state.turnOrder[0])!;
    assert(pub.gameId === 'coup' && priv.gameId === 'coup', 'projections identify Coup explicitly');
    assert(pub.revision === 0 && priv.revision === 0, 'projections expose the same revision');
    assert(!('influences' in (pub.players[0] as object)), 'public player does not expose influences');
  }

  for (const count of [0, 1, 7]) {
    let threw = false;
    try {
      newState(count);
    } catch (error) {
      threw = error instanceof RangeError;
    }
    assert(threw, `base setup rejects ${count} players`);
  }
  let duplicateThrew = false;
  try {
    initGame('DUP', 'base', [
      { playerId: 'same', displayName: 'A' },
      { playerId: 'same', displayName: 'B' },
    ]);
  } catch (error) {
    duplicateThrew = error instanceof TypeError;
  }
  assert(duplicateThrew, 'setup rejects duplicate player ids');
}

function testMalformedAndStaleInputs(): void {
  const state = newState();
  expectRejectedWithoutMutation(
    state,
    () => declareAction(state, 'p0', { action: 'income', expectedRevision: 1 }),
    'stale action',
  );
  expectRejectedWithoutMutation(
    state,
    () => declareAction(state, 'p0', { action: '__proto__', expectedRevision: 0 } as never),
    'prototype action',
  );
  expectRejectedWithoutMutation(
    state,
    () => declareAction(state, 'p0', { action: 'income', targetPlayerId: 'p1', expectedRevision: 0 }),
    'extraneous action target',
  );
  expectRejectedWithoutMutation(
    state,
    () => declareAction(state, 'p0', { action: 'steal', targetPlayerId: '', expectedRevision: 0 }),
    'empty target',
  );
  state.players.get('p1')!.coins = 0;
  expectRejectedWithoutMutation(
    state,
    () => declareAction(state, 'p0', { action: 'steal', targetPlayerId: 'p1', expectedRevision: 0 }),
    'coinless Steal target',
  );
  state.players.get('p1')!.coins = 2;
  expectRejectedWithoutMutation(state, () => declareAction(state, 'p0', null as never), 'null action payload');

  expectOk(declareAction(state, 'p0', { action: 'tax', expectedRevision: 0 }), 'declare Tax');
  expectRejectedWithoutMutation(
    state,
    () => respond(state, 'p1', { response: 'pass', blockCharacter: 'duke', expectedRevision: 1 }),
    'pass with block character',
  );
  expectRejectedWithoutMutation(
    state,
    () => respond(state, 'p1', { response: 'bogus', expectedRevision: 1 } as never),
    'unknown response',
  );
  expectRejectedWithoutMutation(state, () => respond(state, 'p1', null as never), 'null response payload');
}

function testEveryMutationBoundaryAndProjectionCopy(): void {
  const idle = newState();
  expectRejectedWithoutMutation(
    idle,
    () => loseInfluence(idle, 'p0', 'duke', idle.revision),
    'loss outside a loss phase',
  );
  expectRejectedWithoutMutation(
    idle,
    () => chooseExchange(idle, 'p0', ['duke'], idle.revision),
    'exchange outside an exchange phase',
  );
  expectRejectedWithoutMutation(
    idle,
    () => resolveChallenge(idle, 'p0', true, idle.revision),
    'proof outside a challenge decision',
  );
  expectRejectedWithoutMutation(
    idle,
    () => expireWindow(idle, idle.revision),
    'expiry outside a timed phase',
  );
  expectRejectedWithoutMutation(
    idle,
    () => forfeitPlayer(idle, 'missing', idle.revision),
    'unknown forfeit player',
  );

  const targets = newState();
  targets.players.get('p0')!.coins = 7;
  expectRejectedWithoutMutation(
    targets,
    () => declareAction(targets, 'p0', { action: 'coup', targetPlayerId: 'p0', expectedRevision: 0 }),
    'self target',
  );
  expectRejectedWithoutMutation(
    targets,
    () => declareAction(targets, 'p0', { action: 'steal', targetPlayerId: 'missing', expectedRevision: 0 }),
    'unknown target',
  );
  targets.players.get('p1')!.influences.forEach((influence) => { influence.revealed = true; });
  targets.players.get('p1')!.eliminated = true;
  expectRejectedWithoutMutation(
    targets,
    () => declareAction(targets, 'p0', { action: 'steal', targetPlayerId: 'p1', expectedRevision: 0 }),
    'eliminated target',
  );

  const challenge = newState();
  rigHands(challenge, { p0: ['assassin', 'captain'] });
  expectOneRevision(
    challenge,
    () => declareAction(challenge, 'p0', { action: 'tax', expectedRevision: challenge.revision }),
    'open challenge window',
  );
  expectOneRevision(
    challenge,
    () => respond(challenge, 'p1', { response: 'challenge', expectedRevision: challenge.revision }),
    'open claimant decision',
  );
  expectRejectedWithoutMutation(
    challenge,
    () => resolveChallenge(challenge, 'p0', false, challenge.revision - 1),
    'stale claimant decision',
  );
  expectRejectedWithoutMutation(
    challenge,
    () => resolveChallenge(challenge, 'p1', false, challenge.revision),
    'non-claimant challenge decision',
  );
  expectRejectedWithoutMutation(
    challenge,
    () => resolveChallenge(challenge, 'p0', true, challenge.revision),
    'proof without the claimed card',
  );
  expectOneRevision(
    challenge,
    () => resolveChallenge(challenge, 'p0', false, challenge.revision),
    'valid concession',
  );

  const loss = newState();
  loss.players.get('p0')!.coins = 7;
  expectOneRevision(
    loss,
    () => declareAction(loss, 'p0', { action: 'coup', targetPlayerId: 'p1', expectedRevision: 0 }),
    'open influence choice',
  );
  expectRejectedWithoutMutation(
    loss,
    () => loseInfluence(loss, 'p1', 'inquisitor', loss.revision),
    'loss of a card not held',
  );
  expectRejectedWithoutMutation(
    loss,
    () => loseInfluence(loss, 'p2', loss.players.get('p2')!.influences[0]!.character, loss.revision),
    'loss chosen by the wrong player',
  );
  expectRejectedWithoutMutation(
    loss,
    () => loseInfluence(loss, 'p1', loss.players.get('p1')!.influences[0]!.character, loss.revision - 1),
    'stale influence choice',
  );
  expectOneRevision(
    loss,
    () => loseInfluence(loss, 'p1', loss.players.get('p1')!.influences[0]!.character, loss.revision),
    'valid influence choice',
  );

  const exchange = newState();
  expectOneRevision(
    exchange,
    () => declareAction(exchange, 'p0', { action: 'exchange', expectedRevision: 0 }),
    'open Exchange claim',
  );
  passUntilPhaseChanges(exchange, 'awaiting_action_challenge');
  const exchangeProjection = toPublicState(exchange);
  const originalLog = exchange.log[0]!.text;
  exchangeProjection.log[0]!.text = 'tampered';
  exchangeProjection.players[0]!.revealedCharacters.push('inquisitor');
  exchangeProjection.pending.responded.push('tampered');
  assert(exchange.log[0]!.text === originalLog, 'public log projection is detached');
  assert(exchange.players.get('p0')!.influences.every((influence) => !influence.revealed), 'public cards are detached');
  assert(!exchange.pending.passed.has('tampered'), 'public response list is detached');
  const keep = exchange.pending.exchangePool!.slice(0, exchange.pending.exchangeKeep);
  expectRejectedWithoutMutation(
    exchange,
    () => chooseExchange(exchange, 'p0', keep, exchange.revision - 1),
    'stale exchange choice',
  );
  expectRejectedWithoutMutation(
    exchange,
    () => chooseExchange(exchange, 'p1', keep, exchange.revision),
    'exchange chosen by the wrong player',
  );
  expectRejectedWithoutMutation(
    exchange,
    () => chooseExchange(exchange, 'p0', Array(exchange.pending.exchangeKeep).fill('inquisitor'), exchange.revision),
    'exchange cards outside the private pool',
  );
  expectOneRevision(
    exchange,
    () => chooseExchange(exchange, 'p0', keep, exchange.revision),
    'valid exchange choice',
  );
  assertCardConservation(exchange, 'mutation-boundary Exchange');

  const timer = newState();
  expectOneRevision(
    timer,
    () => declareAction(timer, 'p0', { action: 'tax', expectedRevision: 0 }),
    'open expiring response window',
  );
  expectRejectedWithoutMutation(
    timer,
    () => expireWindow(timer, timer.revision - 1),
    'stale window expiry',
  );
  expectOneRevision(timer, () => expireWindow(timer, timer.revision), 'valid window expiry');

  const forfeit = newState();
  expectRejectedWithoutMutation(
    forfeit,
    () => forfeitPlayer(forfeit, 'p0', forfeit.revision + 1),
    'stale forfeit',
  );
  expectOneRevision(forfeit, () => forfeitPlayer(forfeit, 'p0', forfeit.revision), 'valid forfeit');
}

function testAssassinationChallengeOrdering(): void {
  const state = newState();
  rigHands(state, { p0: ['assassin', 'duke'], p1: ['contessa', 'captain'] });
  state.players.get('p0')!.coins = 3;
  state.players.get('p1')!.coins = 5;

  expectOk(
    declareAction(state, 'p0', { action: 'assassinate', targetPlayerId: 'p1', expectedRevision: 0 }),
    'declare assassination',
  );
  expectOk(respond(state, 'p1', { response: 'challenge', expectedRevision: 1 }), 'target challenges Assassin');
  assert(state.pending.phase === 'awaiting_challenge_decision', 'claimant chooses proof response');
  assert(toPublicState(state).pending.waitingOn[0] === 'p0', 'claimant is the only proof responder');
  expectOk(resolveChallenge(state, 'p0', true, 2), 'Assassin is proved');
  assert(String(state.pending.phase) === 'awaiting_lose_influence', 'target chooses first challenge loss');
  expectOk(loseInfluence(state, 'p1', 'captain', 3), 'target loses challenge influence');
  assert(state.players.get('p1')!.eliminated, 'target takes the second assassination loss');
  assert(state.players.get('p1')!.coins === 0, 'eliminated target returns remaining coins');
  assert(state.players.get('p0')!.coins === 0, 'proved assassination remains paid');
  assert(String(state.pending.phase) === 'awaiting_action', 'target does not receive a late Contessa window');
  assert(state.revision === 4, 'double-danger transition increments revision once');
  assertCardConservation(state, 'double-danger assassination');

  const thirdParty = newState();
  rigHands(thirdParty, { p0: ['assassin', 'duke'], p1: ['contessa', 'captain'] });
  thirdParty.players.get('p0')!.coins = 3;
  expectOk(
    declareAction(thirdParty, 'p0', { action: 'assassinate', targetPlayerId: 'p1', expectedRevision: 0 }),
    'declare third-party-tested assassination',
  );
  expectOk(respond(thirdParty, 'p2', { response: 'challenge', expectedRevision: 1 }), 'third party challenges Assassin');
  expectOk(resolveChallenge(thirdParty, 'p0', true, 2), 'prove to third party');
  const loss = thirdParty.players.get('p2')!.influences.find((influence) => !influence.revealed)!;
  expectOk(loseInfluence(thirdParty, 'p2', loss.character, 3), 'third party loses influence');
  assert(thirdParty.pending.phase === 'awaiting_block', 'target may still claim Contessa');
  assert(toPublicState(thirdParty).pending.waitingOn[0] === 'p1', 'only target may block assassination');
}

function testNeutralConcessionAndRefund(): void {
  const state = newState();
  rigHands(state, { p0: ['assassin', 'duke'] });
  state.players.get('p0')!.coins = 3;
  expectOk(
    declareAction(state, 'p0', { action: 'assassinate', targetPlayerId: 'p1', expectedRevision: 0 }),
    'declare truthful assassination',
  );
  expectOk(respond(state, 'p2', { response: 'challenge', expectedRevision: 1 }), 'challenge truthful Assassin');
  expectOk(resolveChallenge(state, 'p0', false, 2), 'truthful claimant may concede');
  assert(state.pending.loseReason === 'conceded_challenge', 'concession reason is neutral');
  expectOk(loseInfluence(state, 'p0', 'assassin', 3), 'claimant chooses concession loss');
  assert(state.players.get('p0')!.coins === 3, 'successfully challenged action cost is refunded');
  assert(state.log.every((entry) => !/bluff|could not show/i.test(entry.text)), 'concession log does not assert hidden truth');
}

function testStealResolvesBeforeEliminationCleanup(): void {
  const state = newState();
  rigHands(state, { p0: ['captain', 'duke'], p1: ['duke', 'contessa'] });
  revealForScenario(state, 'p1', 1);
  state.players.get('p1')!.coins = 5;

  expectOk(declareAction(state, 'p0', { action: 'steal', targetPlayerId: 'p1', expectedRevision: 0 }), 'declare Steal');
  passUntilPhaseChanges(state, 'awaiting_action_challenge');
  assert(state.pending.phase === 'awaiting_block', 'Steal opens target block window');
  expectOk(
    respond(state, 'p1', { response: 'block', blockCharacter: 'ambassador', expectedRevision: state.revision }),
    'target bluffs Ambassador block',
  );
  expectOk(respond(state, 'p0', { response: 'challenge', expectedRevision: state.revision }), 'Captain challenges block');
  expectOk(resolveChallenge(state, 'p1', false, state.revision), 'blocker concedes failed block challenge');
  assert(state.players.get('p1')!.eliminated, 'failed block challenge eliminates target');
  assert(state.players.get('p0')!.coins === 4, 'Captain still takes two coins');
  assert(state.players.get('p1')!.coins === 0, 'remaining three target coins return to Treasury');
  assertCardConservation(state, 'Steal against eliminated blocker');

  const leaving = newState();
  rigHands(leaving, { p0: ['captain', 'duke'], p1: ['duke', 'contessa'] });
  leaving.players.get('p1')!.coins = 5;
  expectOk(
    declareAction(leaving, 'p0', { action: 'steal', targetPlayerId: 'p1', expectedRevision: 0 }),
    'declare Steal before target leaves',
  );
  passUntilPhaseChanges(leaving, 'awaiting_action_challenge');
  expectOk(
    respond(leaving, 'p1', {
      response: 'block',
      blockCharacter: 'ambassador',
      expectedRevision: leaving.revision,
    }),
    'target bluffs a block before leaving',
  );
  expectOk(
    respond(leaving, 'p0', { response: 'challenge', expectedRevision: leaving.revision }),
    'actor challenges the departing blocker',
  );
  expectOk(
    resolveChallenge(leaving, 'p1', false, leaving.revision),
    'blocker concedes before leaving',
  );
  assert(leaving.pending.phase === 'awaiting_lose_influence', 'blocker must choose an influence');
  const beforeForfeitRevision = leaving.revision;
  expectOk(forfeitPlayer(leaving, 'p1', beforeForfeitRevision), 'blocker leaves during influence loss');
  assert(leaving.revision === beforeForfeitRevision + 1, 'leave transition increments revision once');
  assert(leaving.players.get('p0')!.coins === 4, 'successful Steal pays before leave cleanup');
  assert(leaving.players.get('p1')!.coins === 0, 'departed target returns only the coin residue');
  assertCardConservation(leaving, 'Steal against departing defeated blocker');

  const finalOpponentLeaving = newState(2);
  rigHands(finalOpponentLeaving, { p0: ['captain', 'duke'], p1: ['duke', 'contessa'] });
  finalOpponentLeaving.players.get('p1')!.coins = 5;
  const finalActorStartingCoins = finalOpponentLeaving.players.get('p0')!.coins;
  expectOk(
    declareAction(finalOpponentLeaving, 'p0', {
      action: 'steal',
      targetPlayerId: 'p1',
      expectedRevision: 0,
    }),
    'declare final-opponent Steal before target leaves',
  );
  passUntilPhaseChanges(finalOpponentLeaving, 'awaiting_action_challenge');
  expectOk(
    respond(finalOpponentLeaving, 'p1', {
      response: 'block',
      blockCharacter: 'ambassador',
      expectedRevision: finalOpponentLeaving.revision,
    }),
    'final opponent bluffs a block before leaving',
  );
  expectOk(
    respond(finalOpponentLeaving, 'p0', {
      response: 'challenge',
      expectedRevision: finalOpponentLeaving.revision,
    }),
    'actor challenges final opponent block',
  );
  expectOk(
    resolveChallenge(finalOpponentLeaving, 'p1', false, finalOpponentLeaving.revision),
    'final opponent concedes before leaving',
  );
  const finalRevision = finalOpponentLeaving.revision;
  expectOk(
    forfeitPlayer(finalOpponentLeaving, 'p1', finalRevision),
    'final opponent leaves during influence loss',
  );
  assert(finalOpponentLeaving.revision === finalRevision + 1, 'final-opponent leave increments revision once');
  assert(finalOpponentLeaving.status === 'game_over', 'final-opponent leave finishes the game');
  assert(finalOpponentLeaving.winnerId === 'p0', 'remaining Steal actor wins');
  assert(
    finalOpponentLeaving.players.get('p0')!.coins === finalActorStartingCoins + 2,
    'final successful Steal pays before game over',
  );
  assert(finalOpponentLeaving.players.get('p1')!.coins === 0, 'final target coin residue returns to Treasury');
  assertCardConservation(finalOpponentLeaving, 'Steal against departing final opponent');
}

function testExchangePrivacyAndValidation(): void {
  const state = newState();
  rigHands(state, { p0: ['ambassador', 'duke'] });
  expectOk(declareAction(state, 'p0', { action: 'exchange', expectedRevision: 0 }), 'declare Exchange');
  passUntilPhaseChanges(state, 'awaiting_action_challenge');
  assert(state.pending.phase === 'awaiting_exchange', 'Exchange opens private selection');
  const own = toPrivateState(state, 'p0')!;
  const other = toPrivateState(state, 'p1')!;
  assert(Boolean(own.exchange) && other.exchange === null, 'only actor receives exchange pool');

  const character = state.players.get('p0')!.influences[0]!.character;
  own.influences[0]!.character = 'inquisitor';
  own.exchange!.pool[0] = 'inquisitor';
  assert(state.players.get('p0')!.influences[0]!.character === character, 'private influence projection is detached');
  assert(state.pending.exchangePool![0] !== 'inquisitor', 'private exchange projection is detached');

  expectRejectedWithoutMutation(state, () => chooseExchange(state, 'p0', [], state.revision), 'wrong exchange keep count');
  const keep = state.pending.exchangePool!.slice(0, state.pending.exchangeKeep);
  expectOk(chooseExchange(state, 'p0', keep, state.revision), 'submit valid Exchange');
  assertCardConservation(state, 'completed Exchange');
}

function testRecoveryAndForfeit(): void {
  const state = newState();
  state.players.get('p0')!.coins = 4;
  expectOk(forfeitPlayer(state, 'p0', 0), 'current actor forfeits');
  assert(state.players.get('p0')!.eliminated, 'forfeiting actor is eliminated');
  assert(state.players.get('p0')!.coins === 0, 'forfeiting actor returns coins');
  assert(toPublicState(state).currentTurnPlayerId === 'p1', 'turn advances past forfeiting actor');
  assert(!toPublicState(state).pending.waitingOn.includes('p0'), 'forfeiting actor is not awaited');
  assertCardConservation(state, 'actor forfeit');

  const exchange = newState();
  rigHands(exchange, { p0: ['ambassador', 'duke'] });
  expectOk(declareAction(exchange, 'p0', { action: 'exchange', expectedRevision: 0 }), 'declare recovery Exchange');
  passUntilPhaseChanges(exchange, 'awaiting_action_challenge');
  assert(exchange.deck.length === 7, 'Exchange draws two cards out of the deck');
  expectOk(forfeitPlayer(exchange, 'p0', exchange.revision), 'exchange actor forfeits');
  assert(Number(exchange.deck.length) === 9, 'forfeit returns transient Exchange draw');
  assertCardConservation(exchange, 'exchange forfeit');

  const responder = newState();
  expectOk(declareAction(responder, 'p0', { action: 'tax', expectedRevision: 0 }), 'declare Tax for recovery');
  expectOk(respond(responder, 'p1', { response: 'pass', expectedRevision: responder.revision }), 'first responder passes');
  expectOk(forfeitPlayer(responder, 'p2', responder.revision), 'last responder forfeits');
  assert(responder.players.get('p0')!.coins === 5, 'window resolves after responder forfeit');
  assert(!toPublicState(responder).pending.waitingOn.includes('p2'), 'forfeited responder is removed');

  const absent = newState();
  absent.players.get('p0')!.coins = 10;
  expectOk(resolveAbsentDecision(absent, 'p0', 0), 'absent mandatory-Coup actor recovers');
  assert(absent.players.get('p0')!.forfeited && absent.players.get('p0')!.coins === 0, 'expiry forfeits instead of choosing a Coup');
  assert(absent.pending.action === null && absent.pending.actorId === 'p1', 'expiry advances without autoplay');
  expectOk(resolveAbsentDecision(absent, 'p2', absent.revision), 'expiry also forfeits a non-pending seat');
  assert(absent.winnerId === 'p1', 'only the remaining eligible seat wins');

  const timed = newState();
  rigHands(timed, { p0: ['duke', 'captain'] });
  expectOk(declareAction(timed, 'p0', { action: 'tax', expectedRevision: 0 }), 'declare timed Tax');
  expectOk(respond(timed, 'p1', { response: 'challenge', expectedRevision: timed.revision }), 'challenge timed Tax');
  expectOk(expireWindow(timed, timed.revision), 'challenge proof timer expires');
  assert(timed.pending.phase === 'awaiting_lose_influence', 'timeout auto-proves a held claim');
}

function aliveOthers(state: CoupServerState, playerId: string): string[] {
  return state.turnOrder.filter((id) => id !== playerId && aliveCards(state.players.get(id)!.influences) > 0);
}

const DEPARTURE_SCENARIOS = [
  'action', 'action_challenge', 'block', 'block_challenge', 'action_proof', 'block_proof',
  'coup_loss', 'target_challenge_loss', 'third_party_loss', 'blocker_loss', 'actor_loss',
  'steal_loss', 'exchange_two', 'exchange_one',
] as const;

function departureScenario(kind: typeof DEPARTURE_SCENARIOS[number]): CoupServerState {
  const state = newState(4);
  rigHands(state, { p0: ['assassin', 'duke'], p1: ['captain', 'contessa'] });
  const action = (name: CoupActionPayload['action'], targetPlayerId?: string) => expectOk(declareAction(state, 'p0', { action: name, targetPlayerId, expectedRevision: state.revision }), `prepare ${kind}`);
  const challenge = (id: string) => expectOk(respond(state, id, { response: 'challenge', expectedRevision: state.revision }), `challenge ${kind}`);
  if (kind === 'action') return state;
  if (kind.startsWith('exchange')) {
    if (kind === 'exchange_one') revealForScenario(state, 'p0', 1);
    action('exchange');
    passUntilPhaseChanges(state, 'awaiting_action_challenge');
    return state;
  }
  if (kind === 'coup_loss') {
    state.players.get('p0')!.coins = 7;
    action('coup', 'p1');
    return state;
  }
  if (['block', 'block_challenge', 'block_proof'].includes(kind)) {
    action('foreign_aid');
    if (kind === 'block') return state;
    expectOk(respond(state, 'p1', { response: 'block', blockCharacter: 'duke', expectedRevision: state.revision }), 'prepare Duke block');
    if (kind === 'block_proof') challenge('p2');
    return state;
  }
  if (['action_challenge', 'action_proof', 'actor_loss'].includes(kind)) {
    action('tax');
    if (kind === 'action_challenge') return state;
    challenge('p2');
    if (kind === 'actor_loss') expectOk(resolveChallenge(state, 'p0', false, state.revision), 'prepare actor concession');
    return state;
  }
  state.players.get('p0')!.coins = 3;
  action(kind === 'steal_loss' ? 'steal' : 'assassinate', 'p1');
  if (kind === 'target_challenge_loss' || kind === 'third_party_loss') {
    challenge(kind === 'target_challenge_loss' ? 'p1' : 'p2');
    expectOk(resolveChallenge(state, 'p0', true, state.revision), 'prepare proved Assassin');
  } else {
    passUntilPhaseChanges(state, 'awaiting_action_challenge');
    expectOk(respond(state, 'p1', { response: 'block', blockCharacter: kind === 'steal_loss' ? 'ambassador' : 'contessa', expectedRevision: state.revision }), 'prepare target block');
    challenge('p2');
    expectOk(resolveChallenge(state, 'p1', false, state.revision), 'prepare conceded target block');
  }
  return state;
}

function testBatchDepartures(): void {
  const invalid = newState();
  expectRejectedWithoutMutation(invalid, () => forfeitPlayers(invalid, ['p0', 'missing'], invalid.revision), 'mixed valid and unknown departure');
  expectRejectedWithoutMutation(invalid, () => forfeitPlayers(invalid, [], invalid.revision), 'empty departure batch');
  expectRejectedWithoutMutation(invalid, () => forfeitPlayers(invalid, ['p0'], invalid.revision + 1), 'stale departure batch');
  expectOneRevision(invalid, () => forfeitPlayers(invalid, ['p0', 'p0'], invalid.revision), 'duplicate departure IDs settle once');
  expectRejectedWithoutMutation(invalid, () => forfeitPlayers(invalid, ['p0'], invalid.revision), 'repeated departure cannot mutate');

  const owed = departureScenario('third_party_loss');
  expectOk(forfeitPlayer(owed, 'p0', owed.revision), 'proved actor leaves during challenger loss');
  assert(owed.pending.phase === 'awaiting_lose_influence' && owed.pending.losingPlayerId === 'p2', 'committed challenge loss survives actor departure');
  expectOk(loseInfluence(owed, 'p2', owed.players.get('p2')!.influences[0]!.character, owed.revision), 'challenger still chooses the owed loss');
  assert(aliveCards(owed.players.get('p2')!.influences) === 1, 'resolved challenge loss is applied');
  assert(aliveCards(owed.players.get('p1')!.influences) === 2, 'departed actor does not finish assassination');

  const soleOwesLoss = departureScenario('third_party_loss');
  expectOk(forfeitPlayers(soleOwesLoss, ['p0', 'p1', 'p3'], soleOwesLoss.revision), 'all but the adjudicated loser depart');
  assert(soleOwesLoss.status === 'playing' && soleOwesLoss.winnerId === null && soleOwesLoss.pending.losingPlayerId === 'p2', 'sole survivor still chooses its committed loss before winning');
  expectOk(loseInfluence(soleOwesLoss, 'p2', soleOwesLoss.players.get('p2')!.influences[0]!.character, soleOwesLoss.revision), 'sole survivor settles owed loss');
  assert(soleOwesLoss.winnerId === 'p2' && aliveCards(soleOwesLoss.players.get('p2')!.influences) === 1, 'winner projection includes the committed loss');

  const unresolvedBlock = departureScenario('block_proof');
  const actorCoins = unresolvedBlock.players.get('p0')!.coins;
  expectOk(forfeitPlayers(unresolvedBlock, ['p1', 'p2'], unresolvedBlock.revision), 'blocker and challenger leave together');
  assert(unresolvedBlock.players.get('p0')!.coins === actorCoins + 2, 'departed unproved blocker cannot preserve its block');

  const provedBlock = departureScenario('block_proof');
  rigHands(provedBlock, { p1: ['duke', 'contessa'] });
  expectOk(resolveChallenge(provedBlock, 'p1', true, provedBlock.revision), 'prove a Duke block');
  const beforeBlocked = provedBlock.players.get('p0')!.coins;
  expectOk(forfeitPlayer(provedBlock, 'p1', provedBlock.revision), 'proved blocker leaves during challenger loss');
  expectOk(loseInfluence(provedBlock, 'p2', provedBlock.players.get('p2')!.influences[0]!.character, provedBlock.revision), 'challenger loses after proved blocker departure');
  assert(provedBlock.players.get('p0')!.coins === beforeBlocked, 'already proved block remains resolved');

  for (const kind of DEPARTURE_SCENARIOS) {
    for (let mask = 1; mask < 16; mask++) {
      const state = departureScenario(kind);
      const ids = state.turnOrder.filter((_, index) => (mask & (1 << index)) !== 0);
      expectOneRevision(state, () => forfeitPlayers(state, ids, state.revision), `${kind}: batch ${mask}`);
      for (const id of ids) assert(state.players.get(id)!.forfeited, `${kind}: ${id} departed before settlement`);
      if (ids.length === 4) {
        assert(state.status === 'game_over' && state.winnerId === null && state.terminationReason === 'no_players_remaining', `${kind}: all departed means no winner`);
        assert(state.log.every((entry) => !entry.text.includes('wins the game')), `${kind}: no transient winner log`);
      } else if (ids.length === 3) {
        if (state.pending.phase === 'awaiting_lose_influence') {
          assert(state.winnerId === null && !ids.includes(state.pending.losingPlayerId!), `${kind}: sole survivor settles its committed loss first`);
        } else {
          assert(state.status === 'game_over' && state.winnerId !== null && !ids.includes(state.winnerId), `${kind}: only the genuine survivor wins`);
        }
      }
      const previousAlive = new Map<string, number>();
      checkInvariants(state, previousAlive);
      let decisions = 0;
      while (state.status === 'playing' && decisions++ < 4_000) {
        step(state);
        checkInvariants(state, previousAlive);
      }
      assert(state.status === 'game_over', `${kind}: departure continuation completes`);
    }
  }
}

function testCanonicalRuleBranches(): void {
  for (const action of ['foreign_aid', 'steal', 'assassinate'] as const) {
    const blockers = ACTION_META[action].blockableBy.filter((role) => charactersForVariant('base').includes(role));
    for (const blocker of blockers) {
      for (const prove of [false, true]) {
        const state = newState(4);
        rigHands(state, { p0: ['assassin', 'captain'], p1: [blocker, 'duke'] });
        state.players.get('p0')!.coins = 3;
        expectOk(declareAction(state, 'p0', { action, ...(action === 'foreign_aid' ? {} : { targetPlayerId: 'p1' }), expectedRevision: state.revision }), 'declare block-matrix action');
        if (state.pending.phase === 'awaiting_action_challenge') passUntilPhaseChanges(state, 'awaiting_action_challenge');
        if (action !== 'foreign_aid') {
          expectRejectedWithoutMutation(state, () => respond(state, 'p2', { response: 'block', blockCharacter: blocker, expectedRevision: state.revision }), 'non-target cannot block');
        }
        expectOk(respond(state, 'p1', { response: 'block', blockCharacter: blocker, expectedRevision: state.revision }), 'declare legal block');
        expectOk(respond(state, 'p2', { response: 'challenge', expectedRevision: state.revision }), 'third party challenges block');
        expectOk(resolveChallenge(state, 'p1', prove, state.revision), 'prove or concede block');
        const loserId = prove ? 'p2' : 'p1';
        expectOk(loseInfluence(state, loserId, state.players.get(loserId)!.influences.find((card) => !card.revealed)!.character, state.revision), 'choose challenge loss');
        if (prove) assert(aliveCards(state.players.get('p1')!.influences) === 2, 'proved block protects target');
        if (action === 'assassinate') {
          assert(state.players.get('p0')!.coins === 0, 'assassination is paid after either block verdict');
          assert(aliveCards(state.players.get('p1')!.influences) === (prove ? 2 : 0), 'conceded Contessa takes both losses');
        } else {
          assert(state.players.get('p0')!.coins === (prove ? 3 : 5), 'only an unsuccessful block permits the coin gain');
        }
        assertCardConservation(state, `${action}/${blocker}/${prove}`);
      }
    }
  }

  for (const keepCount of [1, 2]) {
    const poolLength = keepCount + 2;
    for (let mask = 0; mask < (1 << poolLength); mask++) {
      const selected = Array.from({ length: poolLength }, (_, index) => index).filter((index) => (mask & (1 << index)) !== 0);
      if (selected.length !== keepCount) continue;
      const state = newState(6);
      rigHands(state, { p0: ['ambassador', 'duke'] });
      if (keepCount === 1) revealForScenario(state, 'p0', 1);
      expectOk(declareAction(state, 'p0', { action: 'exchange', expectedRevision: state.revision }), 'declare canonical Exchange');
      passUntilPhaseChanges(state, 'awaiting_action_challenge');
      const originalRevealed = state.players.get('p0')!.influences.filter((card) => card.revealed).map((card) => card.character);
      const pool = toPrivateState(state, 'p0')!.exchange!.pool;
      const keep = selected.map((index) => pool[index]!);
      expectOk(chooseExchange(state, 'p0', keep, state.revision), 'keep canonical Exchange subset');
      assert(JSON.stringify(state.players.get('p0')!.influences.filter((card) => !card.revealed).map((card) => card.character).sort()) === JSON.stringify([...keep].sort()), 'Exchange keeps exactly the selected multiset');
      assert(JSON.stringify(state.players.get('p0')!.influences.filter((card) => card.revealed).map((card) => card.character)) === JSON.stringify(originalRevealed), 'Exchange never replaces lost influence');
      assert(state.deck.length === 3, 'six-player Exchange returns two cards');
      assertCardConservation(state, 'canonical Exchange subset');
    }
  }

  for (const coins of [10, 11, 20]) {
    const state = newState(2);
    state.players.get('p0')!.coins = coins;
    for (const action of ['income', 'foreign_aid', 'tax', 'exchange', 'steal', 'assassinate'] as const) {
      expectRejectedWithoutMutation(state, () => declareAction(state, 'p0', { action, expectedRevision: state.revision }), 'mandatory Coup excludes every alternative');
    }
    expectOk(declareAction(state, 'p0', { action: 'coup', targetPlayerId: 'p1', expectedRevision: state.revision }), 'mandatory Coup is accepted');
    assert(state.players.get('p0')!.coins === coins - 7, 'Coup costs exactly seven');
    expectRejectedWithoutMutation(state, () => respond(state, 'p1', { response: 'block', blockCharacter: 'contessa', expectedRevision: state.revision }), 'Coup cannot be blocked');
  }
}

function step(state: CoupServerState): void {
  const pending = state.pending;
  if (pending.phase === 'awaiting_action') {
    const actor = state.players.get(state.turnOrder[state.currentTurnIndex])!;
    const others = aliveOthers(state, actor.playerId);
    const stealTargets = others.filter((playerId) => state.players.get(playerId)!.coins > 0);
    let choice: Omit<CoupActionPayload, 'expectedRevision'>;
    if (actor.coins >= 10) {
      choice = { action: 'coup', targetPlayerId: rand(others) };
    } else {
      const options: Omit<CoupActionPayload, 'expectedRevision'>[] = [
        { action: 'income' },
        { action: 'foreign_aid' },
        { action: 'tax' },
        { action: 'exchange' },
      ];
      if (others.length > 0) {
        if (stealTargets.length > 0) options.push({ action: 'steal', targetPlayerId: rand(stealTargets) });
        if (actor.coins >= 3) options.push({ action: 'assassinate', targetPlayerId: rand(others) });
        if (actor.coins >= 7) options.push({ action: 'coup', targetPlayerId: rand(others) });
      }
      choice = rand(options);
    }
    expectOk(declareAction(state, actor.playerId, { ...choice, expectedRevision: state.revision }), `declare ${choice.action}`);
    return;
  }

  if (pending.phase === 'awaiting_challenge_decision') {
    const claimantId = pending.challengeKind === 'block' ? pending.blockerId : pending.actorId;
    const claim = pending.challengeKind === 'block' ? pending.blockCharacter : pending.claimedCharacter;
    assert(Boolean(claimantId && claim), 'challenge decision has claimant and character');
    const claimant = state.players.get(claimantId!)!;
    const holds = claimant.influences.some((influence) => !influence.revealed && influence.character === claim);
    expectOk(resolveChallenge(state, claimantId!, holds && !chance(0.08), state.revision), 'resolve challenge decision');
    return;
  }

  if (pending.phase === 'awaiting_lose_influence') {
    const loser = state.players.get(pending.losingPlayerId!)!;
    const character = rand(loser.influences.filter((influence) => !influence.revealed)).character;
    expectOk(loseInfluence(state, pending.losingPlayerId!, character, state.revision), 'choose influence loss');
    return;
  }

  if (pending.phase === 'awaiting_exchange') {
    const exchange = toPrivateState(state, pending.actorId)!.exchange!;
    const pool = [...exchange.pool];
    const keep = Array.from({ length: exchange.keepCount }, () => pool.splice(Math.floor(random() * pool.length), 1)[0]!);
    expectOk(
      chooseExchange(state, pending.actorId, keep, state.revision),
      'choose Exchange cards',
    );
    return;
  }

  const responder = rand(toPublicState(state).pending.waitingOn);
  if (pending.phase === 'awaiting_action_challenge') {
    expectOk(
      respond(state, responder, { response: chance(0.22) ? 'challenge' : 'pass', expectedRevision: state.revision }),
      'respond to action claim',
    );
    return;
  }
  if (pending.phase === 'awaiting_block') {
    if (chance(0.4)) {
      const allowed = ACTION_META[pending.action!].blockableBy.filter((character) =>
        charactersForVariant(state.variant).includes(character),
      );
      expectOk(
        respond(state, responder, { response: 'block', blockCharacter: rand(allowed), expectedRevision: state.revision }),
        'declare block',
      );
    } else {
      expectOk(respond(state, responder, { response: 'pass', expectedRevision: state.revision }), 'pass block window');
    }
    return;
  }
  if (pending.phase === 'awaiting_block_challenge') {
    expectOk(
      respond(state, responder, { response: chance(0.5) ? 'challenge' : 'pass', expectedRevision: state.revision }),
      'respond to block claim',
    );
    return;
  }
  throw new Error(`unexpected phase ${pending.phase}`);
}

function checkInvariants(state: CoupServerState, previousAlive: Map<string, number>): void {
  for (const player of state.players.values()) {
    assert(player.influences.length === 2, `${player.displayName} retains two influence entries`);
    assert(Number.isSafeInteger(player.coins) && player.coins >= 0, `${player.displayName} has valid coins`);
    const current = aliveCards(player.influences);
    const previous = previousAlive.get(player.playerId) ?? 2;
    assert(current <= previous, `${player.displayName} did not regain influence`);
    previousAlive.set(player.playerId, current);
    assert(player.eliminated === (current === 0), `${player.displayName} elimination flag`);
    if (player.eliminated) assert(player.coins === 0, `${player.displayName} returned eliminated coins`);
  }
  assertCardConservation(state, 'full game');
  const pub = toPublicState(state);
  assert(pub.revision === state.revision, 'public revision matches engine');
  if (state.status === 'playing') {
    assert(pub.pending.waitingOn.length > 0, `phase ${state.pending.phase} has a decision maker`);
    assert(pub.pending.waitingOn.every((id) => !state.players.get(id)!.eliminated), 'never waits on eliminated player');
  }
  for (const player of pub.players) {
    assert(player.influenceCount + player.revealedCharacters.length === 2, 'public influence accounting');
    assert(!('influences' in player), 'public player excludes private influence entries');
    const privateState = toPrivateState(state, player.playerId)!;
    assert(privateState.roomCode === state.roomCode && privateState.gameId === 'coup' && privateState.playerId === player.playerId && privateState.revision === pub.revision, 'private identity matches the public projection');
    assert((privateState.exchange !== null) === (state.pending.phase === 'awaiting_exchange' && state.pending.actorId === player.playerId), 'only the Exchange actor receives the pool');
    assert(privateState.examine === null, 'base Coup never exposes an Examine card');
    if (player.forfeited) assert(player.eliminated, 'forfeited seat cannot retain influence');
  }
  assert(!('deck' in pub) && !('exchangePool' in pub.pending), 'public state excludes hidden deck and pool');
  if (state.status === 'game_over') {
    assert(pub.pending.waitingOn.length === 0 && pub.pending.deadline === null, 'terminal state has no pending decisions');
    assert(state.winnerId === null || !state.players.get(state.winnerId)!.forfeited, 'winner never forfeited');
  }
}

interface GameStats {
  games: number;
  steps: number;
  maxSteps: number;
}

function playGame(count: number): number {
  const state = newState(count);
  const previousAlive = new Map<string, number>();
  let steps = 0;
  const budget = 4_000;
  while (state.status === 'playing' && steps < budget) {
    const revision = state.revision;
    step(state);
    assert(state.revision === revision + 1, 'successful transition increments revision once');
    checkInvariants(state, previousAlive);
    steps += 1;
  }
  assert(state.status === 'game_over', `${count}-player game completes within ${budget} steps`);
  const survivors = state.turnOrder.filter((id) => aliveCards(state.players.get(id)!.influences) > 0);
  assert(survivors.length === 1, `${count}-player game has exactly one survivor`);
  assert(state.winnerId === survivors[0], `${count}-player winner matches survivor`);
  return steps;
}

function main(): void {
  const originalRandom = Math.random;
  Math.random = random;
  try {
    testSetupAndProjection();
    testMalformedAndStaleInputs();
    testEveryMutationBoundaryAndProjectionCopy();
    testAssassinationChallengeOrdering();
    testNeutralConcessionAndRefund();
    testStealResolvesBeforeEliminationCleanup();
    testExchangePrivacyAndValidation();
    testRecoveryAndForfeit();
    testBatchDepartures();
    testCanonicalRuleBranches();

    const gamesPerCount = 250;
    const stats = new Map<number, GameStats>();
    for (let count = 2; count <= 6; count += 1) {
      const value: GameStats = { games: 0, steps: 0, maxSteps: 0 };
      for (let game = 0; game < gamesPerCount; game += 1) {
        const steps = playGame(count);
        value.games += 1;
        value.steps += steps;
        value.maxSteps = Math.max(value.maxSteps, steps);
      }
      stats.set(count, value);
    }

    const summary = [...stats.entries()]
      .map(([count, value]) =>
        `${count}p=${value.games} games, avg ${(value.steps / value.games).toFixed(1)} steps, max ${value.maxSteps}`,
      )
      .join('; ');
    console.log(`COUP SIM PASS: ${summary}; ${assertions} assertions; seed 0x${INITIAL_SEED.toString(16)}.`);
  } finally {
    Math.random = originalRandom;
  }
}

main();
