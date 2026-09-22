export type NotAloneRole = 'creature' | 'hunted';
export type NotAlonePhase =
  | 'hunted_planning' | 'exploration_reaction' | 'creature_planning'
  | 'hunting_reaction' | 'river_choice' | 'reckoning' | 'end_of_turn' | 'game_over';
export type NotAloneHuntToken = 'creature' | 'target' | 'artemia';
export type NotAloneTeam = 'creature' | 'hunted';
export type NotAloneEncounterStage = 'place' | 'target' | 'artemia' | 'creature';
export type NotAloneBoardFace = 'continuous' | 'alternating';
export type NotAloneContentSet = 'original-base-2016';
export type NotAloneEndReason = 'track' | 'forfeit';
export type NotAlonePlaceId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type NotAloneSurvivalCardId =
  | 'adrenaline' | 'amplifier' | 'detector' | 'dodge' | 'double_back'
  | 'drone' | 'gate' | 'hologram' | 'ingenuity' | 'sacrifice'
  | 'sixth_sense' | 'smokescreen' | 'strike_back' | 'vortex' | 'wrong_track';

export type NotAloneHuntCardId =
  | 'anticipation' | 'ascendancy' | 'cataclysm' | 'clone' | 'despair'
  | 'detour' | 'fierceness' | 'flashback' | 'forbidden_zone' | 'force_field'
  | 'interference' | 'mirage' | 'mutation' | 'persecution' | 'phobia'
  | 'scream' | 'stasis' | 'toxin' | 'tracking' | 'virus';

export interface NotAlonePlaceDefinition {
  id: NotAlonePlaceId;
  name: string;
  summary: string;
  accent: string;
}

export interface NotAloneCardDefinition<T extends string> {
  id: T;
  name: string;
  phase: 1 | 2 | 3 | 4 | 0;
  summary: string;
  token?: 'target' | 'artemia';
  placeCount?: 1 | 2;
}

export interface NotAlonePublicPlayer {
  playerId: string;
  displayName: string;
  role: NotAloneRole;
  will: number | null;
  handCount: number;
  discard: NotAlonePlaceId[];
  discardCount: number;
  survivalCount: number;
  forfeited: boolean;
  isReady: boolean;
  reactionPassed: boolean;
  revealedPlaces: NotAlonePlaceId[];
  originalRevealedPlaces: NotAlonePlaceId[];
}

export interface NotAlonePublicState {
  gameId: 'not_alone';
  viewerPlayerId: string;
  roomCode: string;
  rulesVersion: string;
  contentSet: NotAloneContentSet;
  modeDescription: string;
  revision: number;
  status: 'playing' | 'game_over';
  phase: NotAlonePhase;
  roundNumber: number;
  boardFace: NotAloneBoardFace;
  pendingCardChoice: {
    kind: 'ascendancy' | 'forbidden_zone' | 'phobia' | 'artemia_discard' | 'artefact_order';
    playerId: string | null;
    count: number;
    submittedCount: number;
    eligibleCount: number;
  } | null;
  creaturePlayerId: string;
  huntedOrder: string[];
  pendingPlayerId: string | null;
  pendingPlaceId: NotAlonePlaceId | null;
  pendingPlaceIndex: number;
  pendingEncounterStage: NotAloneEncounterStage | null;
  rescueProgress: number;
  rescueGoal: number;
  assimilationProgress: number;
  assimilationGoal: number;
  artemiaAvailable: boolean;
  beachCharged: boolean;
  huntTokens: Record<NotAloneHuntToken, NotAlonePlaceId[]>;
  activeHuntCards: NotAloneHuntCardId[];
  effectiveHuntCardIds: NotAloneHuntCardId[];
  copiedHuntCard: NotAloneHuntCardId | null;
  anticipationTargetPlayerId: string | null;
  selectionBlockedPlaces: NotAlonePlaceId[];
  disabledPlaces: NotAlonePlaceId[];
  reserve: Record<NotAlonePlaceId, number>;
  players: NotAlonePublicPlayer[];
  winner: NotAloneTeam | null;
  endReason: NotAloneEndReason | null;
  log: Array<{ id: number; text: string }>;
}

export interface NotAlonePrivateState {
  gameId: 'not_alone';
  roomCode: string;
  revision: number;
  playerId: string;
  role: NotAloneRole;
  placeHand: NotAlonePlaceId[];
  survivalHand: NotAloneSurvivalCardId[];
  selectedPlaces: NotAlonePlaceId[];
  playedPlaces: NotAlonePlaceId[];
  huntHand: NotAloneHuntCardId[];
  lastDiscardedHuntCard: NotAloneHuntCardId | null;
  survivalChoiceCards: NotAloneSurvivalCardId[];
  canChooseSurvivalCard: boolean;
  cardChoice: { kind: 'ascendancy' | 'forbidden_zone' | 'phobia' | 'artemia_discard' | 'artefact_order'; count: number; placeOptions: NotAlonePlaceId[]; placeIndexes: number[] } | null;
  cardChoiceSubmitted: boolean;
  revealedHuntedHands: Record<string, NotAlonePlaceId[]>;
  canSelect: boolean;
  canGiveUp: boolean;
  resistOptions: Array<{ willCost: 1 | 2; recoveryCount: number }>;
  canChooseRiver: boolean;
  canHunt: boolean;
  playableHuntCardIds: NotAloneHuntCardId[];
  huntOptions: {
    targetPlayerIds: string[];
    ascendancyTargetPlayerIds: string[];
    phobiaTargetPlayerIds: string[];
    cataclysmPlaceIds: NotAlonePlaceId[];
    detourOptions: Array<{
      playerId: string;
      placeIndex: 0 | 1;
      originPlaceId: NotAlonePlaceId;
      destinationPlaceIds: NotAlonePlaceId[];
    }>;
  };
  playableSurvivalCardIds: NotAloneSurvivalCardId[];
  canReveal: boolean;
  canLockHunt: boolean;
  canBeginReckoning: boolean;
  canBeginHunt: boolean;
  canEndTurn: boolean;
  canPass: boolean;
  canResolve: boolean;
  resolutionOptions: {
    stage: 'encounter' | 'place';
    placeId: NotAlonePlaceId;
    effectivePlaceId: NotAlonePlaceId;
    mustUsePlacePower: boolean;
    canUsePlacePower: boolean;
    canRecoverPlace: boolean;
    recoverCount: number;
    recoverablePlaceIds: NotAlonePlaceId[];
    powerRecoverablePlaceIds: NotAlonePlaceId[];
    powerRecoveryCount: number;
    canReturnPlayedPlace: boolean;
    returnablePlayedPlaceId: NotAlonePlaceId | null;
    copyablePlaceIds: NotAlonePlaceId[];
    roverPlaceIds: NotAlonePlaceId[];
    healTargetPlayerIds: string[];
    sourceChoices: Array<'card' | 'will'>;
    beachChoices: Array<'charge' | 'launch'>;
    screamDiscardPlaceIds: NotAlonePlaceId[];
    screamDiscardCount: number;
    canLoseWillForScream: boolean;
    toxinSurvivalCardIds: NotAloneSurvivalCardId[];
    canContinue: boolean;
  } | null;
  survivalOptions: {
    sacrificePlaceIds: NotAlonePlaceId[];
    vortexDiscardPlaceIds: NotAlonePlaceId[];
    vortexSelectedPlaceIds: NotAlonePlaceId[];
    vortexSelectedPlaceIndexes: number[];
    doubleBackPlaceIds: NotAlonePlaceId[];
    doubleBackPlaceIndexes: number[];
    gatePlaceIds: NotAlonePlaceId[];
    hologramPlaceIds: NotAlonePlaceId[];
    wrongTrackCreaturePlaceIds: NotAlonePlaceId[];
    wrongTrackTargetPlaceIds: NotAlonePlaceId[];
  };
  requiredSelectionCount: 1 | 2;
  selectionMode: 'single' | 'river' | 'artefact';
  maxHuntCards: number;
  huntCardsPlayed: number;
}

export interface NotAloneStartPayload { boardFace: NotAloneBoardFace }
export interface NotAloneRevisionPayload { expectedRevision: number }
export interface NotAloneSelectPayload { placeIds: NotAlonePlaceId[]; expectedRevision: number }
export interface NotAloneRiverPayload { explorePlaceId: NotAlonePlaceId; expectedRevision: number }
export interface NotAloneSurvivalChoicePayload { cardId: NotAloneSurvivalCardId; expectedRevision: number }
export interface NotAloneCardChoicePayload { placeIds?: NotAlonePlaceId[]; placeIndexes?: Array<0 | 1>; expectedRevision: number }
export interface NotAloneResistPayload { willCost: 1 | 2; placeIds: NotAlonePlaceId[]; expectedRevision: number }
export interface NotAloneSurvivalPayload {
  cardId: NotAloneSurvivalCardId;
  token?: 'creature' | 'target';
  placeIds?: NotAlonePlaceId[];
  targetPlaceId?: NotAlonePlaceId;
  placeIndex?: 0 | 1;
  expectedRevision: number;
}
export interface NotAloneHuntCardPayload {
  cardId: NotAloneHuntCardId;
  targetPlayerId?: string;
  originPlaceId?: NotAlonePlaceId;
  placeIndex?: 0 | 1;
  placeIds?: NotAlonePlaceId[];
  expectedRevision: number;
}
export interface NotAlonePlaceTokenPayload { token: NotAloneHuntToken; placeIds: NotAlonePlaceId[]; expectedRevision: number }
export interface NotAloneResolvePayload {
  mode: 'power' | 'recover' | 'copy';
  placeIds?: NotAlonePlaceId[];
  targetPlayerId?: string;
  targetPlaceId?: NotAlonePlaceId;
  choice?: 'will' | 'card' | 'charge' | 'launch';
  huntChoice?: 'discard' | 'will';
  huntPlaceIds?: NotAlonePlaceId[];
  huntSurvivalCardId?: NotAloneSurvivalCardId;
  expectedRevision: number;
}

export type NotAloneActionKind =
  | 'start' | 'select' | 'river_choice' | 'survival_choice' | 'card_choice'
  | 'resist' | 'give_up' | 'survival' | 'hunt_card' | 'place_token'
  | 'pass' | 'begin_hunt' | 'lock_hunt' | 'reveal' | 'begin_reckoning' | 'resolve' | 'end_turn';

export interface NotAloneActionAccepted {
  action: NotAloneActionKind;
  revision: number;
}
