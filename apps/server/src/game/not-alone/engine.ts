import {
  NOT_ALONE_HUNT_BY_ID, NOT_ALONE_HUNT_CARDS, NOT_ALONE_MAX_PLAYERS, NOT_ALONE_MIN_PLAYERS,
  NOT_ALONE_RULES_VERSION, NOT_ALONE_SURVIVAL_BY_ID, NOT_ALONE_SURVIVAL_CARDS, notAloneAdjacent,
  notAloneAdvancedCopies, notAloneArtemiaAvailable, notAloneTrackGoals,
  type NotAloneBoardFace,
  type NotAloneHuntCardId, type NotAloneHuntCardPayload, type NotAloneHuntToken,
  type NotAlonePlaceId, type NotAloneResolvePayload, type NotAloneSurvivalCardId,
  type NotAloneSurvivalPayload, type NotAloneTeam, type NotAlonePhase,
  type NotAlonePrivateState,
  type NotAloneEncounterStage,
} from '@zuychin-arcade/types';
import { createHuntDeck, createSurvivalDeck, shuffleNotAlone, type NotAloneRandomSource } from './deck.js';

export interface NotAloneServerPlayer {
  playerId: string;
  displayName: string;
  role: 'creature' | 'hunted';
  will: number;
  placeHand: NotAlonePlaceId[];
  discard: NotAlonePlaceId[];
  survivalHand: NotAloneSurvivalCardId[];
  selectedPlaces: NotAlonePlaceId[];
  playedPlaces: NotAlonePlaceId[];
  riverNext: boolean;
  artefactNext: boolean;
  survivalPlayed: boolean;
  ignoreCreature: boolean;
  ignoreArtemia: boolean;
  copyPower: NotAlonePlaceId | null;
  returnPlayed: Set<NotAlonePlaceId>;
  recoveryActionUsed: boolean;
  forfeited: boolean;
}

interface NotAloneRoundEffects {
  noHuntCard: boolean;
  noSurvival: boolean;
  smokescreen: boolean;
  fierceness: boolean;
  mutation: boolean;
  persecution: boolean;
  interference: boolean;
  stasis: boolean;
  clone: boolean;
  toxin: boolean;
  scream: boolean;
  anticipationTarget: string | null;
  anticipationAwarded: boolean;
  detourTarget: string | null;
  detourPlace: NotAlonePlaceId | null;
}

export interface NotAloneServerState {
  roomCode: string;
  rulesVersion: string;
  revision: number;
  status: 'playing' | 'game_over';
  phase: NotAlonePhase;
  roundNumber: number;
  boardFace: NotAloneBoardFace;
  players: Map<string, NotAloneServerPlayer>;
  turnOrder: string[];
  creaturePlayerId: string;
  huntedOrder: string[];
  rescueProgress: number;
  rescueGoal: number;
  assimilationProgress: number;
  assimilationGoal: number;
  artemiaAvailable: boolean;
  beachCharged: boolean;
  reserve: Record<NotAlonePlaceId, number>;
  survivalDeck: NotAloneSurvivalCardId[];
  survivalDiscard: NotAloneSurvivalCardId[];
  pendingSurvivalDiscard: NotAloneSurvivalCardId[];
  huntDeck: NotAloneHuntCardId[];
  huntDiscard: NotAloneHuntCardId[];
  pendingHuntDiscard: NotAloneHuntCardId[];
  huntHand: NotAloneHuntCardId[];
  activeHuntCards: NotAloneHuntCardId[];
  copiedHuntCard: NotAloneHuntCardId | null;
  maxHuntCards: number;
  nextMaxHuntCards: number;
  huntTokens: Record<NotAloneHuntToken, NotAlonePlaceId[]>;
  huntPlanLocked: boolean;
  forceFieldPlaces: Set<NotAlonePlaceId>;
  selectionBlockedPlaces: Set<NotAlonePlaceId>;
  disabledPlaces: Set<NotAlonePlaceId>;
  cataclysmPlaces: Set<NotAlonePlaceId>;
  revealedHuntedHands: Record<string, NotAlonePlaceId[]>;
  pendingCursor: number;
  pendingPlaceIndex: number;
  pendingPlayerId: string | null;
  resolutionQueue: Array<{ playerId: string; placeIndex: number; stage: NotAloneEncounterStage }>;
  resolutionPaused: boolean;
  pendingSurvivalChoice: { playerId: string; cards: NotAloneSurvivalCardId[] } | null;
  pendingCardChoice: {
    kind: 'ascendancy' | 'forbidden_zone' | 'phobia' | 'artemia_discard' | 'artefact_order';
    playerId: string | null;
    count: number;
    queue: string[];
    eligiblePlayerIds?: string[];
    sealedChoices?: Map<string, NotAlonePlaceId>;
    choiceWindowRevision?: number;
    artefactStage?: NotAloneEncounterStage;
    artefactSignature?: string;
  } | null;
  artefactStageOrders: Map<string, { signature: string; order: Array<0 | 1> }>;
  reactionPasses: Set<string>;
  planningWindowRevision: number;
  reactionWindowRevision: number;
  pendingTargetEffectIndex: number;
  pendingStageResolved: boolean;
  reckoningStageIndex: number;
  resolvedEncounterStages: Set<string>;
  resolvedTargetEffects: Set<string>;
  resolvedPlaceActions: Set<string>;
  creatureCatchAdvanced: boolean;
  exhaustionAdvanced: boolean;
  usedBeach: boolean;
  usedWreck: boolean;
  effects: NotAloneRoundEffects;
  winner: NotAloneTeam | null;
  endReason: 'track' | 'forfeit' | null;
  log: Array<{ id: number; text: string }>;
  nextLogId: number;
  rng: NotAloneRandomSource;
}

export type NotAloneEngineResult = { ok: true } | { ok: false; reason: string };
const ok = (): NotAloneEngineResult => ({ ok: true });
const reject = (reason: string): NotAloneEngineResult => ({ ok: false, reason });

const emptyEffects = (): NotAloneRoundEffects => ({
  noHuntCard: false, noSurvival: false, smokescreen: false, fierceness: false,
  mutation: false, persecution: false, interference: false, stasis: false,
  clone: false, toxin: false, scream: false, anticipationTarget: null, anticipationAwarded: false,
  detourTarget: null, detourPlace: null,
});

function log(state: NotAloneServerState, text: string): void {
  state.log.push({ id: state.nextLogId++, text });
  if (state.log.length > 70) state.log.shift();
}

function stale(state: NotAloneServerState, expectedRevision?: number): NotAloneEngineResult | null {
  return !Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0 || expectedRevision !== state.revision
    ? reject('Game state changed. Please try again.') : null;
}

function staleWindow(state: NotAloneServerState, expectedRevision: number | undefined, windowRevision: number): NotAloneEngineResult | null {
  return !Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0
    || (expectedRevision !== state.revision && expectedRevision !== windowRevision)
    ? reject('Game state changed. Please try again.') : null;
}

function removeOne<T>(items: T[], value: T): boolean {
  const index = items.indexOf(value);
  if (index < 0) return false;
  items.splice(index, 1);
  return true;
}

function drawSurvival(state: NotAloneServerState): NotAloneSurvivalCardId | null {
  if (state.effects.noSurvival) return null;
  if (!state.survivalDeck.length && state.survivalDiscard.length) {
    state.survivalDeck = shuffleNotAlone(state.survivalDiscard, state.rng);
    state.survivalDiscard = [];
  }
  return state.survivalDeck.shift() ?? null;
}

function drawHunt(state: NotAloneServerState): NotAloneHuntCardId | null {
  if (!state.huntDeck.length && state.huntDiscard.length) {
    state.huntDeck = shuffleNotAlone(state.huntDiscard, state.rng);
    state.huntDiscard = [];
  }
  return state.huntDeck.shift() ?? null;
}

function flushPhaseDiscards(state: NotAloneServerState): void {
  state.survivalDiscard.push(...state.pendingSurvivalDiscard); state.pendingSurvivalDiscard = [];
  state.huntDiscard.push(...state.pendingHuntDiscard); state.pendingHuntDiscard = [];
}

function hunted(state: NotAloneServerState, playerId: string): NotAloneServerPlayer | null {
  const player = state.players.get(playerId);
  return player?.role === 'hunted' && state.huntedOrder.includes(playerId) ? player : null;
}

function isPlace(value: unknown): value is NotAlonePlaceId {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10;
}

function selectionMode(player: NotAloneServerPlayer): 'single' | 'river' | 'artefact' {
  return player.artefactNext ? 'artefact' : player.riverNext ? 'river' : 'single';
}

function requiredSelection(player: NotAloneServerPlayer): 1 | 2 {
  return player.artefactNext || player.riverNext ? 2 : 1;
}

function heldUnplayedPlaces(player: NotAloneServerPlayer): NotAlonePlaceId[] {
  return player.placeHand.filter((place) => !player.playedPlaces.includes(place) || player.returnPlayed.has(place));
}

function checkWin(state: NotAloneServerState): boolean {
  if (state.assimilationProgress >= state.assimilationGoal) state.winner = 'creature';
  else if (state.rescueProgress >= state.rescueGoal) state.winner = 'hunted';
  if (!state.winner) return false;
  flushPhaseDiscards(state);
  if (state.pendingSurvivalChoice) state.survivalDiscard.push(...state.pendingSurvivalChoice.cards);
  state.status = 'game_over'; state.phase = 'game_over'; state.endReason = 'track';
  state.pendingPlayerId = null; state.pendingCardChoice = null; state.pendingSurvivalChoice = null;
  state.reactionPasses.clear();
  log(state, state.winner === 'creature' ? 'Artemia assimilates the stranded expedition.' : 'The rescue mission reaches Artemia. The Hunted escape!');
  return true;
}

function loseWill(state: NotAloneServerState, player: NotAloneServerPlayer, amount: number): void {
  player.will = Math.max(0, player.will - amount);
  if (player.will > 0) return;
  if (!state.exhaustionAdvanced) {
    state.assimilationProgress += 1;
    state.exhaustionAdvanced = true;
    log(state, 'The expedition falters; Assimilation advances again.');
  }
  player.will = 3;
  player.placeHand = [...new Set([...player.placeHand, ...player.discard, ...player.playedPlaces])].sort((a, b) => a - b);
  player.discard = [];
  player.playedPlaces.forEach((place) => player.returnPlayed.add(place));
  log(state, `${player.displayName} gives up, recovers every Place card and restores all Will.`);
}

function recoverPlaces(player: NotAloneServerPlayer, requested: NotAlonePlaceId[] | undefined, maximum: number): number {
  const cap = Math.min(maximum, player.discard.length);
  const chosen = (requested ?? player.discard.slice(0, cap)).filter((id, index, all) => all.indexOf(id) === index).slice(0, cap);
  let recovered = 0;
  for (const place of chosen) if (removeOne(player.discard, place)) { player.placeHand.push(place); recovered += 1; }
  player.placeHand.sort((a, b) => a - b);
  return recovered;
}

function allHuntedReady(state: NotAloneServerState): boolean {
  return state.huntedOrder.every((id) => state.players.get(id)!.selectedPlaces.length > 0);
}

function startCreaturePlanningIfReady(state: NotAloneServerState): void {
  if (state.phase === 'hunted_planning' && allHuntedReady(state)) {
    state.phase = 'exploration_reaction';
    state.reactionPasses.clear();
    state.reactionWindowRevision = state.revision + 1;
    log(state, 'Every destination is locked. The Hunted may respond before Hunting begins.');
  }
}

export function initNotAloneGame(
  roomCode: string,
  playerList: Array<{ playerId: string; displayName: string }>,
  rng: NotAloneRandomSource = Math.random,
  boardFace: NotAloneBoardFace = 'continuous',
): NotAloneServerState {
  if (playerList.length < NOT_ALONE_MIN_PLAYERS || playerList.length > NOT_ALONE_MAX_PLAYERS) {
    throw new Error(`Not Alone needs ${NOT_ALONE_MIN_PLAYERS}-${NOT_ALONE_MAX_PLAYERS} players`);
  }
  if (playerList.some((player) => typeof player.playerId !== 'string' || !player.playerId.trim())
    || new Set(playerList.map((player) => player.playerId)).size !== playerList.length) throw new Error('Not Alone requires unique player IDs');
  if (boardFace !== 'continuous' && boardFace !== 'alternating') throw new Error('Invalid Not Alone board face');
  const creaturePlayerId = playerList[0]!.playerId;
  const huntedOrder = playerList.slice(1).map((player) => player.playerId);
  const survivalDeck = createSurvivalDeck(rng); const huntDeck = createHuntDeck(rng);
  const players = new Map<string, NotAloneServerPlayer>();
  for (const source of playerList) {
    const role = source.playerId === creaturePlayerId ? 'creature' : 'hunted';
    players.set(source.playerId, {
      ...source, role, will: role === 'hunted' ? 3 : 0,
      placeHand: role === 'hunted' ? [1, 2, 3, 4, 5] : [], discard: [],
      survivalHand: role === 'hunted' ? [survivalDeck.shift()!] : [], selectedPlaces: [], playedPlaces: [],
      riverNext: false, artefactNext: false, survivalPlayed: false,
      ignoreCreature: false, ignoreArtemia: false, copyPower: null, returnPlayed: new Set(), recoveryActionUsed: false,
      forfeited: false,
    });
  }
  const goals = notAloneTrackGoals(playerList.length); const copies = notAloneAdvancedCopies(huntedOrder.length);
  const reserve = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [index + 1, index < 5 ? 0 : copies])) as Record<NotAlonePlaceId, number>;
  const state: NotAloneServerState = {
    roomCode, rulesVersion: NOT_ALONE_RULES_VERSION, revision: 0, status: 'playing', phase: 'hunted_planning', roundNumber: 1, boardFace,
    players, turnOrder: playerList.map((player) => player.playerId), creaturePlayerId, huntedOrder,
    rescueProgress: 0, rescueGoal: goals.rescue, assimilationProgress: 0, assimilationGoal: goals.assimilation,
    artemiaAvailable: false, beachCharged: false, reserve, survivalDeck, survivalDiscard: [], pendingSurvivalDiscard: [], huntDeck,
    huntDiscard: [], pendingHuntDiscard: [], huntHand: [], activeHuntCards: [], copiedHuntCard: null, maxHuntCards: 1, nextMaxHuntCards: 1,
    huntTokens: { creature: [], target: [], artemia: [] }, huntPlanLocked: false, forceFieldPlaces: new Set(), selectionBlockedPlaces: new Set(), disabledPlaces: new Set(), cataclysmPlaces: new Set(), revealedHuntedHands: {},
    pendingCursor: 0, pendingPlaceIndex: 0, pendingPlayerId: null, resolutionQueue: [], resolutionPaused: false, pendingSurvivalChoice: null, pendingCardChoice: null, artefactStageOrders: new Map(), reactionPasses: new Set(), planningWindowRevision: 0, reactionWindowRevision: 0, pendingTargetEffectIndex: 0, pendingStageResolved: false, reckoningStageIndex: -1, resolvedEncounterStages: new Set(), resolvedTargetEffects: new Set(), resolvedPlaceActions: new Set(), creatureCatchAdvanced: false,
    exhaustionAdvanced: false, usedBeach: false, usedWreck: false, effects: emptyEffects(), winner: null,
    endReason: null, log: [], nextLogId: 1, rng,
  };
  while (state.huntHand.length < 3) { const card = drawHunt(state); if (!card) break; state.huntHand.push(card); }
  log(state, `${players.get(creaturePlayerId)!.displayName} awakens as the Creature. The Hunted scatter across Artemia.`);
  validateNotAloneState(state); return state;
}

export function selectNotAlonePlaces(state: NotAloneServerState, playerId: string, placeIds: NotAlonePlaceId[], expectedRevision?: number): NotAloneEngineResult {
  const staleResult = staleWindow(state, expectedRevision, state.planningWindowRevision); if (staleResult) return staleResult;
  if (state.phase !== 'hunted_planning') return reject('Exploration choices are closed');
  const player = hunted(state, playerId); if (!player) return reject('Only the Hunted choose a place');
  if (player.selectedPlaces.length > 0) return reject('Your destination is already locked');
  const needed = requiredSelection(player);
  if (!Array.isArray(placeIds) || placeIds.length !== needed || new Set(placeIds).size !== placeIds.length) return reject(`Choose ${needed} different Place card${needed === 1 ? '' : 's'}`);
  if (placeIds.some((place) => !isPlace(place) || !player.placeHand.includes(place))) return reject('Choose Place cards in your hand');
  if (placeIds.some((place) => state.selectionBlockedPlaces.has(place))) return reject('A Force Field blocks that place');
  player.selectedPlaces = [...placeIds];
  player.playedPlaces = [...placeIds];
  if (selectionMode(player) === 'artefact') player.artefactNext = false;
  log(state, `${player.displayName} locks in an exploration signal.`);
  startCreaturePlanningIfReady(state); state.revision += 1; validateNotAloneState(state); return ok();
}

export function chooseNotAloneRiverDestination(state: NotAloneServerState, playerId: string, explorePlaceId: NotAlonePlaceId, expectedRevision?: number): NotAloneEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  if (state.phase !== 'river_choice' || state.pendingPlayerId !== playerId) return reject('It is not your River choice');
  const player = hunted(state, playerId); if (!player?.riverNext || player.selectedPlaces.length !== 2 || !player.selectedPlaces.includes(explorePlaceId)) return reject('Choose which prepared Place will be explored');
  const chosenIndex = player.selectedPlaces.indexOf(explorePlaceId);
  player.selectedPlaces = [explorePlaceId]; player.playedPlaces = [player.playedPlaces[chosenIndex]!]; player.riverNext = false;
  const next = state.huntedOrder.find((id) => state.players.get(id)!.riverNext);
  if (next) state.pendingPlayerId = next;
  else {
    state.pendingPlayerId = null; state.phase = 'reckoning'; state.reactionPasses.clear(); state.reactionWindowRevision = state.revision + 1;
    log(state, 'The River decoys vanish. The Hunted reveal their real destinations.');
    settleNoActionReckoningCheckpoint(state);
  }
  state.revision += 1; validateNotAloneState(state); return ok();
}

export function resistNotAlone(state: NotAloneServerState, playerId: string, willCost: 1 | 2, placeIds: NotAlonePlaceId[], expectedRevision?: number): NotAloneEngineResult {
  const staleResult = staleWindow(state, expectedRevision, state.planningWindowRevision); if (staleResult) return staleResult;
  if (state.phase !== 'hunted_planning') return reject('You can only resist before choosing a place');
  const player = hunted(state, playerId); if (!player || player.selectedPlaces.length) return reject('Choose whether to resist before locking a place');
  if (!Array.isArray(placeIds) || placeIds.some((place) => !isPlace(place))) return reject('Choose valid discarded Place cards');
  if (player.recoveryActionUsed) return reject('You already chose a pre-Exploration recovery action this round');
  if (![1, 2].includes(willCost) || player.will < willCost) return reject('You do not have enough Will');
  const count = willCost * 2;
  if (player.discard.length < count || placeIds.length !== count || new Set(placeIds).size !== placeIds.length || placeIds.some((id) => !player.discard.includes(id))) return reject(`Choose ${count} different discarded Place cards`);
  player.will -= willCost; player.recoveryActionUsed = true; recoverPlaces(player, placeIds, count);
  if (player.will === 0) {
    state.assimilationProgress += 1; player.will = 3;
    player.placeHand = [...new Set([...player.placeHand, ...player.discard, ...player.playedPlaces])].sort((a, b) => a - b); player.discard = [];
    log(state, `${player.displayName} resists too far and must give up. Assimilation advances.`);
  } else log(state, `${player.displayName} spends ${willCost} Will to recover ${count} Place cards.`);
  checkWin(state); state.revision += 1; validateNotAloneState(state); return ok();
}

function liveHuntedIds(state: NotAloneServerState): string[] {
  return state.huntedOrder.filter((id) => !state.players.get(id)!.forfeited);
}

function everyLiveHuntedPassed(state: NotAloneServerState): boolean {
  return liveHuntedIds(state).every((id) => state.reactionPasses.has(id)
    || playableNotAloneSurvivalCards(state, id).length === 0);
}

export function passNotAloneReaction(state: NotAloneServerState, playerId: string, expectedRevision?: number): NotAloneEngineResult {
  const staleResult = staleWindow(state, expectedRevision, state.reactionWindowRevision); if (staleResult) return staleResult;
  const player = hunted(state, playerId);
  if (!player || player.forfeited) return reject('Only an active Hunted seat may pass');
  if (!(
    state.phase === 'exploration_reaction'
    || state.phase === 'hunting_reaction'
    || (state.phase === 'reckoning' && state.pendingPlayerId === null && !state.pendingCardChoice)
    || state.phase === 'end_of_turn'
  )) return reject('There is no reaction window to pass');
  if (state.reactionPasses.has(playerId)) return reject('You already passed this reaction window');
  if (playableNotAloneSurvivalCards(state, playerId).length === 0) return reject('No reaction is available; this seat is already ready');
  state.reactionPasses.add(playerId);
  log(state, `${player.displayName} is ready to continue.`);
  state.revision += 1; validateNotAloneState(state); return ok();
}

export function beginNotAloneHunt(state: NotAloneServerState, playerId: string, expectedRevision?: number): NotAloneEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  if (playerId !== state.creaturePlayerId || state.phase !== 'exploration_reaction') return reject('Only the Creature may begin Hunting');
  if (!everyLiveHuntedPassed(state)) return reject('Wait for every active Hunted player to pass the reaction window');
  flushPhaseDiscards(state);
  state.phase = 'creature_planning'; state.reactionPasses.clear();
  state.reactionWindowRevision = state.revision + 1;
  log(state, 'The Creature begins its hunt.');
  state.revision += 1; validateNotAloneState(state); return ok();
}

export function giveUpNotAlone(state: NotAloneServerState, playerId: string, expectedRevision?: number): NotAloneEngineResult {
  const staleResult = staleWindow(state, expectedRevision, state.planningWindowRevision); if (staleResult) return staleResult;
  if (state.phase !== 'hunted_planning') return reject('You can only give up during exploration');
  const player = hunted(state, playerId); if (!player || player.selectedPlaces.length) return reject('Give up before locking a place');
  const legalDestinations = player.placeHand.filter((place) => !state.selectionBlockedPlaces.has(place));
  if (player.recoveryActionUsed && legalDestinations.length >= requiredSelection(player)) {
    return reject('You already chose a pre-Exploration recovery action this round');
  }
  player.recoveryActionUsed = true;
  player.will = 3; player.placeHand = [...new Set([...player.placeHand, ...player.discard, ...player.playedPlaces])].sort((a, b) => a - b); player.discard = [];
  state.assimilationProgress += 1; log(state, `${player.displayName} gives up and recovers every Place card. Assimilation advances.`);
  checkWin(state); state.revision += 1; validateNotAloneState(state); return ok();
}

function survivalPhaseAllowed(state: NotAloneServerState, phase: number, player: NotAloneServerPlayer): boolean {
  if (state.effects.noSurvival) return false;
  if (phase === 1) return state.phase === 'hunted_planning' || state.phase === 'exploration_reaction';
  if (phase === 2) return state.phase === 'hunting_reaction';
  if (phase === 3) return state.phase === 'reckoning' && (state.pendingPlayerId === null || state.pendingPlayerId === player.playerId);
  return state.phase === 'end_of_turn';
}

function currentPlacePowerAvailable(state: NotAloneServerState, player: NotAloneServerPlayer): boolean {
  if (state.phase !== 'reckoning' || state.pendingPlayerId !== player.playerId) return false;
  const entry = state.resolutionQueue[state.pendingCursor];
  if (!entry || entry.stage !== 'place' || entry.placeIndex !== state.pendingPlaceIndex) return false;
  if (state.resolvedPlaceActions.has(placeSlotKey(player.playerId, state.pendingPlaceIndex))) return false;
  const place = player.selectedPlaces[state.pendingPlaceIndex];
  if (!place || state.disabledPlaces.has(place)) return false;
  const slot = placeSlotKey(player.playerId, state.pendingPlaceIndex);
  if (state.resolvedEncounterStages.has(`${slot}:creature`) && !player.ignoreCreature) return false;
  if (state.resolvedEncounterStages.has(`${slot}:artemia`) && !player.ignoreArtemia) return false;
  if (state.resolvedEncounterStages.has(`${slot}:target`)
    && ((state.effects.clone && !player.ignoreCreature) || state.effects.toxin)) return false;
  return true;
}

function availableRoverPlaces(state: NotAloneServerState, player: NotAloneServerPlayer): NotAlonePlaceId[] {
  return ([6, 7, 8, 9, 10] as NotAlonePlaceId[])
    .filter((id) => state.reserve[id] > 0 && !player.placeHand.includes(id) && !player.discard.includes(id));
}

function copiedPlacePowerAvailable(
  state: NotAloneServerState,
  player: NotAloneServerPlayer,
  place: NotAlonePlaceId,
): boolean {
  if (place === 3 && player.artefactNext) return false;
  if (place === 4 && state.usedBeach) return false;
  if (place === 5 && availableRoverPlaces(state, player).length === 0) return false;
  if (place === 7 && (state.effects.noSurvival || state.survivalDeck.length + state.survivalDiscard.length === 0)) return false;
  if (place === 8 && state.usedWreck) return false;
  if (place === 9) {
    const canHeal = state.huntedOrder.some((id) => {
      const target = state.players.get(id)!;
      return !target.forfeited && target.will < 3;
    });
    const canDraw = !state.effects.noSurvival && state.survivalDeck.length + state.survivalDiscard.length > 0;
    if (!canHeal && !canDraw) return false;
  }
  if (place === 10 && player.riverNext) return false;
  return true;
}

function copyableLairPlacesWithTokens(
  state: NotAloneServerState,
  player: NotAloneServerPlayer,
  creaturePlaces: NotAlonePlaceId[],
  targetPlaces: NotAlonePlaceId[],
): NotAlonePlaceId[] {
  const creatureTokenPlaces = [
    ...creaturePlaces,
    ...(state.effects.clone ? targetPlaces : []),
  ];
  return [...new Set(creatureTokenPlaces)]
    .filter((place) => place !== 10 && copiedPlacePowerAvailable(state, player, place));
}

function copyableLairPlaces(state: NotAloneServerState, player: NotAloneServerPlayer): NotAlonePlaceId[] {
  return copyableLairPlacesWithTokens(state, player, state.huntTokens.creature, state.huntTokens.target);
}

function copyableGatePlaces(state: NotAloneServerState, player: NotAloneServerPlayer): NotAlonePlaceId[] {
  const current = player.selectedPlaces[state.pendingPlaceIndex];
  if (!current) return [];
  return ([1, 2, 3, 4, 5, 6, 7, 8, 9] as NotAlonePlaceId[])
    .filter((place) => notAloneAdjacent(current, place) && copiedPlacePowerAvailable(state, player, place));
}

function placeSlotKey(playerId: string, placeIndex: number): string {
  return `${playerId}:${placeIndex}`;
}

function encounterSlotKey(playerId: string, placeIndex: number, stage: NotAloneEncounterStage): string {
  return `${placeSlotKey(playerId, placeIndex)}:${stage}`;
}

function huntCardTimingMatches(state: NotAloneServerState, cardId: NotAloneHuntCardId): boolean {
  const copied = cardId === 'flashback' ? state.huntDiscard.at(-1) : cardId;
  if (!copied || copied === 'flashback') return false;
  const phase = NOT_ALONE_HUNT_BY_ID[copied].phase;
  if (phase === 1) return state.phase === 'hunted_planning' || state.phase === 'exploration_reaction';
  if (phase === 2) return state.phase === 'creature_planning';
  if (phase === 3) return state.phase === 'reckoning' && state.pendingPlayerId === null;
  return state.phase === 'end_of_turn';
}

function unresolvedPlaceActionCanChange(state: NotAloneServerState, playerId: string, placeIndex: number): boolean {
  const player = state.players.get(playerId);
  if (!player || state.resolvedPlaceActions.has(placeSlotKey(playerId, placeIndex))) return false;
  return !placeActionBlocked(state, player, placeIndex);
}

function unresolvedStageAppliesAtPlace(
  state: NotAloneServerState,
  playerId: string,
  placeIndex: number,
  stage: Exclude<NotAloneEncounterStage, 'place'>,
  place: NotAlonePlaceId,
  footprint: NotAlonePlaceId[],
): boolean {
  const stageIndex = stage === 'target' ? 0 : stage === 'artemia' ? 1 : 2;
  if (state.reckoningStageIndex > stageIndex
    || state.resolvedEncounterStages.has(encounterSlotKey(playerId, placeIndex, stage))
    || !footprint.includes(place)) return false;
  if (stage !== 'target') return true;
  const slot = placeSlotKey(playerId, placeIndex);
  return effectiveHuntCards(state).some((cardId, cardIndex) =>
    (cardId === 'scream' || cardId === 'toxin' || cardId === 'clone')
      && !state.resolvedTargetEffects.has(`${slot}:${cardIndex}`));
}

function detourDestinationChangesUnresolvedState(
  state: NotAloneServerState,
  playerId: string,
  placeIndex: number,
  destination: NotAlonePlaceId,
): boolean {
  const player = state.players.get(playerId);
  const origin = player?.selectedPlaces[placeIndex];
  if (!player || !origin || origin === destination) return false;
  if (unresolvedPlaceActionCanChange(state, playerId, placeIndex)
    && (!state.disabledPlaces.has(origin) || !state.disabledPlaces.has(destination))) return true;
  return (['target', 'artemia', 'creature'] as const).some((stage) => {
    const footprint = state.huntTokens[stage];
    return unresolvedStageAppliesAtPlace(state, playerId, placeIndex, stage, origin, footprint)
      !== unresolvedStageAppliesAtPlace(state, playerId, placeIndex, stage, destination, footprint);
  });
}

export function legalNotAloneDetourDestinations(
  state: NotAloneServerState,
  playerId: string,
  placeIndex: number,
): NotAlonePlaceId[] {
  const origin = state.players.get(playerId)?.selectedPlaces[placeIndex];
  if (!origin) return [];
  return ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as NotAlonePlaceId[])
    .filter((candidate) => notAloneAdjacent(origin, candidate)
      && !state.selectionBlockedPlaces.has(candidate)
      && detourDestinationChangesUnresolvedState(state, playerId, placeIndex, candidate));
}

function hasLegalDetour(state: NotAloneServerState): boolean {
  return liveHuntedIds(state).some((id) => state.players.get(id)!.selectedPlaces
    .some((_origin, placeIndex) => legalNotAloneDetourDestinations(state, id, placeIndex).length > 0));
}

export function legalNotAloneCataclysmPlaces(state: NotAloneServerState): NotAlonePlaceId[] {
  return [...new Set(state.huntedOrder.flatMap((playerId) => {
    const player = state.players.get(playerId)!;
    return player.selectedPlaces.filter((place, placeIndex) => unresolvedPlaceActionCanChange(state, playerId, placeIndex)
      && !state.disabledPlaces.has(place));
  }))].sort((a, b) => a - b);
}

export function playableNotAloneHuntCards(state: NotAloneServerState): NotAloneHuntCardId[] {
  if (state.status !== 'playing' || state.effects.noHuntCard || state.pendingCardChoice || state.pendingSurvivalChoice
    || state.activeHuntCards.length >= state.maxHuntCards) return [];
  return state.huntHand.filter((cardId) => {
    if (!huntCardTimingMatches(state, cardId)) return false;
    const effectId = cardId === 'flashback' ? state.huntDiscard.at(-1) : cardId;
    if (effectId === 'force_field') return state.phase === 'hunted_planning'
      && state.huntedOrder.every((id) => state.players.get(id)!.selectedPlaces.length === 0);
    if (effectId === 'ascendancy' || effectId === 'phobia') {
      return liveHuntedIds(state).some((id) => heldUnplayedPlaces(state.players.get(id)!).length > 2);
    }
    if (effectId === 'cataclysm') return legalNotAloneCataclysmPlaces(state).length > 0;
    if (effectId === 'detour') return hasLegalDetour(state);
    return true;
  });
}

function hasUnresolvedArtemiaEncounter(state: NotAloneServerState, player: NotAloneServerPlayer): boolean {
  return player.selectedPlaces.some((place, placeIndex) => state.huntTokens.artemia.includes(place)
    && !state.resolvedEncounterStages.has(encounterSlotKey(player.playerId, placeIndex, 'artemia')));
}

function hasUnresolvedCreatureEncounter(state: NotAloneServerState, player: NotAloneServerPlayer): boolean {
  return player.selectedPlaces.some((place, placeIndex) => {
    const slot = placeSlotKey(player.playerId, placeIndex);
    if (state.huntTokens.creature.includes(place) && !state.resolvedEncounterStages.has(`${slot}:creature`)) return true;
    if (!state.effects.clone || !state.huntTokens.target.includes(place)) return false;
    return effectiveHuntCards(state).some((cardId, cardIndex) => cardId === 'clone'
      && !state.resolvedTargetEffects.has(`${slot}:${cardIndex}`));
  });
}

function tokenMovementStageOpen(state: NotAloneServerState, token: 'target' | 'artemia' | 'creature'): boolean {
  const stageIndex = token === 'target' ? 0 : token === 'artemia' ? 1 : 2;
  return state.phase === 'reckoning' && state.pendingPlayerId === null && state.reckoningStageIndex <= stageIndex;
}

function tokenMovementChangesUnresolvedState(
  state: NotAloneServerState,
  token: 'target' | 'artemia' | 'creature',
  destination: NotAlonePlaceId,
): boolean {
  const currentFootprint = state.huntTokens[token];
  const movedFootprint = [destination];
  const encounterChanges = state.huntedOrder.some((playerId) => {
    const player = state.players.get(playerId)!;
    return player.selectedPlaces.some((place, placeIndex) => {
      const currentApplies = unresolvedStageAppliesAtPlace(state, playerId, placeIndex, token, place, currentFootprint);
      const movedApplies = unresolvedStageAppliesAtPlace(state, playerId, placeIndex, token, place, movedFootprint);
      if (currentApplies !== movedApplies) return true;
      return token === 'target' && effectiveHuntCards(state).includes('mirage')
        && unresolvedPlaceActionCanChange(state, playerId, placeIndex)
        && !state.cataclysmPlaces.has(place)
        && !(state.effects.interference && (place === 4 || place === 8))
        && currentFootprint.includes(place) !== movedFootprint.includes(place);
    });
  });
  if (encounterChanges || token === 'artemia') return encounterChanges;
  return state.huntedOrder.some((playerId) => {
    const player = state.players.get(playerId)!;
    return player.selectedPlaces.some((place, placeIndex) => {
      if (place !== 1 || state.disabledPlaces.has(place)
        || !unresolvedPlaceActionCanChange(state, playerId, placeIndex)) return false;
      const currentCreature = token === 'creature' ? currentFootprint : state.huntTokens.creature;
      const movedCreature = token === 'creature' ? movedFootprint : state.huntTokens.creature;
      const currentTarget = token === 'target' ? currentFootprint : state.huntTokens.target;
      const movedTarget = token === 'target' ? movedFootprint : state.huntTokens.target;
      const before = copyableLairPlacesWithTokens(state, player, currentCreature, currentTarget);
      const after = copyableLairPlacesWithTokens(state, player, movedCreature, movedTarget);
      return before.length !== after.length || before.some((candidate, index) => candidate !== after[index]);
    });
  });
}

export function legalNotAloneTokenMovementDestinations(
  state: NotAloneServerState,
  token: 'target' | 'artemia' | 'creature',
): NotAlonePlaceId[] {
  if (!tokenMovementStageOpen(state, token)) return [];
  const footprint = state.huntTokens[token];
  return ([1,2,3,4,5,6,7,8,9,10] as NotAlonePlaceId[])
    .filter((candidate) => footprint.some((place) => notAloneAdjacent(place, candidate))
      && tokenMovementChangesUnresolvedState(state, token, candidate));
}

export function playableNotAloneSurvivalCards(state: NotAloneServerState, playerId: string): NotAloneSurvivalCardId[] {
  const player = hunted(state, playerId);
  if (!player || player.forfeited || player.survivalPlayed || state.effects.noSurvival || state.pendingCardChoice
    || state.pendingSurvivalChoice || state.status !== 'playing') return [];
  return player.survivalHand.filter((cardId) => {
    const definition = NOT_ALONE_SURVIVAL_BY_ID[cardId];
    if (!survivalPhaseAllowed(state, definition.phase, player)) return false;
    if (cardId === 'adrenaline') return player.will < 3;
    if (cardId === 'amplifier') return state.beachCharged;
    if (cardId === 'detector') return hasUnresolvedArtemiaEncounter(state, player);
    if (cardId === 'dodge') return hasUnresolvedCreatureEncounter(state, player);
    if (cardId === 'double_back') return player.playedPlaces.some((place) => !player.returnPlayed.has(place));
    if (cardId === 'drone') return currentPlacePowerAvailable(state, player) && availableRoverPlaces(state, player).length > 0;
    if (cardId === 'gate') return currentPlacePowerAvailable(state, player) && copyableGatePlaces(state, player).length > 0;
    if (cardId === 'hologram') return legalNotAloneTokenMovementDestinations(state, 'artemia').length > 0;
    if (cardId === 'ingenuity') return !state.beachCharged;
    if (cardId === 'sacrifice') return heldUnplayedPlaces(player).length > 0;
    if (cardId === 'sixth_sense') return player.discard.length > 0;
    if (cardId === 'strike_back') return state.huntHand.length > 0;
    if (cardId === 'vortex') return state.phase === 'hunting_reaction' && player.selectedPlaces.length > 0
      && player.discard.some((place) => !state.selectionBlockedPlaces.has(place));
    if (cardId === 'wrong_track') return legalNotAloneTokenMovementDestinations(state, 'creature').length > 0
      || (state.effects.clone && legalNotAloneTokenMovementDestinations(state, 'target').length > 0);
    return true;
  });
}

export function notAloneResolutionOptions(state: NotAloneServerState, playerId: string): NotAlonePrivateState['resolutionOptions'] {
  const player = hunted(state, playerId);
  if (!player || state.phase !== 'reckoning' || state.pendingPlayerId !== playerId || state.pendingCardChoice || state.pendingSurvivalChoice) return null;
  const place = player.selectedPlaces[state.pendingPlaceIndex]; if (!place) return null;
  const entry = state.resolutionQueue[state.pendingCursor];
  const nextTarget = entry?.stage === 'target' ? nextPendingTargetEffect(state, place) : null;
  const encounterStage = nextTarget !== null
    || ((entry?.stage === 'artemia' || entry?.stage === 'creature') && !state.pendingStageResolved);
  const actual = player.copyPower ?? place;
  const baseAvailable = !encounterStage && entry?.stage === 'place' && currentPlacePowerAvailable(state, player);
  const mustUsePlacePower = player.copyPower !== null;
  const canUsePlacePower = baseAvailable
    && !(actual === 4 && state.usedBeach)
    && !(actual === 8 && state.usedWreck)
    && !(actual === 3 && player.artefactNext)
    && !(actual === 10 && player.riverNext)
    && !(actual === 5 && availableRoverPlaces(state, player).length === 0)
    && !(actual === 7 && (state.effects.noSurvival || state.survivalDeck.length + state.survivalDiscard.length === 0))
    && !(actual === 9 && !state.huntedOrder.some((id) => {
      const target = state.players.get(id)!;
      return !target.forfeited && target.will < 3;
    }) && (state.effects.noSurvival || state.survivalDeck.length + state.survivalDiscard.length === 0));
  const recoveryCap = state.effects.persecution ? 1 : 99;
  const powerRecoveryCount = actual === 1 ? Math.min(recoveryCap, player.discard.length)
    : actual === 2 ? Math.min(recoveryCap, 1, player.discard.length)
      : actual === 6 ? Math.min(recoveryCap, 2, player.discard.length) : 0;
  const returnablePlayedPlaceId = canUsePlacePower && [2, 6].includes(actual)
    ? player.playedPlaces[state.pendingPlaceIndex] ?? null
    : null;
  const unselected = heldUnplayedPlaces(player);
  return {
    stage: encounterStage ? 'encounter' : 'place',
    placeId: place,
    effectivePlaceId: actual,
    mustUsePlacePower,
    canUsePlacePower,
    canRecoverPlace: baseAvailable && !mustUsePlacePower,
    recoverCount: baseAvailable && !mustUsePlacePower ? Math.min(1, player.discard.length) : 0,
    recoverablePlaceIds: baseAvailable ? [...player.discard] : [],
    powerRecoverablePlaceIds: canUsePlacePower && [1, 2, 6].includes(actual) ? [...player.discard] : [],
    powerRecoveryCount,
    canReturnPlayedPlace: returnablePlayedPlaceId !== null,
    returnablePlayedPlaceId,
    copyablePlaceIds: canUsePlacePower && actual === 1
      ? copyableLairPlaces(state, player)
      : [],
    roverPlaceIds: canUsePlacePower && actual === 5 ? availableRoverPlaces(state, player) : [],
    healTargetPlayerIds: canUsePlacePower && actual === 9 ? state.huntedOrder.filter((id) => {
      const target = state.players.get(id)!;
      return !target.forfeited && target.will < 3;
    }) : [],
    sourceChoices: canUsePlacePower && actual === 9 ? [
      ...(state.huntedOrder.some((id) => {
        const target = state.players.get(id)!;
        return !target.forfeited && target.will < 3;
      }) ? ['will' as const] : []),
      ...(!state.effects.noSurvival && state.survivalDeck.length + state.survivalDiscard.length > 0 ? ['card' as const] : []),
    ] : [],
    beachChoices: canUsePlacePower && actual === 4 ? (state.beachCharged ? ['launch'] : ['charge']) : [],
    screamDiscardPlaceIds: nextTarget?.cardId === 'scream' && unselected.length >= 2 ? unselected : [],
    screamDiscardCount: nextTarget?.cardId === 'scream' && unselected.length >= 2 ? 2 : 0,
    canLoseWillForScream: nextTarget?.cardId === 'scream',
    toxinSurvivalCardIds: nextTarget?.cardId === 'toxin' ? [...player.survivalHand] : [],
    canContinue: encounterStage || !baseAvailable,
  };
}

export function notAloneSurvivalOptions(state: NotAloneServerState, playerId: string): NotAlonePrivateState['survivalOptions'] {
  const player = hunted(state, playerId);
  const empty: NotAlonePrivateState['survivalOptions'] = {
    sacrificePlaceIds: [], vortexDiscardPlaceIds: [], vortexSelectedPlaceIds: [],
    vortexSelectedPlaceIndexes: [], doubleBackPlaceIds: [], doubleBackPlaceIndexes: [], gatePlaceIds: [], hologramPlaceIds: [],
    wrongTrackCreaturePlaceIds: [], wrongTrackTargetPlaceIds: [],
  };
  if (!player || player.forfeited) return empty;
  return {
    sacrificePlaceIds: heldUnplayedPlaces(player),
    vortexDiscardPlaceIds: player.discard.filter((place) => !state.selectionBlockedPlaces.has(place)),
    vortexSelectedPlaceIds: [...player.selectedPlaces],
    vortexSelectedPlaceIndexes: player.selectedPlaces.map((_, index) => index),
    doubleBackPlaceIds: player.selectedPlaces.filter((_, index) => !player.returnPlayed.has(player.playedPlaces[index]!)),
    doubleBackPlaceIndexes: player.playedPlaces.map((_, index) => index).filter((index) => !player.returnPlayed.has(player.playedPlaces[index]!)),
    gatePlaceIds: copyableGatePlaces(state, player),
    hologramPlaceIds: legalNotAloneTokenMovementDestinations(state, 'artemia'),
    wrongTrackCreaturePlaceIds: legalNotAloneTokenMovementDestinations(state, 'creature'),
    wrongTrackTargetPlaceIds: state.effects.clone ? legalNotAloneTokenMovementDestinations(state, 'target') : [],
  };
}

function moveTokenFootprint(
  current: NotAlonePlaceId[],
  placeIds: NotAlonePlaceId[] | undefined,
  targetPlaceId: NotAlonePlaceId | undefined,
): NotAlonePlaceId[] | null {
  const requested = placeIds ?? (targetPlaceId ? [targetPlaceId] : []);
  if (requested.length !== 1 || !isPlace(requested[0]) || !current.some((place) => notAloneAdjacent(place, requested[0]!))) return null;
  return [requested[0]!];
}

export function playNotAloneSurvival(state: NotAloneServerState, playerId: string, payload: NotAloneSurvivalPayload): NotAloneEngineResult {
  const inReactionWindow = state.phase === 'exploration_reaction' || state.phase === 'hunting_reaction'
    || (state.phase === 'reckoning' && state.pendingPlayerId === null) || state.phase === 'end_of_turn';
  const staleResult = state.phase === 'hunted_planning'
    ? staleWindow(state, payload?.expectedRevision, state.planningWindowRevision)
    : inReactionWindow
    ? staleWindow(state, payload?.expectedRevision, state.reactionWindowRevision)
    : stale(state, payload?.expectedRevision);
  if (staleResult) return staleResult;
  if (state.pendingCardChoice) return reject('Resolve the pending Hunt card choice first');
  if (state.pendingSurvivalChoice) return reject('Choose one of the drawn Survival cards first');
  const player = hunted(state, playerId); const def = payload && NOT_ALONE_SURVIVAL_BY_ID[payload.cardId];
  if (!player || !def || !player.survivalHand.includes(payload.cardId)) return reject('That Survival card is not in your hand');
  if (player.survivalPlayed) return reject('Each Hunted may play one Survival card per round');
  if (!survivalPhaseAllowed(state, def.phase, player)) return reject(`That card is played during phase ${def.phase}`);
  if (!playableNotAloneSurvivalCards(state, playerId).includes(payload.cardId)) return reject('That Survival card has no legal effect now');
  if (['hologram', 'wrong_track'].includes(payload.cardId) && state.phase === 'reckoning' && state.pendingPlayerId !== null) return reject('Move Hunt tokens in the pre-Reckoning reaction window');
  if (payload.placeIds !== undefined && (!Array.isArray(payload.placeIds) || payload.placeIds.some((place) => !isPlace(place)))) return reject('Choose valid Place cards');
  const requested = payload.placeIds ?? [];
  if (payload.cardId === 'adrenaline') player.will = Math.min(3, player.will + 1);
  else if (payload.cardId === 'amplifier') {
    if (!state.beachCharged) return reject('The Beach beacon is not charged');
    state.beachCharged = false;
    if (!state.effects.stasis) state.rescueProgress += 1;
  }
  else if (payload.cardId === 'detector') { if (!player.selectedPlaces.some((place) => state.huntTokens.artemia.includes(place))) return reject('Detector is played when Artemia finds you'); player.ignoreArtemia = true; }
  else if (payload.cardId === 'dodge') {
    if (!player.selectedPlaces.some((place) => state.huntTokens.creature.includes(place)
      || (state.effects.clone && state.huntTokens.target.includes(place)))) return reject('Dodge is played when a Creature token finds you');
    player.ignoreCreature = true;
  }
  else if (payload.cardId === 'double_back') {
    const chosenIndex = payload.placeIndex ?? (player.selectedPlaces.length === 1 ? 0 : undefined);
    if (chosenIndex === undefined || !player.playedPlaces[chosenIndex] || player.returnPlayed.has(player.playedPlaces[chosenIndex]!)) return reject('Choose one physically played Place card');
    player.returnPlayed.add(player.playedPlaces[chosenIndex]!);
  }
  else if (payload.cardId === 'drone') {
    if (!currentPlacePowerAvailable(state, player) || availableRoverPlaces(state, player).length === 0) return reject('Drone requires an available Rover power');
    player.copyPower = 5;
  }
  else if (payload.cardId === 'gate') {
    if (!currentPlacePowerAvailable(state, player) || !payload.targetPlaceId || !copyableGatePlaces(state, player).includes(payload.targetPlaceId)) return reject('Choose an available adjacent Place power');
    player.copyPower = payload.targetPlaceId;
  }
  else if (payload.cardId === 'hologram') {
    if (!tokenMovementStageOpen(state, 'artemia')) return reject('The Artemia encounter has already resolved');
    const moved = moveTokenFootprint(state.huntTokens.artemia, payload.placeIds, payload.targetPlaceId);
    if (!moved || !legalNotAloneTokenMovementDestinations(state, 'artemia').includes(moved[0]!)) return reject('Move Artemia where it changes an unresolved encounter');
    state.huntTokens.artemia = moved;
  }
  else if (payload.cardId === 'ingenuity') state.beachCharged = true;
  else if (payload.cardId === 'sacrifice') { if (requested.length !== 1 || !heldUnplayedPlaces(player).includes(requested[0]!)) return reject('Choose one unplayed Place card to sacrifice'); removeOne(player.placeHand, requested[0]!); player.discard.push(requested[0]!); state.effects.noHuntCard = true; }
  else if (payload.cardId === 'sixth_sense') { if (requested.length !== Math.min(2, player.discard.length) || new Set(requested).size !== requested.length || requested.some((place) => !player.discard.includes(place))) return reject('Choose two discarded Place cards when possible'); recoverPlaces(player, requested, 2); }
  else if (payload.cardId === 'smokescreen') state.effects.smokescreen = true;
  else if (payload.cardId === 'strike_back') { for (let i = 0; i < 2 && state.huntHand.length; i += 1) state.huntDeck.push(state.huntHand.splice(Math.floor(state.rng() * state.huntHand.length), 1)[0]!); }
  else if (payload.cardId === 'vortex') {
    const selectedIndex = payload.placeIndex ?? (payload.targetPlaceId !== undefined
      ? player.selectedPlaces.indexOf(payload.targetPlaceId)
      : player.selectedPlaces.length === 1 ? 0 : -1);
    const replacement = requested[0];
    if (state.phase !== 'hunting_reaction' || selectedIndex < 0 || !player.selectedPlaces[selectedIndex]) return reject('Choose one prepared destination to replace');
    if (requested.length !== 1 || !replacement || !player.discard.includes(replacement)) return reject('Choose one discarded Place card');
    if (state.selectionBlockedPlaces.has(replacement)) return reject('A Force Field blocks that place');
    const replacedPhysicalPlace = player.playedPlaces[selectedIndex];
    if (!replacedPhysicalPlace || !player.placeHand.includes(replacedPhysicalPlace)) return reject('The selected physical Place is no longer available to swap');
    removeOne(player.discard, replacement); removeOne(player.placeHand, replacedPhysicalPlace); player.discard.push(replacedPhysicalPlace);
    player.placeHand.push(replacement); player.placeHand.sort((a, b) => a - b);
    player.selectedPlaces[selectedIndex] = replacement;
    player.playedPlaces[selectedIndex] = replacement;
  }
  else if (payload.cardId === 'wrong_track') {
    if (payload.token === 'target' && (!state.effects.clone || state.huntTokens.target.length === 0)) {
      return reject('Wrong Track may target the Target token only while Clone is active');
    }
    const token = payload.token === 'target' && state.effects.clone ? 'target' : 'creature';
    if (!tokenMovementStageOpen(state, token)) return reject(`The ${token === 'target' ? 'Clone Target' : 'Creature'} encounter has already resolved`);
    const moved = moveTokenFootprint(state.huntTokens[token], payload.placeIds, payload.targetPlaceId);
    if (!moved || !legalNotAloneTokenMovementDestinations(state, token).includes(moved[0]!)) return reject(`Move the ${token === 'target' ? 'Clone Target' : 'Creature'} where it changes an unresolved encounter or Place action`);
    state.huntTokens[token] = moved;
    if (token === 'target') recomputeDisabledPlaces(state);
  }
  removeOne(player.survivalHand, payload.cardId); state.pendingSurvivalDiscard.push(payload.cardId); player.survivalPlayed = true;
  if (['exploration_reaction', 'hunting_reaction', 'reckoning', 'end_of_turn'].includes(state.phase)) {
    state.reactionPasses.clear(); state.reactionPasses.add(playerId);
    state.reactionWindowRevision = state.revision + 1;
  }
  if (state.phase === 'reckoning' && state.pendingPlayerId === null) settleNoActionReckoningCheckpoint(state);
  log(state, `${player.displayName} plays ${def.name}.`); checkWin(state); state.revision += 1; validateNotAloneState(state); return ok();
}

function effectiveHuntCards(state: NotAloneServerState): NotAloneHuntCardId[] {
  return state.activeHuntCards.flatMap((cardId) => {
    if (cardId !== 'flashback') return [cardId];
    return state.copiedHuntCard ? [state.copiedHuntCard] : [];
  });
}

function recomputeDisabledPlaces(state: NotAloneServerState): void {
  state.disabledPlaces = new Set(state.cataclysmPlaces);
  state.selectionBlockedPlaces = new Set(state.forceFieldPlaces);
  if (state.effects.interference) { state.disabledPlaces.add(4); state.disabledPlaces.add(8); }
  const cards = effectiveHuntCards(state);
  if (cards.includes('mirage')) {
    state.huntTokens.target.forEach((place) => state.disabledPlaces.add(place));
  }
}

function openArtefactOrderChoice(state: NotAloneServerState): boolean {
  const stage: NotAloneEncounterStage | undefined = state.reckoningStageIndex < 0
    ? 'place'
    : RECKONING_STAGES[state.reckoningStageIndex];
  if (!stage) return false;
  const queue = state.huntedOrder.filter((id) => {
    const player = state.players.get(id)!;
    if (player.selectedPlaces.length !== 2) return false;
    const signature = player.selectedPlaces.join(',');
    const key = `${id}:${stage}`;
    if (state.artefactStageOrders.get(key)?.signature === signature) return false;
    const eligible = player.selectedPlaces.map((_place, placeIndex) => {
      if (stage === 'place') {
        return !state.resolvedPlaceActions.has(placeSlotKey(id, placeIndex))
          && !hasUnresolvedEncounterAtOrAfter(state, id, placeIndex, 0);
      }
      if (!stageApplies(state, id, placeIndex, stage)
        || state.resolvedEncounterStages.has(encounterSlotKey(id, placeIndex, stage))) return false;
      if (stage === 'target') {
        const prefix = `${placeSlotKey(id, placeIndex)}:`;
        if ([...state.resolvedTargetEffects].some((resolved) => resolved.startsWith(prefix))) return false;
      }
      return true;
    });
    return eligible[0] === true && eligible[1] === true;
  });
  const first = queue.shift();
  if (!first) return false;
  state.pendingCardChoice = {
    kind: 'artefact_order', playerId: first, count: 2, queue,
    artefactStage: stage, artefactSignature: state.players.get(first)!.selectedPlaces.join(','),
  };
  return true;
}

export function playNotAloneHuntCard(state: NotAloneServerState, playerId: string, payload: NotAloneHuntCardPayload): NotAloneEngineResult {
  const staleResult = stale(state, payload?.expectedRevision); if (staleResult) return staleResult;
  if (state.pendingCardChoice) return reject('Resolve the pending Hunt card choice first');
  if (state.pendingSurvivalChoice) return reject('Wait for the pending Survival card choice');
  if (playerId !== state.creaturePlayerId) return reject('Only the Creature may play Hunt cards');
  if (!['hunted_planning', 'exploration_reaction', 'creature_planning', 'reckoning', 'end_of_turn'].includes(state.phase)) return reject('Hunt cards cannot be played now');
  if (state.effects.noHuntCard) return reject('Sacrifice prevents Hunt cards this round');
  const def = payload && NOT_ALONE_HUNT_BY_ID[payload.cardId];
  if (!def || !state.huntHand.includes(payload.cardId)) return reject('That Hunt card is not in your hand');
  if (state.activeHuntCards.length >= state.maxHuntCards) return reject('You have reached this round\'s Hunt card limit');
  if (!playableNotAloneHuntCards(state).includes(payload.cardId)) return reject('That Hunt card has no legal effect now');
  let effectCardId: NotAloneHuntCardId = payload.cardId;
  if (payload.cardId === 'flashback') {
    const previous = state.huntDiscard[state.huntDiscard.length - 1]; if (!previous || previous === 'flashback') return reject('There is no Hunt card to copy');
    effectCardId = previous;
  }
  const effectDef = NOT_ALONE_HUNT_BY_ID[effectCardId];
  if (effectDef.phase === 1 && state.phase !== 'hunted_planning' && state.phase !== 'exploration_reaction') return reject('That Hunt card must be played during Exploration');
  if (effectDef.phase === 2 && state.phase !== 'creature_planning') return reject('That Hunt card must be played during Hunting');
  if (effectDef.phase === 3 && (state.phase !== 'reckoning' || state.pendingPlayerId !== null)) return reject('That card is played in the pre-Reckoning reaction window');
  if (effectDef.phase === 4 && state.phase !== 'end_of_turn') return reject('That card is played during End-of-Turn Actions');
  if (payload.placeIds !== undefined && (!Array.isArray(payload.placeIds) || payload.placeIds.some((place) => !isPlace(place)))) return reject('Choose valid Place cards');
  const places = payload.placeIds ?? [];
  const targetCandidate = payload.targetPlayerId ? hunted(state, payload.targetPlayerId) : null;
  const target = targetCandidate && !targetCandidate.forfeited ? targetCandidate : null;
  if (effectCardId === 'anticipation') { if (!target) return reject('Choose one Hunted'); state.effects.anticipationTarget = target.playerId; }
  else if (effectCardId === 'ascendancy') {
    if (!target || heldUnplayedPlaces(target).length <= 2) return reject('Choose a Hunted holding more than two unplayed Place cards');
    state.pendingCardChoice = { kind: 'ascendancy', playerId: target.playerId, count: heldUnplayedPlaces(target).length - 2, queue: [] };
  }
  else if (effectCardId === 'cataclysm') {
    if (places.length !== 1 || !legalNotAloneCataclysmPlaces(state).includes(places[0]!)) {
      return reject('Choose a Place whose unresolved action can still be disabled');
    }
    state.cataclysmPlaces.add(places[0]!); recomputeDisabledPlaces(state);
  }
  else if (effectCardId === 'despair') {
    state.effects.noSurvival = true;
    for (const huntedId of state.huntedOrder) {
      const huntedPlayer = state.players.get(huntedId)!;
      if (huntedPlayer.selectedPlaces.length === 2 && !huntedPlayer.riverNext) huntedPlayer.artefactNext = true;
      huntedPlayer.selectedPlaces = [];
      huntedPlayer.playedPlaces = [];
      huntedPlayer.returnPlayed.clear();
      huntedPlayer.copyPower = null;
    }
    state.phase = 'hunted_planning';
    state.pendingPlayerId = null;
    state.resolutionQueue = [];
    state.reactionPasses.clear();
    state.planningWindowRevision = state.revision + 1;
    state.artefactStageOrders.clear();
  }
  else if (effectCardId === 'detour') {
    if (!target || places.length !== 1) return reject('Choose a Hunted and destination');
    const matchingIndexes = payload.originPlaceId === undefined
      ? []
      : target.selectedPlaces.flatMap((place, index) => place === payload.originPlaceId ? [index] : []);
    const placeIndex = payload.placeIndex ?? (target.selectedPlaces.length === 1 ? 0 : matchingIndexes.length === 1 ? matchingIndexes[0] : -1);
    const origin = placeIndex === 0 || placeIndex === 1 ? target.selectedPlaces[placeIndex] : undefined;
    if (placeIndex < 0 || !origin
      || (payload.originPlaceId !== undefined && payload.originPlaceId !== origin)
      || !legalNotAloneDetourDestinations(state, target.playerId, placeIndex).includes(places[0]!)) return reject('Choose one unresolved physical slot and an accessible adjacent destination that changes its outcome');
    target.selectedPlaces[placeIndex] = places[0]!;
    state.effects.detourTarget = target.playerId; state.effects.detourPlace = places[0]!;
  }
  else if (effectCardId === 'fierceness') state.effects.fierceness = true;
  else if (effectCardId === 'forbidden_zone') {
    const eligiblePlayerIds = state.huntedOrder.filter((id) => heldUnplayedPlaces(state.players.get(id)!).length > 0);
    if (eligiblePlayerIds.length > 0) {
      state.pendingCardChoice = {
        kind: 'forbidden_zone', playerId: null, count: 1, queue: [], eligiblePlayerIds,
        sealedChoices: new Map(), choiceWindowRevision: state.revision + 1,
      };
    }
  }
  else if (effectCardId === 'force_field') {
    if (state.phase !== 'hunted_planning' || state.huntedOrder.some((id) => state.players.get(id)!.selectedPlaces.length > 0)) {
      return reject('Force Field must be played before any Hunted player selects a destination');
    }
    if (places.length !== 2 || !notAloneAdjacent(places[0]!, places[1]!)) return reject('Choose two adjacent places');
    state.huntTokens.target = places; state.forceFieldPlaces = new Set(places); recomputeDisabledPlaces(state);
    state.planningWindowRevision = state.revision + 1;
  }
  else if (effectCardId === 'interference') { state.effects.interference = true; recomputeDisabledPlaces(state); }
  else if (effectCardId === 'mirage') {
    if (state.huntTokens.target.length > 0) {
      if (places.length > 0 && (places.length !== state.huntTokens.target.length || places.some((place) => !state.huntTokens.target.includes(place)))) return reject('Mirage shares the existing Target footprint');
      recomputeDisabledPlaces(state);
    } else {
      if (places.length !== 0) return reject('Place the shared Target footprint with the Hunt token action');
    }
  }
  else if (effectCardId === 'mutation') state.effects.mutation = true;
  else if (effectCardId === 'persecution') state.effects.persecution = true;
  else if (effectCardId === 'phobia') {
    if (!target || heldUnplayedPlaces(target).length <= 2) return reject('Choose a Hunted holding more than two unplayed Place cards');
    state.pendingCardChoice = { kind: 'phobia', playerId: target.playerId, count: 2, queue: [] };
  }
  else if (effectCardId === 'scream') state.effects.scream = true;
  else if (effectCardId === 'clone') state.effects.clone = true;
  else if (effectCardId === 'stasis') state.effects.stasis = true;
  else if (effectCardId === 'toxin') state.effects.toxin = true;
  else if (effectCardId === 'tracking') state.nextMaxHuntCards = 2;
  if (payload.cardId === 'flashback') state.copiedHuntCard = effectCardId;
  removeOne(state.huntHand, payload.cardId); state.activeHuntCards.push(payload.cardId); state.pendingHuntDiscard.push(payload.cardId);
  if (effectCardId === 'force_field' || effectCardId === 'mirage') recomputeDisabledPlaces(state);
  state.reactionPasses.clear();
  if (state.phase !== 'hunted_planning') state.reactionWindowRevision = state.revision + 1;
  if (state.phase === 'reckoning' && state.pendingPlayerId === null) settleNoActionReckoningCheckpoint(state);
  log(state, `The Creature plays ${def.name}.`); state.revision += 1; startCreaturePlanningIfReady(state); validateNotAloneState(state); return ok();
}

export function placeNotAloneToken(state: NotAloneServerState, playerId: string, token: NotAloneHuntToken, placeIds: NotAlonePlaceId[], expectedRevision?: number): NotAloneEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  if (state.pendingCardChoice) return reject('Resolve the pending Hunt card choice first');
  if (playerId !== state.creaturePlayerId || state.phase !== 'creature_planning') return reject('The Creature places hunt tokens during Hunting');
  if (state.huntPlanLocked) return reject('The Hunt plan is locked for Hunted reactions');
  if (!['creature', 'target', 'artemia'].includes(token) || !Array.isArray(placeIds)) return reject('Choose a valid Hunt token and Place footprint');
  const cards = effectiveHuntCards(state); let needed = 1;
  if (token === 'target' && cards.includes('force_field') && state.huntTokens.target.length) return reject('Force Field fixed the Target footprint before Exploration');
  if (token === 'target') {
    const tokenCards = cards.filter((id) => NOT_ALONE_HUNT_BY_ID[id].token === 'target');
    if (!tokenCards.length) return reject('No Hunt card grants the Target token');
    needed = Math.max(...tokenCards.map((id) => NOT_ALONE_HUNT_BY_ID[id].placeCount ?? 1));
  }
  if (token === 'artemia') {
    const tokenCards = cards.filter((id) => NOT_ALONE_HUNT_BY_ID[id].token === 'artemia');
    if (!state.artemiaAvailable && !tokenCards.length) return reject('The Artemia token is not available this round');
    needed = tokenCards.length ? Math.max(...tokenCards.map((id) => NOT_ALONE_HUNT_BY_ID[id].placeCount ?? 1)) : 1;
  }
  if (!placeIds.every(isPlace) || placeIds.length !== needed || new Set(placeIds).size !== placeIds.length) return reject(`Choose ${needed} place${needed === 1 ? '' : 's'}`);
  if (needed === 2 && !notAloneAdjacent(placeIds[0]!, placeIds[1]!)) return reject('Those places must be adjacent');
  state.huntTokens[token] = [...placeIds];
  if (token === 'target') recomputeDisabledPlaces(state);
  state.reactionPasses.clear();
  state.reactionWindowRevision = state.revision + 1;
  log(state, `The Creature positions the ${token.toUpperCase()} token.`); state.revision += 1; validateNotAloneState(state); return ok();
}

export function chooseNotAloneCardEffect(
  state: NotAloneServerState,
  playerId: string,
  placeIds: NotAlonePlaceId[],
  expectedRevision?: number,
  placeIndexes?: Array<0 | 1>,
): NotAloneEngineResult {
  const pending = state.pendingCardChoice;
  const staleResult = pending?.kind === 'forbidden_zone'
    ? staleWindow(state, expectedRevision, pending.choiceWindowRevision ?? state.revision)
    : stale(state, expectedRevision);
  if (staleResult) return staleResult;
  const player = hunted(state, playerId);
  if (!pending || !player) return reject('It is not your Hunt card choice');
  if (!Array.isArray(placeIds) || placeIds.some((place) => !isPlace(place))) return reject('Choose valid Place cards');
  if (pending.kind === 'forbidden_zone') {
    const eligiblePlayerIds = pending.eligiblePlayerIds ?? [];
    const sealedChoices = pending.sealedChoices ?? new Map<string, NotAlonePlaceId>();
    if (!eligiblePlayerIds.includes(playerId)) return reject('You are not affected by Forbidden Zone');
    if (sealedChoices.has(playerId)) return reject('Your Forbidden Zone choice is already locked');
    const available = heldUnplayedPlaces(player);
    if (placeIds.length !== 1 || !available.includes(placeIds[0]!)) return reject('Choose one available Place card');
    sealedChoices.set(playerId, placeIds[0]!);
    pending.sealedChoices = sealedChoices;
    if (eligiblePlayerIds.every((id) => sealedChoices.has(id))) {
      for (const id of eligiblePlayerIds) {
        const chosenPlayer = state.players.get(id)!;
        const chosenPlace = sealedChoices.get(id)!;
        if (!removeOne(chosenPlayer.placeHand, chosenPlace)) throw new Error('A sealed Forbidden Zone choice became unavailable');
        chosenPlayer.discard.push(chosenPlace);
      }
      state.pendingCardChoice = null;
      log(state, 'Every affected Hunted simultaneously discards a privately chosen Place card to Forbidden Zone.');
    }
    state.revision += 1; validateNotAloneState(state); return ok();
  }
  if (pending.playerId !== playerId) return reject('It is not your Hunt card choice');
  if (pending.kind === 'artefact_order') {
    if (!placeIndexes || placeIndexes.length !== 2 || new Set(placeIndexes).size !== 2 || placeIndexes.some((index) => index !== 0 && index !== 1)) return reject('Choose the order of both physically played Artefact slots');
    if (!pending.artefactStage || !pending.artefactSignature) return reject('The Artefact order window expired');
    state.artefactStageOrders.set(`${playerId}:${pending.artefactStage}`, {
      signature: pending.artefactSignature,
      order: [...placeIndexes],
    });
    const next = pending.queue.shift();
    if (next) {
      pending.playerId = next;
      pending.artefactSignature = state.players.get(next)!.selectedPlaces.join(',');
    }
    else state.pendingCardChoice = null;
    log(state, `${player.displayName} privately orders equal-category Artefact destinations.`);
    state.revision += 1; validateNotAloneState(state); return ok();
  }
  const available = heldUnplayedPlaces(player);
  if (placeIds.length !== pending.count || new Set(placeIds).size !== placeIds.length || placeIds.some((id) => !available.includes(id))) return reject(`Choose exactly ${pending.count} available Place card${pending.count === 1 ? '' : 's'}`);
  if (pending.kind === 'artemia_discard') {
    const place = player.selectedPlaces[state.pendingPlaceIndex];
    if (!place) return reject('The Artemia encounter is no longer available');
    removeOne(player.placeHand, placeIds[0]!); player.discard.push(placeIds[0]!);
    state.pendingCardChoice = null;
    log(state, `${player.displayName} discards a privately chosen Place card to Artemia.`);
    completeArtemiaResolution(state, player, place);
    state.revision += 1; validateNotAloneState(state); return ok();
  }
  if (pending.kind === 'phobia') state.revealedHuntedHands[playerId] = available.filter((id) => !placeIds.includes(id));
  else for (const place of placeIds) { removeOne(player.placeHand, place); player.discard.push(place); }
  const next = pending.queue.shift();
  if (next) { pending.playerId = next; pending.count = 1; }
  else state.pendingCardChoice = null;
  log(state, `${player.displayName} resolves ${pending.kind.replace('_', ' ')}.`); state.revision += 1; validateNotAloneState(state); return ok();
}

function tokenRequired(state: NotAloneServerState, token: 'target' | 'artemia'): boolean {
  if (token === 'artemia' && state.artemiaAvailable) return true;
  return effectiveHuntCards(state).some((id) => NOT_ALONE_HUNT_BY_ID[id].token === token);
}

function requiredTokenPlaceCount(state: NotAloneServerState, token: 'target' | 'artemia'): number {
  const tokenCards = effectiveHuntCards(state).filter((id) => NOT_ALONE_HUNT_BY_ID[id].token === token);
  return tokenCards.length ? Math.max(...tokenCards.map((id) => NOT_ALONE_HUNT_BY_ID[id].placeCount ?? 1)) : 1;
}

function huntPlanComplete(state: NotAloneServerState): boolean {
  return state.huntTokens.creature.length === 1
    && (!tokenRequired(state, 'target') || state.huntTokens.target.length === requiredTokenPlaceCount(state, 'target'))
    && (!tokenRequired(state, 'artemia') || state.huntTokens.artemia.length === requiredTokenPlaceCount(state, 'artemia'));
}

export function lockNotAloneHunt(state: NotAloneServerState, playerId: string, expectedRevision?: number): NotAloneEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  if (playerId !== state.creaturePlayerId || state.phase !== 'creature_planning') return reject('Only the Creature may lock the Hunt plan');
  if (state.pendingCardChoice) return reject('Resolve the pending Hunt card choice first');
  if (!huntPlanComplete(state)) return reject('Place every required Hunt token before locking the Hunt plan');
  state.huntPlanLocked = true; state.phase = 'hunting_reaction'; state.reactionPasses.clear();
  state.reactionWindowRevision = state.revision + 1;
  log(state, 'The Hunt plan is locked. The Hunted may now play phase-2 Survival cards or pass.');
  state.revision += 1; validateNotAloneState(state); return ok();
}

export function revealNotAlone(state: NotAloneServerState, playerId: string, expectedRevision?: number): NotAloneEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  if (state.pendingCardChoice) return reject('Resolve the pending Hunt card choice first');
  if (playerId !== state.creaturePlayerId || state.phase !== 'hunting_reaction' || !state.huntPlanLocked) return reject('Only the Creature can reveal a locked hunt');
  if (state.huntTokens.creature.length !== 1) return reject('Place the Creature token');
  if (tokenRequired(state, 'target') && state.huntTokens.target.length !== requiredTokenPlaceCount(state, 'target')) return reject(`Place the Target token on ${requiredTokenPlaceCount(state, 'target')} place${requiredTokenPlaceCount(state, 'target') === 1 ? '' : 's'}`);
  if (tokenRequired(state, 'artemia') && state.huntTokens.artemia.length !== requiredTokenPlaceCount(state, 'artemia')) return reject(`Place the Artemia token on ${requiredTokenPlaceCount(state, 'artemia')} place${requiredTokenPlaceCount(state, 'artemia') === 1 ? '' : 's'}`);
  if (!everyLiveHuntedPassed(state)) return reject('Wait for every active Hunted player to pass the Hunting reaction window');
  flushPhaseDiscards(state);
  const riverPlayer = state.huntedOrder.find((id) => state.players.get(id)!.riverNext);
  state.reactionPasses.clear();
  if (riverPlayer) {
    state.phase = 'river_choice'; state.pendingPlayerId = riverPlayer;
    log(state, 'The Hunt is locked. Each affected Hunted now chooses the real River destination.');
  } else {
    state.phase = 'reckoning'; state.pendingPlayerId = null; state.reactionWindowRevision = state.revision + 1;
    log(state, 'The Hunted reveal their destinations. The reaction window opens.');
    settleNoActionReckoningCheckpoint(state);
  }
  state.revision += 1; validateNotAloneState(state); return ok();
}

export function beginNotAloneReckoning(state: NotAloneServerState, playerId: string, expectedRevision?: number): NotAloneEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  if (playerId !== state.creaturePlayerId || state.phase !== 'reckoning' || state.pendingPlayerId) return reject('The reveal is already being resolved');
  if (state.pendingCardChoice) return reject('Resolve the pending choice first');
  if (!everyLiveHuntedPassed(state)) return reject('Wait for every active Hunted player to pass the Reckoning reaction window');
  if (openArtefactOrderChoice(state)) {
    log(state, 'Equal-category Artefact destinations must be ordered by their physical played slots.');
    state.revision += 1; validateNotAloneState(state); return ok();
  }
  if (state.reckoningStageIndex < -1) {
    state.reckoningStageIndex = -1; state.resolvedEncounterStages.clear(); state.resolvedTargetEffects.clear(); state.resolvedPlaceActions.clear();
  }
  resumeOrScheduleReckoning(state);
  state.reactionPasses.clear();
  state.revision += 1; validateNotAloneState(state); return ok();
}

const RECKONING_STAGES: readonly Exclude<NotAloneEncounterStage, 'place'>[] = ['target', 'artemia', 'creature'];

function stageApplies(state: NotAloneServerState, playerId: string, placeIndex: number, stage: Exclude<NotAloneEncounterStage, 'place'>): boolean {
  const place = state.players.get(playerId)?.selectedPlaces[placeIndex];
  if (!place) return false;
  if (stage === 'target') return state.huntTokens.target.includes(place);
  if (stage === 'artemia') return state.huntTokens.artemia.includes(place);
  return state.huntTokens.creature.includes(place);
}

function hasUnresolvedEncounterAtOrAfter(state: NotAloneServerState, playerId: string, placeIndex: number, fromIndex: number): boolean {
  return RECKONING_STAGES.some((stage, index) => index >= Math.max(0, fromIndex)
    && stageApplies(state, playerId, placeIndex, stage)
    && !state.resolvedEncounterStages.has(encounterSlotKey(playerId, placeIndex, stage)));
}

function placeActionBlocked(state: NotAloneServerState, player: NotAloneServerPlayer, placeIndex: number): boolean {
  const slot = placeSlotKey(player.playerId, placeIndex);
  return (state.resolvedEncounterStages.has(`${slot}:creature`) && !player.ignoreCreature)
    || (state.resolvedEncounterStages.has(`${slot}:artemia`) && !player.ignoreArtemia)
    || (state.resolvedEncounterStages.has(`${slot}:target`)
      && ((state.effects.clone && !player.ignoreCreature) || state.effects.toxin));
}

function phaseThreeReactionAvailable(state: NotAloneServerState): boolean {
  return playableNotAloneHuntCards(state).length > 0
    || liveHuntedIds(state).some((id) => playableNotAloneSurvivalCards(state, id).length > 0);
}

function pauseCurrentResolution(state: NotAloneServerState): void {
  state.resolutionPaused = true;
  state.pendingPlayerId = null;
  state.pendingPlaceIndex = 0;
  state.pendingStageResolved = false;
  state.reactionPasses.clear();
  state.reactionWindowRevision = state.revision + 1;
  log(state, 'A Phase 3 priority window opens before the next Reckoning event.');
  settleNoActionReckoningCheckpoint(state);
}

function resumeOrScheduleReckoning(state: NotAloneServerState): void {
  if (state.resolutionPaused) {
    const paused = state.resolutionQueue[state.pendingCursor];
    state.resolutionPaused = false;
    if (paused && !state.resolvedEncounterStages.has(encounterSlotKey(paused.playerId, paused.placeIndex, paused.stage))
      && (paused.stage === 'place' || stageApplies(state, paused.playerId, paused.placeIndex, paused.stage))) {
      state.pendingPlayerId = paused.playerId;
      state.pendingPlaceIndex = paused.placeIndex;
      state.pendingStageResolved = false;
      return;
    }
    state.resolutionQueue = [];
    state.pendingCursor = 0;
    state.pendingTargetEffectIndex = 0;
  }
  scheduleNextReckoningEntry(state);
}

function settleNoActionReckoningCheckpoint(state: NotAloneServerState): void {
  let guard = 0;
  while (state.phase === 'reckoning' && state.pendingPlayerId === null && !state.pendingCardChoice
    && !state.pendingSurvivalChoice && !phaseThreeReactionAvailable(state)) {
    if (guard++ > 64) throw new Error('NOT ALONE Reckoning checkpoint did not settle');
    if (openArtefactOrderChoice(state)) return;
    resumeOrScheduleReckoning(state);
    if (state.pendingPlayerId || state.pendingCardChoice || state.phase !== 'reckoning') return;
  }
}

function scheduleNextReckoningEntry(state: NotAloneServerState): void {
  if (state.pendingSurvivalChoice) return;
  while (state.reckoningStageIndex < RECKONING_STAGES.length) {
    if (openArtefactOrderChoice(state)) return;
    const stage = state.reckoningStageIndex >= 0 ? RECKONING_STAGES[state.reckoningStageIndex] : null;
    const category: NotAloneEncounterStage = stage ?? 'place';
    const candidates = state.huntedOrder.flatMap((id, seatIndex) => state.players.get(id)!.selectedPlaces.flatMap((_place, placeIndex) => {
      const slot = placeSlotKey(id, placeIndex);
      const entries: Array<{ playerId: string; placeIndex: number; stage: NotAloneEncounterStage; seatIndex: number }> = [];
      if (stage && stageApplies(state, id, placeIndex, stage)
        && !state.resolvedEncounterStages.has(encounterSlotKey(id, placeIndex, stage))) {
        entries.push({ playerId: id, placeIndex, stage, seatIndex });
      } else if (!state.resolvedPlaceActions.has(slot)
        && !hasUnresolvedEncounterAtOrAfter(state, id, placeIndex, state.reckoningStageIndex)) {
        entries.push({ playerId: id, placeIndex, stage: 'place', seatIndex });
      }
      return entries;
    }))
      .sort((a, b) => {
        if (a.seatIndex !== b.seatIndex) return a.seatIndex - b.seatIndex;
        const player = state.players.get(a.playerId)!;
        const order = state.artefactStageOrders.get(`${a.playerId}:${category}`);
        const chosen = order?.signature === player.selectedPlaces.join(',') ? order.order : [0, 1];
        return chosen.indexOf(a.placeIndex as 0 | 1) - chosen.indexOf(b.placeIndex as 0 | 1);
      })
      .map(({ playerId: queuedPlayerId, placeIndex, stage: queuedStage }) => ({ playerId: queuedPlayerId, placeIndex, stage: queuedStage }));
    if (candidates.length > 0) {
      const first = candidates[0]!;
      state.resolutionQueue = candidates; state.pendingCursor = 0; state.pendingPlayerId = first.playerId;
      state.pendingPlaceIndex = first.placeIndex; state.pendingTargetEffectIndex = 0; state.pendingStageResolved = false;
      return;
    }
    state.reckoningStageIndex += 1;
  }
  flushPhaseDiscards(state);
  state.resolutionQueue = []; state.resolutionPaused = false; state.pendingCursor = 0; state.pendingPlayerId = null; state.pendingPlaceIndex = 0;
  state.phase = 'end_of_turn'; state.reactionPasses.clear(); state.reactionWindowRevision = state.revision + 1;
  log(state, 'Reckoning is complete. End-of-Turn reactions may be played.');
}

function applyPlacePower(state: NotAloneServerState, player: NotAloneServerPlayer, place: NotAlonePlaceId, payload: NotAloneResolvePayload): NotAloneEngineResult {
  let actual = player.copyPower ?? place;
  if (actual === 1 && payload.targetPlaceId) {
    if (!copyableLairPlaces(state, player).includes(payload.targetPlaceId)) {
      return reject('The Lair can only copy an available Place beneath a Creature token');
    }
    actual = payload.targetPlaceId;
  }
  const cap = state.effects.persecution ? 1 : 99;
  if (actual === 1) { const requested = payload.placeIds ?? []; const needed = Math.min(cap, player.discard.length); if (requested.length !== needed || new Set(requested).size !== requested.length || requested.some((id) => !player.discard.includes(id))) return reject(state.effects.persecution ? 'Choose one discarded Place or copy the Place beneath the Creature' : 'Recover every discarded Place or copy the Place beneath the Creature'); recoverPlaces(player, requested, needed); }
  else if (actual === 2) {
    const requested = payload.placeIds ?? []; const needed = Math.min(cap, 1, player.discard.length);
    if (state.effects.persecution) {
      if (requested.length === 0) player.returnPlayed.add(player.playedPlaces[state.pendingPlaceIndex]!);
      else {
        if (requested.length !== 1 || !player.discard.includes(requested[0]!)) return reject('Under Persecution, return the Jungle or recover one discarded Place');
        recoverPlaces(player, requested, 1);
      }
    } else {
      if (requested.length !== needed || new Set(requested).size !== requested.length || requested.some((id) => !player.discard.includes(id))) return reject('Choose one discarded Place card when possible');
      player.returnPlayed.add(player.playedPlaces[state.pendingPlaceIndex]!);
      recoverPlaces(player, requested, needed);
    }
  }
  else if (actual === 3) {
    if (player.artefactNext) return reject('River and Artefact powers cannot both be activated; recover one discarded Place instead');
    player.riverNext = true;
  }
  else if (actual === 4) {
    if (state.usedBeach) return reject('The Beach power was already used this round');
    if (payload.choice === 'charge' && !state.beachCharged) state.beachCharged = true;
    else if (payload.choice === 'launch' && state.beachCharged) { state.beachCharged = false; state.rescueProgress += 1; }
    else return reject(state.beachCharged ? 'Launch the charged Beach marker' : 'Charge the Beach marker');
    state.usedBeach = true;
  } else if (actual === 5) {
    const choice = payload.targetPlaceId; if (!isPlace(choice) || !availableRoverPlaces(state, player).includes(choice)) return reject('Choose an available advanced place');
    state.reserve[choice] -= 1; player.placeHand.push(choice); player.placeHand.sort((a, b) => a - b);
  } else if (actual === 6) {
    const requested = payload.placeIds ?? []; const needed = Math.min(cap, 2, player.discard.length);
    if (state.effects.persecution) {
      if (requested.length === 0) player.returnPlayed.add(player.playedPlaces[state.pendingPlaceIndex]!);
      else {
        if (requested.length !== 1 || !player.discard.includes(requested[0]!)) return reject('Under Persecution, return the Swamp or recover one discarded Place');
        recoverPlaces(player, requested, 1);
      }
    } else {
      if (requested.length !== needed || new Set(requested).size !== requested.length || requested.some((id) => !player.discard.includes(id))) return reject(`Choose ${needed} discarded Place card${needed === 1 ? '' : 's'}`);
      player.returnPlayed.add(player.playedPlaces[state.pendingPlaceIndex]!);
      recoverPlaces(player, requested, needed);
    }
  }
  else if (actual === 7) {
    if (state.effects.noSurvival) return reject('Despair prevents Shelter draws; recover one discarded Place instead');
    if (state.survivalDeck.length + state.survivalDiscard.length === 0) return reject('No Survival card is drawable; recover one discarded Place instead');
    const cards = [drawSurvival(state), drawSurvival(state)].filter((card): card is NotAloneSurvivalCardId => card !== null);
    if (cards.length === 1) player.survivalHand.push(cards[0]!);
    else if (cards.length === 2) state.pendingSurvivalChoice = { playerId: player.playerId, cards };
  }
  else if (actual === 8) {
    if (state.usedWreck) return reject('The Wreck power was already used; recover one discarded Place instead');
    state.usedWreck = true; state.rescueProgress += 1;
  }
  else if (actual === 9) {
    if (payload.choice === 'will') { const target = payload.targetPlayerId ? hunted(state, payload.targetPlayerId) : null; if (!target || target.forfeited || target.will >= 3) return reject('Choose an active wounded Hunted player'); target.will += 1; }
    else if (payload.choice === 'card') {
      if (state.effects.noSurvival) return reject('Despair prevents Survival draws; heal a Hunted or recover one Place');
      if (state.survivalDeck.length + state.survivalDiscard.length === 0) return reject('No Survival card is drawable; heal a Hunted or recover one Place');
      const card = drawSurvival(state); if (card) player.survivalHand.push(card);
    }
    else return reject('Choose a Hunted to heal or draw a Survival card');
  } else if (actual === 10) {
    if (player.riverNext) return reject('River and Artefact powers cannot both be activated; recover one discarded Place instead');
    player.artefactNext = true;
  }
  player.copyPower = null;
  return ok();
}

function advancePending(state: NotAloneServerState): void {
  const current = state.resolutionQueue[state.pendingCursor];
  if (current?.stage === 'place') state.resolvedPlaceActions.add(placeSlotKey(current.playerId, current.placeIndex));
  else if (current) {
    state.resolvedEncounterStages.add(encounterSlotKey(current.playerId, current.placeIndex, current.stage));
    const player = state.players.get(current.playerId)!;
    if (!hasUnresolvedEncounterAtOrAfter(state, current.playerId, current.placeIndex, state.reckoningStageIndex)
      && placeActionBlocked(state, player, current.placeIndex)) {
      state.resolvedPlaceActions.add(placeSlotKey(current.playerId, current.placeIndex));
    }
  }
  state.resolutionQueue = []; state.resolutionPaused = false; state.pendingCursor = 0; state.pendingPlayerId = null; state.pendingPlaceIndex = 0;
  state.pendingTargetEffectIndex = 0; state.pendingStageResolved = false;
  state.reactionPasses.clear(); state.reactionWindowRevision = state.revision + 1;
  log(state, 'The next Phase 3 reaction window opens before Reckoning continues.');
  settleNoActionReckoningCheckpoint(state);
}

function cloneNotAloneState(state: NotAloneServerState): NotAloneServerState {
  return {
    ...state,
    players: new Map([...state.players].map(([id, player]) => [id, {
      ...player,
      placeHand: [...player.placeHand], discard: [...player.discard], survivalHand: [...player.survivalHand],
      selectedPlaces: [...player.selectedPlaces], playedPlaces: [...player.playedPlaces], returnPlayed: new Set(player.returnPlayed),
    }])),
    turnOrder: [...state.turnOrder], huntedOrder: [...state.huntedOrder], reserve: { ...state.reserve },
    survivalDeck: [...state.survivalDeck], survivalDiscard: [...state.survivalDiscard], pendingSurvivalDiscard: [...state.pendingSurvivalDiscard],
    huntDeck: [...state.huntDeck], huntDiscard: [...state.huntDiscard], pendingHuntDiscard: [...state.pendingHuntDiscard], huntHand: [...state.huntHand],
    activeHuntCards: [...state.activeHuntCards],
    huntTokens: { creature: [...state.huntTokens.creature], target: [...state.huntTokens.target], artemia: [...state.huntTokens.artemia] },
    forceFieldPlaces: new Set(state.forceFieldPlaces), selectionBlockedPlaces: new Set(state.selectionBlockedPlaces), disabledPlaces: new Set(state.disabledPlaces),
    cataclysmPlaces: new Set(state.cataclysmPlaces),
    revealedHuntedHands: Object.fromEntries(Object.entries(state.revealedHuntedHands).map(([id, places]) => [id, [...places]])),
    resolutionQueue: state.resolutionQueue.map((entry) => ({ ...entry })),
    pendingSurvivalChoice: state.pendingSurvivalChoice ? { playerId: state.pendingSurvivalChoice.playerId, cards: [...state.pendingSurvivalChoice.cards] } : null,
    pendingCardChoice: state.pendingCardChoice ? {
      ...state.pendingCardChoice,
      queue: [...state.pendingCardChoice.queue],
      eligiblePlayerIds: state.pendingCardChoice.eligiblePlayerIds ? [...state.pendingCardChoice.eligiblePlayerIds] : undefined,
      sealedChoices: state.pendingCardChoice.sealedChoices ? new Map(state.pendingCardChoice.sealedChoices) : undefined,
    } : null,
    artefactStageOrders: new Map([...state.artefactStageOrders].map(([key, value]) => [key, { signature: value.signature, order: [...value.order] }])), resolvedEncounterStages: new Set(state.resolvedEncounterStages), resolvedTargetEffects: new Set(state.resolvedTargetEffects), resolvedPlaceActions: new Set(state.resolvedPlaceActions), reactionPasses: new Set(state.reactionPasses), effects: { ...state.effects },
    log: state.log.map((entry) => ({ ...entry })),
  };
}

function applyCatch(
  state: NotAloneServerState,
  player: NotAloneServerPlayer,
  place: NotAlonePlaceId,
  source: 'clone' | 'creature',
): boolean {
  const amount = Math.min(player.will, 1 + (place === 1 ? 1 : 0) + (state.effects.fierceness ? 1 : 0));
  loseWill(state, player, amount);
  if (checkWin(state)) return true;
  if (!state.creatureCatchAdvanced) {
    state.assimilationProgress += 1; state.creatureCatchAdvanced = true;
    log(state, 'A Creature signal catches the expedition. Assimilation advances.');
    if (checkWin(state)) return true;
  }
  if (!state.effects.anticipationAwarded && state.effects.anticipationTarget === player.playerId) {
    state.effects.anticipationAwarded = true;
    state.assimilationProgress += 1;
    log(state, `${player.displayName} was anticipated beneath a Creature token.`);
    if (checkWin(state)) return true;
  }
  return false;
}

function completeArtemiaResolution(state: NotAloneServerState, player: NotAloneServerPlayer, place: NotAlonePlaceId): void {
  if (state.effects.mutation) {
    loseWill(state, player, 1);
    if (checkWin(state)) return;
  }
  state.pendingStageResolved = true;
  log(state, `${player.displayName} is intercepted at place ${place}.`);
  if (!checkWin(state)) advancePending(state);
}

function nextPendingTargetEffect(
  state: NotAloneServerState,
  place: NotAlonePlaceId,
): { cardId: 'scream' | 'toxin' | 'clone'; index: number } | null {
  if (!state.huntTokens.target.includes(place)) return null;
  const current = state.resolutionQueue[state.pendingCursor];
  if (!current) return null;
  const slot = placeSlotKey(current.playerId, current.placeIndex);
  const cards = effectiveHuntCards(state);
  for (let index = 0; index < cards.length; index += 1) {
    const cardId = cards[index]!;
    if ((cardId === 'scream' || cardId === 'toxin' || cardId === 'clone')
      && !state.resolvedTargetEffects.has(`${slot}:${index}`)) return { cardId, index };
  }
  return null;
}

export function resolveNotAloneLocation(state: NotAloneServerState, playerId: string, payload: NotAloneResolvePayload): NotAloneEngineResult {
  const staleResult = stale(state, payload?.expectedRevision); if (staleResult) return staleResult;
  if (state.pendingCardChoice) return reject('Resolve the pending choice first');
  if (state.pendingSurvivalChoice) return reject('Choose one of the drawn Survival cards first');
  if (state.phase !== 'reckoning' || state.pendingPlayerId !== playerId) return reject('It is not your place to resolve');
  if (!payload || !['power', 'recover', 'copy'].includes(payload.mode)
    || (payload.targetPlaceId !== undefined && !isPlace(payload.targetPlaceId))
    || (payload.placeIds !== undefined && (!Array.isArray(payload.placeIds) || payload.placeIds.some((place) => !isPlace(place))))
    || (payload.huntPlaceIds !== undefined && (!Array.isArray(payload.huntPlaceIds) || payload.huntPlaceIds.some((place) => !isPlace(place))))) return reject('Choose a valid resolution');
  const player = hunted(state, playerId)!; const place = player.selectedPlaces[state.pendingPlaceIndex]; if (!place) return reject('No revealed place to resolve');
  const entry = state.resolutionQueue[state.pendingCursor];
  if (!entry || entry.playerId !== playerId || entry.placeIndex !== state.pendingPlaceIndex) return reject('The resolution queue changed');
  if (payload.mode === 'copy') {
    if (entry.stage !== 'place' || !currentPlacePowerAvailable(state, player)
      || (player.copyPower ?? place) !== 1 || !payload.targetPlaceId
      || !copyableLairPlaces(state, player).includes(payload.targetPlaceId)) return reject('Choose an available Lair copy');
    player.copyPower = payload.targetPlaceId;
    log(state, `${player.displayName} copies Place ${payload.targetPlaceId} with the Lair. Its choices must now be resolved.`);
    state.revision += 1; validateNotAloneState(state); return ok();
  }
  const snapshot = cloneNotAloneState(state);
  const nextTarget = entry.stage === 'target' ? nextPendingTargetEffect(state, place) : null;
  if (nextTarget) {
    if (nextTarget.cardId === 'scream') {
      const screamChoices = payload.huntPlaceIds ?? [];
      const screamAvailable = heldUnplayedPlaces(player);
      if (payload.huntChoice === 'discard' && (screamChoices.length !== 2 || new Set(screamChoices).size !== 2 || screamChoices.some((id) => !screamAvailable.includes(id)))) return reject('Choose two unplayed Place cards to discard for Scream');
      if (payload.huntChoice !== 'discard' && payload.huntChoice !== 'will') return reject('Choose whether Scream discards two Places or costs one Will');
      if (payload.huntChoice === 'will') {
        loseWill(state, player, 1);
        if (checkWin(state)) { state.revision += 1; return ok(); }
      } else for (const placeId of screamChoices) { removeOne(player.placeHand, placeId); player.discard.push(placeId); }
    } else if (nextTarget.cardId === 'toxin') {
      const toxinSurvival = payload.huntSurvivalCardId;
      if (player.survivalHand.length === 0 && toxinSurvival !== undefined) return reject('No Survival card can be discarded for Toxin');
      if (player.survivalHand.length > 0 && (!toxinSurvival || !player.survivalHand.includes(toxinSurvival))) return reject('Choose a Survival card to discard for Toxin');
      if (toxinSurvival) { removeOne(player.survivalHand, toxinSurvival); state.survivalDiscard.push(toxinSurvival); }
      state.resolvedPlaceActions.add(placeSlotKey(playerId, state.pendingPlaceIndex));
    } else {
      if (!player.ignoreCreature) {
        state.resolvedPlaceActions.add(placeSlotKey(playerId, state.pendingPlaceIndex));
        if (applyCatch(state, player, place, 'clone')) { state.revision += 1; return ok(); }
      }
    }
    state.resolvedTargetEffects.add(`${placeSlotKey(playerId, state.pendingPlaceIndex)}:${nextTarget.index}`);
    log(state, `${player.displayName} resolves the ${NOT_ALONE_HUNT_BY_ID[nextTarget.cardId].name} encounter.`);
    if (nextPendingTargetEffect(state, place)) pauseCurrentResolution(state);
    else advancePending(state);
    state.revision += 1; validateNotAloneState(state); return ok();
  }
  if (entry.stage === 'artemia' && !state.pendingStageResolved) {
    if (!player.ignoreArtemia) {
      const available = heldUnplayedPlaces(player);
      if (available.length > 0) {
        state.pendingCardChoice = { kind: 'artemia_discard', playerId, count: 1, queue: [] };
        log(state, `${player.displayName} must privately choose a Place card for Artemia.`);
        state.revision += 1; validateNotAloneState(state); return ok();
      }
      completeArtemiaResolution(state, player, place);
    } else {
      state.pendingStageResolved = true;
      log(state, `${player.displayName} evades Artemia with Detector.`);
      advancePending(state);
    }
    state.revision += 1; validateNotAloneState(state); return ok();
  }
  if (entry.stage === 'creature' && !state.pendingStageResolved) {
    state.pendingStageResolved = true;
    if (!player.ignoreCreature && applyCatch(state, player, place, 'creature')) { state.revision += 1; return ok(); }
    log(state, player.ignoreCreature ? `${player.displayName} evades the Creature with Dodge.` : `${player.displayName} is caught at place ${place}.`);
    advancePending(state);
    state.revision += 1; validateNotAloneState(state); return ok();
  }
  if (entry.stage === 'target') {
    log(state, `${player.displayName} resolves the Target token at place ${place}.`);
    advancePending(state); state.revision += 1; validateNotAloneState(state); return ok();
  }
  if (entry.stage !== 'place' || !currentPlacePowerAvailable(state, player)) {
    state.resolvedPlaceActions.add(placeSlotKey(playerId, state.pendingPlaceIndex));
    log(state, `${player.displayName}'s place ${place} is unavailable.`);
    advancePending(state); state.revision += 1; validateNotAloneState(state); return ok();
  }
  const resolutionOptions = notAloneResolutionOptions(state, playerId);
  if (payload.mode === 'power' && !resolutionOptions?.canUsePlacePower) return reject('That Place power has no legal effect now');
  let result: NotAloneEngineResult;
  if (payload.mode === 'recover') {
    if (player.copyPower !== null) return reject('Resolve the copied Place power before continuing');
    const requested = payload.placeIds ?? []; const needed = Math.min(1, player.discard.length);
    result = requested.length !== needed || new Set(requested).size !== requested.length || requested.some((candidate) => !player.discard.includes(candidate))
      ? reject('Choose one discarded Place card')
      : (recoverPlaces(player, requested, 1), ok());
  } else result = applyPlacePower(state, player, place, payload);
  if (!result.ok) { Object.assign(state, snapshot); return result; }
  state.resolvedPlaceActions.add(placeSlotKey(playerId, state.pendingPlaceIndex));
  log(state, `${player.displayName} resolves place ${place}.`);
  if (checkWin(state)) { state.revision += 1; return ok(); }
  if (state.pendingSurvivalChoice) { state.revision += 1; validateNotAloneState(state); return ok(); }
  advancePending(state); state.revision += 1; validateNotAloneState(state); return ok();
}

export function chooseNotAloneSurvivalCard(state: NotAloneServerState, playerId: string, cardId: NotAloneSurvivalCardId, expectedRevision?: number): NotAloneEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  const pending = state.pendingSurvivalChoice;
  if (state.phase !== 'reckoning' || !pending || pending.playerId !== playerId || state.pendingPlayerId !== playerId) return reject('It is not your Survival card choice');
  if (!pending.cards.includes(cardId)) return reject('Choose one of the two drawn Survival cards');
  const player = hunted(state, playerId)!;
  player.survivalHand.push(cardId);
  const discarded = pending.cards.find((card) => card !== cardId); if (discarded) state.survivalDiscard.push(discarded);
  state.pendingSurvivalChoice = null;
  log(state, `${player.displayName} keeps one Survival card from the Shelter.`);
  advancePending(state); state.revision += 1; validateNotAloneState(state); return ok();
}

function finishNotAloneRound(state: NotAloneServerState): void {
  if (state.pendingSurvivalChoice) throw new Error('Pending Survival choice reached round cleanup');
  for (const id of state.huntedOrder) {
    const player = state.players.get(id)!;
    for (const place of player.playedPlaces) {
      if (!player.returnPlayed.has(place)) { removeOne(player.placeHand, place); if (!player.discard.includes(place)) player.discard.push(place); }
    }
    player.selectedPlaces = []; player.playedPlaces = []; player.survivalPlayed = false; player.ignoreCreature = false; player.ignoreArtemia = false;
    player.copyPower = null; player.returnPlayed.clear(); player.recoveryActionUsed = false;
  }
  state.activeHuntCards = []; state.copiedHuntCard = null;
  while (state.huntHand.length < 3) { const card = drawHunt(state); if (!card) break; state.huntHand.push(card); }
  flushPhaseDiscards(state);
  if (!state.effects.stasis) state.rescueProgress += 1;
  if (checkWin(state)) return;
  for (const id of state.huntedOrder) {
    const player = state.players.get(id)!;
    if (!player.forfeited) continue;
    state.survivalDiscard.push(...player.survivalHand);
    player.survivalHand = [];
    player.riverNext = false; player.artefactNext = false;
    log(state, `${player.displayName}'s forfeited seat leaves active play after this round.`);
  }
  state.huntedOrder = state.huntedOrder.filter((id) => !state.players.get(id)!.forfeited);
  state.turnOrder = [state.creaturePlayerId, ...state.huntedOrder];
  state.roundNumber += 1; state.phase = 'hunted_planning'; state.maxHuntCards = state.nextMaxHuntCards; state.nextMaxHuntCards = 1;
  state.planningWindowRevision = state.revision + 1;
  state.artemiaAvailable = notAloneArtemiaAvailable(state.boardFace, state.rescueProgress, state.rescueGoal);
  state.huntTokens = { creature: [], target: [], artemia: [] }; state.huntPlanLocked = false; state.forceFieldPlaces.clear(); state.selectionBlockedPlaces.clear(); state.disabledPlaces.clear(); state.cataclysmPlaces.clear(); state.revealedHuntedHands = {};
  state.pendingPlayerId = null; state.pendingCursor = 0; state.pendingPlaceIndex = 0; state.pendingTargetEffectIndex = 0; state.pendingStageResolved = false; state.reckoningStageIndex = -1; state.resolvedEncounterStages.clear(); state.resolvedTargetEffects.clear(); state.resolvedPlaceActions.clear(); state.resolutionQueue = []; state.resolutionPaused = false; state.pendingSurvivalChoice = null; state.pendingCardChoice = null; state.artefactStageOrders.clear(); state.reactionPasses.clear();
  state.creatureCatchAdvanced = false; state.exhaustionAdvanced = false; state.usedBeach = false; state.usedWreck = false; state.effects = emptyEffects();
  log(state, `Round ${state.roundNumber}: the Hunted choose new paths.`);
}

export function endNotAloneTurn(state: NotAloneServerState, playerId: string, expectedRevision?: number): NotAloneEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  if (playerId !== state.creaturePlayerId || state.phase !== 'end_of_turn') return reject('Only the Creature may close End-of-Turn Actions');
  if (state.pendingSurvivalChoice) return reject('Wait for the pending Survival card choice');
  if (!everyLiveHuntedPassed(state)) return reject('Wait for every active Hunted player to pass the End-of-Turn reaction window');
  finishNotAloneRound(state);
  state.revision += 1; validateNotAloneState(state); return ok();
}

function finishNotAloneByForfeit(state: NotAloneServerState): void {
  const creature = state.players.get(state.creaturePlayerId)!;
  const activeHunted = state.huntedOrder.filter((id) => !state.players.get(id)!.forfeited);
  state.winner = creature.forfeited ? (activeHunted.length ? 'hunted' : null) : (activeHunted.length ? null : 'creature');
  if (state.winner === null && !creature.forfeited && activeHunted.length > 0) return;
  flushPhaseDiscards(state);
  if (state.pendingSurvivalChoice) state.survivalDiscard.push(...state.pendingSurvivalChoice.cards);
  state.status = 'game_over'; state.phase = 'game_over'; state.endReason = 'forfeit';
  state.pendingPlayerId = null; state.pendingCardChoice = null; state.pendingSurvivalChoice = null; state.reactionPasses.clear();
  log(state, state.winner === 'hunted'
    ? 'The remaining Hunted escape after the Creature forfeits.'
    : state.winner === 'creature'
      ? 'The Creature wins after every Hunted seat forfeits.'
      : 'The expedition ends after every seat forfeits.');
}

export function settleNotAloneAutopilot(state: NotAloneServerState): void {
  let steps = 0;
  while (state.status === 'playing') {
    if (steps++ > 512) throw new Error('NOT ALONE forfeiture autopilot did not settle');
    if (state.pendingCardChoice) {
      const pending = state.pendingCardChoice;
      if (pending.kind === 'forbidden_zone') {
        const playerId = (pending.eligiblePlayerIds ?? []).find((id) => {
          const candidate = state.players.get(id)!;
          return candidate.forfeited && !(pending.sealedChoices?.has(id) ?? false);
        });
        if (!playerId) return;
        const player = state.players.get(playerId)!;
        const choice = heldUnplayedPlaces(player).sort((a, b) => a - b)[0];
        if (!choice) throw new Error('Forfeited Forbidden Zone choice has no legal Place card');
        const result = chooseNotAloneCardEffect(state, playerId, [choice], state.revision);
        if (!result.ok) throw new Error(result.reason);
        continue;
      }
      const player = state.players.get(pending.playerId!)!;
      if (!player.forfeited) return;
      if (pending.kind === 'artefact_order') {
        const result = chooseNotAloneCardEffect(state, player.playerId, [], state.revision, [0, 1]);
        if (!result.ok) throw new Error(result.reason);
        continue;
      }
      const choices = heldUnplayedPlaces(player).sort((a, b) => a - b).slice(0, pending.count);
      const result = chooseNotAloneCardEffect(state, player.playerId, choices, state.revision);
      if (!result.ok) throw new Error(result.reason);
      continue;
    }
    if (state.pendingSurvivalChoice) {
      const pending = state.pendingSurvivalChoice; const player = state.players.get(pending.playerId)!;
      if (!player.forfeited) return;
      const result = chooseNotAloneSurvivalCard(state, player.playerId, [...pending.cards].sort()[0]!, state.revision);
      if (!result.ok) throw new Error(result.reason);
      continue;
    }
    if (state.phase === 'hunted_planning') {
      const player = state.huntedOrder.map((id) => state.players.get(id)!).find((candidate) => candidate.forfeited && candidate.selectedPlaces.length === 0);
      if (!player) return;
      const needed = requiredSelection(player);
      const available = player.placeHand.filter((place) => !state.selectionBlockedPlaces.has(place)).sort((a, b) => a - b);
      if (available.length < needed) {
        const result = giveUpNotAlone(state, player.playerId, state.revision);
        if (!result.ok) throw new Error(result.reason);
      } else {
        const result = selectNotAlonePlaces(state, player.playerId, available.slice(0, needed), state.revision);
        if (!result.ok) throw new Error(result.reason);
      }
      continue;
    }
    if (state.phase === 'river_choice') {
      const player = state.pendingPlayerId ? state.players.get(state.pendingPlayerId) : null;
      if (!player?.forfeited) return;
      const result = chooseNotAloneRiverDestination(state, player.playerId, [...player.selectedPlaces].sort((a, b) => a - b)[0]!, state.revision);
      if (!result.ok) throw new Error(result.reason);
      continue;
    }
    if (state.phase === 'reckoning' && state.pendingPlayerId) {
      const player = state.players.get(state.pendingPlayerId)!;
      if (!player.forfeited) return;
      let options = notAloneResolutionOptions(state, player.playerId);
      if (options?.stage === 'place' && options.mustUsePlacePower && !options.canUsePlacePower) {
        player.copyPower = null;
        options = notAloneResolutionOptions(state, player.playerId);
      }
      let payload: NotAloneResolvePayload = {
        mode: 'recover',
        placeIds: options?.stage === 'place' && options.canRecoverPlace
          ? options.recoverablePlaceIds.slice(0, options.recoverCount)
          : [],
        expectedRevision: state.revision,
      };
      if (options?.screamDiscardCount === 2) {
        payload.huntChoice = 'discard';
        payload.huntPlaceIds = options.screamDiscardPlaceIds.slice(0, 2);
      } else if (options?.canLoseWillForScream) payload.huntChoice = 'will';
      if (options?.toxinSurvivalCardIds.length) payload.huntSurvivalCardId = [...options.toxinSurvivalCardIds].sort()[0];
      if (options?.stage === 'place' && options.mustUsePlacePower && options.canUsePlacePower) {
        payload = { mode: 'power', expectedRevision: state.revision };
        if ([1, 2, 6].includes(options.effectivePlaceId)) payload.placeIds = options.powerRecoverablePlaceIds.slice(0, options.powerRecoveryCount);
        else if (options.effectivePlaceId === 4) payload.choice = options.beachChoices[0];
        else if (options.effectivePlaceId === 5) payload.targetPlaceId = options.roverPlaceIds[0];
        else if (options.effectivePlaceId === 9) {
          payload.choice = options.sourceChoices[0];
          if (payload.choice === 'will') payload.targetPlayerId = options.healTargetPlayerIds[0];
        }
      }
      const result = resolveNotAloneLocation(state, player.playerId, payload);
      if (!result.ok) throw new Error(result.reason);
      continue;
    }
    return;
  }
}

export function forfeitNotAlonePlayers(state: NotAloneServerState, playerIds: string[], expectedRevision?: number): NotAloneEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  if (state.status !== 'playing') return reject('The game is already over');
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length === 0 || uniqueIds.some((id) => !state.players.has(id))) return reject('Choose valid seats to forfeit');
  const newlyForfeited = uniqueIds.map((id) => state.players.get(id)!).filter((player) => !player.forfeited);
  if (newlyForfeited.length === 0) return reject('Every selected seat has already forfeited');
  for (const player of newlyForfeited) {
    player.forfeited = true;
    log(state, player.role === 'hunted'
      ? `${player.displayName} forfeited and cannot win. Legal automatic play finishes only this round, then their seat leaves active play.`
      : `${player.displayName} forfeited as the Creature and cannot be credited with a win.`);
  }
  state.revision += 1;
  finishNotAloneByForfeit(state);
  if (state.status === 'playing') settleNotAloneAutopilot(state);
  validateNotAloneState(state); return ok();
}

export function validateNotAloneState(state: NotAloneServerState): void {
  if (state.players.size < 2 || state.players.size > 7) throw new Error('Invalid Not Alone player count');
  if (!Number.isSafeInteger(state.revision) || state.revision < 0
    || !Number.isSafeInteger(state.roundNumber) || state.roundNumber < 1) throw new Error('Invalid Not Alone revision or round');
  if (state.boardFace !== 'continuous' && state.boardFace !== 'alternating') throw new Error('Invalid Not Alone board face');
  for (const [progress, goal] of [[state.rescueProgress, state.rescueGoal], [state.assimilationProgress, state.assimilationGoal]]) {
    if (!Number.isSafeInteger(progress) || !Number.isSafeInteger(goal) || progress! < 0 || goal! <= 0 || progress! > goal!) throw new Error('Invalid Not Alone track');
  }
  if (state.turnOrder.length > state.players.size || new Set(state.turnOrder).size !== state.turnOrder.length
    || state.turnOrder[0] !== state.creaturePlayerId || state.turnOrder.some((id) => !state.players.has(id))
    || state.huntedOrder.join(',') !== state.turnOrder.slice(1).join(',')) throw new Error('Invalid Not Alone seat order');
  for (const [id, player] of state.players) {
    if (!id.trim() || player.playerId !== id || player.role !== (id === state.creaturePlayerId ? 'creature' : 'hunted')) throw new Error('Invalid Not Alone player identity');
    if (!state.turnOrder.includes(id) && (!player.forfeited || player.role !== 'hunted'
      || player.survivalHand.length || player.selectedPlaces.length || player.playedPlaces.length
      || player.riverNext || player.artefactNext || player.copyPower !== null || player.returnPlayed.size
      || player.survivalPlayed || player.ignoreCreature || player.ignoreArtemia || player.recoveryActionUsed)) throw new Error('Retired Hunted retains active state');
  }
  const goals = notAloneTrackGoals(state.players.size);
  if (state.rescueGoal !== goals.rescue || state.assimilationGoal !== goals.assimilation) throw new Error('Original track goals changed');
  if ((state.status === 'game_over') !== (state.phase === 'game_over')
    || (state.status === 'playing' && (state.winner !== null || state.endReason !== null))
    || (state.status === 'game_over' && (state.pendingPlayerId !== null || state.pendingCardChoice || state.pendingSurvivalChoice))) throw new Error('Invalid Not Alone terminal state');
  if (Object.keys(state.reserve).length !== 10 || Object.entries(state.reserve).some(([id, count]) => !isPlace(Number(id))
    || !Number.isSafeInteger(count) || count < 0 || (Number(id) <= 5 && count !== 0))) throw new Error('Invalid Place reserve');
  if (!state.players.has(state.creaturePlayerId) || state.players.get(state.creaturePlayerId)!.role !== 'creature') throw new Error('Creature missing');
  const allHuntedIds = [...state.players.values()].filter((player) => player.role === 'hunted').map((player) => player.playerId);
  if (state.huntedOrder.some((id) => !allHuntedIds.includes(id))) throw new Error('Hunted order mismatch');
  if (['exploration_reaction', 'creature_planning', 'hunting_reaction', 'river_choice', 'reckoning', 'end_of_turn'].includes(state.phase) && !allHuntedReady(state) && state.phase !== 'river_choice') throw new Error('Post-Exploration phase before selections');
  if (state.pendingPlayerId && !state.huntedOrder.includes(state.pendingPlayerId)) throw new Error('Pending Hunted missing');
  if (state.pendingSurvivalChoice) {
    const pending = state.pendingSurvivalChoice;
    const player = state.players.get(pending.playerId);
    const entry = state.resolutionQueue[state.pendingCursor];
    if (state.status !== 'playing' || state.phase !== 'reckoning' || !player || player.role !== 'hunted'
      || state.pendingPlayerId !== pending.playerId || state.pendingCardChoice
      || pending.cards.length !== 2 || new Set(pending.cards).size !== 2
      || entry?.playerId !== pending.playerId || entry.placeIndex !== state.pendingPlaceIndex || entry.stage !== 'place'
      || !state.resolvedPlaceActions.has(placeSlotKey(pending.playerId, state.pendingPlaceIndex))) {
      throw new Error('Invalid pending Survival card choice state');
    }
  }
  if (state.pendingCardChoice?.kind === 'forbidden_zone') {
    const eligible = state.pendingCardChoice.eligiblePlayerIds ?? [];
    const choices = state.pendingCardChoice.sealedChoices ?? new Map<string, NotAlonePlaceId>();
    if (state.pendingCardChoice.playerId !== null || eligible.length === 0
      || eligible.some((id) => !state.huntedOrder.includes(id))
      || [...choices].some(([id, place]) => !eligible.includes(id)
        || !heldUnplayedPlaces(state.players.get(id)!).includes(place))) {
      throw new Error('Invalid sealed Forbidden Zone choice state');
    }
  } else if (state.pendingCardChoice && (!state.pendingCardChoice.playerId
    || !state.huntedOrder.includes(state.pendingCardChoice.playerId))) {
    throw new Error('Pending card choice Hunted missing');
  }
  if (state.status === 'game_over' && !state.winner && state.endReason !== 'forfeit') throw new Error('Finished track game has no winner');
  if (state.winner === 'creature' && state.players.get(state.creaturePlayerId)!.forfeited) throw new Error('A forfeited Creature cannot win');
  if (state.winner === 'hunted' && !state.huntedOrder.some((id) => !state.players.get(id)!.forfeited)) throw new Error('A forfeited Hunted team cannot win');
  for (const id of allHuntedIds) {
    const player = state.players.get(id)!;
    if (!Number.isSafeInteger(player.will) || player.will < 0 || player.will > 3) throw new Error('Will out of range');
    if ([...player.placeHand, ...player.discard, ...player.selectedPlaces, ...player.playedPlaces, ...player.returnPlayed].some((place) => !isPlace(place))
      || (player.copyPower !== null && !isPlace(player.copyPower))) throw new Error('Unknown Place card');
    if (new Set(player.placeHand).size !== player.placeHand.length || new Set(player.discard).size !== player.discard.length) throw new Error('Duplicate Place card');
    if (player.placeHand.some((place) => player.discard.includes(place))) throw new Error('Place card in hand and discard');
    if (player.selectedPlaces.length !== player.playedPlaces.length) throw new Error('Current and physically played Place slots differ');
    if (new Set(player.playedPlaces).size !== player.playedPlaces.length || player.playedPlaces.some((place) => !player.placeHand.includes(place)
      && !(player.returnPlayed.has(place) && player.discard.includes(place)))) throw new Error('Physically played Place is not in its authoritative owned zone');
    if (player.returnPlayed.size > player.playedPlaces.length || [...player.returnPlayed].some((place) => !player.playedPlaces.includes(place))) throw new Error('Returned Place marker is not physically played');
  }
  const survivalCards = [
    ...state.survivalDeck, ...state.survivalDiscard, ...state.pendingSurvivalDiscard,
    ...(state.pendingSurvivalChoice?.cards ?? []),
    ...allHuntedIds.flatMap((id) => state.players.get(id)!.survivalHand),
  ];
  const huntCards = [...state.huntDeck, ...state.huntDiscard, ...state.pendingHuntDiscard, ...state.huntHand];
  const survivalManifest = NOT_ALONE_SURVIVAL_CARDS.map((card) => card.id).sort();
  const huntManifest = NOT_ALONE_HUNT_CARDS.map((card) => card.id).sort();
  if (survivalCards.length !== survivalManifest.length || new Set(survivalCards).size !== survivalCards.length
    || [...survivalCards].sort().join(',') !== survivalManifest.join(',')) throw new Error('Survival card manifest is not conserved');
  if (huntCards.length !== huntManifest.length || new Set(huntCards).size !== huntCards.length
    || [...huntCards].sort().join(',') !== huntManifest.join(',')) throw new Error('Hunt card manifest is not conserved');
  const advancedCopies = notAloneAdvancedCopies(allHuntedIds.length);
  for (const id of allHuntedIds) {
    const player = state.players.get(id)!;
    for (const basic of [1, 2, 3, 4, 5] as NotAlonePlaceId[]) {
      if (player.placeHand.filter((place) => place === basic).length + player.discard.filter((place) => place === basic).length !== 1) {
        throw new Error(`Basic Place ${basic} is not conserved for ${id}`);
      }
    }
  }
  for (const advanced of [6, 7, 8, 9, 10] as NotAlonePlaceId[]) {
    const owned = allHuntedIds.reduce((total, id) => {
      const player = state.players.get(id)!;
      return total + player.placeHand.filter((place) => place === advanced).length + player.discard.filter((place) => place === advanced).length;
    }, 0);
    if (owned + state.reserve[advanced] !== advancedCopies) throw new Error(`Advanced Place ${advanced} is not conserved`);
  }
}
