import { create } from 'zustand';
import type {
  SaboteurPublicState,
  SaboteurPrivateState,
  CoupPublicState,
  CoupPrivateState,
  RoomPublicState,
} from '@zuychin-arcade/types';

export interface AuthState {
  token: string;
  playerId: string;
  displayName: string;
  roomCode: string;
}

interface GameStore {
  // Auth
  token: string | null;
  playerId: string | null;
  displayName: string | null;
  roomCode: string | null;

  // Room
  room: RoomPublicState | null;

  // Saboteur game state
  publicState: SaboteurPublicState | null;
  privateState: SaboteurPrivateState | null;

  // Coup game state
  coupPublic: CoupPublicState | null;
  coupPrivate: CoupPrivateState | null;

  // Selected card (for plays)
  selectedCardId: string | null;
  rotated: boolean;

  // Actions
  setAuth: (auth: AuthState) => void;
  setRoom: (room: RoomPublicState) => void;
  setPublicState: (state: SaboteurPublicState) => void;
  setPrivateState: (state: SaboteurPrivateState) => void;
  setCoupPublic: (state: CoupPublicState) => void;
  setCoupPrivate: (state: CoupPrivateState) => void;
  setSelectedCard: (cardId: string | null) => void;
  toggleRotated: () => void;
  clearAll: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  token: null,
  playerId: null,
  displayName: null,
  roomCode: null,
  room: null,
  publicState: null,
  privateState: null,
  coupPublic: null,
  coupPrivate: null,
  selectedCardId: null,
  rotated: false,

  setAuth: (auth) => set(auth),
  setRoom: (room) => set({ room }),
  setPublicState: (publicState) => set({ publicState }),
  setPrivateState: (privateState) => set({ privateState }),
  setCoupPublic: (coupPublic) => set({ coupPublic }),
  setCoupPrivate: (coupPrivate) => set({ coupPrivate }),
  setSelectedCard: (selectedCardId) => set({ selectedCardId, rotated: false }),
  toggleRotated: () => set((s) => ({ rotated: !s.rotated })),
  clearAll: () =>
    set({
      token: null,
      playerId: null,
      displayName: null,
      roomCode: null,
      room: null,
      publicState: null,
      privateState: null,
      coupPublic: null,
      coupPrivate: null,
      selectedCardId: null,
      rotated: false,
    }),
}));
