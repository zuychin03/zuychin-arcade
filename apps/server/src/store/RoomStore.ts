import type { GameId, Player, RoomConfig, RoomPublicState } from '@zuychin-arcade/types';
import {
  BANG_MAX_PLAYERS,
  BANG_MIN_PLAYERS,
  CITADELS_MAX_PLAYERS,
  CITADELS_MIN_PLAYERS,
  COLT_MAX_PLAYERS,
  COLT_MIN_PLAYERS,
  DIXIT_MAX_PLAYERS,
  DIXIT_MIN_PLAYERS,
  CARTOGRAPHERS_HEROES_MAX_PLAYERS,
  CARTOGRAPHERS_HEROES_MIN_PLAYERS,
  TELESTRATIONS_LIMITS,
  COUP_LIMITS,
  KING_OF_TOKYO_MAX_PLAYERS,
  KING_OF_TOKYO_MIN_PLAYERS,
  LIBERTALIA_MAX_PLAYERS,
  LIBERTALIA_MIN_PLAYERS,
  MAX_PLAYERS,
  MIN_PLAYERS as SABOTEUR_MIN_PLAYERS,
  NOT_ALONE_MAX_PLAYERS,
  NOT_ALONE_MIN_PLAYERS,
  SKULL_KING_MAX_PLAYERS,
  SKULL_KING_MIN_PLAYERS,
} from '@zuychin-arcade/types';
import type { SaboteurServerState } from '../game/saboteur/engine.js';
import type { CoupServerState } from '../game/coup/engine.js';
import type { KingOfTokyoServerState } from '../game/king-of-tokyo/engine.js';
import type { SkullKingServerState } from '../game/skull-king/engine.js';
import type { CitadelsServerState } from '../game/citadels/engine.js';
import type { NotAloneServerState } from '../game/not-alone/engine.js';
import type { BangServerState } from '../game/bang/engine.js';
import type { LibertaliaServerState } from '../game/libertalia/engine.js';
import type { ColtServerState } from '../game/colt-express/engine.js';
import type { DixitServerState } from '../game/dixit-odyssey/engine.js';
import type { CartographersHeroesServerState } from '../game/cartographers-heroes/engine.js';
import type { FeedTheKrakenServerState } from '../game/feed-the-kraken/engine.js';
import type { TelestrationsState } from '@zuychin-arcade/types';
import { generateUniqueRoomCode } from '../utils/roomCode.js';

export interface ServerPlayer extends Player {
  socketId: string | null;
  hasConnected: boolean;
  disconnectedAt: number | null;
  reconnectDeadlineAt: number | null;
  presenceTimer: NodeJS.Timeout | null;
}

export interface AddPlayerInput {
  playerId: string;
  displayName: string;
  isHost: boolean;
}

// A room hosts exactly one game; the tagged union lets the socket layer narrow
// to the right engine state.
export type RoomGame =
  | { id: 'saboteur'; state: SaboteurServerState }
  | { id: 'coup'; state: CoupServerState }
  | { id: 'king_of_tokyo'; state: KingOfTokyoServerState }
  | { id: 'skull_king'; state: SkullKingServerState }
  | { id: 'citadels'; state: CitadelsServerState }
  | { id: 'not_alone'; state: NotAloneServerState }
  | { id: 'bang'; state: BangServerState }
  | { id: 'libertalia'; state: LibertaliaServerState }
  | { id: 'colt_express'; state: ColtServerState }
  | { id: 'dixit_odyssey'; state: DixitServerState }
  | { id: 'cartographers_heroes'; state: CartographersHeroesServerState }
  | { id: 'feed_the_kraken'; state: FeedTheKrakenServerState }
  | { id: 'telestrations'; state: TelestrationsState };

export interface ServerRoom {
  roomCode: string;
  gameId: GameId;
  config: RoomConfig;
  passwordHash: string | null;
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
  if (gameId === 'king_of_tokyo') return KING_OF_TOKYO_MAX_PLAYERS;
  if (gameId === 'skull_king') return SKULL_KING_MAX_PLAYERS;
  if (gameId === 'citadels') return CITADELS_MAX_PLAYERS;
  if (gameId === 'not_alone') return NOT_ALONE_MAX_PLAYERS;
  if (gameId === 'bang') return BANG_MAX_PLAYERS;
  if (gameId === 'libertalia') return LIBERTALIA_MAX_PLAYERS;
  if (gameId === 'colt_express') return COLT_MAX_PLAYERS;
  if (gameId === 'dixit_odyssey') return DIXIT_MAX_PLAYERS;
  if (gameId === 'cartographers_heroes') return CARTOGRAPHERS_HEROES_MAX_PLAYERS;
  if (gameId === 'feed_the_kraken') return 11;
  if (gameId === 'telestrations') return TELESTRATIONS_LIMITS.maxPlayers;
  return MAX_PLAYERS;
}

/** Minimum connected players required to commit the lobby roster. */
export function roomMinPlayers(gameId: GameId, config: RoomConfig): number {
  if (gameId === 'coup') return COUP_LIMITS[config.coupVariant ?? 'base'].min;
  if (gameId === 'king_of_tokyo') return KING_OF_TOKYO_MIN_PLAYERS;
  if (gameId === 'skull_king') return SKULL_KING_MIN_PLAYERS;
  if (gameId === 'citadels') return CITADELS_MIN_PLAYERS;
  if (gameId === 'not_alone') return NOT_ALONE_MIN_PLAYERS;
  if (gameId === 'bang') return BANG_MIN_PLAYERS;
  if (gameId === 'libertalia') return LIBERTALIA_MIN_PLAYERS;
  if (gameId === 'colt_express') return COLT_MIN_PLAYERS;
  if (gameId === 'dixit_odyssey') return DIXIT_MIN_PLAYERS;
  if (gameId === 'cartographers_heroes') return CARTOGRAPHERS_HEROES_MIN_PLAYERS;
  if (gameId === 'feed_the_kraken') return 5;
  if (gameId === 'telestrations') return TELESTRATIONS_LIMITS.minPlayers;
  return SABOTEUR_MIN_PLAYERS;
}

class RoomStore {
  private rooms = new Map<string, ServerRoom>();

  create(hostPlayerId: string, passwordHash: string | null, gameId: GameId, config: RoomConfig): ServerRoom {
    const roomCode = generateUniqueRoomCode((c) => this.rooms.has(c));
    const room: ServerRoom = {
      roomCode,
      gameId,
      config,
      passwordHash,
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
    const normalisedCode = roomCode.toUpperCase().trim();
    const room = this.rooms.get(normalisedCode);
    if (room?.timer) clearTimeout(room.timer);
    if (room) {
      for (const player of room.players.values()) this.clearPresenceTimer(player);
    }
    this.rooms.delete(normalisedCode);
  }

  touch(room: ServerRoom): void {
    room.lastActivityAt = Date.now();
  }

  addPlayer(room: ServerRoom, input: AddPlayerInput, reservationDeadlineAt: number): ServerPlayer {
    const player: ServerPlayer = {
      ...input,
      isConnected: false,
      socketId: null,
      hasConnected: false,
      hasLeft: false,
      disconnectedAt: Date.now(),
      reconnectDeadlineAt: reservationDeadlineAt,
      presenceTimer: null,
    };
    room.players.set(player.playerId, player);
    this.touch(room);
    return player;
  }

  markConnected(room: ServerRoom, playerId: string, socketId: string): ServerPlayer | null {
    const player = room.players.get(playerId);
    if (!player || player.hasLeft) return null;
    this.clearPresenceTimer(player);
    player.socketId = socketId;
    player.isConnected = true;
    player.hasConnected = true;
    player.disconnectedAt = null;
    player.reconnectDeadlineAt = null;
    this.touch(room);
    return player;
  }

  markDisconnected(
    room: ServerRoom,
    playerId: string,
    expectedSocketId: string | null,
    reconnectDeadlineAt: number,
  ): ServerPlayer | null {
    const player = room.players.get(playerId);
    if (!player) return null;
    if (expectedSocketId !== null && player.socketId !== expectedSocketId) return null;
    this.clearPresenceTimer(player);
    player.socketId = null;
    player.isConnected = false;
    player.disconnectedAt = Date.now();
    player.reconnectDeadlineAt = reconnectDeadlineAt;
    this.touch(room);
    return player;
  }

  schedulePresenceTimeout(
    room: ServerRoom,
    playerId: string,
    delayMs: number,
    onExpired: (currentRoom: ServerRoom, player: ServerPlayer) => void,
  ): void {
    const player = room.players.get(playerId);
    if (!player || player.isConnected || player.reconnectDeadlineAt === null) return;
    this.clearPresenceTimer(player);
    const expectedDeadline = player.reconnectDeadlineAt;
    player.presenceTimer = setTimeout(() => {
      const currentRoom = this.get(room.roomCode);
      const currentPlayer = currentRoom?.players.get(playerId);
      if (
        !currentRoom
        || !currentPlayer
        || currentPlayer.isConnected
        || currentPlayer.reconnectDeadlineAt !== expectedDeadline
      ) return;
      currentPlayer.presenceTimer = null;
      onExpired(currentRoom, currentPlayer);
    }, Math.max(0, delayMs));
    player.presenceTimer.unref();
  }

  removePlayer(room: ServerRoom, playerId: string): ServerPlayer | null {
    const player = room.players.get(playerId);
    if (!player) return null;
    this.clearPresenceTimer(player);
    room.players.delete(playerId);
    if (room.players.size === 0) {
      this.delete(room.roomCode);
      return player;
    }
    if (room.hostPlayerId === playerId) this.transferHost(room);
    this.touch(room);
    return player;
  }

  transferHost(room: ServerRoom, requireConnected = false): ServerPlayer | null {
    const currentHost = room.players.get(room.hostPlayerId);
    if (currentHost && (!requireConnected || currentHost.isConnected)) {
      this.setHost(room, currentHost.playerId);
      return currentHost;
    }

    const players = [...room.players.values()];
    const nextHost = players.find((player) => player.isConnected) ?? (requireConnected ? null : players[0] ?? null);
    if (!nextHost) return null;
    this.setHost(room, nextHost.playerId);
    return nextHost;
  }

  pruneStartablePlayers(
    room: ServerRoom,
    mode: 'expired' | 'reservations' | 'all' = 'expired',
    now = Date.now(),
  ): string[] {
    if (room.status === 'in_game') return [];
    const removable = [...room.players.values()]
      .filter((player) => !player.isConnected)
      .filter((player) => {
        if (mode === 'all') return true;
        if (mode === 'reservations') return !player.hasConnected;
        return (player.reconnectDeadlineAt ?? Infinity) <= now;
      })
      .map((player) => player.playerId);
    for (const playerId of removable) this.removePlayer(room, playerId);
    return removable;
  }

  clearPresenceTimer(player: ServerPlayer): void {
    if (player.presenceTimer) clearTimeout(player.presenceTimer);
    player.presenceTimer = null;
  }

  private setHost(room: ServerRoom, playerId: string): void {
    room.hostPlayerId = playerId;
    for (const player of room.players.values()) player.isHost = player.playerId === playerId;
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
    hasPassword: room.passwordHash !== null,
    playerCount: room.players.size,
    maxPlayers: roomMaxPlayers(room.gameId, room.config),
    status: room.status,
    players: [...room.players.values()].map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      isHost: player.isHost,
      isConnected: player.isConnected,
      hasLeft: player.hasLeft,
    })),
  };
}

export const roomStore = new RoomStore();
// Run cleanup every 30 minutes
setInterval(() => roomStore.cleanup(), 30 * 60 * 1000).unref();
