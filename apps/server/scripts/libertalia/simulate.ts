import {forfeitLibertaliaPlayers,initLibertaliaGame,resolveLibertaliaChoice,selectLibertaliaCrew,settleLibertaliaAutopilot,validateLibertalia} from '../../src/game/libertalia/engine.js';
import {toLibertaliaPrivateState,toLibertaliaPublicState} from '../../src/game/libertalia/publicState.js';

let assertions=0;
const seenRanks=new Set<number>(),seenChoiceKinds=new Set<string>();let sawMidshipman=false;
const assert=(value:unknown,message:string)=>{assertions++;if(!value)throw new Error(message);};
const rngFor=(seed:number)=>{let x=seed|0;return()=>{x=(Math.imul(x,1664525)+1013904223)|0;return(x>>>0)/4294967296;};};

for(let count=2;count<=6;count++)for(let n=0;n<50;n++){
 const s=initLibertaliaGame(`SIM-${count}-${n}`,Array.from({length:count},(_,i)=>({playerId:`p${i}`,displayName:`P${i}`})),rngFor(count*1000+n));
 assert(s.reputationTrack.length===6,'Every game must use six reputation tokens');
 assert(new Set(s.reputationTrack).size===6,'Reputation tokens must stay unique');
 if(count===2){const active=s.reputationTrack.map((id,i)=>s.players.has(id)?i:-1).filter(i=>i>=0);assert(active[0]===2&&active[1]===3,'Two active tokens start in the middle spaces');}
 let guard=0;
 while(s.status==='playing'&&guard++<3000){
  validateLibertalia(s);
  s.island.forEach(c=>{if(c.neutral)sawMidshipman=true;else seenRanks.add(c.rank);});if(s.pendingChoice)seenChoiceKinds.add(s.pendingChoice.kind);
  if(s.phase==='selection'){
   for(const id of s.turnOrder){const p=s.players.get(id)!;if(p.selectedRank===null&&p.hand.length>0){const result=selectLibertaliaCrew(s,id,p.hand[(n+guard+p.hand.length)%p.hand.length]!,s.revision);if(!result.ok)throw new Error(result.reason);}}
  }else if(s.pendingChoice){
   const c=s.pendingChoice;
   // Exercise both optional passes and actual optional effects deterministically.
   const ids=c.optional&&(guard+n)%4===0?[]:c.options.length?[c.options[(guard+n)%c.options.length]!.id]:[];
   const result=resolveLibertaliaChoice(s,c.playerId,c.id,ids,s.revision);if(!result.ok)throw new Error(result.reason);
  }else throw new Error(`Libertalia stalled in ${s.phase}`);
 }
 assert(s.status==='game_over',`A simulated ${count}-player game must finish (seed ${n}, phase ${s.phase}, voyage ${s.voyage}, day ${s.day}, guard ${guard}, pending ${s.pendingChoice?.prompt??'none'}, queue ${s.queue.map(t=>t.label).join('|')})`);
 assert(s.winnerPlayerIds.length>0,'A completed game must have a winner');
 assert(s.undealtCrew.length===22,'Three voyages must deal exactly eighteen shared crew ranks');
}
assert(seenRanks.size===40,`Seeded regression matrix exercised ${seenRanks.size}/40 crew ranks`);
assert(sawMidshipman,'Seeded two-player games must exercise the neutral Midshipman');
assert(['hand_character','ship_character','graveyard_character','island_character','loot_current','loot_ship','loot_swap','ability','hook_option'].every(k=>seenChoiceKinds.has(k)),`Missing choice-kind coverage: ${[...seenChoiceKinds].join(', ')}`);
let departureGames=0,commands=0,forfeitTerminals=0;
for(let count=2;count<=6;count++)for(let seed=0;seed<40;seed++){
 const s=initLibertaliaGame(`DEPART-${count}-${seed}`,Array.from({length:count},(_,i)=>({playerId:`p${i}`,displayName:`P${i}`})),rngFor(21092026+count*100+seed));
 let departed=false,guard=0;const archived=new Map<string,string>();
 while(s.status==='playing'){
  assert(++guard<5000,`Departure campaign stalled ${count}/${seed}`);validateLibertalia(s);
  if(!departed&&guard>3+seed%30&&(seed%2===0?s.phase==='selection':!!s.pendingChoice)){
   const ids=seed%7===0?[...s.turnOrder]:seed%7===1?s.turnOrder.slice(1):[s.pendingChoice?.playerId??s.turnOrder.at(-1)!];
   assert(forfeitLibertaliaPlayers(s,ids,s.revision).ok,'Forfeit must settle');departed=true;
   if((s.status as string)==='game_over')break;
  }
  for(const p of s.players.values())if(!s.turnOrder.includes(p.playerId)){
   const snapshot=JSON.stringify(p,(_k,v)=>v instanceof Set?[...v]:v);
   if(archived.has(p.playerId))assert(archived.get(p.playerId)===snapshot,'Retired holdings must remain unchanged');else archived.set(p.playerId,snapshot);
   const mine=toLibertaliaPrivateState(s,p.playerId);assert(!mine.canSelect&&!mine.pendingChoice,'Forfeited private actions disabled');
  }
  const before=JSON.stringify(toLibertaliaPublicState(s));
  assert(!selectLibertaliaCrew(s,s.turnOrder[0]!,41,s.revision).ok,'Invalid crew rejected');
  assert(JSON.stringify(toLibertaliaPublicState(s))===before,'Invalid command must not mutate projection');
  if(s.phase==='selection'){
   const p=s.turnOrder.map(id=>s.players.get(id)!).find(p=>p.selectedRank===null&&p.hand.length>0)!;
   assert(selectLibertaliaCrew(s,p.playerId,p.hand[(guard+seed)%p.hand.length]!,s.revision).ok,'Live selection accepted');
  }else{
   const c=s.pendingChoice!;assert(c,`Pending decision required ${count}/${seed}, ${s.voyage}/${s.day}/${s.phase}/${s.settlementPhase}, queue=${s.queue.map(t=>t.label)}`);
   assert(resolveLibertaliaChoice(s,c.playerId,c.id,c.options.slice((guard+seed)%c.options.length,(guard+seed)%c.options.length+1).map(o=>o.id),s.revision).ok,'Live choice accepted');
  }
  commands++;settleLibertaliaAutopilot(s);
 }
 validateLibertalia(s);assert(departed,'Departure exercised');assert(s.winnerPlayerIds.every(id=>!s.players.get(id)!.forfeited),'Winner must remain eligible');
 if(s.endReason==='forfeit')forfeitTerminals++;departureGames++;
}
console.log(`LIBERTALIA SIM PASS: 250 normal complete games + ${departureGames} departure games (${forfeitTerminals} forfeit terminals), ${commands} departure commands, ${assertions} regression checks.`);
