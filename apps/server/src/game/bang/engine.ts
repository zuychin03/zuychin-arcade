import { BANG_CHARACTERS, BANG_MAX_PLAYERS, BANG_MIN_PLAYERS, BANG_RULES_VERSION, BANG_WEAPON_RANGE, type BangBarrelSource, type BangCard, type BangCardName, type BangCharacterId, type BangCheckKind, type BangDrawCheck, type BangDrawChoiceKind, type BangPendingResponse, type BangPhase, type BangPlayOption, type BangRescue, type BangRole, type BangTeam } from '@zuychin-arcade/types';
import { createBangDeck, shuffleBang, type BangRandomSource } from './deck.js';

export type BangEngineResult = { ok: true } | { ok: false; reason: string };
const OK: BangEngineResult = { ok: true };
const fail = (reason: string): BangEngineResult => ({ ok: false, reason });
export interface BangServerPlayer {
  playerId: string; displayName: string; role: BangRole; character: BangCharacterId;
  health: number; maxHealth: number; alive: boolean; forfeited: boolean;
  hand: BangCard[]; equipment: BangCard[]; bangsPlayed: number;
}
interface DamageContext { playerId: string; amount: number; sourcePlayerId?: string; cause: BangRescue['cause']; }
export interface BangServerState {
  gameId: 'bang'; roomCode: string; rulesVersion: string; revision: number;
  status: 'playing' | 'game_over'; phase: BangPhase; turnNumber: number;
  turnOrder: string[]; activeIndex: number; players: Map<string, BangServerPlayer>;
  deck: BangCard[]; discard: BangCard[]; pending: BangPendingResponse | null;
  pendingDraw: { kind: BangDrawChoiceKind; playerId: string; options?: BangCard[] } | null;
  pendingCheck: BangDrawCheck | null; pendingRescue: BangRescue | null;
  pendingDiscardOrder: { playerId: string; cards: BangCard[]; reason: 'elimination' | 'penalty' } | null;
  damageContext: DamageContext | null; winner: BangTeam | null; abandoned: boolean;
  log: { id: number; text: string }[]; logSeq: number; rng: BangRandomSource;
}
const roleSets: Record<number, BangRole[]> = {
  4: ['sheriff', 'renegade', 'outlaw', 'outlaw'],
  5: ['sheriff', 'renegade', 'outlaw', 'outlaw', 'deputy'],
  6: ['sheriff', 'renegade', 'outlaw', 'outlaw', 'outlaw', 'deputy'],
  7: ['sheriff', 'renegade', 'outlaw', 'outlaw', 'outlaw', 'deputy', 'deputy'],
};
const blueCards = new Set<BangCardName>(['barrel', 'dynamite', 'scope', 'mustang', 'jail', 'volcanic', 'schofield', 'remington', 'rev_carabine', 'winchester']);
const manifest = new Map(createBangDeck(() => 0).map(c => [c.id, c]));
const log = (s: BangServerState, text: string) => { s.log.push({ id: ++s.logSeq, text }); };
const bump = (s: BangServerState) => { s.revision++; validateBangState(s); };
const active = (s: BangServerState) => s.players.get(s.turnOrder[s.activeIndex]!)!;
const alive = (s: BangServerState) => s.turnOrder.filter(id => s.players.get(id)!.alive);
const equipment = (p: BangServerPlayer, name: BangCardName) => p.equipment.find(c => c.name === name);
const stale = (s: BangServerState, revision?: number) => revision !== undefined && revision !== s.revision;
const staleError = () => fail('State changed; refresh and try again');
export function bangWeaponRange(p: BangServerPlayer) { return BANG_WEAPON_RANGE[p.equipment.find(c => c.name in BANG_WEAPON_RANGE)?.name ?? 'bang'] ?? 1; }
function clockwise(s: BangServerState, id: string) { const i = s.turnOrder.indexOf(id); return s.turnOrder.slice(i + 1).concat(s.turnOrder.slice(0, i)).filter(x => s.players.get(x)!.alive); }
function drawOne(s: BangServerState): BangCard | undefined {
  if (!s.deck.length && s.discard.length) { s.deck = shuffleBang(s.discard.splice(0), s.rng); log(s, 'The discard pile was reshuffled.'); }
  return s.deck.pop();
}
function drawCards(s: BangServerState, p: BangServerPlayer, count: number) {
  for (let i = 0; i < count; i++) { const card = drawOne(s); if (card) p.hand.push(card); }
}
function takeHandCard(p: BangServerPlayer, id: string) { const i = p.hand.findIndex(c => c.id === id); return i < 0 ? undefined : p.hand.splice(i, 1)[0]; }
function discardCard(s: BangServerState, p: BangServerPlayer, id: string) { const card = takeHandCard(p, id); if (card) s.discard.push(card); return card; }
function triggerEmpty(s: BangServerState, p: BangServerPlayer) {
  if (!p.alive || p.health <= 0 || p.character !== 'suzy_lafayette' || p.hand.length) return;
  if (s.pending?.kind === 'duel' && [s.pending.sourcePlayerId, s.pending.duelOpponentPlayerId].includes(p.playerId)) return;
  if (s.pending?.kind === 'general_store') return;
  drawCards(s, p, 1);
  if (p.hand.length) log(s, `${p.displayName} draws for Suzy Lafayette.`);
}
export function bangDistance(s: BangServerState, fromId: string, toId: string) {
  if (fromId === toId) return 0;
  const ids = alive(s), a = ids.indexOf(fromId), b = ids.indexOf(toId);
  if (a < 0 || b < 0) return 99;
  const from = s.players.get(fromId)!, to = s.players.get(toId)!;
  return Math.max(1, Math.min((b - a + ids.length) % ids.length, (a - b + ids.length) % ids.length)
    + Number(Boolean(equipment(to, 'mustang'))) + Number(to.character === 'paul_regret')
    - Number(Boolean(equipment(from, 'scope'))) - Number(from.character === 'rose_doolan'));
}
function clearPending(s: BangServerState) {
  s.discard.push(...(s.pending?.storeCards ?? []), ...(s.pendingCheck?.cards ?? []), ...(s.pendingDiscardOrder?.cards ?? []));
  // Kit's unrevealed cards remain private when an interrupted game ends.
  s.deck.push(...(s.pendingDraw?.options ?? []));
  s.pending = null; s.pendingDraw = null; s.pendingCheck = null; s.pendingRescue = null; s.pendingDiscardOrder = null; s.damageContext = null;
}
function evaluateWinner(s: BangServerState) {
  const living = [...s.players.values()].filter(p => p.alive);
  if ([...s.players.values()].every(p => p.forfeited)) { s.abandoned = true; s.winner = null; }
  else if (![...s.players.values()].find(p => p.role === 'sheriff')!.alive) s.winner = living.length === 1 && living[0]!.role === 'renegade' ? 'renegade' : 'outlaws';
  else if (!living.some(p => p.role === 'outlaw' || p.role === 'renegade')) s.winner = 'law';
  if (s.winner || s.abandoned) {
    if (s.pendingRescue) {
      const dying = s.players.get(s.pendingRescue.playerId)!;
      dying.alive = false; dying.health = 0;
      s.discard.push(...dying.hand, ...dying.equipment); dying.hand = []; dying.equipment = [];
      const survivors = [...s.players.values()].filter(p => p.alive);
      if (!s.abandoned && ![...s.players.values()].find(p => p.role === 'sheriff')!.alive) s.winner = survivors.length === 1 && survivors[0]!.role === 'renegade' ? 'renegade' : 'outlaws';
    }
    clearPending(s); s.status = 'game_over'; s.phase = 'game_over';
    log(s, s.abandoned ? 'Everyone left. The match was abandoned.' : s.winner === 'outlaws' ? 'The Outlaws win.' : `${s.winner === 'law' ? 'The law' : 'The Renegade'} wins.`);
  }
}
function finishEffect(s: BangServerState) {
  if (s.pending?.storeCards?.length) s.discard.push(...s.pending.storeCards);
  s.pending = null; s.phase = 'play';
  for (const p of s.players.values()) triggerEmpty(s, p);
  evaluateWinner(s);
  if (s.status === 'playing' && !active(s).alive) finishTurn(s);
}
function advanceQueue(s: BangServerState) {
  const pending = s.pending;
  if (!pending) { finishEffect(s); return; }
  if (pending.kind === 'duel') { finishEffect(s); return; }
  const next = pending.queue.find(id => s.players.get(id)!.alive);
  if (!next) { finishEffect(s); return; }
  pending.queue = pending.queue.slice(pending.queue.indexOf(next) + 1);
  pending.targetPlayerId = next; pending.missesPlayed = 0; pending.barrelsUsed = [];
  s.phase = pending.kind === 'general_store' ? 'general_store' : 'response';
}
function resumeDamage(s: BangServerState) {
  const context = s.damageContext;
  s.damageContext = null; s.pendingRescue = null;
  if (!context) return;
  if (context.cause === 'dynamite') {
    evaluateWinner(s);
    if (s.status === 'playing') { if (active(s).alive) resolveJail(s); else finishTurn(s); }
  } else advanceQueue(s);
}
function requestDiscardOrder(s: BangServerState, p: BangServerPlayer, cards: BangCard[], reason: 'elimination' | 'penalty') {
  if (cards.length > 1 && !p.forfeited) {
    s.pendingDiscardOrder = { playerId: p.playerId, cards, reason }; s.phase = 'discard_order'; return true;
  }
  s.discard.push(...cards); return false;
}
function eliminationRewards(s: BangServerState) {
  const context = s.damageContext;
  if (!context) return;
  const p = s.players.get(context.playerId)!, killer = context.sourcePlayerId ? s.players.get(context.sourcePlayerId) : undefined;
  if (killer?.alive && !killer.forfeited && killer.playerId !== p.playerId && !p.forfeited) {
    if (p.role === 'outlaw') drawCards(s, killer, 3);
    if (killer.role === 'sheriff' && p.role === 'deputy') {
      const cards = [...killer.hand, ...killer.equipment]; killer.hand = []; killer.equipment = [];
      if (requestDiscardOrder(s, killer, cards, 'penalty')) return;
      triggerEmpty(s, killer);
    }
  }
  resumeDamage(s);
}
function eliminate(s: BangServerState, p: BangServerPlayer) {
  p.alive = false; p.health = 0; s.pendingRescue = null;
  log(s, `${p.displayName} is eliminated as ${p.role}.`);
  const cards = [...p.hand, ...p.equipment]; p.hand = []; p.equipment = [];
  const sam = [...s.players.values()].find(x => x.alive && !x.forfeited && x.character === 'vulture_sam');
  if (sam) sam.hand.push(...cards);
  else if (requestDiscardOrder(s, p, cards, 'elimination')) return;
  eliminationRewards(s);
}
function finishDamage(s: BangServerState) {
  const context = s.damageContext!;
  const p = s.players.get(context.playerId)!;
  if (p.health <= 0) { eliminate(s, p); return; }
  if (p.character === 'bart_cassidy') drawCards(s, p, context.amount);
  if (p.character === 'el_gringo' && context.sourcePlayerId && context.sourcePlayerId !== p.playerId) {
    const source = s.players.get(context.sourcePlayerId)!;
    for (let i = 0; i < context.amount && source.hand.length; i++) { p.hand.push(source.hand.splice(Math.floor(s.rng() * source.hand.length), 1)[0]!); triggerEmpty(s, source); }
  }
  resumeDamage(s);
}
function canSave(s: BangServerState, p: BangServerPlayer) { return (alive(s).length > 2 && p.hand.some(c => c.name === 'beer')) || (p.character === 'sid_ketchum' && p.hand.length >= 2); }
function damage(s: BangServerState, playerId: string, amount: number, cause: BangRescue['cause'], sourcePlayerId?: string) {
  const p = s.players.get(playerId)!;
  s.damageContext = { playerId, amount, sourcePlayerId, cause }; p.health -= amount;
  log(s, `${p.displayName} loses ${amount} life${amount === 1 ? '' : ' points'}.`);
  if (p.health <= 0 && canSave(s, p)) {
    s.pendingRescue = { playerId, livesNeeded: 1 - p.health, sourcePlayerId: sourcePlayerId ?? null, cause }; s.phase = 'rescue';
  } else finishDamage(s);
}
function continueRescue(s: BangServerState) {
  const p = s.players.get(s.pendingRescue!.playerId)!;
  if (p.health > 0 || !canSave(s, p)) { s.pendingRescue = null; finishDamage(s); }
  else s.pendingRescue!.livesNeeded = 1 - p.health;
}
function resolveCheck(s: BangServerState, cardId?: string) {
  const check = s.pendingCheck!;
  const p = s.players.get(check.playerId)!;
  const card = check.cards.find(c => c.id === cardId) ?? check.cards[0];
  const success = check.kind === 'dynamite' ? card?.suit === 'spades' && Number(card.rank) >= 2 && Number(card.rank) <= 9 : card?.suit === 'hearts';
  s.discard.push(...check.cards.filter(c => c.id !== card?.id));
  if (card) { s.discard.push(card); log(s, `${p.displayName} checks ${check.kind}: ${card.rank} of ${card.suit} (${success ? 'match' : 'no match'}).`); }
  s.pendingCheck = null;
  if (check.kind === 'dynamite') {
    const dynamite = equipment(p, 'dynamite')!; p.equipment.splice(p.equipment.indexOf(dynamite), 1);
    if (success) { s.discard.push(dynamite); damage(s, p.playerId, 3, 'dynamite'); }
    else { const next = clockwise(s, p.playerId)[0]; if (next) s.players.get(next)!.equipment.push(dynamite); else s.discard.push(dynamite); resolveJail(s); }
  } else if (check.kind === 'jail') {
    const jail = equipment(p, 'jail')!; p.equipment.splice(p.equipment.indexOf(jail), 1); s.discard.push(jail);
    if (success) drawPhase(s); else { log(s, `${p.displayName} misses the turn in Jail.`); finishTurn(s); }
  } else {
    s.phase = 'response';
    if (success && s.pending) { s.pending.missesPlayed++; if (s.pending.missesPlayed >= s.pending.missesRequired) advanceQueue(s); }
  }
}
function startCheck(s: BangServerState, p: BangServerPlayer, kind: BangCheckKind) {
  const cards: BangCard[] = [];
  for (let i = 0; i < (p.character === 'lucky_duke' ? 2 : 1); i++) { const c = drawOne(s); if (c) cards.push(c); }
  s.pendingCheck = { playerId: p.playerId, kind, cards }; s.phase = 'draw_check';
  if (cards.length < 2) resolveCheck(s, cards[0]?.id);
}
function resolveJail(s: BangServerState) { const p = active(s); if (equipment(p, 'jail')) startCheck(s, p, 'jail'); else drawPhase(s); }
function drawPhase(s: BangServerState) {
  const p = active(s); s.phase = 'play';
  if (p.character === 'kit_carlson') {
    const options: BangCard[] = []; for (let i = 0; i < 3; i++) { const c = drawOne(s); if (c) options.push(c); }
    if (options.length > 2) { s.pendingDraw = { kind: 'kit_carlson', playerId: p.playerId, options }; s.phase = 'draw_choice'; return; }
    p.hand.push(...options);
  } else if (p.character === 'jesse_jones' && clockwise(s, p.playerId).some(id => s.players.get(id)!.hand.length)) {
    s.pendingDraw = { kind: 'jesse_jones', playerId: p.playerId }; s.phase = 'draw_choice'; return;
  } else if (p.character === 'pedro_ramirez' && s.discard.length) {
    s.pendingDraw = { kind: 'pedro_ramirez', playerId: p.playerId }; s.phase = 'draw_choice'; return;
  } else if (p.character === 'black_jack') {
    drawCards(s, p, 1); const second = drawOne(s);
    if (second) { p.hand.push(second); log(s, `${p.displayName} reveals ${second.name.replaceAll('_', ' ')}: ${second.rank} of ${second.suit} as the second draw.`); if (['hearts', 'diamonds'].includes(second.suit)) drawCards(s, p, 1); }
  } else drawCards(s, p, 2);
  log(s, `${p.displayName} begins the turn.`);
}
function startTurn(s: BangServerState) { const p = active(s); p.bangsPlayed = 0; s.phase = 'play'; if (equipment(p, 'dynamite')) startCheck(s, p, 'dynamite'); else resolveJail(s); }
function finishTurn(s: BangServerState) {
  if (s.status !== 'playing') return;
  const next = clockwise(s, active(s).playerId)[0];
  if (!next) { evaluateWinner(s); return; }
  s.activeIndex = s.turnOrder.indexOf(next); s.turnNumber++; startTurn(s);
}
export function initBangGame(roomCode: string, players: { playerId: string; displayName: string }[], rng: BangRandomSource = Math.random): BangServerState {
  if (players.length < BANG_MIN_PLAYERS || players.length > BANG_MAX_PLAYERS || new Set(players.map(p => p.playerId)).size !== players.length) throw new Error('BANG! requires 4–7 unique players');
  const roles = shuffleBang(roleSets[players.length]!, rng), chars = shuffleBang(Object.keys(BANG_CHARACTERS) as BangCharacterId[], rng);
  const s: BangServerState = { gameId: 'bang', roomCode, rulesVersion: BANG_RULES_VERSION, revision: 0, status: 'playing', phase: 'play', turnNumber: 1, turnOrder: players.map(p => p.playerId), activeIndex: 0, players: new Map(), deck: createBangDeck(rng), discard: [], pending: null, pendingDraw: null, pendingCheck: null, pendingRescue: null, pendingDiscardOrder: null, damageContext: null, winner: null, abandoned: false, log: [], logSeq: 0, rng };
  players.forEach((base, i) => { const character = chars[i]!, role = roles[i]!, maxHealth = BANG_CHARACTERS[character].health + Number(role === 'sheriff'); s.players.set(base.playerId, { ...base, character, role, maxHealth, health: maxHealth, alive: true, forfeited: false, hand: [], equipment: [], bangsPlayed: 0 }); });
  s.activeIndex = s.turnOrder.indexOf([...s.players.values()].find(p => p.role === 'sheriff')!.playerId);
  for (const p of s.players.values()) drawCards(s, p, p.health);
  startTurn(s); validateBangState(s); return s;
}
export function bangPlayOptions(s: BangServerState, id: string): BangPlayOption[] {
  const p = s.players.get(id);
  if (!p?.alive || s.status !== 'playing' || s.phase !== 'play' || active(s).playerId !== id) return [];
  return p.hand.flatMap(card => {
    const name = card.name === 'missed' && p.character === 'calamity_janet' ? 'bang' : card.name;
    if (name === 'missed') return [];
    if (name === 'bang' && p.bangsPlayed >= 1 && p.character !== 'willy_the_kid' && !equipment(p, 'volcanic')) return [];
    const needsTarget = ['bang', 'panic', 'cat_balou', 'duel', 'jail'].includes(name);
    const targets = needsTarget ? [...s.players.values()].filter(q => q.alive).flatMap(q => {
      if (name !== 'panic' && name !== 'cat_balou' && q.playerId === id) return [];
      if (name === 'bang' && bangDistance(s, id, q.playerId) > bangWeaponRange(p)) return [];
      if (name === 'panic' && bangDistance(s, id, q.playerId) > 1) return [];
      if (name === 'jail' && (q.role === 'sheriff' || equipment(q, 'jail'))) return [];
      const removal = name === 'panic' || name === 'cat_balou';
      const hand = removal && q.hand.some(c => q.playerId !== id || c.id !== card.id);
      const equipmentCardIds = removal ? q.equipment.map(c => c.id) : [];
      if (removal && !hand && !equipmentCardIds.length) return [];
      return [{ playerId: q.playerId, hand, equipmentCardIds }];
    }) : [];
    if (needsTarget && !targets.length) return [];
    if (blueCards.has(name) && name !== 'jail' && equipment(p, name)) return [];
    return [{ cardId: card.id, effectiveName: name, targets }];
  });
}
function pendingResponse(kind: BangPendingResponse['kind'], sourcePlayerId: string, targetPlayerId: string, queue: string[] = [], missesRequired = 1): BangPendingResponse {
  return { kind, sourcePlayerId, targetPlayerId, queue, missesRequired, missesPlayed: 0, barrelsUsed: [], response: kind === 'general_store' ? null : ['indians', 'duel'].includes(kind) ? 'bang' : 'missed' };
}
export function playBangCard(s: BangServerState, id: string, payload: { cardId?: string; targetPlayerId?: string; targetZone?: 'hand' | 'equipment'; targetCardId?: string; expectedRevision?: number }): BangEngineResult {
  if (stale(s, payload.expectedRevision)) return staleError();
  const option = bangPlayOptions(s, id).find(x => x.cardId === payload.cardId);
  if (!option) return fail('That card cannot be played now');
  const p = s.players.get(id)!, card = p.hand.find(c => c.id === payload.cardId)!, name = option.effectiveName;
  const targetOption = option.targets.find(x => x.playerId === payload.targetPlayerId), target = payload.targetPlayerId ? s.players.get(payload.targetPlayerId) : undefined;
  if (option.targets.length && !targetOption) return fail('Choose a legal target');
  if (name === 'panic' || name === 'cat_balou') {
    if (payload.targetZone === 'equipment' ? !targetOption!.equipmentCardIds.includes(payload.targetCardId ?? '') : !targetOption!.hand) return fail('Choose an available target card');
  }
  if (blueCards.has(name)) {
    takeHandCard(p, card.id);
    if (name === 'jail') target!.equipment.push(card);
    else { const old = name in BANG_WEAPON_RANGE ? p.equipment.find(c => c.name in BANG_WEAPON_RANGE) : undefined; if (old) { p.equipment.splice(p.equipment.indexOf(old), 1); s.discard.push(old); } p.equipment.push(card); }
  } else {
    discardCard(s, p, card.id);
    if (name === 'bang') { p.bangsPlayed++; s.pending = pendingResponse('bang', id, target!.playerId, [], p.character === 'slab_the_killer' ? 2 : 1); s.phase = 'response'; }
    else if (name === 'beer') { if (alive(s).length > 2) p.health = Math.min(p.maxHealth, p.health + 1); }
    else if (name === 'saloon') { for (const q of s.players.values()) if (q.alive) q.health = Math.min(q.maxHealth, q.health + 1); }
    else if (name === 'stagecoach' || name === 'wells_fargo') drawCards(s, p, name === 'stagecoach' ? 2 : 3);
    else if (name === 'general_store') {
      s.pending = pendingResponse(name, id, id, clockwise(s, id), 0); s.pending.storeCards = [];
      for (let i = 0; i < alive(s).length; i++) { const c = drawOne(s); if (c) s.pending.storeCards.push(c); }
      s.phase = 'general_store'; if (!s.pending.storeCards.length) finishEffect(s);
    } else if (name === 'gatling' || name === 'indians') { const queue = clockwise(s, id), first = queue.shift()!; s.pending = pendingResponse(name, id, first, queue); s.phase = 'response'; }
    else if (name === 'duel') { s.pending = pendingResponse(name, id, target!.playerId); s.pending.duelOpponentPlayerId = target!.playerId; s.phase = 'response'; }
    else if (name === 'panic' || name === 'cat_balou') {
      const taken = payload.targetZone === 'equipment' ? target!.equipment.splice(target!.equipment.findIndex(c => c.id === payload.targetCardId), 1)[0]! : target!.hand.splice(Math.floor(s.rng() * target!.hand.length), 1)[0]!;
      if (name === 'panic') p.hand.push(taken); else s.discard.push(taken);
      triggerEmpty(s, target!);
    }
  }
  log(s, `${p.displayName} plays ${name.replaceAll('_', ' ')}${target ? ` on ${target.displayName}` : ''}.`);
  triggerEmpty(s, p); bump(s); return OK;
}
export function bangBarrelOptions(s: BangServerState, id: string): BangBarrelSource[] {
  const p = s.players.get(id), pending = s.pending;
  if (!p?.alive || s.phase !== 'response' || pending?.targetPlayerId !== id || !['bang', 'gatling'].includes(pending.kind)) return [];
  return (['barrel', 'jourdonnais'] as const).filter(source => !pending.barrelsUsed.includes(source) && (source === 'barrel' ? Boolean(equipment(p, 'barrel')) : p.character === 'jourdonnais'));
}
export function useBangBarrel(s: BangServerState, id: string, source: BangBarrelSource, expectedRevision?: number): BangEngineResult {
  if (stale(s, expectedRevision)) return staleError();
  if (!bangBarrelOptions(s, id).includes(source)) return fail('That draw check is not available');
  s.pending!.barrelsUsed.push(source); startCheck(s, s.players.get(id)!, source); bump(s); return OK;
}
export function chooseBangCheck(s: BangServerState, id: string, cardId: string, expectedRevision?: number): BangEngineResult {
  if (stale(s, expectedRevision)) return staleError();
  if (s.phase !== 'draw_check' || s.pendingCheck?.playerId !== id || !s.pendingCheck.cards.some(c => c.id === cardId)) return fail('Choose one revealed draw-check card');
  resolveCheck(s, cardId); bump(s); return OK;
}
export function respondBang(s: BangServerState, id: string, cardId: string | undefined, expectedRevision?: number): BangEngineResult {
  if (stale(s, expectedRevision)) return staleError();
  const pending = s.pending, p = s.players.get(id);
  if (s.status !== 'playing' || s.phase !== 'response' || !p?.alive || !pending?.response || pending.targetPlayerId !== id) return fail('You are not the responder');
  if (!cardId) { damage(s, id, 1, pending.kind as BangRescue['cause'], pending.sourcePlayerId); bump(s); return OK; }
  const card = p.hand.find(c => c.id === cardId);
  if (!card || (card.name !== pending.response && !(p.character === 'calamity_janet' && ['bang', 'missed'].includes(card.name)))) return fail(`A ${pending.response === 'missed' ? 'Missed!' : 'BANG!'} response is required`);
  discardCard(s, p, cardId);
  if (pending.kind === 'duel') pending.targetPlayerId = id === pending.sourcePlayerId ? pending.duelOpponentPlayerId! : pending.sourcePlayerId;
  else { triggerEmpty(s, p); pending.missesPlayed++; if (pending.missesPlayed >= pending.missesRequired) advanceQueue(s); }
  bump(s); return OK;
}
export function rescueBang(s: BangServerState, id: string, cardId: string | undefined, expectedRevision?: number): BangEngineResult {
  if (stale(s, expectedRevision)) return staleError();
  if (s.phase !== 'rescue' || s.pendingRescue?.playerId !== id) return fail('You do not need a last-chance rescue');
  const p = s.players.get(id)!;
  if (!cardId) { eliminate(s, p); bump(s); return OK; }
  if (alive(s).length <= 2 || !p.hand.some(c => c.id === cardId && c.name === 'beer')) return fail('Choose a Beer from your hand');
  discardCard(s, p, cardId); p.health++; continueRescue(s); bump(s); return OK;
}
export function useSidKetchum(s: BangServerState, id: string, cardIds: string[], expectedRevision?: number): BangEngineResult {
  if (stale(s, expectedRevision)) return staleError();
  const p = s.players.get(id), rescue = s.phase === 'rescue' && s.pendingRescue?.playerId === id;
  if (!p?.alive || p.character !== 'sid_ketchum' || (!rescue && (active(s).playerId !== id || s.phase !== 'play'))) return fail('Sid can heal in his play phase or when saving his last life');
  if (p.health >= p.maxHealth) return fail('You are already at full health');
  if (cardIds.length !== 2 || new Set(cardIds).size !== 2 || cardIds.some(x => !p.hand.some(c => c.id === x))) return fail('Discard exactly two cards');
  cardIds.forEach(x => discardCard(s, p, x)); p.health++; if (rescue) continueRescue(s); bump(s); return OK;
}
export function chooseBangDiscardOrder(s: BangServerState, id: string, cardIds: string[], expectedRevision?: number): BangEngineResult {
  if (stale(s, expectedRevision)) return staleError();
  const choice = s.pendingDiscardOrder;
  if (s.phase !== 'discard_order' || choice?.playerId !== id || cardIds.length !== choice.cards.length || new Set(cardIds).size !== cardIds.length || cardIds.some(x => !choice.cards.some(c => c.id === x))) return fail('Order every card, with the final card on top');
  s.discard.push(...cardIds.map(x => choice.cards.find(c => c.id === x)!)); s.pendingDiscardOrder = null;
  if (choice.reason === 'elimination') eliminationRewards(s); else { triggerEmpty(s, s.players.get(id)!); resumeDamage(s); }
  bump(s); return OK;
}
export function chooseBangStoreCard(s: BangServerState, id: string, cardId: string, expectedRevision?: number): BangEngineResult {
  if (stale(s, expectedRevision)) return staleError();
  const pending = s.pending;
  if (s.phase !== 'general_store' || pending?.kind !== 'general_store' || pending.targetPlayerId !== id) return fail('It is not your General Store choice');
  const index = pending.storeCards!.findIndex(c => c.id === cardId);
  if (index < 0) return fail('Choose an available General Store card');
  s.players.get(id)!.hand.push(pending.storeCards!.splice(index, 1)[0]!);
  if (!pending.storeCards!.length) finishEffect(s); else advanceQueue(s);
  bump(s); return OK;
}
export function chooseBangDraw(s: BangServerState, id: string, payload: { useAbility?: boolean; targetPlayerId?: string; cardIds?: string[]; expectedRevision?: number }): BangEngineResult {
  if (stale(s, payload.expectedRevision)) return staleError();
  const choice = s.pendingDraw, p = s.players.get(id);
  if (s.phase !== 'draw_choice' || choice?.playerId !== id || !p?.alive) return fail('It is not your draw choice');
  if (choice.kind === 'kit_carlson') {
    const ids = payload.cardIds ?? [], options = choice.options!;
    if (ids.length !== 2 || new Set(ids).size !== 2 || ids.some(x => !options.some(c => c.id === x))) return fail('Choose exactly two of the three cards');
    p.hand.push(...ids.map(x => options.find(c => c.id === x)!)); s.deck.push(...options.filter(c => !ids.includes(c.id)));
  } else if (choice.kind === 'jesse_jones') {
    if (payload.useAbility) {
      const target = payload.targetPlayerId ? s.players.get(payload.targetPlayerId) : undefined;
      if (!target?.alive || target.playerId === id || !target.hand.length) return fail('Choose another player with a hand card');
      p.hand.push(target.hand.splice(Math.floor(s.rng() * target.hand.length), 1)[0]!); triggerEmpty(s, target);
    } else drawCards(s, p, 1);
    drawCards(s, p, 1);
  } else {
    if (payload.useAbility) { if (!s.discard.length) return fail('The discard pile is empty'); p.hand.push(s.discard.pop()!); }
    else drawCards(s, p, 1);
    drawCards(s, p, 1);
  }
  s.pendingDraw = null; s.phase = 'play'; log(s, `${p.displayName} begins the turn.`); bump(s); return OK;
}
export function endBangTurn(s: BangServerState, id: string, expectedRevision?: number): BangEngineResult {
  if (stale(s, expectedRevision)) return staleError();
  const p = s.players.get(id);
  if (!p?.alive || s.status !== 'playing' || active(s).playerId !== id || s.phase !== 'play') return fail('Cannot end the turn now');
  if (p.hand.length > p.health) s.phase = 'discard'; else finishTurn(s);
  bump(s); return OK;
}
export function discardBangCards(s: BangServerState, id: string, ids: string[], expectedRevision?: number): BangEngineResult {
  if (stale(s, expectedRevision)) return staleError();
  const p = s.players.get(id);
  if (!p?.alive || active(s).playerId !== id || s.phase !== 'discard') return fail('Cannot discard now');
  const required = p.hand.length - p.health;
  if (ids.length !== required || new Set(ids).size !== ids.length || ids.some(x => !p.hand.some(c => c.id === x))) return fail(`Discard exactly ${required} cards`);
  ids.forEach(x => discardCard(s, p, x)); triggerEmpty(s, p); finishTurn(s); bump(s); return OK;
}
export function forfeitBangPlayers(s: BangServerState, ids: string[]): boolean {
  const leaving = [...new Set(ids)].map(id => s.players.get(id)).filter((p): p is BangServerPlayer => Boolean(p && !p.forfeited));
  if (!leaving.length || s.status === 'game_over') return false;
  for (const p of leaving) { p.forfeited = true; p.alive = false; p.health = 0; log(s, `${p.displayName} forfeits and is eliminated without a killer reward.`); }
  // Mark the whole batch first so a departing Vulture Sam cannot inherit cards.
  const sam = [...s.players.values()].find(p => p.alive && p.character === 'vulture_sam');
  for (const p of leaving) { const cards = [...p.hand, ...p.equipment]; p.hand = []; p.equipment = []; if (sam) sam.hand.push(...cards); else s.discard.push(...cards); }
  evaluateWinner(s);
  if (s.winner || s.abandoned) { bump(s); return true; }
  if (s.pendingDraw && !s.players.get(s.pendingDraw.playerId)!.alive) { s.deck.push(...(s.pendingDraw.options ?? [])); s.pendingDraw = null; }
  if (s.pendingCheck && !s.players.get(s.pendingCheck.playerId)!.alive) { s.discard.push(...s.pendingCheck.cards); s.pendingCheck = null; }
  let resume = false;
  if (s.pendingRescue && !s.players.get(s.pendingRescue.playerId)!.alive) { s.pendingRescue = null; resume = true; }
  if (s.pendingDiscardOrder && s.players.get(s.pendingDiscardOrder.playerId)!.forfeited) { s.discard.push(...s.pendingDiscardOrder.cards); s.pendingDiscardOrder = null; resume = true; }
  if ([...s.players.values()].every(p => p.forfeited)) { evaluateWinner(s); bump(s); return true; }
  if (resume && s.damageContext) resumeDamage(s);
  if (s.status === 'playing' && !s.pendingRescue && !s.pendingDiscardOrder && !s.pendingCheck) {
    if (s.pending?.kind === 'duel' && (!s.players.get(s.pending.sourcePlayerId)!.alive || !s.players.get(s.pending.duelOpponentPlayerId!)!.alive)) finishEffect(s);
    else if (s.pending && !s.players.get(s.pending.targetPlayerId)!.alive) advanceQueue(s);
    else if (!s.pending) { evaluateWinner(s); if (s.status === 'playing' && !active(s).alive) finishTurn(s); }
  }
  bump(s); return true;
}
export function validateBangState(s: BangServerState) {
  if (s.players.size < 4 || s.players.size > 7 || s.turnOrder.length !== s.players.size || new Set(s.turnOrder).size !== s.players.size || s.turnOrder.some(id => !s.players.has(id))) throw new Error('Invalid player order');
  if (!Number.isInteger(s.activeIndex) || s.activeIndex < 0 || s.activeIndex >= s.turnOrder.length) throw new Error('Invalid active player');
  for (const p of s.players.values()) {
    if (p.health > p.maxHealth || (!p.alive && p.health !== 0) || (p.forfeited && p.alive)) throw new Error('Health invariant failed');
    if (!p.alive && (p.hand.length || p.equipment.length)) throw new Error('Eliminated player retains cards');
    if (p.alive && p.health <= 0 && s.pendingRescue?.playerId !== p.playerId) throw new Error('Lethal health without rescue');
    if (new Set(p.equipment.map(c => c.name)).size !== p.equipment.length || p.equipment.filter(c => c.name in BANG_WEAPON_RANGE).length > 1 || p.equipment.some(c => !blueCards.has(c.name))) throw new Error('Invalid equipment');
  }
  if (s.status === 'game_over' && (s.phase !== 'game_over' || s.pending || s.pendingDraw || s.pendingCheck || s.pendingRescue || s.pendingDiscardOrder || s.damageContext || (!s.winner && !s.abandoned))) throw new Error('Terminal state invariant failed');
  if (s.status === 'playing' && (s.phase === 'game_over' || s.winner || s.abandoned)) throw new Error('Playing state invariant failed');
  if ((s.phase === 'draw_choice') !== Boolean(s.pendingDraw) || (s.phase === 'draw_check') !== Boolean(s.pendingCheck) || (s.phase === 'rescue') !== Boolean(s.pendingRescue) || (s.phase === 'discard_order') !== Boolean(s.pendingDiscardOrder)) throw new Error('Choice phase invariant failed');
  if (['response', 'general_store'].includes(s.phase) && (!s.pending || !s.players.get(s.pending.targetPlayerId)?.alive)) throw new Error('Invalid responder');
  const cards = [...s.deck, ...s.discard, ...(s.pending?.storeCards ?? []), ...(s.pendingDraw?.options ?? []), ...(s.pendingCheck?.cards ?? []), ...(s.pendingDiscardOrder?.cards ?? []), ...[...s.players.values()].flatMap(p => [...p.hand, ...p.equipment])];
  if (cards.length !== 80 || new Set(cards.map(c => c.id)).size !== 80) throw new Error(`Card conservation failed: ${cards.length} cards, ${new Set(cards.map(c => c.id)).size} unique`);
  if (cards.some(c => { const expected = manifest.get(c.id); return !expected || expected.name !== c.name || expected.suit !== c.suit || expected.rank !== c.rank; })) throw new Error('Card manifest mismatch');
}
