import { useCallback, useEffect, useRef, useState } from 'react';
import type { KingOfTokyoActionKind, KingOfTokyoPublicState } from '@zuychin-arcade/types';
import { getSocket } from '../../hooks/useSocket';
import { useGameStore } from '../../store/useGameStore';

type Pending = { action: KingOfTokyoActionKind; expectedRevision: number; acceptedRevision: number | null; label: string };

export function useTokyoActions() {
  const token = useGameStore((state) => state.token);
  const game = useGameStore((state) => state.kingOfTokyoPublic);
  const storeSyncing = useGameStore((state) => state.kingOfTokyoSyncing);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [synced, setSynced] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pendingRef = useRef<Pending | null>(null);
  const observedRevision = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const binding = useRef<{ socket: NonNullable<ReturnType<typeof getSocket>>; token: string; active: boolean } | null>(null);
  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const finish = useCallback((text?: string) => {
    clearTimer();
    pendingRef.current = null;
    setPending(null);
    if (text) setMessage(text);
  }, [clearTimer]);
  const refresh = useCallback(() => {
    const owner = binding.current;
    if (!owner?.active || owner.token !== token || useGameStore.getState().token !== token || getSocket() !== owner.socket) return;
    observedRevision.current = null;
    setSynced(false);
    useGameStore.getState().setKingOfTokyoSyncing(true);
    owner.socket.emit('request_state');
  }, [token]);
  const armTimeout = useCallback(() => {
    clearTimer();
    const owner = binding.current;
    timer.current = setTimeout(() => {
      if (!owner?.active || binding.current !== owner || useGameStore.getState().token !== owner.token || getSocket() !== owner.socket) return;
      finish('No confirmation received. Refreshing the battle before you try again.');
      refresh();
    }, 12_000);
  }, [clearTimer, finish, refresh]);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket();
    if (!socket) {
      const retry = setTimeout(() => setAttempt((value) => value + 1), 100);
      return () => clearTimeout(retry);
    }
    const owner = { socket, token, active: true };
    binding.current = owner;
    const ownsSession = () => owner.active && binding.current === owner && useGameStore.getState().token === token && getSocket() === socket;
    finish();
    const received = (state: KingOfTokyoPublicState) => {
      if (!ownsSession() || !state || typeof state !== 'object') return;
      const latest = useGameStore.getState();
      if (state.gameId !== 'king_of_tokyo' || state.roomCode !== latest.roomCode || state.viewerPlayerId !== latest.playerId
        || !Number.isSafeInteger(state.revision) || state.revision < Math.max(0, observedRevision.current ?? 0, latest.kingOfTokyoPublic?.revision ?? 0)) return;
      observedRevision.current = state.revision;
      if (latest.kingOfTokyoSyncing || latest.kingOfTokyoPublic !== state) return;
      const command = pendingRef.current;
      if (command && (command.acceptedRevision === null || state.revision < command.acceptedRevision)) return;
      setSynced(true);
      setConnected(socket.connected);
      setConnectionError(false);
      if (command) finish(`${command.label} accepted.`);
      else setMessage((text) => text?.startsWith('Connected.') || text?.startsWith('Connection lost.') ? null : text);
    };
    const accepted = (ack: { action: KingOfTokyoActionKind; revision: number }) => {
      if (!ownsSession() || !ack || typeof ack !== 'object') return;
      const command = pendingRef.current;
      if (!command || command.action !== ack.action || !Number.isSafeInteger(ack.revision)
        || ack.revision < command.expectedRevision || (ack.revision === command.expectedRevision && command.action !== 'preferences')) return;
      pendingRef.current = { ...command, acceptedRevision: ack.revision };
      setPending(pendingRef.current);
      refresh();
      armTimeout();
    };
    const rejected = (error: { reason: string }) => {
      if (!ownsSession() || !error || typeof error.reason !== 'string') return;
      const { reason } = error;
      finish(`Action not accepted: ${reason}. Refreshing the battle.`);
      refresh();
    };
    const disconnected = () => {
      if (!ownsSession()) return;
      finish();
      observedRevision.current = null;
      setConnected(false);
      setConnectionError(false);
      setSynced(false);
      setMessage('Connection lost. Reconnect before grace expires to keep your monster.');
    };
    const reconnected = () => {
      if (!ownsSession()) return;
      finish();
      setConnected(true);
      setConnectionError(false);
      setMessage('Connected. Refreshing your monster and private choices.');
      refresh();
    };
    const failed = () => {
      if (!ownsSession()) return;
      disconnected();
      setConnectionError(true);
    };
    socket.on('game_state', received);
    socket.on('king_of_tokyo:action_accepted', accepted);
    socket.on('action_rejected', rejected);
    socket.on('disconnect', disconnected);
    socket.on('connect_error', failed);
    socket.on('connect', reconnected);
    setConnected(socket.connected);
    refresh();
    return () => {
      owner.active = false;
      clearTimer();
      socket.off('game_state', received);
      socket.off('king_of_tokyo:action_accepted', accepted);
      socket.off('action_rejected', rejected);
      socket.off('disconnect', disconnected);
      socket.off('connect_error', failed);
      socket.off('connect', reconnected);
    };
  }, [armTimeout, attempt, clearTimer, finish, refresh, token]);

  useEffect(() => {
    const command = pendingRef.current;
    if (!connected || storeSyncing || game?.revision !== observedRevision.current
      || (command && (command.acceptedRevision === null || game.revision < command.acceptedRevision))) return;
    setSynced(true);
    if (command) finish(`${command.label} accepted.`);
  }, [connected, finish, game, storeSyncing]);
  useEffect(() => {
    if (!message?.endsWith('accepted.')) return;
    const expiry = setTimeout(() => setMessage(null), 2500);
    return () => clearTimeout(expiry);
  }, [message]);

  const send = (action: KingOfTokyoActionKind, payload: Record<string, unknown>, label: string, expectedRevision: number): boolean => {
    const latest = useGameStore.getState();
    const socket = getSocket();
    const owner = binding.current;
    if (!owner?.active || owner.socket !== socket || owner.token !== token || latest.token !== token || !socket?.connected
      || !synced || latest.kingOfTokyoSyncing || pendingRef.current || !Number.isSafeInteger(expectedRevision)
      || latest.kingOfTokyoPublic?.revision !== expectedRevision || observedRevision.current !== expectedRevision
      || latest.kingOfTokyoPublic.roomCode !== latest.roomCode || latest.kingOfTokyoPublic.viewerPlayerId !== latest.playerId) return false;
    pendingRef.current = { action, expectedRevision, acceptedRevision: null, label };
    setPending(pendingRef.current);
    setMessage(`${label}…`);
    armTimeout();
    if (action === 'start_game') socket.emit('start_game');
    else socket.emit(`king_of_tokyo:${action}`, { ...payload, expectedRevision });
    return true;
  };
  return { send, pending: pending?.label ?? null, busy: !connected || !synced || storeSyncing || pending !== null, connected, connectionError, synced, message, refresh };
}
