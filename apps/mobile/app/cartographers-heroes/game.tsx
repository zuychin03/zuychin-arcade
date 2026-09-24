import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CARTOGRAPHERS_CARD_BY_ID, CARTOGRAPHERS_OBJECTIVE_BY_ID, CARTOGRAPHERS_SEASONS } from '@zuychin-arcade/types';
import { useGameStore } from '../../store/useGameStore';
import { GameRecovery } from '../../components/ui/GameRecovery';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { NeonButton } from '../../components/ui/NeonButton';
import { CardGrid } from '../../components/ui/CardGrid';
import { CARTOGRAPHERS as C } from '../../components/cartographers/palette';
import { CartographersReferenceSheet } from '../../components/cartographers/ReferenceSheet';
import { PlacementEditor } from '../../components/cartographers/PlacementEditor';
import { MapBoard } from '../../components/cartographers/MapBoard';
import { ObjectiveCard } from '../../components/cartographers/ObjectiveCard';
import { ExploreCard } from '../../components/cartographers/ExploreCard';
import { useCartographersActions } from '../../components/cartographers/useCartographersActions';
import { useCartographersLeave } from '../../components/cartographers/useCartographersLeave';

export default function CartographersGame() {
  const game = useGameStore(state => state.cartographersPublic);
  const mine = useGameStore(state => state.cartographersPrivate);
  const playerId = useGameStore(state => state.playerId);
  const room = useGameStore(state => state.room);
  const token = useGameStore(state => state.token);
  const actions = useCartographersActions();
  const [rules, setRules] = useState(false);
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);
  const [showRoster, setShowRoster] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const leave = useCartographersLeave(() => { if (rules) { setRules(false); return true; } return false; });
  if (!game || !mine || !room || mine.playerId !== playerId || mine.roomCode !== room.roomCode
    || game.roomCode !== room.roomCode || mine.revision !== game.revision) {
    return <GameRecovery message="Restoring your chart, assignments and season." background={C.bg} surface={C.surface} border={C.border} accent={C.accent} muted={C.muted} />;
  }
  const over = game.status === 'game_over';
  const busy = actions.busy || leave.leaving;
  const card = game.currentCardId ? CARTOGRAPHERS_CARD_BY_ID[game.currentCardId] ?? null : null;
  const season = CARTOGRAPHERS_SEASONS[Math.min(game.season, 3)]!;
  const assignment = mine.assignments.find(task => task.targetPlayerId === chosenTarget) ?? mine.assignments[0];
  const me = game.players.find(player => player.playerId === playerId)!;
  const active = game.players.filter(player => !player.forfeited);
  const isHost = room.players.some(player => player.playerId === playerId && player.isHost);
  const retained = room.players.filter(player => !player.hasLeft);
  const canRematch = retained.length >= 1 && retained.every(player => player.isConnected);
  const winners = game.winnerIds.map(id => game.players.find(player => player.playerId === id)?.displayName).join(', ');
  const resultMap = mine.resultMaps[0];
  const title = over ? game.endReason === 'abandoned' ? 'The expedition ended' : 'The completed atlas'
    : assignment ? game.phase === 'season_effect' ? 'Resolve the Troll’s ravage' : card?.kind === 'ambush' ? 'An ambush on the frontier' : card?.kind === 'hero' ? 'A hero joins the map' : 'Chart the next discovery'
      : 'Your map is ready';
  const status = over ? game.endReason === 'abandoned' ? 'No winner is awarded.' : game.solo ? `${game.soloTitle ?? 'Solo expedition'} · adjusted rating ${game.soloRating ?? 0}`
    : winners ? `${winners} ${game.winnerIds.length === 1 ? 'wins' : 'share the win'}${game.endReason === 'forfeit' ? ' by forfeit' : ''}.` : 'No winner is awarded.'
    : assignment ? `${mine.assignments.length} assignment${mine.assignments.length === 1 ? '' : 's'} waiting. You are drawing on ${assignment.displayName}’s map.`
      : `${active.filter(player => player.submitted).length}/${active.length} cartographers have settled their assignments.`;
  return <SafeAreaView edges={['top', 'bottom']} style={styles.page}>
    <View style={styles.toolbar}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text accessibilityRole="header" style={styles.title}>Cartographers Heroes</Text>
        <Text style={styles.muted}>{over ? 'Results' : `${season.name} · ${game.elapsed}/${game.threshold} time`} · {room.roomCode}</Text></View>
      <ScalePressable accessibilityLabel="Open Cartographers rules" onPress={() => setRules(true)} style={styles.icon}><MaterialCommunityIcons name="book-open-page-variant-outline" size={24} color={C.accent} /></ScalePressable>
      <ScalePressable accessibilityLabel="Leave the charting table" disabled={leave.leaving} onPress={leave.requestLeave} style={styles.icon}><MaterialCommunityIcons name="exit-to-app" size={24} color={C.muted} /></ScalePressable>
    </View>
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.content}>
        <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={styles.heading}>{title}</Text><Text style={styles.body}>{status}</Text>
          {me?.forfeited ? <Text style={{ ...styles.body, color: C.danger }}>Your seat forfeited. This map no longer scores or qualifies for victory.</Text> : null}
          {actions.message || leave.error ? <Text accessibilityRole="alert" style={{ ...styles.body, color: C.danger }}>{leave.error ?? actions.message}</Text> : null}
          {actions.busy && !actions.pending ? <View style={{ gap: 8 }}><Text style={styles.muted}>Synchronising your private map. Drawing controls are temporarily locked.</Text><NeonButton label="RETRY CONNECTION" color={C.accent} variant="outline" onPress={actions.refresh} /></View> : null}
        </View>
        {over ? <View style={{ gap: 16 }}>
          <Text style={styles.body}>Final score: {me?.totalScore ?? 0}. Select one cartographer below to inspect their completed map.</Text>
          <MapBoard map={resultMap?.map ?? mine.map} side={game.mapSide} label={resultMap?.displayName ?? 'Your completed chart'} />
          <Text style={styles.muted}>{canRematch ? isHost ? 'You can open another expedition with these connected seats.' : 'The host can open another expedition.' : 'Wait for retained seats to reconnect, or leave to create a new room.'}</Text>
          {isHost ? <NeonButton label="CHART AGAIN" color={C.accent} disabled={busy || !canRematch} onPress={() => actions.send('start')} /> : null}
          <NeonButton label="RETURN TO ARCADE" color={C.accent} variant="outline" disabled={leave.leaving} onPress={leave.requestLeave} />
        </View> : assignment ? <View style={{ gap: 16 }}>
          {mine.assignments.length > 1 ? <View style={{ gap: 8 }}><Text style={styles.body}>A departure can leave you more than one map to settle. Choose a map, then confirm it separately.</Text>
            {mine.assignments.map(task => <NeonButton key={task.targetPlayerId} label={`DRAW ON ${task.displayName.toLocaleUpperCase()}’S MAP`} color={C.accent}
              variant={assignment.targetPlayerId === task.targetPlayerId ? 'solid' : 'outline'} disabled={busy} onPress={() => setChosenTarget(task.targetPlayerId)} />)}
          </View> : null}
          <PlacementEditor key={`${token}:${game.turnId}:${assignment.submissionToken}`} assignment={assignment} card={card} side={game.mapSide} destruction={game.phase === 'season_effect'} busy={busy}
            onPlace={choice => actions.send('place', choice, assignment)} onDestroy={position => actions.send('destroy', position, assignment)} />
        </View> : <View style={{ gap: 16 }}><MapBoard map={mine.map} side={game.mapSide} label="Your chart" />{card ? <ExploreCard card={card} /> : null}</View>}

        <View style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={styles.heading}>Your season ledger</Text>
          <Text style={styles.body}>{mine.map.coins}/14 coins · {me?.totalScore ?? 0} total points</Text>
          {me?.scores.length ? me.scores.map(score => <View key={score.season} style={styles.row}>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={styles.body}>{CARTOGRAPHERS_SEASONS[score.season]?.name ?? `Season ${score.season + 1}`}</Text>
              <Text style={styles.muted}>Objectives {score.objectives[0]} + {score.objectives[1]} · coins +{score.coins} · monsters −{score.monsterPenalty}</Text></View><Text style={styles.score}>{score.total}</Text>
          </View>) : <Text style={styles.muted}>Scores settle after the season’s time limit. Your coins score again in later seasons.</Text>}
        </View>
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={styles.heading}>The royal objectives</Text>
          <Text style={styles.body}>{over ? 'Each objective scored twice during the expedition.' : `${season.name} scores ${season.edicts.map(index => 'ABCD'[index]).join(' + ')}.`}</Text>
          <CardGrid items={game.objectiveIds} keyExtractor={id => id} minCardWidth={240} maxCardWidth={350} gap={16}
            renderItem={id => <ObjectiveCard objective={CARTOGRAPHERS_OBJECTIVE_BY_ID[id]!} edict={'ABCD'[game.objectiveIds.indexOf(id)]} active={!over && (season.edicts as readonly number[]).includes(game.objectiveIds.indexOf(id))} />} />
        </View>
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={styles.heading}>{over ? 'Expedition results' : 'At the charting table'}</Text>
          {[...game.players].sort((a, b) => Number(a.forfeited) - Number(b.forfeited) || b.totalScore - a.totalScore).slice(0, showRoster ? undefined : 10).map(player => <View key={player.playerId} style={styles.row}>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={styles.body}>{player.displayName}{player.playerId === playerId ? ' (you)' : ''}</Text>
              <Text style={styles.muted}>{player.forfeited ? 'Forfeited' : game.winnerIds.includes(player.playerId) ? 'Winner' : over ? 'Expedition complete' : player.submitted ? 'Ready' : 'Drawing'} · {player.coins} coins</Text>
              {over ? <NeonButton label="INSPECT MAP" color={C.accent} variant="outline" disabled={busy} onPress={() => actions.send('inspect_map', player.playerId)} /> : null}
            </View><Text style={styles.score}>{player.totalScore}</Text>
          </View>)}
          {game.players.length > 10 ? <NeonButton label={showRoster ? 'SHOW TOP TEN' : `SHOW ALL ${game.players.length} CARTOGRAPHERS`} color={C.accent} variant="ghost" onPress={() => setShowRoster(!showRoster)} /> : null}
        </View>
        {game.revealedCardIds.length ? <View style={{ gap: 12 }}>
          <NeonButton label={showHistory ? 'HIDE REVEALED CARDS' : `REVEALED CARDS · ${game.revealedCardIds.length}`} color={C.accent} variant="outline" onPress={() => setShowHistory(!showHistory)} />
          {showHistory ? <CardGrid items={game.revealedCardIds} keyExtractor={(id, index) => `${index}:${id}`} minCardWidth={240} maxCardWidth={350} gap={16} renderItem={id => <ExploreCard card={CARTOGRAPHERS_CARD_BY_ID[id]!} />} /> : null}
        </View> : null}
      </View>
    </ScrollView>
    <CartographersReferenceSheet visible={rules} onClose={() => setRules(false)} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg }, toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: C.surface },
  title: { color: C.text, fontFamily: 'Outfit_800ExtraBold', fontSize: 20 }, heading: { color: C.accent, fontFamily: 'Outfit_700Bold', fontSize: 24 },
  body: { color: C.text, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24 }, muted: { color: C.muted, fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 21 },
  icon: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  scroll: { padding: 16, paddingBottom: 32, flexGrow: 1 }, content: { width: '100%', maxWidth: 1200, alignSelf: 'center', gap: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  score: { color: C.secondary, fontFamily: 'SpaceMono_700Bold', fontSize: 20 },
});
