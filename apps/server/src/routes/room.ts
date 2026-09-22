import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import type { GameId, JoinRoomResponse, JwtPayload, LeaderboardRow, RoomConfig } from '@zuychin-arcade/types';
import { getRoomPublicState, roomMaxPlayers, roomStore, type ServerRoom } from '../store/RoomStore.js';
import { signToken, verifyToken } from '../utils/jwt.js';
import { isRoomCode } from '../utils/roomCode.js';
import { hashRoomPassword, verifyRoomPassword } from '../utils/roomPassword.js';
import { FixedWindowRateLimiter, type RateLimitDecision } from '../utils/rateLimit.js';
import { AUTH_TOKEN_LIMIT_CHARS } from '../utils/securityConfig.js';
import { supabase } from '../lib/supabase.js';
import {
  LOBBY_RESERVATION_GRACE_MS,
  markPlayerDisconnected,
  pruneDisconnectedRoomPlayers,
  removeRoomPlayer,
  scheduleLobbyReservationExpiry,
} from '../socket/roomLifecycle.js';

const SUPPORTED_GAME_IDS: readonly GameId[] = ['saboteur', 'coup', 'king_of_tokyo', 'skull_king', 'citadels', 'not_alone', 'bang', 'libertalia', 'colt_express'];
const RATE_LIMIT_MAX_KEYS = 4_096;
export const MAX_CONCURRENT_PASSWORD_OPERATIONS = 4;
export const REST_RATE_LIMITS = {
  createPerIp: { limit: 20, windowMs: 60_000 },
  generalPerIp: { limit: 300, windowMs: 60_000 },
  joinPerIp: { limit: 60, windowMs: 60_000 },
  joinPerRoom: { limit: 30, windowMs: 60_000 },
} as const;

function isGameId(value: string): value is GameId {
  return (SUPPORTED_GAME_IDS as readonly string[]).includes(value);
}

function hasAtMostCodePoints(value: string, maximum: number): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > maximum) return false;
  }
  return true;
}

function validateDisplayName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().normalize('NFC');
  if (!trimmed || !hasAtMostCodePoints(trimmed, 20)) return null;
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(trimmed) ? null : trimmed;
}

function validatePassword(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !hasAtMostCodePoints(value, 64)) return undefined;
  return value;
}

function setNoStore(reply: FastifyReply): void {
  void reply.header('Cache-Control', 'no-store');
}

function isLeaderboardRows(value: unknown): value is LeaderboardRow[] {
  return Array.isArray(value) && value.every((row: unknown) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return false;
    const fields = row as Record<string, unknown>;
    return typeof fields.display_name === 'string' && fields.display_name.trim().length > 0
      && typeof fields.games_played === 'number' && Number.isSafeInteger(fields.games_played) && fields.games_played >= 0
      && typeof fields.wins === 'number' && Number.isSafeInteger(fields.wins) && fields.wins >= 0
      && typeof fields.total_nuggets === 'number' && Number.isSafeInteger(fields.total_nuggets);
  });
}

function enforceRateLimit(reply: FastifyReply, decision: RateLimitDecision): boolean {
  if (decision.allowed) return true;
  void reply
    .header('Retry-After', String(decision.retryAfterSeconds))
    .code(429)
    .send({ message: 'Too many requests. Wait a moment and try again.' });
  return false;
}

function authenticateRoomMember(
  req: FastifyRequest,
  reply: FastifyReply,
  routeRoomCode: string,
): { payload: JwtPayload; room: ServerRoom } | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    void reply.code(401).send({ message: 'Missing token' });
    return null;
  }
  const token = auth.slice(7);
  if (token.length < 1 || token.length > AUTH_TOKEN_LIMIT_CHARS) {
    void reply.code(401).send({ message: 'Invalid token' });
    return null;
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    void reply.code(401).send({ message: 'Invalid token' });
    return null;
  }

  const room = roomStore.get(routeRoomCode);
  if (!room) {
    void reply.code(404).send({ message: 'Room not found' });
    return null;
  }
  const player = room.players.get(payload.playerId);
  if (payload.roomCode.toUpperCase().trim() !== room.roomCode || !player || player.hasLeft) {
    void reply.code(403).send({ message: 'Token is not authorised for this room' });
    return null;
  }
  return { payload, room };
}

export function registerRoomRoutes(app: FastifyInstance, io: Server, resultsClient = supabase): void {
  const generalLimiter = new FixedWindowRateLimiter(
    REST_RATE_LIMITS.generalPerIp.limit,
    REST_RATE_LIMITS.generalPerIp.windowMs,
    RATE_LIMIT_MAX_KEYS,
  );
  const createLimiter = new FixedWindowRateLimiter(
    REST_RATE_LIMITS.createPerIp.limit,
    REST_RATE_LIMITS.createPerIp.windowMs,
    RATE_LIMIT_MAX_KEYS,
  );
  const joinIpLimiter = new FixedWindowRateLimiter(
    REST_RATE_LIMITS.joinPerIp.limit,
    REST_RATE_LIMITS.joinPerIp.windowMs,
    RATE_LIMIT_MAX_KEYS,
  );
  const joinRoomLimiter = new FixedWindowRateLimiter(
    REST_RATE_LIMITS.joinPerRoom.limit,
    REST_RATE_LIMITS.joinPerRoom.windowMs,
    RATE_LIMIT_MAX_KEYS,
  );
  let activePasswordOperations = 0;
  const runPasswordOperation = async <T>(
    reply: FastifyReply,
    operation: () => Promise<T>,
  ): Promise<{ accepted: true; value: T } | { accepted: false }> => {
    if (activePasswordOperations >= MAX_CONCURRENT_PASSWORD_OPERATIONS) {
      enforceRateLimit(reply, { allowed: false, retryAfterSeconds: 1 });
      return { accepted: false };
    }
    activePasswordOperations += 1;
    try {
      return { accepted: true, value: await operation() };
    } finally {
      activePasswordOperations -= 1;
    }
  };

  app.addHook('onRequest', async (req, reply) => {
    if (!enforceRateLimit(reply, generalLimiter.consume(req.ip))) return reply;
  });

  app.post('/rooms/create', async (req, reply) => {
    setNoStore(reply);
    if (!enforceRateLimit(reply, createLimiter.consume(req.ip))) return;
    const body = (req.body ?? {}) as {
      displayName?: string;
      password?: string;
      gameId?: string;
      coupVariant?: string;
    };
    const displayName = validateDisplayName(body.displayName);
    if (!displayName) {
      return reply.code(400).send({ message: 'Display name must be 1–20 visible characters' });
    }
    const password = validatePassword(body.password);
    if (password === undefined) {
      return reply.code(400).send({ message: 'Room password must be at most 64 characters' });
    }

    const requestedGameId = body.gameId ?? 'saboteur';
    if (!isGameId(requestedGameId)) {
      return reply.code(400).send({ message: 'Unsupported game' });
    }
    const gameId = requestedGameId;
    // Phase 1 ships base Coup only; the Reformation toggle arrives in Phase 2.
    const config: RoomConfig = gameId === 'coup' ? { coupVariant: 'base' } : {};

    let passwordHash: string | null = null;
    if (password !== null) {
      const hashed = await runPasswordOperation(reply, () => hashRoomPassword(password));
      if (!hashed.accepted) return;
      passwordHash = hashed.value;
    }

    const playerId = randomUUID();
    const room = roomStore.create(playerId, passwordHash, gameId, config);
    const player = roomStore.addPlayer(room, {
      playerId,
      displayName,
      isHost: true,
    }, Date.now() + LOBBY_RESERVATION_GRACE_MS);
    scheduleLobbyReservationExpiry(io, room, player);

    const token = signToken({ playerId, roomCode: room.roomCode, displayName, isHost: true });
    const res: JoinRoomResponse = {
      token,
      playerId,
      roomCode: room.roomCode,
      room: getRoomPublicState(room),
    };
    return reply.code(201).send(res);
  });

  app.post('/rooms/join', async (req, reply) => {
    setNoStore(reply);
    if (!enforceRateLimit(reply, joinIpLimiter.consume(req.ip))) return;
    const body = (req.body ?? {}) as { roomCode?: string; password?: string; displayName?: string };
    const displayName = validateDisplayName(body.displayName);
    if (!displayName) {
      return reply.code(400).send({ message: 'Display name must be 1–20 visible characters' });
    }
    if (typeof body.roomCode !== 'string') {
      return reply.code(400).send({ message: 'Room code is required' });
    }
    if (!isRoomCode(body.roomCode)) {
      return reply.code(404).send({ message: 'Room not found' });
    }
    const password = validatePassword(body.password);
    if (password === undefined) {
      return reply.code(400).send({ message: 'Room password must be at most 64 characters' });
    }

    let room = roomStore.get(body.roomCode);
    if (!room) return reply.code(404).send({ message: 'Room not found' });
    if (!enforceRateLimit(reply, joinRoomLimiter.consume(room.roomCode))) return;
    pruneDisconnectedRoomPlayers(io, room);
    if (!roomStore.get(room.roomCode)) return reply.code(404).send({ message: 'Room not found' });
    const passwordHash = room.passwordHash;
    if (passwordHash) {
      const verified = await runPasswordOperation(
        reply,
        () => verifyRoomPassword(password ?? '', passwordHash),
      );
      if (!verified.accepted) return;
      if (!verified.value) return reply.code(403).send({ message: 'Wrong password' });
    }
    const currentRoom = roomStore.get(body.roomCode);
    if (!currentRoom || currentRoom !== room) {
      return reply.code(404).send({ message: 'Room not found' });
    }
    room = currentRoom;
    if (room.status !== 'lobby') {
      return reply.code(409).send({ message: 'Game already in progress' });
    }
    if (room.players.size >= roomMaxPlayers(room.gameId, room.config)) {
      return reply.code(409).send({ message: 'Room is full' });
    }
    const nameTaken = [...room.players.values()].some(
      (p) => p.displayName.toLowerCase() === displayName.toLowerCase(),
    );
    if (nameTaken) {
      return reply.code(409).send({ message: 'That name is already taken in this room' });
    }

    const playerId = randomUUID();
    const player = roomStore.addPlayer(room, {
      playerId,
      displayName,
      isHost: false,
    }, Date.now() + LOBBY_RESERVATION_GRACE_MS);
    scheduleLobbyReservationExpiry(io, room, player);
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));

    const token = signToken({ playerId, roomCode: room.roomCode, displayName, isHost: false });
    const res: JoinRoomResponse = {
      token,
      playerId,
      roomCode: room.roomCode,
      room: getRoomPublicState(room),
    };
    return reply.code(200).send(res);
  });

  app.get('/rooms/:roomCode', async (req, reply) => {
    setNoStore(reply);
    const { roomCode } = req.params as { roomCode: string };
    const context = authenticateRoomMember(req, reply, roomCode);
    if (!context) return;
    const { room } = context;
    return getRoomPublicState(room);
  });

  app.post('/rooms/:roomCode/kick', async (req, reply) => {
    setNoStore(reply);
    const { roomCode } = req.params as { roomCode: string };
    const context = authenticateRoomMember(req, reply, roomCode);
    if (!context) return;
    const { payload, room } = context;
    if (room.status !== 'lobby') {
      return reply.code(409).send({ message: 'Players can only be kicked from the lobby' });
    }
    if (room.hostPlayerId !== payload.playerId) {
      return reply.code(403).send({ message: 'Only the host can kick players' });
    }

    const { targetPlayerId } = (req.body ?? {}) as { targetPlayerId?: string };
    if (!targetPlayerId || targetPlayerId === room.hostPlayerId) {
      return reply.code(400).send({ message: 'Invalid target player' });
    }
    const target = room.players.get(targetPlayerId);
    if (!target) return reply.code(404).send({ message: 'Player not in room' });

    const targetSocketId = target.socketId;
    removeRoomPlayer(io, room, targetPlayerId);
    if (targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      targetSocket?.emit('player_kicked', {});
      targetSocket?.disconnect(true);
    }
    return { ok: true };
  });

  app.post('/rooms/:roomCode/leave', async (req, reply) => {
    setNoStore(reply);
    const { roomCode } = req.params as { roomCode: string };
    const context = authenticateRoomMember(req, reply, roomCode);
    if (!context) return;
    const { payload, room } = context;
    const player = room.players.get(payload.playerId)!;
    const socketId = player.socketId;

    if (room.status === 'in_game') {
      markPlayerDisconnected(io, room, player.playerId, socketId, 0, true);
    } else {
      removeRoomPlayer(io, room, player.playerId);
    }

    if (socketId) {
      const playerSocket = io.sockets.sockets.get(socketId);
      playerSocket?.emit('player_left', {});
      playerSocket?.disconnect(true);
    }
    return { ok: true, retainedForGameRecovery: room.status === 'in_game' };
  });

  app.get('/leaderboard', async (req, reply) => {
    setNoStore(reply);
    const game = (req.query as { game?: string })?.game;
    if (game !== undefined && (typeof game !== 'string' || !isGameId(game))) {
      return reply.code(400).send({ message: 'Choose a supported game leaderboard.' });
    }
    if (!resultsClient) {
      return reply.code(503).send({ message: 'Leaderboards are not available on this server yet.' });
    }
    try {
      const rankByWins = game === 'coup' || game === 'king_of_tokyo' || game === 'not_alone' || game === 'bang';
      const query = game
        ? resultsClient.from('leaderboard_by_game')
          .select('display_name,games_played,total_nuggets,wins')
          .eq('game_name', game)
          .order(rankByWins ? 'wins' : 'total_nuggets', { ascending: false })
          .order(rankByWins ? 'total_nuggets' : 'wins', { ascending: false })
          .order('display_name', { ascending: true })
          .limit(50)
        : resultsClient.from('leaderboard').select('display_name,games_played,total_nuggets,wins')
          .order('total_nuggets', { ascending: false })
          .order('wins', { ascending: false })
          .order('display_name', { ascending: true })
          .limit(50);
      const { data, error } = await query.abortSignal(AbortSignal.timeout(10_000));
      if (error || !isLeaderboardRows(data)) throw new Error('Invalid leaderboard response');
      return data.map(({ display_name, games_played, total_nuggets, wins }) => ({
        display_name, games_played, total_nuggets, wins,
      }));
    } catch {
      req.log.error('Leaderboard query failed');
      return reply.code(503).send({ message: 'The leaderboard could not be loaded. Please try again.' });
    }
  });

  app.get('/health', async () => ({ ok: true }));
}
