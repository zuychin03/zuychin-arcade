import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '@zuychin-arcade/types';
import {
  getRoomPublicState,
  roomMinPlayers,
  roomStore,
  type ServerPlayer,
  type ServerRoom,
} from '../store/RoomStore.js';
import { recoverDisconnectedSaboteurPlayers } from '../game/saboteur/socketHandlers.js';
import { recoverDisconnectedCoupPlayers } from '../game/coup/socketHandlers.js';
import { recoverDisconnectedKingOfTokyoPlayers } from '../game/king-of-tokyo/socketHandlers.js';
import { recoverDisconnectedSkullKingPlayers } from '../game/skull-king/socketHandlers.js';
import { recoverDisconnectedCitadelsPlayers } from '../game/citadels/socketHandlers.js';
import { recoverDisconnectedNotAlonePlayers } from '../game/not-alone/socketHandlers.js';
import { recoverDisconnectedBangPlayers } from '../game/bang/socketHandlers.js';
import { recoverDisconnectedLibertaliaPlayers } from '../game/libertalia/socketHandlers.js';
import { recoverDisconnectedColtPlayers } from '../game/colt-express/socketHandlers.js';

export const LOBBY_RESERVATION_GRACE_MS = 60_000;
export const RECONNECT_GRACE_MS = 30_000;

export interface CurrentSocketSession {
  auth: JwtPayload;
  room: ServerRoom;
  player: ServerPlayer;
}

function emitRoomUpdated(io: Server, room: ServerRoom): void {
  io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
}

function handlePresenceExpiry(io: Server, room: ServerRoom, player: ServerPlayer): void {
  if (room.status === 'lobby') {
    roomStore.removePlayer(room, player.playerId);
    const currentRoom = roomStore.get(room.roomCode);
    if (currentRoom) emitRoomUpdated(io, currentRoom);
    return;
  }

  // Commit every already-overdue seat together before a game can finalise.
  const now = Date.now();
  const expiredPlayers = new Map<string, ServerPlayer>([[player.playerId, player]]);
  for (const candidate of room.players.values()) {
    if (
      !candidate.isConnected
      && !candidate.hasLeft
      && candidate.reconnectDeadlineAt !== null
      && candidate.reconnectDeadlineAt <= now
    ) expiredPlayers.set(candidate.playerId, candidate);
  }
  for (const expiredPlayer of expiredPlayers.values()) {
    roomStore.clearPresenceTimer(expiredPlayer);
    expiredPlayer.hasLeft = true;
  }

  if (expiredPlayers.has(room.hostPlayerId)) roomStore.transferHost(room, true);

  if (room.status === 'in_game' && room.game?.id === 'saboteur') {
    recoverDisconnectedSaboteurPlayers(io, room);
  } else if (room.status === 'in_game' && room.game?.id === 'coup') {
    recoverDisconnectedCoupPlayers(io, room);
  } else if (room.status === 'in_game' && room.game?.id === 'king_of_tokyo') {
    recoverDisconnectedKingOfTokyoPlayers(io, room);
  } else if (room.status === 'in_game' && room.game?.id === 'skull_king') {
    recoverDisconnectedSkullKingPlayers(io, room);
  } else if (room.status === 'in_game' && room.game?.id === 'citadels') {
    recoverDisconnectedCitadelsPlayers(io, room);
  } else if (room.status === 'in_game' && room.game?.id === 'not_alone') {
    recoverDisconnectedNotAlonePlayers(io, room);
  } else if (room.status === 'in_game' && room.game?.id === 'bang') {
    recoverDisconnectedBangPlayers(io, room);
  } else if (room.status === 'in_game' && room.game?.id === 'libertalia') {
    recoverDisconnectedLibertaliaPlayers(io, room);
  } else if (room.status === 'in_game' && room.game?.id === 'colt_express') {
    recoverDisconnectedColtPlayers(io, room);
  }

  roomStore.touch(room);
  emitRoomUpdated(io, room);
}

function scheduleCurrentDeadline(io: Server, room: ServerRoom, player: ServerPlayer): void {
  if (player.reconnectDeadlineAt === null) return;
  const delayMs = player.reconnectDeadlineAt - Date.now();
  roomStore.schedulePresenceTimeout(room, player.playerId, delayMs, (currentRoom, currentPlayer) => {
    handlePresenceExpiry(io, currentRoom, currentPlayer);
  });
}

export function scheduleLobbyReservationExpiry(io: Server, room: ServerRoom, player: ServerPlayer): void {
  scheduleCurrentDeadline(io, room, player);
}

export function connectPlayerSocket(io: Server, socket: Socket, room: ServerRoom, player: ServerPlayer): boolean {
  if (
    !player.isConnected
    && player.reconnectDeadlineAt !== null
    && player.reconnectDeadlineAt <= Date.now()
  ) {
    roomStore.clearPresenceTimer(player);
    handlePresenceExpiry(io, room, player);
    return false;
  }
  const replacedSocketId = player.socketId && player.socketId !== socket.id ? player.socketId : null;
  if (!roomStore.markConnected(room, player.playerId, socket.id)) return false;
  socket.join(room.roomCode);
  const currentHost = room.players.get(room.hostPlayerId);
  const hostReservationExpired = (currentHost?.reconnectDeadlineAt ?? Infinity) <= Date.now();
  if (
    !currentHost
    || currentHost.hasLeft
    || (!currentHost.isConnected && hostReservationExpired)
  ) {
    roomStore.transferHost(room, true);
  }

  if (replacedSocketId) {
    const replacedSocket = io.sockets.sockets.get(replacedSocketId);
    replacedSocket?.emit('session_replaced', { message: 'This player joined from another connection' });
    replacedSocket?.disconnect(true);
  }

  emitRoomUpdated(io, room);
  return true;
}

export function markPlayerDisconnected(
  io: Server,
  room: ServerRoom,
  playerId: string,
  expectedSocketId: string | null,
  graceMs = RECONNECT_GRACE_MS,
  preventReconnect = false,
): boolean {
  const deadline = Date.now() + Math.max(0, graceMs);
  const player = roomStore.markDisconnected(room, playerId, expectedSocketId, deadline);
  if (!player) return false;
  player.hasLeft = preventReconnect;
  if (preventReconnect && room.hostPlayerId === playerId) roomStore.transferHost(room, true);
  emitRoomUpdated(io, room);
  scheduleCurrentDeadline(io, room, player);
  return true;
}

export function pruneDisconnectedRoomPlayers(
  io: Server,
  room: ServerRoom,
  mode: 'expired' | 'reservations' | 'all' = 'expired',
): string[] {
  const removed = roomStore.pruneStartablePlayers(room, mode);
  const currentRoom = roomStore.get(room.roomCode);
  if (removed.length > 0 && currentRoom) emitRoomUpdated(io, currentRoom);
  return removed;
}

export function prepareRoomForStart(io: Server, socket: Socket, room: ServerRoom): boolean {
  pruneDisconnectedRoomPlayers(io, room, 'expired');
  const waitingForConnection = [...room.players.values()].filter(
    (player) => !player.isConnected && !player.hasLeft,
  );
  if (waitingForConnection.length > 0) {
    const noun = waitingForConnection.length === 1 ? 'player is' : 'players are';
    const nextStep = room.status === 'lobby'
      ? 'Wait for them or remove them from the lobby'
      : 'Wait for them to reconnect before starting a rematch';
    socket.emit('action_rejected', {
      reason: `${waitingForConnection.length} ${noun} connecting or reconnecting. ${nextStep}`,
    });
    return false;
  }
  const connectedCount = [...room.players.values()].filter((player) => player.isConnected).length;
  const minimum = roomMinPlayers(room.gameId, room.config);
  if (connectedCount < minimum) {
    socket.emit('action_rejected', { reason: `Need at least ${minimum} connected players` });
    return false;
  }
  return true;
}

export function getCurrentSocketSession(socket: Socket): CurrentSocketSession | null {
  const auth = socket.data.auth as JwtPayload | undefined;
  if (!auth) return null;
  const room = roomStore.get(auth.roomCode);
  const player = room?.players.get(auth.playerId);
  if (
    !room
    || !player
    || player.hasLeft
    || !player.isConnected
    || player.socketId !== socket.id
    || !socket.rooms.has(room.roomCode)
  ) return null;
  return { auth, room, player };
}

export function removeRoomPlayer(io: Server, room: ServerRoom, playerId: string): ServerPlayer | null {
  const removed = roomStore.removePlayer(room, playerId);
  const currentRoom = roomStore.get(room.roomCode);
  if (removed && currentRoom) emitRoomUpdated(io, currentRoom);
  return removed;
}
