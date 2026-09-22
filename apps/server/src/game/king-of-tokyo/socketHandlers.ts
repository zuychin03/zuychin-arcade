import type { Server, Socket } from 'socket.io';
import type {
  JwtPayload,
  KingOfTokyoActionKind,
  KingOfTokyoActionPayload,
  KingOfTokyoBuyCardPayload,
  KingOfTokyoBuyOwnedCardPayload,
  KingOfTokyoCardInstancePayload,
  KingOfTokyoDeathFromAbovePayload,
  KingOfTokyoDefensePayload,
  KingOfTokyoEndTurnEffectPayload,
  KingOfTokyoFreezeTimePayload,
  KingOfTokyoFirstRollPayload,
  KingOfTokyoHeartAllocationPayload,
  KingOfTokyoOpportunistPayload,
  KingOfTokyoPreferencePayload,
  KingOfTokyoPsychicProbePayload,
  KingOfTokyoResolveDiceResultsPayload,
  KingOfTokyoSetKeptPayload,
  KingOfTokyoUseCardPayload,
  KingOfTokyoYieldPayload,
} from '@zuychin-arcade/types';
import { KING_OF_TOKYO_MIN_PLAYERS } from '@zuychin-arcade/types';
import { saveGameResult } from '../../lib/saveGameResult.js';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import {
  buyLabCard,
  buyOwnedPowerCard,
  buyPowerCard,
  chooseDeathFromAboveTarget,
  decideFreezeTime,
  decideDefense,
  decideHeartAllocation,
  decideOpportunist,
  decidePsychicProbe,
  decideTokyoYield,
  endTurn,
  forfeitPlayers,
  initKingOfTokyoGame,
  prepareDiceResolution,
  resolveDiceResults,
  resolveEndTurnEffect,
  rollDice,
  rollForFirstPlayer,
  sellOwnedPowerCard,
  setKeptDice,
  sweepPowerCards,
  updatePreferences,
  usePowerCard,
  type EngineResult,
  type KingOfTokyoServerState,
} from './engine.js';
import { toKingOfTokyoPublicState } from './publicState.js';

const DIE_FACES = [1, 2, 3, 'energy', 'smash', 'heart'] as const;
const DICE_RESOLUTION_CATEGORIES = ['points', 'energy', 'hearts', 'smash'] as const;
const DEFENCE_MODES = ['off', 'lethal', 'always'] as const;
const TOKEN_PREFERENCES = ['poison', 'shrink'] as const;
const END_TURN_EFFECTS = [
  'poison',
  'metamorph',
  'energy_hoarder',
  'herbivore',
  'rooting_for_underdog',
  'solar_powered',
] as const;
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isExpectedRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_RE.test(value);
}

function isInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isMember<T extends string | number>(value: unknown, values: readonly T[]): value is T {
  return (values as readonly unknown[]).includes(value);
}

export function isKingOfTokyoStartPayload(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.keys(value).length === 0);
}

export function isKingOfTokyoActionPayload(value: unknown): value is KingOfTokyoActionPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['expectedRevision'])
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoFirstRollPayload(value: unknown): value is KingOfTokyoFirstRollPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['expectedRevision', 'rollOffRound'])
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision)
    && hasOwn(value, 'rollOffRound')
    && isInteger(value.rollOffRound, 1, Number.MAX_SAFE_INTEGER);
}

export function isKingOfTokyoSetKeptPayload(value: unknown): value is KingOfTokyoSetKeptPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['keptIndexes', 'expectedRevision'])
    && hasOwn(value, 'keptIndexes')
    && Array.isArray(value.keptIndexes)
    && value.keptIndexes.length <= 128
    && value.keptIndexes.every((index) => isInteger(index, 0, 127))
    && new Set(value.keptIndexes).size === value.keptIndexes.length
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoPsychicProbePayload(value: unknown): value is KingOfTokyoPsychicProbePayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['dieIndex', 'expectedRevision'])
    && hasOwn(value, 'dieIndex')
    && (value.dieIndex === null || isInteger(value.dieIndex, 0, 127))
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoResolveDiceResultsPayload(
  value: unknown,
): value is KingOfTokyoResolveDiceResultsPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['resolutionOrder', 'expectedRevision'])
    && hasOwn(value, 'resolutionOrder')
    && Array.isArray(value.resolutionOrder)
    && value.resolutionOrder.length === DICE_RESOLUTION_CATEGORIES.length
    && value.resolutionOrder.every((category) => isMember(category, DICE_RESOLUTION_CATEGORIES))
    && new Set(value.resolutionOrder).size === DICE_RESOLUTION_CATEGORIES.length
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoHeartAllocationPayload(
  value: unknown,
): value is KingOfTokyoHeartAllocationPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'healingRayUses', 'poisonTokensToRemove', 'shrinkTokensToRemove', 'expectedRevision',
  ]) || !hasOwn(value, 'healingRayUses') || !Array.isArray(value.healingRayUses) ||
      value.healingRayUses.length > 128) return false;
  const dieIndexes = new Set<number>();
  for (const use of value.healingRayUses) {
    if (!isRecord(use)
      || !hasOnlyKeys(use, ['dieIndex', 'targetPlayerId'])
      || !hasOwn(use, 'dieIndex')
      || !isInteger(use.dieIndex, 0, 127)
      || dieIndexes.has(use.dieIndex)
      || !hasOwn(use, 'targetPlayerId')
      || !isIdentifier(use.targetPlayerId)) return false;
    dieIndexes.add(use.dieIndex);
  }
  return hasOwn(value, 'poisonTokensToRemove')
    && isInteger(value.poisonTokensToRemove, 0, 127)
    && hasOwn(value, 'shrinkTokensToRemove')
    && isInteger(value.shrinkTokensToRemove, 0, 127)
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoYieldPayload(value: unknown): value is KingOfTokyoYieldPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['yieldTokyo', 'expectedRevision'])
    && hasOwn(value, 'yieldTokyo')
    && typeof value.yieldTokyo === 'boolean'
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoFreezeTimePayload(value: unknown): value is KingOfTokyoFreezeTimePayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['accept', 'expectedRevision'])
    && hasOwn(value, 'accept')
    && typeof value.accept === 'boolean'
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoDefensePayload(value: unknown): value is KingOfTokyoDefensePayload {
  if (!isRecord(value) || !hasOwn(value, 'kind') || !hasOwn(value, 'expectedRevision') ||
      !isExpectedRevision(value.expectedRevision)) return false;
  if (value.kind === 'camouflage') {
    if (!hasOnlyKeys(value, ['kind', 'changes', 'expectedRevision']) || !Array.isArray(value.changes) ||
        value.changes.length > 128) return false;
    const indexes = new Set<number>();
    for (const change of value.changes) {
      if (!isRecord(change) || !hasOnlyKeys(change, ['dieIndex', 'face']) ||
          !hasOwn(change, 'dieIndex') || !isInteger(change.dieIndex, 0, 127) || indexes.has(change.dieIndex) ||
          !hasOwn(change, 'face') || !isMember(change.face, DIE_FACES)) return false;
      indexes.add(change.dieIndex);
    }
    return true;
  }
  if (value.kind === 'wings') {
    return hasOnlyKeys(value, ['kind', 'use', 'expectedRevision']) && hasOwn(value, 'use') && typeof value.use === 'boolean';
  }
  if (value.kind === 'rapid_healing') {
    return hasOnlyKeys(value, ['kind', 'activations', 'expectedRevision']) && hasOwn(value, 'activations') &&
      isInteger(value.activations, 0, 127);
  }
  return false;
}

export function isKingOfTokyoDeathFromAbovePayload(value: unknown): value is KingOfTokyoDeathFromAbovePayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['targetPlayerId', 'expectedRevision'])
    && hasOwn(value, 'targetPlayerId')
    && isIdentifier(value.targetPlayerId)
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoBuyCardPayload(value: unknown): value is KingOfTokyoBuyCardPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['marketIndex', 'expectedRevision'])
    && hasOwn(value, 'marketIndex')
    && isInteger(value.marketIndex, 0, 2)
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoOpportunistPayload(value: unknown): value is KingOfTokyoOpportunistPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['buy', 'expectedRevision'])
    && hasOwn(value, 'buy')
    && typeof value.buy === 'boolean'
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoCardInstancePayload(value: unknown): value is KingOfTokyoCardInstancePayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['cardInstanceId', 'expectedRevision'])
    && hasOwn(value, 'cardInstanceId')
    && isIdentifier(value.cardInstanceId)
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoBuyOwnedCardPayload(value: unknown): value is KingOfTokyoBuyOwnedCardPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['ownerPlayerId', 'cardInstanceId', 'expectedRevision'])
    && hasOwn(value, 'ownerPlayerId')
    && isIdentifier(value.ownerPlayerId)
    && hasOwn(value, 'cardInstanceId')
    && isIdentifier(value.cardInstanceId)
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoPreferencePayload(value: unknown): value is KingOfTokyoPreferencePayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['defenseMode', 'rapidHealingMode', 'tokenPreference', 'expectedRevision'])
    && (hasOwn(value, 'defenseMode') || hasOwn(value, 'rapidHealingMode') || hasOwn(value, 'tokenPreference'))
    && (!hasOwn(value, 'defenseMode') || isMember(value.defenseMode, DEFENCE_MODES))
    && (!hasOwn(value, 'rapidHealingMode') || isMember(value.rapidHealingMode, DEFENCE_MODES))
    && (!hasOwn(value, 'tokenPreference') || isMember(value.tokenPreference, TOKEN_PREFERENCES))
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoUseCardPayload(value: unknown): value is KingOfTokyoUseCardPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'cardInstanceId',
    'dieIndex',
    'face',
    'targetPlayerId',
    'targetCardInstanceId',
    'expectedRevision',
  ])) return false;
  return hasOwn(value, 'cardInstanceId')
    && isIdentifier(value.cardInstanceId)
    && (!hasOwn(value, 'dieIndex') || isInteger(value.dieIndex, 0, 127))
    && (!hasOwn(value, 'face') || isMember(value.face, DIE_FACES))
    && (!hasOwn(value, 'targetPlayerId') || isIdentifier(value.targetPlayerId))
    && (!hasOwn(value, 'targetCardInstanceId') || isIdentifier(value.targetCardInstanceId))
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isKingOfTokyoEndTurnEffectPayload(value: unknown): value is KingOfTokyoEndTurnEffectPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['effectId', 'expectedRevision'])
    && hasOwn(value, 'effectId')
    && isMember(value.effectId, END_TURN_EFFECTS)
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

function kingOfTokyoState(room: ServerRoom): KingOfTokyoServerState | null {
  return room.game?.id === 'king_of_tokyo' ? room.game.state : null;
}

function getAuthedRoom(socket: Socket): { room: ServerRoom; auth: JwtPayload } | null {
  const auth = socket.data.auth as JwtPayload | undefined;
  if (!auth) return null;
  const room = roomStore.get(auth.roomCode);
  const player = room?.players.get(auth.playerId);
  if (
    !room
    || room.gameId !== 'king_of_tokyo'
    || !player
    || player.hasLeft
    || !player.isConnected
    || player.socketId !== socket.id
    || !socket.rooms.has(room.roomCode)
  ) {
    socket.emit('server_error', { message: 'This connection is not authorised for the room' });
    return null;
  }
  return { room, auth };
}

function emitKingOfTokyoState(io: Server, room: ServerRoom): void {
  const state = kingOfTokyoState(room);
  if (!state) return;
  for (const player of room.players.values()) {
    if (!player.socketId || !player.isConnected || player.hasLeft) continue;
    io.to(player.socketId).emit('game_state', toKingOfTokyoPublicState(state, player.playerId));
  }
}

export function buildKingOfTokyoResult(state: KingOfTokyoServerState) {
  if (state.status !== 'game_over' || state.terminationReason) return null;
  return {
    gameName: 'king_of_tokyo',
    roomCode: state.roomCode,
    players: state.turnOrder.map(id => state.players.get(id)!).filter(player => !player.forfeited).map(player => ({
      playerId: player.playerId,
      displayName: player.displayName,
      score: player.victoryPoints,
      won: player.playerId === state.winnerId,
    })),
  };
}

function finalizeIfOver(io: Server, room: ServerRoom): void {
  const state = kingOfTokyoState(room);
  if (!state || state.status !== 'game_over' || room.status === 'finished') return;
  room.status = 'finished';
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  const result = buildKingOfTokyoResult(state);
  if (result) void saveGameResult(result);
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
}

function isPastReconnectGrace(room: ServerRoom, playerId: string, now: number): boolean {
  const player = room.players.get(playerId);
  return Boolean(
    player
    && !player.hasLeft
    && !player.isConnected
    && player.reconnectDeadlineAt !== null
    && player.reconnectDeadlineAt <= now,
  );
}

function recoverExpiredAbsentees(room: ServerRoom, now = Date.now()): boolean {
  const state = kingOfTokyoState(room);
  if (!state || state.status !== 'playing') return false;
  const ids = state.turnOrder.filter(id => {
    const player = state.players.get(id);
    const seat = room.players.get(id);
    return player && !player.eliminated && (!seat || seat.hasLeft || isPastReconnectGrace(room, id, now));
  });
  if (!ids.length) return false;
  return forfeitPlayers(state, ids, state.revision, Math.random).ok;
}

function settleAndEmit(io: Server, room: ServerRoom): void {
  roomStore.touch(room);
  finalizeIfOver(io, room);
  emitKingOfTokyoState(io, room);
}

function applyEngineCall(io: Server, socket: Socket, room: ServerRoom, action: KingOfTokyoActionKind, result: EngineResult): void {
  if (!result.ok) {
    socket.emit('action_rejected', { reason: result.reason });
    return;
  }
  socket.emit('king_of_tokyo:action_accepted', { action, revision: kingOfTokyoState(room)!.revision });
  settleAndEmit(io, room);
}

export function recoverDisconnectedKingOfTokyoPlayers(io: Server, room: ServerRoom): boolean {
  const changed = recoverExpiredAbsentees(room);
  if (!changed) return false;
  roomStore.touch(room);
  finalizeIfOver(io, room);
  emitKingOfTokyoState(io, room);
  return true;
}

function recoverBeforeAction(io: Server, socket: Socket, room: ServerRoom, expectedRevision: number): boolean {
  if (!recoverDisconnectedKingOfTokyoPlayers(io, room) || expectedRevision === kingOfTokyoState(room)!.revision) return true;
  socket.emit('action_rejected', { reason: 'Your game state is stale; refresh and try again' });
  return false;
}

function rejectInvalidPayload(socket: Socket): void {
  socket.emit('action_rejected', { reason: 'Invalid payload' });
}

export function registerKingOfTokyoHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    if (!context) return;
    const { room, auth } = context;
    if (!isKingOfTokyoStartPayload(payload)) return rejectInvalidPayload(socket);
    if (room.hostPlayerId !== auth.playerId) {
      return socket.emit('action_rejected', { reason: 'Only the host can start the game' });
    }
    if (room.status === 'in_game') {
      return socket.emit('action_rejected', { reason: 'Game already in progress' });
    }
    const connectedPlayers = [...room.players.values()].filter((player) => player.isConnected && !player.hasLeft);
    if (connectedPlayers.length < KING_OF_TOKYO_MIN_PLAYERS) {
      return socket.emit('action_rejected', { reason: `Need at least ${KING_OF_TOKYO_MIN_PLAYERS} players` });
    }

    const previousState = kingOfTokyoState(room);
    const previousWinnerId = previousState?.winnerId;
    const roster = connectedPlayers.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
    }));
    const rematchStarterId = previousWinnerId && roster.some((player) => player.playerId === previousWinnerId)
      ? previousWinnerId
      : undefined;
    if (rematchStarterId) {
      const winnerIndex = roster.findIndex((player) => player.playerId === rematchStarterId);
      if (winnerIndex > 0) roster.push(...roster.splice(0, winnerIndex));
    }
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    room.game = {
      id: 'king_of_tokyo',
      state: initKingOfTokyoGame(room.roomCode, roster, Math.random, rematchStarterId),
    };
    if (previousState) {
      room.game.state.revision = previousState.revision + 1;
      room.game.state.startingRevision = room.game.state.revision;
    }
    room.status = 'in_game';
    roomStore.touch(room);
    socket.emit('king_of_tokyo:action_accepted', { action: 'start_game', revision: room.game.state.revision });
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitKingOfTokyoState(io, room);
  });

  socket.on('king_of_tokyo:roll_for_first', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoFirstRollPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'roll_for_first', rollForFirstPlayer(
      state, context.auth.playerId, Math.random, payload.expectedRevision, payload.rollOffRound,
    ));
  });

  socket.on('king_of_tokyo:roll', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoActionPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'roll', rollDice(
      state, context.auth.playerId, Math.random, payload.expectedRevision,
    ));
  });

  socket.on('king_of_tokyo:set_kept', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoSetKeptPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'set_kept', setKeptDice(
      state, context.auth.playerId, payload.keptIndexes, payload.expectedRevision,
    ));
  });

  socket.on('king_of_tokyo:resolve_dice', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoActionPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'resolve_dice', prepareDiceResolution(
      state, context.auth.playerId, payload.expectedRevision,
    ));
  });

  socket.on('king_of_tokyo:resolve_dice_results', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoResolveDiceResultsPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'resolve_dice_results', resolveDiceResults(
      state,
      context.auth.playerId,
      { resolutionOrder: payload.resolutionOrder },
      payload.expectedRevision,
      Math.random,
    ));
  });

  socket.on('king_of_tokyo:allocate_hearts', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoHeartAllocationPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    const { expectedRevision, ...allocation } = payload;
    applyEngineCall(io, socket, context.room, 'allocate_hearts', decideHeartAllocation(
      state, context.auth.playerId, allocation, expectedRevision, Math.random,
    ));
  });

  socket.on('king_of_tokyo:psychic_probe', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoPsychicProbePayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'psychic_probe', decidePsychicProbe(
      state, context.auth.playerId, payload.dieIndex, Math.random, payload.expectedRevision,
    ));
  });

  socket.on('king_of_tokyo:yield_tokyo', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoYieldPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'yield_tokyo', decideTokyoYield(
      state, context.auth.playerId, payload.yieldTokyo, payload.expectedRevision, Math.random,
    ));
  });

  socket.on('king_of_tokyo:freeze_time', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoFreezeTimePayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'freeze_time', decideFreezeTime(
      state, context.auth.playerId, payload.accept, payload.expectedRevision, Math.random,
    ));
  });

  socket.on('king_of_tokyo:defense', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoDefensePayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    const { expectedRevision, ...decision } = payload;
    applyEngineCall(io, socket, context.room, 'defense', decideDefense(
      state, context.auth.playerId, decision, expectedRevision, Math.random,
    ));
  });

  socket.on('king_of_tokyo:choose_death_from_above_target', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoDeathFromAbovePayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'choose_death_from_above_target', chooseDeathFromAboveTarget(
      state,
      context.auth.playerId,
      payload.targetPlayerId,
      payload.expectedRevision,
      Math.random,
    ));
  });

  socket.on('king_of_tokyo:buy_card', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoBuyCardPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'buy_card', buyPowerCard(
      state, context.auth.playerId, payload.marketIndex, payload.expectedRevision, Math.random,
    ));
  });

  socket.on('king_of_tokyo:sweep_market', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoActionPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'sweep_market', sweepPowerCards(
      state, context.auth.playerId, payload.expectedRevision, Math.random,
    ));
  });

  socket.on('king_of_tokyo:opportunist', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoOpportunistPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'opportunist', decideOpportunist(
      state, context.auth.playerId, payload.buy, payload.expectedRevision, Math.random,
    ));
  });

  socket.on('king_of_tokyo:buy_lab_card', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoActionPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'buy_lab_card', buyLabCard(
      state, context.auth.playerId, payload.expectedRevision, Math.random,
    ));
  });

  socket.on('king_of_tokyo:use_card', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoUseCardPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    const { cardInstanceId, expectedRevision, ...options } = payload;
    applyEngineCall(io, socket, context.room, 'use_card', usePowerCard(
      state, context.auth.playerId, cardInstanceId, options, expectedRevision, Math.random,
    ));
  });

  socket.on('king_of_tokyo:sell_card', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoCardInstancePayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'sell_card', sellOwnedPowerCard(
      state, context.auth.playerId, payload.cardInstanceId, payload.expectedRevision,
    ));
  });

  socket.on('king_of_tokyo:buy_owned_card', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoBuyOwnedCardPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'buy_owned_card', buyOwnedPowerCard(
      state,
      context.auth.playerId,
      payload.ownerPlayerId,
      payload.cardInstanceId,
      payload.expectedRevision,
    ));
  });

  socket.on('king_of_tokyo:preferences', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoPreferencePayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    const { expectedRevision, ...preferences } = payload;
    const result = updatePreferences(state, context.auth.playerId, preferences, expectedRevision);
    applyEngineCall(io, socket, context.room, 'preferences', result);
    if (result.ok) socket.emit('king_of_tokyo:preferences_updated');
  });

  socket.on('king_of_tokyo:end_turn', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoActionPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'end_turn', endTurn(
      state, context.auth.playerId, payload.expectedRevision, Math.random,
    ));
  });

  socket.on('king_of_tokyo:resolve_end_turn_effect', (payload: unknown) => {
    const context = getAuthedRoom(socket);
    const state = context && kingOfTokyoState(context.room);
    if (!context || !state) return;
    if (!isKingOfTokyoEndTurnEffectPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, context.room, payload.expectedRevision)) return;
    applyEngineCall(io, socket, context.room, 'resolve_end_turn_effect', resolveEndTurnEffect(
      state, context.auth.playerId, payload.effectId, payload.expectedRevision, Math.random,
    ));
  });

  socket.on('request_state', () => {
    const context = getAuthedRoom(socket);
    if (!context) return;
    recoverDisconnectedKingOfTokyoPlayers(io, context.room);
    socket.emit('room_updated', getRoomPublicState(context.room));
    const state = kingOfTokyoState(context.room);
    if (state) socket.emit('game_state', toKingOfTokyoPublicState(state, context.auth.playerId));
  });
}
