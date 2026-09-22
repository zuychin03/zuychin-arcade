import type { ColtPrivateState, ColtPublicState } from '@zuychin-arcade/types';
import { canHideFirstAction, currentProgrammingPlayerId, finalColtScore, programmingActionNumber, type ColtServerState } from './engine.js';

export function toColtPublicState(s: ColtServerState): ColtPublicState {
  return {
    gameId: 'colt_express', roomCode: s.roomCode, rulesVersion: s.rulesVersion, revision: s.revision, status: s.status, phase: s.phase,
    endReason:s.endReason,turnOrder:[...s.turnOrder],initialPlayerCount:s.initialPlayerCount,twoBanditMode:s.twoBanditMode,
    programmingActionNumber:programmingActionNumber(s),
    round: s.round, slot: Math.min(s.slot,s.slots), slots: s.slots, turnType: s.currentRoundCard.turns[s.turnIndex] ?? null,
    roundCard: { ...s.currentRoundCard, turns: [...s.currentRoundCard.turns] }, firstPlayerId: s.phase==='character_selection'?null:s.turnOrder[s.firstIndex]!,
    availableCharacters:[...s.availableCharacters],
    programmingPlayerId: currentProgrammingPlayerId(s), teamSelectionPlayerId:s.phase==='team_selection'?s.turnOrder[(s.firstIndex+s.teamSelectionStep)%s.turnOrder.length]!:null,availableTeams:s.availableTeams.map(x=>[...x]),trainCars: s.trainCars, marshalCar: s.marshalCar,
    neutralBulletsRemaining: s.neutralBulletsRemaining,
    players: [...s.players.values()].map(p=>{const id=p.playerId,fired=p.bulletsFiredByBandit.reduce((a,n)=>a+n,0),loot=p.lootByBandit.flat();return {
      playerId:id,forfeited:p.forfeited,characterChosen:p.characterChosen,displayName:p.displayName,character:p.characterChosen?p.characters[0]!:null,characters:p.characterChosen?[...p.characters]:[],positions:!p.characterChosen||!p.setupComplete||s.phase==='character_selection'||s.phase==='team_selection'||s.phase==='team_setup'?[]:p.positions.map(x=>({...x})),
      lootCount:loot.length,lootCounts:p.lootByBandit.map(x=>x.length),lootValue:s.status==='game_over'?loot.reduce((a,x)=>a+x.value,0):null,
      gunslingerShots:s.status==='game_over'?p.gunslingerShots:null,
      finalScore:s.status==='game_over'?finalColtScore(s,id):null,
      bulletsFired:fired,bulletsRemaining:p.bulletsFiredByBandit.length*6-fired,receivedBullets:p.receivedBullets,handCount:p.hand.length,
      setupComplete:p.setupComplete,reserveComplete:p.reserveComplete,
    };}),
    lootBySpace:Object.fromEntries(Object.entries(s.lootBySpace).map(([space,loot])=>[space,loot.map(x=>({id:x.id,type:x.type,value:x.type==='purse'?null:x.value}))])),
    program:s.program.map((item,index)=>{const revealed=item.faceUp||index<s.executionIndex||(index===s.executionIndex&&s.phase==='pending_choice'&&!s.pendingEvent)||s.status==='game_over';return {playerId:item.playerId,ownerBandit:revealed?item.card.ownerBandit:null,action:revealed?item.card.action as Exclude<typeof item.card.action,'bullet'>:null,faceUp:revealed,cover:item.cover};}),
    executionIndex:s.executionIndex,pending:s.pending?{...s.pending,options:s.pending.options.map(x=>({...x}))}:null,
    winnerPlayerIds:[...s.winnerPlayerIds],log:s.log.map(x=>({...x})),
  };
}

export function toColtPrivateState(s: ColtServerState,id:string):ColtPrivateState{
  const p=s.players.get(id);if(!p)throw new Error('Missing player');
  const eligible = !p.forfeited && s.status === 'playing';
  return {gameId:'colt_express',roomCode:s.roomCode,revision:s.revision,playerId:id,hand:p.hand.map(x=>({...x})),reserveOptions:eligible&&s.phase==='reserve_card'&&!p.reserveComplete?p.deck.map(x=>({...x})):[],programmedCardIds:[...p.programmedCardIds],lootByBandit:p.lootByBandit.map(x=>x.map(y=>({...y}))),canChooseCharacter:eligible&&s.phase==='character_selection'&&!p.characterChosen,canAssignStart:eligible&&s.phase==='team_setup'&&!p.setupComplete,canChooseTeam:eligible&&s.phase==='team_selection'&&s.turnOrder[(s.firstIndex+s.teamSelectionStep)%s.turnOrder.length]===id,canReserve:eligible&&s.phase==='reserve_card'&&!p.reserveComplete,canProgram:eligible&&s.phase==='programming'&&currentProgrammingPlayerId(s)===id,canHideFirstAction:canHideFirstAction(s,p),canChoose:eligible&&s.phase==='pending_choice'&&s.pending?.playerId===id};
}
