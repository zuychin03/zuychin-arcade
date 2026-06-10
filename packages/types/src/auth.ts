import type { RoomPublicState } from './room';

export interface JoinRoomPayload {
  roomCode: string;
  password?: string;
  displayName: string;
}

export interface JwtPayload {
  playerId: string;
  roomCode: string;
  displayName: string;
  isHost: boolean;
  iat: number;
  exp: number;
}

export interface JoinRoomResponse {
  token: string;          // JWT
  playerId: string;
  roomCode: string;
  room: RoomPublicState;
}
