export type CartographersMapSide = 'C' | 'D';
export type CartographersTerrain = 'forest' | 'village' | 'farm' | 'water' | 'monster' | 'hero' | 'mountain';
export type CartographersMonster = 'dragon' | 'zombie' | 'troll' | 'gorgon';
export interface CartographersPoint { x: number; y: number }
export interface CartographersCell {
  terrain: CartographersTerrain | null;
  destroyed: boolean;
  wasteland: boolean;
  monster: CartographersMonster | null;
}
export interface CartographersShape { cells: readonly CartographersPoint[]; coin: boolean }
export interface CartographersExploreCard {
  id: string; name: string; kind: 'explore'; time: number;
  terrains: readonly CartographersTerrain[]; options: readonly CartographersShape[];
}
export interface CartographersHeroCard {
  id: string; name: string; kind: 'hero'; time: 0; attack: readonly CartographersPoint[];
}
export interface CartographersAmbushCard {
  id: string; name: string; kind: 'ambush'; time: 0; monster: CartographersMonster;
  cells: readonly CartographersPoint[]; direction: 'clockwise' | 'counterclockwise';
  soloCorner: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
}
export type CartographersCard = CartographersExploreCard | CartographersHeroCard | CartographersAmbushCard;
export interface CartographersObjective {
  id: string; name: string; category: 'forest' | 'farm_water' | 'village' | 'general'; soloModifier: number;
}
export interface CartographersSeasonScore {
  season: number; objectives: [number, number]; coins: number; monsterPenalty: number; total: number;
}
export interface CartographersMapView {
  cells: CartographersCell[]; attackCells: number[]; coins: number; mountainCoins: number[];
  dragonRewarded: boolean;
}
export interface CartographersTransform {
  anchor: CartographersPoint; rotation: 0 | 90 | 180 | 270; mirrored: boolean;
}
export interface CartographersSubmission {
  turnId: number; expectedRevision: number; submissionToken: string; targetPlayerId: string;
}
export interface CartographersPlacementPayload extends CartographersSubmission, CartographersTransform {
  optionIndex: number; terrain: CartographersTerrain; destroyTarget?: CartographersPoint;
}
export interface CartographersDestructionPayload extends CartographersSubmission { position: CartographersPoint }
export interface CartographersAssignment {
  targetPlayerId: string; displayName: string; submissionToken: string;
  map: CartographersMapView; fallback: boolean;
  fixedPlacement: CartographersTransform | null;
}
export interface CartographersPublicPlayer {
  playerId: string; displayName: string; forfeited: boolean; submitted: boolean;
  coins: number; totalScore: number; scores: CartographersSeasonScore[];
}
export interface CartographersHeroesPublicState {
  gameId: 'cartographers_heroes'; roomCode: string; revision: number; rulesVersion: string;
  status: 'playing' | 'game_over'; phase: 'drawing' | 'season_effect' | 'game_over';
  mapSide: CartographersMapSide; solo: boolean; season: number; elapsed: number; threshold: number;
  turnId: number; turnRevision: number; currentCardId: string | null; currentEffect: CartographersMonster | null;
  objectiveIds: string[]; revealedCardIds: string[]; deckCount: number; players: CartographersPublicPlayer[];
  winnerIds: string[]; endReason: 'natural' | 'forfeit' | 'abandoned' | null;
  soloRating: number | null; soloTitle: string | null;
}
export interface CartographersHeroesPrivateState {
  gameId: 'cartographers_heroes'; roomCode: string; revision: number; playerId: string;
  map: CartographersMapView; assignments: CartographersAssignment[];
  resultMaps: { playerId: string; displayName: string; map: CartographersMapView }[];
}
