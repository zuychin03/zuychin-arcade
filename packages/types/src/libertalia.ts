export type LibertaliaPhase = 'selection' | 'daytime' | 'dusk' | 'night' | 'anchor' | 'effect_choice' | 'game_over';
export type LibertaliaAbilityPhase = 'daytime' | 'dusk' | 'night' | 'anchor';
export type LibertaliaLoot = 'map' | 'barrel' | 'amulet' | 'chest' | 'hook' | 'saber' | 'relic';
export interface LibertaliaCrewDefinition { rank:number; name:string; phases:LibertaliaAbilityPhase[]; summary:string; }
export interface LibertaliaLootToken { id:number; kind:LibertaliaLoot; }
export interface LibertaliaPublicPlayer { playerId:string; displayName:string; forfeited:boolean; reputation:number; reputationValue:number; doubloons:number; score:number; handCount:number; ship:number[]; loot:LibertaliaLootToken[]; ready:boolean; graveyardCount:number; }
export interface LibertaliaIslandCard { id:string; playerId:string|null; rank:number; name:string; neutral:boolean; }
export interface LibertaliaReputationToken { tokenId:string; playerId:string|null; displayName:string; active:boolean; position:number; value:number; }
export type LibertaliaChoiceKind = 'hand_character'|'ship_character'|'graveyard_character'|'island_character'|'loot_current'|'loot_ship'|'loot_swap'|'player'|'ability'|'hook_option';
export interface LibertaliaChoiceOption { id:string; label:string; detail?:string; playerId?:string; rank?:number; lootId?:number; }
export interface LibertaliaPendingChoice { id:number; playerId:string; kind:LibertaliaChoiceKind; prompt:string; optional:boolean; min:number; max:number; options:LibertaliaChoiceOption[]; }
export interface LibertaliaPublicState { gameId:'libertalia'; roomCode:string; rulesVersion:string; revision:number; status:'playing'|'game_over'; phase:LibertaliaPhase; voyage:1|2|3; day:number; daysInVoyage:number; voyagePlayerCount:number; turnOrder:string[]; players:LibertaliaPublicPlayer[]; reputationTrack:LibertaliaReputationToken[]; island:LibertaliaIslandCard[]; currentLoot:LibertaliaLootToken[]; lootDays:LibertaliaLootToken[][]; pendingPlayerId:string|null; pendingKind:LibertaliaChoiceKind|null; pendingPrompt:string|null; winnerPlayerIds:string[]; endReason:'score'|'forfeit'|null; log:Array<{id:number;text:string}>; }
export interface LibertaliaPrivateState { gameId:'libertalia'; roomCode:string; revision:number; playerId:string; hand:number[]; graveyard:number[]; selectedRank:number|null; canSelect:boolean; pendingChoice:LibertaliaPendingChoice|null; }
export type LibertaliaActionKind = 'start'|'select'|'choice'|'loot';
export interface LibertaliaSelectPayload { rank:number; expectedRevision:number; }
export interface LibertaliaChoicePayload { choiceId:number; optionIds:string[]; expectedRevision:number; }
/** @deprecated The choice endpoint supersedes index-based loot selection. */
export interface LibertaliaLootPayload { lootIndex:number; expectedRevision:number; }
