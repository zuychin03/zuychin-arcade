export interface Player {
  playerId: string;       // uuid, server-generated
  displayName: string;
  isHost: boolean;
  isConnected: boolean;
}

export interface RoomPublicState {
  roomCode: string;       // e.g. "GOLD-42"
  hasPassword: boolean;
  playerCount: number;
  maxPlayers: number;
  status: 'lobby' | 'in_game' | 'finished';
  players: Player[];
}
