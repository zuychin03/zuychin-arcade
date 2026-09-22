// Coup (+ Reformation) authoritative engine. Pure: no IO, no sockets.
//
// The whole design problem is interactivity - see COUP_PLAN.md §3. Unlike
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
  CoupRespondPayload,
  CoupVariant,
  LoseInfluenceReason,
} from '@zuychin-arcade/types';
import {
  ACTION_META,
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
  challengerId: string | null;
  challengeKind: 'action' | 'block' | null;
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
  revision: number;
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
  terminationReason: 'no_players_remaining' | null;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function initGame(
  roomCode: string,
  variant: CoupVariant,
  players: { playerId: string; displayName: string }[],
): CoupServerState {
  const n = players.length;
  if (players.some((player) => typeof player.playerId !== 'string' || player.playerId.length === 0)) {
    throw new TypeError('Every Coup player needs a non-empty playerId');
  }
  if (new Set(players.map((player) => player.playerId)).size !== n) {
    throw new TypeError('Coup playerIds must be unique');
  }
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
      forfeited: false,
    });
  });

  const state: CoupServerState = {
    roomCode,
    revision: 0,
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
    terminationReason: null,
  };
  log(state, `Game started - ${n} players, ${variant} rules.`);
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
    challengerId: null,
    challengeKind: null,
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

function stale(state: CoupServerState, expectedRevision: unknown): EngineResult | null {
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) {
    return fail('A valid game state revision is required');
  }
  return expectedRevision !== state.revision
    ? fail('Game state changed. Please try again.')
    : null;
}

function commit(state: CoupServerState, result: EngineResult): EngineResult {
  if (result.ok) state.revision += 1;
  return result;
}

const VALID_CHARACTERS = new Set<CoupCharacter>([
  'duke',
  'assassin',
  'captain',
  'ambassador',
  'contessa',
  'inquisitor',
]);

function isAction(value: unknown): value is CoupActionType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACTION_META, value);
}

// ---------------------------------------------------------------------------
// 1. Action declaration
// ---------------------------------------------------------------------------

export function declareAction(
  state: CoupServerState,
  playerId: string,
  payload: CoupActionPayload,
): EngineResult {
  const staleResult = stale(state, payload?.expectedRevision);
  if (staleResult) return staleResult;
  if (!payload || !isAction(payload.action)) return fail('Unknown action');
  return commit(state, declareActionUnchecked(state, playerId, payload));
}

function declareActionUnchecked(
  state: CoupServerState,
  playerId: string,
  payload: Pick<CoupActionPayload, 'action' | 'targetPlayerId'>,
): EngineResult {
  if (state.status !== 'playing') return fail('The game is over');
  if (state.pending.phase !== 'awaiting_action') return fail('Not waiting for an action right now');
  if (currentPlayerId(state) !== playerId) return fail('It is not your turn');

  const actor = state.players.get(playerId)!;
  const action = payload.action;
  const meta = ACTION_META[action];
  if (meta.reformationOnly && state.variant !== 'reformation') {
    return fail('That action is only available with Reformation rules');
  }
  if (meta.reformationOnly) return fail('That action is not available yet'); // Phase 2

  if (actor.coins >= MANDATORY_COUP_AT && action !== 'coup') {
    return fail('You have 10 or more coins and must launch a Coup');
  }
  if (actor.coins < meta.cost) return fail('Not enough coins');
  if (!meta.needsTarget && payload.targetPlayerId !== undefined) {
    return fail('This action does not take a target');
  }

  let targetId: string | null = null;
  if (meta.needsTarget) {
    targetId = typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : null;
    if (!targetId) return fail('This action needs a target');
    if (targetId === playerId) return fail('You cannot target yourself');
    const target = state.players.get(targetId);
    if (!target || aliveCardCount(target) === 0) return fail('Invalid target');
    if (action === 'steal' && target.coins === 0) return fail('Choose a player who has coins');
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
      log(state, `${actor.displayName} claims Duke - Tax (+3).`);
      return openActionChallenge(state);
    case 'assassinate':
      state.pending.claimedCharacter = 'assassin';
      log(state, `${actor.displayName} claims Assassin - assassinate ${nameOf(state, targetId)} (-3).`);
      return openActionChallenge(state);
    case 'steal':
      state.pending.claimedCharacter = 'captain';
      log(state, `${actor.displayName} claims Captain - steal from ${nameOf(state, targetId)}.`);
      return openActionChallenge(state);
    case 'exchange':
      state.pending.claimedCharacter = 'ambassador';
      log(state, `${actor.displayName} claims Ambassador - Exchange.`);
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
  payload: CoupRespondPayload,
): EngineResult {
  const staleResult = stale(state, payload?.expectedRevision);
  if (staleResult) return staleResult;
  if (!payload || !['challenge', 'block', 'pass'].includes(payload.response)) {
    return fail('Invalid response');
  }
  if (payload.response !== 'block' && payload.blockCharacter !== undefined) {
    return fail('Only a block may name a blocking character');
  }
  return commit(state, respondUnchecked(state, playerId, payload));
}

function respondUnchecked(
  state: CoupServerState,
  playerId: string,
  payload: Pick<CoupRespondPayload, 'response' | 'blockCharacter'>,
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
  return openChallengeDecision(state, playerId, 'action');
}

function openChallengeDecision(
  state: CoupServerState,
  challengerId: string,
  kind: 'action' | 'block',
): EngineResult {
  state.pending.phase = 'awaiting_challenge_decision';
  state.pending.challengerId = challengerId;
  state.pending.challengeKind = kind;
  state.pending.passed = new Set();
  armTimer(state);
  return OK;
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
  return openChallengeDecision(state, playerId, 'block');
}

export function resolveChallenge(
  state: CoupServerState,
  playerId: string,
  prove: boolean,
  expectedRevision: number,
): EngineResult {
  const staleResult = stale(state, expectedRevision);
  if (staleResult) return staleResult;
  if (typeof prove !== 'boolean') return fail('Choose whether to prove or concede');
  return commit(state, resolveChallengeUnchecked(state, playerId, prove));
}

function resolveChallengeUnchecked(
  state: CoupServerState,
  playerId: string,
  prove: boolean,
): EngineResult {
  const pending = state.pending;
  if (pending.phase !== 'awaiting_challenge_decision' || !pending.challengeKind) {
    return fail('There is no challenge to resolve');
  }

  const isBlock = pending.challengeKind === 'block';
  const claimantId = isBlock ? pending.blockerId : pending.actorId;
  if (!claimantId || claimantId !== playerId) return fail('Only the challenged player can decide');

  const claimant = state.players.get(claimantId)!;
  const challengerId = pending.challengerId!;
  const challenger = state.players.get(challengerId)!;
  const claim = isBlock ? pending.blockCharacter! : pending.claimedCharacter!;

  if (prove) {
    if (!hasCharacter(claimant, claim)) return fail(`You cannot prove ${cap(claim)}`);
    log(
      state,
      `${challenger.displayName} challenged - ${claimant.displayName} proves ${cap(claim)}. Challenge fails.`,
    );
    reshuffleReveal(state, claimant, claim);
    pending.challengerId = null;
    pending.challengeKind = null;
    if (isBlock) {
      return startLoseInfluence(state, challengerId, 'failed_challenge', { kind: 'end_turn' });
    }
    const resume: Resume =
      pending.action === 'assassinate' && pending.targetId === challengerId
        ? { kind: 'resolve_action' }
        : { kind: 'proceed_action' };
    return startLoseInfluence(state, challengerId, 'failed_challenge', resume);
  }

  log(state, `${claimant.displayName} concedes the challenge to ${challenger.displayName}.`);
  pending.challengerId = null;
  pending.challengeKind = null;
  if (isBlock) {
    return startLoseInfluence(state, claimantId, 'conceded_challenge', { kind: 'resolve_action' });
  }
  claimant.coins += ACTION_META[pending.action!].cost;
  return startLoseInfluence(state, claimantId, 'conceded_challenge', { kind: 'end_turn' });
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
      if (!target) return endTurn(state);
      const amt = Math.min(STEAL_MAX, target.coins);
      target.coins -= amt;
      actor.coins += amt;
      log(state, `${actor.displayName} stole ${amt} from ${target.displayName}.`);
      if (target.eliminated) target.coins = 0;
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
  state.pending.losingPlayerId = loserId;
  state.pending.loseReason = reason;
  state.pending.resume = resume;
  if (alive.length === 0) {
    clearLossDecision(state);
    return runResume(state, resume);
  }
  if (alive.length === 1) {
    applyReveal(state, loser, alive[0].character);
    return afterLoss(state, resume);
  }
  state.pending.phase = 'awaiting_lose_influence';
  armTimer(state);
  return OK;
}

export function loseInfluence(
  state: CoupServerState,
  playerId: string,
  character: CoupCharacter,
  expectedRevision: number,
): EngineResult {
  const staleResult = stale(state, expectedRevision);
  if (staleResult) return staleResult;
  if (!VALID_CHARACTERS.has(character)) return fail('Invalid character');
  return commit(state, loseInfluenceUnchecked(state, playerId, character));
}

function loseInfluenceUnchecked(
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
  const loserId = state.pending.losingPlayerId;
  const loser = loserId ? state.players.get(loserId) : null;
  const resolveStealBeforeCleanup =
    loser?.eliminated === true &&
    resume.kind === 'resolve_action' &&
    state.pending.action === 'steal' &&
    state.pending.targetId === loserId;
  clearLossDecision(state);
  if (resolveStealBeforeCleanup) return runResume(state, resume);
  if (loser?.eliminated) loser.coins = 0;
  if (checkWin(state)) return OK;
  return runResume(state, resume);
}

function clearLossDecision(state: CoupServerState): void {
  state.pending.losingPlayerId = null;
  state.pending.loseReason = null;
  state.pending.resume = null;
  state.pending.deadline = null;
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
  expectedRevision: number,
): EngineResult {
  const staleResult = stale(state, expectedRevision);
  if (staleResult) return staleResult;
  if (!Array.isArray(keep) || keep.some((character) => !VALID_CHARACTERS.has(character))) {
    return fail('Invalid exchange selection');
  }
  return commit(state, chooseExchangeUnchecked(state, playerId, keep));
}

function chooseExchangeUnchecked(
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
  if (checkWin(state)) return OK;
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
    state.terminationReason = alive.length === 0 ? 'no_players_remaining' : null;
    returnExchangeDraw(state);
    state.pending = freshPending('');
    state.pending.phase = 'game_over';
    state.pending.deadline = null;
    if (state.winnerId) log(state, `${nameOf(state, state.winnerId)} wins the game!`);
    else log(state, 'Game ended without a winner: no players remain.');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 8. Timer-driven window expiry (auto-pass) - called by the socket layer
// ---------------------------------------------------------------------------

export function expireWindow(state: CoupServerState, expectedRevision: number): EngineResult {
  const staleResult = stale(state, expectedRevision);
  if (staleResult) return staleResult;
  return commit(state, expireWindowUnchecked(state));
}

function expireWindowUnchecked(state: CoupServerState): EngineResult {
  switch (state.pending.phase) {
    case 'awaiting_action_challenge':
      return proceedAfterActionSurvives(state);
    case 'awaiting_block':
      return resolveActionEffect(state);
    case 'awaiting_block_challenge':
      return blockStands(state);
    case 'awaiting_challenge_decision': {
      const claimantId = challengeClaimantId(state);
      if (!claimantId) return fail('The challenged player is unavailable');
      const claim = challengeCharacter(state);
      return resolveChallengeUnchecked(
        state,
        claimantId,
        claim !== null && hasCharacter(state.players.get(claimantId)!, claim),
      );
    }
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
      // Keep the player's original cards when their decision window expires.
      const need = state.pending.exchangeKeep;
      const keep = (state.pending.exchangePool ?? []).slice(0, need);
      return chooseExchangeUnchecked(state, state.pending.actorId, keep);
    }
    default:
      return fail('There is no decision window to expire');
  }
}

export function resolveAbsentDecision(
  state: CoupServerState,
  playerId: string,
  expectedRevision: number,
): EngineResult {
  return forfeitPlayer(state, playerId, expectedRevision);
}

export function forfeitPlayer(
  state: CoupServerState,
  playerId: string,
  expectedRevision: number,
): EngineResult {
  return forfeitPlayers(state, [playerId], expectedRevision);
}

export function forfeitPlayers(
  state: CoupServerState,
  playerIds: string[],
  expectedRevision: number,
): EngineResult {
  const staleResult = stale(state, expectedRevision);
  if (staleResult) return staleResult;
  if (!Array.isArray(playerIds) || playerIds.length === 0) return fail('Choose players to forfeit');
  if (playerIds.some((id) => typeof id !== 'string' || !state.players.has(id))) return fail('Unknown player');
  return commit(state, forfeitPlayersUnchecked(state, new Set(playerIds)));
}

function forfeitPlayersUnchecked(state: CoupServerState, playerIds: Set<string>): EngineResult {
  if (state.status !== 'playing') return fail('The game is over');
  const departing = new Set([...playerIds].filter((id) => aliveCardCount(state.players.get(id)!) > 0));
  if (departing.size === 0) return fail('Those players are already out');

  const phase = state.pending.phase;
  const leaves = (id: string | null) => id !== null && departing.has(id);
  const wasActor = leaves(state.pending.actorId);
  const wasTarget = leaves(state.pending.targetId);
  const wasBlocker = leaves(state.pending.blockerId);
  const wasChallenger = leaves(state.pending.challengerId);
  const wasLoser = leaves(state.pending.losingPlayerId);
  const challengeKind = state.pending.challengeKind;
  const resume = state.pending.resume;
  const resolveStealBeforeCleanup =
    phase === 'awaiting_lose_influence'
    && wasLoser
    && wasTarget
    && !wasActor
    && resume?.kind === 'resolve_action'
    && state.pending.action === 'steal';

  if (phase === 'awaiting_exchange' && wasActor) returnExchangeDraw(state);
  // Remove the entire batch before any continuation can select a winner.
  for (const playerId of departing) {
    const player = state.players.get(playerId)!;
    state.pending.passed.delete(playerId);
    log(state, `${player.displayName} forfeits the game.`);
    for (const influence of player.influences) {
      if (influence.revealed) continue;
      influence.revealed = true;
      log(state, `${player.displayName} reveals and loses ${cap(influence.character)}.`);
    }
    player.eliminated = true;
    player.forfeited = true;
    if (!resolveStealBeforeCleanup || playerId !== state.pending.targetId) player.coins = 0;
  }

  if (resolveStealBeforeCleanup && resume) {
    clearLossDecision(state);
    return runResume(state, resume);
  }

  const owedLossSurvives = phase === 'awaiting_lose_influence' && !wasLoser;
  if (aliveIds(state).length <= 1 && !owedLossSurvives) {
    if (state.pending.phase === 'awaiting_exchange') returnExchangeDraw(state);
    checkWin(state);
    return OK;
  }

  if (wasActor) {
    if (phase === 'awaiting_lose_influence' && !wasLoser) {
      // A departure cancels unfinished actions, not an already adjudicated loss.
      state.pending.resume = { kind: 'end_turn' };
      return OK;
    }
    return endTurn(state);
  }

  switch (phase) {
    case 'awaiting_action':
      return OK;
    case 'awaiting_action_challenge':
      if (wasTarget) return endTurn(state);
      return windowComplete(state) ? proceedAfterActionSurvives(state) : OK;
    case 'awaiting_block':
      if (wasTarget) return endTurn(state);
      return windowComplete(state) ? resolveActionEffect(state) : OK;
    case 'awaiting_block_challenge':
      if (wasBlocker) return resolveActionEffect(state);
      if (wasTarget) return endTurn(state);
      return windowComplete(state) ? blockStands(state) : OK;
    case 'awaiting_challenge_decision':
      if (wasBlocker) return resolveActionEffect(state);
      if (wasChallenger) {
        state.pending.challengerId = null;
        state.pending.challengeKind = null;
        return challengeKind === 'block' ? blockStands(state) : proceedAfterActionSurvives(state);
      }
      if (wasTarget) return endTurn(state);
      return OK;
    case 'awaiting_lose_influence':
      if (wasLoser && resume) {
        clearLossDecision(state);
        return runResume(state, resume);
      }
      return OK;
    case 'awaiting_exchange':
      return OK;
    default:
      return wasTarget ? endTurn(state) : OK;
  }
}

function challengeClaimantId(state: CoupServerState): string | null {
  return state.pending.challengeKind === 'block' ? state.pending.blockerId : state.pending.actorId;
}

function challengeCharacter(state: CoupServerState): CoupCharacter | null {
  return state.pending.challengeKind === 'block'
    ? state.pending.blockCharacter
    : state.pending.claimedCharacter;
}

function returnExchangeDraw(state: CoupServerState): void {
  if (state.pending.phase !== 'awaiting_exchange' || !state.pending.exchangePool) return;
  const drawn = state.pending.exchangePool.slice(state.pending.exchangeKeep);
  state.deck.push(...drawn);
  state.deck = shuffle(state.deck);
  state.pending.exchangePool = null;
  state.pending.exchangeKeep = 0;
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
