import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignColtStart, chooseColt, chooseColtCharacter, chooseColtTeam, COLT_CAR_MANIFESTS, COLT_REGULAR_ROUND_FIXTURES, currentProgrammingPlayerId, finalColtScore, forfeitColtPlayers, initColtGame as initialise, programColt, reserveColtCard, settleColtAutopilot, validateColt, type ColtServerState } from '../../src/game/colt-express/engine.js';
import { toColtPrivateState, toColtPublicState } from '../../src/game/colt-express/publicState.js';
import type { ColtAction, ColtCharacter, ColtRoundEvent } from '@zuychin-arcade/types';

const bases = (count: number) => Array.from({ length: count }, (_, i) => ({ playerId: `p${i}`, displayName: `P${i}` }));

test('publisher six-car photo supports the three-purse/one-jewel car and complete six-seat inventory',()=>{
  // Strong publisher-photo inference; the adjacent printed jewel mark is partially obscured.
  assert.equal(COLT_CAR_MANIFESTS.some(car=>car.purses===3&&car.jewels===1),true);
  assert.equal(COLT_CAR_MANIFESTS.reduce((sum,car)=>sum+car.purses,0),12);
  assert.equal(COLT_CAR_MANIFESTS.reduce((sum,car)=>sum+car.jewels,0),6);
  const s=initialise('SIX-CAR-INVENTORY',bases(6),()=>0.4);
  const floor=Object.values(s.lootBySpace).flat();
  assert.equal(floor.filter(token=>token.type==='purse').length,12);
  assert.equal(floor.filter(token=>token.type==='jewel').length,6);
  assert.equal([...s.players.values()].flatMap(player=>player.lootByBandit.flat()).filter(token=>token.type==='purse').length,6);
  assert.equal(s.lootManifest.filter(token=>token.type==='purse').length,18);
  validateColt(s);
});
function initColtGame(...args: Parameters<typeof initialise>) {
  const s=initialise(...args);
  while(s.phase==='character_selection'){
    const id=s.turnOrder.find(id=>toColtPrivateState(s,id).canChooseCharacter)!;
    assert.equal(chooseColtCharacter(s,id,s.availableCharacters[0]!,s.revision).ok,true);
  }
  return s;
}
const snapshot = (s: ColtServerState) => JSON.stringify({...s, players:[...s.players]});
function character(s: ColtServerState, id: string, value: ColtCharacter) {
  const player = s.players.get(id)!;
  const other = [...s.players.values()].find(p => p.characters[0] === value);
  if (other) other.characters[0] = player.characters[0]!;
  player.characters[0] = value;
}
function cardInHand(s: ColtServerState, id: string, action: ColtAction) {
  const player = s.players.get(id)!;
  let card = player.hand.find(c => c.action === action);
  if (!card) { const index = player.deck.findIndex(c => c.action === action); card = player.deck.splice(index,1)[0]!; player.hand.push(card); }
  return card;
}
function checkpoint(action: ColtAction, count = 3, event: ColtRoundEvent = 'none') {
  const s = initColtGame('CANONICAL', bases(count), () => 0.37);
  s.firstIndex = 0;
  s.currentRoundCard = {...s.currentRoundCard, turns:['standard'], event}; s.slots = 1;
  const card = cardInHand(s,'p0',action);
  return {s, card};
}
function reveal(s: ColtServerState, action: ColtAction) {
  const card = cardInHand(s,'p0',action);
  assert.equal(programColt(s,'p0',card.id,false,s.revision).ok,true);
  while(s.phase === 'programming') assert.equal(programColt(s,currentProgrammingPlayerId(s)!,undefined,true,s.revision).ok,true);
}
function step(s: ColtServerState) {
  settleColtAutopilot(s);
  if (s.status === 'game_over') return;
  if(s.phase==='character_selection')assert.equal(chooseColtCharacter(s,s.turnOrder.find(id=>toColtPrivateState(s,id).canChooseCharacter)!,s.availableCharacters[0]!,s.revision).ok,true);
  else if (s.phase === 'team_selection') assert.equal(chooseColtTeam(s,s.turnOrder[(s.firstIndex+s.teamSelectionStep)%s.turnOrder.length]!,0,s.revision).ok,true);
  else if(s.phase === 'team_setup') assert.equal(assignColtStart(s,s.turnOrder.find(id=>!s.players.get(id)!.setupComplete)!,0,s.revision).ok,true);
  else if(s.phase === 'reserve_card') { const id=s.turnOrder.find(id=>!s.players.get(id)!.reserveComplete)!; assert.equal(reserveColtCard(s,id,toColtPrivateState(s,id).reserveOptions[0]!.id,s.revision).ok,true); }
  else if(s.phase === 'programming') { const id=currentProgrammingPlayerId(s)!; const card=toColtPrivateState(s,id).hand.find(c=>c.action!=='bullet'); assert.equal(programColt(s,id,card?.id,!card,s.revision).ok,true); }
  else if(s.pending) assert.equal(chooseColt(s,s.pending.playerId,s.pending.options[0]!.id,s.revision).ok,true);
  else assert.fail(`Unexpected phase ${s.phase}`);
  settleColtAutopilot(s); validateColt(s);
}
function until(s: ColtServerState, predicate:()=>boolean) {
  for(let guard=0;guard<3000&&!predicate();guard++) step(s);
  assert.equal(predicate(),true,'Bounded game progress');
}

for (const count of [2, 3]) test(`natural ${count}-player terminal log names the correct scoring unit`, () => {
  const s = initColtGame('TERMINAL-COPY', bases(count), () => 0.37);
  until(s, () => s.status === 'game_over');
  assert.equal(s.endReason, 'score');
  assert.equal(s.log.at(-1)!.text, count === 2
    ? 'The richest bandit team wins the robbery.'
    : 'The richest bandit wins the robbery.');
});

test('publisher Round Cards Summary shows four open Braking turns for 2–4 players', () => {
  assert.deepEqual(COLT_REGULAR_ROUND_FIXTURES.find(card => card.id === 'braking')!.turns24,
    ['standard', 'standard', 'standard', 'standard']);
});
test('publisher card face 115 shows Braking 5–6 with only its second turn concealed',()=>{
  assert.deepEqual(COLT_REGULAR_ROUND_FIXTURES.find(card=>card.id==='braking')!.turns56,['standard','tunnel','standard','standard']);
});
test('publisher card face 118 ends Take It All 2–4 clockwise, not switching',()=>{
  assert.deepEqual(COLT_REGULAR_ROUND_FIXTURES.find(card=>card.id==='take-it-all')!.turns24,['standard','tunnel','speeding','standard']);
});

test('Ghost may explicitly decline concealment on the first action', () => {
  const state = initColtGame('GHOST', bases(3), () => 0.4);
  const id = currentProgrammingPlayerId(state)!;
  const player = state.players.get(id)!;
  character(state,id,'ghost');
  state.currentRoundCard.turns[0] = 'standard';
  assert.equal(programColt(state, id, player.hand[0]!.id, false, state.revision, undefined, false).ok, true);
  assert.equal(state.program[0]!.faceUp, true);
});

for(const zone of ['deck','hand','reserved'] as const) test(`duplicate physical action in ${zone} is rejected`,()=>{
  const s=initColtGame('DUPLICATE',bases(3),()=>0.4), p=s.players.get('p0')!;
  const card=p.hand[0]!;
  if(zone==='reserved')p.reserved={...card};else p[zone].push({...card});
  assert.throws(()=>validateColt(s),/Duplicate physical card/);
});
for(const field of ['id','action','ownerBandit'] as const) test(`non-canonical action ${field} is rejected`,()=>{
  const s=initColtGame('IDENTITY',bases(3),()=>0.4), card=s.players.get('p0')!.hand[0]!;
  if(field==='id')card.id='invented';else if(field==='action')card.action=card.action==='rob'?'move':'rob';else card.ownerBandit=1;
  assert.throws(()=>validateColt(s));
});
test('loot duplicate, mutation and loss are rejected independently',()=>{
  for(const mode of ['duplicate','mutation','loss']){
    const s=initColtGame('LOOT',bases(3),()=>0.4), p=s.players.get('p0')!;
    if(mode==='duplicate')p.lootByBandit[0]!.push({...p.lootByBandit[0]![0]!});
    else if(mode==='mutation')p.lootByBandit[0]![0]!.value=999;else p.lootByBandit[0]!.pop();
    assert.throws(()=>validateColt(s),/Loot/);
  }
});
test('unplayed hands return to decks when execution begins',()=>{
  const {s}=checkpoint('move'); reveal(s,'move');
  assert.equal(s.phase,'pending_choice');
  assert.equal([...s.players.values()].every(p=>p.hand.length===0),true);validateColt(s);
});
test('Ghost first default hide, explicit face-up, lost after draw, and mandatory tunnel privacy',()=>{
  for(const mode of ['default','open','after-draw','tunnel']){
    const s=initColtGame('GHOST',bases(3),()=>0.4);s.firstIndex=0;character(s,'p0','ghost');
    s.currentRoundCard={...s.currentRoundCard,turns:mode==='tunnel'?['tunnel','standard']:['standard','standard']};s.slots=2;
    if(mode==='after-draw'){for(let i=0;i<3;i++)assert.equal(programColt(s,currentProgrammingPlayerId(s)!,undefined,true,s.revision).ok,true);}
    const p=s.players.get('p0')!,card=p.hand[0]!;
    if(mode==='after-draw'){const before=snapshot(s);assert.equal(programColt(s,'p0',card.id,false,s.revision,undefined,true).ok,false);assert.equal(snapshot(s),before);}
    assert.equal(programColt(s,'p0',card.id,false,s.revision,undefined,mode==='open'||mode==='tunnel'?false:undefined).ok,true);
    assert.equal(s.program[0]!.faceUp,mode==='open'||mode==='after-draw');
  }
});
test('speeding exposes first then second action even when drawing',()=>{
  const s=initColtGame('SPEED',bases(3),()=>0.4);s.currentRoundCard={...s.currentRoundCard,turns:['speeding']};s.slots=1;
  const id=currentProgrammingPlayerId(s)!;
  assert.equal(toColtPublicState(s).programmingActionNumber,1);
  assert.equal(programColt(s,id,undefined,true,s.revision).ok,true);
  assert.equal(currentProgrammingPlayerId(s),id);assert.equal(toColtPublicState(s).programmingActionNumber,2);
});
test('unknown, missing, stale revision and mixed programming inputs do not mutate',()=>{
  const s=initColtGame('INVALID',bases(3),()=>0.4),id=currentProgrammingPlayerId(s)!,card=s.players.get(id)!.hand[0]!;
  for(const operation of [()=>programColt(s,id,card.id,false),()=>programColt(s,id,card.id,false,-1),()=>programColt(s,id,card.id,true,s.revision),()=>programColt(s,'unknown',card.id,false,s.revision),()=>forfeitColtPlayers(s,['unknown'],s.revision)]){
    const before=snapshot(s);assert.equal(operation().ok,false);assert.equal(snapshot(s),before);
  }
});
for(const count of [2,3,4,5,6]) test(`${count}-seat simultaneous all-forfeit has no winner and stays immutable`,()=>{
  const s=initColtGame('ALL-LEFT',bases(count),()=>0.4);
  assert.equal(forfeitColtPlayers(s,[...s.turnOrder],s.revision).ok,true);
  assert.equal(s.status,'game_over');assert.equal(s.endReason,'forfeit');assert.deepEqual(s.winnerPlayerIds,[]);
  assert.equal(toColtPublicState(s).players.every(p=>p.finalScore===null),true);
  const before=snapshot(s);assert.equal(forfeitColtPlayers(s,[...s.turnOrder],s.revision).ok,true);assert.equal(snapshot(s),before);validateColt(s);
});
for(const count of [2,3,4,5,6]) test(`${count}-seat batch leaves one genuine winner`,()=>{
  const s=initColtGame('LAST',bases(count),()=>0.4);
  assert.equal(forfeitColtPlayers(s,s.turnOrder.slice(1),s.revision).ok,true);
  assert.deepEqual(s.winnerPlayerIds,['p0']);assert.equal(finalColtScore(s,'p1'),null);validateColt(s);
});
test('selection forfeit skips without drawing or programming and preserves committed card',()=>{
  const {s,card}=checkpoint('move',4);
  assert.equal(programColt(s,'p0',card.id,false,s.revision).ok,true);
  const p=s.players.get('p1')!,beforeHand=p.hand.map(c=>c.id),beforeProgram=s.program.map(x=>x.card.id);
  assert.equal(forfeitColtPlayers(s,['p1'],s.revision).ok,true);
  assert.equal(currentProgrammingPlayerId(s),'p2');assert.deepEqual(p.hand.map(c=>c.id),beforeHand);assert.deepEqual(s.program.map(x=>x.card.id),beforeProgram);
  assert.equal(toColtPrivateState(s,'p1').canProgram,false);
  until(s,()=>s.round===2);
  assert.equal(s.turnOrder.includes('p1'),false);assert.equal(toColtPublicState(s).players.length,4);assert.equal(p.hand.length,0);
  assert.equal(s.twoBanditMode,false);assert.equal(s.trainCars,5);validateColt(s);
});
test('already-programmed departed action resolves, then archive remains untouched',()=>{
  const {s}=checkpoint('move',3);reveal(s,'move');
  assert.equal(s.pending?.playerId,'p0');
  assert.equal(forfeitColtPlayers(s,['p0'],s.revision).ok,true);
  assert.equal(s.round,2);assert.equal(s.turnOrder.includes('p0'),false);assert.equal(s.players.get('p0')!.positions[0]!.carIndex,1);
  const archive=JSON.stringify(s.players.get('p0'));
  until(s,()=>s.status==='game_over');assert.equal(JSON.stringify(s.players.get('p0')),archive);
  assert.equal(s.winnerPlayerIds.includes('p0'),false);assert.equal(s.twoBanditMode,false);assert.equal(s.initialPlayerCount,3);
});
test('forfeited first player transfers clockwise before order filters',()=>{
  const {s}=checkpoint('move',4);s.firstIndex=1;
  assert.equal(forfeitColtPlayers(s,['p1','p2'],s.revision).ok,true);
  until(s,()=>s.round===2);
  assert.deepEqual(s.turnOrder,['p0','p3']);assert.equal(s.turnOrder[s.firstIndex],'p3');assert.equal(s.twoBanditMode,false);
});
test('public/private deep copies cannot mutate cards, history or hidden purse values',()=>{
  const s=initColtGame('PRIVACY',bases(3),()=>0.4);const before=snapshot(s),pub=toColtPublicState(s),priv=toColtPrivateState(s,'p0');
  assert.equal(pub.roomCode,priv.roomCode);assert.equal(pub.revision,priv.revision);
  assert.equal(pub.players.every(p=>p.lootValue===null&&p.finalScore===null),true);
  assert.equal(Object.values(pub.lootBySpace).flat().filter(x=>x.type==='purse').every(x=>x.value===null),true);
  pub.players[0]!.positions[0]!.carIndex=999;pub.roundCard.turns[0]='speeding';pub.turnOrder.length=0;priv.hand[0]!.id='tampered';priv.lootByBandit[0]![0]!.value=999;
  assert.equal(snapshot(s),before);
});

test('roof shots use nearest occupied car and Belle only when no alternative exists',()=>{
  const {s}=checkpoint('shoot',4);character(s,'p0','doc');character(s,'p1','belle');
  for(const [id,car] of [['p0',0],['p1',1],['p2',1],['p3',2]] as const)s.players.get(id)!.positions[0]={carIndex:car,level:'roof'};
  reveal(s,'shoot');assert.deepEqual(s.pending!.options.map(o=>o.id),['p2:0']);
});
test('Tuco adds other-floor targets in the same car',()=>{
  const {s}=checkpoint('shoot');character(s,'p0','tuco');
  s.players.get('p0')!.positions[0]={carIndex:0,level:'inside'};
  s.players.get('p1')!.positions[0]={carIndex:0,level:'roof'};
  s.players.get('p2')!.positions[0]={carIndex:2,level:'roof'};
  reveal(s,'shoot');assert.deepEqual(s.pending!.options.map(o=>o.id),['p1:0']);
});
test('Django pushes an inside victim into the Marshal and deals both conserved bullets',()=>{
  const {s}=checkpoint('shoot');character(s,'p0','django');character(s,'p1','doc');
  s.players.get('p0')!.positions[0]={carIndex:1,level:'inside'};
  s.players.get('p1')!.positions[0]={carIndex:2,level:'inside'};
  s.players.get('p2')!.positions[0]={carIndex:0,level:'roof'};
  reveal(s,'shoot');assert.equal(chooseColt(s,'p0','p1:0',s.revision).ok,true);
  assert.deepEqual(s.players.get('p1')!.positions[0],{carIndex:3,level:'roof'});
  assert.equal(s.players.get('p1')!.receivedBullets,2);assert.equal(s.players.get('p0')!.gunslingerShots,1);assert.equal(s.neutralBulletsRemaining,12);validateColt(s);
});
test('Cheyenne escrow remains conserved on current-round forfeit and immediate no-winner termination',()=>{
  for(const terminal of [false,true]){
    const {s}=checkpoint('punch',4);character(s,'p0','cheyenne');character(s,'p1','doc');
    for(const p of s.players.values())p.positions[0]={carIndex:0,level:'inside'};
    reveal(s,'punch');assert.equal(chooseColt(s,'p0',s.pending!.options.find(o=>o.id.startsWith('p1:'))!.id,s.revision).ok,true);
    assert.equal(s.pendingEvent?.kind,'cheyenne');
    assert.equal(forfeitColtPlayers(s,terminal?[...s.turnOrder]:['p0'],s.revision).ok,true);
    assert.equal(s.pendingEvent,null);assert.equal(s.lootBySpace['0:inside']!.some(x=>x.id==='start-1-0'),true);
    assert.equal(s.status,terminal?'game_over':'playing');validateColt(s);
  }
});
test('pickpocket optional event choice forfeits without taking a fresh purse',()=>{
  const {s}=checkpoint('move',4,'pickpocketing');
  for(let i=0;i<4;i++)s.players.get(`p${i}`)!.positions[0]={carIndex:i,level:'inside'};
  const p=s.players.get('p0')!,token=p.lootByBandit[0]!.pop()!;s.lootBySpace['0:inside']!.push(token);
  for(let i=0;i<4;i++)assert.equal(programColt(s,currentProgrammingPlayerId(s)!,undefined,true,s.revision).ok,true);
  assert.equal(s.pendingEvent?.kind,'pickpocket');assert.equal(s.pending?.playerId,'p0');
  assert.equal(forfeitColtPlayers(s,['p0'],s.revision).ok,true);assert.equal(p.lootByBandit[0]!.length,0);validateColt(s);
});
for(const event of ['braking','swivel_arm','angry_marshal','passengers_rebellion','take_it_all','marshal_revenge','hostage_conductor'] as const) test(`canonical end-round ${event} effect and conservation`,()=>{
  const {s}=checkpoint('move',3,event),p=s.players.get('p0')!;
  p.positions[0]={carIndex:event==='hostage_conductor'||event==='marshal_revenge'||event==='angry_marshal'?s.marshalCar:1,level:'roof'};
  s.players.get('p1')!.positions[0]={carIndex:0,level:'inside'};
  s.players.get('p2')!.positions[0]={carIndex:0,level:'roof'};
  for(let i=0;i<3;i++)assert.equal(programColt(s,currentProgrammingPlayerId(s)!,undefined,true,s.revision).ok,true);
  assert.equal(s.round,2);
  if(event==='braking')assert.equal(p.positions[0]!.carIndex,2);
  if(event==='swivel_arm')assert.equal(p.positions[0]!.carIndex,0);
  if(event==='angry_marshal'){assert.equal(p.receivedBullets,1);assert.equal(s.marshalCar,2);}
  if(event==='passengers_rebellion')assert.equal(s.players.get('p1')!.receivedBullets,1);
  if(event==='take_it_all')assert.equal(s.lootBySpace[`${s.marshalCar}:inside`]!.some(t=>t.id==='strongbox-2'),true);
  if(event==='marshal_revenge')assert.equal(p.lootByBandit[0]!.length,0);
  if(event==='hostage_conductor')assert.equal(p.lootByBandit[0]!.reduce((sum,t)=>sum+t.value,0),500);
  validateColt(s);
});
test('neutral shortage preserves the undistributed remainder for a later single encounter',()=>{
  const {s}=checkpoint('move',3,'passengers_rebellion');
  const holder=s.players.get('p2')!;
  for(let i=1;i<=12;i++)holder.deck.push({id:`neutral-Marshal-1-${i}-p2-0-${i}`,action:'bullet',ownerBandit:0});
  holder.receivedBullets=12;s.neutralBulletsRemaining=1;holder.positions[0]!.level='roof';
  validateColt(s);
  for(let i=0;i<3;i++)assert.equal(programColt(s,currentProgrammingPlayerId(s)!,undefined,true,s.revision).ok,true);
  assert.equal(s.neutralBulletsRemaining,1);assert.equal(s.players.get('p0')!.receivedBullets,0);assert.equal(s.players.get('p1')!.receivedBullets,0);
  s.firstIndex=0;s.currentRoundCard={...s.currentRoundCard,turns:['standard'],event:'none'};s.slots=1;
  s.players.get('p0')!.positions[0]={carIndex:s.marshalCar,level:'roof'};
  reveal(s,'floor');assert.equal(s.neutralBulletsRemaining,0);assert.equal(s.players.get('p0')!.receivedBullets,1);validateColt(s);
});

for(const count of [3,4,5,6])test(`${count}-player character choice is unique, owned and deals exactly once after all choices`,()=>{
  const s=initialise('CHOOSE',bases(count),()=>0.4),initial=toColtPublicState(s);
  assert.equal(s.phase,'character_selection');assert.equal(initial.firstPlayerId,null);
  assert.equal(initial.players.every(p=>p.character===null&&!p.characterChosen&&!p.characters.length&&!p.positions.length&&!p.handCount),true);
  const revision=s.revision;
  assert.equal(chooseColtCharacter(s,'p1','doc',revision).ok,true);
  let before=snapshot(s);assert.equal(chooseColtCharacter(s,'p0','doc',revision).ok,false);assert.equal(snapshot(s),before);
  assert.equal(chooseColtCharacter(s,'p0','doc',s.revision).ok,false);assert.equal(snapshot(s),before);
  assert.equal(chooseColtCharacter(s,'p1','ghost',s.revision).ok,false);assert.equal(snapshot(s),before);
  assert.equal([...s.players.values()].every(p=>!p.hand.length),true);
  while(s.phase==='character_selection')step(s);
  assert.equal(s.phase,'programming');assert.equal(new Set([...s.players.values()].flatMap(p=>p.characters)).size,count);
  assert.equal(s.players.get('p1')!.hand.length,7);
  for(const p of s.players.values())assert.equal(p.hand.length,p.characters[0]==='doc'?7:6);
  s.turnOrder.forEach((id,i)=>assert.equal(s.players.get(id)!.positions[0]!.carIndex,((i-s.firstIndex+count)%count)%2));
  before=snapshot(s);assert.equal(chooseColtCharacter(s,'p0','belle',s.revision).ok,false);assert.equal(snapshot(s),before);validateColt(s);
});
test('setup forfeit unblocks chosen survivors without changing original mode, train or count',()=>{
  const s=initialise('SETUP-LEFT',bases(3),()=>0.4);
  assert.equal(chooseColtCharacter(s,'p0','ghost',s.revision).ok,true);assert.equal(chooseColtCharacter(s,'p1','doc',s.revision).ok,true);
  assert.equal(forfeitColtPlayers(s,['p2'],s.revision).ok,true);
  assert.equal(s.phase,'programming');assert.deepEqual(s.turnOrder,['p0','p1']);assert.equal(s.twoBanditMode,false);assert.equal(s.initialPlayerCount,3);assert.equal(s.trainCars,4);
  assert.equal(toColtPrivateState(s,'p2').canChooseCharacter,false);assert.equal(s.players.get('p2')!.hand.length,0);
  until(s,()=>s.status==='game_over');assert.equal(s.winnerPlayerIds.includes('p2'),false);
});
test('chosen forfeited identity remains unavailable while unchosen survivors finish setup',()=>{
  const s=initialise('CHOSEN-LEFT',bases(4),()=>0.4);
  assert.equal(chooseColtCharacter(s,'p0','doc',s.revision).ok,true);assert.equal(forfeitColtPlayers(s,['p0'],s.revision).ok,true);
  assert.equal(s.availableCharacters.includes('doc'),false);const before=snapshot(s);
  assert.equal(chooseColtCharacter(s,'p1','doc',s.revision).ok,false);assert.equal(snapshot(s),before);
  until(s,()=>s.phase==='programming');assert.equal(toColtPublicState(s).players.find(p=>p.playerId==='p0')!.character,'doc');validateColt(s);
});
test('terminal setup forfeits never expose unplaced placeholder bandits',()=>{
  for(const chosen of [false,true]){
    const s=initialise('SETUP-TERMINAL',bases(3),()=>0.4);
    if(chosen)assert.equal(chooseColtCharacter(s,'p0','doc',s.revision).ok,true);
    assert.equal(forfeitColtPlayers(s,['p1','p2'],s.revision).ok,true);
    const pub=toColtPublicState(s);
    assert.equal(pub.players.every(p=>p.positions.length===0),true);
    assert.equal(pub.players.filter(p=>!p.characterChosen).every(p=>p.character===null&&p.characters.length===0),true);
  }
});
test('authoritative movement, Marshal and Punch options use board destination names',()=>{
  const move=checkpoint('move',4).s;
  move.players.get('p0')!.positions[0]={carIndex:1,level:'roof'};
  reveal(move,'move');
  assert.equal(move.pending!.options.find(option=>option.id==='0')!.label,'Caboose');
  assert.equal(move.pending!.options.find(option=>option.id==='2')!.label,'Car 3');
  assert.equal(move.pending!.options.find(option=>option.id==='4')!.label,'Locomotive');
  for(const car of [1,3]){
    const marshal=checkpoint('marshal',4).s;
    for(const player of marshal.players.values())player.positions[0]!.level='roof';
    marshal.marshalCar=car;reveal(marshal,'marshal');
    assert.equal(marshal.pending!.options.find(option=>option.id==='2')!.label,'Move Marshal to Car 3');
    assert.equal(marshal.pending!.options.find(option=>option.id===String(car===1?0:4))!.label,`Move Marshal to ${car===1?'Caboose':'Locomotive'}`);
  }
  for(const car of [1,3]){
    const punch=checkpoint('punch',4).s;
    for(const player of punch.players.values())player.positions[0]={carIndex:car,level:'roof'};
    reveal(punch,'punch');
    assert.equal(punch.pending!.options.some(option=>option.label.includes(`to ${car===1?'Caboose':'Locomotive'} · drop`)),true);
    assert.equal(punch.pending!.options.some(option=>option.label.includes('to Car 3 · drop')),true);
  }
});
