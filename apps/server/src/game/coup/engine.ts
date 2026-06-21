// Coup (+ Reformation) authoritative engine. Pure: no IO, no sockets.
//
// The whole design problem is interactivity — see COUP_PLAN.md §3. Unlike
// Saboteur (only the current player ever acts), a declared action waits on
// *other* players to challenge or block. The game therefore lives in a
// `pending` phase machine and most of the time is spent between turns waiting
// on responses. Phase 1 implements the BASE variant; reformation-only actions
// are gated off until Phase 2.
//
// Every entry point returns EngineResult and mutates `state` in place. A single
// engine call resolves all synchronous chained transitions (e.g. an
// auto-revealed influence loss that lets the original action proceed) before
// returning; the caller emits state once afterwards.

import type {
  CoupActionPayload,
  CoupActionType,
  CoupCharacter,
  CoupLogEntry,
  CoupPhase,
  CoupPlayerState,
  CoupVariant,
  LoseInfluenceReason,
} from '@zuychin-arcade/types';
import {
  ACTION_META,
  ASSASSINATE_COST,
  FOREIGN_AID_GAIN,
  INCOME_GAIN,
  MANDATORY_COUP_AT,
  RESPONSE_TIMEOUT_MS,
  STEAL_MAX,
  TAX_GAIN,
  charactersForVariant,
  startingCoins,
} from '@zuychin-arcade/types';
import { buildCourtDeck, shuffle } from './deck.js';

export type EngineResult = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): EngineResult => ({ ok: false, reason });
const OK: EngineResult = { ok: true };

// What to do once a pending influence-loss has been resolved.
type Resume =
  | { kind: 'end_turn' }
  | { kind: 'proceed_action' } // action survived a challenge → block window or resolve
  | { kind: 'resolve_action' }; // a block was broken → apply the action effect

// Server-side pending window. The public projection (CoupPendingPublic) is a
// subset of this; `passed`, `resume`, and exchange pool stay server-only.
interface PendingState {
  phase: CoupPhase;
  actorId: string;
  action: CoupActionType | null;
  targetId: string | null;
  claimedCharacter: CoupCharacter | null;
  blockerId: string | null;
  blockCharacter: CoupCharacter | null;
  passed: Set<string>;
  losingPlayerId: string | null;
  loseReason: LoseInfluenceReason | null;
  resume: Resume | null;
  exchangePool: CoupCharacter[] | null;
  exchangeKeep: number;
  examineTargetId: string | null;
  examineCharacter: CoupCharacter | null;
  deadline: number | null;
}

export interface CoupServerState {
  roomCode: string;
  variant: CoupVariant;
  status: 'playing' | 'game_over';
  players: Map<string, CoupPlayerState>;
  turnOrder: string[];
  currentTurnIndex: number;
  deck: CoupCharacter[];
  treasuryReserve: number;
  pending: PendingState;
  log: CoupLogEntry[];
  logSeq: number;
  winnerId: string | null;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function initGame(
  roomCode: string,
  variant: CoupVariant,
  players: Array<{ playerId: string; displayName: string }>,
): CoupServerState {
  const n = players.length;
  const deck = buildCourtDeck(variant, n);
  const turnOrder = players.map((p) => p.playerId);

  const map = new Map<string, CoupPlayerState>();
  players.forEach((p, i) => {
    map.set(p.playerId, {
      playerId: p.playerId,
      displayName: p.displayName,
      influences: [
        { character: deck.shift()!, revealed: false },
        { character: deck.shift()!, revealed: false },
      ],
      coins: startingCoins(n, i === 0),
      // Reformation alternates allegiances around the table (Phase 2 wires the
      // host's choice); base has no allegiances.
      allegiance: variant === 'reformation' ? (i % 2 === 0 ? 'reformist' : 'loyalist') : null,
      eliminated: false,
    });
  });

  const state: CoupServerState = {
    roomCode,
    variant,
    status: 'playing',
    players: map,
    turnOrder,
    currentTurnIndex: 0,
    deck,
    treasuryReserve: 0,
    pending: freshPending(turnOrder[0]),
    log: [],
    logSeq: 0,
    winnerId: null,
  };
  log(state, `Game started — ${n} players, ${variant} rules.`);
  log(state, `${nameOf(state, turnOrder[0])} goes first.`);
  return state;
}

function freshPending(actorId: string): PendingState {
  return {
    phase: 'awaiting_action',
    actorId,
    action: null,
    targetId: null,
    claimedCharacter: null,
    blockerId: null,
    blockCharacter: null,
    passed: new Set(),
    losingPlayerId: null,
    loseReason: null,
    resume: null,
    exchangePool: null,
    exchangeKeep: 0,
    examineTargetId: null,
    examineCharacter: null,
    deadline: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const aliveCardCount = (p: CoupPlayerState): number =>
  p.influences.filter((i) => !i.revealed).length;

function currentPlayerId(state: CoupServerState): string {
  return state.turnOrder[state.currentTurnIndex];
}

function aliveIds(state: CoupServerState): string[] {
  return state.turnOrder.filter((id) => aliveCardCount(state.players.get(id)!) > 0);
}

function nameOf(state: CoupServerState, id: string | null): string {
  return (id && state.players.get(id)?.displayName) || '?';
}

function log(state: CoupServerState, text: string): void {
  state.logSeq += 1;
  state.log.push({ id: state.logSeq, text });
  if (state.log.length > 100) state.log.shift();
}

function hasCharacter(p: CoupPlayerState, c: CoupCharacter): boolean {
  return p.influences.some((i) => !i.revealed && i.character === c);
}

/** Player proves a claim: return that card to the deck, reshuffle, draw a new one. */
function reshuffleReveal(state: CoupServerState, p: CoupPlayerState, c: CoupCharacter): void {
  const inf = p.influences.find((i) => !i.revealed && i.character === c);
  if (!inf) return;
  state.deck.push(c);
  state.deck = shuffle(state.deck);
  inf.character = state.deck.shift()!;
}

/** Eligible responders for the current challenge/block window. */
function eligibleResponders(state: CoupServerState): string[] {
  const p = state.pending;
  switch (p.phase) {
    case 'awaiting_action_challenge':
      return aliveIds(state).filter((id) => id !== p.actorId);
    case 'awaiting_block':
      return eligibleBlockerIds(state);
    case 'awaiting_block_challenge':
      return aliveIds(state).filter((id) => id !== p.blockerId);
    default:
      return [];
  }
}

function eligibleBlockerIds(state: CoupServerState): string[] {
  const { action, actorId, targetId } = state.pending;
  if (action === 'foreign_aid') return aliveIds(state).filter((id) => id !== actorId);
  if (action === 'assassinate' || action === 'steal') {
    return targetId && aliveCardCount(state.players.get(targetId)!) > 0 ? [targetId] : [];
  }
  return [];
}

function windowComplete(state: CoupServerState): boolean {
  const eligible = eligibleResponders(state);
  return eligible.every((id) => state.pending.passed.has(id));
}

function armTimer(state: CoupServerState): void {
  state.pending.deadline = Date.now() + RESPONSE_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// 1. Action declaration
// ---------------------------------------------------------------------------

export function declareAction(
  state: CoupServerState,
  playerId: string,
  payload: CoupActionPayload,
): EngineResult {
  if (state.status !== 'playing') return fail('The game is over');
  if (state.pending.phase !== 'awaiting_action') return fail('Not waiting for an action right now');
  if (currentPlayerId(state) !== playerId) return fail('It is not your turn');

  const actor = state.players.get(playerId)!;
  const action = payload.action;
  const meta = ACTION_META[action];
  if (!meta) return fail('Unknown action');
  if (meta.reformationOnly && state.variant !== 'reformation') {
    return fail('That action is only available with Reformation rules');
  }
  if (meta.reformationOnly) return fail('That action is not available yet'); // Phase 2

  if (actor.coins >= MANDATORY_COUP_AT && action !== 'coup') {
    return fail('You have 10 or more coins and must launch a Coup');
  }
  if (actor.coins < meta.cost) return fail('Not enough coins');

  let targetId: string | null = null;
  if (meta.needsTarget) {
    targetId = payload.targetPlayerId ?? null;
    if (!targetId) return fail('This action needs a target');
    if (targetId === playerId) return fail('You cannot target yourself');
    const target = state.players.get(targetId);
    if (!target || aliveCardCount(target) === 0) return fail('Invalid target');
    // Allegiance restriction (Reformation) is enforced in Phase 2.
  }

  actor.coins -= meta.cost; // pay up front (refunded if a challenge proves a bluff)
  state.pending = freshPending(playerId);
  state.pending.action = action;
  state.pending.targetId = targetId;

  switch (action) {
    case 'income':
      actor.coins += INCOME_GAIN;
      log(state, `${actor.displayName} took Income (+1).`);
      return endTurn(state);
    case 'foreign_aid':
      log(state, `${actor.displayName} attempts Foreign Aid (+2).`);
      return openBlockWindow(state);
    case 'coup':
      log(state, `${actor.displayName} launched a Coup on ${nameOf(state, targetId)} (-7).`);
      return startLoseInfluence(state, targetId!, 'coup', { kind: 'end_turn' });
    case 'tax':
      state.pending.claimedCharacter = 'duke';
      log(state, `${actor.displayName} claims Duke — Tax (+3).`);
      return openActionChallenge(state);
    case 'assassinate':
      state.pending.claimedCharacter = 'assassin';
      log(state, `${actor.displayName} claims Assassin — assassinate ${nameOf(state, targetId)} (-3).`);
      return openActionChallenge(state);
    case 'steal':
      state.pending.claimedCharacter = 'captain';
      log(state, `${actor.displayName} claims Captain — steal from ${nameOf(state, targetId)}.`);
      return openActionChallenge(state);
    case 'exchange':
      state.pending.claimedCharacter = 'ambassador';
      log(state, `${actor.displayName} claims Ambassador — Exchange.`);
      return openActionChallenge(state);
    default:
      return fail('That action is not available yet');
  }
}

// ---------------------------------------------------------------------------
// 2. Windows
// ---------------------------------------------------------------------------

function openActionChallenge(state: CoupServerState): EngineResult {
  state.pending.phase = 'awaiting_action_challenge';
  state.pending.passed = new Set();
  if (eligibleResponders(state).length === 0) return proceedAfterActionSurvives(state);
  armTimer(state);
  return OK;
}

function openBlockWindow(state: CoupServerState): EngineResult {
  state.pending.phase = 'awaiting_block';
  state.pending.passed = new Set();
  if (eligibleBlockerIds(state).length === 0) return resolveActionEffect(state);
  armTimer(state);
  return OK;
}

function openBlockChallenge(state: CoupServerState): EngineResult {
  state.pending.phase = 'awaiting_block_challenge';
  state.pending.passed = new Set();
  if (eligibleResponders(state).length === 0) return blockStands(state);
  armTimer(state);
  return OK;
}

// ---------------------------------------------------------------------------
// 3. Responses (challenge / block / pass)
// ---------------------------------------------------------------------------

export function respond(
  state: CoupServerState,
  playerId: string,
  payload: { response: 'challenge' | 'block' | 'pass'; blockCharacter?: CoupCharacter },
): EngineResult {
  switch (state.pending.phase) {
    case 'awaiting_action_challenge':
      return respondActionChallenge(state, playerId, payload.response);
    case 'awaiting_block':
      return respondBlock(state, playerId, payload.response, payload.blockCharacter);
    case 'awaiting_block_challenge':
      return respondBlockChallenge(state, playerId, payload.response);
    default:
      return fail('There is nothing to respond to right now');
  }
}

function respondActionChallenge(
  state: CoupServerState,
  playerId: string,
  response: 'challenge' | 'block' | 'pass',
): EngineResult {
  if (!eligibleResponders(state).includes(playerId)) return fail('You cannot respond now');
  if (state.pending.passed.has(playerId)) return fail('You already responded');
  if (response === 'block') return fail('You can only block after the challenge window');

  if (response === 'pass') {
    state.pending.passed.add(playerId);
    return windowComplete(state) ? proceedAfterActionSurvives(state) : OK;
  }
  // challenge the actor's claimed character
  return resolveActionChallenge(state, playerId);
}

function resolveActionChallenge(state: CoupServerState, challengerId: string): EngineResult {
  const actor = state.players.get(state.pending.actorId)!;
  const claim = state.pending.claimedCharacter!;
  const challenger = state.players.get(challengerId)!;

  if (hasCharacter(actor, claim)) {
    // Challenger was wrong: actor proves it, reshuffles, draws; challenger loses.
    log(state, `${challenger.displayName} challenged — ${actor.displayName} reveals ${cap(claim)}. Challenge fails.`);
    reshuffleReveal(state, actor, claim);
    return startLoseInfluence(state, challengerId, 'failed_challenge', { kind: 'proceed_action' });
  }
  // Actor was bluffing: action fails, cost refunded, actor loses an influence.
  log(state, `${challenger.displayName} challenged — ${actor.displayName} could not show ${cap(claim)}. Bluff caught!`);
  actor.coins += ACTION_META[state.pending.action!].cost; // refund (e.g. assassinate)
  return startLoseInfluence(state, state.pending.actorId, 'failed_bluff', { kind: 'end_turn' });
}

function respondBlock(
  state: CoupServerState,
  playerId: string,
  response: 'challenge' | 'block' | 'pass',
  blockCharacter?: CoupCharacter,
): EngineResult {
  if (!eligibleBlockerIds(state).includes(playerId)) return fail('You cannot block now');
  if (state.pending.passed.has(playerId)) return fail('You already responded');
  if (response === 'challenge') return fail('Challenge the block in the next window, not now');

  if (response === 'pass') {
    state.pending.passed.add(playerId);
    return windowComplete(state) ? resolveActionEffect(state) : OK;
  }

  // declare a block
  const allowed = ACTION_META[state.pending.action!].blockableBy.filter((c) =>
    charactersForVariant(state.variant).includes(c),
  );
  let bc = blockCharacter;
  if (!bc) {
    if (allowed.length === 1) bc = allowed[0];
    else return fail('Choose which character blocks');
  }
  if (!allowed.includes(bc)) return fail('That character cannot block this action');

  const blocker = state.players.get(playerId)!;
  state.pending.blockerId = playerId;
  state.pending.blockCharacter = bc;
  log(state, `${blocker.displayName} claims ${cap(bc)} to block.`);
  return openBlockChallenge(state);
}

function respondBlockChallenge(
  state: CoupServerState,
  playerId: string,
  response: 'challenge' | 'block' | 'pass',
): EngineResult {
  if (!eligibleResponders(state).includes(playerId)) return fail('You cannot respond now');
  if (state.pending.passed.has(playerId)) return fail('You already responded');
  if (response === 'block') return fail('There is already a block on the table');

  if (response === 'pass') {
    state.pending.passed.add(playerId);
    return windowComplete(state) ? blockStands(state) : OK;
  }
  // challenge the block
  const blocker = state.players.get(state.pending.blockerId!)!;
  const bc = state.pending.blockCharacter!;
  const challenger = state.players.get(playerId)!;

  if (hasCharacter(blocker, bc)) {
    // Block is real: challenger was wrong, block stands, action is countered.
    log(state, `${challenger.displayName} challenged the block — ${blocker.displayName} reveals ${cap(bc)}. Block holds.`);
    reshuffleReveal(state, blocker, bc);
    return startLoseInfluence(state, playerId, 'failed_challenge', { kind: 'end_turn' });
  }
  // Block was a bluff: blocker loses an influence, the original action resolves.
  log(state, `${challenger.displayName} challenged the block — ${blocker.displayName} could not show ${cap(bc)}. Block fails!`);
  return startLoseInfluence(state, state.pending.blockerId!, 'failed_bluff', { kind: 'resolve_action' });
}

function blockStands(state: CoupServerState): EngineResult {
  log(state, `${nameOf(state, state.pending.actorId)}'s ${actionLabel(state.pending.action)} was blocked.`);
  return endTurn(state);
}

// ---------------------------------------------------------------------------
// 4. Resolution
// ---------------------------------------------------------------------------

function proceedAfterActionSurvives(state: CoupServerState): EngineResult {
  const meta = ACTION_META[state.pending.action!];
  if (meta.needsTarget) {
    const target = state.pending.targetId ? state.players.get(state.pending.targetId) : null;
    if (!target || aliveCardCount(target) === 0) return endTurn(state); // target already gone
  }
  if (eligibleBlockerIds(state).length > 0) return openBlockWindow(state);
  return resolveActionEffect(state);
}

function resolveActionEffect(state: CoupServerState): EngineResult {
  const p = state.pending;
  const actor = state.players.get(p.actorId)!;
  const target = p.targetId ? state.players.get(p.targetId) : null;

  switch (p.action) {
    case 'foreign_aid':
      actor.coins += FOREIGN_AID_GAIN;
      log(state, `${actor.displayName} took Foreign Aid (+2).`);
      return endTurn(state);
    case 'tax':
      actor.coins += TAX_GAIN;
      log(state, `${actor.displayName} taxed (+3).`);
      return endTurn(state);
    case 'steal': {
      if (!target || aliveCardCount(target) === 0) return endTurn(state);
      const amt = Math.min(STEAL_MAX, target.coins);
      target.coins -= amt;
      actor.coins += amt;
      log(state, `${actor.displayName} stole ${amt} from ${target.displayName}.`);
      return endTurn(state);
    }
    case 'assassinate': {
      if (!target || aliveCardCount(target) === 0) return endTurn(state);
      log(state, `${actor.displayName} assassinates ${target.displayName}.`);
      return startLoseInfluence(state, target.playerId, 'assassinate', { kind: 'end_turn' });
    }
    case 'exchange':
      return openExchange(state);
    default:
      return endTurn(state);
  }
}

function openExchange(state: CoupServerState): EngineResult {
  const actor = state.players.get(state.pending.actorId)!;
  const keep = aliveCardCount(actor);
  const drawn: CoupCharacter[] = [];
  for (let i = 0; i < 2 && state.deck.length > 0; i++) drawn.push(state.deck.shift()!);
  const pool = [...actor.influences.filter((i) => !i.revealed).map((i) => i.character), ...drawn];
  state.pending.phase = 'awaiting_exchange';
  state.pending.exchangePool = pool;
  state.pending.exchangeKeep = keep;
  armTimer(state);
  return OK;
}

// ---------------------------------------------------------------------------
// 5. Influence loss
// ---------------------------------------------------------------------------

function startLoseInfluence(
  state: CoupServerState,
  loserId: string,
  reason: LoseInfluenceReason,
  resume: Resume,
): EngineResult {
  const loser = state.players.get(loserId)!;
  const alive = loser.influences.filter((i) => !i.revealed);
  if (alive.length === 0) return runResume(state, resume); // nothing to lose
  if (alive.length === 1) {
    applyReveal(state, loser, alive[0].character);
    return afterLoss(state, resume);
  }
  state.pending.phase = 'awaiting_lose_influence';
  state.pending.losingPlayerId = loserId;
  state.pending.loseReason = reason;
  state.pending.resume = resume;
  armTimer(state);
  return OK;
}

export function loseInfluence(
  state: CoupServerState,
  playerId: string,
  character: CoupCharacter,
): EngineResult {
  if (state.pending.phase !== 'awaiting_lose_influence') return fail('No influence to lose right now');
  if (state.pending.losingPlayerId !== playerId) return fail('You are not losing an influence');
  const p = state.players.get(playerId)!;
  if (!hasCharacter(p, character)) return fail('You do not have that character face-down');
  const resume = state.pending.resume!;
  applyReveal(state, p, character);
  return afterLoss(state, resume);
}

function applyReveal(state: CoupServerState, p: CoupPlayerState, character: CoupCharacter): void {
  const inf = p.influences.find((i) => !i.revealed && i.character === character);
  if (!inf) return;
  inf.revealed = true;
  log(state, `${p.displayName} reveals and loses ${cap(character)}.`);
  if (aliveCardCount(p) === 0) {
    p.eliminated = true;
    log(state, `${p.displayName} is out of the game.`);
  }
}

/** After any influence loss: check for a winner, else run the continuation. */
function afterLoss(state: CoupServerState, resume: Resume): EngineResult {
  if (checkWin(state)) return OK;
  return runResume(state, resume);
}

function runResume(state: CoupServerState, resume: Resume): EngineResult {
  switch (resume.kind) {
    case 'end_turn':
      return endTurn(state);
    case 'proceed_action':
      return proceedAfterActionSurvives(state);
    case 'resolve_action':
      return resolveActionEffect(state);
  }
}

// ---------------------------------------------------------------------------
// 6. Exchange submission
// ---------------------------------------------------------------------------

export function chooseExchange(
  state: CoupServerState,
  playerId: string,
  keep: CoupCharacter[],
): EngineResult {
  if (state.pending.phase !== 'awaiting_exchange') return fail('Not exchanging right now');
  if (state.pending.actorId !== playerId) return fail('It is not your exchange');
  const pool = state.pending.exchangePool!;
  const need = state.pending.exchangeKeep;
  if (keep.length !== need) return fail(`You must keep exactly ${need} card${need === 1 ? '' : 's'}`);
  if (!isSubMultiset(keep, pool)) return fail('Those cards are not in your exchange options');

  const actor = state.players.get(playerId)!;
  const revealed = actor.influences.filter((i) => i.revealed);
  actor.influences = [...revealed, ...keep.map((c) => ({ character: c, revealed: false }))];

  // return the unkept cards to the deck
  const returned = removeMultiset(pool, keep);
  state.deck.push(...returned);
  state.deck = shuffle(state.deck);

  log(state, `${actor.displayName} exchanged cards with the court.`);
  return endTurn(state);
}

// ---------------------------------------------------------------------------
// 7. Turn / win
// ---------------------------------------------------------------------------

function endTurn(state: CoupServerState): EngineResult {
  if (state.status === 'game_over') return OK;
  const n = state.turnOrder.length;
  for (let i = 1; i <= n; i++) {
    const idx = (state.currentTurnIndex + i) % n;
    if (aliveCardCount(state.players.get(state.turnOrder[idx])!) > 0) {
      state.currentTurnIndex = idx;
      break;
    }
  }
  state.pending = freshPending(currentPlayerId(state));
  return OK;
}

function checkWin(state: CoupServerState): boolean {
  const alive = aliveIds(state);
  if (alive.length <= 1) {
    state.status = 'game_over';
    state.winnerId = alive[0] ?? null;
    state.pending.phase = 'game_over';
    state.pending.deadline = null;
    if (state.winnerId) log(state, `${nameOf(state, state.winnerId)} wins the game!`);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 8. Timer-driven window expiry (auto-pass) — called by the socket layer
// ---------------------------------------------------------------------------

export function expireWindow(state: CoupServerState): EngineResult {
  switch (state.pending.phase) {
    case 'awaiting_action_challenge':
      return proceedAfterActionSurvives(state);
    case 'awaiting_block':
      return resolveActionEffect(state);
    case 'awaiting_block_challenge':
      return blockStands(state);
    case 'awaiting_lose_influence': {
      // auto-reveal the first face-down card
      const loser = state.players.get(state.pending.losingPlayerId!)!;
      const first = loser.influences.find((i) => !i.revealed);
      if (!first) return OK;
      const resume = state.pending.resume!;
      applyReveal(state, loser, first.character);
      return afterLoss(state, resume);
    }
    case 'awaiting_exchange': {
      // auto-keep the player's first `keepCount` options (i.e. keep current cards)
      const need = state.pending.exchangeKeep;
      const keep = (state.pending.exchangePool ?? []).slice(0, need);
      return chooseExchange(state, state.pending.actorId, keep);
    }
    default:
      return OK;
  }
}

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

function cap(c: CoupCharacter): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function actionLabel(a: CoupActionType | null): string {
  return a ? a.replace(/_/g, ' ') : 'action';
}

function isSubMultiset<T>(sub: T[], sup: T[]): boolean {
  const pool = [...sup];
  for (const x of sub) {
    const i = pool.indexOf(x);
    if (i === -1) return false;
    pool.splice(i, 1);
  }
  return true;
}

function removeMultiset<T>(from: T[], remove: T[]): T[] {
  const pool = [...from];
  for (const x of remove) {
    const i = pool.indexOf(x);
    if (i !== -1) pool.splice(i, 1);
  }
  return pool;
}
