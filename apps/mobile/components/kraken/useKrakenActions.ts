import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedTheKrakenAction } from '@zuychin-arcade/types';
import { getSocket } from '../../hooks/useSocket';
import { useGameStore } from '../../store/useGameStore';

type Command = { type: FeedTheKrakenAction['type'] | 'start'; revision: number; accepted: number | null };

export function useKrakenActions() {
  const token = useGameStore(state => state.token);
  const game = useGameStore(state => state.krakenPublic);
  const mine = useGameStore(state => state.krakenPrivate);
  const syncing = useGameStore(state => state.krakenSyncing);
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
    useGameStore.getState().setKrakenSyncing(true);
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
    socket.on('kraken:action_accepted', accepted);
    socket.on('action_rejected', rejected);
    socket.on('disconnect', disconnected);
    socket.on('connect_error', disconnected);
    socket.on('connect', reconnected);
    setConnected(socket.connected);
    clear(); refresh();
    return () => {
      if (owner.current === binding) owner.current = null;
      if (timeout.current) clearTimeout(timeout.current);
      socket.off('kraken:action_accepted', accepted);
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

  const send = (action: FeedTheKrakenAction | 'start') => {
    const current = useGameStore.getState();
    const socket = getSocket();
    if (!owner.current || owner.current.token !== token || owner.current.socket !== socket
      || !socket?.connected || current.token !== token || current.krakenSyncing || command.current
      || !current.krakenPublic || current.krakenPrivate?.revision !== current.krakenPublic.revision
      || current.krakenPrivate.playerId !== current.playerId || current.krakenPublic.roomCode !== current.roomCode
      || current.krakenPrivate.roomCode !== current.roomCode || current.krakenPrivate.viewerPlayerId !== current.playerId) return false;
    if (!game || current.krakenPublic.round !== game.round
      || current.krakenPublic.windowId !== game.windowId || current.krakenPublic.phase !== game.phase
      || ((action === 'start' || !['bid', 'ritual'].includes(action.type)) && current.krakenPublic.revision !== game.revision)) return false;
    const binding = owner.current;
    command.current = { type: action === 'start' ? 'start' : action.type, revision: current.krakenPublic.revision, accepted: null };
    setPending(command.current); setMessage(null);
    timeout.current = setTimeout(() => {
      if (owner.current !== binding || useGameStore.getState().token !== token) return;
      clear(); setMessage('No confirmation received. Refreshing before you can try again.'); refresh();
    }, 12_000);
    if (action === 'start') socket.emit('start_game');
    else socket.emit('kraken:action', { action, expectedRevision: current.krakenPublic.revision, windowId: current.krakenPublic.windowId });
    return true;
  };
  return { send, refresh, message, pending: pending !== null, busy: !connected || syncing || pending !== null };
}
