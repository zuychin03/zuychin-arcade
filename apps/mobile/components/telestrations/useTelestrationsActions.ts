import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../../hooks/useSocket';
import { useGameStore } from '../../store/useGameStore';
import type { TelestrationsContent, TelestrationsScoreVerdict } from '@zuychin-arcade/types';

export type BookAction = 'draft' | 'submit' | 'reveal' | 'review' | 'score' | 'next_round' | 'start';
type Command = { action: BookAction; revision: number; accepted: number | null };
type Submission = { content: TelestrationsContent; windowId: string; seatToken: string };
export function useTelestrationsActions() {
  const token = useGameStore(s => s.token);
  const game = useGameStore(s => s.telestrationsPublic);
  const mine = useGameStore(s => s.telestrationsPrivate);
  const syncing = useGameStore(s => s.telestrationsSyncing);
  const [pending, setPending] = useState<Command | null>(null);
  const command = useRef<Command | null>(null);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const owner = useRef<{ token: string; socket: NonNullable<ReturnType<typeof getSocket>> } | null>(null);
  const clear = useCallback(() => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null; command.current = null; setPending(null);
  }, []);
  const refresh = useCallback(() => {
    const current = owner.current;
    if (!current || current.token !== token || useGameStore.getState().token !== token || getSocket() !== current.socket) return;
    useGameStore.getState().setTelestrationsSyncing(true);
    if (current.socket.connected) current.socket.emit('request_state'); else current.socket.connect();
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const socket = getSocket();
    if (!socket) { const retry = setTimeout(() => setAttempt(v => v + 1), 100); return () => clearTimeout(retry); }
    const binding = { token, socket }; owner.current = binding;
    const owns = () => owner.current === binding && useGameStore.getState().token === token && getSocket() === socket;
    const accepted = (ack: { action?: string; revision?: number }) => {
      const current = command.current;
      if (!owns() || !current || ack?.action !== current.action || !Number.isSafeInteger(ack.revision) || ack.revision! <= current.revision) return;
      command.current = { ...current, accepted: ack.revision! }; setPending(command.current);
    };
    const rejected = (payload: { reason?: string }) => { if (owns() && typeof payload?.reason === 'string') { clear(); setMessage(payload.reason); refresh(); } };
    const disconnected = () => { if (owns()) { clear(); setConnected(false); setMessage('Connection lost. Saved drafts will return when your seat reconnects. Keep this page open for unsaved work.'); } };
    const reconnected = () => { if (owns()) { clear(); setConnected(true); setMessage(null); refresh(); } };
    socket.on('telestrations:action_accepted', accepted); socket.on('action_rejected', rejected);
    socket.on('disconnect', disconnected); socket.on('connect_error', disconnected); socket.on('connect', reconnected);
    setConnected(socket.connected); clear(); refresh();
    return () => {
      if (owner.current === binding) owner.current = null;
      if (timeout.current) clearTimeout(timeout.current);
      socket.off('telestrations:action_accepted', accepted); socket.off('action_rejected', rejected);
      socket.off('disconnect', disconnected); socket.off('connect_error', disconnected); socket.off('connect', reconnected);
    };
  }, [token, attempt, clear, refresh]);
  useEffect(() => {
    if (pending?.accepted !== null && pending?.accepted !== undefined && !syncing && game && mine?.revision === game.revision && game.revision >= pending.accepted) { clear(); setMessage(null); }
  }, [pending, syncing, game, mine, clear]);
  const send = (action: BookAction, payload?: Submission | Omit<TelestrationsScoreVerdict, 'expectedRevision'> | { pageIndex: number }) => {
    const current = useGameStore.getState(); const socket = getSocket(); const state = current.telestrationsPublic; const privateState = current.telestrationsPrivate;
    if (!owner.current || owner.current.token !== token || owner.current.socket !== socket || !socket?.connected || current.token !== token || current.telestrationsSyncing || command.current
      || !state || !privateState || state.gameId !== 'telestrations' || privateState.gameId !== 'telestrations' || privateState.revision !== state.revision || privateState.playerId !== current.playerId || privateState.roomCode !== current.roomCode || state.roomCode !== current.roomCode) return false;
    if (action !== 'draft' && action !== 'submit' && state.revision !== game?.revision) return false;
    if ((action === 'draft' || action === 'submit') && (!payload || !('content' in payload) || payload.windowId !== privateState.windowId || payload.seatToken !== privateState.seatToken || privateState.draft?.submitted)) return false;
    const binding = owner.current;
    command.current = { action, revision: state.revision, accepted: null }; setPending(command.current); setMessage(null);
    timeout.current = setTimeout(() => { if (owner.current === binding && useGameStore.getState().token === token) { clear(); setMessage('No confirmation received. Checking the saved page before another attempt.'); refresh(); } }, 12000);
    if (action === 'start') socket.emit('start_game');
    else if (action === 'draft' || action === 'submit') socket.emit(`telestrations:${action}`, { ...payload, draftRevision: privateState.draft!.revision });
    else socket.emit(`telestrations:${action}`, { ...payload, expectedRevision: state.revision });
    return true;
  };
  return { send, refresh, message, pending: pending?.action ?? null, busy: !connected || syncing || pending !== null, canEdit: connected && !syncing && (pending === null || pending.action === 'draft') };
}
