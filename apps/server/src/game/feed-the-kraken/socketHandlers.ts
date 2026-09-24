import type { Server, Socket } from 'socket.io';
import type { FeedTheKrakenAction } from '@zuychin-arcade/types';
import { saveGameResult } from '../../lib/saveGameResult.js';
import { getCurrentSocketSession, prepareRoomForStart } from '../../socket/roomLifecycle.js';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import { forfeitFeedTheKrakenPlayers, initFeedTheKrakenGame, submitFeedTheKrakenAction, type FeedTheKrakenServerState } from './engine.js';
import { toFeedTheKrakenPrivateState, toFeedTheKrakenPublicState } from './publicState.js';

interface ActionPayload { expectedRevision: number; windowId?: number; action: FeedTheKrakenAction }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;

export function isFeedTheKrakenStartPayload(value: unknown): boolean {
  return value === undefined || (record(value) && Object.keys(value).length === 0);
}

export function isFeedTheKrakenActionPayload(value: unknown): value is ActionPayload {
  if (!record(value) || !keys(value, ['expectedRevision', 'windowId', 'action']) || !integer(value.expectedRevision)
    || (value.windowId !== undefined && !integer(value.windowId)) || !record(value.action)) return false;
  const a = value.action;
  switch (a.type) {
    case 'pass': return keys(a, ['type']);
    case 'appoint': return keys(a, ['type', 'lieutenantId', 'navigatorId']) && id(a.lieutenantId) && id(a.navigatorId) && a.lieutenantId !== a.navigatorId;
    case 'bid': return keys(a, ['type', 'guns']) && integer(a.guns, 40) && integer(value.windowId);
    case 'veto': case 'emergency': case 'target': return keys(a, ['type', 'playerId']) && id(a.playerId);
    case 'submit_navigation': return keys(a, ['type', 'cardId', 'redraw']) && id(a.cardId) && (a.redraw === undefined || typeof a.redraw === 'boolean');
    case 'navigate': return keys(a, ['type', 'cardId', 'refuse']) && (a.refuse === undefined || typeof a.refuse === 'boolean')
      && (a.refuse === true ? a.cardId === undefined : id(a.cardId));
    case 'telescope': return keys(a, ['type', 'discard']) && typeof a.discard === 'boolean';
    case 'instigator': return keys(a, ['type', 'accept']) && typeof a.accept === 'boolean';
    case 'character': return keys(a, ['type', 'targets']) && (a.targets === undefined || (Array.isArray(a.targets)
      && a.targets.length <= 3 && a.targets.every(id)));
    case 'ritual': return keys(a, ['type', 'playerId', 'allocations']) && (a.playerId === undefined || id(a.playerId))
      && (a.allocations === undefined || (a.playerId === undefined && record(a.allocations)
        && Object.keys(a.allocations).length <= 11 && Object.entries(a.allocations).every(([key, n]) => id(key) && integer(n, 3))));
    default: return false;
  }
}

function stateFor(room: ServerRoom): FeedTheKrakenServerState | null {
  return room.game?.id === 'feed_the_kraken' ? room.game.state : null;
}
function context(socket: Socket) {
  const current = getCurrentSocketSession(socket);
  if (!current || current.room.gameId !== 'feed_the_kraken') {
    socket.emit('server_error', { message: 'This connection is not authorised for the Feed the Kraken room' });
    return null;
  }
  return current;
}
function emitState(io: Server, room: ServerRoom): void {
  const state = stateFor(room);
  if (!state) return;
  io.to(room.roomCode).emit('game_state', toFeedTheKrakenPublicState(state));
  for (const player of room.players.values()) {
    if (player.socketId && player.isConnected && !player.hasLeft && state.players[player.playerId]) {
      io.to(player.socketId).emit('private_state', toFeedTheKrakenPrivateState(state, player.playerId));
    }
  }
}

export function buildFeedTheKrakenResult(state: FeedTheKrakenServerState) {
  if (state.status !== 'game_over' || state.endReason === 'no_participants') return null;
  return {
    gameName: 'feed_the_kraken', roomCode: state.roomCode, roundsPlayed: state.round,
    players: state.order.filter(id => !state.players[id]!.forfeited).map(id => ({
      playerId: id, displayName: state.players[id]!.displayName,
      score: state.winnerIds.includes(id) ? 1 : 0, won: state.winnerIds.includes(id),
    })),
  };
}
function finish(io: Server, room: ServerRoom): void {
  const state = stateFor(room);
  if (!state || state.status !== 'game_over' || room.status === 'finished') return;
  room.status = 'finished';
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  const result = buildFeedTheKrakenResult(state);
  if (result) void saveGameResult(result);
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
}

export function recoverDisconnectedFeedTheKrakenPlayers(io: Server, room: ServerRoom): boolean {
  const state = stateFor(room);
  if (!state || state.status !== 'playing') return false;
  const now = Date.now();
  const departing = state.order.filter(id => {
    const player = room.players.get(id);
    return !state.players[id]!.forfeited && (!player || player.hasLeft
      || (!player.isConnected && player.reconnectDeadlineAt !== null && player.reconnectDeadlineAt <= now));
  });
  if (!departing.length || !forfeitFeedTheKrakenPlayers(state, departing).ok) return false;
  for (const id of departing) {
    const player = room.players.get(id);
    if (player) { roomStore.clearPresenceTimer(player); player.hasLeft = true; }
  }
  if (departing.includes(room.hostPlayerId)) roomStore.transferHost(room, true);
  roomStore.touch(room);
  finish(io, room);
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
  emitState(io, room);
  return true;
}

export function registerFeedTheKrakenHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    const { room, auth } = value;
    if (!isFeedTheKrakenStartPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    if (room.hostPlayerId !== auth.playerId) return socket.emit('action_rejected', { reason: 'Only the host can start the game' });
    if (room.status === 'in_game') return socket.emit('action_rejected', { reason: 'Game already in progress' });
    if (!prepareRoomForStart(io, socket, room)) return;
    const players = [...room.players.values()].filter(player => player.isConnected && !player.hasLeft);
    const journey = room.config.krakenJourney ?? 'quick';
    if (players.length < 5 || players.length > 11 || (journey === 'long' && players.length < 7)) {
      return socket.emit('action_rejected', { reason: 'Need 5–11 connected players, or 7–11 for the long journey' });
    }
    const previous = stateFor(room);
    const state = initFeedTheKrakenGame(players.map(({ playerId, displayName }) => ({ playerId, displayName })), room.roomCode, journey);
    state.revision = (previous?.revision ?? -1) + 1;
    state.windowId += previous?.windowId ?? 0;
    state.bidWindowRevision = state.revision;
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.game = { id: 'feed_the_kraken', state };
    room.status = 'in_game';
    roomStore.touch(room);
    socket.emit('kraken:action_accepted', { action: 'start', revision: state.revision });
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitState(io, room);
  });
  socket.on('kraken:action', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    if (!isFeedTheKrakenActionPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    const state = stateFor(value.room);
    if (!state) return socket.emit('action_rejected', { reason: 'Feed the Kraken has not started' });
    recoverDisconnectedFeedTheKrakenPlayers(io, value.room);
    if (payload.windowId !== undefined && payload.windowId !== state.windowId) return socket.emit('action_rejected', { reason: 'Stale decision window' });
    const result = submitFeedTheKrakenAction(state, value.auth.playerId, payload.action, payload.expectedRevision, payload.windowId);
    if (!result.ok) return socket.emit('action_rejected', { reason: result.reason });
    roomStore.touch(value.room);
    socket.emit('kraken:action_accepted', { action: payload.action.type, revision: state.revision });
    finish(io, value.room);
    emitState(io, value.room);
  });
  socket.on('request_state', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    if (!isFeedTheKrakenStartPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    recoverDisconnectedFeedTheKrakenPlayers(io, value.room);
    socket.emit('room_updated', getRoomPublicState(value.room));
    const state = stateFor(value.room);
    if (state && state.players[value.auth.playerId]) {
      socket.emit('game_state', toFeedTheKrakenPublicState(state));
      socket.emit('private_state', toFeedTheKrakenPrivateState(state, value.auth.playerId));
    }
  });
}
