import { useEffect, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { DixitCardId } from '@zuychin-arcade/types';
import { DIXIT_CLUE_MAX_LENGTH } from '@zuychin-arcade/types';
import { DIXIT as C } from '../../constants/theme';
import { useGameStore } from '../../store/useGameStore';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';
import { CardGrid } from '../../components/ui/CardGrid';
import { NeonButton } from '../../components/ui/NeonButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { GameRecovery } from '../../components/ui/GameRecovery';
import { DreamCard } from '../../components/dixit/DreamCard';
import { DixitReferenceSheet } from '../../components/dixit/ReferenceSheet';
import { useDixitActions } from '../../components/dixit/useDixitActions';
import { useDixitLeave } from '../../components/dixit/useDixitLeave';

export default function DixitGame() {
  const game = useGameStore(state => state.dixitPublic);
  const mine = useGameStore(state => state.dixitPrivate);
  const room = useGameStore(state => state.room);
  const playerId = useGameStore(state => state.playerId);
  const token = useGameStore(state => state.token);
  const { width, height, fontScale } = useWindowDimensions();
  const actions = useDixitActions();
  const [rules, setRules] = useState(false);
  const [inspect, setInspect] = useState<DixitCardId | null>(null);
  const [chosen, setChosen] = useState<DixitCardId[]>([]);
  const [clue, setClue] = useState('');
  const [votes, setVotes] = useState<[number | null, number | null]>([null, null]);
  const leave = useDixitLeave(() => {
    if (inspect) { setInspect(null); return true; }
    if (rules) { setRules(false); return true; }
    return false;
  });
  useWebModalFocus(inspect !== null, 'dixit-image-detail', () => setInspect(null));
  useEffect(() => {
    setChosen([]); setClue(''); setVotes([null, null]); setInspect(null);
  }, [game?.roundNumber, game?.phase, token]);
  if (!game || !mine || !room || mine.playerId !== playerId || game.roomCode !== room.roomCode) {
    return <GameRecovery message="Restoring your story and private hand." background={C.bg} surface={C.surface}
      border={C.border} accent={C.accent} muted={C.muted} />;
  }
  const me = game.players.find(player => player.playerId === playerId);
  const active = game.players.filter(player => !player.forfeited);
  const storyteller = game.players.find(player => player.playerId === game.storytellerId);
  const canTell = game.phase === 'clue' && (!game.storytellerId || game.storytellerId === playerId) && !me?.forfeited;
  const canSubmit = game.phase === 'submit' && game.storytellerId !== playerId && !me?.submitted && !me?.forfeited;
  const canVote = game.phase === 'vote' && game.storytellerId !== playerId && !me?.voted && !me?.forfeited;
  const isOver = game.status === 'game_over';
  const canReady = game.phase === 'reveal' && !me?.ready && !me?.forfeited;
  const isHost = room.players.some(player => player.playerId === playerId && player.isHost);
  const rematchSeats = room.players.filter(player => !player.hasLeft);
  const rematchAllowed = rematchSeats.length >= 3 && rematchSeats.every(player => player.isConnected);
  const busy = actions.busy || leave.leaving;
  const trimmedClue = clue.trim();
  const clueHasControls = /[\u0000-\u001f\u007f]/u.test(trimmedClue);
  const validClue = trimmedClue.length > 0 && trimmedClue.length <= DIXIT_CLUE_MAX_LENGTH && !clueHasControls;
  const number = (id: DixitCardId) => id.slice(6);
  const name = (id: string) => game.players.find(player => player.playerId === id)?.displayName ?? 'Departed player';
  const choose = (id: DixitCardId) => {
    if (busy) return;
    const limit = canTell ? 1 : mine.submissionCount;
    setChosen(current => current.includes(id) ? current.filter(card => card !== id) : limit === 1 ? [id] : current.length < limit ? [...current, id] : current);
  };
  const decision = canTell ? 'Tell a story' : canSubmit ? `Choose ${mine.submissionCount === 2 ? 'two images' : 'an image'}`
    : canVote ? 'Find the storyteller’s image' : game.phase === 'reveal' ? 'The story revealed'
      : isOver ? game.terminationReason ? 'Game ended without a winner' : 'The final story' : 'Waiting at the table';
  const hint = canTell ? 'Choose one image, then give a clue that only some players will recognise.'
    : canSubmit ? `Match “${game.clue}” with ${mine.submissionCount === 2 ? 'two images' : 'an image'} from your hand.`
      : canVote ? 'Use both votes. Place them together or split them; your own images cannot receive your votes.'
        : game.phase === 'clue' ? `${storyteller?.displayName ?? 'The first inspired player'} is choosing a clue.`
          : game.phase === 'submit' ? `${active.filter(player => player.submitted).length}/${active.length} players have chosen their images.`
            : game.phase === 'vote' ? `${active.filter(player => player.voted).length}/${active.length - 1} voters have locked in.`
              : isOver && game.terminationReason ? 'Fewer than three players remain. No winner is awarded.'
                : 'Look through the images and see where every vote landed.';
  const voteSummary = (mine.votes ?? votes).map((slot, index) => `Vote ${index + 1}: ${slot === null ? 'not placed' : `image ${slot}`}`).join(' · ');
  const sideBySide = width >= 1000 * Math.max(1, fontScale);
  const winners = game.winnerIds.map(name).join(', ');
  const keyboard = Platform.OS === 'ios' ? { automaticallyAdjustKeyboardInsets: true } : {};

  return <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
    <View style={styles.toolbar}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text accessibilityRole="header" style={styles.title}>Dixit Odyssey</Text>
        <Text style={styles.muted}>Round {game.roundNumber} · {room.roomCode}</Text>
      </View>
      <ScalePressable accessibilityLabel="Open Dixit rules" onPress={() => setRules(true)} style={styles.iconButton}>
        <MaterialCommunityIcons name="book-open-page-variant-outline" color={C.accent} size={24} />
      </ScalePressable>
      <ScalePressable accessibilityLabel="Leave the Dixit table" onPress={leave.requestLeave} disabled={leave.leaving} style={styles.iconButton}>
        <MaterialCommunityIcons name="exit-to-app" color={C.muted} size={24} />
      </ScalePressable>
    </View>
    <ScrollView {...keyboard} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
      <View style={{ width: '100%', maxWidth: 1200, alignSelf: 'center', gap: 20 }}>
        <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={styles.heading}>{decision}</Text>
          <Text style={styles.body}>{hint}</Text>
          {game.clue ? <Text selectable style={styles.clue}>“{game.clue}”</Text> : null}
          {isOver && !game.terminationReason ? <Text style={{ ...styles.body, color: C.secondary }}>{winners ? `${winners} ${game.winnerIds.length > 1 ? 'share the win' : 'wins'}!` : 'No winner.'}</Text> : null}
          {actions.message || leave.error ? <Text accessibilityRole="alert" style={{ ...styles.body, color: C.secondary }}>{leave.error ?? actions.message}</Text> : null}
          {actions.busy && !actions.pending ? <Text style={styles.muted}>Synchronising the table. Controls will return when your private hand is ready.</Text> : null}
        </View>
        <View style={{ flexDirection: sideBySide ? 'row' : 'column', gap: 24, alignItems: sideBySide ? 'flex-start' : 'stretch' }}>
          <View style={{ flex: sideBySide ? 1 : undefined, minWidth: 0, gap: 20 }}>
            {game.table.length ? <View style={{ gap: 12 }}>
              {(game.phase === 'vote' && game.storytellerId !== playerId) ? <Text accessibilityLiveRegion="polite" style={styles.body}>{voteSummary}{mine.votes ? ' · Locked in' : ''}</Text> : null}
              <CardGrid items={game.table} keyExtractor={item => String(item.slot)} minCardWidth={132} maxCardWidth={220} gap={16}
                renderItem={(item, cardWidth) => {
                  const own = mine.submittedCardIds.includes(item.cardId);
                  const correct = game.result?.storytellerCardId === item.cardId;
                  const submittedBy = game.result?.submissions.find(submission => submission.cardIds.includes(item.cardId))?.playerId;
                  const attracted = game.result?.votes.flatMap(vote => vote.slots.flatMap((slot, index) => slot === item.slot ? [`${name(vote.playerId)} (${index + 1})`] : []));
                  return <View style={{ gap: 8 }}>
                    <DreamCard cardId={item.cardId} width={cardWidth} selected={correct || votes.includes(item.slot)} onInspect={() => setInspect(item.cardId)} />
                    <Text style={{ ...styles.body, fontFamily: 'Outfit_700Bold', color: correct ? C.secondary : C.text }}>Image {item.slot}{correct ? ' · Storyteller' : own && !game.result ? ' · Yours' : ''}</Text>
                    {canVote ? <View style={{ flexDirection: 'row', gap: 8 }}>
                      {([0, 1] as const).map(dial => <ScalePressable key={dial} disabled={busy || own}
                        accessibilityLabel={`Place vote ${dial + 1} on image ${item.slot}${own ? ', your own image cannot be chosen' : ''}`}
                        accessibilityState={{ selected: votes[dial] === item.slot, disabled: busy || own }}
                        onPress={() => setVotes(current => dial === 0 ? [item.slot, current[1]] : [current[0], item.slot])}
                        style={{ ...styles.voteButton, backgroundColor: votes[dial] === item.slot ? C.accent : C.panel, opacity: own ? 0.4 : 1 }}>
                        <MaterialCommunityIcons name={dial === 0 ? 'numeric-1-circle-outline' : 'numeric-2-circle-outline'} size={26} color={votes[dial] === item.slot ? C.bg : C.text} />
                      </ScalePressable>)}
                    </View> : null}
                    {submittedBy ? <Text style={styles.muted}>From {name(submittedBy)}</Text> : null}
                    {attracted?.length ? <Text style={styles.muted}>Votes: {attracted.join(', ')}</Text> : game.result ? <Text style={styles.muted}>No votes</Text> : null}
                  </View>;
                }} />
            </View> : null}

            {(canTell || canSubmit) ? <View style={{ gap: 12 }}>
              <Text accessibilityRole="header" style={styles.heading}>Your hand</Text>
              <CardGrid items={mine.hand} keyExtractor={id => id} minCardWidth={132} maxCardWidth={220} gap={16}
                renderItem={(id, cardWidth) => <View style={{ gap: 8 }}>
                  <DreamCard cardId={id} width={cardWidth} selected={chosen.includes(id)} onInspect={() => setInspect(id)} />
                  <NeonButton label={`${chosen.includes(id) ? 'SELECTED' : 'CHOOSE'} ${number(id)}`} disabled={busy}
                    variant={chosen.includes(id) ? 'solid' : 'outline'} color={C.accent} onPress={() => choose(id)} />
                </View>} />
              {canTell ? <View style={{ gap: 8 }}>
                <Text style={styles.body}>Your clue</Text>
                <TextInput value={clue} onChangeText={setClue} editable={!busy} maxLength={DIXIT_CLUE_MAX_LENGTH}
                  accessibilityLabel="Your story clue" placeholder="A word or a short phrase…" placeholderTextColor={C.muted}
                  selectionColor={C.accent} style={styles.input} />
                {clueHasControls ? <Text accessibilityRole="alert" style={styles.muted}>Use one line without tabs or control characters.</Text> : null}
              </View> : <Text style={styles.muted}>{chosen.length}/{mine.submissionCount} selected. Your choice stays secret until everyone votes.</Text>}
            </View> : null}

            {game.result ? <View style={{ gap: 12 }}>
              <Text accessibilityRole="header" style={styles.heading}>This round’s points</Text>
              <Text style={styles.body}>{game.result.outcome === 'all' ? 'Every vote found the storyteller. Other players earn 4.' : game.result.outcome === 'none' ? 'No vote found the storyteller. Other players earn 2.' : 'Some votes found the storyteller. Each correct vote earns 3.'}</Text>
              {game.result.scores.map(score => <View key={score.playerId} style={styles.scoreRow}>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text style={styles.body}>{name(score.playerId)}</Text>
                  <Text style={styles.muted}>{score.cluePoints ? `Story: ${score.cluePoints} · ` : ''}Guess: {score.guessPoints} · Decoys: {score.decoyPoints}</Text>
                </View>
                <Text style={styles.score}>+{score.total}</Text>
              </View>)}
            </View> : null}
          </View>

          <View style={{ width: sideBySide ? 260 : '100%', gap: 12 }}>
            <Text accessibilityRole="header" style={styles.heading}>{isOver ? 'Final scores' : 'At the table'}</Text>
            {[...game.players].sort((a, b) => Number(a.forfeited) - Number(b.forfeited) || b.score - a.score).map(player => <View key={player.playerId} style={styles.scoreRow}>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={styles.body}>{player.displayName}{player.playerId === playerId ? ' (you)' : ''}</Text>
                <Text style={styles.muted}>{player.forfeited ? 'Forfeited' : game.winnerIds.includes(player.playerId) ? 'Winner' : player.playerId === game.storytellerId ? 'Storyteller' : game.phase === 'vote' ? player.voted ? 'Votes locked' : 'Choosing votes' : game.phase === 'reveal' ? player.ready ? 'Ready' : 'Reading the reveal' : player.submitted ? 'Image submitted' : `${player.handCount} cards`}</Text>
              </View>
              <Text style={styles.score}>{player.score}</Text>
            </View>)}
            {isOver ? <View style={{ gap: 12 }}>
              <Text style={styles.body}>{rematchAllowed ? isHost ? 'Start another game with these players.' : 'The host can start a rematch.' : 'A rematch needs at least three connected players. Wait for reconnecting seats or leave to create a new room.'}</Text>
              {isHost ? <NeonButton label="PLAY AGAIN" disabled={busy || !rematchAllowed} color={C.accent} onPress={() => actions.send('start')} /> : null}
              <NeonButton label="RETURN TO ARCADE" variant="outline" color={C.accent} disabled={leave.leaving} onPress={leave.requestLeave} />
            </View> : null}
          </View>
        </View>
      </View>
    </ScrollView>
    {(canTell || canSubmit || canVote || canReady) ? <View style={styles.actionBar}>
      {canTell ? <NeonButton label="SHARE CLUE AND IMAGE" disabled={busy || chosen.length !== 1 || !validClue} color={C.accent}
        onPress={() => { if (validClue) actions.send({ type: 'clue', cardId: chosen[0], clue: trimmedClue }); }} />
        : canSubmit ? <NeonButton label={`LOCK IN ${mine.submissionCount === 2 ? 'BOTH IMAGES' : 'IMAGE'}`} disabled={busy || chosen.length !== mine.submissionCount} color={C.accent}
          onPress={() => actions.send({ type: 'submit', cardIds: chosen })} />
          : canVote ? <NeonButton label="LOCK IN BOTH VOTES" disabled={busy || votes.some(vote => vote === null)} color={C.accent}
            onPress={() => { if (votes[0] !== null && votes[1] !== null) actions.send({ type: 'vote', slots: [votes[0], votes[1]] }); }} />
            : <NeonButton label="READY FOR THE NEXT STORY" disabled={busy} color={C.accent} onPress={() => actions.send({ type: 'ready' })} />}
    </View> : null}
    <DixitReferenceSheet visible={rules} onClose={() => setRules(false)} />
    <Modal visible={inspect !== null} transparent animationType="none" onRequestClose={() => setInspect(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#080611F5', padding: 16, alignItems: 'center' }}>
        <View nativeID="dixit-image-detail" accessibilityViewIsModal accessibilityLabel="Enlarged image" style={{ flex: 1, maxWidth: 680, width: '100%', gap: 12 }}>
          <NeonButton label="CLOSE IMAGE" color={C.accent} variant="outline" onPress={() => setInspect(null)} />
          <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 16 }}>
            {inspect ? <DreamCard key={inspect} cardId={inspect} width={Math.min(width - 32, 600, Math.max(180, (height - 140) / 1.5))} /> : null}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: C.surface },
  title: { fontFamily: 'Outfit_800ExtraBold', color: C.text, fontSize: 20 },
  heading: { fontFamily: 'Outfit_700Bold', color: C.accent, fontSize: 22 },
  body: { fontFamily: 'Outfit_400Regular', color: C.text, fontSize: 16, lineHeight: 24 },
  muted: { fontFamily: 'Outfit_400Regular', color: C.muted, fontSize: 14, lineHeight: 21 },
  clue: { fontFamily: 'Outfit_700Bold', color: C.secondary, fontSize: 24, lineHeight: 34 },
  iconButton: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  scroll: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  voteButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  input: { minHeight: 88, padding: 14, backgroundColor: C.panel, color: C.text, borderColor: C.border, borderWidth: 1, borderRadius: 12, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, textAlignVertical: 'top' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  score: { fontFamily: 'SpaceMono_700Bold', color: C.secondary, fontSize: 18 },
  actionBar: { padding: 12, backgroundColor: C.surface },
});
