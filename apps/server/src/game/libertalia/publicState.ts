import { LIBERTALIA_CREW, type LibertaliaPrivateState, type LibertaliaPublicState } from '@zuychin-arcade/types';
import { libertaliaReputationPosition, type LibertaliaServerState } from './engine.js';

export function toLibertaliaPublicState(s:LibertaliaServerState):LibertaliaPublicState{
  const values=[12,11,10,9,8,7];
  return {gameId:'libertalia',roomCode:s.roomCode,rulesVersion:s.rulesVersion,revision:s.revision,status:s.status,phase:s.phase,voyage:s.voyage,day:s.day,daysInVoyage:s.daysInVoyage,voyagePlayerCount:s.voyagePlayerCount,turnOrder:[...s.turnOrder],endReason:s.endReason,lootDays:s.lootDays.map(row=>row.map(t=>({...t}))),
    players:[...s.players.values()].map(p=>{const id=p.playerId,position=libertaliaReputationPosition(s,id);return{playerId:id,displayName:p.displayName,forfeited:p.forfeited,reputation:position,reputationValue:values[position]!,doubloons:p.doubloons,score:p.score,handCount:p.hand.length,ship:[...p.ship],loot:p.loot.map(t=>({...t})),ready:p.selectedRank!==null||(s.phase==='selection'&&p.hand.length===0),graveyardCount:p.graveyard.length};}),
    reputationTrack:s.reputationTrack.map((tokenId,position)=>{const p=s.players.get(tokenId);return{tokenId,playerId:p?.playerId??null,displayName:p?.displayName??s.inactiveReputation.get(tokenId)??'Inactive',active:!!p&&!p.forfeited,position,value:values[position]!};}),
    island:s.island.map(c=>({id:c.id,playerId:c.playerId,rank:c.rank,name:c.neutral?'Midshipman':LIBERTALIA_CREW[c.rank-1]!.name,neutral:c.neutral})),
    currentLoot:(s.lootDays[s.day-1]??[]).map(t=>({...t})),pendingPlayerId:s.pendingChoice?.playerId??null,pendingKind:s.pendingChoice?.kind??null,pendingPrompt:s.pendingChoice?.prompt??null,winnerPlayerIds:[...s.winnerPlayerIds],log:s.log.map(x=>({...x}))};
}
export function toLibertaliaPrivateState(s:LibertaliaServerState,id:string):LibertaliaPrivateState{
  const p=s.players.get(id);if(!p)throw new Error('Missing player');const eligible=s.status==='playing'&&!p.forfeited&&s.turnOrder.includes(id),c=eligible&&s.pendingChoice?.playerId===id?s.pendingChoice:null;
  return{gameId:'libertalia',roomCode:s.roomCode,revision:s.revision,playerId:id,hand:[...p.hand],graveyard:[...p.graveyard],selectedRank:p.selectedRank,canSelect:eligible&&s.phase==='selection'&&p.hand.length>0,pendingChoice:c?{id:c.id,playerId:c.playerId,kind:c.kind,prompt:c.prompt,optional:c.optional,min:c.min,max:c.max,options:c.options.map(o=>({...o}))}:null};
}
