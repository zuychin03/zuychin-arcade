import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '@zuychin-arcade/types';
import { verifyToken } from '../utils/jwt.js';
import { getRoomPublicState, roomStore } from '../store/RoomStore.js';
import { registerGameHandlers } from './gameHandlers.js';

export function registerSocketHandlers(io: Server): void {
  io.use((socket, next) => {
    // Auth middleware — every socket connection must carry a valid JWT
    const token = socket.handshake.auth.token as string | undefined;
    try {
      if (!token) throw new Error('missing');
      const payload = verifyToken(token);
      socket.data.auth = payload;
      next();
    } catch {
      next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const { playerId, roomCode } = socket.data.auth as JwtPayload;

    const room = roomStore.get(roomCode);
    const player = room?.players.get(playerId);
    if (!room || !player) {
      socket.emit('server_error', { message: 'Room or player no longer exists' });
      socket.disconnect(true);
      return;
    }

    socket.join(roomCode);
    player.socketId = socket.id;
    player.isConnected = true;
    roomStore.touch(room);
    io.to(roomCode).emit('room_updated', getRoomPublicState(room));

    registerGameHandlers(io, socket);

    socket.on('disconnect', () => {
      const r = roomStore.get(roomCode);
      if (!r) return;
      const p = r.players.get(playerId);
      if (p && p.socketId === socket.id) {
        p.isConnected = false;
        p.socketId = null;
        io.to(roomCode).emit('room_updated', getRoomPublicState(r));
      }
    });
  });
}
