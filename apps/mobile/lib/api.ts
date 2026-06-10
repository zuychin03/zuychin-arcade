import { SERVER_URL } from '../constants/config';
import type { JoinRoomResponse, LeaderboardRow, RoomPublicState } from '@zuychin-arcade/types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function createRoom(displayName: string, password?: string): Promise<JoinRoomResponse> {
  return request('/rooms/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, password: password || undefined }),
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

export function getRoom(roomCode: string): Promise<RoomPublicState> {
  return request(`/rooms/${encodeURIComponent(roomCode)}`);
}

export function kickPlayer(roomCode: string, token: string, targetPlayerId: string): Promise<void> {
  return request(`/rooms/${encodeURIComponent(roomCode)}/kick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ targetPlayerId }),
  });
}

export function getLeaderboard(): Promise<LeaderboardRow[]> {
  return request('/leaderboard');
}
