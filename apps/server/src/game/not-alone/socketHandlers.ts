import type { Server, Socket } from 'socket.io';
import type {
  NotAloneActionKind,
  NotAloneBoardFace,
  NotAloneCardChoicePayload,
  NotAloneHuntCardId,
  NotAloneHuntCardPayload,
  NotAloneHuntToken,
  NotAlonePlaceId,
  NotAlonePlaceTokenPayload,
  NotAloneResolvePayload,
  NotAloneResistPayload,
  NotAloneRevisionPayload,
  NotAloneRiverPayload,
  NotAloneSelectPayload,
  NotAloneStartPayload,
  NotAloneSurvivalCardId,
  NotAloneSurvivalChoicePayload,
  NotAloneSurvivalPayload,
} from '@zuychin-arcade/types';
import {
  NOT_ALONE_HUNT_CARDS,
  NOT_ALONE_MAX_PLAYERS,
  NOT_ALONE_MIN_PLAYERS,
  NOT_ALONE_SURVIVAL_CARDS,
} from '@zuychin-arcade/types';
import { saveGameResult } from '../../lib/saveGameResult.js';
import { getRoomPublicState, roomStore, type ServerRoom } from '../../store/RoomStore.js';
import {
  getCurrentSocketSession,
  prepareRoomForStart,
} from '../../socket/roomLifecycle.js';
import {
  beginNotAloneHunt,
  beginNotAloneReckoning,
  chooseNotAloneCardEffect,
  chooseNotAloneRiverDestination,
  chooseNotAloneSurvivalCard,
  endNotAloneTurn,
  forfeitNotAlonePlayers,
  giveUpNotAlone,
  initNotAloneGame,
  lockNotAloneHunt,
  passNotAloneReaction,
  placeNotAloneToken,
  playNotAloneHuntCard,
  playNotAloneSurvival,
  resistNotAlone,
  resolveNotAloneLocation,
  revealNotAlone,
  selectNotAlonePlaces,
  settleNotAloneAutopilot,
  type NotAloneEngineResult,
  type NotAloneServerState,
} from './engine.js';
import { toNotAlonePrivateState, toNotAlonePublicState } from './publicState.js';

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const PLACE_IDS = new Set<number>([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const SURVIVAL_IDS = new Set<string>(NOT_ALONE_SURVIVAL_CARDS.map((card) => card.id));
const HUNT_IDS = new Set<string>(NOT_ALONE_HUNT_CARDS.map((card) => card.id));
const HUNT_TOKENS = new Set<string>(['creature', 'target', 'artemia']);

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

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

function isPlace(value: unknown): value is NotAlonePlaceId {
  return typeof value === 'number' && Number.isInteger(value) && PLACE_IDS.has(value);
}

function isPlaceArray(value: unknown, minimum = 0, maximum = 10): value is NotAlonePlaceId[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= maximum
    && value.every(isPlace)
    && new Set(value).size === value.length;
}

function isSurvivalCard(value: unknown): value is NotAloneSurvivalCardId {
  return typeof value === 'string' && SURVIVAL_IDS.has(value);
}

function isHuntCard(value: unknown): value is NotAloneHuntCardId {
  return typeof value === 'string' && HUNT_IDS.has(value);
}

function isHuntToken(value: unknown): value is NotAloneHuntToken {
  return typeof value === 'string' && HUNT_TOKENS.has(value);
}

function isBoardFace(value: unknown): value is NotAloneBoardFace {
  return value === 'continuous' || value === 'alternating';
}

export function isNotAloneStartPayload(value: unknown): value is NotAloneStartPayload | undefined {
  return value === undefined
    || (isRecord(value) && Object.keys(value).length === 0)
    || (isRecord(value) && hasOnlyKeys(value, ['boardFace']) && hasOwn(value, 'boardFace') && isBoardFace(value.boardFace));
}

export function isNotAloneRevisionPayload(value: unknown): value is NotAloneRevisionPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['expectedRevision'])
    && hasOwn(value, 'expectedRevision')
    && isExpectedRevision(value.expectedRevision);
}

export function isNotAloneSelectPayload(value: unknown): value is NotAloneSelectPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['placeIds', 'expectedRevision'])
    && hasOwn(value, 'placeIds')
    && hasOwn(value, 'expectedRevision')
    && isPlaceArray(value.placeIds, 1, 2)
    && isExpectedRevision(value.expectedRevision);
}

export function isNotAloneRiverPayload(value: unknown): value is NotAloneRiverPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['explorePlaceId', 'expectedRevision'])
    && hasOwn(value, 'explorePlaceId')
    && hasOwn(value, 'expectedRevision')
    && isPlace(value.explorePlaceId)
    && isExpectedRevision(value.expectedRevision);
}

export function isNotAloneSurvivalChoicePayload(value: unknown): value is NotAloneSurvivalChoicePayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['cardId', 'expectedRevision'])
    && hasOwn(value, 'cardId')
    && hasOwn(value, 'expectedRevision')
    && isSurvivalCard(value.cardId)
    && isExpectedRevision(value.expectedRevision);
}

export function isNotAloneCardChoicePayload(value: unknown): value is NotAloneCardChoicePayload {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['placeIds', 'placeIndexes', 'expectedRevision'])
    || !hasOwn(value, 'expectedRevision')
    || !isExpectedRevision(value.expectedRevision)) return false;
  const hasPlaces = hasOwn(value, 'placeIds'); const hasIndexes = hasOwn(value, 'placeIndexes');
  if (hasPlaces === hasIndexes) return false;
  if (hasPlaces) return isPlaceArray(value.placeIds, 1, 10);
  return Array.isArray(value.placeIndexes)
    && value.placeIndexes.length === 2
    && value.placeIndexes.every((index) => index === 0 || index === 1)
    && new Set(value.placeIndexes).size === 2;
}

export function isNotAloneResistPayload(value: unknown): value is NotAloneResistPayload {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['willCost', 'placeIds', 'expectedRevision'])
    || !hasOwn(value, 'willCost')
    || !hasOwn(value, 'placeIds')
    || !hasOwn(value, 'expectedRevision')
    || (value.willCost !== 1 && value.willCost !== 2)
    || !isExpectedRevision(value.expectedRevision)) return false;
  return isPlaceArray(value.placeIds, value.willCost * 2, value.willCost * 2);
}

export function isNotAloneSurvivalPayload(value: unknown): value is NotAloneSurvivalPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['cardId', 'token', 'placeIds', 'targetPlaceId', 'placeIndex', 'expectedRevision'])
    && hasOwn(value, 'cardId')
    && hasOwn(value, 'expectedRevision')
    && isSurvivalCard(value.cardId)
    && isExpectedRevision(value.expectedRevision)
    && (!hasOwn(value, 'token') || value.token === 'creature' || value.token === 'target')
    && (!hasOwn(value, 'placeIds') || isPlaceArray(value.placeIds, 1, 10))
    && (!hasOwn(value, 'targetPlaceId') || isPlace(value.targetPlaceId))
    && (!hasOwn(value, 'placeIndex') || value.placeIndex === 0 || value.placeIndex === 1);
}

export function isNotAloneHuntCardPayload(value: unknown): value is NotAloneHuntCardPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['cardId', 'targetPlayerId', 'originPlaceId', 'placeIndex', 'placeIds', 'expectedRevision'])
    && hasOwn(value, 'cardId')
    && hasOwn(value, 'expectedRevision')
    && isHuntCard(value.cardId)
    && isExpectedRevision(value.expectedRevision)
    && (!hasOwn(value, 'targetPlayerId') || isId(value.targetPlayerId))
    && (!hasOwn(value, 'originPlaceId') || isPlace(value.originPlaceId))
    && (!hasOwn(value, 'placeIndex') || value.placeIndex === 0 || value.placeIndex === 1)
    && (!hasOwn(value, 'placeIds') || isPlaceArray(value.placeIds, 1, 2));
}

export function isNotAlonePlaceTokenPayload(value: unknown): value is NotAlonePlaceTokenPayload {
  return isRecord(value)
    && hasOnlyKeys(value, ['token', 'placeIds', 'expectedRevision'])
    && hasOwn(value, 'token')
    && hasOwn(value, 'placeIds')
    && hasOwn(value, 'expectedRevision')
    && isHuntToken(value.token)
    && isPlaceArray(value.placeIds, 1, 2)
    && isExpectedRevision(value.expectedRevision);
}

export function isNotAloneResolvePayload(value: unknown): value is NotAloneResolvePayload {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'mode', 'placeIds', 'targetPlayerId', 'targetPlaceId', 'choice',
      'huntChoice', 'huntPlaceIds', 'huntSurvivalCardId', 'expectedRevision',
    ])
    && hasOwn(value, 'mode')
    && hasOwn(value, 'expectedRevision')
    && (value.mode === 'power' || value.mode === 'recover' || value.mode === 'copy')
    && isExpectedRevision(value.expectedRevision)
    && (!hasOwn(value, 'placeIds') || isPlaceArray(value.placeIds, 0, 10))
    && (!hasOwn(value, 'targetPlayerId') || isId(value.targetPlayerId))
    && (!hasOwn(value, 'targetPlaceId') || isPlace(value.targetPlaceId))
    && (!hasOwn(value, 'choice') || ['will', 'card', 'charge', 'launch'].includes(value.choice as string))
    && (!hasOwn(value, 'huntChoice') || value.huntChoice === 'discard' || value.huntChoice === 'will')
    && (!hasOwn(value, 'huntPlaceIds') || isPlaceArray(value.huntPlaceIds, 0, 2))
    && (!hasOwn(value, 'huntSurvivalCardId') || isSurvivalCard(value.huntSurvivalCardId));
}

function gameState(room: ServerRoom): NotAloneServerState | null {
  return room.game?.id === 'not_alone' ? room.game.state : null;
}

function context(socket: Socket) {
  const current = getCurrentSocketSession(socket);
  if (!current || current.room.gameId !== 'not_alone') {
    socket.emit('server_error', { message: 'This connection is not authorised for the NOT ALONE room' });
    return null;
  }
  return current;
}

function withState(socket: Socket) {
  const value = context(socket);
  if (!value) return null;
  const state = gameState(value.room);
  if (!state || !state.players.has(value.auth.playerId)) {
    socket.emit('action_rejected', { reason: 'NOT ALONE has not started for this seat' });
    return null;
  }
  return { ...value, state };
}

function emitState(io: Server, room: ServerRoom): void {
  const state = gameState(room);
  if (!state) return;
  for (const player of room.players.values()) {
    if (!player.socketId || !player.isConnected || player.hasLeft || !state.players.has(player.playerId)) continue;
    io.to(player.socketId).emit('game_state', toNotAlonePublicState(state, player.playerId));
    io.to(player.socketId).emit('private_state', toNotAlonePrivateState(state, player.playerId));
  }
}

export function buildNotAloneResult(state: NotAloneServerState): Parameters<typeof saveGameResult>[0] | null {
  if (state.status !== 'game_over' || state.winner === null) return null;
  return {
    gameName: 'not_alone', roomCode: state.roomCode, roundsPlayed: state.roundNumber,
    players: [...state.players.values()].filter((player) => !player.forfeited).map((player) => {
      return {
        playerId: player.playerId, displayName: player.displayName,
        score: player.role === 'creature' ? state.assimilationProgress : state.rescueProgress,
        won: player.role === state.winner,
      };
    }),
  };
}

function finalizeIfOver(io: Server, room: ServerRoom): void {
  const state = gameState(room);
  if (!state || state.status !== 'game_over' || room.status === 'finished') return;
  room.status = 'finished';
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  const result = buildNotAloneResult(state);
  if (result) void saveGameResult(result);
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
}

function emitAccepted(socket: Socket, action: NotAloneActionKind, revision: number): void {
  socket.emit('notalone:action_accepted', { action, revision });
}

function apply(io: Server, socket: Socket, room: ServerRoom, action: Exclude<NotAloneActionKind, 'start'>, result: NotAloneEngineResult): void {
  if (!result.ok) { socket.emit('action_rejected', { reason: result.reason }); return; }
  const state = gameState(room)!;
  settleNotAloneAutopilot(state);
  emitAccepted(socket, action, state.revision);
  roomStore.touch(room); finalizeIfOver(io, room); emitState(io, room);
}

function rejectInvalidPayload(socket: Socket): void {
  socket.emit('action_rejected', { reason: 'Invalid payload' });
}

export function recoverDisconnectedNotAlonePlayers(io: Server, room: ServerRoom): boolean {
  const state = gameState(room);
  if (!state || state.status !== 'playing') return false;
  const now = Date.now();
  const forfeitingPlayerIds = state.turnOrder.filter((playerId) => {
    const gamePlayer = state.players.get(playerId)!; const roomPlayer = room.players.get(playerId);
    return !gamePlayer.forfeited && (!roomPlayer || roomPlayer.hasLeft || (
      !roomPlayer.isConnected && roomPlayer.reconnectDeadlineAt !== null
      && roomPlayer.reconnectDeadlineAt <= now
    ));
  });
  if (forfeitingPlayerIds.length === 0) return false;
  const result = forfeitNotAlonePlayers(state, forfeitingPlayerIds, state.revision);
  if (!result.ok) return false;
  state.planningWindowRevision = state.revision;
  state.reactionWindowRevision = state.revision;
  if (state.pendingCardChoice?.choiceWindowRevision !== undefined) {
    state.pendingCardChoice.choiceWindowRevision = state.revision;
  }
  for (const playerId of forfeitingPlayerIds) {
    const player = room.players.get(playerId);
    if (!player) continue;
    roomStore.clearPresenceTimer(player);
    player.hasLeft = true;
  }
  if (forfeitingPlayerIds.includes(room.hostPlayerId)) roomStore.transferHost(room, true);
  roomStore.touch(room); finalizeIfOver(io, room); emitState(io, room); return true;
}

function recoverBeforeAction(io: Server, socket: Socket, room: ServerRoom, expectedRevision: number): boolean {
  if (!recoverDisconnectedNotAlonePlayers(io, room) || expectedRevision === gameState(room)!.revision) return true;
  socket.emit('action_rejected', { reason: 'Game state changed. Please try again.' });
  return false;
}

export function registerNotAloneHandlers(io: Server, socket: Socket): void {
  socket.on('start_game', (payload: unknown) => {
    const value = context(socket); if (!value) return;
    const { room, auth } = value;
    if (!isNotAloneStartPayload(payload)) return rejectInvalidPayload(socket);
    if (room.hostPlayerId !== auth.playerId) return socket.emit('action_rejected', { reason: 'Only the host can start the game' });
    if (room.status === 'in_game') return socket.emit('action_rejected', { reason: 'Game already in progress' });
    if (!prepareRoomForStart(io, socket, room)) return;
    const connectedPlayers = [...room.players.values()].filter((player) => player.isConnected && !player.hasLeft);
    connectedPlayers.sort((a, b) => Number(b.playerId === room.hostPlayerId) - Number(a.playerId === room.hostPlayerId));
    if (connectedPlayers.length < NOT_ALONE_MIN_PLAYERS || connectedPlayers.length > NOT_ALONE_MAX_PLAYERS) {
      return socket.emit('action_rejected', { reason: `Need ${NOT_ALONE_MIN_PLAYERS}-${NOT_ALONE_MAX_PLAYERS} connected players` });
    }
    const priorBoardFace = gameState(room)?.boardFace;
    const nextRevision = gameState(room) ? gameState(room)!.revision + 1 : 0;
    const boardFace = isRecord(payload) && isBoardFace(payload.boardFace) ? payload.boardFace : priorBoardFace ?? 'continuous';
    if (room.timer) { clearTimeout(room.timer); room.timer = null; }
    room.game = { id: 'not_alone', state: initNotAloneGame(room.roomCode, connectedPlayers.map((player) => ({ playerId: player.playerId, displayName: player.displayName })), Math.random, boardFace) };
    room.game.state.revision = nextRevision;
    room.game.state.planningWindowRevision = nextRevision;
    room.game.state.reactionWindowRevision = nextRevision;
    room.status = 'in_game'; roomStore.touch(room);
    emitAccepted(socket, 'start', room.game.state.revision);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room)); emitState(io, room);
  });

  socket.on('notalone:select', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneSelectPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'select', selectNotAlonePlaces(value.state, value.auth.playerId, payload.placeIds, payload.expectedRevision));
  });
  socket.on('notalone:river-choice', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneRiverPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'river_choice', chooseNotAloneRiverDestination(value.state, value.auth.playerId, payload.explorePlaceId, payload.expectedRevision));
  });
  socket.on('notalone:survival-choice', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneSurvivalChoicePayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'survival_choice', chooseNotAloneSurvivalCard(value.state, value.auth.playerId, payload.cardId, payload.expectedRevision));
  });
  socket.on('notalone:card-choice', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneCardChoicePayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'card_choice', chooseNotAloneCardEffect(value.state, value.auth.playerId, payload.placeIds ?? [], payload.expectedRevision, payload.placeIndexes));
  });
  socket.on('notalone:resist', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneResistPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'resist', resistNotAlone(value.state, value.auth.playerId, payload.willCost, payload.placeIds, payload.expectedRevision));
  });
  socket.on('notalone:give-up', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneRevisionPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'give_up', giveUpNotAlone(value.state, value.auth.playerId, payload.expectedRevision));
  });
  socket.on('notalone:survival', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneSurvivalPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'survival', playNotAloneSurvival(value.state, value.auth.playerId, payload));
  });
  socket.on('notalone:hunt-card', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneHuntCardPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'hunt_card', playNotAloneHuntCard(value.state, value.auth.playerId, payload));
  });
  socket.on('notalone:place-token', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAlonePlaceTokenPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'place_token', placeNotAloneToken(value.state, value.auth.playerId, payload.token, payload.placeIds, payload.expectedRevision));
  });
  socket.on('notalone:pass', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneRevisionPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'pass', passNotAloneReaction(value.state, value.auth.playerId, payload.expectedRevision));
  });
  socket.on('notalone:begin-hunt', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneRevisionPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'begin_hunt', beginNotAloneHunt(value.state, value.auth.playerId, payload.expectedRevision));
  });
  socket.on('notalone:lock-hunt', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneRevisionPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'lock_hunt', lockNotAloneHunt(value.state, value.auth.playerId, payload.expectedRevision));
  });
  socket.on('notalone:reveal', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneRevisionPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'reveal', revealNotAlone(value.state, value.auth.playerId, payload.expectedRevision));
  });
  socket.on('notalone:begin-reckoning', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneRevisionPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'begin_reckoning', beginNotAloneReckoning(value.state, value.auth.playerId, payload.expectedRevision));
  });
  socket.on('notalone:resolve', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneResolvePayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'resolve', resolveNotAloneLocation(value.state, value.auth.playerId, payload));
  });
  socket.on('notalone:end-turn', (payload: unknown) => {
    const value = withState(socket); if (!value) return;
    if (!isNotAloneRevisionPayload(payload)) return rejectInvalidPayload(socket);
    if (!recoverBeforeAction(io, socket, value.room, payload.expectedRevision)) return;
    apply(io, socket, value.room, 'end_turn', endNotAloneTurn(value.state, value.auth.playerId, payload.expectedRevision));
  });
  socket.on('request_state', (payload: unknown) => {
    const value = context(socket); if (!value) return;
    if (!(payload === undefined || (isRecord(payload) && Object.keys(payload).length === 0))) return rejectInvalidPayload(socket);
    recoverDisconnectedNotAlonePlayers(io, value.room);
    socket.emit('room_updated', getRoomPublicState(value.room));
    const state = gameState(value.room);
    if (state?.players.has(value.auth.playerId)) {
      socket.emit('game_state', toNotAlonePublicState(state, value.auth.playerId));
      socket.emit('private_state', toNotAlonePrivateState(state, value.auth.playerId));
    }
  });
}
