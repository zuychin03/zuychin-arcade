export type CitadelsRole =
  | 'assassin' | 'thief' | 'magician' | 'king'
  | 'bishop' | 'merchant' | 'architect' | 'warlord';

export type CitadelsDistrictColor = 'noble' | 'religious' | 'trade' | 'military' | 'unique';

export type CitadelsUniqueEffect =
  | 'haunted_city' | 'keep' | 'imperial_treasury' | 'map_room'
  | 'laboratory' | 'observatory' | 'smithy' | 'library'
  | 'school_of_magic' | 'dragon_gate' | 'great_wall'
  | 'factory' | 'gold_mine' | 'wishing_well';

export interface CitadelsDistrictCard {
  id: string;
  templateId: string;
  name: string;
  color: CitadelsDistrictColor;
  cost: number;
  effect?: CitadelsUniqueEffect;
  effectText?: string;
}

export interface CitadelsRoleInfo {
  role: CitadelsRole;
  rank: number;
  name: string;
  summary: string;
}

export interface CitadelsPublicPlayer {
  playerId: string;
  displayName: string;
  gold: number;
  handCount: number;
  city: CitadelsDistrictCard[];
  revealedRole: CitadelsRole | null;
  isCrowned: boolean;
  hasCompletedCity: boolean;
  score: number | null;
  forfeited: boolean;
}

export type CitadelsPhase =
  | 'drafting' | 'choose_income' | 'choose_cards' | 'action' | 'game_over';

export interface CitadelsScoreBreakdown {
  districtPoints: number;
  diversityBonus: number;
  completionBonus: number;
  uniqueBonus: number;
  total: number;
}

export interface CitadelsPublicState {
  gameId: 'citadels';
  roomCode: string;
  rulesVersion: string;
  districtPreset: string;
  modeDescription: string;
  revision: number;
  status: 'playing' | 'game_over';
  terminationReason: 'not_enough_players' | null;
  phase: CitadelsPhase;
  roundNumber: number;
  crownPlayerId: string;
  draftPlayerId: string | null;
  activePlayerId: string | null;
  activeRole: CitadelsRole | null;
  faceUpDiscard: CitadelsRole[];
  calledRoles: CitadelsRole[];
  killedRole: CitadelsRole | null;
  robbedRole: CitadelsRole | null;
  firstCompletedPlayerId: string | null;
  players: CitadelsPublicPlayer[];
  turnOrder: string[];
  winnerIds: string[];
  scoreBreakdowns: Record<string, CitadelsScoreBreakdown>;
  log: Array<{ id: number; text: string }>;
}

export interface CitadelsPrivateState {
  gameId: 'citadels';
  roomCode: string;
  revision: number;
  playerId: string;
  hand: CitadelsDistrictCard[];
  chosenRole: CitadelsRole | null;
  availableRoles: CitadelsRole[];
  drawnCards: CitadelsDistrictCard[];
  canAct: boolean;
  canUseAbilities: boolean;
  canBuild: boolean;
  buildLimit: number;
  builtThisTurn: number;
  taxUsed: boolean;
  specialUsed: boolean;
  usableDistrictIds: string[];
  legalBuildCardIds: string[];
  effectiveBuildCosts: Record<string, number>;
}

export interface CitadelsStartPayload {}
export interface CitadelsChooseRolePayload { role: CitadelsRole; expectedRevision: number }
export interface CitadelsChooseIncomePayload { choice: 'gold' | 'cards'; expectedRevision: number }
export interface CitadelsKeepDistrictPayload { cardId: string; expectedRevision: number }
export interface CitadelsBuildPayload { cardId: string; expectedRevision: number }
export interface CitadelsPowerPayload {
  action: 'assassinate' | 'rob' | 'swap_hand' | 'redraw_hand' | 'tax' | 'architect_draw' | 'destroy';
  targetRole?: CitadelsRole;
  targetPlayerId?: string;
  cardIds?: string[];
  districtId?: string;
  expectedRevision: number;
}
export interface CitadelsDistrictPowerPayload { districtId: string; cardId?: string; expectedRevision: number }
export interface CitadelsEndTurnPayload { expectedRevision: number }

export type CitadelsActionKind =
  | 'start' | 'choose_character' | 'choose_income' | 'keep_district'
  | 'build' | 'power' | 'district_power' | 'end_turn';

export interface CitadelsActionAccepted {
  action: CitadelsActionKind;
  revision: number;
}
