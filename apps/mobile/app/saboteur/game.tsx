import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeIn, SlideInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ActionCard, BoardPosition, GameCard, PathCard, SaboteurActionKind, Tool } from '@zuychin-arcade/types';
import { useGameStore } from '../../store/useGameStore';
import { getSocket } from '../../hooks/useSocket';
import { clearAuthIfMatches } from '../../lib/storage';
import { leaveRoom } from '../../lib/api';
import { showDialog, useDialogStore, type DialogConfig } from '../../lib/dialog';
import { rotateEdges, validPlacements } from '../../lib/placement';
import { GameBoard } from '../../components/saboteur/board/GameBoard';
import { PlayerStatusBar } from '../../components/saboteur/board/PlayerStatusBar';
import { PathCardView } from '../../components/saboteur/cards/PathCardView';
import { ActionCardView, saboteurHandCardSize } from '../../components/saboteur/cards/ActionCardView';
import { HandCard } from '../../components/saboteur/cards/HandCard';
import { RoleRevealOverlay } from '../../components/saboteur/overlays/RoleRevealOverlay';
import { RoundEndOverlay } from '../../components/saboteur/overlays/RoundEndOverlay';
import { GoldPickOverlay } from '../../components/saboteur/overlays/GoldPickOverlay';
import { GameOverOverlay } from '../../components/saboteur/overlays/GameOverOverlay';
import { SaboteurReferenceSheet } from '../../components/saboteur/ReferenceSheet';
import { GameRecovery } from '../../components/ui/GameRecovery';
import { NeonButton } from '../../components/ui/NeonButton';
import { ARCADE, MINE, neonText } from '../../constants/theme';
import { useWebBackGuard } from '../../hooks/useWebBackGuard';
import { useNativeLeaveGuard } from '../../hooks/useNativeLeaveGuard';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { useSaboteurActions } from '../../components/saboteur/useSaboteurActions';
import { usePrivateMapNotice } from '../../components/saboteur/usePrivateMapNotice';

const SABOTAGE_TOOL: Partial<Record<ActionCard['subtype'], Tool>> = {
  sabotage_lantern: 'lantern',
  sabotage_cart: 'cart',
  sabotage_pickaxe: 'pickaxe',
};

const REPAIR_TOOLS: Partial<Record<ActionCard['subtype'], Tool[]>> = {
  repair_lantern: ['lantern'],
  repair_cart: ['cart'],
  repair_pickaxe: ['pickaxe'],
  repair_lantern_cart: ['lantern', 'cart'],
  repair_lantern_pickaxe: ['lantern', 'pickaxe'],
  repair_cart_pickaxe: ['cart', 'pickaxe'],
};

function describeCard(card: GameCard, rotated = false): string {
  if (card.type === 'action') {
    if (card.subtype === 'map') return 'Map: privately inspect a hidden goal and its path openings.';
    if (card.subtype === 'rockfall') return 'Rockfall: remove one tunnel card. Start and goal cards are protected.';
    if (card.subtype.startsWith('sabotage_')) return 'Break ' + card.subtype.slice(9) + ': stop that player placing paths until repaired.';
    return 'Repair ' + card.subtype.slice(7).replaceAll('_', ' or ') + ': fix one matching broken tool on yourself or another player.';
  }
  const openings = Object.entries(rotateEdges(card.edges, rotated))
    .filter(([edge, value]) => edge !== 'center' && value === 'open')
    .map(([edge]) => edge)
    .join(', ');
  return `${card.isDeadEnd ? 'dead-end ' : ''}path card, openings ${openings || 'none'}`;
}

function roleSeenKey(roomCode: string, playerId: string, round: number): string {
  return `za:saboteur:role-seen:${roomCode}:${playerId}:${round}`;
}

function mineLayout(width: number, height: number, fontScale: number) {
  const wide = width >= 960 && width / Math.max(1, fontScale) >= 800;
  return {
    wide,
    boardWidth: wide ? Math.min(440, Math.round((width - 48) * 0.4)) : undefined,
    boardHeight: wide ? undefined : Math.max(280, Math.min(730, height - 520)),
    scrollViewportHeight: wide ? Math.max(560, height - 160) : undefined,
  };
}

type ActionMessageScope = { token: string | null; roomCode: string | undefined; phase: string; revision: number };

function currentActionMessage(message: string | null, sent: ActionMessageScope | null, current: ActionMessageScope): string | null {
  return sent && sent.token === current.token && sent.roomCode === current.roomCode && sent.phase === current.phase
    && current.revision >= sent.revision && current.revision <= sent.revision + 1 ? message : null;
}

async function hasSeenRole(key: string): Promise<boolean> {
  if (Platform.OS === 'web' && typeof globalThis.sessionStorage !== 'undefined') {
    return globalThis.sessionStorage.getItem(key) === '1';
  }
  return (await AsyncStorage.getItem(key)) === '1';
}

async function markRoleSeen(key: string): Promise<void> {
  if (Platform.OS === 'web' && typeof globalThis.sessionStorage !== 'undefined') {
    globalThis.sessionStorage.setItem(key, '1');
    return;
  }
  await AsyncStorage.setItem(key, '1');
}

async function clearRoleSeen(roomCode: string, playerId: string): Promise<void> {
  const keys = [1, 2, 3].map((round) => roleSeenKey(roomCode, playerId, round));
  if (Platform.OS === 'web' && typeof globalThis.sessionStorage !== 'undefined') {
    for (const key of keys) globalThis.sessionStorage.removeItem(key);
    return;
  }
  await AsyncStorage.multiRemove(keys);
}

export default function GameScreen() {
  const actions = useSaboteurActions();
  const reduceMotion = useReducedMotionPreference();
  const { width: viewportWidth, height: viewportHeight, fontScale } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(viewportWidth);
  const publicState = useGameStore((s) => s.publicState);
  const privateState = useGameStore((s) => s.privateState);
  const playerId = useGameStore((s) => s.playerId);
  const room = useGameStore((s) => s.room);
  const token = useGameStore((s) => s.token);
  const selectedCardId = useGameStore((s) => s.selectedCardId);
  const rotated = useGameStore((s) => s.rotated);

  const [showRole, setShowRole] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [peekMessage, dismissPeek] = usePrivateMapNotice(privateState?.peekedGoals ?? [], publicState?.round ?? 0);
  const [actionMessage, setActionMessage] = useState('Select a card to see its legal targets.');
  const [actionMessageScope, setActionMessageScope] = useState<ActionMessageScope | null>(null);
  const pendingCardId = actions.pending ? selectedCardId : null;
  const [cleanupPending, setCleanupPending] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [handOffset, setHandOffset] = useState(0);
  const [handViewportWidth, setHandViewportWidth] = useState(0);
  const [handContentWidth, setHandContentWidth] = useState(0);
  const [handHeadingFontSize, setHandHeadingFontSize] = useState(12);
  const handHeadingRef = useRef<Text>(null);
  const handCardSize = saboteurHandCardSize(fontScale, handHeadingFontSize);
  const lastRoundRef = useRef(0);
  const lastGoldPickRef = useRef<number | null | undefined>(undefined);
  const roleKeyToAcknowledgeRef = useRef<string | null>(null);
  const clearedRoleHistoryRef = useRef(false);
  const roleHistoryClearPromiseRef = useRef<Promise<void> | null>(null);
  const handScrollRef = useRef<ScrollView>(null);
  const leavingRef = useRef(false);
  const leaveNotifiedRef = useRef(false);
  const leaveEpochRef = useRef(0);
  const leaveGameOver = publicState?.status === 'game_over';
  const leaveTerminalRevision = leaveGameOver ? publicState.revision : null;
  const mountedRef = useRef(true);
  const leavePromptOpenRef = useRef(false);
  const ownDialogRef = useRef<DialogConfig | null>(null);
  const decisionDialogRef = useRef<{ dialog: DialogConfig; valid: () => boolean } | null>(null);
  const lifecycleIdentity = useRef(token);
  const nativeBack = useRef<(() => void) | null>(null);
  const approveNavigation = useNativeLeaveGuard(token, () => {
    if (useGameStore.getState().token === token) nativeBack.current?.();
  });
  useEffect(() => {
    leaveEpochRef.current += 1;
    if (ownDialogRef.current && useDialogStore.getState().dialog === ownDialogRef.current) useDialogStore.getState().hide();
    ownDialogRef.current = null;
    leavePromptOpenRef.current = false;
  }, [leaveGameOver, leaveTerminalRevision, room?.roomCode, token]);
  const onRecoveryCleared = useCallback(() => {
    if (useGameStore.getState().token !== null) return;
    leavingRef.current = true;
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null, null);
  }, [approveNavigation]);

  useEffect(() => {
    const previous = lifecycleIdentity.current;
    lifecycleIdentity.current = token;
    if (token === null || previous === token) return;
    leavingRef.current = false;
    leaveNotifiedRef.current = false;
    leavePromptOpenRef.current = false;
    if (ownDialogRef.current && useDialogStore.getState().dialog === ownDialogRef.current) useDialogStore.getState().hide();
    if (decisionDialogRef.current && useDialogStore.getState().dialog === decisionDialogRef.current.dialog) useDialogStore.getState().hide();
    ownDialogRef.current = null;
    decisionDialogRef.current = null;
    lastRoundRef.current = 0;
    lastGoldPickRef.current = undefined;
    roleKeyToAcknowledgeRef.current = null;
    clearedRoleHistoryRef.current = false;
    roleHistoryClearPromiseRef.current = null;
    setLeaving(false);
    setCleanupPending(false);
    setShowRole(false);
    setShowRules(false);
    setActionMessage('Select a card to see its legal targets.');
    dismissPeek();
  }, [token, dismissPeek]);

  useEffect(() => {
    if (token !== null || useGameStore.getState().token !== null || leavingRef.current) return;
    leavingRef.current = true;
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null);
  }, [token, approveNavigation]);

  const isHost = room?.players.find((p) => p.playerId === playerId)?.isHost ?? false;
  const isMyTurn = publicState?.status === 'playing' && publicState.currentTurnPlayerId === playerId;
  const selectedCard = privateState?.hand.find((c) => c.id === selectedCardId) ?? null;
  const myPublicPlayer = publicState?.players.find((player) => player.playerId === playerId) ?? null;
  const canPlacePaths = (myPublicPlayer?.brokenTools.length ?? 0) === 0;
  const connectedPlayerIds = useMemo(
    () => new Set(room?.players.filter((player) => player.isConnected).map((player) => player.playerId) ?? []),
    [room?.players],
  );

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
        if (ownsSession()) showDialog('Room notification failed', `${error instanceof Error ? error.message : 'Unknown error'}. Your seat may stay reserved briefly.`);
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
    if (leavingRef.current || leavePromptOpenRef.current) return;
    if (cleanupPending) { void onLeave(); return; }
    const captured = useGameStore.getState().publicState;
    const ended = captured?.status === 'game_over';
    const revision = captured?.revision;
    const epoch = ++leaveEpochRef.current;
    const isCurrent = () => {
      const current = useGameStore.getState();
      return mountedRef.current && leavePromptOpenRef.current && epoch === leaveEpochRef.current
        && current.token === token && current.room?.roomCode === room?.roomCode
        && (current.publicState?.status === 'game_over') === ended
        && (!ended || current.publicState?.revision === revision);
    };
    leavePromptOpenRef.current = true;
    showDialog('Leave game?', ended ? 'Return to the arcade? This match has already ended.' : 'Leaving forfeits your seat immediately. You cannot play, receive more gold or win this match. It may end the match if too few players remain. A temporary disconnection keeps your seat only during the reconnect grace period.', [
      { text: 'STAY', style: 'cancel', onPress: () => { if (isCurrent()) leavePromptOpenRef.current = false; } },
      { text: 'LEAVE', style: 'destructive', onPress: () => { if (!isCurrent()) return; leavePromptOpenRef.current = false; void onLeave(); } },
    ]);
    ownDialogRef.current = useDialogStore.getState().dialog;
  }, [cleanupPending, onLeave, room?.roomCode, token]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (ownDialogRef.current && useDialogStore.getState().dialog === ownDialogRef.current) useDialogStore.getState().hide();
      if (decisionDialogRef.current && useDialogStore.getState().dialog === decisionDialogRef.current.dialog) useDialogStore.getState().hide();
    };
  }, []);

  useEffect(() => {
    const decision = decisionDialogRef.current;
    if (decision && !decision.valid()) {
      if (useDialogStore.getState().dialog === decision.dialog) useDialogStore.getState().hide();
      decisionDialogRef.current = null;
    }
  }, [publicState, privateState, selectedCardId]);

  const handleBack = useCallback(() => {
    if (showRules) {
      setShowRules(false);
      return;
    }
    if (showRole) {
      setShowRole(false);
      return;
    }
    if (peekMessage) {
      dismissPeek();
      return;
    }
    onRequestLeave();
  }, [dismissPeek, onRequestLeave, peekMessage, showRole, showRules]);
  useLayoutEffect(() => { nativeBack.current = handleBack; }, [handleBack]);

  useWebBackGuard('/saboteur/game', handleBack, token !== null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]);


  const roleStatus = publicState?.status;
  const roleRound = publicState?.round;
  const roleRoomCode = publicState?.roomCode;
  const rolePlayerId = privateState?.playerId;
  const rolePeekCount = privateState?.peekedGoals.length;
  const roleChosenGold = privateState?.chosenGoldCard;

  useEffect(() => {
    if (roleRound === undefined || roleRoomCode === undefined || rolePlayerId === undefined || rolePeekCount === undefined) return;
    if (roleStatus === 'playing' && roleRound !== lastRoundRef.current) {
      lastRoundRef.current = roleRound;
      lastGoldPickRef.current = roleChosenGold;
      if (roleRound === 1) clearedRoleHistoryRef.current = false;
      useGameStore.getState().setSelectedCard(null);
      setActionMessage('New round. The board has returned to the start of the mine.');
      const key = roleSeenKey(roleRoomCode, rolePlayerId, roleRound);
      const stillPlaying = () => {
        const current = useGameStore.getState();
        return mountedRef.current && current.token === token && current.publicState?.status === 'playing'
          && current.publicState.roomCode === roleRoomCode && current.privateState?.playerId === rolePlayerId && current.publicState.round === roleRound;
      };
      void (async () => {
        try {
          await roleHistoryClearPromiseRef.current;
          const seen = await hasSeenRole(key);
          if (seen || !stillPlaying()) return;
          roleKeyToAcknowledgeRef.current = key;
          setShowRole(true);
        } catch {
          if (!stillPlaying()) return;
          roleKeyToAcknowledgeRef.current = key;
          setShowRole(true);
        }
      })();
    }
  }, [roleChosenGold, rolePeekCount, rolePlayerId, roleRoomCode, roleRound, roleStatus, token]);

  useEffect(() => {
    if (roleRoomCode === undefined || rolePlayerId === undefined || roleStatus !== 'game_over' || clearedRoleHistoryRef.current) return;
    clearedRoleHistoryRef.current = true;
    const clearPromise = clearRoleSeen(roleRoomCode, rolePlayerId).catch(() => undefined);
    roleHistoryClearPromiseRef.current = clearPromise;
    void clearPromise.finally(() => {
      if (roleHistoryClearPromiseRef.current === clearPromise) roleHistoryClearPromiseRef.current = null;
    });
  }, [rolePlayerId, roleRoomCode, roleStatus]);

  const myGoldPickValue = privateState?.chosenGoldCard ?? null;
  useEffect(() => {
    if (lastGoldPickRef.current === undefined) {
      lastGoldPickRef.current = myGoldPickValue;
      return;
    }
    if (myGoldPickValue !== null && myGoldPickValue !== lastGoldPickRef.current) {
      setActionMessage(`Gold collected: ${myGoldPickValue}. Your private total is updated.`);
    }
    lastGoldPickRef.current = myGoldPickValue;
  }, [myGoldPickValue]);

  const dismissRole = () => {
    setShowRole(false);
    const key = roleKeyToAcknowledgeRef.current;
    roleKeyToAcknowledgeRef.current = null;
    if (key) void markRoleSeen(key).catch(() => undefined);
  };

  const unrevealedGoals = useMemo(
    () => (publicState ? publicState.goals.filter((g) => !g.revealed).map((g) => g.position) : []),
    [publicState],
  );

  const validTargets = useMemo(() => {
    if (!publicState || !selectedCard || selectedCard.type !== 'path' || !isMyTurn || !canPlacePaths) return new Set<string>();
    return validPlacements(publicState.board, unrevealedGoals, selectedCard as PathCard, rotated);
  }, [publicState, selectedCard, rotated, isMyTurn, unrevealedGoals, canPlacePaths]);

  const actionTargets = useMemo(() => {
    const targets = new Set<string>();
    if (!publicState || !selectedCard || selectedCard.type !== 'action' || !isMyTurn) return targets;
    if (selectedCard.subtype === 'map') {
      for (const goal of unrevealedGoals) targets.add(`${goal.row},${goal.col}`);
    } else if (selectedCard.subtype === 'rockfall') {
      for (const p of publicState.board) {
        if (p.card.subtype === 'tunnel') targets.add(`${p.position.row},${p.position.col}`);
      }
    }
    return targets;
  }, [publicState, selectedCard, isMyTurn, unrevealedGoals]);

  const needsPlayerTarget =
    isMyTurn &&
    selectedCard?.type === 'action' &&
    (selectedCard.subtype.startsWith('sabotage_') || selectedCard.subtype.startsWith('repair_'));

  const eligiblePlayerIds = useMemo(() => {
    const eligible = new Set<string>();
    if (!publicState || !selectedCard || selectedCard.type !== 'action' || !needsPlayerTarget) return eligible;
    const sabotageTool = SABOTAGE_TOOL[selectedCard.subtype];
    const repairTools = REPAIR_TOOLS[selectedCard.subtype];
    for (const player of publicState.players) {
      if (player.forfeited) continue;
      if (sabotageTool && player.playerId !== playerId && !player.brokenTools.includes(sabotageTool)) {
        eligible.add(player.playerId);
      }
      if (repairTools?.some((tool) => player.brokenTools.includes(tool))) eligible.add(player.playerId);
    }
    return eligible;
  }, [needsPlayerTarget, playerId, publicState, selectedCard]);

  const boardInteractionActive = Boolean(
    isMyTurn &&
      !actions.busy && !leaving && !cleanupPending &&
      selectedCard &&
      ((selectedCard.type === 'path' && canPlacePaths) ||
        (selectedCard.type === 'action' && (selectedCard.subtype === 'map' || selectedCard.subtype === 'rockfall'))),
  );

  useEffect(() => {
    if (!selectedCard || !isMyTurn || pendingCardId) return;
    if (selectedCard.type === 'path') {
      if (!canPlacePaths) {
        setActionMessage(`Repair your ${myPublicPlayer?.brokenTools.join(' and ')} before placing a path.`);
      } else if (validTargets.size === 0) {
        setActionMessage('No legal space in this orientation. Rotate the card or discard it.');
      } else {
        setActionMessage(`Choose one of ${validTargets.size} cyan legal space${validTargets.size === 1 ? '' : 's'}.`);
      }
      return;
    }
    if (selectedCard.subtype === 'map') {
      setActionMessage(actionTargets.size > 0 ? 'Choose any cyan hidden goal, including one you already mapped. Its result stays private until revealed.' : 'No hidden goals remain. Discard this Map card.');
      return;
    }
    if (selectedCard.subtype === 'rockfall') {
      setActionMessage(actionTargets.size > 0 ? 'Choose a red tunnel card to remove.' : 'There are no removable tunnel cards yet.');
      return;
    }
    setActionMessage(eligiblePlayerIds.size > 0 ? `Choose one of ${eligiblePlayerIds.size} outlined eligible player${eligiblePlayerIds.size === 1 ? '' : 's'}.` : 'No player is eligible. Discard this card or choose another.');
  }, [actionTargets.size, canPlacePaths, eligiblePlayerIds, isMyTurn, myPublicPlayer?.brokenTools, pendingCardId, selectedCard, validTargets.size]);

  useEffect(() => {
    if (!selectedCardId || !privateState) return;
    const stillHeld = privateState.hand.some((card) => card.id === selectedCardId);
    if (!stillHeld) {
      useGameStore.getState().setSelectedCard(null);
      setActionMessage('Move accepted.');
    }
  }, [privateState, selectedCardId]);

  useEffect(() => {
    if (isMyTurn || !selectedCardId) return;
    useGameStore.getState().setSelectedCard(null);
    setActionMessage(pendingCardId ? 'Move accepted.' : 'Turn changed. Your selection was cleared.');
  }, [isMyTurn, pendingCardId, selectedCardId]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !selectedCardId || !isMyTurn) return;
    const timer = setTimeout(() => {
      const target = document.querySelector<HTMLElement>('#saboteur-board [role="button"][aria-label*="Legal target."], #saboteur-players [role="button"][aria-label*="Eligible target."]');
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedCardId, rotated, isMyTurn]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isMyTurn || showRole) return;
    const timer = setTimeout(() => document.getElementById('saboteur-turn')?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(timer);
  }, [isMyTurn, showRole]);

  if (!publicState || !privateState) {
    return <GameRecovery onSessionCleared={onRecoveryCleared} message="Reconnecting to the mine..." background={ARCADE.bg} surface={ARCADE.surface} border={ARCADE.border} accent={MINE.gold} muted={ARCADE.muted} icon="pickaxe" />;
  }

  const layout = mineLayout(Math.min(contentWidth, viewportWidth), viewportHeight, fontScale);
  const currentMessageScope: ActionMessageScope = {
    token,
    roomCode: room?.roomCode,
    phase: `${publicState.round}:${publicState.status}:${publicState.goldDistribution?.currentPickerId ?? ''}`,
    revision: publicState.revision,
  };
  const controllerMessage = currentActionMessage(actions.message, actionMessageScope, currentMessageScope);
  const sendAction = (event: SaboteurActionKind, payload: Record<string, unknown>, label: string, revision = publicState.revision) => {
    const sent = actions.send(event, payload, label, revision);
    if (sent) setActionMessageScope({ ...currentMessageScope, revision });
    return sent;
  };

  const emitCardAction = (event: SaboteurActionKind, payload: Record<string, unknown>) => {
    if (!selectedCard) return;
    if (!sendAction(event, payload, 'Move')) setActionMessage('Wait for your current turn and a refreshed hand before sending this move.');
  };

  const onCellPress = (pos: BoardPosition) => {
    if (!selectedCard) {
      setActionMessage('Select a card first. Legal board targets will light up.');
      return;
    }
    if (!isMyTurn) {
      setActionMessage('Wait for your turn before playing a card.');
      return;
    }
    if (actions.busy || leaving || cleanupPending) return;
    const k = `${pos.row},${pos.col}`;
    if (selectedCard.type === 'path' && validTargets.has(k)) {
      emitCardAction('place_card', { cardId: selectedCard.id, position: pos, rotated });
    } else if (selectedCard.type === 'action' && actionTargets.has(k)) {
      emitCardAction('play_action', { cardId: selectedCard.id, targetPosition: pos });
    } else if (selectedCard.type === 'path') {
      setActionMessage('That space is not legal for this path. Match every touching edge and keep a route to the start.');
    } else {
      setActionMessage(selectedCard.subtype === 'map' ? 'Choose a cyan hidden goal.' : 'Choose a red removable tunnel card.');
    }
  };

  const onPlayerSelect = (targetPlayerId: string) => {
    if (!selectedCard || selectedCard.type !== 'action' || actions.busy || leaving || cleanupPending) return;
    if (!eligiblePlayerIds.has(targetPlayerId)) {
      setActionMessage('That player is not eligible for this card. Choose an outlined player.');
      return;
    }
    const sub = selectedCard.subtype;
    const target = publicState.players.find((player) => player.playerId === targetPlayerId);
    const repairTools = REPAIR_TOOLS[sub] ?? [];
    const repairChoices = repairTools.filter((tool) => target?.brokenTools.includes(tool));
    if (repairTools.length === 2 && repairChoices.length > 1) {
      const valid = () => {
        const state = useGameStore.getState();
        const currentTarget = state.publicState?.players.find((player) => player.playerId === targetPlayerId);
        return mountedRef.current && state.token === token && state.selectedCardId === selectedCard.id && state.publicState?.status === 'playing'
          && state.publicState.round === publicState.round && state.publicState.currentTurnPlayerId === playerId && state.privateState?.hand.some((card) => card.id === selectedCard.id) === true
          && !currentTarget?.forfeited && repairChoices.every((tool) => currentTarget?.brokenTools.includes(tool));
      };
      showDialog('Repair which tool?', undefined, [
        ...repairChoices.map((tool) => ({
          text: tool.toUpperCase(),
          onPress: () => { if (valid()) sendAction('play_action', { cardId: selectedCard.id, targetPlayerId, chosenTool: tool }, 'Repair', useGameStore.getState().publicState!.revision); },
        })),
        { text: 'CANCEL', style: 'cancel' as const },
      ]);
      const dialog = useDialogStore.getState().dialog;
      if (dialog) decisionDialogRef.current = { dialog, valid };
      return;
    }
    emitCardAction('play_action', {
      cardId: selectedCard.id,
      targetPlayerId,
      ...(repairTools.length === 2 ? { chosenTool: repairChoices[0] } : {}),
    });
  };

  const onPass = () => {
    if (actions.busy || leaving || cleanupPending || !isMyTurn) return;
    if (privateState.hand.length === 0) {
      sendAction('pass_turn', {}, 'Pass');
      return;
    }
    if (!selectedCard) {
      setActionMessage('Select the card you want to discard, then choose Pass.');
      return;
    }
    const valid = () => {
      const state = useGameStore.getState();
      return mountedRef.current && state.token === token && state.selectedCardId === selectedCard.id && state.publicState?.status === 'playing'
        && state.publicState.round === publicState.round && state.publicState.currentTurnPlayerId === playerId && state.privateState?.hand.some((card) => card.id === selectedCard.id) === true;
    };
    showDialog('Pass turn', publicState.deckSize > 0 ? 'Discard the selected card, draw a replacement and pass?' : 'The deck is empty. Discard the selected card and pass without drawing?', [
      { text: 'CANCEL', style: 'cancel' },
      {
        text: 'PASS',
        onPress: () => { if (valid()) sendAction('pass_turn', { discardCardId: selectedCard.id }, 'Pass', useGameStore.getState().publicState!.revision); },
      },
    ]);
    const dialog = useDialogStore.getState().dialog;
    if (dialog) decisionDialogRef.current = { dialog, valid };
  };

  const onCardPress = (card: GameCard) => {
    if (!isMyTurn || actions.busy || leaving || cleanupPending) return;
    const isSelected = card.id === selectedCardId;
    useGameStore.getState().setSelectedCard(isSelected ? null : card.id);
    if (isSelected) {
      setActionMessage('Card deselected. Choose another card.');
      return;
    }
    if (card.type === 'path') {
      setActionMessage(
        canPlacePaths
          ? 'Choose a cyan space. Rotate if this orientation has no legal target.'
          : `Repair your ${myPublicPlayer?.brokenTools.join(' and ')} before placing a path.`,
      );
    } else if (card.subtype === 'map') {
      setActionMessage('Choose any cyan hidden goal, including one you already mapped. Its result stays private until revealed.');
    } else if (card.subtype === 'rockfall') {
      setActionMessage('Choose a red tunnel card to remove. Start and goal cards are protected.');
    } else {
      const sabotageTool = SABOTAGE_TOOL[card.subtype];
      const repairTools = REPAIR_TOOLS[card.subtype];
      const toolTargets = publicState.players.filter((candidate) => {
        if (candidate.forfeited) return false;
        if (sabotageTool) return candidate.playerId !== playerId && !candidate.brokenTools.includes(sabotageTool);
        return repairTools?.some((tool) => candidate.brokenTools.includes(tool)) ?? false;
      }).length;
      setActionMessage(toolTargets > 0 ? `Choose one of ${toolTargets} outlined eligible player${toolTargets === 1 ? '' : 's'}.` : 'No player is eligible. Discard this card or select another.');
    }
  };

  const scrollHand = (direction: -1 | 1) => {
    const page = Math.max(180, handViewportWidth - 24);
    handScrollRef.current?.scrollTo({ x: Math.max(0, handOffset + direction * page), animated: !reduceMotion });
  };

  const onPlayAgain = () => sendAction('start_game', {}, 'Starting a fresh match');

  const myGoldPick =
    publicState.status === 'round_end' &&
    publicState.goldDistribution?.currentPickerId === playerId;

  const canScrollLeft = handOffset > 4;
  const canScrollRight = handOffset + handViewportWidth < handContentWidth - 4;
  const currentPlayerName = publicState.players.find((player) => player.isCurrentTurn)?.displayName ?? 'the next player';
  const retainedSeats = room?.players.filter((player) => !player.hasLeft) ?? [];
  const canRematch = retainedSeats.length >= 3 && retainedSeats.every((player) => player.isConnected);
  const overlayOpen = showRole || showRules || publicState.status !== 'playing';
  const controlsBusy = actions.busy || leaving || cleanupPending;
  const cancelSelection = () => {
    const cardId = selectedCardId;
    useGameStore.getState().setSelectedCard(null);
    setActionMessage('Selection cancelled. Choose a card to see its legal targets.');
    if (Platform.OS === 'web' && cardId) setTimeout(() => document.getElementById('saboteur-hand-' + cardId)?.focus(), 0);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: ARCADE.bg }} edges={['top', 'bottom']}
      onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
      <ScrollView accessibilityElementsHidden={overlayOpen} importantForAccessibility={overlayOpen ? 'no-hide-descendants' : 'auto'} aria-hidden={overlayOpen}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 8 }}>
      <View style={{ minHeight: 56, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 }}>
        <Text style={{ fontFamily: 'Outfit_800ExtraBold', letterSpacing: 1, ...neonText(ARCADE.cyan, 8) }}>
          ROUND {publicState.round}/3
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View accessible accessibilityLabel={`Draw deck: ${publicState.deckSize} cards`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialCommunityIcons name="cards-playing-outline" size={13} color={ARCADE.muted} />
            <Text style={{ fontFamily: 'SpaceMono_700Bold', color: ARCADE.muted, fontSize: 12 }}>{publicState.deckSize}</Text>
          </View>
          <View accessible accessibilityLabel={`Discard pile: ${publicState.discardSize} cards`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialCommunityIcons name="delete-outline" size={13} color={ARCADE.muted} />
            <Text style={{ fontFamily: 'SpaceMono_700Bold', color: ARCADE.muted, fontSize: 12 }}>{publicState.discardSize}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leave game"
            accessibilityHint="Opens a confirmation before leaving the live match"
            onPress={onRequestLeave}
            style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: `${ARCADE.red}66`, alignItems: 'center', justifyContent: 'center' }}
          >
            <MaterialCommunityIcons name="exit-to-app" size={19} color={ARCADE.red} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open rulebook"
            onPress={() => setShowRules(true)}
            style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: ARCADE.border, alignItems: 'center', justifyContent: 'center' }}
          >
            <MaterialCommunityIcons name="book-open-variant" size={18} color={ARCADE.cyan} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reveal my secret role"
            accessibilityHint="Keep your screen private before revealing"
            onPress={() => setShowRole(true)}
            style={{ minWidth: 62, height: 48, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: ARCADE.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}
          >
            <MaterialCommunityIcons name="eye-off-outline" size={16} color={ARCADE.muted} />
            <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: ARCADE.muted, fontSize: 12, letterSpacing: 1 }}>ROLE</Text>
          </Pressable>
        </View>
      </View>

      {(!actions.connected || !actions.synced || cleanupPending) && (
        <View
          accessibilityRole="alert"
          style={{ minHeight: 36, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: `${ARCADE.red}18`, borderBottomWidth: 1, borderBottomColor: `${ARCADE.red}66` }}
        >
          <MaterialCommunityIcons name="connection" size={16} color={ARCADE.red} />
          <Text accessibilityLiveRegion="assertive" style={{ flex: 1, fontFamily: 'SpaceMono_700Bold', color: ARCADE.red, fontSize: 12 }}>
            {cleanupPending ? actionMessage : !actions.connected ? 'Reconnecting. Your controls return after your private hand refreshes.' : 'Refreshing the mine…'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry connection"
            onPress={() => { if (cleanupPending) onRequestLeave(); else if (getSocket()?.connected) actions.refresh(); else getSocket()?.connect(); }}
            style={{ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: ARCADE.cyan, fontSize: 12 }}>RETRY</Text>
          </Pressable>
        </View>
      )}

      <View nativeID="saboteur-workspace" style={{ flexDirection: layout.wide ? 'row' : 'column', alignItems: layout.wide ? 'flex-start' : 'stretch', gap: layout.wide ? 16 : 0, paddingHorizontal: layout.wide ? 16 : 0 }}>
      <View nativeID="saboteur-mine-column" style={{ width: layout.boardWidth, height: layout.boardHeight, flexShrink: 0 }}>
        <GameBoard
          board={publicState.board}
          goals={publicState.goals}
          validTargets={validTargets}
          actionTargets={actionTargets}
          peekedGoals={privateState.peekedGoals}
          round={publicState.round}
          interactionActive={boardInteractionActive}
          availableWidth={layout.boardWidth ?? Math.min(contentWidth, viewportWidth)}
          scrollViewportHeight={layout.scrollViewportHeight}
          onCellPress={onCellPress}
        />
      </View>

      <View nativeID="saboteur-decision-column" style={{ flex: layout.wide ? 1 : undefined, minWidth: 0 }}>
      <View style={{ flexShrink: 0 }}>
        {needsPlayerTarget && (
          <Animated.Text
            entering={reduceMotion ? undefined : FadeIn}
            accessibilityLiveRegion="polite"
            style={{ fontFamily: 'Outfit_700Bold', paddingVertical: 5, textAlign: 'center', fontSize: 13, ...neonText(eligiblePlayerIds.size > 0 ? ARCADE.pink : ARCADE.red, 6) }}
          >
            {eligiblePlayerIds.size > 0 ? `Choose an outlined player (${eligiblePlayerIds.size} eligible)` : 'No eligible players for this card'}
          </Animated.Text>
        )}
        <PlayerStatusBar
          players={publicState.players}
          presencePlayers={room?.players ?? null}
          myPlayerId={playerId}
          myGoldCollected={privateState.goldCollected}
          targeting={Boolean(needsPlayerTarget && !controlsBusy)}
          eligiblePlayerIds={eligiblePlayerIds}
          onSelect={onPlayerSelect}
        />
      </View>

      <View nativeID="saboteur-hand-controls" style={{ flexShrink: 0, paddingHorizontal: 8, paddingTop: 5, paddingBottom: 4, backgroundColor: ARCADE.bg }}>
        <View style={{ minHeight: 52, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 }}>
          <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0, paddingRight: 6 }}>
            <Text nativeID="saboteur-turn" {...(Platform.OS === 'web' ? { tabIndex: -1 } : {})} accessibilityLiveRegion="polite" style={{ fontFamily: 'Outfit_700Bold', color: isMyTurn ? ARCADE.cyan : ARCADE.muted, fontSize: 15 }}>
              {isMyTurn ? 'YOUR TURN' : `WAITING FOR ${currentPlayerName.toUpperCase()}`}
            </Text>
            <View style={{ marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialCommunityIcons name="gesture-swipe-horizontal" size={13} color={ARCADE.muted} />
              <Text ref={handHeadingRef} nativeID="saboteur-hand-heading" onLayout={() => {
                if (Platform.OS !== 'web' || !handHeadingRef.current || typeof window === 'undefined') return;
                const size = Number.parseFloat(window.getComputedStyle(handHeadingRef.current as unknown as Element).fontSize);
                if (Number.isFinite(size) && size > 0) setHandHeadingFontSize(size);
              }} style={{ flex: 1, minWidth: 0, fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, fontSize: 12 }}>
                HAND · {privateState.hand.length} {privateState.hand.length === 1 ? 'CARD' : 'CARDS'} · SCROLL
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
            {selectedCard?.type === 'path' && (
              <NeonButton
                label="ROTATE"
                color={ARCADE.purple}
                variant="outline"
                icon={<MaterialCommunityIcons name="sync" size={14} color={ARCADE.purple} />}
                disabled={!isMyTurn || controlsBusy}
                onPress={() => {
                  useGameStore.getState().toggleRotated();
                  setActionMessage('Card rotated 180°. Cyan spaces are legal in this orientation.');
                }}
              />
            )}
            <NeonButton
              label="PASS"
              color={ARCADE.pink}
              variant={isMyTurn ? 'solid' : 'outline'}
              disabled={!isMyTurn || controlsBusy}
              icon={<MaterialCommunityIcons name="skip-forward" size={14} color={isMyTurn ? ARCADE.bg : ARCADE.muted} />}
              onPress={onPass}
            />
          </View>
        </View>
        <View
          accessibilityLiveRegion="polite"
          style={{ minHeight: 32, marginHorizontal: 2, marginBottom: 2, borderRadius: 9, backgroundColor: `${ARCADE.cyan}0D`, paddingHorizontal: 9, paddingVertical: 5, justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: 'Outfit_400Regular', color: pendingCardId ? ARCADE.cyan : ARCADE.text, fontSize: 14, lineHeight: 20 }}>
            {controllerMessage ?? actionMessage}
          </Text>
        </View>
        {selectedCard && <View style={{ paddingHorizontal: 4, paddingVertical: 8, gap: 8 }}>
          <Text style={{ color: ARCADE.text, fontSize: 15, lineHeight: 21 }}>{describeCard(selectedCard, rotated)}{selectedCard.type === 'path' && rotated ? ' · rotated 180°' : ''}</Text>
          <NeonButton label="CANCEL SELECTION" color={ARCADE.cyan} variant="outline" disabled={controlsBusy} onPress={cancelSelection} />
        </View>}
        <View style={{ minHeight: 140, flexDirection: 'row', alignItems: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scroll hand left"
            accessibilityState={{ disabled: !canScrollLeft }}
            disabled={!canScrollLeft}
            onPress={() => scrollHand(-1)}
            style={{ width: 48, height: 96, alignItems: 'center', justifyContent: 'center', opacity: canScrollLeft ? 1 : 0.25 }}
          >
            <MaterialCommunityIcons name="chevron-left" size={24} color={ARCADE.cyan} />
          </Pressable>
          <ScrollView
            ref={handScrollRef}
            horizontal
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 6, paddingHorizontal: 3, alignItems: 'stretch' }}
            showsHorizontalScrollIndicator
            scrollEventThrottle={16}
            onLayout={(event) => setHandViewportWidth(event.nativeEvent.layout.width)}
            onContentSizeChange={(width) => setHandContentWidth(width)}
            onScroll={(event) => setHandOffset(event.nativeEvent.contentOffset.x)}
          >
            {privateState.hand.map((card) => {
              const selected = card.id === selectedCardId;
              return (
                <HandCard
                  key={card.id}
                  selected={selected}
                  nativeID={'saboteur-hand-' + card.id}
                  disabled={!isMyTurn || controlsBusy}
                  accessibilityLabel={`${selected ? 'Selected ' : ''}${describeCard(card, selected && rotated)}`}
                  onPress={() => onCardPress(card)}
                >
                  {card.type === 'path' ? (
                    <PathCardView card={card} rotated={selected && rotated} {...handCardSize} fill />
                  ) : (
                    <ActionCardView card={card} {...handCardSize} fill />
                  )}
                </HandCard>
              );
            })}
            {privateState.hand.length === 0 && (
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, paddingHorizontal: 16 }}>No cards left this round</Text>
            )}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scroll hand right"
            accessibilityHint="Shows later cards, including the sixth card"
            accessibilityState={{ disabled: !canScrollRight }}
            disabled={!canScrollRight}
            onPress={() => scrollHand(1)}
            style={{ width: 48, height: 96, alignItems: 'center', justifyContent: 'center', opacity: canScrollRight ? 1 : 0.25 }}
          >
            <MaterialCommunityIcons name="chevron-right" size={24} color={ARCADE.cyan} />
          </Pressable>
        </View>
      </View>
      </View>
      </View>
      </ScrollView>

      {peekMessage && (
        <Animated.View
          entering={reduceMotion ? undefined : SlideInUp.duration(180)}
          style={{
            position: 'absolute',
            left: 32,
            right: 32,
            top: 96,
            zIndex: 40,
            alignItems: 'center',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: ARCADE.border,
            backgroundColor: 'rgba(0, 0, 0, 0.95)',
            padding: 16,
            boxShadow: `0 0 16px ${ARCADE.purple}66`,
          }}
        >
          <Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 17, ...neonText('#F5C518', 10) }}>{peekMessage}</Text>
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, fontSize: 12, marginTop: 4 }}>Private result saved in your map strip</Text>
        </Animated.View>
      )}

      {showRole && !showRules && publicState.status === 'playing' && (
        <RoleRevealOverlay role={privateState.role} round={publicState.round} onDismiss={dismissRole} />
      )}
      {publicState.status === 'round_end' && !myGoldPick && !showRules && (
        <RoundEndOverlay
          state={publicState}
          myPlayerId={playerId}
          myGoldCollected={privateState.goldCollected}
          onLeave={onRequestLeave}
        />
      )}
      {myGoldPick && publicState.goldDistribution && !showRules && (
        <GoldPickOverlay
          values={privateState.availableGoldCards}
          busy={controlsBusy}
          message={controllerMessage}
          onRefresh={actions.refresh}
          onPick={(cardIndex) => sendAction('choose_gold', { cardIndex }, 'Gold choice')}
          onLeave={onRequestLeave}
        />
      )}
      {publicState.status === 'game_over' && !showRules && (
        <GameOverOverlay
          state={publicState}
          isHost={isHost}
          canRematch={canRematch}
          busy={controlsBusy}
          connectedCount={connectedPlayerIds.size}
          message={controllerMessage}
          onPlayAgain={() => void onPlayAgain()}
          onLeave={() => void onLeave()}
        />
      )}
      <SaboteurReferenceSheet visible={showRules} onClose={() => setShowRules(false)} />
    </SafeAreaView>
  );
}
