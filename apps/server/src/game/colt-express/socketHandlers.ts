import type { Server, Socket } from 'socket.io';
import { COLT_MIN_PLAYERS, COLT_MAX_PLAYERS, type ColtActionKind, type ColtAssignStartPayload, type ColtChoicePayload, type ColtChooseCharacterPayload, type ColtChooseTeamPayload, type ColtProgramPayload, type ColtReservePayload } from '@zuychin-arcade/types';
import { saveGameResult } from '../../lib/saveGameResult.js';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import { assignColtStart, chooseColt, chooseColtCharacter, chooseColtTeam, finalColtScore, forfeitColtPlayers, initColtGame, programColt, reserveColtCard, settleColtAutopilot, type ColtResult, type ColtServerState } from './engine.js';
import { toColtPrivateState, toColtPublicState } from './publicState.js';
import { getCurrentSocketSession, prepareRoomForStart } from '../../socket/roomLifecycle.js';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && [null, Object.prototype].includes(Object.getPrototypeOf(value));
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));
export function isColtStartPayload(value: unknown): boolean {
  return value === undefined || (record(value) && Object.keys(value).length === 0);
}
export function isColtProgramPayload(value: unknown): value is ColtProgramPayload {
  if (!record(value) || !keys(value, ['cardId', 'coverCardId', 'draw', 'faceDown', 'expectedRevision']) || !integer(value.expectedRevision)) return false;
  if (value.draw === true) return !Object.hasOwn(value, 'cardId') && !Object.hasOwn(value, 'coverCardId') && !Object.hasOwn(value, 'faceDown');
  return !Object.hasOwn(value, 'draw') && text(value.cardId)
    && (!Object.hasOwn(value, 'faceDown') || typeof value.faceDown === 'boolean')
    && (!Object.hasOwn(value, 'coverCardId') || (text(value.coverCardId) && value.coverCardId !== value.cardId));
}
export function isColtChoicePayload(value: unknown): value is ColtChoicePayload {
  return record(value) && keys(value, ['optionId', 'expectedRevision']) && text(value.optionId) && integer(value.expectedRevision);
}
export function isColtAssignStartPayload(value: unknown): value is ColtAssignStartPayload {
  return record(value) && keys(value, ['cabooseBandit', 'expectedRevision']) && (value.cabooseBandit === 0 || value.cabooseBandit === 1) && integer(value.expectedRevision);
}
export function isColtChooseTeamPayload(value: unknown): value is ColtChooseTeamPayload {
  return record(value) && keys(value, ['teamIndex', 'expectedRevision']) && integer(value.teamIndex) && value.teamIndex < 6 && integer(value.expectedRevision);
}
export function isColtChooseCharacterPayload(value: unknown): value is ColtChooseCharacterPayload {
  return record(value) && keys(value, ['character', 'expectedRevision']) && integer(value.expectedRevision)
    && typeof value.character === 'string' && ['ghost', 'doc', 'tuco', 'django', 'cheyenne', 'belle'].includes(value.character);
}
export function isColtReservePayload(value: unknown): value is ColtReservePayload {
  return record(value) && keys(value, ['cardId', 'expectedRevision']) && text(value.cardId) && integer(value.expectedRevision);
}
function invalid(socket: Socket): void { socket.emit('action_rejected', { reason: 'Invalid payload' }); }

const state = (room: ServerRoom): ColtServerState | null => room.game?.id === 'colt_express' ? room.game.state : null;

function ctx(socket: Socket) {
  const value = getCurrentSocketSession(socket);
  if (!value || value.room.gameId !== 'colt_express') {
    socket.emit('server_error', { message: 'This connection is not authorised for the Colt Express room' });
    return null;
  }
  return value;
}

function gameplayContext(io: Server, socket: Socket, expectedRevision: number) {
  const value = ctx(socket);
  if (!value) return null;
  const game = state(value.room);
  if (!game || !game.players.has(value.auth.playerId)) {
    socket.emit('action_rejected', { reason: 'Colt Express has not started for this seat' });
    return null;
  }
  recoverDisconnectedColtPlayers(io, value.room);
  if (expectedRevision !== game.revision) {
    socket.emit('action_rejected', { reason: 'State changed; refresh' });
    return null;
  }
  return { ...value, game };
}

function emit(io: Server, room: ServerRoom) {
  const game = state(room);
  if (!game) return;
  for (const player of room.players.values()) if (player.socketId && player.isConnected && !player.hasLeft && game.players.has(player.playerId)) {
    io.to(player.socketId).emit('game_state', toColtPublicState(game));
    io.to(player.socketId).emit('private_state', toColtPrivateState(game, player.playerId));
  }
}

export function buildColtResult(game: ColtServerState): Parameters<typeof saveGameResult>[0] | null {
  if (game.status !== 'game_over' || game.winnerPlayerIds.length === 0) return null;
  return {
    gameName: 'colt_express', roomCode: game.roomCode, roundsPlayed: game.round,
    players: [...game.players.values()].filter((player) => !player.forfeited).map((player) => ({
      playerId: player.playerId, displayName: player.displayName,
      score: finalColtScore(game, player.playerId)!, won: game.winnerPlayerIds.includes(player.playerId),
    })),
  };
}

function finalize(io: Server, room: ServerRoom): void {
  const game = state(room);
  if (game?.status === 'game_over' && room.status !== 'finished') {
    room.status = 'finished';
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    const result = buildColtResult(game);
    if (result) void saveGameResult(result);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
  }
}

function apply(io: Server, socket: Socket, room: ServerRoom, action: ColtActionKind, result: ColtResult) {
  if (!result.ok) return socket.emit('action_rejected', { reason: result.reason });
  settleColtAutopilot(state(room)!);
  socket.emit('colt:action_accepted', { action, revision: state(room)!.revision });
  roomStore.touch(room);
  finalize(io, room);
  emit(io, room);
}

export function recoverDisconnectedColtPlayers(io: Server, room: ServerRoom): boolean {
  const game = state(room);
  if (!game || game.status !== 'playing') return false;
  const now = Date.now();
  const departed = [...game.players.values()].filter((player) => {
    const seat = room.players.get(player.playerId);
    return !player.forfeited && (!seat || seat.hasLeft || (!seat.isConnected
      && seat.reconnectDeadlineAt !== null && seat.reconnectDeadlineAt <= now));
  }).map((player) => player.playerId);
  if (departed.length === 0) return false;
  const result = forfeitColtPlayers(game, departed, game.revision);
  if (!result.ok) return false;
  settleColtAutopilot(game);
  for (const id of departed) {
    const seat = room.players.get(id);
    if (!seat) continue;
    roomStore.clearPresenceTimer(seat);
    seat.hasLeft = true;
  }
  if (departed.includes(room.hostPlayerId)) roomStore.transferHost(room, true);
  roomStore.touch(room);
  finalize(io, room);
  emit(io, room);
  return true;
}

export function registerColtExpressHandlers(io: Server, socket: Socket) {
  socket.on('start_game', (payload: unknown) => {
    const value = ctx(socket);
    if (!value) return;
    if (!isColtStartPayload(payload)) return invalid(socket);
    if (value.room.hostPlayerId !== value.auth.playerId) return socket.emit('action_rejected', { reason: 'Only the host can start' });
    if (value.room.status === 'in_game') return socket.emit('action_rejected', { reason: 'Game already in progress' });
    if (!prepareRoomForStart(io, socket, value.room)) return;
    const roster = [...value.room.players.values()].filter((player) => player.isConnected && !player.hasLeft);
    if (roster.length < COLT_MIN_PLAYERS || roster.length > COLT_MAX_PLAYERS) return socket.emit('action_rejected', { reason: `Need ${COLT_MIN_PLAYERS}-${COLT_MAX_PLAYERS} connected players` });
    const revision = state(value.room) ? state(value.room)!.revision + 1 : 0;
    value.room.game = { id: 'colt_express', state: initColtGame(value.room.roomCode, roster) };
    value.room.game.state.revision = revision;
    value.room.status = 'in_game';
    roomStore.touch(value.room);
    socket.emit('colt:action_accepted', { action: 'start', revision });
    io.to(value.room.roomCode).emit('room_updated', getRoomPublicState(value.room));
    emit(io, value.room);
  });
  socket.on('colt:program', (payload: unknown) => {
    if (!isColtProgramPayload(payload)) return invalid(socket);
    const value = gameplayContext(io, socket, payload.expectedRevision);
    if (value) apply(io, socket, value.room, 'program', programColt(value.game, value.auth.playerId, payload.cardId, payload.draw, payload.expectedRevision, payload.coverCardId, payload.faceDown));
  });
  socket.on('colt:assign-start', (payload: unknown) => {
    if (!isColtAssignStartPayload(payload)) return invalid(socket);
    const value = gameplayContext(io, socket, payload.expectedRevision);
    if (value) apply(io, socket, value.room, 'assign-start', assignColtStart(value.game, value.auth.playerId, payload.cabooseBandit, payload.expectedRevision));
  });
  socket.on('colt:choose-team', (payload: unknown) => {
    if (!isColtChooseTeamPayload(payload)) return invalid(socket);
    const value = gameplayContext(io, socket, payload.expectedRevision);
    if (value) apply(io, socket, value.room, 'choose-team', chooseColtTeam(value.game, value.auth.playerId, payload.teamIndex, payload.expectedRevision));
  });
  socket.on('colt:reserve', (payload: unknown) => {
    if (!isColtReservePayload(payload)) return invalid(socket);
    const value = gameplayContext(io, socket, payload.expectedRevision);
    if (value) apply(io, socket, value.room, 'reserve', reserveColtCard(value.game, value.auth.playerId, payload.cardId, payload.expectedRevision));
  });
  socket.on('colt:choose-character', (payload: unknown) => {
    if (!isColtChooseCharacterPayload(payload)) return invalid(socket);
    const value = gameplayContext(io, socket, payload.expectedRevision);
    if (value) apply(io, socket, value.room, 'choose-character', chooseColtCharacter(value.game, value.auth.playerId, payload.character, payload.expectedRevision));
  });
  socket.on('colt:choose', (payload: unknown) => {
    if (!isColtChoicePayload(payload)) return invalid(socket);
    const value = gameplayContext(io, socket, payload.expectedRevision);
    if (value) apply(io, socket, value.room, 'choose', chooseColt(value.game, value.auth.playerId, payload.optionId, payload.expectedRevision));
  });
  socket.on('request_state', () => {
    const value = ctx(socket);
    if (!value) return;
    recoverDisconnectedColtPlayers(io, value.room);
    socket.emit('room_updated', getRoomPublicState(value.room));
    const game = state(value.room);
    if (game && game.players.has(value.auth.playerId)) {
      socket.emit('game_state', toColtPublicState(game));
      socket.emit('private_state', toColtPrivateState(game, value.auth.playerId));
    }
  });
}
