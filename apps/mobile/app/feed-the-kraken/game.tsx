import { useEffect, useState } from 'react';
import { AppState, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameStore } from '../../store/useGameStore';
import { GameRecovery } from '../../components/ui/GameRecovery';
import { CardSurface } from '../../components/ui/CardSurface';
import { CharacterCard } from '../../components/kraken/CharacterCard';
import { HelmButton, typography as T } from '../../components/kraken/Controls';
import { KRAKEN as C } from '../../components/kraken/palette';
import { VoyageMap } from '../../components/kraken/VoyageMap';
import { DecisionPanel } from '../../components/kraken/DecisionPanel';
import { KrakenReferenceSheet } from '../../components/kraken/ReferenceSheet';
import { phaseNames } from '../../components/kraken/decisions';
import { useKrakenActions } from '../../components/kraken/useKrakenActions';
import { useKrakenLeave } from '../../components/kraken/useKrakenLeave';
export default function Game() {
  const game = useGameStore(s => s.krakenPublic), mine = useGameStore(s => s.krakenPrivate), room = useGameStore(s => s.room);
  const playerId = useGameStore(s => s.playerId), token = useGameStore(s => s.token);
  const [rules, setRules] = useState(false), [privateKey, setPrivateKey] = useState<string | null>(null);
  useEffect(() => { const listener = AppState.addEventListener('change', state => { if (state !== 'active') setPrivateKey(null); }); return () => listener.remove(); }, []);
  const actions = useKrakenActions();
  const leave = useKrakenLeave(() => { if (rules) { setRules(false); return true; } if (privateKey) { setPrivateKey(null); return true; } return false; });
  const { width, fontScale } = useWindowDimensions();
  if (!game || !mine || !room || mine.playerId !== playerId || mine.viewerPlayerId !== playerId || mine.roomCode !== room.roomCode || game.roomCode !== room.roomCode || mine.revision !== game.revision) return <GameRecovery message="Restoring your private allegiance and the ship’s position." background={C.bg} surface={C.surface} border={C.border} accent={C.accent} muted={C.muted} />;
  const identity = `${token}/${game.round}/${game.windowId}/${game.phase}`;
  const revealed = privateKey === identity;
  const over = game.status === 'game_over', me = game.players.find(p => p.playerId === playerId);
  const name = (id: string | null) => game.players.find(p => p.playerId === id)?.displayName ?? 'Unassigned';
  const wide = width >= 1000 * Math.max(1, fontScale);
  const seats = room.players.filter(p => !p.hasLeft), min = game.journey === 'long' ? 7 : 5;
  const host = room.players.some(p => p.playerId === playerId && p.isHost);
  const rematch = seats.length >= min && seats.length <= 11 && seats.every(p => p.isConnected);
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: C.bg }}><ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}><View style={{ width: '100%', maxWidth: 1180, alignSelf: 'center', gap: 24 }}>
    <View style={{ gap: 12 }}><Text accessibilityRole="header" style={T.title}>Feed the Kraken</Text><Text style={T.muted}>{room.roomCode} · Command cycle {game.round} · {game.journey} voyage</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><HelmButton quiet label="Ship’s reference" onPress={() => setRules(true)} /><HelmButton quiet label="Leave voyage" disabled={leave.leaving} onPress={leave.requestLeave} /></View></View>
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={T.heading}>{phaseNames[game.phase]}</Text>
    {actions.message || leave.error ? <Text accessibilityRole="alert" style={T.body}>{leave.error ?? actions.message}</Text> : null}
    {actions.busy && !actions.pending ? <View style={{ gap: 8 }}><Text style={T.body}>Synchronising the ship and your private information. Commands are paused.</Text><HelmButton label="Check connection" onPress={actions.refresh} /></View> : null}
    {over ? <View testID="kraken-results" style={{ gap: 12 }}><Text accessibilityRole="header" style={T.title}>{game.winner ? `${game.winner.toUpperCase()} VICTORY` : 'No winning faction'}</Text><Text style={T.body}>{game.endReason === 'leader_fed' ? 'The cult leader was fed to the Kraken.' : game.endReason === 'no_participants' ? 'No eligible participants remain.' : 'The ship reached its destination.'}</Text><Text style={T.body}>{game.winnerIds.map(name).join(', ') || 'No eligible individual winners.'}</Text>{host ? <HelmButton label="Sail again" disabled={actions.busy || !rematch || leave.leaving} onPress={() => actions.send('start')} /> : null}<Text style={T.muted}>A rematch needs {min}–11 connected seats and the host’s confirmation.</Text></View> : null}
    <View style={{ flexDirection: wide ? 'row' : 'column', gap: 24, alignItems: 'stretch' }}>
      <View style={{ flex: wide ? 1 : undefined, minWidth: 0, gap: 20 }}><VoyageMap journey={game.journey} nodeId={game.nodeId} /><Text style={T.body}>Captain: {name(game.captainId)}{game.lieutenantId ? ` · Lieutenant: ${name(game.lieutenantId)}` : ''}{game.navigatorId ? ` · Navigator: ${name(game.navigatorId)}` : ''}</Text><Text style={T.muted}>Deck {game.drawCount} · Discard {game.discardCount} · Supply {game.supplyGuns} guns</Text>
        {game.bids ? <View style={{ gap: 6 }}><Text style={T.heading}>Revealed mutiny bids</Text>{Object.entries(game.bids).map(([id, amount]) => <Text key={id} style={T.body}>{name(id)}: {amount} guns · {amount * (game.effects.doubledPlayerIds.includes(id) ? 2 : 1)} strength</Text>)}</View> : null}
      </View>
      {!over ? <View style={{ flex: wide ? 1 : undefined, minWidth: 0, gap: 16 }}>
          <HelmButton label={revealed ? 'Hide private information' : 'Open my private panel'} quiet onPress={() => setPrivateKey(revealed ? null : identity)} />
          {revealed ? <CardSurface radius={16} faceColor={C.surface} edgeColor={C.bg} highlightColor={C.border}><View style={{ padding: 16, gap: 16 }}><Text style={T.heading}>Private · {mine.faction.replaceAll('_', ' ')}</Text><Text style={T.body}>{mine.ownGuns} guns</Text>{mine.knownPirateIds.length ? <Text style={T.body}>Known pirates: {mine.knownPirateIds.map(name).join(', ')}</Text> : null}{mine.knownLeaderId ? <Text style={T.body}>Known cult leader: {name(mine.knownLeaderId)}</Text> : null}
            <CharacterCard character={mine.character} compact />
            <DecisionPanel key={identity} game={game} mine={mine} busy={actions.busy || leave.leaving || Boolean(me?.forfeited)} send={actions.send} showCharacterCopy={false} />
            {mine.observations.length ? <View style={{ gap: 8 }}><Text style={T.heading}>Your observations</Text>{mine.observations.map((o, i) => <Text key={i} style={T.body}>{o.kind.replaceAll('_', ' ')}{o.playerId ? ` · ${name(o.playerId)}` : ''}{o.faction ? ` · ${o.faction.replaceAll('_', ' ')}` : ''}{o.cards ? ` · ${o.cards.map(c => `${c.colour}/${c.effect}`).join(', ')}` : ''}</Text>)}</View> : null}
          </View></CardSurface> : <Text style={T.body}>{mine.canAct ? 'Your decision is ready. Open your panel privately to act.' : 'Waiting for the crew. Your allegiance stays hidden.'}</Text>}
      </View> : null}
    </View>
    <View style={{ gap: 12 }}><Text style={T.heading}>Crew manifest</Text>{game.players.map(p => <View key={p.playerId} style={{ gap: 6, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}><Text style={T.body}>{p.displayName}{p.playerId === playerId ? ' (you)' : ''} · {p.forfeited ? 'Forfeited' : p.aboard ? 'Aboard' : `Overboard: ${p.departureReason}`}</Text><Text style={T.muted}>{p.guns === null ? 'Guns concealed during bidding' : `${p.guns} guns`}{p.offDuty ? ' · Off duty' : ''}{p.tongueless ? ' · No words or captaincy' : ''}{p.conversionImmune ? ' · Conversion immune' : ''}{p.notFactions.length ? ` · Not ${p.notFactions.join(' / ')}` : ''}</Text>{p.character ? <CharacterCard character={p.character} compact /> : null}{over && p.faction ? <Text style={T.body}>Final faction: {p.faction.replaceAll('_', ' ')}</Text> : null}{p.resume.length ? <Text style={T.muted}>Navigation résumé: {p.resume.map(c => `${c.colour}/${c.effect}`).join(' · ')}</Text> : null}</View>)}</View>
    <View style={{ gap: 8 }}><Text style={T.heading}>Ship’s log</Text>{game.log.slice(-30).map((entry, i) => <Text key={`${entry.revision}/${i}`} style={T.muted}>{entry.message}</Text>)}</View>
  </View></ScrollView><KrakenReferenceSheet visible={rules} onClose={() => setRules(false)} /></SafeAreaView>;
}
