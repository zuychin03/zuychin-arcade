import type { GameId, Player, RoomConfig, RoomPublicState } from '@zuychin-arcade/types';
import { COUP_LIMITS, MAX_PLAYERS } from '@zuychin-arcade/types';
import type { SaboteurServerState } from '../game/saboteur/engine.js';
import type { CoupServerState } from '../game/coup/engine.js';
import { generateUniqueRoomCode } from '../utils/roomCode.js';

export interface ServerPlayer extends Player {
  socketId: string | null;
}

// A room hosts exactly one game; the tagged union lets the socket layer narrow
// to the right engine state.
export type RoomGame =
  | { id: 'saboteur'; state: SaboteurServerState }
  | { id: 'coup'; state: CoupServerState };

export interface ServerRoom {
  roomCode: string;
  gameId: GameId;
  config: RoomConfig;
  password: string | null;
  hostPlayerId: string;
  players: Map<string, ServerPlayer>;
  status: 'lobby' | 'in_game' | 'finished';
  game: RoomGame | null;
  createdAt: number;
  lastActivityAt: number;
  timer: NodeJS.Timeout | null; // round-end pause (Saboteur) / response auto-pass (Coup)
}

/** Maximum players for a room, by game (and Coup variant). */
export function roomMaxPlayers(gameId: GameId, config: RoomConfig): number {
  if (gameId === 'coup') return COUP_LIMITS[config.coupVariant ?? 'base'].max;
  return MAX_PLAYERS;
}

class RoomStore {
  private rooms = new Map<string, ServerRoom>();

  create(hostPlayerId: string, password: string | null, gameId: GameId, config: RoomConfig): ServerRoom {
    const roomCode = generateUniqueRoomCode((c) => this.rooms.has(c));
    const room: ServerRoom = {
      roomCode,
      gameId,
      config,
      password,
      hostPlayerId,
      players: new Map(),
      status: 'lobby',
      game: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      timer: null,
    };
    this.rooms.set(roomCode, room);
    return room;
  }

  get(roomCode: string): ServerRoom | undefined {
    return this.rooms.get(roomCode.toUpperCase().trim());
  }

  delete(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (room?.timer) clearTimeout(room.timer);
    this.rooms.delete(roomCode);
  }

  touch(room: ServerRoom): void {
    room.lastActivityAt = Date.now();
  }

  // Cleanup rooms inactive for > 4 hours
  cleanup(): void {
    const cutoff = Date.now() - 4 * 60 * 60 * 1000;
    for (const [code, room] of this.rooms) {
      if (room.lastActivityAt < cutoff) this.delete(code);
    }
  }
}

export function getRoomPublicState(room: ServerRoom): RoomPublicState {
  return {
    roomCode: room.roomCode,
    gameId: room.gameId,
    config: room.config,
    hasPassword: room.password !== null,
    playerCount: room.players.size,
    maxPlayers: roomMaxPlayers(room.gameId, room.config),
    status: room.status,
    players: [...room.players.values()].map(({ socketId: _socketId, ...p }) => p),
  };
}

export const roomStore = new RoomStore();
// Run cleanup every 30 minutes
setInterval(() => roomStore.cleanup(), 30 * 60 * 1000).unref();
