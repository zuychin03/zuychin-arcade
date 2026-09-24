import { create } from 'zustand';
import type {
  SaboteurPublicState,
  SaboteurPrivateState,
  CoupPublicState,
  CoupPrivateState,
  KingOfTokyoPublicState,
  SkullKingPrivateState,
  SkullKingPublicState,
  CitadelsPrivateState,
  CitadelsPublicState,
  NotAlonePrivateState,
  NotAlonePublicState,
  BangPrivateState,
  BangPublicState,
  LibertaliaPrivateState,
  LibertaliaPublicState,
  ColtPrivateState,
  ColtPublicState,
  DixitPublicState,
  DixitPrivateState,
  CartographersHeroesPublicState,
  CartographersHeroesPrivateState,
  FeedTheKrakenPublicState,
  FeedTheKrakenPrivateState,
  TelestrationsPublicState,
  TelestrationsPrivateState,
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
  saboteurSyncing: boolean;

  // Coup game state
  coupPublic: CoupPublicState | null;
  coupPrivate: CoupPrivateState | null;
  coupSyncing: boolean;

  // One viewer-specific frame includes private Lab offers and preferences.
  kingOfTokyoPublic: KingOfTokyoPublicState | null;
  kingOfTokyoSyncing: boolean;

  // Skull King has a shared table plus a viewer-specific hand.
  skullKingPublic: SkullKingPublicState | null;
  skullKingPrivate: SkullKingPrivateState | null;
  skullKingSyncing: boolean;

  // Citadels keeps the draft and hand viewer-specific.
  citadelsPublic: CitadelsPublicState | null;
  citadelsPrivate: CitadelsPrivateState | null;
  citadelsSyncing: boolean;

  // Not Alone separates asymmetric hands and hidden destinations per viewer.
  notAlonePublic: NotAlonePublicState | null;
  notAlonePrivate: NotAlonePrivateState | null;
  notAloneSyncing: boolean;
  bangPublic: BangPublicState | null;
  bangPrivate: BangPrivateState | null;
  bangSyncing: boolean;
  libertaliaPublic: LibertaliaPublicState | null;
  libertaliaPrivate: LibertaliaPrivateState | null;
  libertaliaSyncing: boolean;
  coltPublic: ColtPublicState | null;
  coltPrivate: ColtPrivateState | null;
  coltSyncing: boolean;
  dixitPublic: DixitPublicState | null;
  dixitPrivate: DixitPrivateState | null;
  dixitSyncing: boolean;
  cartographersPublic: CartographersHeroesPublicState | null;
  cartographersPrivate: CartographersHeroesPrivateState | null;
  cartographersSyncing: boolean;
  krakenPublic: FeedTheKrakenPublicState | null;
  krakenPrivate: FeedTheKrakenPrivateState | null;
  krakenSyncing: boolean;
  telestrationsPublic: TelestrationsPublicState | null;
  telestrationsPrivate: TelestrationsPrivateState | null;
  telestrationsSyncing: boolean;

  // Selected card (for plays)
  selectedCardId: string | null;
  rotated: boolean;

  // Actions
  setAuth: (auth: AuthState) => void;
  setRoom: (room: RoomPublicState) => void;
  setPublicState: (state: SaboteurPublicState) => void;
  setPrivateState: (state: SaboteurPrivateState) => void;
  setSaboteurState: (publicState: SaboteurPublicState, privateState: SaboteurPrivateState) => void;
  setSaboteurSyncing: (syncing: boolean) => void;
  setCoupPublic: (state: CoupPublicState) => void;
  setCoupPrivate: (state: CoupPrivateState) => void;
  setCoupState: (publicState: CoupPublicState, privateState: CoupPrivateState) => void;
  setCoupSyncing: (syncing: boolean) => void;
  setKingOfTokyoPublic: (state: KingOfTokyoPublicState) => void;
  setKingOfTokyoSyncing: (syncing: boolean) => void;
  setSkullKingPublic: (state: SkullKingPublicState) => void;
  setSkullKingPrivate: (state: SkullKingPrivateState) => void;
  setSkullKingState: (publicState: SkullKingPublicState, privateState: SkullKingPrivateState) => void;
  setSkullKingSyncing: (syncing: boolean) => void;
  setCitadelsPublic: (state: CitadelsPublicState) => void;
  setCitadelsPrivate: (state: CitadelsPrivateState) => void;
  setCitadelsState: (publicState: CitadelsPublicState, privateState: CitadelsPrivateState) => void;
  setCitadelsSyncing: (syncing: boolean) => void;
  setNotAlonePublic: (state: NotAlonePublicState) => void;
  setNotAlonePrivate: (state: NotAlonePrivateState) => void;
  setNotAloneState: (publicState: NotAlonePublicState, privateState: NotAlonePrivateState) => void;
  setNotAloneSyncing: (syncing: boolean) => void;
  setBangPublic: (state: BangPublicState) => void;
  setBangPrivate: (state: BangPrivateState) => void;
  setBangState: (publicState: BangPublicState, privateState: BangPrivateState) => void;
  setBangSyncing: (syncing: boolean) => void;
  setLibertaliaPublic: (state: LibertaliaPublicState) => void;
  setLibertaliaPrivate: (state: LibertaliaPrivateState) => void;
  setLibertaliaState: (publicState: LibertaliaPublicState, privateState: LibertaliaPrivateState) => void;
  setLibertaliaSyncing: (syncing: boolean) => void;
  setColtPublic: (state: ColtPublicState) => void;
  setColtPrivate: (state: ColtPrivateState) => void;
  setColtState: (publicState: ColtPublicState, privateState: ColtPrivateState) => void;
  setColtSyncing: (syncing: boolean) => void;
  setDixitState: (publicState: DixitPublicState, privateState: DixitPrivateState) => void;
  setDixitSyncing: (syncing: boolean) => void;
  setCartographersState: (publicState: CartographersHeroesPublicState, privateState: CartographersHeroesPrivateState) => void;
  setCartographersSyncing: (syncing: boolean) => void;
  setKrakenState: (publicState: FeedTheKrakenPublicState, privateState: FeedTheKrakenPrivateState) => void;
  setKrakenSyncing: (syncing: boolean) => void;
  setTelestrationsState: (publicState: TelestrationsPublicState, privateState: TelestrationsPrivateState) => void;
  setTelestrationsSyncing: (syncing: boolean) => void;
  setSelectedCard: (cardId: string | null) => void;
  toggleRotated: () => void;
  clearAll: () => void;
}

const emptyState = () => ({
  token: null,
  playerId: null,
  displayName: null,
  roomCode: null,
  room: null,
  publicState: null,
  privateState: null,
  saboteurSyncing: true,
  coupPublic: null,
  coupPrivate: null,
  coupSyncing: true,
  kingOfTokyoPublic: null,
  kingOfTokyoSyncing: true,
  skullKingPublic: null,
  skullKingPrivate: null,
  skullKingSyncing: true,
  citadelsPublic: null,
  citadelsPrivate: null,
  citadelsSyncing: true,
  notAlonePublic: null,
  notAlonePrivate: null,
  notAloneSyncing: true,
  bangPublic: null,
  bangPrivate: null,
  bangSyncing: true,
  libertaliaPublic: null,
  libertaliaPrivate: null,
  libertaliaSyncing: true,
  coltPublic: null,
  coltPrivate: null,
  coltSyncing: true,
  dixitPublic: null,
  dixitPrivate: null,
  dixitSyncing: true,
  cartographersPublic: null,
  cartographersPrivate: null,
  cartographersSyncing: true,
  krakenPublic: null,
  krakenPrivate: null,
  krakenSyncing: true,
  telestrationsPublic: null,
  telestrationsPrivate: null,
  telestrationsSyncing: true,
  selectedCardId: null,
  rotated: false,
});

export const useGameStore = create<GameStore>((set) => ({
  ...emptyState(),
  setAuth: (auth) => set((state) => state.token === auth.token
    && state.playerId === auth.playerId && state.roomCode === auth.roomCode
    ? auth : { ...emptyState(), ...auth }),
  setRoom: (room) => set({ room }),
  setPublicState: (publicState) => set({ publicState }),
  setPrivateState: (privateState) => set({ privateState }),
  setSaboteurState: (publicState, privateState) => set({ publicState, privateState, saboteurSyncing: false }),
  setSaboteurSyncing: (saboteurSyncing) => set({ saboteurSyncing }),
  setCoupPublic: (coupPublic) => set({ coupPublic }),
  setCoupPrivate: (coupPrivate) => set({ coupPrivate }),
  setCoupState: (coupPublic, coupPrivate) => set({ coupPublic, coupPrivate, coupSyncing: false }),
  setCoupSyncing: (coupSyncing) => set({ coupSyncing }),
  setKingOfTokyoPublic: (kingOfTokyoPublic) => set({ kingOfTokyoPublic, kingOfTokyoSyncing: false }),
  setKingOfTokyoSyncing: (kingOfTokyoSyncing) => set({ kingOfTokyoSyncing }),
  setSkullKingPublic: (skullKingPublic) => set({ skullKingPublic }),
  setSkullKingPrivate: (skullKingPrivate) => set({ skullKingPrivate }),
  setSkullKingState: (skullKingPublic, skullKingPrivate) => set({ skullKingPublic, skullKingPrivate, skullKingSyncing: false }),
  setSkullKingSyncing: (skullKingSyncing) => set({ skullKingSyncing }),
  setCitadelsPublic: (citadelsPublic) => set({ citadelsPublic }),
  setCitadelsPrivate: (citadelsPrivate) => set({ citadelsPrivate }),
  setCitadelsState: (citadelsPublic, citadelsPrivate) => set({ citadelsPublic, citadelsPrivate, citadelsSyncing: false }),
  setCitadelsSyncing: (citadelsSyncing) => set({ citadelsSyncing }),
  setNotAlonePublic: (notAlonePublic) => set({ notAlonePublic }),
  setNotAlonePrivate: (notAlonePrivate) => set({ notAlonePrivate }),
  setNotAloneState: (notAlonePublic, notAlonePrivate) => set({ notAlonePublic, notAlonePrivate, notAloneSyncing: false }),
  setNotAloneSyncing: (notAloneSyncing) => set({ notAloneSyncing }),
  setBangPublic: (bangPublic) => set({ bangPublic }),
  setBangPrivate: (bangPrivate) => set({ bangPrivate }),
  setBangState: (bangPublic, bangPrivate) => set({ bangPublic, bangPrivate, bangSyncing: false }),
  setBangSyncing: (bangSyncing) => set({ bangSyncing }),
  setLibertaliaPublic: (libertaliaPublic) => set({ libertaliaPublic }),
  setLibertaliaPrivate: (libertaliaPrivate) => set({ libertaliaPrivate }),
  setLibertaliaState: (libertaliaPublic, libertaliaPrivate) => set({ libertaliaPublic, libertaliaPrivate, libertaliaSyncing: false }),
  setLibertaliaSyncing: (libertaliaSyncing) => set({ libertaliaSyncing }),
  setColtPublic: (coltPublic) => set({ coltPublic }),
  setColtPrivate: (coltPrivate) => set({ coltPrivate }),
  setColtState: (coltPublic, coltPrivate) => set({ coltPublic, coltPrivate, coltSyncing: false }),
  setColtSyncing: (coltSyncing) => set({ coltSyncing }),
  setDixitState: (dixitPublic, dixitPrivate) => set({ dixitPublic, dixitPrivate, dixitSyncing: false }),
  setDixitSyncing: (dixitSyncing) => set({ dixitSyncing }),
  setCartographersState: (cartographersPublic, cartographersPrivate) => set({ cartographersPublic, cartographersPrivate, cartographersSyncing: false }),
  setCartographersSyncing: (cartographersSyncing) => set({ cartographersSyncing }),
  setKrakenState: (krakenPublic, krakenPrivate) => set({ krakenPublic, krakenPrivate, krakenSyncing: false }),
  setKrakenSyncing: (krakenSyncing) => set({ krakenSyncing }),
  setTelestrationsState: (telestrationsPublic, telestrationsPrivate) => set({ telestrationsPublic, telestrationsPrivate, telestrationsSyncing: false }),
  setTelestrationsSyncing: (telestrationsSyncing) => set({ telestrationsSyncing }),
  setSelectedCard: (selectedCardId) => set({ selectedCardId, rotated: false }),
  toggleRotated: () => set((s) => ({ rotated: !s.rotated })),
  clearAll: () => set(emptyState()),
}));
