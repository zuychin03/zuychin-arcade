import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibertaliaActionKind } from '@zuychin-arcade/types';
import { getSocket } from '../../hooks/useSocket';
import { useGameStore } from '../../store/useGameStore';


type Pending = { action: LibertaliaActionKind; expectedRevision: number; acceptedRevision: number | null; label: string };

export function useLibertaliaActions() {
  const token = useGameStore((state) => state.token);
  const libertaliaPublic = useGameStore((state) => state.libertaliaPublic);
  const libertaliaPrivate = useGameStore((state) => state.libertaliaPrivate);
  const storeSyncing = useGameStore((state) => state.libertaliaSyncing);
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [syncBlocked, setSyncBlocked] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [bindingAttempt, setBindingAttempt] = useState(0);
  const pendingRef = useRef<Pending | null>(null);
  const revisions = useRef<{ public: number | null; private: number | null }>({ public: null, private: null });
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const binding = useRef<{ socket: NonNullable<ReturnType<typeof getSocket>>; token: string; active: boolean } | null>(null);

  const clearTimeoutFence = useCallback(() => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
  }, []);

  const requestState = useCallback(() => {
    const owner = binding.current;
    if (!owner?.active || owner.token !== token || useGameStore.getState().token !== token || getSocket() !== owner.socket) return;
    revisions.current = { public: null, private: null };
    useGameStore.getState().setLibertaliaSyncing(true);
    setSynced(false);
    owner.socket.emit('request_state');
  }, [token]);

  const finish = useCallback((text?: string) => {
    clearTimeoutFence();
    pendingRef.current = null;
    setPending(null);
    if (text) setMessage(text);
  }, [clearTimeoutFence]);

  const armTimeout = useCallback(() => {
    clearTimeoutFence();
    const owner = binding.current;
    timeout.current = setTimeout(() => {
      if (!owner?.active || binding.current !== owner || useGameStore.getState().token !== owner.token || getSocket() !== owner.socket) return;
      finish('No confirmation received. Refreshing the table before you try again.');
      requestState();
    }, 12_000);
  }, [clearTimeoutFence, finish, requestState]);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket();
    if (!socket) {
      const retry = setTimeout(() => setBindingAttempt((value) => value + 1), 100);
      return () => clearTimeout(retry);
    }
    const owner = { socket, token, active: true };
    binding.current = owner;
    const ownsSession = () => owner.active && binding.current === owner && useGameStore.getState().token === token && getSocket() === socket;
    finish();
    const paired = () => {
      if (!ownsSession()) return;
      const current = revisions.current;
      if (current.public === null || current.public !== current.private) return;
      const latest = useGameStore.getState();
      if (latest.libertaliaSyncing || latest.libertaliaPublic?.revision !== current.public || latest.libertaliaPrivate?.revision !== current.private) return;
      const command = pendingRef.current;
      if (command && (command.acceptedRevision === null || current.public < command.acceptedRevision)) return;
      setSynced(true);
      setConnected(socket.connected);
      if (command) finish(`${command.label} accepted.`);
      else setMessage((current) => current?.startsWith('Connected.') || current?.startsWith('Connection lost.') ? null : current);
    };
    const receivedPublic = (state: { gameId?: string; roomCode?: string; revision?: number }) => {
      if (!ownsSession() || !state || typeof state !== 'object' || Array.isArray(state)) return;
      const latest = useGameStore.getState();
      if (latest.token !== token || state.gameId !== 'libertalia' || state.roomCode !== latest.roomCode || typeof state.revision !== 'number' || !Number.isSafeInteger(state.revision) || state.revision < Math.max(0, latest.libertaliaPublic?.revision ?? 0, revisions.current.public ?? 0, revisions.current.private ?? 0)) return;
      revisions.current.public = state.revision;
      if (revisions.current.private !== state.revision) setSynced(false);
      paired();
    };
    const receivedPrivate = (state: { gameId?: string; roomCode?: string; playerId?: string; revision?: number }) => {
      if (!ownsSession() || !state || typeof state !== 'object' || Array.isArray(state)) return;
      const latest = useGameStore.getState();
      if (latest.token !== token || state.gameId !== 'libertalia' || state.roomCode !== latest.roomCode || state.playerId !== latest.playerId || typeof state.revision !== 'number' || !Number.isSafeInteger(state.revision) || state.revision < Math.max(0, latest.libertaliaPrivate?.revision ?? 0, revisions.current.public ?? 0, revisions.current.private ?? 0)) return;
      revisions.current.private = state.revision;
      if (revisions.current.public !== state.revision) setSynced(false);
      paired();
    };
    const accepted = (ack: { action: LibertaliaActionKind; revision: number }) => {
      if (!ownsSession() || !ack || typeof ack !== 'object' || Array.isArray(ack)) return;
      const command = pendingRef.current;
      if (useGameStore.getState().token !== token || !command || command.action !== ack.action || !Number.isSafeInteger(ack.revision) || ack.revision <= command.expectedRevision) return;
      pendingRef.current = { ...command, acceptedRevision: ack.revision };
      setPending(pendingRef.current);
      requestState();
      armTimeout();
    };
    const rejected = (payload: { reason?: unknown } | null | undefined) => {
      if (!ownsSession() || !payload || typeof payload !== 'object' || Array.isArray(payload)
        || typeof payload.reason !== 'string') return;
      const { reason } = payload;
      finish(`Action not accepted: ${reason}. Refreshing the table.`);
      requestState();
    };
    const disconnected = () => {
      if (!ownsSession()) return;
      finish();
      revisions.current = { public: null, private: null };
      setConnected(false);
      setSynced(false);
      setMessage('Connection lost. Your controls will return after the table reconnects.');
    };
    const reconnected = () => {
      if (!ownsSession()) return;
      finish();
      setConnected(true);
      setMessage('Connected. Refreshing your private crew and the table.');
      requestState();
    };
    socket.on('game_state', receivedPublic);
    socket.on('private_state', receivedPrivate);
    socket.on('libertalia:action_accepted', accepted);
    socket.on('action_rejected', rejected);
    socket.on('disconnect', disconnected);
    socket.on('connect_error', disconnected);
    socket.on('connect', reconnected);
    setConnected(socket.connected);
    requestState();
    return () => {
      owner.active = false;
      clearTimeoutFence();
      socket.off('game_state', receivedPublic);
      socket.off('private_state', receivedPrivate);
      socket.off('libertalia:action_accepted', accepted);
      socket.off('action_rejected', rejected);
      socket.off('disconnect', disconnected);
      socket.off('connect_error', disconnected);
      socket.off('connect', reconnected);
    };
  }, [armTimeout, bindingAttempt, clearTimeoutFence, finish, requestState, token]);

  useEffect(() => {
    if (synced && !storeSyncing) { setSyncBlocked(false); return; }
    // Keep focus stable while the public/private frames arrive as a pair.
    const timer = setTimeout(() => setSyncBlocked(true), 150);
    return () => clearTimeout(timer);
  }, [synced, storeSyncing]);

  useEffect(() => {
    const revision = libertaliaPublic?.revision;
    const command = pendingRef.current;
    if (storeSyncing || !connected || revision === undefined || libertaliaPrivate?.revision !== revision
      || revisions.current.public !== revision || revisions.current.private !== revision
      || (command && (command.acceptedRevision === null || revision < command.acceptedRevision))) return;
    setSynced(true);
    if (command) finish(`${command.label} accepted.`);
  }, [connected, storeSyncing, libertaliaPublic?.revision, libertaliaPrivate?.revision, finish]);

  useEffect(() => {
    if (!message?.endsWith('accepted.')) return;
    const timer = setTimeout(() => setMessage(null), 2_500);
    return () => clearTimeout(timer);
  }, [message]);

  const ready = connected && synced && !storeSyncing && libertaliaPublic?.revision === libertaliaPrivate?.revision;
  const send = (action: LibertaliaActionKind, payload: Record<string, unknown>, label: string, expectedRevision: number): boolean => {
    const latest = useGameStore.getState();
    const socket = getSocket();
    const owner = binding.current;
    if (!owner?.active || owner.socket !== socket || owner.token !== token || !ready || latest.token !== token || latest.libertaliaPrivate?.playerId !== latest.playerId || latest.libertaliaPrivate?.roomCode !== latest.roomCode || latest.libertaliaPublic?.roomCode !== latest.roomCode || latest.libertaliaSyncing || !socket?.connected || pendingRef.current || latest.libertaliaPublic?.revision !== expectedRevision
      || latest.libertaliaPrivate?.revision !== expectedRevision || revisions.current.public !== expectedRevision || revisions.current.private !== expectedRevision) return false;
    const command = { action, expectedRevision, acceptedRevision: null, label };
    pendingRef.current = command;
    setPending(command);
    setMessage(`${label}…`);
    armTimeout();
    if (action === 'start') socket.emit('start_game');
    else socket.emit(`libertalia:${action}`, { ...payload, expectedRevision });
    return true;
  };

  return { send, pending: pending !== null, busy: !connected || syncBlocked || pending !== null, connected, synced, message, refresh: requestState };
}
