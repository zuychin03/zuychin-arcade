import type { Server, Socket } from 'socket.io';
import type {
  ChooseGoldPayload,
  JwtPayload,
  PassTurnPayload,
  PlaceCardPayload,
  PlayActionPayload,
} from '@zuychin-arcade/types';
import { MIN_PLAYERS, ROUNDS_PER_GAME } from '@zuychin-arcade/types';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import {
  advanceRound,
  chooseGold,
  initGame,
  isGoldDistributionComplete,
  passTurn,
  placeCard,
  playAction,
  type EngineResult,
  type SaboteurServerState,
} from './engine.js';
import { toPrivateState, toPublicState } from './publicState.js';
import { saveGameResult } from '../../lib/saveGameResult.js';

const ROUND_END_PAUSE_MS = 12_000;

/** Narrow a room's tagged game union to the Saboteur engine state. */
function saboteurState(room: ServerRoom): SaboteurServerState | null {
  return room.game?.id === 'saboteur' ? room.game.state : null;
}

export function emitGameState(io: Server, room: ServerRoom): void {
  const state = saboteurState(room);
  if (!state) return;
  io.to(room.roomCode).emit('game_state', toPublicState(state));
  for (const player of room.players.values()) {
    if (!player.socketId) continue;
    const priv = toPrivateState(state, player.playerId);
    if (priv) io.to(player.socketId).emit('private_state', priv);
  }
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

function applyEngineCall(io: Server, socket: Socket, room: ServerRoom, result: EngineResult): void {
  if (!result.ok) {
    socket.emit('action_rejected', { reason: result.reason });
    return;
  }
  roomStore.touch(room);
  handleRoundTransition(io, room);
  emitGameState(io, room);
}

/**
 * When a round ends, broadcast the role reveal and — once gold has been fully
 * distributed — schedule the next round (or game over) after a pause so
 * clients can show the round-end overlay.
 */
function handleRoundTransition(io: Server, room: ServerRoom): void {
  const state = saboteurState(room);
  if (!state) return;

  if (state.status === 'round_end' && !room.timer && isGoldDistributionComplete(state)) {
    io.to(room.roomCode).emit(
      'role_reveal',
      [...state.players.values()].map((p) => ({
        playerId: p.playerId,
        displayName: p.displayName,
        role: p.role,
      })),
    );
    room.timer = setTimeout(() => {
      room.timer = null;
      advanceRound(state);
      if (state.status === 'game_over') {
        room.status = 'finished';
        void saveGameResult({
          gameName: 'saboteur',
          roomCode: room.roomCode,
          roundsPlayed: ROUNDS_PER_GAME,
          players: [...state.players.values()].map((p) => ({
            playerId: p.playerId,
            displayName: p.displayName,
            score: p.goldCollected,
            won: state.winnerIds?.includes(p.playerId) ?? false,
          })),
        });
        io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
      }
      emitGameState(io, room);
    }, ROUND_END_PAUSE_MS);
  }
}

export function registerSaboteurHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', () => {
    const ctx = getAuthedRoom(socket);
    if (!ctx) return;
    const { room, auth } = ctx;

    if (room.hostPlayerId !== auth.playerId) {
      return socket.emit('action_rejected', { reason: 'Only the host can start the game' });
    }
    if (room.status === 'in_game' && saboteurState(room)?.status !== 'game_over') {
      return socket.emit('action_rejected', { reason: 'Game already in progress' });
    }
    if (room.players.size < MIN_PLAYERS) {
      return socket.emit('action_rejected', { reason: `Need at least ${MIN_PLAYERS} players` });
    }

    room.game = {
      id: 'saboteur',
      state: initGame(
        room.roomCode,
        [...room.players.values()].map((p) => ({ playerId: p.playerId, displayName: p.displayName })),
      ),
    };
    room.status = 'in_game';
    roomStore.touch(room);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitGameState(io, room);
  });

  socket.on('place_card', (payload: PlaceCardPayload) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && saboteurState(ctx.room);
    if (!ctx || !state) return;
    if (!payload?.cardId || !payload.position) {
      return socket.emit('action_rejected', { reason: 'Invalid payload' });
    }
    applyEngineCall(io, socket, ctx.room, placeCard(
      state,
      ctx.auth.playerId,
      payload.cardId,
      payload.position,
      Boolean(payload.rotated),
    ));
  });

  socket.on('play_action', (payload: PlayActionPayload) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && saboteurState(ctx.room);
    if (!ctx || !state) return;
    if (!payload?.cardId) {
      return socket.emit('action_rejected', { reason: 'Invalid payload' });
    }
    applyEngineCall(io, socket, ctx.room, playAction(
      state,
      ctx.auth.playerId,
      payload.cardId,
      payload.targetPlayerId,
      payload.targetPosition,
      payload.chosenTool,
    ));
  });

  socket.on('pass_turn', (payload: PassTurnPayload) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && saboteurState(ctx.room);
    if (!ctx || !state) return;
    applyEngineCall(io, socket, ctx.room, passTurn(
      state,
      ctx.auth.playerId,
      payload?.discardCardId,
    ));
  });

  socket.on('choose_gold', (payload: ChooseGoldPayload) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && saboteurState(ctx.room);
    if (!ctx || !state) return;
    applyEngineCall(io, socket, ctx.room, chooseGold(
      state,
      ctx.auth.playerId,
      Number(payload?.cardIndex),
    ));
  });

  socket.on('request_state', () => {
    const ctx = getAuthedRoom(socket);
    if (!ctx) return;
    socket.emit('room_updated', getRoomPublicState(ctx.room));
    const state = saboteurState(ctx.room);
    if (state) {
      socket.emit('game_state', toPublicState(state));
      const priv = toPrivateState(state, ctx.auth.playerId);
      if (priv) socket.emit('private_state', priv);
    }
  });
}
