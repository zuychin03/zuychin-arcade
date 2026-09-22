import type {
  KingOfTokyoDefenseDecision, KingOfTokyoDefenseMode, KingOfTokyoDiceResolutionPlan, KingOfTokyoDie, KingOfTokyoDieFace,
  KingOfTokyoEndTurnEffect, KingOfTokyoLogEntry, KingOfTokyoMarketCard, KingOfTokyoOwnedPowerCard,
  KingOfTokyoHeartAllocation,
  KingOfTokyoPhase, KingOfTokyoPlayer,
  KingOfTokyoPowerCardId, KingOfTokyoTokenPreference, KingOfTokyoVictoryType, KingOfTokyoZone,
} from '@zuychin-arcade/types';
import {
  KING_OF_TOKYO_DECK_SIZE, KING_OF_TOKYO_DICE_COUNT, KING_OF_TOKYO_DIE_FACES,
  KING_OF_TOKYO_MAX_HEALTH, KING_OF_TOKYO_MAX_PLAYERS, KING_OF_TOKYO_MAX_ROLLS,
  KING_OF_TOKYO_MIN_PLAYERS, KING_OF_TOKYO_POWER_CARD_BY_ID, KING_OF_TOKYO_POWER_CARDS,
  KING_OF_TOKYO_RULES_VERSION, KING_OF_TOKYO_STARTING_HEALTH, KING_OF_TOKYO_VICTORY_POINTS,
  kingOfTokyoCapacity,
} from '@zuychin-arcade/types';

export type EngineResult = { ok: true } | { ok: false; reason: string };
export type RandomSource = () => number;
const OK: EngineResult = { ok: true };
const fail = (reason: string): EngineResult => ({ ok: false, reason });

interface OpportunistWindow { cardInstanceId: string; playerIds: string[] }
interface OpportunistReveal { cardInstanceId: string; playerIds: string[] }
interface PsychicProbeWindow { playerId: string; cardInstanceId: string }
interface PendingDiceResolution {
  playerId: string;
  remainingCategories: KingOfTokyoDiceResolutionPlan['resolutionOrder'];
}
interface PendingHeartAllocation {
  playerId: string;
  heartIndexes: number[];
  healingRayAvailable: boolean;
}
interface DeathWatcherEntitlement {
  playerId: string;
  copies: number;
}
interface SmashDamageEntitlements {
  camouflage: number;
  armorPlating: number;
  wings: number;
  rapidHealing: number;
  stretchy: number;
  makingItStronger: number;
  childEntitled: boolean;
}
interface PendingTokyoDamage {
  amount: number;
  poisonTokens: number;
  shrinkTokens: number;
  jetsCardInstanceIds: string[];
  jetsSnapshotGranted: boolean;
  smashEntitlements: SmashDamageEntitlements;
  deathWatcherEntitlements: DeathWatcherEntitlement[];
  deferredEvenBiggerLoss: number;
}
interface PendingSmashAftermath {
  actorId: string;
  alphaPoints: number;
  fireSources: number;
  fireNeighborIds: string[];
}
interface PendingSmashResolution {
  actorId: string;
  smashes: number;
  targetPlayerIds: string[];
  poisonTokens: number;
  shrinkTokens: number;
  woundedTokyoTargetIds: string[];
}
interface PendingBurrowingYield {
  entrantPlayerId: string;
  sourcePlayerId: string;
  zone: KingOfTokyoZone;
  copies: number;
}
interface PendingDeathFromAbove {
  playerId: string;
  targetPlayerIds: string[];
}
interface PendingFreezeTimeDecision {
  playerId: string;
  cardInstanceId: string;
  dicePenalty: number;
}
interface TokyoBayNormalization {
  player: KingOfTokyoPlayer;
  movedToCity: boolean;
}
interface ActiveTurnCardEffects {
  playerId: string;
  extraHead: number;
  giantBrain: number;
}

type PendingDamageTargetStage = 'camouflage' | 'armor' | 'wings' | 'rapid_healing' | 'apply' | 'done';
interface PendingDamageTarget {
  playerId: string;
  rawAmount: number;
  amount: number;
  lost: number;
  stage: PendingDamageTargetStage;
  camouflageCopyIndex: number;
  camouflageFaces: KingOfTokyoDieFace[];
  entitlements: SmashDamageEntitlements;
}
interface PendingDamageWorkflow {
  previousPhase: KingOfTokyoPhase;
  sourcePlayerId: string | null;
  kind: DamageKind;
  targets: PendingDamageTarget[];
  targetIndex: number;
  fatalityPlayerIds: string[];
  deathWatcherEntitlements: DeathWatcherEntitlement[];
  deferPendingTokyoEvenBiggerLoss: boolean;
  preservePendingJetsEntitlements: boolean;
}
interface PendingDefenseDecision {
  kind: 'camouflage' | 'wings' | 'rapid_healing';
  playerId: string;
  incomingDamage: number;
  remainingDamage: number;
  camouflageCopy: number | null;
  camouflageCopies: number | null;
  dice: KingOfTokyoDieFace[];
  maxActivations: number;
}
interface StoredDamageOutcome {
  losses: { playerId: string; amount: number }[];
  consumedBodyPlayerIds: string[];
}
interface PendingEvenBiggerLoss {
  playerId: string;
  copiesRemaining: number;
  finalMaxHealth: number;
  entitlements: SmashDamageEntitlements;
  deathWatcherEntitlements: DeathWatcherEntitlement[];
  preservePendingJetsEntitlements: boolean;
}
type ResolutionTask =
  | { kind: 'complete_smash_direct' }
  | { kind: 'reconcile_jets' }
  | { kind: 'normalize_tokyo' }
  | { kind: 'finalize_smash_queue' }
  | { kind: 'continue_fire' }
  | { kind: 'resume_dice_after_smash' }
  | { kind: 'complete_tokyo_smash'; playerId: string; pendingDamage: PendingTokyoDamage; mode: 'stay' | 'stale' | 'normalization' }
  | { kind: 'resume_tokyo_queue' }
  | { kind: 'continue_burrowing'; playerId: string; sourcePlayerId: string; copiesRemaining: number }
  | { kind: 'drain_even_bigger_losses' }
  | { kind: 'complete_even_bigger_loss'; pending: PendingEvenBiggerLoss }
  | {
      kind: 'complete_tokyo_smash_after_even_bigger';
      playerId: string;
      pendingDamage: PendingTokyoDamage;
      mode: 'stay' | 'stale' | 'normalization';
      lost: number;
    }
  | { kind: 'complete_tokyo_yield_after_even_bigger'; playerId: string }
  | { kind: 'complete_power_sale'; playerId: string; cardId: KingOfTokyoPowerCardId; value: number }
  | { kind: 'complete_mimic_retarget'; playerId: string; initialTarget: boolean }
  | {
      kind: 'resume_forfeit';
      playerId: string;
      wasCurrentPlayer: boolean;
      deathFromAboveOwnerId: string | null;
    }
  | { kind: 'resume_purchase'; mode: 'market' | 'opportunist' | 'lab'; buyerId: string; previousPhase: KingOfTokyoPhase }
  | { kind: 'complete_end_turn_damage'; playerId: string }
  | { kind: 'resume_death_from_above' }
  | { kind: 'finish_dice_after_entry' };

export interface KingOfTokyoServerState {
  gameId: 'king_of_tokyo';
  roomCode: string;
  revision: number;
  startingRevision: number;
  rulesVersion: string;
  status: 'playing' | 'game_over';
  phase: KingOfTokyoPhase;
  players: Map<string, KingOfTokyoPlayer>;
  turnOrder: string[];
  currentTurnIndex: number;
  startRolls: Map<string, number | null>;
  startingRollContenders: string[];
  rollOffRound: number;
  rollCount: number;
  maxRolls: number;
  dice: KingOfTokyoDie[];
  currentTurnDicePenalty: number;
  pendingPsychicProbes: PsychicProbeWindow[];
  pendingDiceResolution: PendingDiceResolution | null;
  pendingHeartAllocation: PendingHeartAllocation | null;
  pendingTokyoDecisions: string[];
  pendingTokyoDamage: Map<string, PendingTokyoDamage>;
  pendingDamageWorkflow: PendingDamageWorkflow | null;
  pendingDefenseDecision: PendingDefenseDecision | null;
  pendingEvenBiggerLosses: PendingEvenBiggerLoss[];
  pendingEvenBiggerReconcileJets: boolean;
  pendingEvenBiggerNormalizeTokyo: boolean;
  resolutionTasks: ResolutionTask[];
  completedDamageOutcome: StoredDamageOutcome | null;
  drainingResolutionTasks: boolean;
  pendingSmashResolution: PendingSmashResolution | null;
  pendingSmashAftermath: PendingSmashAftermath | null;
  pendingBurrowingYields: PendingBurrowingYield[];
  pendingDeathFromAbove: PendingDeathFromAbove | null;
  pendingFreezeTimeDecisions: PendingFreezeTimeDecision[];
  pendingOpportunist: OpportunistWindow | null;
  opportunistRevealQueue: OpportunistReveal[];
  market: (KingOfTokyoMarketCard | null)[];
  deck: KingOfTokyoMarketCard[];
  discardPile: KingOfTokyoMarketCard[];
  labOffersRemaining: number;
  purchasesThisTurn: number;
  queuedExtraTurns: { playerId: string; dicePenalty: number; source: string }[];
  resumeAfterExtraTurnsPlayerId: string | null;
  usedThisTurn: Set<string>;
  wingsProtected: Set<string>;
  turnDealtDamage: boolean;
  mustEnterTokyo: boolean;
  pendingEndTurnEffects: KingOfTokyoEndTurnEffect[];
  winnerId: string | null;
  victoryType: KingOfTokyoVictoryType | null;
  terminationReason: 'no_players_remaining' | null;
  log: KingOfTokyoLogEntry[];
  logSeq: number;
}

type DamageKind = 'smash' | 'card' | 'poison' | 'yield';
interface FatalDamageOptions {
  childEntitled?: boolean;
  notifyWatchers?: boolean;
  reconcileJets?: boolean;
  normalizeTokyo?: boolean;
}
interface CardTopologySnapshot {
  activeTurnEffects: ActiveTurnCardEffects | null;
  damageEntitlements: Map<string, SmashDamageEntitlements>;
  deathWatcherEntitlements: DeathWatcherEntitlement[];
  evenBiggerCounts: Map<string, number>;
  health: Map<string, number>;
}
interface CardTopologyFatalBatch {
  childEntitlements?: ReadonlySet<string>;
  damageEntitlements?: ReadonlyMap<string, SmashDamageEntitlements>;
  deferPendingTokyoEvenBiggerLoss: boolean;
  depth: number;
  draining: boolean;
  eaterEntitlements?: ReadonlyMap<string, number>;
  fatalOptions: FatalDamageOptions;
  pendingPlayerIds: Set<string>;
  preservePendingJetsEntitlements: boolean;
  rng: RandomSource;
}

const CARD_TOPOLOGY_FATAL_BATCHES = new WeakMap<KingOfTokyoServerState, CardTopologyFatalBatch>();

export function initKingOfTokyoGame(
  roomCode: string,
  players: { playerId: string; displayName: string }[],
  rng: RandomSource = Math.random,
  startingPlayerId?: string,
): KingOfTokyoServerState {
  if (players.length < KING_OF_TOKYO_MIN_PLAYERS || players.length > KING_OF_TOKYO_MAX_PLAYERS) {
    throw new Error(`King of Tokyo requires ${KING_OF_TOKYO_MIN_PLAYERS}-${KING_OF_TOKYO_MAX_PLAYERS} players`);
  }
  if (new Set(players.map((player) => player.playerId)).size !== players.length) {
    throw new Error('Player IDs must be unique');
  }
  const state: KingOfTokyoServerState = {
    gameId: 'king_of_tokyo', roomCode, revision: 0, startingRevision: 0, rulesVersion: KING_OF_TOKYO_RULES_VERSION,
    status: 'playing', phase: 'determining_first_player',
    players: new Map(players.map((player) => [player.playerId, {
      ...player, health: KING_OF_TOKYO_STARTING_HEALTH, maxHealth: KING_OF_TOKYO_MAX_HEALTH,
      victoryPoints: 0, energy: 0, tokyoZone: null, eliminated: false, forfeited: false,
      poisonTokens: 0, shrinkTokens: 0,
      defenseMode: 'lethal' as KingOfTokyoDefenseMode,
      rapidHealingMode: 'lethal' as KingOfTokyoDefenseMode,
      tokenPreference: 'poison' as KingOfTokyoTokenPreference,
      powerCards: [],
    }])),
    turnOrder: players.map((player) => player.playerId), currentTurnIndex: 0,
    startRolls: new Map(players.map((player) => [player.playerId, null])),
    startingRollContenders: players.map((player) => player.playerId), rollOffRound: 1,
    rollCount: 0, maxRolls: KING_OF_TOKYO_MAX_ROLLS, dice: [], currentTurnDicePenalty: 0,
    pendingPsychicProbes: [], pendingDiceResolution: null, pendingHeartAllocation: null,
    pendingTokyoDecisions: [], pendingTokyoDamage: new Map(),
    pendingDamageWorkflow: null, pendingDefenseDecision: null, pendingEvenBiggerLosses: [],
    pendingEvenBiggerReconcileJets: false, pendingEvenBiggerNormalizeTokyo: false,
    resolutionTasks: [], completedDamageOutcome: null,
    drainingResolutionTasks: false, pendingSmashResolution: null,
    pendingSmashAftermath: null, pendingBurrowingYields: [], pendingDeathFromAbove: null,
    pendingFreezeTimeDecisions: [], pendingOpportunist: null,
    opportunistRevealQueue: [], market: [null, null, null],
    deck: shuffledPowerDeck(rng), discardPile: [], labOffersRemaining: 0,
    purchasesThisTurn: 0, queuedExtraTurns: [], resumeAfterExtraTurnsPlayerId: null,
    usedThisTurn: new Set(), wingsProtected: new Set(), turnDealtDamage: false, mustEnterTokyo: false,
    pendingEndTurnEffects: [],
    winnerId: null, victoryType: null, terminationReason: null, log: [], logSeq: 0,
  };
  for (let index = 0; index < 3; index += 1) fillMarketSlot(state, index, false, rng);
  addLog(state, `Game started with ${players.length} monsters and the full ${KING_OF_TOKYO_DECK_SIZE}-card market deck.`);
  if (startingPlayerId !== undefined) {
    const starterIndex = state.turnOrder.indexOf(startingPlayerId);
    if (starterIndex < 0) throw new Error('Starting player must be in the game');
    state.currentTurnIndex = starterIndex;
    state.startingRollContenders = [];
    addLog(state, `${state.players.get(startingPlayerId)!.displayName} starts this rematch.`);
    beginTurn(state);
  } else {
    addLog(state, 'Every monster must roll for first player; the most Smash starts.');
  }
  validateKingOfTokyoState(state);
  return state;
}

function shuffledPowerDeck(rng: RandomSource): KingOfTokyoMarketCard[] {
  const cards: KingOfTokyoMarketCard[] = [];
  for (const definition of KING_OF_TOKYO_POWER_CARDS) {
    const copies = 'copies' in definition ? definition.copies : 1;
    for (let copy = 1; copy <= copies; copy += 1) {
      cards.push({ instanceId: `${definition.id}:${copy}`, cardId: definition.id });
    }
  }
  shuffle(cards, rng);
  return cards;
}
function shuffle<T>(items: T[], rng: RandomSource): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.max(0, Math.min(index, Math.floor(rng() * (index + 1))));
    [items[index], items[swap]] = [items[swap], items[index]];
  }
}
function currentPlayerId(state: KingOfTokyoServerState): string { return state.turnOrder[state.currentTurnIndex]; }
function currentPlayer(state: KingOfTokyoServerState): KingOfTokyoPlayer { return state.players.get(currentPlayerId(state))!; }
function livingPlayers(state: KingOfTokyoServerState): KingOfTokyoPlayer[] {
  return state.turnOrder.map((id) => state.players.get(id)!).filter((player) => !player.eliminated);
}
function addLog(state: KingOfTokyoServerState, text: string): void {
  state.logSeq += 1; state.log.push({ id: state.logSeq, text });
  if (state.log.length > 140) state.log.shift();
}
function checkRevision(state: KingOfTokyoServerState, expectedRevision: number): EngineResult {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return fail('Invalid game-state revision');
  return expectedRevision === state.revision ? OK : fail('Your game state is stale; refresh and try again');
}
function checkAction(state: KingOfTokyoServerState, playerId: string, expectedRevision: number): EngineResult {
  if (state.status !== 'playing') return fail('The game is over');
  const revision = checkRevision(state, expectedRevision); if (!revision.ok) return revision;
  const player = state.players.get(playerId);
  return !player || player.eliminated ? fail('Player cannot act') : OK;
}
function commit(state: KingOfTokyoServerState): EngineResult {
  state.revision += 1; validateKingOfTokyoState(state); return OK;
}
function rollFace(rng: RandomSource): KingOfTokyoDieFace {
  const value = rng();
  if (!Number.isFinite(value)) throw new Error('Random source returned a non-finite value');
  return KING_OF_TOKYO_DIE_FACES[Math.min(5, Math.max(0, Math.floor(value * 6)))];
}
function findOwnedCard(state: KingOfTokyoServerState, instanceId: string) {
  for (const player of state.players.values()) {
    const card = player.powerCards.find((candidate) => candidate.instanceId === instanceId);
    if (card) return { player, card };
  }
  return null;
}
function effectiveCardId(state: KingOfTokyoServerState, card: KingOfTokyoOwnedPowerCard): KingOfTokyoPowerCardId | null {
  if (card.cardId !== 'mimic') return card.cardId;
  const target = card.mimicTargetInstanceId ? findOwnedCard(state, card.mimicTargetInstanceId)?.card : null;
  return target && target.cardId !== 'mimic' ? target.cardId : null;
}
export function availableOncePerTurnPowerCardInstanceIds(
  state: KingOfTokyoServerState,
  playerId: string,
): string[] {
  const player = state.players.get(playerId);
  if (!player || player.eliminated || state.status !== 'playing' || currentPlayerId(state) !== playerId) return [];
  if (state.phase === 'awaiting_roll') {
    return player.powerCards.flatMap((card) => {
      if (card.cardId !== 'mimic' || player.energy < 1) return [];
      if (state.usedThisTurn.has(`mimic_initial:${card.instanceId}`) || state.usedThisTurn.has(`mimic_retarget:${card.instanceId}`)) return [];
      const hasAlternativeTarget = [...state.players.values()].some((owner) =>
        owner.powerCards.some((target) => target.cardId !== 'mimic' && target.instanceId !== card.mimicTargetInstanceId));
      return hasAlternativeTarget ? [card.instanceId] : [];
    });
  }
  if (state.phase === 'choosing_dice' && state.rollCount > 0) {
    return player.powerCards.flatMap((card) =>
      effectiveCardId(state, card) === 'herd_culler' && !state.usedThisTurn.has(card.instanceId)
        ? [card.instanceId]
        : []);
  }
  return [];
}
function effectCards(state: KingOfTokyoServerState, player: KingOfTokyoPlayer, cardId: KingOfTokyoPowerCardId) {
  return player.powerCards.filter((card) => effectiveCardId(state, card) === cardId);
}
function effectCount(state: KingOfTokyoServerState, player: KingOfTokyoPlayer, cardId: KingOfTokyoPowerCardId): number {
  return effectCards(state, player, cardId).length;
}
function isFreezeTimeDecisionEligible(state: KingOfTokyoServerState, pending: PendingFreezeTimeDecision): boolean {
  const owned = findOwnedCard(state, pending.cardInstanceId);
  return Boolean(owned && owned.player.playerId === pending.playerId && effectiveCardId(state, owned.card) === 'freeze_time');
}
function reconcilePendingFreezeTimeEligibility(state: KingOfTokyoServerState): void {
  if (!state.pendingFreezeTimeDecisions.length) return;
  state.pendingFreezeTimeDecisions = state.pendingFreezeTimeDecisions.filter((pending) => {
    const eligible = isFreezeTimeDecisionEligible(state, pending);
    if (!eligible) {
      const player = state.players.get(pending.playerId);
      if (player) addLog(state, `${player.displayName}'s pending Freeze Time offer expired with its power.`);
    }
    return eligible;
  });
}
function syncMaxHealth(state: KingOfTokyoServerState, player: KingOfTokyoPlayer): void {
  player.maxHealth = KING_OF_TOKYO_MAX_HEALTH + effectCount(state, player, 'even_bigger') * 2;
  player.health = Math.min(player.health, player.maxHealth);
}
function activeTurnCardEffects(state: KingOfTokyoServerState): ActiveTurnCardEffects | null {
  if (state.status !== 'playing' || state.phase === 'determining_first_player') return null;
  const player = currentPlayer(state);
  return {
    playerId: player.playerId,
    extraHead: effectCount(state, player, 'extra_head'),
    giantBrain: effectCount(state, player, 'giant_brain'),
  };
}
function clearBrokenMimics(state: KingOfTokyoServerState, removedInstanceIds: ReadonlySet<string>): void {
  for (const player of state.players.values()) for (const card of player.powerCards) {
    if (card.cardId === 'mimic' && card.mimicTargetInstanceId && removedInstanceIds.has(card.mimicTargetInstanceId)) {
      card.mimicTargetInstanceId = null; card.counters = 0;
      addLog(state, `${player.displayName}'s Mimic lost its copied power.`);
    }
  }
}
function reconcileCardDerivedAuthorizations(
  state: KingOfTokyoServerState,
  previousEffects: ActiveTurnCardEffects | null = null,
): void {
  for (const key of [...state.usedThisTurn]) {
    if (!key.startsWith('mimic_initial:')) continue;
    const instanceId = key.slice('mimic_initial:'.length);
    const owned = findOwnedCard(state, instanceId);
    if (!owned || owned.card.cardId !== 'mimic') {
      state.usedThisTurn.delete(key);
      continue;
    }
    const hasKeep = livingPlayers(state).some((candidate) =>
      candidate.powerCards.some((card) => card.cardId !== 'mimic'));
    if (!hasKeep) {
      state.usedThisTurn.delete(key);
      addLog(state, `${owned.player.displayName}'s Mimic remained inactive because no Keep card was available.`);
    }
  }

  state.pendingPsychicProbes = state.pendingPsychicProbes.filter((pending) => {
    const player = state.players.get(pending.playerId);
    const card = player?.powerCards.find((candidate) => candidate.instanceId === pending.cardInstanceId);
    return Boolean(player && !player.eliminated && card && effectiveCardId(state, card) === 'psychic_probe');
  });
  reconcilePendingFreezeTimeEligibility(state);
  reconcilePendingOpportunistEligibility(state);

  if (state.phase === 'determining_first_player') return;
  const active = currentPlayer(state);
  if (state.phase === 'buying_cards' || state.phase === 'awaiting_opportunist') {
    state.labOffersRemaining = Math.min(state.labOffersRemaining, effectCount(state, active, 'made_in_a_lab'));
  }
  if (!previousEffects || previousEffects.playerId !== active.playerId) return;
  const canStillRoll = state.phase === 'awaiting_roll' || state.phase === 'choosing_dice';
  const awaitingUnresolvedDice = (state.phase === 'awaiting_psychic_probe' || state.phase === 'awaiting_dice_resolution') &&
    state.pendingDiceResolution === null;
  if (canStillRoll) {
    const rerollDelta = effectCount(state, active, 'giant_brain') - previousEffects.giantBrain;
    state.maxRolls = Math.max(state.rollCount, state.maxRolls + rerollDelta);
  }
  if (canStillRoll || awaitingUnresolvedDice) {
    const extraHeadCount = effectCount(state, active, 'extra_head');
    const allowedDice = Math.max(
      0,
      KING_OF_TOKYO_DICE_COUNT + extraHeadCount -
        active.shrinkTokens - state.currentTurnDicePenalty,
    );
    if (previousEffects.extraHead > extraHeadCount && state.dice.length > allowedDice) {
      state.dice.splice(allowedDice);
    } else if (state.phase === 'awaiting_roll' && previousEffects.extraHead < extraHeadCount) {
      while (state.dice.length < allowedDice) state.dice.push({ face: null, kept: false });
    }
  }
}
function captureCardTopology(state: KingOfTokyoServerState): CardTopologySnapshot {
  return {
    activeTurnEffects: activeTurnCardEffects(state),
    damageEntitlements: new Map([...state.players].map(([playerId, player]) => [
      playerId,
      captureSmashDamageEntitlements(state, player),
    ])),
    deathWatcherEntitlements: captureDeathWatcherEntitlements(state),
    evenBiggerCounts: new Map([...state.players].map(([playerId, player]) => [
      playerId,
      effectCount(state, player, 'even_bigger'),
    ])),
    health: new Map([...state.players].map(([playerId, player]) => [playerId, player.health])),
  };
}
function beginCardTopologyFatalResolution(
  state: KingOfTokyoServerState,
  rng: RandomSource,
  options: FatalDamageOptions & {
    childEntitlements?: ReadonlySet<string>;
    damageEntitlements?: ReadonlyMap<string, SmashDamageEntitlements>;
    deferPendingTokyoEvenBiggerLoss?: boolean;
    eaterEntitlements?: ReadonlyMap<string, number>;
    preservePendingJetsEntitlements?: boolean;
  } = {},
): void {
  const batch = CARD_TOPOLOGY_FATAL_BATCHES.get(state);
  if (batch) {
    batch.depth += 1;
    return;
  }
  const {
    childEntitlements,
    damageEntitlements,
    deferPendingTokyoEvenBiggerLoss = false,
    eaterEntitlements,
    preservePendingJetsEntitlements = false,
    ...fatalOptions
  } = options;
  CARD_TOPOLOGY_FATAL_BATCHES.set(state, {
    childEntitlements,
    damageEntitlements,
    deferPendingTokyoEvenBiggerLoss,
    depth: 1,
    draining: false,
    eaterEntitlements,
    fatalOptions,
    pendingPlayerIds: new Set(),
    preservePendingJetsEntitlements,
    rng,
  });
}
function drainCardTopologyFatalResolution(
  state: KingOfTokyoServerState,
  batch: CardTopologyFatalBatch,
): void {
  if (batch.draining) return;
  batch.draining = true;
  try {
    while (batch.pendingPlayerIds.size && state.status === 'playing') {
      const playerId = state.turnOrder.find((candidate) => batch.pendingPlayerIds.has(candidate));
      if (!playerId) break;
      batch.pendingPlayerIds.delete(playerId);
      const player = state.players.get(playerId);
      if (!player || player.eliminated || player.health > 0) continue;
      if (batch.eaterEntitlements) {
        notifyDeathWatchersFromEntitlements(state, playerId, batch.eaterEntitlements);
      }
      finalizeFatalDamage(state, player, batch.rng, {
        ...batch.fatalOptions,
        childEntitled: batch.childEntitlements?.has(playerId) ?? batch.fatalOptions.childEntitled,
        notifyWatchers: batch.eaterEntitlements ? false : batch.fatalOptions.notifyWatchers,
      });
    }
  } finally {
    batch.draining = false;
  }
}
function endCardTopologyFatalResolution(state: KingOfTokyoServerState): void {
  const batch = CARD_TOPOLOGY_FATAL_BATCHES.get(state);
  if (!batch) return;
  batch.depth -= 1;
  if (batch.depth > 0 || batch.draining) return;
  drainCardTopologyFatalResolution(state, batch);
  if (!batch.depth && !batch.pendingPlayerIds.size) CARD_TOPOLOGY_FATAL_BATCHES.delete(state);
}
function hasUnsettledEvenBiggerLoss(state: KingOfTokyoServerState, playerId: string): boolean {
  return state.pendingEvenBiggerLosses.some((pending) => pending.playerId === playerId) ||
    state.resolutionTasks.some((task) =>
      task.kind === 'complete_even_bigger_loss' && task.pending.playerId === playerId) ||
    (state.pendingTokyoDamage.get(playerId)?.deferredEvenBiggerLoss ?? 0) > 0;
}
function ensureEvenBiggerLossDrain(state: KingOfTokyoServerState): void {
  if (!state.resolutionTasks.some((task) => task.kind === 'drain_even_bigger_losses')) {
    state.resolutionTasks.unshift({ kind: 'drain_even_bigger_losses' });
  }
}
function queueEvenBiggerLoss(
  state: KingOfTokyoServerState,
  pending: PendingEvenBiggerLoss,
  reconcileJets = true,
  normalizeTokyo = true,
): void {
  if (pending.copiesRemaining <= 0) return;
  state.pendingEvenBiggerLosses.push({
    ...pending,
    entitlements: { ...pending.entitlements },
    deathWatcherEntitlements: pending.deathWatcherEntitlements.map((entry) => ({ ...entry })),
  });
  state.pendingEvenBiggerReconcileJets ||= reconcileJets;
  state.pendingEvenBiggerNormalizeTokyo ||= normalizeTokyo;
  ensureEvenBiggerLossDrain(state);
}
function queueAfterEvenBiggerLosses(state: KingOfTokyoServerState, task: ResolutionTask): void {
  const drainIndex = state.resolutionTasks.findIndex((candidate) => candidate.kind === 'drain_even_bigger_losses');
  if (drainIndex < 0) state.resolutionTasks.unshift(task);
  else state.resolutionTasks.splice(drainIndex + 1, 0, task);
}
function discardPendingEvenBiggerLossesForBody(state: KingOfTokyoServerState, playerId: string): void {
  state.pendingEvenBiggerLosses = state.pendingEvenBiggerLosses.filter((pending) => pending.playerId !== playerId);
}
function grantPendingJetsSnapshotLosses(state: KingOfTokyoServerState): void {
  for (const [playerId, pendingDamage] of state.pendingTokyoDamage) {
    if (pendingDamage.jetsSnapshotGranted) continue;
    const player = state.players.get(playerId);
    if (!player) continue;
    const liveJetsIds = new Set(effectCards(state, player, 'jets').map((card) => card.instanceId));
    if (pendingDamage.jetsCardInstanceIds.some((instanceId) => !liveJetsIds.has(instanceId))) {
      pendingDamage.jetsSnapshotGranted = true;
    }
  }
}
function reconcileCardTopology(
  state: KingOfTokyoServerState,
  snapshot: CardTopologySnapshot,
): void {
  const fatalBatch = CARD_TOPOLOGY_FATAL_BATCHES.get(state);
  for (const playerId of state.turnOrder) {
    const player = state.players.get(playerId)!;
    const previousCount = snapshot.evenBiggerCounts.get(playerId) ?? 0;
    const nextCount = effectCount(state, player, 'even_bigger');
    const delta = nextCount - previousCount;
    const nextMaxHealth = KING_OF_TOKYO_MAX_HEALTH + nextCount * 2;
    if (delta > 0) {
      player.maxHealth = nextMaxHealth;
      healPlayer(state, player, delta * 2, 'Even Bigger');
    } else {
      if (!hasUnsettledEvenBiggerLoss(state, playerId)) {
        player.maxHealth = nextMaxHealth;
        player.health = Math.min(player.health, player.maxHealth);
      }
    }
  }
  if (fatalBatch?.preservePendingJetsEntitlements) grantPendingJetsSnapshotLosses(state);
  reconcileCardDerivedAuthorizations(state, snapshot.activeTurnEffects);
}
function mutatePowerCardTopology<T>(
  state: KingOfTokyoServerState,
  rng: RandomSource,
  mutate: () => T,
): T {
  beginCardTopologyFatalResolution(state, rng);
  const snapshot = captureCardTopology(state);
  try {
    const result = mutate();
    reconcileCardTopology(state, snapshot);
    return result;
  } finally {
    endCardTopologyFatalResolution(state);
  }
}
function discardOwnedCards(
  state: KingOfTokyoServerState,
  player: KingOfTokyoPlayer,
  instanceIds: readonly string[],
  rng: RandomSource = Math.random,
) {
  const requestedIds = new Set(instanceIds);
  const cards = player.powerCards.filter((card) => requestedIds.has(card.instanceId));
  if (!cards.length) return [];
  const removedIds = new Set(cards.map((card) => card.instanceId));
  mutatePowerCardTopology(state, rng, () => {
    player.powerCards = player.powerCards.filter((card) => !removedIds.has(card.instanceId));
    for (const card of cards) {
      state.usedThisTurn.delete(`mimic_initial:${card.instanceId}`);
      state.usedThisTurn.delete(`mimic_retarget:${card.instanceId}`);
      state.discardPile.push({ instanceId: card.instanceId, cardId: card.cardId });
    }
    clearBrokenMimics(state, removedIds);
  });
  return cards;
}
function discardOwnedCard(
  state: KingOfTokyoServerState,
  player: KingOfTokyoPlayer,
  instanceId: string,
  rng: RandomSource = Math.random,
) {
  return discardOwnedCards(state, player, [instanceId], rng)[0] ?? null;
}
function discardAllOwnedCards(
  state: KingOfTokyoServerState,
  player: KingOfTokyoPlayer,
  rng: RandomSource,
): void {
  discardOwnedCards(state, player, player.powerCards.map((card) => card.instanceId), rng);
}
function gainEnergy(state: KingOfTokyoServerState, player: KingOfTokyoPlayer, amount: number, friendBonus = true): number {
  if (amount <= 0) return 0;
  const gained = amount + (friendBonus ? effectCount(state, player, 'friend_of_children') : 0);
  player.energy += gained; addLog(state, `${player.displayName} gained ${gained} energy.`); return gained;
}
function healPlayer(
  state: KingOfTokyoServerState,
  player: KingOfTokyoPlayer,
  amount: number,
  reason?: string,
): number {
  if (amount <= 0 || player.eliminated) return 0;
  const baseHealing = Math.min(amount, player.maxHealth - player.health);
  const regeneration = baseHealing > 0 ? effectCount(state, player, 'regeneration') : 0;
  const requested = amount + regeneration;
  const healed = Math.min(requested, player.maxHealth - player.health); player.health += healed;
  if (healed > 0) addLog(state, `${player.displayName} gained ${healed} health${reason ? ` (${reason})` : ''}.`);
  return healed;
}
function finishGame(state: KingOfTokyoServerState, winner: KingOfTokyoPlayer, victoryType: KingOfTokyoVictoryType): void {
  state.status = 'game_over'; state.phase = 'game_over'; state.winnerId = winner.playerId; state.victoryType = victoryType;
  state.pendingTokyoDecisions = []; state.pendingTokyoDamage.clear(); state.pendingPsychicProbes = [];
  state.pendingDiceResolution = null; state.pendingHeartAllocation = null;
  state.pendingDamageWorkflow = null; state.pendingDefenseDecision = null;
  state.pendingEvenBiggerLosses = [];
  state.pendingEvenBiggerReconcileJets = false; state.pendingEvenBiggerNormalizeTokyo = false;
  state.resolutionTasks = []; state.completedDamageOutcome = null; state.drainingResolutionTasks = false;
  state.pendingSmashResolution = null; state.pendingSmashAftermath = null; clearPendingBurrowingYields(state);
  state.pendingDeathFromAbove = null; state.pendingFreezeTimeDecisions = [];
  state.pendingOpportunist = null; state.pendingEndTurnEffects = [];
  state.opportunistRevealQueue = []; state.queuedExtraTurns = [];
  state.labOffersRemaining = 0; state.usedThisTurn.clear();
  addLog(state, `${winner.displayName} wins by ${victoryType === 'victory_points' ? 'reaching 20 victory points' : 'being the last monster standing'}.`);
}
function hasPendingInitialMimic(state: KingOfTokyoServerState): boolean {
  return [...state.usedThisTurn].some((key) => key.startsWith('mimic_initial:'));
}
function finishMutualDestruction(state: KingOfTokyoServerState, abandoned = false): void {
  state.status = 'game_over'; state.phase = 'game_over'; state.winnerId = null;
  state.victoryType = abandoned ? null : 'mutual_destruction';
  state.terminationReason = abandoned ? 'no_players_remaining' : null;
  state.pendingTokyoDecisions = []; state.pendingTokyoDamage.clear(); state.pendingPsychicProbes = [];
  state.pendingDiceResolution = null; state.pendingHeartAllocation = null;
  state.pendingDamageWorkflow = null; state.pendingDefenseDecision = null;
  state.pendingEvenBiggerLosses = [];
  state.pendingEvenBiggerReconcileJets = false; state.pendingEvenBiggerNormalizeTokyo = false;
  state.resolutionTasks = []; state.completedDamageOutcome = null; state.drainingResolutionTasks = false;
  state.pendingSmashResolution = null; state.pendingSmashAftermath = null; clearPendingBurrowingYields(state);
  state.pendingDeathFromAbove = null; state.pendingFreezeTimeDecisions = [];
  state.pendingOpportunist = null; state.pendingEndTurnEffects = [];
  state.opportunistRevealQueue = []; state.queuedExtraTurns = [];
  state.labOffersRemaining = 0; state.usedThisTurn.clear();
  addLog(state, abandoned
    ? 'The game ended without a winner because no active players remain.'
    : 'Every monster was eliminated at the same time. Nobody wins.');
}
function checkVictoryPoints(state: KingOfTokyoServerState, player: KingOfTokyoPlayer): boolean {
  return state.status === 'playing' && !player.eliminated && player.victoryPoints >= KING_OF_TOKYO_VICTORY_POINTS;
}
function hasCommittedResolution(state: KingOfTokyoServerState): boolean {
  return Boolean(
    state.pendingDamageWorkflow || state.pendingDefenseDecision || state.pendingEvenBiggerLosses.length ||
    state.resolutionTasks.length ||
    state.pendingSmashResolution || state.pendingSmashAftermath || state.pendingTokyoDamage.size ||
    state.pendingTokyoDecisions.length || state.pendingOpportunist || state.opportunistRevealQueue.length ||
    hasPendingInitialMimic(state)
  );
}
function checkLastMonsterStanding(state: KingOfTokyoServerState): boolean {
  if (state.status !== 'playing') return true;
  if (hasCommittedResolution(state)) return false;
  const living = livingPlayers(state);
  if (!living.length) { finishMutualDestruction(state); return true; }
  if (living.length !== 1) return false;
  finishGame(state, living[0], 'last_monster_standing'); return true;
}
function notifyDeathWatchersFromEntitlements(
  state: KingOfTokyoServerState,
  deadPlayerId: string,
  entitlements: ReadonlyMap<string, number>,
): void {
  for (const [watcherId, count] of entitlements) {
    if (watcherId === deadPlayerId) continue;
    const watcher = state.players.get(watcherId);
    if (!watcher || watcher.forfeited) continue;
    if (count) {
      watcher.victoryPoints += count * 3;
      addLog(state, `${watcher.displayName} gained ${count * 3} victory points from Eater of the Dead.`);
    }
  }
}
function notifyDeathWatchers(state: KingOfTokyoServerState, deadPlayerId: string): void {
  notifyDeathWatchersFromEntitlements(state, deadPlayerId, new Map(
    livingPlayers(state).map((watcher) => [watcher.playerId, effectCount(state, watcher, 'eater_of_the_dead')]),
  ));
}
function captureDeathWatcherEntitlements(state: KingOfTokyoServerState): DeathWatcherEntitlement[] {
  return livingPlayers(state).flatMap((player) => {
    const copies = effectCount(state, player, 'eater_of_the_dead');
    return copies ? [{ playerId: player.playerId, copies }] : [];
  });
}
function captureSmashDamageEntitlements(
  state: KingOfTokyoServerState,
  player: KingOfTokyoPlayer,
): SmashDamageEntitlements {
  return {
    camouflage: effectCount(state, player, 'camouflage'),
    armorPlating: effectCount(state, player, 'armor_plating'),
    wings: effectCount(state, player, 'wings'),
    rapidHealing: effectCount(state, player, 'rapid_healing'),
    stretchy: effectCount(state, player, 'stretchy'),
    makingItStronger: effectCount(state, player, 'making_it_stronger'),
    childEntitled: effectCount(state, player, 'it_has_a_child') > 0,
  };
}
function shouldDefend(player: KingOfTokyoPlayer, amount: number): boolean {
  return player.defenseMode === 'always' || (player.defenseMode === 'lethal' && amount >= player.health);
}
function finalizeFatalDamage(
  state: KingOfTokyoServerState,
  target: KingOfTokyoPlayer,
  rng: RandomSource,
  options: FatalDamageOptions = {},
): void {
  if (target.health > 0 || target.eliminated || state.status !== 'playing') return;
  discardPendingEvenBiggerLossesForBody(state, target.playerId);
  if (options.notifyWatchers !== false) notifyDeathWatchers(state, target.playerId);
  const childEntitled = options.childEntitled ?? effectCount(state, target, 'it_has_a_child') > 0;
  if (childEntitled) {
    addLog(state, `${target.displayName}'s offspring continues the fight.`);
    discardAllOwnedCards(state, target, rng);
    if (state.phase === 'resolving_end_turn' && currentPlayerId(state) === target.playerId) {
      state.pendingEndTurnEffects = [];
    }
    Object.assign(target, {
      victoryPoints: 0, health: KING_OF_TOKYO_STARTING_HEALTH, maxHealth: KING_OF_TOKYO_MAX_HEALTH,
      tokyoZone: null, eliminated: false,
    });
    reconcileCardDerivedAuthorizations(state);
    if (options.reconcileJets !== false) reconcilePendingJets(state, rng);
    return;
  }
  target.eliminated = true; target.tokyoZone = null; target.energy = 0;
  discardAllOwnedCards(state, target, rng);
  addLog(state, `${target.displayName} was eliminated.`);
  reconcileCardDerivedAuthorizations(state);
  if (options.reconcileJets !== false) reconcilePendingJets(state, rng);
  if (options.normalizeTokyo !== false) normalizeAndReconcileTokyoBay(state, rng);
}

export function rapidHealingOptions(state: KingOfTokyoServerState, playerId: string) {
  const player = state.players.get(playerId)!;
  const healingPerActivation = 1 + effectCount(state, player, 'regeneration');
  const maxActivations = Math.min(Math.ceil((player.maxHealth - player.health) / healingPerActivation), Math.floor(player.energy / 2));
  return { healingPerActivation, maxActivations };
}
function rapidHealingLimit(state: KingOfTokyoServerState, player: KingOfTokyoPlayer): number {
  return rapidHealingOptions(state, player.playerId).maxActivations;
}

function resolveCamouflageRoll(state: KingOfTokyoServerState, target: PendingDamageTarget): void {
  const player = state.players.get(target.playerId)!;
  const prevented = target.camouflageFaces.filter((face) => face === 'heart').length;
  target.amount = Math.max(0, target.amount - prevented);
  if (prevented) addLog(state, `${player.displayName}'s Camouflage prevented ${prevented} health loss.`);
  target.camouflageFaces = [];
  target.camouflageCopyIndex += 1;
  if (!target.amount) target.stage = 'done';
}

function queueDefenseDecision(
  state: KingOfTokyoServerState,
  target: PendingDamageTarget,
  kind: PendingDefenseDecision['kind'],
): void {
  const player = state.players.get(target.playerId)!;
  state.pendingDefenseDecision = {
    kind,
    playerId: target.playerId,
    incomingDamage: target.rawAmount,
    remainingDamage: target.amount,
    camouflageCopy: kind === 'camouflage' ? target.camouflageCopyIndex + 1 : null,
    camouflageCopies: kind === 'camouflage' ? target.entitlements.camouflage : null,
    dice: kind === 'camouflage' ? [...target.camouflageFaces] : [],
    maxActivations: kind === 'rapid_healing' ? rapidHealingLimit(state, player) : 0,
  };
  state.phase = 'awaiting_defense_decision';
  const label = kind === 'camouflage' ? 'Camouflage dice with Stretchy'
    : kind === 'wings' ? 'Wings' : 'Rapid Healing';
  addLog(state, `${player.displayName} must decide ${label} before the damage resolves.`);
}

function beginDamageWorkflow(
  state: KingOfTokyoServerState,
  targets: readonly KingOfTokyoPlayer[],
  amount: number,
  sourcePlayerId: string | null,
  kind: DamageKind,
  rng: RandomSource,
  afterTasks: readonly ResolutionTask[] = [],
  entitlementsByPlayer?: ReadonlyMap<string, SmashDamageEntitlements>,
  deathWatcherEntitlements: readonly DeathWatcherEntitlement[] = captureDeathWatcherEntitlements(state),
  deferPendingTokyoEvenBiggerLoss = false,
  preservePendingJetsEntitlements = false,
): void {
  if (state.pendingDamageWorkflow || state.pendingDefenseDecision) {
    throw new Error('A damage workflow is already pending');
  }
  if (afterTasks.length) state.resolutionTasks.unshift(...afterTasks);
  const seen = new Set<string>();
  const packetTargets = targets.flatMap((player) => {
    if (amount <= 0 || player.eliminated || seen.has(player.playerId)) return [];
    seen.add(player.playerId);
    return [{
      playerId: player.playerId,
      rawAmount: amount,
      amount,
      lost: 0,
      stage: 'camouflage' as PendingDamageTargetStage,
      camouflageCopyIndex: 0,
      camouflageFaces: [],
      entitlements: entitlementsByPlayer?.get(player.playerId) ?? captureSmashDamageEntitlements(state, player),
    }];
  });
  if (!packetTargets.length) {
    state.completedDamageOutcome = { losses: [], consumedBodyPlayerIds: [] };
    runResolutionTasks(state, rng);
    return;
  }
  state.pendingDamageWorkflow = {
    previousPhase: state.phase,
    sourcePlayerId,
    kind,
    targets: packetTargets,
    targetIndex: 0,
    fatalityPlayerIds: [],
    deathWatcherEntitlements: deathWatcherEntitlements.map((entry) => ({ ...entry })),
    deferPendingTokyoEvenBiggerLoss,
    preservePendingJetsEntitlements,
  };
  advanceDamageWorkflow(state, rng);
}

function advanceDamageWorkflow(state: KingOfTokyoServerState, rng: RandomSource): void {
  const workflow = state.pendingDamageWorkflow;
  if (!workflow || state.pendingDefenseDecision) return;
  while (workflow.targetIndex < workflow.targets.length) {
    const target = workflow.targets[workflow.targetIndex];
    const player = state.players.get(target.playerId);
    if (!player || player.eliminated) {
      target.stage = 'done';
    }
    if (target.stage === 'camouflage' && player) {
      if (state.wingsProtected.has(player.playerId)) {
        addLog(state, `${player.displayName}'s Wings prevented ${target.amount} health loss.`);
        target.stage = 'done';
      } else if (target.camouflageCopyIndex >= target.entitlements.camouflage) {
        target.stage = 'armor';
      } else if (!target.camouflageFaces.length) {
        target.camouflageFaces = Array.from({ length: target.amount }, () => rollFace(rng));
        if (target.entitlements.stretchy > 0 && player.energy >= 2 &&
            target.camouflageFaces.some((face) => face !== 'heart')) {
          queueDefenseDecision(state, target, 'camouflage');
          return;
        }
        resolveCamouflageRoll(state, target);
      }
    }
    if (target.stage === 'camouflage') continue;
    if (target.stage === 'armor' && player) {
      if (target.amount === 1 && target.entitlements.armorPlating > 0) {
        addLog(state, `${player.displayName}'s Armor Plating ignored 1 health loss.`);
        target.stage = 'done';
      } else target.stage = 'wings';
    }
    if (target.stage === 'wings' && player) {
      if (target.entitlements.wings > 0 && player.energy >= 2) {
        queueDefenseDecision(state, target, 'wings');
        return;
      }
      target.stage = 'rapid_healing';
    }
    if (target.stage === 'rapid_healing' && player) {
      if (target.entitlements.rapidHealing > 0 && rapidHealingLimit(state, player) > 0) {
        queueDefenseDecision(state, target, 'rapid_healing');
        return;
      }
      target.stage = 'apply';
    }
    if (target.stage === 'apply' && player) {
      target.lost = Math.min(target.amount, player.health);
      player.health -= target.lost;
      addLog(state, `${player.displayName} lost ${target.lost} health and has ${player.health} remaining.`);
      if (target.lost >= 2) {
        for (let copy = 0; copy < target.entitlements.makingItStronger; copy += 1) gainEnergy(state, player, 1);
      }
      const activeId = state.phase === 'determining_first_player' ? null : currentPlayerId(state);
      if (workflow.sourcePlayerId && workflow.kind !== 'poison' && target.lost > 0 &&
          workflow.sourcePlayerId === activeId) state.turnDealtDamage = true;
      target.stage = 'done';
    }
    if (target.stage === 'done') workflow.targetIndex += 1;
  }

  workflow.fatalityPlayerIds = workflow.targets.flatMap((target) => {
    const player = state.players.get(target.playerId);
    return player && !player.eliminated && player.health === 0 ? [player.playerId] : [];
  });
  const watcherMap = new Map(workflow.deathWatcherEntitlements.map(({ playerId, copies }) => [playerId, copies]));
  for (const fatalityId of workflow.fatalityPlayerIds) {
    notifyDeathWatchersFromEntitlements(state, fatalityId, watcherMap);
  }
  const entitlementMap = new Map(workflow.targets.map((target) => [target.playerId, target.entitlements]));
  const childEntitlements = new Set(workflow.targets.flatMap((target) =>
    target.entitlements.childEntitled ? [target.playerId] : []));
  beginCardTopologyFatalResolution(state, rng, {
    childEntitlements,
    damageEntitlements: entitlementMap,
    eaterEntitlements: watcherMap,
    deferPendingTokyoEvenBiggerLoss: workflow.deferPendingTokyoEvenBiggerLoss,
    preservePendingJetsEntitlements: workflow.preservePendingJetsEntitlements,
    reconcileJets: false,
    normalizeTokyo: false,
  });
  try {
    for (const fatalityId of workflow.fatalityPlayerIds) {
      const fatality = state.players.get(fatalityId);
      if (!fatality) continue;
      finalizeFatalDamage(state, fatality, rng, {
        childEntitled: childEntitlements.has(fatalityId),
        notifyWatchers: false,
        reconcileJets: false,
        normalizeTokyo: false,
      });
    }
  } finally {
    endCardTopologyFatalResolution(state);
  }
  const losses = new Map(workflow.targets.map((target) => [target.playerId, target.lost]));
  const previousPhase = workflow.previousPhase;
  state.pendingDamageWorkflow = null;
  state.pendingDefenseDecision = null;
  if (state.status === 'playing') state.phase = previousPhase;
  reconcileCardDerivedAuthorizations(state);
  state.completedDamageOutcome = {
    losses: [...losses].map(([playerId, amount]) => ({ playerId, amount })),
    consumedBodyPlayerIds: [...workflow.fatalityPlayerIds],
  };
  runResolutionTasks(state, rng);
}

function applyDefenseDecision(
  state: KingOfTokyoServerState,
  playerId: string,
  decision: KingOfTokyoDefenseDecision,
  rng: RandomSource,
): EngineResult {
  const pending = state.pendingDefenseDecision;
  const workflow = state.pendingDamageWorkflow;
  const target = workflow?.targets[workflow.targetIndex];
  const player = state.players.get(playerId);
  if (state.phase !== 'awaiting_defense_decision' || !pending || !workflow || !target ||
      pending.playerId !== playerId || target.playerId !== playerId || !player || player.eliminated) {
    return fail('No defence decision is waiting for you');
  }
  if (!decision || typeof decision !== 'object' || Array.isArray(decision) || decision.kind !== pending.kind) {
    return fail('That defence decision is not currently available');
  }
  if (decision.kind === 'camouflage') {
    if (Object.keys(decision).sort().join('|') !== 'changes|kind' || !Array.isArray(decision.changes)) {
      return fail('Camouflage requires a list of die changes');
    }
    const indexes = new Set<number>();
    for (const change of decision.changes) {
      if (!change || typeof change !== 'object' || Array.isArray(change) ||
          Object.keys(change).sort().join('|') !== 'dieIndex|face' || !Number.isSafeInteger(change.dieIndex) ||
          change.dieIndex < 0 || change.dieIndex >= target.camouflageFaces.length || indexes.has(change.dieIndex) ||
          !KING_OF_TOKYO_DIE_FACES.includes(change.face) || target.camouflageFaces[change.dieIndex] === change.face) {
        return fail('Invalid Camouflage die change');
      }
      indexes.add(change.dieIndex);
    }
    const cost = decision.changes.length * 2;
    if (cost > player.energy) return fail(`Need ${cost} energy for those Stretchy changes`);
    if (decision.changes.length && target.entitlements.stretchy <= 0) return fail('Stretchy is not available for this damage packet');
    player.energy -= cost;
    for (const change of decision.changes) target.camouflageFaces[change.dieIndex] = change.face;
    if (cost) addLog(state, `${player.displayName} spent ${cost} energy changing ${decision.changes.length} Camouflage ${decision.changes.length === 1 ? 'die' : 'dice'} with Stretchy.`);
    else addLog(state, `${player.displayName} kept the Camouflage dice unchanged.`);
    resolveCamouflageRoll(state, target);
  } else if (decision.kind === 'wings') {
    if (Object.keys(decision).sort().join('|') !== 'kind|use' || typeof decision.use !== 'boolean') {
      return fail('Wings requires an accept or decline decision');
    }
    if (decision.use) {
      if (target.entitlements.wings <= 0 || player.energy < 2) return fail('Wings is no longer affordable for this packet');
      player.energy -= 2;
      state.wingsProtected.add(player.playerId);
      addLog(state, `${player.displayName} spent 2 energy on Wings and is protected for this turn.`);
      target.stage = 'done';
    } else {
      addLog(state, `${player.displayName} declined Wings for this damage packet.`);
      target.stage = 'rapid_healing';
    }
  } else {
    if (Object.keys(decision).sort().join('|') !== 'activations|kind' || !Number.isSafeInteger(decision.activations) ||
        decision.activations < 0 || decision.activations > rapidHealingLimit(state, player)) {
      return fail('Invalid Rapid Healing amount');
    }
    const cost = decision.activations * 2;
    player.energy -= cost;
    if (decision.activations) {
      for (let activation = 0; activation < decision.activations; activation += 1) {
        healPlayer(state, player, 1, 'Rapid Healing');
      }
      addLog(state, `${player.displayName} spent ${cost} energy on Rapid Healing before damage.`);
    } else addLog(state, `${player.displayName} declined Rapid Healing for this damage packet.`);
    target.stage = 'apply';
  }
  state.pendingDefenseDecision = null;
  state.phase = workflow.previousPhase;
  advanceDamageWorkflow(state, rng);
  return OK;
}

export function decideDefense(
  state: KingOfTokyoServerState,
  playerId: string,
  decision: KingOfTokyoDefenseDecision,
  expectedRevision: number,
  rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  const result = applyDefenseDecision(state, playerId, decision, rng); if (!result.ok) return result;
  return commit(state);
}

function damagePlayersAtomically(
  state: KingOfTokyoServerState,
  targets: readonly KingOfTokyoPlayer[],
  amount: number,
  sourcePlayerId: string,
  rng: RandomSource,
): void {
  beginDamageWorkflow(state, targets, amount, sourcePlayerId, 'card', rng, [
    { kind: 'reconcile_jets' },
    { kind: 'normalize_tokyo' },
  ]);
}
function normalizeTokyoBay(state: KingOfTokyoServerState): TokyoBayNormalization | null {
  if (kingOfTokyoCapacity(livingPlayers(state).length) === 2) return null;
  const bay = livingPlayers(state).find((player) => player.tokyoZone === 'tokyo_bay'); if (!bay) return null;
  const cityOccupied = livingPlayers(state).some((player) => player.tokyoZone === 'tokyo_city');
  bay.tokyoZone = cityOccupied ? null : 'tokyo_city';
  addLog(state, cityOccupied
    ? `${bay.displayName} left Tokyo because only four monsters remain and Tokyo City is occupied.`
    : `${bay.displayName} moved from Tokyo Bay to Tokyo City because only four monsters remain.`);
  return { player: bay, movedToCity: !cityOccupied };
}
function reconcileTokyoBayNormalization(
  state: KingOfTokyoServerState,
  normalization: TokyoBayNormalization | null,
  rng: RandomSource,
): void {
  if (!normalization || normalization.movedToCity) return;
  const { player } = normalization;
  const pendingDamage = state.pendingTokyoDamage.get(player.playerId);
  if (pendingDamage && !player.eliminated && state.status === 'playing') {
    const actor = currentPlayer(state);
    addLog(state, `${player.displayName}'s forced Tokyo Bay exit was not a Yield; the deferred Smash resolves.`);
    state.pendingTokyoDamage.delete(player.playerId);
    state.pendingTokyoDecisions = state.pendingTokyoDecisions.filter((id) => id !== player.playerId);
    beginPendingTokyoSmash(state, player, pendingDamage, actor, 'normalization', rng);
    return;
  }
  state.pendingTokyoDamage.delete(player.playerId);
  state.pendingTokyoDecisions = state.pendingTokyoDecisions.filter((id) => id !== player.playerId);
}
function normalizeAndReconcileTokyoBay(state: KingOfTokyoServerState, rng: RandomSource): void {
  reconcileTokyoBayNormalization(state, normalizeTokyoBay(state), rng);
}
function openTokyoZone(state: KingOfTokyoServerState): KingOfTokyoZone | null {
  const living = livingPlayers(state);
  if (!living.some((player) => player.tokyoZone === 'tokyo_city')) return 'tokyo_city';
  if (kingOfTokyoCapacity(living.length) === 2 && !living.some((player) => player.tokyoZone === 'tokyo_bay')) return 'tokyo_bay';
  return null;
}
function clearPendingBurrowingYields(state: KingOfTokyoServerState, entrantPlayerId?: string): void {
  state.pendingBurrowingYields = entrantPlayerId === undefined
    ? []
    : state.pendingBurrowingYields.filter((pending) => pending.entrantPlayerId !== entrantPlayerId);
}
function queueTokyoYieldForEntrant(
  state: KingOfTokyoServerState,
  occupant: KingOfTokyoPlayer,
  entrant: KingOfTokyoPlayer,
): KingOfTokyoZone | null {
  const zone = occupant.tokyoZone;
  if (!zone) return null;
  occupant.tokyoZone = null;
  state.pendingBurrowingYields = state.pendingBurrowingYields.filter((pending) =>
    pending.entrantPlayerId !== entrant.playerId || pending.zone !== zone);
  const copies = entrant.eliminated || entrant.tokyoZone ? 0 : effectCount(state, occupant, 'burrowing');
  if (copies) {
    state.pendingBurrowingYields.push({
      entrantPlayerId: entrant.playerId,
      sourcePlayerId: occupant.playerId,
      zone,
      copies,
    });
  }
  return zone;
}
function enterOpenTokyoZone(
  state: KingOfTokyoServerState,
  player: KingOfTokyoPlayer,
  rng: RandomSource = Math.random,
): void {
  if (player.eliminated || player.tokyoZone) {
    clearPendingBurrowingYields(state, player.playerId);
    return;
  }
  const zone = openTokyoZone(state);
  if (!zone) {
    clearPendingBurrowingYields(state, player.playerId);
    return;
  }
  enterTokyoZone(state, player, zone, rng);
}
function enterTokyoZone(
  state: KingOfTokyoServerState,
  player: KingOfTokyoPlayer,
  zone: KingOfTokyoZone,
  rng: RandomSource,
): void {
  if (player.eliminated || player.tokyoZone || livingPlayers(state).some((occupant) => occupant.tokyoZone === zone)) {
    clearPendingBurrowingYields(state, player.playerId);
    return;
  }
  player.tokyoZone = zone; player.victoryPoints += 1;
  addLog(state, `${player.displayName} entered ${zone === 'tokyo_city' ? 'Tokyo City' : 'Tokyo Bay'} and gained 1 victory point.`);
  const retaliation = state.pendingBurrowingYields.filter((pending) =>
    pending.entrantPlayerId === player.playerId && pending.zone === zone);
  clearPendingBurrowingYields(state, player.playerId);
  if (retaliation.length) {
    state.resolutionTasks.unshift(...retaliation.map((pending) => ({
      kind: 'continue_burrowing' as const,
      playerId: player.playerId,
      sourcePlayerId: pending.sourcePlayerId,
      copiesRemaining: pending.copies,
    })));
    runResolutionTasks(state, rng);
  }
}

function continueBurrowingDamage(
  state: KingOfTokyoServerState,
  playerId: string,
  sourcePlayerId: string,
  copiesRemaining: number,
  rng: RandomSource,
): void {
  const player = state.players.get(playerId);
  if (!player || player.eliminated || copiesRemaining <= 0) return;
  beginDamageWorkflow(state, [player], 1, sourcePlayerId, 'yield', rng, [
    { kind: 'reconcile_jets' },
    { kind: 'normalize_tokyo' },
    { kind: 'continue_burrowing', playerId, sourcePlayerId, copiesRemaining: copiesRemaining - 1 },
  ]);
}
function refillDeckIfNeeded(state: KingOfTokyoServerState, rng: RandomSource): void {
  if (state.deck.length || !state.discardPile.length) return;
  state.deck = [...state.discardPile]; state.discardPile = []; shuffle(state.deck, rng);
  addLog(state, 'The Power card discard pile was reshuffled.');
}
function drawCard(state: KingOfTokyoServerState, rng: RandomSource) {
  refillDeckIfNeeded(state, rng); return state.deck.shift() ?? null;
}
function fillMarketSlot(state: KingOfTokyoServerState, index: number, offer: boolean, rng: RandomSource): void {
  const card = drawCard(state, rng); state.market[index] = card;
  if (state.labOffersRemaining > 0) refillDeckIfNeeded(state, rng);
  if (card && offer) state.opportunistRevealQueue.push({
    cardInstanceId: card.instanceId,
    playerIds: eligibleOpportunists(state, card),
  });
}
function effectiveCost(state: KingOfTokyoServerState, player: KingOfTokyoPlayer, cardId: KingOfTokyoPowerCardId): number {
  return Math.max(0, KING_OF_TOKYO_POWER_CARD_BY_ID[cardId].cost - effectCount(state, player, 'alien_origin'));
}
function eligibleOpportunists(state: KingOfTokyoServerState, card: KingOfTokyoMarketCard): string[] {
  const ordered = Array.from(
    { length: state.turnOrder.length - 1 },
    (_, index) => state.turnOrder[(state.currentTurnIndex + index + 1) % state.turnOrder.length],
  );
  return ordered.filter((id) => {
    const player = state.players.get(id)!;
    return !player.eliminated && effectCount(state, player, 'opportunist') > 0 &&
      player.energy >= effectiveCost(state, player, card.cardId);
  });
}
function reconcilePendingOpportunistEligibility(state: KingOfTokyoServerState): void {
  if (!state.pendingOpportunist) return;
  const card = state.market.find((candidate) => candidate?.instanceId === state.pendingOpportunist!.cardInstanceId);
  state.pendingOpportunist.playerIds = card ? state.pendingOpportunist.playerIds.filter((playerId) => {
    const player = state.players.get(playerId);
    return Boolean(player && !player.eliminated &&
      player.energy >= effectiveCost(state, player, card.cardId));
  }) : [];
}
function advanceOpportunistWindow(state: KingOfTokyoServerState): void {
  if (state.pendingDamageWorkflow || state.pendingDefenseDecision || state.resolutionTasks.length || state.pendingDeathFromAbove) return;
  if (hasPendingInitialMimic(state)) return;
  state.pendingOpportunist = null;
  while (state.opportunistRevealQueue.length) {
    const reveal = state.opportunistRevealQueue.shift()!;
    const card = state.market.find((candidate) => candidate?.instanceId === reveal.cardInstanceId);
    if (!card) continue;
    const playerIds = reveal.playerIds.filter((playerId) => {
      const player = state.players.get(playerId);
      return Boolean(player && !player.eliminated && player.energy >= effectiveCost(state, player, card.cardId));
    });
    if (!playerIds.length) continue;
    state.pendingOpportunist = { cardInstanceId: reveal.cardInstanceId, playerIds };
    state.phase = 'awaiting_opportunist';
    addLog(state, `${state.players.get(playerIds[0])!.displayName} may buy the newly revealed ${KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].name}.`);
    return;
  }
  if (state.status === 'playing') state.phase = 'buying_cards';
}
function resumePendingOpportunistWindow(state: KingOfTokyoServerState): void {
  reconcilePendingOpportunistEligibility(state);
  if (state.phase !== 'awaiting_opportunist') return;
  if (!state.pendingOpportunist?.playerIds.length) {
    advanceOpportunistWindow(state);
    return;
  }
  addLog(state, `${state.players.get(state.pendingOpportunist.playerIds[0])!.displayName} may buy the revealed card.`);
}
function resumeAfterDeathFromAbove(state: KingOfTokyoServerState): void {
  if (state.status !== 'playing') return;
  if (!advanceIfCurrentPlayerEliminated(state)) advanceOpportunistWindow(state);
}
function completeDeathFromAboveChoice(
  state: KingOfTokyoServerState,
  target: KingOfTokyoPlayer | null,
  rng: RandomSource,
): void {
  const pending = state.pendingDeathFromAbove;
  if (!pending) return;
  const buyer = state.players.get(pending.playerId);
  state.pendingDeathFromAbove = null;
  if (!buyer || buyer.eliminated || buyer.tokyoZone) {
    resumeAfterDeathFromAbove(state);
    return;
  }
  if (target?.tokyoZone) {
    const zone = target.tokyoZone;
    target.tokyoZone = null;
    clearPendingBurrowingYields(state, buyer.playerId);
    addLog(state, `${target.displayName} was forced out of Tokyo by ${buyer.displayName}'s Death from Above.`);
    enterTokyoZone(state, buyer, zone, rng);
  } else enterOpenTokyoZone(state, buyer, rng);
  if (state.pendingDamageWorkflow || state.resolutionTasks.length) {
    state.resolutionTasks.push({ kind: 'resume_death_from_above' });
    return;
  }
  resumeAfterDeathFromAbove(state);
}
function reconcilePendingDeathFromAbove(state: KingOfTokyoServerState, rng: RandomSource): void {
  const pending = state.pendingDeathFromAbove;
  if (!pending) return;
  const buyer = state.players.get(pending.playerId);
  if (!buyer || buyer.eliminated || buyer.tokyoZone) {
    completeDeathFromAboveChoice(state, null, rng);
    return;
  }
  pending.targetPlayerIds = pending.targetPlayerIds.filter((playerId) => {
    const target = state.players.get(playerId);
    return Boolean(target && !target.eliminated && target.tokyoZone);
  });
  if (pending.targetPlayerIds.length > 1) return;
  const target = pending.targetPlayerIds[0]
    ? state.players.get(pending.targetPlayerIds[0]) ?? null
    : null;
  completeDeathFromAboveChoice(state, target, rng);
}
function resolveDiscardCard(
  state: KingOfTokyoServerState, buyer: KingOfTokyoPlayer,
  cardId: KingOfTokyoPowerCardId, rng: RandomSource,
): void {
  const others = () => livingPlayers(state).filter((player) => player.playerId !== buyer.playerId);
  const gainPoints = (amount: number) => {
    buyer.victoryPoints += amount;
    addLog(state, `${buyer.displayName} gained ${amount} victory point${amount === 1 ? '' : 's'}.`);
  };
  switch (cardId) {
    case 'apartment_building': gainPoints(3); break;
    case 'commuter_train': gainPoints(2); break;
    case 'corner_store': gainPoints(1); break;
    case 'drop_from_high_altitude': {
      gainPoints(2);
      const occupants = others().filter((player) => player.tokyoZone);
      for (const occupant of occupants) {
        queueTokyoYieldForEntrant(state, occupant, buyer);
        addLog(state, `${occupant.displayName} yielded Tokyo to ${buyer.displayName}'s Death from Above.`);
      }
      enterOpenTokyoZone(state, buyer, rng);
      break;
    }
    case 'energize': gainEnergy(state, buyer, 9); break;
    case 'evacuation_orders':
      for (const player of others()) player.victoryPoints = Math.max(0, player.victoryPoints - 5);
      addLog(state, `Every rival of ${buyer.displayName} lost up to 5 victory points.`); break;
    case 'flame_thrower':
      damagePlayersAtomically(state, others(), 2, buyer.playerId, rng); break;
    case 'frenzy':
      state.queuedExtraTurns.push({ playerId: buyer.playerId, dicePenalty: 0, source: 'Frenzy' });
      addLog(state, `${buyer.displayName} gained an extra turn from Frenzy.`); break;
    case 'gas_refinery':
      gainPoints(2);
      damagePlayersAtomically(state, others(), 3, buyer.playerId, rng);
      break;
    case 'heal': healPlayer(state, buyer, 2, 'Heal'); break;
    case 'high_altitude_bombing':
      damagePlayersAtomically(state, livingPlayers(state), 3, buyer.playerId, rng);
      break;
    case 'jet_fighters':
      gainPoints(5);
      beginDamageWorkflow(state, [buyer], 4, buyer.playerId, 'card', rng, [
        { kind: 'reconcile_jets' }, { kind: 'normalize_tokyo' },
      ]);
      break;
    case 'national_guard':
      gainPoints(2);
      beginDamageWorkflow(state, [buyer], 2, buyer.playerId, 'card', rng, [
        { kind: 'reconcile_jets' }, { kind: 'normalize_tokyo' },
      ]);
      break;
    case 'nuclear_power_plant': gainPoints(2); healPlayer(state, buyer, 3, 'Nuclear Power Plant'); break;
    case 'skyscraper': gainPoints(4); break;
    case 'tanks':
      gainPoints(4);
      beginDamageWorkflow(state, [buyer], 3, buyer.playerId, 'card', rng, [
        { kind: 'reconcile_jets' }, { kind: 'normalize_tokyo' },
      ]);
      break;
    case 'vast_storm':
      gainPoints(2);
      for (const player of others()) player.energy -= Math.floor(player.energy / 2);
      addLog(state, `${buyer.displayName}'s rivals lost half their energy, rounded down.`); break;
    default: throw new Error(`Keep card ${cardId} reached discard resolver`);
  }
}
function acquirePowerCard(
  state: KingOfTokyoServerState, buyer: KingOfTokyoPlayer, card: KingOfTokyoMarketCard,
  rng: RandomSource, paymentRecipient?: KingOfTokyoPlayer,
): EngineResult {
  const definition = KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId];
  const cost = effectiveCost(state, buyer, card.cardId);
  if (buyer.energy < cost) return fail(`Need ${cost} energy`);
  const mediaFriendly = effectCount(state, buyer, 'media_friendly');
  buyer.energy -= cost; if (paymentRecipient) paymentRecipient.energy += cost;
  addLog(state, `${buyer.displayName} bought ${definition.name} for ${cost} energy.`);
  if (mediaFriendly) {
    buyer.victoryPoints += mediaFriendly;
    addLog(state, `${buyer.displayName} gained ${mediaFriendly} victory point${mediaFriendly === 1 ? '' : 's'} from Media Friendly.`);
  }
  if (definition.kind === 'keep') {
    buyer.powerCards.push({
      ...card, counters: card.cardId === 'battery_monster' ? 6 : card.cardId === 'smoke_cloud' ? 3 : 0,
      mimicTargetInstanceId: null,
    });
    if (card.cardId === 'even_bigger') { syncMaxHealth(state, buyer); healPlayer(state, buyer, 2, 'Even Bigger'); }
    if (card.cardId === 'mimic' && livingPlayers(state).some((candidate) =>
      candidate.powerCards.some((target) => target.cardId !== 'mimic'))) {
      state.usedThisTurn.add(`mimic_initial:${card.instanceId}`);
    }
    if (card.cardId === 'made_in_a_lab' && state.phase === 'buying_cards' && currentPlayerId(state) === buyer.playerId) {
      state.labOffersRemaining += 1;
      refillDeckIfNeeded(state, rng);
    }
  } else {
    state.discardPile.push(card); resolveDiscardCard(state, buyer, card.cardId, rng);
  }
  checkVictoryPoints(state, buyer); return OK;
}
function beginTurn(state: KingOfTokyoServerState): void {
  if (state.status !== 'playing') return;
  Object.assign(state, {
    rollCount: 0, pendingPsychicProbes: [], pendingDiceResolution: null, pendingHeartAllocation: null,
    pendingTokyoDecisions: [], pendingTokyoDamage: new Map<string, PendingTokyoDamage>(),
    pendingDamageWorkflow: null, pendingDefenseDecision: null, pendingEvenBiggerLosses: [],
    pendingEvenBiggerReconcileJets: false, pendingEvenBiggerNormalizeTokyo: false,
    resolutionTasks: [], completedDamageOutcome: null,
    drainingResolutionTasks: false, pendingSmashResolution: null,
    pendingSmashAftermath: null, pendingBurrowingYields: [], pendingDeathFromAbove: null,
    pendingFreezeTimeDecisions: [],
    pendingOpportunist: null, opportunistRevealQueue: [], labOffersRemaining: 0, purchasesThisTurn: 0,
    usedThisTurn: new Set<string>(), wingsProtected: new Set<string>(), turnDealtDamage: false,
    mustEnterTokyo: false, pendingEndTurnEffects: [],
  });
  const player = currentPlayer(state); syncMaxHealth(state, player);
  const batteryPayouts = effectCards(state, player, 'battery_monster')
    .map((card) => ({ owner: player, card, moved: Math.min(2, card.counters) }));
  for (const { owner, card, moved } of batteryPayouts) {
    card.counters -= moved;
    if (moved) gainEnergy(state, owner, moved, false);
    if (moved) addLog(state, `${owner.displayName} moved ${moved} stored energy from Battery Monster.`);
  }
  const emptyBatteryIdsByOwner = new Map(state.turnOrder.map((playerId) => [
    playerId,
    batteryPayouts
      .filter((payout) => payout.owner.playerId === playerId && payout.card.counters === 0)
      .map((payout) => payout.card.instanceId),
  ]));
  for (const owner of livingPlayers(state)) {
    const emptyBatteryIds = emptyBatteryIdsByOwner.get(owner.playerId) ?? [];
    if (emptyBatteryIds.length) discardOwnedCards(state, owner, emptyBatteryIds);
  }
  const diceCount = Math.max(
    0, KING_OF_TOKYO_DICE_COUNT + effectCount(state, player, 'extra_head') -
      player.shrinkTokens - state.currentTurnDicePenalty,
  );
  state.maxRolls = KING_OF_TOKYO_MAX_ROLLS + effectCount(state, player, 'giant_brain');
  state.dice = Array.from({ length: diceCount }, () => ({ face: null, kept: false }));
  state.phase = 'awaiting_roll';
  addLog(state, `${player.displayName}'s turn began with ${diceCount} dice and up to ${state.maxRolls} rolls.`);
  if (player.tokyoZone) {
    const points = 2 + effectCount(state, player, 'urbavore');
    player.victoryPoints += points;
    addLog(state, `${player.displayName} began in Tokyo and gained ${points} victory points.`);
    checkVictoryPoints(state, player);
  }
}

function settleStartingRolls(state: KingOfTokyoServerState): void {
  state.startingRollContenders = state.startingRollContenders.filter((id) => !state.players.get(id)!.eliminated);
  if (!state.startingRollContenders.length) return;
  if (state.startingRollContenders.length === 1) {
    const winnerId = state.startingRollContenders[0];
    state.startingRollContenders = [];
    state.currentTurnIndex = state.turnOrder.indexOf(winnerId);
    addLog(state, `${state.players.get(winnerId)!.displayName} won the roll-off.`); beginTurn(state);
    return;
  }
  if (!state.startingRollContenders.every((id) => state.startRolls.get(id) !== null)) return;
  const high = Math.max(...state.startingRollContenders.map((id) => state.startRolls.get(id) ?? 0));
  const leaders = state.startingRollContenders.filter((id) => state.startRolls.get(id) === high);
  if (leaders.length === 1) {
    state.startingRollContenders = [];
    state.currentTurnIndex = state.turnOrder.indexOf(leaders[0]);
    addLog(state, `${state.players.get(leaders[0])!.displayName} won the roll-off.`); beginTurn(state);
  } else {
    state.startingRollContenders = leaders;
    state.rollOffRound += 1;
    for (const id of leaders) state.startRolls.set(id, null);
    addLog(state, `${leaders.length} monsters tied and must roll again.`);
  }
}

export function rollForFirstPlayer(
  state: KingOfTokyoServerState, playerId: string, rng: RandomSource = Math.random,
  expectedRevision: number, rollOffRound: number,
): EngineResult {
  if (state.status !== 'playing') return fail('The game is over');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return fail('Invalid game-state revision');
  if (expectedRevision < state.startingRevision || expectedRevision > state.revision) {
    return fail('Your game state is stale; refresh and try again');
  }
  const player = state.players.get(playerId);
  if (!player || player.eliminated) return fail('Player cannot act');
  if (state.phase !== 'determining_first_player') return fail('First player has already been chosen');
  if (!Number.isSafeInteger(rollOffRound) || rollOffRound < 1 || rollOffRound !== state.rollOffRound) {
    return fail('That roll-off round is stale; refresh and try again');
  }
  if (!state.startingRollContenders.includes(playerId)) return fail('You are not in this roll-off');
  if (state.startRolls.get(playerId) !== null) return fail('You already rolled in this round');
  let smashes = 0;
  for (let die = 0; die < KING_OF_TOKYO_DICE_COUNT; die += 1) if (rollFace(rng) === 'smash') smashes += 1;
  state.startRolls.set(playerId, smashes);
  addLog(state, `${state.players.get(playerId)!.displayName} rolled ${smashes} Smash for first player.`);
  settleStartingRolls(state);
  return commit(state);
}
export function rollDice(
  state: KingOfTokyoServerState, playerId: string, rng: RandomSource = Math.random,
  expectedRevision: number,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (currentPlayerId(state) !== playerId) return fail('It is not your turn');
  if (state.phase !== 'awaiting_roll' && state.phase !== 'choosing_dice') return fail('Dice cannot be rolled in this phase');
  if (state.rollCount >= state.maxRolls) return fail('No rolls remain');
  const indexes = state.dice.flatMap((die, index) => state.rollCount === 0 || !die.kept ? [index] : []);
  if (!indexes.length) {
    if (state.rollCount > 0) return fail('At least one die must be available to reroll');
    state.rollCount = 1; state.phase = 'choosing_dice';
    addLog(state, `${currentPlayer(state).displayName} had no dice to roll.`);
    return commit(state);
  }
  for (const index of indexes) state.dice[index] = { face: rollFace(rng), kept: false };
  state.rollCount += 1; state.phase = 'choosing_dice';
  addLog(state, `${currentPlayer(state).displayName} rolled ${indexes.length} ${indexes.length === 1 ? 'die' : 'dice'} (${state.rollCount}/${state.maxRolls}).`);
  return commit(state);
}
export function setKeptDice(
  state: KingOfTokyoServerState, playerId: string, keptIndexes: number[], expectedRevision: number,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (currentPlayerId(state) !== playerId) return fail('It is not your turn');
  if (state.phase !== 'choosing_dice' || !state.rollCount) return fail('Dice can only be kept after a roll');
  if (!Array.isArray(keptIndexes)) return fail('Kept dice must be an array');
  const unique = new Set(keptIndexes);
  if (unique.size !== keptIndexes.length) return fail('Each die index may appear only once');
  if ([...unique].some((index) => !Number.isInteger(index) || index < 0 || index >= state.dice.length)) return fail('Invalid die index');
  state.dice.forEach((die, index) => { die.kept = unique.has(index); }); return commit(state);
}
function countFace(state: KingOfTokyoServerState, face: KingOfTokyoDieFace): number {
  return state.dice.filter((die) => die.face === face).length;
}
function scoreNumberDice(state: KingOfTokyoServerState, player: KingOfTokyoPlayer): void {
  let points = 0;
  for (const value of [1, 2, 3] as const) {
    const count = countFace(state, value); if (count >= 3) points += value + count - 3;
  }
  if (countFace(state, 1) >= 3) points += effectCount(state, player, 'gourmet') * 2;
  if ([1, 2, 3].every((face) => countFace(state, face as 1 | 2 | 3))) points += effectCount(state, player, 'detritivore') * 2;
  if (KING_OF_TOKYO_DIE_FACES.every((face) => countFace(state, face))) points += effectCount(state, player, 'complete_destruction') * 9;
  if (points) {
    player.victoryPoints += points;
    addLog(state, `${player.displayName} gained ${points} victory ${points === 1 ? 'point' : 'points'} from the final roll.`);
  }
}
function attackTargets(state: KingOfTokyoServerState, actor: KingOfTokyoPlayer): KingOfTokyoPlayer[] {
  if (effectCount(state, actor, 'nova_breath')) return livingPlayers(state).filter((player) => player.playerId !== actor.playerId);
  return livingPlayers(state).filter((target) => actor.tokyoZone === null ? target.tokyoZone !== null : target.tokyoZone === null);
}
function livingNeighbors(state: KingOfTokyoServerState, playerId: string): KingOfTokyoPlayer[] {
  const ids = state.turnOrder.filter((id) => !state.players.get(id)!.eliminated);
  const index = ids.indexOf(playerId); if (index < 0 || ids.length < 2) return [];
  const left = ids[(index - 1 + ids.length) % ids.length]; const right = ids[(index + 1) % ids.length];
  return [...new Set([left, right])].map((id) => state.players.get(id)!);
}
function finishDiceResolution(state: KingOfTokyoServerState, rng: RandomSource): void {
  if (state.status !== 'playing') return;
  state.pendingDiceResolution = null;
  state.pendingHeartAllocation = null;
  state.mustEnterTokyo = !currentPlayer(state).tokyoZone;
  if (state.mustEnterTokyo) enterOpenTokyoZone(state, currentPlayer(state), rng);
  else clearPendingBurrowingYields(state, currentPlayerId(state));
  if (state.pendingDamageWorkflow || state.resolutionTasks.length) {
    state.resolutionTasks.push({ kind: 'finish_dice_after_entry' });
    return;
  }
  if (advanceIfCurrentPlayerEliminated(state)) return;
  if (state.status === 'playing') {
    state.phase = 'buying_cards';
    state.labOffersRemaining = effectCount(state, currentPlayer(state), 'made_in_a_lab');
    if (state.labOffersRemaining > 0) refillDeckIfNeeded(state, rng);
  }
}
function queueFreezeTimeDecisions(state: KingOfTokyoServerState, actor: KingOfTokyoPlayer): void {
  if (countFace(state, 1) < 3) return;
  const cards = effectCards(state, actor, 'freeze_time');
  if (!cards.length) return;
  const dicePenalty = state.currentTurnDicePenalty + 1;
  state.pendingFreezeTimeDecisions.push(...cards.map((card) => ({
    playerId: actor.playerId,
    cardInstanceId: card.instanceId,
    dicePenalty,
  })));
  state.phase = 'awaiting_freeze_time';
  addLog(state, `${actor.displayName} may take ${cards.length === 1 ? 'an extra turn' : `${cards.length} separate extra turns`} from Freeze Time.`);
}
function resumeFreezeTimeAfterReconciliation(state: KingOfTokyoServerState, rng: RandomSource): void {
  if (state.phase !== 'awaiting_freeze_time' || state.pendingFreezeTimeDecisions.length ||
      !state.pendingDiceResolution || currentPlayer(state).eliminated) return;
  state.phase = 'awaiting_dice_resolution';
  continueDiceResolution(state, rng);
}
function applyAttackTokens(
  state: KingOfTokyoServerState,
  target: KingOfTokyoPlayer,
  tokens: Pick<PendingTokyoDamage, 'poisonTokens' | 'shrinkTokens'>,
): void {
  if (target.eliminated) return;
  if (tokens.poisonTokens) {
    target.poisonTokens += tokens.poisonTokens;
    addLog(state, `${target.displayName} received ${tokens.poisonTokens} Poison token${tokens.poisonTokens === 1 ? '' : 's'}.`);
  }
  if (tokens.shrinkTokens) {
    target.shrinkTokens += tokens.shrinkTokens;
    addLog(state, `${target.displayName} received ${tokens.shrinkTokens} Shrink token${tokens.shrinkTokens === 1 ? '' : 's'}.`);
  }
}
function queueDeferredEvenBiggerLoss(
  state: KingOfTokyoServerState,
  player: KingOfTokyoPlayer,
  pendingDamage: PendingTokyoDamage,
  consumedBody: boolean,
): boolean {
  const amount = pendingDamage.deferredEvenBiggerLoss;
  pendingDamage.deferredEvenBiggerLoss = 0;
  if (!amount || consumedBody || player.eliminated || state.status !== 'playing') return false;
  queueEvenBiggerLoss(state, {
    playerId: player.playerId,
    copiesRemaining: Math.ceil(amount / 2),
    finalMaxHealth: KING_OF_TOKYO_MAX_HEALTH + effectCount(state, player, 'even_bigger') * 2,
    entitlements: pendingDamage.smashEntitlements,
    deathWatcherEntitlements: pendingDamage.deathWatcherEntitlements,
    preservePendingJetsEntitlements: true,
  }, true, true);
  return true;
}
interface CompletedDamageOutcome {
  losses: Map<string, number>;
  consumedBodyPlayerIds: Set<string>;
}

function beginPendingTokyoSmash(
  state: KingOfTokyoServerState,
  player: KingOfTokyoPlayer,
  pendingDamage: PendingTokyoDamage,
  actor: KingOfTokyoPlayer,
  mode: 'stay' | 'stale' | 'normalization',
  rng: RandomSource,
): void {
  beginDamageWorkflow(
    state,
    [player],
    pendingDamage.amount,
    actor.playerId,
    'smash',
    rng,
    [{ kind: 'complete_tokyo_smash', playerId: player.playerId, pendingDamage, mode }],
    new Map([[player.playerId, pendingDamage.smashEntitlements]]),
    pendingDamage.deathWatcherEntitlements,
    false,
    true,
  );
}
function resolvePendingSmashAftermath(state: KingOfTokyoServerState, rng: RandomSource): void {
  const aftermath = state.pendingSmashAftermath;
  if (!aftermath || state.status !== 'playing') return;
  const actor = state.players.get(aftermath.actorId);
  if (!actor) return;
  if (aftermath.alphaPoints) {
    actor.victoryPoints += aftermath.alphaPoints;
    addLog(state, `${actor.displayName} gained ${aftermath.alphaPoints} victory point${aftermath.alphaPoints === 1 ? '' : 's'} from Alpha Monster.`);
    aftermath.alphaPoints = 0;
  }
  if (aftermath.fireSources > 0) {
    aftermath.fireSources -= 1;
    const neighbors = aftermath.fireNeighborIds.flatMap((neighborId) => {
      const neighbor = state.players.get(neighborId);
      return neighbor ? [neighbor] : [];
    });
    beginDamageWorkflow(state, neighbors, 1, actor.playerId, 'card', rng, [
      { kind: 'reconcile_jets' },
      { kind: 'normalize_tokyo' },
      { kind: 'continue_fire' },
    ]);
    return;
  }
  state.pendingSmashAftermath = null;
}
function reconcilePendingJets(state: KingOfTokyoServerState, rng: RandomSource): void {
  if (state.pendingDamageWorkflow) return;
  const stale = [...state.pendingTokyoDamage].find(([playerId, pendingDamage]) => {
    const player = state.players.get(playerId);
    return !player || player.eliminated || !player.tokyoZone ||
      (!pendingDamage.jetsSnapshotGranted && effectCount(state, player, 'jets') === 0);
  });
  if (!stale) return;
  const [playerId, pendingDamage] = stale;
  const player = state.players.get(playerId);
  state.pendingTokyoDamage.delete(playerId);
  if (!player || player.eliminated || !player.tokyoZone) {
    state.pendingTokyoDecisions = state.pendingTokyoDecisions.filter((id) => id !== playerId);
    reconcilePendingJets(state, rng);
    return;
  }
  const actor = currentPlayer(state);
  addLog(state, `${player.displayName} lost access to Jets before yielding, so the deferred Smash resolves.`);
  state.resolutionTasks.unshift(
    { kind: 'reconcile_jets' },
    ...(state.pendingSmashResolution ? [] : [{ kind: 'resume_tokyo_queue' } as const]),
  );
  beginPendingTokyoSmash(state, player, pendingDamage, actor, 'stale', rng);
}
function resolveSmashCategory(state: KingOfTokyoServerState, rng: RandomSource): void {
  const actor = currentPlayer(state);
  const rolledSmashes = countFace(state, 'smash');
  const quillSmashes = countFace(state, 2) >= 3 ? effectCount(state, actor, 'poison_quills') * 2 : 0;
  const burrowingSmashes = actor.tokyoZone ? effectCount(state, actor, 'burrowing') : 0;
  let smashes = rolledSmashes + effectCount(state, actor, 'acid_attack') + quillSmashes + burrowingSmashes;
  if (smashes) {
    smashes += effectCount(state, actor, 'spiked_tail');
    if (actor.tokyoZone) smashes += effectCount(state, actor, 'urbavore');
  }
  state.mustEnterTokyo = !actor.tokyoZone;
  const targets = smashes ? attackTargets(state, actor) : [];
  const attackTokens = {
    poisonTokens: effectCount(state, actor, 'poison_spit'),
    shrinkTokens: effectCount(state, actor, 'shrink_ray'),
  };
  const fireSources = smashes > 0 ? effectCount(state, actor, 'fire_breathing') : 0;
  const neighborIds = new Set(fireSources ? livingNeighbors(state, actor.playerId).map((player) => player.playerId) : []);
  const alphaPoints = smashes > 0 ? effectCount(state, actor, 'alpha_monster') : 0;
  state.pendingSmashAftermath = alphaPoints || fireSources ? {
    actorId: actor.playerId,
    alphaPoints,
    fireSources,
    fireNeighborIds: [...neighborIds],
  } : null;
  const eaterEntitlements = new Map(
    livingPlayers(state).map((player) => [player.playerId, effectCount(state, player, 'eater_of_the_dead')]),
  );
  const damageEntitlements = new Map(
    targets.map((player) => [player.playerId, captureSmashDamageEntitlements(state, player)]),
  );
  const directTargets: KingOfTokyoPlayer[] = [];
  for (const target of targets) {
    const jetsCards = target.tokyoZone ? effectCards(state, target, 'jets') : [];
    if (jetsCards.length) {
      state.pendingTokyoDamage.set(target.playerId, {
        amount: smashes,
        ...attackTokens,
        jetsCardInstanceIds: jetsCards.map((card) => card.instanceId),
        jetsSnapshotGranted: false,
        smashEntitlements: damageEntitlements.get(target.playerId)!,
        deathWatcherEntitlements: [...eaterEntitlements].flatMap(([playerId, copies]) =>
          copies ? [{ playerId, copies }] : []),
        deferredEvenBiggerLoss: 0,
      });
    } else {
      directTargets.push(target);
    }
  }
  state.pendingSmashResolution = {
    actorId: actor.playerId,
    smashes,
    targetPlayerIds: targets.map((target) => target.playerId),
    ...attackTokens,
    woundedTokyoTargetIds: [],
  };
  if (directTargets.length) {
    beginDamageWorkflow(
      state,
      directTargets,
      smashes,
      actor.playerId,
      'smash',
      rng,
      [{ kind: 'complete_smash_direct' }],
      damageEntitlements,
      [...eaterEntitlements].flatMap(([playerId, copies]) => copies ? [{ playerId, copies }] : []),
      true,
      true,
    );
  } else {
    state.resolutionTasks.unshift({ kind: 'complete_smash_direct' });
    state.completedDamageOutcome = { losses: [], consumedBodyPlayerIds: [] };
    runResolutionTasks(state, rng);
  }
}

function storedDamageOutcome(state: KingOfTokyoServerState): CompletedDamageOutcome {
  const stored = state.completedDamageOutcome;
  return {
    losses: new Map(stored?.losses.map(({ playerId, amount }) => [playerId, amount]) ?? []),
    consumedBodyPlayerIds: new Set(stored?.consumedBodyPlayerIds ?? []),
  };
}

function completeDirectSmash(
  state: KingOfTokyoServerState,
  outcome: CompletedDamageOutcome,
): void {
  const pending = state.pendingSmashResolution;
  if (!pending) return;
  grantPendingJetsSnapshotLosses(state);
  for (const targetId of pending.targetPlayerIds) {
    const target = state.players.get(targetId);
    const lost = outcome.losses.get(targetId) ?? 0;
    if (!target || !lost) continue;
    if (!target.eliminated && target.tokyoZone) pending.woundedTokyoTargetIds.push(targetId);
    applyAttackTokens(state, target, pending);
  }
  const actor = state.players.get(pending.actorId);
  if (!pending.targetPlayerIds.length && pending.smashes && actor) {
    addLog(state, `${actor.displayName}'s Smash hit no monsters.`);
  }
  reconcileCardDerivedAuthorizations(state);
  state.resolutionTasks.unshift(
    { kind: 'reconcile_jets' },
    { kind: 'normalize_tokyo' },
    { kind: 'finalize_smash_queue' },
  );
}

function finalizeSmashQueue(state: KingOfTokyoServerState): void {
  const pending = state.pendingSmashResolution;
  if (!pending) return;
  if (pending.smashes) {
    const woundedIds = new Set([
      ...pending.woundedTokyoTargetIds,
      ...state.pendingTokyoDamage.keys(),
      ...state.pendingTokyoDecisions,
    ]);
    state.pendingTokyoDecisions = Array.from(
      { length: state.turnOrder.length - 1 },
      (_, index) => state.turnOrder[(state.currentTurnIndex + index + 1) % state.turnOrder.length],
    ).filter((targetId) => woundedIds.has(targetId) &&
      !state.players.get(targetId)!.eliminated && state.players.get(targetId)!.tokyoZone);
  }
  state.pendingSmashResolution = null;
  if (state.pendingTokyoDecisions.length) {
    state.phase = 'awaiting_tokyo_decision';
    return;
  }
  state.resolutionTasks.unshift({ kind: 'continue_fire' }, { kind: 'resume_dice_after_smash' });
}

function finishEvenBiggerLossDrain(state: KingOfTokyoServerState): void {
  const tasks: ResolutionTask[] = [];
  if (state.pendingEvenBiggerReconcileJets) tasks.push({ kind: 'reconcile_jets' });
  if (state.pendingEvenBiggerNormalizeTokyo) tasks.push({ kind: 'normalize_tokyo' });
  state.pendingEvenBiggerReconcileJets = false;
  state.pendingEvenBiggerNormalizeTokyo = false;
  if (tasks.length) state.resolutionTasks.unshift(...tasks);
}

function beginNextEvenBiggerLoss(state: KingOfTokyoServerState, rng: RandomSource): void {
  let pending: PendingEvenBiggerLoss | undefined;
  let player: KingOfTokyoPlayer | undefined;
  while ((pending = state.pendingEvenBiggerLosses.shift())) {
    player = state.players.get(pending.playerId);
    if (player && !player.eliminated && player.health > 0 && state.status === 'playing') break;
    player = undefined;
  }
  if (!pending || !player) {
    finishEvenBiggerLossDrain(state);
    return;
  }
  beginDamageWorkflow(
    state,
    [player],
    2,
    null,
    'card',
    rng,
    [
      { kind: 'complete_even_bigger_loss', pending },
      { kind: 'drain_even_bigger_losses' },
    ],
    new Map([[player.playerId, pending.entitlements]]),
    pending.deathWatcherEntitlements,
    false,
    pending.preservePendingJetsEntitlements,
  );
}

function completeEvenBiggerLoss(
  state: KingOfTokyoServerState,
  pending: PendingEvenBiggerLoss,
  outcome: CompletedDamageOutcome,
): void {
  const player = state.players.get(pending.playerId);
  const consumedBody = outcome.consumedBodyPlayerIds.has(pending.playerId);
  if (!player) return;
  const derivedMaxHealth = KING_OF_TOKYO_MAX_HEALTH + effectCount(state, player, 'even_bigger') * 2;
  if (player.eliminated || consumedBody || state.status !== 'playing') {
    player.maxHealth = derivedMaxHealth;
    player.health = Math.min(player.health, player.maxHealth);
    return;
  }
  player.maxHealth = Math.max(pending.finalMaxHealth, derivedMaxHealth, player.maxHealth - 2);
  const aboveNewMaximum = Math.max(0, player.health - player.maxHealth);
  player.health -= aboveNewMaximum;
  if (aboveNewMaximum) {
    addLog(state, `${player.displayName} lost ${aboveNewMaximum} health above the new maximum.`);
  }
  pending.copiesRemaining -= 1;
  if (pending.copiesRemaining > 0) state.pendingEvenBiggerLosses.unshift(pending);
}

function finishTokyoSmashAfterEvenBigger(
  state: KingOfTokyoServerState,
  task: Extract<ResolutionTask, { kind: 'complete_tokyo_smash_after_even_bigger' }>,
): void {
  const player = state.players.get(task.playerId);
  if (!player) return;
  if (task.lost) applyAttackTokens(state, player, task.pendingDamage);
  if (task.mode === 'stay') {
    if (!player.eliminated) addLog(state, `${player.displayName} stayed in Tokyo.`);
  } else if (task.mode === 'stale') {
    if (task.lost > 0 && !player.eliminated && player.tokyoZone) {
      if (!state.pendingTokyoDecisions.includes(player.playerId)) state.pendingTokyoDecisions.push(player.playerId);
    } else state.pendingTokyoDecisions = state.pendingTokyoDecisions.filter((id) => id !== player.playerId);
  }
}

function completeTokyoSmash(
  state: KingOfTokyoServerState,
  task: Extract<ResolutionTask, { kind: 'complete_tokyo_smash' }>,
  outcome: CompletedDamageOutcome,
): void {
  const player = state.players.get(task.playerId);
  if (!player) return;
  const lost = outcome.losses.get(player.playerId) ?? 0;
  const consumedBody = outcome.consumedBodyPlayerIds.has(player.playerId);
  const continuation: Extract<ResolutionTask, { kind: 'complete_tokyo_smash_after_even_bigger' }> = {
    kind: 'complete_tokyo_smash_after_even_bigger',
    playerId: player.playerId,
    pendingDamage: task.pendingDamage,
    mode: task.mode,
    lost,
  };
  if (queueDeferredEvenBiggerLoss(state, player, task.pendingDamage, consumedBody)) {
    queueAfterEvenBiggerLosses(state, continuation);
  } else {
    finishTokyoSmashAfterEvenBigger(state, continuation);
  }
}

function resumeTokyoQueue(state: KingOfTokyoServerState): void {
  if (state.pendingTokyoDecisions.length) {
    state.phase = 'awaiting_tokyo_decision';
    return;
  }
  state.resolutionTasks.unshift({ kind: 'continue_fire' }, { kind: 'resume_dice_after_smash' });
}

function finishDiceAfterEntry(state: KingOfTokyoServerState, rng: RandomSource): void {
  if (advanceIfCurrentPlayerEliminated(state)) return;
  if (state.status === 'playing') {
    state.phase = 'buying_cards';
    state.labOffersRemaining = effectCount(state, currentPlayer(state), 'made_in_a_lab');
    if (state.labOffersRemaining > 0) refillDeckIfNeeded(state, rng);
  }
}

function resumePurchaseAfterDamage(
  state: KingOfTokyoServerState,
  task: Extract<ResolutionTask, { kind: 'resume_purchase' }>,
): void {
  if (state.status !== 'playing') return;
  state.phase = task.previousPhase;
  if (task.mode === 'lab') {
    advanceIfCurrentPlayerEliminated(state);
    return;
  }
  advanceOpportunistWindow(state);
}

function completePowerSale(
  state: KingOfTokyoServerState,
  task: Extract<ResolutionTask, { kind: 'complete_power_sale' }>,
): void {
  const player = state.players.get(task.playerId);
  if (!player) return;
  if (!player.eliminated) {
    gainEnergy(state, player, task.value, false);
    addLog(state, `${player.displayName} metamorphed ${KING_OF_TOKYO_POWER_CARD_BY_ID[task.cardId].name} into ${task.value} energy.`);
  }
  reconcilePendingEndTurnEffects(state, player);
  advanceIfCurrentPlayerEliminated(state);
}

function completeMimicRetarget(
  state: KingOfTokyoServerState,
  task: Extract<ResolutionTask, { kind: 'complete_mimic_retarget' }>,
): void {
  if (!advanceIfCurrentPlayerEliminated(state) && task.initialTarget) advanceOpportunistWindow(state);
}

function runResolutionTasks(state: KingOfTokyoServerState, rng: RandomSource): void {
  if (state.drainingResolutionTasks || state.pendingDamageWorkflow || state.pendingDefenseDecision) return;
  const heartWindowAtEntry = state.pendingHeartAllocation;
  state.drainingResolutionTasks = true;
  try {
    while (state.status === 'playing' && state.resolutionTasks.length &&
           !state.pendingDamageWorkflow && !state.pendingDefenseDecision &&
           (!state.pendingHeartAllocation || state.pendingHeartAllocation === heartWindowAtEntry)) {
      const task = state.resolutionTasks.shift()!;
      const outcome = storedDamageOutcome(state);
      state.completedDamageOutcome = null;
      switch (task.kind) {
        case 'complete_smash_direct': completeDirectSmash(state, outcome); break;
        case 'reconcile_jets': reconcilePendingJets(state, rng); break;
        case 'normalize_tokyo': normalizeAndReconcileTokyoBay(state, rng); break;
        case 'finalize_smash_queue': finalizeSmashQueue(state); break;
        case 'continue_fire': resolvePendingSmashAftermath(state, rng); break;
        case 'resume_dice_after_smash':
          if (currentPlayer(state).eliminated) {
            state.pendingTokyoDamage.clear();
            state.pendingDiceResolution = null;
            state.pendingHeartAllocation = null;
            advanceIfCurrentPlayerEliminated(state);
          } else if (state.pendingDiceResolution) continueDiceResolution(state, rng);
          else finishDiceResolution(state, rng);
          break;
        case 'complete_tokyo_smash': completeTokyoSmash(state, task, outcome); break;
        case 'resume_tokyo_queue': resumeTokyoQueue(state); break;
        case 'continue_burrowing':
          continueBurrowingDamage(state, task.playerId, task.sourcePlayerId, task.copiesRemaining, rng);
          break;
        case 'drain_even_bigger_losses': beginNextEvenBiggerLoss(state, rng); break;
        case 'complete_even_bigger_loss': completeEvenBiggerLoss(state, task.pending, outcome); break;
        case 'complete_tokyo_smash_after_even_bigger': finishTokyoSmashAfterEvenBigger(state, task); break;
        case 'complete_tokyo_yield_after_even_bigger':
          finishTokyoYieldAfterEvenBigger(state, task.playerId, rng);
          break;
        case 'complete_power_sale': completePowerSale(state, task); break;
        case 'complete_mimic_retarget': completeMimicRetarget(state, task); break;
        case 'resume_forfeit':
          finishForfeitResolution(
            state,
            task.playerId,
            task.wasCurrentPlayer,
            task.deathFromAboveOwnerId,
            rng,
          );
          break;
        case 'resume_purchase': resumePurchaseAfterDamage(state, task); break;
        case 'complete_end_turn_damage': {
          const player = state.players.get(task.playerId);
          if (player) {
            if (state.status !== 'playing' || player.eliminated || !state.pendingEndTurnEffects.length) {
              completeEndTurn(state, player);
            } else if (state.pendingEndTurnEffects.length === 1) {
              continueEndTurnEffects(state, player, rng);
            } else state.phase = 'resolving_end_turn';
          }
          break;
        }
        case 'resume_death_from_above': resumeAfterDeathFromAbove(state); break;
        case 'finish_dice_after_entry': finishDiceAfterEntry(state, rng); break;
      }
    }
  } finally {
    state.drainingResolutionTasks = false;
    if (!state.resolutionTasks.length && !state.pendingDamageWorkflow) state.completedDamageOutcome = null;
  }
}
function healingRayTargetPlayerIds(
  state: KingOfTokyoServerState,
  pending: PendingHeartAllocation,
): string[] {
  if (!pending.healingRayAvailable) return [];
  return state.turnOrder.filter((playerId) => {
    const player = state.players.get(playerId)!;
    return playerId !== pending.playerId && !player.eliminated && player.health < player.maxHealth;
  });
}

function validateHeartAllocation(
  state: KingOfTokyoServerState,
  pending: PendingHeartAllocation,
  allocation: KingOfTokyoHeartAllocation,
): EngineResult {
  if (!allocation || typeof allocation !== 'object' || Array.isArray(allocation) ||
      Object.keys(allocation).sort().join('|') !==
        ['healingRayUses', 'poisonTokensToRemove', 'shrinkTokensToRemove'].sort().join('|')) {
    return fail('Invalid Heart allocation');
  }
  if (!Number.isSafeInteger(allocation.poisonTokensToRemove) || allocation.poisonTokensToRemove < 0 ||
      !Number.isSafeInteger(allocation.shrinkTokensToRemove) || allocation.shrinkTokensToRemove < 0 ||
      !Array.isArray(allocation.healingRayUses)) {
    return fail('Invalid Heart allocation');
  }
  const actor = state.players.get(pending.playerId)!;
  const heartIndexes = new Set(pending.heartIndexes);
  const usedIndexes = new Set<number>();
  const usesByTarget = new Map<string, number>();
  for (const use of allocation.healingRayUses) {
    if (!use || typeof use !== 'object' || Array.isArray(use) ||
        Object.keys(use).sort().join('|') !== 'dieIndex|targetPlayerId' ||
        !Number.isSafeInteger(use.dieIndex) || !heartIndexes.has(use.dieIndex) || usedIndexes.has(use.dieIndex) ||
        typeof use.targetPlayerId !== 'string' || !use.targetPlayerId.trim()) {
      return fail('Invalid Healing Ray use');
    }
    const target = state.players.get(use.targetPlayerId);
    const nextUses = (usesByTarget.get(use.targetPlayerId) ?? 0) + 1;
    if (!pending.healingRayAvailable || !target || target.eliminated || target.playerId === actor.playerId ||
        nextUses > target.maxHealth - target.health) {
      return fail('Choose another wounded living monster for Healing Ray');
    }
    usedIndexes.add(use.dieIndex);
    usesByTarget.set(use.targetPlayerId, nextUses);
  }
  const remainingHearts = pending.heartIndexes.length - usedIndexes.size;
  if (actor.tokyoZone && (allocation.poisonTokensToRemove || allocation.shrinkTokensToRemove)) {
    return fail('Tokyo monsters cannot remove tokens with Hearts');
  }
  if (allocation.poisonTokensToRemove > actor.poisonTokens ||
      allocation.shrinkTokensToRemove > actor.shrinkTokens ||
      allocation.poisonTokensToRemove + allocation.shrinkTokensToRemove > remainingHearts) {
    return fail('Token removals exceed available tokens or Hearts');
  }
  return OK;
}

function resolveHeartCategory(
  state: KingOfTokyoServerState,
  pending: PendingHeartAllocation,
  allocation: KingOfTokyoHeartAllocation,
): void {
  const actor = currentPlayer(state);
  const rayHealingByTarget = new Map<string, number>();
  for (const use of [...allocation.healingRayUses].sort((left, right) => left.dieIndex - right.dieIndex)) {
    rayHealingByTarget.set(use.targetPlayerId, (rayHealingByTarget.get(use.targetPlayerId) ?? 0) + 1);
  }
  for (const [targetId, amount] of rayHealingByTarget) {
    const target = state.players.get(targetId)!;
    const payment = Math.min(2 * amount, target.energy); target.energy -= payment; actor.energy += payment;
    healPlayer(state, target, amount, 'Healing Ray');
    addLog(state, `${target.displayName} paid ${payment} energy to ${actor.displayName}.`);
  }
  let remaining = pending.heartIndexes.length - allocation.healingRayUses.length;
  actor.poisonTokens -= allocation.poisonTokensToRemove;
  actor.shrinkTokens -= allocation.shrinkTokensToRemove;
  remaining -= allocation.poisonTokensToRemove + allocation.shrinkTokensToRemove;
  if (allocation.poisonTokensToRemove) addLog(state, `${actor.displayName} spent ${allocation.poisonTokensToRemove} Heart${allocation.poisonTokensToRemove === 1 ? '' : 's'} removing Poison.`);
  if (allocation.shrinkTokensToRemove) addLog(state, `${actor.displayName} spent ${allocation.shrinkTokensToRemove} Heart${allocation.shrinkTokensToRemove === 1 ? '' : 's'} removing Shrink.`);
  if (!actor.tokyoZone) {
    if (remaining) healPlayer(state, actor, remaining, 'dice');
  } else if (remaining) addLog(state, `${actor.displayName} cannot use remaining rolled Hearts on themself while in Tokyo.`);
}

function beginHeartCategory(state: KingOfTokyoServerState): boolean {
  const actor = currentPlayer(state);
  const pending: PendingHeartAllocation = {
    playerId: actor.playerId,
    heartIndexes: state.dice.flatMap((die, index) => die.face === 'heart' ? [index] : []),
    healingRayAvailable: effectCount(state, actor, 'healing_ray') > 0,
  };
  if (!pending.heartIndexes.length) return false;
  const hasHealingRayChoice = healingRayTargetPlayerIds(state, pending).length > 0;
  const hasTokenChoice = !actor.tokyoZone && (actor.poisonTokens > 0 || actor.shrinkTokens > 0);
  if (!hasHealingRayChoice && !hasTokenChoice) {
    resolveHeartCategory(state, pending, {
      healingRayUses: [],
      poisonTokensToRemove: 0,
      shrinkTokensToRemove: 0,
    });
    return false;
  }
  state.pendingHeartAllocation = pending;
  state.phase = 'awaiting_heart_allocation';
  addLog(state, `${actor.displayName} must allocate the rolled Hearts using the current table state.`);
  return true;
}

function reconcilePendingHeartAllocation(state: KingOfTokyoServerState, rng: RandomSource): void {
  const pending = state.pendingHeartAllocation;
  if (state.phase !== 'awaiting_heart_allocation' || !pending) return;
  const actor = state.players.get(pending.playerId);
  if (!actor || actor.eliminated || currentPlayerId(state) !== pending.playerId) return;
  const hasHealingRayChoice = healingRayTargetPlayerIds(state, pending).length > 0;
  const hasTokenChoice = !actor.tokyoZone && (actor.poisonTokens > 0 || actor.shrinkTokens > 0);
  if (hasHealingRayChoice || hasTokenChoice) return;
  state.pendingHeartAllocation = null;
  state.phase = 'awaiting_dice_resolution';
  resolveHeartCategory(state, pending, {
    healingRayUses: [],
    poisonTokensToRemove: 0,
    shrinkTokensToRemove: 0,
  });
  continueDiceResolution(state, rng);
}

function continueDiceResolution(state: KingOfTokyoServerState, rng: RandomSource): void {
  const pending = state.pendingDiceResolution; if (!pending) return;
  while (pending.remainingCategories.length && state.status === 'playing') {
    const category = pending.remainingCategories.shift()!;
    const actor = currentPlayer(state);
    if (category === 'points') {
      scoreNumberDice(state, actor);
      queueFreezeTimeDecisions(state, actor);
      if (state.pendingFreezeTimeDecisions.length) return;
    }
    else if (category === 'energy') {
      const energy = countFace(state, 'energy'); if (energy) gainEnergy(state, actor, energy);
    } else if (category === 'hearts') {
      if (beginHeartCategory(state)) return;
    }
    else {
      resolveSmashCategory(state, rng);
      return;
    }
    if (state.pendingTokyoDecisions.length || state.pendingDamageWorkflow || state.resolutionTasks.length) return;
  }
  if (state.status === 'playing') finishDiceResolution(state, rng);
}
function validateDiceResolutionPlan(plan: KingOfTokyoDiceResolutionPlan): EngineResult {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return fail('Invalid dice-resolution plan');
  const keys = Object.keys(plan).sort();
  if (keys.join('|') !== 'resolutionOrder') {
    return fail('Invalid dice-resolution plan');
  }
  const categories = ['points', 'energy', 'hearts', 'smash'];
  if (!Array.isArray(plan.resolutionOrder) || plan.resolutionOrder.length !== categories.length ||
      new Set(plan.resolutionOrder).size !== categories.length || plan.resolutionOrder.some((category) => !categories.includes(category))) {
    return fail('Resolution order must contain every result category exactly once');
  }
  return OK;
}

export function prepareDiceResolution(
  state: KingOfTokyoServerState, playerId: string, expectedRevision: number,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (currentPlayerId(state) !== playerId) return fail('It is not your turn');
  if (state.phase !== 'choosing_dice' || !state.rollCount) return fail('Roll the dice before resolving them');
  if (state.dice.some((die) => die.face === null)) return fail('Every die must have a face');
  const clockwiseOrder = Array.from(
    { length: state.turnOrder.length - 1 },
    (_, index) => state.turnOrder[(state.currentTurnIndex + index + 1) % state.turnOrder.length],
  );
  state.pendingPsychicProbes = clockwiseOrder.flatMap((id) => {
    const player = state.players.get(id)!;
    return !player.eliminated
      ? effectCards(state, player, 'psychic_probe').map((card) => ({ playerId: id, cardInstanceId: card.instanceId }))
      : [];
  });
  if (state.pendingPsychicProbes.length) {
    state.phase = 'awaiting_psychic_probe';
    addLog(state, `${state.players.get(state.pendingPsychicProbes[0].playerId)!.displayName} may use Psychic Probe.`);
  } else state.phase = 'awaiting_dice_resolution';
  return commit(state);
}
export function resolveDiceResults(
  state: KingOfTokyoServerState, playerId: string, plan: KingOfTokyoDiceResolutionPlan,
  expectedRevision: number, rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (state.phase !== 'awaiting_dice_resolution' || currentPlayerId(state) !== playerId) return fail('Dice results are not waiting for you');
  const validated = validateDiceResolutionPlan(plan); if (!validated.ok) return validated;
  state.pendingDiceResolution = {
    playerId,
    remainingCategories: [...plan.resolutionOrder],
  };
  continueDiceResolution(state, rng);
  return commit(state);
}

export function decideHeartAllocation(
  state: KingOfTokyoServerState,
  playerId: string,
  allocation: KingOfTokyoHeartAllocation,
  expectedRevision: number,
  rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  const pending = state.pendingHeartAllocation;
  if (state.phase !== 'awaiting_heart_allocation' || pending?.playerId !== playerId ||
      currentPlayerId(state) !== playerId) {
    return fail('No Heart allocation is waiting for you');
  }
  const validated = validateHeartAllocation(state, pending, allocation); if (!validated.ok) return validated;
  state.pendingHeartAllocation = null;
  state.phase = 'awaiting_dice_resolution';
  resolveHeartCategory(state, pending, allocation);
  continueDiceResolution(state, rng);
  runResolutionTasks(state, rng);
  return commit(state);
}
export function decidePsychicProbe(
  state: KingOfTokyoServerState, playerId: string, dieIndex: number | null,
  rng: RandomSource = Math.random, expectedRevision: number,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  const pending = state.pendingPsychicProbes[0];
  if (state.phase !== 'awaiting_psychic_probe' || pending?.playerId !== playerId) return fail('No Psychic Probe decision is waiting for you');
  const player = state.players.get(playerId)!;
  if (dieIndex !== null) {
    if (!Number.isInteger(dieIndex) || dieIndex < 0 || dieIndex >= state.dice.length) return fail('Invalid die index');
    const card = player.powerCards.find((candidate) => candidate.instanceId === pending.cardInstanceId && effectiveCardId(state, candidate) === 'psychic_probe');
    if (!card) return fail('Psychic Probe is no longer available');
    const face = rollFace(rng); state.dice[dieIndex] = { face, kept: true };
    addLog(state, `${player.displayName} used Psychic Probe on die ${dieIndex + 1}.`);
    if (face === 'heart') {
      discardOwnedCard(state, player, card.instanceId, rng);
      addLog(state, `${player.displayName} discarded Psychic Probe after rolling a Heart.`);
    }
  } else addLog(state, `${player.displayName} passed on Psychic Probe.`);
  state.pendingPsychicProbes = state.pendingPsychicProbes.filter((candidate) =>
    candidate.playerId !== pending.playerId || candidate.cardInstanceId !== pending.cardInstanceId);
  if (!state.pendingPsychicProbes.length) state.phase = 'awaiting_dice_resolution';
  else addLog(state, `${state.players.get(state.pendingPsychicProbes[0].playerId)!.displayName} may use Psychic Probe.`);
  return commit(state);
}
function finishTokyoYieldAfterEvenBigger(
  state: KingOfTokyoServerState,
  playerId: string,
  rng: RandomSource,
): void {
  const player = state.players.get(playerId);
  const actor = state.phase === 'determining_first_player' ? null : currentPlayer(state);
  if (player && !player.eliminated && player.tokyoZone && actor && state.status === 'playing') {
    const zone = queueTokyoYieldForEntrant(state, player, actor)!;
    addLog(state, `${player.displayName} yielded ${zone === 'tokyo_bay' ? 'Tokyo Bay' : 'Tokyo City'}.`);
  }
  if (!state.pendingTokyoDecisions.length && state.status === 'playing') {
    state.resolutionTasks.unshift({ kind: 'continue_fire' }, { kind: 'resume_dice_after_smash' });
    runResolutionTasks(state, rng);
  }
}
export function decideTokyoYield(
  state: KingOfTokyoServerState, playerId: string, yieldTokyo: boolean,
  expectedRevision: number, rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (state.phase !== 'awaiting_tokyo_decision' || state.pendingTokyoDecisions[0] !== playerId) return fail('No Tokyo decision is waiting for you');
  if (typeof yieldTokyo !== 'boolean') return fail('Tokyo decision must be a boolean');
  const player = state.players.get(playerId)!;
  const pendingDamage = state.pendingTokyoDamage.get(playerId);
  state.pendingTokyoDamage.delete(playerId);
  state.pendingTokyoDecisions.shift();
  if (yieldTokyo) {
    if (pendingDamage) addLog(state, `${player.displayName}'s Jets prevented ${pendingDamage.amount} Smash damage when yielding.`);
    if (pendingDamage && queueDeferredEvenBiggerLoss(state, player, pendingDamage, false)) {
      queueAfterEvenBiggerLosses(state, {
        kind: 'complete_tokyo_yield_after_even_bigger',
        playerId: player.playerId,
      });
      runResolutionTasks(state, rng);
      return commit(state);
    }
    finishTokyoYieldAfterEvenBigger(state, player.playerId, rng);
    return commit(state);
  } else {
    if (pendingDamage) {
      const actor = currentPlayer(state);
      beginDamageWorkflow(
        state,
        [player],
        pendingDamage.amount,
        actor.playerId,
        'smash',
        rng,
        [
          { kind: 'complete_tokyo_smash', playerId: player.playerId, pendingDamage, mode: 'stay' },
          { kind: 'resume_tokyo_queue' },
        ],
        new Map([[player.playerId, pendingDamage.smashEntitlements]]),
        pendingDamage.deathWatcherEntitlements,
        false,
        true,
      );
      return commit(state);
    }
    if (!player.eliminated) addLog(state, `${player.displayName} stayed in Tokyo.`);
  }
  if (!state.pendingTokyoDecisions.length && state.status === 'playing') {
    state.resolutionTasks.unshift({ kind: 'continue_fire' }, { kind: 'resume_dice_after_smash' });
    runResolutionTasks(state, rng);
  }
  return commit(state);
}

export function decideFreezeTime(
  state: KingOfTokyoServerState,
  playerId: string,
  acceptExtraTurn: boolean,
  expectedRevision: number,
  rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  const pending = state.pendingFreezeTimeDecisions[0];
  if (state.phase !== 'awaiting_freeze_time' || pending?.playerId !== playerId) {
    return fail('No Freeze Time decision is waiting for you');
  }
  if (typeof acceptExtraTurn !== 'boolean') return fail('Freeze Time decision must be a boolean');
  state.pendingFreezeTimeDecisions.shift();
  const player = state.players.get(playerId)!;
  if (acceptExtraTurn) {
    state.queuedExtraTurns.push({ playerId, dicePenalty: pending.dicePenalty, source: 'Freeze Time' });
    addLog(state, `${player.displayName} accepted a Freeze Time extra turn with ${pending.dicePenalty} fewer ${pending.dicePenalty === 1 ? 'die' : 'dice'}.`);
  } else {
    addLog(state, `${player.displayName} declined a Freeze Time extra turn.`);
  }
  if (state.pendingFreezeTimeDecisions.length) {
    addLog(state, `${player.displayName} has another separate Freeze Time choice.`);
  } else {
    state.phase = 'awaiting_dice_resolution';
    continueDiceResolution(state, rng);
  }
  return commit(state);
}

function advanceIfCurrentPlayerEliminated(state: KingOfTokyoServerState): boolean {
  if (state.status !== 'playing' || !currentPlayer(state).eliminated) return false;
  if (hasCommittedResolution(state)) return false;
  const actorId = currentPlayerId(state);
  state.pendingPsychicProbes = [];
  state.pendingDiceResolution = null;
  state.pendingHeartAllocation = null;
  state.pendingSmashAftermath = null;
  state.pendingTokyoDecisions = [];
  state.pendingTokyoDamage.clear();
  clearPendingBurrowingYields(state, actorId);
  state.pendingDeathFromAbove = null;
  state.pendingFreezeTimeDecisions = [];
  state.pendingOpportunist = null;
  state.opportunistRevealQueue = [];
  state.pendingEndTurnEffects = [];
  state.queuedExtraTurns = state.queuedExtraTurns.filter((turn) => turn.playerId !== actorId);
  addLog(state, `The active monster was eliminated; their turn ended immediately.`);
  if (checkLastMonsterStanding(state)) return true;
  advanceToNextTurn(state);
  return true;
}
export function chooseDeathFromAboveTarget(
  state: KingOfTokyoServerState,
  playerId: string,
  targetPlayerId: string,
  expectedRevision: number,
  rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  const pending = state.pendingDeathFromAbove;
  if (state.phase !== 'awaiting_death_from_above' || pending?.playerId !== playerId) {
    return fail('No Death from Above choice is waiting for you');
  }
  if (typeof targetPlayerId !== 'string' || !pending.targetPlayerIds.includes(targetPlayerId)) {
    return fail('Choose one of the monsters currently in Tokyo');
  }
  const target = state.players.get(targetPlayerId);
  if (!target || target.eliminated || !target.tokyoZone) return fail('That monster is no longer in Tokyo');
  completeDeathFromAboveChoice(state, target, rng);
  return commit(state);
}
export function buyPowerCard(
  state: KingOfTokyoServerState, playerId: string, marketIndex: number,
  expectedRevision: number, rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (hasPendingInitialMimic(state)) return fail('Choose the newly bought Mimic power first');
  if (state.phase !== 'buying_cards' || currentPlayerId(state) !== playerId) return fail('You can only buy market cards during your buy phase');
  if (!Number.isInteger(marketIndex) || marketIndex < 0 || marketIndex >= 3) return fail('Invalid market slot');
  const card = state.market[marketIndex]; if (!card) return fail('That market slot is empty');
  const previousPhase = state.phase;
  const buyer = state.players.get(playerId)!; const acquired = acquirePowerCard(state, buyer, card, rng);
  if (!acquired.ok) return acquired;
  state.market[marketIndex] = null; state.purchasesThisTurn += 1;
  if (state.status === 'playing') {
    fillMarketSlot(state, marketIndex, true, rng);
    if (state.pendingDamageWorkflow || state.resolutionTasks.length) {
      state.resolutionTasks.push({ kind: 'resume_purchase', mode: 'market', buyerId: playerId, previousPhase });
    } else if (!advanceIfCurrentPlayerEliminated(state)) advanceOpportunistWindow(state);
  }
  return commit(state);
}
export function sweepPowerCards(
  state: KingOfTokyoServerState, playerId: string, expectedRevision: number,
  rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (hasPendingInitialMimic(state)) return fail('Choose the newly bought Mimic power first');
  if (state.phase !== 'buying_cards' || currentPlayerId(state) !== playerId) return fail('You can only sweep during your buy phase');
  const player = state.players.get(playerId)!; if (player.energy < 2) return fail('A market sweep costs 2 energy');
  player.energy -= 2;
  for (let index = 0; index < 3; index += 1) {
    if (state.market[index]) state.discardPile.push(state.market[index]!);
    state.market[index] = null;
  }
  for (let index = 0; index < 3; index += 1) fillMarketSlot(state, index, true, rng);
  addLog(state, `${player.displayName} spent 2 energy to sweep the market.`);
  advanceOpportunistWindow(state); return commit(state);
}
export function decideOpportunist(
  state: KingOfTokyoServerState, playerId: string, buy: boolean,
  expectedRevision: number, rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (hasPendingInitialMimic(state)) return fail('Choose the newly bought Mimic power first');
  const window = state.pendingOpportunist;
  if (state.phase !== 'awaiting_opportunist' || !window || window.playerIds[0] !== playerId) return fail('No Opportunist decision is waiting for you');
  if (typeof buy !== 'boolean') return fail('Opportunist decision must be a boolean');
  const marketIndex = state.market.findIndex((card) => card?.instanceId === window.cardInstanceId);
  if (buy && marketIndex >= 0) {
    const previousPhase = state.phase;
    const buyer = state.players.get(playerId)!; const card = state.market[marketIndex]!;
    const acquired = acquirePowerCard(state, buyer, card, rng); if (!acquired.ok) return acquired;
    state.market[marketIndex] = null; fillMarketSlot(state, marketIndex, true, rng);
    addLog(state, `${buyer.displayName} seized the opportunity.`);
    state.pendingOpportunist = null;
    if (state.pendingDamageWorkflow || state.resolutionTasks.length) {
      state.resolutionTasks.push({ kind: 'resume_purchase', mode: 'opportunist', buyerId: playerId, previousPhase });
    } else if (state.status === 'playing' && !advanceIfCurrentPlayerEliminated(state)) advanceOpportunistWindow(state);
  } else {
    window.playerIds.shift();
    if (!window.playerIds.length) advanceOpportunistWindow(state);
    else addLog(state, `${state.players.get(window.playerIds[0])!.displayName} may buy the revealed card.`);
  }
  return commit(state);
}
export function buyLabCard(
  state: KingOfTokyoServerState, playerId: string, expectedRevision: number,
  rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (hasPendingInitialMimic(state)) return fail('Choose the newly bought Mimic power first');
  if (state.phase !== 'buying_cards' || currentPlayerId(state) !== playerId || state.labOffersRemaining <= 0) return fail('Made in a Lab has no card available now');
  const previousPhase = state.phase;
  const card = state.deck[0]; if (!card) return fail('No inspected Lab card is available');
  const buyer = state.players.get(playerId)!; const acquired = acquirePowerCard(state, buyer, card, rng);
  if (!acquired.ok) return acquired;
  state.deck.shift(); state.labOffersRemaining = Math.max(0, state.labOffersRemaining - 1); state.purchasesThisTurn += 1;
  if (state.labOffersRemaining > 0) refillDeckIfNeeded(state, rng);
  if (state.pendingDamageWorkflow || state.resolutionTasks.length) {
    state.resolutionTasks.push({ kind: 'resume_purchase', mode: 'lab', buyerId: playerId, previousPhase });
  } else advanceIfCurrentPlayerEliminated(state);
  return commit(state);
}
export function buyOwnedPowerCard(
  state: KingOfTokyoServerState, playerId: string, ownerPlayerId: string,
  cardInstanceId: string, expectedRevision: number, rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (hasPendingInitialMimic(state)) return fail('Choose the newly bought Mimic power first');
  if (state.phase !== 'buying_cards' || currentPlayerId(state) !== playerId) return fail('You can only buy another monster’s card in your buy phase');
  const buyer = state.players.get(playerId)!;
  if (!effectCount(state, buyer, 'parasitic_tentacles')) return fail('You do not have Parasitic Tentacles');
  const owner = state.players.get(ownerPlayerId);
  if (!owner || owner.eliminated || owner.playerId === buyer.playerId) return fail('Invalid card owner');
  const card = owner.powerCards.find((candidate) => candidate.instanceId === cardInstanceId);
  if (!card) return fail('That card is no longer available');
  const cost = effectiveCost(state, buyer, card.cardId); if (buyer.energy < cost) return fail(`Need ${cost} energy`);
  const mediaFriendly = effectCount(state, buyer, 'media_friendly');
  const labCopiesBefore = effectCount(state, buyer, 'made_in_a_lab');
  buyer.energy -= cost; owner.energy += cost;
  mutatePowerCardTopology(state, rng, () => {
    owner.powerCards = owner.powerCards.filter((candidate) => candidate.instanceId !== card.instanceId);
    buyer.powerCards.push(card);
  });
  addLog(state, `${buyer.displayName} bought ${KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].name} from ${owner.displayName}.`);
  if (mediaFriendly) {
    buyer.victoryPoints += mediaFriendly;
    addLog(state, `${buyer.displayName} gained ${mediaFriendly} victory point${mediaFriendly === 1 ? '' : 's'} from Media Friendly.`);
  }
  state.labOffersRemaining += Math.max(0, effectCount(state, buyer, 'made_in_a_lab') - labCopiesBefore);
  if (state.labOffersRemaining > 0) refillDeckIfNeeded(state, rng);
  state.purchasesThisTurn += 1;
  runResolutionTasks(state, rng);
  return commit(state);
}
export function sellOwnedPowerCard(
  state: KingOfTokyoServerState, playerId: string, cardInstanceId: string, expectedRevision: number,
  rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (hasPendingInitialMimic(state)) return fail('Choose the newly bought Mimic power first');
  if (state.phase !== 'selling_cards' || currentPlayerId(state) !== playerId) return fail('Keep cards can only be sold during a Metamorph end-turn window');
  const player = state.players.get(playerId)!;
  const card = player.powerCards.find((candidate) => candidate.instanceId === cardInstanceId);
  if (!card) return fail('You do not own that card');
  if (state.usedThisTurn.has(`mimic_initial:${card.instanceId}`)) return fail('Choose the Mimic power before selling cards');
  const value = KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].cost;
  const pendingLossCount = state.pendingEvenBiggerLosses.length;
  beginCardTopologyFatalResolution(state, rng);
  try {
    discardOwnedCard(state, player, card.instanceId, rng);
  } finally {
    endCardTopologyFatalResolution(state);
  }
  const completion: Extract<ResolutionTask, { kind: 'complete_power_sale' }> = {
    kind: 'complete_power_sale',
    playerId: player.playerId,
    cardId: card.cardId,
    value,
  };
  if (state.pendingEvenBiggerLosses.length > pendingLossCount) {
    queueAfterEvenBiggerLosses(state, completion);
    runResolutionTasks(state, rng);
  } else {
    completePowerSale(state, completion);
  }
  return commit(state);
}
export function usePowerCard(
  state: KingOfTokyoServerState, playerId: string, cardInstanceId: string,
  options: { dieIndex?: number; face?: KingOfTokyoDieFace; targetPlayerId?: string; targetCardInstanceId?: string } = {},
  expectedRevision: number, rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (!options || typeof options !== 'object' || Array.isArray(options)) return fail('Invalid Power-card options');
  const player = state.players.get(playerId)!;
  const card = player.powerCards.find((candidate) => candidate.instanceId === cardInstanceId);
  if (!card) return fail('You do not own that card');
  const cardId = effectiveCardId(state, card);
  if (!cardId && card.cardId !== 'mimic') return fail('That power is inactive');
  const optionKeys = Object.keys(options).sort();
  const hasExactly = (...keys: string[]) => optionKeys.join('|') === [...keys].sort().join('|');

  if (cardId === 'rapid_healing') {
    if (!hasExactly()) return fail('Rapid Healing does not take options');
    if (state.pendingDamageWorkflow || state.pendingDefenseDecision) {
      return fail('Resolve the current defence decision before using Rapid Healing');
    }
    if (player.energy < 2 || player.health >= player.maxHealth) return fail('Rapid Healing needs 2 energy and missing health');
    player.energy -= 2;
    healPlayer(state, player, 1, 'Rapid Healing');
    resumePendingOpportunistWindow(state);
    return commit(state);
  }
  if (card.cardId === 'mimic' && options.targetCardInstanceId) {
    if (!hasExactly('targetCardInstanceId') || typeof options.targetCardInstanceId !== 'string' || !options.targetCardInstanceId.trim()) {
      return fail('Mimic requires only a target Keep card');
    }
    const initialTarget = state.usedThisTurn.has(`mimic_initial:${card.instanceId}`);
    if (initialTarget) {
      if (state.phase !== 'buying_cards' && state.phase !== 'awaiting_opportunist') return fail('A newly bought Mimic must be targeted immediately');
    } else if (currentPlayerId(state) !== playerId || state.phase !== 'awaiting_roll') {
      return fail('Mimic can only be moved at the start of your turn');
    }
    if (!initialTarget && state.usedThisTurn.has(`mimic_retarget:${card.instanceId}`)) {
      return fail('Mimic can only be retargeted once at the start of your turn');
    }
    const target = findOwnedCard(state, options.targetCardInstanceId);
    if (!target || target.card.cardId === 'mimic' || target.card.instanceId === card.instanceId) return fail('Choose a non-Mimic Keep card');
    if (card.mimicTargetInstanceId === target.card.instanceId && effectiveCardId(state, card)) {
      return fail('Mimic must move to a different Keep card');
    }
    if (!initialTarget) {
      if (player.energy < 1) return fail('Retargeting Mimic costs 1 energy at the start of your turn');
      player.energy -= 1;
    }
    const pendingLossCount = state.pendingEvenBiggerLosses.length;
    mutatePowerCardTopology(state, rng, () => {
      card.mimicTargetInstanceId = target.card.instanceId;
      state.usedThisTurn.delete(`mimic_initial:${card.instanceId}`);
      if (!initialTarget) state.usedThisTurn.add(`mimic_retarget:${card.instanceId}`);
      const newEffective = effectiveCardId(state, card);
      card.counters = newEffective === 'battery_monster' ? 6 : newEffective === 'smoke_cloud' ? 3 : 0;
      if (initialTarget && newEffective === 'made_in_a_lab' && currentPlayerId(state) === playerId) {
        state.labOffersRemaining += 1;
        refillDeckIfNeeded(state, rng);
      }
      addLog(state, `${player.displayName}'s Mimic copied ${KING_OF_TOKYO_POWER_CARD_BY_ID[target.card.cardId].name}.`);
    });
    const completion: Extract<ResolutionTask, { kind: 'complete_mimic_retarget' }> = {
      kind: 'complete_mimic_retarget',
      playerId: player.playerId,
      initialTarget,
    };
    if (state.pendingEvenBiggerLosses.length > pendingLossCount) {
      queueAfterEvenBiggerLosses(state, completion);
      runResolutionTasks(state, rng);
    } else {
      completeMimicRetarget(state, completion);
    }
    return commit(state);
  }

  if (currentPlayerId(state) !== playerId) return fail('That power can only be used on your turn');

  if (state.phase !== 'choosing_dice' || !state.rollCount) return fail('That power requires rolled dice');
  if (options.dieIndex != null && (!Number.isInteger(options.dieIndex) || options.dieIndex < 0 || options.dieIndex >= state.dice.length)) return fail('Invalid die index');
  switch (cardId) {
    case 'energy_drink':
      if (!hasExactly()) return fail('Energy Drink does not take options');
      if (player.energy < 1) return fail('Energy Drink costs 1 energy');
      player.energy -= 1; state.maxRolls += 1;
      addLog(state, `${player.displayName} bought an extra reroll with Energy Drink.`); break;
    case 'smoke_cloud':
      if (!hasExactly()) return fail('Smoke Cloud does not take options');
      if (card.counters <= 0) return fail('Smoke Cloud has no counters');
      card.counters -= 1; state.maxRolls += 1;
      addLog(state, `${player.displayName} spent a Smoke counter for an extra reroll.`);
      if (!card.counters) discardOwnedCard(state, player, card.instanceId, rng);
      break;
    case 'background_dweller':
      if (!hasExactly('dieIndex')) return fail('Background Dweller requires only a die index');
      if (options.dieIndex == null || state.dice[options.dieIndex].face !== 3) return fail('Choose a die showing 3');
      state.dice[options.dieIndex] = { face: rollFace(rng), kept: false };
      addLog(state, `${player.displayName} rerolled a 3 with Background Dweller.`); break;
    case 'herd_culler':
      if (!hasExactly('dieIndex')) return fail('Herd Culler requires only a die index');
      if (state.usedThisTurn.has(card.instanceId)) return fail('Herd Culler was already used this turn');
      if (options.dieIndex == null) return fail('Choose a die');
      state.dice[options.dieIndex].face = 1; state.usedThisTurn.add(card.instanceId);
      addLog(state, `${player.displayName} changed a die to 1 with Herd Culler.`); break;
    case 'plot_twist':
      if (!hasExactly('dieIndex', 'face') || !KING_OF_TOKYO_DIE_FACES.includes(options.face as KingOfTokyoDieFace)) return fail('Plot Twist requires one die and a valid face');
      if (options.dieIndex == null || options.face == null) return fail('Choose a die and face');
      state.dice[options.dieIndex].face = options.face; discardOwnedCard(state, player, card.instanceId, rng);
      addLog(state, `${player.displayName} used Plot Twist.`); break;
    case 'stretchy':
      if (!hasExactly('dieIndex', 'face') || !KING_OF_TOKYO_DIE_FACES.includes(options.face as KingOfTokyoDieFace)) return fail('Stretchy requires one die and a valid face');
      if (player.energy < 2) return fail('Stretchy costs 2 energy');
      if (options.dieIndex == null || options.face == null) return fail('Choose a die and face');
      player.energy -= 2; state.dice[options.dieIndex].face = options.face;
      addLog(state, `${player.displayName} spent 2 energy to stretch a die.`); break;
    case 'healing_ray': return fail('Choose Healing Ray targets while ordering final dice results');
    default: return fail('That power is automatic or has no manual activation');
  }
  return commit(state);
}

export function updatePreferences(
  state: KingOfTokyoServerState, playerId: string,
  preferences: {
    defenseMode?: KingOfTokyoDefenseMode;
    rapidHealingMode?: KingOfTokyoDefenseMode;
    tokenPreference?: KingOfTokyoTokenPreference;
  },
  expectedRevision: number,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return fail('Invalid preferences');
  const keys = Object.keys(preferences);
  if (!keys.length || keys.some((key) => !['defenseMode', 'rapidHealingMode', 'tokenPreference'].includes(key))) return fail('Invalid preferences');
  const defenseModes: KingOfTokyoDefenseMode[] = ['off', 'lethal', 'always'];
  const tokenPreferences: KingOfTokyoTokenPreference[] = ['poison', 'shrink'];
  if ('defenseMode' in preferences && !defenseModes.includes(preferences.defenseMode as KingOfTokyoDefenseMode)) return fail('Invalid Wings preference');
  if ('rapidHealingMode' in preferences && !defenseModes.includes(preferences.rapidHealingMode as KingOfTokyoDefenseMode)) return fail('Invalid Rapid Healing preference');
  if ('tokenPreference' in preferences && !tokenPreferences.includes(preferences.tokenPreference as KingOfTokyoTokenPreference)) return fail('Invalid token preference');
  const player = state.players.get(playerId)!;
  const changed =
    (preferences.defenseMode !== undefined && preferences.defenseMode !== player.defenseMode) ||
    (preferences.rapidHealingMode !== undefined && preferences.rapidHealingMode !== player.rapidHealingMode) ||
    (preferences.tokenPreference !== undefined && preferences.tokenPreference !== player.tokenPreference);
  if (!changed) return OK;
  if (preferences.defenseMode) player.defenseMode = preferences.defenseMode;
  if (preferences.rapidHealingMode) player.rapidHealingMode = preferences.rapidHealingMode;
  if (preferences.tokenPreference) player.tokenPreference = preferences.tokenPreference;
  return commit(state);
}
function advanceToNextTurn(state: KingOfTokyoServerState): void {
  if (state.status !== 'playing') return;
  const actorId = currentPlayerId(state);
  while (state.queuedExtraTurns.length && state.players.get(state.queuedExtraTurns[0].playerId)?.eliminated) {
    state.queuedExtraTurns.shift();
  }
  const extra = state.queuedExtraTurns.shift();
  if (extra) {
    if (state.resumeAfterExtraTurnsPlayerId === null) state.resumeAfterExtraTurnsPlayerId = actorId;
    state.currentTurnIndex = state.turnOrder.indexOf(extra.playerId);
    state.currentTurnDicePenalty = extra.dicePenalty;
    addLog(state, `${state.players.get(extra.playerId)!.displayName} takes an extra turn from ${extra.source}.`);
    beginTurn(state); return;
  }
  let next = state.resumeAfterExtraTurnsPlayerId === null
    ? state.currentTurnIndex
    : state.turnOrder.indexOf(state.resumeAfterExtraTurnsPlayerId);
  state.resumeAfterExtraTurnsPlayerId = null;
  do next = (next + 1) % state.turnOrder.length;
  while (state.players.get(state.turnOrder[next])!.eliminated);
  state.currentTurnIndex = next; state.currentTurnDicePenalty = 0; beginTurn(state);
}
function collectEndTurnEffects(state: KingOfTokyoServerState, player: KingOfTokyoPlayer): KingOfTokyoEndTurnEffect[] {
  const effects: KingOfTokyoEndTurnEffect[] = [];
  const add = (kind: KingOfTokyoEndTurnEffect['kind'], copies: number) => {
    if (copies > 0) effects.push({ effectId: kind, kind, copies });
  };
  add('poison', player.poisonTokens ? 1 : 0);
  add('metamorph', effectCount(state, player, 'metamorph'));
  add('energy_hoarder', effectCount(state, player, 'energy_hoarder'));
  if (!state.turnDealtDamage) add('herbivore', effectCount(state, player, 'herbivore'));
  if (livingPlayers(state).every((candidate) =>
    candidate.playerId === player.playerId || player.victoryPoints < candidate.victoryPoints)) {
    add('rooting_for_underdog', effectCount(state, player, 'rooting_for_underdog'));
  }
  if (!player.energy) add('solar_powered', effectCount(state, player, 'solar_powered'));
  return effects;
}
function reconcilePendingEndTurnEffects(state: KingOfTokyoServerState, player: KingOfTokyoPlayer): boolean {
  let changed = false;
  state.pendingEndTurnEffects = state.pendingEndTurnEffects.flatMap((effect) => {
    if (effect.kind === 'poison') return [effect];
    const copies = Math.min(effect.copies, effectCount(state, player, effect.kind));
    if (copies !== effect.copies) changed = true;
    return copies > 0 ? [{ ...effect, copies }] : [];
  });
  return changed;
}
function applyEndTurnEffect(
  state: KingOfTokyoServerState, player: KingOfTokyoPlayer, effect: KingOfTokyoEndTurnEffect, rng: RandomSource,
): void {
  switch (effect.kind) {
    case 'poison':
      beginDamageWorkflow(state, [player], player.poisonTokens, player.playerId, 'poison', rng, [
        { kind: 'reconcile_jets' },
        { kind: 'normalize_tokyo' },
        { kind: 'complete_end_turn_damage', playerId: player.playerId },
      ]);
      break;
    case 'metamorph':
      state.phase = 'selling_cards';
      state.labOffersRemaining = 0;
      addLog(state, `${player.displayName} opened a Metamorph sales window.`);
      break;
    case 'energy_hoarder': {
      const points = Math.floor(player.energy / 6) * effect.copies;
      player.victoryPoints += points;
      addLog(state, `${player.displayName} gained ${points} victory point${points === 1 ? '' : 's'} from Energy Hoarder.`);
      break;
    }
    case 'herbivore':
      player.victoryPoints += effect.copies;
      addLog(state, `${player.displayName} gained ${effect.copies} victory point${effect.copies === 1 ? '' : 's'} from Herbivore.`);
      break;
    case 'rooting_for_underdog': {
      const soleLowest = livingPlayers(state).every((candidate) =>
        candidate.playerId === player.playerId || player.victoryPoints < candidate.victoryPoints);
      const points = soleLowest ? effect.copies : 0;
      player.victoryPoints += points;
      addLog(state, points
        ? `${player.displayName} gained ${points} victory point${points === 1 ? '' : 's'} from Rooting for the Underdog.`
        : `${player.displayName} no longer had the sole lowest score when Rooting for the Underdog resolved.`);
      break;
    }
    case 'solar_powered':
      if (!player.energy) {
        for (let copy = 0; copy < effect.copies; copy += 1) gainEnergy(state, player, 1);
      } else {
        addLog(state, `${player.displayName} no longer had zero energy when Solar Powered resolved.`);
      }
      break;
  }
}
function completeEndTurn(state: KingOfTokyoServerState, player: KingOfTokyoPlayer): void {
  state.pendingEndTurnEffects = [];
  if (state.status !== 'playing') return;
  if (!player.eliminated && checkVictoryPoints(state, player)) { finishGame(state, player, 'victory_points'); return; }
  if (checkLastMonsterStanding(state)) return;
  advanceToNextTurn(state);
}
function continueEndTurnEffects(
  state: KingOfTokyoServerState,
  player: KingOfTokyoPlayer,
  rng: RandomSource,
): void {
  if (!state.pendingEndTurnEffects.length) {
    completeEndTurn(state, player);
    return;
  }
  if (state.pendingEndTurnEffects.length === 1) {
    const effect = state.pendingEndTurnEffects.shift()!;
    applyEndTurnEffect(state, player, effect, rng);
    if (effect.kind !== 'metamorph' && effect.kind !== 'poison') completeEndTurn(state, player);
    return;
  }
  state.phase = 'resolving_end_turn';
  addLog(state, `${player.displayName} must choose the order of ${state.pendingEndTurnEffects.length} end-turn effects.`);
}
export function endTurn(
  state: KingOfTokyoServerState, playerId: string, expectedRevision: number,
  rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (currentPlayerId(state) !== playerId || (state.phase !== 'buying_cards' && state.phase !== 'selling_cards')) return fail('Resolve every phase before ending the turn');
  if ([...state.usedThisTurn].some((key) => key.startsWith('mimic_initial:'))) return fail('Choose the newly bought Mimic power before ending the turn');
  const player = state.players.get(playerId)!;
  if (state.phase === 'selling_cards') {
    reconcilePendingEndTurnEffects(state, player);
    addLog(state, `${player.displayName} finished Metamorph sales.`);
  } else {
    state.labOffersRemaining = 0;
    state.pendingEndTurnEffects = collectEndTurnEffects(state, player);
  }
  continueEndTurnEffects(state, player, rng);
  return commit(state);
}

export function resolveEndTurnEffect(
  state: KingOfTokyoServerState, playerId: string, effectId: KingOfTokyoEndTurnEffect['effectId'],
  expectedRevision: number, rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  if (state.phase !== 'resolving_end_turn' || currentPlayerId(state) !== playerId) return fail('No end-turn effect choice is waiting for you');
  const index = state.pendingEndTurnEffects.findIndex((effect) => effect.effectId === effectId);
  if (index < 0) return fail('That end-turn effect is not pending');
  const [effect] = state.pendingEndTurnEffects.splice(index, 1);
  const player = state.players.get(playerId)!;
  applyEndTurnEffect(state, player, effect, rng);
  if (effect.kind !== 'metamorph' && effect.kind !== 'poison' &&
      (state.status !== 'playing' || player.eliminated || !state.pendingEndTurnEffects.length)) {
    completeEndTurn(state, player);
  }
  return commit(state);
}

function defaultDiceResolutionPlan(): KingOfTokyoDiceResolutionPlan {
  return { resolutionOrder: ['points', 'energy', 'hearts', 'smash'] };
}

function defaultHeartAllocation(
  state: KingOfTokyoServerState,
  pending: PendingHeartAllocation,
): KingOfTokyoHeartAllocation {
  const actor = currentPlayer(state);
  let hearts = pending.heartIndexes.length;
  let poisonTokensToRemove = 0;
  let shrinkTokensToRemove = 0;
  if (!actor.tokyoZone) {
    if (actor.tokenPreference === 'poison') {
      poisonTokensToRemove = Math.min(actor.poisonTokens, hearts); hearts -= poisonTokensToRemove;
      shrinkTokensToRemove = Math.min(actor.shrinkTokens, hearts);
    } else {
      shrinkTokensToRemove = Math.min(actor.shrinkTokens, hearts); hearts -= shrinkTokensToRemove;
      poisonTokensToRemove = Math.min(actor.poisonTokens, hearts);
    }
  }
  return {
    healingRayUses: [],
    poisonTokensToRemove,
    shrinkTokensToRemove,
  };
}

export function resolveAbsentDecision(
  state: KingOfTokyoServerState,
  playerId: string,
  expectedRevision: number,
  rng: RandomSource = Math.random,
): EngineResult {
  const checked = checkAction(state, playerId, expectedRevision); if (!checked.ok) return checked;
  const pendingDefense = state.pendingDefenseDecision;
  if (state.phase === 'awaiting_defense_decision' && pendingDefense?.playerId === playerId) {
    const player = state.players.get(playerId)!;
    const healingNeeded = Math.max(0, pendingDefense.remainingDamage - player.health + 1);
    const activationsNeeded = Math.ceil(healingNeeded / (1 + effectCount(state, player, 'regeneration')));
    const fallback: KingOfTokyoDefenseDecision = pendingDefense.kind === 'camouflage'
      ? { kind: 'camouflage', changes: [] }
      : pendingDefense.kind === 'wings'
        ? { kind: 'wings', use: shouldDefend(player, pendingDefense.remainingDamage) }
        : {
            kind: 'rapid_healing',
            activations: player.rapidHealingMode === 'always'
              ? pendingDefense.maxActivations
              : player.rapidHealingMode === 'lethal'
                ? pendingDefense.maxActivations >= activationsNeeded
                  ? activationsNeeded
                  : 0
                : 0,
          };
    const result = applyDefenseDecision(state, playerId, fallback, rng); if (!result.ok) return result;
    return commit(state);
  }
  const pendingMimic = [...state.usedThisTurn]
    .find((key) => key.startsWith('mimic_initial:'))?.slice('mimic_initial:'.length);
  if (pendingMimic) {
    const owned = findOwnedCard(state, pendingMimic);
    if (owned?.player.playerId === playerId) {
      const target = [...state.players.values()]
        .filter((candidate) => !candidate.eliminated)
        .flatMap((candidate) => candidate.powerCards)
        .find((card) => card.cardId !== 'mimic');
      if (!target) {
        state.usedThisTurn.delete(`mimic_initial:${pendingMimic}`);
        addLog(state, `${owned.player.displayName}'s Mimic remained inactive because no Keep card was available.`);
        return commit(state);
      }
      return usePowerCard(state, playerId, pendingMimic, { targetCardInstanceId: target.instanceId }, expectedRevision, rng);
    }
  }
  switch (state.phase) {
    case 'determining_first_player':
      if (!state.startingRollContenders.includes(playerId) || state.startRolls.get(playerId) !== null) return fail('No roll-off decision is waiting for that player');
      return rollForFirstPlayer(state, playerId, rng, expectedRevision, state.rollOffRound);
    case 'awaiting_roll':
      if (currentPlayerId(state) !== playerId) return fail('No roll is waiting for that player');
      return rollDice(state, playerId, rng, expectedRevision);
    case 'choosing_dice':
      if (currentPlayerId(state) !== playerId) return fail('No dice decision is waiting for that player');
      return prepareDiceResolution(state, playerId, expectedRevision);
    case 'awaiting_psychic_probe':
      if (state.pendingPsychicProbes[0]?.playerId !== playerId) return fail('No Psychic Probe decision is waiting for that player');
      return decidePsychicProbe(state, playerId, null, rng, expectedRevision);
    case 'awaiting_dice_resolution':
      if (currentPlayerId(state) !== playerId) return fail('No dice resolution is waiting for that player');
      return resolveDiceResults(state, playerId, defaultDiceResolutionPlan(), expectedRevision, rng);
    case 'awaiting_heart_allocation': {
      const pending = state.pendingHeartAllocation;
      if (pending?.playerId !== playerId || currentPlayerId(state) !== playerId) {
        return fail('No Heart allocation is waiting for that player');
      }
      return decideHeartAllocation(
        state,
        playerId,
        defaultHeartAllocation(state, pending),
        expectedRevision,
        rng,
      );
    }
    case 'awaiting_defense_decision':
      return fail('No defence decision is waiting for that player');
    case 'awaiting_freeze_time':
      if (state.pendingFreezeTimeDecisions[0]?.playerId !== playerId) return fail('No Freeze Time decision is waiting for that player');
      return decideFreezeTime(state, playerId, false, expectedRevision, rng);
    case 'awaiting_tokyo_decision':
      if (state.pendingTokyoDecisions[0] !== playerId) return fail('No Tokyo decision is waiting for that player');
      return decideTokyoYield(state, playerId, false, expectedRevision, rng);
    case 'awaiting_death_from_above': {
      const pending = state.pendingDeathFromAbove;
      if (pending?.playerId !== playerId || !pending.targetPlayerIds[0]) {
        return fail('No Death from Above choice is waiting for that player');
      }
      return chooseDeathFromAboveTarget(state, playerId, pending.targetPlayerIds[0], expectedRevision, rng);
    }
    case 'awaiting_opportunist':
      if (state.pendingOpportunist?.playerIds[0] !== playerId) return fail('No Opportunist decision is waiting for that player');
      return decideOpportunist(state, playerId, false, expectedRevision, rng);
    case 'buying_cards':
    case 'selling_cards':
      if (currentPlayerId(state) !== playerId) return fail('No buy-step decision is waiting for that player');
      return endTurn(state, playerId, expectedRevision, rng);
    case 'resolving_end_turn':
      if (currentPlayerId(state) !== playerId || !state.pendingEndTurnEffects[0]) return fail('No end-turn decision is waiting for that player');
      return resolveEndTurnEffect(state, playerId, state.pendingEndTurnEffects[0].effectId, expectedRevision, rng);
    case 'game_over': return fail('The game is over');
  }
}

function finishForfeitResolution(
  state: KingOfTokyoServerState,
  playerId: string,
  wasCurrentPlayer: boolean,
  deathFromAboveOwnerId: string | null,
  rng: RandomSource,
): void {
  reconcilePendingJets(state, rng);
  if (state.pendingDamageWorkflow || state.pendingDefenseDecision) return;
  normalizeAndReconcileTokyoBay(state, rng);
  if (state.pendingDamageWorkflow || state.pendingDefenseDecision) return;
  resumeFreezeTimeAfterReconciliation(state, rng);
  if (deathFromAboveOwnerId === playerId) {
    state.pendingDeathFromAbove = null;
    state.pendingFreezeTimeDecisions = [];
    if (!wasCurrentPlayer) advanceOpportunistWindow(state);
  } else if (state.pendingDeathFromAbove) {
    reconcilePendingDeathFromAbove(state, rng);
    if (wasCurrentPlayer && (state.status !== 'playing' || currentPlayerId(state) !== playerId)) {
      return;
    }
  }

  if (state.phase === 'determining_first_player') {
    if (checkLastMonsterStanding(state)) return;
    settleStartingRolls(state);
  } else if ((wasCurrentPlayer || currentPlayer(state).eliminated) && !state.pendingDeathFromAbove &&
             !hasCommittedResolution(state)) {
    state.pendingPsychicProbes = [];
    state.pendingDiceResolution = null;
    state.pendingHeartAllocation = null;
    state.pendingSmashAftermath = null;
    state.pendingTokyoDecisions = [];
    state.pendingTokyoDamage.clear();
    clearPendingBurrowingYields(state);
    state.pendingDeathFromAbove = null;
    state.pendingOpportunist = null;
    state.opportunistRevealQueue = [];
    state.pendingEndTurnEffects = [];
    if (!checkLastMonsterStanding(state)) advanceToNextTurn(state);
  } else if (state.status === 'playing') {
    if (state.phase === 'awaiting_death_from_above') {
      reconcilePendingDeathFromAbove(state, rng);
    } else if (state.phase === 'resolving_end_turn') {
      const activePlayer = currentPlayer(state);
      const changed = reconcilePendingEndTurnEffects(state, activePlayer);
      if (changed && state.pendingEndTurnEffects.length <= 1) {
        continueEndTurnEffects(state, activePlayer, rng);
      }
    } else if (state.phase === 'selling_cards') {
      reconcilePendingEndTurnEffects(state, currentPlayer(state));
    } else if (state.phase === 'awaiting_psychic_probe' && !state.pendingPsychicProbes.length) {
      state.phase = 'awaiting_dice_resolution';
    } else if (state.phase === 'awaiting_heart_allocation') {
      reconcilePendingHeartAllocation(state, rng);
    } else if (state.phase === 'awaiting_tokyo_decision' && !state.pendingTokyoDecisions.length) {
      state.resolutionTasks.unshift({ kind: 'continue_fire' }, { kind: 'resume_dice_after_smash' });
      runResolutionTasks(state, rng);
    } else if (state.phase === 'awaiting_opportunist') {
      resumePendingOpportunistWindow(state);
    }
  }
  if (state.status === 'playing') checkLastMonsterStanding(state);
}

export function forfeitPlayer(
  state: KingOfTokyoServerState,
  playerId: string,
  expectedRevision: number,
  rng: RandomSource = Math.random,
): EngineResult {
  return forfeitPlayers(state, [playerId], expectedRevision, rng);
}

export function forfeitPlayers(
  state: KingOfTokyoServerState,
  playerIds: string[],
  expectedRevision: number,
  rng: RandomSource = Math.random,
): EngineResult {
  if (state.status !== 'playing') return fail('The game is over');
  const revision = checkRevision(state, expectedRevision); if (!revision.ok) return revision;
  if (!Array.isArray(playerIds) || playerIds.some((id) => typeof id !== 'string' || !state.players.has(id))) {
    return fail('Invalid forfeiting players');
  }
  const departingIds = new Set(playerIds.filter((id) => !state.players.get(id)!.eliminated));
  if (!departingIds.size) return OK;
  const actorId = currentPlayerId(state);
  const wasCurrentPlayer = state.phase !== 'determining_first_player' && departingIds.has(actorId);
  const deathFromAboveOwnerId = state.pendingDeathFromAbove?.playerId ?? null;
  const playerId = wasCurrentPlayer ? actorId
    : deathFromAboveOwnerId && departingIds.has(deathFromAboveOwnerId) ? deathFromAboveOwnerId
      : state.turnOrder.find((id) => departingIds.has(id))!;
  const interruptedDefense = Boolean(state.pendingDefenseDecision && departingIds.has(state.pendingDefenseDecision.playerId));
  // Remove the complete batch before reconciling copied powers or any winner.
  mutatePowerCardTopology(state, rng, () => {
    const removedCards = new Set<string>();
    for (const id of state.turnOrder.filter((candidate) => departingIds.has(candidate))) {
      const player = state.players.get(id)!;
      player.health = 0; player.eliminated = true; player.forfeited = true;
      player.energy = 0; player.tokyoZone = null;
      discardPendingEvenBiggerLossesForBody(state, id);
      for (const card of player.powerCards) {
        removedCards.add(card.instanceId);
        state.discardPile.push({ instanceId: card.instanceId, cardId: card.cardId });
        state.usedThisTurn.delete(`mimic_initial:${card.instanceId}`);
        state.usedThisTurn.delete(`mimic_retarget:${card.instanceId}`);
      }
      player.powerCards = [];
      state.pendingTokyoDamage.delete(id);
      clearPendingBurrowingYields(state, id);
      addLog(state, `${player.displayName} forfeited and left the game.`);
    }
    clearBrokenMimics(state, removedCards);
  });
  state.startingRollContenders = state.startingRollContenders.filter((id) => !departingIds.has(id));
  state.pendingPsychicProbes = state.pendingPsychicProbes.filter((pending) => !departingIds.has(pending.playerId));
  if (state.pendingHeartAllocation && departingIds.has(state.pendingHeartAllocation.playerId)) state.pendingHeartAllocation = null;
  state.pendingTokyoDecisions = state.pendingTokyoDecisions.filter((id) => !departingIds.has(id));
  state.pendingFreezeTimeDecisions = state.pendingFreezeTimeDecisions.filter((pending) => !departingIds.has(pending.playerId));
  if (state.pendingOpportunist) {
    state.pendingOpportunist.playerIds = state.pendingOpportunist.playerIds.filter((id) => !departingIds.has(id));
  }
  for (const reveal of state.opportunistRevealQueue) {
    reveal.playerIds = reveal.playerIds.filter((id) => !departingIds.has(id));
  }
  state.queuedExtraTurns = state.queuedExtraTurns.filter((turn) => !departingIds.has(turn.playerId));
  if (!livingPlayers(state).length) {
    finishMutualDestruction(state, true);
    return commit(state);
  }

  const continuation: Extract<ResolutionTask, { kind: 'resume_forfeit' }> = {
    kind: 'resume_forfeit',
    playerId,
    wasCurrentPlayer,
    deathFromAboveOwnerId,
  };
  if (state.pendingDamageWorkflow || state.pendingDefenseDecision || state.resolutionTasks.length) {
    state.resolutionTasks.push(continuation);
    if (interruptedDefense && state.pendingDamageWorkflow) {
      state.pendingDefenseDecision = null;
      state.phase = state.pendingDamageWorkflow.previousPhase;
      advanceDamageWorkflow(state, rng);
    } else runResolutionTasks(state, rng);
  } else {
    finishForfeitResolution(state, playerId, wasCurrentPlayer, deathFromAboveOwnerId, rng);
  }
  return commit(state);
}

export function validateKingOfTokyoState(state: KingOfTokyoServerState): void {
  if (state.players.size !== state.turnOrder.length || new Set(state.turnOrder).size !== state.turnOrder.length) {
    throw new Error('Turn order invariant failed');
  }
  if (state.market.length !== 3) throw new Error('Market size invariant failed');
  if (!Number.isSafeInteger(state.rollOffRound) || state.rollOffRound < 1) {
    throw new Error('Roll-off round invariant failed');
  }
  if (state.rollCount < 0 || state.rollCount > state.maxRolls) throw new Error('Roll count invariant failed');
  const cards = [
    ...state.deck,
    ...state.discardPile,
    ...state.market.flatMap((card) => card ? [card] : []),
    ...[...state.players.values()].flatMap((player) => player.powerCards),
  ];
  const cardIds = cards.map((card) => card.instanceId);
  if (cardIds.length !== KING_OF_TOKYO_DECK_SIZE || new Set(cardIds).size !== cardIds.length) {
    throw new Error(`Power deck invariant failed (${cardIds.length}/${KING_OF_TOKYO_DECK_SIZE})`);
  }
  for (const card of cards) {
    const definition = KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId];
    const copy = Number(card.instanceId.slice(card.cardId.length + 1));
    if (!definition || !Number.isInteger(copy) || copy < 1 || copy > (definition.copies ?? 1) ||
        card.instanceId !== `${card.cardId}:${copy}`) throw new Error('Canonical Power card identity invariant failed');
  }
  if (!Number.isSafeInteger(state.startingRevision) || state.startingRevision < 0 ||
      !Number.isSafeInteger(state.revision) || state.revision < state.startingRevision) {
    throw new Error('Match revision floor invariant failed');
  }
  for (const id of state.turnOrder) {
    const player = state.players.get(id);
    if (!player) throw new Error(`Missing player ${id}`);
    if (!Number.isInteger(player.health) || player.health < 0 || player.health > player.maxHealth) throw new Error(`Health invariant failed for ${id}`);
    if (!Number.isInteger(player.maxHealth) || player.maxHealth < KING_OF_TOKYO_MAX_HEALTH) throw new Error(`Max health invariant failed for ${id}`);
    const awaitingAtomicFatality = !player.eliminated && player.health === 0 &&
      state.pendingDamageWorkflow?.targets.some((target) => target.playerId === id && target.stage === 'done');
    if (player.eliminated !== (player.health === 0) && !awaitingAtomicFatality) {
      throw new Error(`Elimination invariant failed for ${id}`);
    }
    if (!Number.isInteger(player.victoryPoints) || player.victoryPoints < 0) throw new Error(`Victory point invariant failed for ${id}`);
    if (!Number.isInteger(player.energy) || player.energy < 0) throw new Error(`Energy invariant failed for ${id}`);
    if (!Number.isInteger(player.poisonTokens) || player.poisonTokens < 0 ||
        !Number.isInteger(player.shrinkTokens) || player.shrinkTokens < 0) throw new Error(`Token invariant failed for ${id}`);
    if (player.eliminated && player.tokyoZone) throw new Error(`Eliminated player ${id} occupies Tokyo`);
  }
  const living = livingPlayers(state);
  const zones = living.map((player) => player.tokyoZone).filter((zone) => zone !== null);
  if (new Set(zones).size !== zones.length || zones.length > kingOfTokyoCapacity(living.length)) throw new Error('Tokyo occupancy invariant failed');
  if (living.length <= 4 && zones.includes('tokyo_bay')) throw new Error('Tokyo Bay is active below five players');
  if (new Set(state.pendingTokyoDecisions).size !== state.pendingTokyoDecisions.length ||
      state.pendingTokyoDecisions.some((id) => state.players.get(id)?.eliminated || !state.players.get(id)?.tokyoZone)) {
    throw new Error('Tokyo decision queue invariant failed');
  }
  const pendingEvenBiggerPackets = [
    ...state.pendingEvenBiggerLosses,
    ...state.resolutionTasks.flatMap((task) => task.kind === 'complete_even_bigger_loss' ? [task.pending] : []),
  ];
  const hasEvenBiggerDrain = state.resolutionTasks.some((task) => task.kind === 'drain_even_bigger_losses');
  if (typeof state.pendingEvenBiggerReconcileJets !== 'boolean' ||
      typeof state.pendingEvenBiggerNormalizeTokyo !== 'boolean' ||
      ((state.pendingEvenBiggerLosses.length > 0 || state.pendingEvenBiggerReconcileJets ||
        state.pendingEvenBiggerNormalizeTokyo) && !hasEvenBiggerDrain) ||
      pendingEvenBiggerPackets.some((pending) => {
        const entitlements = pending.entitlements;
        const watcherIds = pending.deathWatcherEntitlements.map((entry) => entry.playerId);
        return !state.players.has(pending.playerId) || !Number.isSafeInteger(pending.copiesRemaining) ||
          pending.copiesRemaining <= 0 || !Number.isSafeInteger(pending.finalMaxHealth) ||
          pending.finalMaxHealth < KING_OF_TOKYO_MAX_HEALTH ||
          !Number.isSafeInteger(entitlements.camouflage) || entitlements.camouflage < 0 ||
          !Number.isSafeInteger(entitlements.armorPlating) || entitlements.armorPlating < 0 ||
          !Number.isSafeInteger(entitlements.wings) || entitlements.wings < 0 ||
          !Number.isSafeInteger(entitlements.rapidHealing) || entitlements.rapidHealing < 0 ||
          !Number.isSafeInteger(entitlements.stretchy) || entitlements.stretchy < 0 ||
          !Number.isSafeInteger(entitlements.makingItStronger) || entitlements.makingItStronger < 0 ||
          typeof entitlements.childEntitled !== 'boolean' ||
          typeof pending.preservePendingJetsEntitlements !== 'boolean' ||
          new Set(watcherIds).size !== watcherIds.length ||
          pending.deathWatcherEntitlements.some((entry) => !state.players.has(entry.playerId) ||
            !Number.isSafeInteger(entry.copies) || entry.copies <= 0);
      })) {
    throw new Error('Pending Even Bigger loss invariant failed');
  }
  for (const [id, pending] of state.pendingTokyoDamage) {
    const entitlements = pending.smashEntitlements;
    const watcherIds = pending.deathWatcherEntitlements.map((entitlement) => entitlement.playerId);
    const jetsIds = pending.jetsCardInstanceIds;
    if ((!state.pendingTokyoDecisions.includes(id) && !state.pendingSmashResolution?.targetPlayerIds.includes(id)) ||
        !Number.isSafeInteger(pending.amount) || pending.amount <= 0 ||
        !Number.isSafeInteger(pending.poisonTokens) || pending.poisonTokens < 0 ||
        !Number.isSafeInteger(pending.shrinkTokens) || pending.shrinkTokens < 0 ||
        !Number.isSafeInteger(pending.deferredEvenBiggerLoss) || pending.deferredEvenBiggerLoss < 0 ||
        !Array.isArray(jetsIds) || !jetsIds.length || new Set(jetsIds).size !== jetsIds.length ||
        jetsIds.some((instanceId) => typeof instanceId !== 'string' || !instanceId) ||
        typeof pending.jetsSnapshotGranted !== 'boolean' || !state.players.get(id) ||
        (!pending.jetsSnapshotGranted && effectCount(state, state.players.get(id)!, 'jets') === 0) ||
        !entitlements || !Number.isSafeInteger(entitlements.camouflage) || entitlements.camouflage < 0 ||
        !Number.isSafeInteger(entitlements.armorPlating) || entitlements.armorPlating < 0 ||
        !Number.isSafeInteger(entitlements.wings) || entitlements.wings < 0 ||
        !Number.isSafeInteger(entitlements.rapidHealing) || entitlements.rapidHealing < 0 ||
        !Number.isSafeInteger(entitlements.stretchy) || entitlements.stretchy < 0 ||
        !Number.isSafeInteger(entitlements.makingItStronger) || entitlements.makingItStronger < 0 ||
        typeof entitlements.childEntitled !== 'boolean' || !Array.isArray(pending.deathWatcherEntitlements) ||
        new Set(watcherIds).size !== watcherIds.length || pending.deathWatcherEntitlements.some((entitlement) =>
          !state.players.has(entitlement.playerId) || !Number.isSafeInteger(entitlement.copies) || entitlement.copies <= 0)) {
      throw new Error('Deferred Tokyo damage invariant failed');
    }
  }
  const burrowingYieldKeys = state.pendingBurrowingYields.map((pending) =>
    `${pending.entrantPlayerId}:${pending.zone}`);
  if (new Set(burrowingYieldKeys).size !== burrowingYieldKeys.length ||
      state.pendingBurrowingYields.some((pending) =>
        pending.entrantPlayerId !== currentPlayerId(state) ||
        !state.players.has(pending.sourcePlayerId) ||
        state.players.get(pending.entrantPlayerId)?.eliminated ||
        state.players.get(pending.entrantPlayerId)?.tokyoZone !== null ||
        (pending.zone !== 'tokyo_city' && pending.zone !== 'tokyo_bay') ||
        !Number.isSafeInteger(pending.copies) || pending.copies <= 0) ||
      (state.pendingBurrowingYields.length > 0 && state.phase !== 'awaiting_tokyo_decision' &&
        !state.pendingDiceResolution)) {
    throw new Error('Pending Burrowing yield invariant failed');
  }
  const deathFromAbove = state.pendingDeathFromAbove;
  if (deathFromAbove && (
    state.phase !== 'awaiting_death_from_above' ||
    new Set(deathFromAbove.targetPlayerIds).size !== deathFromAbove.targetPlayerIds.length ||
    deathFromAbove.targetPlayerIds.length !== 2 ||
    state.players.get(deathFromAbove.playerId)?.eliminated ||
    state.players.get(deathFromAbove.playerId)?.tokyoZone !== null ||
    deathFromAbove.targetPlayerIds.some((playerId) => {
      const target = state.players.get(playerId);
      return !target || target.eliminated || !target.tokyoZone;
    })
  )) throw new Error('Death from Above choice invariant failed');
  const freezeTime = state.pendingFreezeTimeDecisions;
  if (freezeTime.some((pending) =>
    pending.playerId !== currentPlayerId(state) || state.players.get(pending.playerId)?.eliminated ||
    !pending.cardInstanceId || !Number.isSafeInteger(pending.dicePenalty) ||
    pending.dicePenalty !== state.currentTurnDicePenalty + 1 || !isFreezeTimeDecisionEligible(state, pending)) ||
    new Set(freezeTime.map((pending) => pending.cardInstanceId)).size !== freezeTime.length ||
    (freezeTime.length > 0 && (!state.pendingDiceResolution || state.phase !== 'awaiting_freeze_time'))) {
    throw new Error('Freeze Time choice invariant failed');
  }
  const aftermath = state.pendingSmashAftermath;
  if (aftermath && (
    (!hasCommittedResolution(state) && state.phase !== 'awaiting_tokyo_decision') || aftermath.actorId !== currentPlayerId(state) ||
    !Number.isSafeInteger(aftermath.alphaPoints) || aftermath.alphaPoints < 0 ||
    !Number.isSafeInteger(aftermath.fireSources) || aftermath.fireSources < 0 ||
    (!aftermath.alphaPoints && !aftermath.fireSources && !state.pendingDamageWorkflow &&
      !state.resolutionTasks.some((task) => task.kind === 'continue_fire')) ||
    new Set(aftermath.fireNeighborIds).size !== aftermath.fireNeighborIds.length ||
    aftermath.fireNeighborIds.some((id) => id === aftermath.actorId || !state.players.has(id))
  )) throw new Error('Pending Smash aftermath invariant failed');
  if (new Set(state.pendingEndTurnEffects.map((effect) => effect.effectId)).size !== state.pendingEndTurnEffects.length ||
      state.pendingEndTurnEffects.some((effect) => effect.effectId !== effect.kind ||
        !Number.isSafeInteger(effect.copies) || effect.copies <= 0)) {
    throw new Error('Pending end-turn effect invariant failed');
  }
  if (state.status === 'playing') {
    const workflow = state.pendingDamageWorkflow;
    const defense = state.pendingDefenseDecision;
    const pendingHearts = state.pendingHeartAllocation;
    const heartWindowInterruptedByDefense = workflow?.previousPhase === 'awaiting_heart_allocation';
    const heartWindowExpected = state.phase === 'awaiting_heart_allocation' || heartWindowInterruptedByDefense;
    if (Boolean(pendingHearts) !== heartWindowExpected || (pendingHearts && (
      !state.pendingDiceResolution || pendingHearts.playerId !== currentPlayerId(state) ||
      state.players.get(pendingHearts.playerId)?.eliminated || !pendingHearts.heartIndexes.length ||
      new Set(pendingHearts.heartIndexes).size !== pendingHearts.heartIndexes.length ||
      pendingHearts.heartIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 ||
        index >= state.dice.length || state.dice[index]?.face !== 'heart') ||
      typeof pendingHearts.healingRayAvailable !== 'boolean'
    ))) throw new Error('Heart allocation invariant failed');
    if (state.pendingDiceResolution && (
      state.pendingDiceResolution.playerId !== currentPlayerId(state) ||
      new Set(state.pendingDiceResolution.remainingCategories).size !==
        state.pendingDiceResolution.remainingCategories.length ||
      state.pendingDiceResolution.remainingCategories.some((category) =>
        !['points', 'energy', 'hearts', 'smash'].includes(category))
    )) throw new Error('Dice resolution invariant failed');
    if ((state.phase === 'awaiting_defense_decision') !== Boolean(defense) || Boolean(defense) !== Boolean(workflow) ||
        state.drainingResolutionTasks || (defense && (
          defense.playerId !== workflow?.targets[workflow.targetIndex]?.playerId ||
          defense.remainingDamage !== workflow?.targets[workflow.targetIndex]?.amount ||
          !Number.isSafeInteger(defense.incomingDamage) || defense.incomingDamage <= 0 ||
          !Number.isSafeInteger(defense.remainingDamage) || defense.remainingDamage <= 0 ||
          !Number.isSafeInteger(defense.maxActivations) || defense.maxActivations < 0 ||
          defense.dice.some((face) => !KING_OF_TOKYO_DIE_FACES.includes(face))
        ))) throw new Error('Pending defence decision invariant failed');
    if (workflow && (typeof workflow.preservePendingJetsEntitlements !== 'boolean' ||
        workflow.targetIndex < 0 || workflow.targetIndex >= workflow.targets.length ||
        workflow.targets.some((target) => !state.players.has(target.playerId) || target.rawAmount <= 0 ||
          target.amount < 0 || target.amount > target.rawAmount || target.camouflageCopyIndex < 0 ||
          target.camouflageCopyIndex > target.entitlements.camouflage))) {
      throw new Error('Pending damage workflow invariant failed');
    }
    if (currentPlayer(state).eliminated) {
      advanceIfCurrentPlayerEliminated(state);
      return;
    }
    if (!Number.isSafeInteger(state.labOffersRemaining) || state.labOffersRemaining < 0) {
      throw new Error('Made in a Lab offer invariant failed');
    }
    if ((state.phase === 'buying_cards' || state.phase === 'awaiting_opportunist') &&
        state.labOffersRemaining > effectCount(state, currentPlayer(state), 'made_in_a_lab')) {
      throw new Error('Made in a Lab offer invariant failed');
    }
    if (state.pendingPsychicProbes.some((pending) => {
      const player = state.players.get(pending.playerId);
      const card = player?.powerCards.find((candidate) => candidate.instanceId === pending.cardInstanceId);
      return !player || player.eliminated || !card || effectiveCardId(state, card) !== 'psychic_probe';
    })) throw new Error('Psychic Probe queue invariant failed');
    if (state.pendingOpportunist) {
      const card = state.market.find((candidate) => candidate?.instanceId === state.pendingOpportunist!.cardInstanceId);
      if (!card || !state.pendingOpportunist.playerIds.length || state.pendingOpportunist.playerIds.some((playerId) => {
        const player = state.players.get(playerId);
        return !player || player.eliminated ||
          player.energy < effectiveCost(state, player, card.cardId);
      })) throw new Error('Opportunist queue invariant failed');
    }
    if (state.opportunistRevealQueue.some((reveal) => !reveal.cardInstanceId ||
        new Set(reveal.playerIds).size !== reveal.playerIds.length ||
        reveal.playerIds.some((playerId) => !state.players.has(playerId)))) {
      throw new Error('Opportunist reveal queue invariant failed');
    }
    const settlingDeadAttacker = hasCommittedResolution(state) ||
      (state.phase === 'awaiting_death_from_above' && Boolean(state.pendingDeathFromAbove));
    if (state.phase !== 'determining_first_player' && currentPlayer(state).eliminated && !settlingDeadAttacker) {
      throw new Error('Eliminated monster has the turn');
    }
    const defenseInterruptedTokyo = workflow?.previousPhase === 'awaiting_tokyo_decision';
    if (!defenseInterruptedTokyo &&
        ((state.phase === 'awaiting_tokyo_decision') !== Boolean(state.pendingTokyoDecisions.length))) {
      throw new Error('Tokyo decision phase invariant failed');
    }
    if ((state.phase === 'awaiting_death_from_above') !== Boolean(state.pendingDeathFromAbove)) throw new Error('Death from Above phase invariant failed');
    if ((state.phase === 'awaiting_freeze_time') !== Boolean(state.pendingFreezeTimeDecisions.length)) throw new Error('Freeze Time phase invariant failed');
    if ((state.phase === 'awaiting_psychic_probe') !== Boolean(state.pendingPsychicProbes.length)) throw new Error('Psychic Probe phase invariant failed');
    if ((state.pendingOpportunist && state.phase !== 'awaiting_opportunist') ||
        (state.phase === 'awaiting_opportunist' && !state.pendingOpportunist && !hasPendingInitialMimic(state))) {
      throw new Error('Opportunist phase invariant failed');
    }
    if (state.phase === 'resolving_end_turn' && !state.pendingEndTurnEffects.length) throw new Error('End-turn effect phase invariant failed');
    if (state.phase !== 'resolving_end_turn' && state.phase !== 'selling_cards' && state.pendingEndTurnEffects.length) {
      throw new Error('End-turn effect phase invariant failed');
    }
  } else if (state.phase !== 'game_over' ||
      (state.terminationReason === 'no_players_remaining'
        ? state.winnerId !== null || state.victoryType !== null || living.length > 0
        : !state.victoryType || (state.victoryType === 'mutual_destruction' ? state.winnerId !== null : !state.winnerId))) {
    throw new Error('Game-over invariant failed');
  }
}
