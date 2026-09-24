import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { router } from 'expo-router';
import { useGameStore } from '../../store/useGameStore';
import { useNativeLeaveGuard } from '../../hooks/useNativeLeaveGuard';
import { useWebBackGuard } from '../../hooks/useWebBackGuard';
import { getSocket } from '../../hooks/useSocket';
import { leaveRoom } from '../../lib/api';
import { clearAuthIfMatches } from '../../lib/storage';
import { showDialog, useDialogStore, type DialogConfig } from '../../lib/dialog';

export function useCartographersLeave(dismissOverlay: () => boolean) {
  const token = useGameStore(state => state.token);
  const status = useGameStore(state => state.cartographersPublic?.status);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const notified = useRef(false);
  const mounted = useRef(true);
  const prompt = useRef<DialogConfig | null>(null);
  const handleBack = useRef<() => void>(() => {});
  const approve = useNativeLeaveGuard(token, () => handleBack.current());
  const dismissPrompt = useCallback(() => {
    if (prompt.current && useDialogStore.getState().dialog === prompt.current) useDialogStore.getState().hide();
    prompt.current = null;
  }, []);
  useEffect(() => {
    mounted.current = true; busy.current = false; notified.current = false;
    setLeaving(false); setError(null);
    return () => { mounted.current = false; dismissPrompt(); };
  }, [token, dismissPrompt]);
  useEffect(dismissPrompt, [status, dismissPrompt]);
  useEffect(() => {
    if (token === null) approve(() => router.replace('/'), () => mounted.current && useGameStore.getState().token === null, null);
  }, [token, approve]);

  const leave = async () => {
    const current = useGameStore.getState();
    const roomCode = current.roomCode;
    const owns = () => mounted.current && useGameStore.getState().token === token && useGameStore.getState().roomCode === roomCode;
    if (busy.current || !owns() || !token || !roomCode) return;
    busy.current = true; setLeaving(true); setError(null);
    try {
      if (!notified.current) { await leaveRoom(roomCode, token); if (!owns()) return; notified.current = true; }
      if (!owns()) return;
      getSocket()?.disconnect();
      await clearAuthIfMatches(token);
      if (!owns()) return;
      useGameStore.getState().clearAll();
      approve(() => router.replace('/'), () => mounted.current && useGameStore.getState().token === null, null);
    } catch {
      if (!owns()) return;
      busy.current = false; setLeaving(false);
      setError(notified.current ? 'Your seat has ended, but its saved details could not be cleared. Retry leaving.' : 'Could not leave the room. Check your connection and retry.');
    }
  };
  const requestLeave = () => {
    if (busy.current || !mounted.current || useGameStore.getState().token !== token) return;
    if (notified.current) { void leave(); return; }
    if (prompt.current && useDialogStore.getState().dialog === prompt.current) return;
    const captured = useGameStore.getState().cartographersPublic;
    showDialog(captured?.status === 'playing' ? 'Forfeit this game?' : 'Leave the table?',
      captured?.status === 'playing'
        ? 'Your seat will forfeit future scoring and victory. Submitted map changes stay. Unfinished ambush assignments return to their map owners.'
        : 'Your completed result stays. Close this seat and return to the arcade?', [
        { text: 'STAY', style: 'cancel', onPress: dismissPrompt },
        { text: 'LEAVE', style: 'destructive', onPress: () => {
          const latest = useGameStore.getState();
          if (!mounted.current || latest.token !== token || latest.cartographersPublic?.status !== captured?.status) return;
          dismissPrompt(); void leave();
        } },
      ]);
    prompt.current = useDialogStore.getState().dialog;
  };
  handleBack.current = () => {
    const dialog = useDialogStore.getState().dialog;
    if (dialog) {
      useDialogStore.getState().hide();
      if (dialog === prompt.current) prompt.current = null;
      return;
    }
    if (!dismissOverlay()) requestLeave();
  };
  useWebBackGuard('/cartographers-heroes/game', () => handleBack.current(), Boolean(token));
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { handleBack.current(); return true; });
    return () => subscription.remove();
  }, []);
  return { requestLeave, leaving, error };
}
