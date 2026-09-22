import type { Server, Socket } from 'socket.io';
import type {
  ChooseGoldPayload,
  JwtPayload,
  PassTurnPayload,
  PlaceCardPayload,
  PlayActionPayload,
  SaboteurActionKind,
  Tool,
} from '@zuychin-arcade/types';
import { BOARD, MIN_PLAYERS, MAX_PLAYERS } from '@zuychin-arcade/types';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import {
  advanceRound,
  chooseGold,
  forfeitSaboteurPlayers,
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
const CARD_ID_RE = /^(?:path|action)-(?:0|[1-9]\d{0,2})$/;
const PLAYER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOOLS: readonly Tool[] = ['lantern', 'cart', 'pickaxe'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasRevision(value: Record<string, unknown>): boolean {
  return hasOwn(value, 'expectedRevision') && typeof value.expectedRevision === 'number'
    && Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0;
}

export function isSaboteurStartPayload(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.keys(value).length === 0);
}

function isCardId(value: unknown): value is string {
  return typeof value === 'string' && CARD_ID_RE.test(value);
}

function isPathCardId(value: unknown): value is string {
  return isCardId(value) && value.startsWith('path-');
}

function isActionCardId(value: unknown): value is string {
  return isCardId(value) && value.startsWith('action-');
}

function isPlayerId(value: unknown): value is string {
  return typeof value === 'string' && PLAYER_ID_RE.test(value);
}

function isTool(value: unknown): value is Tool {
  return typeof value === 'string' && (TOOLS as readonly string[]).includes(value);
}

function isBoardPosition(value: unknown): value is { row: number; col: number } {
  if (!isRecord(value) || !hasOnlyKeys(value, ['row', 'col'])) return false;
  if (!hasOwn(value, 'row') || !hasOwn(value, 'col')) return false;
  if (typeof value.row !== 'number' || typeof value.col !== 'number') return false;
  if (!Number.isSafeInteger(value.row) || !Number.isSafeInteger(value.col)) return false;
  return value.row >= BOARD.playableBounds.minRow
    && value.row <= BOARD.playableBounds.maxRow
    && value.col >= BOARD.playableBounds.minCol
    && value.col <= BOARD.playableBounds.maxCol;
}

export function isPlaceCardPayload(value: unknown): value is PlaceCardPayload {
  if (!isRecord(value) || !hasRevision(value) || !hasOnlyKeys(value, ['cardId', 'position', 'rotated', 'expectedRevision'])) return false;
  return hasOwn(value, 'cardId')
    && hasOwn(value, 'position')
    && hasOwn(value, 'rotated')
    && isPathCardId(value.cardId)
    && isBoardPosition(value.position)
    && typeof value.rotated === 'boolean';
}

export function isPlayActionPayload(value: unknown): value is PlayActionPayload {
  if (!isRecord(value) || !hasRevision(value) || !hasOnlyKeys(value, ['cardId', 'targetPlayerId', 'targetPosition', 'chosenTool', 'expectedRevision'])) {
    return false;
  }
  if (!hasOwn(value, 'cardId') || !isActionCardId(value.cardId)) return false;
  if (hasOwn(value, 'targetPlayerId') && !isPlayerId(value.targetPlayerId)) return false;
  if (hasOwn(value, 'targetPosition') && !isBoardPosition(value.targetPosition)) return false;
  if (hasOwn(value, 'chosenTool') && !isTool(value.chosenTool)) return false;
  return true;
}

export function isPassTurnPayload(value: unknown): value is PassTurnPayload {
  if (!isRecord(value) || !hasRevision(value) || !hasOnlyKeys(value, ['discardCardId', 'expectedRevision'])) return false;
  return !hasOwn(value, 'discardCardId') || isCardId(value.discardCardId);
}

export function isChooseGoldPayload(value: unknown): value is ChooseGoldPayload {
  if (!isRecord(value) || !hasRevision(value) || !hasOnlyKeys(value, ['cardIndex', 'expectedRevision'])) return false;
  return hasOwn(value, 'cardIndex')
    && typeof value.cardIndex === 'number'
    && Number.isSafeInteger(value.cardIndex)
    && value.cardIndex >= 0 && value.cardIndex < MAX_PLAYERS;
}

function saboteurState(room: ServerRoom): SaboteurServerState | null {
  return room.game?.id === 'saboteur' ? room.game.state : null;
}

export function emitGameState(io: Server, room: ServerRoom): void {
  const state = saboteurState(room);
  if (!state) return;
  io.to(room.roomCode).emit('game_state', toPublicState(state));
  for (const player of room.players.values()) {
    if (!player.socketId || !player.isConnected || player.hasLeft) continue;
    const priv = toPrivateState(state, player.playerId);
    if (priv) io.to(player.socketId).emit('private_state', priv);
  }
}

function getAuthedRoom(socket: Socket): { room: ServerRoom; auth: JwtPayload } | null {
  const auth = socket.data.auth as JwtPayload;
  const room = roomStore.get(auth.roomCode);
  const player = room?.players.get(auth.playerId);
  if (
    !room
    || room.gameId !== 'saboteur'
    || !player
    || player.hasLeft
    || !player.isConnected
    || player.socketId !== socket.id
    || !socket.rooms.has(room.roomCode)
  ) {
    socket.emit('server_error', { message: 'This connection is not authorised for the room' });
    return null;
  }
  return { room, auth };
}

function applyEngineCall(io: Server, socket: Socket, room: ServerRoom, action: SaboteurActionKind, result: EngineResult): void {
  if (!result.ok) {
    socket.emit('action_rejected', { reason: result.reason });
    return;
  }
  roomStore.touch(room);
  settleAndEmit(io, room);
  socket.emit('saboteur:action_accepted', { action, revision: saboteurState(room)!.revision });
}

function hasCurrentRevision(io: Server, socket: Socket, room: ServerRoom, state: SaboteurServerState, expectedRevision: number): boolean {
  recoverDisconnectedSaboteurPlayers(io, room);
  if (state.revision === expectedRevision) return true;
  socket.emit('action_rejected', { reason: 'Game state changed. Review the current state and try again.' });
  return false;
}

function isPastReconnectGrace(room: ServerRoom, playerId: string, now: number): boolean {
  const player = room.players.get(playerId);
  return !player || player.hasLeft || (
    !player.isConnected
    && player.reconnectDeadlineAt !== null
    && player.reconnectDeadlineAt <= now
  );
}

function recoverExpiredAbsentees(room: ServerRoom, now = Date.now()): boolean {
  const state = saboteurState(room);
  if (!state) return false;
  const departed = [...state.players.keys()].filter(playerId => isPastReconnectGrace(room, playerId, now));
  return forfeitSaboteurPlayers(state, departed);
}

function settleAndEmit(io: Server, room: ServerRoom): void {
  recoverExpiredAbsentees(room);
  handleRoundTransition(io, room);
  emitGameState(io, room);
}

export function recoverDisconnectedSaboteurPlayers(io: Server, room: ServerRoom): boolean {
  const changed = recoverExpiredAbsentees(room);
  if (!changed) return false;
  roomStore.touch(room);
  handleRoundTransition(io, room);
  emitGameState(io, room);
  return true;
}

function handleRoundTransition(io: Server, room: ServerRoom): void {
  const state = saboteurState(room);
  if (!state) return;

  if (state.status === 'game_over') {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    if (room.status !== 'finished') {
      room.status = 'finished';
      const players = [...state.players.values()].filter(player => !player.forfeited);
      if (!state.terminationReason && state.winnerIds?.length && players.length > 0) {
        void saveGameResult({
          gameName: 'saboteur', roomCode: room.roomCode, roundsPlayed: state.round,
          players: players.map(player => ({
            playerId: player.playerId, displayName: player.displayName,
            score: player.goldCollected, won: state.winnerIds!.includes(player.playerId),
          })),
        });
      }
      io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    }
    return;
  }

  if (state.status === 'round_end' && !room.timer && isGoldDistributionComplete(state)) {
    io.to(room.roomCode).emit(
      'role_reveal',
      state.roundPlayerIds.map(playerId => state.players.get(playerId)!).map((p) => ({
        playerId: p.playerId,
        displayName: p.displayName,
        role: p.role,
      })),
    );
    room.timer = setTimeout(() => {
      room.timer = null;
      if (roomStore.get(room.roomCode) !== room || saboteurState(room) !== state) return;
      recoverExpiredAbsentees(room);
      advanceRound(state);
      roomStore.touch(room);
      settleAndEmit(io, room);
    }, ROUND_END_PAUSE_MS);
  }
}

export function registerSaboteurHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    if (!ctx) return;
    const { room, auth } = ctx;

    if (!isSaboteurStartPayload(payload)) {
      return socket.emit('action_rejected', { reason: 'Invalid payload' });
    }

    if (room.hostPlayerId !== auth.playerId) {
      return socket.emit('action_rejected', { reason: 'Only the host can start the game' });
    }
    if (room.status === 'in_game' && saboteurState(room)?.status !== 'game_over') {
      return socket.emit('action_rejected', { reason: 'Game already in progress' });
    }
    const eligiblePlayers = [...room.players.values()].filter(player => !player.hasLeft);
    if (eligiblePlayers.some(player => !player.isConnected)) {
      return socket.emit('action_rejected', { reason: 'Wait for connecting or reconnecting players' });
    }
    const connectedPlayers = eligiblePlayers.filter(player => player.isConnected);
    if (connectedPlayers.length < MIN_PLAYERS || connectedPlayers.length > MAX_PLAYERS) {
      return socket.emit('action_rejected', { reason: `Need ${MIN_PLAYERS}–${MAX_PLAYERS} connected players` });
    }

    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    const previousRevision = saboteurState(room)?.revision ?? 0;

    room.game = {
      id: 'saboteur',
      state: initGame(
        room.roomCode,
        connectedPlayers.map((p) => ({ playerId: p.playerId, displayName: p.displayName })),
      ),
    };
    room.game.state.revision = previousRevision + 1;
    room.status = 'in_game';
    roomStore.touch(room);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitGameState(io, room);
    socket.emit('saboteur:action_accepted', { action: 'start_game', revision: room.game.state.revision });
  });

  socket.on('place_card', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && saboteurState(ctx.room);
    if (!ctx) return;
    if (!state) return socket.emit('action_rejected', { reason: 'Game has not started' });
    if (!isPlaceCardPayload(payload)) {
      return socket.emit('action_rejected', { reason: 'Invalid payload' });
    }
    if (!hasCurrentRevision(io, socket, ctx.room, state, payload.expectedRevision)) return;
    applyEngineCall(io, socket, ctx.room, 'place_card', placeCard(
      state,
      ctx.auth.playerId,
      payload.cardId,
      payload.position,
      payload.rotated,
    ));
  });

  socket.on('play_action', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && saboteurState(ctx.room);
    if (!ctx) return;
    if (!state) return socket.emit('action_rejected', { reason: 'Game has not started' });
    if (!isPlayActionPayload(payload)) {
      return socket.emit('action_rejected', { reason: 'Invalid payload' });
    }
    if (!hasCurrentRevision(io, socket, ctx.room, state, payload.expectedRevision)) return;
    applyEngineCall(io, socket, ctx.room, 'play_action', playAction(
      state,
      ctx.auth.playerId,
      payload.cardId,
      payload.targetPlayerId,
      payload.targetPosition,
      payload.chosenTool,
    ));
  });

  socket.on('pass_turn', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && saboteurState(ctx.room);
    if (!ctx) return;
    if (!state) return socket.emit('action_rejected', { reason: 'Game has not started' });
    if (!isPassTurnPayload(payload)) {
      return socket.emit('action_rejected', { reason: 'Invalid payload' });
    }
    if (!hasCurrentRevision(io, socket, ctx.room, state, payload.expectedRevision)) return;
    applyEngineCall(io, socket, ctx.room, 'pass_turn', passTurn(
      state,
      ctx.auth.playerId,
      payload.discardCardId,
    ));
  });

  socket.on('choose_gold', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && saboteurState(ctx.room);
    if (!ctx) return;
    if (!state) return socket.emit('action_rejected', { reason: 'Game has not started' });
    if (!isChooseGoldPayload(payload)) {
      return socket.emit('action_rejected', { reason: 'Invalid payload' });
    }
    if (!hasCurrentRevision(io, socket, ctx.room, state, payload.expectedRevision)) return;
    applyEngineCall(io, socket, ctx.room, 'choose_gold', chooseGold(
      state,
      ctx.auth.playerId,
      payload.cardIndex,
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
