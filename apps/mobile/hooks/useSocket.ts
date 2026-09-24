import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { router } from 'expo-router';
import type {
  BangPrivateState, BangPublicState, CitadelsPrivateState, CitadelsPublicState,
  ColtPrivateState, ColtPublicState, CoupPrivateState, CoupPublicState,
  LibertaliaPrivateState, LibertaliaPublicState, NotAlonePrivateState, NotAlonePublicState,
  SaboteurPrivateState, SaboteurPublicState, SkullKingPrivateState, SkullKingPublicState,
  DixitPublicState, DixitPrivateState, CartographersHeroesPublicState, CartographersHeroesPrivateState,
  FeedTheKrakenPublicState, FeedTheKrakenPrivateState, TelestrationsPublicState, TelestrationsPrivateState,
} from '@zuychin-arcade/types';
import { useGameStore } from '../store/useGameStore';
import { revisionPair } from '../lib/revisionPair';
import { SERVER_URL } from '../constants/config';
import { clearAuthIfMatches } from '../lib/storage';
import { showDialog, useDialogStore, type DialogConfig } from '../lib/dialog';

let socketInstance: Socket | null = null;

/**
 * Owns the Socket.IO connection lifecycle. Mounted once in the root layout:
 * connects whenever a token is present, tears down when it goes away.
 */
export function useSocket(): void {
  const token = useGameStore((s) => s.token);

  useEffect(() => {
    if (!token) return;

    const socket = io(SERVER_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
    });
    socketInstance = socket;

    const store = useGameStore.getState;
    const dixitPair = revisionPair<DixitPublicState, DixitPrivateState>({
      roomCode: () => store().roomCode, playerId: () => store().playerId,
      current: () => store().dixitPublic,
      syncing: value => store().setDixitSyncing(value),
      adopt: (shared, owned) => store().setDixitState(shared, owned),
    });
    const cartographersPair = revisionPair<CartographersHeroesPublicState, CartographersHeroesPrivateState>({
      roomCode: () => store().roomCode, playerId: () => store().playerId,
      current: () => store().cartographersPublic,
      syncing: value => store().setCartographersSyncing(value),
      adopt: (shared, owned) => store().setCartographersState(shared, owned),
    });
    const krakenPair = revisionPair<FeedTheKrakenPublicState, FeedTheKrakenPrivateState>({
      roomCode: () => store().roomCode, playerId: () => store().playerId,
      current: () => store().krakenPublic,
      syncing: value => store().setKrakenSyncing(value),
      adopt: (shared, owned) => store().setKrakenState(shared, owned),
    });
    const telestrationsPair = revisionPair<TelestrationsPublicState, TelestrationsPrivateState>({
      roomCode: () => store().roomCode, playerId: () => store().playerId,
      current: () => store().telestrationsPublic,
      syncing: value => store().setTelestrationsSyncing(value),
      adopt: (shared, owned) => store().setTelestrationsState(shared, owned),
    });
    let active = true;
    let ending = false;
    let cleanupDialog: DialogConfig | null = null;
    let pendingPublic: SaboteurPublicState | null = null;
    let pendingPrivate: SaboteurPrivateState | null = null;
    let pendingCoupPublic: CoupPublicState | null = null;
    let pendingCoupPrivate: CoupPrivateState | null = null;
    let pendingBangPublic: BangPublicState | null = null;
    let pendingBangPrivate: BangPrivateState | null = null;
    let pendingSkullPublic: SkullKingPublicState | null = null;
    let pendingSkullPrivate: SkullKingPrivateState | null = null;
    let pendingCitadelsPublic: CitadelsPublicState | null = null;
    let pendingCitadelsPrivate: CitadelsPrivateState | null = null;
    let pendingNotAlonePublic: NotAlonePublicState | null = null;
    let pendingNotAlonePrivate: NotAlonePrivateState | null = null;
    let pendingLibertaliaPublic: LibertaliaPublicState | null = null;
    let pendingLibertaliaPrivate: LibertaliaPrivateState | null = null;
    let pendingColtPublic: ColtPublicState | null = null;
    let pendingColtPrivate: ColtPrivateState | null = null;
    const ownsSession = () => active && socketInstance === socket && store().token === token;
    const acceptsState = () => ownsSession() && !ending && socket.connected;
    const resetPairs = () => {
      dixitPair.reset();
      cartographersPair.reset();
      krakenPair.reset();
      telestrationsPair.reset();
      pendingPublic = null;
      pendingPrivate = null;
      pendingCoupPublic = null;
      pendingCoupPrivate = null;
      pendingBangPublic = null;
      pendingBangPrivate = null;
      pendingSkullPublic = null;
      pendingSkullPrivate = null;
      pendingCitadelsPublic = null;
      pendingCitadelsPrivate = null;
      pendingNotAlonePublic = null;
      pendingNotAlonePrivate = null;
      pendingLibertaliaPublic = null;
      pendingLibertaliaPrivate = null;
      pendingColtPublic = null;
      pendingColtPrivate = null;
      store().setSaboteurSyncing(true);
      store().setCoupSyncing(true);
      store().setBangSyncing(true);
      store().setKingOfTokyoSyncing(true);
      store().setSkullKingSyncing(true);
      store().setCitadelsSyncing(true);
      store().setNotAloneSyncing(true);
      store().setLibertaliaSyncing(true);
      store().setColtSyncing(true);
    };
    resetPairs();

    const gameIdFor = (state: unknown) => {
      if (!acceptsState() || !state || typeof state !== 'object' || !('gameId' in state)) return null;
      if ('roomCode' in state && state.roomCode !== store().roomCode) return null;
      const gameId = (state as { gameId?: string }).gameId;
      if (store().room && gameId !== store().room?.gameId) return null;
      return gameId;
    };
    const adoptSaboteurPair = () => {
      if (pendingPublic && pendingPrivate && pendingPublic.revision === pendingPrivate.revision) {
        store().setSaboteurState(pendingPublic, pendingPrivate);
      }
    };
    const acceptsSaboteurRevision = (revision: number) => {
      const current = store().publicState;
      const previousRevision = current?.roomCode === store().roomCode ? current.revision : 0;
      return Number.isSafeInteger(revision) && revision > 0
        && revision >= previousRevision
        && revision >= (pendingPublic?.revision ?? 0)
        && revision >= (pendingPrivate?.revision ?? 0);
    };
    const adoptCoupPair = () => {
      if (pendingCoupPublic && pendingCoupPrivate && pendingCoupPublic.revision === pendingCoupPrivate.revision) {
        store().setCoupState(pendingCoupPublic, pendingCoupPrivate);
      }
    };
    const acceptsCoupRevision = (revision: number) => {
      const current = store().coupPublic;
      const previousRevision = current?.roomCode === store().roomCode ? current.revision : 0;
      return Number.isSafeInteger(revision) && revision >= 0
        && revision >= previousRevision
        && revision >= (pendingCoupPublic?.revision ?? 0)
        && revision >= (pendingCoupPrivate?.revision ?? 0);
    };
    const adoptBangPair = () => {
      if (pendingBangPublic && pendingBangPrivate && pendingBangPublic.revision === pendingBangPrivate.revision) {
        store().setBangState(pendingBangPublic, pendingBangPrivate);
      }
    };
    const acceptsBangRevision = (revision: number) => {
      const current = store().bangPublic;
      const previousRevision = current?.roomCode === store().roomCode ? current.revision : 0;
      return Number.isSafeInteger(revision) && revision >= 0
        && revision >= previousRevision
        && revision >= (pendingBangPublic?.revision ?? 0)
        && revision >= (pendingBangPrivate?.revision ?? 0);
    };
    const adoptSkullPair = () => {
      if (pendingSkullPublic && pendingSkullPrivate && pendingSkullPublic.revision === pendingSkullPrivate.revision) {
        store().setSkullKingState(pendingSkullPublic, pendingSkullPrivate);
      }
    };
    const acceptsSkullRevision = (revision: number) => {
      const current = store().skullKingPublic;
      const previousRevision = current?.roomCode === store().roomCode ? current.revision : 0;
      return Number.isSafeInteger(revision) && revision >= 0
        && revision >= previousRevision
        && revision >= (pendingSkullPublic?.revision ?? 0)
        && revision >= (pendingSkullPrivate?.revision ?? 0);
    };
    const adoptCitadelsPair = () => {
      if (pendingCitadelsPublic && pendingCitadelsPrivate && pendingCitadelsPublic.revision === pendingCitadelsPrivate.revision) {
        store().setCitadelsState(pendingCitadelsPublic, pendingCitadelsPrivate);
      }
    };
    const acceptsCitadelsRevision = (revision: number) => {
      const current = store().citadelsPublic;
      const previousRevision = current?.roomCode === store().roomCode ? current.revision : 0;
      return Number.isSafeInteger(revision) && revision >= 0
        && revision >= previousRevision
        && revision >= (pendingCitadelsPublic?.revision ?? 0)
        && revision >= (pendingCitadelsPrivate?.revision ?? 0);
    };
    const adoptNotAlonePair = () => {
      if (pendingNotAlonePublic && pendingNotAlonePrivate && pendingNotAlonePublic.revision === pendingNotAlonePrivate.revision) {
        store().setNotAloneState(pendingNotAlonePublic, pendingNotAlonePrivate);
      }
    };
    const acceptsNotAloneRevision = (revision: number) => {
      const current = store().notAlonePublic;
      const previousRevision = current?.roomCode === store().roomCode ? current.revision : 0;
      return Number.isSafeInteger(revision) && revision >= 0
        && revision >= previousRevision
        && revision >= (pendingNotAlonePublic?.revision ?? 0)
        && revision >= (pendingNotAlonePrivate?.revision ?? 0);
    };
    const adoptLibertaliaPair = () => {
      if (pendingLibertaliaPublic && pendingLibertaliaPrivate && pendingLibertaliaPublic.revision === pendingLibertaliaPrivate.revision) {
        store().setLibertaliaState(pendingLibertaliaPublic, pendingLibertaliaPrivate);
      }
    };
    const acceptsLibertaliaRevision = (revision: number) => {
      const current = store().libertaliaPublic;
      const previousRevision = current?.roomCode === store().roomCode ? current.revision : 0;
      return Number.isSafeInteger(revision) && revision >= 0
        && revision >= previousRevision
        && revision >= (pendingLibertaliaPublic?.revision ?? 0)
        && revision >= (pendingLibertaliaPrivate?.revision ?? 0);
    };
    const adoptColtPair = () => {
      if (pendingColtPublic && pendingColtPrivate && pendingColtPublic.revision === pendingColtPrivate.revision) {
        store().setColtState(pendingColtPublic, pendingColtPrivate);
      }
    };
    const acceptsColtRevision = (revision: number) => {
      const current = store().coltPublic;
      const previousRevision = current?.roomCode === store().roomCode ? current.revision : 0;
      return Number.isSafeInteger(revision) && revision >= 0
        && revision >= previousRevision
        && revision >= (pendingColtPublic?.revision ?? 0)
        && revision >= (pendingColtPrivate?.revision ?? 0);
    };
    const acceptsTokyoRevision = (revision: number) => {
      const current = store().kingOfTokyoPublic;
      const previousRevision = current?.roomCode === store().roomCode ? current.revision : 0;
      return Number.isSafeInteger(revision) && revision >= 0 && revision >= previousRevision;
    };
    socket.on('room_updated', (room) => {
      if (acceptsState() && room?.roomCode === store().roomCode) store().setRoom(room);
    });
    socket.on('game_state', (state) => {
      const gameId = gameIdFor(state);
      if (gameId === 'dixit_odyssey') dixitPair.public(state);
      else if (gameId === 'cartographers_heroes') cartographersPair.public(state);
      else if (gameId === 'feed_the_kraken') krakenPair.public(state);
      else if (gameId === 'telestrations') telestrationsPair.public(state);
      if (gameId === 'king_of_tokyo' && state.roomCode === store().roomCode
        && state.viewerPlayerId === store().playerId && acceptsTokyoRevision(state.revision)) {
        store().setKingOfTokyoPublic(state);
      }
      else if (gameId === 'skull_king' && state.roomCode === store().roomCode && acceptsSkullRevision(state.revision)) {
        store().setSkullKingSyncing(true);
        pendingSkullPublic = state;
        adoptSkullPair();
      }
      else if (gameId === 'citadels' && state.roomCode === store().roomCode && acceptsCitadelsRevision(state.revision)) {
        store().setCitadelsSyncing(true);
        pendingCitadelsPublic = state;
        adoptCitadelsPair();
      }
      else if (gameId === 'not_alone' && state.roomCode === store().roomCode
        && state.viewerPlayerId === store().playerId && acceptsNotAloneRevision(state.revision)) {
        store().setNotAloneSyncing(true);
        pendingNotAlonePublic = state;
        adoptNotAlonePair();
      }
      else if (gameId === 'libertalia' && state.roomCode === store().roomCode && acceptsLibertaliaRevision(state.revision)) {
        store().setLibertaliaSyncing(true);
        pendingLibertaliaPublic = state;
        adoptLibertaliaPair();
      }
      else if (gameId === 'colt_express' && state.roomCode === store().roomCode && acceptsColtRevision(state.revision)) {
        store().setColtSyncing(true);
        pendingColtPublic = state;
        adoptColtPair();
      }
      else if (gameId === 'bang' && state.roomCode === store().roomCode && acceptsBangRevision(state.revision)) {
        store().setBangSyncing(true);
        pendingBangPublic = state;
        adoptBangPair();
      }
      else if (gameId === 'coup' && state.roomCode === store().roomCode && acceptsCoupRevision(state.revision)) {
        store().setCoupSyncing(true);
        pendingCoupPublic = state;
        adoptCoupPair();
      }
      else if (gameId === 'saboteur' && state.roomCode === store().roomCode && acceptsSaboteurRevision(state.revision)) {
        store().setSaboteurSyncing(true);
        pendingPublic = state;
        adoptSaboteurPair();
      }
    });
    socket.on('private_state', (state) => {
      const gameId = gameIdFor(state);
      if (!state || state.playerId !== store().playerId) return;
      if (gameId === 'dixit_odyssey') dixitPair.private(state);
      else if (gameId === 'cartographers_heroes') cartographersPair.private(state);
      else if (gameId === 'feed_the_kraken') krakenPair.private(state);
      else if (gameId === 'telestrations') telestrationsPair.private(state);
      if (gameId === 'coup' && state.roomCode === store().roomCode && acceptsCoupRevision(state.revision)) {
        store().setCoupSyncing(true);
        pendingCoupPrivate = state;
        adoptCoupPair();
      }
      else if (gameId === 'skull_king' && state.roomCode === store().roomCode && acceptsSkullRevision(state.revision)) {
        store().setSkullKingSyncing(true);
        pendingSkullPrivate = state;
        adoptSkullPair();
      }
      else if (gameId === 'citadels' && state.roomCode === store().roomCode && acceptsCitadelsRevision(state.revision)) {
        store().setCitadelsSyncing(true);
        pendingCitadelsPrivate = state;
        adoptCitadelsPair();
      }
      else if (gameId === 'not_alone' && state.roomCode === store().roomCode && acceptsNotAloneRevision(state.revision)) {
        store().setNotAloneSyncing(true);
        pendingNotAlonePrivate = state;
        adoptNotAlonePair();
      }
      else if (gameId === 'bang' && state.roomCode === store().roomCode && acceptsBangRevision(state.revision)) {
        store().setBangSyncing(true);
        pendingBangPrivate = state;
        adoptBangPair();
      }
      else if (gameId === 'libertalia' && state.roomCode === store().roomCode && acceptsLibertaliaRevision(state.revision)) {
        store().setLibertaliaSyncing(true);
        pendingLibertaliaPrivate = state;
        adoptLibertaliaPair();
      }
      else if (gameId === 'colt_express' && state.roomCode === store().roomCode && acceptsColtRevision(state.revision)) {
        store().setColtSyncing(true);
        pendingColtPrivate = state;
        adoptColtPair();
      }
      else if (gameId === 'saboteur' && state.roomCode === store().roomCode && acceptsSaboteurRevision(state.revision)) {
        store().setSaboteurSyncing(true);
        pendingPrivate = state;
        adoptSaboteurPair();
      }
    });
    const endLocalSession = async (title: string, message: string) => {
      if (!ownsSession() || ending) return;
      ending = true;
      socket.disconnect();
      resetPairs();
      try {
        await clearAuthIfMatches(token);
      } catch {
        if (!ownsSession()) return;
        ending = false;
        showDialog('Could not clear saved seat', 'Your session has ended, but its saved details could not be removed. Retry to leave safely.', [
          { text: 'RETRY', onPress: () => { void endLocalSession(title, message); } },
        ]);
        cleanupDialog = useDialogStore.getState().dialog;
        return;
      }
      if (!ownsSession()) return;
      if (cleanupDialog && useDialogStore.getState().dialog === cleanupDialog) useDialogStore.getState().hide();
      cleanupDialog = null;
      store().clearAll();
      router.replace('/');
      showDialog(title, message);
    };
    socket.on('session_replaced', () => {
      void endLocalSession(
        'Session moved',
        'This player seat was opened on another tab or device. Continue there, or join again with a different player name.',
      );
    });
    socket.on('player_kicked', () => {
      void endLocalSession('Removed from room', 'The room host removed this player seat.');
    });
    socket.on('connect', () => {
      if (!acceptsState()) return;
      resetPairs();
      socket.emit('request_state');
    });
    socket.on('disconnect', () => {
      if (!ownsSession()) return;
      resetPairs();
    });
    socket.on('server_error', (error: unknown) => {
      if (!error || typeof error !== 'object' || Array.isArray(error)
        || !('message' in error) || typeof error.message !== 'string') return;
      void endLocalSession(
        'Session ended',
        error.message || 'This room or player seat is no longer available.',
      );
    });
    socket.on('connect_error', (err: unknown) => {
      if (err && typeof err === 'object' && 'message' in err && err.message === 'INVALID_TOKEN') {
        void endLocalSession('Session expired', 'Join the room again to continue playing.');
      }
    });

    return () => {
      active = false;
      socket.removeAllListeners();
      socket.disconnect();
      if (socketInstance === socket) socketInstance = null;
      if (cleanupDialog && useDialogStore.getState().dialog === cleanupDialog) useDialogStore.getState().hide();
    };
  }, [token]);
}

export function getSocket(): Socket | null {
  return socketInstance;
}
