import type { Server, Socket } from 'socket.io';
import type {
  CitadelsActionKind,
  CitadelsBuildPayload,
  CitadelsChooseIncomePayload,
  CitadelsChooseRolePayload,
  CitadelsDistrictPowerPayload,
  CitadelsEndTurnPayload,
  CitadelsKeepDistrictPayload,
  CitadelsPowerPayload,
  CitadelsRole,
} from '@zuychin-arcade/types';
import {
  CITADELS_MAX_PLAYERS,
  CITADELS_MIN_PLAYERS,
  CITADELS_ROLE_ORDER,
} from '@zuychin-arcade/types';
import { saveGameResult } from '../../lib/saveGameResult.js';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import { getCurrentSocketSession, prepareRoomForStart } from '../../socket/roomLifecycle.js';
import {
  buildDistrict,
  chooseCharacter,
  chooseIncome,
  endCitadelsTurn,
  forfeitCitadelsPlayers,
  initCitadelsGame,
  keepDistrict,
  settleCitadelsAutopilot,
  useCharacterPower,
  useDistrictPower,
  type CitadelsEngineResult,
  type CitadelsServerState,
} from './engine.js';
import { toCitadelsPrivateState, toCitadelsPublicState } from './publicState.js';

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isExpectedRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

function isRole(value: unknown): value is CitadelsRole {
  return typeof value === 'string' && CITADELS_ROLE_ORDER.includes(value as CitadelsRole);
}

export function isCitadelsStartPayload(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.keys(value).length === 0);
}

export function isCitadelsChooseRolePayload(value: unknown): value is CitadelsChooseRolePayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['role', 'expectedRevision'])
    && hasOwn(value, 'role')
    && hasOwn(value, 'expectedRevision')
    && isRole(value.role)
    && isExpectedRevision(value.expectedRevision);
}

export function isCitadelsChooseIncomePayload(value: unknown): value is CitadelsChooseIncomePayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['choice', 'expectedRevision'])
    && hasOwn(value, 'choice')
    && hasOwn(value, 'expectedRevision')
    && (value.choice === 'gold' || value.choice === 'cards')
    && isExpectedRevision(value.expectedRevision);
}

function isCardPayload(value: unknown): value is CitadelsKeepDistrictPayload | CitadelsBuildPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['cardId', 'expectedRevision'])
    && hasOwn(value, 'cardId')
    && hasOwn(value, 'expectedRevision')
    && isId(value.cardId)
    && isExpectedRevision(value.expectedRevision);
}

export function isCitadelsPowerPayload(value: unknown): value is CitadelsPowerPayload {
  if (!isRecord(value) || typeof value.action !== 'string' || !isExpectedRevision(value.expectedRevision)) return false;
  if (value.action === 'tax' || value.action === 'architect_draw') {
    return hasOnlyKeys(value, ['action', 'expectedRevision']);
  }
  if (value.action === 'assassinate' || value.action === 'rob') {
    return hasOnlyKeys(value, ['action', 'targetRole', 'expectedRevision'])
      && hasOwn(value, 'targetRole')
      && isRole(value.targetRole);
  }
  if (value.action === 'swap_hand') {
    return hasOnlyKeys(value, ['action', 'targetPlayerId', 'expectedRevision'])
      && hasOwn(value, 'targetPlayerId')
      && isId(value.targetPlayerId);
  }
  if (value.action === 'redraw_hand') {
    return hasOnlyKeys(value, ['action', 'cardIds', 'expectedRevision'])
      && hasOwn(value, 'cardIds')
      && Array.isArray(value.cardIds)
      && value.cardIds.length > 0
      && value.cardIds.length <= 68
      && value.cardIds.every(isId)
      && new Set(value.cardIds).size === value.cardIds.length;
  }
  if (value.action === 'destroy') {
    return hasOnlyKeys(value, ['action', 'targetPlayerId', 'districtId', 'expectedRevision'])
      && hasOwn(value, 'targetPlayerId')
      && hasOwn(value, 'districtId')
      && isId(value.targetPlayerId)
      && isId(value.districtId);
  }
  return false;
}

export function isCitadelsDistrictPowerPayload(value: unknown): value is CitadelsDistrictPowerPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['districtId', 'cardId', 'expectedRevision'])
    && hasOwn(value, 'districtId')
    && hasOwn(value, 'expectedRevision')
    && isId(value.districtId)
    && (!hasOwn(value, 'cardId') || isId(value.cardId))
    && isExpectedRevision(value.expectedRevision);
}

export function isCitadelsEndTurnPayload(value: unknown): value is CitadelsEndTurnPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['expectedRevision'])
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

function gameState(room: ServerRoom): CitadelsServerState | null {
  return room.game?.id === 'citadels' ? room.game.state : null;
}

function context(socket: Socket) {
  const current = getCurrentSocketSession(socket);
  if (!current || current.room.gameId !== 'citadels') {
    socket.emit('server_error', { message: 'This connection is not authorised for the Citadels room' });
    return null;
  }
  return current;
}

function withState(socket: Socket) {
  const value = context(socket);
  if (!value) return null;
  const state = gameState(value.room);
  if (!state || !state.players.has(value.auth.playerId)) {
    socket.emit('action_rejected', { reason: 'Citadels has not started for this seat' });
    return null;
  }
  return { ...value, state };
}

function emitState(io: Server, room: ServerRoom): void {
  const state = gameState(room);
  if (!state) return;
  io.to(room.roomCode).emit('game_state', toCitadelsPublicState(state));
  for (const player of room.players.values()) {
    if (player.socketId && player.isConnected && !player.hasLeft && state.players.has(player.playerId)) {
      io.to(player.socketId).emit('private_state', toCitadelsPrivateState(state, player.playerId));
    }
  }
}

export function buildCitadelsResult(state: CitadelsServerState) {
  if (state.status !== 'game_over' || state.terminationReason !== null || state.winnerIds.length === 0) return null;
  return {
    gameName: 'citadels',
    roomCode: state.roomCode,
    roundsPlayed: state.roundNumber,
    players: [...state.players.values()].filter(player => !player.forfeited).map((player) => {
      return {
        playerId: player.playerId,
        displayName: player.displayName,
        score: player.score ?? 0,
        won: state.winnerIds.includes(player.playerId),
      };
    }),
  };
}

function finalizeIfOver(io: Server, room: ServerRoom): void {
  const state = gameState(room);
  if (!state || state.status !== 'game_over' || room.status === 'finished') return;
  room.status = 'finished';
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  const result = buildCitadelsResult(state);
  if (result) void saveGameResult(result);
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
}

function emitAccepted(socket: Socket, action: CitadelsActionKind, revision: number): void {
  socket.emit('citadels:action_accepted', { action, revision });
}

function apply(
  io: Server,
  socket: Socket,
  room: ServerRoom,
  action: Exclude<CitadelsActionKind, 'start'>,
  result: CitadelsEngineResult,
): void {
  if (!result.ok) {
    socket.emit('action_rejected', { reason: result.reason });
    return;
  }
  const state = gameState(room)!;
  settleCitadelsAutopilot(state);
  emitAccepted(socket, action, state.revision);
  roomStore.touch(room);
  finalizeIfOver(io, room);
  emitState(io, room);
}

function rejectInvalidPayload(socket: Socket): void {
  socket.emit('action_rejected', { reason: 'Invalid payload' });
}

export function recoverDisconnectedCitadelsPlayers(io: Server, room: ServerRoom): boolean {
  const state = gameState(room);
  if (!state || state.status !== 'playing') return false;
  const now = Date.now();
  const forfeitingPlayerIds = state.turnOrder.filter((playerId) => {
    const gamePlayer = state.players.get(playerId)!;
    const roomPlayer = room.players.get(playerId);
    return !gamePlayer.forfeited && (!roomPlayer || roomPlayer.hasLeft || (
      !roomPlayer.isConnected && roomPlayer.reconnectDeadlineAt !== null
      && roomPlayer.reconnectDeadlineAt <= now
    ));
  });
  if (forfeitingPlayerIds.length === 0) return false;
  const result = forfeitCitadelsPlayers(state, forfeitingPlayerIds, state.revision);
  if (!result.ok) return false;
  for (const playerId of forfeitingPlayerIds) {
    const player = room.players.get(playerId);
    if (!player) continue;
    roomStore.clearPresenceTimer(player);
    player.hasLeft = true;
  }
  if (forfeitingPlayerIds.includes(room.hostPlayerId)) roomStore.transferHost(room, true);
  roomStore.touch(room);
  finalizeIfOver(io, room);
  emitState(io, room);
  return true;
}

function recoverBeforeAction(io: Server, socket: Socket, room: ServerRoom, expectedRevision: number): boolean {
  if (!recoverDisconnectedCitadelsPlayers(io, room) || expectedRevision === gameState(room)!.revision) return true;
  socket.emit('action_rejected', { reason: 'Game state changed. Please try again.' });
  return false;
}

export function registerCitadelsHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    const { room, auth } = value;
    if (!isCitadelsStartPayload(payload)) return rejectInvalidPayload(socket);
    if (room.hostPlayerId !== auth.playerId) {
      socket.emit('action_rejected', { reason: 'Only the host can start the game' });
      return;
    }
    if (room.status === 'in_game') {
      socket.emit('action_rejected', { reason: 'Game already in progress' });
      return;
    }
    if (!prepareRoomForStart(io, socket, room)) return;
    const connectedPlayers = [...room.players.values()].filter((player) => player.isConnected && !player.hasLeft);
    if (connectedPlayers.length < CITADELS_MIN_PLAYERS || connectedPlayers.length > CITADELS_MAX_PLAYERS) {
      socket.emit('action_rejected', { reason: `Need ${CITADELS_MIN_PLAYERS}-${CITADELS_MAX_PLAYERS} connected players` });
      return;
    }
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    const nextRevision = gameState(room) ? gameState(room)!.revision + 1 : 0;
    room.game = {
      id: 'citadels',
      state: initCitadelsGame(room.roomCode, connectedPlayers.map((player) => ({
        playerId: player.playerId,
        displayName: player.displayName,
      }))),
    };
    room.game.state.revision = nextRevision;
    room.status = 'in_game';
    roomStore.touch(room);
    emitAccepted(socket, 'start', room.game.state.revision);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitState(io, room);
  });

  socket.on('citadels:choose-character', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isCitadelsChooseRolePayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'choose_character', chooseCharacter(
      value.state, value.auth.playerId, payload.role, payload.expectedRevision,
    ));
  });

  socket.on('citadels:choose-income', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isCitadelsChooseIncomePayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'choose_income', chooseIncome(
      value.state, value.auth.playerId, payload.choice, payload.expectedRevision,
    ));
  });

  socket.on('citadels:keep-district', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isCardPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'keep_district', keepDistrict(
      value.state, value.auth.playerId, payload.cardId, payload.expectedRevision,
    ));
  });

  socket.on('citadels:build', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isCardPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'build', buildDistrict(
      value.state, value.auth.playerId, payload.cardId, payload.expectedRevision,
    ));
  });

  socket.on('citadels:power', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isCitadelsPowerPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'power', useCharacterPower(
      value.state, value.auth.playerId, payload, payload.expectedRevision,
    ));
  });

  socket.on('citadels:district-power', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isCitadelsDistrictPowerPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'district_power', useDistrictPower(
      value.state, value.auth.playerId, payload.districtId, payload.cardId, payload.expectedRevision,
    ));
  });

  socket.on('citadels:end-turn', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isCitadelsEndTurnPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'end_turn', endCitadelsTurn(
      value.state, value.auth.playerId, payload.expectedRevision,
    ));
  });

  socket.on('request_state', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    if (!isCitadelsStartPayload(payload)) return rejectInvalidPayload(socket);
    recoverDisconnectedCitadelsPlayers(io, value.room);
    socket.emit('room_updated', getRoomPublicState(value.room));
    const state = gameState(value.room);
    if (state && state.players.has(value.auth.playerId)) {
      socket.emit('game_state', toCitadelsPublicState(state));
      socket.emit('private_state', toCitadelsPrivateState(state, value.auth.playerId));
    }
  });
}
