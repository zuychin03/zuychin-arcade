import type { GameId } from '@zuychin-arcade/types';

export function gameBaseRoute(id: GameId) {
  return `/${id.replace(/_/g, '-')}`;
}

export function gameLobbyRoute(id: GameId) {
  return `${gameBaseRoute(id)}/lobby`;
}
