import type { FeedTheKrakenPrivateState, FeedTheKrakenPublicState } from '../../../../../packages/types/src/feed-the-kraken.js';
import { canUseFeedTheKrakenCharacter, feedTheKrakenMutinyThreshold, feedTheKrakenOfficeTargets, type FeedTheKrakenServerState } from './engine.js';

export function toFeedTheKrakenPublicState(s: FeedTheKrakenServerState): FeedTheKrakenPublicState {
  return structuredClone({
    gameId: s.gameId, roomCode: s.roomCode, revision: s.revision, rulesVersion: s.rulesVersion,
    journey: s.journey, status: s.status, phase: s.phase, window: s.window, windowId: s.windowId,
    round: s.round, nodeId: s.nodeId, captainId: s.captainId, lieutenantId: s.lieutenantId, navigatorId: s.navigatorId,
    pendingPlayerId: s.phase === 'ritual' ? null : s.pendingPlayerId,
    players: s.order.map((id) => {
      const p = s.players[id]!;
      return {
        playerId: id, displayName: p.displayName, guns: s.phase === 'mutiny' ? null : p.guns,
        aboard: p.aboard, forfeited: p.forfeited, departureReason: p.departureReason,
        tongueless: p.tongueless, conversionImmune: p.conversionImmune, notFactions: p.notFactions,
        offDuty: s.offDuty.includes(id), character: p.characterRevealed || s.status === 'game_over' ? p.character : null,
        characterRevealed: p.characterRevealed, resume: p.resume, faction: s.status === 'game_over' ? p.faction : null,
      };
    }),
    initialPlayerCount: s.initialPlayerCount, mutinyThreshold: feedTheKrakenMutinyThreshold(s),
    bids: s.bidsRevealed ? s.bids : null,
    readyPlayerIds: s.phase === 'mutiny' ? Object.keys(s.bids) : s.phase === 'navigation' ? Object.keys(s.submissions).filter((id) => !!s.players[id]) : [],
    tieCandidates: s.tieCandidates, drawCount: s.draw.length, discardCount: s.discard.length,
    supplyGuns: s.supplyGuns, supplyCrossed: s.supplyCrossed, revealedRituals: s.revealedRituals,
    mapAction: s.mapAction, currentCard: s.currentCard, winner: s.winner, winnerIds: s.winnerIds,
    effects: { excludedPlayerIds: s.effects.excluded, forcedBidPlayerIds: s.effects.forced, doubledPlayerIds: s.effects.doubled,
      extraDrawPlayerIds: s.effects.extraDraw, redrawPlayerIds: s.effects.redraw, bidCap: s.effects.cap, forcedLieutenantId: s.effects.lieutenant },
    endReason: s.endReason, log: s.log,
  });
}

export function toFeedTheKrakenPrivateState(s: FeedTheKrakenServerState, playerId: string): FeedTheKrakenPrivateState {
  const p = s.players[playerId]; if (!p) throw new Error('Unknown Feed the Kraken viewer');
  const active = p.aboard && !p.forfeited && s.status === 'playing';
  const bid = active && s.phase === 'mutiny' && playerId !== s.captainId && s.bids[playerId] === undefined && !s.effects.excluded.includes(playerId);
  const navigation = active && s.phase === 'navigation' && !!s.hands[playerId];
  const ritual = s.phase === 'ritual' && s.ritualPendingIds.includes(playerId);
  const canAct = active && (s.phase === 'ritual' ? ritual : s.pendingPlayerId === playerId || bid || navigation);
  let legalTargetIds: string[] = [];
  if (canAct) {
    if (s.phase === 'appointment') legalTargetIds = feedTheKrakenOfficeTargets(s);
    else if (s.phase === 'tie_veto') legalTargetIds = s.tieCandidates;
    else if (s.phase === 'ritual' && s.pendingPlayerId !== playerId) legalTargetIds = [];
    else if (s.phase === 'ritual' && s.ritual === 'conversion') legalTargetIds = s.order.filter((id) => {
      const t = s.players[id]!; return t.aboard && !t.forfeited && !t.conversionImmune && id !== playerId;
    });
    else if (s.phase === 'emergency') legalTargetIds = s.order.filter((id) => s.players[id]!.aboard && !s.players[id]!.forfeited && id !== s.captainId && id !== s.lieutenantId);
    else legalTargetIds = s.order.filter((id) => s.players[id]!.aboard && !s.players[id]!.forfeited && (s.phase === 'priority' || s.phase === 'ritual' || id !== playerId));
  }
  return structuredClone({
    gameId: s.gameId, roomCode: s.roomCode, viewerPlayerId: playerId, playerId, revision: s.revision,
    faction: p.faction, originalFaction: p.originalFaction, knownPirateIds: p.knownPirateIds, knownLeaderId: p.knownLeaderId,
    character: p.character, observations: p.observations,
    navigationCards: active ? s.phase === 'telescope' && s.pendingPlayerId === playerId && s.telescopeCard ? [s.telescopeCard]
      : s.hands[playerId] ?? (s.phase === 'navigator' && s.navigatorId === playerId ? s.offered : []) : [],
    ownBid: s.bids[playerId] ?? null, ownGuns: p.guns,
    minimumBid: bid && s.effects.forced.includes(playerId) && p.guns > 0 ? 1 : 0,
    maximumBid: bid ? Math.min(p.guns, s.effects.cap ?? p.guns) : 0,
    canAct, canUseCharacter: canUseFeedTheKrakenCharacter(s, playerId),
    canRedraw: navigation && s.effects.redraw.includes(playerId), ritual: active && ritual && s.pendingPlayerId === playerId ? s.ritual : null,
    ritualGunCount: active && ritual && s.pendingPlayerId === playerId && s.ritual === 'stash' ? s.ritualGunCount : 0,
    legalTargetIds,
  });
}
