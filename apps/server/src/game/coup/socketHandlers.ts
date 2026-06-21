import type { Server, Socket } from 'socket.io';
import type {
  CoupActionPayload,
  CoupExchangePayload,
  CoupLoseInfluencePayload,
  CoupRespondPayload,
  JwtPayload,
} from '@zuychin-arcade/types';
import { COUP_LIMITS } from '@zuychin-arcade/types';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import {
  chooseExchange,
  declareAction,
  expireWindow,
  initGame,
  loseInfluence,
  respond,
  type CoupServerState,
  type EngineResult,
} from './engine.js';
import { toPrivateState, toPublicState } from './publicState.js';
import { saveGameResult } from '../../lib/saveGameResult.js';

function coupState(room: ServerRoom): CoupServerState | null {
  return room.game?.id === 'coup' ? room.game.state : null;
}

function getAuthedRoom(socket: Socket): { room: ServerRoom; auth: JwtPayload } | null {
  const auth = socket.data.auth as JwtPayload;
  const room = roomStore.get(auth.roomCode);
  if (!room) {
    socket.emit('server_error', { message: 'Room no longer exists' });
    return null;
  }
  return { room, auth };
}

function emitCoupState(io: Server, room: ServerRoom): void {
  const state = coupState(room);
  if (!state) return;
  io.to(room.roomCode).emit('game_state', toPublicState(state));
  for (const player of room.players.values()) {
    if (!player.socketId) continue;
    const priv = toPrivateState(state, player.playerId);
    if (priv) io.to(player.socketId).emit('private_state', priv);
  }
}

function finalizeIfOver(io: Server, room: ServerRoom): void {
  const state = coupState(room);
  if (state && state.status === 'game_over' && room.status !== 'finished') {
    room.status = 'finished';
    void saveGameResult({
      gameName: 'coup',
      roomCode: room.roomCode,
      players: [...state.players.values()].map((p) => ({
        playerId: p.playerId,
        displayName: p.displayName,
        score: 0, // Coup ranks by wins, not score
        won: p.playerId === state.winnerId,
      })),
    });
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
  }
}

/**
 * Arm (or clear) the per-room auto-pass timer to match the current pending
 * deadline. When a response/decision window expires, the engine's expireWindow
 * advances the machine; we re-emit and re-arm for whatever window comes next.
 */
function syncTimer(io: Server, room: ServerRoom): void {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  const state = coupState(room);
  if (!state || state.status !== 'playing') return;
  const deadline = state.pending.deadline;
  if (deadline == null) return;

  room.timer = setTimeout(() => {
    room.timer = null;
    const s = coupState(room);
    if (!s || s.status !== 'playing') return;
    expireWindow(s);
    roomStore.touch(room);
    finalizeIfOver(io, room);
    emitCoupState(io, room);
    syncTimer(io, room);
  }, Math.max(0, deadline - Date.now()));
}

function applyEngineCall(io: Server, socket: Socket, room: ServerRoom, result: EngineResult): void {
  if (!result.ok) {
    socket.emit('action_rejected', { reason: result.reason });
    return;
  }
  roomStore.touch(room);
  finalizeIfOver(io, room);
  emitCoupState(io, room);
  syncTimer(io, room);
}

export function registerCoupHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', () => {
    const ctx = getAuthedRoom(socket);
    if (!ctx) return;
    const { room, auth } = ctx;

    if (room.hostPlayerId !== auth.playerId) {
      return socket.emit('action_rejected', { reason: 'Only the host can start the game' });
    }
    if (room.status === 'in_game' && coupState(room)?.status !== 'game_over') {
      return socket.emit('action_rejected', { reason: 'Game already in progress' });
    }
    const variant = room.config.coupVariant ?? 'base';
    const min = COUP_LIMITS[variant].min;
    if (room.players.size < min) {
      return socket.emit('action_rejected', { reason: `Need at least ${min} players` });
    }

    room.game = {
      id: 'coup',
      state: initGame(
        room.roomCode,
        variant,
        [...room.players.values()].map((p) => ({ playerId: p.playerId, displayName: p.displayName })),
      ),
    };
    room.status = 'in_game';
    roomStore.touch(room);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitCoupState(io, room);
    syncTimer(io, room);
  });

  socket.on('coup:action', (payload: CoupActionPayload) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && coupState(ctx.room);
    if (!ctx || !state) return;
    if (!payload?.action) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    applyEngineCall(io, socket, ctx.room, declareAction(state, ctx.auth.playerId, payload));
  });

  socket.on('coup:respond', (payload: CoupRespondPayload) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && coupState(ctx.room);
    if (!ctx || !state) return;
    if (!payload?.response) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    applyEngineCall(io, socket, ctx.room, respond(state, ctx.auth.playerId, payload));
  });

  socket.on('coup:lose_influence', (payload: CoupLoseInfluencePayload) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && coupState(ctx.room);
    if (!ctx || !state) return;
    if (!payload?.character) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    applyEngineCall(io, socket, ctx.room, loseInfluence(state, ctx.auth.playerId, payload.character));
  });

  socket.on('coup:exchange', (payload: CoupExchangePayload) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && coupState(ctx.room);
    if (!ctx || !state) return;
    if (!Array.isArray(payload?.keep)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    applyEngineCall(io, socket, ctx.room, chooseExchange(state, ctx.auth.playerId, payload.keep));
  });

  socket.on('request_state', () => {
    const ctx = getAuthedRoom(socket);
    if (!ctx) return;
    socket.emit('room_updated', getRoomPublicState(ctx.room));
    const state = coupState(ctx.room);
    if (state) {
      socket.emit('game_state', toPublicState(state));
      const priv = toPrivateState(state, ctx.auth.playerId);
      if (priv) socket.emit('private_state', priv);
    }
  });
}
