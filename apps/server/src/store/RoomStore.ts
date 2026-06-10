import type { Player, RoomPublicState } from '@zuychin-arcade/types';
import { MAX_PLAYERS } from '@zuychin-arcade/types';
import type { SaboteurServerState } from '../game/saboteur/engine.js';
import { generateUniqueRoomCode } from '../utils/roomCode.js';

export interface ServerPlayer extends Player {
  socketId: string | null;
}

export interface ServerRoom {
  roomCode: string;
  password: string | null;
  hostPlayerId: string;
  players: Map<string, ServerPlayer>;
  status: 'lobby' | 'in_game' | 'finished';
  gameState: SaboteurServerState | null;
  createdAt: number;
  lastActivityAt: number;
  nextRoundTimer: NodeJS.Timeout | null;
}

class RoomStore {
  private rooms = new Map<string, ServerRoom>();

  create(hostPlayerId: string, password: string | null): ServerRoom {
    const roomCode = generateUniqueRoomCode((c) => this.rooms.has(c));
    const room: ServerRoom = {
      roomCode,
      password,
      hostPlayerId,
      players: new Map(),
      status: 'lobby',
      gameState: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      nextRoundTimer: null,
    };
    this.rooms.set(roomCode, room);
    return room;
  }

  get(roomCode: string): ServerRoom | undefined {
    return this.rooms.get(roomCode.toUpperCase().trim());
  }

  delete(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (room?.nextRoundTimer) clearTimeout(room.nextRoundTimer);
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
    hasPassword: room.password !== null,
    playerCount: room.players.size,
    maxPlayers: MAX_PLAYERS,
    status: room.status,
    players: [...room.players.values()].map(({ socketId: _socketId, ...p }) => p),
  };
}

export const roomStore = new RoomStore();
// Run cleanup every 30 minutes
setInterval(() => roomStore.cleanup(), 30 * 60 * 1000).unref();
