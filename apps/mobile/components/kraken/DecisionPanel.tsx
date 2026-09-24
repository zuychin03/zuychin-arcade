import { useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { FEED_THE_KRAKEN_CHARACTER_NAMES as N, FEED_THE_KRAKEN_CHARACTER_SUMMARIES as S, type FeedTheKrakenAction, type FeedTheKrakenPrivateState, type FeedTheKrakenPublicState } from '@zuychin-arcade/types';
import { HelmButton, typography as T } from './Controls';
import { characterTargets, targetSlots } from './decisions';
import { CardGrid } from '../ui/CardGrid';
import { NavigationCard } from './NavigationCard';
export function DecisionPanel({ game, mine, busy, send }: { game: FeedTheKrakenPublicState; mine: FeedTheKrakenPrivateState; busy: boolean; send: (a: FeedTheKrakenAction) => boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [guns, setGuns] = useState(mine.minimumBid);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [confirm, setConfirm] = useState(false);
  const { fontScale } = useWindowDimensions();
  const name = (id: string) => game.players.find(p => p.playerId === id)?.displayName ?? id;
  const choose = (slot: number, id: string) => { setSelected(old => { const next = old.slice(0, slot); next[slot] = id; return next; }); setConfirm(false); };
  const targets = (label: string, slot: number, ids: string[]) => <View key={label} style={{ gap: 8 }}><Text style={T.body}>{label}</Text>{ids.map(id => <HelmButton key={id} label={name(id)} selected={selected[slot] === id} disabled={busy} onPress={() => choose(slot, id)} />)}</View>;
  const submit = (label: string, action: FeedTheKrakenAction, enabled = true) => <HelmButton label={label} disabled={busy || !enabled} onPress={() => send(action)} />;
  if (!mine.canAct) return <Text accessibilityLiveRegion="polite" style={T.body}>{game.phase === 'mutiny' && mine.ownBid !== null ? `Your sealed bid: ${mine.ownBid} guns. Waiting for the remaining crew.` : game.phase === 'ritual' ? 'Keep private information hidden while the ritual resolves.' : game.pendingPlayerId ? `Waiting for ${name(game.pendingPlayerId)}.` : 'Waiting for the navigation team.'}</Text>;
  if (game.phase === 'priority') {
    const slots = targetSlots(mine.character);
    const legal = slots.every((_, i) => characterTargets(game, mine.character, mine.playerId, i, selected).some(p => p.playerId === selected[i]));
    return <View style={{ gap: 12 }}><Text style={T.heading}>{N[mine.character]}</Text><Text style={T.body}>{S[mine.character]}</Text>
      <Text style={T.muted}>Window: {game.window?.replaceAll('_', ' ')}. Revealing a character uses its ability. Passing keeps it for later.</Text>
      {mine.canUseCharacter ? <>{slots.map((label, slot) => targets(label, slot, characterTargets(game, mine.character, mine.playerId, slot, selected).map(p => p.playerId)))}{submit('Reveal and use character', { type: 'character', targets: selected }, legal)}</> : <Text style={T.muted}>Your ability is not available in this window.</Text>}
      {submit('Pass this window', { type: 'pass' })}</View>;
  }
  if (game.phase === 'appointment') {
    const lieutenant = game.effects.forcedLieutenantId ?? selected[0];
    return <View style={{ gap: 12 }}>{game.effects.forcedLieutenantId ? <Text style={T.body}>Adviser appointed {name(lieutenant)} as lieutenant.</Text> : targets('Lieutenant', 0, mine.legalTargetIds)}
      {targets('Navigator', 1, mine.legalTargetIds.filter(id => id !== lieutenant))}
      {submit('Confirm navigation team', { type: 'appoint', lieutenantId: lieutenant, navigatorId: selected[1] }, mine.legalTargetIds.includes(lieutenant) && mine.legalTargetIds.includes(selected[1]) && lieutenant !== selected[1])}</View>;
  }
  if (game.phase === 'mutiny') return <View style={{ gap: 12 }}><Text style={T.body}>Secretly commit guns to overthrow the captain. Threshold: {game.mutinyThreshold}. Your guns: {mine.ownGuns}.</Text><Text style={T.muted}>Allowed bid: {mine.minimumBid}–{mine.maximumBid}. Submitted bids cannot be changed.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}><HelmButton label="Fewer guns" disabled={busy || guns <= mine.minimumBid} onPress={() => setGuns(guns - 1)} /><Text style={T.heading}>{guns}</Text><HelmButton label="More guns" disabled={busy || guns >= mine.maximumBid} onPress={() => setGuns(guns + 1)} /></View>
    {submit(`Seal bid: ${guns} guns`, { type: 'bid', guns }, guns >= mine.minimumBid && guns <= mine.maximumBid)}</View>;
  if (game.phase === 'navigation' || game.phase === 'navigator') return <View style={{ gap: 12 }}><Text style={T.body}>{game.phase === 'navigation' ? 'Send one card face down. The others are discarded. Do not communicate during selection.' : 'Choose one course. The other card is discarded; its original sender remains secret.'}</Text>
    <CardGrid items={mine.navigationCards} keyExtractor={card => card.id} minCardWidth={210} maxCardWidth={320} textScale={fontScale}
      renderItem={card => <NavigationCard card={card} selected={selected[0] === card.id} disabled={busy} onSelect={() => choose(0, card.id)} />} />
    {submit(game.phase === 'navigator' ? 'Sail this course' : 'Send this card', { type: game.phase === 'navigator' ? 'navigate' : 'submit_navigation', cardId: selected[0] }, mine.navigationCards.some(c => c.id === selected[0]))}
    {mine.canRedraw && mine.navigationCards[0] ? submit('Use redraw: discard this hand', { type: 'submit_navigation', cardId: mine.navigationCards[0].id, redraw: true }) : null}
    {game.phase === 'navigator' ? <><HelmButton quiet label="Refuse to navigate" disabled={busy} onPress={() => setConfirm(!confirm)} />{confirm ? <><Text style={T.body}>You go overboard and stop acting, but may still win with your faction. A cult leader’s refusal does not win for the cult.</Text>{submit('Confirm refusal and go overboard', { type: 'navigate', refuse: true })}</> : null}</> : null}</View>;
  if (game.phase === 'telescope') return <View style={{ gap: 12 }}><Text style={T.body}>Private top card</Text>{mine.navigationCards.map(card => <View key={card.id} style={{ maxWidth: 320 }}><NavigationCard card={card} /></View>)}{submit('Keep it on top', { type: 'telescope', discard: false })}{submit('Discard it', { type: 'telescope', discard: true })}</View>;
  if (game.phase === 'instigator') return <View style={{ gap: 12 }}><Text style={T.body}>Add all your remaining guns to this mutiny? Declining restores the instigator’s ability.</Text>{submit('Accept: add all remaining guns', { type: 'instigator', accept: true })}{submit('Decline', { type: 'instigator', accept: false })}</View>;
  if (game.phase === 'ritual' && mine.ritual === null) return <View style={{ gap: 12 }}>
    <Text style={T.body}>Review your private panel, then complete your step. Every crew member responds privately so the ritual does not reveal who holds a hidden role.</Text>
    {submit('Complete private ritual', { type: 'ritual' })}
  </View>;
  if (game.phase === 'ritual' && mine.ritual === 'stash') {
    const currentAllocations = Object.fromEntries(mine.legalTargetIds.map(id => [id, allocations[id] ?? 0]));
    const total = Object.values(currentAllocations).reduce((a, b) => a + b, 0), required = mine.ritualGunCount;
    return <View style={{ gap: 12 }}><Text style={T.body}>Secret stash: distribute exactly {required} supply guns. Assigned {total}.</Text>{mine.legalTargetIds.map(id => <View key={id} style={{ gap: 8 }}><Text style={T.body}>{name(id)}: {allocations[id] ?? 0}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[0, 1, 2, 3].map(n => <HelmButton key={n} label={String(n)} selected={(allocations[id] ?? 0) === n} disabled={busy || total - (allocations[id] ?? 0) + n > required} onPress={() => setAllocations({ ...allocations, [id]: n })} />)}</View></View>)}{submit('Confirm distribution', { type: 'ritual', allocations: currentAllocations }, total === required && mine.legalTargetIds.length > 0)}</View>;
  }
  const descriptions = { cabin: 'Privately inspect another player’s current faction.', flogging: 'Publicly rule out one faction for the target.', tongue: 'Cut out the target’s tongue. They cannot speak words or become captain.', feeding: 'Feed the target to the Kraken. Feeding the cult leader immediately wins for the cult.' };
  const label = game.phase === 'tie_veto' ? 'Choose a tied player to EXCLUDE' : game.phase === 'emergency' ? 'Choose the emergency navigator' : game.phase === 'ritual' ? 'Choose a conversion target' : game.phase === 'map_action' ? descriptions[game.mapAction!] : `Choose who receives ${game.currentCard?.effect ?? 'the effect'}`;
  const type = game.phase === 'tie_veto' ? 'veto' : game.phase === 'emergency' ? 'emergency' : game.phase === 'ritual' ? 'ritual' : 'target';
  return <View style={{ gap: 12 }}>{targets(label, 0, mine.legalTargetIds)}{game.mapAction === 'feeding' && !confirm ? <HelmButton label="Review feeding" disabled={busy || !selected[0]} onPress={() => setConfirm(true)} /> : submit(game.mapAction === 'feeding' ? 'Confirm sacrifice' : 'Confirm choice', { type, playerId: selected[0] }, mine.legalTargetIds.includes(selected[0]))}</View>;
}
