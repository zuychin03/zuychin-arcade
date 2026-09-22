import {
  assignColtStart, chooseColt, COLT_CAR_MANIFESTS, COLT_REGULAR_ROUND_FIXTURES, COLT_STATION_ROUND_FIXTURES,
  chooseColtTeam, chooseColtCharacter, currentProgrammingPlayerId, initColtGame as initialise, programColt, reserveColtCard, validateColt, forfeitColtPlayers, settleColtAutopilot,
} from '../../src/game/colt-express/engine.js';
import { toColtPrivateState, toColtPublicState } from '../../src/game/colt-express/publicState.js';

let assertions=0;
function assert(condition:unknown,message:string):asserts condition{assertions++;if(!condition)throw new Error(message);}
function seeded(seed:number){let value=seed>>>0;return()=>{value=(value*1664525+1013904223)>>>0;return value/0x100000000;};}
const bases=(count:number)=>Array.from({length:count},(_,i)=>({playerId:`p${i}`,displayName:`P${i}`}));
function initColtGame(...args:Parameters<typeof initialise>){
  const s=initialise(...args);
  while(s.phase==='character_selection'){
    const id=s.turnOrder.find(id=>toColtPrivateState(s,id).canChooseCharacter)!;
    assert(chooseColtCharacter(s,id,s.availableCharacters[0]!,s.revision).ok,'Character choice rejected');
  }
  return s;
}

const exact24:Record<string,string>={
  'angry-marshal':'standard,standard,tunnel,switching','braking':'standard,standard,standard,standard',
  bridge:'standard,speeding,standard','passengers-rebellion':'standard,standard,tunnel,standard,standard',
  'swivel-arm':'standard,tunnel,standard,standard','take-it-all':'standard,tunnel,speeding,standard',
  tunnel:'standard,tunnel,standard,tunnel,standard',
};
const exact56:Record<string,string>={
  'angry-marshal':'standard,standard,switching','braking':'standard,tunnel,standard,standard',bridge:'standard,speeding',
  'passengers-rebellion':'standard,tunnel,standard,switching','swivel-arm':'standard,tunnel,standard',
  'take-it-all':'standard,speeding,switching',tunnel:'standard,tunnel,standard,tunnel',
};
for(const card of COLT_REGULAR_ROUND_FIXTURES){assert(card.turns24.join(',')===exact24[card.id],`2-4 schedule drift: ${card.id}`);assert(card.turns56.join(',')===exact56[card.id],`5-6 schedule drift: ${card.id}`);}
assert(COLT_STATION_ROUND_FIXTURES.map(x=>x.event).sort().join(',')==='hostage_conductor,marshal_revenge,pickpocketing','Station event selection drift');
for(const card of COLT_STATION_ROUND_FIXTURES)assert(card.turns.join(',')==='standard,standard,tunnel,standard',`Station schedule drift: ${card.id}`);

{
  const s=initColtGame('FIXTURE-4',bases(4),seeded(7));
  assert(s.roundDeck.length===5,'Round deck must contain five cards');assert(s.roundDeck.slice(0,4).every(x=>x.band==='2-4'),'First four cards must use the 2-4 deck');assert(s.roundDeck[4]!.band==='station','Station card must be last');
  const manifests=Object.entries(s.lootBySpace).filter(([space])=>space.endsWith(':inside')&&Number(space.split(':')[0])<s.trainCars-1).map(([,loot])=>({purses:loot.filter(x=>x.type==='purse').length,jewels:loot.filter(x=>x.type==='jewel').length}));
  for(const manifest of manifests)assert(COLT_CAR_MANIFESTS.some(x=>x.purses===manifest.purses&&x.jewels===manifest.jewels),'Car does not match a printed loot manifest');
  const publicState=toColtPublicState(s);assert(Object.values(publicState.lootBySpace).flat().filter(x=>x.type==='purse').every(x=>x.value===null),'Floor purse values leaked publicly');
}

{
  const s=initColtGame('FIXTURE-2',bases(2),seeded(11));assert(s.phase==='team_selection','Two-player game must begin with the official paired-team choice');assert(s.availableTeams.length===3,'Exactly three random official teams must be offered');
  for(let i=0;i<2;i++){const chooser=s.turnOrder[(s.firstIndex+s.teamSelectionStep)%2]!,result=chooseColtTeam(s,chooser,0,s.revision);assert(result.ok,'Team choice rejected');}
  assert(String(s.phase)==='team_setup','Team choice must advance to secret formation');assert(s.trainCars===4,'Two-player train must have three cars plus locomotive');
  for(const id of s.turnOrder){const result=assignColtStart(s,id,id==='p0'?0:1,s.revision);assert(result.ok,'Starting formation rejected');}
  assert(String(s.phase)==='reserve_card','Two-player round must include reserve step');
  for(const id of s.turnOrder){const p=s.players.get(id)!;assert(p.deck.length===11,'Two-player action deck must contain 11 cards');const shoot=p.deck.find(x=>x.action==='shoot')!;const result=reserveColtCard(s,id,shoot.id,s.revision);assert(result.ok,'Reserve rejected');}
  assert(String(s.phase)==='programming','Reserve step did not advance');
  for(const p of s.players.values()){const expected=p.characters.includes('doc')?8:7;assert(p.hand.length===expected,'Reserved card plus official round hand count is wrong');}
  const actor=currentProgrammingPlayerId(s)!,p=s.players.get(actor)!,shoot=p.hand.find(x=>x.action==='shoot')!,cover=p.hand.find(x=>x.ownerBandit!==shoot.ownerBandit&&x.action!=='bullet'&&x.action!=='marshal')!;
  const result=programColt(s,actor,shoot.id,false,s.revision,cover.id);assert(result.ok,'Legal Cover play rejected');assert(s.program.length===2&&s.program[1]!.cover,'Cover must add the other bandit action without consuming another turn');
}

{
  const s=initColtGame('FIXTURE-POWERS',bases(3),seeded(21));s.firstIndex=0;s.currentRoundCard={...s.currentRoundCard,turns:['standard'],event:'none'};s.slots=1;s.slot=1;s.turnIndex=0;s.programStepIndex=0;
  const attacker=s.players.get('p0')!,belle=s.players.get('p1')!,other=s.players.get('p2')!;attacker.characters[0]='cheyenne';belle.characters[0]='belle';other.characters[0]='doc';for(const p of [attacker,belle,other])p.positions[0]={carIndex:0,level:'inside'};
  let punch=attacker.hand.find(x=>x.action==='punch');if(!punch){const index=attacker.deck.findIndex(x=>x.action==='punch');punch=attacker.deck.splice(index,1)[0]!;attacker.hand.push(punch);}assert(programColt(s,'p0',punch.id,false,s.revision).ok,'Cheyenne Punch could not be programmed');assert(programColt(s,'p1',undefined,true,s.revision).ok,'Belle draw failed');assert(programColt(s,'p2',undefined,true,s.revision).ok,'Other draw failed');
  assert(s.phase==='pending_choice'&&s.pending?.action==='punch','Punch did not reach target selection');assert(s.pending.options.every(x=>x.id.startsWith('p2:')),'Belle must be excluded while another legal punch target exists');
  assert(chooseColt(s,'p0',s.pending.options[0]!.id,s.revision).ok,'Punch target rejected');assert(s.pendingEvent?.kind==='cheyenne'&&s.pending?.options.some(x=>x.id==='drop'),'Cheyenne must be offered the optional purse pickup');assert(chooseColt(s,'p0','drop',s.revision).ok,'Cheyenne decline rejected');assert((s.lootBySpace['0:inside']??[]).some(x=>x.id.startsWith('start-2')),'Declined Cheyenne purse must remain in the punched bandit’s former space');
}

let commands=0,normal=0,departures=0;
const coverage=new Set<string>();
for(const departure of [false,true])for(let count=2;count<=6;count++)for(let run=0;run<50;run++){
  const random=seeded(210926+count*10000+run+(departure?100000:0));
  const s=initialise(`SIM-${count}-${run}`,bases(count),random);let guard=0,left=false;
  const leaveRound=1+run%5;
  const archiveSnapshots=new Map<string,string>();
  while(s.status==='playing'&&guard++<3000){validateColt(s);assertions++;
    const publicState=toColtPublicState(s);
    coverage.add(`phase:${s.phase}`);coverage.add(`event:${s.currentRoundCard.event}`);
    assert(publicState.players.length===count,'Historical roster shrank');assert(publicState.initialPlayerCount===count,'Original count changed');
    for(const p of s.players.values()){
      const privateState=toColtPrivateState(s,p.playerId);
      assert(privateState.roomCode===publicState.roomCode&&privateState.revision===publicState.revision,'Projection identity/version mismatch');
      if(p.forfeited)assert(!privateState.canProgram&&!privateState.canChoose&&!privateState.canReserve,'Forfeited action capability');
      if(!s.turnOrder.includes(p.playerId)){
        const value=JSON.stringify(p),prior=archiveSnapshots.get(p.playerId);if(prior)assert(value===prior,'Archived seat changed');else archiveSnapshots.set(p.playerId,value);
      }
    }
    if(departure&&!left&&s.round>=leaveRound&&(run%2===0||s.phase==='pending_choice')){
      const id=s.pending?.playerId??currentProgrammingPlayerId(s)??s.turnOrder[run%s.turnOrder.length]!;
      const result=forfeitColtPlayers(s,[id],s.revision);assert(result.ok,'Forfeit rejected');left=true;
      if(String(s.status)==='game_over')break;
    }
    settleColtAutopilot(s);
    if(s.phase==='character_selection'){const candidates=s.turnOrder.filter(id=>toColtPrivateState(s,id).canChooseCharacter),id=candidates[Math.floor(random()*candidates.length)]!;assert(chooseColtCharacter(s,id,s.availableCharacters[Math.floor(random()*s.availableCharacters.length)]!,s.revision).ok,'Character selection failed');}
    else if(s.phase==='team_selection'){const id=s.turnOrder[(s.firstIndex+s.teamSelectionStep)%s.turnOrder.length]!,result=chooseColtTeam(s,id,Math.floor(random()*s.availableTeams.length),s.revision);if(!result.ok)throw new Error(result.reason);}
    else if(s.phase==='team_setup'){const id=s.turnOrder.find(x=>!s.players.get(x)!.setupComplete)!;const result=assignColtStart(s,id,run%2,s.revision);if(!result.ok)throw new Error(result.reason);}
    else if(s.phase==='reserve_card'){const id=s.turnOrder.find(x=>!s.players.get(x)!.reserveComplete)!;const options=toColtPrivateState(s,id).reserveOptions;const result=reserveColtCard(s,id,options[Math.floor(random()*options.length)]!.id,s.revision);if(!result.ok)throw new Error(result.reason);}
    else if(s.phase==='programming'){const id=currentProgrammingPlayerId(s)!,mine=toColtPrivateState(s,id),cards=mine.hand.filter(c=>c.action!=='bullet'),card=cards[Math.floor(random()*cards.length)];const draw=!card||random()<0.1;
      let cover:string|undefined;if(!draw&&card.action==='shoot'&&s.twoBanditMode&&publicState.turnType==='standard'&&random()<0.6)cover=cards.find(c=>c.ownerBandit!==card.ownerBandit&&c.action!=='marshal')?.id;
      coverage.add(`action:${draw?'draw':card.action}`);if(cover)coverage.add('cover');
      const result=programColt(s,id,draw?undefined:card.id,draw,s.revision,cover,!draw&&mine.canHideFirstAction&&!cover?random()<0.5:undefined);if(!result.ok)throw new Error(result.reason);}
    else if(s.phase==='pending_choice'){const option=s.pending!.options[Math.floor(random()*s.pending!.options.length)]!;if(s.pendingEvent)coverage.add(s.pendingEvent.kind);const result=chooseColt(s,s.pending!.playerId,option.id,s.revision);if(!result.ok)throw new Error(result.reason);}
    commands++;settleColtAutopilot(s);
  }
  assert(s.status==='game_over'&&s.winnerPlayerIds.length>0,`Colt stalled ${count}/${run}`);
  assert(s.winnerPlayerIds.every(id=>!s.players.get(id)!.forfeited),'Departed winner');validateColt(s);
  if(departure){assert(left,'Departure campaign missed departure');departures++;}else{assert(s.round===5&&s.endReason==='score','Normal match did not finish five rounds');normal++;}
}
console.log(`COLT EXPRESS SIM PASS: ${normal} normal five-round games + ${departures} departure games, ${commands} commands, ${assertions} assertions. Coverage: ${[...coverage].sort().join(', ')}`);
