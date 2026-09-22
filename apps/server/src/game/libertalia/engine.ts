import {
  LIBERTALIA_CREW, LIBERTALIA_LOOT_COUNTS, LIBERTALIA_MAX_PLAYERS, LIBERTALIA_MIN_PLAYERS,
  LIBERTALIA_RULES_VERSION, type LibertaliaChoiceOption, type LibertaliaLoot,
  type LibertaliaLootToken, type LibertaliaPendingChoice, type LibertaliaPhase,
} from '@zuychin-arcade/types';

export type LibertaliaResult={ok:true}|{ok:false;reason:string};
const OK:LibertaliaResult={ok:true};
const fail=(reason:string):LibertaliaResult=>({ok:false,reason});
export type LibertaliaRng=()=>number;
type IslandCard={id:string;playerId:string|null;rank:number;neutral:boolean};
type Task={label:string;run:()=>void};
type OrderedAbility={id:string;label:string;rank?:number;available?:()=>boolean;run:()=>void};
type InternalChoice=LibertaliaPendingChoice&{resolve:(ids:string[])=>LibertaliaResult;cancelForfeit?:()=>void};

export interface LibertaliaServerPlayer{
  playerId:string;displayName:string;doubloons:number;score:number;hand:number[];selectedRank:number|null;
  ship:number[];graveyard:number[];loot:LibertaliaLootToken[];keptRanks:Set<number>;anchorDebt:number;forfeited:boolean;dealtRanks:number[];
}
export interface LibertaliaServerState{
  gameId:'libertalia';roomCode:string;rulesVersion:string;revision:number;status:'playing'|'game_over';phase:LibertaliaPhase;
  voyage:1|2|3;day:number;daysInVoyage:number;voyagePlayerCount:number;turnOrder:string[];players:Map<string,LibertaliaServerPlayer>;endReason:'score'|'forfeit'|null;settlementPhase:'day'|'anchor';
  reputationTrack:string[];inactiveReputation:Map<string,string>;undealtCrew:number[];island:IslandCard[];
  lootBag:LibertaliaLootToken[];lootDays:LibertaliaLootToken[][];pendingChoice:InternalChoice|null;queue:Task[];
  daytimeResolved:Set<string>;duskProcessed:Set<string>;midshipmanLeftId:string|null;nightNymphOwners:string[];nightCopiedPrisoners:Set<string>;winnerPlayerIds:string[];log:Array<{id:number;text:string}>;
  logSeq:number;choiceSeq:number;cardSeq:number;lootSeq:number;rng:LibertaliaRng;
}

const repValues=[12,11,10,9,8,7] as const;
const shuffle=<T>(xs:readonly T[],rng:LibertaliaRng)=>{const a=[...xs];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j]!,a[i]!];}return a;};
const note=(s:LibertaliaServerState,text:string)=>{s.log.push({id:++s.logSeq,text});if(s.log.length>80)s.log.shift();};
const crew=(rank:number)=>LIBERTALIA_CREW[rank-1]!;
const player=(s:LibertaliaServerState,id:string)=>s.players.get(id)!;
const activePlayers=(s:LibertaliaServerState)=>s.turnOrder.map(id=>player(s,id));
const selectionsReady=(s:LibertaliaServerState)=>activePlayers(s).every(p=>p.hand.length===0||p.selectedRank!==null);
const repPosition=(s:LibertaliaServerState,id:string)=>s.reputationTrack.indexOf(id);
export const libertaliaReputationPosition=repPosition;
const gain=(p:LibertaliaServerPlayer,n:number)=>{if(n>=0){const service=Math.min(p.anchorDebt,n);p.anchorDebt-=service;p.doubloons+=n-service;}else p.doubloons=Math.max(0,p.doubloons+n);};
const anchorPay=(p:LibertaliaServerPlayer,n:number)=>{const paid=Math.min(p.doubloons,n);p.doubloons-=paid;p.anchorDebt+=n-paid;};
function changeRep(s:LibertaliaServerState,p:LibertaliaServerPlayer,delta:number){
  if(!delta)return;const token=p.playerId;const from=repPosition(s,token);if(from<0)return;
  s.reputationTrack.splice(from,1);const raw=from+delta;const to=Math.max(0,Math.min(5,raw));s.reputationTrack.splice(to,0,token);
  const overflow=delta>0?Math.max(0,raw-5):Math.min(0,raw);
  if(overflow)gain(p,overflow); // overflow reputation is +/- one doubloon per step
}
function moveRepTo(s:LibertaliaServerState,p:LibertaliaServerPlayer,to:number){const from=repPosition(s,p.playerId);changeRep(s,p,to-from);return Math.abs(to-from);}
const sortIsland=(s:LibertaliaServerState)=>s.island.sort((a,b)=>a.rank-b.rank||(a.playerId&&b.playerId?repPosition(s,a.playerId)-repPosition(s,b.playerId):0));
function insertIsland(s:LibertaliaServerState,card:IslandCard){
  const index=s.island.findIndex(other=>other.rank>card.rank||(other.rank===card.rank&&other.playerId&&card.playerId&&repPosition(s,other.playerId)>repPosition(s,card.playerId)));
  s.island.splice(index<0?s.island.length:index,0,card);
}
function captureMidshipmanLeft(s:LibertaliaServerState){const i=s.island.findIndex(c=>c.neutral);s.midshipmanLeftId=i>0?s.island[i-1]!.id:null;}
const removeRank=(xs:number[],rank:number)=>{const i=xs.indexOf(rank);if(i>=0)xs.splice(i,1);return i>=0;};
function discardShip(s:LibertaliaServerState,p:LibertaliaServerPlayer,rank:number){if(removeRank(p.ship,rank)){p.keptRanks.delete(rank);p.graveyard.push(rank);return true;}return false;}
function discardIsland(s:LibertaliaServerState,id:string){const i=s.island.findIndex(c=>c.id===id);if(i<0)return null;const [c]=s.island.splice(i,1);if(c?.playerId)player(s,c.playerId).graveyard.push(c.rank);return c??null;}
const optionCrew=(p:LibertaliaServerPlayer,rank:number,where:string):LibertaliaChoiceOption=>({id:`${where}:${p.playerId}:${rank}`,label:`#${rank} ${crew(rank).name}`,playerId:p.playerId,rank});
const optionLoot=(p:LibertaliaServerPlayer,t:LibertaliaLootToken,where:string):LibertaliaChoiceOption=>({id:`${where}:${p.playerId}:${t.id}`,label:t.kind.toUpperCase(),playerId:p.playerId,lootId:t.id});
function setChoice(s:LibertaliaServerState,config:Omit<LibertaliaPendingChoice,'id'>,resolve:(ids:string[])=>LibertaliaResult){
  s.phase='effect_choice';s.pendingChoice={...config,id:++s.choiceSeq,resolve};
}
function process(s:LibertaliaServerState){let guard=0;while(!s.pendingChoice&&s.queue.length&&s.status==='playing'){if(++guard>10000)throw new Error('Libertalia task loop');s.queue.shift()!.run();}}
const enqueue=(s:LibertaliaServerState,label:string,run:()=>void)=>s.queue.push({label,run});
const prepend=(s:LibertaliaServerState,label:string,run:()=>void)=>s.queue.unshift({label,run});
function chooseOne(s:LibertaliaServerState,p:LibertaliaServerPlayer,kind:LibertaliaPendingChoice['kind'],prompt:string,options:LibertaliaChoiceOption[],optional:boolean,onPick:(o:LibertaliaChoiceOption|null)=>void){
  if(!options.length){onPick(null);return;}
  setChoice(s,{playerId:p.playerId,kind,prompt,optional,min:optional?0:1,max:1,options},ids=>{const picked=ids.length?options.find(o=>o.id===ids[0]):null;if(!picked&&!optional)return fail('Choose one legal option');onPick(picked??null);return OK;});
}
function scheduleOrdered(s:LibertaliaServerState,p:LibertaliaServerPlayer,prompt:string,items:OrderedAbility[],done:()=>void){
  items=items.filter(item=>!item.available||item.available());
  if(!items.length||(p.forfeited&&s.settlementPhase==='anchor')){done();return;}if(items.length===1){prepend(s,`finish ${prompt}`,done);prepend(s,items[0]!.label,()=>{if(!p.forfeited||s.settlementPhase!=='anchor')items[0]!.run();});return;}
  chooseOne(s,p,'ability',prompt,items.map(x=>({id:x.id,label:x.label,...(x.rank?{rank:x.rank,playerId:p.playerId}: {})})),false,o=>{const selected=items.find(x=>x.id===o!.id)!;prepend(s,`continue ${prompt}`,()=>scheduleOrdered(s,p,prompt,items.filter(x=>x!==selected),done));prepend(s,selected.label,()=>{if(!p.forfeited||s.settlementPhase!=='anchor')selected.run();});});
  if(s.pendingChoice)s.pendingChoice.cancelForfeit=done;
}
function drawBagLoot(s:LibertaliaServerState){if(!s.lootBag.length)return undefined;return s.lootBag.splice(Math.floor(s.rng()*s.lootBag.length),1)[0];}

function resolveLootDusk(s:LibertaliaServerState,p:LibertaliaServerPlayer,t:LibertaliaLootToken){
  if(t.kind==='barrel'){changeRep(s,p,1);note(s,`${p.displayName} gains 1 reputation from a barrel.`);return;}
  if(t.kind!=='saber')return;
  const targets=s.island.filter(c=>!c.neutral&&c.playerId!==p.playerId).map(c=>({id:c.id,label:`#${c.rank} ${crew(c.rank).name} — ${player(s,c.playerId!).displayName}`,playerId:c.playerId!,rank:c.rank}));
  chooseOne(s,p,'island_character','Saber: discard another player’s island character.',targets,false,o=>{if(o){const c=discardIsland(s,o.id);if(c)note(s,`${p.displayName}'s saber discards ${crew(c.rank).name}.`);}});
}
function gainLoot(s:LibertaliaServerState,p:LibertaliaServerPlayer,t:LibertaliaLootToken){p.loot.push(t);note(s,`${p.displayName} gains ${t.kind}.`);}
function takeCurrentLoot(s:LibertaliaServerState,p:LibertaliaServerPlayer,prompt:string,onTaken:(t:LibertaliaLootToken|null)=>void){
  const row=s.lootDays[s.day-1]??[];chooseOne(s,p,'loot_current',prompt,row.map(t=>optionLoot(p,t,'day')),false,o=>{if(!o){onTaken(null);return;}const i=row.findIndex(t=>t.id===o.lootId);if(i<0){onTaken(null);return;}const [t]=row.splice(i,1);gainLoot(s,p,t!);onTaken(t!);});
}
function duskAbilities(s:LibertaliaServerState,p:LibertaliaServerPlayer,card:IslandCard,t:LibertaliaLootToken|null,done:()=>void){
  const items:Array<{id:string;label:string;run:()=>void}>=[];
  if(t&&(t.kind==='barrel'||t.kind==='saber'))items.push({id:`loot:${t.id}`,label:`Resolve ${t.kind}`,run:()=>resolveLootDusk(s,p,t)});
  if(card.rank===10&&t?.kind==='map')items.push({id:'crew:10',label:'Explorer: gain 2 reputation',run:()=>changeRep(s,p,2)});
  if(card.rank===26)items.push({id:'crew:26',label:'Cook: gain a second loot token',run:()=>{if(!s.island.some(c=>c.id===card.id))return;takeCurrentLoot(s,p,'Cook: choose a second loot token.',second=>{if(second)resolveLootDusk(s,p,second);});}});
  if(card.rank===28&&(t?.kind==='saber'||t?.kind==='hook'))items.push({id:'crew:28',label:'Armorer: gain 2 reputation',run:()=>changeRep(s,p,2)});
  scheduleOrdered(s,p,'Choose the next dusk ability to resolve.',items,done);
}

function runCrewDay(s:LibertaliaServerState,card:IslandCard,copiedRank?:number){
  if(!card.playerId)return;const p=player(s,card.playerId),rank=copiedRank??card.rank,copied=copiedRank!==undefined;
  switch(rank){
    case 1: if(copied)discardShip(s,p,1);else discardIsland(s,card.id);chooseOne(s,p,'hand_character','Scout: choose another character to play.',p.hand.map(r=>optionCrew(p,r,'hand')),false,o=>{if(o&&removeRank(p.hand,o.rank!)){insertIsland(s,{id:`c${++s.cardSeq}`,playerId:p.playerId,rank:o.rank!,neutral:false});captureMidshipmanLeft(s);}});break;
    case 2:{const opts=p.ship.filter(r=>crew(r).phases.includes('daytime')).map(r=>optionCrew(p,r,'ship'));chooseOne(s,p,'ship_character','Apprentice: choose a daytime ability in your ship.',opts,false,o=>{if(o)runCrewDay(s,card,o.rank);});break;}
    case 3:{const right=s.island.at(-1);if(right?.playerId){const q=player(s,right.playerId),paid=Math.min(2,q.doubloons);q.doubloons-=paid;p.doubloons+=paid;changeRep(s,q,1);}break;}
    case 4: chooseOne(s,p,'ship_character','Innkeeper: return a ship character to your hand.',p.ship.map(r=>optionCrew(p,r,'ship')),false,o=>{if(o&&removeRank(p.ship,o.rank!)){p.keptRanks.delete(o.rank!);p.hand.push(o.rank!);}});break;
    case 5:if(!copied&&s.island[0]?.id===card.id)gain(p,3);break;
    case 6:{const moved=moveRepTo(s,p,0);gain(p,moved);break;}
    case 7:chooseOne(s,p,'loot_ship','Preacher: keep one loot token and discard the rest.',p.loot.map(t=>optionLoot(p,t,'ship')),false,o=>{if(!o)return;const discarded=p.loot.filter(t=>t.id!==o.lootId);p.loot=p.loot.filter(t=>t.id===o.lootId);s.lootBag.push(...discarded);changeRep(s,p,discarded.length);});break;
    case 9:{const t=drawBagLoot(s);if(t){gainLoot(s,p,t);resolveLootDusk(s,p,t);}if(copied)discardShip(s,p,9);else discardIsland(s,card.id);break;}
    case 11:gain(p,-Math.floor(p.doubloons/2));break;
    case 12:if(p.doubloons>=12)changeRep(s,p,2);else gain(p,12-p.doubloons);break;
    case 13:takeCurrentLoot(s,p,'Smuggler: choose loot from today.',t=>{if(t)resolveLootDusk(s,p,t);if(card.rank===13&&s.island.some(c=>c.id===card.id)){s.island=s.island.filter(c=>c.id!==card.id);p.ship.push(13);}});break;
    case 14:{const row=s.lootDays[s.day-1]??[],removed=row.filter(t=>t.kind==='saber'||t.kind==='hook');s.lootDays[s.day-1]=row.filter(t=>t.kind!=='saber'&&t.kind!=='hook');s.lootBag.push(...removed);gain(p,removed.length*2);break;}
    case 17:{const right=s.island.at(-1);if(right&&!right.neutral){const owner=player(s,right.playerId!);discardIsland(s,right.id);changeRep(s,owner,1);}break;}
    case 18:{const opts=activePlayers(s).flatMap(q=>q.ship.map(r=>optionCrew(q,r,'ship')));chooseOne(s,p,'ship_character','Gunner: choose any ship character to discard.',opts,false,o=>{if(!o)return;const q=player(s,o.playerId!);if(discardShip(s,q,o.rank!))changeRep(s,p,q===p?1:-1);});break;}
    case 19:{chooseOne(s,p,'loot_ship','Necromancer: discard a relic token.',p.loot.filter(t=>t.kind==='relic').map(t=>optionLoot(p,t,'ship')),false,o=>{if(!o)return;const i=p.loot.findIndex(t=>t.id===o.lootId);if(i>=0)s.lootBag.push(...p.loot.splice(i,1));chooseOne(s,p,'graveyard_character','Necromancer: return a character to your ship.',p.graveyard.map(r=>optionCrew(p,r,'grave')),false,c=>{if(c&&removeRank(p.graveyard,c.rank!))p.ship.push(c.rank!);});});break;}
    case 21:gain(p,p.ship.filter(r=>r<21).length*2);break;
    case 22:{const opts=activePlayers(s).filter(q=>q!==p&&q.ship.includes(22)).map(q=>optionCrew(q,22,'ship'));chooseOne(s,p,'ship_character','Brawler: discard an opponent’s Brawler.',opts,false,o=>{if(o&&discardShip(s,player(s,o.playerId!),22))changeRep(s,p,2);});break;}
    case 23:{const i=s.turnOrder.indexOf(p.playerId),neighborIds=[s.turnOrder[(i-1+s.turnOrder.length)%s.turnOrder.length]!,s.turnOrder[(i+1)%s.turnOrder.length]!];const opts=[...new Set(neighborIds)].flatMap(id=>player(s,id).loot.map(t=>optionLoot(player(s,id),t,'ship')));chooseOne(s,p,'loot_ship','Thief: take loot from an adjacent player.',opts,false,o=>{if(!o)return;const q=player(s,o.playerId!),idx=q.loot.findIndex(t=>t.id===o.lootId);if(idx>=0){p.loot.push(...q.loot.splice(idx,1));changeRep(s,p,-2);}});break;}
    case 25:chooseOne(s,p,'hand_character','Recruiter: choose a hand character for your ship.',p.hand.map(r=>optionCrew(p,r,'hand')),false,o=>{if(o&&removeRank(p.hand,o.rank!))p.ship.push(o.rank!);});break;
    case 27:{const today=s.lootDays[s.day-1]??[],tomorrow=s.lootDays[s.day]??[];const pairs=today.flatMap(a=>tomorrow.map(b=>({a,b,id:`swap:${a.id}:${b.id}`})));const opts=pairs.map(({a,b,id})=>({id,label:`Today: ${a.kind} → tomorrow; tomorrow: ${b.kind} → today`,lootId:a.id}));chooseOne(s,p,'loot_swap','Watchman: swap today’s loot with tomorrow’s.',opts,false,o=>{if(!o)return;const pair=pairs.find(x=>x.id===o.id)!;const a=today.findIndex(t=>t.id===pair.a.id),b=tomorrow.findIndex(t=>t.id===pair.b.id);if(a>=0&&b>=0)[today[a],tomorrow[b]]=[tomorrow[b]!,today[a]!];});break;}
    case 29:if(!copied&&s.island.at(-1)?.id===card.id)gain(p,5);break;
    case 30:{const groups=[...new Set(p.loot.map(t=>t.kind))].flatMap(kind=>[1,2,3].filter(n=>p.loot.filter(t=>t.kind===kind).length>=n).map(n=>({id:`merchant:${kind}:${n}`,label:`Discard ${n} ${kind}${n>1?'s':''} for ${n*n} doubloons`,kind,n})));chooseOne(s,p,'loot_ship','Merchant: trade identical loot.',groups.map(({id,label})=>({id,label})),false,o=>{if(!o)return;const {kind,n}=groups.find(g=>g.id===o.id)!;for(let k=0;k<n;k++){const idx=p.loot.findIndex(t=>t.kind===kind);if(idx>=0)s.lootBag.push(...p.loot.splice(idx,1));}gain(p,n*n);});break;}
    case 31:chooseOne(s,p,'graveyard_character','Surgeon: privately return a graveyard character.',p.graveyard.map(r=>optionCrew(p,r,'grave')),false,o=>{if(o&&removeRank(p.graveyard,o.rank!))p.hand.push(o.rank!);});break;
    case 33:gain(p,-p.loot.length);break;
    case 34:changeRep(s,p,2);break;
    case 36:gain(p,p.loot.length);break;
    case 38:gain(p,-p.ship.length);break;
    case 39:{const moved=moveRepTo(s,p,5);gain(p,-moved);break;}
    case 40:{const n=p.ship.length;[...p.ship].forEach(r=>discardShip(s,p,r));changeRep(s,p,n);break;}
  }
}

function daytimeNext(s:LibertaliaServerState){
  s.phase='daytime';const card=s.island.find(c=>!c.neutral&&!s.daytimeResolved.has(c.id));
  if(!card){beginDusk(s);return;}s.daytimeResolved.add(card.id);runCrewDay(s,card);enqueue(s,'next daytime character',()=>daytimeNext(s));
}
function finishDuskCard(s:LibertaliaServerState,card:IslandCard){const i=s.island.findIndex(c=>c.id===card.id);if(i>=0&&card.playerId){s.island.splice(i,1);player(s,card.playerId).ship.push(card.rank);}duskNext(s);}
function duskNext(s:LibertaliaServerState){
  s.phase='dusk';const card=[...s.island].reverse().find(c=>!s.duskProcessed.has(c.id));
  if(!card){const row=s.lootDays[s.day-1]??[];s.lootBag.push(...row.splice(0));beginNight(s);return;}s.duskProcessed.add(card.id);
  if(card.neutral){const left=s.island.find(c=>c.id===s.midshipmanLeftId);if(!left?.playerId||(s.lootDays[s.day-1]?.length??0)===0){duskNext(s);return;}const chooser=s.turnOrder.find(id=>id!==left.playerId)!;takeCurrentLootForReturn(s,player(s,chooser),()=>duskNext(s));return;}
  const p=player(s,card.playerId!);if(card.rank===5){duskAbilities(s,p,card,null,()=>finishDuskCard(s,card));return;}
  takeCurrentLoot(s,p,'Choose a loot token from the island.',t=>duskAbilities(s,p,card,t,()=>finishDuskCard(s,card)));
}
function takeCurrentLootForReturn(s:LibertaliaServerState,p:LibertaliaServerPlayer,done:()=>void){const row=s.lootDays[s.day-1]??[];chooseOne(s,p,'loot_current','Midshipman: remove one loot token before the character to its left chooses.',row.map(t=>optionLoot(p,t,'day')),false,o=>{if(o){const i=row.findIndex(t=>t.id===o.lootId);if(i>=0){const [t]=row.splice(i,1);s.lootBag.push(t!);note(s,`${p.displayName} removes ${t!.kind} for the Midshipman.`);}}done();});}
function beginDusk(s:LibertaliaServerState){s.phase='dusk';s.duskProcessed.clear();duskNext(s);}

function runCrewNight(s:LibertaliaServerState,p:LibertaliaServerPlayer,rank:number){
  if(!p.ship.includes(rank))return;switch(rank){
    case 8:gain(p,1);break;
    case 15:{const opts=p.ship.filter(r=>r!==15&&crew(r).phases.includes('night')).map(r=>({...optionCrew(p,r,'ship'),...(r===20?{detail:'Commit this copied ability for the end of the night.'}:{})}));chooseOne(s,p,'ship_character','Witch: choose a night ability to copy.',opts,false,o=>{if(o?.rank===20){s.nightCopiedPrisoners.add(p.playerId);note(s,`${p.displayName} commits a copied Freed Prisoner ability for the end of the night.`);}else if(o)runCrewNight(s,p,o.rank!);});break;}
    case 16:{const low=Math.min(...p.ship);if(Number.isFinite(low))discardShip(s,p,low);gain(p,2);break;}
    case 22:gain(p,1);break;
    case 24:gain(p,4);gain(p,-p.ship.length);break;
    case 28:gain(p,p.loot.filter(t=>t.kind==='saber'||t.kind==='hook').length);break;
    case 37:if(s.nightNymphOwners.length===1)gain(p,2);else discardShip(s,p,37);break;
  }
}
function resolveFreedPrisoner(s:LibertaliaServerState,p:LibertaliaServerPlayer){
  const n=p.ship.filter(r=>r>20).length;gain(p,n);if(n>=3)discardShip(s,p,20);
  note(s,`${p.displayName} gains ${n} from Freed Prisoner at the end of the night.`);
}
function finishNightAbilities(s:LibertaliaServerState){
  let index=0;const next=()=>{if(index>=s.turnOrder.length){finishNight(s);return;}const p=player(s,s.turnOrder[index++]!);const items:OrderedAbility[]=[];
    if(p.ship.includes(20))items.push({id:'end:20',rank:20,label:'Freed Prisoner: end-of-night ability',available:()=>p.ship.includes(20),run:()=>resolveFreedPrisoner(s,p)});
    if(s.nightCopiedPrisoners.has(p.playerId))items.push({id:'end:copy:20',rank:20,label:'Witch: committed end-of-night Freed Prisoner copy',run:()=>{s.nightCopiedPrisoners.delete(p.playerId);resolveFreedPrisoner(s,p);}});
    scheduleOrdered(s,p,'Choose the next end-of-night ability.',items,next);
  };next();
}
function beginNight(s:LibertaliaServerState){s.phase='night';s.nightNymphOwners=activePlayers(s).filter(p=>p.ship.includes(37)).map(p=>p.playerId);s.nightCopiedPrisoners.clear();let index=0;const next=()=>{if(index>=s.turnOrder.length){finishNightAbilities(s);return;}const p=player(s,s.turnOrder[index++]!);p.anchorDebt=0;const items=p.ship.filter(r=>r!==20&&crew(r).phases.includes('night')).map(r=>({rank:r,id:`night:${r}`,label:`#${r} ${crew(r).name}`,available:()=>p.ship.includes(r),run:()=>runCrewNight(s,p,r)}));scheduleOrdered(s,p,'Choose the next night ability.',items,()=>{p.anchorDebt=0;next();});};next();}
function retireForfeited(s:LibertaliaServerState){
  for(const p of activePlayers(s).filter(p=>p.forfeited)){s.lootBag.push(...p.loot.splice(0));p.selectedRank=null;p.keptRanks.clear();p.anchorDebt=0;}
  s.turnOrder=s.turnOrder.filter(id=>!player(s,id).forfeited);
}
function finishNight(s:LibertaliaServerState){retireForfeited(s);if(s.day<s.daysInVoyage){s.day++;s.phase='selection';s.island=[];s.midshipmanLeftId=null;s.daytimeResolved.clear();s.duskProcessed.clear();for(const p of activePlayers(s))p.selectedRank=null;note(s,`Day ${s.day} begins.`);if(selectionsReady(s))reveal(s);return;}beginAnchor(s);}

function mapReward(count:number){let best=0;for(let triples=0;triples<=Math.floor(count/3);triples++)best=Math.max(best,triples*12+Math.floor((count-triples*3)/2)*7);return best;}
function runAnchorCrew(s:LibertaliaServerState,p:LibertaliaServerPlayer,rank:number){
  if(!p.ship.includes(rank))return;switch(rank){
    case 7:gain(p,6);break;case 8:gain(p,p.loot.filter(t=>t.kind==='barrel').length);break;case 10:{const maps=p.loot.filter(t=>t.kind==='map').length;gain(p,mapReward(maps+(maps?1:0)));break;}case 11:gain(p,10);break;
    case 15:if(p.ship.filter(r=>crew(r).phases.includes('night')).length===1){removeRank(p.ship,15);p.keptRanks.delete(15);p.hand.push(15);}break;
    case 32:gain(p,p.loot.filter(t=>t.kind==='barrel'||t.kind==='amulet'||t.kind==='chest').length);break;
    case 33:gain(p,6);break;case 34:{const owners=activePlayers(s).filter(q=>!q.forfeited&&q.ship.includes(34));if(owners.length===1)gain(p,5);else anchorPay(p,3);break;}
    case 35:{const n=new Set(p.loot.map(t=>t.kind)).size;gain(p,n>=5?10:n===4?5:n===3?3:n===2?1:0);break;}
    case 36:anchorPay(p,6);break;case 38:gain(p,p.ship.length);break;
  }
}
function anchorItems(s:LibertaliaServerState,p:LibertaliaServerPlayer){
  const items:Array<{rank?:number;id:string;label:string;run:()=>void}>=p.ship.filter(r=>crew(r).phases.includes('anchor')).map(r=>({rank:r,id:`anchor:crew:${r}`,label:`#${r} ${crew(r).name}`,run:()=>runAnchorCrew(s,p,r)}));
  const by=(k:LibertaliaLoot)=>p.loot.filter(t=>t.kind===k);
  if(by('chest').length)items.push({id:'anchor:chest',label:`Chests ×${by('chest').length}`,run:()=>gain(p,by('chest').length*5)});
  if(by('amulet').length)items.push({id:'anchor:amulet',label:`Amulets ×${by('amulet').length}`,run:()=>gain(p,by('amulet').length*3)});
  if(by('barrel').length)items.push({id:'anchor:barrel',label:`Barrels ×${by('barrel').length}`,run:()=>gain(p,by('barrel').length)});
  if(by('relic').length)items.push({id:'anchor:relic',label:`Relics ×${by('relic').length}`,run:()=>anchorPay(p,by('relic').length*3)});
  if(by('map').length&&!p.ship.includes(10)){const count=by('map').length;items.push({id:'anchor:map',label:`Maps (${count} counted)`,run:()=>gain(p,mapReward(count))});}
  for(const t of by('hook'))items.push({id:`anchor:hook:${t.id}`,label:'Hook: keep a character or gain 2',run:()=>{const canKeep=p.ship.some(r=>!p.keptRanks.has(r)),choices:LibertaliaChoiceOption[]=[{id:'coins',label:'Gain 2 doubloons'}];if(canKeep)choices.push({id:'keep',label:'Keep a ship character for the next voyage'});chooseOne(s,p,'hook_option','Hook: choose its anchor effect.',choices,false,o=>{if(o?.id==='coins')gain(p,2);else if(o){const opts=p.ship.filter(r=>!p.keptRanks.has(r)).map(r=>optionCrew(p,r,'ship'));chooseOne(s,p,'ship_character','Hook: choose a character to keep aboard.',opts,false,c=>{if(c)p.keptRanks.add(c.rank!);});}});}});
  return items;
}
function beginAnchor(s:LibertaliaServerState){s.phase='anchor';s.settlementPhase='anchor';let index=0;const next=()=>{if(index>=s.turnOrder.length){completeVoyage(s);return;}const p=player(s,s.turnOrder[index++]!);p.anchorDebt=0;scheduleOrdered(s,p,'Choose the next anchor ability.',anchorItems(s,p),()=>{p.anchorDebt=0;next();});};next();}
function completeVoyage(s:LibertaliaServerState){
  retireForfeited(s);
  for(const p of activePlayers(s)){if(!p.forfeited)p.score+=p.doubloons;p.doubloons=0;s.lootBag.push(...p.loot.splice(0));for(const rank of [...p.ship])if(!p.keptRanks.has(rank))discardShip(s,p,rank);p.keptRanks.clear();}
  if(s.voyage===3){const high=Math.max(...activePlayers(s).filter(p=>!p.forfeited).map(p=>p.score));const tied=activePlayers(s).filter(p=>!p.forfeited&&p.score===high);const best=Math.max(...tied.map(p=>repPosition(s,p.playerId)));s.winnerPlayerIds=tied.filter(p=>repPosition(s,p.playerId)===best).map(p=>p.playerId);s.status='game_over';s.phase='game_over';s.endReason='score';note(s,'The richest admiral wins Libertalia.');return;}
  s.voyage=(s.voyage+1) as 2|3;setupVoyage(s);
}

function fillLootDays(s:LibertaliaServerState){s.lootDays=[];s.lootBag=shuffle(s.lootBag,s.rng);const per=s.voyagePlayerCount===2?3:s.voyagePlayerCount;for(let d=0;d<s.daysInVoyage;d++){const row:LibertaliaLootToken[]=[];for(let i=0;i<per;i++){if(!s.lootBag.length)throw new Error('Loot bag unexpectedly empty');row.push(s.lootBag.pop()!);}s.lootDays.push(row);}}
function setupVoyage(s:LibertaliaServerState){
  s.settlementPhase='day';s.daysInVoyage=s.voyage+3;s.day=1;s.voyagePlayerCount=s.turnOrder.length;const dealt=s.undealtCrew.splice(0,6);for(const p of activePlayers(s)){p.hand.push(...dealt);p.dealtRanks.push(...dealt);p.doubloons=repValues[repPosition(s,p.playerId)]!;p.selectedRank=null;p.anchorDebt=0;}
  fillLootDays(s);s.phase='selection';s.island=[];s.midshipmanLeftId=null;s.pendingChoice=null;s.queue=[];s.daytimeResolved.clear();s.duskProcessed.clear();note(s,`Voyage ${s.voyage} begins with ${s.daysInVoyage} days.`);
}
function reveal(s:LibertaliaServerState){
  s.island=[];for(const p of activePlayers(s)){const rank=p.selectedRank;if(rank===null)continue;removeRank(p.hand,rank);s.island.push({id:`c${++s.cardSeq}`,playerId:p.playerId,rank,neutral:false});}
  if(s.voyagePlayerCount===2)s.island.push({id:`midshipman:${s.voyage}:${s.day}`,playerId:null,rank:20.5,neutral:true});sortIsland(s);captureMidshipmanLeft(s);note(s,`The fleet reveals ${s.island.filter(c=>!c.neutral).map(c=>crew(c.rank).name).join(', ')}.`);s.daytimeResolved.clear();s.queue=[];enqueue(s,'first daytime character',()=>daytimeNext(s));process(s);
}
export function initLibertaliaGame(roomCode:string,bases:Array<{playerId:string;displayName:string}>,rng:LibertaliaRng=Math.random):LibertaliaServerState{
  if(bases.length<LIBERTALIA_MIN_PLAYERS||bases.length>LIBERTALIA_MAX_PLAYERS)throw new Error(`Libertalia requires ${LIBERTALIA_MIN_PLAYERS}-${LIBERTALIA_MAX_PLAYERS} players`);
  if(new Set(bases.map(p=>p.playerId)).size!==bases.length||bases.some(p=>!p.playerId||p.playerId.startsWith('inactive:')))throw new Error('Invalid player identity');
  const active=bases.map(b=>b.playerId),inactive=Array.from({length:6-active.length},(_,i)=>`inactive:${i}`);let track:string[];
  if(bases.length===2){const middle=shuffle(active,rng);track=shuffle(inactive,rng);track.splice(2,0,middle[0]!,middle[1]!);}else track=shuffle([...active,...inactive],rng);
  const lootKinds=Object.entries(LIBERTALIA_LOOT_COUNTS).flatMap(([kind,n])=>Array.from({length:n},()=>kind as LibertaliaLoot));let lootSeq=0;
  const state:LibertaliaServerState={gameId:'libertalia',roomCode,rulesVersion:LIBERTALIA_RULES_VERSION,revision:0,status:'playing',phase:'selection',voyage:1,day:1,daysInVoyage:4,voyagePlayerCount:bases.length,endReason:null,settlementPhase:'day',turnOrder:active,players:new Map(),reputationTrack:track,inactiveReputation:new Map(inactive.map((id,i)=>[id,`Inactive ${i+1}`])),undealtCrew:shuffle(Array.from({length:40},(_,i)=>i+1),rng),island:[],lootBag:shuffle(lootKinds.map(kind=>({id:++lootSeq,kind})),rng),lootDays:[],pendingChoice:null,queue:[],daytimeResolved:new Set(),duskProcessed:new Set(),midshipmanLeftId:null,nightNymphOwners:[],nightCopiedPrisoners:new Set(),winnerPlayerIds:[],log:[],logSeq:0,choiceSeq:0,cardSeq:0,lootSeq,rng};
  bases.forEach(b=>state.players.set(b.playerId,{...b,doubloons:0,score:0,hand:[],selectedRank:null,ship:[],graveyard:[],loot:[],keptRanks:new Set(),anchorDebt:0,forfeited:false,dealtRanks:[]}));setupVoyage(state);validateLibertalia(state);return state;
}
const stale=(s:LibertaliaServerState,r?:number)=>r!==undefined&&r!==s.revision;
export function selectLibertaliaCrew(s:LibertaliaServerState,id:string,rank:number,rev?:number):LibertaliaResult{if(stale(s,rev))return fail('State changed; refresh');const p=s.players.get(id);if(s.status!=='playing'||s.phase!=='selection'||!p||p.forfeited||!s.turnOrder.includes(id)||!p.hand.includes(rank))return fail('Choose a crew card from your hand');p.selectedRank=rank;s.revision++;if(selectionsReady(s))reveal(s);validateLibertalia(s);return OK;}
export function resolveLibertaliaChoice(s:LibertaliaServerState,id:string,choiceId:number,ids:string[],rev?:number):LibertaliaResult{
  if(stale(s,rev))return fail('State changed; refresh');if(s.status!=='playing'||s.players.get(id)?.forfeited)return fail('That seat cannot act');return resolveChoice(s,id,choiceId,ids);
}
function resolveChoice(s:LibertaliaServerState,id:string,choiceId:number,ids:string[]):LibertaliaResult{
  const c=s.pendingChoice;if(!c||c.playerId!==id||c.id!==choiceId)return fail('That choice is no longer available');if(!Array.isArray(ids)||ids.some(x=>typeof x!=='string'))return fail('Illegal choice');const unique=[...new Set(ids)];if(unique.length!==ids.length||unique.length<c.min||unique.length>c.max)return fail(`Choose ${c.min}-${c.max} distinct options`);if(unique.some(x=>!c.options.some(o=>o.id===x)))return fail('Illegal choice');
  s.pendingChoice=null;const result=c.resolve(unique);if(!result.ok){s.pendingChoice=c;return result;}s.revision++;process(s);validateLibertalia(s);return OK;
}
export function settleLibertaliaAutopilot(s:LibertaliaServerState):void{
  let guard=0;
  while(s.status==='playing'&&s.pendingChoice&&player(s,s.pendingChoice.playerId).forfeited){
    if(++guard>1000)throw new Error('Forfeit settlement failed to progress');
    const c=s.pendingChoice;
    const result=resolveChoice(s,c.playerId,c.id,c.options.slice(0,c.min).map(o=>o.id));
    if(!result.ok)throw new Error(result.reason);
  }
}
export function forfeitLibertaliaPlayers(s:LibertaliaServerState,ids:string[],revision:number):LibertaliaResult{
  if(stale(s,revision))return fail('State changed; refresh');
  if(s.status==='game_over')return OK;
  if(!Array.isArray(ids)||ids.some(id=>!s.players.has(id)))return fail('Unknown player');
  const departing=[...new Set(ids)].map(id=>player(s,id)).filter(p=>!p.forfeited);
  if(!departing.length)return OK;
  for(const p of departing){p.forfeited=true;note(s,`${p.displayName} forfeits eligibility.`);}
  s.revision++;
  const eligible=activePlayers(s).filter(p=>!p.forfeited);
  if(eligible.length<=1){s.status='game_over';s.phase='game_over';s.endReason='forfeit';s.winnerPlayerIds=eligible.map(p=>p.playerId);s.pendingChoice=null;s.queue=[];note(s,eligible.length?'The remaining admiral wins by forfeit.':'No eligible admirals remain.');}
  else if(s.phase==='selection'){retireForfeited(s);if(selectionsReady(s))reveal(s);}
  else {if(s.settlementPhase==='anchor'&&s.pendingChoice&&player(s,s.pendingChoice.playerId).forfeited){const cancelled=s.pendingChoice;s.pendingChoice=null;cancelled.cancelForfeit?.();process(s);}settleLibertaliaAutopilot(s);}
  validateLibertalia(s);return OK;
}
/** Compatibility for clients still sending an index during rolling deployment. */
export function chooseLibertaliaLoot(s:LibertaliaServerState,id:string,index:number,rev?:number):LibertaliaResult{const c=s.pendingChoice;if(!c||c.kind!=='loot_current')return fail('It is not your loot choice');const o=c.options[index];return o?resolveLibertaliaChoice(s,id,c.id,[o.id],rev):fail('Choose available loot');}
export function validateLibertalia(s:LibertaliaServerState){
  if(s.reputationTrack.length!==6||new Set(s.reputationTrack).size!==6)throw new Error('Reputation track must contain six unique tokens');
  if(!Number.isSafeInteger(s.revision)||s.revision<0)throw new Error('Invalid revision');
  if(new Set(s.turnOrder).size!==s.turnOrder.length||s.turnOrder.some(id=>!s.players.has(id)))throw new Error('Invalid active order');
  if(!Number.isInteger(s.voyagePlayerCount)||s.voyagePlayerCount<2||s.voyagePlayerCount>6||s.turnOrder.length>s.voyagePlayerCount)throw new Error('Invalid voyage setup');
  if(s.lootDays.length!==s.daysInVoyage||s.day<1||s.day>s.daysInVoyage)throw new Error('Invalid voyage days');
  const canonicalRank=(r:number)=>Number.isInteger(r)&&r>=1&&r<=40;
  if(s.undealtCrew.some(r=>!canonicalRank(r))||new Set(s.undealtCrew).size!==s.undealtCrew.length||s.undealtCrew.length!==40-s.voyage*6)throw new Error('Invalid undealt crew');
  for(const p of s.players.values()){
    if([p.doubloons,p.score,p.anchorDebt].some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('Invalid wealth');
    if(repPosition(s,p.playerId)<0)throw new Error('Missing reputation token');
    const cards=[...p.hand,...p.ship,...p.graveyard,...s.island.filter(c=>c.playerId===p.playerId).map(c=>c.rank)];
    if(cards.some(r=>!canonicalRank(r))||new Set(cards).size!==cards.length||new Set(p.dealtRanks).size!==p.dealtRanks.length||cards.length!==p.dealtRanks.length||cards.some(r=>!p.dealtRanks.includes(r))||p.dealtRanks.some(r=>s.undealtCrew.includes(r)))throw new Error('Crew conservation failed');
    if([...p.keptRanks].some(r=>!p.ship.includes(r)))throw new Error('Kept crew missing');
    if(!s.turnOrder.includes(p.playerId)&&(!p.forfeited||p.selectedRank!==null||p.loot.length))throw new Error('Invalid retired seat');
    if(s.phase==='selection'&&p.selectedRank!==null&&!p.hand.includes(p.selectedRank))throw new Error('Selection missing from hand');
  }
  if(new Set(s.island.map(c=>c.id)).size!==s.island.length||s.island.some(c=>c.neutral?(c.rank!==20.5||c.playerId!==null||s.voyagePlayerCount!==2):(!c.playerId||!s.turnOrder.includes(c.playerId))))throw new Error('Invalid island');
  if(s.pendingChoice&&(!s.turnOrder.includes(s.pendingChoice.playerId)||s.phase!=='effect_choice'||!s.pendingChoice.options.length||new Set(s.pendingChoice.options.map(o=>o.id)).size!==s.pendingChoice.options.length))throw new Error('Invalid pending choice');
  if(s.status==='game_over'?(s.phase!=='game_over'||s.pendingChoice!==null||s.queue.length!==0||s.endReason===null):s.endReason!==null||s.winnerPlayerIds.length!==0)throw new Error('Invalid terminal state');
  if(s.winnerPlayerIds.some(id=>!s.players.has(id)||player(s,id).forfeited))throw new Error('Ineligible winner');
  const kinds=Object.entries(LIBERTALIA_LOOT_COUNTS).flatMap(([kind,n])=>Array.from({length:n},()=>kind));
  const loot=[...s.lootBag,...s.lootDays.flat(),...[...s.players.values()].flatMap(p=>p.loot)];
  if(loot.length!==kinds.length||new Set(loot.map(t=>t.id)).size!==loot.length||loot.some(t=>!Number.isInteger(t.id)||kinds[t.id-1]!==t.kind))throw new Error('Canonical loot conservation failed');
}
