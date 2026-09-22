import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, BackHandler, Modal, Platform, ScrollView, StyleSheet, Text, View, findNodeHandle, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LIBERTALIA_CREW } from '@zuychin-arcade/types';
import { useGameStore } from '../../store/useGameStore';
import { getSocket } from '../../hooks/useSocket';
import { useNativeLeaveGuard } from '../../hooks/useNativeLeaveGuard';
import { useWebBackGuard } from '../../hooks/useWebBackGuard';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { CardGrid } from '../../components/ui/CardGrid';
import { NeonButton } from '../../components/ui/NeonButton';
import { GameRecovery } from '../../components/ui/GameRecovery';
import { CrewCard } from '../../components/libertalia/CrewCard';
import { LibertaliaHand } from '../../components/libertalia/Hand';
import { LibertaliaLootCollection } from '../../components/libertalia/Loot';
import { LibertaliaLootArtwork, LibertaliaPhaseArtwork } from '../../components/libertalia/LibertaliaArtwork';
import { libertaliaLayout, libertaliaScrollOffset } from '../../components/libertalia/layout';
import { LibertaliaReferenceSheet } from '../../components/libertalia/ReferenceSheet';
import { useLibertaliaActions } from '../../components/libertalia/useLibertaliaActions';
import { useLibertaliaDecisionAttention } from '../../components/libertalia/useLibertaliaDecisionAttention';
import { isLibertaliaLeavePromptCurrent, libertaliaDecisionKey, libertaliaEmptySelection, libertaliaLeaveMessage, libertaliaOptionHelp, libertaliaOptionLabel, libertaliaRematchBlock, libertaliaRematchMessage, libertaliaResultPlayers } from '../../components/libertalia/decision';
import { LIBERTALIA as C } from '../../constants/theme';
import { leaveRoom } from '../../lib/api';
import { clearAuthIfMatches } from '../../lib/storage';
import { showDialog, useDialogStore, type DialogConfig } from '../../lib/dialog';

const phaseNames: Record<string, string> = { selection: 'SECRET CREW SELECTION', daytime: 'DAYTIME · LOW TO HIGH', dusk: 'DUSK · HIGH TO LOW', night: 'NIGHT WATCH', anchor: 'ANCHOR AND SCORING', effect_choice: 'RESOLVING ABILITIES', game_over: 'EXPEDITION COMPLETE' };
const body = { fontFamily: 'Outfit_400Regular', color: C.text, fontSize: 15, lineHeight: 22 } as const;
const secondary = { ...body, color: C.muted, fontSize: 14, lineHeight: 21 } as const;

function Section({ title, children, detail, id, nativeID, onLayout }: { title: string; children: ReactNode; detail?: string; id?: string; nativeID?: string; onLayout?: (y: number) => void }) {
  return <View nativeID={nativeID} onLayout={event => onLayout?.(event.nativeEvent.layout.y)} style={styles.section}>
    <Text nativeID={id} accessibilityRole="header" {...(id && Platform.OS === 'web' ? { tabIndex: -1 } : {})} style={{ fontFamily: 'Outfit_800ExtraBold', color: C.sky, fontSize: 16 }}>{title}</Text>
    {detail ? <Text style={secondary}>{detail}</Text> : null}{children}
  </View>;
}

export default function LibertaliaGame() {
  const { width = 375, fontScale = 1 } = useWindowDimensions();
  const [playWidth, setPlayWidth] = useState(Math.max(0, width - 28));
  const [resultWidth, setResultWidth] = useState(Math.max(0, width - 64));
  const [titleHeight, setTitleHeight] = useState(24);
  const [resultTextScale, setResultTextScale] = useState(1);
  const textScale = Math.max(1, fontScale, titleHeight / 24);
  const game = useGameStore(s => s.libertaliaPublic), mine = useGameStore(s => s.libertaliaPrivate);
  const room = useGameStore(s => s.room), token = useGameStore(s => s.token), playerId = useGameStore(s => s.playerId);
  const actions = useLibertaliaActions();
  const dialogOpen = useDialogStore(s => s.dialog !== null);
  const [rules, setRules] = useState(false), [rank, setRank] = useState<number | null>(null);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [outlook, setOutlook] = useState(false), [graveyard, setGraveyard] = useState(false);
  const [leaving, setLeaving] = useState(false), [cleanupPending, setCleanupPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true), leavingRef = useRef(false), notified = useRef(false), promptOpen = useRef(false);
  const prompt = useRef<DialogConfig | null>(null), epoch = useRef(0), identity = useRef(token);
  const nativeBack = useRef<(() => void) | null>(null);
  const scroll = useRef<ScrollView>(null), heading = useRef<Text>(null), decisionY = useRef(0);
  const lootY = useRef(0);
  const anchors = useRef({ play: 0, primary: 0, public: 0, decision: 0, loot: 0 });
  const updateOffsets = useCallback(() => {
    const current = anchors.current;
    decisionY.current = libertaliaScrollOffset(current.play, current.primary, current.decision);
    lootY.current = libertaliaScrollOffset(current.play, current.public, current.loot);
  }, []);
  const approveNavigation = useNativeLeaveGuard(token, () => { if (useGameStore.getState().token === token) nativeBack.current?.(); });
  const gameOver = game?.status === 'game_over';
  const dismissPrompt = useCallback(() => {
    if (prompt.current && useDialogStore.getState().dialog === prompt.current) useDialogStore.getState().hide();
    prompt.current = null; promptOpen.current = false;
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; dismissPrompt(); }; }, [dismissPrompt]);
  useEffect(() => { epoch.current += 1; dismissPrompt(); }, [game?.status, room?.roomCode, token, dismissPrompt]);
  useLayoutEffect(() => {
    const old = identity.current; identity.current = token;
    if (token === null || token === old) return;
    leavingRef.current = false; notified.current = false;
    setLeaving(false); setCleanupPending(false); setError(null); setRules(false); setRank(null); setOptionIds([]);
  }, [token]);
  useEffect(() => { setRank(null); setOptionIds([]); }, [game?.voyage, game?.day, mine?.pendingChoice?.id, mine?.canSelect]);
  useEffect(() => {
    if (rank === null || Platform.OS !== 'web') return;
    const frame = requestAnimationFrame(() => {
      if (!mounted.current || useGameStore.getState().token !== token) return;
      const button = document.querySelector<HTMLElement>(`[aria-label^="CONFIRM #${rank} "]`);
      button?.scrollIntoView({ block: 'center' }); button?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [rank, token]);
  const cancelSelection = useCallback(() => {
    const selected = rank;
    const captured = useGameStore.getState().libertaliaPublic;
    setRank(null);
    if (selected === null || Platform.OS !== 'web') return;
    requestAnimationFrame(() => {
      const current = useGameStore.getState();
      if (!mounted.current || current.token !== token || current.libertaliaPublic?.voyage !== captured?.voyage
        || current.libertaliaPublic?.day !== captured?.day || !current.libertaliaPrivate?.canSelect) return;
      const button = Array.from(document.querySelectorAll<HTMLElement>('[role="button"][aria-label]'))
        .find(node => node.getAttribute('aria-label')?.startsWith(`Choose ${LIBERTALIA_CREW[selected - 1]?.name}, rank ${selected}.`));
      button?.scrollIntoView({ block: 'center' }); button?.focus({ preventScroll: true });
    });
  }, [rank, token]);
  useEffect(() => { if (gameOver) { setRules(false); setRank(null); setOptionIds([]); } }, [gameOver]);
  const sessionCleared = useCallback(() => {
    if (!mounted.current || useGameStore.getState().token !== null) return;
    leavingRef.current = true;
    approveNavigation(() => router.replace('/'), () => mounted.current && useGameStore.getState().token === null, null);
  }, [approveNavigation]);
  useEffect(() => { if (token === null && !leavingRef.current && useGameStore.getState().token === null) sessionCleared(); }, [token, sessionCleared]);
  const leave = useCallback(async (destination: '/' | '/libertalia' = '/') => {
    const owns = () => mounted.current && useGameStore.getState().token === token && useGameStore.getState().room?.roomCode === room?.roomCode;
    if (leavingRef.current || !owns()) return;
    leavingRef.current = true; setLeaving(true); setError(null);
    if (!notified.current && room && token) {
      try { await leaveRoom(room.roomCode, token); notified.current = true; }
      catch (caught) { if (owns()) { leavingRef.current = false; setLeaving(false); setError(`Could not leave the table. Try again. ${caught instanceof Error ? caught.message : ''}`); } return; }
    }
    if (!owns()) return;
    getSocket()?.disconnect();
    try { if (token) await clearAuthIfMatches(token); }
    catch (caught) { if (owns()) { leavingRef.current = false; setLeaving(false); setCleanupPending(true); setError(`Your saved seat could not be cleared. Retry leaving. ${caught instanceof Error ? caught.message : ''}`); } return; }
    if (!owns()) return;
    useGameStore.getState().clearAll();
    approveNavigation(() => router.replace(destination), () => mounted.current && useGameStore.getState().token === null, null);
  }, [approveNavigation, room, token]);
  const requestLeave = useCallback(() => {
    const owns = () => mounted.current && useGameStore.getState().token === token && useGameStore.getState().room?.roomCode === room?.roomCode;
    if (!owns() || leavingRef.current || promptOpen.current) return;
    if (cleanupPending) { void leave(); return; }
    const captured = useGameStore.getState().libertaliaPublic;
    if (!captured) return;
    const currentEpoch = epoch.current; promptOpen.current = true;
    let capturedPrompt: DialogConfig | null = null;
    showDialog(captured.status === 'playing' ? 'Forfeit this expedition?' : 'Return to the arcade?', captured.status === 'playing' ? libertaliaLeaveMessage() : 'Your completed result is preserved. Close this seat and return to the arcade?', [
      { text: 'STAY', style: 'cancel', onPress: () => { if (owns() && epoch.current === currentEpoch && prompt.current === capturedPrompt) promptOpen.current = false; } },
      { text: 'LEAVE', style: 'destructive', onPress: () => {
        if (!owns() || !promptOpen.current || prompt.current !== capturedPrompt || !isLibertaliaLeavePromptCurrent(captured, useGameStore.getState().libertaliaPublic, currentEpoch, epoch.current)) return;
        promptOpen.current = false; void leave();
      } },
    ]);
    capturedPrompt = useDialogStore.getState().dialog;
    prompt.current = capturedPrompt;
  }, [cleanupPending, leave, room?.roomCode, token]);
  const startNewRoom = useCallback(() => {
    if (game?.status !== 'game_over' || !isLibertaliaLeavePromptCurrent(game, useGameStore.getState().libertaliaPublic, 0, 0)) return;
    void leave('/libertalia');
  }, [game, leave]);
  const handleBack = useCallback(() => {
    if (!mounted.current || useGameStore.getState().token !== token) return;
    if (rules) { setRules(false); return; }
    if (rank !== null) { cancelSelection(); return; }
    requestLeave();
  }, [cancelSelection, rank, requestLeave, rules, token]);
  useLayoutEffect(() => { nativeBack.current = handleBack; }, [handleBack]);
  useWebBackGuard('/libertalia/game', handleBack, token !== null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { handleBack(); return true; });
    return () => listener.remove();
  }, [handleBack]);
  useWebModalFocus(Boolean(gameOver && !rules && !dialogOpen), 'libertalia-results', requestLeave);
  const focusDecision = useCallback(() => {
    if (!heading.current) return false;
    if (Platform.OS === 'web') {
      const node = document.getElementById('libertalia-decision');
      if (!node) return false;
      node.scrollIntoView({ block: 'start', inline: 'nearest' }); node.focus({ preventScroll: true });
    } else {
      scroll.current?.scrollTo({ y: decisionY.current, animated: false });
      const node = findNodeHandle(heading.current); if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }
    return true;
  }, []);
  useLibertaliaDecisionAttention(libertaliaDecisionKey(game, mine), actions.busy || rules || dialogOpen || leaving, focusDecision);
  if (!game || !mine) return <GameRecovery onSessionCleared={sessionCleared} message="Restoring your private crew and voyage…" background={C.bg} surface={C.surface} border={C.border} accent={C.sky} muted={C.muted} icon="ship-wheel" />;
  const self = game.players.find(p => p.playerId === playerId);
  const locked = actions.busy || leaving || cleanupPending || dialogOpen || self?.forfeited === true;
  const pending = mine.pendingChoice;
  const choiceLoot = pending?.kind === 'loot_current' ? game.currentLoot : pending?.kind === 'loot_ship' ? game.players.flatMap(player => player.loot) : [];
  const { besideTable } = libertaliaLayout(playWidth, textScale);
  const { besideResults } = libertaliaLayout(resultWidth, Math.max(fontScale, resultTextScale));
  const winnerNames = game.players.filter(p => game.winnerPlayerIds.includes(p.playerId)).map(p => p.displayName).join(', ');
  const waitingName = game.players.find(p => p.playerId === game.pendingPlayerId)?.displayName;
  const emptySelection = libertaliaEmptySelection(game, self);
  const crewReady = game.phase === 'selection' && mine.selectedRank !== null;
  const title = self?.forfeited ? 'YOU HAVE FORFEITED' : pending ? 'YOUR DECISION' : emptySelection ? 'NO CREW LEFT IN HAND' : mine.canSelect ? 'CHOOSE YOUR CREW' : crewReady ? 'YOUR CREW IS READY' : 'WATCH THE VOYAGE';
  const instruction = self?.forfeited
    ? game.turnOrder.includes(self.playerId) ? 'You cannot win. Automatic choices finish this committed day, then your seat is removed.' : 'Your seat has left active play. Your earlier voyage history remains visible.'
    : pending?.prompt ?? (emptySelection ? 'You sit out island selection; your ship still resolves tonight. You remain in the expedition.' : mine.canSelect ? crewReady ? `Your secret choice is #${mine.selectedRank} ${LIBERTALIA_CREW[mine.selectedRank! - 1]?.name}. You may change it until all admirals are ready.` : 'Select one crew member, then confirm your secret choice. Crews reveal together when all admirals are ready.' : crewReady ? `You chose #${mine.selectedRank} ${LIBERTALIA_CREW[mine.selectedRank! - 1]?.name}. Waiting for the other admirals.` : waitingName ? `${waitingName} is resolving a choice.` : 'The table is resolving the day. Your next decision will appear here.');
  const rematchSeats = room?.players ?? [];
  const isHost = room?.players.some(p => p.playerId === playerId && p.isHost);
  const canRematch = Boolean(isHost && libertaliaRematchBlock(rematchSeats) === null);
  const feedback = error ?? actions.message;
  const forfeitLabel = (id: string) => game.status === 'game_over' ? 'FORFEITED · INELIGIBLE' : game.turnOrder.includes(id) ? 'FORFEITED · FINISHING TODAY' : 'FORFEITED · REMOVED FROM PLAY';
  const submitChoice = (ids: string[]) => { if (pending && !locked) actions.send('choice', { choiceId: pending.id, optionIds: ids }, 'Choice', game.revision); };
  const renderFeedback = () => <>
    {feedback ? <Text accessibilityRole={error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={{ ...body, color: error ? C.coral : C.sky }}>{feedback}</Text> : null}
    {!actions.connected || !actions.synced ? <><Text style={secondary}>Reconnecting and restoring your private crew. Actions wait for the latest table.</Text><NeonButton label="RETRY CONNECTION" color={C.sky} variant="outline" disabled={leaving} onPress={actions.refresh} /></> : null}
    {cleanupPending ? <NeonButton label="RETRY LEAVING" color={C.coral} disabled={leaving} onPress={() => void leave()} /> : null}
  </>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
    <View nativeID="libertalia-toolbar" style={styles.toolbar}>
      <ScalePressable accessibilityLabel="Back to arcade" disabled={leaving} onPress={handleBack} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="arrow-left" size={24} color={C.sky} /></ScalePressable>
      <View style={{ flex: 1, minWidth: 0 }}><Text onLayout={event => setTitleHeight(event.nativeEvent.layout.height)} style={{ fontFamily: 'Outfit_800ExtraBold', color: C.sky, fontSize: 17, lineHeight: 24 }}>VOYAGE {game.voyage} OF 3</Text><Text style={secondary}>Day {game.day} of {game.daysInVoyage}</Text></View>
      <ScalePressable accessibilityLabel="Open rulebook" onPress={() => setRules(true)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="book-open-variant" size={24} color={C.gold} /></ScalePressable>
    </View>
    <ScrollView ref={scroll} contentContainerStyle={styles.page}>
      <View nativeID="libertalia-play-area" onLayout={event => { anchors.current.play = event.nativeEvent.layout.y; setPlayWidth(event.nativeEvent.layout.width); updateOffsets(); }} style={[styles.playArea, { flexDirection: besideTable ? 'row' : 'column' }]}>
      <View onLayout={event => { anchors.current.primary = event.nativeEvent.layout.y; updateOffsets(); }} style={[styles.column, besideTable ? { flexBasis: 640, flexGrow: 1.7 } : { width: '100%' }]}>
      <View nativeID="libertalia-decision-area" onLayout={event => { anchors.current.decision = event.nativeEvent.layout.y; updateOffsets(); }} style={[styles.decision, { borderColor: pending || mine.canSelect ? C.sky : C.border }]}>
        <Text ref={heading} nativeID="libertalia-decision" accessibilityRole="header" {...(Platform.OS === 'web' ? { tabIndex: -1 } : {})} style={{ fontFamily: 'Outfit_800ExtraBold', color: C.text, fontSize: 21 }}>{title}</Text>
        <Text accessibilityLiveRegion="polite" style={body}>{instruction}</Text><Text style={secondary}>{phaseNames[game.phase]}</Text>{renderFeedback()}
        <Text style={{ ...body, color: C.gold }}>Today’s loot: {game.currentLoot.map(loot => loot.kind).join(' · ') || 'row cleared'}</Text>
        <NeonButton label="INSPECT VOYAGE LOOT" color={C.gold} variant="outline" onPress={() => {
          setOutlook(true);
          requestAnimationFrame(() => {
            if (!mounted.current || useGameStore.getState().token !== token) return;
            if (Platform.OS === 'web') { const node = document.getElementById('libertalia-loot'); node?.scrollIntoView({ block: 'start' }); node?.focus({ preventScroll: true }); }
            else scroll.current?.scrollTo({ y: lootY.current, animated: false });
          });
        }} />
        {pending ? <View style={{ gap: 9 }}>{pending.options.map(option => {
          const loot = choiceLoot.find(token => token.id === option.lootId);
          const crew = option.rank ? LIBERTALIA_CREW[option.rank - 1] : undefined;
          return <ScalePressable key={option.id} testID={`libertalia-choice-${pending.id}-${encodeURIComponent(option.id)}`} accessibilityLabel={libertaliaOptionLabel(option, game, playerId, pending.kind)} accessibilityState={{ selected: optionIds.includes(option.id), disabled: locked }} disabled={locked}
          onPress={() => pending.max <= 1 ? submitChoice([option.id]) : setOptionIds(ids => ids.includes(option.id) ? ids.filter(id => id !== option.id) : ids.length < pending.max ? [...ids, option.id] : ids)}
          style={{ minHeight: 52, borderRadius: 12, borderWidth: optionIds.includes(option.id) ? 2 : 1, borderColor: C.sky, padding: 12, backgroundColor: C.surface }}>
          {loot ? <View style={styles.optionArtwork}><LibertaliaLootArtwork kind={loot.kind} size={64} /></View> : crew ? <View style={styles.optionArtwork}><LibertaliaPhaseArtwork phase={crew.phases[0]} /></View> : null}
          <Text style={{ ...body, fontFamily: 'Outfit_700Bold' }}>{option.label}</Text>
          {option.playerId ? <Text style={{ ...secondary, color: C.gold }}>{option.playerId === playerId ? 'You' : game.players.find(p => p.playerId === option.playerId)?.displayName}</Text> : null}
          {option.rank && LIBERTALIA_CREW[option.rank - 1] ? <><Text style={secondary}>Timing: {LIBERTALIA_CREW[option.rank - 1].phases.join(', ')}</Text><Text style={body}>{LIBERTALIA_CREW[option.rank - 1].summary}</Text></> : null}
          {option.detail ? <Text style={secondary}>{option.detail}</Text> : null}
          {libertaliaOptionHelp(pending.kind, option, game) ? <Text style={body}>{libertaliaOptionHelp(pending.kind, option, game)}</Text> : null}
        </ScalePressable>; })}{pending.max > 1 ? <NeonButton label={`CONFIRM ${optionIds.length} CHOICES`} color={C.gold} disabled={locked || optionIds.length < pending.min || optionIds.length > pending.max} onPress={() => submitChoice(optionIds)} /> : null}
          {pending.optional ? <NeonButton label="PASS THIS ABILITY" color={C.muted} variant="outline" disabled={locked} onPress={() => submitChoice([])} /> : null}
        </View> : null}
      </View>
      {!gameOver ? <Section nativeID="libertalia-hand" title="YOUR PRIVATE CREW" detail={`${mine.hand.length} ${mine.hand.length === 1 ? 'card' : 'cards'} in hand. Crew descriptions remain available while you wait.`}>
        {rank !== null && rank !== mine.selectedRank && mine.canSelect ? <View style={{ gap: 8 }}><NeonButton label={`CONFIRM #${rank} ${LIBERTALIA_CREW[rank - 1]?.name.toUpperCase()}`} color={C.gold} disabled={locked || !mine.hand.includes(rank)} onPress={() => actions.send('select', { rank }, 'Crew selection', game.revision)} /><NeonButton label="CANCEL SELECTION" color={C.sky} variant="outline" onPress={cancelSelection} /></View> : null}
        <LibertaliaHand ranks={mine.hand} textScale={textScale} renderCard={(card, onFocus, fluid) => <CrewCard key={card} nativeID={`libertalia-hand-card-${card}`} rank={card} selection={mine.selectedRank === card ? 'submitted' : rank === card ? 'candidate' : undefined} disabled={!mine.canSelect || locked} onFocus={onFocus} fluid={fluid} onPress={() => setRank(card)} />} />
      </Section> : null}
      </View>
      <View nativeID="libertalia-public-table" onLayout={event => { anchors.current.public = event.nativeEvent.layout.y; updateOffsets(); }} style={[styles.column, besideTable ? { flexBasis: 340, flexGrow: 1 } : { width: '100%' }]}>
      <Section id="libertalia-loot" nativeID="libertalia-loot-area" onLayout={y => { anchors.current.loot = y; updateOffsets(); }} title="TODAY’S LOOT" detail="Calm-side effects. Loot is claimed right to left at dusk."><LibertaliaLootCollection tokens={game.currentLoot} textScale={textScale} testID="libertalia-current-loot-grid" />
        {!game.currentLoot.length ? <Text style={secondary}>No loot remains on today’s row.</Text> : null}
        <NeonButton label={outlook ? 'HIDE VOYAGE LOOT' : 'VIEW ALL VOYAGE LOOT'} color={C.gold} variant="outline" onPress={() => setOutlook(!outlook)} />
        {outlook ? game.lootDays.map((lootDay, index) => <View key={index} style={{ gap: 8 }}><Text accessibilityRole="header" style={{ ...body, fontFamily: 'Outfit_700Bold', color: index + 1 === game.day ? C.gold : C.text }}>Day {index + 1}{index + 1 === game.day ? ' · TODAY' : index + 1 < game.day ? ' · PAST' : ''}</Text><LibertaliaLootCollection tokens={lootDay} compact textScale={textScale} testID={`libertalia-voyage-loot-grid-${index + 1}`} />{!lootDay.length ? <Text style={secondary}>Row cleared</Text> : null}</View>) : null}
      </Section>
      <Section nativeID="libertalia-island" title="ISLAND LINE" detail="Daytime resolves low to high. Dusk claims loot high to low; reputation breaks equal ranks.">
        {game.island.length ? <View style={styles.pieces}>{game.island.map((card, index) => <View key={card.id} nativeID={`libertalia-island-${card.id}`} style={styles.islandSlot}>
          <View style={styles.stationHeading}><Text style={styles.position}>{index + 1}</Text>{!card.neutral && LIBERTALIA_CREW[card.rank - 1] ? <View style={styles.optionArtwork}><LibertaliaPhaseArtwork phase={LIBERTALIA_CREW[card.rank - 1].phases[0]} /></View> : <MaterialCommunityIcons accessible={false} name="ship-wheel" size={36} color={C.muted} />}</View>
          <Text style={{ ...body, fontFamily: 'Outfit_700Bold', color: C.gold }}>#{card.rank} · {card.name}</Text><Text style={secondary}>{card.neutral ? 'Neutral Midshipman' : game.players.find(p => p.playerId === card.playerId)?.displayName}</Text>{!card.neutral ? <><Text style={{ ...secondary, color: C.violet }}>{LIBERTALIA_CREW[card.rank - 1]?.phases.join(' · ').toUpperCase()}</Text><Text style={body}>{LIBERTALIA_CREW[card.rank - 1]?.summary}</Text></> : null}</View>)}</View> : <Text style={secondary}>{game.phase === 'selection' ? 'Crew selections remain hidden until everyone is ready.' : 'No crew remain on the island.'}</Text>}
      </Section>
      <Section nativeID="libertalia-reputation" title="REPUTATION TRACK" detail="Left to right. Inactive tokens still occupy spaces; the displayed amount is the voyage’s starting doubloons."><View style={styles.pieces}>{game.reputationTrack.map(t => <View key={t.tokenId} nativeID={`libertalia-reputation-${t.tokenId}`} accessible accessibilityLabel={`Position ${t.position + 1}, ${t.displayName}, ${t.value} starting doubloons${t.active ? '' : ', inactive token'}`} style={[styles.reputationSlot, { borderColor: t.playerId === playerId ? C.gold : C.border }]}><Text style={styles.position}>{t.position + 1}</Text><Text style={{ ...body, fontFamily: 'Outfit_700Bold' }}>{t.displayName}</Text><Text style={{ ...secondary, color: C.gold }}>{t.value} starting doubloons</Text>{!t.active ? <Text style={secondary}>Inactive token</Text> : null}</View>)}</View></Section>
      </View>
      </View>
      <Section nativeID="libertalia-fleet" title="THE FLEET" detail={`${game.turnOrder.length} current-day seats · ${game.players.length} seats in expedition history`}>
        <View style={styles.fleet}>{game.players.map(p => <View key={p.playerId} nativeID={`libertalia-seat-${p.playerId}`} style={[styles.fleetStation, { borderColor: p.forfeited ? C.coral : p.playerId === playerId ? C.sky : C.border }]}>
          <Text style={{ ...body, fontFamily: 'Outfit_800ExtraBold' }}>{p.displayName}{p.playerId === playerId ? ' · YOU' : ''}</Text><Text style={{ ...body, color: C.gold }}>{p.doubloons} doubloons · {p.score} protected points</Text>
          <Text style={{ ...secondary, color: p.forfeited ? C.coral : C.sky }}>{p.forfeited ? forfeitLabel(p.playerId) : room?.players.find(seat => seat.playerId === p.playerId)?.hasLeft ? 'LEFT AFTER THE RESULT' : room?.players.find(seat => seat.playerId === p.playerId)?.isConnected === false ? 'RECONNECTING' : libertaliaEmptySelection(game, p) ? 'SITTING OUT SELECTION' : game.phase === 'selection' && p.ready ? 'CREW READY' : `${p.handCount} in hand · ${p.graveyardCount} buried`}</Text>
          {game.phase === 'selection' && p.ready && !p.forfeited ? <View testID={`libertalia-ready-${p.playerId}`} accessible accessibilityLabel="Secret selection submitted" style={styles.ready}><MaterialCommunityIcons accessible={false} name="cards-outline" size={22} color={C.sky} /><Text style={{ ...secondary, color: C.sky }}>CREW READY</Text></View> : null}
          <View nativeID={`libertalia-ship-${p.playerId}`} style={{ minWidth: 0 }}>{p.ship.length ? <CardGrid items={p.ship} keyExtractor={String} minCardWidth={250} maxCardWidth={320} textScale={textScale} renderItem={card => <CrewCard rank={card} fluid />} /> : <Text style={secondary}>Ship: empty</Text>}</View>
          {p.loot.length ? <LibertaliaLootCollection tokens={p.loot} compact textScale={textScale} testID={`libertalia-collected-loot-grid-${p.playerId}`} /> : <Text style={secondary}>No collected loot</Text>}
        </View>)}</View>
      </Section>
      <Section nativeID="libertalia-graveyard" title="YOUR PRIVATE GRAVEYARD"><NeonButton label={graveyard ? 'HIDE GRAVEYARD' : `VIEW ${mine.graveyard.length} BURIED CREW`} color={C.violet} variant="outline" onPress={() => setGraveyard(!graveyard)} />{graveyard ? <View style={{ minWidth: 0 }}><CardGrid items={mine.graveyard} keyExtractor={String} minCardWidth={250} maxCardWidth={320} textScale={textScale} renderItem={card => <CrewCard rank={card} fluid />} />{!mine.graveyard.length ? <Text style={secondary}>No buried crew yet.</Text> : null}</View> : null}</Section>
      <Section title="VOYAGE LOG">{game.log.slice(-12).reverse().map(entry => <Text key={entry.id} style={secondary}>{entry.text}</Text>)}</Section>
    </ScrollView>
    <Modal visible={Boolean(gameOver)} transparent animationType="none" onRequestClose={handleBack}><View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', padding: 16, alignItems: 'center', justifyContent: 'center' }}>
      <View nativeID="libertalia-results" role="dialog" aria-modal accessibilityViewIsModal accessibilityLabel="Libertalia results" onLayout={event => setResultWidth(event.nativeEvent.layout.width - 32)} style={styles.results}><ScrollView contentContainerStyle={{ gap: 20, flexDirection: besideResults ? 'row' : 'column', alignItems: 'flex-start' }}>
        <View nativeID="libertalia-result-summary" style={[styles.column, besideResults ? { flexBasis: 320, flexGrow: 1 } : { width: '100%' }]}>
        <MaterialCommunityIcons accessible={false} name="ship-wheel" size={40} color={C.gold} />
        <Text nativeID="libertalia-result-title" onLayout={() => {
          if (Platform.OS !== 'web') return;
          const node = document.getElementById('libertalia-result-title');
          if (node) setResultTextScale(Math.max(1, Number.parseFloat(window.getComputedStyle(node).fontSize) / 25 || 1));
        }} accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 25, lineHeight: 32, color: C.gold }}>{winnerNames ? `${winnerNames} wins` : 'NO WINNER'}</Text>
        <Text style={body}>{game.endReason === 'forfeit' ? winnerNames ? 'Only one eligible admiral remains. This expedition ended by forfeit, not three-voyage scoring.' : 'No eligible admirals remain. The expedition ended without a winner.' : 'Three voyages complete. Highest protected score wins; reputation breaks a score tie.'}</Text>
        {renderFeedback()}{isHost && canRematch ? <NeonButton label="PLAY AGAIN" color={C.sky} disabled={actions.busy || leaving || cleanupPending || dialogOpen} onPress={() => actions.send('start', {}, 'New expedition', game.revision)} /> : <Text style={secondary}>{libertaliaRematchMessage(rematchSeats, Boolean(isHost))}</Text>}
        {!canRematch && isHost ? <NeonButton label="START A NEW ROOM" color={C.sky} variant="outline" disabled={leaving} onPress={startNewRoom} /> : null}
        <NeonButton label="BACK TO ARCADE" color={C.gold} disabled={leaving} onPress={requestLeave} />
        </View>
        <View nativeID="libertalia-result-roster" style={[styles.column, besideResults ? { flexBasis: 440, flexGrow: 1.3 } : { width: '100%' }]}>
        {libertaliaResultPlayers(game).map(p => <View key={p.playerId} nativeID={`libertalia-result-row-${p.playerId}`} style={[styles.resultRow, { borderColor: p.forfeited ? C.coral : C.border }]}><Text style={{ ...body, fontFamily: 'Outfit_800ExtraBold' }}>{p.displayName}</Text><Text style={{ ...body, color: p.forfeited ? C.coral : C.gold }}>{p.forfeited ? 'FORFEITED · INELIGIBLE' : game.winnerPlayerIds.includes(p.playerId) ? 'WINNER' : 'COMPLETED'}</Text><Text style={secondary}>{game.endReason === 'score' ? `${p.score} points · reputation position ${p.reputation + 1}` : `${p.score} earlier protected points, not a final score`}</Text></View>)}
        </View>
      </ScrollView></View>
    </View></Modal>
    <LibertaliaReferenceSheet visible={rules} onClose={() => setRules(false)} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  toolbar: { minHeight: 60, flexShrink: 0, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, gap: 8 },
  page: { width: '100%', maxWidth: 1440, alignSelf: 'center', padding: 14, gap: 20, paddingBottom: 40 },
  playArea: { minWidth: 0, gap: 20, alignItems: 'flex-start' },
  column: { minWidth: 0, gap: 14, flexShrink: 1 },
  section: { minWidth: 0, borderRadius: 15, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, padding: 13, gap: 10 },
  decision: { minWidth: 0, backgroundColor: C.panel, borderRadius: 15, borderWidth: 1, padding: 14, gap: 9 },
  pieces: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionArtwork: { width: 64, height: 64, flexShrink: 0, marginBottom: 8 },
  stationHeading: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  position: { fontFamily: 'SpaceMono_700Bold', fontSize: 20, lineHeight: 28, color: C.gold },
  islandSlot: { flexBasis: 220, flexGrow: 1, minWidth: 0, padding: 12, gap: 6, borderRadius: 12, borderWidth: 1, borderBottomWidth: 4, borderColor: C.border, backgroundColor: C.panel },
  reputationSlot: { flexBasis: 140, flexGrow: 1, minWidth: 0, padding: 12, gap: 4, borderRadius: 12, backgroundColor: C.panel, borderWidth: 1, borderBottomWidth: 4 },
  fleet: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  fleetStation: { flexBasis: 440, flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: '100%', borderRadius: 12, backgroundColor: C.panel, borderWidth: 1, borderBottomWidth: 4, padding: 12, gap: 8 },
  ready: { alignSelf: 'flex-start', minWidth: 0, maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  results: { width: '100%', maxWidth: 1120, maxHeight: '94%', backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.gold, padding: 16 },
  resultRow: { minWidth: 0, padding: 12, gap: 6, borderRadius: 12, backgroundColor: C.panel, borderWidth: 1, borderBottomWidth: 4 },
});
