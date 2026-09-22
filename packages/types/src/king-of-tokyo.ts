import type { KingOfTokyoPowerCardId } from './king-of-tokyo-cards';

export type KingOfTokyoDieFace = 1 | 2 | 3 | 'energy' | 'smash' | 'heart';
export type KingOfTokyoZone = 'tokyo_city' | 'tokyo_bay';
export type KingOfTokyoDefenseMode = 'off' | 'lethal' | 'always';
export type KingOfTokyoTokenPreference = 'poison' | 'shrink';
export type KingOfTokyoDiceResolutionCategory = 'points' | 'energy' | 'hearts' | 'smash';

export type KingOfTokyoPhase =
  | 'determining_first_player'
  | 'awaiting_roll'
  | 'choosing_dice'
  | 'awaiting_psychic_probe'
  | 'awaiting_dice_resolution'
  | 'awaiting_heart_allocation'
  | 'awaiting_defense_decision'
  | 'awaiting_freeze_time'
  | 'awaiting_tokyo_decision'
  | 'awaiting_death_from_above'
  | 'buying_cards'
  | 'selling_cards'
  | 'resolving_end_turn'
  | 'awaiting_opportunist'
  | 'game_over';

export type KingOfTokyoVictoryType = 'victory_points' | 'last_monster_standing' | 'mutual_destruction';
export type KingOfTokyoEndTurnEffectKind =
  | 'poison'
  | 'metamorph'
  | 'energy_hoarder'
  | 'herbivore'
  | 'rooting_for_underdog'
  | 'solar_powered';

export interface KingOfTokyoEndTurnEffect {
  effectId: KingOfTokyoEndTurnEffectKind;
  kind: KingOfTokyoEndTurnEffectKind;
  copies: number;
}

export interface KingOfTokyoDie {
  face: KingOfTokyoDieFace | null;
  kept: boolean;
}

export interface KingOfTokyoOwnedPowerCard {
  instanceId: string;
  cardId: KingOfTokyoPowerCardId;
  counters: number;
  mimicTargetInstanceId: string | null;
}

export interface KingOfTokyoMarketCard {
  instanceId: string;
  cardId: KingOfTokyoPowerCardId;
}

export interface KingOfTokyoPlayer {
  playerId: string;
  displayName: string;
  health: number;
  maxHealth: number;
  victoryPoints: number;
  energy: number;
  tokyoZone: KingOfTokyoZone | null;
  eliminated: boolean;
  forfeited: boolean;
  poisonTokens: number;
  shrinkTokens: number;
  defenseMode: KingOfTokyoDefenseMode;
  rapidHealingMode: KingOfTokyoDefenseMode;
  tokenPreference: KingOfTokyoTokenPreference;
  powerCards: KingOfTokyoOwnedPowerCard[];
}

export type KingOfTokyoPublicPlayer = Omit<
  KingOfTokyoPlayer,
  'defenseMode' | 'rapidHealingMode' | 'tokenPreference'
>;

export interface KingOfTokyoViewerPreferences {
  defenseMode: KingOfTokyoDefenseMode;
  rapidHealingMode: KingOfTokyoDefenseMode;
  tokenPreference: KingOfTokyoTokenPreference;
}

export interface KingOfTokyoHealingRayUse {
  dieIndex: number;
  targetPlayerId: string;
}

export interface KingOfTokyoDiceResolutionPlan {
  resolutionOrder: KingOfTokyoDiceResolutionCategory[];
}

export interface KingOfTokyoHeartAllocation {
  healingRayUses: KingOfTokyoHealingRayUse[];
  poisonTokensToRemove: number;
  shrinkTokensToRemove: number;
}

export type KingOfTokyoDefenseDecision =
  | { kind: 'camouflage'; changes: { dieIndex: number; face: KingOfTokyoDieFace }[] }
  | { kind: 'wings'; use: boolean }
  | { kind: 'rapid_healing'; activations: number };

export interface KingOfTokyoPendingDefenseDecision {
  kind: KingOfTokyoDefenseDecision['kind'];
  playerId: string;
  incomingDamage: number;
  remainingDamage: number;
  camouflageCopy: number | null;
  camouflageCopies: number | null;
  dice: KingOfTokyoDieFace[];
  stretchyAvailable: boolean;
  healingPerActivation: number;
  maxActivations: number;
}

export interface KingOfTokyoPendingHeartAllocation {
  playerId: string;
  heartIndexes: number[];
  healingRayAvailable: boolean;
  healingRayTargetPlayerIds: string[];
}

export interface KingOfTokyoLogEntry {
  id: number;
  text: string;
}

export interface KingOfTokyoPublicState {
  gameId: 'king_of_tokyo';
  roomCode: string;
  viewerPlayerId: string | null;
  revision: number;
  rulesVersion: string;
  status: 'playing' | 'game_over';
  phase: KingOfTokyoPhase;
  players: KingOfTokyoPublicPlayer[];
  /** Present only in the state projected to this player. */
  viewerPreferences: KingOfTokyoViewerPreferences | null;
  /** Viewer-owned once-per-turn manual powers currently available in this phase. */
  viewerAvailableOncePerTurnCardInstanceIds: string[];
  turnOrder: string[];
  currentPlayerId: string | null;
  rollCount: number;
  maxRolls: number;
  dice: KingOfTokyoDie[];
  tokyoCapacity: 1 | 2;
  rollOffRound: number;
  pendingTokyoDecisionPlayerId: string | null;
  hasDeferredSmashDamage: boolean;
  pendingHeartAllocation: KingOfTokyoPendingHeartAllocation | null;
  pendingDefenseDecision: KingOfTokyoPendingDefenseDecision | null;
  pendingFreezeTimePlayerId: string | null;
  pendingFreezeTimeDicePenalty: number | null;
  pendingFreezeTimeChoicesRemaining: number;
  pendingDeathFromAbovePlayerId: string | null;
  pendingDeathFromAboveTargetPlayerIds: string[];
  pendingPsychicProbePlayerId: string | null;
  pendingPsychicProbeCardInstanceId: string | null;
  pendingOpportunistPlayerId: string | null;
  pendingOpportunistCardInstanceId: string | null;
  pendingMimicTargetPlayerId: string | null;
  pendingMimicTargetCardInstanceId: string | null;
  /** Visible only to the active player while ordering simultaneous end-turn effects. */
  pendingEndTurnEffects: KingOfTokyoEndTurnEffect[];
  market: (KingOfTokyoMarketCard | null)[];
  deckCount: number;
  discardCount: number;
  /** Private Made in a Lab offer; null for every non-active viewer. */
  labCard: KingOfTokyoMarketCard | null;
  startRolls: Record<string, number | null>;
  startingRollContenders: string[];
  winnerId: string | null;
  victoryType: KingOfTokyoVictoryType | null;
  terminationReason: 'no_players_remaining' | null;
  log: KingOfTokyoLogEntry[];
}

export type KingOfTokyoActionKind =
  | 'start_game' | 'roll_for_first' | 'roll' | 'set_kept' | 'resolve_dice'
  | 'resolve_dice_results' | 'allocate_hearts' | 'psychic_probe' | 'yield_tokyo'
  | 'freeze_time' | 'defense' | 'choose_death_from_above_target' | 'buy_card'
  | 'sweep_market' | 'opportunist' | 'buy_lab_card' | 'use_card' | 'sell_card'
  | 'buy_owned_card' | 'preferences' | 'end_turn' | 'resolve_end_turn_effect';

export interface KingOfTokyoActionPayload {
  expectedRevision: number;
}

export interface KingOfTokyoFirstRollPayload extends KingOfTokyoActionPayload {
  rollOffRound: number;
}

export interface KingOfTokyoResolveDiceResultsPayload
  extends KingOfTokyoActionPayload, KingOfTokyoDiceResolutionPlan {}

export interface KingOfTokyoHeartAllocationPayload
  extends KingOfTokyoActionPayload, KingOfTokyoHeartAllocation {}

export interface KingOfTokyoSetKeptPayload extends KingOfTokyoActionPayload {
  keptIndexes: number[];
}

export interface KingOfTokyoYieldPayload extends KingOfTokyoActionPayload {
  yieldTokyo: boolean;
}

export interface KingOfTokyoFreezeTimePayload extends KingOfTokyoActionPayload {
  accept: boolean;
}

export type KingOfTokyoDefensePayload = KingOfTokyoActionPayload & KingOfTokyoDefenseDecision;

export interface KingOfTokyoDeathFromAbovePayload extends KingOfTokyoActionPayload {
  targetPlayerId: string;
}

export interface KingOfTokyoBuyCardPayload extends KingOfTokyoActionPayload {
  marketIndex: number;
}

export interface KingOfTokyoUseCardPayload extends KingOfTokyoActionPayload {
  cardInstanceId: string;
  dieIndex?: number;
  face?: KingOfTokyoDieFace;
  targetPlayerId?: string;
  targetCardInstanceId?: string;
}

export interface KingOfTokyoCardInstancePayload extends KingOfTokyoActionPayload {
  cardInstanceId: string;
}

export interface KingOfTokyoBuyOwnedCardPayload extends KingOfTokyoActionPayload {
  ownerPlayerId: string;
  cardInstanceId: string;
}

export interface KingOfTokyoPreferencePayload extends KingOfTokyoActionPayload {
  defenseMode?: KingOfTokyoDefenseMode;
  rapidHealingMode?: KingOfTokyoDefenseMode;
  tokenPreference?: KingOfTokyoTokenPreference;
}

export interface KingOfTokyoPsychicProbePayload extends KingOfTokyoActionPayload {
  dieIndex: number | null;
}

export interface KingOfTokyoOpportunistPayload extends KingOfTokyoActionPayload {
  buy: boolean;
}

export interface KingOfTokyoEndTurnEffectPayload extends KingOfTokyoActionPayload {
  effectId: KingOfTokyoEndTurnEffectKind;
}
