import type { Server, Socket } from 'socket.io';
import type {
  BangDiscardPayload, BangDrawPayload, BangPlayPayload, BangRespondPayload,
  BangActionKind, BangBarrelPayload, BangRole, BangSidPayload, BangStorePayload, BangTeam,
} from '@zuychin-arcade/types';
import { BANG_MAX_PLAYERS, BANG_MIN_PLAYERS } from '@zuychin-arcade/types';
import { saveGameResult } from '../../lib/saveGameResult.js';
import { getCurrentSocketSession, prepareRoomForStart } from '../../socket/roomLifecycle.js';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import {
  chooseBangDraw, chooseBangStoreCard, discardBangCards, endBangTurn, initBangGame,
  playBangCard, respondBang, useSidKetchum, useBangBarrel, chooseBangCheck, rescueBang,
  chooseBangDiscardOrder, forfeitBangPlayers, type BangEngineResult, type BangServerState,
} from './engine.js';
import { toBangPrivateState, toBangPublicState } from './publicState.js';

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
type RevisionPayload = { expectedRevision: number };
type ActionKind = BangActionKind;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}
function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isIdList(value: unknown, minimum: number, maximum: number): value is string[] {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum
    && value.every(isId) && new Set(value).size === value.length;
}
export function isBangStartPayload(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.keys(value).length === 0);
}
export function isBangRevisionPayload(value: unknown): value is RevisionPayload {
  return isRecord(value) && hasOnlyKeys(value, ['expectedRevision'])
    && hasOwn(value, 'expectedRevision') && isRevision(value.expectedRevision);
}
export function isBangPlayPayload(value: unknown): value is BangPlayPayload & RevisionPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['cardId', 'targetPlayerId', 'targetZone', 'targetCardId', 'expectedRevision'])
    || !hasOwn(value, 'cardId') || !hasOwn(value, 'expectedRevision')
    || !isId(value.cardId) || !isRevision(value.expectedRevision)) return false;
  if (hasOwn(value, 'targetPlayerId') && !isId(value.targetPlayerId)) return false;
  if (hasOwn(value, 'targetZone') && value.targetZone !== 'hand' && value.targetZone !== 'equipment') return false;
  if (hasOwn(value, 'targetZone') && !isId(value.targetPlayerId)) return false;
  if (value.targetZone === 'equipment') return isId(value.targetCardId);
  return !hasOwn(value, 'targetCardId');
}
export function isBangRespondPayload(value: unknown): value is BangRespondPayload & RevisionPayload {
  return isRecord(value) && hasOnlyKeys(value, ['cardId', 'expectedRevision'])
    && hasOwn(value, 'expectedRevision') && isRevision(value.expectedRevision)
    && (!hasOwn(value, 'cardId') || isId(value.cardId));
}
export function isBangStorePayload(value: unknown): value is BangStorePayload & RevisionPayload {
  return isBangRespondPayload(value) && isId(value.cardId);
}
export function isBangDrawPayload(value: unknown): value is BangDrawPayload & RevisionPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['useAbility', 'targetPlayerId', 'cardIds', 'expectedRevision'])
    || !hasOwn(value, 'expectedRevision') || !isRevision(value.expectedRevision)) return false;
  if (hasOwn(value, 'cardIds')) {
    return isIdList(value.cardIds, 2, 2) && !hasOwn(value, 'useAbility') && !hasOwn(value, 'targetPlayerId');
  }
  if (hasOwn(value, 'useAbility') && typeof value.useAbility !== 'boolean') return false;
  return !hasOwn(value, 'targetPlayerId') || (value.useAbility === true && isId(value.targetPlayerId));
}
export function isBangDiscardPayload(value: unknown): value is BangDiscardPayload & RevisionPayload {
  return isRecord(value) && hasOnlyKeys(value, ['cardIds', 'expectedRevision'])
    && hasOwn(value, 'cardIds') && hasOwn(value, 'expectedRevision')
    && isRevision(value.expectedRevision) && isIdList(value.cardIds, 1, 80);
}
export function isBangSidPayload(value: unknown): value is BangSidPayload & RevisionPayload {
  return isBangDiscardPayload(value) && value.cardIds.length === 2;
}
export function isBangBarrelPayload(value: unknown): value is BangBarrelPayload & RevisionPayload {
  return isRecord(value) && hasOnlyKeys(value, ['source', 'expectedRevision'])
    && hasOwn(value, 'source') && hasOwn(value, 'expectedRevision') && isRevision(value.expectedRevision)
    && (value.source === 'barrel' || value.source === 'jourdonnais');
}

function gameState(room: ServerRoom): BangServerState | null {
  return room.game?.id === 'bang' ? room.game.state : null;
}
function context(socket: Socket) {
  const current = getCurrentSocketSession(socket);
  if (!current || current.room.gameId !== 'bang') {
    socket.emit('server_error', { message: 'This connection is not authorised for the BANG! room' });
    return null;
  }
  return current;
}
function withState(socket: Socket) {
  const value = context(socket);
  if (!value) return null;
  const state = gameState(value.room);
  if (!state || !state.players.has(value.auth.playerId)) {
    socket.emit('action_rejected', { reason: 'BANG! has not started for this seat' });
    return null;
  }
  return { ...value, state };
}
function emitState(io: Server, room: ServerRoom): void {
  const state = gameState(room);
  if (!state) return;
  for (const player of room.players.values()) {
    if (!player.socketId || !player.isConnected || player.hasLeft || !state.players.has(player.playerId)) continue;
    io.to(player.socketId).emit('game_state', toBangPublicState(state, player.playerId));
    io.to(player.socketId).emit('private_state', toBangPrivateState(state, player.playerId));
  }
}
export function isBangWinningRole(role: BangRole, winner: BangTeam | null): boolean {
  if (winner === 'law') return role === 'sheriff' || role === 'deputy';
  if (winner === 'outlaws') return role === 'outlaw';
  return winner === 'renegade' && role === 'renegade';
}
function finalizeIfOver(io: Server, room: ServerRoom): void {
  const state = gameState(room);
  if (!state || state.status !== 'game_over' || room.status === 'finished') return;
  room.status = 'finished';
  if (!state.abandoned) void saveGameResult({
    gameName: 'bang',
    roomCode: room.roomCode,
    roundsPlayed: state.turnNumber,
    players: state.turnOrder.filter(id => !state.players.get(id)!.forfeited).map(id => {
      const player = state.players.get(id)!;
      return { playerId: id, displayName: player.displayName, score: player.alive ? 1 : 0, won: isBangWinningRole(player.role, state.winner) };
    }),
  });
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
}
function accepted(socket: Socket, action: ActionKind, revision: number): void {
  socket.emit('bang:action_accepted', { action, revision });
}
function apply(io: Server, socket: Socket, room: ServerRoom, action: Exclude<ActionKind, 'start'>, result: BangEngineResult): void {
  if (!result.ok) {
    socket.emit('action_rejected', { reason: result.reason });
    return;
  }
  const state = gameState(room)!;
  accepted(socket, action, state.revision);
  roomStore.touch(room);
  finalizeIfOver(io, room);
  emitState(io, room);
}
function rejectPayload(socket: Socket): void {
  socket.emit('action_rejected', { reason: 'Invalid payload' });
}

export function recoverDisconnectedBangPlayers(io: Server, room: ServerRoom): boolean {
  const state = gameState(room);
  if (!state || state.status !== 'playing') return false;
  const departed = state.turnOrder.filter(id => {
    const player = room.players.get(id);
    return !player || player.hasLeft;
  });
  const revision = state.revision;
  forfeitBangPlayers(state, departed);
  if (state.revision === revision) return false;
  roomStore.touch(room);
  finalizeIfOver(io, room);
  emitState(io, room);
  return true;
}

export function registerBangHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    if (!isBangStartPayload(payload)) return rejectPayload(socket);
    const { room, auth } = value;
    if (room.hostPlayerId !== auth.playerId) {
      socket.emit('action_rejected', { reason: 'Only the host can start the game' });
      return;
    }
    if (room.status === 'in_game') {
      socket.emit('action_rejected', { reason: 'Game already in progress' });
      return;
    }
    if (!prepareRoomForStart(io, socket, room)) return;
    const players = [...room.players.values()].filter(player => player.isConnected && !player.hasLeft);
    if (players.length < BANG_MIN_PLAYERS || players.length > BANG_MAX_PLAYERS) {
      socket.emit('action_rejected', { reason: `Need ${BANG_MIN_PLAYERS}-${BANG_MAX_PLAYERS} connected players` });
      return;
    }
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    const previousRevision = room.game?.id === 'bang' ? room.game.state.revision : -1;
    room.game = { id: 'bang', state: initBangGame(room.roomCode, players) };
    room.game.state.revision = previousRevision + 1;
    room.status = 'in_game';
    roomStore.touch(room);
    accepted(socket, 'start', room.game.state.revision);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitState(io, room);
  });
  socket.on('bang:play', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isBangPlayPayload(payload)) return rejectPayload(socket);
    apply(io, socket, value.room, 'play', playBangCard(value.state, value.auth.playerId, payload));
  });
  socket.on('bang:respond', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isBangRespondPayload(payload)) return rejectPayload(socket);
    apply(io, socket, value.room, 'respond', respondBang(value.state, value.auth.playerId, payload.cardId, payload.expectedRevision));
  });
  socket.on('bang:choose-store', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isBangStorePayload(payload)) return rejectPayload(socket);
    apply(io, socket, value.room, 'choose_store', chooseBangStoreCard(value.state, value.auth.playerId, payload.cardId, payload.expectedRevision));
  });
  socket.on('bang:choose-draw', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isBangDrawPayload(payload)) return rejectPayload(socket);
    apply(io, socket, value.room, 'choose_draw', chooseBangDraw(value.state, value.auth.playerId, payload));
  });
  socket.on('bang:sid-heal', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isBangSidPayload(payload)) return rejectPayload(socket);
    apply(io, socket, value.room, 'sid_ketchum', useSidKetchum(value.state, value.auth.playerId, payload.cardIds, payload.expectedRevision));
  });
  socket.on('bang:use-barrel', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isBangBarrelPayload(payload)) return rejectPayload(socket);
    apply(io, socket, value.room, 'use_barrel', useBangBarrel(value.state, value.auth.playerId, payload.source, payload.expectedRevision));
  });
  socket.on('bang:choose-check', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isBangStorePayload(payload)) return rejectPayload(socket);
    apply(io, socket, value.room, 'choose_check', chooseBangCheck(value.state, value.auth.playerId, payload.cardId, payload.expectedRevision));
  });
  socket.on('bang:rescue', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isBangRespondPayload(payload)) return rejectPayload(socket);
    apply(io, socket, value.room, 'rescue', rescueBang(value.state, value.auth.playerId, payload.cardId, payload.expectedRevision));
  });
  socket.on('bang:choose-discard-order', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isBangDiscardPayload(payload)) return rejectPayload(socket);
    apply(io, socket, value.room, 'discard_order', chooseBangDiscardOrder(value.state, value.auth.playerId, payload.cardIds, payload.expectedRevision));
  });
  socket.on('bang:end-turn', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isBangRevisionPayload(payload)) return rejectPayload(socket);
    apply(io, socket, value.room, 'end_turn', endBangTurn(value.state, value.auth.playerId, payload.expectedRevision));
  });
  socket.on('bang:discard', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isBangDiscardPayload(payload)) return rejectPayload(socket);
    apply(io, socket, value.room, 'discard', discardBangCards(value.state, value.auth.playerId, payload.cardIds, payload.expectedRevision));
  });
  socket.on('request_state', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    if (!isBangStartPayload(payload)) return rejectPayload(socket);
    socket.emit('room_updated', getRoomPublicState(value.room));
    const state = gameState(value.room);
    if (state && state.players.has(value.auth.playerId)) {
      socket.emit('game_state', toBangPublicState(state, value.auth.playerId));
      socket.emit('private_state', toBangPrivateState(state, value.auth.playerId));
    }
  });
}
