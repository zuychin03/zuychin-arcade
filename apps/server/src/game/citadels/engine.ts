import type {
  CitadelsDistrictCard, CitadelsDistrictColor, CitadelsRole, CitadelsScoreBreakdown,
} from '@zuychin-arcade/types';
import {
  CITADELS_CITY_SIZE, CITADELS_MAX_PLAYERS, CITADELS_MIN_PLAYERS,
  CITADELS_ROLE_BY_ID, CITADELS_ROLE_ORDER, CITADELS_RULES_VERSION,
  citadelsFaceUpDiscardCount,
} from '@zuychin-arcade/types';
import { createCitadelsDistrictDeck, shuffleCitadels, type CitadelsRandomSource } from './deck.js';

export interface CitadelsServerPlayer {
  playerId: string;
  displayName: string;
  gold: number;
  hand: CitadelsDistrictCard[];
  city: CitadelsDistrictCard[];
  role: CitadelsRole | null;
  revealedRole: CitadelsRole | null;
  builtThisTurn: number;
  taxUsed: boolean;
  specialUsed: boolean;
  usedDistrictIds: Set<string>;
  lastRoleRank: number;
  score: number | null;
  forfeited: boolean;
}

export interface CitadelsServerState {
  roomCode: string;
  revision: number;
  rulesVersion: string;
  status: 'playing' | 'game_over';
  terminationReason: 'not_enough_players' | null;
  phase: 'drafting' | 'choose_income' | 'choose_cards' | 'action' | 'game_over';
  roundNumber: number;
  players: Map<string, CitadelsServerPlayer>;
  turnOrder: string[];
  crownPlayerId: string;
  draftOrder: string[];
  draftIndex: number;
  draftPlayerId: string | null;
  availableRoles: CitadelsRole[];
  faceUpDiscard: CitadelsRole[];
  faceDownDiscard: CitadelsRole[];
  roleOwners: Map<CitadelsRole, string>;
  calledRoles: CitadelsRole[];
  callIndex: number;
  activePlayerId: string | null;
  activeRole: CitadelsRole | null;
  killedRole: CitadelsRole | null;
  robbedRole: CitadelsRole | null;
  thiefPlayerId: string | null;
  districtDeck: CitadelsDistrictCard[];
  pendingDraw: CitadelsDistrictCard[];
  firstCompletedPlayerId: string | null;
  completionOrder: string[];
  winnerIds: string[];
  scoreBreakdowns: Record<string, CitadelsScoreBreakdown>;
  log: Array<{ id: number; text: string }>;
  nextLogId: number;
  rng: CitadelsRandomSource;
}

export type CitadelsEngineResult = { ok: true } | { ok: false; reason: string };
const ok = (): CitadelsEngineResult => ({ ok: true });
const reject = (reason: string): CitadelsEngineResult => ({ ok: false, reason });

function addLog(state: CitadelsServerState, text: string): void {
  state.log.push({ id: state.nextLogId++, text });
  if (state.log.length > 60) state.log.shift();
}

function stale(state: CitadelsServerState, expectedRevision?: number): CitadelsEngineResult | null {
  return expectedRevision !== undefined && expectedRevision !== state.revision
    ? reject('Game state changed. Please try again.') : null;
}

function drawDistricts(state: CitadelsServerState, count: number): CitadelsDistrictCard[] {
  const drawn: CitadelsDistrictCard[] = [];
  while (drawn.length < count && state.districtDeck.length) drawn.push(state.districtDeck.shift()!);
  return drawn;
}

function returnToBottom(state: CitadelsServerState, cards: CitadelsDistrictCard[]): void {
  state.districtDeck.push(...cards);
}

function playerHasEffect(player: CitadelsServerPlayer, effect: CitadelsDistrictCard['effect']): boolean {
  return player.city.some((card) => card.effect === effect);
}

export function citadelsBuildCost(player: CitadelsServerPlayer, card: CitadelsDistrictCard): number {
  return card.color === 'unique' && card.effect !== 'factory' && playerHasEffect(player, 'factory')
    ? Math.max(0, card.cost - 1)
    : card.cost;
}

function canUseAbilities(state: CitadelsServerState, playerId: string): CitadelsServerPlayer | null {
  return (
    (state.phase === 'choose_income' || state.phase === 'action')
    && state.activePlayerId === playerId
  ) ? state.players.get(playerId) ?? null : null;
}

function transferForfeitedCrown(state: CitadelsServerState): void {
  if (!state.players.get(state.crownPlayerId)!.forfeited) return;
  const index = state.turnOrder.indexOf(state.crownPlayerId);
  for (let offset = 1; offset <= state.turnOrder.length; offset += 1) {
    const nextId = state.turnOrder[(index + offset) % state.turnOrder.length]!;
    if (!state.players.get(nextId)!.forfeited) {
      state.crownPlayerId = nextId;
      addLog(state, `${state.players.get(nextId)!.displayName} receives the departed builder’s crown.`);
      return;
    }
  }
}

function startDraft(state: CitadelsServerState): void {
  transferForfeitedCrown(state);
  for (const id of state.turnOrder) {
    const player = state.players.get(id)!;
    if (player.forfeited) {
      returnToBottom(state, player.hand);
      player.hand = [];
    }
  }
  state.turnOrder = state.turnOrder.filter(id => !state.players.get(id)!.forfeited);
  for (const player of state.players.values()) {
    player.role = null;
    player.revealedRole = null;
    player.builtThisTurn = 0;
    player.taxUsed = false;
    player.specialUsed = false;
    player.usedDistrictIds.clear();
    player.lastRoleRank = 0;
  }
  state.roleOwners.clear();
  state.calledRoles = [];
  state.killedRole = null;
  state.robbedRole = null;
  state.thiefPlayerId = null;
  state.activePlayerId = null;
  state.activeRole = null;
  state.pendingDraw = [];
  state.callIndex = 0;
  const crownIndex = state.turnOrder.indexOf(state.crownPlayerId);
  state.draftOrder = state.turnOrder.map((_, offset) => state.turnOrder[(crownIndex + offset) % state.turnOrder.length]!);
  state.draftIndex = 0;
  state.draftPlayerId = state.draftOrder[0]!;

  const roles = shuffleCitadels(CITADELS_ROLE_ORDER, state.rng);
  state.faceUpDiscard = [];
  for (let index = 0; index < citadelsFaceUpDiscardCount(state.turnOrder.length); index += 1) {
    const legalFaceUp = roles.filter((role) => role !== 'king');
    const role = legalFaceUp[Math.floor(state.rng() * legalFaceUp.length)]!;
    state.faceUpDiscard.push(role);
    roles.splice(roles.indexOf(role), 1);
  }
  state.faceDownDiscard = [roles.shift()!];
  state.availableRoles = roles;
  state.phase = 'drafting';
  addLog(state, `Round ${state.roundNumber}: ${state.players.get(state.crownPlayerId)!.displayName} opens the secret character draft.`);
}

export function initCitadelsGame(
  roomCode: string,
  playerList: Array<{ playerId: string; displayName: string }>,
  rng: CitadelsRandomSource = Math.random,
): CitadelsServerState {
  if (playerList.length < CITADELS_MIN_PLAYERS || playerList.length > CITADELS_MAX_PLAYERS) {
    throw new Error(`Citadels needs ${CITADELS_MIN_PLAYERS}-${CITADELS_MAX_PLAYERS} players`);
  }
  if (playerList.some((player) => !player.playerId) || new Set(playerList.map((player) => player.playerId)).size !== playerList.length) {
    throw new Error('Citadels player IDs must be non-empty and unique');
  }
  const deck = createCitadelsDistrictDeck(rng);
  const players = new Map<string, CitadelsServerPlayer>();
  for (const player of playerList) {
    players.set(player.playerId, {
      ...player, gold: 2, hand: deck.splice(0, 4), city: [], role: null, revealedRole: null,
      builtThisTurn: 0, taxUsed: false, specialUsed: false, usedDistrictIds: new Set(),
      lastRoleRank: 0, score: null, forfeited: false,
    });
  }
  const crownPlayerId = playerList[Math.floor(rng() * playerList.length)]!.playerId;
  const state: CitadelsServerState = {
    roomCode, revision: 0, rulesVersion: CITADELS_RULES_VERSION, status: 'playing', terminationReason: null, phase: 'drafting',
    roundNumber: 1, players, turnOrder: playerList.map((player) => player.playerId), crownPlayerId,
    draftOrder: [], draftIndex: 0, draftPlayerId: null, availableRoles: [], faceUpDiscard: [], faceDownDiscard: [],
    roleOwners: new Map(), calledRoles: [], callIndex: 0, activePlayerId: null, activeRole: null,
    killedRole: null, robbedRole: null, thiefPlayerId: null, districtDeck: deck, pendingDraw: [],
    firstCompletedPlayerId: null, completionOrder: [], winnerIds: [], scoreBreakdowns: {},
    log: [], nextLogId: 1, rng,
  };
  startDraft(state);
  validateCitadelsState(state);
  return state;
}

export function chooseCharacter(
  state: CitadelsServerState, playerId: string, role: CitadelsRole, expectedRevision?: number,
): CitadelsEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  if (state.phase !== 'drafting') return reject('The character draft is closed');
  if (state.draftPlayerId !== playerId) return reject('It is not your turn to draft');
  if (!CITADELS_ROLE_ORDER.includes(role) || !state.availableRoles.includes(role)) return reject('That character is not available');
  const player = state.players.get(playerId); if (!player) return reject('Player is not in this game');

  state.availableRoles.splice(state.availableRoles.indexOf(role), 1);
  player.role = role;
  state.roleOwners.set(role, playerId);
  addLog(state, `${player.displayName} chose a character.`);
  state.draftIndex += 1;
  if (state.draftIndex >= state.draftOrder.length) {
    state.faceDownDiscard.push(...state.availableRoles);
    state.availableRoles = [];
    state.draftPlayerId = null;
    state.callIndex = 0;
    advanceRoleCall(state);
  } else {
    if (state.turnOrder.length === 7 && state.draftIndex === state.draftOrder.length - 1) {
      state.availableRoles.push(...state.faceDownDiscard);
      state.faceDownDiscard = [];
      state.availableRoles = shuffleCitadels(state.availableRoles, state.rng);
    }
    state.draftPlayerId = state.draftOrder[state.draftIndex]!;
  }
  state.revision += 1;
  validateCitadelsState(state);
  return ok();
}

function beginRoleTurn(state: CitadelsServerState, role: CitadelsRole, playerId: string): void {
  const player = state.players.get(playerId)!;
  player.revealedRole = role;
  player.lastRoleRank = CITADELS_ROLE_BY_ID[role].rank;
  player.builtThisTurn = 0;
  player.taxUsed = false;
  player.specialUsed = false;
  player.usedDistrictIds.clear();
  state.activeRole = role;
  state.activePlayerId = playerId;
  if (role === 'king' && !player.forfeited) {
    state.crownPlayerId = playerId;
    addLog(state, `${player.displayName} reveals the King and takes the crown.`);
  } else addLog(state, `${player.displayName} reveals the ${CITADELS_ROLE_BY_ID[role].name}.`);
  if (role === state.robbedRole && state.thiefPlayerId) {
    const thief = state.players.get(state.thiefPlayerId)!;
    const stolen = player.gold;
    player.gold = 0;
    thief.gold += stolen;
    addLog(state, `The Thief takes ${stolen} gold from ${player.displayName}.`);
  }
  if (role === 'merchant') {
    player.gold += 1;
    player.specialUsed = true;
    addLog(state, `${player.displayName} gains the Merchant's extra gold.`);
  }
  state.phase = 'choose_income';
}

function advanceRoleCall(state: CitadelsServerState): void {
  state.activePlayerId = null;
  state.activeRole = null;
  while (state.callIndex < CITADELS_ROLE_ORDER.length) {
    const role = CITADELS_ROLE_ORDER[state.callIndex++]!;
    state.calledRoles.push(role);
    const ownerId = state.roleOwners.get(role);
    if (!ownerId) {
      addLog(state, `${CITADELS_ROLE_BY_ID[role].name} is called, but no one answers.`);
      continue;
    }
    if (role === state.killedRole) {
      addLog(state, `${CITADELS_ROLE_BY_ID[role].name} is called, but no one answers.`);
      continue;
    }
    beginRoleTurn(state, role, ownerId);
    return;
  }
  finishRound(state);
}

export function chooseIncome(
  state: CitadelsServerState, playerId: string, choice: 'gold' | 'cards', expectedRevision?: number,
): CitadelsEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  if (state.phase !== 'choose_income' || state.activePlayerId !== playerId) return reject('You cannot collect income now');
  const player = state.players.get(playerId)!;
  if (choice === 'gold') {
    const amount = playerHasEffect(player, 'gold_mine') ? 3 : 2;
    player.gold += amount;
    state.phase = 'action';
    addLog(state, `${player.displayName} takes ${amount} gold${amount === 3 ? ' with the Gold Mine' : ''}.`);
  } else if (choice === 'cards') {
    const drawCount = playerHasEffect(player, 'observatory') ? 3 : 2;
    state.pendingDraw = drawDistricts(state, drawCount);
    if (playerHasEffect(player, 'library') || state.pendingDraw.length <= 1) {
      player.hand.push(...state.pendingDraw);
      addLog(state, playerHasEffect(player, 'library')
        ? `${player.displayName} keeps all ${state.pendingDraw.length} districts with the Library.`
        : `${player.displayName} finds ${state.pendingDraw.length} district plan${state.pendingDraw.length === 1 ? '' : 's'}.`);
      state.pendingDraw = [];
      state.phase = 'action';
    } else {
      state.phase = 'choose_cards';
      addLog(state, `${player.displayName} studies ${drawCount} district plans.`);
    }
  } else return reject('Choose gold or district cards');
  state.revision += 1;
  validateCitadelsState(state);
  return ok();
}

export function keepDistrict(
  state: CitadelsServerState, playerId: string, cardId: string, expectedRevision?: number,
): CitadelsEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  if (state.phase !== 'choose_cards' || state.activePlayerId !== playerId) return reject('There are no income cards to choose');
  const index = state.pendingDraw.findIndex((card) => card.id === cardId);
  if (index < 0) return reject('That district is not among the drawn cards');
  const [kept] = state.pendingDraw.splice(index, 1);
  state.players.get(playerId)!.hand.push(kept!);
  returnToBottom(state, state.pendingDraw);
  state.pendingDraw = [];
  state.phase = 'action';
  addLog(state, `${state.players.get(playerId)!.displayName} keeps one district plan.`);
  state.revision += 1;
  validateCitadelsState(state);
  return ok();
}

function activeActionPlayer(state: CitadelsServerState, playerId: string): CitadelsServerPlayer | null {
  return state.phase === 'action' && state.activePlayerId === playerId ? state.players.get(playerId) ?? null : null;
}

export function buildDistrict(
  state: CitadelsServerState, playerId: string, cardId: string, expectedRevision?: number,
): CitadelsEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  const player = activeActionPlayer(state, playerId); if (!player) return reject('You cannot build now');
  const limit = player.role === 'architect' ? 3 : 1;
  if (player.builtThisTurn >= limit) return reject('You have reached this turn’s building limit');
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index < 0) return reject('That district is not in your hand');
  const card = player.hand[index]!;
  if (player.forfeited && player.city.length >= CITADELS_CITY_SIZE - 1) return reject('A forfeited seat cannot complete a city');
  if (player.city.some((district) => district.name === card.name)) return reject('Your city cannot contain duplicate district names');
  const price = citadelsBuildCost(player, card);
  if (player.gold < price) return reject('You do not have enough gold');
  player.gold -= price;
  player.hand.splice(index, 1);
  player.city.push(card);
  player.builtThisTurn += 1;
  if (player.city.length >= CITADELS_CITY_SIZE && !state.completionOrder.includes(playerId)) {
    state.completionOrder.push(playerId);
    state.firstCompletedPlayerId ??= playerId;
  }
  addLog(state, `${player.displayName} builds ${card.name} for ${price} gold${price < card.cost ? ' with the Factory' : ''}.`);
  state.revision += 1;
  validateCitadelsState(state);
  return ok();
}

function taxColor(role: CitadelsRole | null): CitadelsDistrictColor | null {
  if (role === 'king') return 'noble';
  if (role === 'bishop') return 'religious';
  if (role === 'merchant') return 'trade';
  if (role === 'warlord') return 'military';
  return null;
}

export function useCharacterPower(
  state: CitadelsServerState,
  playerId: string,
  payload: { action: string; targetRole?: CitadelsRole; targetPlayerId?: string; cardIds?: string[]; districtId?: string },
  expectedRevision?: number,
): CitadelsEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  const player = canUseAbilities(state, playerId); if (!player) return reject('You cannot use a character ability now');
  const role = player.role!;
  if (payload.action === 'tax') {
    const color = taxColor(role);
    if (!color) return reject('This character has no district income ability');
    if (player.taxUsed) return reject('District income was already collected');
    const amount = player.city.filter((card) => card.color === color).length + (playerHasEffect(player, 'school_of_magic') ? 1 : 0);
    player.gold += amount;
    player.taxUsed = true;
    addLog(state, `${player.displayName} collects ${amount} gold from ${color} districts.`);
  } else if (payload.action === 'assassinate') {
    if (role !== 'assassin') return reject('Only the Assassin can do that');
    if (player.specialUsed) return reject('Character ability already used');
    if (!payload.targetRole || payload.targetRole === 'assassin' || !CITADELS_ROLE_ORDER.includes(payload.targetRole)) return reject('Choose another character to assassinate');
    state.killedRole = payload.targetRole;
    player.specialUsed = true;
    addLog(state, `The Assassin marks the ${CITADELS_ROLE_BY_ID[payload.targetRole].name}.`);
  } else if (payload.action === 'rob') {
    if (role !== 'thief') return reject('Only the Thief can do that');
    if (player.specialUsed) return reject('Character ability already used');
    if (!payload.targetRole || !CITADELS_ROLE_ORDER.includes(payload.targetRole) || ['assassin', 'thief'].includes(payload.targetRole) || payload.targetRole === state.killedRole) return reject('That character cannot be robbed');
    state.robbedRole = payload.targetRole;
    state.thiefPlayerId = playerId;
    player.specialUsed = true;
    addLog(state, `The Thief sets a trap for the ${CITADELS_ROLE_BY_ID[payload.targetRole].name}.`);
  } else if (payload.action === 'swap_hand') {
    if (role !== 'magician') return reject('Only the Magician can do that');
    if (player.specialUsed) return reject('Character ability already used');
    const target = payload.targetPlayerId ? state.players.get(payload.targetPlayerId) : null;
    if (!target || target.playerId === playerId || !state.turnOrder.includes(target.playerId)) return reject('Choose another current-round player');
    [player.hand, target.hand] = [target.hand, player.hand];
    player.specialUsed = true;
    addLog(state, `${player.displayName} exchanges district plans with ${target.displayName}.`);
  } else if (payload.action === 'redraw_hand') {
    if (role !== 'magician') return reject('Only the Magician can do that');
    if (player.specialUsed) return reject('Character ability already used');
    const cardIds = [...new Set(payload.cardIds ?? [])];
    if (!cardIds.length || cardIds.some((id) => !player.hand.some((card) => card.id === id))) return reject('Choose district cards from your hand');
    const discarded = player.hand.filter((card) => cardIds.includes(card.id));
    player.hand = player.hand.filter((card) => !cardIds.includes(card.id));
    returnToBottom(state, discarded);
    player.hand.push(...drawDistricts(state, discarded.length));
    player.specialUsed = true;
    addLog(state, `${player.displayName} transforms ${discarded.length} district plan${discarded.length === 1 ? '' : 's'}.`);
  } else if (payload.action === 'architect_draw') {
    if (role !== 'architect') return reject('Only the Architect can do that');
    if (player.specialUsed) return reject('Character ability already used');
    const cards = drawDistricts(state, 2);
    player.hand.push(...cards);
    player.specialUsed = true;
    addLog(state, `${player.displayName} gains ${cards.length} extra district card${cards.length === 1 ? '' : 's'} as the Architect.`);
  } else if (payload.action === 'destroy') {
    if (role !== 'warlord') return reject('Only the Warlord can do that');
    if (player.specialUsed) return reject('Character ability already used');
    const target = payload.targetPlayerId ? state.players.get(payload.targetPlayerId) : null;
    if (!target || !state.turnOrder.includes(target.playerId)) return reject('Choose a current-round player’s district');
    if (target.city.length >= CITADELS_CITY_SIZE) return reject('A completed city cannot be attacked');
    if (target.role === 'bishop' && state.killedRole !== 'bishop') return reject('The Bishop’s city is protected');
    const cardIndex = target.city.findIndex((card) => card.id === payload.districtId);
    if (cardIndex < 0) return reject('That district is not in the target city');
    const district = target.city[cardIndex]!;
    if (district.effect === 'keep') return reject('The Keep cannot be destroyed');
    const price = Math.max(0, district.cost - 1) + (district.effect !== 'great_wall' && playerHasEffect(target, 'great_wall') ? 1 : 0);
    if (player.gold < price) return reject('You cannot afford to destroy that district');
    player.gold -= price;
    target.city.splice(cardIndex, 1);
    player.specialUsed = true;
    addLog(state, `${player.displayName} destroys ${target.displayName}’s ${district.name} for ${price} gold.`);
    returnToBottom(state, [district]);
  } else return reject('Unknown character ability');
  state.revision += 1;
  validateCitadelsState(state);
  return ok();
}

export function useDistrictPower(
  state: CitadelsServerState, playerId: string, districtId: string, cardId: string | undefined, expectedRevision?: number,
): CitadelsEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  const player = canUseAbilities(state, playerId); if (!player) return reject('You cannot use a district now');
  const district = player.city.find((card) => card.id === districtId);
  if (!district || !['laboratory', 'smithy'].includes(district.effect ?? '')) return reject('That district has no active ability');
  if (player.usedDistrictIds.has(districtId)) return reject('That district ability was already used this turn');
  if (district.effect === 'laboratory') {
    const index = player.hand.findIndex((card) => card.id === cardId);
    if (index < 0) return reject('Choose a district card to discard');
    const [discarded] = player.hand.splice(index, 1);
    returnToBottom(state, [discarded!]);
    player.gold += 2;
    addLog(state, `${player.displayName} converts a plan into two gold at the Laboratory.`);
  } else {
    if (player.gold < 2) return reject('The Smithy costs two gold to use');
    player.gold -= 2;
    const cards = drawDistricts(state, 3);
    player.hand.push(...cards);
    addLog(state, `${player.displayName} pays two gold to draw ${cards.length} districts at the Smithy.`);
  }
  player.usedDistrictIds.add(districtId);
  state.revision += 1;
  validateCitadelsState(state);
  return ok();
}

export function endCitadelsTurn(
  state: CitadelsServerState, playerId: string, expectedRevision?: number,
): CitadelsEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  const player = activeActionPlayer(state, playerId); if (!player) return reject('You cannot end the turn now');
  addLog(state, `${player.displayName} ends the ${CITADELS_ROLE_BY_ID[player.role!].name} turn.`);
  advanceRoleCall(state);
  state.revision += 1;
  validateCitadelsState(state);
  return ok();
}

function scorePlayer(state: CitadelsServerState, player: CitadelsServerPlayer): CitadelsScoreBreakdown {
  const districtPoints = player.city.reduce((sum, district) => sum + district.cost, 0);
  const baseColors = new Set(player.city.filter((card) => card.color !== 'unique').map((card) => card.color));
  const hasUnique = player.city.some((card) => card.color === 'unique');
  const hasNonHauntedUnique = player.city.some((card) => card.color === 'unique' && card.effect !== 'haunted_city');
  const hasHauntedCity = playerHasEffect(player, 'haunted_city');
  const missingBaseColors = 4 - baseColors.size;
  const hauntedSubstitutesBaseColor = hasHauntedCity && hasNonHauntedUnique && missingBaseColors === 1;
  const diversityBonus = (
    (hasUnique && missingBaseColors === 0)
    || hauntedSubstitutesBaseColor
  ) ? 3 : 0;
  const completionBonus = player.city.length >= CITADELS_CITY_SIZE ? (state.firstCompletedPlayerId === player.playerId ? 4 : 2) : 0;
  let uniqueBonus = 0;
  if (playerHasEffect(player, 'dragon_gate')) uniqueBonus += 2;
  if (playerHasEffect(player, 'imperial_treasury')) uniqueBonus += player.gold;
  if (playerHasEffect(player, 'map_room')) uniqueBonus += player.hand.length;
  if (playerHasEffect(player, 'wishing_well')) {
    uniqueBonus += player.city.filter((district) => district.color === 'unique').length
      - (hauntedSubstitutesBaseColor ? 1 : 0);
  }
  return { districtPoints, diversityBonus, completionBonus, uniqueBonus, total: districtPoints + diversityBonus + completionBonus + uniqueBonus };
}

function finishRound(state: CitadelsServerState): void {
  if (state.killedRole === 'king') {
    const murderedKing = state.roleOwners.get('king');
    if (murderedKing) {
      state.players.get(murderedKing)!.revealedRole = 'king';
      state.players.get(murderedKing)!.lastRoleRank = CITADELS_ROLE_BY_ID.king.rank;
      if (!state.players.get(murderedKing)!.forfeited) {
        state.crownPlayerId = murderedKing;
        addLog(state, 'The murdered King is revealed and receives the crown for the next round.');
      } else addLog(state, 'The murdered King is revealed, but a forfeited builder cannot receive the crown.');
    }
  }
  const completed = [...state.players.values()].some((player) => (
    !player.forfeited && player.city.length >= CITADELS_CITY_SIZE
  ));
  if (completed) {
    state.status = 'game_over';
    state.phase = 'game_over';
    state.activePlayerId = null;
    state.activeRole = null;
    for (const player of state.players.values()) {
      const breakdown = player.forfeited
        ? { districtPoints: 0, diversityBonus: 0, completionBonus: 0, uniqueBonus: 0, total: 0 }
        : scorePlayer(state, player);
      state.scoreBreakdowns[player.playerId] = breakdown;
      player.score = breakdown.total;
    }
    const eligible = [...state.players.values()].filter((player) => !player.forfeited);
    if (eligible.length === 0) {
      state.winnerIds = [];
      addLog(state, 'The council closed after every builder forfeited.');
      return;
    }
    const highScore = Math.max(...eligible.map((player) => player.score!));
    const tied = eligible.filter((player) => player.score === highScore);
    tied.sort((a, b) => b.lastRoleRank - a.lastRoleRank);
    state.winnerIds = [tied[0]!.playerId];
    addLog(state, `${tied[0]!.displayName} becomes Master Builder with ${highScore} points.`);
    return;
  }
  state.roundNumber += 1;
  startDraft(state);
}

function finishByForfeit(state: CitadelsServerState): void {
  state.status = 'game_over';
  state.terminationReason = 'not_enough_players';
  state.phase = 'game_over';
  state.draftPlayerId = null;
  state.activePlayerId = null;
  state.activeRole = null;
  returnToBottom(state, state.pendingDraw);
  state.pendingDraw = [];
  state.scoreBreakdowns = {};
  for (const player of state.players.values()) player.score = player.forfeited ? 0 : null;
  state.winnerIds = [];
  addLog(state, 'The council ended without a winner because fewer than four eligible builders remain.');
}

function cheapestLegalBuild(player: CitadelsServerPlayer): CitadelsDistrictCard | null {
  if (player.forfeited && player.city.length >= CITADELS_CITY_SIZE - 1) return null;
  return [...player.hand]
    .filter((card) => !player.city.some((district) => district.name === card.name))
    .filter((card) => citadelsBuildCost(player, card) <= player.gold)
    .sort((a, b) => citadelsBuildCost(player, a) - citadelsBuildCost(player, b) || a.id.localeCompare(b.id))[0] ?? null;
}

export function settleCitadelsAutopilot(state: CitadelsServerState): void {
  let steps = 0;
  while (state.status === 'playing') {
    if (steps++ > 512) throw new Error('Citadels forfeiture autopilot did not settle');
    if (state.phase === 'drafting') {
      const player = state.draftPlayerId ? state.players.get(state.draftPlayerId) : null;
      if (!player?.forfeited) return;
      const role = [...state.availableRoles].sort((a, b) => CITADELS_ROLE_BY_ID[a].rank - CITADELS_ROLE_BY_ID[b].rank)[0]!;
      const result = chooseCharacter(state, player.playerId, role, state.revision);
      if (!result.ok) throw new Error(result.reason);
      continue;
    }

    const actor = state.activePlayerId ? state.players.get(state.activePlayerId) : null;
    if (!actor?.forfeited) return;

    if (
      (state.phase === 'choose_income' || state.phase === 'action')
      && actor.role === 'architect'
      && !actor.specialUsed
    ) {
      const result = useCharacterPower(state, actor.playerId, { action: 'architect_draw' }, state.revision);
      if (!result.ok) throw new Error(result.reason);
      continue;
    }
    if (
      (state.phase === 'choose_income' || state.phase === 'action')
      && ['king', 'bishop', 'merchant', 'warlord'].includes(actor.role ?? '')
      && !actor.taxUsed
    ) {
      const result = useCharacterPower(state, actor.playerId, { action: 'tax' }, state.revision);
      if (!result.ok) throw new Error(result.reason);
      continue;
    }
    if (state.phase === 'choose_income') {
      const hasNewName = actor.hand.some((card) => !actor.city.some((district) => district.name === card.name));
      const choice = hasNewName ? 'gold' : 'cards';
      const result = chooseIncome(state, actor.playerId, choice, state.revision);
      if (!result.ok) throw new Error(result.reason);
      continue;
    }
    if (state.phase === 'choose_cards') {
      const card = [...state.pendingDraw]
        .sort((a, b) => Number(actor.city.some((district) => district.name === a.name)) - Number(actor.city.some((district) => district.name === b.name)) || a.cost - b.cost || a.id.localeCompare(b.id))[0];
      if (!card) throw new Error('Citadels forfeiture autopilot has no income card to keep');
      const result = keepDistrict(state, actor.playerId, card.id, state.revision);
      if (!result.ok) throw new Error(result.reason);
      continue;
    }
    if (state.phase === 'action') {
      const card = cheapestLegalBuild(actor);
      const limit = actor.role === 'architect' ? 3 : 1;
      const result = card && actor.builtThisTurn < limit
        ? buildDistrict(state, actor.playerId, card.id, state.revision)
        : endCitadelsTurn(state, actor.playerId, state.revision);
      if (!result.ok) throw new Error(result.reason);
      continue;
    }
    return;
  }
}

export function forfeitCitadelsPlayers(
  state: CitadelsServerState,
  playerIds: string[],
  expectedRevision?: number,
): CitadelsEngineResult {
  const staleResult = stale(state, expectedRevision); if (staleResult) return staleResult;
  if (state.status !== 'playing') return reject('The game is already over');
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length === 0 || uniqueIds.some((playerId) => !state.players.has(playerId))) return reject('Choose valid seats to forfeit');
  const newlyForfeited = uniqueIds.map((playerId) => state.players.get(playerId)!).filter((player) => !player.forfeited);
  if (newlyForfeited.length === 0) return reject('Every selected seat has already forfeited');
  for (const player of newlyForfeited) {
    player.forfeited = true;
    player.score = 0;
    addLog(state, `${player.displayName} forfeited and cannot score or win. Legal autopilot finishes only this round; the seat leaves the next draft.`);
  }
  transferForfeitedCrown(state);
  state.firstCompletedPlayerId = state.completionOrder.find((playerId) => !state.players.get(playerId)!.forfeited) ?? null;
  state.revision += 1;
  if ([...state.players.values()].filter((player) => !player.forfeited).length < CITADELS_MIN_PLAYERS) finishByForfeit(state);
  else settleCitadelsAutopilot(state);
  validateCitadelsState(state);
  return ok();
}

const canonicalDistricts = new Map(createCitadelsDistrictDeck(() => 0.5).map((card) => [card.id, card]));

export function validateCitadelsState(state: CitadelsServerState): void {
  if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !Number.isSafeInteger(state.roundNumber) || state.roundNumber < 1) throw new Error('Invalid revision or round');
  if (state.turnOrder.length < CITADELS_MIN_PLAYERS || state.turnOrder.length > CITADELS_MAX_PLAYERS) throw new Error('Invalid round player count');
  if (new Set(state.turnOrder).size !== state.turnOrder.length) throw new Error('Duplicate player in turn order');
  if (state.turnOrder.some((id) => !state.players.has(id))) throw new Error('Unknown turn-order player');
  if (!state.players.has(state.crownPlayerId)) throw new Error('Crown holder missing');
  const eligible = [...state.players.values()].filter(player => !player.forfeited);
  if (eligible.some(player => !state.turnOrder.includes(player.playerId))) throw new Error('Eligible player missing from turn order');
  if (state.status === 'playing' && (eligible.length < CITADELS_MIN_PLAYERS || state.terminationReason !== null || !state.turnOrder.includes(state.crownPlayerId) || state.players.get(state.crownPlayerId)!.forfeited)) throw new Error('Invalid active council');
  if (state.draftOrder.length !== state.turnOrder.length || new Set(state.draftOrder).size !== state.turnOrder.length || state.draftOrder.some(id => !state.turnOrder.includes(id))) throw new Error('Draft order/round mismatch');
  if ((state.status === 'game_over') !== (state.phase === 'game_over')) throw new Error('Terminal status/phase mismatch');
  if (state.phase === 'drafting' && !state.draftPlayerId) throw new Error('Draft needs an active player');
  if (state.draftPlayerId && !state.turnOrder.includes(state.draftPlayerId)) throw new Error('Archived drafter');
  if (state.activePlayerId && !state.turnOrder.includes(state.activePlayerId)) throw new Error('Archived actor');
  if ([...state.roleOwners.values()].some(id => !state.turnOrder.includes(id))) throw new Error('Archived role owner');
  if (['choose_income', 'choose_cards', 'action'].includes(state.phase) && (!state.activePlayerId || !state.activeRole)) throw new Error('Character phase needs an actor');
  if (state.phase === 'choose_cards' ? state.pendingDraw.length < 2 : state.pendingDraw.length !== 0) throw new Error('Invalid pending district choice');
  if (state.status === 'game_over') {
    if (state.activePlayerId || state.activeRole || state.draftPlayerId) throw new Error('Finished game has a pending actor');
    const expectedWinners = state.terminationReason === 'not_enough_players' ? 0 : 1;
    if (state.winnerIds.length !== expectedWinners) throw new Error('Finished game has invalid winners');
    if (state.terminationReason === 'not_enough_players' && (eligible.length >= CITADELS_MIN_PLAYERS || Object.keys(state.scoreBreakdowns).length !== 0 || eligible.some(player => player.score !== null))) throw new Error('Abandoned council must remain unscored');
    if (state.winnerIds.some((playerId) => !state.players.has(playerId) || state.players.get(playerId)!.forfeited)) throw new Error('An absent or forfeited seat cannot win');
  }
  const cards = [...state.districtDeck, ...state.pendingDraw];
  for (const player of state.players.values()) {
    if (!state.turnOrder.includes(player.playerId) && (!player.forfeited || player.hand.length || player.role || player.revealedRole || player.builtThisTurn || player.lastRoleRank || player.taxUsed || player.specialUsed || player.usedDistrictIds.size)) throw new Error('Archived seat retains live state');
    if (!Number.isSafeInteger(player.gold) || player.gold < 0) throw new Error('Gold must be a non-negative integer');
    if (player.score !== null && (!Number.isSafeInteger(player.score) || player.score < 0)) throw new Error('Invalid player score');
    if (!Number.isSafeInteger(player.builtThisTurn) || player.builtThisTurn < 0 || player.builtThisTurn > 3) throw new Error('Invalid build count');
    if (new Set(player.city.map((card) => card.name)).size !== player.city.length) throw new Error('Duplicate city district');
    cards.push(...player.hand, ...player.city);
  }
  if (cards.length !== canonicalDistricts.size || new Set(cards.map((card) => card.id)).size !== canonicalDistricts.size) throw new Error('District card conservation failed');
  for (const card of cards) {
    const canonical = canonicalDistricts.get(card.id);
    if (!canonical || card.templateId !== canonical.templateId || card.name !== canonical.name || card.color !== canonical.color || card.cost !== canonical.cost || card.effect !== canonical.effect || card.effectText !== canonical.effectText) throw new Error('Canonical district identity failed');
  }
}
