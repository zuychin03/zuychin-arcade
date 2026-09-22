import type { Server, Socket } from 'socket.io';
import type {
  SkullKingActionKind,
  SkullKingBidPayload,
  SkullKingPlayPayload,
} from '@zuychin-arcade/types';
import { SKULL_KING_MIN_PLAYERS, SKULL_KING_ROUNDS } from '@zuychin-arcade/types';
import { saveGameResult } from '../../lib/saveGameResult.js';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import { getCurrentSocketSession, prepareRoomForStart } from '../../socket/roomLifecycle.js';
import {
  forfeitPlayers,
  initSkullKingGame,
  playCard,
  submitBid,
  type EngineResult,
  type SkullKingServerState,
} from './engine.js';
import { toSkullKingPrivateState, toSkullKingPublicState } from './publicState.js';
import { isTigressMode } from './resolver.js';

const CARD_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

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

export function isSkullKingStartPayload(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.keys(value).length === 0);
}

export function isSkullKingBidPayload(value: unknown): value is SkullKingBidPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['bid', 'expectedRevision'])
    && hasOwn(value, 'bid')
    && hasOwn(value, 'expectedRevision')
    && typeof value.bid === 'number'
    && Number.isSafeInteger(value.bid)
    && value.bid >= 0
    && value.bid <= SKULL_KING_ROUNDS
    && isExpectedRevision(value.expectedRevision);
}

export function isSkullKingPlayPayload(value: unknown): value is SkullKingPlayPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['cardId', 'tigressMode', 'expectedRevision'])
    && hasOwn(value, 'cardId')
    && hasOwn(value, 'expectedRevision')
    && typeof value.cardId === 'string'
    && CARD_ID_RE.test(value.cardId)
    && (!hasOwn(value, 'tigressMode') || isTigressMode(value.tigressMode))
    && isExpectedRevision(value.expectedRevision);
}

function gameState(room: ServerRoom): SkullKingServerState | null {
  return room.game?.id === 'skull_king' ? room.game.state : null;
}

function context(socket: Socket) {
  const current = getCurrentSocketSession(socket);
  if (!current || current.room.gameId !== 'skull_king') {
    socket.emit('server_error', { message: 'This connection is not authorised for the Skull King room' });
    return null;
  }
  return current;
}

function withState(socket: Socket) {
  const value = context(socket);
  if (!value) return null;
  const state = gameState(value.room);
  if (!state || !state.players.has(value.auth.playerId)) {
    socket.emit('action_rejected', { reason: 'Skull King has not started for this seat' });
    return null;
  }
  return { ...value, state };
}

function emitState(io: Server, room: ServerRoom): void {
  const state = gameState(room);
  if (!state) return;
  for (const player of room.players.values()) {
    if (player.socketId && player.isConnected && !player.hasLeft && state.players.has(player.playerId)) {
      io.to(player.socketId).emit('game_state', toSkullKingPublicState(state));
      io.to(player.socketId).emit('private_state', toSkullKingPrivateState(state, player.playerId));
    }
  }
}

export function buildSkullKingResult(state: SkullKingServerState) {
  if (state.status !== 'game_over' || state.winnerIds.length === 0) return null;
  return {
    gameName: 'skull_king',
    roomCode: state.roomCode,
    roundsPlayed: state.roundNumber,
    players: [...state.players.values()].filter(player => !player.forfeited).map((player) => {
      return {
        playerId: player.playerId,
        displayName: player.displayName,
        score: player.totalScore,
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
  const result = buildSkullKingResult(state);
  if (result) void saveGameResult(result);
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
}

function emitAccepted(socket: Socket, action: SkullKingActionKind, revision: number): void {
  socket.emit('skull_king:action_accepted', { action, revision });
}

function apply(
  io: Server,
  socket: Socket,
  room: ServerRoom,
  action: Exclude<SkullKingActionKind, 'start'>,
  result: EngineResult,
): void {
  if (!result.ok) {
    socket.emit('action_rejected', { reason: result.reason });
    return;
  }
  const state = gameState(room)!;
  emitAccepted(socket, action, state.revision);
  roomStore.touch(room);
  finalizeIfOver(io, room);
  emitState(io, room);
}

function rejectInvalidPayload(socket: Socket): void {
  socket.emit('action_rejected', { reason: 'Invalid payload' });
}

export function recoverDisconnectedSkullKingPlayers(io: Server, room: ServerRoom): boolean {
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
  const result = forfeitPlayers(state, forfeitingPlayerIds, state.revision);
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
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
  emitState(io, room);
  return true;
}

function recoverBeforeAction(io: Server, socket: Socket, room: ServerRoom, expectedRevision: number): boolean {
  if (!recoverDisconnectedSkullKingPlayers(io, room) || expectedRevision === gameState(room)!.revision) return true;
  socket.emit('action_rejected', { reason: 'Game state changed. Please try again.' });
  return false;
}

export function registerSkullKingHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    const { room, auth } = value;
    if (!isSkullKingStartPayload(payload)) return rejectInvalidPayload(socket);
    if (room.hostPlayerId !== auth.playerId) {
      socket.emit('action_rejected', { reason: 'Only the host can start the game' });
      return;
    }
    if (room.status === 'in_game') {
      socket.emit('action_rejected', { reason: 'Game already in progress' });
      return;
    }
    if (!prepareRoomForStart(io, socket, room)) return;
    const connectedPlayers = [...room.players.values()]
      .filter((player) => player.isConnected && !player.hasLeft);
    if (connectedPlayers.length < SKULL_KING_MIN_PLAYERS) {
      socket.emit('action_rejected', {
        reason: 'Need at least ' + SKULL_KING_MIN_PLAYERS + ' connected players',
      });
      return;
    }
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    const nextRevision = room.game?.id === 'skull_king' ? room.game.state.revision + 1 : 0;
    room.game = {
      id: 'skull_king',
      state: initSkullKingGame(
        room.roomCode,
        connectedPlayers.map((player) => ({
          playerId: player.playerId,
          displayName: player.displayName,
        })),
      ),
    };
    room.game.state.revision = nextRevision;
    room.game.state.biddingRevision = nextRevision;
    room.status = 'in_game';
    roomStore.touch(room);
    emitAccepted(socket, 'start', room.game.state.revision);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitState(io, room);
  });

  socket.on('skull_king:bid', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isSkullKingBidPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(
      io,
      socket,
      value.room,
      'bid',
      submitBid(value.state, value.auth.playerId, payload.bid, payload.expectedRevision),
    );
  });

  socket.on('skull_king:play', (payload: unknown) => {
    const value = withState(socket);
    if (!value) return;
    if (!isSkullKingPlayPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(
      io,
      socket,
      value.room,
      'play',
      playCard(
        value.state,
        value.auth.playerId,
        payload.cardId,
        payload.tigressMode,
        payload.expectedRevision,
      ),
    );
  });

  socket.on('request_state', (payload: unknown) => {
    const value = context(socket);
    if (!value) return;
    if (!isSkullKingStartPayload(payload)) return rejectInvalidPayload(socket);
    recoverDisconnectedSkullKingPlayers(io, value.room);
    socket.emit('room_updated', getRoomPublicState(value.room));
    const state = gameState(value.room);
    if (state && state.players.has(value.auth.playerId)) {
      socket.emit('game_state', toSkullKingPublicState(state));
      socket.emit('private_state', toSkullKingPrivateState(state, value.auth.playerId));
    }
  });
}
