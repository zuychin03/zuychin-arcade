export type ColtAction = 'move' | 'floor' | 'shoot' | 'punch' | 'rob' | 'marshal';
export type ColtActionKind = 'start' | 'program' | 'assign-start' | 'choose-team' | 'choose-character' | 'reserve' | 'choose';
export type ColtLevel = 'inside' | 'roof';
export type ColtCharacter = 'ghost' | 'doc' | 'tuco' | 'django' | 'cheyenne' | 'belle';
export type ColtPhase = 'character_selection' | 'team_selection' | 'team_setup' | 'reserve_card' | 'programming' | 'execution' | 'pending_choice' | 'game_over';
export type ColtLootType = 'purse' | 'jewel' | 'strongbox';
export type ColtTurnType = 'standard' | 'tunnel' | 'speeding' | 'switching';
export type ColtRoundEvent = 'none' | 'angry_marshal' | 'braking' | 'passengers_rebellion' | 'swivel_arm' | 'take_it_all' | 'marshal_revenge' | 'hostage_conductor' | 'pickpocketing';

export interface ColtPosition { carIndex: number; level: ColtLevel }
export interface ColtLoot { id: string; type: ColtLootType; value: number }
export interface ColtPublicLoot { id: string; type: ColtLootType; value: number | null }
export interface ColtRoundCard { id: string; title: string; band: '2-4' | '5-6' | 'station'; turns: ColtTurnType[]; event: ColtRoundEvent }
export interface ColtProgramCard { playerId: string; ownerBandit: number | null; action: ColtAction | null; faceUp: boolean; cover: boolean }
export interface ColtPublicPlayer {
  playerId: string;
  forfeited: boolean;
  displayName: string;
  character: ColtCharacter | null;
  characterChosen: boolean;
  characters: ColtCharacter[];
  positions: ColtPosition[];
  lootCount: number;
  lootCounts: number[];
  lootValue: number | null;
  gunslingerShots: number | null;
  finalScore: number | null;
  bulletsFired: number;
  bulletsRemaining: number;
  receivedBullets: number;
  handCount: number;
  setupComplete: boolean;
  reserveComplete: boolean;
}
export interface ColtPendingChoice { playerId: string; action: ColtAction; options: { id: string; label: string }[] }
export interface ColtPublicState {
  gameId: 'colt_express';
  roomCode: string;
  rulesVersion: string;
  revision: number;
  status: 'playing' | 'game_over';
  endReason: 'score' | 'forfeit' | null;
  turnOrder: string[];
  initialPlayerCount: number;
  twoBanditMode: boolean;
  phase: ColtPhase;
  round: 1 | 2 | 3 | 4 | 5;
  slot: number;
  slots: number;
  turnType: ColtTurnType | null;
  roundCard: ColtRoundCard;
  firstPlayerId: string | null;
  programmingPlayerId: string | null;
  programmingActionNumber: 1 | 2 | null;
  teamSelectionPlayerId: string | null;
  availableTeams: ColtCharacter[][];
  availableCharacters: ColtCharacter[];
  trainCars: number;
  marshalCar: number;
  neutralBulletsRemaining: number;
  players: ColtPublicPlayer[];
  lootBySpace: Record<string, ColtPublicLoot[]>;
  program: ColtProgramCard[];
  executionIndex: number;
  pending: ColtPendingChoice | null;
  winnerPlayerIds: string[];
  log: { id: number; text: string }[];
}
export interface ColtPrivateState {
  gameId: 'colt_express';
  roomCode: string;
  revision: number;
  playerId: string;
  hand: { id: string; action: ColtAction | 'bullet'; ownerBandit: number }[];
  reserveOptions: { id: string; action: ColtAction | 'bullet'; ownerBandit: number }[];
  programmedCardIds: string[];
  lootByBandit: ColtLoot[][];
  canAssignStart: boolean;
  canChooseTeam: boolean;
  canChooseCharacter: boolean;
  canReserve: boolean;
  canProgram: boolean;
  canHideFirstAction: boolean;
  canChoose: boolean;
}
export interface ColtProgramPayload { cardId?: string; coverCardId?: string; draw?: boolean; faceDown?: boolean; expectedRevision: number }
export interface ColtChoicePayload { optionId: string; expectedRevision: number }
export interface ColtAssignStartPayload { cabooseBandit: number; expectedRevision: number }
export interface ColtReservePayload { cardId: string; expectedRevision: number }
export interface ColtChooseTeamPayload { teamIndex: number; expectedRevision: number }
export interface ColtChooseCharacterPayload { character: ColtCharacter; expectedRevision: number }
