import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Modal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CoupActionKind, CoupActionType, CoupCharacter } from '@zuychin-arcade/types';
import { ACTION_META, charactersForVariant, canTargetCoupPlayer } from '@zuychin-arcade/types';
import { useGameStore } from '../../store/useGameStore';
import { getSocket } from '../../hooks/useSocket';
import { useWebBackGuard } from '../../hooks/useWebBackGuard';
import { useNativeLeaveGuard } from '../../hooks/useNativeLeaveGuard';
import { clearAuthIfMatches } from '../../lib/storage';
import { leaveRoom } from '../../lib/api';
import { showDialog, useDialogStore, type DialogConfig } from '../../lib/dialog';
import { useCoupActions } from '../../components/coup/useCoupActions';
import { restoreCoupActionFocus } from '../../components/coup/focus';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';
import { PlayerSeat } from '../../components/coup/PlayerSeat';
import { CharacterCard } from '../../components/coup/CharacterCard';
import { CardGrid } from '../../components/ui/CardGrid';
import { GameLog } from '../../components/coup/GameLog';
import { Countdown } from '../../components/coup/Countdown';
import { ReferenceSheet, ReferencePanel } from '../../components/coup/ReferenceSheet';
import { NeonButton } from '../../components/ui/NeonButton';
import { GameRecovery } from '../../components/ui/GameRecovery';
import { Coin } from '../../components/ui/Coin';
import { COUP, OVERLAY_FILL, neonText } from '../../constants/theme';

const ACTION_LABELS: Record<CoupActionType, { label: string; hint: string }> = {
  income: { label: 'Income', hint: '+1 coin' },
  foreign_aid: { label: 'Foreign Aid', hint: '+2 coins (Duke blocks)' },
  tax: { label: 'Tax', hint: 'Duke · +3 coins' },
  steal: { label: 'Steal', hint: 'Captain · take up to 2 coins' },
  exchange: { label: 'Exchange', hint: 'Ambassador · draw 2, keep your influence count' },
  assassinate: { label: 'Assassinate', hint: 'Assassin · pay 3' },
  coup: { label: 'Coup', hint: 'pay 7 · target loses 1 influence' },
  convert: { label: 'Convert', hint: 'pay 1 (self) / 2 (other)' },
  embezzle: { label: 'Embezzle', hint: 'no Duke · take Reserve' },
  inquisitor_exchange: { label: 'Exchange', hint: 'Inquisitor · swap 1' },
  inquisitor_examine: { label: 'Examine', hint: 'Inquisitor · inspect card' },
};

const ACTION_ICONS: Record<CoupActionType, keyof typeof MaterialCommunityIcons.glyphMap> = {
  income: 'cash-multiple',
  foreign_aid: 'bank-transfer-in',
  tax: 'crown',
  steal: 'anchor',
  exchange: 'handshake',
  assassinate: 'sword',
  coup: 'flash-alert',
  convert: 'swap-horizontal',
  embezzle: 'bank-minus',
  inquisitor_exchange: 'handshake',
  inquisitor_examine: 'magnify',
};

export default function CoupGameScreen() {
  const pub = useGameStore((s) => s.coupPublic);
  const priv = useGameStore((s) => s.coupPrivate);
  const myId = useGameStore((s) => s.playerId);
  const room = useGameStore((s) => s.room);
  const token = useGameStore((s) => s.token);
  const dialogOpen = useDialogStore((s) => s.dialog !== null);

  const [targeting, setTargeting] = useState<CoupActionType | null>(null);
  const [keepSel, setKeepSel] = useState<number[]>([]);
  const [showRef, setShowRef] = useState(false);
  const [activeReactions, setActiveReactions] = useState<Record<string, string>>({});
  const [showTaunts, setShowTaunts] = useState(false);
  const [showInfluences, setShowInfluences] = useState(false);
  const actions = useCoupActions();
  const reducedMotion = useReducedMotionPreference();
  const pendingCommand = actions.pending ? 'Decision' : null;
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const connectionState = actions.connected ? 'connected' : 'reconnecting';
  const [leaving, setLeaving] = useState(false);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [seatsWidth, setSeatsWidth] = useState(0);
  const reactionTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const leavingRef = useRef(false);
  const leaveNotifiedRef = useRef(false);
  const mountedRef = useRef(true);
  const leavePromptRef = useRef(false);
  const ownDialogRef = useRef<DialogConfig | null>(null);
  const leaveEpochRef = useRef(0);
  const lastDecisionRef = useRef<string | null>(null);
  const lifecycleIdentity = useRef(token);
  const nativeBack = useRef<(() => void) | null>(null);
  const approveNavigation = useNativeLeaveGuard(token, () => {
    if (useGameStore.getState().token === token) nativeBack.current?.();
  });
  const { width: winWidth, height: winHeight, fontScale = 1 } = useWindowDimensions();
  const isWide = winWidth >= 900;
  const isXWide = winWidth >= 1440;
  const actionMinimumWidth: ViewStyle['minWidth'] = Platform.OS === 'web'
    ? 'min-content' as ViewStyle['minWidth']
    : Math.min(140 * Math.max(1, fontScale), Math.max(48, (isWide ? 380 : winWidth) - 28));
  const resultsWide = winWidth >= 900 * Math.max(1, fontScale);

  const phase = pub?.pending.phase;

  useEffect(() => {
    setTargeting(null);
    setKeepSel([]);
  }, [phase, pub?.currentTurnPlayerId]);

  useEffect(() => {
    setShowInfluences(false);
  }, [pub?.currentTurnPlayerId]);

  useEffect(() => {
    if (!showInfluences) return;
    const timer = setTimeout(() => setShowInfluences(false), 15_000);
    return () => clearTimeout(timer);
  }, [showInfluences]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setShowInfluences(false);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    let active = true;
    const ownsSession = () => active && useGameStore.getState().token === token && getSocket() === socket;

    const onReaction = ({ playerId, reaction }: { playerId: string; reaction: string }) => {
      if (!ownsSession()) return;
      setActiveReactions((prev) => ({ ...prev, [playerId]: reaction }));
      const timer = setTimeout(() => {
        if (!ownsSession()) return;
        setActiveReactions((prev) => {
          const next = { ...prev };
          delete next[playerId];
          return next;
        });
      }, 3000);
      reactionTimers.current.push(timer);
    };

    socket.on('reaction_received', onReaction);
    return () => {
      active = false;
      socket.off('reaction_received', onReaction);
      reactionTimers.current.forEach(clearTimeout);
      reactionTimers.current = [];
    };
  }, [token]);

  useEffect(() => {
    const previous = lifecycleIdentity.current;
    lifecycleIdentity.current = token;
    if (token === null || previous === token) return;
    leavingRef.current = false;
    leaveNotifiedRef.current = false;
    leavePromptRef.current = false;
    if (ownDialogRef.current && useDialogStore.getState().dialog === ownDialogRef.current) useDialogStore.getState().hide();
    ownDialogRef.current = null;
    setLeaving(false);
    setCleanupPending(false);
    setActionMessage(null);
    setShowInfluences(false);
  }, [token]);

  useEffect(() => {
    if (token !== null || useGameStore.getState().token !== null || leavingRef.current) return;
    leavingRef.current = true;
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null);
  }, [token, approveNavigation]);

  const onSessionCleared = useCallback(() => {
    if (useGameStore.getState().token !== null) return;
    leavingRef.current = true;
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null, null);
  }, [approveNavigation]);

  const onLeave = useCallback(async () => {
    const ownsSession = () => mountedRef.current && useGameStore.getState().token === token && useGameStore.getState().room?.roomCode === room?.roomCode;
    if (leavingRef.current || !ownsSession()) return;
    leavingRef.current = true;
    setLeaving(true);
    if (!leaveNotifiedRef.current) {
      leaveNotifiedRef.current = true;
      try {
        if (room && token) await leaveRoom(room.roomCode, token);
      } catch (error) {
        if (ownsSession()) showDialog('Court notification failed', `${error instanceof Error ? error.message : 'Unknown error'}. Your seat may stay reserved until reconnect grace expires.`);
      }
    }
    if (!ownsSession()) return;
    getSocket()?.disconnect();
    try {
      if (token) await clearAuthIfMatches(token);
    } catch (error) {
      if (ownsSession()) {
        leavingRef.current = false;
        setLeaving(false);
        setCleanupPending(true);
        setActionMessage(`Your saved session could not be cleared. Retry leaving before joining another room. ${error instanceof Error ? error.message : ''}`);
      }
      return;
    }
    if (!ownsSession()) return;
    useGameStore.getState().clearAll();
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null, null);
  }, [room, token, approveNavigation]);

  const onRequestLeave = useCallback(() => {
    if (leavingRef.current || leavePromptRef.current) return;
    const current = useGameStore.getState();
    if (!mountedRef.current || current.token !== token || current.room?.roomCode !== room?.roomCode) return;
    if (cleanupPending) { void onLeave(); return; }
    const captured = current.coupPublic;
    if (!captured) return;
    const epoch = leaveEpochRef.current;
    const isCurrent = () => {
      const latest = useGameStore.getState();
      return mountedRef.current && leavePromptRef.current && latest.token === token && latest.room?.roomCode === room?.roomCode
        && epoch === leaveEpochRef.current && latest.coupPublic?.status === captured.status
        && (captured.status !== 'game_over' || latest.coupPublic.revision === captured.revision);
    };
    leavePromptRef.current = true;
    showDialog(captured.status === 'game_over' ? 'Leave the table?' : 'Leave the Coup?',
      captured.status === 'game_over' ? 'Return to the arcade? This match has already ended.'
        : 'Leaving forfeits your remaining influence immediately and may end the match. You cannot win after forfeiting. A temporary disconnection keeps your seat during reconnect grace; expiry also forfeits it.',
      [
        { text: 'STAY', style: 'cancel', onPress: () => { if (isCurrent()) leavePromptRef.current = false; } },
        { text: 'LEAVE', style: 'destructive', onPress: () => { if (!isCurrent()) return; leavePromptRef.current = false; void onLeave(); } },
      ]);
    ownDialogRef.current = useDialogStore.getState().dialog;
  }, [cleanupPending, onLeave, room?.roomCode, token]);

  useEffect(() => {
    leaveEpochRef.current += 1;
    if (ownDialogRef.current && useDialogStore.getState().dialog === ownDialogRef.current) useDialogStore.getState().hide();
    ownDialogRef.current = null;
    leavePromptRef.current = false;
  }, [pub?.status, room?.roomCode, token]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (ownDialogRef.current && useDialogStore.getState().dialog === ownDialogRef.current) useDialogStore.getState().hide();
    };
  }, []);

  const handleBack = useCallback(() => {
    if (showRef) { setShowRef(false); return; }
    if (showInfluences) { setShowInfluences(false); return; }
    onRequestLeave();
  }, [onRequestLeave, showInfluences, showRef]);
  useLayoutEffect(() => { nativeBack.current = handleBack; }, [handleBack]);

  useWebModalFocus(pub?.status === 'game_over' && !dialogOpen, 'coup-results', onRequestLeave);

  const decisionKey = pub?.status === 'playing' && (pub.pending.waitingOn.includes(myId ?? '') || (pub.pending.phase === 'awaiting_action' && pub.currentTurnPlayerId === myId))
    ? [pub.pending.phase, pub.pending.actorId, pub.pending.targetId, pub.pending.blockerId, pub.pending.losingPlayerId, pub.pending.claimedCharacter, pub.pending.blockCharacter].join(':')
    : null;
  useEffect(() => {
    if (Platform.OS !== 'web' || !decisionKey || showRef) return;
    if (lastDecisionRef.current === decisionKey) return;
    lastDecisionRef.current = decisionKey;
    const timer = setTimeout(() => {
      const panel = document.getElementById('coup-decision-panel');
      const target = panel?.querySelector<HTMLElement>('[role="button"]:not([aria-disabled="true"]), [tabindex]');
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
    }, 0);
    return () => clearTimeout(timer);
  }, [decisionKey, showRef]);
  useEffect(() => {
    if (!decisionKey) lastDecisionRef.current = null;
  }, [decisionKey]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !targeting) return;
    const timer = setTimeout(() => {
      const target = document.querySelector<HTMLElement>('#coup-seats [role="button"][aria-label*="available target"]');
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
    }, 0);
    return () => clearTimeout(timer);
  }, [targeting]);

  const beginTargeting = (action: CoupActionType | null) => {
    setTargeting(action);
  };
  const cancelTargeting = () => {
    const label = targeting ? ACTION_LABELS[targeting].label : null;
    setTargeting(null);
    if (Platform.OS === 'web' && label) setTimeout(() => restoreCoupActionFocus(label, () => {
      const latest = useGameStore.getState();
      return mountedRef.current && latest.token === token && latest.roomCode === room?.roomCode
        && latest.coupPublic?.status === 'playing' && latest.coupPublic.pending.phase === 'awaiting_action'
        && latest.coupPublic.currentTurnPlayerId === myId;
    }), 0);
  };

  useWebBackGuard('/coup/game', handleBack, token !== null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]);

  if (!pub || !priv || !myId) {
    return <GameRecovery message="Connecting to the court…" background={COUP.bg} surface={COUP.surface} border={COUP.border} accent={COUP.crimson} muted={COUP.muted} icon="drama-masks" onSessionCleared={onSessionCleared} />;
  }

  const me = pub.players.find((p) => p.playerId === myId);
  const pending = pub.pending;
  const nameOf = (id: string | null) => (id && pub.players.find((p) => p.playerId === id)?.displayName) || '?';
  const isMyTurn = pub.currentTurnPlayerId === myId && pending.phase === 'awaiting_action';
  const waitingOnMe = pending.waitingOn.includes(myId);
  const blockChars = pending.action
    ? ACTION_META[pending.action].blockableBy.filter((c) => charactersForVariant(pub.variant).includes(c))
    : [];
  const myCoins = me?.coins ?? 0;
  const mustCoup = myCoins >= 10;
  const stateSynced = actions.synced;
  const busy = actions.busy || leaving || cleanupPending;
  const presenceById = new Map(room?.players.map((player) => [player.playerId, player]) ?? []);
  const canTargetPlayer = (playerId: string) => {
    const player = pub.players.find((candidate) => candidate.playerId === playerId);
    const presence = presenceById.get(playerId);
    return Boolean(
      player
      && player.playerId !== myId
      && !player.eliminated
      && !player.forfeited
      && (targeting === 'convert' || canTargetCoupPlayer(pub.variant, pub.players, myId, player.playerId))
      && !(targeting === 'steal' && player.coins === 0)
      && !presence?.hasLeft,
    );
  };
  const targetCount = pub.players.filter((player) => canTargetPlayer(player.playerId)).length;
  const hasStealTarget = pub.players.some((player) => {
    const presence = presenceById.get(player.playerId);
    return canTargetCoupPlayer(pub.variant, pub.players, myId, player.playerId) && !player.forfeited && player.coins > 0 && !presence?.hasLeft;
  });

  const sendCommand = (action: CoupActionKind, payload: Record<string, unknown>, label: string) => {
    if (leaving || cleanupPending) return false;
    return actions.send(action, payload, label, pub.revision);
  };
  const act = (action: CoupActionType, targetPlayerId?: string) =>
    sendCommand('action', { action, ...(targetPlayerId ? { targetPlayerId } : {}) }, ACTION_LABELS[action].label);
  const respond = (response: 'challenge' | 'block' | 'pass', blockCharacter?: CoupCharacter) =>
    sendCommand('respond', { response, ...(blockCharacter ? { blockCharacter } : {}) },
      response === 'pass' ? 'Allow' : response === 'challenge' ? 'Challenge' : `Block as ${blockCharacter}`);
  const onPlayAgain = () => {
    if (canRematch) sendCommand('start_game', {}, 'Play again');
  };

  const describe = (): string => {
    const a = pending.action;
    const actor = nameOf(pending.actorId);
    const label = a ? ACTION_LABELS[a]?.label ?? a : '';
    switch (pending.phase) {
      case 'awaiting_allegiance':
        return `${nameOf(pending.waitingOn[0])} chooses the starting allegiance. The other seats will alternate sides.`;
      case 'awaiting_action':
        return `${nameOf(pub.currentTurnPlayerId)} is choosing an action…`;
      case 'awaiting_action_challenge':
        if (a === 'embezzle') return `${actor} claims to hold no Duke and takes the Treasury`;
        return `${actor} claims ${pending.claimedCharacter?.toUpperCase()} - ${label}`;
      case 'awaiting_block':
        if (a === 'foreign_aid') return `${actor} takes Foreign Aid - eligible opponents may block with the Duke`;
        return `${actor} → ${label} on ${nameOf(pending.targetId)} - target may block`;
      case 'awaiting_block_challenge':
        return `${nameOf(pending.blockerId)} claims ${pending.blockCharacter?.toUpperCase()} to block`;
      case 'awaiting_challenge_decision':
        return `${nameOf(pending.blockerId ?? pending.actorId)} was challenged by ${nameOf(pending.challengerId)}`;
      case 'awaiting_lose_influence':
        return `${nameOf(pending.losingPlayerId)} loses an influence (${pending.loseReason?.replace(/_/g, ' ')})`;
      case 'awaiting_exchange':
        return `${actor} is exchanging cards with the court…`;
      case 'awaiting_examine':
        return `${actor} is examining target card…`;
      case 'awaiting_examine_selection':
        return `${nameOf(pending.targetId)} chooses one hidden influence to show privately to ${actor}`;
      default:
        return '';
    }
  };

  const getPhaseIcon = (): keyof typeof MaterialCommunityIcons.glyphMap => {
    switch (pending.phase) {
      case 'awaiting_action_challenge':
      case 'awaiting_block_challenge':
      case 'awaiting_challenge_decision':
        return 'alert-decagram-outline';
      case 'awaiting_block':
        return 'shield-alert-outline';
      case 'awaiting_lose_influence':
        return 'skull-outline';
      case 'awaiting_exchange':
      case 'awaiting_examine_selection':
      case 'awaiting_examine':
        return 'cards-outline';
      default:
        return 'timer-sand';
    }
  };

  const bannerAccent =
    pending.phase.includes('challenge')
      ? COUP.crimson
      : pending.phase === 'awaiting_block'
        ? COUP.purple
        : pending.phase === 'awaiting_lose_influence'
          ? COUP.crimson
          : COUP.gold;

  const myFaceDown = priv.influences.filter((i) => !i.revealed).map((i) => i.character);
  const challengedClaim = pending.blockCharacter ?? pending.claimedCharacter;
  const noDukeClaim = pending.action === 'embezzle' && !pending.blockerId;
  const canProveChallenge = noDukeClaim ? !myFaceDown.includes('duke') : challengedClaim != null && myFaceDown.includes(challengedClaim);
  const gameOver = pending.phase === 'game_over' || pub.status === 'game_over';
  const iAmHost = room?.players.find((player) => player.playerId === myId)?.isHost ?? false;

  const retainedPlayers = room?.players.filter((player) => !player.hasLeft) ?? [];
  const connectedCount = retainedPlayers.filter((player) => player.isConnected).length;
  const canRematch = connectedCount >= 2 && retainedPlayers.every((player) => player.isConnected);
  const actionGroup = getActionsForVariant(pub.variant);

  const SEAT_GAP = 10;
  const MIN_SEAT_W = 160;
  const seatCols = seatsWidth > 0 ? Math.max(1, Math.floor((seatsWidth + SEAT_GAP) / (MIN_SEAT_W + SEAT_GAP))) : 1;
  const seatW = seatsWidth > 0 ? Math.floor((seatsWidth - SEAT_GAP * (seatCols - 1)) / seatCols) : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COUP.bg, flexDirection: isWide ? 'row' : 'column' }} edges={['top', 'bottom']}>
      <ScrollView
        accessibilityElementsHidden={gameOver || showRef}
        importantForAccessibility={gameOver || showRef ? 'no-hide-descendants' : 'auto'}
        aria-hidden={Platform.OS === 'web' ? gameOver || showRef : undefined}
        style={{ flex: 1 }}
        contentContainerStyle={{ width: '100%', maxWidth: 980, alignSelf: 'center', padding: 14, gap: 12, paddingBottom: 28 }}
        showsVerticalScrollIndicator
      >
        <View nativeID="coup-toolbar" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1, maxWidth: '100%' }}><MaterialCommunityIcons name="drama-masks" size={21} color={COUP.crimson} /><Text style={{ flexShrink: 1, fontFamily: 'Outfit_800ExtraBold', fontSize: 18, ...neonText(COUP.crimson, 10) }}>{pub.variant === 'base' ? 'BASE COUP' : 'REFORMATION + INQUISITOR'}</Text></View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 12, flexShrink: 1, maxWidth: '100%' }}>
            {pub.variant === 'reformation' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MaterialCommunityIcons name="bank" size={14} color={COUP.gold} />
                <Text accessibilityLabel={`Treasury Reserve: ${pub.treasuryReserve} coins`} style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.gold, fontSize: 13 }}>Treasury {pub.treasuryReserve}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialCommunityIcons name="cards-playing-outline" size={14} color={COUP.muted} />
              <Text accessibilityLabel={`${pub.deckSize} cards in the court deck`} style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.muted, fontSize: 13 }}>{pub.deckSize}</Text>
            </View>
            {!isXWide && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open rules"
                onPress={() => setShowRef(true)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: COUP.border,
                  backgroundColor: COUP.panel,
                  paddingHorizontal: 9,
                  minHeight: 48,
                  minWidth: 48,
                  maxWidth: '100%',
                  flexShrink: 1,
                  justifyContent: 'center',
                }}
              >
                <MaterialCommunityIcons name="book-open-variant" size={11} color={COUP.muted} />
                <Text style={{ flexShrink: 1, fontFamily: 'Outfit_700Bold', color: COUP.muted, fontSize: 13 }}>Rules</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Leave game"
              accessibilityHint="Opens a confirmation before forfeiting"
              onPress={onRequestLeave}
              style={{ minHeight: 48, minWidth: 48, maxWidth: '100%', flexShrink: 1, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 10, borderWidth: 1, borderColor: `${COUP.crimson}66`, backgroundColor: `${COUP.crimson}12` }}
            >
              <MaterialCommunityIcons name="exit-to-app" size={15} color={COUP.crimson} />
              <Text style={{ flexShrink: 1, fontFamily: 'Outfit_700Bold', color: COUP.crimson, fontSize: 13 }}>Leave</Text>
            </Pressable>
          </View>
        </View>

        {connectionState !== 'connected' && (
          <View accessibilityRole="alert" style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: `${COUP.crimson}77`, backgroundColor: `${COUP.crimson}12`, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="connection" size={17} color={COUP.crimson} />
            <Text accessibilityLiveRegion="assertive" style={{ flex: 1, fontFamily: 'SpaceMono_700Bold', color: COUP.crimson, fontSize: 12, lineHeight: 18 }}>
              {'Reconnecting. The court will refresh before you act.'}
            </Text>
          </View>
        )}

        {connectionState === 'connected' && !stateSynced && (
          <View accessibilityRole="alert" style={{ minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: `${COUP.gold}66`, backgroundColor: `${COUP.gold}10`, paddingHorizontal: 11, justifyContent: 'center' }}>
            <Text accessibilityLiveRegion="polite" style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.gold, fontSize: 12 }}>
              Syncing your private cards with the latest court state…
            </Text>
          </View>
        )}

        {(actionMessage || actions.message || cleanupPending) && (
          <View accessibilityRole="summary" style={{ minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: `${COUP.blue}55`, backgroundColor: `${COUP.blue}0F`, paddingHorizontal: 11, justifyContent: 'center' }}>
            <Text accessibilityLiveRegion="polite" style={{ fontFamily: 'Outfit_400Regular', color: COUP.text, fontSize: 14, lineHeight: 20 }}>{actionMessage ?? actions.message}</Text>
            {cleanupPending && <NeonButton label="RETRY LEAVING" color={COUP.crimson} onPress={() => void onLeave()} />}
          </View>
        )}

        <Animated.View
          entering={reducedMotion ? undefined : FadeIn.duration(250)}
          key={`${pending.phase}-${pending.actorId}-${pending.blockerId}`}
          style={{
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: `${bannerAccent}99`,
            backgroundColor: COUP.panel,
            padding: 12,
            gap: 8,
            boxShadow: `0 0 12px ${bannerAccent}2E`,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
            <MaterialCommunityIcons name={getPhaseIcon()} size={16} color={bannerAccent} />
            <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={{ flex: 1, fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 14, lineHeight: 19, textAlign: 'center' }}>{describe()}</Text>
          </View>
          {pending.deadline != null && <Countdown deadline={pending.deadline} />}
        </Animated.View>

        <View
          nativeID="coup-seats"
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            setSeatsWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
          }}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SEAT_GAP }}
        >
          {pub.players.map((p) => {
            const presence = presenceById.get(p.playerId);
            const selectable = targeting != null && canTargetPlayer(p.playerId);
            return (
              <View key={p.playerId} style={{ width: seatW ?? '100%' }}>
                <PlayerSeat
                  player={p}
                  isMe={p.playerId === myId}
                  fill
                  selectable={selectable}
                  waiting={pending.waitingOn.includes(p.playerId)}
                  reaction={activeReactions[p.playerId]}
                  presence={presence}
                  onSelect={
                    selectable
                      ? () => {
                          if (act(targeting!, p.playerId)) setTargeting(null);
                        }
                      : undefined
                  }
                />
              </View>
            );
          })}
        </View>

        <View style={{ marginTop: 4, marginBottom: 12, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.muted, fontSize: 12, letterSpacing: 2 }}>
              YOUR INFLUENCE
            </Text>
            <Coin amount={myCoins} size="md" showText />
          </View>
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 12, lineHeight: 18 }}>
            Keep these private. They hide again after 15 seconds, on turn change, or when the app is backgrounded.
          </Text>
          <CardGrid items={priv.influences} keyExtractor={(_, i) => String(i)} minCardWidth={208} maxCardWidth={280} gap={10} textScale={fontScale}
            renderItem={(inf, _columnWidth, i) => (
              <CharacterCard
                fluid
                character={inf.character}
                faceDown={!inf.revealed && !showInfluences}
                lost={inf.revealed}
                size="md"
                accessibilityLabel={!inf.revealed && !showInfluences ? `Private influence ${i + 1}, hidden` : `${inf.character}, ${inf.revealed ? 'revealed and lost' : 'active private influence'}`}
              />
            )}
          />
          {myFaceDown.length > 0 && (
            <NeonButton
              label={showInfluences ? 'HIDE PRIVATE CARDS' : 'REVEAL PRIVATE CARDS'}
              color={showInfluences ? COUP.crimson : COUP.gold}
              variant="outline"
              icon={<MaterialCommunityIcons name={showInfluences ? 'eye-off-outline' : 'eye-outline'} size={16} color={showInfluences ? COUP.crimson : COUP.gold} />}
              onPress={() => setShowInfluences((visible) => !visible)}
            />
          )}
          {showInfluences && (
            <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.gold, fontSize: 12 }}>
              PRIVATE CARDS VISIBLE
            </Text>
          )}
        </View>

        <View style={{ marginVertical: 4 }}>
          <GameLog log={pub.log} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showTaunts ? 'Hide table reactions' : 'Show table reactions'}
            accessibilityState={{ expanded: showTaunts }}
            aria-expanded={Platform.OS === 'web' ? showTaunts : undefined}
            onPress={() => setShowTaunts(!showTaunts)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 22,
              marginBottom: showTaunts ? 8 : 2,
              minHeight: 48,
              minWidth: 48,
              paddingVertical: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialCommunityIcons name="bullhorn-outline" size={13} color={COUP.muted} />
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.muted, fontSize: 12, letterSpacing: 1.5 }}>
                TAUNT ENEMIES
              </Text>
            </View>
            <MaterialCommunityIcons name={showTaunts ? 'chevron-up' : 'chevron-down'} size={14} color={COUP.muted} />
          </Pressable>

          {showTaunts && (
            <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(200)}>
              <ScrollView style={{ maxHeight: 132 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {getTauntsForVariant(pub.variant).map((taunt) => (
                  <Pressable
                    key={taunt.text}
                    accessibilityRole="button"
                    accessibilityLabel={`Send reaction: ${taunt.label}`}
                    onPress={() => getSocket()?.emit('player_reaction', { reaction: taunt.text })}
                    style={{
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: `${taunt.color}66`,
                      backgroundColor: `${taunt.color}14`,
                      paddingHorizontal: 10,
                      minHeight: 48,
                      minWidth: 48,
                      paddingVertical: 8,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }}
                  >
                    <MaterialCommunityIcons name={taunt.icon} size={11} color={taunt.color} />
                    <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 13 }}>{taunt.label}</Text>
                  </Pressable>
                ))}
                </View>
              </ScrollView>
            </Animated.View>
          )}
        </View>
      </ScrollView>

      {!gameOver && (
        <Animated.View
          entering={reducedMotion ? undefined : (isWide ? FadeIn : FadeInUp).duration(250)}
          accessibilityElementsHidden={showRef}
          importantForAccessibility={showRef ? 'no-hide-descendants' : 'auto'}
          aria-hidden={Platform.OS === 'web' ? showRef : undefined}
          style={
            isWide
              ? { width: 380, borderLeftWidth: 1, borderLeftColor: COUP.border, backgroundColor: COUP.surface, padding: 14, gap: 10 }
              : { maxHeight: Math.min(390, Math.max(280, winHeight * 0.46)), borderTopWidth: 1, borderTopColor: COUP.border, backgroundColor: COUP.surface, padding: 14, paddingBottom: 8, gap: 10 }
          }
        >
          <ScrollView nativeID="coup-decision-panel" style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 10 }} showsVerticalScrollIndicator
            {...(Platform.OS === 'web' ? { tabIndex: 0, role: 'region' as const } : {})} accessibilityLabel="Your Coup decision">
          {waitingOnMe && !isMyTurn && (
            <Text style={{ color: COUP.text, fontFamily: 'Outfit_400Regular', fontSize: 15, lineHeight: 21 }}>{describe()}</Text>
          )}
          {pendingCommand && (
            <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.gold, fontSize: 12, textAlign: 'center' }}>
              {pendingCommand?.toUpperCase()} SENT · WAITING FOR SERVER
            </Text>
          )}

          {waitingOnMe && pending.phase === 'awaiting_allegiance' && <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={{ color: COUP.gold, fontFamily: 'Outfit_700Bold', fontSize: 18 }}>Choose your allegiance</Text>
            <Text style={{ color: COUP.text, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24 }}>The other players alternate sides after you. Allegiances restrict attacks, but there is only one winner. If time runs out, you start as Reformist.</Text>
            <NeonButton label="LOYALIST" color={COUP.blue} disabled={busy} onPress={() => sendCommand('choose_allegiance', { allegiance: 'loyalist' }, 'Choose Loyalist')} />
            <NeonButton label="REFORMIST" color={COUP.crimson} disabled={busy} onPress={() => sendCommand('choose_allegiance', { allegiance: 'reformist' }, 'Choose Reformist')} />
          </View>}
          {isMyTurn && targeting == null && (
            <View>
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.gold, fontSize: 13, letterSpacing: 1, marginBottom: 8 }}>
                YOUR TURN {mustCoup ? ' · 10+ coins - you must Coup' : ''}
              </Text>
              
              <View style={{ gap: 12 }}>
                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.muted, fontSize: 12, letterSpacing: 1 }}>
                    GENERAL ACTIONS (NO CLAIM)
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {actionGroup.general.map((a) => renderActionButton(a, myCoins, mustCoup, busy, hasStealTarget, act, beginTargeting, actionMinimumWidth))}
                  </View>
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.muted, fontSize: 12, letterSpacing: 1 }}>
                    CHARACTER CLAIMS (CHALLENGEABLE)
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {actionGroup.character.map((a) => renderActionButton(a, myCoins, mustCoup, busy, hasStealTarget, act, beginTargeting, actionMinimumWidth))}
                  </View>
                </View>

                {pub.variant === 'reformation' && (
                  <View style={{ gap: 6 }}>
                    <Text style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.muted, fontSize: 12, letterSpacing: 1 }}>
                      FACTION ACTIONS (REFORMATION)
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {actionGroup.reformation.map((a) => {
                        if (a === 'convert') {
                          const disabledSelf = mustCoup || myCoins < 1;
                          const disabledOther = mustCoup || myCoins < 2;
                          return (
                            <View key="convert-split" style={{ flexDirection: 'row', flexWrap: 'wrap', width: '100%', gap: 8 }}>
                              <View style={{ flexGrow: 1, flexBasis: '46%', minWidth: actionMinimumWidth }}>
                                <NeonButton
                                  label="Convert Self"
                                  color={COUP.gold}
                                  variant="outline"
                                  disabled={disabledSelf || busy}
                                  icon={<MaterialCommunityIcons name="swap-horizontal" size={13} color={COUP.gold} />}
                                  onPress={() => act('convert', myId)}
                                />
                                <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
                                  Cost: 1 coin
                                </Text>
                              </View>
                              <View style={{ flexGrow: 1, flexBasis: '46%', minWidth: actionMinimumWidth }}>
                                <NeonButton
                                  label="Convert Other"
                                  color={COUP.gold}
                                  variant="outline"
                                  disabled={disabledOther || busy}
                                  icon={<MaterialCommunityIcons name="swap-horizontal" size={13} color={COUP.gold} />}
                                  onPress={() => beginTargeting('convert')}
                                />
                                <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
                                  Cost: 2 coins
                                </Text>
                              </View>
                            </View>
                          );
                        }
                        return renderActionButton(a, myCoins, mustCoup, busy, hasStealTarget, act, beginTargeting, actionMinimumWidth);
                      })}
                    </View>
                  </View>
                )}
              </View>
            </View>
          )}

          {isMyTurn && targeting != null && (
            <>
              <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.gold, fontSize: 13 }}>
                {targetCount > 0
                  ? `Choose a highlighted player to ${ACTION_LABELS[targeting].label.toLowerCase()}.`
                  : 'No player is currently eligible. Cancel and choose another action.'}
              </Text>
              <NeonButton label="CANCEL" color={COUP.muted} variant="ghost" onPress={cancelTargeting} />
            </>
          )}

          {waitingOnMe && pending.phase === 'awaiting_action_challenge' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <NeonButton
                  label="CHALLENGE"
                  accessibilityHint={noDukeClaim ? 'Challenge the claim that this player has no Duke. If they prove it, you lose one influence.' : 'Challenge the character claim. If it is proven, you must lose one influence.'}
                  color={COUP.crimson}
                  icon={<MaterialCommunityIcons name="flag-outline" size={16} color={COUP.text} />}
                  disabled={busy}
                  onPress={() => respond('challenge')}
                />
              </View>
              <View style={{ flex: 1 }}>
                <NeonButton
                  label="ALLOW"
                  accessibilityHint="Pass on challenging this claim. The action continues when every eligible player allows it."
                  color={COUP.green}
                  variant="outline"
                  icon={<MaterialCommunityIcons name="check" size={16} color={COUP.green} />}
                  disabled={busy}
                  onPress={() => respond('pass')}
                />
              </View>
            </View>
          )}

          {waitingOnMe && pending.phase === 'awaiting_block' && (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {blockChars.map((c) => (
                  <View key={c} style={{ flexGrow: 1, minWidth: '46%' }}>
                    <NeonButton
                      label={`BLOCK (${c.toUpperCase()})`}
                      accessibilityHint={`Claim ${c} to block the action. Other eligible players may challenge your claim.`}
                      color={COUP.purple}
                      icon={<MaterialCommunityIcons name="shield-outline" size={15} color={COUP.text} />}
                      disabled={busy}
                      onPress={() => respond('block', c)}
                    />
                  </View>
                ))}
              </View>
              <NeonButton
                label="ALLOW"
                accessibilityHint="Decline to block this action. It resolves when every eligible player allows it."
                color={COUP.green}
                variant="outline"
                icon={<MaterialCommunityIcons name="check" size={15} color={COUP.green} />}
                disabled={busy}
                onPress={() => respond('pass')}
              />
            </View>
          )}

          {waitingOnMe && pending.phase === 'awaiting_block_challenge' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <NeonButton
                  label="CHALLENGE BLOCK"
                  accessibilityHint="Challenge the blocking character claim. If it is proven, you must lose one influence."
                  color={COUP.crimson}
                  icon={<MaterialCommunityIcons name="flag-outline" size={16} color={COUP.text} />}
                  disabled={busy}
                  onPress={() => respond('challenge')}
                />
              </View>
              <View style={{ flex: 1 }}>
                <NeonButton
                  label="ALLOW"
                  accessibilityHint="Accept this block. The original action is cancelled when every eligible player allows it."
                  color={COUP.green}
                  variant="outline"
                  icon={<MaterialCommunityIcons name="check" size={16} color={COUP.green} />}
                  disabled={busy}
                  onPress={() => respond('pass')}
                />
              </View>
            </View>
          )}

          {waitingOnMe && pending.phase === 'awaiting_challenge_decision' && (
            <View style={{ gap: 10 }}>
              <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.crimson, fontSize: 14 }}>
                YOUR CLAIM WAS CHALLENGED
              </Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.text, fontSize: 13, lineHeight: 20 }}>
                {noDukeClaim ? `Show all your hidden cards to prove you have no Duke. They return to the deck and you receive replacements. ${nameOf(pending.challengerId)} loses influence. Or concede and lose one influence without showing your hand.` : `Prove ${challengedClaim?.toUpperCase()} to swap that card and make ${nameOf(pending.challengerId)} lose influence, or concede and choose one of your influences to lose. Conceding does not reveal whether you held the card.`}
              </Text>
              {!canProveChallenge && (
                <Text accessibilityRole="alert" style={{ fontFamily: 'SpaceMono_700Bold', color: COUP.gold, fontSize: 12, lineHeight: 18 }}>
                  You cannot prove this claim with your current face-down cards.
                </Text>
              )}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <NeonButton
                    label={noDukeClaim ? 'PROVE NO DUKE' : `PROVE ${challengedClaim?.toUpperCase() ?? 'CLAIM'}`}
                    accessibilityHint={noDukeClaim ? 'Publicly reveal and replace all hidden cards. The challenger loses one influence.' : `Reveal and replace your ${challengedClaim ?? 'claimed'} influence. The challenger must lose one influence.`}
                    color={COUP.green}
                    disabled={busy || !canProveChallenge}
                    icon={<MaterialCommunityIcons name="cards-outline" size={16} color={COUP.bg} />}
                    onPress={() => sendCommand('resolve_challenge', { prove: true }, 'Prove claim')}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <NeonButton
                    label="CONCEDE"
                    accessibilityHint="Do not prove the claim. You must choose one influence to lose, without revealing whether you held the claimed character."
                    color={COUP.crimson}
                    variant="outline"
                    disabled={busy}
                    icon={<MaterialCommunityIcons name="flag-outline" size={16} color={COUP.crimson} />}
                    onPress={() => sendCommand('resolve_challenge', { prove: false }, 'Concede challenge')}
                  />
                </View>
              </View>
            </View>
          )}

          {waitingOnMe && pending.phase === 'awaiting_lose_influence' && (
            <>
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.crimson, fontSize: 13, marginBottom: 4 }}>
                Choose an influence to lose
              </Text>
              <CardGrid items={myFaceDown} keyExtractor={(c, i) => `${c}-${i}`} minCardWidth={208} maxCardWidth={280} gap={10} textScale={fontScale}
                renderItem={(c) => (
                  <CharacterCard
                    fluid
                    character={c}
                    size="md"
                    accessibilityLabel={`Lose ${c} influence`}
                    accessibilityHint="Reveals this card to the court and removes it from play"
                    disabled={busy}
                    onPress={() => sendCommand('lose_influence', { character: c }, `Lose ${c}`)}
                  />
                )}
              />
            </>
          )}

          {waitingOnMe && pending.phase === 'awaiting_exchange' && priv.exchange && (
            <>
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.gold, fontSize: 13, marginBottom: 4 }}>
                Keep {priv.exchange.keepCount} - tap to choose
              </Text>
              <View style={{ marginBottom: 8 }}>
              <CardGrid items={priv.exchange.pool} keyExtractor={(_, i) => String(i)} minCardWidth={208} maxCardWidth={280} gap={10} textScale={fontScale}
                renderItem={(c, _columnWidth, i) => (
                  <CharacterCard
                    fluid
                    character={c}
                    size="md"
                    selected={keepSel.includes(i)}
                    accessibilityLabel={`${c}, exchange option ${i + 1}`}
                    accessibilityHint={keepSel.includes(i) ? 'Remove this card from your kept cards' : 'Keep this card'}
                    disabled={busy}
                    onPress={() =>
                      setKeepSel((sel) =>
                        sel.includes(i)
                          ? sel.filter((x) => x !== i)
                          : sel.length < priv.exchange!.keepCount
                            ? [...sel, i]
                            : sel,
                      )
                    }
                  />
                )}
              />
              </View>
              <NeonButton
                label={`CONFIRM (${keepSel.length}/${priv.exchange.keepCount})`}
                accessibilityHint={`Keep the selected ${priv.exchange.keepCount} influences and return the rest to the court deck.`}
                color={COUP.gold}
                disabled={busy || keepSel.length !== priv.exchange.keepCount}
                icon={<MaterialCommunityIcons name="checkbox-marked-circle-outline" size={15} color={COUP.gold} />}
                onPress={() => sendCommand('exchange', { keep: keepSel.map((i) => priv.exchange!.pool[i]) }, 'Confirm exchange')}
              />
            </>
          )}

          {waitingOnMe && pending.phase === 'awaiting_examine_selection' && <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', color: COUP.gold, fontSize: 18 }}>Choose an influence to show</Text>
            <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.text, fontSize: 16, lineHeight: 24 }}>Only {nameOf(pending.actorId)} sees this card. They may return it or make you replace it. You do not lose influence.</Text>
            <CardGrid items={myFaceDown} keyExtractor={(c, i) => `${c}-${i}`} minCardWidth={208} maxCardWidth={280} gap={10} textScale={fontScale}
              renderItem={(c) => <CharacterCard fluid character={c} size="md" disabled={busy} accessibilityLabel={`Show ${c} privately`} accessibilityHint="The Inquisitor may force you to replace this influence" onPress={() => sendCommand('examine_select', { character: c }, 'Show influence privately')} />} />
          </View>}
          {waitingOnMe && pending.phase === 'awaiting_examine' && priv.examine && <View style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', color: COUP.gold, fontSize: 18 }}>{priv.examine.targetName} showed you this influence</Text>
            <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.text, fontSize: 16, lineHeight: 24 }}>This card is private. Return it or make them draw a replacement. Their influence count stays the same.</Text>
            <CardGrid items={[priv.examine.character]} keyExtractor={(c) => c} minCardWidth={208} maxCardWidth={280} gap={10} textScale={fontScale}
              renderItem={(c) => <CharacterCard fluid character={c} size="md" accessibilityLabel={`Privately examined ${c}`} />} />
            <NeonButton label="RETURN CARD" color={COUP.green} disabled={busy} onPress={() => sendCommand('examine', { forceSwap: false }, 'Return examined card')} />
            <NeonButton label="FORCE REPLACEMENT" color={COUP.crimson} variant="outline" disabled={busy} onPress={() => sendCommand('examine', { forceSwap: true }, 'Replace examined card')} />
          </View>}
          {!isMyTurn && !waitingOnMe && (
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 12, textAlign: 'center' }}>
              {me?.eliminated ? 'You are out. You can keep watching the court.' : `Waiting for ${pending.waitingOn.map(nameOf).join(', ') || nameOf(pub.currentTurnPlayerId)}.`}
            </Text>
          )}
          </ScrollView>
        </Animated.View>
      )}

      {!gameOver && isXWide && <ReferencePanel variant={pub.variant} style={{ maxWidth: 400 }} />}

      {gameOver && (
        <Modal transparent visible animationType="none" onRequestClose={onRequestLeave}>
          <Animated.View
            nativeID="coup-results"
            accessibilityLabel="Game over"
            accessibilityViewIsModal
            role="dialog"
            aria-modal
            style={[OVERLAY_FILL, { alignItems: 'stretch', justifyContent: 'flex-start', backgroundColor: COUP.bg }]}
          >
            <SafeAreaView style={{ flex: 1, width: '100%' }} edges={['top', 'bottom']}>
              <ScrollView
                {...(Platform.OS === 'web' ? { tabIndex: 0, role: 'region' as const } : {})}
                accessibilityLabel="Coup match results"
                contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 }}
                showsVerticalScrollIndicator
              >
              <View style={{ width: '100%', maxWidth: 980, flexDirection: resultsWide ? 'row' : 'column', alignItems: 'flex-start', gap: 32 }}>
                <View style={{ minWidth: 0, flex: resultsWide ? 1 : undefined, width: resultsWide ? undefined : '100%' }}>
              <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ alignSelf: 'center', width: 104, height: 104, borderRadius: 52, backgroundColor: COUP.panel, borderTopWidth: 3, borderTopColor: COUP.gold, borderBottomWidth: 5, borderBottomColor: COUP.border, alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 10px rgba(0,0,0,0.3)' }}><MaterialCommunityIcons name={pub.winnerId === myId ? 'crown-outline' : 'drama-masks'} size={54} color={pub.winnerId ? COUP.gold : COUP.muted} /></View>
              <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 26, textAlign: 'center', color: COUP.gold, marginTop: 8 }}>
                {!pub.winnerId ? 'MATCH ENDED' : pub.winnerId === myId ? 'YOU WIN!' : `${nameOf(pub.winnerId)} WINS`}
              </Text>
              <Text style={{ maxWidth: 360, alignSelf: 'center', fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8 }}>
                {pub.winnerId ? 'The last player with influence controls the court.' : 'All remaining players forfeited. There is no winner and no competitive result is recorded.'}
              </Text>
              <View style={{ width: '100%', gap: 10, marginTop: 24 }}>
                {actions.message && <Text accessibilityLiveRegion="polite" style={{ color: COUP.gold, fontSize: 14, lineHeight: 20 }}>{actions.message}</Text>}
                <Text style={{ color: COUP.muted, fontSize: 14, lineHeight: 20 }}>{connectedCount} connected. A rematch needs at least 2 players and every retained seat connected.</Text>
                {iAmHost ? (
                  <NeonButton
                    label={actions.pending ? 'STARTING…' : 'PLAY AGAIN'}
                    icon={<MaterialCommunityIcons name="play" size={16} color={COUP.bg} />}
                    color={COUP.crimson}
                    disabled={busy || !canRematch}
                    onPress={onPlayAgain}
                  />
                ) : (
                  <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 13, textAlign: 'center' }}>
                    Waiting for the room host to start a rematch.
                  </Text>
                )}
                <NeonButton label="LEAVE TABLE" color={COUP.blue} variant="outline" onPress={onRequestLeave} />
              </View>
                </View>
              <View style={{ minWidth: 0, flex: resultsWide ? 1 : undefined, width: resultsWide ? undefined : '100%', gap: 10 }}>
                {pub.players.map((player) => {
                  const hasLeft = player.forfeited;
                  const resultStatus = hasLeft ? 'FORFEITED' : player.playerId === pub.winnerId ? 'WINNER' : 'ELIMINATED';
                  return (
                    <View
                      key={player.playerId}
                      accessible
                      accessibilityLabel={`${player.displayName}${player.playerId === myId ? ', you' : ''}. ${resultStatus}.`}
                      style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: player.playerId === pub.winnerId ? `${COUP.gold}88` : COUP.border, backgroundColor: COUP.surface, padding: 14, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
                    >
                      <Text style={{ flexBasis: 180, flexGrow: 1, minWidth: 0, fontFamily: 'Outfit_700Bold', color: player.playerId === pub.winnerId ? COUP.gold : COUP.text, fontSize: 15 }}>
                        {player.displayName}{player.playerId === myId ? ' (you)' : ''}
                      </Text>
                      <Text style={{ fontFamily: 'SpaceMono_700Bold', color: resultStatus === 'WINNER' ? COUP.green : COUP.muted, fontSize: 12 }}>
                        {resultStatus}
                      </Text>
                    </View>
                  );
                })}
              </View>

              </View>
              </ScrollView>
            </SafeAreaView>
          </Animated.View>
        </Modal>
      )}

      <ReferenceSheet visible={showRef && !isXWide && !gameOver} variant={pub.variant} onClose={() => setShowRef(false)} />
    </SafeAreaView>
  );
}

function getActionsForVariant(variant: 'base' | 'reformation') {
  const general: CoupActionType[] = ['income', 'foreign_aid', 'coup'];
  const character: CoupActionType[] =
    variant === 'base'
      ? ['tax', 'assassinate', 'steal', 'exchange']
      : ['tax', 'assassinate', 'steal', 'inquisitor_exchange', 'inquisitor_examine'];
  const reformation: CoupActionType[] = variant === 'reformation' ? ['convert', 'embezzle'] : [];

  return { general, character, reformation };
}

function renderActionButton(
  a: CoupActionType,
  myCoins: number,
  mustCoup: boolean,
  busy: boolean,
  hasStealTarget: boolean,
  act: (action: CoupActionType, target?: string) => void,
  setTargeting: (action: CoupActionType | null) => void,
  minimumWidth: ViewStyle['minWidth'],
) {
  const meta = ACTION_META[a];
  const info = ACTION_LABELS[a];
  const disabled =
    busy ||
    (mustCoup && a !== 'coup') ||
    (a === 'steal' && !hasStealTarget) ||
    myCoins < meta.cost ||
    (a === 'assassinate' && myCoins < 3) ||
    (a === 'coup' && myCoins < 7);

  const isDanger = a === 'coup' || a === 'assassinate';
  const isSpecial = a === 'tax' || a === 'exchange' || a === 'inquisitor_exchange' || a === 'inquisitor_examine';
  const buttonColor = isDanger ? COUP.crimson : isSpecial ? COUP.purple : COUP.blue;

  return (
    <View key={a} style={{ flexBasis: '48%', flexGrow: 1, minWidth: minimumWidth, maxWidth: '100%', marginBottom: 8 }}>
      <NeonButton
        label={info.label}
        accessibilityHint={`${info.hint}. ${meta.needsTarget ? 'Choose an eligible player. ' : ''}${meta.challengeable ? 'This character claim may be challenged.' : 'This action cannot be challenged.'}${meta.blockableBy.length > 0 ? ' An eligible player may block it.' : ' It cannot be blocked.'}`}
        color={buttonColor}
        variant="outline"
        disabled={disabled}
        icon={<MaterialCommunityIcons name={ACTION_ICONS[a]} size={14} color={disabled ? `${buttonColor}50` : buttonColor} />}
        onPress={() => (meta.needsTarget ? setTargeting(a) : act(a))}
      />
      <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
        {info.hint}
      </Text>
    </View>
  );
}

function getTauntsForVariant(variant: 'base' | 'reformation') {
  const basic = [
    { label: 'I am Duke!', text: 'I have a Duke!', icon: 'crown' as const, color: COUP.purple },
    { label: 'I am Assassin!', text: 'I have Assassin!', icon: 'sword' as const, color: '#F97316' },
    { label: 'I am Captain!', text: 'I have Captain!', icon: 'anchor' as const, color: '#4F8EF7' },
  ];

  const middle =
    variant === 'base'
      ? { label: 'I am Ambassador!', text: 'I have Ambassador!', icon: 'handshake' as const, color: '#34D399' }
      : { label: 'I am Inquisitor!', text: 'I have Inquisitor!', icon: 'magnify' as const, color: '#F4C04E' };

  const rest = [
    { label: 'I am Contessa!', text: 'I have Contessa!', icon: 'shield-crown' as const, color: COUP.crimson },
    { label: 'Doubt it!', text: 'Doubt it!', icon: 'flag-outline' as const, color: COUP.crimson },
    { label: 'Allow!', text: 'Allowing', icon: 'check' as const, color: '#34D399' },
    { label: 'Block!', text: 'Blocking', icon: 'shield-outline' as const, color: COUP.purple },
    { label: 'Nice play!', text: 'Nice play!', icon: 'thumb-up-outline' as const, color: '#F4C04E' },
  ];

  return [...basic, middle, ...rest];
}
