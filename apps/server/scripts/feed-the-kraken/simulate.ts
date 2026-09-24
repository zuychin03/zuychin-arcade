import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import type { FeedTheKrakenAction, FeedTheKrakenJourney } from '../../../../packages/types/src/feed-the-kraken.js';
import { feedTheKrakenOfficeTargets, initFeedTheKrakenGame, submitFeedTheKrakenAction, validateFeedTheKrakenState, type FeedTheKrakenServerState } from '../../src/game/feed-the-kraken/engine.js';
import { toFeedTheKrakenPrivateState } from '../../src/game/feed-the-kraken/publicState.js';

export function seededFeedTheKrakenRng(seed: number): () => number {
  let value = seed >>> 0; return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 0x100000000; };
}
export function nextFeedTheKrakenSimulationAction(s: FeedTheKrakenServerState): { actor: string; action: FeedTheKrakenAction } {
  const actor = s.pendingPlayerId ?? s.captainId;
  switch (s.phase) {
    case 'priority': return { actor, action: { type: 'pass' } };
    case 'appointment': {
      const options = feedTheKrakenOfficeTargets(s); const lieutenantId = s.effects.lieutenant ?? options[0]!;
      return { actor, action: { type: 'appoint', lieutenantId, navigatorId: options.find((id) => id !== lieutenantId)! } };
    }
    case 'mutiny': return { actor: s.order.find((id) => s.players[id]!.aboard && !s.players[id]!.forfeited && id !== s.captainId && s.bids[id] === undefined)!, action: { type: 'bid', guns: 0 } };
    case 'tie_veto': return { actor, action: { type: 'veto', playerId: s.tieCandidates[0]! } };
    case 'navigation': { const owner = Object.keys(s.hands)[0]!; return { actor: owner, action: { type: 'submit_navigation', cardId: s.hands[owner]![0]!.id } }; }
    case 'navigator': return { actor, action: { type: 'navigate', cardId: s.offered[0]!.id } };
    case 'emergency': return { actor, action: { type: 'emergency', playerId: toFeedTheKrakenPrivateState(s, actor).legalTargetIds[0]! } };
    case 'map_action': case 'effect_target': return { actor, action: { type: 'target', playerId: toFeedTheKrakenPrivateState(s, actor).legalTargetIds[0]! } };
    case 'telescope': return { actor, action: { type: 'telescope', discard: false } };
    case 'instigator': return { actor, action: { type: 'instigator', accept: true } };
    case 'ritual': {
      const respondent = s.ritualPendingIds[0]!;
      const mine = toFeedTheKrakenPrivateState(s, respondent);
      return { actor: respondent, action: mine.ritual === 'conversion' ? { type: 'ritual', playerId: mine.legalTargetIds[0]! }
        : mine.ritual === 'stash' ? { type: 'ritual', allocations: { [respondent]: s.ritualGunCount } } : { type: 'ritual' } };
    }
    default: throw new Error(`No simulation move for ${s.phase}`);
  }
}
export function runFeedTheKrakenSimulation(count: number, journey: FeedTheKrakenJourney, seed: number): number {
  const s = initFeedTheKrakenGame(Array.from({ length: count }, (_, i) => ({ playerId: `p${i}`, displayName: `Player ${i}` })), 'SIM', journey, seededFeedTheKrakenRng(seed));
  let steps = 0;
  while (s.status === 'playing') {
    assert.ok(steps++ < 1500, `Simulation stalled: ${count}/${journey}/${seed}/${s.phase}`);
    const move = nextFeedTheKrakenSimulationAction(s);
    assert.deepEqual(submitFeedTheKrakenAction(s, move.actor, move.action, s.revision, s.windowId), { ok: true }, `${s.phase}: ${JSON.stringify(move)}`);
    validateFeedTheKrakenState(s);
  }
  assert.ok(s.winner); return steps;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let games = 0; let actions = 0;
  for (let n = 5; n <= 11; n++) for (const journey of (n >= 7 ? ['quick', 'long'] : ['quick']) as FeedTheKrakenJourney[]) {
    for (let seed = 1; seed <= 100; seed++) { actions += runFeedTheKrakenSimulation(n, journey, seed); games++; }
  }
  console.log(JSON.stringify({ games, acceptedActions: actions, result: 'passed' }));
}
