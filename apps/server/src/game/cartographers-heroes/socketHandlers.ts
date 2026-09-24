import type { Server, Socket } from 'socket.io';
import {
  CARTOGRAPHERS_HEROES_MAX_PLAYERS, CARTOGRAPHERS_HEROES_MIN_PLAYERS,
  type CartographersDestructionPayload, type CartographersPlacementPayload,
} from '@zuychin-arcade/types';
import { saveGameResult } from '../../lib/saveGameResult.js';
import { getCurrentSocketSession, prepareRoomForStart } from '../../socket/roomLifecycle.js';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import {
  chooseCartographersDestruction, forfeitCartographersPlayers, initCartographersHeroesGame,
  submitCartographersPlacement, type CartographersEngineResult, type CartographersHeroesServerState,
} from './engine.js';
import { toCartographersHeroesPrivateState, toCartographersHeroesPublicState } from './publicState.js';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
function integer(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}
function position(value: unknown): boolean {
  return record(value) && keys(value, ['x', 'y']) && integer(value.x, 0, 10) && integer(value.y, 0, 10);
}
function identity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}
const submissionKeys = ['turnId', 'expectedRevision', 'submissionToken', 'targetPlayerId'];
function submission(value: Record<string, unknown>): boolean {
  return integer(value.turnId, 1, Number.MAX_SAFE_INTEGER) && integer(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER)
    && identity(value.targetPlayerId) && typeof value.submissionToken === 'string'
    && value.submissionToken.length > 0 && value.submissionToken.length <= 100;
}
export function isCartographersHeroesStartPayload(value: unknown): boolean {
  return value === undefined || (record(value) && Object.keys(value).length === 0);
}
export function isCartographersPlacementPayload(value: unknown): value is CartographersPlacementPayload {
  return record(value) && keys(value, [...submissionKeys, 'anchor', 'rotation', 'mirrored', 'optionIndex', 'terrain', 'destroyTarget'])
    && submission(value) && position(value.anchor) && [0, 90, 180, 270].includes(value.rotation as number)
    && typeof value.mirrored === 'boolean' && integer(value.optionIndex, 0, 1)
    && ['forest', 'village', 'farm', 'water', 'monster', 'hero'].includes(value.terrain as string)
    && (value.destroyTarget === undefined || position(value.destroyTarget));
}
export function isCartographersDestructionPayload(value: unknown): value is CartographersDestructionPayload {
  return record(value) && keys(value, [...submissionKeys, 'position']) && submission(value) && position(value.position);
}
export function isCartographersInspectionPayload(value: unknown): value is { targetPlayerId: string; expectedRevision: number } {
  return record(value) && keys(value, ['targetPlayerId', 'expectedRevision']) && identity(value.targetPlayerId)
    && integer(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER);
}
function stateFor(room: ServerRoom): CartographersHeroesServerState | null {
  return room.game?.id === 'cartographers_heroes' ? room.game.state : null;
}
function context(socket: Socket) {
  const current = getCurrentSocketSession(socket);
  if (!current || current.room.gameId !== 'cartographers_heroes') {
    socket.emit('server_error', { message: 'This connection is not authorised for the Cartographers Heroes room' });
    return null;
  }
  return current;
}
const pendingEmissions = new WeakMap<ServerRoom, NodeJS.Immediate>();
function emitState(io: Server, room: ServerRoom): void {
  if (pendingEmissions.has(room)) return;
  const pending = setImmediate(() => {
    pendingEmissions.delete(room);
    if (roomStore.get(room.roomCode) !== room) return;
    const state = stateFor(room);
    if (!state) return;
    io.to(room.roomCode).emit('game_state', toCartographersHeroesPublicState(state));
    for (const player of room.players.values()) {
      if (player.socketId && player.isConnected && !player.hasLeft && state.players.has(player.playerId)) {
        io.to(player.socketId).emit('private_state', toCartographersHeroesPrivateState(state, player.playerId));
      }
    }
  });
  pending.unref();
  pendingEmissions.set(room, pending);
}
export function buildCartographersHeroesResult(state: CartographersHeroesServerState) {
  if (state.status !== 'game_over' || state.endReason !== 'natural' || !state.winnerIds.length) return null;
  return {
    gameName: 'cartographers_heroes', roomCode: state.roomCode, roundsPlayed: 4,
    players: [...state.players.values()].filter(player => !player.forfeited).map(player => ({
      playerId: player.playerId, displayName: player.displayName, score: player.totalScore,
      won: state.winnerIds.includes(player.playerId),
    })),
  };
}
function finish(io: Server, room: ServerRoom): void {
  const state = stateFor(room);
  if (!state || state.status !== 'game_over' || room.status === 'finished') return;
  room.status = 'finished';
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  const result = buildCartographersHeroesResult(state);
  if (result) void saveGameResult(result);
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
}
export function recoverDisconnectedCartographersPlayers(io: Server, room: ServerRoom): boolean {
  const state = stateFor(room);
  if (!state || state.status !== 'playing') return false;
  const now = Date.now();
  const departed = state.turnOrder.filter(id => {
    const player = room.players.get(id);
    return !state.players.get(id)!.forfeited && (!player || player.hasLeft
      || (!player.isConnected && player.reconnectDeadlineAt !== null && player.reconnectDeadlineAt <= now));
  });
  if (!departed.length || !forfeitCartographersPlayers(state, departed).ok) return false;
  for (const id of departed) {
    const player = room.players.get(id);
    if (player) { roomStore.clearPresenceTimer(player); player.hasLeft = true; }
  }
  if (departed.includes(room.hostPlayerId)) roomStore.transferHost(room, true);
  roomStore.touch(room); finish(io, room);
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
  emitState(io, room); return true;
}
function accept(io: Server, socket: Socket, room: ServerRoom, action: string, result: CartographersEngineResult): void {
  if (!result.ok) { socket.emit('action_rejected', { reason: result.reason }); return; }
  roomStore.touch(room);
  socket.emit('cartographers:action_accepted', { action, revision: stateFor(room)!.revision });
  finish(io, room); emitState(io, room);
}
export function registerCartographersHeroesHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    const { room, auth } = value;
    if (!isCartographersHeroesStartPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    if (room.hostPlayerId !== auth.playerId) return socket.emit('action_rejected', { reason: 'Only the host can start the game' });
    if (room.status === 'in_game') return socket.emit('action_rejected', { reason: 'Game already in progress' });
    if (!prepareRoomForStart(io, socket, room)) return;
    const players = [...room.players.values()].filter(player => player.isConnected && !player.hasLeft);
    if (players.length < CARTOGRAPHERS_HEROES_MIN_PLAYERS || players.length > CARTOGRAPHERS_HEROES_MAX_PLAYERS) {
      return socket.emit('action_rejected', { reason: 'Need 1–100 connected players' });
    }
    const revision = (stateFor(room)?.revision ?? -1) + 1;
    const state = initCartographersHeroesGame(players.map(({ playerId, displayName }) => ({ playerId, displayName })), {
      roomCode: room.roomCode, mapSide: room.config.cartographersMapSide ?? 'C', startingRevision: revision,
    });
    if (room.timer) clearTimeout(room.timer);
    room.timer = null; room.game = { id: 'cartographers_heroes', state }; room.status = 'in_game';
    roomStore.touch(room);
    socket.emit('cartographers:action_accepted', { action: 'start', revision });
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room)); emitState(io, room);
  });
  socket.on('cartographers:place', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    if (!isCartographersPlacementPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    const state = stateFor(value.room);
    if (!state) return socket.emit('action_rejected', { reason: 'Cartographers Heroes has not started' });
    recoverDisconnectedCartographersPlayers(io, value.room);
    accept(io, socket, value.room, 'place', submitCartographersPlacement(state, value.auth.playerId, payload));
  });
  socket.on('cartographers:destroy', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    if (!isCartographersDestructionPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    const state = stateFor(value.room);
    if (!state) return socket.emit('action_rejected', { reason: 'Cartographers Heroes has not started' });
    recoverDisconnectedCartographersPlayers(io, value.room);
    accept(io, socket, value.room, 'destroy', chooseCartographersDestruction(state, value.auth.playerId, payload));
  });
  socket.on('cartographers:inspect_map', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    if (!isCartographersInspectionPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    const state = stateFor(value.room);
    if (!state || state.status !== 'game_over' || state.revision !== payload.expectedRevision || !state.players.has(payload.targetPlayerId)) {
      return socket.emit('action_rejected', { reason: 'Finished map is not available at this revision' });
    }
    roomStore.touch(value.room);
    socket.emit('game_state', toCartographersHeroesPublicState(state));
    socket.emit('private_state', toCartographersHeroesPrivateState(state, value.auth.playerId, payload.targetPlayerId));
    socket.emit('cartographers:action_accepted', { action: 'inspect_map', revision: state.revision });
  });
  socket.on('request_state', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    if (!isCartographersHeroesStartPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    recoverDisconnectedCartographersPlayers(io, value.room);
    socket.emit('room_updated', getRoomPublicState(value.room));
    const state = stateFor(value.room);
    if (state && state.players.has(value.auth.playerId)) {
      socket.emit('game_state', toCartographersHeroesPublicState(state));
      socket.emit('private_state', toCartographersHeroesPrivateState(state, value.auth.playerId));
    }
  });
}
