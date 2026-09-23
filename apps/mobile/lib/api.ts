import { SERVER_URL } from '../constants/config';
import type { GameId, JoinRoomResponse, LeaderboardRow, RoomPublicState, RoomConfig } from '@zuychin-arcade/types';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const signal = init?.signal;
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
  try {
    const res = await fetch(`${SERVER_URL}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      let code: string | undefined;
      try {
        const body = (await res.json()) as { message?: string; code?: string };
        if (typeof body.message === 'string' && body.message.trim()) message = body.message;
        if (typeof body.code === 'string') code = body.code;
      } catch {
        // Keep the status-based message when the server did not return JSON.
      }
      throw new ApiError(res.status, message, code);
    }
    return await res.json() as T;
  } catch (error) {
    if (timedOut) {
      throw new Error('The server took too long to respond. Check your connection and try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function createRoom(
  displayName: string,
  password?: string,
  gameId: GameId = 'saboteur',
  config?: RoomConfig,
): Promise<JoinRoomResponse> {
  return request('/rooms/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, password: password || undefined, gameId, ...(config ? { config } : {}) }),
  });
}

export function joinRoom(
  roomCode: string,
  displayName: string,
  password?: string,
): Promise<JoinRoomResponse> {
  return request('/rooms/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode, displayName, password: password || undefined }),
  });
}

export function getRoom(roomCode: string, token: string, signal?: AbortSignal): Promise<RoomPublicState> {
  return request(`/rooms/${encodeURIComponent(roomCode)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
}

export function kickPlayer(roomCode: string, token: string, targetPlayerId: string): Promise<void> {
  return request(`/rooms/${encodeURIComponent(roomCode)}/kick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ targetPlayerId }),
  });
}

export interface LeaveRoomResponse {
  ok: true;
  retainedForGameRecovery: boolean;
}

export function leaveRoom(roomCode: string, token: string): Promise<LeaveRoomResponse> {
  return request(`/rooms/${encodeURIComponent(roomCode)}/leave`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getLeaderboard(game?: GameId, signal?: AbortSignal): Promise<LeaderboardRow[]> {
  return request(`/leaderboard${game ? `?game=${encodeURIComponent(game)}` : ''}`, { signal });
}
