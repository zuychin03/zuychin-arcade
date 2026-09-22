import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import type {
  CitadelsPublicPlayer,
  CitadelsActionKind,
  CitadelsRole,
} from '@zuychin-arcade/types';
import {
  CITADELS_MIN_PLAYERS,
  CITADELS_ROLE_BY_ID,
  CITADELS_ROLE_ORDER,
} from '@zuychin-arcade/types';
import { getSocket } from '../../hooks/useSocket';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
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
import { CitadelsDistrictView, CitadelsRoleCard, DISTRICT_COLOR } from '../../components/citadels/CitadelsCard';
import { CitadelsMark } from '../../components/citadels/CitadelsArtwork';
import { CitadelsReferenceSheet } from '../../components/citadels/ReferenceSheet';
import { CITADELS } from '../../constants/theme';

import { useCitadelsActions } from '../../components/citadels/useCitadelsActions';
import { useCitadelsDecisionAttention } from '../../components/citadels/useCitadelsDecisionAttention';
import { citadelsForfeitLabel, citadelsNoWinnerMessage, citadelsSkippedTurnMessage, isCitadelsLeavePromptCurrent, isOwnCitadelsCharacterKilled } from '../../components/citadels/decision';

type Mode = 'assassinate' | 'rob' | 'swap' | 'redraw' | 'destroy' | 'laboratory' | null;
const nameWrapping: TextStyle = { minWidth: 0, maxWidth: '100%', ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere' } as TextStyle : {}) };
function phaseLabel(phase: string): string {
  if (phase === 'drafting') return 'SECRET CHARACTER DRAFT';
  if (phase === 'choose_income') return 'GATHER RESOURCES OR USE ABILITIES';
  if (phase === 'choose_cards') return 'CHOOSE A DISTRICT';
  if (phase === 'game_over') return 'FINAL SCORING';
  return 'BUILD AND USE ABILITIES';
}

function playerForfeited(player?: CitadelsPublicPlayer | null): boolean {
  return player?.forfeited === true;
}

function SectionHeading({ children, detail }: { children: string; detail?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 7 }}>
      <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: CITADELS.gold, fontSize: 13, letterSpacing: 1.4 }}>{children}</Text>
      {detail ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 19 }}>{detail}</Text> : null}
    </View>
  );
}

interface ChoiceButtonProps {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  hint?: string;
}

function ChoiceButton({ label, icon, onPress, color = CITADELS.royal, disabled = false, hint }: ChoiceButtonProps) {
  const { fontScale = 1 } = useWindowDimensions();
  return (
    <ScalePressable
      accessibilityLabel={label}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      style={{ minWidth: 48, maxWidth: '100%', minHeight: 52, flexBasis: 184 * Math.max(1, fontScale), flexGrow: 1, flexShrink: 1, borderRadius: 13, borderWidth: 1, borderColor: color, borderTopColor: `${color}AA`, backgroundColor: CITADELS.panel, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: '0 3px 0 #050813', opacity: disabled ? 0.55 : 1 }}
    >
      <MaterialCommunityIcons name={icon} size={20} color={color} />
      <Text style={{ ...nameWrapping, fontFamily: 'Outfit_800ExtraBold', color, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>{label}</Text>
    </ScalePressable>
  );
}

export default function CitadelsGame() {
  const { width, fontScale = 1 } = useWindowDimensions();
  const textScale = Math.max(1, fontScale);
  const [playAreaWidth, setPlayAreaWidth] = useState(0);
  const decisionBesideTable = playAreaWidth >= 900 * textScale;
  const resultsWide = width >= 960 * textScale;
  const compact = width < 640;
  const narrow = width < 370;
  const reduceMotion = useReducedMotionPreference();
  const game = useGameStore((state) => state.citadelsPublic);
  const mine = useGameStore((state) => state.citadelsPrivate);
  const room = useGameStore((state) => state.room);
  const playerId = useGameStore((state) => state.playerId);
  const token = useGameStore((state) => state.token);
  const [rules, setRules] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const actions = useCitadelsActions();
  const dialogOpen = useDialogStore((state) => state.dialog !== null);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const connectionState: string = actions.connected ? 'connected' : 'reconnecting';
  const stateSynced = actions.synced;
  const feedback = actionMessage ?? actions.message;
  const [isLeaving, setIsLeaving] = useState(false);
  const mainScrollRef = useRef<ScrollView>(null);
  const decisionHeadingRef = useRef<Text>(null);
  const decisionZoneYRef = useRef(0);
  const playAreaYRef = useRef(0);
  const decisionWithinColumnYRef = useRef(0);
  const leavingRef = useRef(false);
  const leaveNotifiedRef = useRef(false);
  const leavePromptOpenRef = useRef(false);
  const ownDialogRef = useRef<DialogConfig | null>(null);
  const leaveEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const modeOpenerRef = useRef<string | null>(null);
  const restoringModeFocusRef = useRef(false);
  const latestGameRef = useRef(game);
  const lifecycleIdentity = useRef(token);
  const nativeBack = useRef<(() => void) | null>(null);
  const approveNavigation = useNativeLeaveGuard(token, () => {
    if (useGameStore.getState().token === token) nativeBack.current?.();
  });
  latestGameRef.current = game;

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
    setActionMessage(null);
    setRules(false);
    setMode(null);
    setSelectedCards([]);
    modeOpenerRef.current = null;
    restoringModeFocusRef.current = false;
  }, [token]);

  const openMode = (next: Exclude<Mode, null>) => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') modeOpenerRef.current = document.activeElement?.getAttribute('aria-label') ?? null;
    setSelectedCards([]);
    setMode(next);
  };

  const cancelMode = useCallback(() => {
    restoringModeFocusRef.current = true;
    setMode(null);
    setSelectedCards([]);
    const label = modeOpenerRef.current;
    const ownerToken = token;
    const captured = useGameStore.getState().citadelsPublic;
    requestAnimationFrame(() => {
      const current = useGameStore.getState();
      if (!mountedRef.current || current.token !== ownerToken || !label || Platform.OS !== 'web'
        || current.citadelsPublic?.roundNumber !== captured?.roundNumber
        || current.citadelsPublic?.activeRole !== captured?.activeRole
        || current.citadelsPublic?.phase !== captured?.phase) return;
      const control = Array.from(document.querySelectorAll<HTMLElement>('[role="button"][aria-label]'))
        .find((element) => element.getAttribute('aria-label') === label && !element.closest('[aria-hidden="true"]') && element.getAttribute('aria-disabled') !== 'true');
      control?.focus({ preventScroll: true });
    });
  }, [token]);

  useEffect(() => {
    setMode(null);
    setSelectedCards([]);
  }, [game?.activePlayerId, game?.draftPlayerId, game?.phase, game?.roundNumber]);

  useEffect(() => {
    if (!mode) return;
    if (!mine?.canUseAbilities || !actions.connected) {
      setMode(null);
      setSelectedCards([]);
      return;
    }
    setSelectedCards((cards) => {
      const valid = cards.filter((id) => mine.hand.some((card) => card.id === id));
      return valid.length === cards.length ? cards : valid;
    });
  }, [actions.connected, mine, mode]);

  const gameOver = game?.status === 'game_over';
  useEffect(() => {
    if (!gameOver) return;
    setRules(false);
    setMode(null);
    setSelectedCards([]);
  }, [gameOver]);

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

  const leave = useCallback(async (destination: '/' | '/citadels' = '/') => {
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
        if (ownsSession()) showDialog('Court notification failed', `${error instanceof Error ? error.message : 'Unknown error'}. Your seat may remain reserved until reconnect grace expires.`);
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
        setActionMessage(`Your saved session could not be cleared. Retry leaving before joining another room. ${error instanceof Error ? error.message : ''}`);
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
    const courtLive = captured.status === 'playing';
    showDialog(
      courtLive ? 'Forfeit this court?' : 'Return to the arcade?',
      courtLive ? 'You will forfeit immediately and cannot win. Legal autopilot finishes only this round, then your seat is removed before the next draft. If fewer than four eligible builders remain, the court ends immediately with no winner or competitive result.' : 'This closes your builder seat and returns to the arcade.',
      [
        { text: 'STAY', style: 'cancel', onPress: () => { if (ownsPrompt() && epoch === leaveEpochRef.current) leavePromptOpenRef.current = false; } },
        { text: 'LEAVE', style: 'destructive', onPress: () => {
          if (!ownsPrompt()) return;
          if (!isCitadelsLeavePromptCurrent(captured, useGameStore.getState().citadelsPublic, epoch, leaveEpochRef.current)) return;
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
    if (mode) {
      cancelMode();
      return;
    }
    requestLeave();
  }, [cancelMode, mode, requestLeave, room?.roomCode, rules, token]);

  useLayoutEffect(() => { nativeBack.current = handleBack; }, [handleBack]);
  useWebBackGuard('/citadels/game', handleBack, token !== null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]);

  const localDecisionPlayer = game?.players.find((player) => player.playerId === playerId);
  const localDecisionKey = game && mine && playerId && localDecisionPlayer && !playerForfeited(localDecisionPlayer)
    ? mode
      ? `mode:${mode}:${game.roundNumber}:${game.activePlayerId}:${game.activeRole}`
      : game.phase === 'drafting' && mine.availableRoles.length
        ? `draft:${game.roundNumber}:${mine.availableRoles.join(',')}`
        : game.phase === 'choose_income' && game.activePlayerId === playerId
          ? `income:${game.roundNumber}:${game.activePlayerId}:${game.activeRole}`
          : game.phase === 'choose_cards' && game.activePlayerId === playerId
            ? `keep:${game.roundNumber}:${mine.drawnCards.map((card) => card.id).join(',')}`
            : game.phase === 'action' && mine.canAct
              ? `action:${game.roundNumber}:${game.activePlayerId}:${game.activeRole}`
              : null
    : null;

  const focusDecision = useCallback(() => {
    if (restoringModeFocusRef.current) {
      restoringModeFocusRef.current = false;
      return true;
    }
    if (!decisionHeadingRef.current) return false;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      if (mode === 'redraw' || mode === 'laboratory') {
        const card = Array.from(document.querySelectorAll<HTMLElement>('[role="button"][aria-label]'))
          .find((element) => element.getAttribute('aria-label')?.startsWith('SELECT.') && !element.closest('[aria-hidden="true"]'));
        if (!card) return false;
        card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        card.focus({ preventScroll: true });
        return true;
      }
      const heading = document.getElementById('citadels-decision-heading');
      if (!heading) return false;
      heading.setAttribute('tabindex', '-1');
      heading.scrollIntoView({ block: 'start', inline: 'nearest' });
      heading.focus({ preventScroll: true });
    } else {
      mainScrollRef.current?.scrollTo({ y: Math.max(0, decisionZoneYRef.current - 10), animated: !reduceMotion });
      const handle = findNodeHandle(decisionHeadingRef.current);
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }
    return true;
  }, [mode, reduceMotion]);
  useCitadelsDecisionAttention(localDecisionKey, rules || dialogOpen || Boolean(gameOver) || actions.busy || isLeaving, focusDecision);

  const meForAnnouncement = game?.players.find((player) => player.playerId === playerId);
  const activeForAnnouncement = game?.players.find((player) => player.playerId === game.activePlayerId);
  const drafterForAnnouncement = game?.players.find((player) => player.playerId === game.draftPlayerId);
  const winnerForAnnouncement = game?.players.find((player) => game.winnerIds.includes(player.playerId));
  const skippedTurnMessage = isOwnCitadelsCharacterKilled(game, mine, playerId) && !playerForfeited(meForAnnouncement)
    ? citadelsSkippedTurnMessage(CITADELS_ROLE_BY_ID[mine!.chosenRole!].name, Boolean(game?.firstCompletedPlayerId))
    : null;
  const decisionAnnouncement = useMemo(() => {
    if (!game || !mine || !playerId) return 'Restoring the royal court.';
    if (connectionState === 'error') return 'Connection failed. Decisions are paused.';
    if (connectionState === 'reconnecting' || !stateSynced) return 'Reconnecting. Decisions are paused while the table refreshes.';
    if (feedback) return feedback;
    if (game.status === 'game_over') return winnerForAnnouncement ? `${winnerForAnnouncement.displayName} wins with ${winnerForAnnouncement.score ?? 0} points.` : citadelsNoWinnerMessage(game.terminationReason);
    if (playerForfeited(meForAnnouncement)) return citadelsForfeitLabel(game, playerId);
    if (skippedTurnMessage) return skippedTurnMessage;
    if (game.phase === 'drafting') return mine.availableRoles.length ? 'Choose your secret character.' : `Waiting for ${drafterForAnnouncement?.displayName ?? 'the next builder'} to draft.`;
    if (game.activePlayerId === playerId) {
      if (game.phase === 'choose_income') return 'Choose income, or use an available ability first.';
      if (game.phase === 'choose_cards') return 'Choose one district card to keep.';
      return 'Your action step. Build, use abilities, or end the character turn.';
    }
    return `Waiting for ${activeForAnnouncement?.displayName ?? 'the next character'}.`;
  }, [feedback, activeForAnnouncement?.displayName, connectionState, drafterForAnnouncement?.displayName, game, meForAnnouncement, mine, playerId, skippedTurnMessage, stateSynced, winnerForAnnouncement]);

  useWebModalFocus(Boolean(gameOver) && !dialogOpen, 'citadels-game-over', requestLeave);

  if (!game || !mine || !playerId) return <GameRecovery onSessionCleared={handleSessionCleared} message="Restoring the royal court…" background={CITADELS.bg} surface={CITADELS.surface} border={CITADELS.border} accent={CITADELS.royal} muted={CITADELS.muted} icon="castle" />;

  const me = game.players.find((player) => player.playerId === playerId);
  if (!me) return <GameRecovery onSessionCleared={handleSessionCleared} message="Restoring your builder seat…" background={CITADELS.bg} surface={CITADELS.surface} border={CITADELS.border} accent={CITADELS.royal} muted={CITADELS.muted} icon="castle" />;

  const active = game.players.find((player) => player.playerId === game.activePlayerId);
  const drafter = game.players.find((player) => player.playerId === game.draftPlayerId);
  const isHost = room?.players.find((player) => player.playerId === playerId)?.isHost ?? false;
  const activeSeats = room?.players.filter((player) => !player.hasLeft) ?? [];
  const connectedRematchPlayers = activeSeats.filter((player) => player.isConnected).length;
  const newBuildersNeeded = Math.max(0, CITADELS_MIN_PLAYERS - activeSeats.length);
  const rematchNeedsNewCourt = newBuildersNeeded > 0;
  const rematchReady = connectedRematchPlayers >= CITADELS_MIN_PLAYERS && connectedRematchPlayers === activeSeats.length;
  const winner = game.players.find((player) => game.winnerIds.includes(player.playerId));
  const unscored = game.terminationReason === 'not_enough_players';
  const canUseAbilities = mine.canUseAbilities;
  const effectiveBuildCosts = mine.effectiveBuildCosts;
  const legalBuildCardIds = mine.legalBuildCardIds;
  const busy = actions.busy || isLeaving || cleanupPending || playerForfeited(me);
  const selectingCards = mode === 'redraw' || mode === 'laboratory';
  const roleTargets = CITADELS_ROLE_ORDER.filter((role) => mode === 'assassinate' ? role !== 'assassin' : !['assassin', 'thief'].includes(role) && role !== game.killedRole);
  const myRole = mine.chosenRole ? CITADELS_ROLE_BY_ID[mine.chosenRole] : null;
  const canTax = canUseAbilities && !!mine.chosenRole && ['king', 'bishop', 'merchant', 'warlord'].includes(mine.chosenRole) && !mine.taxUsed;
  const characterStatus = mine.chosenRole === 'merchant'
    ? 'EXTRA GOLD APPLIED'
    : mine.chosenRole && ['assassin', 'thief', 'magician', 'architect', 'warlord'].includes(mine.chosenRole)
      ? `CHARACTER ${mine.specialUsed ? 'USED' : 'READY'}`
      : 'PASSIVE ROLE';
  const taxStatus = mine.chosenRole && ['king', 'bishop', 'merchant', 'warlord'].includes(mine.chosenRole)
    ? `TAX ${mine.taxUsed ? 'USED' : 'READY'}`
    : 'NO DISTRICT TAX';
  const goldIncome = me.city.some((district) => district.effect === 'gold_mine') ? 3 : 2;
  const drawCount = me.city.some((district) => district.effect === 'observatory') ? 3 : 2;
  const keepCountLabel = me.city.some((district) => district.effect === 'library') ? `DRAW ${drawCount} · KEEP ALL` : `DRAW ${drawCount} · KEEP 1`;

  const sendAction = (_event: string, action: Exclude<CitadelsActionKind, 'start'>, label: string, payload: Record<string, unknown> = {}) => {
    if (busy) return false;
    setActionMessage(null);
    return actions.send(action, payload, label, game.revision);
  };

  const rematch = () => {
    if (busy || !rematchReady) return;
    setActionMessage(null);
    actions.send('start', {}, 'Start rematch', game.revision);
  };

  const toggleSelected = (cardId: string) => {
    setSelectedCards((cards) => {
      if (mode === 'laboratory' && !cards.includes(cardId)) return [cardId];
      return cards.includes(cardId) ? cards.filter((id) => id !== cardId) : [...cards, cardId];
    });
  };

  const choosePowerRole = (targetRole: CitadelsRole) => {
    sendAction('citadels:power', 'power', mode === 'assassinate' ? `Mark ${CITADELS_ROLE_BY_ID[targetRole].name}` : `Set robbery on ${CITADELS_ROLE_BY_ID[targetRole].name}`, { action: mode === 'assassinate' ? 'assassinate' : 'rob', targetRole });
    setMode(null);
  };

  const decisionTitle = playerForfeited(me)
    ? citadelsForfeitLabel(game, playerId)
    : skippedTurnMessage ? 'YOUR TURN IS SKIPPED' : game.phase === 'drafting'
      ? mine.availableRoles.length ? 'CHOOSE YOUR SECRET CHARACTER' : mine.chosenRole ? `YOUR ${CITADELS_ROLE_BY_ID[mine.chosenRole].name.toUpperCase()} IS LOCKED` : `WAITING FOR ${(drafter?.displayName ?? 'THE NEXT BUILDER').toUpperCase()}`
      : game.activePlayerId === playerId
        ? game.phase === 'choose_income' ? 'CHOOSE INCOME OR USE AN ABILITY' : game.phase === 'choose_cards' ? 'KEEP ONE DISTRICT PLAN' : `YOUR ${myRole?.name.toUpperCase() ?? 'CHARACTER'} ACTION STEP`
        : `WAITING FOR ${(active?.displayName ?? 'THE NEXT CHARACTER').toUpperCase()}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: CITADELS.bg }} edges={['top', 'right', 'bottom', 'left']}>
      <Text accessible accessibilityLiveRegion={connectionState === 'error' ? 'assertive' : 'polite'} style={{ position: 'absolute', left: -10_000, width: 1, height: 1, overflow: 'hidden' }}>{decisionAnnouncement}</Text>
      <ScrollView
        ref={mainScrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ width: '100%', maxWidth: 1240, alignSelf: 'center', paddingHorizontal: narrow ? 10 : compact ? 14 : 20, paddingTop: 10, gap: 16, paddingBottom: 44 }}
        showsVerticalScrollIndicator={false}
      >
        <View nativeID="citadels-toolbar" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8 }}>
          <ScalePressable accessibilityLabel="Back to arcade" accessibilityHint="Opens a confirmation before leaving this court" disabled={isLeaving} onPress={requestLeave} style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: CITADELS.border, backgroundColor: CITADELS.surface, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={CITADELS.royal} />
          </ScalePressable>
          <View style={{ flexBasis: 240, flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: CITADELS.border, backgroundColor: CITADELS.surface, paddingHorizontal: 12, paddingVertical: 10 }}>
            {!narrow ? <CitadelsMark size={38} /> : null}
            <View style={{ flexBasis: 180, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
              <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: CITADELS.royal, fontSize: narrow ? 14 : compact ? 15 : 17, letterSpacing: compact ? 1.2 : 2 }}>ROUND {game.roundNumber}</Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 18 }}>{unscored ? 'COURT ENDED' : phaseLabel(game.phase)}</Text>
            </View>
            <View accessible accessibilityLabel={`${me.gold} gold. ${me.city.length} of 7 districts.`} style={{ minWidth: 0, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 6, gap: 2, borderRadius: 10, borderWidth: 1, borderColor: `${CITADELS.gold}55`, backgroundColor: CITADELS.bg }}>
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: CITADELS.gold, fontSize: 16 }}>{me.gold} GOLD</Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 18 }}>{me.city.length}/7 BUILT</Text>
            </View>
            <ScalePressable accessibilityLabel="Open rules" accessibilityHint="Opens the Digital Original Cast rules" onPress={() => setRules(true)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="book-open-variant" size={22} color={CITADELS.gold} />
            </ScalePressable>
          </View>
        </View>

        {game.modeDescription ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 8 }}>{narrow ? 'DIGITAL ORIGINAL CAST · CURATED CUSTOM 14 · TAP RULES FOR DIGITAL ADAPTATIONS' : game.modeDescription}</Text> : null}

        {game.status === 'playing' && game.phase !== 'drafting' && myRole && !me.revealedRole ? (
          <View accessible accessibilityLabel={`Your secret character is ${myRole.name}, rank ${myRole.rank}.`} style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: `${CITADELS.violet}77`, backgroundColor: `${CITADELS.violet}12`, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="incognito" size={18} color={CITADELS.violet} />
            <Text style={{ flexShrink: 1, fontFamily: 'SpaceMono_700Bold', color: CITADELS.violet, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>YOUR SECRET CHARACTER · {myRole.name.toUpperCase()} · RANK {myRole.rank}</Text>
          </View>
        ) : null}

        {connectionState !== 'connected' ? (
          <View accessible accessibilityLabel="Connection status" style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: `${CITADELS.crimson}77`, backgroundColor: `${CITADELS.crimson}12`, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="connection" size={17} color={CITADELS.crimson} />
            <Text style={{ flex: 1, fontFamily: 'SpaceMono_700Bold', color: CITADELS.crimson, fontSize: 13, lineHeight: 19 }}>{connectionState === 'error' ? 'Could not reconnect. Check your network.' : 'Reconnecting. Decisions are paused until the court refreshes…'}</Text>
          </View>
        ) : null}
        {connectionState === 'connected' && (!stateSynced || feedback) ? (
          <View style={{ minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: CITADELS.border, backgroundColor: CITADELS.surface, paddingHorizontal: 11, justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'SpaceMono_700Bold', color: CITADELS.gold, fontSize: 13, lineHeight: 19 }}>{!stateSynced ? feedback ?? 'Refreshing the court…' : feedback}</Text>
          </View>
        ) : null}

        {game.firstCompletedPlayerId ? (
          <View accessible accessibilityLabel={`${game.players.find((player) => player.playerId === game.firstCompletedPlayerId)?.displayName ?? 'A builder'} completed the first city. The final round continues through every remaining character.`} style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: `${CITADELS.gold}77`, backgroundColor: `${CITADELS.gold}12`, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="flag-checkered" size={18} color={CITADELS.gold} />
            <Text nativeID="citadels-completion-banner" style={{ ...nameWrapping, flex: 1, fontFamily: 'SpaceMono_700Bold', color: CITADELS.gold, fontSize: 13, lineHeight: 19 }}>{game.players.find((player) => player.playerId === game.firstCompletedPlayerId)?.displayName ?? 'A builder'} completed the first city. Final scoring waits until every remaining character is called.</Text>
          </View>
        ) : null}

        <View nativeID="citadels-play-area"
          onLayout={(event) => { playAreaYRef.current = event.nativeEvent.layout.y; decisionZoneYRef.current = playAreaYRef.current + decisionWithinColumnYRef.current; setPlayAreaWidth(event.nativeEvent.layout.width); }}
          style={{ flexDirection: decisionBesideTable ? 'row' : 'column', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20 }}>
        <View nativeID="citadels-private-table" style={{ width: decisionBesideTable ? undefined : '100%', flexBasis: decisionBesideTable ? 460 : undefined, flexGrow: 1.3, flexShrink: 1, minWidth: 0, maxWidth: '100%', gap: 16 }}>
        <View nativeID="citadels-private-hand" style={{ borderRadius: 16, borderWidth: 1, borderTopWidth: 3, borderColor: CITADELS.border, borderTopColor: '#050813', backgroundColor: '#0B1121', padding: narrow ? 11 : 13, gap: 10 }}>
          <SectionHeading detail={`${mine.hand.length} plan${mine.hand.length === 1 ? '' : 's'} · inspect before choosing`}>YOUR DISTRICT HAND</SectionHeading>
          {mine.hand.length ? (
            <ScrollView nativeID="citadels-hand" horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 12, paddingTop: 14, paddingBottom: 16, paddingHorizontal: 2 }}>
              {mine.hand.map((card) => {
                const selected = selectedCards.includes(card.id);
                const buildCost = effectiveBuildCosts[card.id] ?? card.cost;
                const duplicate = me.city.some((built) => built.name === card.name);
                const canBuildCard = mine.canAct && !busy && !mode && legalBuildCardIds.includes(card.id);
                const selectable = selectingCards && canUseAbilities && !busy;
                const buildReason = duplicate ? 'DUPLICATE' : me.gold < buildCost ? `NEED ${buildCost} GOLD` : mine.builtThisTurn >= mine.buildLimit ? 'BUILD LIMIT REACHED' : 'WAITING';
                return (
                  <CitadelsDistrictView
                    key={card.id}
                    card={card}
                    compact={compact}
                    selected={selected}
                    disabled={selectingCards ? !selectable : !canBuildCard}
                    onPress={selectable ? () => toggleSelected(card.id) : canBuildCard ? () => sendAction('citadels:build', 'build', `Build ${card.name}`, { cardId: card.id }) : undefined}
                    actionLabel={selectingCards ? selected ? 'SELECTED' : 'SELECT' : canBuildCard ? `BUILD · ${buildCost} GOLD` : buildReason}
                  />
                );
              })}
            </ScrollView>
          ) : <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 19 }}>Your district hand is empty. Choose card income on a future character turn.</Text>}
        </View>

        <View
          nativeID="citadels-decision-area"
          onLayout={(event) => { decisionWithinColumnYRef.current = event.nativeEvent.layout.y; decisionZoneYRef.current = playAreaYRef.current + decisionWithinColumnYRef.current; }}
          style={{ minWidth: 0, maxWidth: '100%', borderRadius: 18, borderWidth: localDecisionKey ? 2 : 1, borderColor: localDecisionKey ? CITADELS.royal : CITADELS.border, backgroundColor: CITADELS.surface, padding: narrow ? 11 : 15, gap: 14, boxShadow: '0 4px 0 #050813, 0 7px 16px rgba(0,0,0,0.18)' }}
        >
          <Text ref={decisionHeadingRef} nativeID="citadels-decision-heading" accessible accessibilityRole="header" style={{ ...nameWrapping, fontFamily: 'Outfit_800ExtraBold', color: localDecisionKey ? CITADELS.royal : CITADELS.text, fontSize: 16, lineHeight: 21, textAlign: 'center' }}>{decisionTitle}</Text>
          {skippedTurnMessage ? <Text nativeID="citadels-skipped-turn" style={{ fontFamily: 'Outfit_400Regular', color: CITADELS.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' }}>{skippedTurnMessage}</Text> : null}
          {playerForfeited(me) ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.crimson, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>{game.status === 'playing' && game.turnOrder.includes(playerId) ? 'Legal autopilot finishes only this round. Your seat is removed before the next draft and cannot win.' : 'Your seat is no longer playing and cannot win. Its city remains visible as history.'}</Text> : null}

          {game.phase === 'drafting' ? (
            <>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>{game.faceUpDiscard.length ? `Publicly unavailable: ${game.faceUpDiscard.map((role) => CITADELS_ROLE_BY_ID[role].name).join(', ')}. One or more other roles remain hidden.` : 'No character was discarded face up. At least one unchosen role stays hidden.'}</Text>
              {mine.availableRoles.length ? (
                <ScrollView nativeID="citadels-draft" horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 12, paddingTop: 12, paddingBottom: 16, paddingHorizontal: 2 }}>
                  {mine.availableRoles.map((role) => <CitadelsRoleCard key={role} role={role} compact={compact} disabled={busy} actionLabel="CHOOSE SECRETLY" onPress={() => sendAction('citadels:choose-character', 'choose_character', `Choose ${CITADELS_ROLE_BY_ID[role].name}`, { role })} />)}
                </ScrollView>
              ) : mine.chosenRole ? <View style={{ alignItems: 'center' }}><CitadelsRoleCard role={mine.chosenRole} compact actionLabel="LOCKED · PRIVATE" /></View> : null}
            </>
          ) : null}

          {game.phase === 'choose_income' && game.activePlayerId === playerId ? (
            <View nativeID="citadels-income-options" style={{ gap: 12 }}>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>You may use an available character or district ability before taking income. Building unlocks after income resolves.</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <ChoiceButton label={`TAKE ${goldIncome} GOLD`} icon="gold" color={CITADELS.gold} disabled={busy || mode !== null} onPress={() => sendAction('citadels:choose-income', 'choose_income', `Take ${goldIncome} gold`, { choice: 'gold' })} />
                <ChoiceButton label={keepCountLabel} icon="cards-outline" disabled={busy || mode !== null} onPress={() => sendAction('citadels:choose-income', 'choose_income', 'Draw district income', { choice: 'cards' })} />
              </View>
            </View>
          ) : null}

          {game.phase === 'choose_cards' && game.activePlayerId === playerId ? (
            <ScrollView nativeID="citadels-income" horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 12, paddingTop: 12, paddingBottom: 16, paddingHorizontal: 2 }}>
              {mine.drawnCards.map((card) => <CitadelsDistrictView key={card.id} card={card} compact={compact} disabled={busy} actionLabel="KEEP THIS PLAN" onPress={() => sendAction('citadels:keep-district', 'keep_district', `Keep ${card.name}`, { cardId: card.id })} />)}
            </ScrollView>
          ) : null}

          {canUseAbilities && myRole ? (
            <View style={{ gap: 9 }}>
              <View style={{ gap: 9 }}>
                <View style={{ minWidth: 0 }}>
                  <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: CITADELS.gold, fontSize: 15 }}>{myRole.name.toUpperCase()} ABILITIES</Text>
                  <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 19, marginTop: 3 }}>{myRole.summary}</Text>
                  <Text style={{ fontFamily: 'SpaceMono_700Bold', color: CITADELS.royal, fontSize: 13, lineHeight: 19, marginTop: 6 }}>BUILD {mine.builtThisTurn}/{mine.buildLimit} · {characterStatus} · {taxStatus}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {mine.chosenRole === 'assassin' ? <ChoiceButton label="NAME A CHARACTER" icon="knife-military" color={CITADELS.crimson} disabled={busy || mode !== null || mine.specialUsed} onPress={() => openMode('assassinate')} /> : null}
                {mine.chosenRole === 'thief' ? <ChoiceButton label="SET A ROBBERY" icon="hand-coin-outline" color={CITADELS.crimson} disabled={busy || mode !== null || mine.specialUsed} onPress={() => openMode('rob')} /> : null}
                {mine.chosenRole === 'magician' ? (
                  <>
                    <ChoiceButton label="SWAP ENTIRE HAND" icon="swap-horizontal" disabled={busy || mode !== null || mine.specialUsed} onPress={() => openMode('swap')} />
                    <ChoiceButton label="REDRAW SELECTED PLANS" icon="auto-fix" color={CITADELS.violet} disabled={busy || mode !== null || mine.specialUsed || !mine.hand.length} onPress={() => { setSelectedCards([]); openMode('redraw'); }} />
                  </>
                ) : null}
                {mine.chosenRole === 'architect' ? <ChoiceButton label="DRAW 2 ARCHITECT PLANS" icon="compass-outline" disabled={busy || mode !== null || mine.specialUsed} onPress={() => sendAction('citadels:power', 'power', 'Draw Architect plans', { action: 'architect_draw' })} /> : null}
                {canTax ? <ChoiceButton label="COLLECT DISTRICT TAX" icon="cash-multiple" color={CITADELS.gold} disabled={busy || mode !== null} onPress={() => sendAction('citadels:power', 'power', 'Collect district tax', { action: 'tax' })} /> : null}
                {mine.chosenRole === 'warlord' ? <ChoiceButton label="DESTROY A DISTRICT" icon="shield-sword-outline" color={CITADELS.crimson} disabled={busy || mode !== null || mine.specialUsed} onPress={() => openMode('destroy')} /> : null}
                {mine.usableDistrictIds.map((id) => {
                  const district = me.city.find((card) => card.id === id);
                  if (!district) return null;
                  return <ChoiceButton key={id} label={district.effect === 'laboratory' ? 'USE LABORATORY' : 'USE SMITHY · PAY 2 GOLD'} icon={district.effect === 'laboratory' ? 'flask-outline' : 'anvil'} color={CITADELS.violet} disabled={busy || mode !== null} onPress={() => district.effect === 'laboratory' ? (setSelectedCards([]), openMode('laboratory')) : sendAction('citadels:district-power', 'district_power', 'Use Smithy', { districtId: id })} />;
                })}
              </View>
            </View>
          ) : null}

          {mode === 'assassinate' || mode === 'rob' ? (
            <View style={{ borderRadius: 14, borderWidth: 1, borderColor: CITADELS.crimson, backgroundColor: `${CITADELS.crimson}0C`, padding: 11, gap: 8 }}>
              <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: CITADELS.crimson, textAlign: 'center' }}>{mode === 'assassinate' ? 'WHICH CHARACTER WILL LOSE ITS TURN?' : 'WHICH CHARACTER WILL BE ROBBED?'}</Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>Choose a character rank, never a named player. The choice is final once confirmed.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>{roleTargets.map((role) => <ChoiceButton key={role} label={`${CITADELS_ROLE_BY_ID[role].rank} · ${CITADELS_ROLE_BY_ID[role].name.toUpperCase()}`} icon="account-question-outline" color={CITADELS.crimson} disabled={busy} onPress={() => choosePowerRole(role)} />)}</View>
              <NeonButton label="CANCEL CHARACTER CHOICE" color={CITADELS.muted} variant="ghost" disabled={busy} onPress={cancelMode} />
            </View>
          ) : null}

          {mode === 'swap' ? (
            <View style={{ borderRadius: 14, borderWidth: 1, borderColor: CITADELS.royal, padding: 11, gap: 7 }}>
              <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: CITADELS.royal, textAlign: 'center' }}>SWAP YOUR ENTIRE HAND WITH</Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>Both complete hands are exchanged. You do not see the other hand before choosing.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>{game.players.filter((player) => player.playerId !== playerId && game.turnOrder.includes(player.playerId)).map((player) => <ChoiceButton key={player.playerId} label={`${player.displayName.toUpperCase()} · ${player.handCount} CARDS`} icon="account-switch-outline" disabled={busy} onPress={() => { sendAction('citadels:power', 'power', `Swap hands with ${player.displayName}`, { action: 'swap_hand', targetPlayerId: player.playerId }); setMode(null); }} />)}</View>
              <NeonButton label="CANCEL HAND SWAP" color={CITADELS.muted} variant="ghost" disabled={busy} onPress={cancelMode} />
            </View>
          ) : null}

          {mode === 'redraw' || mode === 'laboratory' ? (
            <View style={{ borderRadius: 14, borderWidth: 1, borderColor: CITADELS.violet, padding: 11, gap: 7 }}>
              <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: CITADELS.violet, textAlign: 'center' }}>{mode === 'redraw' ? 'SELECT PLANS TO REPLACE' : 'SELECT ONE PLAN FOR THE LABORATORY'}</Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>Select in your hand above. {selectedCards.length} selected.</Text>
              <NeonButton
                label={mode === 'redraw' ? `REDRAW ${selectedCards.length} PLAN${selectedCards.length === 1 ? '' : 'S'}` : 'DISCARD 1 PLAN · GAIN 2 GOLD'}
                color={CITADELS.violet}
                disabled={busy || (mode === 'laboratory' ? selectedCards.length !== 1 : selectedCards.length < 1)}
                onPress={() => {
                  if (mode === 'redraw') sendAction('citadels:power', 'power', `Redraw ${selectedCards.length} plans`, { action: 'redraw_hand', cardIds: selectedCards });
                  else {
                    const district = me.city.find((card) => card.effect === 'laboratory');
                    if (district) sendAction('citadels:district-power', 'district_power', 'Use Laboratory', { districtId: district.id, cardId: selectedCards[0] });
                  }
                  setMode(null);
                  setSelectedCards([]);
                }}
              />
              <NeonButton label="CANCEL PLAN SELECTION" color={CITADELS.muted} variant="ghost" disabled={busy} onPress={cancelMode} />
            </View>
          ) : null}

          {mode === 'destroy' ? (
            <View nativeID="citadels-destruction-targets" style={{ minWidth: 0, borderRadius: 14, borderWidth: 1, borderColor: CITADELS.crimson, backgroundColor: `${CITADELS.crimson}0C`, padding: 11, gap: 10 }}>
              <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: CITADELS.crimson, fontSize: 16, textAlign: 'center' }}>CHOOSE A LEGAL DISTRICT TO DESTROY</Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>You may target any incomplete city, including your own. Completed cities, the living Bishop&apos;s city and Keeps are protected. Great Wall raises the cost of destroying another district by one.</Text>
              {game.players.filter((player) => player.city.length > 0 && game.turnOrder.includes(player.playerId)).map((player) => {
                const completed = player.city.length >= 7;
                const bishopProtected = player.revealedRole === 'bishop' && game.killedRole !== 'bishop';
                return (
                  <View key={player.playerId} style={{ gap: 6 }}>
                    <Text accessibilityRole="header" style={{ ...nameWrapping, fontFamily: 'Outfit_800ExtraBold', color: CITADELS.text }}>{player.displayName.toUpperCase()}{player.playerId === playerId ? ' · YOUR CITY' : ''}{completed ? ' · COMPLETE' : bishopProtected ? ' · BISHOP PROTECTED' : ''}</Text>
                    <ScrollView nativeID={`citadels-target-${player.playerId}`} horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 12, paddingTop: 12, paddingBottom: 16, paddingHorizontal: 2 }}>
                      {player.city.map((card) => {
                        const price = Math.max(0, card.cost - 1) + (card.effect !== 'great_wall' && player.city.some((built) => built.effect === 'great_wall') ? 1 : 0);
                        const protectedDistrict = completed || bishopProtected || card.effect === 'keep';
                        const affordable = me.gold >= price;
                        const enabled = !protectedDistrict && affordable && !busy;
                        const actionLabel = completed ? 'COMPLETE CITY' : bishopProtected ? 'BISHOP PROTECTED' : card.effect === 'keep' ? 'KEEP PROTECTED' : !affordable ? `NEED ${price} GOLD` : `DESTROY · ${price} GOLD`;
                        return <CitadelsDistrictView key={card.id} card={card} compact disabled={!enabled} actionLabel={actionLabel} onPress={enabled ? () => { sendAction('citadels:power', 'power', `Destroy ${player.displayName}'s ${card.name}`, { action: 'destroy', targetPlayerId: player.playerId, districtId: card.id }); setMode(null); } : undefined} />;
                      })}
                    </ScrollView>
                  </View>
                );
              })}
              <NeonButton label="CANCEL DESTRUCTION" color={CITADELS.muted} variant="ghost" disabled={busy} onPress={cancelMode} />
            </View>
          ) : null}

          {mine.canAct && mode === null ? (
            <NeonButton label="END CHARACTER TURN" color={CITADELS.gold} variant="outline" disabled={busy} icon={<MaterialCommunityIcons name="check-circle-outline" size={17} color={CITADELS.gold} />} onPress={() => sendAction('citadels:end-turn', 'end_turn', 'End character turn')} />
          ) : null}
        </View>

        </View>
        <View nativeID="citadels-public-table" style={{ width: decisionBesideTable ? undefined : '100%', flexBasis: decisionBesideTable ? 340 : undefined, flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: '100%', gap: 16 }}>
        <View nativeID="citadels-roster" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {game.players.map((player) => {
            const isActive = player.playerId === game.activePlayerId;
            const roomSeat = room?.players.find((seat) => seat.playerId === player.playerId);
            const forfeited = playerForfeited(player);
            const connectionLabel = forfeited ? citadelsForfeitLabel(game, player.playerId) : roomSeat?.isConnected === false ? 'RECONNECTING · SEAT RESERVED BRIEFLY' : isActive ? 'ACTING NOW' : '';
            return (
              <View key={player.playerId} accessible accessibilityLabel={`${player.displayName}. ${player.gold} gold, ${player.handCount} cards, ${player.city.length} districts.${player.isCrowned ? ' Crown holder.' : ''}${player.revealedRole ? ` Revealed as ${CITADELS_ROLE_BY_ID[player.revealedRole].name}.` : ''}${connectionLabel ? ` ${connectionLabel}.` : ''}`} style={{ minWidth: 0, maxWidth: '100%', flexBasis: compact ? '100%' : 210 * textScale, flexGrow: 1, flexShrink: 1, borderRadius: 14, borderWidth: isActive ? 2 : 1, borderColor: forfeited ? CITADELS.crimson : isActive ? CITADELS.royal : CITADELS.border, backgroundColor: CITADELS.surface, padding: 12, boxShadow: '0 3px 0 #050813' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialCommunityIcons name={player.isCrowned ? 'crown' : 'account-outline'} size={17} color={player.isCrowned ? CITADELS.gold : forfeited ? CITADELS.crimson : CITADELS.royal} />
                  <Text nativeID={`citadels-roster-name-${player.playerId}`} style={{ ...nameWrapping, flex: 1, fontFamily: 'Outfit_800ExtraBold', color: player.playerId === playerId ? CITADELS.gold : CITADELS.text }}>{player.displayName}</Text>
                </View>
                <Text style={{ fontFamily: 'SpaceMono_700Bold', color: CITADELS.royal, fontSize: 13, lineHeight: 19, marginTop: 4 }}>{player.gold} GOLD · {player.handCount} CARDS</Text>
                <Text style={{ fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 19, marginTop: 2 }}>{player.city.length}/7 DISTRICTS{player.revealedRole ? ` · ${CITADELS_ROLE_BY_ID[player.revealedRole].name.toUpperCase()}` : ''}</Text>
                {connectionLabel ? <Text style={{ fontFamily: 'SpaceMono_700Bold', color: forfeited || roomSeat?.isConnected === false ? CITADELS.crimson : CITADELS.emerald, fontSize: 13, lineHeight: 19, marginTop: 3 }}>{connectionLabel}</Text> : null}
                <View accessible={false} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 9, paddingBottom: 3 }}>{player.city.map((district) => <View key={district.id} style={{ width: 14, height: 20, borderRadius: 3, borderTopWidth: 1, borderTopColor: '#FFFFFF77', backgroundColor: DISTRICT_COLOR[district.color], boxShadow: '0 2px 0 #050813' }} />)}</View>
              </View>
            );
          })}
        </View>

        <View nativeID="citadels-cities" style={{ minWidth: 0, borderRadius: 18, borderWidth: 1, borderTopWidth: 3, borderColor: CITADELS.border, borderTopColor: '#050813', backgroundColor: '#0B1121', padding: 13, gap: 14 }}>
          <SectionHeading detail={`${game.players.filter((player) => !player.forfeited).length} eligible · ${game.players.filter((player) => !game.turnOrder.includes(player.playerId)).length} removed`}>CITIES OF THE REALM</SectionHeading>
          {game.players.map((player) => (
            <View key={player.playerId} style={{ borderTopWidth: 1, borderTopColor: CITADELS.border, paddingTop: 9 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <Text nativeID={`citadels-city-name-${player.playerId}`} style={{ ...nameWrapping, flexBasis: 150, flexGrow: 1, flexShrink: 1, fontFamily: 'Outfit_800ExtraBold', color: player.playerId === playerId ? CITADELS.royal : CITADELS.text, fontSize: 16 }}>{player.displayName}{playerForfeited(player) ? ` · ${citadelsForfeitLabel(game, player.playerId)}` : ''}</Text>
                <Text style={{ fontFamily: 'SpaceMono_700Bold', color: CITADELS.muted, fontSize: 13, lineHeight: 19 }}>{player.city.reduce((sum, card) => sum + card.cost, 0)} PRINTED PTS</Text>
              </View>
              {player.city.length ? <ScrollView nativeID={`citadels-city-${player.playerId}`} horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: 12, paddingTop: 12, paddingBottom: 16, paddingHorizontal: 2 }}>{player.city.map((card) => <CitadelsDistrictView key={card.id} card={card} compact />)}</ScrollView> : <Text style={{ fontFamily: 'Outfit_400Regular', color: CITADELS.muted, fontSize: 15, lineHeight: 22, marginTop: 5 }}>No districts built yet.</Text>}
            </View>
          ))}
        </View>
        </View>
        </View>
        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: CITADELS.border, backgroundColor: CITADELS.surface, padding: 13 }}>
          <SectionHeading>COURT CHRONICLE</SectionHeading>
          {game.log.slice(-8).map((entry) => <Text key={entry.id} style={{ ...nameWrapping, fontFamily: 'SpaceMono_400Regular', color: CITADELS.muted, fontSize: 13, lineHeight: 19, marginTop: 5 }}>{entry.text}</Text>)}
        </View>
      </ScrollView>

      <Modal visible={Boolean(gameOver)} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={requestLeave}>
        <View style={{ flex: 1, backgroundColor: '#000000DD', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', width: '100%' }} style={{ width: '100%', maxWidth: 1040 }}>
            <View nativeID="citadels-game-over" accessibilityLabel={`Court complete. ${winner ? `${winner.displayName} is Master Builder` : 'No eligible winner'} dialog`} accessibilityViewIsModal role="dialog" aria-modal style={{ borderRadius: 20, borderWidth: 2, borderColor: CITADELS.gold, backgroundColor: CITADELS.panel, padding: compact ? 18 : 24, gap: 20, alignItems: 'stretch', boxShadow: '0 5px 0 #050813' }}>
              <View style={{ flexDirection: resultsWide ? 'row' : 'column', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20 }}>
              <View nativeID="citadels-result-summary" style={{ width: resultsWide ? undefined : '100%', flexBasis: resultsWide ? 320 : undefined, flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: '100%', gap: 16 }}>
              <View style={{ alignItems: 'center', gap: 7 }}>
                <CitadelsMark size={76} color={CITADELS.gold} />
                <Text accessibilityRole="header" style={{ ...nameWrapping, width: '100%', fontFamily: 'Outfit_800ExtraBold', color: CITADELS.gold, fontSize: compact ? 24 : 30, textAlign: 'center' }}>{winner ? `${winner.displayName} IS MASTER BUILDER` : 'NO WINNER'}</Text>
                <Text style={{ color: CITADELS.muted, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, textAlign: 'center' }}>{winner ? `${winner.score ?? 0} points after ${game.roundNumber} rounds` : citadelsNoWinnerMessage(game.terminationReason)}</Text>
              </View>
              <View nativeID="citadels-result-actions" style={{ gap: 12 }}>
              {connectionState !== 'connected' || actions.pending ? (
                <View style={{ minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: connectionState === 'error' ? `${CITADELS.crimson}77` : CITADELS.border, backgroundColor: CITADELS.surface, padding: 10, justifyContent: 'center' }}>
                  <Text style={{ fontFamily: 'SpaceMono_700Bold', color: connectionState === 'error' ? CITADELS.crimson : CITADELS.gold, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>{connectionState === 'error' ? 'Could not reconnect. Check your network.' : feedback ?? 'Reconnecting to the court…'}</Text>
                </View>
              ) : null}
              {rematchNeedsNewCourt ? (
                <View accessible accessibilityLabel={`Rematch unavailable. Need ${newBuildersNeeded} new ${newBuildersNeeded === 1 ? 'builder' : 'builders'}. Start a new room.`} style={{ borderRadius: 12, borderWidth: 1, borderColor: `${CITADELS.crimson}88`, backgroundColor: `${CITADELS.crimson}0D`, padding: 11, gap: 8 }}>
                  <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: CITADELS.crimson, fontSize: 13, textAlign: 'center' }}>REMATCH UNAVAILABLE · NEED {newBuildersNeeded} NEW {newBuildersNeeded === 1 ? 'BUILDER' : 'BUILDERS'}</Text>
                  <Text style={{ fontFamily: 'Outfit_400Regular', color: CITADELS.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' }}>Finished rooms cannot accept replacement builders. {isHost ? 'Start a new room to assemble another court.' : 'Ask the host to start a new room.'}</Text>
                  {isHost ? <NeonButton label={isLeaving ? 'LEAVING…' : 'START A NEW ROOM'} color={CITADELS.royal} disabled={isLeaving} accessibilityHint="Closes this finished room and opens Citadels room creation" onPress={() => { void leave('/citadels'); }} /> : null}
                </View>
              ) : isHost ? (
                <NeonButton label={actions.pending ? 'STARTING REMATCH…' : !rematchReady ? `WAITING FOR ${activeSeats.length - connectedRematchPlayers} TO RECONNECT` : 'PLAY AGAIN'} color={CITADELS.royal} disabled={busy || !rematchReady} accessibilityHint="Starts a new Citadels court with the connected builders" onPress={rematch} />
              ) : <Text style={{ fontFamily: 'Outfit_400Regular', color: CITADELS.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' }}>Waiting for the host to offer a rematch.</Text>}
              <NeonButton label={isLeaving ? 'LEAVING…' : 'BACK TO ARCADE'} color={CITADELS.gold} variant="outline" disabled={isLeaving} onPress={requestLeave} />
              </View>
              </View>
              <View nativeID="citadels-result-roster" style={{ width: resultsWide ? undefined : '100%', flexBasis: resultsWide ? 440 : undefined, flexGrow: 1.2, flexShrink: 1, minWidth: 0, maxWidth: '100%', gap: 10 }}>
                <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: CITADELS.gold, fontSize: 16 }}>{unscored ? 'COURT RECORD' : 'FINAL STANDINGS'}</Text>
                {!unscored && game.players.some(playerForfeited) ? <Text style={{ fontFamily: 'Outfit_400Regular', color: CITADELS.muted, fontSize: 16, lineHeight: 24 }}>Eligible builders rank first. Forfeited seats follow with zero points and cannot win.</Text> : null}
                {[...game.players].sort((a, b) => unscored ? 0 : Number(playerForfeited(a)) - Number(playerForfeited(b)) || (b.score ?? 0) - (a.score ?? 0) || Number(game.winnerIds.includes(b.playerId)) - Number(game.winnerIds.includes(a.playerId)) || (b.revealedRole ? CITADELS_ROLE_BY_ID[b.revealedRole].rank : 0) - (a.revealedRole ? CITADELS_ROLE_BY_ID[a.revealedRole].rank : 0)).map((player, index) => {
                  const score = game.scoreBreakdowns[player.playerId];
                  const forfeited = playerForfeited(player);
                  return (
                    <View key={player.playerId} accessible accessibilityLabel={unscored ? `${player.displayName}. ${forfeited ? 'Forfeited.' : 'Not scored.'}` : `${index + 1}. ${player.displayName}, ${forfeited ? 'forfeited with' : ''} ${score?.total ?? player.score ?? 0} points`} style={{ minWidth: 0, borderRadius: 12, borderWidth: 1, borderColor: forfeited ? CITADELS.crimson : game.winnerIds.includes(player.playerId) ? CITADELS.gold : CITADELS.border, backgroundColor: CITADELS.surface, padding: 12, gap: 5, boxShadow: '0 3px 0 #050813' }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <Text style={{ ...nameWrapping, flexBasis: 160, flexGrow: 1, flexShrink: 1, fontFamily: 'Outfit_800ExtraBold', fontSize: 18, color: forfeited ? CITADELS.crimson : game.winnerIds.includes(player.playerId) ? CITADELS.gold : CITADELS.text }}>{unscored ? '' : `${index + 1}. `}{player.displayName}</Text>
                        <Text style={{ maxWidth: '100%', fontFamily: 'Outfit_800ExtraBold', fontSize: 24, color: forfeited ? CITADELS.crimson : CITADELS.gold }}>{unscored ? forfeited ? 'FORFEITED' : 'NOT SCORED' : `${score?.total ?? player.score ?? 0} PTS`}</Text>
                      </View>
                      {!unscored && score ? <Text style={{ fontFamily: 'Outfit_400Regular', color: CITADELS.muted, fontSize: 15, lineHeight: 22 }}>DISTRICTS {score.districtPoints} · DIVERSITY +{score.diversityBonus} · COMPLETION +{score.completionBonus} · UNIQUE +{score.uniqueBonus}</Text> : null}
                      <Text style={{ fontFamily: 'SpaceMono_700Bold', color: forfeited ? CITADELS.crimson : CITADELS.royal, fontSize: 13, lineHeight: 19 }}>{forfeited ? 'FORFEITED · INELIGIBLE' : unscored ? 'COURT CANCELLED' : player.revealedRole ? `FINAL CHARACTER · ${CITADELS_ROLE_BY_ID[player.revealedRole].name.toUpperCase()} · RANK ${CITADELS_ROLE_BY_ID[player.revealedRole].rank}` : 'ELIGIBLE BUILDER'}</Text>
                    </View>
                  );
                })}
              </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <CitadelsReferenceSheet visible={rules} onClose={() => setRules(false)} />
    </SafeAreaView>
  );
}
