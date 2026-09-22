export type BangRole = 'sheriff' | 'deputy' | 'outlaw' | 'renegade';
export type BangTeam = 'law' | 'outlaws' | 'renegade';
export type BangPhase = 'draw_choice' | 'draw_check' | 'play' | 'response' | 'rescue' | 'discard_order' | 'general_store' | 'discard' | 'game_over';
export type BangSuit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type BangCardName = 'bang' | 'missed' | 'beer' | 'saloon' | 'stagecoach' | 'wells_fargo' | 'general_store' | 'panic' | 'cat_balou' | 'gatling' | 'indians' | 'duel' | 'barrel' | 'dynamite' | 'scope' | 'mustang' | 'jail' | 'volcanic' | 'schofield' | 'remington' | 'rev_carabine' | 'winchester';
export type BangCharacterId = 'bart_cassidy' | 'black_jack' | 'calamity_janet' | 'el_gringo' | 'jesse_jones' | 'jourdonnais' | 'kit_carlson' | 'lucky_duke' | 'paul_regret' | 'pedro_ramirez' | 'rose_doolan' | 'sid_ketchum' | 'slab_the_killer' | 'suzy_lafayette' | 'vulture_sam' | 'willy_the_kid';
export interface BangCard { id: string; name: BangCardName; suit: BangSuit; rank: string; }
export interface BangPublicPlayer {
  playerId: string;
  displayName: string;
  character: BangCharacterId;
  role: BangRole | null;
  health: number;
  maxHealth: number;
  alive: boolean;
  forfeited: boolean;
  handCount: number;
  equipment: BangCard[];
  distanceFromActive: number;
}
export type BangBarrelSource = 'barrel' | 'jourdonnais';
export type BangCheckKind = BangBarrelSource | 'jail' | 'dynamite';
export interface BangPendingResponse {
  kind: 'bang' | 'gatling' | 'indians' | 'duel' | 'general_store';
  sourcePlayerId: string;
  targetPlayerId: string;
  response: 'missed' | 'bang' | null;
  missesRequired: number;
  missesPlayed: number;
  barrelsUsed: BangBarrelSource[];
  queue: string[];
  duelOpponentPlayerId?: string;
  storeCards?: BangCard[];
}
export type BangDrawChoiceKind = 'jesse_jones' | 'kit_carlson' | 'pedro_ramirez';
export interface BangPublicDrawChoice { kind: BangDrawChoiceKind; playerId: string; }
export interface BangPrivateDrawChoice extends BangPublicDrawChoice { options?: BangCard[]; }
export interface BangDrawCheck { playerId: string; kind: BangCheckKind; cards: BangCard[]; }
export interface BangRescue { playerId: string; livesNeeded: number; sourcePlayerId: string | null; cause: 'bang' | 'gatling' | 'indians' | 'duel' | 'dynamite'; }
export interface BangPlayTarget { playerId: string; hand: boolean; equipmentCardIds: string[]; }
export interface BangPlayOption { cardId: string; effectiveName: BangCardName; targets: BangPlayTarget[]; }
export interface BangPublicState {
  gameId: 'bang';
  roomCode: string;
  rulesVersion: string;
  revision: number;
  status: 'playing' | 'game_over';
  phase: BangPhase;
  turnNumber: number;
  activePlayerId: string;
  players: BangPublicPlayer[];
  pending: BangPendingResponse | null;
  drawChoice: BangPublicDrawChoice | null;
  drawCheck: BangDrawCheck | null;
  rescue: BangRescue | null;
  discardOrder: { playerId: string; count: number } | null;
  drawCount: number;
  discardTop: BangCard | null;
  winner: BangTeam | null;
  abandoned: boolean;
  log: { id: number; text: string }[];
}
export interface BangPrivateState {
  gameId: 'bang';
  roomCode: string;
  revision: number;
  playerId: string;
  role: BangRole;
  hand: BangCard[];
  canPlay: boolean;
  playOptions: BangPlayOption[];
  canRespond: boolean;
  responseCardIds: string[];
  barrelOptions: BangBarrelSource[];
  canChooseStore: boolean;
  canChooseDraw: boolean;
  drawChoice: BangPrivateDrawChoice | null;
  canChooseCheck: boolean;
  canRescue: boolean;
  rescueBeerCardIds: string[];
  canUseSid: boolean;
  canChooseDiscardOrder: boolean;
  discardOrderCards: BangCard[];
  canDiscard: boolean;
  legalTargetIds: string[];
  weaponRange: number;
  bangsRemaining: number | null;
}
export interface BangPlayPayload { cardId: string; targetPlayerId?: string; targetZone?: 'hand' | 'equipment'; targetCardId?: string; expectedRevision?: number; }
export interface BangRespondPayload { cardId?: string; expectedRevision?: number; }
export interface BangDiscardPayload { cardIds: string[]; expectedRevision?: number; }
export interface BangStorePayload { cardId: string; expectedRevision?: number; }
export interface BangDrawPayload { useAbility?: boolean; targetPlayerId?: string; cardIds?: string[]; expectedRevision?: number; }
export interface BangSidPayload { cardIds: string[]; expectedRevision?: number; }
export interface BangBarrelPayload { source: BangBarrelSource; expectedRevision?: number; }
export interface BangCheckPayload { cardId: string; expectedRevision?: number; }
export interface BangRescuePayload { cardId?: string; expectedRevision?: number; }
export interface BangDiscardOrderPayload { cardIds: string[]; expectedRevision?: number; }
export type BangActionKind = 'start' | 'play' | 'respond' | 'end_turn' | 'discard' | 'choose_store' | 'choose_draw' | 'sid_ketchum' | 'use_barrel' | 'choose_check' | 'rescue' | 'discard_order';
export interface BangActionAccepted { action: BangActionKind; revision: number; }
