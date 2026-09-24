import { useCallback, useEffect, useRef, useState } from 'react';
import type { CartographersAssignment, CartographersPlacementPayload, CartographersPoint } from '@zuychin-arcade/types';
import { getSocket } from '../../hooks/useSocket';
import { useGameStore } from '../../store/useGameStore';

type Choice = Omit<CartographersPlacementPayload, 'turnId' | 'expectedRevision' | 'submissionToken' | 'targetPlayerId'>;
type Action = 'place' | 'destroy' | 'inspect_map' | 'start';
interface Pending { action: Action; revision: number; accepted: number | null; target?: string }
export function useCartographersActions() {
  const token = useGameStore(state => state.token);
  const game = useGameStore(state => state.cartographersPublic);
  const mine = useGameStore(state => state.cartographersPrivate);
  const syncing = useGameStore(state => state.cartographersSyncing);
  const [pending, setPending] = useState<Pending | null>(null);
  const command = useRef<Pending | null>(null);
  const owner = useRef<{ token: string; socket: NonNullable<ReturnType<typeof getSocket>> } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const clear = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; command.current = null; setPending(null); }, []);
  const refresh = useCallback(() => {
    const binding = owner.current;
    if (!binding || binding.token !== token || useGameStore.getState().token !== token || getSocket() !== binding.socket) return;
    useGameStore.getState().setCartographersSyncing(true);
    if (binding.socket.connected) binding.socket.emit('request_state'); else binding.socket.connect();
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const socket = getSocket();
    if (!socket) { const retry = setTimeout(() => setAttempt(n => n + 1), 100); return () => clearTimeout(retry); }
    const binding = { token, socket }; owner.current = binding;
    const owns = () => owner.current === binding && useGameStore.getState().token === token && getSocket() === socket;
    const accepted = (ack: { action?: string; revision?: number }) => {
      const current = command.current;
      if (!owns() || !current || ack?.action !== current.action || !Number.isSafeInteger(ack.revision)
        || (current.action === 'inspect_map' ? ack.revision !== current.revision : ack.revision! <= current.revision)) return;
      command.current = { ...current, accepted: ack.revision! }; setPending(command.current);
    };
    const rejected = (error: { reason?: string }) => { if (owns() && typeof error?.reason === 'string') { clear(); setMessage(error.reason); refresh(); } };
    const disconnected = () => { if (owns()) { clear(); setConnected(false); setMessage('Connection lost. Restoring your map before accepting another move.'); } };
    const reconnected = () => { if (owns()) { clear(); setConnected(true); setMessage(null); refresh(); } };
    socket.on('cartographers:action_accepted', accepted); socket.on('action_rejected', rejected); socket.on('disconnect', disconnected);
    socket.on('connect_error', disconnected); socket.on('connect', reconnected);
    setConnected(socket.connected); clear(); refresh();
    return () => {
      if (owner.current === binding) owner.current = null; if (timer.current) clearTimeout(timer.current);
      socket.off('cartographers:action_accepted', accepted); socket.off('action_rejected', rejected); socket.off('disconnect', disconnected);
      socket.off('connect_error', disconnected); socket.off('connect', reconnected);
    };
  }, [token, attempt, clear, refresh]);
  useEffect(() => {
    if (pending?.accepted != null && !syncing && game && mine?.revision === game.revision && game.revision >= pending.accepted
      && (pending.action !== 'inspect_map' || mine.resultMaps.some(map => map.playerId === pending.target))) { clear(); setMessage(null); }
  }, [pending, syncing, game, mine, clear]);
  const send = (action: Action, data?: Choice | CartographersPoint | string, assignment?: CartographersAssignment) => {
    const state = useGameStore.getState(); const socket = getSocket(); const publicState = state.cartographersPublic; const privateState = state.cartographersPrivate;
    if (!owner.current || owner.current.token !== token || owner.current.socket !== socket || state.token !== token || !socket?.connected
      || state.cartographersSyncing || command.current || !publicState || privateState?.revision !== publicState.revision
      || privateState.playerId !== state.playerId || privateState.roomCode !== state.roomCode || publicState.roomCode !== state.roomCode) return false;
    if (!game || publicState.turnId !== game.turnId || publicState.turnRevision !== game.turnRevision || publicState.phase !== game.phase
      || ((action === 'start' || action === 'inspect_map') && publicState.revision !== game.revision)) return false;
    const currentAssignment = assignment && privateState.assignments.find(task => task.targetPlayerId === assignment.targetPlayerId && task.submissionToken === assignment.submissionToken);
    if ((action === 'place' || action === 'destroy') && !currentAssignment) return false;
    const binding = owner.current;
    command.current = { action, revision: publicState.revision, accepted: null, ...(action === 'inspect_map' ? { target: data as string } : {}) };
    setPending(command.current); setMessage(null);
    timer.current = setTimeout(() => {
      if (owner.current !== binding || useGameStore.getState().token !== token) return;
      clear(); setMessage('No confirmation received. Refreshing your map before another attempt.'); refresh();
    }, 12_000);
    if (action === 'start') socket.emit('start_game');
    else if (action === 'inspect_map') socket.emit('cartographers:inspect_map', { targetPlayerId: data, expectedRevision: publicState.revision });
    else {
      const submission = { turnId: publicState.turnId, expectedRevision: publicState.revision, submissionToken: currentAssignment!.submissionToken, targetPlayerId: currentAssignment!.targetPlayerId };
      socket.emit(`cartographers:${action}`, action === 'place' ? { ...submission, ...data as Choice } : { ...submission, position: data });
    }
    return true;
  };
  return { send, refresh, pending: pending !== null, busy: !connected || syncing || pending !== null, message };
}
