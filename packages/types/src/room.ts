import type { CoupVariant } from './coup';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_EXAMPLE = '7KPM-R4TX';
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

// Which game a room hosts. A room is bound to one game at creation time; the
// lobby/room/JWT/kick layer itself is game-agnostic.
export type GameId = 'saboteur' | 'coup' | 'king_of_tokyo' | 'skull_king' | 'citadels' | 'not_alone' | 'bang' | 'libertalia' | 'colt_express';

// Game-specific room creation config (echoed back in RoomPublicState).
export interface RoomConfig {
  coupVariant?: CoupVariant; // coup only - 'base' | 'reformation'
}

export interface Player {
  playerId: string;       // uuid, server-generated
  displayName: string;
  isHost: boolean;
  isConnected: boolean;
  hasLeft: boolean;
}

export interface RoomPublicState {
  roomCode: string;       // e.g. "7KPM-R4TX"
  gameId: GameId;
  config: RoomConfig;     // game-specific options chosen at creation
  hasPassword: boolean;
  playerCount: number;
  maxPlayers: number;
  status: 'lobby' | 'in_game' | 'finished';
  players: Player[];
}
