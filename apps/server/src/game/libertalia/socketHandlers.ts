import type { Server, Socket } from 'socket.io';
import {
  LIBERTALIA_MAX_PLAYERS, LIBERTALIA_MIN_PLAYERS,
  type LibertaliaActionKind, type LibertaliaChoicePayload,
  type LibertaliaLootPayload, type LibertaliaSelectPayload,
} from '@zuychin-arcade/types';
import { saveGameResult } from '../../lib/saveGameResult.js';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import { getCurrentSocketSession, prepareRoomForStart } from '../../socket/roomLifecycle.js';
import {
  chooseLibertaliaLoot, initLibertaliaGame, resolveLibertaliaChoice, selectLibertaliaCrew,
  forfeitLibertaliaPlayers, settleLibertaliaAutopilot,
  type LibertaliaResult, type LibertaliaServerState,
} from './engine.js';
import { toLibertaliaPrivateState, toLibertaliaPublicState } from './publicState.js';

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= minimum;

export function isLibertaliaStartPayload(value: unknown): boolean {
  return value === undefined || (record(value) && Object.keys(value).length === 0);
}

export function isLibertaliaSelectPayload(value: unknown): value is LibertaliaSelectPayload {
  return record(value) && keys(value, ['rank', 'expectedRevision'])
    && integer(value.rank, 1) && value.rank <= 40 && integer(value.expectedRevision);
}

export function isLibertaliaChoicePayload(value: unknown): value is LibertaliaChoicePayload {
  return record(value) && keys(value, ['choiceId', 'optionIds', 'expectedRevision'])
    && integer(value.choiceId, 1) && integer(value.expectedRevision)
    && Array.isArray(value.optionIds) && value.optionIds.length <= 64
    && value.optionIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256)
    && new Set(value.optionIds).size === value.optionIds.length;
}

export function isLibertaliaLootPayload(value: unknown): value is LibertaliaLootPayload {
  return record(value) && keys(value, ['lootIndex', 'expectedRevision'])
    && integer(value.lootIndex) && value.lootIndex < 64 && integer(value.expectedRevision);
}

function gameState(room: ServerRoom): LibertaliaServerState | null {
  return room.game?.id === 'libertalia' ? room.game.state : null;
}

function context(socket: Socket) {
  const value = getCurrentSocketSession(socket);
  if (!value || value.room.gameId !== 'libertalia') {
    socket.emit('server_error', { message: 'This connection is not authorised for the Libertalia room' });
    return null;
  }
  return value;
}

function withState(socket: Socket) {
  const value = context(socket);
  if (!value) return null;
  const state = gameState(value.room);
  if (!state || !state.players.has(value.auth.playerId)) {
    socket.emit('action_rejected', { reason: 'Libertalia has not started for this seat' });
    return null;
  }
  return { ...value, state };
}

function emitState(io: Server, room: ServerRoom): void {
  const state = gameState(room);
  if (!state) return;
  for (const player of room.players.values()) {
    if (!player.socketId || !player.isConnected || player.hasLeft || !state.players.has(player.playerId)) continue;
    io.to(player.socketId).emit('game_state', toLibertaliaPublicState(state));
    io.to(player.socketId).emit('private_state', toLibertaliaPrivateState(state, player.playerId));
  }
}

export function buildLibertaliaResult(state: LibertaliaServerState): Parameters<typeof saveGameResult>[0] | null {
  if (state.status !== 'game_over' || state.winnerPlayerIds.length === 0) return null;
  return {
    gameName: 'libertalia', roomCode: state.roomCode, roundsPlayed: state.voyage,
    players: [...state.players.values()].filter((player) => !player.forfeited).map((player) => ({
      playerId: player.playerId, displayName: player.displayName, score: player.score,
      won: state.winnerPlayerIds.includes(player.playerId),
    })),
  };
}

function finalizeIfOver(io: Server, room: ServerRoom): void {
  const state = gameState(room);
  if (!state || state.status !== 'game_over' || room.status === 'finished') return;
  room.status = 'finished';
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  const result = buildLibertaliaResult(state);
  if (result) void saveGameResult(result);
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
}

function apply(io: Server, socket: Socket, room: ServerRoom, action: LibertaliaActionKind, result: LibertaliaResult): void {
  if (!result.ok) { socket.emit('action_rejected', { reason: result.reason }); return; }
  settleLibertaliaAutopilot(gameState(room)!);
  socket.emit('libertalia:action_accepted', { action, revision: gameState(room)!.revision });
  roomStore.touch(room);
  finalizeIfOver(io, room);
  emitState(io, room);
}

function invalid(socket: Socket): void { socket.emit('action_rejected', { reason: 'Invalid payload' }); }

export function recoverDisconnectedLibertaliaPlayers(io: Server, room: ServerRoom): boolean {
  const state = gameState(room);
  if (!state || state.status !== 'playing') return false;
  const now = Date.now();
  const departed = [...state.players.values()].filter((player) => {
    const seat = room.players.get(player.playerId);
    return !player.forfeited && (!seat || seat.hasLeft || (!seat.isConnected
      && seat.reconnectDeadlineAt !== null && seat.reconnectDeadlineAt <= now));
  }).map((player) => player.playerId);
  if (departed.length === 0) return false;
  const result = forfeitLibertaliaPlayers(state, departed, state.revision);
  if (!result.ok) return false;
  settleLibertaliaAutopilot(state);
  for (const id of departed) {
    const seat = room.players.get(id);
    if (!seat) continue;
    roomStore.clearPresenceTimer(seat);
    seat.hasLeft = true;
  }
  if (departed.includes(room.hostPlayerId)) roomStore.transferHost(room, true);
  roomStore.touch(room);
  finalizeIfOver(io, room);
  emitState(io, room);
  return true;
}

function recoverBeforeAction(io: Server, socket: Socket, room: ServerRoom, expectedRevision: number): boolean {
  if (!recoverDisconnectedLibertaliaPlayers(io, room) || expectedRevision === gameState(room)!.revision) return true;
  socket.emit('action_rejected', { reason: 'Game state changed. Please try again.' });
  return false;
}

export function registerLibertaliaHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    const { room, auth } = value;
    if (!isLibertaliaStartPayload(payload)) return invalid(socket);
    if (room.hostPlayerId !== auth.playerId) return socket.emit('action_rejected', { reason: 'Only the host can start the game' });
    if (room.status === 'in_game') return socket.emit('action_rejected', { reason: 'Game already in progress' });
    if (!prepareRoomForStart(io, socket, room)) return;
    const roster = [...room.players.values()].filter((player) => player.isConnected && !player.hasLeft);
    if (roster.length < LIBERTALIA_MIN_PLAYERS || roster.length > LIBERTALIA_MAX_PLAYERS) {
      return socket.emit('action_rejected', { reason: `Need ${LIBERTALIA_MIN_PLAYERS}-${LIBERTALIA_MAX_PLAYERS} connected players` });
    }
    const revision = gameState(room) ? gameState(room)!.revision + 1 : 0;
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    room.game = { id: 'libertalia', state: initLibertaliaGame(room.roomCode, roster) };
    room.game.state.revision = revision;
    room.status = 'in_game';
    roomStore.touch(room);
    socket.emit('libertalia:action_accepted', { action: 'start', revision });
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitState(io, room);
  });
  socket.on('libertalia:select', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isLibertaliaSelectPayload(payload)) return invalid(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'select', selectLibertaliaCrew(value.state, value.auth.playerId, payload.rank, payload.expectedRevision));
  });
  socket.on('libertalia:choice', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isLibertaliaChoicePayload(payload)) return invalid(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'choice', resolveLibertaliaChoice(value.state, value.auth.playerId, payload.choiceId, payload.optionIds, payload.expectedRevision));
  });
  socket.on('libertalia:loot', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isLibertaliaLootPayload(payload)) return invalid(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'loot', chooseLibertaliaLoot(value.state, value.auth.playerId, payload.lootIndex, payload.expectedRevision));
  });
  socket.on('request_state', () => {
    const value = context(socket);
    if (!value) return;
    recoverDisconnectedLibertaliaPlayers(io, value.room);
    socket.emit('room_updated', getRoomPublicState(value.room));
    const state = gameState(value.room);
    if (!state || !state.players.has(value.auth.playerId)) return;
    socket.emit('game_state', toLibertaliaPublicState(state));
    socket.emit('private_state', toLibertaliaPrivateState(state, value.auth.playerId));
  });
}
