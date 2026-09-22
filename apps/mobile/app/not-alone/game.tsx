import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Modal,
  Platform,
  ScrollView,
  Text,
  View,
  type TextStyle,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  NOT_ALONE_HUNT_BY_ID,
  NOT_ALONE_MIN_PLAYERS,
  NOT_ALONE_PLACE_BY_ID,
  NOT_ALONE_SURVIVAL_BY_ID,
  notAloneAdjacent,
  notAloneArtemiaAvailable,
  type NotAloneActionKind,
  type NotAloneHuntCardId,
  type NotAloneHuntToken,
  type NotAlonePlaceId,
  type NotAlonePrivateState,
  type NotAlonePublicPlayer,
  type NotAlonePublicState,
  type NotAloneResolvePayload,
  type NotAloneSurvivalCardId,
} from '@zuychin-arcade/types';
import { NeonButton } from '../../components/ui/NeonButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { GameRecovery } from '../../components/ui/GameRecovery';
import { NotAloneMark } from '../../components/not-alone/NotAloneArtwork';
import { NotAlonePlaceCard } from '../../components/not-alone/PlaceCard';
import { CardChip } from '../../components/not-alone/CardChip';
import { PlaceChoiceGrid } from '../../components/not-alone/PlaceChoiceRow';
import { NotAloneReferenceSheet } from '../../components/not-alone/ReferenceSheet';
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
import { NOT_ALONE } from '../../constants/theme';

import { useNotAloneActions } from '../../components/not-alone/useNotAloneActions';
import { useNotAloneDecisionAttention } from '../../components/not-alone/useNotAloneDecisionAttention';
import { isNotAloneLeavePromptCurrent, notAloneForfeitLabel, notAloneForfeitMessage, notAloneHuntNeedsOptions, notAloneLeaveMessage, notAloneSurvivalNeedsOptions } from '../../components/not-alone/decision';
const ALL_PLACES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const nameWrapping: TextStyle = { minWidth: 0, maxWidth: '100%', ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere' } as TextStyle : {}) };

type ChoiceMode =
  | { kind: 'resist'; revision: number; willCost: 1 | 2 }
  | { kind: 'survival'; revision: number; cardId: NotAloneSurvivalCardId }
  | { kind: 'hunt'; revision: number; cardId: NotAloneHuntCardId }
  | { kind: 'token'; revision: number; token: NotAloneHuntToken }
  | { kind: 'resolve'; revision: number; mode: 'power' | 'recover' }
  | null;

function choiceContext(game: NotAlonePublicState, mine: NotAlonePrivateState, mode: Exclude<ChoiceMode, null>): string {
  const localPlayer = game.players.find((player) => player.playerId === mine.playerId);
  const options = mode.kind === 'survival'
    ? [mine.playableSurvivalCardIds.includes(mode.cardId), mine.survivalOptions, mine.selectedPlaces, mine.playedPlaces, localPlayer?.discard]
    : mode.kind === 'hunt'
      ? [mine.playableHuntCardIds.includes(mode.cardId), mine.huntOptions, mine.lastDiscardedHuntCard]
      : mode.kind === 'resolve'
        ? [mine.canResolve, mine.resolutionOptions]
        : mode.kind === 'resist'
          ? [mine.canSelect, mine.resistOptions, localPlayer?.discard, localPlayer?.will]
          : [game.artemiaAvailable, game.huntTokens];
  return JSON.stringify([game.roundNumber, game.phase, game.pendingPlayerId, game.pendingPlaceIndex,
    game.pendingEncounterStage, game.pendingCardChoice?.kind, game.effectiveHuntCardIds,
    game.selectionBlockedPlaces, game.disabledPlaces, game.huntTokens, options]);
}

function phaseLabel(phase: string): string {
  if (phase === 'hunted_planning') return 'SECRET EXPLORATION';
  if (phase === 'exploration_reaction') return 'EXPLORATION REACTIONS';
  if (phase === 'creature_planning') return 'THE HUNT';
  if (phase === 'hunting_reaction') return 'LOCKED HUNT REACTIONS';
  if (phase === 'river_choice') return 'RIVER DECOY';
  if (phase === 'reckoning') return 'RECKONING';
  if (phase === 'end_of_turn') return 'END-OF-TURN ACTIONS';
  return 'SIGNAL CLOSED';
}

function playerForfeited(player?: NotAlonePublicPlayer | null): boolean {
  return player?.forfeited === true;
}

function Meter({ label, value, goal, color, icon }: { label: string; value: number; goal: number; color: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }) {
  const progress = Math.min(100, Math.max(0, (value / Math.max(1, goal)) * 100));
  return (
    <View nativeID={`not-alone-meter-${label.toLowerCase()}`} accessible accessibilityLabel={`${label}: ${value} of ${goal}`} style={{ flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0, maxWidth: '100%', borderRadius: 16, borderWidth: 1, borderColor: `${color}66`, backgroundColor: NOT_ALONE.surface, padding: 14, boxShadow: '0 3px 0 #06030C' }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <MaterialCommunityIcons name={icon} size={22} color={color} />
          <Text style={{ ...nameWrapping, fontFamily: 'Outfit_800ExtraBold', color, fontSize: 15, lineHeight: 22 }}>{label}</Text>
        </View>
        <Text style={{ fontFamily: 'Outfit_800ExtraBold', color, fontSize: 20, lineHeight: 28 }}>{value}/{goal}</Text>
      </View>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ marginHorizontal: 10, marginTop: 14, marginBottom: 5, height: 16, borderRadius: 8, backgroundColor: '#06030C', borderTopWidth: 2, borderTopColor: '#030206' }}>
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${progress}%`, borderRadius: 7, backgroundColor: `${color}66` }} />
        <View style={{ flexDirection: 'row', height: '100%' }}>{Array.from({ length: Math.max(0, goal) }, (_, index) => <View key={index} style={{ flex: 1, borderRightWidth: index < goal - 1 ? 1 : 0, borderRightColor: `${color}55` }} />)}</View>
        <View style={{ position: 'absolute', left: `${progress}%`, top: -5, width: 22, height: 22, borderRadius: 11, transform: [{ translateX: -11 }], backgroundColor: color, borderTopWidth: 2, borderTopColor: '#FFFFFF99', borderBottomWidth: 3, borderBottomColor: '#00000055', boxShadow: '0 3px 4px #00000066' }} />
      </View>
    </View>
  );
}

function HuntTokenPiece({ token }: { token: NotAloneHuntToken }) {
  const color = token === 'creature' ? NOT_ALONE.creature : token === 'target' ? NOT_ALONE.amber : NOT_ALONE.signal;
  const icon = token === 'creature' ? 'alien-outline' : token === 'target' ? 'crosshairs-gps' : 'radar';
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: 32, height: 32, borderRadius: token === 'creature' ? 16 : token === 'target' ? 6 : 10, backgroundColor: color, borderTopWidth: 2, borderTopColor: '#FFFFFF99', borderBottomWidth: 3, borderBottomColor: '#00000055', transform: [{ rotate: token === 'target' ? '45deg' : '0deg' }], boxShadow: '0 3px 4px #00000077', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ transform: [{ rotate: token === 'target' ? '-45deg' : '0deg' }] }}><MaterialCommunityIcons name={icon} size={22} color={NOT_ALONE.bg} /></View>
    </View>
  </View>;
}

function SectionHeading({ children, detail }: { children: string; detail?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 7 }}>
      <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.amber, fontSize: 13, letterSpacing: 1.4 }}>{children}</Text>
      {detail ? <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>{detail}</Text> : null}
    </View>
  );
}

function ChoiceButton({
  label,
  icon,
  onPress,
  color = NOT_ALONE.signal,
  disabled = false,
  selected = false,
  hint,
}: {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  selected?: boolean;
  hint?: string;
}) {
  return (
    <ScalePressable
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{ minWidth: 48, maxWidth: '100%', minHeight: 52, flexBasis: 184, flexGrow: 1, flexShrink: 1, borderRadius: 13, borderWidth: selected ? 2 : 1.5, borderColor: disabled ? NOT_ALONE.border : color, backgroundColor: selected ? `${color}26` : NOT_ALONE.surface, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: '0 3px 0 #06030C' }}
    >
      <MaterialCommunityIcons name={selected ? 'check-circle' : icon} size={20} color={color} />
      <Text style={{ ...nameWrapping, fontFamily: 'Outfit_800ExtraBold', color: disabled ? NOT_ALONE.muted : color, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>{label}</Text>
    </ScalePressable>
  );
}

export default function NotAloneGame() {
  const { width, fontScale = 1 } = useWindowDimensions();
  const textScale = Math.max(1, fontScale);
  const compact = width < 640;
  const narrow = width < 370;
  const [playAreaWidth, setPlayAreaWidth] = useState(0);
  const [mapWidth, setMapWidth] = useState(0);
  const mapFaces = useIntrinsicCardHeight(ALL_PLACES.map(String), `${mapWidth}:${width}:${textScale}`);
  const decisionBesideTable = playAreaWidth >= 980 * textScale;
  const resultsWide = width >= 980 * textScale;
  const reduceMotion = useReducedMotionPreference();
  const game = useGameStore((state) => state.notAlonePublic);
  const mine = useGameStore((state) => state.notAlonePrivate);
  const room = useGameStore((state) => state.room);
  const playerId = useGameStore((state) => state.playerId);
  const token = useGameStore((state) => state.token);
  const [rules, setRules] = useState(false);
  const [handViewportWidth, setHandViewportWidth] = useState(220);
  const [mode, setMode] = useState<ChoiceMode>(null);
  const [choicePlaces, setChoicePlaces] = useState<NotAlonePlaceId[]>([]);
  const [choiceIndexes, setChoiceIndexes] = useState<number[]>([]);
  const [hazardPlaces, setHazardPlaces] = useState<NotAlonePlaceId[]>([]);
  const [targetPlayerId, setTargetPlayerId] = useState<string | null>(null);
  const [chosenToken, setChosenToken] = useState<'creature' | 'target'>('creature');
  const [survivalPlaceIndex, setSurvivalPlaceIndex] = useState<0 | 1 | null>(null);
  const [detourOriginPlace, setDetourOriginPlace] = useState<NotAlonePlaceId | null>(null);
  const [detourPlaceIndex, setDetourPlaceIndex] = useState<0 | 1 | null>(null);
  const [powerChoice, setPowerChoice] = useState<'recover' | 'return_played' | 'copy' | 'will' | 'card' | 'charge' | 'launch' | null>(null);
  const [huntChoice, setHuntChoice] = useState<'discard' | 'will' | null>(null);
  const [toxinCardId, setToxinCardId] = useState<NotAloneSurvivalCardId | null>(null);
  const actions = useNotAloneActions();
  const dialogOpen = useDialogStore(state => state.dialog !== null);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const connectionState: string = actions.connected ? 'connected' : 'reconnecting';
  const stateSynced = actions.synced;
  const feedback = actionMessage ?? actions.message;
  const [isLeaving, setIsLeaving] = useState(false);
  const [rematchFace, setRematchFace] = useState<'continuous' | 'alternating'>('continuous');
  const mainScrollRef = useRef<ScrollView>(null);
  const decisionHeadingRef = useRef<Text>(null);
  const handHeadingRef = useRef<View>(null);
  const trailHeadingRef = useRef<View>(null);
  const decisionZoneYRef = useRef(0);
  const handZoneYRef = useRef(0);
  const trailZoneYRef = useRef(0);
  const playAreaYRef = useRef(0);
  const decisionInnerYRef = useRef(0);
  const handInnerYRef = useRef(0);
  const publicColumnYRef = useRef(0);
  const trailInnerYRef = useRef(0);
  const updateSectionOffsets = () => {
    decisionZoneYRef.current = playAreaYRef.current + decisionInnerYRef.current;
    handZoneYRef.current = playAreaYRef.current + handInnerYRef.current;
    trailZoneYRef.current = playAreaYRef.current + publicColumnYRef.current + trailInnerYRef.current;
  };
  const leavingRef = useRef(false);
  const navigatingRef = useRef(false);
  const leavePromptOpenRef = useRef(false);
  const latestGameRef = useRef(game);
  const leaveNotifiedRef = useRef(false);
  const ownDialogRef = useRef<DialogConfig | null>(null);
  const giveUpDialogRef = useRef<DialogConfig | null>(null);
  const leaveEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const lifecycleIdentity = useRef(token);
  const nativeBack = useRef<(() => void) | null>(null);
  const modeOpenerRef = useRef<string | null>(null);
  const restoringModeFocusRef = useRef(false);
  const choiceContextRef = useRef<string | null>(null);
  const approveNavigation = useNativeLeaveGuard(token, () => {
    if (useGameStore.getState().token === token) nativeBack.current?.();
  });
  latestGameRef.current = game;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (ownDialogRef.current && useDialogStore.getState().dialog === ownDialogRef.current) useDialogStore.getState().hide();
      if (giveUpDialogRef.current && useDialogStore.getState().dialog === giveUpDialogRef.current) useDialogStore.getState().hide();
    };
  }, []);

  useEffect(() => {
    leaveEpochRef.current += 1;
    if (ownDialogRef.current && useDialogStore.getState().dialog === ownDialogRef.current) useDialogStore.getState().hide();
    ownDialogRef.current = null;
    leavePromptOpenRef.current = false;
  }, [game?.status, room?.roomCode, token]);

  useEffect(() => {
    if (giveUpDialogRef.current && useDialogStore.getState().dialog === giveUpDialogRef.current) useDialogStore.getState().hide();
    giveUpDialogRef.current = null;
  }, [game?.status, game?.phase, game?.roundNumber, mine?.canGiveUp, token]);

  const resetChoice = useCallback(() => {
    choiceContextRef.current = null;
    setMode(null);
    setChoicePlaces([]);
    setChoiceIndexes([]);
    setHazardPlaces([]);
    setTargetPlayerId(null);
    setChosenToken('creature');
    setSurvivalPlaceIndex(null);
    setDetourOriginPlace(null);
    setDetourPlaceIndex(null);
    setPowerChoice(null);
    setHuntChoice(null);
    setToxinCardId(null);
  }, []);

  useEffect(() => {
    const previous = lifecycleIdentity.current;
    lifecycleIdentity.current = token;
    if (token === null || previous === token) return;
    leavingRef.current = false;
    navigatingRef.current = false;
    leaveNotifiedRef.current = false;
    setIsLeaving(false);
    setCleanupPending(false);
    setActionMessage(null);
    resetChoice();
  }, [token, resetChoice]);

  useEffect(() => {
    if (!actions.connected) resetChoice();
  }, [actions.connected, resetChoice]);

  useEffect(() => {
    if (!mode || !game || !mine || mode.revision === game.revision || mine.revision !== game.revision) return;
    if (choiceContextRef.current === choiceContext(game, mine, mode)) setMode({ ...mode, revision: game.revision });
    else resetChoice();
  }, [game, mine, mode, resetChoice]);

  useEffect(() => {
    resetChoice();
  }, [game?.pendingCardChoice?.kind, game?.pendingPlayerId, game?.phase, game?.roundNumber, mine?.resolutionOptions?.effectivePlaceId, resetChoice]);

  useEffect(() => {
    if (game?.boardFace) setRematchFace(game.boardFace);
  }, [game?.boardFace]);

  const gameOver = game?.status === 'game_over';
  useEffect(() => {
    if (!gameOver) return;
    setRules(false);
    resetChoice();
  }, [gameOver, resetChoice]);

  useEffect(() => {
    if (token !== null || useGameStore.getState().token !== null || leavingRef.current) return;
    leavingRef.current = true;
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null);
  }, [token, approveNavigation]);

  const leave = useCallback(async (destination: '/' | '/not-alone' = '/') => {
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
        if (ownsSession()) showDialog('Expedition notification failed', `${error instanceof Error ? error.message : 'Unknown error'}. Your seat may remain reserved until reconnect grace expires.`);
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
    navigatingRef.current = true;
    useGameStore.getState().clearAll();
    approveNavigation(() => router.replace(destination), () => useGameStore.getState().token === null, null);
  }, [room, token, approveNavigation]);

  const onSessionCleared = useCallback(() => {
    if (!mountedRef.current || useGameStore.getState().token !== null) return;
    leavingRef.current = true;
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null, null);
  }, [approveNavigation]);

  const requestLeave = useCallback(() => {
    if (leavingRef.current || leavePromptOpenRef.current) return;
    if (cleanupPending) { void leave(); return; }
    const captured = latestGameRef.current;
    if (!captured) return;
    const epoch = leaveEpochRef.current;
    leavePromptOpenRef.current = true;
    const expeditionLive = captured.status === 'playing';
    showDialog(
      expeditionLive ? 'Forfeit this expedition?' : 'Return to the arcade?',
      notAloneLeaveMessage(captured, playerId),
      [
        { text: 'STAY', style: 'cancel', onPress: () => { leavePromptOpenRef.current = false; } },
        { text: 'LEAVE', style: 'destructive', onPress: () => {
          if (!isNotAloneLeavePromptCurrent(captured, useGameStore.getState().notAlonePublic, epoch, leaveEpochRef.current)) return;
          leavePromptOpenRef.current = false;
          void leave();
        } },
      ],
    );
    ownDialogRef.current = useDialogStore.getState().dialog;
  }, [cleanupPending, leave, playerId]);

  const cancelChoice = useCallback(() => {
    const opener = modeOpenerRef.current;
    const captured = useGameStore.getState().notAlonePublic;
    restoringModeFocusRef.current = true;
    resetChoice();
    if (Platform.OS !== 'web' || !opener || typeof document === 'undefined') return;
    requestAnimationFrame(() => {
      const current = useGameStore.getState();
      if (!mountedRef.current || current.token !== token || current.notAlonePublic?.phase !== captured?.phase
        || current.notAlonePublic?.roundNumber !== captured?.roundNumber
        || current.notAlonePublic?.pendingPlayerId !== captured?.pendingPlayerId) return;
      const button = Array.from(document.querySelectorAll<HTMLElement>('[role="button"],button'))
        .find((element) => element.getAttribute('aria-label') === opener
          && element.getAttribute('aria-disabled') !== 'true' && !element.closest('[aria-hidden="true"]'));
      button?.focus({ preventScroll: true });
    });
  }, [resetChoice, token]);

  const handleBack = useCallback(() => {
    if (rules) {
      setRules(false);
      return;
    }
    if (mode) {
      cancelChoice();
      return;
    }
    requestLeave();
  }, [mode, requestLeave, cancelChoice, rules]);
  useLayoutEffect(() => { nativeBack.current = handleBack; }, [handleBack]);

  useWebBackGuard('/not-alone/game', handleBack, token !== null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !mode || rules || gameOver || typeof document === 'undefined') return;
    const closeChoice = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelChoice();
    };
    document.addEventListener('keydown', closeChoice);
    return () => document.removeEventListener('keydown', closeChoice);
  }, [gameOver, mode, cancelChoice, rules]);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]);

  const localPlayer = game?.players.find((player) => player.playerId === playerId);
  const localDecisionKey = game && mine && playerId && localPlayer && !playerForfeited(localPlayer)
    ? mode
      ? `choice:${game.roundNumber}:${game.phase}:${mode.kind}:${'cardId' in mode ? mode.cardId : 'token' in mode ? mode.token : 'mode' in mode ? mode.mode : mode.willCost}`
      : mine.cardChoice
        ? `card-choice:${game.roundNumber}:${mine.cardChoice.kind}:${mine.cardChoice.placeOptions.join(',')}:${mine.cardChoice.placeIndexes.join(',')}`
        : mine.canChooseSurvivalCard
          ? `shelter:${game.roundNumber}:${mine.survivalChoiceCards.join(',')}`
          : mine.canChooseRiver
            ? `river:${game.roundNumber}:${mine.selectedPlaces.join(',')}`
            : mine.canSelect
              ? `select:${mine.selectionMode}:${mine.requiredSelectionCount}:${game.roundNumber}`
              : mine.canResolve
                ? `resolve:${game.roundNumber}:${game.pendingPlaceIndex}:${game.pendingEncounterStage}:${mine.resolutionOptions?.effectivePlaceId ?? 0}`
                : mine.canPass || mine.canBeginHunt || mine.canLockHunt || mine.canHunt || mine.canReveal || mine.canBeginReckoning || mine.canEndTurn
                  ? `reaction:${game.roundNumber}:${game.phase}:${game.pendingEncounterStage}:${game.pendingPlaceIndex}:${mine.canPass}:${mine.canBeginHunt}:${mine.canLockHunt}:${mine.canHunt}:${mine.canReveal}:${mine.canBeginReckoning}:${mine.canEndTurn}`
                  : null
    : null;

  const focusDecision = useCallback(() => {
    if (restoringModeFocusRef.current && !mode) { restoringModeFocusRef.current = false; return true; }
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const heading = document.getElementById('not-alone-decision-heading');
      if (!heading) return false;
      heading.setAttribute('tabindex', '-1');
      heading.scrollIntoView({ block: 'start', inline: 'nearest' });
      heading.focus({ preventScroll: true });
    } else {
      mainScrollRef.current?.scrollTo({ y: Math.max(0, decisionZoneYRef.current - 10), animated: !reduceMotion });
      const handle = decisionHeadingRef.current ? findNodeHandle(decisionHeadingRef.current) : null;
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }
    return true;
  }, [mode, reduceMotion]);
  useNotAloneDecisionAttention(localDecisionKey, rules || dialogOpen || Boolean(gameOver) || actions.busy || isLeaving, focusDecision);

  const pendingPlayer = game?.players.find((player) => player.playerId === game.pendingPlayerId);
  const decisionAnnouncement = useMemo(() => {
    if (!game || !mine || !playerId) return 'Restoring the Artemia signal.';
    if (connectionState === 'error') return 'Connection failed. Decisions are paused.';
    if (connectionState === 'reconnecting' || !stateSynced) return 'Reconnecting. Decisions are paused while the table refreshes.';
    if (game.status === 'game_over') return game.winner === 'hunted'
      ? 'The Hunted win and escape Artemia.'
      : game.winner === 'creature'
        ? 'The Creature wins and assimilates the expedition.'
        : 'The expedition ended because no eligible winner remains.';
    if (localPlayer?.forfeited) return notAloneForfeitMessage(game, localPlayer);
    if (mine.cardChoice) return mine.cardChoice.kind === 'phobia'
      ? `Choose ${mine.cardChoice.count} Place cards to keep hidden.`
      : mine.cardChoice.kind === 'artefact_order'
        ? 'Choose which Artefact destination resolves first and second.'
        : mine.cardChoice.kind === 'artemia_discard'
          ? 'Artemia caught you. Privately discard one other Place from your hand, not the card you explored.'
          : mine.cardChoice.kind === 'forbidden_zone'
            ? 'Seal one unplayed Place card. Every affected Hunted commits privately before any discard is applied.'
        : `Choose ${mine.cardChoice.count} Place cards to discard.`;
    if (game.pendingCardChoice?.kind === 'forbidden_zone') return mine.cardChoiceSubmitted
      ? `Your Forbidden Zone choice is sealed. ${game.pendingCardChoice.submittedCount} of ${game.pendingCardChoice.eligibleCount} anonymous commitments are locked; waiting for the others.`
      : mine.role === 'creature'
        ? `${game.pendingCardChoice.submittedCount} of ${game.pendingCardChoice.eligibleCount} anonymous Forbidden Zone commitments are locked. Discard identities stay hidden until everyone submits.`
        : `You are not affected by this Forbidden Zone. ${game.pendingCardChoice.submittedCount} of ${game.pendingCardChoice.eligibleCount} anonymous commitments are locked.`;
    if (feedback) return feedback;
    if (mine.canChooseSurvivalCard) return 'Choose one of the Survival cards drawn at the Shelter.';
    if (mine.canChooseRiver) return 'Choose the real River destination now that the Hunt tokens are locked.';
    if (mine.canSelect) return game.effectiveHuntCardIds.includes('despair')
      ? `Despair returned every locked destination. Secretly choose ${mine.requiredSelectionCount} Place card${mine.requiredSelectionCount === 1 ? '' : 's'} again; any Survival card already spent remains spent.`
      : `Secretly choose ${mine.requiredSelectionCount} Place card${mine.requiredSelectionCount === 1 ? '' : 's'}.`;
    if (mine.canResolve) return `Resolve ${game.pendingEncounterStage ? `${game.pendingEncounterStage} layer, ` : ''}slot ${game.pendingPlaceIndex + 1} at Place ${mine.resolutionOptions?.placeId ?? game.pendingPlaceId ?? ''}.`;
    if (mine.canPass) return 'Play a legal reaction or pass this reaction window.';
    if (mine.canBeginHunt) return 'Every active Hunted player has passed. Begin the Hunt.';
    if (mine.canLockHunt) return 'Every required Hunt token is placed. Lock their positions for Hunted reactions.';
    if (mine.canHunt) return 'Place your Hunt tokens. You may reposition them before locking the Hunt.';
    if (mine.canReveal) return 'Every required Hunt token is placed and reactions are complete. Reveal destinations.';
    if (mine.canBeginReckoning) return 'The reaction window is complete. Continue to the next Place or encounter.';
    if (mine.canEndTurn) return 'All end-of-turn reactions are complete. Finish the round.';
    return pendingPlayer ? `Waiting for ${pendingPlayer.displayName} to resolve.` : `Waiting during ${phaseLabel(game.phase).toLowerCase()}.`;
  }, [feedback, connectionState, game, localPlayer, mine, pendingPlayer, playerId, stateSynced]);

  useWebModalFocus(Boolean(gameOver) && !dialogOpen, 'not-alone-game-over', requestLeave);

  if (!game || !mine || !playerId) return <GameRecovery onSessionCleared={onSessionCleared} message="Restoring the Artemia signal…" background={NOT_ALONE.bg} surface={NOT_ALONE.surface} border={NOT_ALONE.border} accent={NOT_ALONE.signal} muted={NOT_ALONE.muted} icon="access-point" />;
  const me = game.players.find((player) => player.playerId === playerId);
  if (!me) return <GameRecovery onSessionCleared={onSessionCleared} message="Restoring your expedition seat…" background={NOT_ALONE.bg} surface={NOT_ALONE.surface} border={NOT_ALONE.border} accent={NOT_ALONE.signal} muted={NOT_ALONE.muted} icon="account-sync-outline" />;

  const isCreature = mine.role === 'creature';
  const privateHandCount = isCreature ? mine.huntHand.length : mine.survivalHand.length;
  const isHost = room?.players.find((player) => player.playerId === playerId)?.isHost ?? false;
  const activeSeats = room?.players.filter((seat) => !seat.hasLeft && game.players.some((player) => player.playerId === seat.playerId && !player.forfeited)) ?? [];
  const connectedRematchPlayers = activeSeats.filter((seat) => seat.isConnected).length;
  const newPlayersNeeded = Math.max(0, NOT_ALONE_MIN_PLAYERS - activeSeats.length);
  const rematchNeedsNewRoom = newPlayersNeeded > 0;
  const rematchReady = connectedRematchPlayers >= NOT_ALONE_MIN_PLAYERS && connectedRematchPlayers === activeSeats.length;
  const revisionsMatch = game.revision === mine.revision;
  const busy = actions.busy || !revisionsMatch || isLeaving || cleanupPending || me.forfeited;
  const effectiveHuntCards = game.effectiveHuntCardIds;
  const despairReselection = game.phase === 'hunted_planning' && effectiveHuntCards.includes('despair');
  const forbiddenChoicePending = game.pendingCardChoice?.kind === 'forbidden_zone';
  const tableChoicePending = game.pendingCardChoice !== null;
  const anticipationTarget = game.players.find((player) => player.playerId === game.anticipationTargetPlayerId) ?? null;
  const boardFaceLabel = game.boardFace === 'continuous' ? 'CONTINUOUS FACE' : 'ALTERNATING FACE';
  const artemiaStatusLabel = game.status === 'game_over'
    ? `FINAL ROUND · ARTEMIA WAS ${game.artemiaAvailable ? 'ACTIVE' : 'INACTIVE'}`
    : `ARTEMIA · ${game.artemiaAvailable ? 'ACTIVE' : 'INACTIVE'} THIS ROUND`;
  const artemiaStatusSentence = game.status === 'game_over'
    ? `Artemia was ${game.artemiaAvailable ? 'active' : 'inactive'} in the final round.`
    : `Artemia is ${game.artemiaAvailable ? 'active' : 'inactive'} this round.`;
  const artemiaActivationSpaces = Array.from({ length: game.rescueGoal }, (_, progress) => progress)
    .filter((progress) => notAloneArtemiaAvailable(game.boardFace, progress, game.rescueGoal));

  const sendAction = (_event: string, action: NotAloneActionKind, label: string, payload: Record<string, unknown> = {}) => {
    if (busy || (tableChoicePending && action !== 'card_choice')) return false;
    setActionMessage(null);
    const sent = actions.send(action, payload, label, game.revision);
    if (sent) resetChoice();
    return sent;
  };

  const sendRematch = () => {
    if (busy || !rematchReady) return;
    setActionMessage(null);
    actions.send('start', { boardFace: rematchFace }, 'Start rematch', game.revision);
  };

  const toggleChoicePlace = (place: NotAlonePlaceId, maximum: number) => {
    setChoicePlaces((current) => current.includes(place)
      ? current.filter((id) => id !== place)
      : current.length < maximum ? [...current, place] : [...current.slice(1), place]);
  };

  const toggleChoiceIndex = (placeIndex: number, maximum: number) => {
    setChoiceIndexes((current) => current.includes(placeIndex)
      ? current.filter((index) => index !== placeIndex)
      : current.length < maximum ? [...current, placeIndex] : [...current.slice(1), placeIndex]);
  };

  const exploredSlotLabel = (placeIndex: number): string => {
    const played = mine.playedPlaces[placeIndex];
    const current = mine.selectedPlaces[placeIndex];
    if (!played || !current) return `EXPLORED SLOT ${placeIndex + 1}`;
    const playedName = NOT_ALONE_PLACE_BY_ID[played].name.toUpperCase();
    const currentName = NOT_ALONE_PLACE_BY_ID[current].name.toUpperCase();
    return played === current
      ? `SLOT ${placeIndex + 1} · ${playedName} · PLACE ${played}`
      : `SLOT ${placeIndex + 1} · PLAYED ${played} ${playedName} · MOVED TO ${current} ${currentName}`;
  };

  const openMode = (next: Exclude<ChoiceMode, null>) => {
    if (tableChoicePending) return;
    modeOpenerRef.current = Platform.OS === 'web' && typeof document !== 'undefined' ? document.activeElement?.getAttribute('aria-label') ?? null : null;
    resetChoice();
    choiceContextRef.current = choiceContext(game, mine, next);
    setMode(next);
  };

  const openSurvival = (cardId: NotAloneSurvivalCardId) => {
    if (tableChoicePending || !mine.playableSurvivalCardIds.includes(cardId) || busy) return;
    if (notAloneSurvivalNeedsOptions(cardId)) {
      openMode({ kind: 'survival', revision: game.revision, cardId });
      return;
    }
    sendAction('notalone:survival', 'survival', `Play ${NOT_ALONE_SURVIVAL_BY_ID[cardId].name}`, { cardId });
  };

  const effectiveHuntCard = (cardId: NotAloneHuntCardId): NotAloneHuntCardId | null => cardId === 'flashback' ? mine.lastDiscardedHuntCard : cardId;
  const openHunt = (cardId: NotAloneHuntCardId) => {
    if (tableChoicePending || !mine.playableHuntCardIds.includes(cardId) || busy) return;
    if (notAloneHuntNeedsOptions(cardId, mine.lastDiscardedHuntCard)) {
      openMode({ kind: 'hunt', revision: game.revision, cardId });
      return;
    }
    sendAction('notalone:hunt-card', 'hunt_card', `Play ${NOT_ALONE_HUNT_BY_ID[cardId].name}`, { cardId });
  };

  const requiredTokenPlaces = (huntToken: NotAloneHuntToken): number => {
    if (huntToken === 'creature') return 1;
    const counts = effectiveHuntCards.filter((cardId) => NOT_ALONE_HUNT_BY_ID[cardId].token === huntToken).map((cardId) => NOT_ALONE_HUNT_BY_ID[cardId].placeCount ?? 1);
    return counts.length ? Math.max(...counts) : 1;
  };
  const targetTokenRequired = effectiveHuntCards.some((cardId) => NOT_ALONE_HUNT_BY_ID[cardId].token === 'target');
  const artemiaTokenRequired = game.artemiaAvailable || effectiveHuntCards.some((cardId) => NOT_ALONE_HUNT_BY_ID[cardId].token === 'artemia');
  const targetFootprintFixed = effectiveHuntCards.includes('force_field') && game.huntTokens.target.length > 0;

  const selection = mine.selectedPlaces;
  const jumpToSection = (position: number, headingId: string) => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const heading = document.getElementById(headingId);
      heading?.scrollIntoView({ block: 'start', inline: 'nearest' });
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({ preventScroll: true });
    } else {
      mainScrollRef.current?.scrollTo({ y: Math.max(0, position - 10), animated: !reduceMotion });
      const heading = headingId === 'not-alone-private-hand' ? handHeadingRef.current
        : headingId === 'not-alone-public-trails' ? trailHeadingRef.current : decisionHeadingRef.current;
      const handle = heading ? findNodeHandle(heading) : null;
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }
  };
  const toggleExploration = (place: NotAlonePlaceId) => {
    if (!mine.canSelect || busy || game.selectionBlockedPlaces.includes(place)) return;
    const current = choicePlaces.length ? choicePlaces : selection;
    setChoicePlaces(current.includes(place)
      ? current.filter((id) => id !== place)
      : current.length < mine.requiredSelectionCount ? [...current, place] : [...current.slice(1), place]);
  };
  const explorationSelection = choicePlaces.length ? choicePlaces : selection;

  const confirmGiveUp = () => {
    showDialog('Give up?', 'Assimilation advances immediately. You restore three Will and recover every discarded Place.', [
      { text: 'CANCEL', style: 'cancel' },
      { text: 'GIVE UP', style: 'destructive', onPress: () => {
        const current = useGameStore.getState();
        if (!mountedRef.current || current.token !== token || !current.notAlonePrivate?.canGiveUp
          || current.notAlonePublic?.phase !== game.phase || current.notAlonePublic?.roundNumber !== game.roundNumber) return;
        if (actions.send('give_up', {}, 'Give up', current.notAlonePublic.revision)) resetChoice();
      } },
    ]);
    giveUpDialogRef.current = useDialogStore.getState().dialog;
  };

  const resistOption = mode?.kind === 'resist'
    ? mine.resistOptions.find((option) => option.willCost === mode.willCost) ?? null
    : null;

  const survivalCardId = mode?.kind === 'survival' ? mode.cardId : null;
  const survivalPlaces: NotAlonePlaceId[] = survivalCardId === 'sacrifice'
    ? mine.survivalOptions.sacrificePlaceIds
    : survivalCardId === 'sixth_sense'
      ? me.discard
      : survivalCardId === 'vortex'
        ? mine.survivalOptions.vortexDiscardPlaceIds
      : survivalCardId === 'double_back'
        ? []
        : survivalCardId === 'gate'
          ? mine.survivalOptions.gatePlaceIds
          : survivalCardId === 'hologram'
            ? mine.survivalOptions.hologramPlaceIds
            : survivalCardId === 'wrong_track'
              ? chosenToken === 'target' ? mine.survivalOptions.wrongTrackTargetPlaceIds : mine.survivalOptions.wrongTrackCreaturePlaceIds
              : [];
  const survivalNeeded = survivalCardId === 'sixth_sense'
    ? Math.min(2, me.discard.length)
    : survivalCardId === 'double_back' ? 0 : survivalCardId ? 1 : 0;
  const survivalChoiceValid = Boolean(survivalCardId)
    && (survivalCardId === 'vortex'
      ? choicePlaces.length === 1 && survivalPlaceIndex !== null && mine.survivalOptions.vortexSelectedPlaceIndexes.includes(survivalPlaceIndex)
      : survivalCardId === 'double_back'
        ? survivalPlaceIndex !== null && mine.survivalOptions.doubleBackPlaceIndexes.includes(survivalPlaceIndex)
        : choicePlaces.length === survivalNeeded);

  const submitSurvival = () => {
    if (!survivalCardId || !survivalChoiceValid) return;
    const payload: Record<string, unknown> = { cardId: survivalCardId };
    if (['sacrifice', 'sixth_sense', 'vortex'].includes(survivalCardId)) payload.placeIds = choicePlaces;
    if (['gate', 'hologram', 'wrong_track'].includes(survivalCardId)) payload.targetPlaceId = choicePlaces[0];
    if (survivalCardId === 'vortex' || survivalCardId === 'double_back') payload.placeIndex = survivalPlaceIndex;
    if (survivalCardId === 'wrong_track') payload.token = chosenToken;
    sendAction('notalone:survival', 'survival', `Play ${NOT_ALONE_SURVIVAL_BY_ID[survivalCardId].name}`, payload);
  };

  const huntCardId = mode?.kind === 'hunt' ? mode.cardId : null;
  const huntEffect = huntCardId ? effectiveHuntCard(huntCardId) : null;
  const huntNeedsTarget = huntEffect ? ['anticipation', 'ascendancy', 'phobia', 'detour'].includes(huntEffect) : false;
  const huntTargetPlayerIds = huntEffect === 'ascendancy'
    ? mine.huntOptions.ascendancyTargetPlayerIds
    : huntEffect === 'phobia'
      ? mine.huntOptions.phobiaTargetPlayerIds
      : huntEffect === 'detour'
        ? [...new Set(mine.huntOptions.detourOptions.map((option) => option.playerId))]
        : huntEffect === 'anticipation'
          ? mine.huntOptions.targetPlayerIds
          : [];
  const detourOptionsForTarget = huntEffect === 'detour' && targetPlayerId
    ? mine.huntOptions.detourOptions.filter((option) => option.playerId === targetPlayerId)
    : [];
  const selectedDetourOption = huntEffect === 'detour'
    ? detourOptionsForTarget.find((option) => option.placeIndex === detourPlaceIndex && option.originPlaceId === detourOriginPlace) ?? null
    : null;
  const huntPlaceOptions: NotAlonePlaceId[] = huntEffect === 'detour'
    ? selectedDetourOption?.destinationPlaceIds ?? []
    : huntEffect === 'cataclysm'
      ? mine.huntOptions.cataclysmPlaceIds
      : huntEffect === 'force_field'
      ? [...ALL_PLACES]
      : [];
  const huntPlaceCount = huntEffect === 'force_field' ? 2 : huntEffect === 'cataclysm' || huntEffect === 'detour' ? 1 : 0;
  const huntPlacesValid = choicePlaces.length === huntPlaceCount
    && choicePlaces.every((place) => huntPlaceOptions.includes(place))
    && (huntPlaceCount !== 2 || notAloneAdjacent(choicePlaces[0]!, choicePlaces[1]!));
  const huntChoiceValid = Boolean(huntCardId && huntEffect)
    && (!huntNeedsTarget || Boolean(targetPlayerId && huntTargetPlayerIds.includes(targetPlayerId)))
    && (huntEffect !== 'detour' || Boolean(selectedDetourOption))
    && huntPlacesValid;

  const submitHunt = () => {
    if (!huntCardId || !huntChoiceValid) return;
    sendAction('notalone:hunt-card', 'hunt_card', `Play ${NOT_ALONE_HUNT_BY_ID[huntCardId].name}`, {
      cardId: huntCardId,
      ...(targetPlayerId ? { targetPlayerId } : {}),
      ...(selectedDetourOption ? { originPlaceId: selectedDetourOption.originPlaceId, placeIndex: selectedDetourOption.placeIndex } : {}),
      ...(huntPlaceCount ? { placeIds: choicePlaces } : {}),
    });
  };

  const tokenMode = mode?.kind === 'token' ? mode.token : null;
  const tokenPlaceCount = tokenMode ? requiredTokenPlaces(tokenMode) : 0;
  const tokenChoiceValid = Boolean(tokenMode) && choicePlaces.length === tokenPlaceCount && (tokenPlaceCount !== 2 || notAloneAdjacent(choicePlaces[0]!, choicePlaces[1]!));
  const submitToken = () => {
    if (!tokenMode || !tokenChoiceValid) return;
    sendAction('notalone:place-token', 'place_token', `Place ${tokenMode} token`, { token: tokenMode, placeIds: choicePlaces });
  };

  const cardChoice = mine.cardChoice;
  const cardChoiceIsArtefact = cardChoice?.kind === 'artefact_order';
  const cardChoiceValid = Boolean(cardChoice) && (cardChoiceIsArtefact
    ? choiceIndexes.length === cardChoice.count && choiceIndexes.every((index) => cardChoice.placeIndexes.includes(index))
    : choicePlaces.length === cardChoice?.count);
  const submitCardChoice = () => {
    if (!cardChoice || !cardChoiceValid) return;
    const label = cardChoice.kind === 'phobia' ? 'Keep private cards' : cardChoice.kind === 'artefact_order' ? 'Set Artefact order' : 'Choose private discard';
    sendAction('notalone:card-choice', 'card_choice', label, cardChoice.kind === 'artefact_order'
      ? { placeIndexes: choiceIndexes }
      : { placeIds: choicePlaces });
  };

  const resolution = mine.resolutionOptions;
  const showResolutionControls = !tableChoicePending && mine.canResolve && !mine.canChooseSurvivalCard;
  const effectiveResolutionPlace = resolution?.effectivePlaceId ?? null;
  const resolutionMode = mode?.kind === 'resolve' ? mode.mode : null;
  const persecutionReturnChoice = Boolean(
    resolution?.canReturnPlayedPlace
    && effectiveHuntCards.includes('persecution')
    && (effectiveResolutionPlace === 2 || effectiveResolutionPlace === 6),
  );
  const screamRequired = Boolean(resolution && (resolution.canLoseWillForScream || resolution.screamDiscardCount > 0));
  const toxinRequired = Boolean(resolution?.toxinSurvivalCardIds.length);
  const screamValid = !screamRequired
    || (huntChoice === 'will' && Boolean(resolution?.canLoseWillForScream))
    || (huntChoice === 'discard' && hazardPlaces.length === resolution?.screamDiscardCount);
  const toxinValid = !toxinRequired || Boolean(toxinCardId);
  const resolutionPowerValid = (() => {
    if (!resolution || !resolutionMode) return false;
    if (!resolution.canUsePlacePower && !resolution.canRecoverPlace) return resolution.canContinue && resolutionMode === 'power';
    if (resolutionMode === 'recover') return resolution.canRecoverPlace && choicePlaces.length === resolution.recoverCount;
    if (!resolution.canUsePlacePower) return false;
    if (effectiveResolutionPlace === 1) {
      if (powerChoice === 'copy') return choicePlaces.length === 1 && resolution.copyablePlaceIds.includes(choicePlaces[0]!);
      return powerChoice === 'recover' && choicePlaces.length === resolution.powerRecoveryCount;
    }
    if (effectiveResolutionPlace === 2 || effectiveResolutionPlace === 6) {
      if (!persecutionReturnChoice) return choicePlaces.length === resolution.powerRecoveryCount;
      return (powerChoice === 'return_played' && choicePlaces.length === 0)
        || (powerChoice === 'recover' && resolution.powerRecoveryCount > 0 && choicePlaces.length === resolution.powerRecoveryCount);
    }
    if (effectiveResolutionPlace === 4) return Boolean(powerChoice && resolution.beachChoices.includes(powerChoice as 'charge' | 'launch'));
    if (effectiveResolutionPlace === 5) return choicePlaces.length === 1 && resolution.roverPlaceIds.includes(choicePlaces[0]!);
    if (effectiveResolutionPlace === 9) return (powerChoice === 'card' && resolution.sourceChoices.includes('card'))
      || (powerChoice === 'will' && resolution.sourceChoices.includes('will') && Boolean(targetPlayerId) && resolution.healTargetPlayerIds.includes(targetPlayerId!));
    return true;
  })();
  const resolutionValid = Boolean(resolutionMode && resolution) && screamValid && toxinValid && resolutionPowerValid;

  const submitResolution = () => {
    if (!resolution || !resolutionMode || !resolutionValid) return;
    if (resolutionMode === 'power' && effectiveResolutionPlace === 1 && powerChoice === 'copy') {
      sendAction('notalone:resolve', 'resolve', 'Choose Lair copy', { mode: 'copy', targetPlaceId: choicePlaces[0] });
      return;
    }
    const payload: Omit<NotAloneResolvePayload, 'expectedRevision'> = { mode: resolutionMode };
    if (screamRequired) {
      payload.huntChoice = huntChoice ?? undefined;
      if (huntChoice === 'discard') payload.huntPlaceIds = hazardPlaces;
    }
    if (toxinRequired) payload.huntSurvivalCardId = toxinCardId ?? undefined;
    if (resolution.canUsePlacePower || resolution.canRecoverPlace) {
      if (resolutionMode === 'recover') payload.placeIds = choicePlaces;
      else if (effectiveResolutionPlace === 1) {
        payload.placeIds = choicePlaces;
      } else if (effectiveResolutionPlace === 2 || effectiveResolutionPlace === 6) payload.placeIds = choicePlaces;
      else if (effectiveResolutionPlace === 4) payload.choice = powerChoice as 'charge' | 'launch';
      else if (effectiveResolutionPlace === 5) payload.targetPlaceId = choicePlaces[0];
      else if (effectiveResolutionPlace === 9) {
        payload.choice = powerChoice as 'will' | 'card';
        if (powerChoice === 'will') payload.targetPlayerId = targetPlayerId ?? undefined;
      }
    }
    sendAction('notalone:resolve', 'resolve', `Resolve Place ${resolution.placeId}`, payload as Record<string, unknown>);
  };

  const decisionTitle = me.forfeited
    ? notAloneForfeitLabel(game, me)
    : cardChoice
      ? cardChoice.kind === 'phobia' ? 'KEEP TWO PLACE CARDS HIDDEN' : cardChoice.kind === 'artefact_order' ? 'ORDER YOUR ARTEFACT PLACES' : cardChoice.kind === 'artemia_discard' ? 'ARTEMIA · DISCARD FROM YOUR HAND' : cardChoice.kind === 'forbidden_zone' ? 'FORBIDDEN ZONE · SEAL ONE DISCARD' : 'CHOOSE YOUR PRIVATE DISCARD'
      : forbiddenChoicePending
        ? mine.cardChoiceSubmitted ? 'CHOICE SEALED · WAITING FOR OTHERS' : 'FORBIDDEN ZONE · SEALED CHOICES'
      : mine.canChooseSurvivalCard
        ? 'KEEP ONE SURVIVAL CARD'
        : mine.canChooseRiver
          ? 'CHOOSE THE REAL RIVER DESTINATION'
          : mine.canSelect
            ? mine.requiredSelectionCount === 2 ? `SECRETLY PREPARE TWO PLACES · ${mine.selectionMode.toUpperCase()}` : 'SECRETLY CHOOSE ONE PLACE'
            : mine.canResolve
              ? `RESOLVE ${game.pendingEncounterStage?.toUpperCase() ?? 'PLACE'} · SLOT ${game.pendingPlaceIndex + 1} · PLACE ${resolution?.placeId ?? game.pendingPlaceId ?? ''}`
              : mine.canPass
                ? 'PLAY A REACTION OR PASS'
                : mine.canBeginHunt
                  ? 'BEGIN THE HUNT'
                  : mine.canLockHunt
                    ? 'LOCK HUNT POSITIONS'
                  : mine.canHunt
                    ? 'PLAN YOUR HUNT'
                  : mine.canReveal
                    ? 'REVEAL THE HUNT'
                    : mine.canBeginReckoning
                      ? `ADVANCE RECKONING${game.pendingEncounterStage ? ` · ${game.pendingEncounterStage.toUpperCase()}` : ''}`
                      : mine.canEndTurn
                        ? 'FINISH THE ROUND'
                        : pendingPlayer ? `WAITING FOR ${pendingPlayer.displayName.toUpperCase()}` : 'WATCH THE SIGNAL';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: NOT_ALONE.bg }} edges={['top', 'right', 'bottom', 'left']}>
      <Text accessible accessibilityLiveRegion={connectionState === 'error' ? 'assertive' : 'polite'} style={{ position: 'absolute', left: -10_000, width: 1, height: 1, overflow: 'hidden' }}>{decisionAnnouncement}</Text>
      <ScrollView ref={mainScrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ width: '100%', maxWidth: 1280, alignSelf: 'center', paddingHorizontal: narrow ? 10 : compact ? 14 : 20, paddingTop: 10, paddingBottom: 40, gap: 16 }}>
        <View nativeID="not-alone-toolbar" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <ScalePressable accessibilityLabel="Back to arcade" accessibilityHint="Opens the forfeit confirmation" onPress={handleBack} style={{ width: 48, height: 48, borderRadius: 13, borderWidth: 1, borderColor: NOT_ALONE.border, backgroundColor: NOT_ALONE.surface, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={NOT_ALONE.signal} />
          </ScalePressable>
          {!narrow ? <NotAloneMark size={42} /> : null}
          <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160, minWidth: 0 }}>
            <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.signal, fontSize: narrow ? 17 : 20, letterSpacing: 1.2 }}>NOT ALONE</Text>
            <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21 }}>ROUND {game.roundNumber} · {phaseLabel(game.phase)}</Text>
          </View>
          <ScalePressable accessibilityLabel="How to play" onPress={() => setRules(true)} style={{ width: 48, height: 48, borderRadius: 13, borderWidth: 1, borderColor: NOT_ALONE.amber, backgroundColor: `${NOT_ALONE.amber}12`, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="book-open-variant" size={20} color={NOT_ALONE.amber} />
          </ScalePressable>
        </View>

        <Text nativeID="not-alone-mode-summary" style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>Original 2016 base · Digital adaptations in How to play</Text>

        {connectionState !== 'connected' ? (
          <View accessible accessibilityLabel="Connection status" style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: `${NOT_ALONE.creature}77`, backgroundColor: `${NOT_ALONE.creature}12`, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="connection" size={18} color={NOT_ALONE.creature} />
            <Text style={{ flex: 1, ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.creature, fontSize: 14, lineHeight: 21 }}>{connectionState === 'error' ? 'Could not reconnect. Check your network.' : 'Reconnecting to the Artemia signal. Decisions are paused…'}</Text>
          </View>
        ) : null}
        {feedback ? (
          <View style={{ minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: NOT_ALONE.border, backgroundColor: NOT_ALONE.surface, paddingHorizontal: 11, justifyContent: 'center' }}>
            <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21 }}>{feedback}</Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Meter label="RESCUE" value={game.rescueProgress} goal={game.rescueGoal} color={NOT_ALONE.safe} icon="rocket-launch-outline" />
          <Meter label="ASSIMILATION" value={game.assimilationProgress} goal={game.assimilationGoal} color={NOT_ALONE.creature} icon="alien-outline" />
        </View>

        <View
          accessible
          accessibilityLabel={`${boardFaceLabel}. ${artemiaStatusSentence} Artemia activation spaces are Rescue ${artemiaActivationSpaces.join(', ')}.`}
          style={{ borderRadius: 14, borderWidth: 1, borderColor: game.artemiaAvailable ? NOT_ALONE.signal : NOT_ALONE.border, backgroundColor: game.artemiaAvailable ? `${NOT_ALONE.signal}12` : NOT_ALONE.surface, padding: 11, gap: 4 }}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 7 }}>
            <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.amber, fontSize: 12, lineHeight: 19 }}>{boardFaceLabel}</Text>
            <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: game.artemiaAvailable ? NOT_ALONE.signal : NOT_ALONE.muted, fontSize: 12, lineHeight: 19 }}>{artemiaStatusLabel}</Text>
          </View>
          <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>MARKED RESCUE SPACES · {artemiaActivationSpaces.join(' · ')}</Text>
        </View>

        <View accessible accessibilityLabel={`You are ${isCreature ? 'the Creature' : 'one of the Hunted'}`} style={{ borderRadius: 16, borderWidth: 1, borderColor: isCreature ? NOT_ALONE.creature : NOT_ALONE.signal, backgroundColor: NOT_ALONE.surface, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <MaterialCommunityIcons name={isCreature ? 'alien-outline' : 'account-eye-outline'} size={27} color={isCreature ? NOT_ALONE.creature : NOT_ALONE.signal} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: isCreature ? NOT_ALONE.creature : NOT_ALONE.signal, fontSize: 14 }}>{isCreature ? 'YOU ARE THE CREATURE' : 'YOU ARE HUNTED'}</Text>
            <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21, marginTop: 2 }}>{isCreature ? 'Only you can see the Hunt cards below. Predict every secret path.' : 'Only you can see your Place and Survival cards. Your locked destination stays private until reveal.'}</Text>
          </View>
        </View>

        {game.selectionBlockedPlaces.length ? (
          <View accessible accessibilityRole="alert" style={{ borderRadius: 14, borderWidth: 2, borderColor: NOT_ALONE.creature, backgroundColor: `${NOT_ALONE.creature}12`, padding: 12 }}>
            <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.creature, fontSize: 13 }}>FORCE FIELD · INACCESSIBLE THIS TURN · {game.selectionBlockedPlaces.map((place) => `PLACE ${place}`).join(' + ')}</Text>
            <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.text, fontSize: 14, lineHeight: 21, marginTop: 4 }}>{game.selectionBlockedPlaces.map((place) => NOT_ALONE_PLACE_BY_ID[place].name).join(' and ')} cannot be selected or entered by Detour or Vortex. Their Place powers being ineffective is a different state, marked separately on the map.</Text>
          </View>
        ) : null}

        <View nativeID="not-alone-play-area" onLayout={event => { playAreaYRef.current = event.nativeEvent.layout.y; setPlayAreaWidth(event.nativeEvent.layout.width); updateSectionOffsets(); }} style={{ flexDirection: decisionBesideTable ? 'row' : 'column', alignItems: 'flex-start', gap: 16 }}>
        <View style={{ minWidth: 0, maxWidth: '100%', gap: 16, ...(decisionBesideTable ? { flexBasis: 520, flexGrow: 1.3, flexShrink: 1 } : { width: '100%' }) }}>
        <View nativeID="not-alone-decision-area" onLayout={(event) => { decisionInnerYRef.current = event.nativeEvent.layout.y; updateSectionOffsets(); }} style={{ minWidth: 0, maxWidth: '100%', borderRadius: 18, borderWidth: localDecisionKey ? 2 : 1, borderColor: localDecisionKey ? NOT_ALONE.signal : NOT_ALONE.border, backgroundColor: NOT_ALONE.panel, padding: 13, gap: 12, boxShadow: '0 4px 0 #06030C' }}>
          <Text ref={decisionHeadingRef} nativeID="not-alone-decision-heading" accessible accessibilityRole="header" style={{ ...nameWrapping, fontFamily: 'Outfit_800ExtraBold', color: localDecisionKey ? NOT_ALONE.signal : NOT_ALONE.text, fontSize: 17, lineHeight: 24, textAlign: 'center' }}>{decisionTitle}</Text>
          <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>{decisionAnnouncement}</Text>
          {!tableChoicePending && (mine.playableHuntCardIds.length > 0 || mine.playableSurvivalCardIds.length > 0) ? <NeonButton label={`VIEW ${isCreature ? mine.playableHuntCardIds.length : mine.playableSurvivalCardIds.length} PLAYABLE ${isCreature ? 'HUNT' : 'SURVIVAL'} CARD${(isCreature ? mine.playableHuntCardIds.length : mine.playableSurvivalCardIds.length) === 1 ? '' : 'S'}`} color={isCreature ? NOT_ALONE.creature : NOT_ALONE.signal} variant="outline" onPress={() => jumpToSection(handZoneYRef.current, 'not-alone-private-hand')} accessibilityHint="Moves to your private hand without passing or playing a card" /> : null}

          {cardChoice ? (
            <View style={{ gap: 9 }}>
              <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>{cardChoice.kind === 'phobia' ? `Select ${cardChoice.count} cards to KEEP HIDDEN. Every other available card is revealed only to the Creature.` : cardChoice.kind === 'artefact_order' ? 'Select both revealed Places in the order they should resolve. Your first click resolves first.' : cardChoice.kind === 'artemia_discard' ? 'Privately discard one other Place from your hand. Your currently explored physical card is not an option.' : cardChoice.kind === 'forbidden_zone' ? 'Choose one unplayed Place and seal it. Every affected Hunted commits privately before any chosen card is discarded or revealed.' : `Select exactly ${cardChoice.count} card${cardChoice.count === 1 ? '' : 's'} to discard. This choice is private.`}</Text>
              {cardChoice.kind === 'artefact_order' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {cardChoice.placeIndexes.map((placeIndex) => <ChoiceButton key={`artefact-slot-${placeIndex}`} label={exploredSlotLabel(placeIndex)} icon="numeric" selected={choiceIndexes.includes(placeIndex)} onPress={() => toggleChoiceIndex(placeIndex, cardChoice.count)} />)}
                </View>
              ) : <PlaceChoiceGrid places={cardChoice.placeOptions} selected={choicePlaces} onToggle={(place) => toggleChoicePlace(place, cardChoice.count)} />}
              {cardChoice.kind === 'artefact_order' && choiceIndexes.length ? <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.signal, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>{choiceIndexes.map((placeIndex, index) => `${index + 1}${index === 0 ? 'ST' : 'ND'} · ${exploredSlotLabel(placeIndex)}`).join('\n')}</Text> : null}
              <NeonButton label={cardChoice.kind === 'phobia' ? `KEEP ${cardChoice.count} HIDDEN` : cardChoice.kind === 'artefact_order' ? 'CONFIRM ARTEFACT ORDER' : cardChoice.kind === 'forbidden_zone' ? 'SEAL PRIVATE DISCARD' : `DISCARD ${cardChoice.count}`} color={NOT_ALONE.signal} disabled={busy || !cardChoiceValid} onPress={submitCardChoice} />
            </View>
          ) : null}

          {forbiddenChoicePending && !cardChoice ? (
            <View
              accessible
              role="status"
              accessibilityLiveRegion="polite"
              accessibilityLabel={decisionAnnouncement}
              style={{ borderRadius: 13, borderWidth: 1, borderColor: NOT_ALONE.amber, backgroundColor: `${NOT_ALONE.amber}10`, padding: 11, gap: 5 }}
            >
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.amber, fontSize: 12, lineHeight: 19, textAlign: 'center' }}>FORBIDDEN ZONE · {game.pendingCardChoice!.submittedCount}/{game.pendingCardChoice!.eligibleCount} CHOICES SEALED</Text>
              <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.text, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>{mine.cardChoiceSubmitted ? 'YOUR CHOICE IS SEALED · WAITING FOR OTHER AFFECTED HUNTED' : mine.role === 'creature' ? 'WAITING FOR AFFECTED HUNTED · DISCARD IDENTITIES REMAIN PRIVATE' : 'YOU ARE NOT AFFECTED · WAITING FOR THE SEALED CHOICES'}</Text>
            </View>
          ) : null}

          {!tableChoicePending && mine.canChooseSurvivalCard ? (
            <View style={{ gap: 10 }}>
              <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>Keep one card for your private hand. The other card is discarded.</Text>
              {mine.survivalChoiceCards.map((cardId) => {
                const card = NOT_ALONE_SURVIVAL_BY_ID[cardId];
                return <View key={cardId} style={{ gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: NOT_ALONE.border }}>
                  <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.signal, fontSize: 14 }}>{card.name} · PHASE {card.phase}</Text>
                  <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.text, fontSize: 14, lineHeight: 21 }}>{card.summary}</Text>
                  <NeonButton label={`KEEP ${card.name.toUpperCase()}`} color={NOT_ALONE.signal} variant="outline" disabled={busy} onPress={() => sendAction('notalone:survival-choice', 'survival_choice', `Keep ${card.name}`, { cardId })} />
                </View>;
              })}
            </View>
          ) : null}

          {!tableChoicePending && mine.canChooseRiver ? (
            <View style={{ gap: 8 }}>
              <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>The Hunt tokens are locked. Choose which prepared Place is real. The unused decoy remains hidden.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>{mine.selectedPlaces.map((place) => <NotAlonePlaceCard key={place} placeId={place} compact accessibilityHint="Choose this as your real destination immediately" onPress={() => sendAction('notalone:river-choice', 'river_choice', `Choose River destination ${place}`, { explorePlaceId: place })} />)}</View>
            </View>
          ) : null}

          {!tableChoicePending && mine.canSelect ? (
            <View style={{ gap: 9 }}>
              <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: despairReselection ? NOT_ALONE.creature : NOT_ALONE.amber, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>{despairReselection ? 'DESPAIR RETURNED EVERY LOCKED DESTINATION. Choose again. Survival cards already played remain spent, and no further Survival card can be played or drawn this round.' : mine.selectionMode === 'river' ? 'Prepare two possible destinations. Your real choice comes after the Hunt tokens are placed.' : mine.selectionMode === 'artefact' ? 'Choose two different Places. Both resolve during Reckoning.' : 'Choose one Place from your private hand.'}</Text>
              <PlaceChoiceGrid places={mine.placeHand} selected={explorationSelection} selectionBlockedPlaces={game.selectionBlockedPlaces} onToggle={toggleExploration} />
              <NeonButton label={`LOCK ${mine.requiredSelectionCount} SECRET PLACE${mine.requiredSelectionCount === 1 ? '' : 'S'}`} color={NOT_ALONE.signal} disabled={busy || explorationSelection.length !== mine.requiredSelectionCount} onPress={() => sendAction('notalone:select', 'select', 'Lock secret destination', { placeIds: explorationSelection })} />
              {!mine.selectedPlaces.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {mine.resistOptions.map((option) => <ChoiceButton key={option.willCost} label={`RESIST · ${option.willCost} WILL / ${option.recoveryCount} PLACES`} icon={option.willCost === 1 ? 'shield-half-full' : 'shield-alert-outline'} color={NOT_ALONE.amber} disabled={busy} onPress={() => openMode({ kind: 'resist', revision: game.revision, willCost: option.willCost })} />)}
                  {mine.canGiveUp ? <ChoiceButton label="GIVE UP" icon="flag-outline" color={NOT_ALONE.creature} disabled={busy} onPress={confirmGiveUp} /> : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {showResolutionControls && resolution ? (
            <View style={{ gap: 9 }}>
              {resolution.mustUsePlacePower ? <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.signal, fontSize: 14, lineHeight: 21 }}>LAIR COPY COMMITTED · Complete {NOT_ALONE_PLACE_BY_ID[resolution.effectivePlaceId].name}'s power below. Your physical explored Place is unchanged.</Text> : null}
              {!resolution.canUsePlacePower && !resolution.canRecoverPlace ? <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.creature, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>A Hunt token or effect intercepts this Place. Resolve any exact hazard choices, then continue.</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {resolution.canUsePlacePower ? <ChoiceButton label="USE PLACE POWER" icon="lightning-bolt-outline" disabled={busy} onPress={() => openMode({ kind: 'resolve', revision: game.revision, mode: 'power' })} /> : null}
                {resolution.canRecoverPlace ? <ChoiceButton label={resolution.recoverCount ? 'RECOVER ONE PLACE' : 'SKIP PLACE POWER'} icon="cards-playing-outline" color={NOT_ALONE.amber} disabled={busy} onPress={() => openMode({ kind: 'resolve', revision: game.revision, mode: 'recover' })} /> : null}
                {!resolution.canUsePlacePower && !resolution.canRecoverPlace && resolution.canContinue ? <ChoiceButton label="RESOLVE INTERCEPTION" icon="shield-alert-outline" color={NOT_ALONE.creature} disabled={busy} onPress={() => openMode({ kind: 'resolve', revision: game.revision, mode: 'power' })} /> : null}
              </View>
            </View>
          ) : null}

          {!tableChoicePending && mine.canPass ? <NeonButton label="PASS REACTION" color={NOT_ALONE.amber} variant="outline" disabled={busy} accessibilityHint="Confirms you will play no more cards in this reaction window" onPress={() => sendAction('notalone:pass', 'pass', 'Pass reaction')} /> : null}
          {!tableChoicePending && mine.canBeginHunt ? <NeonButton label="BEGIN THE HUNT" color={NOT_ALONE.creature} disabled={busy} onPress={() => sendAction('notalone:begin-hunt', 'begin_hunt', 'Begin the Hunt')} /> : null}
          {!tableChoicePending && mine.canLockHunt ? <NeonButton label="LOCK HUNT POSITIONS" color={NOT_ALONE.creature} disabled={busy} accessibilityHint="Locks every Hunt token before the Hunted phase-two reaction window" onPress={() => sendAction('notalone:lock-hunt', 'lock_hunt', 'Lock Hunt positions')} /> : null}
          {!tableChoicePending && mine.canReveal ? <NeonButton label="REVEAL DESTINATIONS" color={NOT_ALONE.creature} disabled={busy} accessibilityHint="Reveals every real Hunted destination after locked-token reactions and River choices finish" onPress={() => sendAction('notalone:reveal', 'reveal', 'Reveal destinations')} /> : null}
          {!tableChoicePending && mine.canBeginReckoning ? <NeonButton label="ADVANCE RECKONING" color={NOT_ALONE.creature} disabled={busy} accessibilityHint="Closes this reaction window and resolves the next Place or encounter" onPress={() => sendAction('notalone:begin-reckoning', 'begin_reckoning', 'Advance Reckoning')} /> : null}
          {!tableChoicePending && mine.canEndTurn ? <NeonButton label="FINISH ROUND" color={NOT_ALONE.amber} disabled={busy} onPress={() => sendAction('notalone:end-turn', 'end_turn', 'Finish round')} /> : null}

          {!tableChoicePending && mode?.kind === 'resist' && resistOption ? (
            <View style={{ borderRadius: 14, borderWidth: 1, borderColor: NOT_ALONE.amber, padding: 11, gap: 8 }}>
              <SectionHeading detail={`${choicePlaces.length}/${resistOption.recoveryCount} selected`}>CHOOSE EXACT PLACES TO RECOVER</SectionHeading>
              <PlaceChoiceGrid places={me.discard} selected={choicePlaces} onToggle={(place) => toggleChoicePlace(place, resistOption.recoveryCount)} />
              <NeonButton label={`SPEND ${mode.willCost} WILL · RECOVER ${resistOption.recoveryCount}`} color={NOT_ALONE.amber} disabled={busy || choicePlaces.length !== resistOption.recoveryCount} onPress={() => sendAction('notalone:resist', 'resist', 'Resist', { willCost: mode.willCost, placeIds: choicePlaces })} />
              <NeonButton label="CANCEL" color={NOT_ALONE.muted} variant="ghost" disabled={busy} onPress={cancelChoice} />
            </View>
          ) : null}

          {!tableChoicePending && survivalCardId ? (
            <View style={{ borderRadius: 14, borderWidth: 1, borderColor: NOT_ALONE.signal, padding: 11, gap: 8 }}>
              <SectionHeading detail={survivalCardId === 'vortex' ? `${survivalPlaceIndex === null ? 0 : 1}/1 slot · ${choicePlaces.length}/1 replacement` : survivalCardId === 'double_back' ? `${survivalPlaceIndex === null ? 0 : 1}/1 physical card` : `${choicePlaces.length}/${survivalNeeded} selected`}>{`PLAY ${NOT_ALONE_SURVIVAL_BY_ID[survivalCardId].name.toUpperCase()}`}</SectionHeading>
              <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>{NOT_ALONE_SURVIVAL_BY_ID[survivalCardId].summary}</Text>
              {survivalCardId === 'vortex' ? <><Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21 }}>First choose the exact prepared slot to replace. The other physical Artefact card stays unchanged, even when both destinations currently match.</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{mine.survivalOptions.vortexSelectedPlaceIndexes.map((placeIndex) => <ChoiceButton key={`vortex-slot-${placeIndex}`} label={`REPLACE ${exploredSlotLabel(placeIndex)}`} icon="swap-horizontal" selected={survivalPlaceIndex === placeIndex} onPress={() => setSurvivalPlaceIndex(placeIndex as 0 | 1)} />)}</View><Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21 }}>Then choose one legal discarded Place to swap into that slot.</Text></> : null}
              {survivalCardId === 'double_back' ? <><Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21 }}>Choose the exact physical Place card to return. A Detour changes its destination, not the card you originally played.</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{mine.survivalOptions.doubleBackPlaceIndexes.map((placeIndex) => <ChoiceButton key={`double-back-slot-${placeIndex}`} label={`RETURN ${exploredSlotLabel(placeIndex)}`} icon="undo-variant" selected={survivalPlaceIndex === placeIndex} onPress={() => setSurvivalPlaceIndex(placeIndex as 0 | 1)} />)}</View></> : null}
              {survivalCardId === 'wrong_track' && effectiveHuntCards.includes('clone') && game.huntTokens.target.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ChoiceButton label="MOVE CREATURE" icon="alien-outline" selected={chosenToken === 'creature'} onPress={() => { setChosenToken('creature'); setChoicePlaces([]); }} /><ChoiceButton label="MOVE CLONE TARGET" icon="crosshairs-gps" selected={chosenToken === 'target'} onPress={() => { setChosenToken('target'); setChoicePlaces([]); }} /></View> : null}
              <PlaceChoiceGrid places={survivalPlaces} selected={choicePlaces} onToggle={(place) => toggleChoicePlace(place, survivalNeeded)} />
              <NeonButton label={`CONFIRM ${NOT_ALONE_SURVIVAL_BY_ID[survivalCardId].name.toUpperCase()}`} color={NOT_ALONE.signal} disabled={busy || !survivalChoiceValid} onPress={submitSurvival} />
              <NeonButton label="CANCEL" color={NOT_ALONE.muted} variant="ghost" disabled={busy} onPress={cancelChoice} />
            </View>
          ) : null}

          {!tableChoicePending && huntCardId && huntEffect ? (
            <View style={{ borderRadius: 14, borderWidth: 1, borderColor: NOT_ALONE.creature, padding: 11, gap: 8 }}>
              <SectionHeading detail={huntCardId === 'flashback' ? `copies ${NOT_ALONE_HUNT_BY_ID[huntEffect].name}` : undefined}>{`PLAY ${NOT_ALONE_HUNT_BY_ID[huntCardId].name.toUpperCase()}`}</SectionHeading>
              <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>{NOT_ALONE_HUNT_BY_ID[huntEffect].summary}</Text>
              {huntNeedsTarget ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{huntTargetPlayerIds.map((id) => { const player = game.players.find((candidate) => candidate.playerId === id); return <ChoiceButton key={id} label={player?.displayName.toUpperCase() ?? 'HUNTED'} icon="account-search-outline" color={NOT_ALONE.creature} selected={targetPlayerId === id} onPress={() => { setTargetPlayerId(id); setDetourOriginPlace(null); setDetourPlaceIndex(null); setChoicePlaces([]); }} />; })}</View> : null}
              {huntEffect === 'detour' && targetPlayerId ? <>
                <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21 }}>Choose the exact revealed physical slot to move. Detour changes its destination, not the Place card that will later be discarded or returned.</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {detourOptionsForTarget.map((option) => <ChoiceButton key={`detour-${option.playerId}-${option.placeIndex}-${option.originPlaceId}`} label={`MOVE SLOT ${option.placeIndex + 1} · CURRENT ${option.originPlaceId} ${NOT_ALONE_PLACE_BY_ID[option.originPlaceId].name.toUpperCase()}`} icon="map-marker-path" color={NOT_ALONE.creature} selected={detourPlaceIndex === option.placeIndex && detourOriginPlace === option.originPlaceId} onPress={() => { setDetourPlaceIndex(option.placeIndex); setDetourOriginPlace(option.originPlaceId); setChoicePlaces([]); }} />)}
                </View>
              </> : null}
              {huntPlaceCount && (huntEffect !== 'detour' || selectedDetourOption) ? <><Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21 }}>{huntPlaceCount === 2 ? 'Choose two adjacent Places.' : huntEffect === 'detour' ? 'Choose one projected adjacent destination. It may match the other Artefact slot.' : huntEffect === 'cataclysm' ? 'Choose one Place where disabling its unresolved power can still change this Reckoning.' : 'Choose one Place.'}</Text><PlaceChoiceGrid places={huntPlaceOptions} selected={choicePlaces} onToggle={(place) => toggleChoicePlace(place, huntPlaceCount)} /></> : null}
              <NeonButton label={`CONFIRM ${NOT_ALONE_HUNT_BY_ID[huntCardId].name.toUpperCase()}`} color={NOT_ALONE.creature} disabled={busy || !huntChoiceValid} onPress={submitHunt} />
              <NeonButton label="CANCEL" color={NOT_ALONE.muted} variant="ghost" disabled={busy} onPress={cancelChoice} />
            </View>
          ) : null}

          {!tableChoicePending && tokenMode ? (
            <View style={{ borderRadius: 14, borderWidth: 1, borderColor: tokenMode === 'creature' ? NOT_ALONE.creature : NOT_ALONE.amber, padding: 11, gap: 8 }}>
              <SectionHeading detail={`${choicePlaces.length}/${tokenPlaceCount} selected`}>{`POSITION ${tokenMode.toUpperCase()} TOKEN`}</SectionHeading>
              <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>{tokenPlaceCount === 2 ? 'Choose two different adjacent Places. This shared footprint applies every same-symbol Hunt effect.' : 'Choose one Place.'}</Text>
              <PlaceChoiceGrid places={ALL_PLACES} selected={choicePlaces} onToggle={(place) => toggleChoicePlace(place, tokenPlaceCount)} />
              <NeonButton label={`PLACE ${tokenMode.toUpperCase()} TOKEN`} color={tokenMode === 'creature' ? NOT_ALONE.creature : NOT_ALONE.amber} disabled={busy || !tokenChoiceValid} onPress={submitToken} />
              <NeonButton label="CANCEL" color={NOT_ALONE.muted} variant="ghost" disabled={busy} onPress={cancelChoice} />
            </View>
          ) : null}

          {!tableChoicePending && resolutionMode && resolution ? (
            <View style={{ borderRadius: 14, borderWidth: 1, borderColor: NOT_ALONE.signal, padding: 11, gap: 9 }}>
              <SectionHeading detail={effectiveResolutionPlace !== resolution.placeId ? `copied from Place ${effectiveResolutionPlace}` : undefined}>{resolution.canUsePlacePower || resolution.canRecoverPlace ? `RESOLVE ${NOT_ALONE_PLACE_BY_ID[resolution.placeId].name.toUpperCase()}` : 'RESOLVE HUNT EFFECTS'}</SectionHeading>
              {screamRequired ? <View style={{ gap: 7 }}><Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.creature, fontSize: 14, lineHeight: 21 }}>SCREAM: choose one currently projected consequence for this Target layer.</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{resolution.canLoseWillForScream ? <ChoiceButton label="LOSE 1 WILL" icon="heart-broken-outline" color={NOT_ALONE.creature} selected={huntChoice === 'will'} onPress={() => { setHuntChoice('will'); setHazardPlaces([]); }} /> : null}{resolution.screamDiscardCount > 0 ? <ChoiceButton label={`DISCARD ${resolution.screamDiscardCount} PLACES`} icon="cards-outline" color={NOT_ALONE.creature} disabled={resolution.screamDiscardPlaceIds.length < resolution.screamDiscardCount} selected={huntChoice === 'discard'} onPress={() => { setHuntChoice('discard'); setHazardPlaces([]); }} /> : null}</View>{huntChoice === 'discard' ? <PlaceChoiceGrid places={resolution.screamDiscardPlaceIds} selected={hazardPlaces} onToggle={(place) => setHazardPlaces((current) => current.includes(place) ? current.filter((id) => id !== place) : current.length < resolution.screamDiscardCount ? [...current, place] : [...current.slice(1), place])} /> : null}</View> : null}
              {toxinRequired ? <View style={{ gap: 7 }}><Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.creature, fontSize: 14, lineHeight: 21 }}>TOXIN: choose one Survival card to discard.</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{resolution.toxinSurvivalCardIds.map((cardId) => <ChoiceButton key={cardId} label={NOT_ALONE_SURVIVAL_BY_ID[cardId].name.toUpperCase()} icon="cards-outline" color={NOT_ALONE.creature} selected={toxinCardId === cardId} onPress={() => setToxinCardId(cardId)} />)}</View></View> : null}
              {resolutionMode === 'recover' ? <><Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21 }}>{resolution.recoverCount ? 'Choose one discarded Place to recover.' : 'You have no discarded Place to recover. Confirm to continue without using the Place power.'}</Text><PlaceChoiceGrid places={resolution.recoverablePlaceIds} selected={choicePlaces} onToggle={(place) => toggleChoicePlace(place, resolution.recoverCount)} /></> : null}
              {resolutionMode === 'power' && resolution.canUsePlacePower && effectiveResolutionPlace === 1 ? <><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ChoiceButton label={`RECOVER ${resolution.powerRecoveryCount || 'NO'} DISCARDED`} icon="cards-playing-outline" selected={powerChoice === 'recover'} onPress={() => { setPowerChoice('recover'); setChoicePlaces([]); }} /><ChoiceButton label="COPY CREATURE PLACE" icon="content-copy" disabled={!resolution.copyablePlaceIds.length} selected={powerChoice === 'copy'} onPress={() => { setPowerChoice('copy'); setChoicePlaces([]); }} /></View>{powerChoice === 'recover' ? <PlaceChoiceGrid places={resolution.powerRecoverablePlaceIds} selected={choicePlaces} onToggle={(place) => toggleChoicePlace(place, resolution.powerRecoveryCount)} /> : null}{powerChoice === 'copy' ? <PlaceChoiceGrid places={resolution.copyablePlaceIds} selected={choicePlaces} onToggle={(place) => toggleChoicePlace(place, 1)} /> : null}</> : null}
              {resolutionMode === 'power' && resolution.canUsePlacePower && (effectiveResolutionPlace === 2 || effectiveResolutionPlace === 6) ? persecutionReturnChoice ? <>
                <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.creature, fontSize: 14, lineHeight: 21 }}>PERSECUTION: return exactly one Place card total. Choose the physical {NOT_ALONE_PLACE_BY_ID[resolution.returnablePlayedPlaceId!].name} you played, or recover one discarded Place instead.</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <ChoiceButton label={`RETURN PLAYED ${NOT_ALONE_PLACE_BY_ID[resolution.returnablePlayedPlaceId!].name.toUpperCase()}`} icon="undo-variant" color={NOT_ALONE.creature} selected={powerChoice === 'return_played'} onPress={() => { setPowerChoice('return_played'); setChoicePlaces([]); }} />
                  {resolution.powerRecoveryCount > 0 ? <ChoiceButton label="RECOVER ONE DISCARDED PLACE" icon="cards-playing-outline" color={NOT_ALONE.amber} selected={powerChoice === 'recover'} onPress={() => { setPowerChoice('recover'); setChoicePlaces([]); }} /> : null}
                </View>
                {powerChoice === 'recover' ? <PlaceChoiceGrid places={resolution.powerRecoverablePlaceIds} selected={choicePlaces} onToggle={(place) => toggleChoicePlace(place, resolution.powerRecoveryCount)} /> : null}
              </> : <><Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21 }}>Choose exactly {resolution.powerRecoveryCount} discarded Place{resolution.powerRecoveryCount === 1 ? '' : 's'} to recover.{resolution.canReturnPlayedPlace && resolution.returnablePlayedPlaceId ? ` Your played ${NOT_ALONE_PLACE_BY_ID[resolution.returnablePlayedPlaceId].name} also returns.` : ''}</Text><PlaceChoiceGrid places={resolution.powerRecoverablePlaceIds} selected={choicePlaces} onToggle={(place) => toggleChoicePlace(place, resolution.powerRecoveryCount)} /></> : null}
              {resolutionMode === 'power' && resolution.canUsePlacePower && effectiveResolutionPlace === 4 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{resolution.beachChoices.map((choice) => <ChoiceButton key={choice} label={choice === 'launch' ? 'LAUNCH · +1 RESCUE' : 'CHARGE BEACON'} icon={choice === 'launch' ? 'rocket-launch-outline' : 'battery-charging-outline'} selected={powerChoice === choice} onPress={() => setPowerChoice(choice)} />)}</View> : null}
              {resolutionMode === 'power' && resolution.canUsePlacePower && effectiveResolutionPlace === 5 ? <><Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21 }}>Choose one available advanced Place from the shared reserve.</Text><PlaceChoiceGrid places={resolution.roverPlaceIds} selected={choicePlaces} onToggle={(place) => toggleChoicePlace(place, 1)} /></> : null}
              {resolutionMode === 'power' && resolution.canUsePlacePower && effectiveResolutionPlace === 9 ? <><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{resolution.sourceChoices.includes('card') ? <ChoiceButton label="DRAW SURVIVAL CARD" icon="cards-outline" selected={powerChoice === 'card'} onPress={() => { setPowerChoice('card'); setTargetPlayerId(null); }} /> : null}{resolution.sourceChoices.includes('will') ? <ChoiceButton label="RESTORE 1 WILL" icon="heart-plus-outline" selected={powerChoice === 'will'} onPress={() => setPowerChoice('will')} /> : null}</View>{powerChoice === 'will' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{resolution.healTargetPlayerIds.map((id) => { const player = game.players.find((candidate) => candidate.playerId === id); return <ChoiceButton key={id} label={player?.displayName.toUpperCase() ?? 'HUNTED'} icon="account-heart-outline" selected={targetPlayerId === id} onPress={() => setTargetPlayerId(id)} />; })}</View> : null}</> : null}
              <NeonButton label={resolution.canUsePlacePower || resolution.canRecoverPlace ? 'CONFIRM RESOLUTION' : 'CONTINUE RECKONING'} color={NOT_ALONE.signal} disabled={busy || !resolutionValid} onPress={submitResolution} />
              <NeonButton label="CANCEL" color={NOT_ALONE.muted} variant="ghost" disabled={busy} onPress={cancelChoice} />
            </View>
          ) : null}
        </View>

        {isCreature && game.phase === 'creature_planning' && !tableChoicePending ? (
          <View style={{ borderRadius: 18, borderWidth: 1, borderColor: NOT_ALONE.creature, backgroundColor: NOT_ALONE.panel, padding: 13, gap: 9 }}>
            <SectionHeading detail="Reposition before locking">HUNT TOKENS</SectionHeading>
            <NeonButton label="STUDY PUBLIC DISCARD TRAILS" color={NOT_ALONE.amber} variant="ghost" onPress={() => jumpToSection(trailZoneYRef.current, 'not-alone-public-trails')} accessibilityHint="Review the Place cards each Hunted has already discarded before choosing Hunt positions" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <ChoiceButton label={game.huntTokens.creature.length ? `CREATURE · PLACE ${game.huntTokens.creature.join(' + ')}` : 'PLACE CREATURE'} icon="alien-outline" color={NOT_ALONE.creature} disabled={busy} selected={game.huntTokens.creature.length > 0} onPress={() => openMode({ kind: 'token', revision: game.revision, token: 'creature' })} />
              {targetTokenRequired ? <ChoiceButton label={targetFootprintFixed ? `TARGET · FIXED · PLACE ${game.huntTokens.target.join(' + ')}` : game.huntTokens.target.length ? `TARGET · PLACE ${game.huntTokens.target.join(' + ')}` : 'PLACE TARGET'} icon="crosshairs-gps" color={NOT_ALONE.amber} disabled={busy || targetFootprintFixed} selected={game.huntTokens.target.length > 0} hint={targetFootprintFixed ? 'Force Field fixed this footprint before Exploration; it cannot be repositioned during Hunting' : 'Position or reposition the shared Target footprint before locking the Hunt'} onPress={() => openMode({ kind: 'token', revision: game.revision, token: 'target' })} /> : null}
              {artemiaTokenRequired ? <ChoiceButton label={game.huntTokens.artemia.length ? `ARTEMIA · PLACE ${game.huntTokens.artemia.join(' + ')}` : 'PLACE ARTEMIA'} icon="terrain" color={NOT_ALONE.signal} disabled={busy} selected={game.huntTokens.artemia.length > 0} onPress={() => openMode({ kind: 'token', revision: game.revision, token: 'artemia' })} /> : null}
            </View>
            <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>A two-Place token footprint must be adjacent. Same-symbol Hunt cards share one placement while all their effects apply.</Text>
          </View>
        ) : null}

        {anticipationTarget ? (
          <View
            accessible
            accessibilityRole="alert"
            accessibilityLabel={`Anticipation targets ${anticipationTarget.displayName}. This public declaration persists for the round. If that Hunted is caught, Assimilation advances one extra space.`}
            style={{ borderRadius: 14, borderWidth: 2, borderColor: NOT_ALONE.amber, backgroundColor: `${NOT_ALONE.amber}12`, padding: 12, gap: 4 }}
          >
            <Text accessibilityRole="header" style={{ ...nameWrapping, fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.amber, fontSize: 13, lineHeight: 18 }}>ANTICIPATION TARGET · {anticipationTarget.displayName.toUpperCase()}</Text>
            <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.text, fontSize: 14, lineHeight: 21 }}>PUBLIC DECLARATION · IF CAUGHT, +1 ASSIMILATION</Text>
          </View>
        ) : null}

        {game.activeHuntCards.length ? (
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: NOT_ALONE.creature, backgroundColor: NOT_ALONE.surface, padding: 12, gap: 8 }}>
            <SectionHeading>ACTIVE HUNT EFFECTS</SectionHeading>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{game.activeHuntCards.map((cardId, index) => { const shown = cardId === 'flashback' && game.copiedHuntCard ? game.copiedHuntCard : cardId; const card = NOT_ALONE_HUNT_BY_ID[shown]; return <View key={`${cardId}-${index}`} style={{ minWidth: 150, flex: 1, borderRadius: 11, borderWidth: 1, borderColor: `${NOT_ALONE.creature}66`, padding: 10 }}><Text style={{ fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.creature, fontSize: 12 }}>{cardId === 'flashback' ? `FLASHBACK · ${card.name.toUpperCase()}` : card.name.toUpperCase()}</Text><Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21, marginTop: 4 }}>{card.summary}</Text></View>; })}</View>
          </View>
        ) : null}

        {isCreature && Object.keys(mine.revealedHuntedHands).length ? (
          <View accessible accessibilityLabel="Private Phobia intelligence, visible only to the Creature" style={{ borderRadius: 16, borderWidth: 2, borderColor: NOT_ALONE.creature, backgroundColor: `${NOT_ALONE.creature}10`, padding: 12, gap: 8 }}>
            <SectionHeading detail="Creature only">PHOBIA INTELLIGENCE</SectionHeading>
            {Object.entries(mine.revealedHuntedHands).map(([id, places]) => <View key={id}><Text style={{ ...nameWrapping, fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.text, fontSize: 12 }}>{game.players.find((player) => player.playerId === id)?.displayName ?? 'Hunted'}</Text><Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.creature, fontSize: 14, lineHeight: 21 }}>{places.length ? places.map((place) => `PLACE ${place} · ${NOT_ALONE_PLACE_BY_ID[place].name}`).join('   ') : 'No cards were revealed.'}</Text></View>)}
          </View>
        ) : null}

        {!isCreature && mine.playedPlaces.length ? (
          <View accessible accessibilityLabel="Your private explored Place slots" style={{ borderRadius: 16, borderWidth: 1, borderColor: NOT_ALONE.signal, backgroundColor: `${NOT_ALONE.signal}0D`, padding: 12, gap: 7 }}>
            <SectionHeading detail={game.pendingEncounterStage ? `${game.pendingEncounterStage} layer` : 'Hunted only'}>YOUR EXPLORED ROUTE</SectionHeading>
            {mine.playedPlaces.map((_, placeIndex) => <Text key={`private-route-${placeIndex}`} style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.text, fontSize: 14, lineHeight: 21 }}>{exploredSlotLabel(placeIndex)}</Text>)}
            <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>A moved destination changes where the slot resolves. The originally played physical card is still the one later returned or discarded.</Text>
          </View>
        ) : null}

        {(mine.survivalHand.length || mine.huntHand.length) && game.status === 'playing' ? (
          <View onLayout={(event) => { handInnerYRef.current = event.nativeEvent.layout.y; updateSectionOffsets(); }} style={{ minWidth: 0, maxWidth: '100%', borderRadius: 18, borderWidth: 1, borderColor: NOT_ALONE.border, backgroundColor: '#0A0513', padding: 12, gap: 10, borderTopWidth: 3 }}>
            <View ref={handHeadingRef} accessible accessibilityRole="header" nativeID="not-alone-private-hand"><SectionHeading detail={isCreature ? `${mine.huntCardsPlayed}/${mine.maxHuntCards} played this round` : 'One Survival card per Hunted each round'}>{isCreature ? 'YOUR PRIVATE HUNT HAND' : 'YOUR PRIVATE SURVIVAL HAND'}</SectionHeading></View>
            {compact && privateHandCount > 1 ? <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>{privateHandCount} cards · swipe or scroll to browse</Text> : null}
            <ScrollView horizontal onLayout={event => setHandViewportWidth(event.nativeEvent.layout.width)} showsHorizontalScrollIndicator contentContainerStyle={{ gap: 12, paddingHorizontal: 2, paddingTop: 10, paddingBottom: 14, alignItems: 'stretch' }}>
              {isCreature ? mine.huntHand.map((cardId) => {
                const card = NOT_ALONE_HUNT_BY_ID[cardId];
                const playable = mine.playableHuntCardIds.includes(cardId);
                return <CardChip width={compact ? Math.max(1, handViewportWidth - 4) : Math.max(1, Math.min(handViewportWidth - 4, 244 * textScale))} cardId={cardId} key={cardId} title={`${card.name} · P${card.phase || 'COPY'}`} body={card.summary} color={NOT_ALONE.creature} disabled={busy || tableChoicePending || !playable} needsOptions={notAloneHuntNeedsOptions(cardId, mine.lastDiscardedHuntCard)} onPress={() => openHunt(cardId)} />;
              }) : mine.survivalHand.map((cardId) => {
                const card = NOT_ALONE_SURVIVAL_BY_ID[cardId];
                const playable = mine.playableSurvivalCardIds.includes(cardId);
                return <CardChip width={compact ? Math.max(1, handViewportWidth - 4) : Math.max(1, Math.min(handViewportWidth - 4, 244 * textScale))} cardId={cardId} key={cardId} title={`${card.name} · P${card.phase}`} body={card.summary} color={NOT_ALONE.signal} disabled={busy || tableChoicePending || !playable} needsOptions={notAloneSurvivalNeedsOptions(cardId)} onPress={() => openSurvival(cardId)} />;
              })}
            </ScrollView>
            <NeonButton label="RETURN TO CURRENT DECISION" color={NOT_ALONE.amber} variant="ghost" onPress={() => jumpToSection(decisionZoneYRef.current, 'not-alone-decision-heading')} />
          </View>
        ) : null}
        </View>

        <View nativeID="not-alone-public-table" onLayout={event => { publicColumnYRef.current = event.nativeEvent.layout.y; updateSectionOffsets(); }} style={{ minWidth: 0, maxWidth: '100%', gap: 16, ...(decisionBesideTable ? { flexBasis: 400, flexGrow: 1, flexShrink: 1 } : { width: '100%' }) }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {game.players.map((player) => {
            const roomSeat = room?.players.find((seat) => seat.playerId === player.playerId);
            const connectionLabel = player.forfeited ? notAloneForfeitLabel(game, player) : roomSeat?.isConnected === false ? 'RECONNECTING · SEAT RESERVED BRIEFLY' : player.reactionPassed ? 'REACTION PASSED' : player.role === 'hunted' && player.isReady ? 'DESTINATION LOCKED' : '';
            const movedSlots = player.revealedPlaces.flatMap((currentPlace, placeIndex) => {
              const originalPlace = player.originalRevealedPlaces[placeIndex];
              return originalPlace && originalPlace !== currentPlace ? [`SLOT ${placeIndex + 1} #${originalPlace}→#${currentPlace}`] : [];
            });
            return (
              <View key={player.playerId} accessible accessibilityLabel={`${player.displayName}. ${player.role}. ${player.will === null ? '' : `${player.will} Will.`} ${player.handCount} Place or Hunt cards. ${player.discardCount} discarded.${connectionLabel ? ` ${connectionLabel}.` : ''}${movedSlots.length ? ` Moved route: ${movedSlots.join(', ')}.` : ''}`} style={{ flexBasis: compact ? '100%' : 220 * textScale, flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: '100%', minHeight: 128, borderRadius: 14, borderWidth: player.playerId === game.pendingPlayerId ? 2 : 1, borderColor: player.forfeited ? NOT_ALONE.creature : player.playerId === game.pendingPlayerId ? NOT_ALONE.amber : player.role === 'creature' ? NOT_ALONE.creature : NOT_ALONE.border, backgroundColor: NOT_ALONE.surface, padding: 13, boxShadow: '0 3px 0 #06030C' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><MaterialCommunityIcons name={player.role === 'creature' ? 'alien-outline' : 'account-outline'} size={22} color={player.role === 'creature' ? NOT_ALONE.creature : NOT_ALONE.signal} /><Text style={{ ...nameWrapping, flex: 1, fontFamily: 'Outfit_800ExtraBold', color: player.playerId === playerId ? NOT_ALONE.amber : NOT_ALONE.text, fontSize: 16, lineHeight: 23 }}>{player.displayName}</Text></View>
                <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: player.role === 'creature' ? NOT_ALONE.creature : NOT_ALONE.signal, fontSize: 14, lineHeight: 21, marginTop: 4 }}>{player.role === 'creature' ? 'CREATURE' : `${player.will}/3 WILL`}</Text>
                {player.will !== null ? <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ flexDirection: 'row', gap: 6, marginVertical: 8 }}>{[0, 1, 2].map(will => <View key={will} style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: will < player.will! ? NOT_ALONE.signal : NOT_ALONE.bg, borderWidth: 1, borderColor: will < player.will! ? '#DEC7FF' : NOT_ALONE.border, borderBottomWidth: 3, boxShadow: '0 2px 2px #00000066' }} />)}</View> : null}
                <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>{player.handCount} {player.role === 'creature' ? 'HUNT' : 'PLACE'} · {player.discardCount} DISCARDED · {player.survivalCount} SURVIVAL</Text>
                {connectionLabel ? <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: player.forfeited || roomSeat?.isConnected === false ? NOT_ALONE.creature : NOT_ALONE.safe, fontSize: 14, lineHeight: 21, marginTop: 4 }}>{connectionLabel}</Text> : null}
                {player.revealedPlaces.length ? <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.amber, fontSize: 14, lineHeight: 21, marginTop: 4 }}>REVEALED · {player.revealedPlaces.map((place) => `#${place}`).join(' + ')}</Text> : null}
                {movedSlots.length ? <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.creature, fontSize: 14, lineHeight: 21, marginTop: 3 }}>MOVED · {movedSlots.join(' · ')}</Text> : null}
              </View>
            );
          })}
        </View>

        <View style={{ minWidth: 0, maxWidth: '100%', borderRadius: 18, borderWidth: 1, borderTopWidth: 3, borderColor: NOT_ALONE.border, backgroundColor: '#0A0513', padding: 12, gap: 12 }}>
          <SectionHeading detail={`${boardFaceLabel} · ${game.status === 'game_over' ? `FINAL ROUND ARTEMIA ${game.artemiaAvailable ? 'ACTIVE' : 'INACTIVE'}` : `ARTEMIA ${game.artemiaAvailable ? 'ACTIVE' : 'INACTIVE'}`}`}>ARTEMIA MAP</SectionHeading>
          <View onLayout={event => setMapWidth(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', paddingTop: 4, paddingBottom: 8 }}>
            {ALL_PLACES.map((place) => {
              const tokens = (['creature', 'target', 'artemia'] as const).filter((huntToken) => game.huntTokens[huntToken].includes(place));
              return <View key={place} style={{ minWidth: 0, maxWidth: '100%', alignItems: 'center', gap: 8 }}><NotAlonePlaceCard placeId={place} compact faceSizing={mapFaces.forCard(String(place))} selectionBlocked={game.selectionBlockedPlaces.includes(place)} powerDisabled={game.disabledPlaces.includes(place)} />
                {tokens.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4, maxWidth: 176 }}>{tokens.map(token => <View key={token} style={{ alignItems: 'center', gap: 2 }}><HuntTokenPiece token={token} /><Text style={{ fontFamily: 'Outfit_700Bold', color: token === 'creature' ? NOT_ALONE.creature : token === 'target' ? NOT_ALONE.amber : NOT_ALONE.signal, fontSize: 13, lineHeight: 19 }}>{token.toUpperCase()}</Text></View>)}</View> : <Text style={{ ...nameWrapping, minHeight: 32, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>{place >= 6 ? `${game.reserve[place]} IN RESERVE` : 'BASE PLACE'}</Text>}
              </View>;
            })}
          </View>
        </View>

        <View onLayout={(event) => { trailInnerYRef.current = event.nativeEvent.layout.y; updateSectionOffsets(); }} style={{ minWidth: 0, maxWidth: '100%', borderRadius: 16, borderWidth: 1, borderColor: NOT_ALONE.border, backgroundColor: NOT_ALONE.surface, padding: 12, gap: 10 }}>
          <View ref={trailHeadingRef} accessible accessibilityRole="header" nativeID="not-alone-public-trails"><SectionHeading>PUBLIC DISCARD TRAILS</SectionHeading></View>
          <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>Active Hunted can recover these discarded Places. Removed seats retain historical cards only. Card effects can still change active destinations.</Text>
          {game.players.filter((player) => player.role === 'hunted').map((player) => (
            <View key={player.playerId} style={{ borderTopWidth: 1, borderTopColor: NOT_ALONE.border, paddingTop: 8, gap: 4 }}>
              <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: player.playerId === playerId ? NOT_ALONE.amber : NOT_ALONE.text, fontSize: 15, lineHeight: 22 }}>{player.displayName}{player.playerId === playerId ? ' · YOU' : ''} · {player.discardCount} discarded</Text>
              {player.forfeited ? <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.creature, fontSize: 14, lineHeight: 21 }}>{notAloneForfeitLabel(game, player)}</Text> : null}
              <Text nativeID={`not-alone-trail-${player.playerId}`} style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>{player.discard.length ? player.discard.map((place) => `#${place} ${NOT_ALONE_PLACE_BY_ID[place].name}`).join(' · ') : player.discardCount > 0 ? 'Hidden by Smokescreen this round.' : 'No discarded Places.'}</Text>
            </View>
          ))}
          <NeonButton label="RETURN TO CURRENT DECISION" color={NOT_ALONE.amber} variant="ghost" onPress={() => jumpToSection(decisionZoneYRef.current, 'not-alone-decision-heading')} />
        </View>
        </View>
        </View>

        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: NOT_ALONE.border, backgroundColor: NOT_ALONE.surface, padding: 12 }}>
          <SectionHeading>SIGNAL LOG</SectionHeading>
          {game.log.slice(-8).map((entry) => <Text key={entry.id} style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21, marginTop: 5 }}>{entry.text}</Text>)}
        </View>
      </ScrollView>

      <Modal visible={Boolean(gameOver)} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={requestLeave}>
        <View style={{ flex: 1, backgroundColor: '#000000DD', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', width: '100%' }} style={{ width: '100%', maxWidth: 1040 }}>
            <View nativeID="not-alone-game-over" accessibilityLabel={`Game over. ${game.winner === 'hunted' ? 'The Hunted escaped' : game.winner === 'creature' ? 'The Creature won' : 'The expedition ended with no eligible winner'} dialog`} accessibilityViewIsModal role="dialog" aria-modal style={{ borderRadius: 20, borderWidth: 2, borderColor: game.winner === 'hunted' ? NOT_ALONE.safe : game.winner === 'creature' ? NOT_ALONE.creature : NOT_ALONE.amber, backgroundColor: NOT_ALONE.panel, padding: compact ? 17 : 23, gap: 20, flexDirection: resultsWide ? 'row' : 'column', alignItems: 'flex-start' }}>
              <View nativeID="not-alone-result-summary" style={{ minWidth: 0, maxWidth: '100%', gap: 12, ...(resultsWide ? { flexBasis: 360, flexGrow: 1, flexShrink: 1 } : { width: '100%' }) }}>
              <View style={{ alignItems: 'center', gap: 8 }}><NotAloneMark size={80} color={game.winner === 'hunted' ? NOT_ALONE.safe : game.winner === 'creature' ? NOT_ALONE.creature : NOT_ALONE.amber} /><Text accessibilityRole="header" style={{ ...nameWrapping, fontFamily: 'Outfit_800ExtraBold', color: game.winner === 'hunted' ? NOT_ALONE.safe : game.winner === 'creature' ? NOT_ALONE.creature : NOT_ALONE.amber, fontSize: compact ? 24 : 28, textAlign: 'center' }}>{game.winner === 'hunted' ? 'THE HUNTED ESCAPE' : game.winner === 'creature' ? 'THE CREATURE PREVAILS' : 'EXPEDITION ENDED'}</Text><Text style={{ fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' }}>After {game.roundNumber} round{game.roundNumber === 1 ? '' : 's'} · {game.winner === null ? 'no eligible winner remains' : game.endReason === 'forfeit' ? 'opposition forfeited' : game.winner === 'hunted' ? `Rescue reached ${game.rescueProgress}/${game.rescueGoal}` : `Assimilation reached ${game.assimilationProgress}/${game.assimilationGoal}`}</Text></View>
              {game.players.some((player) => player.forfeited) ? <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.creature, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>Forfeited seats remain in expedition history and cannot win.</Text> : null}
              <View nativeID="not-alone-result-actions" style={{ minWidth: 0, maxWidth: '100%', gap: 12 }}>
              {isHost && !rematchNeedsNewRoom ? <View style={{ gap: 7 }}><Text style={{ fontFamily: 'SpaceMono_700Bold', color: NOT_ALONE.amber, fontSize: 13, textAlign: 'center' }}>REMATCH BOARD FACE</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ChoiceButton label="CONTINUOUS" icon="chart-timeline-variant" selected={rematchFace === 'continuous'} disabled={busy} onPress={() => setRematchFace('continuous')} /><ChoiceButton label="ALTERNATING" icon="swap-horizontal" selected={rematchFace === 'alternating'} disabled={busy} onPress={() => setRematchFace('alternating')} /></View></View> : null}
              {rematchNeedsNewRoom ? <View style={{ borderRadius: 12, borderWidth: 1, borderColor: NOT_ALONE.creature, backgroundColor: `${NOT_ALONE.creature}0F`, padding: 11, gap: 8 }}><Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.creature, fontSize: 13, textAlign: 'center' }}>REMATCH UNAVAILABLE · NEED {newPlayersNeeded} NEW PLAYER{newPlayersNeeded === 1 ? '' : 'S'}</Text><Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>Finished rooms cannot accept replacement players. {isHost ? 'Start a new room for another expedition.' : 'Ask the host to start a new room.'}</Text>{isHost ? <NeonButton label={isLeaving ? 'LEAVING…' : 'START A NEW ROOM'} color={NOT_ALONE.signal} disabled={isLeaving} onPress={() => { void leave('/not-alone'); }} /> : null}</View> : isHost ? <NeonButton label={actions.pending ? 'STARTING REMATCH…' : !rematchReady ? `WAITING FOR ${activeSeats.length - connectedRematchPlayers} TO RECONNECT` : 'PLAY AGAIN'} color={NOT_ALONE.signal} disabled={busy || !rematchReady} onPress={sendRematch} /> : <Text style={{ ...nameWrapping, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>Waiting for the host to offer a rematch.</Text>}
              <NeonButton label={isLeaving ? 'LEAVING…' : 'BACK TO ARCADE'} color={NOT_ALONE.amber} variant="outline" disabled={isLeaving} onPress={requestLeave} />
              </View>
              </View>
              <View nativeID="not-alone-result-roster" style={{ minWidth: 0, maxWidth: '100%', gap: 10, ...(resultsWide ? { flexBasis: 400, flexGrow: 1, flexShrink: 1 } : { width: '100%' }) }}>
                <SectionHeading>EXPEDITION RECORD</SectionHeading>
                {game.players.map((player) => <View key={player.playerId} style={{ minHeight: 64, borderRadius: 13, borderWidth: 1, borderColor: player.forfeited ? NOT_ALONE.creature : player.role === game.winner ? NOT_ALONE.safe : NOT_ALONE.border, backgroundColor: NOT_ALONE.surface, padding: 13, gap: 8, boxShadow: '0 3px 0 #06030C' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><MaterialCommunityIcons name={player.role === 'creature' ? 'alien-outline' : 'account-outline'} size={24} color={player.forfeited ? NOT_ALONE.creature : player.role === game.winner ? NOT_ALONE.safe : NOT_ALONE.muted} /><Text style={{ ...nameWrapping, flex: 1, fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.text, fontSize: 18, lineHeight: 25 }}>{player.displayName}</Text></View>
                  <Text style={{ ...nameWrapping, fontFamily: 'Outfit_700Bold', color: player.forfeited ? NOT_ALONE.creature : player.role === game.winner ? NOT_ALONE.safe : NOT_ALONE.muted, fontSize: 15, lineHeight: 22 }}>{player.forfeited ? 'FORFEITED' : player.role === game.winner ? 'WINNER' : player.role.toUpperCase()}</Text>
                </View>)}
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <NotAloneReferenceSheet visible={rules} onClose={() => setRules(false)} />
    </SafeAreaView>
  );
}
