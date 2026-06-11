import type { Server, Socket } from 'socket.io';
import type {
  ChooseGoldPayload,
  JwtPayload,
  PassTurnPayload,
  PlaceCardPayload,
  PlayActionPayload,
} from '@zuychin-arcade/types';
import { MIN_PLAYERS } from '@zuychin-arcade/types';
import { getRoomPublicState, roomStore, type ServerRoom } from '../store/RoomStore.js';
import {
  advanceRound,
  chooseGold,
  initGame,
  isGoldDistributionComplete,
  passTurn,
  placeCard,
  playAction,
  type EngineResult,
} from '../game/saboteur/engine.js';
import { toPrivateState, toPublicState } from '../game/saboteur/publicState.js';
import { saveGameResult } from '../lib/saveGameResult.js';

const ROUND_END_PAUSE_MS = 12_000;

export function emitGameState(io: Server, room: ServerRoom): void {
  if (!room.gameState) return;
  io.to(room.roomCode).emit('game_state', toPublicState(room.gameState));
  for (const player of room.players.values()) {
    if (!player.socketId) continue;
    const priv = toPrivateState(room.gameState, player.playerId);
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
  const state = room.gameState;
  if (!state) return;

  if (state.status === 'round_end' && !room.nextRoundTimer && isGoldDistributionComplete(state)) {
    io.to(room.roomCode).emit(
      'role_reveal',
      [...state.players.values()].map((p) => ({
        playerId: p.playerId,
        displayName: p.displayName,
        role: p.role,
      })),
    );
    room.nextRoundTimer = setTimeout(() => {
      room.nextRoundTimer = null;
      advanceRound(state);
      if (state.status === 'game_over') {
        room.status = 'finished';
        void saveGameResult({
          roomCode: room.roomCode,
          players: [...state.players.values()].map((p) => ({
            playerId: p.playerId,
            displayName: p.displayName,
            totalNuggets: p.goldCollected,
            won: state.winnerIds?.includes(p.playerId) ?? false,
          })),
        });
        io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
      }
      emitGameState(io, room);
    }, ROUND_END_PAUSE_MS);
  }
}

export function registerGameHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', () => {
    const ctx = getAuthedRoom(socket);
    if (!ctx) return;
    const { room, auth } = ctx;

    if (room.hostPlayerId !== auth.playerId) {
      return socket.emit('action_rejected', { reason: 'Only the host can start the game' });
    }
    if (room.status === 'in_game' && room.gameState?.status !== 'game_over') {
      return socket.emit('action_rejected', { reason: 'Game already in progress' });
    }
    if (room.players.size < MIN_PLAYERS) {
      return socket.emit('action_rejected', { reason: `Need at least ${MIN_PLAYERS} players` });
    }

    room.gameState = initGame(
      room.roomCode,
      [...room.players.values()].map((p) => ({ playerId: p.playerId, displayName: p.displayName })),
    );
    room.status = 'in_game';
    roomStore.touch(room);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitGameState(io, room);
  });

  socket.on('place_card', (payload: PlaceCardPayload) => {
    const ctx = getAuthedRoom(socket);
    if (!ctx?.room.gameState) return;
    if (!payload?.cardId || !payload.position) {
      return socket.emit('action_rejected', { reason: 'Invalid payload' });
    }
    applyEngineCall(io, socket, ctx.room, placeCard(
      ctx.room.gameState,
      ctx.auth.playerId,
      payload.cardId,
      payload.position,
      Boolean(payload.rotated),
    ));
  });

  socket.on('play_action', (payload: PlayActionPayload) => {
    const ctx = getAuthedRoom(socket);
    if (!ctx?.room.gameState) return;
    if (!payload?.cardId) {
      return socket.emit('action_rejected', { reason: 'Invalid payload' });
    }
    applyEngineCall(io, socket, ctx.room, playAction(
      ctx.room.gameState,
      ctx.auth.playerId,
      payload.cardId,
      payload.targetPlayerId,
      payload.targetPosition,
      payload.chosenTool,
    ));
  });

  socket.on('pass_turn', (payload: PassTurnPayload) => {
    const ctx = getAuthedRoom(socket);
    if (!ctx?.room.gameState) return;
    applyEngineCall(io, socket, ctx.room, passTurn(
      ctx.room.gameState,
      ctx.auth.playerId,
      payload?.discardCardId,
    ));
  });

  socket.on('choose_gold', (payload: ChooseGoldPayload) => {
    const ctx = getAuthedRoom(socket);
    if (!ctx?.room.gameState) return;
    applyEngineCall(io, socket, ctx.room, chooseGold(
      ctx.room.gameState,
      ctx.auth.playerId,
      Number(payload?.cardIndex),
    ));
  });

  socket.on('request_state', () => {
    const ctx = getAuthedRoom(socket);
    if (!ctx) return;
    socket.emit('room_updated', getRoomPublicState(ctx.room));
    if (ctx.room.gameState) {
      socket.emit('game_state', toPublicState(ctx.room.gameState));
      const priv = toPrivateState(ctx.room.gameState, ctx.auth.playerId);
      if (priv) socket.emit('private_state', priv);
    }
  });
}
