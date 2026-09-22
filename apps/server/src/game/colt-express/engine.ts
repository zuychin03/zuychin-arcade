import {
  COLT_ACTION_COUNTS, COLT_CHARACTERS, COLT_MAX_PLAYERS, COLT_MIN_PLAYERS, COLT_RULES_VERSION,
  type ColtAction, type ColtCharacter, type ColtLevel, type ColtLoot, type ColtPendingChoice,
  type ColtPosition, type ColtRoundCard, type ColtRoundEvent, type ColtTurnType,
} from '@zuychin-arcade/types';

export type ColtResult = { ok: true } | { ok: false; reason: string };
export type ColtRng = () => number;
const OK: ColtResult = { ok: true };
const fail = (reason: string): ColtResult => ({ ok: false, reason });

export interface ColtActionCard { id: string; action: ColtAction | 'bullet'; ownerBandit: number }
interface Programmed { playerId: string; card: ColtActionCard; faceUp: boolean; cover: boolean }
interface PendingEvent { kind: 'pickpocket' | 'cheyenne'; playerId: string; bandit: number; loot?: ColtLoot; dropPosition?: ColtPosition }

export interface ColtServerPlayer {
  playerId: string;
  forfeited: boolean;
  characterChosen: boolean;
  displayName: string;
  characters: ColtCharacter[];
  positions: ColtPosition[];
  lootByBandit: ColtLoot[][];
  deck: ColtActionCard[];
  hand: ColtActionCard[];
  reserved: ColtActionCard | null;
  reserveComplete: boolean;
  setupComplete: boolean;
  programmedCardIds: string[];
  actedThisRound: boolean;
  bulletsFiredByBandit: number[];
  gunslingerShots: number;
  receivedBullets: number;
}

export interface ColtServerState {
  gameId: 'colt_express'; roomCode: string; rulesVersion: string; revision: number;
  initialPlayerCount: number; twoBanditMode: boolean; endReason: 'score' | 'forfeit' | null;
  programReturned: boolean;
  lootManifest: ColtLoot[];
  status: 'playing' | 'game_over'; phase: 'character_selection' | 'team_selection' | 'team_setup' | 'reserve_card' | 'programming' | 'execution' | 'pending_choice' | 'game_over';
  round: 1 | 2 | 3 | 4 | 5; slot: number; slots: number; turnIndex: number; programStepIndex: number;
  roundDeck: ColtRoundCard[]; currentRoundCard: ColtRoundCard;
  availableTeams: ColtCharacter[][]; teamSelectionStep: number;
  availableCharacters: ColtCharacter[];
  turnOrder: string[]; firstIndex: number; trainCars: number; marshalCar: number; neutralBulletsRemaining: number;
  players: Map<string, ColtServerPlayer>; lootBySpace: Record<string, ColtLoot[]>; program: Programmed[];
  executionIndex: number; pending: ColtPendingChoice | null; pendingEvent: PendingEvent | null; eventQueue: PendingEvent[];
  winnerPlayerIds: string[]; log: { id: number; text: string }[]; logSeq: number; rng: ColtRng;
}

type RoundFixture = { id: string; title: string; turns24: ColtTurnType[]; turns56: ColtTurnType[]; event: ColtRoundEvent };
export const COLT_REGULAR_ROUND_FIXTURES: readonly RoundFixture[] = [
  { id: 'angry-marshal', title: 'Angry Marshal', turns24: ['standard','standard','tunnel','switching'], turns56: ['standard','standard','switching'], event: 'angry_marshal' },
  { id: 'braking', title: 'Braking', turns24: ['standard','standard','standard','standard'], turns56: ['standard','tunnel','standard','standard'], event: 'braking' },
  { id: 'bridge', title: 'Bridge', turns24: ['standard','speeding','standard'], turns56: ['standard','speeding'], event: 'none' },
  { id: 'passengers-rebellion', title: "Passengers' Rebellion", turns24: ['standard','standard','tunnel','standard','standard'], turns56: ['standard','tunnel','standard','switching'], event: 'passengers_rebellion' },
  { id: 'swivel-arm', title: 'Swivel Arm', turns24: ['standard','tunnel','standard','standard'], turns56: ['standard','tunnel','standard'], event: 'swivel_arm' },
  { id: 'take-it-all', title: 'Take It All!', turns24: ['standard','tunnel','speeding','standard'], turns56: ['standard','speeding','switching'], event: 'take_it_all' },
  { id: 'tunnel', title: 'Tunnel', turns24: ['standard','tunnel','standard','tunnel','standard'], turns56: ['standard','tunnel','standard','tunnel'], event: 'none' },
] as const;
export const COLT_STATION_ROUND_FIXTURES: readonly ColtRoundCard[] = [
  { id: 'station-marshal-revenge', title: "Marshal's Revenge", band: 'station', turns: ['standard','standard','tunnel','standard'], event: 'marshal_revenge' },
  { id: 'station-hostage', title: 'Hostage-Taking of the Conductor', band: 'station', turns: ['standard','standard','tunnel','standard'], event: 'hostage_conductor' },
  { id: 'station-pickpocket', title: 'Pickpocketing', band: 'station', turns: ['standard','standard','tunnel','standard'], event: 'pickpocketing' },
] as const;
export const COLT_CAR_MANIFESTS = [
  { purses: 1, jewels: 0 }, { purses: 3, jewels: 1 }, { purses: 3, jewels: 0 },
  { purses: 1, jewels: 1 }, { purses: 4, jewels: 1 }, { purses: 0, jewels: 3 },
] as const;
export const COLT_PURSE_VALUES = [250,250,250,250,250,250,250,250,300,300,350,350,400,400,450,450,500,500] as const;

const shuffle = <T>(xs: readonly T[], rng: ColtRng) => { const a=[...xs]; for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j]!,a[i]!];} return a; };
const log = (s: ColtServerState, text: string) => s.log.push({ id: ++s.logSeq, text });
const key = (p: ColtPosition) => `${p.carIndex}:${p.level}`;
const twoPlayer = (s: ColtServerState) => s.twoBanditMode;
const allCards = (p: ColtServerPlayer) => [...p.deck, ...p.hand, ...(p.reserved ? [p.reserved] : [])];
const activePlayers = (s: ColtServerState) => s.turnOrder.map(id => s.players.get(id)!);
const hasBanditAbility = (p: ColtServerPlayer, b: number, character: ColtCharacter) => p.characters[b] === character;
const hasTeamAbility = (s: ColtServerState, p: ColtServerPlayer, character: ColtCharacter) => twoPlayer(s) ? p.characters.includes(character) : p.characters[0] === character;
const banditName = (p: ColtServerPlayer, b: number) => `${p.displayName}'s ${COLT_CHARACTERS[p.characters[b]!].name}`;
const carName = (s: ColtServerState, car: number) => car === 0 ? 'Caboose' : car === s.trainCars - 1 ? 'Locomotive' : `Car ${car + 1}`;

function buildDeck(playerIndex: number, bandits: number): ColtActionCard[] {
  const cards: ColtActionCard[]=[];
  if(bandits===1) for(const [action,count] of Object.entries(COLT_ACTION_COUNTS) as [ColtAction,number][]) for(let i=0;i<count;i++) cards.push({id:`p${playerIndex}-${action}-${i}`,action,ownerBandit:0});
  else { for(let b=0;b<2;b++) for(const action of ['move','floor','shoot','punch','rob'] as ColtAction[]) cards.push({id:`p${playerIndex}-b${b}-${action}`,action,ownerBandit:b}); cards.push({id:`p${playerIndex}-marshal`,action:'marshal',ownerBandit:0}); }
  return cards;
}

function makeRoundDeck(playerCount: number, rng: ColtRng): ColtRoundCard[] {
  const band = playerCount <= 4 ? '2-4' : '5-6';
  const regular = shuffle(COLT_REGULAR_ROUND_FIXTURES, rng).slice(0,4).map(card=>({id:`${band}-${card.id}`,title:card.title,band,turns:[...(band==='2-4'?card.turns24:card.turns56)],event:card.event} satisfies ColtRoundCard));
  return [...regular, shuffle(COLT_STATION_ROUND_FIXTURES,rng)[0]!];
}

function currentTurn(s: ColtServerState) { return s.currentRoundCard.turns[s.turnIndex] ?? null; }
function actionsPerPlayer(turn: ColtTurnType | null) { return turn === 'speeding' ? 2 : 1; }
export function currentProgrammingPlayerId(s: ColtServerState): string | null {
  if(s.phase!=='programming') return null;
  const turn=currentTurn(s); if(!turn)return null;
  const actor=Math.floor(s.programStepIndex/actionsPerPlayer(turn));
  const delta=turn==='switching'?-actor:actor;
  return s.turnOrder[(s.firstIndex+delta+s.turnOrder.length)%s.turnOrder.length]!;
}
export function programmingActionNumber(s: ColtServerState): 1 | 2 | null {
  return s.phase === 'programming' ? (s.programStepIndex % actionsPerPlayer(currentTurn(s)) + 1) as 1 | 2 : null;
}
export function canHideFirstAction(s: ColtServerState, p: ColtServerPlayer): boolean {
  return !p.forfeited && currentProgrammingPlayerId(s) === p.playerId && currentTurn(s) !== 'tunnel'
    && hasTeamAbility(s, p, 'ghost') && !p.actedThisRound;
}
function resetSchedule(s: ColtServerState) { s.turnIndex=0;s.programStepIndex=0;s.slot=1;s.slots=s.currentRoundCard.turns.length; }

function dealHand(s: ColtServerState, p: ColtServerPlayer) {
  const reserved=p.reserved;
  const rest=allCards(p).filter(c=>c.id!==reserved?.id);
  p.deck=shuffle(rest,s.rng); p.hand=reserved?[reserved]:[]; p.reserved=null;
  const drawCount=6+(hasTeamAbility(s,p,'doc')?1:0);
  for(let i=0;i<drawCount&&p.deck.length;i++) p.hand.push(p.deck.pop()!);
  p.programmedCardIds=[]; p.actedThisRound=false; p.reserveComplete=false;
}
function beginRound(s: ColtServerState) {
  s.currentRoundCard=s.roundDeck[s.round-1]!; resetSchedule(s); s.program=[];s.programReturned=false;s.executionIndex=0;s.pending=null;s.pendingEvent=null;s.eventQueue=[];
  if(twoPlayer(s)){s.phase='reserve_card';for(const p of activePlayers(s)){p.deck=shuffle(allCards(p),s.rng);p.hand=[];p.reserved=null;p.reserveComplete=false;p.programmedCardIds=[];p.actedThisRound=false;}log(s,`Round ${s.round}: each team secretly reserves one card.`);}
  else {s.phase='programming';for(const p of activePlayers(s))dealHand(s,p);log(s,`Round ${s.round} begins: ${s.currentRoundCard.title}.`);}
}

function advanceProgramTurn(s: ColtServerState) {
  const turn=currentTurn(s)!; s.programStepIndex++;
  if(s.programStepIndex>=s.turnOrder.length*actionsPerPlayer(turn)){s.programStepIndex=0;s.turnIndex++;s.slot=s.turnIndex+1;}
  if(s.turnIndex>=s.currentRoundCard.turns.length){
    for(const p of activePlayers(s)){p.deck.push(...p.hand);p.hand=[];}
    s.phase='execution';s.executionIndex=0;advanceExecution(s);
  }
}

function marshalVictims(s: ColtServerState) { return allBandits(s).filter(x=>x.pos.level==='inside'&&x.pos.carIndex===s.marshalCar); }
function dealNeutralBullets(s: ColtServerState, targets: {p:ColtServerPlayer;b:number}[], reason: string) {
  if(!targets.length)return; const canDeal=s.neutralBulletsRemaining>=targets.length;
  for(const {p,b} of targets){if(canDeal){s.neutralBulletsRemaining--;p.receivedBullets++;p.deck.push({id:`neutral-${reason}-${s.round}-${s.revision}-${p.playerId}-${b}-${p.receivedBullets}`,action:'bullet',ownerBandit:b});log(s,`${banditName(p,b)} takes a neutral bullet (${reason}).`);}else log(s,`${banditName(p,b)} takes no bullet; the neutral supply cannot cover the whole ${reason} encounter.`);}
}
function resolveMarshalVictims(s: ColtServerState, victims=marshalVictims(s)){for(const {pos} of victims)pos.level='roof';dealNeutralBullets(s,victims,'Marshal');}
function encounterMarshal(s: ColtServerState,p:ColtServerPlayer,b:number){const pos=p.positions[b]!;if(pos.level==='inside'&&pos.carIndex===s.marshalCar)resolveMarshalVictims(s,[{p,b,pos}]);}

function targets(s: ColtServerState,p:ColtServerPlayer,b:number){
  const pos = p.positions[b]!;
  const candidates: { id: string; label: string }[] = [];
  const present = activePlayers(s);
  for (const q of present) for (let qb = 0; qb < q.positions.length; qb++) {
    if (q.playerId === p.playerId && qb === b) continue;
    const qp = q.positions[qb]!;
    let legal = false;
    if (pos.level === 'inside') {
      legal = qp.level === 'inside' && Math.abs(qp.carIndex - pos.carIndex) === 1;
    } else if (qp.level === 'roof' && qp.carIndex !== pos.carIndex) {
      const direction = Math.sign(qp.carIndex - pos.carIndex);
      const nearer = present.flatMap(x => x.positions).some(x => x.level === 'roof'
        && Math.sign(x.carIndex - pos.carIndex) === direction
        && Math.abs(x.carIndex - pos.carIndex) < Math.abs(qp.carIndex - pos.carIndex));
      legal = !nearer;
    }
    if (hasBanditAbility(p,b,'tuco') && qp.carIndex === pos.carIndex && qp.level !== pos.level) legal = true;
    if (legal) candidates.push({id:`${q.playerId}:${qb}`,label:banditName(q,qb)});
  }
  const nonBelle = candidates.filter(option => {
    const [id, bandit] = option.id.split(':');
    return !hasBanditAbility(s.players.get(id)!, Number(bandit), 'belle');
  });
  return nonBelle.length ? nonBelle : candidates;
}
function optionsFor(s: ColtServerState,p:ColtServerPlayer,card:ColtActionCard):ColtPendingChoice|null{
  const b=card.ownerBandit,pos=p.positions[b]!;let options:{id:string;label:string}[]=[];
  if(card.action==='move'){const max=pos.level==='roof'?3:1;for(let d=1;d<=max;d++)for(const sign of[-1,1]){const car=pos.carIndex+d*sign;if(car>=0&&car<s.trainCars)options.push({id:String(car),label:carName(s,car)});}}
  else if(card.action==='shoot'&&p.bulletsFiredByBandit[b]!<6)options=targets(s,p,b);
  else if(card.action==='punch'){const candidates:{q:ColtServerPlayer;qb:number}[]=[];for(const q of activePlayers(s))for(let qb=0;qb<q.positions.length;qb++){const qp=q.positions[qb]!;if(!(q.playerId===p.playerId&&qb===b)&&qp.carIndex===pos.carIndex&&qp.level===pos.level)candidates.push({q,qb});}const nonBelle=candidates.filter(x=>!hasBanditAbility(x.q,x.qb,'belle')),legal=nonBelle.length?nonBelle:candidates;for(const {q,qb} of legal)for(const car of[pos.carIndex-1,pos.carIndex+1])if(car>=0&&car<s.trainCars){const loot=q.lootByBandit[qb]!;if(loot.length)loot.forEach((token,li)=>options.push({id:`${q.playerId}:${qb}:${car}:${li}`,label:`Punch ${banditName(q,qb)} to ${carName(s,car)} · drop ${token.type}`}));else options.push({id:`${q.playerId}:${qb}:${car}:-1`,label:`Punch ${banditName(q,qb)} to ${carName(s,car)}`});}}
  else if(card.action==='rob')options=(s.lootBySpace[key(pos)]??[]).map((x,i)=>({id:String(i),label:x.type}));
  else if(card.action==='marshal')for(const car of[s.marshalCar-1,s.marshalCar+1])if(car>=0&&car<s.trainCars)options.push({id:String(car),label:`Move Marshal to ${carName(s,car)}`});
  return options.length?{playerId:p.playerId,action:card.action as ColtAction,options}:null;
}
function executeChoice(s: ColtServerState,p:ColtServerPlayer,card:ColtActionCard,id:string){
  const b=card.ownerBandit,pos=p.positions[b]!;
  if(card.action==='move'){pos.carIndex=Number(id);encounterMarshal(s,p,b);}else if(card.action==='floor'){pos.level=pos.level==='inside'?'roof':'inside';encounterMarshal(s,p,b);}
  else if(card.action==='rob'){const list=s.lootBySpace[key(pos)]??[],loot=list.splice(Number(id),1)[0];if(loot)p.lootByBandit[b]!.push(loot);}
  else if(card.action==='marshal'){s.marshalCar=Number(id);resolveMarshalVictims(s);}
  else if(card.action==='shoot'){const[idp,ibs]=id.split(':'),q=s.players.get(idp)!,qb=Number(ibs),shot=++p.bulletsFiredByBandit[b]!;if(q.playerId!==p.playerId)p.gunslingerShots++;q.receivedBullets++;q.deck.push({id:`bullet-${p.playerId}-${b}-${shot}`,action:'bullet',ownerBandit:qb});if(hasBanditAbility(p,b,'django')){const qp=q.positions[qb]!,dir=Math.sign(qp.carIndex-pos.carIndex),car=qp.carIndex+dir;if(car>=0&&car<s.trainCars)qp.carIndex=car;encounterMarshal(s,q,qb);}log(s,`${banditName(p,b)} shoots ${banditName(q,qb)}.`);}
  else if(card.action==='punch'){const[idp,ibs,car,lootIndex]=id.split(':'),q=s.players.get(idp)!,qb=Number(ibs),qp=q.positions[qb]!,dropPosition={...qp},lootPile=q.lootByBandit[qb]!,li=Number(lootIndex);if(li>=0&&li<lootPile.length){const loot=lootPile.splice(li,1)[0]!;if(hasBanditAbility(p,b,'cheyenne')&&loot.type==='purse'){s.pendingEvent={kind:'cheyenne',playerId:p.playerId,bandit:b,loot,dropPosition};s.pending={playerId:p.playerId,action:'punch',options:[{id:'take',label:'Cheyenne takes the dropped purse'},{id:'drop',label:'Leave the purse on the floor'}]};s.phase='pending_choice';}else(s.lootBySpace[key(dropPosition)]??=[]).push(loot);}qp.carIndex=Number(car);encounterMarshal(s,q,qb);log(s,`${banditName(p,b)} punches ${banditName(q,qb)}.`);}
}

function allBandits(s: ColtServerState){return activePlayers(s).flatMap(p=>p.positions.map((pos,b)=>({p,b,pos})));}
function resolveRoundEvent(s: ColtServerState): boolean {
  switch(s.currentRoundCard.event){
    case 'angry_marshal': {const victims=allBandits(s).filter(x=>x.pos.level==='roof'&&x.pos.carIndex===s.marshalCar);dealNeutralBullets(s,victims,'Angry Marshal');s.marshalCar=Math.max(0,s.marshalCar-1);resolveMarshalVictims(s);break;}
    case 'braking': for(const {pos} of allBandits(s))if(pos.level==='roof')pos.carIndex=Math.min(s.trainCars-1,pos.carIndex+1);break;
    case 'take_it_all': if(!s.lootManifest.some(x=>x.id==='strongbox-2')){const token:ColtLoot={id:'strongbox-2',type:'strongbox',value:1000};s.lootManifest.push({...token});(s.lootBySpace[`${s.marshalCar}:inside`]??=[]).push(token);}break;
    case 'passengers_rebellion': dealNeutralBullets(s,allBandits(s).filter(x=>x.pos.level==='inside'),"Passengers' Rebellion");break;
    case 'swivel_arm': for(const {pos} of allBandits(s))if(pos.level==='roof')pos.carIndex=0;break;
    case 'marshal_revenge': for(const {p,b,pos} of allBandits(s).filter(x=>x.pos.level==='roof'&&x.pos.carIndex===s.marshalCar)){const pile=p.lootByBandit[b]!,purses=pile.map((x,i)=>({x,i})).filter(y=>y.x.type==='purse').sort((a,c)=>a.x.value-c.x.value);if(purses[0])(s.lootBySpace[key(pos)]??=[]).push(pile.splice(purses[0].i,1)[0]!);}break;
    case 'hostage_conductor': for(const {p,b} of allBandits(s).filter(x=>x.pos.carIndex===s.trainCars-1)){const token:ColtLoot={id:`hostage-${p.playerId}-${b}`,type:'purse',value:250};s.lootManifest.push({...token});p.lootByBandit[b]!.push(token);}break;
    case 'pickpocketing': s.eventQueue=allBandits(s).filter(({pos})=>allBandits(s).filter(x=>x.pos.carIndex===pos.carIndex&&x.pos.level===pos.level).length===1&&(s.lootBySpace[key(pos)]??[]).some(x=>x.type==='purse')).map(({p,b})=>({kind:'pickpocket' as const,playerId:p.playerId,bandit:b}));if(s.eventQueue.length){beginNextEventChoice(s);return true;}break;
  }
  return false;
}
function beginNextEventChoice(s: ColtServerState){const event=s.eventQueue.shift();if(!event){s.pendingEvent=null;s.pending=null;completeRound(s);return;}const p=s.players.get(event.playerId)!,pos=p.positions[event.bandit]!,options=(s.lootBySpace[key(pos)]??[]).map((x,i)=>({x,i})).filter(y=>y.x.type==='purse').map(y=>({id:String(y.i),label:'Take a purse'}));options.push({id:'skip',label:'Take nothing'});s.pendingEvent=event;s.pending={playerId:event.playerId,action:'rob',options};s.phase='pending_choice';}

function scorePlayer(p: ColtServerPlayer){return p.lootByBandit.flat().reduce((sum,x)=>sum+x.value,0);}
export function finalColtScore(s: ColtServerState, playerId: string): number | null {
  const p = s.players.get(playerId);
  if (!p || p.forfeited) return null;
  const maxShots = Math.max(...[...s.players.values()].filter(x => !x.forfeited).map(x => x.gunslingerShots));
  return scorePlayer(p) + (p.gunslingerShots === maxShots ? 1000 : 0);
}
function finishGame(s: ColtServerState) {
  const scores = [...s.players.values()].filter(p => !p.forfeited).map(p => ({ p, score: finalColtScore(s, p.playerId)! }));
  const high = Math.max(...scores.map(x => x.score));
  const tied = scores.filter(x => x.score === high);
  const fewest = Math.min(...tied.map(x => x.p.receivedBullets));
  s.winnerPlayerIds = tied.filter(x => x.p.receivedBullets === fewest).map(x => x.p.playerId);
  s.status = 'game_over'; s.phase = 'game_over'; s.endReason = 'score';
  log(s, twoPlayer(s) ? 'The richest bandit team wins the robbery.' : 'The richest bandit wins the robbery.');
}
function completeRound(s: ColtServerState) {
  if (s.round === 5) { finishGame(s); return; }
  const oldOrder = s.turnOrder;
  let nextFirst = oldOrder[s.firstIndex]!;
  for (let offset = 1; offset <= oldOrder.length; offset++) {
    const candidate = oldOrder[(s.firstIndex + offset) % oldOrder.length]!;
    if (!s.players.get(candidate)!.forfeited) { nextFirst = candidate; break; }
  }
  for (const p of activePlayers(s).filter(p => p.forfeited)) {
    p.deck.push(...p.hand, ...(p.reserved ? [p.reserved] : []));
    p.hand = []; p.reserved = null; p.programmedCardIds = [];
  }
  s.turnOrder = oldOrder.filter(id => !s.players.get(id)!.forfeited);
  s.firstIndex = s.turnOrder.indexOf(nextFirst);
  s.round = (s.round + 1) as 2 | 3 | 4 | 5;
  beginRound(s);
}
function finishRound(s: ColtServerState) {
  if (!s.programReturned) {
    for (const item of s.program) s.players.get(item.playerId)!.deck.push(item.card);
    s.programReturned = true;
  }
  if (!resolveRoundEvent(s)) completeRound(s);
}
function advanceExecution(s: ColtServerState){while(s.phase==='execution'&&s.executionIndex<s.program.length){const item=s.program[s.executionIndex]!,p=s.players.get(item.playerId)!;if(item.card.action==='bullet'){s.executionIndex++;continue;}if(item.card.action==='floor'){executeChoice(s,p,item.card,'');s.executionIndex++;continue;}const pending=optionsFor(s,p,item.card);if(!pending){log(s,`${banditName(p,item.card.ownerBandit)} cannot resolve ${item.card.action}.`);s.executionIndex++;continue;}s.pending=pending;s.phase='pending_choice';return;}if(s.executionIndex>=s.program.length)finishRound(s);}

function createLoot(s: ColtServerState, playerCount: number){
  const pursePool=[...COLT_PURSE_VALUES]; const startingBandits=playerCount===2?4:playerCount;
  for(let i=0;i<startingBandits;i++)pursePool.splice(pursePool.indexOf(250),1);
  const manifests=shuffle(COLT_CAR_MANIFESTS,s.rng).slice(0,s.trainCars-1);let purseId=0,jewelId=0;
  manifests.forEach((manifest,car)=>{const list:ColtLoot[]=[];for(let i=0;i<manifest.purses;i++){const choice=Math.floor(s.rng()*pursePool.length),value=pursePool.splice(choice,1)[0]!;list.push({id:`purse-${purseId++}`,type:'purse',value});}for(let i=0;i<manifest.jewels;i++)list.push({id:`jewel-${jewelId++}`,type:'jewel',value:500});s.lootBySpace[`${car}:inside`]=list;s.lootBySpace[`${car}:roof`]=[];});
  s.lootBySpace[`${s.trainCars-1}:inside`]=[{id:'strongbox-1',type:'strongbox',value:1000}];s.lootBySpace[`${s.trainCars-1}:roof`]=[];
}

export function initColtGame(roomCode:string,bases:{playerId:string;displayName:string}[],rng:ColtRng=Math.random):ColtServerState{
  if(bases.length<COLT_MIN_PLAYERS||bases.length>COLT_MAX_PLAYERS)throw new Error(`Colt Express requires ${COLT_MIN_PLAYERS}-${COLT_MAX_PLAYERS} players`);
  const two=bases.length===2,primary=shuffle(['tuco','django','cheyenne'] as ColtCharacter[],rng),chars=shuffle(Object.keys(COLT_CHARACTERS) as ColtCharacter[],rng),availableTeams=two?shuffle((['ghost','doc','belle'] as ColtCharacter[]).map((sidekick,i)=>[sidekick,primary[i]!] as ColtCharacter[]),rng):[],trainCars=two?4:bases.length+1,roundDeck=makeRoundDeck(bases.length,rng),firstIndex=Math.floor(rng()*bases.length);
  const state:ColtServerState={gameId:'colt_express',roomCode,rulesVersion:COLT_RULES_VERSION,revision:0,initialPlayerCount:bases.length,twoBanditMode:two,endReason:null,programReturned:false,lootManifest:[],status:'playing',phase:two?'team_selection':'character_selection',round:1,slot:1,slots:roundDeck[0]!.turns.length,turnIndex:0,programStepIndex:0,roundDeck,currentRoundCard:roundDeck[0]!,availableTeams,availableCharacters:two?[]:Object.keys(COLT_CHARACTERS) as ColtCharacter[],teamSelectionStep:0,turnOrder:bases.map(x=>x.playerId),firstIndex,trainCars,marshalCar:trainCars-1,neutralBulletsRemaining:13,players:new Map(),lootBySpace:{},program:[],executionIndex:0,pending:null,pendingEvent:null,eventQueue:[],winnerPlayerIds:[],log:[],logSeq:0,rng};
  createLoot(state,bases.length);
  bases.forEach((base,i)=>{const bandits=two?2:1,characters=two?[...availableTeams[i]!] :[chars[i]!],deck=buildDeck(i,bandits),positions=Array.from({length:bandits},(_,b)=>({carIndex:two?b:((i-firstIndex+bases.length)%bases.length)%2,level:'inside' as ColtLevel})),lootByBandit=Array.from({length:bandits},(_,b)=>[{id:`start-${i}-${b}`,type:'purse' as const,value:250}]);state.players.set(base.playerId,{...base,forfeited:false,characterChosen:false,characters,positions,lootByBandit,deck,hand:[],reserved:null,reserveComplete:false,setupComplete:false,programmedCardIds:[],actedThisRound:false,bulletsFiredByBandit:Array(bandits).fill(0),gunslingerShots:0,receivedBullets:0});});
  state.lootManifest = [...Object.values(state.lootBySpace).flat(), ...[...state.players.values()].flatMap(p => p.lootByBandit.flat())].map(x => ({...x}));
  log(state,two?'Choose one of the three official randomly paired bandit teams.':'Choose an available character before the robbery.');
  validateColt(state);return state;
}

const stale=(s:ColtServerState,r?:number)=>!Number.isSafeInteger(r)||r!==s.revision;
function finishCharacterSelection(s: ColtServerState) {
  if (!activePlayers(s).every(p => p.characterChosen)) return;
  s.firstIndex = Math.floor(s.rng() * s.turnOrder.length);
  activePlayers(s).forEach((p,index) => {
    p.positions[0] = {carIndex:((index-s.firstIndex+s.turnOrder.length)%s.turnOrder.length)%2,level:'inside'};
    p.setupComplete = true;
  });
  beginRound(s);
}
export function chooseColtCharacter(s: ColtServerState, id: string, character: ColtCharacter, rev: number): ColtResult {
  if (stale(s, rev)) return fail('State changed; refresh');
  const p = s.players.get(id);
  if (s.phase !== 'character_selection' || !p || p.forfeited || p.characterChosen) return fail('You cannot choose a character now');
  if (!s.availableCharacters.includes(character)) return fail('Choose an available character');
  p.characters = [character]; p.characterChosen = true;
  s.availableCharacters = s.availableCharacters.filter(value => value !== character);
  log(s, `${p.displayName} chooses ${COLT_CHARACTERS[character].name}.`);
  finishCharacterSelection(s); s.revision++; validateColt(s); return OK;
}
export function chooseColtTeam(s:ColtServerState,id:string,teamIndex:number,rev?:number):ColtResult{if(stale(s,rev))return fail('State changed; refresh');const chooser=s.turnOrder[(s.firstIndex+s.teamSelectionStep)%s.turnOrder.length];if(s.phase!=='team_selection'||chooser!==id)return fail('It is not your team selection turn');const team=Number.isInteger(teamIndex)?s.availableTeams[teamIndex]:undefined;if(!team)return fail('Choose an available team');s.players.get(id)!.characters=[...team];s.players.get(id)!.characterChosen=true;s.availableTeams.splice(teamIndex,1);s.teamSelectionStep++;log(s,`${s.players.get(id)!.displayName} chooses ${team.map(x=>COLT_CHARACTERS[x].name).join(' & ')}.`);if(s.teamSelectionStep>=s.turnOrder.length){s.phase='team_setup';log(s,'Each team secretly assigns one bandit to the caboose and the other to the adjacent car.');}s.revision++;validateColt(s);return OK;}
export function assignColtStart(s:ColtServerState,id:string,cabooseBandit:number,rev?:number):ColtResult{if(stale(s,rev))return fail('State changed; refresh');if(s.phase!=='team_setup')return fail('Starting positions are already locked');const p=s.players.get(id);if(!p||p.setupComplete||![0,1].includes(cabooseBandit))return fail('Choose one of your two bandits for the caboose');p.positions[cabooseBandit]={carIndex:0,level:'inside'};p.positions[1-cabooseBandit]={carIndex:1,level:'inside'};p.setupComplete=true;log(s,`${p.displayName} locks in a secret starting formation.`);if([...s.players.values()].every(x=>x.setupComplete))beginRound(s);s.revision++;validateColt(s);return OK;}
export function reserveColtCard(s:ColtServerState,id:string,cardId:string,rev?:number):ColtResult{if(stale(s,rev))return fail('State changed; refresh');if(s.phase!=='reserve_card')return fail('It is not the reserve step');const p=s.players.get(id);if(!p||p.reserveComplete)return fail('Your reserve is already locked');const all=allCards(p),idx=all.findIndex(c=>c.id===cardId);if(idx<0)return fail('Choose one card from your action deck');p.reserved=all[idx]!;p.deck=all.filter(c=>c.id!==cardId);p.hand=[];p.reserveComplete=true;log(s,`${p.displayName} reserves a card.`);if([...s.players.values()].every(x=>x.reserveComplete)){for(const x of s.players.values())dealHand(s,x);s.phase='programming';log(s,`Round ${s.round} begins: ${s.currentRoundCard.title}.`);}s.revision++;validateColt(s);return OK;}
export function programColt(s:ColtServerState,id:string,cardId:string|undefined,draw:boolean|undefined,rev?:number,coverCardId?:string,faceDown?:boolean):ColtResult{
  if(stale(s,rev))return fail('State changed; refresh');if(s.phase!=='programming'||currentProgrammingPlayerId(s)!==id||s.players.get(id)?.forfeited)return fail('It is not your programming turn');const p=s.players.get(id)!;
  if (faceDown !== undefined && typeof faceDown !== 'boolean') return fail('Choose a valid card orientation');
  if (draw !== undefined && typeof draw !== 'boolean') return fail('Choose a valid programming action');
  if (draw && (cardId !== undefined || coverCardId !== undefined || faceDown !== undefined)) return fail('Draw or program, not both');
  if (faceDown === true && (!canHideFirstAction(s, p) || coverCardId)) return fail('Ghost cannot conceal this action');
  if(draw){for(let i=0;i<3&&p.deck.length;i++)p.hand.push(p.deck.pop()!);p.actedThisRound=true;log(s,`${p.displayName} draws 3 cards.`);}
  else {const idx=p.hand.findIndex(c=>c.id===cardId);if(idx<0)return fail('Choose an action card from hand');const card=p.hand[idx]!;if(card.action==='bullet')return fail('Bullet cards cannot be programmed');const cover=coverCardId?p.hand.find(c=>c.id===coverCardId):undefined;
    if(coverCardId){if(!twoPlayer(s)||currentTurn(s)!=='standard'||card.action!=='shoot')return fail('Cover is only available after Shoot on a standard turn');if(!cover||cover.id===card.id||cover.action==='bullet'||cover.action==='marshal'||cover.ownerBandit===card.ownerBandit)return fail("Cover must be the other bandit's non-Marshal action");}
    p.hand.splice(idx,1);p.programmedCardIds.push(card.id);const ghostCanHide=hasTeamAbility(s,p,'ghost')&&!p.actedThisRound&&!cover&&faceDown!==false;const faceUp=currentTurn(s)!=='tunnel'&&!ghostCanHide;s.program.push({playerId:id,card,faceUp,cover:false});
    if(cover){const coverIndex=p.hand.findIndex(c=>c.id===cover.id);p.hand.splice(coverIndex,1);p.programmedCardIds.push(cover.id);s.program.push({playerId:id,card:cover,faceUp:true,cover:true});}
    p.actedThisRound=true;log(s,`${p.displayName} programs ${faceUp?card.action:'a concealed action'}${cover?' with Cover':''}.`);
  }
  advanceProgramTurn(s);s.revision++;validateColt(s);return OK;
}
export function chooseColt(s:ColtServerState,id:string,optionId:string,rev?:number):ColtResult{
  if (s.players.get(id)?.forfeited) return fail('This seat has forfeited');
  return resolveColtChoice(s,id,optionId,rev);
}
function resolveColtChoice(s:ColtServerState,id:string,optionId:string,rev?:number):ColtResult{if(stale(s,rev))return fail('State changed; refresh');if(s.phase!=='pending_choice'||s.pending?.playerId!==id||!s.pending.options.some(o=>o.id===optionId))return fail('Choose a legal action option');
  if(s.pendingEvent?.kind==='pickpocket'){const event=s.pendingEvent,p=s.players.get(id)!,pos=p.positions[event.bandit]!;if(optionId!=='skip'){const loot=(s.lootBySpace[key(pos)]??[]).splice(Number(optionId),1)[0];if(loot)p.lootByBandit[event.bandit]!.push(loot);}s.pending=null;s.pendingEvent=null;beginNextEventChoice(s);}
  else if(s.pendingEvent?.kind==='cheyenne'){const event=s.pendingEvent,p=s.players.get(id)!;if(optionId==='take')p.lootByBandit[event.bandit]!.push(event.loot!);else(s.lootBySpace[key(event.dropPosition!)]??=[]).push(event.loot!);s.pending=null;s.pendingEvent=null;s.phase='execution';advanceExecution(s);}
  else {const item=s.program[s.executionIndex]!,p=s.players.get(id)!;executeChoice(s,p,item.card,optionId);s.executionIndex++;if(!s.pendingEvent){s.pending=null;s.phase='execution';advanceExecution(s);}}
  s.revision++;validateColt(s);return OK;}

export function settleColtAutopilot(s: ColtServerState): boolean {
  const before = s.revision;
  for (let guard = 0; guard < 1000 && s.status === 'playing'; guard++) {
    const actor = currentProgrammingPlayerId(s);
    if (actor && s.players.get(actor)!.forfeited) {
      advanceProgramTurn(s);
      s.revision++;
      continue;
    }
    if (s.pending && s.players.get(s.pending.playerId)!.forfeited) {
      const option = s.pendingEvent?.kind === 'cheyenne' ? 'drop'
        : s.pendingEvent?.kind === 'pickpocket' ? 'skip' : s.pending.options[0]!.id;
      const result = resolveColtChoice(s, s.pending.playerId, option, s.revision);
      if (!result.ok) throw new Error('Committed forfeited action could not settle');
      continue;
    }
    validateColt(s);
    return before !== s.revision;
  }
  if (s.status === 'playing') throw new Error('Colt departure settlement did not converge');
  validateColt(s);
  return before !== s.revision;
}

export function forfeitColtPlayers(s: ColtServerState, ids: string[], expectedRevision: number): ColtResult {
  if (stale(s, expectedRevision)) return fail('State changed; refresh');
  if (s.status === 'game_over') return OK;
  if (ids.some(id => !s.players.has(id))) return fail('Unknown player');
  const departing = [...new Set(ids)].map(id => s.players.get(id)!).filter(p => !p.forfeited);
  if (!departing.length) return OK;
  for (const p of departing) {
    p.forfeited = true;
    log(s, `${p.displayName} forfeits; only already-programmed actions will finish.`);
  }
  s.revision++;
  const eligible = [...s.players.values()].filter(p => !p.forfeited);
  if (eligible.length <= 1) {
    if (s.pendingEvent?.kind === 'cheyenne') {
      (s.lootBySpace[key(s.pendingEvent.dropPosition!)] ??= []).push(s.pendingEvent.loot!);
    }
    s.pending = null; s.pendingEvent = null; s.eventQueue = [];
    s.status = 'game_over'; s.phase = 'game_over'; s.endReason = 'forfeit';
    s.winnerPlayerIds = eligible.map(p => p.playerId);
    log(s, eligible.length ? 'The remaining eligible player wins by forfeit.' : 'All players forfeited; there is no winner.');
    validateColt(s);
    return OK;
  }
  if (s.phase === 'character_selection') {
    s.turnOrder = s.turnOrder.filter(id => !s.players.get(id)!.forfeited);
    s.firstIndex = 0;
    finishCharacterSelection(s);
  }
  settleColtAutopilot(s);
  validateColt(s);
  return OK;
}

export function validateColt(s: ColtServerState) {
  if (!Number.isSafeInteger(s.revision) || s.revision < 0) throw new Error('Invalid revision');
  if (s.initialPlayerCount !== s.players.size || s.twoBanditMode !== (s.initialPlayerCount === 2)) throw new Error('Initial mode changed');
  if (new Set(s.turnOrder).size !== s.turnOrder.length || s.turnOrder.some(id => !s.players.has(id))) throw new Error('Invalid active roster');
  const physicalIds = new Set<string>();
  let neutralCount = 0;
  const issuedShots = new Map<string, number>();
  let playerIndex = 0;
  for (const p of s.players.values()) {
    const bandits = s.twoBanditMode ? 2 : 1;
    if (p.positions.length !== bandits || p.characters.length !== bandits || p.lootByBandit.length !== bandits || p.bulletsFiredByBandit.length !== bandits) throw new Error('Bandit ownership mismatch');
    if (p.bulletsFiredByBandit.some(n => !Number.isInteger(n) || n < 0 || n > 6)) throw new Error('Invalid bullet supply');
    for (const pos of p.positions) {
      if (!Number.isInteger(pos.carIndex) || pos.carIndex < 0 || pos.carIndex >= s.trainCars || !['inside','roof'].includes(pos.level)) throw new Error('Bandit off train');
      if (s.turnOrder.includes(p.playerId) && pos.level === 'inside' && pos.carIndex === s.marshalCar) throw new Error('Bandit remained with Marshal');
    }
    if (!s.turnOrder.includes(p.playerId) && (!p.forfeited || p.hand.length || p.reserved)) throw new Error('Invalid retired seat');
    const expected = new Map(buildDeck(playerIndex++, bandits).map(card => [card.id, card]));
    const cards = [...allCards(p), ...(!s.programReturned ? s.program.filter(item => item.playerId === p.playerId).map(item => item.card) : [])];
    let received = 0;
    for (const card of cards) {
      if (physicalIds.has(card.id)) throw new Error('Duplicate physical card');
      physicalIds.add(card.id);
      if (!Number.isInteger(card.ownerBandit) || card.ownerBandit < 0 || card.ownerBandit >= bandits) throw new Error('Invalid card owner');
      if (card.action !== 'bullet') {
        const canonical = expected.get(card.id);
        if (!canonical || canonical.action !== card.action || canonical.ownerBandit !== card.ownerBandit) throw new Error('Non-canonical action card');
        expected.delete(card.id);
      } else {
        received++;
        if (card.id.startsWith('neutral-')) neutralCount++;
        else {
          let shooter: ColtServerPlayer | undefined;
          for (const source of s.players.values()) for (let b = 0; b < bandits; b++) {
            for (let shot = 1; shot <= source.bulletsFiredByBandit[b]!; shot++) {
              if (card.id === `bullet-${source.playerId}-${b}-${shot}`) shooter = source;
            }
          }
          if (!shooter) throw new Error('Non-canonical fired bullet');
          if (shooter.playerId !== p.playerId) issuedShots.set(shooter.playerId, (issuedShots.get(shooter.playerId) ?? 0) + 1);
        }
      }
    }
    if (expected.size) throw new Error('Missing action card');
    if (received !== p.receivedBullets) throw new Error('Received bullet count mismatch');
  }
  for (const p of s.players.values()) {
    if (p.gunslingerShots !== (issuedShots.get(p.playerId) ?? 0)) throw new Error('Gunslinger count mismatch');
    for (let b = 0; b < p.bulletsFiredByBandit.length; b++) for (let n = 1; n <= p.bulletsFiredByBandit[b]!; n++) {
      if (!physicalIds.has(`bullet-${p.playerId}-${b}-${n}`)) throw new Error('Missing fired bullet');
    }
  }
  if (!Number.isInteger(s.neutralBulletsRemaining) || s.neutralBulletsRemaining < 0 || s.neutralBulletsRemaining + neutralCount !== 13) throw new Error('Neutral bullet conservation failed');
  const loot = [...Object.values(s.lootBySpace).flat(), ...[...s.players.values()].flatMap(p => p.lootByBandit.flat()), ...(s.pendingEvent?.loot ? [s.pendingEvent.loot] : [])];
  const manifest = new Map(s.lootManifest.map(token => [token.id, token]));
  if (manifest.size !== s.lootManifest.length || loot.length !== manifest.size) throw new Error('Loot count mismatch');
  for (const token of loot) {
    const expected = manifest.get(token.id);
    if (!expected || expected.type !== token.type || expected.value !== token.value) throw new Error('Loot identity mismatch');
    manifest.delete(token.id);
  }
  if (!Number.isInteger(s.marshalCar) || s.marshalCar < 0 || s.marshalCar >= s.trainCars) throw new Error('Marshal off train');
  if ((s.phase === 'pending_choice') !== !!s.pending) throw new Error('Choice phase mismatch');
  if (s.pending && (!s.turnOrder.includes(s.pending.playerId) || !s.pending.options.length)) throw new Error('Invalid pending owner/options');
  if ((s.status === 'game_over') !== (s.phase === 'game_over') || (s.status === 'game_over') !== (s.endReason !== null)) throw new Error('Terminal state mismatch');
  if (s.winnerPlayerIds.some(id => !s.players.has(id) || s.players.get(id)!.forfeited)) throw new Error('Ineligible winner');
  if (s.roundDeck.length !== 5 || s.roundDeck[4]?.band !== 'station' || new Set(s.roundDeck.map(card => card.id)).size !== 5) throw new Error('Invalid round deck');
  if (s.roundDeck.slice(0,4).some(card => card.band !== (s.initialPlayerCount <= 4 ? '2-4' : '5-6'))) throw new Error('Round band changed');
}
