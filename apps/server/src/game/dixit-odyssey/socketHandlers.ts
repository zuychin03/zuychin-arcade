import type { Server, Socket } from 'socket.io';
import { DIXIT_CARD_IDS, DIXIT_CLUE_MAX_LENGTH, DIXIT_MAX_PLAYERS, DIXIT_MIN_PLAYERS, type DixitActionPayload } from '@zuychin-arcade/types';
import { saveGameResult } from '../../lib/saveGameResult.js';
import { getCurrentSocketSession, prepareRoomForStart } from '../../socket/roomLifecycle.js';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import { applyDixitAction, forfeitDixitPlayers, initDixitGame, type DixitServerState } from './engine.js';
import { toDixitPrivateState, toDixitPublicState } from './publicState.js';

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function cardId(value: unknown): boolean {
  return typeof value === 'string' && (DIXIT_CARD_IDS as readonly string[]).includes(value);
}

export function isDixitStartPayload(value: unknown): boolean {
  return value === undefined || (record(value) && Object.keys(value).length === 0);
}

export function isDixitActionPayload(value: unknown): value is DixitActionPayload {
  if (!record(value) || !keys(value, ['expectedRevision', 'roundNumber', 'action'])
    || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0
    || !Number.isSafeInteger(value.roundNumber) || (value.roundNumber as number) < 1
    || !record(value.action)) return false;
  const action = value.action;
  if (action.type === 'clue') return keys(action, ['type', 'cardId', 'clue']) && cardId(action.cardId)
    && typeof action.clue === 'string' && action.clue.length <= DIXIT_CLUE_MAX_LENGTH;
  if (action.type === 'submit') return keys(action, ['type', 'cardIds']) && Array.isArray(action.cardIds)
    && action.cardIds.length >= 1 && action.cardIds.length <= 2 && action.cardIds.every(cardId)
    && new Set(action.cardIds).size === action.cardIds.length;
  if (action.type === 'vote') return keys(action, ['type', 'slots']) && Array.isArray(action.slots)
    && action.slots.length === 2 && action.slots.every(slot => Number.isSafeInteger(slot) && slot >= 1 && slot <= 12);
  return action.type === 'ready' && keys(action, ['type']);
}

function stateFor(room: ServerRoom): DixitServerState | null {
  return room.game?.id === 'dixit_odyssey' ? room.game.state : null;
}

function context(socket: Socket) {
  const current = getCurrentSocketSession(socket);
  if (!current || current.room.gameId !== 'dixit_odyssey') {
    socket.emit('server_error', { message: 'This connection is not authorised for the Dixit Odyssey room' });
    return null;
  }
  return current;
}

function emitState(io: Server, room: ServerRoom): void {
  const state = stateFor(room);
  if (!state) return;
  io.to(room.roomCode).emit('game_state', toDixitPublicState(state));
  for (const player of room.players.values()) {
    if (player.socketId && player.isConnected && !player.hasLeft && state.players.has(player.playerId)) {
      io.to(player.socketId).emit('private_state', toDixitPrivateState(state, player.playerId));
    }
  }
}

export function buildDixitResult(state: DixitServerState) {
  if (state.status !== 'game_over' || state.terminationReason || !state.winnerIds.length) return null;
  return {
    gameName: 'dixit_odyssey', roomCode: state.roomCode, roundsPlayed: state.roundNumber,
    players: [...state.players.values()].filter(player => !player.forfeited).map(player => ({
      playerId: player.playerId, displayName: player.displayName,
      score: player.score, won: state.winnerIds.includes(player.playerId),
    })),
  };
}

function finish(io: Server, room: ServerRoom): void {
  const state = stateFor(room);
  if (!state || state.status !== 'game_over' || room.status === 'finished') return;
  room.status = 'finished';
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  const result = buildDixitResult(state);
  if (result) void saveGameResult(result);
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
}

export function recoverDisconnectedDixitPlayers(io: Server, room: ServerRoom): boolean {
  const state = stateFor(room);
  if (!state || state.status !== 'playing') return false;
  const now = Date.now();
  const departing = state.turnOrder.filter(id => {
    const player = room.players.get(id);
    return !state.players.get(id)!.forfeited && (!player || player.hasLeft
      || (!player.isConnected && player.reconnectDeadlineAt !== null && player.reconnectDeadlineAt <= now));
  });
  if (!departing.length || !forfeitDixitPlayers(state, departing, state.revision).ok) return false;
  for (const id of departing) {
    const player = room.players.get(id);
    if (player) {
      roomStore.clearPresenceTimer(player);
      player.hasLeft = true;
    }
  }
  if (departing.includes(room.hostPlayerId)) roomStore.transferHost(room, true);
  roomStore.touch(room);
  finish(io, room);
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
  emitState(io, room);
  return true;
}

export function registerDixitHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    const { room, auth } = value;
    if (!isDixitStartPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    if (room.hostPlayerId !== auth.playerId) return socket.emit('action_rejected', { reason: 'Only the host can start the game' });
    if (room.status === 'in_game') return socket.emit('action_rejected', { reason: 'Game already in progress' });
    if (!prepareRoomForStart(io, socket, room)) return;
    const players = [...room.players.values()].filter(player => player.isConnected && !player.hasLeft);
    if (players.length < DIXIT_MIN_PLAYERS || players.length > DIXIT_MAX_PLAYERS) {
      return socket.emit('action_rejected', { reason: 'Need 3–12 connected players' });
    }
    const revision = (stateFor(room)?.revision ?? -1) + 1;
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    const state = initDixitGame(room.roomCode, players.map(({ playerId, displayName }) => ({ playerId, displayName })));
    state.revision = revision;
    state.roundStartedRevision = revision;
    room.game = { id: 'dixit_odyssey', state };
    room.status = 'in_game';
    roomStore.touch(room);
    socket.emit('dixit:action_accepted', { action: 'start', revision });
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitState(io, room);
  });

  socket.on('dixit:action', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    if (!isDixitActionPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    const state = stateFor(value.room);
    if (!state) return socket.emit('action_rejected', { reason: 'Dixit Odyssey has not started' });
    recoverDisconnectedDixitPlayers(io, value.room);
    const result = applyDixitAction(state, value.auth.playerId, payload.action, payload.expectedRevision, payload.roundNumber);
    if (!result.ok) return socket.emit('action_rejected', { reason: result.reason });
    roomStore.touch(value.room);
    socket.emit('dixit:action_accepted', { action: payload.action.type, revision: state.revision });
    finish(io, value.room);
    emitState(io, value.room);
  });

  socket.on('request_state', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    if (!isDixitStartPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    recoverDisconnectedDixitPlayers(io, value.room);
    socket.emit('room_updated', getRoomPublicState(value.room));
    const state = stateFor(value.room);
    if (state && state.players.has(value.auth.playerId)) {
      socket.emit('game_state', toDixitPublicState(state));
      socket.emit('private_state', toDixitPrivateState(state, value.auth.playerId));
    }
  });
}
