import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { router } from 'expo-router';
import { useGameStore } from '../store/useGameStore';
import { SERVER_URL } from '../constants/config';
import { clearAuth } from '../lib/storage';

let socketInstance: Socket | null = null;

/**
 * Owns the Socket.IO connection lifecycle. Mounted once in the root layout:
 * connects whenever a token is present, tears down when it goes away.
 */
export function useSocket(): void {
  const token = useGameStore((s) => s.token);

  useEffect(() => {
    if (!token) return;

    const socket = io(SERVER_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });
    socketInstance = socket;

    const store = useGameStore.getState;
    // game_state / private_state are shared channels; route to the right game's
    // store slice by the room's gameId (room_updated always arrives first), with
    // a payload-shape fallback ('variant' is Coup-only).
    const isCoup = (state: unknown): boolean =>
      store().room?.gameId === 'coup' || (!!state && typeof state === 'object' && 'variant' in state);
    socket.on('room_updated', (room) => store().setRoom(room));
    socket.on('game_state', (state) => (isCoup(state) ? store().setCoupPublic(state) : store().setPublicState(state)));
    socket.on('private_state', (state) =>
      isCoup(state) ? store().setCoupPrivate(state) : store().setPrivateState(state),
    );
    socket.on('player_kicked', () => {
      void clearAuth();
      store().clearAll();
      router.replace('/');
    });
    socket.on('connect', () => socket.emit('request_state'));
    socket.on('server_error', () => {
      // Room or player no longer exists server-side — session is unrecoverable
      void clearAuth();
      store().clearAll();
      router.replace('/');
    });
    socket.on('connect_error', (err) => {
      if (err.message === 'INVALID_TOKEN') {
        void clearAuth();
        store().clearAll();
        router.replace('/');
      }
    });

    return () => {
      socket.disconnect();
      if (socketInstance === socket) socketInstance = null;
    };
  }, [token]);
}

export function getSocket(): Socket | null {
  return socketInstance;
}
