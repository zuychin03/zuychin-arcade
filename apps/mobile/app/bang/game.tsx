import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BANG_CHARACTERS, BANG_MIN_PLAYERS, type BangActionKind, type BangCard, type BangRole } from '@zuychin-arcade/types';
import { useGameStore } from '../../store/useGameStore';
import { getSocket } from '../../hooks/useSocket';
import { useWebBackGuard } from '../../hooks/useWebBackGuard';
import { useNativeLeaveGuard } from '../../hooks/useNativeLeaveGuard';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { CardGrid } from '../../components/ui/CardGrid';
import { GameRecovery } from '../../components/ui/GameRecovery';
import { BangCardView, BANG_CARD_DETAILS, BANG_ROLE_GUIDE } from '../../components/bang/Card';
import { BANG_CARD_EMBLEM } from '../../components/bang/CardArtwork';
import { BangCharacterArtwork } from '../../components/bang/CharacterArtwork';
import { BangHand } from '../../components/bang/Hand';
import { BangReferenceSheet } from '../../components/bang/ReferenceSheet';
import { useBangActions } from '../../components/bang/useBangActions';
import { bangDecisionOffset, bangLayout } from '../../components/bang/layout';
import { showDialog, useDialogStore, type DialogConfig } from '../../lib/dialog';
import { leaveRoom } from '../../lib/api';
import { clearAuthIfMatches } from '../../lib/storage';
import { BANG } from '../../constants/theme';

const name = (card: BangCard) => BANG_CARD_DETAILS[card.name].name;
const toggle = (values: string[], id: string, limit: number) => values.includes(id) ? values.filter((value) => value !== id) : values.length < limit ? [...values, id] : values;
function Button({ label, onPress, disabled, danger, quiet }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean; quiet?: boolean }) {
  const colour = danger ? BANG.red : BANG.gold;
  return <ScalePressable accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, { backgroundColor: quiet ? BANG.panel : colour, borderColor: colour, opacity: disabled ? 0.45 : 1 }]}>
    <Text style={[styles.buttonText, { color: quiet ? colour : BANG.bg }]}>{label}</Text>
  </ScalePressable>;
}
function Panel({ title, children, urgent = false, onLayout, nativeID }: { title: string; children: ReactNode; urgent?: boolean; onLayout?: (event: LayoutChangeEvent) => void; nativeID?: string }) {
  return <View nativeID={nativeID} tabIndex={Platform.OS === 'web' && nativeID === 'bang-current-choice' ? -1 : undefined} accessibilityLabel={nativeID === 'bang-current-choice' ? title : undefined} accessibilityLiveRegion={urgent ? 'polite' : undefined} onLayout={onLayout} style={[styles.panel, urgent && { borderColor: BANG.gold }]}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function RoleBadge({ role, playerId }: { role: BangRole | null; playerId?: string }) {
  const icon = role === null ? 'help' : role === 'sheriff' ? 'star-circle-outline' : role === 'deputy' ? 'shield-star-outline' : role === 'outlaw' ? 'cards-spade' : 'compass-outline';
  return <View testID={playerId ? `bang-public-role-${playerId}` : undefined} style={styles.roleStation}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.badge, role === null && styles.badgeHidden]}>
      <MaterialCommunityIcons name={icon} size={28} color={role === null ? BANG.sand : BANG.gold} />
    </View>
    <Text style={styles.roleName}>{role === null ? 'Hidden role' : BANG_ROLE_GUIDE[role].name}</Text>
  </View>;
}

function LifeTokens({ health, maximum }: { health: number; maximum: number }) {
  return <View style={styles.lifeStation}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.lifeRack}>
      {Array.from({ length: maximum }, (_, index) => <View key={index} style={[styles.lifeToken, index >= health && styles.lifeEmpty]}>
        <MaterialCommunityIcons name={index < health ? 'heart' : 'heart-outline'} size={16} color={index < health ? BANG.bg : BANG.muted} />
      </View>)}
    </View>
    <Text style={styles.small}>{health}/{maximum} life</Text>
  </View>;
}

export default function BangGame() {
  const game = useGameStore((state) => state.bangPublic);
  const priv = useGameStore((state) => state.bangPrivate);
  const me = useGameStore((state) => state.playerId);
  const room = useGameStore((state) => state.room);
  const token = useGameStore((state) => state.token);
  const actions = useBangActions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const [sidMode, setSidMode] = useState(false);
  const [rules, setRules] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leaveRef = useRef(false);
  const promptRef = useRef(false);
  const ownedPrompt = useRef<DialogConfig | null>(null);
  const mounted = useRef(true);
  const departedRef = useRef(false);
  const leaveEpochRef = useRef(0);
  const leaveGameOver = game?.status === 'game_over';
  const leaveTerminalRevision = leaveGameOver ? game.revision : null;
  const lifecycleIdentity = useRef(token);
  const nativeBack = useRef<(() => void) | null>(null);
  const approveNavigation = useNativeLeaveGuard(token, () => {
    if (useGameStore.getState().token === token) nativeBack.current?.();
  });
  const onRecoveryCleared = useCallback(() => {
    if (useGameStore.getState().token !== null) return;
    leaveRef.current = true;
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null, null);
  }, [approveNavigation]);
  const scroll = useRef<ScrollView>(null);
  const { fontScale = 1 } = useWindowDimensions();
  const [playWidth, setPlayWidth] = useState(0);
  const [resultWidth, setResultWidth] = useState(0);
  const [titleHeight, setTitleHeight] = useState(28);
  const textScale = Math.max(1, fontScale, titleHeight / 28);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (ownedPrompt.current && useDialogStore.getState().dialog === ownedPrompt.current) useDialogStore.getState().hide();
    };
  }, []);
  useEffect(() => {
    leaveEpochRef.current += 1;
    if (ownedPrompt.current && useDialogStore.getState().dialog === ownedPrompt.current) useDialogStore.getState().hide();
    ownedPrompt.current = null;
    promptRef.current = false;
  }, [leaveGameOver, leaveTerminalRevision, room?.roomCode, token]);
  useEffect(() => {
    const previous = lifecycleIdentity.current;
    lifecycleIdentity.current = token;
    if (token === null || previous === token) return;
    leaveRef.current = false;
    departedRef.current = false;
    promptRef.current = false;
    if (ownedPrompt.current && useDialogStore.getState().dialog === ownedPrompt.current) useDialogStore.getState().hide();
    ownedPrompt.current = null;
    setLeaving(false);
    setRules(false);
    setSelectedId(null);
    setTargetId(null);
    setSidMode(false);
    setPicks([]);
  }, [token]);
  useEffect(() => {
    if (token !== null || useGameStore.getState().token !== null || leaveRef.current) return;
    leaveRef.current = true;
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null);
  }, [token, approveNavigation]);
  const hasDecision = priv && (priv.canPlay || priv.canRespond || priv.canChooseStore || priv.canChooseDraw || priv.canChooseCheck || priv.canRescue || priv.canChooseDiscardOrder || priv.canDiscard);
  const decisionKey = hasDecision && game ? `${game.phase}:${game.turnNumber}:${game.activePlayerId}:${game.drawCheck?.kind ?? ''}` : null;
  const decisionY = useRef(0);
  const decisionAnchors = useRef({ play: 0, primary: 0, decision: 0, choice: 0, hand: 0, inHand: false });
  const updateDecisionY = () => {
    const anchor = decisionAnchors.current;
    decisionY.current = bangDecisionOffset(anchor.play, anchor.primary, anchor.decision, anchor.choice, anchor.inHand ? anchor.hand : 0);
  };
  const decisionLayout = (event: LayoutChangeEvent) => {
    decisionAnchors.current.choice = event.nativeEvent.layout.y;
    decisionAnchors.current.inHand = false;
    updateDecisionY();
  };
  const handDecisionLayout = (event: LayoutChangeEvent) => {
    decisionAnchors.current.choice = event.nativeEvent.layout.y;
    decisionAnchors.current.inHand = true;
    updateDecisionY();
  };
  useLayoutEffect(() => {
    const anchor = decisionAnchors.current;
    const inHand = Boolean(priv?.canPlay || priv?.canDiscard);
    if (anchor.inHand !== inHand) {
      anchor.inHand = inHand;
      anchor.choice = 0;
    }
    decisionY.current = bangDecisionOffset(anchor.play, anchor.primary, anchor.decision, anchor.choice, inHand ? anchor.hand : 0);
  }, [priv?.canPlay, priv?.canDiscard]);
  useEffect(() => { setPicks([]); setSidMode(false); }, [decisionKey]);
  useEffect(() => {
    if (!priv?.canPlay || !priv.playOptions.some((item) => item.cardId === selectedId)) { setSelectedId(null); setTargetId(null); }
    else if (!priv.playOptions.find((item) => item.cardId === selectedId)?.targets.some((item) => item.playerId === targetId)) setTargetId(null);
    if (!priv?.canUseSid) setSidMode(false);
  }, [priv, selectedId, targetId]);
  useEffect(() => {
    if (!decisionKey) return;
    const timer = setTimeout(() => {
      if (Platform.OS === 'web') {
        const panel = document.getElementById('bang-current-choice');
        panel?.scrollIntoView({ block: 'start' });
        panel?.focus({ preventScroll: true });
      } else scroll.current?.scrollTo({ y: decisionY.current, animated: false });
    }, 60);
    return () => clearTimeout(timer);
  }, [decisionKey]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !selectedId) return;
    const timer = setTimeout(() => document.getElementById('bang-play-options')?.querySelector<HTMLElement>('[role="button"]')?.focus(), 0);
    return () => clearTimeout(timer);
  }, [selectedId, targetId]);
  const cancelPlay = useCallback(() => {
    if (Platform.OS === 'web' && selectedId) document.getElementById(`bang-card-hand-${selectedId}`)?.querySelector<HTMLElement>('[role="button"]')?.focus();
    setSelectedId(null); setTargetId(null);
  }, [selectedId]);

  const leave = useCallback(async () => {
    const ownsSession = () => mounted.current && useGameStore.getState().token === token && useGameStore.getState().room?.roomCode === room?.roomCode;
    if (leaveRef.current || !ownsSession()) return;
    leaveRef.current = true;
    setLeaving(true);
    try {
      if (room && token && !departedRef.current) {
        await leaveRoom(room.roomCode, token);
        if (!ownsSession()) return;
        departedRef.current = true;
        getSocket()?.disconnect();
      }
      if (token) await clearAuthIfMatches(token);
    } catch (error) {
      if (!ownsSession()) return;
      leaveRef.current = false;
      setLeaving(false);
      showDialog('Could not finish leaving', `${error instanceof Error ? error.message : 'Connection unavailable'}. Try leaving again to clear this session.`);
      return;
    }
    if (!ownsSession()) return;
    getSocket()?.disconnect();
    useGameStore.getState().clearAll();
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null, null);
  }, [room, token, approveNavigation]);
  const requestLeave = useCallback(() => {
    if (leaveRef.current || promptRef.current) return;
    const captured = useGameStore.getState().bangPublic;
    const ended = captured?.status === 'game_over';
    const revision = captured?.revision;
    const epoch = ++leaveEpochRef.current;
    const isCurrent = () => {
      const current = useGameStore.getState();
      return mounted.current && promptRef.current && epoch === leaveEpochRef.current
        && current.token === token && current.room?.roomCode === room?.roomCode
        && (current.bangPublic?.status === 'game_over') === ended
        && (!ended || current.bangPublic?.revision === revision);
    };
    promptRef.current = true;
    const live = captured?.status === 'playing';
    showDialog(live ? 'Leave and forfeit?' : 'Leave this table?', live
      ? 'Leaving immediately eliminates your character and forfeits your place in this match, even if your team wins. This can end the match, including when the Sheriff leaves. You cannot rejoin this match. A temporary connection loss gives you a chance to reconnect instead.'
      : 'Your seat will close and you will return to the arcade.', [
      { text: 'STAY', style: 'cancel', onPress: () => { if (isCurrent()) promptRef.current = false; } },
      { text: live ? 'FORFEIT AND LEAVE' : 'LEAVE TABLE', style: 'destructive', onPress: () => { if (!isCurrent()) return; promptRef.current = false; void leave(); } },
    ]);
    ownedPrompt.current = useDialogStore.getState().dialog;
  }, [leave, room?.roomCode, token]);
  const back = useCallback(() => {
    if (rules) setRules(false);
    else if (selectedId || sidMode) { setSelectedId(null); setTargetId(null); setSidMode(false); setPicks([]); }
    else requestLeave();
  }, [requestLeave, rules, selectedId, sidMode]);
  useLayoutEffect(() => { nativeBack.current = back; }, [back]);
  useWebBackGuard('/bang/game', back, token !== null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [back]);

  const mine = game?.players.find((player) => player.playerId === me);
  if (!game || !priv || !mine) return <GameRecovery onSessionCleared={onRecoveryCleared} message="Dealing the frontier…" background={BANG.bg} surface={BANG.surface} border={BANG.border} accent={BANG.gold} muted={BANG.muted} icon="pistol" />;
  const { besideTable } = bangLayout(playWidth, textScale);
  const { besideResults } = bangLayout(resultWidth, textScale);
  const busy = actions.busy || leaving;
  const send = (action: BangActionKind, payload: Record<string, unknown>, label: string) => actions.send(action, payload, label, game.revision);
  const selected = priv.hand.find((card) => card.id === selectedId);
  const option = priv.playOptions.find((item) => item.cardId === selectedId);
  const target = option?.targets.find((item) => item.playerId === targetId);
  const targetPlayer = game.players.find((player) => player.playerId === targetId);
  const active = game.players.find((player) => player.playerId === game.activePlayerId);
  const showTurn = game.status === 'playing' && active?.alive === true;
  const decidingId = game.rescue?.playerId ?? game.drawCheck?.playerId ?? game.discardOrder?.playerId ?? game.drawChoice?.playerId ?? game.pending?.targetPlayerId ?? game.activePlayerId;
  const deciding = game.players.find((player) => player.playerId === decidingId);
  const myDecision = priv.canPlay || priv.canRespond || priv.canChooseStore || priv.canChooseDraw || priv.canChooseCheck || priv.canRescue || priv.canChooseDiscardOrder || priv.canDiscard;
  const required = Math.max(0, priv.hand.length - mine.health);
  const role = BANG_ROLE_GUIDE[priv.role];
  const character = BANG_CHARACTERS[mine.character];
  const connectedCount = room?.players.filter((player) => player.isConnected).length ?? 0;
  const reservedCount = room?.players.filter((player) => !player.hasLeft && !player.isConnected).length ?? 0;
  const isHost = room?.players.some((player) => player.playerId === me && player.isHost);
  const headline = game.status === 'game_over' ? game.abandoned ? 'Table closed' : game.winner === 'outlaws' ? 'The Outlaws win' : `${game.winner === 'law' ? 'The Law' : 'The Renegade'} wins`
    : myDecision ? 'Your move' : !mine.alive ? 'You are watching the showdown' : `Waiting for ${deciding?.displayName ?? 'the table'}`;
  const opponentId = game.pending?.kind === 'duel' && game.pending.sourcePlayerId === me ? game.pending.duelOpponentPlayerId : game.pending?.sourcePlayerId;
  const play = (targetPlayerId?: string, targetZone?: 'hand' | 'equipment', targetCardId?: string) => {
    if (selected) send('play', { cardId: selected.id, targetPlayerId, targetZone, targetCardId }, `Playing ${name(selected)}`);
  };
  const cardStatus = (card: BangCard) => {
    if (sidMode) return 'Choose 2 to heal';
    if (priv.canDiscard) return 'Choose to discard';
    if (priv.canRespond && priv.responseCardIds.includes(card.id)) return 'Use to respond';
    if (priv.canRescue && priv.rescueBeerCardIds.includes(card.id)) return 'Use to survive';
    const playable = priv.playOptions.find((item) => item.cardId === card.id);
    if (playable) return playable.effectiveName !== card.name ? `Play as ${BANG_CARD_DETAILS[playable.effectiveName].name}` : 'Select to play';
    if (!priv.canPlay) return 'In your hand';
    if (card.name === 'missed') return 'Keep for a response';
    if (card.name === 'bang' && priv.bangsRemaining === 0) return 'BANG! limit reached';
    if (card.name === 'beer') return game.players.filter((player) => player.alive).length <= 2 ? 'No healing with 2 alive' : 'Life is full';
    return 'No legal play now';
  };

  return <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: BANG.bg }}>
    <View nativeID="bang-toolbar" style={styles.header}>
      <ScalePressable accessibilityLabel="Leave table" onPress={requestLeave} disabled={leaving} style={styles.iconButton}><MaterialCommunityIcons name="arrow-left" size={24} color={BANG.gold} /></ScalePressable>
      <View style={styles.brandGroup}><Text onLayout={event => setTitleHeight(event.nativeEvent.layout.height)} style={styles.brand}>BANG!</Text><Text style={styles.turn}>TURN {game.turnNumber}</Text></View>
      <ScalePressable accessibilityLabel="Open rules" onPress={() => setRules(true)} style={styles.iconButton}><MaterialCommunityIcons name="book-open-variant" size={23} color={BANG.sand} /></ScalePressable>
    </View>
    <ScrollView ref={scroll} contentContainerStyle={styles.content}>
      <View accessibilityLiveRegion="polite" style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={styles.headline}>{headline}</Text>
        <Text style={styles.body}>{game.status === 'game_over' ? 'Roles revealed. Review the table or play a fresh match.' : `${active?.displayName ?? 'The table'} is taking turn ${game.turnNumber}. ${mine.alive ? '' : mine.forfeited ? 'You forfeited this match.' : priv.role === 'renegade' ? 'You are eliminated and can no longer win.' : 'Your team can still win.'}`}</Text>
        {!actions.connected || !actions.synced || actions.message ? <View style={styles.notice}><Text style={styles.body}>{actions.message ?? (actions.connected ? 'Synchronising your hand and the table…' : 'Reconnecting to the table…')}</Text>{!actions.synced ? <Button label="REFRESH TABLE" onPress={actions.refresh} quiet disabled={!actions.connected} /> : null}</View> : null}
      </View>
      {game.status === 'game_over' ? <View nativeID="bang-results" onLayout={event => setResultWidth(event.nativeEvent.layout.width - 32)} style={[styles.results, { flexDirection: besideResults ? 'row' : 'column' }]}>
        <View nativeID="bang-result-summary" style={[styles.resultSummary, besideResults ? { flexBasis: 320, flexGrow: 1 } : { width: '100%' }]}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{game.abandoned ? 'No winner: this match ended without a winning team' : 'Final standings'}</Text>
        <Text style={styles.body}>{connectedCount} connected · at least {BANG_MIN_PLAYERS} needed for a rematch. {reservedCount ? `Waiting for ${reservedCount} reserved seat(s) to reconnect or expire. ` : ''}Fresh roles, characters and cards are dealt.</Text>
        {isHost ? <Button label="PLAY AGAIN" disabled={busy || reservedCount > 0 || connectedCount < BANG_MIN_PLAYERS} onPress={() => send('start', {}, 'Starting a fresh match')} /> : <Text style={styles.body}>The host can start the rematch when enough players are connected.</Text>}
        <Button label="BACK TO ARCADE" quiet onPress={requestLeave} disabled={leaving} />
        </View>
        <View nativeID="bang-result-roster" style={[styles.resultRoster, besideResults ? { flexBasis: 440, flexGrow: 1 } : { width: '100%' }]}>
          {game.players.map((player) => {
            const winner = !player.forfeited && !game.abandoned && (game.winner === 'law' ? player.role === 'sheriff' || player.role === 'deputy' : game.winner === 'outlaws' ? player.role === 'outlaw' : player.role === 'renegade');
            return <View key={player.playerId} nativeID={`bang-result-row-${player.playerId}`} style={styles.result}><View style={styles.resultIdentity}><Text style={styles.playerName}>{player.displayName}{player.playerId === me ? ' (you)' : ''}</Text><RoleBadge role={player.role} /><Text style={styles.body}>{BANG_CHARACTERS[player.character].name}</Text></View><Text style={[styles.resultStatus, { color: winner ? BANG.gold : BANG.sand }]}>{player.forfeited ? 'FORFEITED' : winner ? 'WINNER' : player.alive ? 'SURVIVED' : 'ELIMINATED'}</Text></View>;
          })}
        </View>
      </View> : null}
      <View nativeID="bang-play-area" onLayout={event => { decisionAnchors.current.play = event.nativeEvent.layout.y; setPlayWidth(event.nativeEvent.layout.width); updateDecisionY(); }} style={[styles.playArea, { flexDirection: besideTable ? 'row' : 'column' }]}>
      <View onLayout={event => { decisionAnchors.current.primary = event.nativeEvent.layout.y; updateDecisionY(); }} style={[styles.primaryColumn, besideTable ? { flexBasis: 560, flexGrow: 1.6 } : { width: '100%' }, game.status === 'game_over' && { display: 'none' }]}>
      {game.status !== 'game_over' ? <View style={styles.identity}>
        <RoleBadge role={priv.role} />
        <Text style={styles.sectionTitle}>Your {priv.role === 'sheriff' ? 'public' : 'secret'} role: {role.name}</Text><Text style={styles.body}>{role.goal}</Text>
        <View style={styles.characterStation}><BangCharacterArtwork character={mine.character} /><Text style={styles.playerName}>{character.name}</Text><LifeTokens health={mine.health} maximum={mine.maxHealth} /><Text style={styles.body}>{character.summary}</Text></View>
        {priv.canPlay ? <Text style={styles.small}>Weapon range {priv.weaponRange} · {priv.bangsRemaining === null ? 'Unlimited BANG!' : `${priv.bangsRemaining} BANG! remaining this turn`}</Text> : null}
      </View> : null}
      <View nativeID="bang-decision-area" onLayout={event => { decisionAnchors.current.decision = event.nativeEvent.layout.y; updateDecisionY(); }} style={styles.decisionArea}>
      {priv.canChooseCheck && game.drawCheck ? <Panel nativeID="bang-current-choice" onLayout={decisionLayout} title={`Lucky Duke: choose your ${game.drawCheck.kind.replace('_', ' ')} check`} urgent>
        <Text style={styles.body}>{game.drawCheck.kind === 'dynamite' ? 'Spades 2–9 explode. Choose the card to resolve; both revealed cards are discarded.' : 'Hearts succeed. Choose the card to resolve; both revealed cards are discarded.'}</Text>
        <CardGrid items={game.drawCheck.cards} keyExtractor={card => card.id} minCardWidth={200} maxCardWidth={260} textScale={textScale} renderItem={card => <BangCardView card={card} fluid idPrefix="check" status="Choose this check" disabled={busy} onPress={() => send('choose_check', { cardId: card.id }, 'Choosing the check')} />} />
      </Panel> : null}
      {priv.canChooseStore ? <Panel nativeID="bang-current-choice" onLayout={decisionLayout} title="General Store: choose one card" urgent><CardGrid items={game.pending?.storeCards ?? []} keyExtractor={card => card.id} minCardWidth={200} maxCardWidth={260} textScale={textScale} renderItem={card => <BangCardView card={card} fluid idPrefix="store" disabled={busy} status="Take this card" onPress={() => send('choose_store', { cardId: card.id }, 'Taking a store card')} />} /></Panel> : null}
      {priv.canChooseDraw && priv.drawChoice ? <Panel nativeID="bang-current-choice" onLayout={decisionLayout} title={`${character.name}: choose your draw`} urgent>
        {priv.drawChoice.kind === 'kit_carlson' ? <><Text style={styles.body}>Select two cards to keep. The remaining card goes back on top of the deck.</Text><CardGrid items={priv.drawChoice.options ?? []} keyExtractor={card => card.id} minCardWidth={200} maxCardWidth={260} textScale={textScale} renderItem={card => <BangCardView card={card} fluid idPrefix="draw" selected={picks.includes(card.id)} disabled={busy} onPress={() => setPicks(toggle(picks, card.id, 2))} />} /><Button label={`KEEP SELECTED (${picks.length}/2)`} disabled={busy || picks.length !== 2} onPress={() => send('choose_draw', { cardIds: picks }, 'Keeping two cards')} /></>
          : <><Text style={styles.body}>{priv.drawChoice.kind === 'jesse_jones' ? 'Take your first card randomly from another hand, then draw one from the deck. Or draw both from the deck.' : 'Take the top discard and one card from the deck. Or draw both from the deck.'}</Text>
            {priv.drawChoice.kind === 'jesse_jones' ? game.players.filter((player) => player.playerId !== me && player.alive && player.handCount > 0).map((player) => <Button key={player.playerId} label={`TAKE FROM ${player.displayName}`} quiet disabled={busy} onPress={() => send('choose_draw', { useAbility: true, targetPlayerId: player.playerId }, 'Taking a random card')} />)
              : <Button label={`TAKE ${game.discardTop ? name(game.discardTop) : 'TOP DISCARD'}`} quiet disabled={busy || !game.discardTop} onPress={() => send('choose_draw', { useAbility: true }, 'Taking the discard')} />}
            <Button label="DRAW TWO FROM DECK" disabled={busy} onPress={() => send('choose_draw', { useAbility: false }, 'Drawing two cards')} /></>}
      </Panel> : null}
      {priv.canRespond && game.pending ? <Panel nativeID="bang-current-choice" onLayout={decisionLayout} title={`Respond to ${game.pending.kind === 'bang' ? 'BANG!' : game.pending.kind.replace('_', ' ')}`} urgent>
        <Text style={styles.body}>From {game.players.find((player) => player.playerId === opponentId)?.displayName}. {game.pending.response === 'missed' ? `${game.pending.missesRequired - game.pending.missesPlayed} successful defence(s) still needed.` : 'Discard a BANG! to continue, or lose 1 life.'}</Text>
        {priv.barrelOptions.map((source) => <Button key={source} label={`TRY ${source.toUpperCase()}`} quiet disabled={busy} onPress={() => send('use_barrel', { source }, `Trying ${source}`)} />)}
        <Text style={styles.body}>{priv.responseCardIds.length ? 'Choose a response card from your hand below.' : 'You have no card that can answer this attack.'}</Text>
        <Button label="TAKE THE HIT" danger quiet disabled={busy} onPress={() => send('respond', {}, 'Accepting the hit')} />
      </Panel> : null}
      {priv.canRescue && game.rescue ? <Panel nativeID="bang-current-choice" onLayout={decisionLayout} title={`Save yourself: recover ${game.rescue.livesNeeded} life`} urgent>
        <Text style={styles.body}>Use Beer from your hand{priv.canUseSid ? ' or Sid Ketchum’s ability' : ''} until you have at least 1 life. Each Beer restores 1 life.</Text>
        {!priv.rescueBeerCardIds.length ? <Text style={styles.body}>No usable Beer in your hand.</Text> : null}
        <Button label="ACCEPT ELIMINATION" danger quiet disabled={busy} onPress={() => send('rescue', {}, 'Accepting elimination')} />
      </Panel> : null}
      {priv.canChooseDiscardOrder ? <Panel nativeID="bang-current-choice" onLayout={decisionLayout} title="Order the discarded cards" urgent><Text style={styles.body}>Select every card in the order to discard it. The last selected card will be on top of the discard pile.</Text><CardGrid items={priv.discardOrderCards} keyExtractor={card => card.id} minCardWidth={200} maxCardWidth={260} textScale={textScale} renderItem={card => <BangCardView card={card} fluid idPrefix="order" selected={picks.includes(card.id)} selectionOrder={picks.indexOf(card.id) + 1} disabled={busy} onPress={() => setPicks(toggle(picks, card.id, priv.discardOrderCards.length))} />} /><Button label={`CONFIRM ORDER (${picks.length}/${priv.discardOrderCards.length})`} disabled={busy || picks.length !== priv.discardOrderCards.length} onPress={() => send('discard_order', { cardIds: picks }, 'Ordering the discard pile')} /></Panel> : null}
      {selected && option && !sidMode ? <Panel nativeID="bang-play-options" title={`Play ${BANG_CARD_DETAILS[option.effectiveName].name}`} urgent>
        <Text style={styles.body}>{BANG_CARD_DETAILS[option.effectiveName].effect}</Text>
        {target && targetPlayer ? <><Text style={styles.playerName}>Target: {targetPlayer.displayName}{targetId === me ? ' (you)' : ''}</Text>
          {target.hand ? <Button label={`RANDOM HAND CARD · ${targetPlayer.handCount}`} quiet disabled={busy} onPress={() => play(targetId!, 'hand')} /> : null}
          {target.equipmentCardIds.map((id) => { const card = targetPlayer.equipment.find((item) => item.id === id); return card ? <Button key={id} label={`IN PLAY: ${name(card)}`} quiet disabled={busy} onPress={() => play(targetId!, 'equipment', id)} /> : null; })}
          <Button label="BACK TO TARGETS" quiet onPress={() => setTargetId(null)} disabled={busy} /></>
          : option.targets.length ? <><Text style={styles.body}>Choose a legal target. Distances are measured from you.</Text>{option.targets.map((item) => { const player = game.players.find((person) => person.playerId === item.playerId)!; return <Button key={item.playerId} label={`TARGET ${player.displayName}${item.playerId === me ? ' (YOU)' : ` · DISTANCE ${player.distanceFromActive}`}`} quiet disabled={busy} onPress={() => option.effectiveName === 'panic' || option.effectiveName === 'cat_balou' ? setTargetId(item.playerId) : play(item.playerId)} />; })}</>
            : <Button label={`PLAY ${BANG_CARD_DETAILS[option.effectiveName].name.toUpperCase()}`} disabled={busy} onPress={() => play()} />}
        <Button label="CANCEL PLAY" quiet onPress={cancelPlay} disabled={busy} />
      </Panel> : null}
      <View nativeID="bang-hand" onLayout={event => { decisionAnchors.current.hand = event.nativeEvent.layout.y; updateDecisionY(); }} style={styles.hand}>
      {game.status !== 'game_over' && mine.alive ? <Panel nativeID={priv.canPlay || priv.canDiscard ? 'bang-current-choice' : undefined} onLayout={priv.canPlay || priv.canDiscard ? handDecisionLayout : undefined} title={sidMode ? 'Sid Ketchum: choose two cards to heal' : priv.canDiscard ? `Discard ${required} card${required === 1 ? '' : 's'} to end your turn` : `Your hand · ${priv.hand.length}`}>
        {priv.canDiscard ? <Text style={styles.body}>Your hand limit is your current life: {mine.health}. Select the cards to discard, in order. Last selected goes on top.</Text> : null}
        {!priv.hand.length ? <Text style={styles.body}>Your hand is empty.</Text> : null}
        <BangHand cards={priv.hand} textScale={textScale} renderCard={(card, onFocus, fluid) => {
          const enabled = sidMode || priv.canDiscard || priv.playOptions.some((item) => item.cardId === card.id) || priv.responseCardIds.includes(card.id) || priv.rescueBeerCardIds.includes(card.id);
          return <BangCardView key={card.id} card={card} onFocus={onFocus} fluid={fluid} selected={selectedId === card.id || picks.includes(card.id)} selectionOrder={priv.canDiscard ? picks.indexOf(card.id) + 1 : undefined} status={cardStatus(card)} disabled={busy || !enabled} onPress={() => {
            if (sidMode || priv.canDiscard) setPicks(toggle(picks, card.id, sidMode ? 2 : required));
            else if (priv.canRespond) send('respond', { cardId: card.id }, `Responding with ${name(card)}`);
            else if (priv.canRescue) send('rescue', { cardId: card.id }, 'Using Beer to survive');
            else { setSelectedId(card.id); setTargetId(null); }
          }} />;
        }} />
        {priv.canUseSid ? sidMode ? <><Button label={`HEAL WITH TWO CARDS (${picks.length}/2)`} disabled={busy || picks.length !== 2} onPress={() => send('sid_ketchum', { cardIds: picks }, 'Healing with Sid Ketchum')} /><Button label="CANCEL HEAL" quiet onPress={() => { setSidMode(false); setPicks([]); }} disabled={busy} /></> : <Button label="SID KETCHUM: DISCARD TWO TO HEAL" quiet disabled={busy} onPress={() => { setSidMode(true); setSelectedId(null); setPicks([]); }} /> : null}
        {priv.canDiscard ? <Button label={`DISCARD SELECTED (${picks.length}/${required})`} disabled={busy || picks.length !== required} onPress={() => send('discard', { cardIds: picks }, 'Discarding to your hand limit')} /> : priv.canPlay && !sidMode ? <Button label="END TURN" quiet disabled={busy} onPress={() => send('end_turn', {}, 'Ending your turn')} /> : null}
      </Panel> : null}
      </View>
      </View>
      </View>
      <View nativeID="bang-public-table" style={[styles.publicColumn, besideTable && game.status !== 'game_over' ? { flexBasis: 340, flexGrow: 1 } : { width: '100%' }]}>
      <Panel title="Around the table">
        <Text nativeID="bang-table-context" style={styles.body}>{game.status === 'game_over' ? 'Final table in clockwise seat order. All roles are revealed.' : showTurn ? `Clockwise seat order. Distance is from ${active.displayName}. Eliminated seats no longer add distance.` : 'Clockwise seat order. Eliminated seats no longer add distance.'}</Text>
        <View style={styles.seats}>{game.players.map((player, index) => <View key={player.playerId} nativeID={`bang-seat-${player.playerId}`} style={[styles.seat, showTurn && player.playerId === game.activePlayerId && player.alive && { borderColor: BANG.gold }]}>
          <Text style={styles.playerName}>{index + 1}. {player.displayName}{player.playerId === me ? ' (you)' : ''}</Text>
          <RoleBadge role={player.role} playerId={player.playerId} />
          {showTurn && player.alive && player.playerId === game.activePlayerId ? <Text style={styles.small}>TAKING TURN</Text> : null}
          <View style={styles.characterStation}><BangCharacterArtwork character={player.character} size={72} /><Text style={styles.playerName}>{BANG_CHARACTERS[player.character].name}</Text><Text style={styles.body}>{BANG_CHARACTERS[player.character].summary}</Text></View>
          <LifeTokens health={player.health} maximum={player.maxHealth} />
          <Text style={styles.body}>{player.forfeited ? 'Forfeited' : player.alive ? `${player.handCount} cards in hand` : 'Eliminated'}</Text>
          {player.alive ? <Text style={styles.small}>{showTurn ? `${player.playerId === game.activePlayerId ? 'Active seat' : `Distance ${player.distanceFromActive}`} · ` : ''}{room?.players.find((person) => person.playerId === player.playerId)?.isConnected ? 'Connected' : 'Reconnecting'}</Text> : null}
          <View style={styles.equipmentRack}>{player.equipment.length ? player.equipment.map(card => <View key={card.id} nativeID={`bang-equipment-${card.id}`} style={styles.equipmentSlot}><MaterialCommunityIcons accessible={false} importantForAccessibility="no" name={BANG_CARD_EMBLEM[card.name]} size={20} color={BANG.sand} /><View style={styles.equipmentLabel}><Text style={styles.playerName}>{name(card)}</Text><Text style={styles.small}>{card.rank} {card.suit}</Text></View></View>) : <Text style={styles.body}>No cards in play</Text>}</View>
        </View>)}</View>
      </Panel>
      <Panel title="Table log"><Text style={styles.small}>{game.drawCount} cards in deck · Top discard: {game.discardTop ? `${name(game.discardTop)} (${game.discardTop.rank} ${game.discardTop.suit})` : 'none'}</Text>{game.log.slice(-8).reverse().map((entry) => <Text key={entry.id} style={styles.body}>{entry.text}</Text>)}</Panel>
      </View>
      </View>
    </ScrollView>
    <BangReferenceSheet visible={rules} onClose={() => setRules(false)} />
  </SafeAreaView>;
}

const wrapText = Platform.OS === 'web' ? { overflowWrap: 'anywhere' as const } : {};
const styles = StyleSheet.create({
  header: { minHeight: 60, borderBottomWidth: 1, borderBottomColor: BANG.border, backgroundColor: BANG.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 6 },
  iconButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  brandGroup: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 8 },
  brand: { ...wrapText, minWidth: 0, fontFamily: 'Outfit_800ExtraBold', color: BANG.gold, fontSize: 21, lineHeight: 28 },
  turn: { ...wrapText, minWidth: 0, fontFamily: 'SpaceMono_400Regular', fontSize: 13, lineHeight: 20, color: BANG.sand },
  content: { width: '100%', maxWidth: 1360, alignSelf: 'center', padding: 12, gap: 16, paddingBottom: 48 },
  headline: { ...wrapText, fontFamily: 'Outfit_800ExtraBold', color: BANG.gold, fontSize: 28, lineHeight: 34 },
  sectionTitle: { ...wrapText, fontFamily: 'Outfit_800ExtraBold', color: BANG.gold, fontSize: 18, lineHeight: 24 },
  playerName: { ...wrapText, minWidth: 0, fontFamily: 'Outfit_800ExtraBold', color: BANG.text, fontSize: 16, lineHeight: 22 },
  body: { ...wrapText, fontFamily: 'Outfit_400Regular', color: BANG.text, fontSize: 16, lineHeight: 24 },
  small: { ...wrapText, fontFamily: 'Outfit_700Bold', color: BANG.sand, fontSize: 13, lineHeight: 20 },
  panel: { minWidth: 0, maxWidth: '100%', borderRadius: 14, borderWidth: 1, borderColor: BANG.border, backgroundColor: BANG.surface, padding: 12, gap: 12 },
  identity: { minWidth: 0, borderTopWidth: 1, borderBottomWidth: 1, borderColor: BANG.border, paddingVertical: 12, gap: 8 },
  playArea: { minWidth: 0, width: '100%', alignItems: 'flex-start', gap: 16 },
  primaryColumn: { minWidth: 0, maxWidth: '100%', flexShrink: 1, gap: 16 },
  publicColumn: { minWidth: 0, maxWidth: '100%', flexShrink: 1, gap: 16 },
  decisionArea: { minWidth: 0, gap: 16 },
  hand: { minWidth: 0 },
  results: { minWidth: 0, borderWidth: 1, borderColor: BANG.gold, borderRadius: 16, backgroundColor: BANG.surface, padding: 15, gap: 24, alignItems: 'flex-start' },
  resultSummary: { minWidth: 0, maxWidth: '100%', flexShrink: 1, gap: 12 },
  resultRoster: { minWidth: 0, maxWidth: '100%', flexShrink: 1 },
  resultIdentity: { flexBasis: 180, flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 8 },
  resultStatus: { ...wrapText, maxWidth: '100%', fontFamily: 'Outfit_700Bold', fontSize: 13, lineHeight: 20 },
  roleStation: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  badge: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: BANG.gold, backgroundColor: BANG.panel, borderBottomWidth: 3, alignItems: 'center', justifyContent: 'center' },
  badgeHidden: { borderColor: BANG.border, backgroundColor: BANG.bg },
  roleName: { ...wrapText, minWidth: 0, flexShrink: 1, fontFamily: 'Outfit_700Bold', color: BANG.sand, fontSize: 15, lineHeight: 22 },
  characterStation: { minWidth: 0, borderTopWidth: 1, borderTopColor: BANG.border, paddingTop: 8, gap: 8 },
  lifeStation: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  lifeRack: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flexShrink: 1 },
  lifeToken: { width: 28, height: 32, borderRadius: 8, borderWidth: 1, borderBottomWidth: 3, borderColor: BANG.muted, backgroundColor: BANG.sand, alignItems: 'center', justifyContent: 'center' },
  lifeEmpty: { backgroundColor: BANG.bg, borderColor: BANG.border },
  equipmentRack: { minWidth: 0, borderRadius: 10, backgroundColor: BANG.bg, padding: 8, gap: 8 },
  equipmentSlot: { minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  equipmentLabel: { minWidth: 0, flex: 1, gap: 2 },
  notice: { backgroundColor: BANG.surface, padding: 12, gap: 8, borderRadius: 12 },
  button: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12, justifyContent: 'center' },
  buttonText: { ...wrapText, fontFamily: 'Outfit_800ExtraBold', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  seats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  seat: { minWidth: 0, maxWidth: '100%', flexBasis: 260, flexGrow: 1, flexShrink: 1, borderWidth: 1, borderBottomWidth: 3, borderColor: BANG.border, padding: 12, borderRadius: 12, gap: 8, backgroundColor: BANG.panel },
  result: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BANG.border },
});
