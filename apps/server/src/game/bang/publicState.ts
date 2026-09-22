import type { BangPrivateState, BangPublicState } from '@zuychin-arcade/types';
import { bangBarrelOptions, bangDistance, bangPlayOptions, bangWeaponRange, type BangServerState } from './engine.js';

export function toBangPublicState(s: BangServerState, _viewerId: string): BangPublicState {
  const active = s.turnOrder[s.activeIndex]!;
  return {
    gameId: 'bang', roomCode: s.roomCode, rulesVersion: s.rulesVersion, revision: s.revision, status: s.status, phase: s.phase,
    turnNumber: s.turnNumber, activePlayerId: active,
    players: s.turnOrder.map(id => {
      const p = s.players.get(id)!;
      return { playerId: id, displayName: p.displayName, character: p.character, role: p.role === 'sheriff' || !p.alive || s.status === 'game_over' ? p.role : null,
        health: p.health, maxHealth: p.maxHealth, alive: p.alive, forfeited: p.forfeited, handCount: p.hand.length,
        equipment: p.equipment.map(c => ({ ...c })), distanceFromActive: p.alive ? bangDistance(s, active, id) : 99 };
    }),
    pending: s.pending ? { ...s.pending, barrelsUsed: [...s.pending.barrelsUsed], queue: [...s.pending.queue], storeCards: s.pending.storeCards?.map(c => ({ ...c })) } : null,
    drawChoice: s.pendingDraw ? { kind: s.pendingDraw.kind, playerId: s.pendingDraw.playerId } : null,
    drawCheck: s.pendingCheck ? { ...s.pendingCheck, cards: s.pendingCheck.cards.map(c => ({ ...c })) } : null,
    rescue: s.pendingRescue ? { ...s.pendingRescue } : null,
    discardOrder: s.pendingDiscardOrder ? { playerId: s.pendingDiscardOrder.playerId, count: s.pendingDiscardOrder.cards.length } : null,
    drawCount: s.deck.length, discardTop: s.discard.at(-1) ? { ...s.discard.at(-1)! } : null,
    winner: s.winner, abandoned: s.abandoned, log: s.log.map(x => ({ ...x })),
  };
}
export function toBangPrivateState(s: BangServerState, id: string): BangPrivateState {
  const p = s.players.get(id);
  if (!p) throw new Error('Player missing');
  const canPlay = s.status === 'playing' && s.phase === 'play' && s.turnOrder[s.activeIndex] === id && p.alive;
  const canChooseDraw = s.phase === 'draw_choice' && s.pendingDraw?.playerId === id;
  const canRespond = s.phase === 'response' && s.pending?.targetPlayerId === id && p.alive;
  const canRescue = s.phase === 'rescue' && s.pendingRescue?.playerId === id;
  const canChooseDiscardOrder = s.phase === 'discard_order' && s.pendingDiscardOrder?.playerId === id;
  const playOptions = bangPlayOptions(s, id);
  return {
    gameId: 'bang', roomCode: s.roomCode, revision: s.revision, playerId: id, role: p.role, hand: p.hand.map(c => ({ ...c })),
    canPlay, playOptions, canRespond,
    responseCardIds: canRespond ? p.hand.filter(c => c.name === s.pending!.response || (p.character === 'calamity_janet' && ['bang', 'missed'].includes(c.name))).map(c => c.id) : [],
    barrelOptions: bangBarrelOptions(s, id), canChooseStore: s.phase === 'general_store' && s.pending?.targetPlayerId === id,
    canChooseDraw, drawChoice: canChooseDraw && s.pendingDraw ? { ...s.pendingDraw, options: s.pendingDraw.options?.map(c => ({ ...c })) } : null,
    canChooseCheck: s.phase === 'draw_check' && s.pendingCheck?.playerId === id, canRescue,
    rescueBeerCardIds: canRescue && [...s.players.values()].filter(x => x.alive).length > 2 ? p.hand.filter(c => c.name === 'beer').map(c => c.id) : [],
    canUseSid: (canPlay || canRescue) && p.character === 'sid_ketchum' && p.health < p.maxHealth && p.hand.length >= 2,
    canChooseDiscardOrder, discardOrderCards: canChooseDiscardOrder ? s.pendingDiscardOrder!.cards.map(c => ({ ...c })) : [],
    canDiscard: s.phase === 'discard' && s.turnOrder[s.activeIndex] === id && p.alive,
    legalTargetIds: [...new Set(playOptions.flatMap(x => x.targets.map(t => t.playerId)))], weaponRange: bangWeaponRange(p),
    bangsRemaining: p.character === 'willy_the_kid' || p.equipment.some(c => c.name === 'volcanic') ? null : Math.max(0, 1 - p.bangsPlayed),
  };
}
