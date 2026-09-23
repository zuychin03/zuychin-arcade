import type { Server, Socket } from 'socket.io';
import type {
  CoupActionPayload,
  CoupAllegiancePayload,
  CoupExaminePayload,
  CoupExamineSelectPayload,
  CoupActionKind,
  CoupChallengeDecisionPayload,
  CoupExchangePayload,
  CoupLoseInfluencePayload,
  CoupRespondPayload,
  JwtPayload,
} from '@zuychin-arcade/types';
import { COUP_LIMITS } from '@zuychin-arcade/types';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import {
  chooseExchange,
  chooseAllegiance,
  selectExamine,
  decideExamine,
  declareAction,
  expireWindow,
  forfeitPlayers,
  initGame,
  loseInfluence,
  resolveChallenge,
  respond,
  type CoupServerState,
  type EngineResult,
} from './engine.js';
import { toPrivateState, toPublicState } from './publicState.js';
import { saveGameResult } from '../../lib/saveGameResult.js';

const COUP_ACTIONS = [
  'income',
  'foreign_aid',
  'coup',
  'tax',
  'assassinate',
  'steal',
  'exchange',
  'convert',
  'embezzle',
  'inquisitor_exchange',
  'inquisitor_examine',
] as const;
const COUP_RESPONSES = ['challenge', 'block', 'pass'] as const;
const COUP_CHARACTERS = ['duke', 'assassin', 'captain', 'ambassador', 'contessa', 'inquisitor'] as const;
const PLAYER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isExpectedRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPlayerId(value: unknown): value is string {
  return typeof value === 'string' && PLAYER_ID_RE.test(value);
}

function isCoupAction(value: unknown): value is CoupActionPayload['action'] {
  return typeof value === 'string' && (COUP_ACTIONS as readonly string[]).includes(value);
}

function isCoupResponse(value: unknown): value is CoupRespondPayload['response'] {
  return typeof value === 'string' && (COUP_RESPONSES as readonly string[]).includes(value);
}

function isCoupCharacter(value: unknown): value is CoupLoseInfluencePayload['character'] {
  return typeof value === 'string' && (COUP_CHARACTERS as readonly string[]).includes(value);
}

export function isCoupActionPayload(value: unknown): value is CoupActionPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['action', 'targetPlayerId', 'expectedRevision'])) return false;
  if (!hasOwn(value, 'action') || !isCoupAction(value.action)) return false;
  if (!hasOwn(value, 'expectedRevision') || !isExpectedRevision(value.expectedRevision)) return false;
  return !hasOwn(value, 'targetPlayerId') || isPlayerId(value.targetPlayerId);
}

export function isCoupRespondPayload(value: unknown): value is CoupRespondPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['response', 'blockCharacter', 'expectedRevision'])) return false;
  if (!hasOwn(value, 'response') || !isCoupResponse(value.response)) return false;
  if (!hasOwn(value, 'expectedRevision') || !isExpectedRevision(value.expectedRevision)) return false;
  if (value.response === 'block') {
    return !hasOwn(value, 'blockCharacter') || isCoupCharacter(value.blockCharacter);
  }
  return !hasOwn(value, 'blockCharacter');
}

export function isCoupLoseInfluencePayload(value: unknown): value is CoupLoseInfluencePayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['character', 'expectedRevision'])) return false;
  return hasOwn(value, 'character')
    && isCoupCharacter(value.character)
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isCoupExchangePayload(value: unknown): value is CoupExchangePayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['keep', 'expectedRevision'])) return false;
  return hasOwn(value, 'keep')
    && Array.isArray(value.keep)
    && value.keep.length >= 1
    && value.keep.length <= 2
    && value.keep.every(isCoupCharacter)
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isCoupChallengeDecisionPayload(value: unknown): value is CoupChallengeDecisionPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['prove', 'expectedRevision'])) return false;
  return hasOwn(value, 'prove')
    && typeof value.prove === 'boolean'
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isCoupStartPayload(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.keys(value).length === 0);
}

export function isCoupAllegiancePayload(value: unknown): value is CoupAllegiancePayload {
  return isRecord(value) && hasOnlyKeys(value, ['allegiance', 'expectedRevision'])
    && hasOwn(value, 'allegiance') && (value.allegiance === 'loyalist' || value.allegiance === 'reformist')
    && hasOwn(value, 'expectedRevision') && isExpectedRevision(value.expectedRevision);
}

export function isCoupExamineSelectPayload(value: unknown): value is CoupExamineSelectPayload {
  return isCoupLoseInfluencePayload(value);
}

export function isCoupExaminePayload(value: unknown): value is CoupExaminePayload {
  return isRecord(value) && hasOnlyKeys(value, ['forceSwap', 'expectedRevision'])
    && hasOwn(value, 'forceSwap') && typeof value.forceSwap === 'boolean'
    && hasOwn(value, 'expectedRevision') && isExpectedRevision(value.expectedRevision);
}

function coupState(room: ServerRoom): CoupServerState | null {
  return room.game?.id === 'coup' ? room.game.state : null;
}

function getAuthedRoom(socket: Socket): { room: ServerRoom; auth: JwtPayload } | null {
  const auth = socket.data.auth as JwtPayload;
  const room = roomStore.get(auth.roomCode);
  const player = room?.players.get(auth.playerId);
  if (
    !room
    || room.gameId !== 'coup'
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

function emitCoupState(io: Server, room: ServerRoom): void {
  const state = coupState(room);
  if (!state) return;
  io.to(room.roomCode).emit('game_state', toPublicState(state));
  for (const player of room.players.values()) {
    if (!player.socketId || !player.isConnected || player.hasLeft) continue;
    const priv = toPrivateState(state, player.playerId);
    if (priv) io.to(player.socketId).emit('private_state', priv);
  }
}

export function buildCoupResult(state: CoupServerState) {
  if (state.status !== 'game_over' || !state.winnerId || state.terminationReason) return null;
  return {
    gameName: 'coup',
    roomCode: state.roomCode,
    players: [...state.players.values()].filter(player => !player.forfeited).map(player => ({
      playerId: player.playerId,
      displayName: player.displayName,
      score: 0,
      won: player.playerId === state.winnerId,
    })),
  };
}

function finalizeIfOver(io: Server, room: ServerRoom): void {
  const state = coupState(room);
  if (state && state.status === 'game_over' && room.status !== 'finished') {
    room.status = 'finished';
    const result = buildCoupResult(state);
    if (result) void saveGameResult(result);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
  }
}

function syncTimer(io: Server, room: ServerRoom): void {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  const state = coupState(room);
  if (!state || state.status !== 'playing') return;
  const deadline = state.pending.deadline;
  if (deadline == null) return;
  const expectedRevision = state.revision;
  const expectedPhase = state.pending.phase;

  const timer = setTimeout(() => {
    if (roomStore.get(room.roomCode) !== room || room.timer !== timer) return;
    room.timer = null;
    const s = coupState(room);
    if (
      !s
      || s !== state
      || s.status !== 'playing'
      || s.revision !== expectedRevision
      || s.pending.phase !== expectedPhase
      || s.pending.deadline !== deadline
    ) return;
    if (recoverDisconnectedCoupPlayers(io, room)) return;
    const result = expireWindow(s, expectedRevision);
    if (!result.ok) return;
    settleAndEmit(io, room);
  }, Math.max(0, deadline - Date.now()));
  timer.unref();
  room.timer = timer;
}

function applyEngineCall(io: Server, socket: Socket, room: ServerRoom, action: CoupActionKind, result: EngineResult): void {
  if (!result.ok) {
    socket.emit('action_rejected', { reason: result.reason });
    return;
  }
  settleAndEmit(io, room);
  socket.emit('coup:action_accepted', { action, revision: coupState(room)!.revision });
}

function isPastReconnectGrace(room: ServerRoom, playerId: string, now: number): boolean {
  const player = room.players.get(playerId);
  return Boolean(
    player
    && !player.hasLeft
    && !player.isConnected
    && player.reconnectDeadlineAt !== null
    && player.reconnectDeadlineAt <= now,
  );
}

function recoverExpiredAbsentees(room: ServerRoom, now = Date.now()): boolean {
  const state = coupState(room);
  if (!state || state.status !== 'playing') return false;
  const forfeitingPlayerIds = state.turnOrder.filter((playerId) => {
      const gamePlayer = state.players.get(playerId);
      const roomPlayer = room.players.get(playerId);
      return Boolean(gamePlayer && !gamePlayer.eliminated && (
        !roomPlayer || roomPlayer.hasLeft || isPastReconnectGrace(room, playerId, now)
      ));
    });
  return forfeitingPlayerIds.length > 0 && forfeitPlayers(state, forfeitingPlayerIds, state.revision).ok;
}

function settleAndEmit(io: Server, room: ServerRoom): void {
  recoverExpiredAbsentees(room);
  roomStore.touch(room);
  finalizeIfOver(io, room);
  emitCoupState(io, room);
  syncTimer(io, room);
}

export function recoverDisconnectedCoupPlayers(io: Server, room: ServerRoom): boolean {
  const changed = recoverExpiredAbsentees(room);
  if (!changed) return false;
  roomStore.touch(room);
  finalizeIfOver(io, room);
  emitCoupState(io, room);
  syncTimer(io, room);
  return true;
}

export function registerCoupHandlers(io: Server, socket: Socket): void {
  socket.on('coup:choose_allegiance', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && coupState(ctx.room);
    if (!ctx || !state) return;
    if (!isCoupAllegiancePayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    recoverDisconnectedCoupPlayers(io, ctx.room);
    applyEngineCall(io, socket, ctx.room, 'choose_allegiance', chooseAllegiance(state, ctx.auth.playerId, payload.allegiance, payload.expectedRevision));
  });

  socket.on('coup:examine_select', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && coupState(ctx.room);
    if (!ctx || !state) return;
    if (!isCoupExamineSelectPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    recoverDisconnectedCoupPlayers(io, ctx.room);
    applyEngineCall(io, socket, ctx.room, 'examine_select', selectExamine(state, ctx.auth.playerId, payload.character, payload.expectedRevision));
  });

  socket.on('coup:examine', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && coupState(ctx.room);
    if (!ctx || !state) return;
    if (!isCoupExaminePayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    recoverDisconnectedCoupPlayers(io, ctx.room);
    applyEngineCall(io, socket, ctx.room, 'examine', decideExamine(state, ctx.auth.playerId, payload.forceSwap, payload.expectedRevision));
  });

  socket.on('start_game', (payload?: unknown) => {
    const ctx = getAuthedRoom(socket);
    if (!ctx) return;
    const { room, auth } = ctx;

    if (!isCoupStartPayload(payload)) {
      return socket.emit('action_rejected', { reason: 'Invalid payload' });
    }

    if (room.hostPlayerId !== auth.playerId) {
      return socket.emit('action_rejected', { reason: 'Only the host can start the game' });
    }
    if (room.status === 'in_game') {
      return socket.emit('action_rejected', { reason: 'Game already in progress' });
    }
    const variant = room.config.coupVariant ?? 'base';
    const min = COUP_LIMITS[variant].min;
    const connectedPlayers = [...room.players.values()].filter(
      (player) => player.isConnected && !player.hasLeft,
    );
    if (connectedPlayers.length < min) {
      return socket.emit('action_rejected', { reason: `Need at least ${min} players` });
    }

    const previousState = coupState(room);
    const previousWinnerId = previousState?.winnerId;
    const roster = connectedPlayers.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
    }));
    const winnerIndex = previousWinnerId
      ? roster.findIndex((player) => player.playerId === previousWinnerId)
      : -1;
    const turnOrder = winnerIndex > 0
      ? [...roster.slice(winnerIndex), ...roster.slice(0, winnerIndex)]
      : roster;
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    room.game = {
      id: 'coup',
      state: initGame(room.roomCode, variant, turnOrder),
    };
    if (previousState) room.game.state.revision = previousState.revision + 1;
    room.status = 'in_game';
    roomStore.touch(room);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    emitCoupState(io, room);
    syncTimer(io, room);
    socket.emit('coup:action_accepted', { action: 'start_game', revision: room.game.state.revision });
  });

  socket.on('coup:action', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && coupState(ctx.room);
    if (!ctx || !state) return;
    if (!isCoupActionPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    recoverDisconnectedCoupPlayers(io, ctx.room);
    applyEngineCall(io, socket, ctx.room, 'action', declareAction(state, ctx.auth.playerId, payload));
  });

  socket.on('coup:respond', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && coupState(ctx.room);
    if (!ctx || !state) return;
    if (!isCoupRespondPayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    recoverDisconnectedCoupPlayers(io, ctx.room);
    applyEngineCall(io, socket, ctx.room, 'respond', respond(state, ctx.auth.playerId, payload));
  });

  socket.on('coup:lose_influence', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && coupState(ctx.room);
    if (!ctx || !state) return;
    if (!isCoupLoseInfluencePayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    recoverDisconnectedCoupPlayers(io, ctx.room);
    applyEngineCall(
      io,
      socket,
      ctx.room,
      'lose_influence',
      loseInfluence(state, ctx.auth.playerId, payload.character, payload.expectedRevision),
    );
  });

  socket.on('coup:exchange', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && coupState(ctx.room);
    if (!ctx || !state) return;
    if (!isCoupExchangePayload(payload)) return socket.emit('action_rejected', { reason: 'Invalid payload' });
    recoverDisconnectedCoupPlayers(io, ctx.room);
    applyEngineCall(
      io,
      socket,
      ctx.room,
      'exchange',
      chooseExchange(state, ctx.auth.playerId, payload.keep, payload.expectedRevision),
    );
  });

  socket.on('coup:resolve_challenge', (payload: unknown) => {
    const ctx = getAuthedRoom(socket);
    const state = ctx && coupState(ctx.room);
    if (!ctx || !state) return;
    if (!isCoupChallengeDecisionPayload(payload)) {
      return socket.emit('action_rejected', { reason: 'Invalid payload' });
    }
    recoverDisconnectedCoupPlayers(io, ctx.room);
    applyEngineCall(
      io,
      socket,
      ctx.room,
      'resolve_challenge',
      resolveChallenge(state, ctx.auth.playerId, payload.prove, payload.expectedRevision),
    );
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
