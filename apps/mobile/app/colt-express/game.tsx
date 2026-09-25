import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, BackHandler, Modal, Platform, ScrollView, Text, View, findNodeHandle, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLT_CHARACTERS, type ColtPublicState } from '@zuychin-arcade/types';
import { useGameStore } from '../../store/useGameStore';
import { getSocket } from '../../hooks/useSocket';
import { useNativeLeaveGuard } from '../../hooks/useNativeLeaveGuard';
import { useWebBackGuard } from '../../hooks/useWebBackGuard';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { NeonButton } from '../../components/ui/NeonButton';
import { GameRecovery } from '../../components/ui/GameRecovery';
import { ActionCard } from '../../components/colt/ActionCard';
import { ActionArtwork } from '../../components/colt/ActionArtwork';
import { CardSurface } from '../../components/ui/CardSurface';
import { CardGrid } from '../../components/ui/CardGrid';
import { useIntrinsicCardHeight } from '../../hooks/useIntrinsicCardHeight';
import { CharacterChoice, TeamChoice } from '../../components/colt/CharacterChoice';
import { TrainBoard } from '../../components/colt/TrainBoard';
import { ColtReferenceSheet } from '../../components/colt/ReferenceSheet';
import { useColtActions } from '../../components/colt/useColtActions';
import { useColtDecisionAttention } from '../../components/colt/useColtDecisionAttention';
import { COLT_ACTION_HELP, COLT_TURN_HELP, COLT_EVENT_HELP, coltCarName, coltCharacterSetupMessage, coltProgramPayload, coltDecisionKey, coltLeaveMessage, coltRematchMessage, isColtLeavePromptCurrent } from '../../components/colt/decision';
import { COLT as C } from '../../constants/theme';
import { leaveRoom } from '../../lib/api';
import { clearAuthIfMatches } from '../../lib/storage';
import { showDialog, useDialogStore, type DialogConfig } from '../../lib/dialog';

const body = { fontFamily: 'Outfit_400Regular', color: C.text, fontSize: 15, lineHeight: 22 } as const;
const secondary = { ...body, color: C.muted, fontSize: 14, lineHeight: 21 } as const;
function Section({ title, children, detail, id, headingRef, flat = false }: { title: string; children: ReactNode; detail?: string; id?: string; headingRef?: React.RefObject<Text | null>; flat?: boolean }) {
  return <View style={{ minWidth: 0, gap: 10, ...(flat ? {} : { borderRadius: 15, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, padding: 13 }) }}>
    <Text ref={headingRef} nativeID={id} accessibilityRole="header" {...(id && Platform.OS === 'web' ? { tabIndex: -1 } : {})} style={{ fontFamily: 'Outfit_800ExtraBold', color: C.gold, fontSize: 17 }}>{title}</Text>
    {detail ? <Text style={secondary}>{detail}</Text> : null}{children}
  </View>;
}

function ProgramCards({ game, headingRef }: { game: ColtPublicState; headingRef?: React.RefObject<Text | null> }) {
  const { fontScale = 1 } = useWindowDimensions();
  const [columnWidth, setColumnWidth] = useState(0);
  const ids = game.program.map((_, index) => String(index));
  const layoutKey = `${columnWidth}:${fontScale}`;
  const faces = useIntrinsicCardHeight(ids, layoutKey);
  const statuses = useIntrinsicCardHeight(ids, layoutKey);
  return <Section title="SHARED PROGRAM" id="colt-program" headingRef={headingRef} detail="Actions execute in this order. Face-down cards remain hidden until revealed." flat>
    {!game.program.length ? <Text style={secondary}>No actions programmed yet.</Text> : null}
    <CardGrid items={game.program} keyExtractor={(_, index) => String(index)} minCardWidth={240} maxCardWidth={320} gap={12} textScale={fontScale} renderItem={(card, _width, index) => {
      const revealed = card.faceUp && card.action !== null;
      const player = game.players.find(p => p.playerId === card.playerId);
      const characterId = revealed && card.ownerBandit !== null ? player?.characters[card.ownerBandit] : undefined;
      const character = characterId ? COLT_CHARACTERS[characterId] : undefined;
      const active = index === game.executionIndex && game.phase !== 'programming' && game.status !== 'game_over';
      const face = faces.forCard(String(index)), status = statuses.forCard(String(index));
      return <View nativeID={'colt-program-card-' + index} onLayout={event => { if (index === 0) setColumnWidth(event.nativeEvent.layout.width); }} style={{ width: '100%', minWidth: 0, paddingBottom: 4, gap: 6 }}>
        <View style={{ minHeight: status.minimumHeight }}><Text key={status.measurementKey} onLayout={event => status.onMeasure(event.nativeEvent.layout.height)} style={{ ...body, fontFamily: 'Outfit_700Bold', color: active ? C.ember : C.text }}>{index + 1}.{active ? ' RESOLVING NOW' : index < game.executionIndex ? ' RESOLVED' : ' QUEUED'}</Text></View>
        <View style={{ minHeight: face.minimumHeight }}><CardSurface fill radius={12} faceColor={C.panel} edgeColor="#10131B" highlightColor={active ? C.ember : C.border} depth={3} selected={active}>
          <View key={face.measurementKey} onLayout={event => face.onMeasure(event.nativeEvent.layout.height)} style={{ width: '100%' }}>
            {revealed && card.action ? <ActionArtwork action={card.action} /> : <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: '100%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="cards-outline" size={48} color={C.gold} /></View>}
            <View style={{ padding: 12, gap: 8 }}>
            <Text style={{ ...body, fontFamily: 'Outfit_700Bold', textAlign: 'center' }}>{revealed ? card.action!.toUpperCase() : 'FACE DOWN'}</Text>
            {character ? <Text style={{ ...secondary, textAlign: 'center' }}>{character.name}</Text> : null}
            </View>
          </View>
        </CardSurface></View>
        <Text style={secondary}>{player?.displayName}{card.cover ? ' · COVER' : ''}</Text>
      </View>;
    }} />
  </Section>;
}

type MessageScope = { token: string | null; roomCode: string | undefined; phase: string; revision: number };
function scopedActionMessage(message: string | null, sent: MessageScope | null, current: MessageScope) {
  if (!message?.endsWith('accepted.')) return message;
  return sent && sent.token === current.token && sent.roomCode === current.roomCode && sent.phase === current.phase
    && current.revision >= sent.revision && current.revision <= sent.revision + 1 ? message : null;
}

export default function ColtGame() {
  const game = useGameStore(s => s.coltPublic), mine = useGameStore(s => s.coltPrivate);
  const token = useGameStore(s => s.token), playerId = useGameStore(s => s.playerId), room = useGameStore(s => s.room);
  const actions = useColtActions(), dialogOpen = useDialogStore(s => s.dialog !== null);
  const { fontScale = 1 } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(0);
  const sideBySide = Boolean(mine?.hand.length) && contentWidth >= 940 * Math.max(1, fontScale);
  const [messageScope, setMessageScope] = useState<MessageScope | null>(null);
  const [rules, setRules] = useState(false), [coverShoot, setCoverShoot] = useState<string | null>(null), [faceDown, setFaceDown] = useState(false);
  const [leaving, setLeaving] = useState(false), [cleanupPending, setCleanupPending] = useState(false), [error, setError] = useState<string | null>(null);
  const mounted = useRef(true), leavingRef = useRef(false), notified = useRef(false), promptOpen = useRef(false);
  const prompt = useRef<DialogConfig | null>(null), epoch = useRef(0), identity = useRef(token);
  const nativeBack = useRef<(() => void) | null>(null);
  const scroll = useRef<ScrollView>(null), heading = useRef<Text>(null), decisionY = useRef(0), trainY = useRef(0);
  const reserveHeading = useRef<Text>(null), handHeading = useRef<Text>(null), programHeading = useRef<Text>(null);
  const reserveY = useRef(0), cardsY = useRef(0), handY = useRef(0), programY = useRef(0);
  const jumpToCards = useCallback((section: 'reserve' | 'hand' | 'program') => {
    if (!mounted.current || useGameStore.getState().token !== token) return;
    if (Platform.OS === 'web') {
      const node = document.getElementById('colt-' + section);
      node?.scrollIntoView({ block: 'start' }); node?.focus({ preventScroll: true });
    } else {
      const target = section === 'reserve' ? reserveHeading : section === 'hand' ? handHeading : programHeading;
      scroll.current?.scrollTo({ y: section === 'reserve' ? reserveY.current : cardsY.current + (section === 'hand' ? handY.current : programY.current), animated: false });
      const node = findNodeHandle(target.current); if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }
  }, [token]);
  const approveNavigation = useNativeLeaveGuard(token, () => { if (useGameStore.getState().token === token) nativeBack.current?.(); });
  const gameOver = game?.status === 'game_over';
  const decisionKey = coltDecisionKey(game, mine);
  useEffect(() => { setCoverShoot(null); setFaceDown(false); }, [decisionKey]);
  const cancelCover = useCallback(() => {
    const cardId = coverShoot, captured = useGameStore.getState();
    const capturedDecision = coltDecisionKey(captured.coltPublic, captured.coltPrivate);
    setCoverShoot(null);
    if (!cardId) return;
    requestAnimationFrame(() => {
      const current = useGameStore.getState();
      if (!mounted.current || current.token !== token || coltDecisionKey(current.coltPublic, current.coltPrivate) !== capturedDecision || !current.coltPrivate?.canProgram) return;
      if (Platform.OS !== 'web') { jumpToCards('hand'); return; }
      const control = document.getElementById('colt-hand-' + cardId)?.querySelector<HTMLElement>('[role="button"]');
      control?.scrollIntoView({ block: 'center' }); control?.focus({ preventScroll: true });
    });
  }, [coverShoot, jumpToCards, token]);
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
    setLeaving(false); setCleanupPending(false); setError(null); setRules(false); setCoverShoot(null); setFaceDown(false);
  }, [token]);
  useEffect(() => { if (gameOver) { setRules(false); setCoverShoot(null); setFaceDown(false); } }, [gameOver]);
  const sessionCleared = useCallback(() => {
    if (!mounted.current || useGameStore.getState().token !== null) return;
    leavingRef.current = true;
    approveNavigation(() => router.replace('/'), () => mounted.current && useGameStore.getState().token === null, null);
  }, [approveNavigation]);
  useEffect(() => { if (token === null && !leavingRef.current && useGameStore.getState().token === null) sessionCleared(); }, [token, sessionCleared]);
  const leave = useCallback(async (destination: '/' | '/colt-express' = '/') => {
    const owns = () => mounted.current && useGameStore.getState().token === token && useGameStore.getState().room?.roomCode === room?.roomCode;
    if (leavingRef.current || !owns()) return;
    leavingRef.current = true; setLeaving(true); setError(null);
    if (!notified.current && room && token) {
      try { await leaveRoom(room.roomCode, token); if (!owns()) return; notified.current = true; }
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
    const captured = useGameStore.getState().coltPublic;
    if (!captured) return;
    const currentEpoch = epoch.current; promptOpen.current = true;
    let capturedPrompt: DialogConfig | null = null;
    showDialog(captured.status === 'playing' ? 'Forfeit this robbery?' : 'Return to the arcade?', captured.status === 'playing' ? coltLeaveMessage() : 'Your completed result is preserved. Close this seat and return to the arcade?', [
      { text: 'STAY', style: 'cancel', onPress: () => { if (owns() && epoch.current === currentEpoch && prompt.current === capturedPrompt) promptOpen.current = false; } },
      { text: 'LEAVE', style: 'destructive', onPress: () => {
        if (!owns() || !promptOpen.current || prompt.current !== capturedPrompt || !isColtLeavePromptCurrent(captured, useGameStore.getState().coltPublic, currentEpoch, epoch.current)) return;
        promptOpen.current = false; void leave();
      } },
    ]);
    capturedPrompt = useDialogStore.getState().dialog;
    prompt.current = capturedPrompt;
  }, [cleanupPending, leave, room?.roomCode, token]);
  const startNewRoom = useCallback(() => {
    if (game?.status !== 'game_over' || !isColtLeavePromptCurrent(game, useGameStore.getState().coltPublic, 0, 0)) return;
    void leave('/colt-express');
  }, [game, leave]);
  const handleBack = useCallback(() => {
    if (!mounted.current || useGameStore.getState().token !== token) return;
    if (rules) { setRules(false); return; }
    if (coverShoot !== null) { cancelCover(); return; }
    requestLeave();
  }, [cancelCover, coverShoot, requestLeave, rules, token]);
  useLayoutEffect(() => { nativeBack.current = handleBack; }, [handleBack]);
  useWebBackGuard('/colt-express/game', handleBack, token !== null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { handleBack(); return true; });
    return () => listener.remove();
  }, [handleBack]);
  useWebModalFocus(Boolean(gameOver && !rules && !dialogOpen), 'colt-results', requestLeave);
  const focusDecision = useCallback(() => {
    if (!heading.current) return false;
    if (Platform.OS === 'web') {
      const control = document.getElementById('colt-decision');
      if (!control) return false;
      control.scrollIntoView({ block: 'start', inline: 'nearest' }); control.focus({ preventScroll: true });
    } else {
      scroll.current?.scrollTo({ y: decisionY.current, animated: false });
      const node = findNodeHandle(heading.current); if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }
    return true;
  }, []);
  useColtDecisionAttention(decisionKey, actions.busy || rules || dialogOpen || leaving, focusDecision);
  useColtDecisionAttention(coverShoot ? decisionKey + ':cover' : null, actions.busy || rules || dialogOpen || leaving, focusDecision);
  if (!game || !mine) return <GameRecovery onSessionCleared={sessionCleared} message="Restoring the train and your private hand…" background={C.bg} surface={C.surface} border={C.border} accent={C.ember} muted={C.muted} icon="train" />;
  const self = game.players.find(p => p.playerId === playerId);
  if (!self) return <GameRecovery onSessionCleared={sessionCleared} message="Restoring your bandit seat…" background={C.bg} surface={C.surface} border={C.border} accent={C.ember} muted={C.muted} icon="train" />;
  const locked = actions.busy || leaving || cleanupPending || dialogOpen || self.forfeited;
  const currentMessageScope = { token, roomCode: room?.roomCode, phase: `${game.round}:${game.status}:${game.phase}`, revision: game.revision };
  const controllerMessage = scopedActionMessage(actions.message, messageScope, currentMessageScope);
  const sendAction: typeof actions.send = (action, payload, label, revision) => {
    const sent = actions.send(action, payload, label, revision);
    if (sent) setMessageScope({ ...currentMessageScope, revision });
    return sent;
  };
  const ownDecision = mine.canChooseCharacter || mine.canChooseTeam || mine.canAssignStart || mine.canReserve || mine.canProgram || mine.canChoose;
  const pending = game.pending;
  const waitingId = game.phase === 'team_selection' ? game.teamSelectionPlayerId : game.phase === 'programming' ? game.programmingPlayerId : pending?.playerId;
  const waitingName = game.players.find(p => p.playerId === waitingId)?.displayName;
  const title = gameOver ? 'THE ROBBERY IS OVER' : self.forfeited ? 'YOUR SEAT HAS FORFEITED' : coverShoot ? 'CHOOSE OPTIONAL COVER' : game.phase === 'character_selection' ? mine.canChooseCharacter ? 'CHOOSE YOUR CHARACTER' : 'YOUR CHARACTER IS CONFIRMED' : mine.canChooseTeam ? 'CHOOSE YOUR TWO-BANDIT TEAM' : mine.canAssignStart ? 'CHOOSE YOUR SECRET FORMATION' : mine.canReserve ? 'RESERVE YOUR ROUND CARD' : mine.canProgram ? 'YOUR TURN TO PROGRAM' : mine.canChoose ? 'YOUR EXECUTION CHOICE' : 'WATCH THE TRAIN';
  const instruction = gameOver ? 'Your completed result is below.' : self.forfeited ? 'You are no longer eligible to win. You may inspect the public train.' : coverShoot ? 'Shoot is not submitted yet. Add a legal action from your other bandit, shoot alone, or cancel. Cover actions are face up, even with Ghost.' : game.phase === 'character_selection' ? coltCharacterSetupMessage(game, mine) : mine.canChooseTeam ? 'Both character powers apply. Choose one of the available pairs; each player chooses their own team.' : mine.canAssignStart ? 'Choose the bandit in the caboose. Your other bandit starts in the next car; formations reveal together.' : mine.canReserve ? 'Keep this chosen card for the new round, then draw the rest of your hand.' : mine.canProgram ? 'An action-card button programs it now, to resolve later. You may draw three cards instead.' : mine.canChoose ? 'Resolve this decision using one of the exact legal options below.' : waitingName ? waitingName + ' is making the next decision.' : 'The table is resolving actions. Your next choice will appear here.';
  const ownerName = (bandit: number) => COLT_CHARACTERS[self.characters[bandit]!]?.name ?? 'Your bandit';
  const shoot = mine.hand.find(c => c.id === coverShoot);
  const coverOptions = shoot ? mine.hand.filter(c => c.id !== shoot.id && c.action !== 'bullet' && c.action !== 'marshal' && c.ownerBandit !== shoot.ownerBandit) : [];
  const play = (cardId: string, coverCardId?: string) => {
    if (locked) return;
    if (sendAction('program', coltProgramPayload(cardId, coverCardId, mine.canHideFirstAction, faceDown), 'Program action', game.revision)) setCoverShoot(null);
  };
  const isHost = room?.players.some(p => p.playerId === playerId && p.isHost), rematchBlocked = coltRematchMessage(room?.players ?? []);
  const winnerNames = game.players.filter(p => game.winnerPlayerIds.includes(p.playerId)).map(p => p.displayName).join(', ');
  const resultPlayers = [...game.players].sort((a, b) => Number(a.forfeited) - Number(b.forfeited) || Number(game.winnerPlayerIds.includes(b.playerId)) - Number(game.winnerPlayerIds.includes(a.playerId)) || (b.finalScore ?? 0) - (a.finalScore ?? 0) || a.receivedBullets - b.receivedBullets);
  const inspectTrain = () => {
    if (Platform.OS === 'web') { const node = document.getElementById('colt-train'); node?.scrollIntoView({ block: 'start' }); node?.focus({ preventScroll: true }); }
    else scroll.current?.scrollTo({ y: trainY.current, animated: false });
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
    <View style={{ minHeight: 60, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 }}>
      <ScalePressable accessibilityLabel="Back to arcade" onPress={handleBack} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="arrow-left" size={23} color={C.ember} /></ScalePressable>
      <View style={{ flex: 1, minWidth: 0, paddingVertical: 8 }}><Text style={{ fontFamily: 'Outfit_800ExtraBold', color: C.ember, fontSize: 18 }}>ROUND {game.round} OF 5</Text><Text style={secondary}>{game.roundCard.title}</Text></View>
      <ScalePressable accessibilityLabel="Open rulebook" onPress={() => setRules(true)} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="book-open-variant" size={23} color={C.gold} /></ScalePressable>
    </View>
    <ScrollView ref={scroll} onLayout={event => setContentWidth(Math.max(0, Math.min(1100, event.nativeEvent.layout.width) - 28))} contentContainerStyle={{ width: '100%', maxWidth: 1100, alignSelf: 'center', padding: 14, gap: 20, paddingBottom: 40 }}>
      <View onLayout={event => { decisionY.current = event.nativeEvent.layout.y; }} style={{ borderRadius: 15, borderWidth: 1, borderColor: ownDecision ? C.ember : C.border, backgroundColor: C.surface, padding: 14, gap: 10 }}>
        <Text ref={heading} nativeID="colt-decision" accessibilityRole="header" accessibilityLiveRegion="polite" {...(Platform.OS === 'web' ? { tabIndex: -1 } : {})} style={{ fontFamily: 'Outfit_800ExtraBold', color: C.text, fontSize: 21 }}>{title}</Text>
        <Text style={body}>{instruction}</Text>
        {game.turnType && game.phase === 'programming' ? <Text style={{ ...body, color: C.gold }}>Turn {game.slot} of {game.slots}{mine.canProgram ? ` · action ${game.programmingActionNumber} of ${game.turnType === 'speeding' ? 2 : 1}` : ''}. {COLT_TURN_HELP[game.turnType]}</Text> : null}
        <Text style={secondary}>{COLT_EVENT_HELP[game.roundCard.event]}</Text>
        {controllerMessage ? <Text accessibilityLiveRegion="polite" style={{ ...body, color: C.cyan }}>{controllerMessage}</Text> : null}
        {!actions.connected || !actions.synced ? <><Text style={secondary}>Restoring the connection and your matching private hand. Actions are unavailable until ready.</Text><NeonButton label="RETRY CONNECTION" color={C.cyan} variant="outline" onPress={actions.refresh} /></> : null}
        {error ? <Text accessibilityRole="alert" style={{ ...body, color: C.red }}>{error}</Text> : null}
        {cleanupPending ? <NeonButton label="RETRY LEAVING" color={C.ember} onPress={() => void leave()} disabled={leaving} /> : null}
        <NeonButton label="INSPECT TRAIN" color={C.cyan} variant="outline" onPress={inspectTrain} />
        {!coverShoot && mine.canReserve ? <NeonButton label="CHOOSE RESERVE CARD" color={C.ember} onPress={() => jumpToCards('reserve')} /> : null}
        {!coverShoot && mine.canProgram ? <NeonButton label="CHOOSE FROM YOUR HAND" color={C.ember} onPress={() => jumpToCards('hand')} /> : null}
        {game.program.length > 0 ? <NeonButton label="VIEW SHARED PROGRAM" color={C.gold} variant="outline" onPress={() => jumpToCards('program')} /> : null}
        {mine.canChooseCharacter ? game.availableCharacters.map(character => <CharacterChoice key={character} character={COLT_CHARACTERS[character]} disabled={locked} onPress={() => sendAction('choose-character', { character }, 'Character choice', game.revision)} />) : null}
        {game.phase === 'character_selection' ? <View style={{ gap: 6 }}><Text accessibilityRole="header" style={{ ...body, color: C.gold }}>CHARACTER CLAIMS</Text>{game.players.filter(player => !player.forfeited).map(player => <Text key={player.playerId} style={body}>{player.displayName}{player.playerId === playerId ? ' · YOU' : ''}: {player.characterChosen && player.character ? COLT_CHARACTERS[player.character].name : 'Choosing a character'}</Text>)}</View> : null}
        {mine.canChooseTeam ? game.availableTeams.map((team, teamIndex) => <TeamChoice key={team.join('-')} characters={team.map(c => COLT_CHARACTERS[c])} disabled={locked} onPress={() => sendAction('choose-team', { teamIndex }, 'Team choice', game.revision)} />) : null}
        {mine.canAssignStart ? self.characters.map((character, cabooseBandit) => <NeonButton key={character} label={COLT_CHARACTERS[character].name.toUpperCase() + ' IN CABOOSE'} color={C.gold} variant="outline" disabled={locked} onPress={() => sendAction('assign-start', { cabooseBandit }, 'Starting formation', game.revision)} />) : null}
        {mine.canChoose && pending ? <><Text style={{ ...body, color: C.gold }}>{pending.action.toUpperCase()}: {COLT_ACTION_HELP[pending.action]}</Text>{pending.options.map(option => <NeonButton key={option.id} label={option.label} color={C.gold} variant="outline" disabled={locked} onPress={() => sendAction('choose', { optionId: option.id }, 'Execution choice', game.revision)} />)}</> : null}
        {coverShoot ? <><NeonButton label="PROGRAM SHOOT ONLY" color={C.ember} disabled={locked} onPress={() => play(coverShoot)} />{coverOptions.map(card => <View key={card.id} style={{ gap: 5 }}><NeonButton label={'PROGRAM SHOOT + ' + ownerName(card.ownerBandit).toUpperCase() + ' ' + card.action.toUpperCase()} color={C.cyan} variant="outline" disabled={locked} onPress={() => play(coverShoot, card.id)} /><Text style={body}>{COLT_ACTION_HELP[card.action]}</Text></View>)}<NeonButton label="CANCEL COVER" color={C.cyan} variant="outline" onPress={cancelCover} /></> : null}
      </View>
      <View onLayout={event => { trainY.current = event.nativeEvent.layout.y; }}><Section title="THE TRAIN" id="colt-train" flat><TrainBoard game={game} playerId={playerId} /><NeonButton label="RETURN TO DECISION" color={C.cyan} variant="outline" onPress={focusDecision} /></Section></View>
      {mine.canReserve ? <View onLayout={event => { reserveY.current = event.nativeEvent.layout.y; }}><Section title="YOUR SECRET RESERVE" id="colt-reserve" headingRef={reserveHeading} detail="The chosen card is guaranteed in your new hand." flat><NeonButton label="RETURN TO DECISION" color={C.cyan} variant="outline" onPress={focusDecision} /><CardGrid items={mine.reserveOptions} keyExtractor={card => card.id} minCardWidth={240} maxCardWidth={320} gap={12} textScale={fontScale} renderItem={card => <ActionCard fluid action={card.action} owner={ownerName(card.ownerBandit)} mode="reserve" disabled={locked} onPress={() => sendAction('reserve', { cardId: card.id }, 'Reserve card', game.revision)} />} /></Section></View> : null}
      <View onLayout={event => { cardsY.current = event.nativeEvent.layout.y; }} style={{ flexDirection: sideBySide ? 'row' : 'column', alignItems: 'flex-start', gap: 24 }}>
      <View onLayout={event => { handY.current = event.nativeEvent.layout.y; }} style={{ minWidth: 0, width: sideBySide ? undefined : '100%', flex: sideBySide ? 2 : undefined }}><Section title="YOUR PRIVATE HAND" id="colt-hand" headingRef={handHeading} detail={mine.hand.length + ' cards. Your next action resolves later in the shared program.'} flat>
        <NeonButton label="RETURN TO DECISION" color={C.cyan} variant="outline" onPress={focusDecision} />
        {mine.canProgram && mine.canHideFirstAction ? <ScalePressable accessibilityLabel={faceDown ? 'Ghost first action: face down' : 'Ghost first action: face up'} accessibilityState={{ selected: faceDown, disabled: locked }} disabled={locked} onPress={() => setFaceDown(value => !value)} style={{ minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: C.gold, padding: 12 }}><Text style={{ ...body, color: C.gold }}>{faceDown ? 'GHOST: HIDE FIRST ACTION' : 'GHOST: FIRST ACTION FACE UP'}</Text><Text style={secondary}>Optional Ghost power. Toggle before programming the eligible action.</Text></ScalePressable> : null}
        {mine.canProgram ? <NeonButton label="DRAW 3 INSTEAD" color={C.cyan} variant="outline" disabled={locked} onPress={() => sendAction('program', { draw: true }, 'Draw cards', game.revision)} /> : null}
        <CardGrid items={mine.hand} keyExtractor={card => card.id} minCardWidth={240} maxCardWidth={320} gap={12} textScale={fontScale} renderItem={card => <ActionCard fluid id={'colt-hand-' + card.id} action={card.action} owner={ownerName(card.ownerBandit)} disabled={locked || !mine.canProgram || card.action === 'bullet'} configure={card.action === 'shoot' && self.characters.length === 2 && game.turnType === 'standard'} onPress={() => { if (card.action === 'shoot' && self.characters.length === 2 && game.turnType === 'standard') setCoverShoot(card.id); else play(card.id); }} />} />
        {!mine.hand.length ? <Text style={secondary}>No cards in your hand.</Text> : null}
      </Section></View>
      <View onLayout={event => { programY.current = event.nativeEvent.layout.y; }} style={{ minWidth: 0, width: sideBySide ? undefined : '100%', flex: sideBySide ? 1 : undefined, gap: 10 }}><ProgramCards game={game} headingRef={programHeading} /><NeonButton label="RETURN TO DECISION" color={C.cyan} variant="outline" onPress={focusDecision} /></View>
      </View>
      <Section title="YOUR BANDITS AND LOOT" detail="Only you can see these owned loot values.">
        {self.characters.map((character, index) => <View key={character} style={{ gap: 5 }}><Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 17, color: C.gold }}>{COLT_CHARACTERS[character].name}</Text><Text style={body}>{COLT_CHARACTERS[character].summary}</Text><Text style={secondary}>{self.positions[index] ? coltCarName(self.positions[index]!.carIndex, game.trainCars) + ' · ' + self.positions[index]!.level : 'Starting formation not revealed'}</Text><Text style={body}>{mine.lootByBandit[index]?.map(loot => loot.type + ' $' + loot.value).join(' · ') || 'No loot'}</Text></View>)}
      </Section>
      <Section title="BANDIT ROSTER">
        {game.players.map(player => <View key={player.playerId} style={{ gap: 3, paddingVertical: 5 }}><Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 16, color: player.playerId === playerId ? C.ember : C.text }}>{player.displayName}{player.playerId === playerId ? ' · YOU' : ''}</Text><Text style={secondary}>{player.lootCount} loot · {player.bulletsFired} shots fired · {player.receivedBullets} {player.receivedBullets === 1 ? 'bullet' : 'bullets'} received</Text>{player.forfeited ? <Text style={{ ...body, color: C.red }}>FORFEITED{game.turnOrder.includes(player.playerId) ? ' · FINISHING COMMITTED ROUND' : ' · REMOVED FROM TRAIN'}</Text> : room?.players.find(p => p.playerId === player.playerId)?.isConnected === false ? <Text style={{ ...body, color: C.gold }}>RECONNECTING</Text> : null}</View>)}
      </Section>
      <Section title="ROBBERY LOG">{game.log.slice(-8).reverse().map(entry => <Text key={entry.id} style={secondary}>{entry.text}</Text>)}</Section>
    </ScrollView>
    <Modal visible={gameOver && !rules && !dialogOpen} transparent animationType="none" onRequestClose={requestLeave}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'center', padding: 16 }}>
        <View nativeID="colt-results" accessibilityViewIsModal {...(Platform.OS === 'web' ? { role: 'dialog' as const, 'aria-modal': true } : {})} style={{ width: '100%', maxWidth: 640, maxHeight: '90%', alignSelf: 'center', borderRadius: 17, borderWidth: 1, borderColor: C.gold, backgroundColor: C.surface, padding: 16 }}>
          <ScrollView contentContainerStyle={{ gap: 12 }}><Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: C.gold, fontSize: 25 }}>{winnerNames ? winnerNames + (game.winnerPlayerIds.length === 1 ? ' wins' : ' win') : 'No winner'}</Text><Text style={body}>{game.endReason === 'forfeit' ? winnerNames ? 'The remaining eligible seat wins by forfeit, not by haul.' : 'All seats departed. There is no winner.' : 'Five rounds complete. Loot plus the Gunslinger prize decides the winner; fewer received bullets breaks a wealth tie.'}</Text>
            {resultPlayers.map(player => <View key={player.playerId} style={{ borderRadius: 12, borderWidth: 1, borderColor: game.winnerPlayerIds.includes(player.playerId) ? C.ember : C.border, padding: 12, gap: 5 }}><Text style={{ fontFamily: 'Outfit_800ExtraBold', color: C.text, fontSize: 17 }}>{player.displayName}</Text><Text style={{ ...body, color: player.forfeited ? C.red : C.gold }}>{player.forfeited ? 'FORFEITED' : game.winnerPlayerIds.includes(player.playerId) ? 'WINNER' : 'COMPLETED'}</Text>{game.endReason === 'score' && player.finalScore !== null ? <Text style={body}>${player.finalScore} total · ${player.lootValue ?? 0} loot · {player.receivedBullets} {player.receivedBullets === 1 ? 'bullet' : 'bullets'} received</Text> : null}</View>)}
            {controllerMessage ? <Text style={{ ...body, color: C.cyan }}>{controllerMessage}</Text> : null}{error ? <Text accessibilityRole="alert" style={{ ...body, color: C.red }}>{error}</Text> : null}
            {isHost && !rematchBlocked ? <NeonButton label="PLAY AGAIN" color={C.ember} disabled={locked} onPress={() => sendAction('start', {}, 'Rematch', game.revision)} /> : <Text style={secondary}>{rematchBlocked ?? 'The host can start another robbery.'}</Text>}
            {isHost && rematchBlocked ? <NeonButton label="START A NEW ROOM" color={C.cyan} variant="outline" disabled={leaving} onPress={startNewRoom} /> : null}
            <NeonButton label={cleanupPending ? 'RETRY LEAVING' : 'BACK TO ARCADE'} color={C.gold} variant="outline" disabled={leaving} onPress={requestLeave} />
          </ScrollView>
        </View>
      </View>
    </Modal>
    <ColtReferenceSheet visible={rules} onClose={() => setRules(false)} />
  </SafeAreaView>;
}
