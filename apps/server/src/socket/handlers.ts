import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '@zuychin-arcade/types';
import { verifyToken } from '../utils/jwt.js';
import { FixedWindowQuota } from '../utils/rateLimit.js';
import { AUTH_TOKEN_LIMIT_CHARS } from '../utils/securityConfig.js';
import { roomStore } from '../store/RoomStore.js';
import { isSaboteurStartPayload, registerSaboteurHandlers } from '../game/saboteur/socketHandlers.js';
import { isCoupStartPayload, registerCoupHandlers } from '../game/coup/socketHandlers.js';
import {
  isKingOfTokyoStartPayload,
  registerKingOfTokyoHandlers,
} from '../game/king-of-tokyo/socketHandlers.js';
import {
  isSkullKingStartPayload,
  registerSkullKingHandlers,
} from '../game/skull-king/socketHandlers.js';
import {
  isCitadelsStartPayload,
  registerCitadelsHandlers,
} from '../game/citadels/socketHandlers.js';
import { isNotAloneStartPayload, registerNotAloneHandlers } from '../game/not-alone/socketHandlers.js';
import { isBangStartPayload, registerBangHandlers } from '../game/bang/socketHandlers.js';
import { isLibertaliaStartPayload, registerLibertaliaHandlers } from '../game/libertalia/socketHandlers.js';
import { isColtStartPayload, registerColtExpressHandlers } from '../game/colt-express/socketHandlers.js';
import {
  connectPlayerSocket,
  getCurrentSocketSession,
  markPlayerDisconnected,
  prepareRoomForStart,
  pruneDisconnectedRoomPlayers,
} from './roomLifecycle.js';

export const SOCKET_RATE_LIMITS = {
  events: { limit: 120, windowMs: 10_000 },
  reactions: { limit: 6, windowMs: 5_000 },
} as const;

export const ALLOWED_PLAYER_REACTIONS = [
  'I have a Duke!',
  'I have Assassin!',
  'I have Captain!',
  'I have Ambassador!',
  'I have Inquisitor!',
  'I have Contessa!',
  'Doubt it!',
  'Allowing',
  'Blocking',
  'Nice play!',
] as const;

const allowedPlayerReactions = new Set<string>(ALLOWED_PLAYER_REACTIONS);

export function registerSocketHandlers(
  io: Server,
  rateLimits: {
    events: { limit: number; windowMs: number };
    reactions: { limit: number; windowMs: number };
  } = SOCKET_RATE_LIMITS,
): void {
  io.use((socket, next) => {
    // Auth middleware - every socket connection must carry a valid JWT
    const token = socket.handshake.auth.token as unknown;
    try {
      if (
        typeof token !== 'string'
        || token.length === 0
        || token.length > AUTH_TOKEN_LIMIT_CHARS
      ) throw new Error('missing');
      const payload = verifyToken(token);
      socket.data.auth = payload;
      next();
    } catch {
      next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const { playerId, roomCode } = socket.data.auth as JwtPayload;
    const eventQuota = new FixedWindowQuota(
      rateLimits.events.limit,
      rateLimits.events.windowMs,
    );
    const reactionQuota = new FixedWindowQuota(
      rateLimits.reactions.limit,
      rateLimits.reactions.windowMs,
    );

    let room = roomStore.get(roomCode);
    if (room?.status === 'lobby') {
      pruneDisconnectedRoomPlayers(io, room);
      room = roomStore.get(roomCode);
    }
    const player = room?.players.get(playerId);
    if (!room || !player || player.hasLeft) {
      socket.emit('server_error', { message: 'Room or player no longer exists' });
      socket.disconnect(true);
      return;
    }

    if (!connectPlayerSocket(io, socket, room, player)) {
      socket.emit('server_error', { message: 'Player session is no longer available' });
      socket.disconnect(true);
      return;
    }

    socket.use(([event, payload], next) => {
      const eventDecision = eventQuota.consume();
      if (!eventDecision.allowed) {
        socket.emit('action_rejected', {
          reason: `Too many actions. Try again in ${eventDecision.retryAfterSeconds}s.`,
        });
        return;
      }
      const current = getCurrentSocketSession(socket);
      if (!current) {
        socket.emit('server_error', { message: 'This connection no longer owns the player session' });
        socket.disconnect(true);
        return;
      }
      if (event === 'start_game') {
        if (current.room.hostPlayerId !== current.auth.playerId) {
          socket.emit('action_rejected', { reason: 'Only the host can start the game' });
          return;
        }
        if (current.room.status === 'in_game') {
          socket.emit('action_rejected', { reason: 'Game already in progress' });
          return;
        }
        if (current.room.gameId === 'saboteur' && !isSaboteurStartPayload(payload)) {
          next();
          return;
        }
        if (current.room.gameId === 'coup' && !isCoupStartPayload(payload)) {
          next();
          return;
        }
        if (current.room.gameId === 'king_of_tokyo' && !isKingOfTokyoStartPayload(payload)) {
          next();
          return;
        }
        if (current.room.gameId === 'skull_king' && !isSkullKingStartPayload(payload)) {
          next();
          return;
        }
        if (current.room.gameId === 'citadels' && !isCitadelsStartPayload(payload)) {
          next();
          return;
        }
        if (current.room.gameId === 'not_alone' && !isNotAloneStartPayload(payload)) {
          next();
          return;
        }
        if (current.room.gameId === 'bang' && !isBangStartPayload(payload)) {
          next();
          return;
        }
        if (current.room.gameId === 'libertalia' && !isLibertaliaStartPayload(payload)) {
          next();
          return;
        }
        if (current.room.gameId === 'colt_express' && !isColtStartPayload(payload)) {
          next();
          return;
        }
        if (!prepareRoomForStart(io, socket, current.room)) return;
      }
      next();
    });

    // Dispatch to the game bound to this room (each game namespaces its events).
    if (room.gameId === 'coup') registerCoupHandlers(io, socket);
    else if (room.gameId === 'king_of_tokyo') registerKingOfTokyoHandlers(io, socket);
    else if (room.gameId === 'skull_king') registerSkullKingHandlers(io, socket);
    else if (room.gameId === 'citadels') registerCitadelsHandlers(io, socket);
    else if (room.gameId === 'not_alone') registerNotAloneHandlers(io, socket);
    else if (room.gameId === 'bang') registerBangHandlers(io, socket);
    else if (room.gameId === 'libertalia') registerLibertaliaHandlers(io, socket);
    else if (room.gameId === 'colt_express') registerColtExpressHandlers(io, socket);
    else registerSaboteurHandlers(io, socket);

    socket.on('player_reaction', (payload: { reaction?: unknown } | null) => {
      const reactionDecision = reactionQuota.consume();
      if (!reactionDecision.allowed) {
        socket.emit('action_rejected', {
          reason: `Too many reactions. Try again in ${reactionDecision.retryAfterSeconds}s.`,
        });
        return;
      }
      if (typeof payload?.reaction !== 'string' || !allowedPlayerReactions.has(payload.reaction)) {
        socket.emit('action_rejected', { reason: 'Invalid reaction' });
        return;
      }
      io.to(roomCode).emit('reaction_received', { playerId, reaction: payload.reaction });
    });

    socket.on('disconnect', () => {
      const r = roomStore.get(roomCode);
      if (!r) return;
      markPlayerDisconnected(io, r, playerId, socket.id);
    });
  });
}
