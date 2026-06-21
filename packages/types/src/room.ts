import type { CoupVariant } from './coup';

// Which game a room hosts. A room is bound to one game at creation time; the
// lobby/room/JWT/kick layer itself is game-agnostic.
export type GameId = 'saboteur' | 'coup';

// Game-specific room creation config (echoed back in RoomPublicState).
export interface RoomConfig {
  coupVariant?: CoupVariant; // coup only — 'base' | 'reformation'
}

export interface Player {
  playerId: string;       // uuid, server-generated
  displayName: string;
  isHost: boolean;
  isConnected: boolean;
}

export interface RoomPublicState {
  roomCode: string;       // e.g. "GOLD-42"
  gameId: GameId;
  config: RoomConfig;     // game-specific options chosen at creation
  hasPassword: boolean;
  playerCount: number;
  maxPlayers: number;
  status: 'lobby' | 'in_game' | 'finished';
  players: Player[];
}
