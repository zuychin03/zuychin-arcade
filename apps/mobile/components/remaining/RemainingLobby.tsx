import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { RoomPublicState } from '@zuychin-arcade/types';
import { RoomCodeDisplay } from '../lobby/RoomCodeDisplay';
import { NeonButton } from '../ui/NeonButton';
import { TYPOGRAPHY } from '../../constants/typography';
import { ScalePressable } from '../ui/ScalePressable';
import { GameRecovery } from '../ui/GameRecovery';
import { getSocket } from '../../hooks/useSocket';
import { useWebBackGuard } from '../../hooks/useWebBackGuard';
import { useNativeLeaveGuard } from '../../hooks/useNativeLeaveGuard';
import { kickPlayer, leaveRoom } from '../../lib/api';
import { showDialog, useDialogStore, type DialogConfig } from '../../lib/dialog';
import { clearAuthIfMatches } from '../../lib/storage';
import { useGameStore } from '../../store/useGameStore';

interface Palette {
  bg: string;
  surface: string;
  panel: string;
  border: string;
  accent: string;
  secondary: string;
  muted: string;
  text: string;
  onAccent?: string;
  controlSurface?: string;
  danger?: string;
}

interface Props {
  base: string;
  gameName: string;
  minPlayers: number;
  mark: ReactNode;
  briefing: string;
  gameReady: boolean;
  renderRules: (visible: boolean, onClose: () => void) => ReactNode;
  palette: Palette;
  startPayload?: Record<string, unknown>;
  renderStartOptions?: (disabled: boolean) => ReactNode;
  seatRoleLabel?: (seat: RoomPublicState['players'][number]) => string;
}

const START_TIMEOUT_MS = 10_000;

export function RemainingLobby({ base, gameName, minPlayers, mark, briefing, gameReady, renderRules, palette, startPayload, renderStartOptions, seatRoleLabel }: Props) {
  const room = useGameStore((state) => state.room);
  const playerId = useGameStore((state) => state.playerId);
  const token = useGameStore((state) => state.token);
  const compact = useWindowDimensions().width < 560;
  const [rules, setRules] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [connection, setConnection] = useState<'connected' | 'reconnecting' | 'error'>('reconnecting');
  const [synced, setSynced] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const leavingRef = useRef(false);
  const startingRef = useRef(false);
  const removingRef = useRef<string | null>(null);
  const navigatingRef = useRef(false);
  const promptOpen = useRef(false);
  const ownedPrompt = useRef<DialogConfig | null>(null);
  const leaveNotified = useRef(false);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lifecycleIdentity = useRef(token);
  const nativeBack = useRef<(() => void) | null>(null);
  const isHost = room?.players.find((player) => player.playerId === playerId)?.isHost ?? false;
  const approveNavigation = useNativeLeaveGuard(token, () => {
    if (useGameStore.getState().token === token) nativeBack.current?.();
  });

  const dismissOwnPrompt = useCallback(() => {
    if (ownedPrompt.current && useDialogStore.getState().dialog === ownedPrompt.current) useDialogStore.getState().hide();
    ownedPrompt.current = null;
    promptOpen.current = false;
  }, []);

  const clearStartTimer = useCallback(() => {
    if (startTimer.current) clearTimeout(startTimer.current);
    startTimer.current = null;
  }, []);

  const finishStarting = useCallback(() => {
    clearStartTimer();
    startingRef.current = false;
    if (mounted.current) setStarting(false);
  }, [clearStartTimer]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearStartTimer(); dismissOwnPrompt(); };
  }, [clearStartTimer, dismissOwnPrompt]);

  useEffect(() => {
    const previous = lifecycleIdentity.current;
    lifecycleIdentity.current = token;
    if (token === null || previous === token) return;
    leavingRef.current = false;
    navigatingRef.current = false;
    leaveNotified.current = false;
    removingRef.current = null;
    setLeaving(false);
    setCleanupPending(false);
    setRemoving(null);
    setMessage(null);
    dismissOwnPrompt();
    finishStarting();
  }, [token, dismissOwnPrompt, finishStarting]);

  useEffect(() => {
    if (room?.status !== 'lobby' && room && gameReady && !leavingRef.current && !navigatingRef.current) {
      navigatingRef.current = true;
      dismissOwnPrompt();
      finishStarting();
      approveNavigation(() => router.replace((base + '/game') as never), () => {
        const current = useGameStore.getState();
        return current.token === token && current.room?.roomCode === room.roomCode && current.room.status !== 'lobby';
      });
    }
  }, [room, gameReady, base, finishStarting, dismissOwnPrompt, approveNavigation, token]);

  useEffect(() => {
    if (token !== null || useGameStore.getState().token !== null || navigatingRef.current) return;
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null);
  }, [token, approveNavigation]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    const bind = () => {
      if (cancelled) return;
      const socket = getSocket();
      if (!socket) { retry = setTimeout(bind, 100); return; }
      const ownsSession = () => !cancelled && mounted.current && useGameStore.getState().token === token && getSocket() === socket;
      const connected = () => {
        if (!ownsSession()) return;
        setConnection('connected');
        setSynced(false);
        socket.emit('request_state');
      };
      const disconnected = () => {
        if (!ownsSession()) return;
        finishStarting();
        setConnection('reconnecting');
        setSynced(false);
      };
      const failed = () => {
        if (!ownsSession()) return;
        disconnected();
        setConnection('error');
      };
      const rejected = (payload: unknown) => {
        if (!ownsSession() || !payload || typeof payload !== 'object' || Array.isArray(payload)
          || !('reason' in payload) || typeof payload.reason !== 'string' || !payload.reason) return;
        finishStarting();
        setMessage(payload.reason);
      };
      const updated = (current: unknown) => {
        if (!ownsSession() || !socket.connected || !current || typeof current !== 'object' || Array.isArray(current)
          || !('roomCode' in current) || current.roomCode !== useGameStore.getState().roomCode
          || !('status' in current) || typeof current.status !== 'string'
          || !['lobby', 'in_game', 'finished'].includes(current.status)) return;
        setConnection('connected');
        setSynced(true);
        if (current.status !== 'lobby' && startingRef.current) setMessage('Start confirmed. Loading your game…');
      };
      socket.on('connect', connected);
      socket.on('disconnect', disconnected);
      socket.on('connect_error', failed);
      socket.on('action_rejected', rejected);
      socket.on('room_updated', updated);
      if (socket.connected) connected();
      unsubscribe = () => {
        socket.off('connect', connected);
        socket.off('disconnect', disconnected);
        socket.off('connect_error', failed);
        socket.off('action_rejected', rejected);
        socket.off('room_updated', updated);
      };
    };
    bind();
    return () => { cancelled = true; if (retry) clearTimeout(retry); unsubscribe(); };
  }, [token, finishStarting]);

  const refresh = () => {
    const socket = getSocket();
    if (cleanupPending || leavingRef.current || useGameStore.getState().token !== token) return;
    setSynced(false);
    setMessage('Refreshing the room…');
    if (socket?.connected) socket.emit('request_state');
    else socket?.connect();
  };

  const start = () => {
    const socket = getSocket();
    const session = useGameStore.getState();
    const current = session.room;
    if (!mounted.current || session.token !== token || session.playerId !== playerId || current?.roomCode !== room?.roomCode) return;
    const seats = current?.players.filter((player) => !player.hasLeft) ?? [];
    if (startingRef.current || leavingRef.current || removingRef.current || promptOpen.current || cleanupPending) return;
    if (!socket?.connected || !synced) {
      setMessage('Reconnect and refresh the room before starting.');
      return;
    }
    if (current?.status !== 'lobby' || !seats.some((seat) => seat.playerId === playerId && seat.isHost)
      || seats.length < minPlayers || seats.some((player) => !player.isConnected)) return;
    startingRef.current = true;
    setStarting(true);
    setMessage(null);
    clearStartTimer();
    startTimer.current = setTimeout(() => {
      if (!mounted.current || useGameStore.getState().token !== token || getSocket() !== socket) return;
      finishStarting();
      setSynced(false);
      setMessage('The game did not finish loading. Refreshing the room before you try again…');
      socket.emit('request_state');
    }, START_TIMEOUT_MS);
    if (startPayload) socket.emit('start_game', startPayload);
    else socket.emit('start_game');
  };

  const leave = useCallback(async () => {
    const ownsSession = () => mounted.current && useGameStore.getState().token === token && useGameStore.getState().room?.roomCode === room?.roomCode;
    if (leavingRef.current || !ownsSession()) return;
    const socket = getSocket();
    leavingRef.current = true;
    setLeaving(true);
    finishStarting();
    if (!leaveNotified.current) {
      leaveNotified.current = true;
      try {
        if (room && token) await leaveRoom(room.roomCode, token);
      } catch (caught) {
        if (ownsSession()) showDialog('Room notification failed', (caught instanceof Error ? caught.message : 'The server could not be reached.') + ' Your local session will still be removed. The seat may stay reserved briefly.');
      }
    }
    if (!ownsSession()) return;
    socket?.disconnect();
    try {
      if (token) await clearAuthIfMatches(token);
    } catch (caught) {
      if (ownsSession()) {
        leavingRef.current = false;
        setLeaving(false);
        setCleanupPending(true);
        setMessage('Your saved session could not be cleared. Retry leaving before joining another room. ' + (caught instanceof Error ? caught.message : ''));
      }
      return;
    }
    if (!ownsSession()) return;
    navigatingRef.current = true;
    useGameStore.getState().clearAll();
    approveNavigation(() => router.replace('/'), () => useGameStore.getState().token === null, null);
  }, [room, token, finishStarting, approveNavigation]);

  const requestLeave = useCallback(() => {
    if (!mounted.current || leavingRef.current || promptOpen.current) return;
    if (startingRef.current) { setMessage('Waiting for the game to start. You can leave from the game once it loads.'); return; }
    if (cleanupPending) { void leave(); return; }
    promptOpen.current = true;
    showDialog('Leave room?', room?.status === 'lobby' ? 'Release your seat and return to the arcade?' : 'The game has started. Leaving may forfeit your character and affect the result. Return to the arcade?', [
      { text: 'STAY', style: 'cancel', onPress: dismissOwnPrompt },
      { text: 'LEAVE', style: 'destructive', onPress: () => {
        dismissOwnPrompt();
        if (room?.status === 'lobby' && useGameStore.getState().room?.status !== 'lobby') return;
        void leave();
      } },
    ]);
    ownedPrompt.current = useDialogStore.getState().dialog;
  }, [cleanupPending, leave, room?.status, dismissOwnPrompt]);

  const handleBack = useCallback(() => {
    if (rules) setRules(false);
    else requestLeave();
  }, [requestLeave, rules]);
  useLayoutEffect(() => { nativeBack.current = handleBack; }, [handleBack]);

  useWebBackGuard(base + '/lobby', handleBack, token !== null && !navigatingRef.current);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { handleBack(); return true; });
    return () => subscription.remove();
  }, [handleBack]);

  const removePlayer = (targetId: string) => {
    if (!room || !token || !isHost || !synced || cleanupPending || startingRef.current || leavingRef.current || removingRef.current || promptOpen.current) return;
    const target = room.players.find((player) => player.playerId === targetId);
    if (!target || target.isHost || target.hasLeft) return;
    promptOpen.current = true;
    showDialog('Remove player?', 'Remove ' + target.displayName + ' from the lobby?', [
      { text: 'CANCEL', style: 'cancel', onPress: dismissOwnPrompt },
      { text: 'REMOVE', style: 'destructive', onPress: () => {
        dismissOwnPrompt();
        const current = useGameStore.getState();
        if (!mounted.current || current.token !== token || current.room?.status !== 'lobby' || current.room.roomCode !== room.roomCode || removingRef.current || startingRef.current || leavingRef.current) return;
        removingRef.current = targetId;
        setRemoving(targetId);
        const ownsRemoval = () => mounted.current && useGameStore.getState().token === token
          && useGameStore.getState().room?.roomCode === room.roomCode && removingRef.current === targetId;
        void kickPlayer(room.roomCode, token, targetId).catch((caught: unknown) => {
          if (ownsRemoval()) setMessage(caught instanceof Error ? caught.message : 'The player could not be removed.');
        }).finally(() => {
          if (!ownsRemoval()) return;
          removingRef.current = null;
          setRemoving(null);
        });
      } },
    ]);
    ownedPrompt.current = useDialogStore.getState().dialog;
  };

  if (!room) return <GameRecovery message={'Finding your ' + gameName + ' room…'} background={palette.bg} surface={palette.surface} border={palette.border} accent={palette.accent} muted={palette.muted} solidTextColor={palette.onAccent} outlineBackgroundColor={palette.controlSurface} />;

  const seats = room.players.filter((player) => !player.hasLeft);
  const connectedCount = seats.filter((player) => player.isConnected).length;
  const reconnectingCount = seats.length - connectedCount;
  const canStart = connectedCount >= minPlayers && reconnectingCount === 0 && room.status === 'lobby';
  const locked = leaving || cleanupPending || starting || removing !== null;
  const connectionMessage = connection === 'error' ? 'Could not reconnect. Check your network and try again.' : connection !== 'connected' ? 'Reconnecting. Your seat stays reserved briefly.' : !synced ? 'Refreshing the room before actions are available…' : null;

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 720, alignSelf: 'center', padding: compact ? 14 : 20, gap: 14, paddingBottom: 36 }}>
        <RoomCodeDisplay roomCode={room.roomCode} hasPassword={room.hasPassword} gameName={gameName} palette={{ background: palette.bg, surface: palette.surface, border: palette.border, accent: palette.accent, secondary: palette.secondary, muted: palette.muted, text: palette.text, errorColor: palette.danger }} />
        {connectionMessage && !cleanupPending ? <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 14, padding: 14, gap: 10 }}>
          <Text accessibilityLiveRegion="polite" style={{ ...TYPOGRAPHY.body, color: palette.text }}>{connectionMessage}</Text>
          <NeonButton label="RETRY CONNECTION" color={palette.secondary} outlineBackgroundColor={palette.controlSurface} variant="outline" disabled={leaving} onPress={refresh} />
        </View> : null}
        {message ? <Text accessibilityRole="alert" style={{ ...TYPOGRAPHY.body, color: palette.text }}>{message}</Text> : null}
        <View style={{ alignItems: 'center' }}>{mark}<Text accessibilityRole="header" style={{ ...TYPOGRAPHY.display, color: palette.accent, fontSize: 20, lineHeight: 28, marginTop: 5, textAlign: 'center' }}>{gameName.toUpperCase()} TABLE</Text></View>
        <View style={{ borderRadius: 18, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, padding: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text accessibilityRole="header" style={{ ...TYPOGRAPHY.heading, color: palette.secondary }}>PLAYERS</Text>
            <Text accessibilityLabel={seats.length + ' of ' + room.maxPlayers + ' seats filled'} style={{ ...TYPOGRAPHY.data, color: palette.accent }}>{seats.length}/{room.maxPlayers}</Text>
          </View>
          {seats.map((player) => <View key={player.playerId} style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: palette.border + '66' }}>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text style={{ ...TYPOGRAPHY.heading, color: palette.text }}>{player.displayName}{player.playerId === playerId ? ' · YOU' : ''}</Text>
              <Text style={{ ...TYPOGRAPHY.label, color: player.isConnected ? palette.accent : palette.muted }}>{[seatRoleLabel?.(player), player.isHost ? 'HOST' : null, player.isConnected ? 'CONNECTED' : 'RECONNECTING · SEAT RESERVED'].filter(Boolean).join(' · ')}</Text>
            </View>
            {isHost && !player.isHost ? <ScalePressable accessibilityLabel={'Remove ' + player.displayName} disabled={locked || !synced || connection !== 'connected'} onPress={() => removePlayer(player.playerId)} style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center', opacity: locked || !synced ? 0.4 : 1 }}>
              <MaterialCommunityIcons name="account-remove-outline" size={22} color={palette.secondary} />
            </ScalePressable> : null}
          </View>)}
        </View>
        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.panel, padding: 14 }}>
          <Text accessibilityRole="header" style={{ ...TYPOGRAPHY.heading, color: palette.secondary }}>TABLE BRIEFING</Text>
          <Text style={{ ...TYPOGRAPHY.body, color: palette.muted, marginTop: 7 }}>{briefing}</Text>
        </View>
        {isHost ? <>
          {renderStartOptions?.(locked || !synced || connection !== 'connected' || room.status !== 'lobby')}
          <NeonButton label={starting ? 'STARTING…' : reconnectingCount ? 'WAITING FOR RECONNECTION' : canStart ? 'START GAME' : 'NEED ' + Math.max(0, minPlayers - connectedCount) + ' MORE CONNECTED'} color={palette.accent} solidTextColor={palette.onAccent} disabled={!canStart || locked || !synced || connection !== 'connected'} onPress={start} />
          {reconnectingCount > 0 ? <Text style={{ ...TYPOGRAPHY.body, color: palette.muted }}>Wait for disconnected players, or remove their reserved seats before starting.</Text> : null}
        </> : <Text style={{ ...TYPOGRAPHY.body, color: palette.muted, textAlign: 'center', padding: 15 }}>Waiting for the host to start…</Text>}
        <NeonButton label="HOW TO PLAY" color={palette.secondary} outlineBackgroundColor={palette.controlSurface} variant="outline" disabled={leaving} onPress={() => setRules(true)} />
        <NeonButton label={leaving ? 'LEAVING…' : cleanupPending ? 'RETRY LEAVING' : 'LEAVE ROOM'} color={palette.muted} variant="ghost" disabled={leaving || starting} onPress={requestLeave} />
      </ScrollView>
      {renderRules(rules, () => setRules(false))}
    </View>
  );
}
