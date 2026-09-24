export type FeedTheKrakenJourney = 'quick' | 'long';
export type FeedTheKrakenFaction = 'sailor' | 'pirate' | 'cult_leader' | 'cultist';
export type FeedTheKrakenTeam = 'sailor' | 'pirate' | 'cult';
export type FeedTheKrakenColour = 'red' | 'blue' | 'yellow';
export type FeedTheKrakenCardEffect = 'drunk' | 'armed' | 'disarmed' | 'mermaid' | 'telescope' | 'uprising';
export type FeedTheKrakenMapAction = 'cabin' | 'flogging' | 'tongue' | 'feeding';
export type FeedTheKrakenRitual = 'conversion' | 'stash' | 'cult_search';
export type FeedTheKrakenCharacter = 'kleptomaniac' | 'troublemaker' | 'gunsmith' | 'peacemaker'
  | 'gunslinger' | 'minstrel' | 'boatswain' | 'herbalist' | 'lookout' | 'master_strategist'
  | 'smuggler' | 'agitator' | 'adviser' | 'chief_cook' | 'rabble_rouser' | 'archivist'
  | 'mentor' | 'spiritualist' | 'debt_collector' | 'negotiator' | 'instigator';
export type FeedTheKrakenPhase = 'priority' | 'appointment' | 'mutiny' | 'tie_veto' | 'navigation'
  | 'navigator' | 'emergency' | 'map_action' | 'effect_target' | 'telescope' | 'ritual' | 'instigator' | 'game_over';
export type FeedTheKrakenWindow = 'before_appointment' | 'after_appointment' | 'after_bids' | 'before_draw' | 'during_navigation' | 'yellow';
export interface FeedTheKrakenNavigationCard {
  id: string;
  colour: FeedTheKrakenColour;
  effect: FeedTheKrakenCardEffect;
}
export interface FeedTheKrakenMapNode {
  id: string;
  x: number;
  y: number;
  routes: Record<FeedTheKrakenColour, string>;
  action?: FeedTheKrakenMapAction;
  beforeSupply: boolean;
}
export type FeedTheKrakenAction =
  | { type: 'pass' }
  | { type: 'appoint'; lieutenantId: string; navigatorId: string }
  | { type: 'bid'; guns: number }
  | { type: 'veto'; playerId: string }
  | { type: 'submit_navigation'; cardId: string; redraw?: boolean }
  | { type: 'navigate'; cardId?: string; refuse?: boolean }
  | { type: 'emergency'; playerId: string }
  | { type: 'target'; playerId: string }
  | { type: 'telescope'; discard: boolean }
  | { type: 'ritual'; playerId?: string; allocations?: Record<string, number> }
  | { type: 'instigator'; accept: boolean }
  | { type: 'character'; targets?: string[] };
export interface FeedTheKrakenObservation {
  revision: number;
  kind: 'cabin' | 'cult_search' | 'conversion' | 'mermaid' | 'telescope' | 'lookout';
  playerId?: string;
  faction?: FeedTheKrakenFaction;
  cards?: Array<Pick<FeedTheKrakenNavigationCard, 'colour' | 'effect'>>;
}
export interface FeedTheKrakenPublicPlayer {
  playerId: string;
  displayName: string;
  guns: number | null;
  aboard: boolean;
  forfeited: boolean;
  departureReason: 'fed' | 'refused' | 'forfeit' | null;
  tongueless: boolean;
  conversionImmune: boolean;
  notFactions: FeedTheKrakenTeam[];
  offDuty: boolean;
  character: FeedTheKrakenCharacter | null;
  characterRevealed: boolean;
  resume: FeedTheKrakenNavigationCard[];
  faction: FeedTheKrakenFaction | null;
}
export interface FeedTheKrakenPublicState {
  gameId: 'feed_the_kraken';
  roomCode: string;
  revision: number;
  rulesVersion: string;
  journey: FeedTheKrakenJourney;
  status: 'playing' | 'game_over';
  phase: FeedTheKrakenPhase;
  window: FeedTheKrakenWindow | null;
  windowId: number;
  round: number;
  nodeId: string;
  captainId: string;
  lieutenantId: string | null;
  navigatorId: string | null;
  pendingPlayerId: string | null;
  players: FeedTheKrakenPublicPlayer[];
  initialPlayerCount: number;
  mutinyThreshold: number;
  bids: Record<string, number> | null;
  readyPlayerIds: string[];
  tieCandidates: string[];
  drawCount: number;
  discardCount: number;
  supplyGuns: number;
  supplyCrossed: boolean;
  revealedRituals: FeedTheKrakenRitual[];
  mapAction: FeedTheKrakenMapAction | null;
  currentCard: FeedTheKrakenNavigationCard | null;
  effects: {
    excludedPlayerIds: string[]; forcedBidPlayerIds: string[]; doubledPlayerIds: string[];
    extraDrawPlayerIds: string[]; redrawPlayerIds: string[]; bidCap: number | null; forcedLieutenantId: string | null;
  };
  winner: FeedTheKrakenTeam | null;
  winnerIds: string[];
  endReason: 'destination' | 'leader_fed' | 'no_participants' | null;
  log: Array<{ revision: number; message: string }>;
}
export interface FeedTheKrakenPrivateState {
  gameId: 'feed_the_kraken';
  roomCode: string;
  viewerPlayerId: string;
  playerId: string;
  revision: number;
  faction: FeedTheKrakenFaction;
  originalFaction: FeedTheKrakenFaction;
  knownPirateIds: string[];
  knownLeaderId: string | null;
  character: FeedTheKrakenCharacter;
  observations: FeedTheKrakenObservation[];
  navigationCards: FeedTheKrakenNavigationCard[];
  ownBid: number | null;
  ownGuns: number;
  minimumBid: number;
  maximumBid: number;
  canAct: boolean;
  canUseCharacter: boolean;
  canRedraw: boolean;
  ritual: FeedTheKrakenRitual | null;
  ritualGunCount: number;
  legalTargetIds: string[];
}
