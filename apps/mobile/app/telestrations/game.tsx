import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useGameStore } from '../../store/useGameStore';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { GameRecovery } from '../../components/ui/GameRecovery';
import { CardSurface } from '../../components/ui/CardSurface';
import { BookDraft, type LocalBookDraft } from '../../components/telestrations/BookDraft';
import { Drawing } from '../../components/telestrations/Drawing';
import { Scoring } from '../../components/telestrations/Scoring';
import { BookButton, typography as T } from '../../components/telestrations/Controls';
import { TelestrationsReferenceSheet } from '../../components/telestrations/ReferenceSheet';
import { useTelestrationsActions } from '../../components/telestrations/useTelestrationsActions';
import { useTelestrationsLeave } from '../../components/telestrations/useTelestrationsLeave';
import { TELESTRATIONS as C } from '../../components/telestrations/palette';

export default function TelestrationsGame() {
  const game = useGameStore(s => s.telestrationsPublic);
  const mine = useGameStore(s => s.telestrationsPrivate);
  const room = useGameStore(s => s.room);
  const playerId = useGameStore(s => s.playerId);
  const token = useGameStore(s => s.token);
  const { width, fontScale } = useWindowDimensions();
  const actions = useTelestrationsActions();
  const [rules, setRules] = useState(false);
  const cache = useRef(new Map<string, LocalBookDraft>());
  const leave = useTelestrationsLeave(() => { if (rules) { setRules(false); return true; } return false; });
  const identity = token && mine?.windowId ? `${token}/${mine.windowId}` : null;
  useEffect(() => { cache.current.clear(); }, [token]);
  useEffect(() => { if (identity) for (const key of cache.current.keys()) if (key !== identity) cache.current.delete(key); }, [identity]);
  if (!game || !mine || !room || mine.playerId !== playerId || mine.roomCode !== room.roomCode || game.roomCode !== room.roomCode) {
    return <GameRecovery message="Restoring your sketchbook and private page." background={C.bg} surface={C.surface} border={C.border} accent={C.accent} muted={C.muted} />;
  }
  const isOver = game.phase === 'game_over';
  const active = ['prompt', 'draw', 'guess'].includes(game.phase);
  const name = (id: string) => game.players.find(p => p.id === id)?.displayName ?? 'Departed player';
  const owner = game.revealOwnerId === playerId;
  const me = game.players.find(p => p.id === playerId);
  const busy = actions.busy || leave.leaving || Boolean(me?.forfeited);
  const wide = width >= 1000 * Math.max(1, fontScale);
  const canStart = room.players.some(p => p.playerId === playerId && p.isHost);
  const rematchSeats = room.players.filter(p => !p.hasLeft);
  const canRematch = rematchSeats.length >= 4 && rematchSeats.length <= 12 && rematchSeats.every(p => p.isConnected);
  const title = game.phase === 'prompt' ? 'Begin with a secret' : game.phase === 'draw' ? 'Turn words into a drawing' : game.phase === 'guess' ? 'Put the drawing into words'
    : game.phase === 'reveal' || game.phase === 'scoring' ? `${name(game.revealOwnerId!)}’s sketchbook` : game.phase === 'round_end' ? 'Round complete' : game.endReason === 'insufficient_players' ? 'The table has ended' : 'Three rounds, many surprises';
  const hint = game.phase === 'prompt' ? `${game.seats.length % 2 ? 'An odd table: pass before the first drawing.' : 'An even table: draw your own secret first.'} Everyone locks in before the books pass.`
    : active ? 'Only the previous page is yours to interpret. Take your time; there is no countdown.'
      : game.phase === 'round_end' ? 'Every book has been revealed. These points are settled.'
        : isOver ? game.endReason === 'insufficient_players' ? 'Fewer than four players remain. Settled points stay, but no winner is awarded.' : game.scoringMode === 'none' ? 'A shared collection of unexpected stories. No scores or winners.' : `${game.winnerIds.map(name).join(', ')} ${game.winnerIds.length > 1 ? 'share the win' : 'wins'}.`
          : owner ? 'You guide this reveal. Show each page before judging the book.' : `${name(game.revealOwnerId!)} is guiding this reveal.`;
  return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom', 'left', 'right']}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: C.surface }}>
      <View style={{ flex: 1, minWidth: 0 }}><Text accessibilityRole="header" style={[T.heading, { color: C.text }]}>Telestrations</Text><Text style={T.muted}>Round {Math.min(3, game.completedRounds + (game.phase === 'round_end' ? 0 : 1))} of 3 · {room.roomCode}</Text></View>
      <ScalePressable accessibilityLabel="Open Telestrations rules" onPress={() => setRules(true)} style={{ width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="book-open-page-variant-outline" size={24} color={C.accent} /></ScalePressable>
      <ScalePressable accessibilityLabel="Leave the sketchbooks" onPress={leave.requestLeave} disabled={leave.leaving} style={{ width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="exit-to-app" size={24} color={C.muted} /></ScalePressable>
    </View>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={{ width: '100%', maxWidth: 1120, alignSelf: 'center', gap: 24 }}>
          <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={T.title}>{title}</Text><Text style={T.body}>{hint}</Text>
            {game.cancelledRounds.length > 0 && !isOver ? <Text style={T.muted}>A player left earlier. The unfinished round restarted without using a scoring round.</Text> : null}
            {actions.message || leave.error ? <Text accessibilityRole="alert" style={[T.body, { color: C.secondary }]}>{leave.error ?? actions.message}</Text> : null}
            {actions.busy && !actions.pending ? <View style={{ gap: 8 }}><Text style={T.muted}>Synchronising your private page. Editing resumes when the table and your page agree.</Text><BookButton label="Check connection" quiet onPress={actions.refresh} /></View> : null}
          </View>
          <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'flex-start' : 'stretch', gap: 24 }}>
            <View style={{ flex: wide ? 1 : undefined, minWidth: 0, width: wide ? undefined : '100%', maxWidth: 680, gap: 20 }}>
              {active && mine.draft && identity ? <BookDraft key={identity} game={game} mine={mine} actions={actions} leaving={leave.leaving} cached={cache.current.get(identity)} remember={value => cache.current.set(identity, value)} /> : null}
              {game.revealed ? <View style={{ gap: 12 }}>
                <Text style={T.heading}>{game.revealPage === -1 ? 'The original secret' : `Page ${game.revealPage + 1} · ${'authorId' in game.revealed ? name(game.revealed.authorId) : ''}`}</Text>
                {typeof game.revealed.content === 'string' ? <CardSurface radius={12} faceColor={C.panel} edgeColor={C.bg} highlightColor={C.border}><Text selectable style={[T.body, { fontSize: 24, lineHeight: 34, padding: 24 }]}>{game.revealed.content}</Text></CardSurface>
                  : <View accessibilityLabel="Revealed drawing" style={{ overflow: 'hidden', borderRadius: 12 }}><Drawing drawing={game.revealed.content} /></View>}
              </View> : null}
              {game.phase === 'reveal' && owner ? <BookButton testID="telestrations-next-page" label="Reveal the next page" disabled={busy} onPress={() => actions.send('reveal')} /> : null}
              {game.phase === 'scoring' && owner ? <Scoring key={`${game.completedRounds}/${game.revealBook}`} game={game} actions={actions} disabled={busy} /> : null}
              {game.phase === 'scoring' && !owner ? <Text style={T.body}>{name(game.revealOwnerId!)} is reviewing the book{game.scoringMode === 'none' ? '.' : ' and choosing its points.'}</Text> : null}
              {game.phase === 'round_end' ? <View style={{ gap: 12 }}>
                <Text style={T.body}>{name(game.seats[0])} opens the next round when everyone is ready.</Text>
                {game.seats[0] === playerId ? <BookButton label="Open the next round" disabled={busy} onPress={() => actions.send('next_round')} /> : null}
              </View> : null}
              {isOver ? <View style={{ gap: 16 }}>
                <Text style={T.body}>{canRematch ? canStart ? 'Open fresh sketchbooks for this table.' : 'The host can start another game.' : 'A new game needs 4–12 connected players. Wait for reconnecting seats, or leave and create a new table.'}</Text>
                {canStart ? <BookButton label="Play again" disabled={busy || !canRematch} onPress={() => actions.send('start')} /> : null}
                <BookButton label="Return to Arcade" quiet disabled={leave.leaving} onPress={leave.requestLeave} />
              </View> : null}
            </View>
            <View style={{ width: wide ? 264 : '100%', minWidth: 0, gap: 12 }}>
              <Text accessibilityRole="header" style={T.heading}>{isOver ? 'The final table' : 'At the table'}</Text>
              <Text style={T.muted}>{game.scoringMode === 'none' ? 'Just for laughs' : `${game.scoringMode === 'friendly' ? 'Friendly' : 'Competitive'} scoring`} · {game.direction === 1 ? 'Clockwise' : 'Anticlockwise'}</Text>
              {game.players.map(p => <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={T.body}>{p.displayName}{p.id === playerId ? ' (you)' : ''}</Text>
                  <Text style={T.muted}>{p.forfeited ? 'Forfeited' : game.winnerIds.includes(p.id) ? 'Winner' : active ? game.readyIds.includes(p.id) ? 'Page locked' : 'Creating a page' : p.id === game.revealOwnerId ? 'Revealing this book' : 'At the table'}</Text>
                  {game.pendingScores[p.id] > 0 ? <Text style={T.muted}>+{game.pendingScores[p.id]} provisional this round</Text> : null}
                </View>
                {game.scoringMode !== 'none' ? <Text accessibilityLabel={`${p.score} settled points`} style={{ fontFamily: 'SpaceMono_700Bold', fontSize: 20, color: C.secondary }}>{p.score}</Text> : null}
              </View>)}
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    <TelestrationsReferenceSheet visible={rules} onClose={() => setRules(false)} />
  </SafeAreaView>;
}
