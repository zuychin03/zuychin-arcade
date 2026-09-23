import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SkullKingDeckArtwork } from '../../components/skull-king/SkullKingCardArtwork';
import {
  AccessibilityInfo,
  BackHandler,
  Modal,
  Platform,
  ScrollView,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
  type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SkullKingCard } from '@zuychin-arcade/types';
import { SKULL_KING_MIN_PLAYERS } from '@zuychin-arcade/types';
import { getSocket } from '../../hooks/useSocket';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { useIntrinsicCardHeight } from '../../hooks/useIntrinsicCardHeight';
import { useWebBackGuard } from '../../hooks/useWebBackGuard';
import { useNativeLeaveGuard } from '../../hooks/useNativeLeaveGuard';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';
import { leaveRoom } from '../../lib/api';
import { showDialog, useDialogStore, type DialogConfig } from '../../lib/dialog';
import { clearAuthIfMatches } from '../../lib/storage';
import { useGameStore } from '../../store/useGameStore';
import { NeonButton } from '../../components/ui/NeonButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { GameRecovery } from '../../components/ui/GameRecovery';
import { SkullKingCardView } from '../../components/skull-king/SkullKingCard';
import { SkullKingMark } from '../../components/skull-king/SkullKingArtwork';
import { SkullKingReferenceSheet } from '../../components/skull-king/ReferenceSheet';
import { useSkullKingActions } from '../../components/skull-king/useSkullKingActions';
import { SkullKingScorecard } from '../../components/skull-king/Scorecard';
import { useSkullDecisionAttention } from '../../components/skull-king/useSkullDecisionAttention';
import { isSkullLeavePromptCurrent, skullKingPlayInstruction, skullKingForfeitStatus, skullKingNoWinnerCopy, skullKingRosterSummary, SKULL_LEAVE_MESSAGE } from '../../components/skull-king/decision';
import { SKULL_KING } from '../../constants/theme';


function SectionHeading({ children, detail }: { children: string; detail?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 7 }}>
      <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: SKULL_KING.gold, fontSize: 13, letterSpacing: 1.4 }}>{children}</Text>
      {detail ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: SKULL_KING.muted, fontSize: 13, lineHeight: 19 }}>{detail}</Text> : null}
    </View>
  );
}

export default function SkullKingGame() {
  const { width, fontScale = 1 } = useWindowDimensions();
  const textScale = Math.max(1, fontScale);
  const [playAreaWidth, setPlayAreaWidth] = useState(0);
  const decisionBesideTable = playAreaWidth >= 900 * textScale;
  const resultsWide = width >= 960 * textScale;
  const compact = width < 600;
  const narrow = width < 370;
  const reduceMotion = useReducedMotionPreference();
  const game = useGameStore((state) => state.skullKingPublic);
  const [trickWidth, setTrickWidth] = useState(0);
  const trickFaces = useIntrinsicCardHeight(game?.currentTrick.map(card => card.id) ?? [], `${trickWidth}:${width}:${textScale}`);
  const mine = useGameStore((state) => state.skullKingPrivate);
  const room = useGameStore((state) => state.room);
  const playerId = useGameStore((state) => state.playerId);
  const token = useGameStore((state) => state.token);
  const [rules, setRules] = useState(false);
  const [tigress, setTigress] = useState<SkullKingCard | null>(null);
  const actions = useSkullKingActions();
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const actionMessage = localMessage ?? actions.message;
  const connectionState: string = actions.connected ? 'connected' : 'reconnecting';
  const stateSynced = actions.synced;
  const dialogOpen = useDialogStore((state) => state.dialog !== null);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const mainScrollRef = useRef<ScrollView>(null);
  const decisionHeadingRef = useRef<Text>(null);
  const decisionZoneYRef = useRef(0);
  const leavingRef = useRef(false);
  const leaveNotifiedRef = useRef(false);
  const leavePromptOpenRef = useRef(false);
  const ownDialogRef = useRef<DialogConfig | null>(null);
  const leaveEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const latestGameRef = useRef(game);
  const lifecycleIdentity = useRef(token);
  const nativeBack = useRef<(() => void) | null>(null);
  const approveNavigation = useNativeLeaveGuard(token, () => {
    if (useGameStore.getState().token === token) nativeBack.current?.();
  });
  latestGameRef.current = game;

  useEffect(() => {
    if (!tigress) return;
    if (game?.status !== 'playing' || game.phase !== 'trick_play' || game.currentPlayerId !== playerId
      || !mine?.legalCardIds.includes(tigress.id) || !mine.hand.some((card) => card.id === tigress.id)) setTigress(null);
  }, [game?.status, game?.phase, game?.currentPlayerId, mine, playerId, tigress]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (ownDialogRef.current && useDialogStore.getState().dialog === ownDialogRef.current) useDialogStore.getState().hide();
    };
  }, []);

  useEffect(() => {
    leaveEpochRef.current += 1;
    if (ownDialogRef.current && useDialogStore.getState().dialog === ownDialogRef.current) useDialogStore.getState().hide();
    ownDialogRef.current = null;
    leavePromptOpenRef.current = false;
  }, [game?.status, room?.roomCode, token]);

  useLayoutEffect(() => {
    const previous = lifecycleIdentity.current;
    lifecycleIdentity.current = token;
    if (token === null || previous === token) return;
    leavingRef.current = false;
    leaveNotifiedRef.current = false;
    setIsLeaving(false);
    setCleanupPending(false);
    setLocalMessage(null);
    setRules(false);
    setTigress(null);
  }, [token]);

  const handleSessionCleared = useCallback(() => {
    if (!mountedRef.current || useGameStore.getState().token !== null) return;
    leavingRef.current = true;
    approveNavigation(() => router.replace('/'), () => mountedRef.current && useGameStore.getState().token === null, null);
  }, [approveNavigation]);

  useEffect(() => {
    if (token !== null || leavingRef.current || useGameStore.getState().token !== null) return;
    leavingRef.current = true;
    approveNavigation(() => router.replace('/'), () => mountedRef.current && useGameStore.getState().token === null);
  }, [token, approveNavigation]);

  const leave = useCallback(async (destination: '/' | '/skull-king' = '/') => {
    const ownsSession = () => mountedRef.current && useGameStore.getState().token === token
      && useGameStore.getState().room?.roomCode === room?.roomCode;
    if (leavingRef.current || !ownsSession()) return;
    leavingRef.current = true;
    setIsLeaving(true);
    if (!leaveNotifiedRef.current) {
      leaveNotifiedRef.current = true;
      try {
        if (room && token) await leaveRoom(room.roomCode, token);
      } catch (error) {
        if (ownsSession()) showDialog('Crew notification failed', `${error instanceof Error ? error.message : 'Unknown error'}. Your seat may remain reserved until reconnect grace expires.`);
      }
    }
    if (!ownsSession()) return;
    getSocket()?.disconnect();
    try {
      if (token) await clearAuthIfMatches(token);
    } catch (error) {
      if (ownsSession()) {
        leavingRef.current = false;
        setIsLeaving(false);
        setCleanupPending(true);
        setLocalMessage(`Your saved session could not be cleared. Retry leaving before joining another room. ${error instanceof Error ? error.message : ''}`);
      }
      return;
    }
    if (!ownsSession()) return;
    useGameStore.getState().clearAll();
    approveNavigation(() => router.replace(destination), () => mountedRef.current && useGameStore.getState().token === null, null);
  }, [room, token, approveNavigation]);

  const requestLeave = useCallback(() => {
    const ownsPrompt = () => mountedRef.current && useGameStore.getState().token === token
      && useGameStore.getState().room?.roomCode === room?.roomCode;
    if (!ownsPrompt()) return;
    if (leavingRef.current || leavePromptOpenRef.current) return;
    if (cleanupPending) { void leave(); return; }
    const captured = latestGameRef.current;
    if (!captured) return;
    const epoch = leaveEpochRef.current;
    leavePromptOpenRef.current = true;
    const voyageLive = captured.status === 'playing';
    showDialog(
      voyageLive ? 'Forfeit live voyage?' : 'Return to the arcade?',
      voyageLive ? SKULL_LEAVE_MESSAGE : 'This closes your captain seat and returns to the arcade.',
      [
        { text: 'STAY', style: 'cancel', onPress: () => { if (ownsPrompt() && epoch === leaveEpochRef.current) leavePromptOpenRef.current = false; } },
        { text: 'LEAVE', style: 'destructive', onPress: () => {
          if (!ownsPrompt()) return;
          if (!isSkullLeavePromptCurrent(captured, useGameStore.getState().skullKingPublic, epoch, leaveEpochRef.current)) return;
          leavePromptOpenRef.current = false;
          void leave();
        } },
      ],
    );
    ownDialogRef.current = useDialogStore.getState().dialog;
  }, [cleanupPending, leave, room?.roomCode, token]);

  const handleBack = useCallback(() => {
    if (!mountedRef.current || useGameStore.getState().token !== token
      || useGameStore.getState().room?.roomCode !== room?.roomCode) return;
    if (rules) {
      setRules(false);
      return;
    }
    if (tigress) {
      setTigress(null);
      return;
    }
    requestLeave();
  }, [requestLeave, room?.roomCode, rules, tigress, token]);

  useLayoutEffect(() => { nativeBack.current = handleBack; }, [handleBack]);
  useWebBackGuard('/skull-king/game', handleBack, token !== null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]);

  const gameOver = game?.status === 'game_over';
  useEffect(() => {
    if (!gameOver) return;
    setRules(false);
    setTigress(null);
  }, [gameOver]);
  useWebModalFocus(Boolean(tigress) && !dialogOpen, 'skull-king-tigress-choice', () => setTigress(null));
  useWebModalFocus(Boolean(gameOver) && !dialogOpen, 'skull-king-game-over', requestLeave);

  const me = game?.players.find((player) => player.playerId === playerId);
  const isHost = room?.players.find((player) => player.playerId === playerId)?.isHost ?? false;
  const myTurn = game?.currentPlayerId === playerId;
  const currentPlayerName = game?.players.find((player) => player.playerId === game.currentPlayerId)?.displayName ?? 'The next captain';
  const activeSeats = room?.players.filter((player) => !player.hasLeft) ?? [];
  const connectedRematchPlayers = activeSeats.filter((player) => player.isConnected).length;
  const newCaptainsNeeded = Math.max(0, SKULL_KING_MIN_PLAYERS - activeSeats.length);
  const rematchNeedsNewCrew = newCaptainsNeeded > 0;
  const rematchReady = connectedRematchPlayers >= SKULL_KING_MIN_PLAYERS && connectedRematchPlayers === activeSeats.length;
  const busy = actions.busy || isLeaving || cleanupPending;
  const winner = game?.players.find((player) => game.winnerIds.includes(player.playerId));
  const noWinnerCopy = skullKingNoWinnerCopy(game?.terminationReason ?? null);

  const localDecisionKey = game && mine && !me?.forfeited
    ? game.phase === 'bidding' && mine.submittedBid === null
      ? `bid:${game.roundNumber}`
      : game.phase === 'trick_play' && myTurn
        ? `play:${game.roundNumber}:${game.trickNumber}:${mine.hand.map((card) => card.id).join(',')}`
        : null
    : null;

  const focusDecision = useCallback(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const heading = document.getElementById('skull-king-decision-heading');
      if (!heading) return false;
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    } else {
      const handle = findNodeHandle(decisionHeadingRef.current);
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }
    mainScrollRef.current?.scrollTo({ y: Math.max(0, decisionZoneYRef.current - 8), animated: !reduceMotion });
    return true;
  }, [reduceMotion]);
  useSkullDecisionAttention(localDecisionKey, Boolean(tigress || rules || gameOver || dialogOpen || busy), focusDecision);

  const decisionAnnouncement = useMemo(() => {
    if (!game || !mine) return 'Restoring the captain table.';
    if (connectionState === 'error') return 'Connection failed. Decisions are paused.';
    if (connectionState === 'reconnecting' || !stateSynced) return 'Reconnecting. Decisions are paused while the table refreshes.';
    if (actionMessage) return actionMessage;
    if (game.status === 'game_over') return winner ? `${winner.displayName} wins with ${winner.totalScore} points.` : `${noWinnerCopy.summary} ${noWinnerCopy.detail}`.trim();
    if (me?.forfeited) return skullKingForfeitStatus(game, me)?.detail ?? 'This seat has forfeited.';
    if (game.phase === 'bidding') {
      return mine.submittedBid === null
        ? `Choose your secret bid for round ${game.roundNumber}.`
        : `Bid ${mine.submittedBid} locked. Waiting for the crew.`;
    }
    return myTurn ? 'Your turn. Play a legal card.' : `Waiting for ${currentPlayerName} to play.`;
  }, [actionMessage, connectionState, currentPlayerName, game, me, mine, myTurn, noWinnerCopy.detail, noWinnerCopy.summary, stateSynced, winner]);

  const sendAction = (
    _event: string,
    label: string,
    payload: Record<string, unknown>,
    confirmation: { kind: 'bid'; bid: number } | { kind: 'play'; cardId: string },
  ) => {
    if (!game || busy) return false;
    return actions.send(confirmation.kind, payload, label, game.revision);
  };

  const play = (card: SkullKingCard) => {
    if (card.kind === 'tigress') {
      if (!busy) setTigress(card);
      return;
    }
    sendAction(
      'skull_king:play',
      `Play ${card.kind === 'number' ? `${card.suit} ${card.rank}` : card.kind.replace('_', ' ')}`,
      { cardId: card.id },
      { kind: 'play', cardId: card.id },
    );
  };

  const rematch = () => {
    if (game && !busy && rematchReady) actions.send('start', {}, 'Start rematch', game.revision);
  };

  if (!game || !mine || !playerId || !me) {
    return <GameRecovery onSessionCleared={handleSessionCleared} message="Restoring the captain's table…" background={SKULL_KING.bg} surface={SKULL_KING.surface} border={SKULL_KING.border} accent={SKULL_KING.teal} muted={SKULL_KING.muted} icon="pirate" />;
  }

  const phaseLabel = game.phase === 'bidding'
    ? 'SECRET BIDDING'
    : game.phase === 'trick_play'
      ? `TRICK ${game.trickNumber} · ${game.cardsPerPlayer} ${game.cardsPerPlayer === 1 ? 'CARD' : 'CARDS'} THIS ROUND`
      : 'VOYAGE COMPLETE';
  const decisionTitle = game.phase === 'bidding'
    ? mine.submittedBid === null ? 'CHOOSE YOUR SECRET BID' : `BID ${mine.submittedBid} LOCKED`
    : myTurn ? 'YOUR TURN · PLAY A CARD' : `WAITING FOR ${currentPlayerName.toUpperCase()}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: SKULL_KING.bg }} edges={['top', 'right', 'bottom', 'left']}>
      <Text accessible accessibilityLiveRegion={connectionState === 'error' ? 'assertive' : 'polite'} style={{ position: 'absolute', left: -10_000, width: 1, height: 1, overflow: 'hidden' }}>{decisionAnnouncement}</Text>
      <ScrollView
        ref={mainScrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ width: '100%', maxWidth: 1240, alignSelf: 'center', paddingHorizontal: narrow ? 10 : compact ? 14 : 20, paddingTop: 10, gap: 16, paddingBottom: 44 }}
        showsVerticalScrollIndicator={false}
      >
        <View nativeID="skull-toolbar" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8 }}>
          <ScalePressable accessibilityLabel="Back to arcade" accessibilityHint="Opens a confirmation before leaving this voyage" disabled={isLeaving} onPress={requestLeave} style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: SKULL_KING.border, backgroundColor: SKULL_KING.surface, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={SKULL_KING.teal} />
          </ScalePressable>
          <View style={{ flexBasis: 240, flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 16, borderWidth: 1, borderColor: SKULL_KING.border, backgroundColor: SKULL_KING.surface, paddingHorizontal: 10, paddingVertical: 8 }}>
            <SkullKingMark size={38} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: SKULL_KING.teal, fontSize: compact ? 15 : 17, letterSpacing: compact ? 1.2 : 2 }}>{game.roundNumber > 10 ? `TIEBREAKER ${game.roundNumber - 10}` : `ROUND ${game.roundNumber} / 10`}</Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: SKULL_KING.muted, fontSize: 12, lineHeight: 18 }}>{phaseLabel}</Text>
            </View>
            <ScalePressable accessibilityLabel="Open rules" accessibilityHint="Opens the Digital Base Voyage rules" onPress={() => setRules(true)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="book-open-variant" size={22} color={SKULL_KING.gold} />
            </ScalePressable>
          </View>
        </View>

        {connectionState !== 'connected' ? (
          <View accessible accessibilityLabel="Connection status" style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: `${SKULL_KING.coral}77`, backgroundColor: `${SKULL_KING.coral}12`, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="connection" size={17} color={SKULL_KING.coral} />
            <Text style={{ flex: 1, fontFamily: 'SpaceMono_700Bold', color: SKULL_KING.coral, fontSize: 14, lineHeight: 21 }}>{connectionState === 'error' ? 'Could not reconnect. Check your network.' : 'Reconnecting. Decisions are paused until the table refreshes…'}</Text>
          </View>
        ) : null}
        {connectionState === 'connected' && (!stateSynced || actionMessage) ? (
          <View style={{ minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: SKULL_KING.border, backgroundColor: SKULL_KING.surface, paddingHorizontal: 11, justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'SpaceMono_700Bold', color: SKULL_KING.gold, fontSize: 14, lineHeight: 21 }}>{!stateSynced ? actionMessage ?? 'Refreshing the table…' : actionMessage}</Text>
          </View>
        ) : null}

        <View
          nativeID="skull-play-area"
          onLayout={(event) => { decisionZoneYRef.current = event.nativeEvent.layout.y; setPlayAreaWidth(event.nativeEvent.layout.width); }}
          style={{ flexDirection: decisionBesideTable ? 'row' : 'column', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20 }}
        >
        <View
          nativeID="skull-decision-area"
          style={{ width: decisionBesideTable ? undefined : '100%', flexBasis: decisionBesideTable ? 460 : undefined, flexGrow: 1.3, flexShrink: 1, minWidth: 0, maxWidth: '100%', borderRadius: 18, borderWidth: myTurn || game.phase === 'bidding' ? 2 : 1, borderColor: myTurn || game.phase === 'bidding' ? SKULL_KING.teal : SKULL_KING.border, backgroundColor: SKULL_KING.surface, padding: narrow ? 11 : 15, gap: 14, boxShadow: '0 4px 0 #04060B, 0 7px 16px rgba(0,0,0,0.2)' }}
        >
          <Text
            ref={decisionHeadingRef}
            nativeID="skull-king-decision-heading"
            accessible
            accessibilityRole="header"
            style={{ fontFamily: 'Outfit_800ExtraBold', color: myTurn || game.phase === 'bidding' ? SKULL_KING.teal : SKULL_KING.text, fontSize: 16, lineHeight: 21, textAlign: 'center' }}
          >
            {decisionTitle}
          </Text>
          {game.phase === 'bidding' ? (
            <Text style={{ fontFamily: 'Outfit_400Regular', color: SKULL_KING.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' }}>
              {mine.submittedBid === null ? 'Inspect your whole hand first, then predict how many tricks you will win. Your bid stays hidden until everyone commits.' : 'Your bid remains private while the rest of the crew chooses.'}
            </Text>
          ) : (
            <Text style={{ fontFamily: 'Outfit_400Regular', color: SKULL_KING.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' }}>
              {myTurn ? skullKingPlayInstruction(game.currentTrick, mine.hand) : `${currentPlayerName} is choosing a card. You can inspect your hand while you wait.`}
            </Text>
          )}
          <View>
            <SectionHeading detail={`${mine.hand.length} ${mine.hand.length === 1 ? 'card' : 'cards'}`}>YOUR HAND</SectionHeading>
            <ScrollView nativeID="skull-hand" horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 12, paddingTop: 14, paddingBottom: 16, paddingHorizontal: 2 }}>
              {mine.hand.map((card) => {
                const canChooseCard = game.phase === 'trick_play' && myTurn && !me.forfeited;
                const legal = canChooseCard && mine.legalCardIds.includes(card.id);
                return <SkullKingCardView key={card.id} card={card} compact={compact} disabled={canChooseCard && (busy || !legal)} onPress={canChooseCard ? () => play(card) : undefined} />;
              })}
            </ScrollView>
          </View>
          {game.phase === 'bidding' && mine.submittedBid === null && !me.forfeited ? (
            <View nativeID="skull-bid-counters" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, paddingBottom: 4 }}>
              {Array.from({ length: game.cardsPerPlayer + 1 }, (_, bid) => (
                <ScalePressable
                  key={bid}
                  accessibilityLabel={`Bid ${bid} ${bid === 1 ? 'trick' : 'tricks'}`}
                  accessibilityHint="Locks this secret bid for the round"
                  disabled={busy}
                  onPress={() => sendAction('skull_king:bid', `Bid ${bid}`, { bid }, { kind: 'bid', bid })}
                  style={{ minWidth: 48, minHeight: 48, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1.5, borderColor: SKULL_KING.teal, borderTopColor: '#FFFFFF', backgroundColor: '#252E3F', boxShadow: '0 3px 0 #05070B, 0 4px 5px rgba(0,0,0,0.28)', alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}
                >
                  <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: SKULL_KING.teal, fontSize: 20 }}>{bid}</Text>
                </ScalePressable>
              ))}
            </View>
          ) : null}
        </View>

        <View nativeID="skull-public-table" style={{ width: decisionBesideTable ? undefined : '100%', flexBasis: decisionBesideTable ? 340 : undefined, flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: '100%', gap: 16 }}>
        <View nativeID="skull-current-trick" style={{ minHeight: 170, borderRadius: 18, borderWidth: 1, borderTopWidth: 3, borderColor: SKULL_KING.border, borderTopColor: '#05070C', backgroundColor: '#0C121E', padding: narrow ? 10 : 14, paddingBottom: 20, gap: 14 }}>
          <SectionHeading>{game.currentTrick.length ? `CURRENT TRICK · ${game.currentTrick.length}/${game.turnOrder.length}` : 'CURRENT TRICK'}</SectionHeading>
          {game.currentTrick.length ? (
            <View onLayout={event => setTrickWidth(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14 }}>
              {game.currentTrick.map((card) => (
                <View key={card.playerId} style={{ flexBasis: 120 * textScale, flexGrow: 1, flexShrink: 1, minWidth: Platform.OS === 'web' ? 'min-content' as unknown as number : 0, maxWidth: '100%', alignItems: 'center', gap: 10 }}>
                  <SkullKingCardView card={card} compact faceSizing={trickFaces.forCard(card.id)} />
                  <Text nativeID={`skull-trick-owner-${card.playerId}`} style={{ width: '100%', minWidth: 0, color: SKULL_KING.muted, fontFamily: 'Outfit_700Bold', fontSize: 14, lineHeight: 20, textAlign: 'center', ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere' } as unknown as TextStyle : {}) }}>{game.players.find((player) => player.playerId === card.playerId)?.displayName}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={{ flex: 1, minHeight: 105, alignItems: 'center', justifyContent: 'center' }}>
              <View accessible={false} style={{ padding: 14, borderRadius: 18, borderWidth: 1, borderColor: SKULL_KING.border, borderTopWidth: 3, borderTopColor: '#05070C', backgroundColor: '#111B2A' }}><MaterialCommunityIcons name="cards-playing-outline" size={38} color={SKULL_KING.muted} /></View>
              <Text style={{ color: SKULL_KING.muted, fontFamily: 'SpaceMono_400Regular', fontSize: 14, lineHeight: 21, marginTop: 6, textAlign: 'center' }}>{game.phase === 'trick_play' ? `${currentPlayerName} leads` : 'Cards appear here after bidding'}</Text>
            </View>
          )}
        </View>


        <View nativeID="skull-scoreboard" style={{ borderRadius: 18, borderWidth: 1, borderColor: SKULL_KING.border, backgroundColor: SKULL_KING.surface, padding: narrow ? 10 : 13 }}>
          <SectionHeading detail={skullKingRosterSummary(game)}>SCOREBOARD</SectionHeading>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
            {game.players.map((player) => {
              const active = player.playerId === game.currentPlayerId;
              const presence = room?.players.find((candidate) => candidate.playerId === player.playerId);
              const forfeitStatus = skullKingForfeitStatus(game, player);
              const status = forfeitStatus?.label ?? (presence && !presence.isConnected ? 'RECONNECTING' : active ? 'PLAYING' : player.playerId === game.dealerId ? 'DEALER' : 'READY');
              return (
                <View
                  key={player.playerId}
                  accessible
                  accessibilityLabel={`${player.displayName}. ${status}. ${player.totalScore} ${player.forfeited ? 'historical' : ''} points. ${player.forfeited ? 'No further scoring. Previous completed rounds remain in the scorecard.' : player.exactLastRound === null ? 'No completed-round score yet.' : `Last round ${player.roundScore >= 0 ? '+' : ''}${player.roundScore}, ${player.exactLastRound ? 'exact' : 'missed'} bid.`} ${forfeitStatus?.detail ?? (game.bidsRevealed ? `${player.tricksWon} of ${player.bid} tricks` : player.bidSubmitted ? 'Bid locked' : 'Choosing bid')}. ${player.cardCount} cards.`}
                  style={{ minWidth: 0, maxWidth: '100%', flexBasis: (compact ? 142 : 170) * textScale, flexGrow: 1, flexShrink: 1, borderRadius: 14, borderWidth: active ? 2 : 1, borderColor: player.forfeited ? SKULL_KING.coral : active ? SKULL_KING.teal : SKULL_KING.border, backgroundColor: SKULL_KING.panel, padding: 12, boxShadow: '0 3px 0 #05070C' }}
                >
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ flexBasis: 90, flexGrow: 1, flexShrink: 1, minWidth: 0, fontFamily: 'Outfit_800ExtraBold', color: player.playerId === playerId ? SKULL_KING.gold : active ? SKULL_KING.teal : SKULL_KING.text, fontSize: 16 }}>{player.displayName}</Text>
                    <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: SKULL_KING.teal, fontSize: 24 }}>{player.totalScore}</Text>
                  </View>
                  <Text style={{ fontFamily: 'SpaceMono_700Bold', color: player.forfeited ? SKULL_KING.coral : active ? SKULL_KING.teal : SKULL_KING.muted, fontSize: 12, lineHeight: 18, marginTop: 3 }}>{status}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    {player.cardCount > 0 ? <View style={{ width: 24, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}><SkullKingDeckArtwork /></View> : null}
                    <Text style={{ flex: 1, minWidth: 0, fontFamily: 'SpaceMono_400Regular', color: SKULL_KING.muted, fontSize: 12, lineHeight: 18 }}>{player.forfeited ? 'NO SCORE · CANNOT WIN' : game.bidsRevealed ? `${player.tricksWon} / ${player.bid} TRICKS` : player.bidSubmitted ? 'BID LOCKED' : 'CHOOSING BID…'} · {player.cardCount} {player.cardCount === 1 ? 'CARD' : 'CARDS'}</Text>
                  </View>
                  {player.exactLastRound !== null ? <Text style={{ fontFamily: 'SpaceMono_700Bold', color: player.exactLastRound ? SKULL_KING.teal : SKULL_KING.coral, fontSize: 12, lineHeight: 18, marginTop: 2 }}>LAST {player.roundScore >= 0 ? '+' : ''}{player.roundScore} · {player.exactLastRound ? 'EXACT' : 'MISSED'}</Text> : null}
                </View>
              );
            })}
          </View>
        </View>
        </View>
        </View>
        {game.lastTrick ? (
          <View accessible accessibilityLabel={`${game.lastTrick.winnerName} won trick ${game.lastTrick.trickNumber}. ${game.lastTrick.reason}`} style={{ borderRadius: 12, borderWidth: 1, borderColor: `${SKULL_KING.gold}66`, backgroundColor: `${SKULL_KING.gold}0D`, padding: 12 }}>
            <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', color: SKULL_KING.gold, fontSize: 13 }}>{game.lastTrick.winnerName} won trick {game.lastTrick.trickNumber}</Text>
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: SKULL_KING.muted, fontSize: 14, lineHeight: 21, marginTop: 3 }}>{game.lastTrick.reason}{game.lastTrick.bonus ? ` · ${game.lastTrick.bonus} bonus banked if the bid is exact` : ''}</Text>
          </View>
        ) : null}

        <SkullKingScorecard history={game.scoreHistory ?? []} />

        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: SKULL_KING.border, backgroundColor: SKULL_KING.surface, padding: 13 }}>
          <SectionHeading>CAPTAIN'S LOG</SectionHeading>
          {game.log.slice(-7).map((entry) => <Text key={entry.id} style={{ fontFamily: 'SpaceMono_400Regular', color: SKULL_KING.muted, fontSize: 14, lineHeight: 21, marginTop: 5 }}>{entry.text}</Text>)}
        </View>
      </ScrollView>

      <Modal visible={Boolean(tigress)} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setTigress(null)}>
        <View style={{ flex: 1, backgroundColor: '#000000CC', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <ScrollView style={{ width: '100%', maxWidth: 440, maxHeight: '100%' }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}><View nativeID="skull-king-tigress-choice" accessibilityLabel="Choose how the Tigress plays dialog" accessibilityViewIsModal role="dialog" aria-modal style={{ width: '100%', maxWidth: 440, borderRadius: 18, borderWidth: 2, borderColor: SKULL_KING.coral, backgroundColor: SKULL_KING.panel, padding: 18, gap: 10 }}>
            <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: SKULL_KING.coral, fontSize: 18, textAlign: 'center' }}>HOW WILL THE TIGRESS PLAY?</Text>
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: SKULL_KING.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>Pirate can win the trick. Escape normally loses it. This choice cannot change after play.</Text>
            <NeonButton label="PLAY AS PIRATE" color={SKULL_KING.coral} disabled={busy} onPress={() => {
              if (!tigress) return;
              sendAction('skull_king:play', 'Play Tigress as Pirate', { cardId: tigress.id, tigressMode: 'pirate' }, { kind: 'play', cardId: tigress.id });
              setTigress(null);
            }} />
            <NeonButton label="PLAY AS ESCAPE" color={SKULL_KING.muted} variant="outline" disabled={busy} onPress={() => {
              if (!tigress) return;
              sendAction('skull_king:play', 'Play Tigress as Escape', { cardId: tigress.id, tigressMode: 'escape' }, { kind: 'play', cardId: tigress.id });
              setTigress(null);
            }} />
            <NeonButton label="CANCEL TIGRESS CHOICE" color={SKULL_KING.muted} variant="ghost" onPress={() => setTigress(null)} />
          </View></ScrollView>
        </View>
      </Modal>

      <Modal visible={gameOver} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={requestLeave}>
        <View style={{ flex: 1, backgroundColor: '#000000DD', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', width: '100%' }} style={{ width: '100%', maxWidth: 1040 }}>
            <View nativeID="skull-king-game-over" accessibilityLabel={`${winner ? `Voyage complete. ${winner.displayName} wins` : noWinnerCopy.summary} dialog`} accessibilityViewIsModal role="dialog" aria-modal style={{ borderRadius: 20, borderWidth: 2, borderColor: SKULL_KING.gold, backgroundColor: SKULL_KING.panel, padding: compact ? 18 : 24, gap: 20, alignItems: 'stretch' }}>
              <View style={{ flexDirection: resultsWide ? 'row' : 'column', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24 }}>
              <View nativeID="skull-result-summary" style={{ width: resultsWide ? undefined : '100%', flexBasis: resultsWide ? 360 : undefined, flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: '100%', gap: 16 }}>
                <View style={{ alignItems: 'center', gap: 10 }}>
                  <View accessible={false} style={{ padding: 12, borderRadius: 24, borderWidth: 1, borderColor: `${SKULL_KING.gold}77`, borderTopColor: SKULL_KING.gold, backgroundColor: '#252230', boxShadow: '0 4px 0 #090C13, 0 7px 12px rgba(0,0,0,0.24)' }}><SkullKingMark size={76} color={SKULL_KING.gold} /></View>
                  <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: SKULL_KING.gold, fontSize: 28, textAlign: 'center' }}>{winner ? `${winner.displayName} WINS` : noWinnerCopy.title}</Text>
                  <Text style={{ color: SKULL_KING.muted, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, textAlign: 'center' }}>{winner ? `${winner.totalScore} points after ${game.roundNumber} rounds` : noWinnerCopy.summary}</Text>
                  {!winner && noWinnerCopy.detail ? <Text style={{ color: SKULL_KING.muted, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, textAlign: 'center' }}>{noWinnerCopy.detail}</Text> : null}
                </View>
              <View nativeID="skull-result-actions" style={{ width: '100%', minWidth: 0, gap: 12 }}>
              {connectionState !== 'connected' || actionMessage ? (
                <View style={{ minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: connectionState === 'error' ? `${SKULL_KING.coral}77` : SKULL_KING.border, backgroundColor: SKULL_KING.surface, padding: 10, justifyContent: 'center' }}>
                  <Text style={{ fontFamily: 'SpaceMono_700Bold', color: connectionState === 'error' ? SKULL_KING.coral : SKULL_KING.gold, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>{connectionState === 'error' ? 'Could not reconnect. Check your network.' : actionMessage ?? 'Reconnecting to the table…'}</Text>
                </View>
              ) : null}
              {rematchNeedsNewCrew ? (
                <View
                  accessible
                  accessibilityLabel={`Rematch unavailable. Need ${newCaptainsNeeded} new ${newCaptainsNeeded === 1 ? 'captain' : 'captains'}. Finished rooms cannot accept replacement captains. Start a new room.`}
                  style={{ borderRadius: 12, borderWidth: 1, borderColor: `${SKULL_KING.coral}88`, backgroundColor: `${SKULL_KING.coral}0D`, padding: 11, gap: 8 }}
                >
                  <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: SKULL_KING.coral, fontSize: 13, textAlign: 'center' }}>REMATCH UNAVAILABLE · NEED {newCaptainsNeeded} NEW {newCaptainsNeeded === 1 ? 'CAPTAIN' : 'CAPTAINS'}</Text>
                  <Text style={{ fontFamily: 'SpaceMono_400Regular', color: SKULL_KING.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>Finished rooms cannot accept replacement captains. {isHost ? 'Start a new room to assemble another crew.' : 'Ask the host to start a new room.'}</Text>
                  {isHost ? <NeonButton label={isLeaving ? 'LEAVING…' : 'START A NEW ROOM'} color={SKULL_KING.teal} disabled={isLeaving} accessibilityHint="Closes this finished room and opens Skull King room creation" onPress={() => { void leave('/skull-king'); }} /> : null}
                </View>
              ) : isHost ? (
                <NeonButton
                  label={actions.pending ? 'STARTING REMATCH…' : !rematchReady ? `WAITING FOR ${activeSeats.length - connectedRematchPlayers} TO RECONNECT` : 'PLAY AGAIN'}
                  color={SKULL_KING.teal}
                  disabled={busy || !rematchReady}
                  accessibilityHint="Starts a new ten-round voyage with the connected crew"
                  onPress={rematch}
                />
              ) : <Text style={{ fontFamily: 'SpaceMono_400Regular', color: SKULL_KING.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>Waiting for the host to offer a rematch.</Text>}
              <NeonButton label={isLeaving ? 'LEAVING…' : 'BACK TO ARCADE'} color={SKULL_KING.gold} variant="outline" disabled={isLeaving} onPress={requestLeave} />
              </View>
              </View>
              <View nativeID="skull-result-roster" style={{ width: resultsWide ? undefined : '100%', flexBasis: resultsWide ? 360 : undefined, flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: '100%', gap: 12 }}>
                <SectionHeading>{winner ? 'FINAL STANDINGS' : 'VOYAGE RECORD'}</SectionHeading>
                {game.players.some((player) => player.forfeited) ? <Text style={{ fontFamily: 'Outfit_400Regular', color: SKULL_KING.muted, fontSize: 16, lineHeight: 24 }}>{winner ? 'Eligible captains rank first. Forfeited seats follow with historical scores only; they cannot win.' : 'Scores below are historical, not a winning result. Forfeited seats cannot win.'}</Text> : null}
                {[...game.players].sort((a, b) => Number(a.forfeited) - Number(b.forfeited) || b.totalScore - a.totalScore).map((player, index) => (
                  <View key={player.playerId} accessible accessibilityLabel={`${index + 1}. ${player.displayName}, ${player.forfeited ? 'forfeited with a historical score of' : ''} ${player.totalScore} points`} style={{ minWidth: 0, maxWidth: '100%', borderRadius: 12, borderWidth: 1, borderColor: player.forfeited ? SKULL_KING.coral : player.playerId === winner?.playerId ? SKULL_KING.gold : SKULL_KING.border, backgroundColor: SKULL_KING.surface, padding: 14, gap: 6, boxShadow: '0 3px 0 #05070C' }}>
                    <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: player.forfeited ? SKULL_KING.coral : player.playerId === winner?.playerId ? SKULL_KING.gold : SKULL_KING.text, fontSize: 18 }}>{index + 1}. {player.displayName}</Text>
                    <Text style={{ fontFamily: 'SpaceMono_700Bold', color: player.forfeited ? SKULL_KING.coral : SKULL_KING.teal, fontSize: 14, lineHeight: 21 }}>{player.forfeited ? `FORFEITED · ${player.totalScore} HISTORICAL` : `${player.totalScore} POINTS`}</Text>
                  </View>
                ))}
              </View>
              </View>
              <SkullKingScorecard history={game.scoreHistory ?? []} />
            </View>
          </ScrollView>
        </View>
      </Modal>

      <SkullKingReferenceSheet visible={rules} onClose={() => setRules(false)} />
    </SafeAreaView>
  );
}
