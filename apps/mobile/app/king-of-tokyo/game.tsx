import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, Modal, Platform, ScrollView, Text, View, findNodeHandle, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type {
  KingOfTokyoActionKind,
  KingOfTokyoDefenseDecision,
  KingOfTokyoDieFace,
  KingOfTokyoDiceResolutionCategory,
  KingOfTokyoOwnedPowerCard,
  KingOfTokyoPublicPlayer,
  KingOfTokyoPowerCardId,
  Player,
} from '@zuychin-arcade/types';
import { KING_OF_TOKYO_MIN_PLAYERS, KING_OF_TOKYO_POWER_CARD_BY_ID } from '@zuychin-arcade/types';
import { NeonButton } from '../../components/ui/NeonButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { GameRecovery } from '../../components/ui/GameRecovery';
import { MonsterAvatar } from '../../components/king-of-tokyo/MonsterAvatar';
import { PowerCard } from '../../components/king-of-tokyo/PowerCard';
import { PowerCardCollection } from '../../components/king-of-tokyo/PowerCardCollection';
import { KingOfTokyoReferenceSheet } from '../../components/king-of-tokyo/ReferenceSheet';
import { TokyoArena } from '../../components/king-of-tokyo/TokyoArena';
import { TokyoDie } from '../../components/king-of-tokyo/TokyoDie';
import { ResourceBadge, TokyoMark } from '../../components/king-of-tokyo/TokyoArtwork';
import { getSocket } from '../../hooks/useSocket';
import { useWebBackGuard } from '../../hooks/useWebBackGuard';
import { useNativeLeaveGuard } from '../../hooks/useNativeLeaveGuard';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';
import { leaveRoom } from '../../lib/api';
import { showDialog, useDialogStore } from '../../lib/dialog';
import { clearAuthIfMatches } from '../../lib/storage';
import { useTokyoActions } from '../../components/king-of-tokyo/useTokyoActions';
import { useTokyoDecisionAttention } from '../../components/king-of-tokyo/useTokyoDecisionAttention';
import { rapidHealingPreview } from '../../components/king-of-tokyo/healingPreview';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { useGameStore } from '../../store/useGameStore';
import { TOKYO, neonText } from '../../constants/theme';

const CHANGEABLE_FACES: KingOfTokyoDieFace[] = [1, 2, 3, 'energy', 'smash', 'heart'];
const DICE_POWER_IDS = new Set<KingOfTokyoPowerCardId>([
  'background_dweller', 'herd_culler', 'plot_twist', 'stretchy',
]);
const INSTANT_POWER_IDS = new Set<KingOfTokyoPowerCardId>([
  'energy_drink', 'smoke_cloud', 'rapid_healing',
]);
const DECISION_FOCUSABLE = 'button:not([disabled]), [role="button"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"])';

const DEFAULT_RESOLUTION_ORDER: KingOfTokyoDiceResolutionCategory[] = ['points', 'energy', 'hearts', 'smash'];
const RESOLUTION_META: Record<KingOfTokyoDiceResolutionCategory, { label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string }> = {
  points: { label: 'Victory points', icon: 'star-circle-outline', color: TOKYO.lime },
  energy: { label: 'Energy', icon: 'lightning-bolt', color: TOKYO.energy },
  hearts: { label: 'Hearts', icon: 'heart', color: '#55E59A' },
  smash: { label: 'Smash', icon: 'paw', color: '#FF8B72' },
};



function SectionTitle({ icon, title, detail, onTextScale }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; detail?: string; onTextScale?: (scale: number) => void }) {
  const textRef = useRef<Text>(null);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
      <MaterialCommunityIcons name={icon} size={16} color={TOKYO.cyan} />
      <Text ref={textRef} onLayout={() => {
        if (onTextScale && Platform.OS === 'web' && typeof window !== 'undefined' && textRef.current) {
          const scale = Number.parseFloat(window.getComputedStyle(textRef.current as unknown as Element).fontSize) / 13;
          if (Number.isFinite(scale)) onTextScale(Math.max(1, scale));
        }
      }} accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', color: TOKYO.text, fontSize: 13, letterSpacing: 1.2, flexShrink: 1 }}>{title}</Text>
      {detail ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 16, flexShrink: 1 }}>{detail}</Text> : null}
    </View>
  );
}

function ChoiceChip({ label, active, color = TOKYO.cyan, disabled, hint, onPress }: {
  label: string; active?: boolean; color?: string; disabled?: boolean; hint?: string; onPress: () => void;
}) {
  return (
    <ScalePressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected: Boolean(active), disabled: Boolean(disabled) }}
      style={{
        minWidth: 48, minHeight: 48, justifyContent: 'center', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8,
        maxWidth: '100%', flexShrink: 1,
        borderWidth: 1, borderColor: active ? color : TOKYO.border,
        backgroundColor: active ? `${color}22` : TOKYO.surface,
        opacity: disabled ? 0.72 : 1,
      }}
    >
      <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: active ? color : TOKYO.muted, fontSize: 11, lineHeight: 15, flexShrink: 1, flexWrap: 'wrap', textAlign: 'center' }}>{label}</Text>
    </ScalePressable>
  );
}

function StatusChip({ label, active, color = TOKYO.cyan }: { label: string; active?: boolean; color?: string }) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        minHeight: 40,
        justifyContent: 'center',
        borderRadius: 10,
        paddingHorizontal: 11,
        paddingVertical: 8,
        maxWidth: '100%',
        flexShrink: 1,
        borderWidth: 1,
        borderColor: active ? color : TOKYO.border,
        backgroundColor: active ? `${color}22` : TOKYO.surface,
      }}
    >
      <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: active ? color : TOKYO.muted, fontSize: 11, lineHeight: 15, flexShrink: 1, flexWrap: 'wrap', textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function PlayerPanel({ player, presence, active, profileIndex, dense, basis }: { player: KingOfTokyoPublicPlayer; presence?: Player; active: boolean; profileIndex: number; dense: boolean; basis: number }) {
  const zone = player.tokyoZone === 'tokyo_city' ? 'TOKYO CITY' : player.tokyoZone === 'tokyo_bay' ? 'TOKYO BAY' : null;
  const presenceLabel = player.forfeited ? 'FORFEITED' : presence?.hasLeft ? 'LEFT' : player.eliminated ? 'ELIMINATED' : presence && !presence.isConnected ? 'RECONNECTING' : zone ?? (active ? 'ACTIVE MONSTER' : 'OUTSIDE TOKYO');
  const inactive = Boolean(presence?.hasLeft || player.eliminated || (presence && !presence.isConnected));
  return (
    <View
      accessible
      accessibilityLabel={`${player.displayName}. ${presenceLabel}. ${player.health} health, ${player.victoryPoints} victory points, ${player.energy} energy, ${player.powerCards.length} power cards.`}
      style={{
      minWidth: 0, maxWidth: '100%', flexBasis: basis, flexGrow: 1, flexShrink: 1, borderRadius: 16, borderWidth: active ? 2 : 1,
      borderColor: active ? TOKYO.lime : TOKYO.border,
      backgroundColor: player.eliminated ? '#160B0D' : TOKYO.surface,
      padding: dense ? 8 : 10,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: dense ? 6 : 9 }}>
        <View style={{ opacity: inactive ? 0.55 : 1 }}>
          <MonsterAvatar seed={player.playerId} profileIndex={profileIndex} size={dense ? 38 : 46} active={active} eliminated={player.eliminated} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: inactive ? TOKYO.muted : active ? TOKYO.lime : TOKYO.text, fontSize: dense ? 13 : 15 }}>{player.displayName}</Text>
          <Text style={{ fontFamily: 'SpaceMono_700Bold', color: presence?.hasLeft || player.eliminated ? TOKYO.danger : zone ? TOKYO.cyan : TOKYO.muted, fontSize: 11, lineHeight: 14, marginTop: 3 }}>
            {presenceLabel}
          </Text>
        </View>
        {active && !player.eliminated ? <MaterialCommunityIcons name="chevron-double-right" size={16} color={TOKYO.lime} /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: dense ? 3 : 5, marginTop: dense ? 7 : 9 }}>
        <ResourceBadge kind="health" value={player.health} compact />
        <ResourceBadge kind="victory" value={player.victoryPoints} compact />
        <ResourceBadge kind="energy" value={player.energy} compact />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: dense ? 5 : 8, marginTop: 7 }}>
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11 }}>{player.powerCards.length} POWER{player.powerCards.length === 1 ? '' : 'S'}</Text>
        {player.poisonTokens > 0 ? <Text style={{ fontFamily: 'SpaceMono_700Bold', color: '#72E36E', fontSize: 11 }}>POISON {player.poisonTokens}</Text> : null}
        {player.shrinkTokens > 0 ? <Text style={{ fontFamily: 'SpaceMono_700Bold', color: '#B58CFF', fontSize: 11 }}>SHRINK {player.shrinkTokens}</Text> : null}
      </View>
    </View>
  );
}

function CounterChoice({ label, value, max, color, disabled, onChange }: {
  label: string; value: number; max: number; color: string; disabled?: boolean; onChange: (value: number) => void;
}) {
  return (
    <View style={{ flex: 1, minWidth: 150, borderRadius: 12, borderWidth: 1, borderColor: `${color}66`, backgroundColor: TOKYO.surface, padding: 9 }}>
      <Text style={{ fontFamily: 'SpaceMono_700Bold', color, fontSize: 11, textAlign: 'center' }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 6 }}>
        <ScalePressable accessibilityLabel={`Decrease ${label.toLowerCase()}`} disabled={disabled || value <= 0} onPress={() => onChange(value - 1)} style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: TOKYO.border, alignItems: 'center', justifyContent: 'center', opacity: disabled || value <= 0 ? 0.4 : 1 }}><MaterialCommunityIcons name="minus" size={18} color={color} /></ScalePressable>
        <Text style={{ minWidth: 24, fontFamily: 'Outfit_800ExtraBold', color: TOKYO.text, fontSize: 20, textAlign: 'center' }}>{value}</Text>
        <ScalePressable accessibilityLabel={`Increase ${label.toLowerCase()}`} disabled={disabled || value >= max} onPress={() => onChange(value + 1)} style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: TOKYO.border, alignItems: 'center', justifyContent: 'center', opacity: disabled || value >= max ? 0.4 : 1 }}><MaterialCommunityIcons name="plus" size={18} color={color} /></ScalePressable>
      </View>
    </View>
  );
}

export default function KingOfTokyoGame() {
  const { width, fontScale = 1 } = useWindowDimensions();
  const [playAreaWidth, setPlayAreaWidth] = useState(0);
  const game = useGameStore((state) => state.kingOfTokyoPublic);
  const playerId = useGameStore((state) => state.playerId);
  const room = useGameStore((state) => state.room);
  const token = useGameStore((state) => state.token);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pendingRerollConfirmation, setPendingRerollConfirmation] = useState<{
    afterRevision: number;
    keptIndexes: number[];
  } | null>(null);
  const [activeCardInstanceId, setActiveCardInstanceId] = useState<string | null>(null);
  const [activeDieIndex, setActiveDieIndex] = useState<number | null>(null);
  const [showRules, setShowRules] = useState(false);
  const actions = useTokyoActions();
  const pendingCommand = actions.pending;
  const connectionState = actions.connectionError ? 'error' : actions.connected ? 'connected' : 'reconnecting';
  const [localMessage, setActionMessage] = useState<string | null>(null);
  const actionMessage = localMessage ?? actions.message;
  const reduceMotion = useReducedMotionPreference();
  const [cleanupPending, setCleanupPending] = useState(false);
  const dialogOpen = useDialogStore((state) => state.dialog !== null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [resolutionOrder, setResolutionOrder] = useState<KingOfTokyoDiceResolutionCategory[]>(DEFAULT_RESOLUTION_ORDER);
  const [healingRayTargets, setHealingRayTargets] = useState<Record<number, string>>({});
  const [activeHeartIndex, setActiveHeartIndex] = useState<number | null>(null);
  const [poisonTokensToRemove, setPoisonTokensToRemove] = useState(0);
  const [shrinkTokensToRemove, setShrinkTokensToRemove] = useState(0);
  const [camouflageHeartIndexes, setCamouflageHeartIndexes] = useState<Set<number>>(new Set());
  const [rapidHealingActivations, setRapidHealingActivations] = useState(0);
  const mainScrollRef = useRef<ScrollView>(null);
  const decisionHeadingRef = useRef<Text>(null);
  const [dieTextScale, setDieTextScale] = useState(1);
  const decisionZoneYRef = useRef(0);

  const leavingRef = useRef(false);
  const leavePromptOpenRef = useRef(false);
  const mountedRef = useRef(true);
  const leaveNotifiedRef = useRef(false);
  const ownDialogRef = useRef<ReturnType<typeof useDialogStore.getState>['dialog']>(null);
  const leaveEpochRef = useRef(0);
  const diceSelectionContextRef = useRef<string | null>(null);
  const lifecycleIdentity = useRef(token);
  const nativeBack = useRef<(() => void) | null>(null);
  const approveNavigation = useNativeLeaveGuard(token, () => {
    if (useGameStore.getState().token === token) nativeBack.current?.();
  });
  const latestGameRef = useRef(game);
  latestGameRef.current = game;
  const defenseDecisionKey = game?.pendingDefenseDecision
    ? [
        game.pendingDefenseDecision.playerId,
        game.pendingDefenseDecision.kind,
        game.pendingDefenseDecision.camouflageCopy ?? 0,
        game.pendingDefenseDecision.dice.join(','),
        game.pendingDefenseDecision.maxActivations,
        game.pendingDefenseDecision.remainingDamage,
        game.pendingDefenseDecision.stretchyAvailable ? 1 : 0,
      ].join(':')
    : null;
  const heartAllocationPlayerId = game?.pendingHeartAllocation?.playerId ?? null;
  const heartAllocationIndexesKey = game?.pendingHeartAllocation?.heartIndexes.join(',') ?? '';
  const heartAllocationKey = heartAllocationPlayerId
    ? `${heartAllocationPlayerId}:${heartAllocationIndexesKey}`
    : null;
  const heartAllocationTargetKey = game?.pendingHeartAllocation?.healingRayTargetPlayerIds.join(',') ?? '';

  useEffect(() => {
    const currentGame = latestGameRef.current;
    if (!currentGame) return;
    const diceSelectionContext = [
      currentGame.phase,
      currentGame.currentPlayerId,
      currentGame.rollCount,
      currentGame.maxRolls,
      currentGame.dice.map((die) => `${String(die.face)}:${die.kept ? 1 : 0}`).join(','),
    ].join('|');
    if (diceSelectionContextRef.current !== diceSelectionContext) {
      diceSelectionContextRef.current = diceSelectionContext;
      setSelected(new Set(currentGame.dice.flatMap((die, index) => (die.kept ? [index] : []))));
    }
    setActiveCardInstanceId((currentInstanceId) => {
      if (!currentInstanceId || currentGame.players.some((player) => player.powerCards.some((card) => card.instanceId === currentInstanceId))) return currentInstanceId;
      setActiveDieIndex(null);
      return null;
    });
  }, [game?.revision]);



  useEffect(() => {
    if (game?.phase !== 'awaiting_dice_resolution' || game.currentPlayerId !== playerId) return;
    setResolutionOrder(DEFAULT_RESOLUTION_ORDER);
  }, [game?.phase, game?.currentPlayerId, playerId]);

  useEffect(() => {
    setHealingRayTargets({});
    setActiveHeartIndex(heartAllocationIndexesKey ? Number(heartAllocationIndexesKey.split(',')[0]) : null);
    setPoisonTokensToRemove(0);
    setShrinkTokensToRemove(0);
    if (!heartAllocationKey || heartAllocationPlayerId !== playerId) return;
  }, [heartAllocationIndexesKey, heartAllocationKey, heartAllocationPlayerId, playerId]);

  useEffect(() => {
    const validHeartIndexes = new Set(heartAllocationIndexesKey
      ? heartAllocationIndexesKey.split(',').map(Number)
      : []);
    const validTargetIds = new Set(heartAllocationTargetKey ? heartAllocationTargetKey.split(',') : []);
    setHealingRayTargets((previous) => Object.fromEntries(
      Object.entries(previous).filter(([index, targetId]) => validHeartIndexes.has(Number(index)) && validTargetIds.has(targetId)),
    ));
  }, [heartAllocationIndexesKey, heartAllocationKey, heartAllocationTargetKey]);

  useEffect(() => {
    setCamouflageHeartIndexes(new Set());
    setRapidHealingActivations(0);
    if (!defenseDecisionKey || game?.pendingDefenseDecision?.playerId !== playerId) return;
  }, [defenseDecisionKey, game?.pendingDefenseDecision?.playerId, playerId]);

  useEffect(() => {
    if (!pendingRerollConfirmation || !game || actions.busy || game.revision <= pendingRerollConfirmation.afterRevision) return;
    const confirmed = game.dice.flatMap((die, index) => die.kept ? [index] : []);
    const keepSelectionConfirmed = confirmed.length === pendingRerollConfirmation.keptIndexes.length
      && confirmed.every((index, position) => index === pendingRerollConfirmation.keptIndexes[position]);
    if (game.phase === 'choosing_dice' && game.currentPlayerId === playerId && keepSelectionConfirmed) {
      actions.send('roll', {}, 'Reroll dice', game.revision);
    } else {
      setActionMessage('The table changed before your kept dice were confirmed. Review the dice and try again.');
    }
    setPendingRerollConfirmation(null);
  }, [actions, game, pendingRerollConfirmation, playerId]);

  useEffect(() => {
    if (actions.connected && !actions.message?.startsWith('Action not accepted:') && !actions.message?.startsWith('No confirmation')) return;
    setPendingRerollConfirmation(null);
    setActiveCardInstanceId(null);
    setActiveDieIndex(null);
  }, [actions.connected, actions.message]);

  useEffect(() => {
    const previous = lifecycleIdentity.current;
    lifecycleIdentity.current = token;
    if (token === null || previous === token) return;
    leavingRef.current = false;
    leaveNotifiedRef.current = false;
    leavePromptOpenRef.current = false;
    if (ownDialogRef.current && useDialogStore.getState().dialog === ownDialogRef.current) useDialogStore.getState().hide();
    ownDialogRef.current = null;
    setIsLeaving(false);
    setCleanupPending(false);
    setActionMessage(null);
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

  const me = useMemo(() => game?.players.find((player) => player.playerId === playerId) ?? null, [game?.players, playerId]);
  const current = game?.players.find((player) => player.playerId === game.currentPlayerId) ?? null;
  const winner = game?.players.find((player) => player.playerId === game.winnerId) ?? null;
  const myTurn = game?.currentPlayerId === playerId && !me?.eliminated;
  const myTokyoDecision = game?.pendingTokyoDecisionPlayerId === playerId;
  const myDefenseDecision = game?.pendingDefenseDecision?.playerId === playerId;
  const myFreezeTimeDecision = game?.pendingFreezeTimePlayerId === playerId;
  const myPsychicDecision = game?.pendingPsychicProbePlayerId === playerId;
  const myOpportunity = game?.pendingOpportunistPlayerId === playerId;
  const myMimicDecision = game?.pendingMimicTargetPlayerId === playerId;
  const myEndTurnDecision = game?.phase === 'resolving_end_turn' && game.currentPlayerId === playerId;
  const myResolutionDecision = game?.phase === 'awaiting_dice_resolution' && game.currentPlayerId === playerId;
  const myHeartAllocation = game?.phase === 'awaiting_heart_allocation' &&
    game.pendingHeartAllocation?.playerId === playerId;
  const myStartRollPending = game?.phase === 'determining_first_player'
    && game.startingRollContenders.includes(playerId ?? '')
    && game.startRolls[playerId ?? ''] === null;
  const isHost = room?.players.find((player) => player.playerId === playerId)?.isHost ?? false;
  const rematchSeats = room?.players.filter((player) => !player.hasLeft) ?? [];
  const connectedRematchPlayers = rematchSeats.filter((player) => player.isConnected).length;
  const reconnectingRematchPlayers = rematchSeats.length - connectedRematchPlayers;
  const canStartRematch = connectedRematchPlayers >= KING_OF_TOKYO_MIN_PLAYERS && reconnectingRematchPlayers === 0;
  const returningWinnerStartsRematch = Boolean(game?.winnerId && rematchSeats.some((player) => player.playerId === game.winnerId));
  const compact = width < 560;
  const denseRoster = width < 380;
  const textScale = Math.max(1, fontScale);
  const resultsWide = width >= 960 * textScale;
  const columnMinimum = 0;
  const playerPanelBasis = (denseRoster ? 136 : width >= 560 ? 220 : 160) * textScale;
  const presenceById = new Map(room?.players.map((player) => [player.playerId, player]) ?? []);
  const busy = actions.busy || isLeaving || cleanupPending;
  const decisionName = myDefenseDecision
    ? `${game?.pendingDefenseDecision?.kind ?? 'defence'} defence`
    : myMimicDecision
      ? 'choose Mimic power'
        : myFreezeTimeDecision
          ? 'decide Freeze Time'
          : myHeartAllocation
            ? 'allocate Hearts'
            : myResolutionDecision
              ? 'choose dice result order'
              : myPsychicDecision
                ? 'decide Psychic Probe'
                : myTokyoDecision
                  ? 'decide whether to yield Tokyo'
                  : myOpportunity
                    ? 'decide Opportunist purchase'
                    : myEndTurnDecision
                      ? 'choose the next end-turn effect'
                      : myStartRollPending
                        ? 'roll for first player'
                        : myTurn && game?.phase === 'awaiting_roll'
                          ? 'roll dice'
                          : myTurn && game?.phase === 'choosing_dice'
                            ? game.rollCount < game.maxRolls ? 'keep dice, reroll or resolve' : 'resolve the final dice result'
                            : myTurn && game?.phase === 'buying_cards'
                              ? 'buy cards or end the turn'
                              : myTurn && game?.phase === 'selling_cards'
                                ? 'sell cards or finish selling'
                                : null;
  const decisionFocusKey = decisionName
    ? [
        decisionName,
        game?.phase,
        game?.rollCount,
        game?.pendingDefenseDecision?.kind,
        game?.pendingDefenseDecision?.camouflageCopy,
        game?.pendingFreezeTimeChoicesRemaining,
        game?.pendingMimicTargetCardInstanceId,
        game?.pendingPsychicProbeCardInstanceId,
        game?.pendingOpportunistCardInstanceId,
        game?.pendingHeartAllocation?.playerId,
        game?.pendingHeartAllocation?.heartIndexes.join(','),
        game?.pendingHeartAllocation?.healingRayTargetPlayerIds.join(','),
        game?.pendingEndTurnEffects.map((effect) => effect.effectId).join(','),
        game?.rollOffRound,
      ].join(':')
    : null;
  const liveAnnouncement = connectionState !== 'connected'
    ? connectionState === 'error'
      ? 'Could not reconnect. Check your network.'
      : 'Reconnecting. Decisions are paused until state is refreshed.'
    : actionMessage ?? '';

  const focusDecision = useCallback(() => {
    if (Platform.OS === 'web') {
      const target = document.getElementById('king-current-decision')?.querySelector<HTMLElement>(DECISION_FOCUSABLE);
      if (!target) return false;
      mainScrollRef.current?.scrollTo({ y: Math.max(0, decisionZoneYRef.current - 12), animated: !reduceMotion });
      target.focus({ preventScroll: true });
      return true;
    }
    const handle = findNodeHandle(decisionHeadingRef.current);
    if (!handle) return false;
    mainScrollRef.current?.scrollTo({ y: Math.max(0, decisionZoneYRef.current - 12), animated: !reduceMotion });
    AccessibilityInfo.setAccessibilityFocus(handle);
    return true;
  }, [reduceMotion]);
  useTokyoDecisionAttention(
    game?.status === 'game_over' ? null : decisionFocusKey,
    showRules || dialogOpen || actions.busy || isLeaving,
    focusDecision,
  );

  useEffect(() => {
    if (Platform.OS === 'ios' && liveAnnouncement) AccessibilityInfo.announceForAccessibility(liveAnnouncement);
  }, [liveAnnouncement]);

  const emit = (event: `king_of_tokyo:${KingOfTokyoActionKind}`, payload: Record<string, unknown> = {}, label = 'Action') => {
    if (!game || isLeaving || cleanupPending) return false;
    setActionMessage(null);
    return actions.send(event.slice('king_of_tokyo:'.length) as KingOfTokyoActionKind, payload, label, game.revision);
  };

  const submitDefense = (decision: KingOfTokyoDefenseDecision, label: string) => {
    emit('king_of_tokyo:defense', decision, label);
  };

  const effectiveCardId = (card: KingOfTokyoOwnedPowerCard): KingOfTokyoPowerCardId | null => {
    if (card.cardId !== 'mimic') return card.cardId;
    if (!card.mimicTargetInstanceId || !game) return null;
    for (const player of game.players) {
      const target = player.powerCards.find((candidate) => candidate.instanceId === card.mimicTargetInstanceId);
      if (target && target.cardId !== 'mimic') return target.cardId;
    }
    return null;
  };

  const effectCount = (cardId: KingOfTokyoPowerCardId) =>
    me?.powerCards.filter((card) => effectiveCardId(card) === cardId).length ?? 0;
  const activeCard = me?.powerCards.find((card) => card.instanceId === activeCardInstanceId) ?? null;
  const activePowerId = activeCard ? effectiveCardId(activeCard) : null;
  const marketDiscount = effectCount('alien_origin');
  const playPowerCard = (card: KingOfTokyoOwnedPowerCard, extra: Record<string, unknown> = {}) => {
    emit('king_of_tokyo:use_card', { cardInstanceId: card.instanceId, ...extra }, `Use ${KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].name}`);
  };

  const manualLabel = (card: KingOfTokyoOwnedPowerCard): string | null => {
    const id = effectiveCardId(card);
    if (game?.pendingMimicTargetCardInstanceId === card.instanceId) return null;
    if (card.cardId === 'mimic' && game?.phase === 'awaiting_roll') {
      return game.viewerAvailableOncePerTurnCardInstanceIds.includes(card.instanceId) ? 'CHOOSE COPY' : 'MIMIC UNAVAILABLE';
    }
    if (id === 'rapid_healing') return 'RAPID HEALING · 2 ENERGY';
    if (id === 'energy_drink') return 'EXTRA REROLL · 1 ENERGY';
    if (id === 'smoke_cloud') return `EXTRA REROLL · ${card.counters} LEFT`;
    if (id === 'background_dweller') return 'REROLL A 3';
    if (id === 'herd_culler') return game?.viewerAvailableOncePerTurnCardInstanceIds.includes(card.instanceId) ? 'CHANGE DIE TO 1' : 'HERD CULLER USED';
    if (id === 'plot_twist') return 'CHANGE DIE · DISCARD';
    if (id === 'stretchy') return 'CHANGE DIE · 2 ENERGY';
    return null;
  };

  const canUseCard = (card: KingOfTokyoOwnedPowerCard): boolean => {
    const id = effectiveCardId(card);
    if (game?.phase === 'awaiting_defense_decision') return false;
    if (card.cardId === 'mimic' && game?.phase === 'awaiting_roll') {
      return game.viewerAvailableOncePerTurnCardInstanceIds.includes(card.instanceId);
    }
    if (id === 'rapid_healing') return game?.status === 'playing' && !me?.eliminated && (me?.energy ?? 0) >= 2 && (me?.health ?? 0) < (me?.maxHealth ?? 0);
    if (game?.pendingMimicTargetCardInstanceId) return false;
    if (!myTurn || game?.phase !== 'choosing_dice' || !game.rollCount) return false;
    if (id === 'energy_drink') return (me?.energy ?? 0) >= 1;
    if (id === 'smoke_cloud') return card.counters > 0;
    if (id === 'background_dweller') return game.dice.some((die) => die.face === 3);
    if (id === 'herd_culler') return game.viewerAvailableOncePerTurnCardInstanceIds.includes(card.instanceId);
    if (id === 'stretchy') return (me?.energy ?? 0) >= 2;
    return Boolean(id && DICE_POWER_IDS.has(id));
  };

  const activeCardSelectionValid = Boolean(activeCard && (
    activeCard.cardId === 'mimic' && game?.phase === 'awaiting_roll'
      ? myTurn && game?.phase === 'awaiting_roll' && canUseCard(activeCard)
      : activePowerId && DICE_POWER_IDS.has(activePowerId) && myTurn && game?.phase === 'choosing_dice' && canUseCard(activeCard)
  ));

  useEffect(() => {
    if (!activeCardInstanceId || activeCardSelectionValid) return;
    setActiveCardInstanceId(null);
    setActiveDieIndex(null);
  }, [activeCardInstanceId, activeCardSelectionValid]);

  const startCardAction = (card: KingOfTokyoOwnedPowerCard) => {
    const id = effectiveCardId(card);
    if (card.cardId === 'mimic' && game?.phase === 'awaiting_roll') {
      setActiveCardInstanceId((previous) => previous === card.instanceId ? null : card.instanceId);
      setActiveDieIndex(null);
      return;
    }
    if (INSTANT_POWER_IDS.has(id as KingOfTokyoPowerCardId)) {
      playPowerCard(card);
      return;
    }
    setActiveCardInstanceId((previous) => previous === card.instanceId ? null : card.instanceId);
    setActiveDieIndex(null);
  };

  const toggleDie = (index: number) => {
    if (myPsychicDecision) {
      emit('king_of_tokyo:psychic_probe', { dieIndex: index }, 'Use Psychic Probe');
      return;
    }
    if (activeCard && activePowerId && DICE_POWER_IDS.has(activePowerId) && activeCardSelectionValid) {
      if (activePowerId === 'background_dweller' || activePowerId === 'herd_culler') {
        if (activePowerId === 'background_dweller' && game?.dice[index]?.face !== 3) return;
        playPowerCard(activeCard, { dieIndex: index });
        setActiveCardInstanceId(null);
      } else {
        setActiveDieIndex(index);
      }
      return;
    }
    if (!myTurn || game?.phase !== 'choosing_dice' || game.rollCount >= game.maxRolls || pendingRerollConfirmation !== null || busy) return;
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const chooseFace = (face: KingOfTokyoDieFace) => {
    if (!activeCard || activeDieIndex === null) return;
    playPowerCard(activeCard, { dieIndex: activeDieIndex, face });
    setActiveCardInstanceId(null);
    setActiveDieIndex(null);
  };

  const reroll = () => {
    if (!game || selected.size === game.dice.length || busy) return;
    const keptIndexes = [...selected].sort((a, b) => a - b);
    if (emit('king_of_tokyo:set_kept', { keptIndexes }, 'Keep dice')) {
      setPendingRerollConfirmation({ afterRevision: game.revision, keptIndexes });
    }
  };

  const leave = useCallback(async () => {
    const ownsSession = () => mountedRef.current && useGameStore.getState().token === token && useGameStore.getState().roomCode === room?.roomCode;
    if (leavingRef.current || !ownsSession()) return;
    leavingRef.current = true;
    setIsLeaving(true);
    if (!leaveNotifiedRef.current) {
      leaveNotifiedRef.current = true;
      try {
        if (room && token) await leaveRoom(room.roomCode, token);
      } catch (error) {
        if (ownsSession()) setActionMessage(`The table could not be notified. Your seat may remain reserved until reconnect grace expires. ${error instanceof Error ? error.message : ''}`);
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
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null, null);
  }, [room, token, approveNavigation]);

  const requestLeave = useCallback(() => {
    if (leavingRef.current || leavePromptOpenRef.current) return;
    const current = useGameStore.getState();
    if (!mountedRef.current || current.token !== token || current.roomCode !== room?.roomCode) return;
    if (cleanupPending) { void leave(); return; }
    const captured = current.kingOfTokyoPublic;
    if (!captured) return;
    const epoch = leaveEpochRef.current;
    const isCurrent = () => {
      const latest = useGameStore.getState();
      return mountedRef.current && leavePromptOpenRef.current && latest.token === token && latest.roomCode === room?.roomCode
        && epoch === leaveEpochRef.current && latest.kingOfTokyoPublic?.status === captured.status
        && (captured.status !== 'game_over' || latest.kingOfTokyoPublic.revision === captured.revision);
    };
    leavePromptOpenRef.current = true;
    const activeMatch = captured.status !== 'game_over';
    showDialog(activeMatch ? 'Leave the battle?' : 'Leave the table?',
      activeMatch
        ? 'Leaving forfeits your monster immediately and may end the match. Temporary disconnections preserve your seat during reconnect grace; expiry also forfeits it. A forfeited monster cannot win.'
        : 'Return to the arcade? This match has already ended.',
      [
        { text: 'STAY', style: 'cancel', onPress: () => { if (isCurrent()) leavePromptOpenRef.current = false; } },
        { text: 'LEAVE', style: 'destructive', onPress: () => { if (!isCurrent()) return; leavePromptOpenRef.current = false; void leave(); } },
      ]);
    ownDialogRef.current = useDialogStore.getState().dialog;
  }, [cleanupPending, leave, room?.roomCode, token]);

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
    leavePromptOpenRef.current = false;
    ownDialogRef.current = null;
  }, [game?.status, room?.roomCode, token]);

  const closeFinishedGame = useCallback(() => {
    const current = useGameStore.getState();
    if (mountedRef.current && current.token === token && current.roomCode === room?.roomCode
      && game?.status === 'game_over' && current.kingOfTokyoPublic?.status === 'game_over'
      && current.kingOfTokyoPublic.revision === game.revision) void leave();
  }, [game, leave, room?.roomCode, token]);
  const handleBack = useCallback(() => {
    if (game?.status === 'game_over') {
      closeFinishedGame();
      return;
    }
    if (showRules) {
      setShowRules(false);
      return;
    }
    requestLeave();
  }, [closeFinishedGame, game?.status, requestLeave, showRules]);
  useLayoutEffect(() => { nativeBack.current = handleBack; }, [handleBack]);
  useWebBackGuard('/king-of-tokyo/game', handleBack, token !== null);
  useWebModalFocus(game?.status === 'game_over' && !dialogOpen, 'king-of-tokyo-game-over', closeFinishedGame);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]);

  if (!game || !me) {
    return <GameRecovery message="Restoring the monster battle…" background={TOKYO.bg} surface={TOKYO.surface} border={TOKYO.border} accent={TOKYO.lime} muted={TOKYO.muted} icon="city-variant-outline" onSessionCleared={onSessionCleared} />;
  }

  const opportunistCard = game.market.find((card) => card?.instanceId === game.pendingOpportunistCardInstanceId) ?? null;
  const phaseLabel = game.phase.replaceAll('_', ' ').toUpperCase();
  const ownsTentacles = effectCount('parasitic_tentacles') > 0;
  const ownsDefense = effectCount('wings') > 0;
  const ownsRapidHealing = effectCount('rapid_healing') > 0;
  const preferences = game.viewerPreferences;
  const gameOver = game.status === 'game_over';
  const initialMimicPending = Boolean(game.pendingMimicTargetCardInstanceId);
  const pendingMimicOwner = game.players.find((player) => player.playerId === game.pendingMimicTargetPlayerId) ?? null;
  const pendingMimicCard = pendingMimicOwner?.powerCards.find((card) => card.cardId === 'mimic' && card.instanceId === game.pendingMimicTargetCardInstanceId) ?? null;
  const pendingMimicTargets = pendingMimicOwner
    ? game.players
      .flatMap((player) => player.powerCards
        .filter((card) => card.cardId !== 'mimic' && card.instanceId !== pendingMimicCard?.mimicTargetInstanceId)
        .map((card) => ({ player, card })))
    : [];
  const pendingFreezeTimeOwner = game.players.find((player) =>
    player.playerId === game.pendingFreezeTimePlayerId) ?? null;
  const pendingDefense = game.pendingDefenseDecision;
  const pendingDefenseOwner = game.players.find((player) =>
    player.playerId === pendingDefense?.playerId) ?? null;
  const defenseLabel = pendingDefense?.kind === 'camouflage'
    ? 'Camouflage'
    : pendingDefense?.kind === 'wings'
      ? 'Wings'
      : 'Rapid Healing';
  const defenseAccent = pendingDefense?.kind === 'wings'
    ? '#B58CFF'
    : pendingDefense?.kind === 'rapid_healing'
      ? '#55E59A'
      : TOKYO.cyan;
  const selectedCamouflageCount = camouflageHeartIndexes.size;
  const camouflageEnergyLimit = pendingDefense?.kind === 'camouflage' && pendingDefense.stretchyAvailable
    ? Math.floor(me.energy / 2)
    : 0;
  const camouflageHearts = pendingDefense?.kind === 'camouflage'
    ? pendingDefense.dice.filter((face) => face === 'heart').length + selectedCamouflageCount
    : 0;
  const camouflagePrevented = pendingDefense?.kind === 'camouflage'
    ? Math.min(pendingDefense.remainingDamage, camouflageHearts)
    : 0;
  const rapidPreview = pendingDefense?.kind === 'rapid_healing'
    ? rapidHealingPreview(me.health, me.maxHealth, rapidHealingActivations, pendingDefense.healingPerActivation, pendingDefense.remainingDamage)
    : { healed: 0, remainingHealth: me.health };
  const heartIndexes = game.pendingHeartAllocation?.heartIndexes ?? [];
  const healingTargets = (game.pendingHeartAllocation?.healingRayTargetPlayerIds ?? []).flatMap((targetId) => {
    const target = game.players.find((player) => player.playerId === targetId);
    return target ? [target] : [];
  });
  const startTurnRapidHealingMimics = game.phase === 'awaiting_roll'
    ? me.powerCards.filter((card) => card.cardId === 'mimic' && effectiveCardId(card) === 'rapid_healing')
    : [];
  const allocatedHealingRays = Object.entries(healingRayTargets).filter(([index, targetId]) => heartIndexes.includes(Number(index)) && healingTargets.some((target) => target.playerId === targetId));
  const heartsAfterRay = Math.max(0, heartIndexes.length - allocatedHealingRays.length);
  const tokenRemovalCapacity = me.tokyoZone ? 0 : heartsAfterRay;
  const unusedHearts = Math.max(0, heartsAfterRay - poisonTokensToRemove - shrinkTokensToRemove);
  const showDecisionZone = Boolean(decisionName || game.phase === 'determining_first_player');
  const decisionBesideTable = showDecisionZone && playAreaWidth >= 960 * textScale;
  const isWide = !decisionBesideTable && playAreaWidth >= 900 * textScale;
  const showMarketInDecision = myTurn && game.phase === 'buying_cards';
  const showOwnedCardsInDecision = Boolean(
    decisionName && (
      activeCardInstanceId
      || myTurn && ['awaiting_roll', 'choosing_dice', 'buying_cards', 'selling_cards'].includes(game.phase)
      || me.powerCards.some((card) => canUseCard(card))
    ),
  );
  const showDiceInDecision = showDecisionZone && game.phase !== 'determining_first_player';
  const statusTitle = gameOver
    ? game.terminationReason ? 'MATCH ENDED' : 'MATCH COMPLETE'
    : game.phase === 'determining_first_player'
      ? myStartRollPending ? 'ROLL TO CLAIM THE FIRST TURN' : 'WAITING FOR THE ROLL-OFF'
    : pendingDefenseOwner
      ? myDefenseDecision ? `RESOLVE ${defenseLabel.toUpperCase()}` : `${pendingDefenseOwner.displayName} is resolving ${defenseLabel}`
      : pendingFreezeTimeOwner
        ? myFreezeTimeDecision ? 'TAKE A FREEZE TIME TURN?' : `${pendingFreezeTimeOwner.displayName} is deciding Freeze Time`
      : pendingMimicOwner
      ? myMimicDecision ? 'CHOOSE MIMIC POWER' : `${pendingMimicOwner.displayName} is choosing Mimic`
      : game.phase === 'awaiting_heart_allocation'
        ? myHeartAllocation ? 'ALLOCATE HEARTS' : `${current?.displayName ?? 'Another monster'} is allocating Hearts`
      : myResolutionDecision
        ? 'CHOOSE RESULT ORDER'
        : myEndTurnDecision
          ? 'ORDER END-TURN EFFECTS'
          : game.phase === 'selling_cards' && myTurn
            ? 'METAMORPH SALES'
            : myTokyoDecision
              ? 'YOUR TOKYO DECISION'
              : myPsychicDecision
                ? 'USE PSYCHIC PROBE?'
                : myOpportunity
                  ? 'OPPORTUNIST WINDOW'
                  : myTurn ? 'YOUR TURN' : `${current?.displayName ?? 'Another monster'} is acting`;

  const moveResolution = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= resolutionOrder.length) return;
    setResolutionOrder((previous) => {
      const next = [...previous];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  };

  const assignHeart = (dieIndex: number, targetPlayerId?: string) => {
    const next = { ...healingRayTargets };
    if (targetPlayerId) next[dieIndex] = targetPlayerId; else delete next[dieIndex];
    const available = Math.max(0, heartIndexes.length - Object.keys(next).length);
    const nextPoison = Math.min(poisonTokensToRemove, available);
    setHealingRayTargets(next);
    setPoisonTokensToRemove(nextPoison);
    setShrinkTokensToRemove(Math.min(shrinkTokensToRemove, Math.max(0, available - nextPoison)));
  };

  const resolveResults = () => emit('king_of_tokyo:resolve_dice_results', { resolutionOrder }, 'Resolve dice results');
  const allocateHearts = () => emit('king_of_tokyo:allocate_hearts', {
    healingRayUses: allocatedHealingRays.map(([dieIndex, targetPlayerId]) => ({ dieIndex: Number(dieIndex), targetPlayerId })),
    poisonTokensToRemove,
    shrinkTokensToRemove,
  }, 'Allocate Hearts');
  const toggleCamouflageHeart = (dieIndex: number) => {
    if (pendingDefense?.kind !== 'camouflage' || !pendingDefense.stretchyAvailable || pendingDefense.dice[dieIndex] === 'heart') return;
    setCamouflageHeartIndexes((previous) => {
      const next = new Set(previous);
      if (next.has(dieIndex)) next.delete(dieIndex);
      else if (next.size < camouflageEnergyLimit) next.add(dieIndex);
      return next;
    });
  };
  const submitCamouflageChanges = () => submitDefense({
    kind: 'camouflage',
    changes: [...camouflageHeartIndexes]
      .sort((left, right) => left - right)
      .map((dieIndex) => ({ dieIndex, face: 'heart' as const })),
  }, `Change ${selectedCamouflageCount} Camouflage ${selectedCamouflageCount === 1 ? 'die' : 'dice'}`);
  const playAgain = () => {
    const socket = getSocket();
    if (!socket?.connected) {
      setActionMessage('Reconnect before starting a rematch.');
      return;
    }
    if (!canStartRematch) {
      setActionMessage(reconnectingRematchPlayers > 0
        ? 'Wait for every reserved seat to reconnect before starting the rematch.'
        : `A rematch needs at least ${KING_OF_TOKYO_MIN_PLAYERS} connected monsters. Leave and create a new room to replace missing seats.`);
      return;
    }
    setActionMessage(null);
    actions.send('start_game', {}, 'Play again', game.revision);
  };

  const renderMarket = (interactive: boolean) => {
    const buying = interactive && myTurn && game.phase === 'buying_cards';
    return (
      <View style={{ gap: 10, borderRadius: 17, borderWidth: 1, borderColor: TOKYO.border, backgroundColor: TOKYO.surface, padding: 13 }}>
        <SectionTitle icon="storefront-outline" title="POWER MARKET" detail={`${game.deckCount} deck · ${game.discardCount} discard`} />
        <PowerCardCollection compact={compact}>{layout => game.market.map((card, index) => card ? (
            <PowerCard
              {...layout}
              key={card.instanceId}
              card={card}
              compact={compact}
              actionLabel={buying ? `BUY · ${Math.max(0, KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].cost - marketDiscount)} ENERGY` : undefined}
              actionDisabled={busy || initialMimicPending || me.energy < Math.max(0, KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].cost - marketDiscount)}
              onAction={() => emit('king_of_tokyo:buy_card', { marketIndex: index }, `Buy ${KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].name}`)}
            />
          ) : (
            <View key={index} style={{ width: layout.columnWidth, minWidth: 0, minHeight: 130, borderRadius: 16, borderWidth: 1, borderColor: TOKYO.border, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: TOKYO.muted, fontSize: 11 }}>Empty slot</Text>
            </View>
          ))}</PowerCardCollection>
        {buying ? <NeonButton label="SWEEP ALL 3 · 2 ENERGY" accessibilityHint="Discard all three market cards and reveal three replacements; you may repeat while you can pay" color={TOKYO.cyan} variant="outline" disabled={busy || initialMimicPending || me.energy < 2} icon={<MaterialCommunityIcons name="refresh" size={17} color={TOKYO.cyan} />} onPress={() => emit('king_of_tokyo:sweep_market', {}, 'Sweep market')} /> : null}
        {buying && game.labCard ? (
          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: TOKYO.border, paddingTop: 10 }}>
            <SectionTitle icon="flask-outline" title="MADE IN A LAB OFFER" />
            <PowerCard card={game.labCard} compact standalone actionLabel="BUY PRIVATE TOP CARD" actionDisabled={busy || initialMimicPending || me.energy < Math.max(0, KING_OF_TOKYO_POWER_CARD_BY_ID[game.labCard.cardId].cost - marketDiscount)} onAction={() => emit('king_of_tokyo:buy_lab_card', {}, 'Buy private lab card')} />
          </View>
        ) : null}
        {buying ? <NeonButton label={pendingCommand ? 'ENDING…' : 'END TURN'} accessibilityHint="Finish buying and continue to end-turn effects" color={TOKYO.lime} disabled={busy || initialMimicPending} icon={<MaterialCommunityIcons name="skip-next" size={17} color={TOKYO.bg} />} onPress={() => emit('king_of_tokyo:end_turn', {}, 'End turn')} /> : null}
      </View>
    );
  };

  const renderOwnedCards = (interactive: boolean) => (
    <View style={{ gap: 10, borderRadius: 17, borderWidth: 1, borderColor: TOKYO.border, backgroundColor: TOKYO.surface, padding: 13 }}>
      <SectionTitle icon="cards-outline" title="YOUR POWER CARDS" detail={`${me.powerCards.length} owned`} />
      {me.powerCards.length ? (
        <PowerCardCollection compact={compact}>{layout => me.powerCards.map((card) => {
            const selling = interactive && myTurn && game.phase === 'selling_cards';
            const label = interactive ? selling ? `SELL · ${KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].cost} ENERGY` : manualLabel(card) : null;
            const blockedByInitialMimic = initialMimicPending && (selling || effectiveCardId(card) !== 'rapid_healing');
            const cardSelected = !selling && activeCardSelectionValid && activeCardInstanceId === card.instanceId;
            const mimicSelected = cardSelected && card.cardId === 'mimic' && game.phase === 'awaiting_roll';
            return (
              <PowerCard
                {...layout}
                key={card.instanceId}
                card={card}
                compact={compact}
                selected={interactive && cardSelected}
                selectedAccessibilityLabel={mimicSelected ? 'Mimic is selected. Choose a Keep card, or activate Mimic again to cancel.' : undefined}
                selectedInstruction={mimicSelected ? 'SELECTED · CHOOSE A KEEP CARD' : undefined}
                selectedActionLabel={mimicSelected ? 'CANCEL MIMIC SELECTION' : undefined}
                selectedActionHint={mimicSelected ? 'Cancel Mimic selection without changing its copied card' : undefined}
                actionLabel={label ?? undefined}
                actionDisabled={busy || blockedByInitialMimic || (!selling && !canUseCard(card))}
                onAction={() => selling
                  ? emit('king_of_tokyo:sell_card', { cardInstanceId: card.instanceId }, `Sell ${KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].name}`)
                  : startCardAction(card)}
              />
            );
          })}</PowerCardCollection>
      ) : <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>Buy Keep cards from the market to build your monster.</Text>}

      {interactive && startTurnRapidHealingMimics.map((card, index) => (
        <ChoiceChip
          key={`rapid-healing:${card.instanceId}`}
          label={`RAPID HEALING WITH MIMIC COPY${startTurnRapidHealingMimics.length > 1 ? ` ${index + 1}` : ''} · 2 ENERGY`}
          color="#55E59A"
          disabled={busy || initialMimicPending || me.energy < 2 || me.health >= me.maxHealth}
          hint="Use the currently copied Rapid Healing power without moving the Mimic counter"
          onPress={() => playPowerCard(card)}
        />
      ))}

      {interactive && activeCard?.cardId === 'mimic' && !initialMimicPending && game.phase === 'awaiting_roll' ? (
        <View style={{ gap: 8 }}>
          <SectionTitle icon="content-copy" title="COPY A KEEP CARD" detail="Costs 1 energy" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {game.players.flatMap((player) => player.powerCards.filter((card) => card.cardId !== 'mimic' && card.instanceId !== activeCard.mimicTargetInstanceId).map((card) => (
              <ChoiceChip key={card.instanceId} label={`${player.displayName} · ${KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].name}`} disabled={busy} hint="Copy this Keep card with Mimic" onPress={() => { playPowerCard(activeCard, { targetCardInstanceId: card.instanceId }); setActiveCardInstanceId(null); }} />
            )))}
          </View>
        </View>
      ) : null}

      {interactive && myTurn && game.phase === 'selling_cards' ? (
        <NeonButton label={pendingCommand ? 'ENDING…' : 'DONE SELLING'} accessibilityHint="Finish Metamorph sales and continue remaining end-turn effects" color={TOKYO.lime} disabled={busy || initialMimicPending} icon={<MaterialCommunityIcons name="skip-next" size={17} color={TOKYO.bg} />} onPress={() => emit('king_of_tokyo:end_turn', {}, 'Finish Metamorph sales')} />
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: TOKYO.bg }} edges={['top', 'right', 'bottom', 'left']}>
    <Text
      accessible
      accessibilityLiveRegion={connectionState === 'error' ? 'assertive' : 'polite'}
      style={{ position: 'absolute', left: -10_000, width: 1, height: 1, overflow: 'hidden' }}
    >
      {liveAnnouncement}
    </Text>
    <ScrollView
      ref={mainScrollRef}
      accessibilityElementsHidden={gameOver}
      importantForAccessibility={gameOver ? 'no-hide-descendants' : 'auto'}
      style={{ flex: 1 }}
      contentContainerStyle={{ width: '100%', maxWidth: 1240, alignSelf: 'center', padding: compact ? 12 : 20, gap: 12, paddingBottom: 36 }}
      showsVerticalScrollIndicator
    >
      <View nativeID="tokyo-toolbar" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TokyoMark size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: compact ? 18 : 23, letterSpacing: compact ? 1 : 2, ...neonText(TOKYO.lime, 10) }}>KING OF TOKYO</Text>
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, marginTop: 3 }}>{phaseLabel}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          <ScalePressable
            accessibilityLabel="Open rulebook"
            accessibilityHint="Opens the base game rules and digital adaptations"
            disabled={isLeaving}
            onPress={() => setShowRules(true)}
            style={{ width: 48, height: 48, borderWidth: 1, borderColor: TOKYO.border, borderRadius: 12, alignItems: 'center', justifyContent: 'center', opacity: isLeaving ? 0.55 : 1 }}
          >
            <MaterialCommunityIcons name="book-open-variant" size={17} color={TOKYO.cyan} />
          </ScalePressable>
          <ScalePressable accessibilityLabel="Leave game" accessibilityHint="Opens a confirmation before forfeiting" disabled={isLeaving} onPress={requestLeave} style={{ width: 48, height: 48, borderWidth: 1, borderColor: `${TOKYO.danger}66`, borderRadius: 12, alignItems: 'center', justifyContent: 'center', opacity: isLeaving ? 0.55 : 1 }}>
            <MaterialCommunityIcons name="exit-to-app" size={19} color={TOKYO.danger} />
          </ScalePressable>
        </View>
      </View>

      {connectionState !== 'connected' && (
        <View accessibilityLabel="Connection status" style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: `${TOKYO.danger}77`, backgroundColor: `${TOKYO.danger}12`, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MaterialCommunityIcons name="connection" size={17} color={TOKYO.danger} />
          <Text style={{ flex: 1, fontFamily: 'SpaceMono_700Bold', color: TOKYO.danger, fontSize: 11, lineHeight: 17 }}>
            {connectionState === 'error' ? 'Could not reconnect. Check your network.' : 'Reconnecting. Decisions are paused until state is refreshed.'}
          </Text>
        </View>
      )}

      {actionMessage && (
        <View style={{ minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: TOKYO.border, backgroundColor: TOKYO.surface, paddingHorizontal: 11, justifyContent: 'center' }}>
          <Text style={{ fontFamily: 'SpaceMono_700Bold', color: TOKYO.cyan, fontSize: 11, lineHeight: 17 }}>{actionMessage}</Text>
        </View>
      )}

      <View accessibilityRole="summary" style={{ alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: myDefenseDecision ? defenseAccent : myTurn ? TOKYO.lime : TOKYO.border, backgroundColor: TOKYO.surface, padding: 10 }}>
        <Text accessibilityRole="header" style={{ maxWidth: '100%', flexShrink: 1, fontFamily: 'Outfit_800ExtraBold', color: TOKYO.text, fontSize: 15, textAlign: 'center' }}>
          {statusTitle}
        </Text>
        {pendingDefenseOwner ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17, marginTop: 4, textAlign: 'center' }}>
          {myDefenseDecision
            ? pendingDefense?.kind === 'camouflage'
              ? pendingDefense.stretchyAvailable
                ? 'Review the Camouflage roll. This damage packet includes Stretchy, so you may change a failed die to a Heart for 2 energy.'
                : 'Review the Camouflage roll. This damage packet has no Stretchy change available.'
              : pendingDefense?.kind === 'wings'
                ? 'Choose whether to spend 2 energy on Wings before this damage continues.'
                : 'Choose how much health to buy with Rapid Healing before this damage lands.'
            : `${pendingDefenseOwner.displayName} is resolving ${defenseLabel} before damage continues.`}
        </Text> : null}
        {pendingMimicOwner ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17, marginTop: 4, textAlign: 'center' }}>
          {myMimicDecision
            ? 'Your newly bought Mimic must copy one Keep card before play continues.'
            : `Waiting for ${pendingMimicOwner.displayName} to copy a Keep card.`}
        </Text> : null}
        {pendingFreezeTimeOwner ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17, marginTop: 4, textAlign: 'center' }}>
          {myFreezeTimeDecision
            ? `Choose whether to queue this extra turn with ${game.pendingFreezeTimeDicePenalty} fewer ${game.pendingFreezeTimeDicePenalty === 1 ? 'die' : 'dice'}. ${game.pendingFreezeTimeChoicesRemaining} choice${game.pendingFreezeTimeChoicesRemaining === 1 ? '' : 's'} remaining.`
            : `Waiting for ${pendingFreezeTimeOwner.displayName} to accept or decline Freeze Time.`}
        </Text> : null}
        {game.phase === 'awaiting_heart_allocation' ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17, marginTop: 4, textAlign: 'center' }}>
          {myHeartAllocation
            ? 'Choose Healing Ray targets and token removals now. Eligibility reflects everything that resolved before Hearts.'
            : `Waiting for ${current?.displayName ?? 'the active monster'} to allocate rolled Hearts.`}
        </Text> : null}
        {game.phase === 'choosing_dice' ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17, marginTop: 4, textAlign: 'center' }}>Roll {game.rollCount}/{game.maxRolls} · {game.rollCount < game.maxRolls ? 'tap dice to keep or release them' : 'final result: use an eligible power or resolve every die'}</Text> : null}
        {game.phase === 'buying_cards' && myTurn && !initialMimicPending ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17, marginTop: 4, textAlign: 'center' }}>Buy any affordable cards, sweep the market, or end your turn.</Text> : null}
        {game.phase === 'selling_cards' && myTurn && !initialMimicPending ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17, marginTop: 4, textAlign: 'center' }}>Sell any Keep cards you choose, then select Done Selling to continue the remaining end-turn effects.</Text> : null}
      </View>

      <View
        nativeID="king-play-area"
        onLayout={({ nativeEvent }) => {
          setPlayAreaWidth(nativeEvent.layout.width);
          decisionZoneYRef.current = nativeEvent.layout.y;
        }}
        style={{ flexDirection: decisionBesideTable ? 'row' : 'column', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20 }}
      >
      {showDecisionZone ? (
      <View
        nativeID="king-current-decision"
        accessibilityLabel={decisionName ? `Current decision: ${decisionName}` : 'Current first-player roll-off'}
        style={{ gap: 12, minWidth: columnMinimum, maxWidth: '100%', flexBasis: decisionBesideTable ? 480 : undefined, flexGrow: decisionBesideTable ? 1.3 : undefined, flexShrink: 1, width: decisionBesideTable ? undefined : '100%' }}
      >
        <Text
          ref={decisionHeadingRef}
          onLayout={() => {
            if (Platform.OS === 'web' && typeof window !== 'undefined' && decisionHeadingRef.current) {
              const scale = Number.parseFloat(window.getComputedStyle(decisionHeadingRef.current as unknown as Element).fontSize) / 12;
              if (Number.isFinite(scale)) setDieTextScale(Math.max(1, scale));
            }
          }}
          accessible
          accessibilityRole="header"
          style={{ fontFamily: 'SpaceMono_700Bold', color: decisionName ? TOKYO.lime : TOKYO.cyan, fontSize: 12, letterSpacing: 1.2 }}
        >
          {decisionName ? `ACTION REQUIRED · ${decisionName.toUpperCase()}` : 'CURRENT ROLL-OFF'}
        </Text>

      {myDefenseDecision && pendingDefense ? (
        <View accessibilityLabel={`${defenseLabel} defence decision`} style={{ maxWidth: '100%', minWidth: 0, gap: 10, padding: 13, borderRadius: 16, borderWidth: 1.5, borderColor: defenseAccent, backgroundColor: TOKYO.panel }}>
          {pendingDefense.kind === 'camouflage' ? (
            <>
              <SectionTitle
                icon="shield-search"
                title="CAMOUFLAGE"
                detail={`Roll ${pendingDefense.camouflageCopy ?? 1} of ${pendingDefense.camouflageCopies ?? 1}`}
              />
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>
                {pendingDefense.remainingDamage} incoming health. Each Heart prevents 1. {pendingDefense.stretchyAvailable ? 'Tap a failed die to change it to a Heart for 2 energy.' : 'Resolve these dice exactly as rolled.'}
              </Text>
              <View style={{ maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 9 }}>
                {pendingDefense.dice.map((face, index) => {
                  const selectedHeart = camouflageHeartIndexes.has(index);
                  const alreadyHeart = face === 'heart';
                  const atLimit = !selectedHeart && selectedCamouflageCount >= camouflageEnergyLimit;
                  return (
                    <View key={index} style={{ minWidth: 62, alignItems: 'center', gap: 4 }}>
                      <TokyoDie
                        face={selectedHeart ? 'heart' : face}
                        index={index}
                        selectionState={selectedHeart ? 'changed' : alreadyHeart ? 'armed' : undefined}
                        interactive={!busy && pendingDefense.stretchyAvailable && !alreadyHeart && !atLimit}
                        size={compact ? 60 : 68}
                        textScale={dieTextScale}
                        accessibilityHint={alreadyHeart
                          ? 'This Heart already prevents one health'
                          : !pendingDefense.stretchyAvailable
                            ? 'This failed die cannot be changed in this damage packet'
                          : selectedHeart
                            ? 'Remove this proposed Stretchy change and recover 2 energy'
                            : atLimit
                              ? 'Not enough energy to change another die'
                              : 'Change this Camouflage die to a Heart for 2 energy'}
                        onPress={() => toggleCamouflageHeart(index)}
                      />
                      <Text style={{ maxWidth: 82, fontFamily: 'SpaceMono_700Bold', color: alreadyHeart || selectedHeart ? '#55E59A' : TOKYO.muted, fontSize: 11, lineHeight: 14, textAlign: 'center' }}>
                        {alreadyHeart ? 'PREVENTS 1' : selectedHeart ? 'TO HEART · 2 ENERGY' : 'FAILED'}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <Text style={{ fontFamily: 'SpaceMono_700Bold', color: defenseAccent, fontSize: 11, lineHeight: 17, textAlign: 'center' }}>
                This roll will prevent {camouflagePrevented} of {pendingDefense.remainingDamage}. Later defences may still apply.
              </Text>
              <View nativeID="tokyo-camouflage-actions" style={{ width: '100%', minWidth: 0, flexDirection: 'column', gap: 8 }}>
                {selectedCamouflageCount > 0 ? (
                  <NeonButton
                    label={`CHANGE ${selectedCamouflageCount} TO HEART · ${selectedCamouflageCount * 2} ENERGY`}
                    accessibilityHint="Spend energy and resolve the changed Camouflage dice"
                    color={defenseAccent}
                    disabled={busy}
                    onPress={submitCamouflageChanges}
                  />
                ) : null}
                <NeonButton
                  label="KEEP CAMOUFLAGE ROLL"
                  accessibilityHint="Spend no energy and resolve the Camouflage dice as rolled"
                  color={TOKYO.muted}
                  variant="outline"
                  disabled={busy}
                  onPress={() => submitDefense({ kind: 'camouflage', changes: [] }, 'Keep Camouflage roll')}
                />
              </View>
            </>
          ) : pendingDefense.kind === 'wings' ? (
            <>
              <SectionTitle icon="shield-outline" title="USE WINGS?" detail={`${pendingDefense.remainingDamage} incoming health`} />
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>
                Spend 2 energy to prevent this health loss and any later health loss during the current turn.
              </Text>
              <View nativeID="tokyo-wings-actions" style={{ width: '100%', minWidth: 0, flexDirection: 'column', gap: 8 }}>
                <NeonButton
                  label="USE WINGS · 2 ENERGY"
                  accessibilityHint="Spend 2 energy and prevent health loss for the rest of this turn"
                  color={defenseAccent}
                  disabled={busy || me.energy < 2}
                  onPress={() => submitDefense({ kind: 'wings', use: true }, 'Use Wings')}
                />
                <NeonButton
                  label="CONTINUE WITHOUT WINGS"
                  accessibilityHint="Decline Wings; Rapid Healing may still be offered before damage"
                  color={TOKYO.muted}
                  variant="outline"
                  disabled={busy}
                  onPress={() => submitDefense({ kind: 'wings', use: false }, 'Decline Wings')}
                />
              </View>
            </>
          ) : (
            <>
              <SectionTitle icon="heart-plus-outline" title="RAPID HEALING" detail={`${pendingDefense.remainingDamage} incoming health`} />
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>
                Each activation costs 2 energy and heals up to {pendingDefense.healingPerActivation} health before this damage resolves.
              </Text>
              <CounterChoice
                label="RAPID HEALING ACTIVATIONS"
                value={rapidHealingActivations}
                max={pendingDefense.maxActivations}
                color={defenseAccent}
                disabled={busy}
                onChange={setRapidHealingActivations}
              />
              <Text style={{ fontFamily: 'SpaceMono_700Bold', color: defenseAccent, fontSize: 11, lineHeight: 17, textAlign: 'center' }}>
                Cost {rapidHealingActivations * 2} energy · heal {rapidPreview.healed} · projected health after damage {rapidPreview.remainingHealth}
              </Text>
              <View nativeID="tokyo-rapid-healing-actions" style={{ width: '100%', minWidth: 0, flexDirection: 'column', gap: 8 }}>
                {rapidHealingActivations > 0 ? (
                  <NeonButton
                    label={`HEAL ${rapidPreview.healed} · ${rapidHealingActivations * 2} ENERGY`}
                    accessibilityHint="Spend the selected energy, heal, then continue the damage packet"
                    color={defenseAccent}
                    disabled={busy}
                    onPress={() => submitDefense({ kind: 'rapid_healing', activations: rapidHealingActivations }, `Rapid Heal ${rapidHealingActivations}`)}
                  />
                ) : null}
                <NeonButton
                  label="TAKE DAMAGE WITHOUT HEALING"
                  accessibilityHint="Spend no energy on Rapid Healing for this damage packet"
                  color={TOKYO.muted}
                  variant="outline"
                  disabled={busy}
                  onPress={() => submitDefense({ kind: 'rapid_healing', activations: 0 }, 'Decline Rapid Healing')}
                />
              </View>
            </>
          )}
        </View>
      ) : null}

      {myMimicDecision && pendingMimicCard ? (
        <View style={{ gap: 9, padding: 13, borderRadius: 16, borderWidth: 1.5, borderColor: '#B58CFF', backgroundColor: TOKYO.panel }}>
          <SectionTitle icon="content-copy" title="COPY A KEEP CARD" />
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>
            Copy any monster’s Keep card, including your own. This required first copy costs no energy.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {pendingMimicTargets.map(({ player, card }) => (
              <ChoiceChip
                key={card.instanceId}
                label={`COPY ${player.displayName} · ${KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].name}`}
                color="#B58CFF"
                disabled={busy}
                hint="Copy this Keep card with the newly bought Mimic"
                onPress={() => playPowerCard(pendingMimicCard, { targetCardInstanceId: card.instanceId })}
              />
            ))}
          </View>
        </View>
      ) : null}

      {myFreezeTimeDecision ? (
        <View style={{ gap: 9, padding: 13, borderRadius: 16, borderWidth: 1.5, borderColor: '#B58CFF', backgroundColor: TOKYO.panel }}>
          <SectionTitle icon="timer-sand" title="FREEZE TIME" detail={`${game.pendingFreezeTimeChoicesRemaining} choice${game.pendingFreezeTimeChoicesRemaining === 1 ? '' : 's'} left`} />
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>
            This trigger is optional. Each copy is decided separately, and this offer uses {game.pendingFreezeTimeDicePenalty} fewer {game.pendingFreezeTimeDicePenalty === 1 ? 'die' : 'dice'}.
          </Text>
          <View style={{ flexDirection: compact ? 'column' : 'row', gap: 8 }}>
            <NeonButton label="TAKE EXTRA TURN" accessibilityHint="Accept this Freeze Time trigger" color="#B58CFF" disabled={busy} onPress={() => emit('king_of_tokyo:freeze_time', { accept: true }, 'Accept Freeze Time')} />
            <NeonButton label="DECLINE" accessibilityHint="Decline this Freeze Time trigger and continue resolving dice" color={TOKYO.muted} variant="outline" disabled={busy} onPress={() => emit('king_of_tokyo:freeze_time', { accept: false }, 'Decline Freeze Time')} />
          </View>
        </View>
      ) : null}

      {game.phase === 'determining_first_player' ? (
        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: TOKYO.cyan, backgroundColor: TOKYO.panel, padding: 15, gap: 10 }}>
          <SectionTitle icon="dice-multiple" title="FIRST PLAYER ROLL-OFF" detail={`Round ${game.rollOffRound} · most Smash starts`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {game.startingRollContenders.map((id) => {
              const player = game.players.find((candidate) => candidate.playerId === id)!;
              const score = game.startRolls[id];
              return <StatusChip key={id} label={`${player.displayName}: ${score === null ? 'WAITING' : `${score} SMASH`}`} active={id === playerId} />;
            })}
          </View>
          {myStartRollPending ? <NeonButton label={pendingCommand ? 'ROLLING…' : 'ROLL 6 DICE FOR FIRST'} accessibilityHint="Roll all six dice; the monster with the most Smash symbols starts the first match" color={TOKYO.lime} disabled={busy} icon={<MaterialCommunityIcons name="dice-6" size={18} color={TOKYO.bg} />} onPress={() => emit('king_of_tokyo:roll_for_first', { rollOffRound: game.rollOffRound }, 'First-player roll')} /> : null}
          {!myStartRollPending ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' }}>Waiting for the remaining tied monsters.</Text> : null}
        </View>
      ) : null}

      {showDiceInDecision ? (
        <View nativeID="tokyo-active-dice-tray" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'stretch', gap: 12, padding: 16, paddingBottom: 20, borderRadius: 20, borderWidth: 2, borderTopColor: '#050D09', borderLeftColor: '#050D09', borderRightColor: TOKYO.border, borderBottomColor: '#31513B', backgroundColor: '#091A12' }}>
          {game.dice.map((die, index) => {
            const canKeep = myTurn
              && game.phase === 'choosing_dice'
              && game.rollCount < game.maxRolls
              && pendingRerollConfirmation === null;
            const canTargetWithPower = Boolean(
              activeCardSelectionValid
              && activeCard
              && activePowerId
              && DICE_POWER_IDS.has(activePowerId)
              && (activePowerId !== 'background_dweller' || die.face === 3),
            );
            const targeted = activeDieIndex === index;
            return (
              <TokyoDie
                key={index}
                face={die.face}
                index={index}
                selectionState={targeted ? 'targeted' : canKeep && selected.has(index) ? 'kept' : undefined}
                interactive={!busy && !initialMimicPending && game.phase !== 'awaiting_defense_decision' && (myPsychicDecision || canTargetWithPower || canKeep)}
                size={compact ? 72 : 88}
                textScale={dieTextScale}
                accessibilityHint={myPsychicDecision
                  ? 'Force this die to reroll with Psychic Probe'
                  : activeCard && canTargetWithPower
                    ? `Target this die with ${KING_OF_TOKYO_POWER_CARD_BY_ID[activeCard.cardId].name}`
                    : canKeep
                      ? 'Keep or release this die before a reroll'
                      : 'Final result. This die can no longer be kept or released.'}
                onPress={() => toggleDie(index)}
              />
            );
          })}
        </View>
      ) : null}

      {myTurn && game.phase === 'choosing_dice' && me.tokyoZone ? (
        <View
          accessibilityRole="alert"
          style={{ borderRadius: 12, borderWidth: 1, borderColor: `${TOKYO.danger}88`, backgroundColor: `${TOKYO.danger}12`, paddingHorizontal: 12, paddingVertical: 9 }}
        >
          <Text style={{ fontFamily: 'SpaceMono_700Bold', color: TOKYO.danger, fontSize: 11, lineHeight: 17, textAlign: 'center' }}>
            ROLLED HEARTS CANNOT HEAL YOU WHILE IN TOKYO
          </Text>
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 10, lineHeight: 15, textAlign: 'center' }}>
            They can still power Healing Ray. Rapid Healing also works because its card text overrides the arena rule.
          </Text>
        </View>
      ) : null}

      {myResolutionDecision ? (
        <View style={{ gap: 12, padding: 13, borderRadius: 16, borderWidth: 1.5, borderColor: TOKYO.lime, backgroundColor: TOKYO.panel }}>
          <SectionTitle icon="sort-ascending" title="RESOLVE EVERY RESULT" detail="Choose the order" />
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>
            Every group resolves once. Move a group earlier or later, then confirm the complete plan.
          </Text>
          <View style={{ gap: 7 }}>
            {resolutionOrder.map((category, index) => {
              const meta = RESOLUTION_META[category];
              return (
                <View key={category} accessible={false} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: `${meta.color}66`, backgroundColor: TOKYO.surface, paddingLeft: 11, paddingRight: 4 }}>
                  <Text style={{ width: 18, fontFamily: 'Outfit_800ExtraBold', color: meta.color, fontSize: 14 }}>{index + 1}</Text>
                  <MaterialCommunityIcons name={meta.icon} size={18} color={meta.color} />
                  <Text style={{ flex: 1, fontFamily: 'Outfit_700Bold', color: TOKYO.text, fontSize: 12 }}>{meta.label}</Text>
                  <ScalePressable accessibilityLabel={`Move ${meta.label} earlier`} disabled={busy || index === 0} onPress={() => moveResolution(index, -1)} style={{ width: 48, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', opacity: index === 0 ? 0.35 : 1 }}><MaterialCommunityIcons name="chevron-up" size={21} color={meta.color} /></ScalePressable>
                  <ScalePressable accessibilityLabel={`Move ${meta.label} later`} disabled={busy || index === resolutionOrder.length - 1} onPress={() => moveResolution(index, 1)} style={{ width: 48, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', opacity: index === resolutionOrder.length - 1 ? 0.35 : 1 }}><MaterialCommunityIcons name="chevron-down" size={21} color={meta.color} /></ScalePressable>
                </View>
              );
            })}
          </View>

          <NeonButton label={pendingCommand ? 'RESOLVING…' : 'CONFIRM RESULT ORDER'} accessibilityHint={`Resolve in this order: ${resolutionOrder.map((category) => RESOLUTION_META[category].label).join(', ')}`} color={TOKYO.lime} disabled={busy} icon={<MaterialCommunityIcons name="check-all" size={18} color={TOKYO.bg} />} onPress={resolveResults} />
        </View>
      ) : null}

      {myHeartAllocation ? (
        <View style={{ gap: 12, padding: 13, borderRadius: 16, borderWidth: 1.5, borderColor: '#55E59A', backgroundColor: TOKYO.panel }}>
          <SectionTitle icon="heart-plus-outline" title="ALLOCATE HEARTS" detail="Uses the table state at this step" />
          {game.pendingHeartAllocation?.healingRayAvailable && healingTargets.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>
                Assign any Heart to a wounded rival. They heal 1 and pay you 2 energy, or all remaining energy if they have less, including zero.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {heartIndexes.map((dieIndex) => {
                  const target = healingTargets.find((candidate) => candidate.playerId === healingRayTargets[dieIndex]);
                  return <ChoiceChip key={dieIndex} label={`HEART ${dieIndex + 1}: ${target?.displayName ?? 'SELF / TOKENS'}`} active={activeHeartIndex === dieIndex} color="#55E59A" disabled={busy} hint="Select this Heart, then choose who receives it" onPress={() => setActiveHeartIndex(dieIndex)} />;
                })}
              </View>
              {activeHeartIndex !== null ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  <ChoiceChip label="SELF / TOKENS" active={!healingRayTargets[activeHeartIndex]} color="#55E59A" disabled={busy} onPress={() => assignHeart(activeHeartIndex)} />
                  {healingTargets.map((target) => {
                    const selectedForTarget = Object.entries(healingRayTargets).filter(([index, targetId]) =>
                      Number(index) !== activeHeartIndex && targetId === target.playerId).length;
                    const atCapacity = selectedForTarget >= target.maxHealth - target.health;
                    return <ChoiceChip key={target.playerId} label={`HEAL ${target.displayName}`} active={healingRayTargets[activeHeartIndex] === target.playerId} color="#55E59A" disabled={busy || atCapacity} hint={`${target.displayName} pays 2 energy per assigned Heart or all they have. Their Regeneration may add free healing.`} onPress={() => assignHeart(activeHeartIndex, target.playerId)} />;
                  })}
                </View>
              ) : null}
            </View>
          ) : null}

          {(me.poisonTokens > 0 || me.shrinkTokens > 0) ? (
            <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: TOKYO.border, paddingTop: 11 }}>
              <SectionTitle icon="shield-remove-outline" title="SPEND HEARTS ON TOKENS" detail={me.tokyoZone ? 'Unavailable while in Tokyo' : `${tokenRemovalCapacity} Heart${tokenRemovalCapacity === 1 ? '' : 's'} available`} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {me.poisonTokens > 0 ? <CounterChoice label="POISON TOKENS" value={poisonTokensToRemove} max={Math.min(me.poisonTokens, Math.max(0, tokenRemovalCapacity - shrinkTokensToRemove))} color="#72E36E" disabled={busy || Boolean(me.tokyoZone)} onChange={setPoisonTokensToRemove} /> : null}
                {me.shrinkTokens > 0 ? <CounterChoice label="SHRINK TOKENS" value={shrinkTokensToRemove} max={Math.min(me.shrinkTokens, Math.max(0, tokenRemovalCapacity - poisonTokensToRemove))} color="#B58CFF" disabled={busy || Boolean(me.tokyoZone)} onChange={setShrinkTokensToRemove} /> : null}
              </View>
            </View>
          ) : null}

          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>
            {allocatedHealingRays.length} Heart{allocatedHealingRays.length === 1 ? '' : 's'} assigned to Healing Ray; {poisonTokensToRemove + shrinkTokensToRemove} to tokens; {unusedHearts} {me.tokyoZone ? 'remaining Heart(s) cannot heal you in Tokyo' : 'remaining Heart(s) heal you up to maximum health'}.
          </Text>
          <NeonButton label={pendingCommand ? 'ALLOCATING…' : 'CONFIRM HEARTS'} accessibilityHint="Apply these Healing Ray, token-removal, and self-healing choices" color="#55E59A" disabled={busy} icon={<MaterialCommunityIcons name="heart-plus-outline" size={18} color={TOKYO.bg} />} onPress={allocateHearts} />
        </View>
      ) : null}

      {activeCardSelectionValid && activeCard && activeDieIndex !== null && !initialMimicPending && (activePowerId === 'plot_twist' || activePowerId === 'stretchy') ? (
        <View style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: '#B58CFF', backgroundColor: TOKYO.panel }}>
          <SectionTitle icon="swap-horizontal" title={`CHOOSE NEW FACE FOR DIE ${activeDieIndex + 1}`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {CHANGEABLE_FACES.map((face) => <ChoiceChip key={String(face)} label={String(face).toUpperCase()} color="#B58CFF" disabled={busy} onPress={() => chooseFace(face)} />)}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 9 }}>
        {myTurn && game.phase === 'awaiting_roll' ? <NeonButton label={pendingCommand ? 'ROLLING…' : 'ROLL DICE'} accessibilityHint="Begins your first roll of the turn" color={TOKYO.lime} disabled={busy} icon={<MaterialCommunityIcons name="dice-multiple" size={18} color={TOKYO.bg} />} onPress={() => emit('king_of_tokyo:roll', {}, 'Roll dice')} /> : null}
        {myTurn && game.phase === 'choosing_dice' ? (
          <>
            {game.rollCount < game.maxRolls ? <NeonButton label={pendingRerollConfirmation !== null ? 'ROLLING…' : `REROLL (${game.maxRolls - game.rollCount} LEFT)`} accessibilityHint={`${selected.size} ${selected.size === 1 ? 'die' : 'dice'} kept; reroll every unkept die`} color={TOKYO.cyan} disabled={busy || pendingRerollConfirmation !== null || selected.size === game.dice.length} icon={<MaterialCommunityIcons name="refresh" size={17} color={TOKYO.bg} />} onPress={reroll} /> : null}
            <NeonButton label={pendingCommand ? 'PREPARING…' : 'RESOLVE DICE'} accessibilityHint="Stops rolling, then lets you choose the order in which every result resolves" color={TOKYO.lime} variant="outline" disabled={busy || pendingRerollConfirmation !== null} icon={<MaterialCommunityIcons name="checkbox-marked-circle-outline" size={17} color={TOKYO.lime} />} onPress={() => emit('king_of_tokyo:resolve_dice', {}, 'Prepare dice results')} />
          </>
        ) : null}
        {myPsychicDecision ? (
          <View style={{ gap: 8 }}>
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.cyan, textAlign: 'center', fontSize: 11, lineHeight: 17 }}>Tap one die above to force its reroll, or pass.</Text>
            <NeonButton label="PASS PSYCHIC PROBE" color={TOKYO.cyan} variant="outline" disabled={busy} onPress={() => emit('king_of_tokyo:psychic_probe', { dieIndex: null }, 'Pass Psychic Probe')} />
          </View>
        ) : null}
        {myTokyoDecision ? (
          <View style={{ gap: 9 }}>
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.danger, textAlign: 'center' }}>You have {me.health} health. Stay in {me.tokyoZone === 'tokyo_bay' ? 'Tokyo Bay' : 'Tokyo City'}, or yield your place to the attacker?</Text>
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, textAlign: 'center', fontSize: 12, lineHeight: 18 }}>{game.hasDeferredSmashDamage ? 'Jets defers this Smash damage: staying takes it; yielding prevents it.' : 'Stay to earn 2 victory points at the start of your next turn. Yield to leave Tokyo, where rolled Hearts can heal you.'}</Text>
            <NeonButton label="STAY IN TOKYO" accessibilityHint="Keep your Tokyo position; if Jets deferred the attacker’s Smash, take that pending damage" color={TOKYO.lime} disabled={busy} onPress={() => emit('king_of_tokyo:yield_tokyo', { yieldTokyo: false }, 'Stay in Tokyo')} />
            <NeonButton label="YIELD TOKYO" accessibilityHint="Leave Tokyo. If your Jets deferred the attacker’s Smash, prevent that pending damage and open your space" color={TOKYO.danger} variant="outline" disabled={busy} onPress={() => emit('king_of_tokyo:yield_tokyo', { yieldTokyo: true }, 'Yield Tokyo')} />
          </View>
        ) : null}
        {myOpportunity && opportunistCard ? (
          <View style={{ gap: 9 }}>
            <PowerCard card={opportunistCard} standalone />
            <NeonButton label="BUY WITH OPPORTUNIST" color={TOKYO.energy} disabled={busy || initialMimicPending || me.energy < Math.max(0, KING_OF_TOKYO_POWER_CARD_BY_ID[opportunistCard.cardId].cost - marketDiscount)} onPress={() => emit('king_of_tokyo:opportunist', { buy: true }, 'Buy with Opportunist')} />
            <NeonButton label="PASS" color={TOKYO.muted} variant="outline" disabled={busy || initialMimicPending} onPress={() => emit('king_of_tokyo:opportunist', { buy: false }, 'Pass Opportunist')} />
          </View>
        ) : null}
        {myEndTurnDecision ? (
          <View style={{ gap: 9, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: TOKYO.energy, backgroundColor: TOKYO.panel }}>
            <SectionTitle icon="sort" title="CHOOSE THE NEXT EFFECT" detail="Each listed effect resolves exactly once" />
            {game.pendingEndTurnEffects.map((effect) => {
              const labels = {
                poison: `TAKE ${me.poisonTokens} POISON DAMAGE`,
                energy_hoarder: `ENERGY HOARDER${effect.copies > 1 ? ` ×${effect.copies}` : ''}`,
                herbivore: `HERBIVORE${effect.copies > 1 ? ` ×${effect.copies}` : ''}`,
                rooting_for_underdog: `ROOTING FOR THE UNDERDOG${effect.copies > 1 ? ` ×${effect.copies}` : ''}`,
                solar_powered: `SOLAR POWERED${effect.copies > 1 ? ` ×${effect.copies}` : ''}`,
                metamorph: 'OPEN METAMORPH SALES',
              } as const;
              return <NeonButton key={effect.effectId} label={labels[effect.kind]} color={effect.kind === 'poison' ? TOKYO.danger : TOKYO.energy} variant="outline" disabled={busy} onPress={() => emit('king_of_tokyo:resolve_end_turn_effect', { effectId: effect.effectId }, `Resolve ${effect.kind.replaceAll('_', ' ')}`)} />;
            })}
          </View>
        ) : null}
      </View>

      {showMarketInDecision ? renderMarket(true) : null}
      {showOwnedCardsInDecision ? renderOwnedCards(true) : null}

      {ownsTentacles && myTurn && game.phase === 'buying_cards' ? (
        <View style={{ gap: 10, borderRadius: 17, borderWidth: 1, borderColor: '#FF9E5E', backgroundColor: TOKYO.surface, padding: 13 }}>
          <SectionTitle icon="source-branch" title="PARASITIC TENTACLES" detail="Pay a rival to take one Keep card" />
          <PowerCardCollection compact>{layout => game.players.filter((player) => player.playerId !== playerId && !player.eliminated && !presenceById.get(player.playerId)?.hasLeft).flatMap((owner) => owner.powerCards.map((card) => (
              <PowerCard {...layout} key={card.instanceId} card={card} compact actionLabel={`BUY FROM ${owner.displayName.toUpperCase()}`} actionDisabled={busy || initialMimicPending || me.energy < Math.max(0, KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].cost - marketDiscount)} onAction={() => emit('king_of_tokyo:buy_owned_card', { ownerPlayerId: owner.playerId, cardInstanceId: card.instanceId }, `Buy ${KING_OF_TOKYO_POWER_CARD_BY_ID[card.cardId].name} from ${owner.displayName}`)} />
            )))}</PowerCardCollection>
        </View>
      ) : null}
      </View>
      ) : null}

      <View nativeID="tokyo-table-state" style={{ gap: 12, minWidth: columnMinimum, maxWidth: '100%', flexBasis: decisionBesideTable ? 380 : undefined, flexGrow: decisionBesideTable ? 1 : undefined, flexShrink: 1, width: decisionBesideTable ? undefined : '100%' }}>
        <SectionTitle icon="city-variant-outline" title="TABLE STATE" detail={`${game.players.length} monsters`} />
        <View style={{ flexDirection: isWide ? 'row' : 'column', gap: 10, alignItems: 'stretch' }}>
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start', gap: 8 }}>
            {game.players.map((player, index) => (
              <PlayerPanel
                key={player.playerId}
                player={player}
                profileIndex={index}
                presence={presenceById.get(player.playerId)}
                active={player.playerId === game.currentPlayerId && !presenceById.get(player.playerId)?.hasLeft}
                dense={denseRoster}
                basis={playerPanelBasis}
              />
            ))}
          </View>
          <View style={{ flex: isWide ? 1.05 : undefined }}>
            <TokyoArena players={game.players} currentPlayerId={game.currentPlayerId} capacity={game.tokyoCapacity} compact={compact} />
          </View>
        </View>
      </View>
      </View>

      {!showDiceInDecision && game.phase !== 'determining_first_player' ? (
        <View style={{ gap: 9 }}>
          <SectionTitle icon="dice-multiple" title="CURRENT DICE" onTextScale={setDieTextScale} />
          <View nativeID="tokyo-public-dice-tray" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'stretch', gap: 12, padding: 16, paddingBottom: 20, borderRadius: 20, borderWidth: 2, borderTopColor: '#050D09', borderLeftColor: '#050D09', borderRightColor: TOKYO.border, borderBottomColor: '#31513B', backgroundColor: '#091A12' }}>
            {game.dice.map((die, index) => (
              <TokyoDie
                key={index}
                face={die.face}
                index={index}
                selectionState={game.phase === 'choosing_dice' && game.rollCount < game.maxRolls && die.kept ? 'kept' : undefined}
                interactive={false}
                size={compact ? 64 : 76}
                textScale={dieTextScale}
                accessibilityHint="Current public die result"
                onPress={() => {}}
              />
            ))}
          </View>
        </View>
      ) : null}

      {!showMarketInDecision ? renderMarket(false) : null}
      {!showOwnedCardsInDecision ? renderOwnedCards(false) : null}

      {!me.eliminated && !gameOver ? <View nativeID="tokyo-preferences" style={{ gap: 10, borderRadius: 17, borderWidth: 1, borderColor: TOKYO.border, backgroundColor: TOKYO.surface, padding: 13 }}>
        <SectionTitle icon="tune-variant" title="MONSTER PREFERENCES" />
        {ownsDefense && preferences ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>Private Wings defence preference while connected. You still choose each offer; reconnect-grace expiry forfeits rather than auto-playing.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {(['off', 'lethal', 'always'] as const).map((mode) => <ChoiceChip key={mode} label={mode === 'lethal' ? 'LETHAL ONLY' : mode.toUpperCase()} active={preferences.defenseMode === mode} color={TOKYO.cyan} disabled={busy} onPress={() => emit('king_of_tokyo:preferences', { defenseMode: mode }, `Set Wings to ${mode}`)} />)}
            </View>
          </View>
        ) : null}
        {ownsRapidHealing && preferences ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>Private Rapid Healing preference while connected. You still choose the exact amount; reconnect-grace expiry forfeits rather than auto-playing.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {(['off', 'lethal', 'always'] as const).map((mode) => <ChoiceChip key={mode} label={mode === 'lethal' ? 'LETHAL ONLY' : mode.toUpperCase()} active={preferences.rapidHealingMode === mode} color="#55E59A" disabled={busy} onPress={() => emit('king_of_tokyo:preferences', { rapidHealingMode: mode }, `Set Rapid Healing to ${mode}`)} />)}
            </View>
          </View>
        ) : null}
        {preferences ? <View style={{ gap: 6 }}>
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>When a Heart can remove a token, remove this type first</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            <ChoiceChip label="POISON FIRST" active={preferences.tokenPreference === 'poison'} color="#72E36E" disabled={busy} onPress={() => emit('king_of_tokyo:preferences', { tokenPreference: 'poison' }, 'Prefer Poison tokens')} />
            <ChoiceChip label="SHRINK FIRST" active={preferences.tokenPreference === 'shrink'} color="#B58CFF" disabled={busy} onPress={() => emit('king_of_tokyo:preferences', { tokenPreference: 'shrink' }, 'Prefer Shrink tokens')} />
          </View>
        </View> : <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17 }}>Refreshing your private preferences…</Text>}
      </View> : null}


      <View style={{ borderRadius: 14, backgroundColor: TOKYO.surface, borderWidth: 1, borderColor: TOKYO.border, padding: 14 }}>
        <SectionTitle icon="radio-tower" title="RECENT EVENTS" />
        <View>
          {game.log.slice(-8).map((entry) => <Text key={entry.id} style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.text, fontSize: 11, lineHeight: 17, marginTop: 5 }}>{entry.text}</Text>)}
        </View>
      </View>
    </ScrollView>

    {gameOver && (
      <Modal transparent visible animationType="none" onRequestClose={closeFinishedGame}>
        <View
          nativeID="king-of-tokyo-game-over"
          accessibilityLabel="Game over"
          accessibilityViewIsModal
          onAccessibilityEscape={closeFinishedGame}
          role="dialog"
          aria-modal
          style={{ flex: 1, width: '100%', backgroundColor: TOKYO.bg }}
        >
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'right', 'bottom', 'left']}>
            <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 30 }} showsVerticalScrollIndicator>
              <View style={{ width: '100%', maxWidth: 1040, flexDirection: resultsWide ? 'row' : 'column', flexWrap: 'wrap', alignItems: 'flex-start', gap: 32 }}>
              <View nativeID="tokyo-result-summary" style={{ minWidth: columnMinimum, maxWidth: '100%', flexBasis: resultsWide ? 380 : undefined, flexGrow: resultsWide ? 1 : undefined, flexShrink: 1, width: resultsWide ? undefined : '100%', alignItems: 'center' }}>
              <View style={{ padding: 14, paddingBottom: 18, borderRadius: 30, borderWidth: 1, borderColor: winner ? `${TOKYO.lime}55` : `${TOKYO.danger}55`, borderBottomWidth: 4, backgroundColor: TOKYO.surface }}>
              {winner ? <MonsterAvatar seed={winner.playerId} profileIndex={game.players.findIndex((player) => player.playerId === winner.playerId)} size={84} active /> : <MaterialCommunityIcons name="skull-crossbones-outline" size={72} color={TOKYO.danger} />}
              </View>
              <Text accessibilityRole="header" style={{ maxWidth: '100%', fontFamily: 'Outfit_800ExtraBold', fontSize: 28, textAlign: 'center', color: winner ? TOKYO.lime : TOKYO.danger, marginTop: 16 }}>
                {game.terminationReason ? 'MATCH ENDED' : winner ? (winner.playerId === playerId ? 'YOU RULE TOKYO!' : `${winner.displayName} RULES TOKYO`) : 'EVERYONE LOSES'}
              </Text>
              <Text style={{ maxWidth: '100%', fontFamily: 'Outfit_400Regular', color: TOKYO.muted, fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 8 }}>
                {game.terminationReason ? 'All remaining monsters forfeited. No winner or competitive result is recorded.' : game.victoryType === 'victory_points' ? 'Reached 20 victory points and survived the turn.' : game.victoryType === 'last_monster_standing' ? 'Last living monster standing.' : 'Every monster was eliminated in the same resolution.'}
              </Text>
              <View nativeID="tokyo-result-actions" style={{ width: '100%', gap: 10, marginTop: 24 }}>
                {(connectionState !== 'connected' || actionMessage) ? (
                  <View
                    accessible
                    accessibilityLiveRegion={connectionState === 'error' ? 'assertive' : 'polite'}
                    accessibilityLabel={connectionState === 'error' ? `Connection error. ${actionMessage ?? 'Could not reconnect.'}` : actionMessage ?? 'Reconnecting to the table.'}
                    style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: connectionState === 'error' ? `${TOKYO.danger}88` : TOKYO.border, backgroundColor: TOKYO.surface, paddingHorizontal: 12, justifyContent: 'center' }}
                  >
                    <Text style={{ fontFamily: 'SpaceMono_700Bold', color: connectionState === 'error' ? TOKYO.danger : TOKYO.cyan, fontSize: 11, lineHeight: 17, textAlign: 'center' }}>
                      {connectionState === 'error' ? actionMessage ?? 'Could not reconnect. Check your network.' : connectionState === 'reconnecting' ? actionMessage ?? 'Reconnecting to the table…' : actionMessage}
                    </Text>
                  </View>
                ) : null}
                {isHost ? (
                  <>
                    <NeonButton
                      label={connectionState === 'error'
                        ? 'CONNECTION ERROR'
                        : connectionState === 'reconnecting'
                          ? 'RECONNECTING…'
                          : pendingCommand === 'Play again'
                        ? 'STARTING…'
                        : reconnectingRematchPlayers > 0
                          ? `WAITING FOR ${reconnectingRematchPlayers}`
                          : connectedRematchPlayers < KING_OF_TOKYO_MIN_PLAYERS
                            ? `NEED ${KING_OF_TOKYO_MIN_PLAYERS} PLAYERS`
                            : 'PLAY AGAIN'}
                      accessibilityHint={returningWinnerStartsRematch
                        ? 'Start a rematch with the returning previous winner taking the first turn'
                        : 'Start a rematch with a fresh all-player Smash roll-off'}
                      color={TOKYO.lime}
                      disabled={busy || !canStartRematch}
                      icon={<MaterialCommunityIcons name="play" size={16} color={TOKYO.bg} />}
                      onPress={playAgain}
                    />
                    {!canStartRematch ? <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' }}>
                      {reconnectingRematchPlayers > 0
                        ? `Waiting for ${reconnectingRematchPlayers} reserved seat${reconnectingRematchPlayers === 1 ? '' : 's'} to reconnect.`
                        : `Only ${connectedRematchPlayers} monster${connectedRematchPlayers === 1 ? '' : 's'} remain. Finished rooms do not accept replacements, so the host must leave and create a new room.`}
                    </Text> : null}
                  </>
                ) : (
                  <Text style={{ fontFamily: 'SpaceMono_400Regular', color: TOKYO.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' }}>
                    {reconnectingRematchPlayers > 0
                      ? `Waiting for ${reconnectingRematchPlayers} reserved seat${reconnectingRematchPlayers === 1 ? '' : 's'} to reconnect before the host can start.`
                      : connectedRematchPlayers < KING_OF_TOKYO_MIN_PLAYERS
                        ? 'Not enough connected monsters remain. Finished rooms do not accept replacements, so the host must leave and create a new room.'
                        : returningWinnerStartsRematch
                          ? 'Waiting for the room host to start a rematch. The returning previous winner starts next.'
                          : 'Waiting for the room host to start a rematch. Everyone rolls Smash to choose the first player.'}
                  </Text>
                )}
                <NeonButton label={isLeaving ? 'LEAVING…' : 'LEAVE TABLE'} color={TOKYO.cyan} variant="outline" disabled={isLeaving} onPress={closeFinishedGame} />
              </View>
              </View>
              <View nativeID="tokyo-result-roster" style={{ minWidth: columnMinimum, maxWidth: '100%', flexBasis: resultsWide ? 380 : undefined, flexGrow: resultsWide ? 1 : undefined, flexShrink: 1, width: resultsWide ? undefined : '100%', gap: 10 }}>
                <SectionTitle icon="account-group-outline" title="FINAL TABLE" />
                {game.players.map((player, index) => {
                  const status = player.forfeited ? 'FORFEITED' : player.playerId === game.winnerId ? 'WINNER' : player.eliminated ? 'ELIMINATED' : 'SURVIVOR';
                  return (
                    <View key={player.playerId} accessible accessibilityLabel={`${player.displayName}${player.playerId === playerId ? ', you' : ''}. ${status}. ${player.victoryPoints} victory points.`} style={{ minHeight: 72, borderRadius: 14, borderWidth: 1, borderBottomWidth: 3, borderColor: player.playerId === game.winnerId ? `${TOKYO.lime}88` : TOKYO.border, backgroundColor: TOKYO.surface, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <MonsterAvatar seed={player.playerId} profileIndex={index} size={44} eliminated={player.eliminated} />
                      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                        <Text style={{ fontFamily: 'Outfit_700Bold', color: player.playerId === game.winnerId ? TOKYO.lime : TOKYO.text, fontSize: 16 }}>{player.displayName}{player.playerId === playerId ? ' (you)' : ''}</Text>
                        <Text style={{ fontFamily: 'SpaceMono_700Bold', color: status === 'WINNER' ? TOKYO.lime : status === 'FORFEITED' ? TOKYO.danger : TOKYO.muted, fontSize: 12 }}>{status} · {player.victoryPoints} VP</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    )}

    <KingOfTokyoReferenceSheet visible={showRules && !gameOver} onClose={() => setShowRules(false)} />
    </SafeAreaView>
  );
}
