/**
 * Coup engine smoke test: plays full base-variant games (2–6 players) driving
 * the phase machine with random legal inputs, and asserts core invariants
 * after every step. This is the regression net for the challenge/block state
 * machine — run after any change under src/game/coup/. Run with:
 *   pnpm --filter @zuychin-arcade/server simulate:coup
 */
import type { CoupCharacter } from '@zuychin-arcade/types';
import {
  ACTION_META,
  charactersForVariant,
  copiesPerCharacter,
} from '@zuychin-arcade/types';
import {
  chooseExchange,
  declareAction,
  initGame,
  loseInfluence,
  respond,
  type CoupServerState,
} from '../../src/game/coup/engine.js';
import { toPublicState, toPrivateState } from '../../src/game/coup/publicState.js';

let assertions = 0;
function assert(cond: boolean, msg: string): void {
  assertions++;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const chance = (p: number): boolean => Math.random() < p;
const aliveCards = (infl: { revealed: boolean }[]): number => infl.filter((i) => !i.revealed).length;

function aliveOthers(state: CoupServerState, id: string): string[] {
  return state.turnOrder.filter(
    (pid) => pid !== id && aliveCards(state.players.get(pid)!.influences) > 0,
  );
}

// --- drive one pending step with a random legal input ---
function step(state: CoupServerState): void {
  const pub = toPublicState(state);
  const p = state.pending;

  if (p.phase === 'awaiting_action') {
    const actor = state.players.get(state.turnOrder[state.currentTurnIndex])!;
    const others = aliveOthers(state, actor.playerId);
    let choice: { action: string; targetPlayerId?: string };
    if (actor.coins >= 10) {
      choice = { action: 'coup', targetPlayerId: rand(others) };
    } else {
      const opts: Array<{ action: string; targetPlayerId?: string }> = [
        { action: 'income' },
        { action: 'foreign_aid' },
        { action: 'tax' },
        { action: 'exchange' },
      ];
      if (others.length) {
        opts.push({ action: 'steal', targetPlayerId: rand(others) });
        if (actor.coins >= 3) opts.push({ action: 'assassinate', targetPlayerId: rand(others) });
        if (actor.coins >= 7) opts.push({ action: 'coup', targetPlayerId: rand(others) });
      }
      choice = rand(opts);
    }
    const r = declareAction(state, actor.playerId, choice as never);
    assert(r.ok, `declareAction ${choice.action} rejected: ${r.ok ? '' : r.reason}`);
    return;
  }

  if (p.phase === 'awaiting_lose_influence') {
    const loser = state.players.get(p.losingPlayerId!)!;
    const card = rand(loser.influences.filter((i) => !i.revealed)).character;
    const r = loseInfluence(state, p.losingPlayerId!, card);
    assert(r.ok, `loseInfluence rejected: ${r.ok ? '' : r.reason}`);
    return;
  }

  if (p.phase === 'awaiting_exchange') {
    const priv = toPrivateState(state, p.actorId)!;
    const pool = priv.exchange!.pool;
    const keep = pool.slice(0, priv.exchange!.keepCount);
    const r = chooseExchange(state, p.actorId, keep);
    assert(r.ok, `chooseExchange rejected: ${r.ok ? '' : r.reason}`);
    return;
  }

  // a response window — pick one waiting player and respond
  const responder = rand(pub.pending.waitingOn);
  if (p.phase === 'awaiting_action_challenge') {
    const r = respond(state, responder, { response: chance(0.22) ? 'challenge' : 'pass' });
    assert(r.ok, `action-challenge respond rejected: ${r.ok ? '' : r.reason}`);
    return;
  }
  if (p.phase === 'awaiting_block') {
    if (chance(0.4)) {
      const allowed = ACTION_META[p.action!].blockableBy.filter((c) =>
        charactersForVariant(state.variant).includes(c),
      );
      const r = respond(state, responder, { response: 'block', blockCharacter: rand(allowed) });
      assert(r.ok, `block respond rejected: ${r.ok ? '' : r.reason}`);
    } else {
      const r = respond(state, responder, { response: 'pass' });
      assert(r.ok, `block-pass rejected: ${r.ok ? '' : r.reason}`);
    }
    return;
  }
  if (p.phase === 'awaiting_block_challenge') {
    const r = respond(state, responder, { response: chance(0.5) ? 'challenge' : 'pass' });
    assert(r.ok, `block-challenge respond rejected: ${r.ok ? '' : r.reason}`);
    return;
  }
  throw new Error(`unexpected phase ${p.phase}`);
}

function checkInvariants(
  state: CoupServerState,
  n: number,
  totalCards: number,
  lastAlive: Map<string, number>,
): void {
  // every player always has exactly 2 influence entries (only revealed flips / swaps)
  let influenceEntries = 0;
  for (const pl of state.players.values()) {
    assert(pl.influences.length === 2, `${pl.displayName} has ${pl.influences.length} influence entries`);
    influenceEntries += pl.influences.length;
    assert(pl.coins >= 0, `${pl.displayName} has negative coins (${pl.coins})`);
    // influence count is monotonically non-increasing
    const now = aliveCards(pl.influences);
    const prev = lastAlive.get(pl.playerId) ?? 2;
    assert(now <= prev, `${pl.displayName} gained influence (${prev}→${now})`);
    lastAlive.set(pl.playerId, now);
    // eliminated flag matches having zero face-down cards
    assert(pl.eliminated === (now === 0), `${pl.displayName} eliminated flag mismatch`);
  }
  // card conservation: deck + all influence cards = the full court deck. During
  // awaiting_exchange the freshly drawn cards sit transiently in the exchange
  // pool (not yet in the deck nor the player's influences) — account for them.
  let inExchange = 0;
  if (state.pending.phase === 'awaiting_exchange' && state.pending.exchangePool) {
    inExchange = state.pending.exchangePool.length - state.pending.exchangeKeep;
  }
  assert(
    state.deck.length + influenceEntries + inExchange === totalCards,
    `card count drift: deck ${state.deck.length} + ${influenceEntries} + ${inExchange} != ${totalCards}`,
  );
  // no deadlock while playing
  if (state.status === 'playing') {
    const pub = toPublicState(state);
    assert(pub.pending.waitingOn.length > 0, `deadlock: nobody to act in phase ${state.pending.phase}`);
    if (state.pending.phase === 'awaiting_action') {
      assert(aliveCards(state.players.get(pub.currentTurnPlayerId!)!.influences) > 0, 'dead player has the turn');
    }
  }
  // private state never leaks: public never carries face-down characters
  const pub = toPublicState(state);
  for (const pp of pub.players) {
    assert(pp.influenceCount + pp.revealedCharacters.length === 2, 'public influence accounting wrong');
  }
}

function playGame(n: number): void {
  const charCount = charactersForVariant('base').length;
  const totalCards = copiesPerCharacter(n) * charCount;
  const players = Array.from({ length: n }, (_, i) => ({
    playerId: `p${i}`,
    displayName: `P${i}`,
  }));
  const state = initGame('TEST-1', 'base', players);
  const lastAlive = new Map<string, number>();

  assert(state.deck.length + n * 2 === totalCards, 'deal conservation');

  let steps = 0;
  const budget = 4000;
  while (state.status === 'playing' && steps < budget) {
    step(state);
    checkInvariants(state, n, totalCards, lastAlive);
    steps++;
  }

  assert(state.status === 'game_over', `game did not finish in ${budget} steps (${n} players)`);
  const alive = state.turnOrder.filter((id) => aliveCards(state.players.get(id)!.influences) > 0);
  assert(alive.length === 1, `expected 1 survivor, got ${alive.length}`);
  assert(state.winnerId === alive[0], 'winnerId mismatch');
  for (const id of state.turnOrder) {
    if (id !== state.winnerId) assert(state.players.get(id)!.eliminated, `${id} should be eliminated`);
  }
}

function main(): void {
  const GAMES_PER_COUNT = 250;
  let games = 0;
  for (let n = 2; n <= 6; n++) {
    for (let g = 0; g < GAMES_PER_COUNT; g++) {
      playGame(n);
      games++;
    }
  }
  console.log(`COUP SIM PASS: ${games} games (2–6 players), ${assertions} assertions, no invariant violations.`);
}

main();
