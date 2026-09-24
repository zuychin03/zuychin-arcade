import type {
  FeedTheKrakenAction, FeedTheKrakenCharacter, FeedTheKrakenFaction, FeedTheKrakenJourney,
  FeedTheKrakenMapAction, FeedTheKrakenNavigationCard, FeedTheKrakenObservation, FeedTheKrakenPhase,
  FeedTheKrakenRitual, FeedTheKrakenTeam, FeedTheKrakenWindow,
} from '../../../../../packages/types/src/feed-the-kraken.js';
import { FEED_THE_KRAKEN_CHARACTERS, FEED_THE_KRAKEN_MAPS, FEED_THE_KRAKEN_RULES_VERSION, feedTheKrakenDeck } from '../../../../../packages/types/src/feed-the-kraken-constants.js';

export type FeedTheKrakenEngineResult = { ok: true } | { ok: false; reason: string };
export interface FeedTheKrakenServerPlayer {
  playerId: string; displayName: string; originalFaction: FeedTheKrakenFaction; faction: FeedTheKrakenFaction;
  knownPirateIds: string[]; knownLeaderId: string | null; guns: number; aboard: boolean; forfeited: boolean;
  departureReason: 'fed' | 'refused' | 'forfeit' | null; tongueless: boolean; conversionImmune: boolean;
  notFactions: FeedTheKrakenTeam[]; character: FeedTheKrakenCharacter; characterRevealed: boolean;
  resume: FeedTheKrakenNavigationCard[]; observations: FeedTheKrakenObservation[];
}
interface Effects {
  excluded: string[]; forced: string[]; doubled: string[]; strategist: string[]; instigatorReset: string[];
  extraDraw: string[]; redraw: string[]; cap: number | null; threshold: number | null; lieutenant: string | null;
}
export interface FeedTheKrakenServerState {
  gameId: 'feed_the_kraken'; roomCode: string; rulesVersion: string; revision: number; journey: FeedTheKrakenJourney;
  status: 'playing' | 'game_over'; phase: FeedTheKrakenPhase; window: FeedTheKrakenWindow | null; windowId: number;
  round: number; players: Record<string, FeedTheKrakenServerPlayer>; order: string[]; initialPlayerCount: number;
  captainId: string; lieutenantId: string | null; navigatorId: string | null; navigationCaptainId: string;
  navigationTeam: string[]; offDuty: string[]; nodeId: string; supplyCrossed: boolean; supplyGuns: number;
  draw: FeedTheKrakenNavigationCard[]; discard: FeedTheKrakenNavigationCard[];
  hands: Record<string, FeedTheKrakenNavigationCard[]>; submissions: Record<string, FeedTheKrakenNavigationCard>;
  offered: FeedTheKrakenNavigationCard[]; currentCard: FeedTheKrakenNavigationCard | null;
  bids: Record<string, number>; bidsRevealed: boolean; bidWindowId: number; bidWindowRevision: number;
  navigationResumePhase: 'navigation' | 'navigator' | null;
  priorityOrder: string[]; priorityIndex: number; tieCandidates: string[]; pendingPlayerId: string | null;
  mapAction: FeedTheKrakenMapAction | null; pendingEffect: 'mermaid' | 'telescope' | null;
  telescopeCard: FeedTheKrakenNavigationCard | null; telescopeReturn: 'priority' | 'finish' | null;
  rituals: FeedTheKrakenRitual[]; revealedRituals: FeedTheKrakenRitual[]; ritual: FeedTheKrakenRitual | null;
  ritualPendingIds: string[]; ritualWindowRevision: number; ritualGunCount: number;
  ritualDecision: { playerId?: string; allocations?: Record<string, number> } | null;
  effects: Effects; instigatorOwner: string | null;
  winner: FeedTheKrakenTeam | null; winnerIds: string[]; endReason: 'destination' | 'leader_fed' | 'no_participants' | null;
  log: Array<{ revision: number; message: string }>; rng: () => number;
}
const newEffects = (): Effects => ({ excluded: [], forced: [], doubled: [], strategist: [], instigatorReset: [], extraDraw: [], redraw: [], cap: null, threshold: null, lieutenant: null });
const reject = (reason: string): FeedTheKrakenEngineResult => ({ ok: false, reason });
const ok = (): FeedTheKrakenEngineResult => ({ ok: true });
export const feedTheKrakenTeam = (f: FeedTheKrakenFaction): FeedTheKrakenTeam => f === 'cult_leader' || f === 'cultist' ? 'cult' : f;
function shuffle<T>(s: FeedTheKrakenServerState, values: readonly T[]): T[] {
  const a = [...values];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.min(i, Math.floor(s.rng() * (i + 1))); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}
const alive = (s: FeedTheKrakenServerState) => s.order.filter((id) => s.players[id]!.aboard && !s.players[id]!.forfeited);
const eligibleCaptain = (s: FeedTheKrakenServerState, id: string) => alive(s).includes(id) && !s.players[id]!.tongueless;
const clockwise = (s: FeedTheKrakenServerState, start: string) => {
  const i = s.order.indexOf(start); return [...s.order.slice(i), ...s.order.slice(0, i)].filter((id) => alive(s).includes(id));
};
function log(s: FeedTheKrakenServerState, message: string) { s.log.push({ revision: s.revision + 1, message }); if (s.log.length > 150) s.log.shift(); }
function observe(s: FeedTheKrakenServerState, id: string, observation: Omit<FeedTheKrakenObservation, 'revision'>) {
  s.players[id]!.observations.push({ ...observation, revision: s.revision + 1 });
}
function bankGive(s: FeedTheKrakenServerState, id: string, amount: number) {
  const n = Math.min(amount, s.supplyGuns); s.supplyGuns -= n; s.players[id]!.guns += n;
}
function bankTake(s: FeedTheKrakenServerState, id: string, amount: number) {
  const n = Math.min(amount, s.players[id]!.guns); s.players[id]!.guns -= n; s.supplyGuns += n;
}
function transfer(s: FeedTheKrakenServerState, from: string, to: string, amount: number) {
  const n = Math.min(amount, availableGuns(s, from)); s.players[from]!.guns -= n; s.players[to]!.guns += n;
}
function availableGuns(s: FeedTheKrakenServerState, id: string) {
  const reserved = s.window === 'after_bids' || s.phase === 'tie_veto' || s.phase === 'instigator';
  return Math.max(0, s.players[id]!.guns - (reserved ? s.bids[id] ?? 0 : 0));
}
function finish(s: FeedTheKrakenServerState, winner: FeedTheKrakenTeam | null, reason: FeedTheKrakenServerState['endReason']) {
  s.status = 'game_over'; s.phase = 'game_over'; s.window = null; s.pendingPlayerId = null; s.winner = winner; s.endReason = reason;
  s.winnerIds = winner ? s.order.filter((id) => !s.players[id]!.forfeited && feedTheKrakenTeam(s.players[id]!.faction) === winner) : [];
  s.hands = {}; s.offered = []; s.submissions = {}; s.ritual = null; s.ritualPendingIds = []; s.ritualDecision = null;
  log(s, winner ? `${winner} victory.` : 'The voyage ended without a winner.');
}
export function feedTheKrakenMutinyThreshold(s: FeedTheKrakenServerState): number {
  return s.effects.threshold ?? (s.initialPlayerCount <= 7 ? 3 : s.initialPlayerCount <= 9 ? 4 : 5);
}
function drunkCaptain(s: FeedTheKrakenServerState): string {
  const candidates = clockwise(s, s.captainId).filter((id) => id !== s.captainId && eligibleCaptain(s, id));
  if (!candidates.length) {
    if (eligibleCaptain(s, s.captainId)) return s.captainId;
    throw new Error('No eligible captain remains');
  }
  const min = Math.min(...candidates.map((id) => s.players[id]!.resume.length));
  const ordered = [...candidates.filter((id) => id !== s.captainId), ...candidates.filter((id) => id === s.captainId)];
  return ordered.find((id) => s.players[id]!.resume.length === min)!;
}
function priority(s: FeedTheKrakenServerState, window: FeedTheKrakenWindow) {
  s.phase = 'priority'; s.window = window; s.windowId += 1; s.priorityOrder = clockwise(s, s.captainId); s.priorityIndex = 0;
  s.pendingPlayerId = s.priorityOrder[0] ?? null;
  if (!s.pendingPlayerId) finish(s, null, 'no_participants');
}
function nextRound(s: FeedTheKrakenServerState) {
  s.round += 1; s.effects = newEffects(); s.bids = {}; s.bidsRevealed = false; s.tieCandidates = [];
  s.lieutenantId = null; s.navigatorId = null; s.currentCard = null; s.mapAction = null; s.pendingEffect = null;
  priority(s, 'before_appointment');
}
function nextPriority(s: FeedTheKrakenServerState) {
  do { s.priorityIndex++; } while (s.priorityIndex < s.priorityOrder.length && !alive(s).includes(s.priorityOrder[s.priorityIndex]!));
  s.pendingPlayerId = s.priorityOrder[s.priorityIndex] ?? null;
  if (s.pendingPlayerId) return;
  const w = s.window; s.window = null;
  if (w === 'before_appointment') {
    if (s.effects.lieutenant && !feedTheKrakenOfficeTargets(s).includes(s.effects.lieutenant)) s.effects.lieutenant = null;
    s.phase = 'appointment'; s.pendingPlayerId = s.captainId; autoOffices(s);
  }
  else if (w === 'after_appointment') startBids(s);
  else if (w === 'after_bids') resolveBids(s);
  else if (w === 'before_draw') drawNavigation(s);
  else if (w === 'during_navigation') {
    s.phase = s.navigationResumePhase ?? 'navigation'; s.navigationResumePhase = null;
    s.pendingPlayerId = s.phase === 'navigator' ? s.navigatorId : null;
    if (s.phase === 'navigator' && (!s.navigatorId || !alive(s).includes(s.navigatorId))) {
      const chosen = s.offered[0]!; s.discard.push(...s.offered.slice(1)); s.offered = []; executeNavigation(s, chosen);
    }
  }
  else if (w === 'yellow') resolveRitual(s);
}
function reshuffle(s: FeedTheKrakenServerState) { s.draw = shuffle(s, [...s.draw, ...s.discard]); s.discard = []; }
function drawOne(s: FeedTheKrakenServerState): FeedTheKrakenNavigationCard {
  if (!s.draw.length) reshuffle(s);
  const card = s.draw.shift(); if (!card) throw new Error('Navigation deck exhausted'); return card;
}
function drawN(s: FeedTheKrakenServerState, n: number) { return Array.from({ length: n }, () => drawOne(s)); }
function startBids(s: FeedTheKrakenServerState) {
  s.phase = 'mutiny'; s.bids = {}; s.bidsRevealed = false; s.pendingPlayerId = null; s.windowId++; s.bidWindowId = s.windowId;
  s.bidWindowRevision = s.revision + 1;
  for (const id of alive(s)) if (id !== s.captainId && s.effects.excluded.includes(id)) s.bids[id] = 0;
  checkBids(s);
}
function checkBids(s: FeedTheKrakenServerState) {
  if (alive(s).filter((id) => id !== s.captainId).every((id) => s.bids[id] !== undefined)) {
    s.bidsRevealed = true; priority(s, 'after_bids');
  }
}
function resolveBids(s: FeedTheKrakenServerState) {
  const strength = (id: string) => (s.bids[id] ?? 0) * (s.effects.doubled.includes(id) ? 2 : 1);
  const total = alive(s).reduce((sum, id) => sum + strength(id), 0);
  if (total < feedTheKrakenMutinyThreshold(s)) { log(s, 'The navigation team was accepted.'); priority(s, 'before_draw'); return; }
  const candidates = alive(s).filter((id) => id !== s.captainId && eligibleCaptain(s, id));
  const max = Math.max(0, ...candidates.map(strength));
  s.tieCandidates = candidates.filter((id) => strength(id) === max);
  if (s.tieCandidates.length > 1) { s.phase = 'tie_veto'; s.pendingPlayerId = s.captainId; return; }
  completeMutiny(s, s.tieCandidates[0] ?? s.captainId);
}
function completeMutiny(s: FeedTheKrakenServerState, newCaptain: string) {
  for (const id of alive(s)) {
    const bid = s.bids[id] ?? 0; bankTake(s, id, bid);
    const p = s.players[id]!;
    if (s.effects.strategist.includes(id) && id !== newCaptain) bankGive(s, id, bid);
    else if (bid > 0 && p.character === 'gunsmith' && p.characterRevealed) bankGive(s, id, 1);
  }
  for (const id of s.effects.instigatorReset) s.players[id]!.characterRevealed = false;
  s.captainId = newCaptain; log(s, 'The mutiny succeeded.'); nextRound(s);
}
function drawNavigation(s: FeedTheKrakenServerState) {
  s.phase = 'navigation'; s.pendingPlayerId = null; s.hands = {}; s.submissions = {}; s.offered = [];
  s.navigationCaptainId = s.captainId; s.navigationTeam = [s.captainId, s.lieutenantId, s.navigatorId].filter((id): id is string => id !== null);
  if (s.draw.length < 4) reshuffle(s);
  for (const id of [s.captainId, s.lieutenantId]) {
    if (id && alive(s).includes(id)) s.hands[id] = drawN(s, s.effects.extraDraw.includes(id) ? 3 : 2);
    else {
      const cards = shuffle(s, drawN(s, 2)); s.submissions['missing_lieutenant'] = cards[0]!; s.discard.push(cards[1]!);
    }
  }
  s.navigationResumePhase = 'navigation'; priority(s, 'during_navigation');
}
function checkSubmissions(s: FeedTheKrakenServerState) {
  if (Object.keys(s.hands).length) return;
  s.offered = shuffle(s, Object.values(s.submissions)); s.submissions = {}; s.phase = 'navigator'; s.pendingPlayerId = s.navigatorId;
  s.navigationResumePhase = 'navigator'; priority(s, 'during_navigation');
}
function executeNavigation(s: FeedTheKrakenServerState, card: FeedTheKrakenNavigationCard) {
  s.currentCard = card; s.players[s.navigationCaptainId]!.resume.push(card);
  const graph = FEED_THE_KRAKEN_MAPS[s.journey]; const source = graph[s.nodeId]!; const destination = source.routes[card.colour];
  s.nodeId = destination;
  if (destination === 'pirate' || destination === 'sailor' || destination === 'cult') { finish(s, destination, 'destination'); return; }
  const node = graph[destination]!;
  if (s.journey === 'long' && !s.supplyCrossed && source.beforeSupply && !node.beforeSupply) {
    s.supplyCrossed = true; for (const id of alive(s)) bankGive(s, id, Math.max(0, 3 - s.players[id]!.guns)); log(s, 'The ship crossed the supply line.');
  }
  if (node.action && alive(s).some((id) => id !== s.captainId)) {
    s.phase = 'map_action'; s.mapAction = node.action; s.pendingPlayerId = s.captainId;
  } else resolveCardEffect(s);
}
function finishNavigation(s: FeedTheKrakenServerState) {
  const team = s.navigationTeam;
  s.offDuty = (s.initialPlayerCount <= 6 ? [team[2]] : s.initialPlayerCount <= 8 ? team.slice(1) : team).filter((id): id is string => !!id && alive(s).includes(id));
  s.ritual = null; s.ritualPendingIds = []; s.ritualDecision = null;
  for (const id of s.effects.instigatorReset) s.players[id]!.characterRevealed = false;
  nextRound(s);
}
function resolveCardEffect(s: FeedTheKrakenServerState) {
  s.mapAction = null; const effect = s.currentCard!.effect;
  if (effect === 'drunk') s.captainId = drunkCaptain(s);
  else if (effect === 'armed' && s.navigatorId && alive(s).includes(s.navigatorId)) bankGive(s, s.navigatorId, 1);
  else if (effect === 'disarmed' && s.navigatorId) bankTake(s, s.navigatorId, 1);
  else if (effect === 'mermaid' || effect === 'telescope') {
    if (alive(s).some((id) => id !== s.captainId)) { s.phase = 'effect_target'; s.pendingEffect = effect; s.pendingPlayerId = s.captainId; return; }
  } else if (effect === 'uprising') { priority(s, 'yellow'); return; }
  finishNavigation(s);
}
function resolveRitual(s: FeedTheKrakenServerState) {
  const ritual = s.rituals.shift(); if (!ritual) throw new Error('More than five nonterminal uprisings');
  s.ritual = ritual; s.revealedRituals.push(ritual);
  s.phase = 'ritual'; s.window = null; s.windowId++; s.ritualWindowRevision = s.revision + 1;
  s.ritualPendingIds = alive(s); s.ritualDecision = null; s.ritualGunCount = Math.min(3, s.supplyGuns);
  const leader = alive(s).find((id) => s.players[id]!.faction === 'cult_leader');
  s.pendingPlayerId = leader && ((ritual === 'conversion' && conversionTargets(s).length > 0)
    || (ritual === 'stash' && s.ritualGunCount > 0)) ? leader : null;
  completeRitual(s);
}
function completeRitual(s: FeedTheKrakenServerState) {
  if (s.ritualPendingIds.length) return;
  const leader = alive(s).find((id) => s.players[id]!.faction === 'cult_leader');
  const decision = s.ritualDecision;
  if (leader && s.ritual === 'cult_search') {
    for (const id of s.navigationTeam) observe(s, leader, { kind: 'cult_search', playerId: id, faction: s.players[id]!.originalFaction });
  } else if (leader && s.ritual === 'conversion' && decision?.playerId && conversionTargets(s).includes(decision.playerId)) {
    const target = s.players[decision.playerId]!; target.faction = 'cultist'; target.knownLeaderId = leader;
    observe(s, leader, { kind: 'conversion', playerId: decision.playerId, faction: 'cultist' });
    observe(s, decision.playerId, { kind: 'conversion', playerId: leader, faction: 'cult_leader' });
  } else if (leader && s.ritual === 'stash' && decision?.allocations) {
    for (const [id, count] of Object.entries(decision.allocations)) if (alive(s).includes(id)) bankGive(s, id, count);
  }
  log(s, 'The ritual is complete.'); finishNavigation(s);
}
function conversionTargets(s: FeedTheKrakenServerState) {
  return alive(s).filter((id) => !s.players[id]!.conversionImmune && s.players[id]!.faction !== 'cult_leader');
}
export function feedTheKrakenOfficeTargets(s: FeedTheKrakenServerState): string[] {
  const others = alive(s).filter((id) => id !== s.captainId); const rested = others.filter((id) => !s.offDuty.includes(id));
  return rested.length >= 2 ? rested : others;
}
function autoOffices(s: FeedTheKrakenServerState) {
  if (alive(s).length >= 3) return;
  s.lieutenantId = alive(s).find((id) => id !== s.captainId) ?? null; s.navigatorId = null;
  priority(s, 'after_appointment');
}

export function initFeedTheKrakenGame(
  players: Array<{ playerId: string; displayName: string }>, roomCode: string,
  journey: FeedTheKrakenJourney = 'quick', rng: () => number = Math.random,
): FeedTheKrakenServerState {
  if (players.length < 5 || players.length > 11 || new Set(players.map((p) => p.playerId)).size !== players.length
    || players.some((p) => !p.playerId) || (journey !== 'quick' && journey !== 'long') || (journey === 'long' && players.length < 7)) throw new Error('Invalid Feed the Kraken setup');
  const s: FeedTheKrakenServerState = {
    gameId: 'feed_the_kraken', roomCode, rulesVersion: FEED_THE_KRAKEN_RULES_VERSION, revision: 0, journey,
    status: 'playing', phase: 'priority', window: null, windowId: 0, round: 0, players: {}, order: players.map((p) => p.playerId), initialPlayerCount: players.length,
    captainId: players[0]!.playerId, lieutenantId: null, navigatorId: null, navigationCaptainId: players[0]!.playerId, navigationTeam: [], offDuty: [], nodeId: '0,0', supplyCrossed: false, supplyGuns: 40 - players.length * 3,
    draw: [], discard: [], hands: {}, submissions: {}, offered: [], currentCard: null, bids: {}, bidsRevealed: false, bidWindowId: 0, bidWindowRevision: 0, navigationResumePhase: null,
    priorityOrder: [], priorityIndex: 0, tieCandidates: [], pendingPlayerId: null, mapAction: null, pendingEffect: null,
    telescopeCard: null, telescopeReturn: null, rituals: [], revealedRituals: [], ritual: null,
    ritualPendingIds: [], ritualWindowRevision: 0, ritualGunCount: 0, ritualDecision: null, effects: newEffects(), instigatorOwner: null,
    winner: null, winnerIds: [], endReason: null, log: [], rng,
  };
  const n = players.length;
  let roles: FeedTheKrakenFaction[];
  if (n === 5) roles = [...shuffle(s, ['sailor', 'sailor', 'sailor', 'pirate', 'pirate'] as FeedTheKrakenFaction[]).slice(1), 'cult_leader'];
  else { const pirates = n <= 7 ? 2 : n <= 9 ? 3 : 4; roles = [...Array<FeedTheKrakenFaction>(n - pirates - 1 - (n === 11 ? 1 : 0)).fill('sailor'), ...Array<FeedTheKrakenFaction>(pirates).fill('pirate'), 'cult_leader', ...(n === 11 ? ['cultist' as const] : [])]; }
  roles = shuffle(s, roles); const characters = shuffle(s, FEED_THE_KRAKEN_CHARACTERS); s.captainId = shuffle(s, s.order)[0]!;
  players.forEach((p, i) => { s.players[p.playerId] = { ...p, originalFaction: roles[i]!, faction: roles[i]!, knownPirateIds: [], knownLeaderId: null, guns: 3, aboard: true, forfeited: false, departureReason: null, tongueless: false, conversionImmune: false, notFactions: [], character: characters[i]!, characterRevealed: false, resume: [], observations: [] }; });
  const pirates = s.order.filter((id) => s.players[id]!.faction === 'pirate');
  for (const id of pirates) s.players[id]!.knownPirateIds = pirates.filter((other) => other !== id);
  s.draw = shuffle(s, feedTheKrakenDeck(journey)); s.rituals = shuffle(s, ['conversion', 'conversion', 'conversion', 'stash', 'cult_search']);
  nextRound(s); validateFeedTheKrakenState(s); return s;
}

const timing: Partial<Record<FeedTheKrakenCharacter, FeedTheKrakenWindow>> = {
  troublemaker: 'after_bids', peacemaker: 'after_bids', minstrel: 'after_appointment', boatswain: 'before_draw',
  herbalist: 'before_appointment', master_strategist: 'after_bids', smuggler: 'before_draw', agitator: 'after_appointment',
  adviser: 'before_appointment', chief_cook: 'before_appointment', rabble_rouser: 'after_bids', archivist: 'before_draw',
  spiritualist: 'yellow', debt_collector: 'after_appointment', negotiator: 'after_appointment', instigator: 'after_bids',
};
export function canUseFeedTheKrakenCharacter(s: FeedTheKrakenServerState, id: string): boolean {
  const p = s.players[id];
  if (!p || !p.aboard || p.forfeited || p.characterRevealed || s.phase !== 'priority'
    || s.pendingPlayerId !== id || (timing[p.character] && timing[p.character] !== s.window)) return false;
  if (p.character === 'gunsmith') return availableGuns(s, id) > 0;
  if (p.character === 'herbalist') return s.offDuty.some((t) => alive(s).includes(t)) && alive(s).length > 1;
  if (p.character === 'mentor') return alive(s).some((t) => t !== id && s.players[t]!.characterRevealed);
  if (p.character === 'boatswain') return s.lieutenantId !== null && s.navigatorId !== null;
  if (p.character === 'adviser') return feedTheKrakenOfficeTargets(s).length > 0;
  if (p.character === 'instigator') return alive(s).some((t) => t !== s.captainId);
  if (['minstrel', 'agitator', 'spiritualist'].includes(p.character)) return alive(s).length >= 2;
  return true;
}
function character(s: FeedTheKrakenServerState, id: string, targets: string[]): FeedTheKrakenEngineResult {
  if (!canUseFeedTheKrakenCharacter(s, id)) return reject('Character unavailable');
  const p = s.players[id]!; const c = p.character; const [a, b, recipient] = targets;
  const requireTargets = (count: number) => targets.length === count && new Set(targets.slice(0, Math.min(count, 2))).size === Math.min(count, 2) && targets.every((t) => alive(s).includes(t));
  const one = ['kleptomaniac', 'troublemaker', 'peacemaker', 'smuggler', 'adviser', 'archivist', 'mentor', 'debt_collector', 'instigator'];
  if (one.includes(c) && !requireTargets(1)) return reject('Choose one active player');
  if (['minstrel', 'agitator', 'herbalist'].includes(c) && !requireTargets(2)) return reject('Choose two different active players');
  if (c === 'spiritualist' && !requireTargets(3)) return reject('Choose two donors and a recipient');
  if (!one.includes(c) && !['minstrel', 'agitator', 'herbalist', 'spiritualist'].includes(c) && targets.length) return reject('This character takes no targets');
  if (c === 'gunsmith' && availableGuns(s, id) < 1) return reject('An uncommitted gun is required');
  if (c === 'herbalist' && !s.offDuty.includes(a!)) return reject('Move an existing off-duty sign');
  if (['smuggler', 'archivist'].includes(c) && a !== s.captainId && a !== s.lieutenantId) return reject('Choose captain or lieutenant');
  if (c === 'adviser' && !feedTheKrakenOfficeTargets(s).includes(a!)) return reject('Ineligible lieutenant');
  if (c === 'mentor' && (a === id || !s.players[a!]!.characterRevealed)) return reject('Choose another revealed character');
  if (c === 'debt_collector' && ![s.captainId, s.lieutenantId, s.navigatorId].includes(a!)) return reject('Choose a navigation-team member');
  if (c === 'instigator' && a === s.captainId) return reject('Captain cannot join a mutiny');
  p.characterRevealed = true; log(s, `${p.displayName} revealed ${c.replaceAll('_', ' ')}.`);
  switch (c) {
    case 'kleptomaniac': transfer(s, a!, id, 1); break;
    case 'troublemaker': if (!s.effects.doubled.includes(a!)) s.effects.doubled.push(a!); break;
    case 'gunsmith': bankTake(s, id, 1); break;
    case 'peacemaker': s.bids[a!] = 0; break;
    case 'gunslinger': bankGive(s, id, 2); break;
    case 'minstrel': s.effects.excluded.push(a!, b!); break;
    case 'boatswain': [s.lieutenantId, s.navigatorId] = [s.navigatorId, s.lieutenantId]; break;
    case 'herbalist': s.offDuty[s.offDuty.indexOf(a!)] = b!; break;
    case 'lookout': {
      s.telescopeCard = drawOne(s); s.telescopeReturn = 'priority'; s.phase = 'telescope'; s.pendingPlayerId = id;
      observe(s, id, { kind: 'lookout', cards: [{ colour: s.telescopeCard.colour, effect: s.telescopeCard.effect }] }); return ok();
    }
    case 'master_strategist': s.effects.strategist.push(id); break;
    case 'smuggler': s.effects.extraDraw.push(a!); break;
    case 'agitator': s.effects.forced.push(a!, b!); break;
    case 'adviser': s.effects.lieutenant = a!; break;
    case 'chief_cook': s.captainId = drunkCaptain(s); s.effects.lieutenant = null; break;
    case 'rabble_rouser': s.effects.threshold = Math.ceil(feedTheKrakenMutinyThreshold(s) / 2); break;
    case 'archivist': s.effects.redraw.push(a!); break;
    case 'mentor': s.players[a!]!.characterRevealed = false; break;
    case 'spiritualist': transfer(s, a!, recipient!, 1); transfer(s, b!, recipient!, 1); break;
    case 'debt_collector': for (const t of [s.captainId, s.lieutenantId, s.navigatorId]) if (t && t !== a) transfer(s, a!, t, 1); break;
    case 'negotiator': s.effects.threshold = 1; s.effects.cap = 1; break;
    case 'instigator': s.phase = 'instigator'; s.pendingPlayerId = a!; s.instigatorOwner = id; return ok();
  }
  nextPriority(s); return ok();
}

function apply(s: FeedTheKrakenServerState, id: string, action: FeedTheKrakenAction): FeedTheKrakenEngineResult {
  const p = s.players[id]; if (!p || !p.aboard || p.forfeited || s.status !== 'playing') return reject('Player cannot act');
  if (action.type === 'character') return character(s, id, action.targets ?? []);
  if (action.type === 'pass') {
    if (s.phase !== 'priority' || s.pendingPlayerId !== id) return reject('Not your priority'); nextPriority(s); return ok();
  }
  if (action.type === 'appoint') {
    if (s.phase !== 'appointment' || id !== s.captainId) return reject('Not appointing');
    const legal = feedTheKrakenOfficeTargets(s);
    if (action.lieutenantId === action.navigatorId || !legal.includes(action.lieutenantId) || !legal.includes(action.navigatorId)
      || (s.effects.lieutenant && action.lieutenantId !== s.effects.lieutenant)) return reject('Ineligible navigation team');
    s.lieutenantId = action.lieutenantId; s.navigatorId = action.navigatorId; priority(s, 'after_appointment'); return ok();
  }
  if (action.type === 'bid') {
    if (s.phase !== 'mutiny' || id === s.captainId || s.bids[id] !== undefined || s.effects.excluded.includes(id)) return reject('Cannot bid');
    if (!Number.isSafeInteger(action.guns) || action.guns < 0 || action.guns > p.guns || (s.effects.cap !== null && action.guns > s.effects.cap)
      || (s.effects.forced.includes(id) && p.guns > 0 && action.guns === 0)) return reject('Invalid gun commitment');
    s.bids[id] = action.guns; checkBids(s); return ok();
  }
  if (action.type === 'veto') {
    if (s.phase !== 'tie_veto' || s.pendingPlayerId !== id || !s.tieCandidates.includes(action.playerId)) return reject('Invalid tie veto');
    s.tieCandidates = s.tieCandidates.filter((t) => t !== action.playerId); s.pendingPlayerId = action.playerId;
    if (s.tieCandidates.length === 1) completeMutiny(s, s.tieCandidates[0]!); return ok();
  }
  if (action.type === 'submit_navigation') {
    if (s.phase !== 'navigation' || !s.hands[id]) return reject('No navigation hand');
    if (action.redraw) {
      if (!s.effects.redraw.includes(id)) return reject('Redraw unavailable');
      s.discard.push(...s.hands[id]!); s.hands[id] = drawN(s, 2); s.effects.redraw = s.effects.redraw.filter((t) => t !== id); return ok();
    }
    const cards = s.hands[id]!; const card = cards.find((c) => c.id === action.cardId); if (!card) return reject('Card not held');
    s.submissions[id] = card; s.discard.push(...cards.filter((c) => c.id !== card.id)); delete s.hands[id]; checkSubmissions(s); return ok();
  }
  if (action.type === 'navigate') {
    if (s.phase !== 'navigator' || s.navigatorId !== id) return reject('Not navigator');
    if (action.refuse) {
      s.discard.push(...s.offered); s.offered = []; p.aboard = false; p.departureReason = 'refused'; s.navigatorId = null;
      log(s, `${p.displayName} refused command and went overboard.`); s.phase = 'emergency'; s.pendingPlayerId = s.captainId;
      if (alive(s).length < 3) { s.navigatorId = null; drawNavigation(s); } return ok();
    }
    const card = s.offered.find((c) => c.id === action.cardId); if (!card) return reject('Card not offered');
    s.discard.push(...s.offered.filter((c) => c.id !== card.id)); s.offered = []; executeNavigation(s, card); return ok();
  }
  if (action.type === 'emergency') {
    if (s.phase !== 'emergency' || id !== s.captainId || !alive(s).includes(action.playerId)
      || action.playerId === s.captainId || action.playerId === s.lieutenantId) return reject('Invalid emergency navigator');
    s.navigatorId = action.playerId; drawNavigation(s); return ok();
  }
  if (action.type === 'target') {
    if (s.pendingPlayerId !== id || !['map_action', 'effect_target'].includes(s.phase) || action.playerId === id || !alive(s).includes(action.playerId)) return reject('Invalid target');
    const target = s.players[action.playerId]!;
    if (s.phase === 'map_action') {
      if (s.mapAction === 'cabin') { observe(s, id, { kind: 'cabin', playerId: action.playerId, faction: target.faction }); target.conversionImmune = true; }
      else if (s.mapAction === 'flogging') {
        const other = (['pirate', 'sailor', 'cult'] as const).filter((f) => f !== feedTheKrakenTeam(target.faction));
        target.notFactions.push(shuffle(s, other)[0]!); target.conversionImmune = true;
      } else if (s.mapAction === 'tongue') target.tongueless = true;
      else if (s.mapAction === 'feeding') {
        target.aboard = false; target.departureReason = 'fed';
        if (target.faction === 'cult_leader') { finish(s, 'cult', 'leader_fed'); return ok(); }
      }
      resolveCardEffect(s); return ok();
    }
    if (s.pendingEffect === 'mermaid') {
      observe(s, action.playerId, { kind: 'mermaid', cards: shuffle(s, s.discard.slice(-3)).map(({ colour, effect }) => ({ colour, effect })) }); finishNavigation(s);
    } else {
      s.telescopeCard = drawOne(s); s.telescopeReturn = 'finish'; s.pendingPlayerId = action.playerId; s.phase = 'telescope';
      observe(s, action.playerId, { kind: 'telescope', cards: [{ colour: s.telescopeCard.colour, effect: s.telescopeCard.effect }] });
    }
    return ok();
  }
  if (action.type === 'telescope') {
    if (s.phase !== 'telescope' || s.pendingPlayerId !== id || !s.telescopeCard) return reject('No telescope decision');
    if (action.discard) s.discard.push(s.telescopeCard); else s.draw.unshift(s.telescopeCard);
    s.telescopeCard = null; const back = s.telescopeReturn; s.telescopeReturn = null;
    if (back === 'priority') { s.phase = 'priority'; nextPriority(s); } else finishNavigation(s); return ok();
  }
  if (action.type === 'ritual') {
    if (s.phase !== 'ritual' || !s.ritualPendingIds.includes(id)) return reject('No ritual decision');
    if (s.pendingPlayerId !== id) {
      if (action.playerId !== undefined || action.allocations !== undefined) return reject('Only a private ritual acknowledgement is required');
    } else if (s.ritual === 'conversion') {
      if (!action.playerId || !conversionTargets(s).includes(action.playerId)) return reject('Invalid conversion target');
      s.ritualDecision = { playerId: action.playerId };
    } else if (s.ritual === 'stash') {
      const entries = Object.entries(action.allocations ?? {});
      if (!entries.length || entries.some(([t, n]) => !alive(s).includes(t) || !Number.isSafeInteger(n) || n < 0)
        || entries.reduce((sum, [, n]) => sum + n, 0) !== s.ritualGunCount) return reject('Allocate the available ritual guns');
      s.ritualDecision = { allocations: { ...action.allocations } };
    }
    s.ritualPendingIds = s.ritualPendingIds.filter(t => t !== id); completeRitual(s); return ok();
  }
  if (action.type === 'instigator') {
    if (s.phase !== 'instigator' || s.pendingPlayerId !== id || !s.instigatorOwner) return reject('No instigator invitation');
    if (action.accept) s.bids[id] = p.guns;
    else s.effects.instigatorReset.push(s.instigatorOwner);
    s.instigatorOwner = null; s.phase = 'priority'; nextPriority(s); return ok();
  }
  return reject('Unknown action');
}

export function submitFeedTheKrakenAction(s: FeedTheKrakenServerState, actorId: string, action: FeedTheKrakenAction, expectedRevision: number, windowId?: number): FeedTheKrakenEngineResult {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return reject('Invalid action');
  const simultaneous = Number.isSafeInteger(expectedRevision) && expectedRevision <= s.revision && (
    (s.phase === 'mutiny' && action.type === 'bid' && windowId === s.bidWindowId && expectedRevision >= s.bidWindowRevision)
    || (s.phase === 'ritual' && action.type === 'ritual' && windowId === s.windowId && expectedRevision >= s.ritualWindowRevision));
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision !== s.revision && !simultaneous)) return reject('Stale revision');
  if (action.type === 'character' && action.targets !== undefined && (!Array.isArray(action.targets) || action.targets.length > 3 || action.targets.some((id) => typeof id !== 'string'))) return reject('Invalid targets');
  if (action.type === 'ritual' && action.allocations !== undefined && (typeof action.allocations !== 'object' || action.allocations === null || Array.isArray(action.allocations))) return reject('Invalid allocations');
  if ((action.type === 'telescope' && typeof action.discard !== 'boolean') || (action.type === 'instigator' && typeof action.accept !== 'boolean')
    || (action.type === 'navigate' && action.refuse !== undefined && typeof action.refuse !== 'boolean')
    || (action.type === 'submit_navigation' && action.redraw !== undefined && typeof action.redraw !== 'boolean')) return reject('Invalid choice');
  const { rng, ...data } = s; const draft: FeedTheKrakenServerState = { ...structuredClone(data), rng };
  const result = apply(draft, actorId, action); if (!result.ok) return result;
  draft.revision++; validateFeedTheKrakenState(draft); Object.assign(s, draft); return ok();
}

export function forfeitFeedTheKrakenPlayer(s: FeedTheKrakenServerState, playerId: string): FeedTheKrakenEngineResult {
  return forfeitFeedTheKrakenPlayers(s, [playerId]);
}

export function forfeitFeedTheKrakenPlayers(s: FeedTheKrakenServerState, playerIds: readonly string[]): FeedTheKrakenEngineResult {
  const departing = new Set(playerIds);
  if (!departing.size || s.status !== 'playing' || [...departing].some(id => !s.players[id] || s.players[id]!.forfeited)) return reject('Cannot forfeit players');
  const heldOffice = [s.captainId, s.lieutenantId, s.navigatorId].some(id => id !== null && departing.has(id));
  const restartAppointment = heldOffice && (s.phase === 'appointment' || s.phase === 'mutiny' || (s.phase === 'priority' && s.window !== 'yellow' && s.window !== 'during_navigation'));
  const pendingDeparted = s.pendingPlayerId !== null && departing.has(s.pendingPlayerId);
  for (const playerId of departing) {
    const p = s.players[playerId]!;
    p.forfeited = true; p.aboard = false; p.departureReason = 'forfeit'; bankTake(s, playerId, p.guns);
    delete s.bids[playerId]; log(s, `${p.displayName} forfeited the voyage.`);
  }
  s.offDuty = s.offDuty.filter(id => !departing.has(id));
  if (!alive(s).some((id) => eligibleCaptain(s, id))) finish(s, null, 'no_participants');
  else {
    if (departing.has(s.captainId)) s.captainId = drunkCaptain(s);
    if (s.lieutenantId && departing.has(s.lieutenantId)) s.lieutenantId = null;
    if (s.navigatorId && departing.has(s.navigatorId)) s.navigatorId = null;
    if (s.lieutenantId === s.captainId) s.lieutenantId = null;
    if (s.navigatorId === s.captainId) s.navigatorId = null;
    const departedHands = [...departing].filter(id => s.hands[id]);
    for (const id of departedHands) {
      const cards = shuffle(s, s.hands[id]!); s.submissions[id] = cards[0]!; s.discard.push(...cards.slice(1)); delete s.hands[id];
    }
    if (s.phase === 'priority' && s.window === 'during_navigation' && departedHands.length) {
      if (!Object.keys(s.hands).length) checkSubmissions(s);
      else if (pendingDeparted) nextPriority(s);
    }
    else if (restartAppointment) nextRound(s);
    else if (s.phase === 'priority' && pendingDeparted) nextPriority(s);
    else if (s.phase === 'mutiny') checkBids(s);
    else if (s.phase === 'navigation' && departedHands.length) checkSubmissions(s);
    else if (s.phase === 'navigator' && pendingDeparted) {
      const chosen = s.offered[0]!; s.discard.push(...s.offered.slice(1)); s.offered = []; executeNavigation(s, chosen);
    } else if (s.phase === 'ritual') {
      s.ritualPendingIds = s.ritualPendingIds.filter(id => !departing.has(id));
      if (pendingDeparted) { s.pendingPlayerId = null; s.ritualDecision = null; }
      if (s.ritual === 'conversion' && !conversionTargets(s).length) s.pendingPlayerId = null;
      completeRitual(s);
    }
    else if (s.phase === 'telescope' && pendingDeparted) {
      if (s.telescopeCard) s.draw.unshift(s.telescopeCard); s.telescopeCard = null;
      if (s.telescopeReturn === 'priority') { s.phase = 'priority'; nextPriority(s); } else finishNavigation(s);
      s.telescopeReturn = null;
    } else if (s.phase === 'instigator' && pendingDeparted) {
      if (s.instigatorOwner) s.effects.instigatorReset.push(s.instigatorOwner); s.instigatorOwner = null; s.phase = 'priority'; nextPriority(s);
    } else if (s.phase === 'tie_veto') {
      s.tieCandidates = s.tieCandidates.filter((id) => alive(s).includes(id));
      if (s.tieCandidates.length <= 1) completeMutiny(s, s.tieCandidates[0] ?? s.captainId);
      else if (pendingDeparted) s.pendingPlayerId = s.captainId;
    } else if (['appointment', 'emergency', 'map_action', 'effect_target'].includes(s.phase)) {
      s.pendingPlayerId = s.captainId;
      if (s.phase === 'appointment') autoOffices(s);
      else if (s.phase === 'emergency' && alive(s).length < 3) drawNavigation(s);
      else if ((s.phase === 'map_action' || s.phase === 'effect_target') && alive(s).length === 1) {
        if (s.phase === 'map_action') resolveCardEffect(s); else finishNavigation(s);
      }
    }
  }
  s.revision++; validateFeedTheKrakenState(s); return ok();
}

export function validateFeedTheKrakenState(s: FeedTheKrakenServerState): void {
  if (!Number.isSafeInteger(s.revision) || s.revision < 0) throw new Error('Invalid revision');
  if (s.supplyGuns < 0 || !Number.isInteger(s.supplyGuns) || s.order.some((id) => s.players[id]!.guns < 0 || !Number.isInteger(s.players[id]!.guns))) throw new Error('Invalid gun count');
  if (s.supplyGuns + s.order.reduce((n, id) => n + s.players[id]!.guns, 0) !== 40) throw new Error('Gun conservation');
  const cards = [...s.draw, ...s.discard, ...Object.values(s.hands).flat(), ...Object.values(s.submissions), ...s.offered,
    ...s.order.flatMap((id) => s.players[id]!.resume), ...(s.telescopeCard ? [s.telescopeCard] : [])];
  if (s.status === 'playing' && (cards.length !== (s.journey === 'quick' ? 19 : 23) || new Set(cards.map((c) => c.id)).size !== cards.length)) throw new Error('Navigation card conservation');
  if (s.revealedRituals.length > 5 || s.revealedRituals.length + s.rituals.length !== 5) throw new Error('Ritual conservation');
  if (s.winnerIds.some((id) => s.players[id]!.forfeited)) throw new Error('Forfeited winner');
  if (s.status === 'playing' && !FEED_THE_KRAKEN_MAPS[s.journey][s.nodeId]) throw new Error('Unknown chart position');
}
