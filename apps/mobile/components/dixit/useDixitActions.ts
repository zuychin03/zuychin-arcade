import { useCallback, useEffect, useRef, useState } from 'react';
import type { DixitAction } from '@zuychin-arcade/types';
import { getSocket } from '../../hooks/useSocket';
import { useGameStore } from '../../store/useGameStore';

type Command = { type: DixitAction['type'] | 'start'; revision: number; accepted: number | null };

export function useDixitActions() {
  const token = useGameStore(state => state.token);
  const game = useGameStore(state => state.dixitPublic);
  const mine = useGameStore(state => state.dixitPrivate);
  const syncing = useGameStore(state => state.dixitSyncing);
  const [pending, setPending] = useState<Command | null>(null);
  const command = useRef<Command | null>(null);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const owner = useRef<{ token: string; socket: NonNullable<ReturnType<typeof getSocket>> } | null>(null);
  const clear = useCallback(() => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    command.current = null;
    setPending(null);
  }, []);
  const refresh = useCallback(() => {
    const current = owner.current;
    if (!current || current.token !== token || useGameStore.getState().token !== token || getSocket() !== current.socket) return;
    useGameStore.getState().setDixitSyncing(true);
    if (current.socket.connected) current.socket.emit('request_state');
    else current.socket.connect();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket();
    if (!socket) {
      const retry = setTimeout(() => setAttempt(value => value + 1), 100);
      return () => clearTimeout(retry);
    }
    const binding = { token, socket };
    owner.current = binding;
    const owns = () => owner.current === binding && useGameStore.getState().token === token && getSocket() === socket;
    const accepted = (ack: { action?: string; revision?: number }) => {
      const current = command.current;
      if (!owns() || !current || !ack || ack.action !== current.type || !Number.isSafeInteger(ack.revision)
        || ack.revision! <= current.revision) return;
      command.current = { ...current, accepted: ack.revision! };
      setPending(command.current);
    };
    const rejected = (payload: { reason?: string }) => {
      if (!owns() || !payload || typeof payload.reason !== 'string') return;
      clear(); setMessage(payload.reason); refresh();
    };
    const disconnected = () => {
      if (!owns()) return;
      clear(); setConnected(false); setMessage('Connection lost. Waiting for your private hand and the table to reconnect.');
    };
    const reconnected = () => {
      if (!owns()) return;
      clear(); setConnected(true); setMessage(null); refresh();
    };
    socket.on('dixit:action_accepted', accepted);
    socket.on('action_rejected', rejected);
    socket.on('disconnect', disconnected);
    socket.on('connect_error', disconnected);
    socket.on('connect', reconnected);
    setConnected(socket.connected);
    clear(); refresh();
    return () => {
      if (owner.current === binding) owner.current = null;
      if (timeout.current) clearTimeout(timeout.current);
      socket.off('dixit:action_accepted', accepted);
      socket.off('action_rejected', rejected);
      socket.off('disconnect', disconnected);
      socket.off('connect_error', disconnected);
      socket.off('connect', reconnected);
    };
  }, [token, attempt, clear, refresh]);

  useEffect(() => {
    if (pending?.accepted !== null && pending?.accepted !== undefined && !syncing
      && game?.revision === mine?.revision && game && game.revision >= pending.accepted) {
      clear(); setMessage(null);
    }
  }, [pending, syncing, game, mine, clear]);

  const send = (action: DixitAction | 'start') => {
    const current = useGameStore.getState();
    const socket = getSocket();
    if (!owner.current || owner.current.token !== token || owner.current.socket !== socket
      || !socket?.connected || current.token !== token || current.dixitSyncing || command.current
      || !current.dixitPublic || current.dixitPrivate?.revision !== current.dixitPublic.revision
      || current.dixitPrivate.playerId !== current.playerId || current.dixitPublic.roomCode !== current.roomCode
      || current.dixitPrivate.roomCode !== current.roomCode
      || game?.roundNumber !== current.dixitPublic.roundNumber || game?.phase !== current.dixitPublic.phase) return false;
    if ((action === 'start' || action.type === 'clue') && game.revision !== current.dixitPublic.revision) return false;
    const binding = owner.current;
    command.current = { type: action === 'start' ? 'start' : action.type, revision: current.dixitPublic.revision, accepted: null };
    setPending(command.current); setMessage(null);
    timeout.current = setTimeout(() => {
      if (owner.current !== binding || useGameStore.getState().token !== token) return;
      clear(); setMessage('No confirmation received. Refreshing before you can try again.'); refresh();
    }, 12_000);
    if (action === 'start') socket.emit('start_game');
    else socket.emit('dixit:action', { action, expectedRevision: game.revision, roundNumber: game.roundNumber });
    return true;
  };
  return { send, refresh, message, pending: pending !== null, busy: !connected || syncing || pending !== null };
}
