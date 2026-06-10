import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import type { JoinRoomResponse, LeaderboardRow } from '@zuychin-arcade/types';
import { MAX_PLAYERS } from '@zuychin-arcade/types';
import { getRoomPublicState, roomStore } from '../store/RoomStore.js';
import { signToken, verifyToken } from '../utils/jwt.js';
import { supabase } from '../lib/supabase.js';

const NAME_RE = /^[A-Za-z0-9 ]{1,20}$/;

function validateDisplayName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return NAME_RE.test(trimmed) ? trimmed : null;
}

export function registerRoomRoutes(app: FastifyInstance, io: Server): void {
  app.post('/rooms/create', async (req, reply) => {
    const body = (req.body ?? {}) as { displayName?: string; password?: string };
    const displayName = validateDisplayName(body.displayName);
    if (!displayName) {
      return reply.code(400).send({ message: 'Display name must be 1–20 letters, numbers or spaces' });
    }
    const password = typeof body.password === 'string' && body.password.length > 0 ? body.password : null;

    const playerId = randomUUID();
    const room = roomStore.create(playerId, password);
    room.players.set(playerId, {
      playerId,
      displayName,
      isHost: true,
      isConnected: false,
      socketId: null,
    });

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
    const body = (req.body ?? {}) as { roomCode?: string; password?: string; displayName?: string };
    const displayName = validateDisplayName(body.displayName);
    if (!displayName) {
      return reply.code(400).send({ message: 'Display name must be 1–20 letters, numbers or spaces' });
    }
    if (typeof body.roomCode !== 'string') {
      return reply.code(400).send({ message: 'Room code is required' });
    }

    const room = roomStore.get(body.roomCode);
    if (!room) return reply.code(404).send({ message: 'Room not found' });
    if (room.password && room.password !== (body.password ?? '')) {
      return reply.code(403).send({ message: 'Wrong password' });
    }
    if (room.status !== 'lobby') {
      return reply.code(409).send({ message: 'Game already in progress' });
    }
    if (room.players.size >= MAX_PLAYERS) {
      return reply.code(409).send({ message: 'Room is full' });
    }
    const nameTaken = [...room.players.values()].some(
      (p) => p.displayName.toLowerCase() === displayName.toLowerCase(),
    );
    if (nameTaken) {
      return reply.code(409).send({ message: 'That name is already taken in this room' });
    }

    const playerId = randomUUID();
    room.players.set(playerId, {
      playerId,
      displayName,
      isHost: false,
      isConnected: false,
      socketId: null,
    });
    roomStore.touch(room);
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
    const { roomCode } = req.params as { roomCode: string };
    const room = roomStore.get(roomCode);
    if (!room) return reply.code(404).send({ message: 'Room not found' });
    return getRoomPublicState(room);
  });

  app.post('/rooms/:roomCode/kick', async (req, reply) => {
    const { roomCode } = req.params as { roomCode: string };
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return reply.code(401).send({ message: 'Missing token' });

    let payload;
    try {
      payload = verifyToken(auth.slice(7));
    } catch {
      return reply.code(401).send({ message: 'Invalid token' });
    }

    const room = roomStore.get(roomCode);
    if (!room) return reply.code(404).send({ message: 'Room not found' });
    if (room.hostPlayerId !== payload.playerId) {
      return reply.code(403).send({ message: 'Only the host can kick players' });
    }

    const { targetPlayerId } = (req.body ?? {}) as { targetPlayerId?: string };
    if (!targetPlayerId || targetPlayerId === room.hostPlayerId) {
      return reply.code(400).send({ message: 'Invalid target player' });
    }
    const target = room.players.get(targetPlayerId);
    if (!target) return reply.code(404).send({ message: 'Player not in room' });

    room.players.delete(targetPlayerId);
    if (target.socketId) {
      io.to(target.socketId).emit('player_kicked', {});
      io.sockets.sockets.get(target.socketId)?.leave(room.roomCode);
    }
    io.to(room.roomCode).emit('room_updated', getRoomPublicState(room));
    return { ok: true };
  });

  app.get('/leaderboard', async (): Promise<LeaderboardRow[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from('leaderboard').select('*').limit(50);
    if (error) {
      console.error('[supabase] leaderboard query failed', error);
      return [];
    }
    return (data ?? []) as LeaderboardRow[];
  });

  app.get('/health', async () => ({ ok: true }));
}
