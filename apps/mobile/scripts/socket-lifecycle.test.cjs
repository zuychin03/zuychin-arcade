const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const auth = (token = 'original', playerId = 'p0', roomCode = 'ABCD-EFGH') => ({ token, playerId, roomCode, displayName: 'Tester' });
const publicState = (revision, extra = {}) => ({ gameId: 'saboteur', roomCode: 'ABCD-EFGH', revision, status: 'playing', ...extra });
const privateState = (revision, extra = {}) => ({ gameId: 'saboteur', roomCode: 'ABCD-EFGH', playerId: 'p0', revision, hand: [], ...extra });
const coupPublic = (revision, extra = {}) => publicState(revision, { gameId: 'coup', ...extra });
const coupPrivate = (revision, extra = {}) => ({ gameId: 'coup', roomCode: 'ABCD-EFGH', playerId: 'p0', revision, influences: [], ...extra });
const bangPublic = (revision, extra = {}) => publicState(revision, { gameId: 'bang', ...extra });
const bangPrivate = (revision, extra = {}) => privateState(revision, { gameId: 'bang', ...extra });
const tokyoState = (revision, extra = {}) => publicState(revision, { gameId: 'king_of_tokyo', viewerPlayerId: 'p0', labCard: null, ...extra });
const skullPublic = (revision, extra = {}) => publicState(revision, { gameId: 'skull_king', ...extra });
const skullPrivate = (revision, extra = {}) => privateState(revision, { gameId: 'skull_king', ...extra });
const citadelsPublic = (revision, extra = {}) => publicState(revision, { gameId: 'citadels', ...extra });
const citadelsPrivate = (revision, extra = {}) => privateState(revision, { gameId: 'citadels', ...extra });
const notAlonePublic = (revision, extra = {}) => publicState(revision, { gameId: 'not_alone', viewerPlayerId: 'p0', ...extra });
const notAlonePrivate = (revision, extra = {}) => privateState(revision, { gameId: 'not_alone', ...extra });
const libertaliaPublic = (revision, extra = {}) => publicState(revision, { gameId: 'libertalia', ...extra });
const libertaliaPrivate = (revision, extra = {}) => privateState(revision, { gameId: 'libertalia', ...extra });
const coltPublic = (revision, extra = {}) => publicState(revision, { gameId: 'colt_express', ...extra });
const coltPrivate = (revision, extra = {}) => privateState(revision, { gameId: 'colt_express', ...extra });

function load(relative, modules) {
  const filename = path.join(__dirname, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports;
}

function setup(remove = async () => undefined) {
  const changes = [];
  const { useGameStore: store } = load('../store/useGameStore.ts', {
    zustand: { create(initialise) {
      let state;
      const set = (update) => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; changes.push(state); };
      state = initialise(set);
      const useStore = (selector) => selector(state);
      useStore.getState = () => state;
      return useStore;
    } },
  });
  const sockets = [];
  const routes = [];
  const removedTokens = [];
  const dialogs = [];
  let currentDialog = null;
  let cleanup;
  let effect;
  const dialogStore = {
    getState: () => ({ dialog: currentDialog, hide: () => { currentDialog = null; } }),
  };
  const hook = load('../hooks/useSocket.ts', {
    react: { useEffect: (next) => { effect = next; } },
    'socket.io-client': { io: () => {
      const handlers = new Map();
      const socket = {
        connected: true,
        sent: [],
        disconnected: 0,
        on(event, callback) { handlers.set(event, callback); },
        emit(event, payload) { this.sent.push({ event, payload }); },
        receive(event, payload) {
          if (event === 'connect') this.connected = true;
          if (event === 'disconnect') this.connected = false;
          handlers.get(event)?.(payload);
        },
        callback(event) { return handlers.get(event); },
        disconnect() { this.connected = false; this.disconnected++; this.receive('disconnect'); },
        removeAllListeners() { handlers.clear(); },
        get listenerCount() { return handlers.size; },
      };
      sockets.push(socket);
      return socket;
    } },
    'expo-router': { router: { replace: (route) => routes.push(route) } },
    '../store/useGameStore': { useGameStore: store },
    '../constants/config': { SERVER_URL: 'https://local.invalid' },
    '../lib/storage': { clearAuthIfMatches: async (token) => { removedTokens.push(token); await remove(token); } },
    '../lib/dialog': {
      useDialogStore: dialogStore,
      showDialog(title, message, buttons) { currentDialog = { title, message, buttons }; dialogs.push(currentDialog); },
    },
  });
  store.getState().setAuth(auth());
  store.getState().setRoom({ roomCode: 'ABCD-EFGH', gameId: 'saboteur' });
  function mount() {
    cleanup?.();
    hook.useSocket();
    cleanup = effect();
    return sockets.at(-1);
  }
  return {
    store, changes, routes, removedTokens, dialogs, sockets, hook, mount,
    unmount: () => cleanup?.(),
    dialog: () => currentDialog,
    replaceDialog: () => { currentDialog = { title: 'A newer dialog' }; },
  };
}

test('Saboteur adopts only matching public/private revisions in one store update', () => {
  const h = setup();
  const socket = h.mount();
  socket.receive('game_state', publicState(1));
  assert.equal(h.store.getState().publicState, null);
  assert.equal(h.store.getState().saboteurSyncing, true);
  socket.receive('private_state', privateState(1));
  assert.equal(h.store.getState().saboteurSyncing, false);
  socket.receive('game_state', publicState(2));
  assert.equal(h.store.getState().publicState.revision, 1);
  assert.equal(h.store.getState().privateState.revision, 1);
  assert.equal(h.store.getState().saboteurSyncing, true);
  socket.receive('private_state', privateState(2));
  assert.equal(h.store.getState().publicState.revision, 2);
  assert.equal(h.store.getState().privateState.revision, 2);
  assert.equal(h.store.getState().saboteurSyncing, false);
  for (const state of h.changes) {
    if (state.publicState && state.privateState) assert.equal(state.publicState.revision, state.privateState.revision);
  }
});

test('private-first and interleaved pairs cannot roll Saboteur backwards', () => {
  const h = setup();
  const socket = h.mount();
  socket.receive('private_state', privateState(4));
  socket.receive('game_state', publicState(3));
  assert.equal(h.store.getState().publicState, null);
  socket.receive('game_state', publicState(4));
  socket.receive('game_state', publicState(2));
  socket.receive('private_state', privateState(2));
  assert.equal(h.store.getState().publicState.revision, 4);
  assert.equal(h.store.getState().saboteurSyncing, false);
  socket.receive('game_state', publicState(5));
  socket.receive('private_state', privateState(6));
  socket.receive('private_state', privateState(5));
  assert.equal(h.store.getState().publicState.revision, 4);
  socket.receive('game_state', publicState(6));
  assert.equal(h.store.getState().publicState.revision, 6);
});

test('Saboteur rejects wrong identity, absent identity and invalid revisions', () => {
  const h = setup();
  const socket = h.mount();
  for (const revision of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    socket.receive('game_state', publicState(revision));
    socket.receive('private_state', privateState(revision));
  }
  socket.receive('game_state', publicState(1, { roomCode: 'OTHER' }));
  socket.receive('game_state', publicState(1, { roomCode: undefined }));
  socket.receive('game_state', { roomCode: 'ABCD-EFGH', revision: 1 });
  socket.receive('game_state', publicState(1, { gameId: 'unknown' }));
  socket.receive('private_state', privateState(1, { playerId: 'another-player' }));
  socket.receive('private_state', privateState(1, { roomCode: 'OTHER' }));
  assert.equal(h.store.getState().publicState, null);
  assert.equal(h.store.getState().privateState, null);
});

test('reconnect preserves the display but blocks play until a fresh complete pair', () => {
  const h = setup();
  const socket = h.mount();
  socket.receive('game_state', publicState(4));
  socket.receive('private_state', privateState(4));
  socket.receive('disconnect');
  assert.equal(h.store.getState().saboteurSyncing, true);
  socket.receive('game_state', publicState(5));
  socket.receive('private_state', privateState(5));
  assert.equal(h.store.getState().publicState.revision, 4);
  assert.equal(h.store.getState().saboteurSyncing, true);
  socket.receive('connect');
  assert.equal(socket.sent.at(-1).event, 'request_state');
  socket.receive('game_state', publicState(4));
  assert.equal(h.store.getState().saboteurSyncing, true);
  assert.equal(h.store.getState().publicState.revision, 4);
  socket.receive('private_state', privateState(4));
  assert.equal(h.store.getState().saboteurSyncing, false);
});

test('monotonic rematch state replaces results without accepting old-game frames', () => {
  const h = setup();
  const socket = h.mount();
  socket.receive('game_state', publicState(90, { status: 'game_over' }));
  socket.receive('private_state', privateState(90));
  socket.receive('game_state', publicState(91));
  socket.receive('private_state', privateState(91));
  socket.receive('private_state', privateState(1));
  socket.receive('game_state', publicState(1));
  assert.equal(h.store.getState().publicState.status, 'playing');
  assert.equal(h.store.getState().privateState.revision, 91);
});

function setupCoup() {
  const h = setup();
  h.store.getState().setRoom({ roomCode: 'ABCD-EFGH', gameId: 'coup' });
  return h;
}

test('Coup adopts revision zero and later public/private pairs atomically', () => {
  const h = setupCoup();
  const socket = h.mount();
  socket.receive('game_state', coupPublic(0));
  assert.equal(h.store.getState().coupPublic, null);
  assert.equal(h.store.getState().coupSyncing, true);
  socket.receive('private_state', coupPrivate(0));
  assert.equal(h.store.getState().coupSyncing, false);
  socket.receive('game_state', coupPublic(1));
  assert.equal(h.store.getState().coupPublic.revision, 0);
  assert.equal(h.store.getState().coupPrivate.revision, 0);
  assert.equal(h.store.getState().coupSyncing, true);
  socket.receive('private_state', coupPrivate(1));
  assert.equal(h.store.getState().coupPublic.revision, 1);
  assert.equal(h.store.getState().coupSyncing, false);
  for (const state of h.changes) {
    if (state.coupPublic && state.coupPrivate) assert.equal(state.coupPublic.revision, state.coupPrivate.revision);
  }
});

test('Coup private-first and interleaved frames cannot roll the adopted pair backwards', () => {
  const h = setupCoup(); const socket = h.mount();
  socket.receive('private_state', coupPrivate(4));
  socket.receive('game_state', coupPublic(3));
  assert.equal(h.store.getState().coupPublic, null);
  socket.receive('game_state', coupPublic(4));
  socket.receive('game_state', coupPublic(5));
  socket.receive('private_state', coupPrivate(6));
  socket.receive('private_state', coupPrivate(5));
  assert.equal(h.store.getState().coupPublic.revision, 4);
  assert.equal(h.store.getState().coupSyncing, true);
  socket.receive('game_state', coupPublic(6));
  socket.receive('game_state', coupPublic(2));
  socket.receive('private_state', coupPrivate(2));
  assert.equal(h.store.getState().coupPublic.revision, 6);
  assert.equal(h.store.getState().coupSyncing, false);
});

test('Coup rejects wrong or missing identity and invalid revisions', () => {
  const h = setupCoup(); const socket = h.mount();
  for (const revision of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    socket.receive('game_state', coupPublic(revision));
    socket.receive('private_state', coupPrivate(revision));
  }
  for (const roomCode of ['OTHER', undefined]) {
    socket.receive('game_state', coupPublic(0, { roomCode }));
    socket.receive('private_state', coupPrivate(0, { roomCode }));
  }
  socket.receive('private_state', coupPrivate(0, { playerId: 'other' }));
  socket.receive('game_state', coupPublic(0, { gameId: undefined }));
  socket.receive('game_state', publicState(1));
  socket.receive('private_state', privateState(1));
  assert.equal(h.store.getState().coupPublic, null);
  assert.equal(h.store.getState().coupPrivate, null);
  assert.equal(h.store.getState().publicState, null);
});

test('Coup reconnect preserves the last display but requires a new paired snapshot', () => {
  const h = setupCoup(); const socket = h.mount();
  socket.receive('game_state', coupPublic(4)); socket.receive('private_state', coupPrivate(4));
  socket.receive('disconnect');
  assert.equal(h.store.getState().coupSyncing, true);
  socket.receive('game_state', coupPublic(5)); socket.receive('private_state', coupPrivate(5));
  assert.equal(h.store.getState().coupPublic.revision, 4);
  socket.receive('connect');
  assert.equal(socket.sent.at(-1).event, 'request_state');
  socket.receive('private_state', coupPrivate(4));
  assert.equal(h.store.getState().coupSyncing, true);
  socket.receive('game_state', coupPublic(4));
  assert.equal(h.store.getState().coupSyncing, false);
});

test('Coup monotonic rematches reject delayed previous-match frames', () => {
  const h = setupCoup(); const socket = h.mount();
  socket.receive('game_state', coupPublic(90, { status: 'game_over' }));
  socket.receive('private_state', coupPrivate(90));
  socket.receive('game_state', coupPublic(91));
  socket.receive('private_state', coupPrivate(0));
  assert.equal(h.store.getState().coupPublic.status, 'game_over');
  assert.equal(h.store.getState().coupSyncing, true);
  socket.receive('private_state', coupPrivate(91));
  socket.receive('game_state', coupPublic(89));
  assert.equal(h.store.getState().coupPublic.status, 'playing');
  assert.equal(h.store.getState().coupPrivate.revision, 91);
});

test('changing authenticated seats atomically removes obsolete game information and choices', () => {
  const h = setupCoup(); const socket = h.mount();
  socket.receive('game_state', coupPublic(4)); socket.receive('private_state', coupPrivate(4));
  h.store.getState().setSaboteurState(publicState(8), privateState(8));
  h.store.getState().setBangPrivate({ playerId: 'p0', hand: ['old secret'] });
  h.store.getState().setSelectedCard('old card');
  h.store.getState().toggleRotated();
  h.store.getState().setAuth(auth('different', 'p1', 'IJKL-MNOP'));
  const state = h.store.getState();
  assert.equal(state.room, null);
  assert.equal(state.coupPublic, null); assert.equal(state.coupPrivate, null);
  assert.equal(state.publicState, null); assert.equal(state.privateState, null);
  assert.equal(state.bangPrivate, null);
  assert.equal(state.coupSyncing, true); assert.equal(state.saboteurSyncing, true);
  assert.equal(state.bangSyncing, true);
  assert.equal(state.selectedCardId, null); assert.equal(state.rotated, false);
  socket.receive('game_state', coupPublic(5)); socket.receive('private_state', coupPrivate(5));
  assert.equal(h.store.getState().coupPublic, null);
  assert.equal(h.store.getState().token, 'different');
});

test('reapplying the same authenticated identity preserves its current display', () => {
  const h = setupCoup(); const socket = h.mount();
  socket.receive('game_state', coupPublic(4)); socket.receive('private_state', coupPrivate(4));
  const state = h.store.getState();
  state.setAuth({ ...auth(), displayName: 'Updated name' });
  assert.equal(h.store.getState().coupPublic, state.coupPublic);
  assert.equal(h.store.getState().coupPrivate, state.coupPrivate);
  assert.equal(h.store.getState().room, state.room);
  assert.equal(h.store.getState().coupSyncing, false);
});

function setupBang() {
  const h = setup();
  h.store.getState().setRoom({ roomCode: 'ABCD-EFGH', gameId: 'bang' });
  return h;
}

test('BANG adopts revision zero and later public/private pairs atomically', () => {
  const h = setupBang(); const socket = h.mount();
  socket.receive('game_state', bangPublic(0));
  assert.equal(h.store.getState().bangPublic, null);
  assert.equal(h.store.getState().bangSyncing, true);
  socket.receive('private_state', bangPrivate(0));
  assert.equal(h.store.getState().bangSyncing, false);
  socket.receive('game_state', bangPublic(1));
  assert.equal(h.store.getState().bangPublic.revision, 0);
  assert.equal(h.store.getState().bangPrivate.revision, 0);
  assert.equal(h.store.getState().bangSyncing, true);
  socket.receive('private_state', bangPrivate(1));
  assert.equal(h.store.getState().bangPublic.revision, 1);
  assert.equal(h.store.getState().bangSyncing, false);
  for (const state of h.changes) {
    if (state.bangPublic && state.bangPrivate) assert.equal(state.bangPublic.revision, state.bangPrivate.revision);
  }
});

test('BANG rejects stale partial frames in either arrival order', () => {
  for (const privateFirst of [false, true]) {
    const h = setupBang(); const socket = h.mount();
    socket.receive('game_state', bangPublic(3)); socket.receive('private_state', bangPrivate(3));
    const first = privateFirst ? 'private_state' : 'game_state';
    const second = privateFirst ? 'game_state' : 'private_state';
    const leadingFrame = privateFirst ? bangPrivate : bangPublic;
    const trailingFrame = privateFirst ? bangPublic : bangPrivate;
    socket.receive(first, leadingFrame(5));
    socket.receive(first, leadingFrame(4));
    assert.equal(h.store.getState().bangPublic.revision, 3);
    socket.receive(second, trailingFrame(5));
    assert.equal(h.store.getState().bangPublic.revision, 5);
    assert.equal(h.store.getState().bangPrivate.revision, 5);
    assert.equal(h.store.getState().bangSyncing, false);
  }
});

test('BANG rejects missing or wrong identity and invalid revisions', () => {
  const h = setupBang(); const socket = h.mount();
  for (const revision of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    socket.receive('game_state', bangPublic(revision)); socket.receive('private_state', bangPrivate(revision));
  }
  for (const roomCode of ['OTHER', undefined]) {
    socket.receive('game_state', bangPublic(0, { roomCode }));
    socket.receive('private_state', bangPrivate(0, { roomCode }));
  }
  socket.receive('private_state', bangPrivate(0, { playerId: 'other' }));
  socket.receive('game_state', bangPublic(0, { gameId: undefined }));
  socket.receive('game_state', coupPublic(0)); socket.receive('private_state', coupPrivate(0));
  assert.equal(h.store.getState().bangPublic, null);
  assert.equal(h.store.getState().bangPrivate, null);
  assert.equal(h.store.getState().coupPublic, null);
});

test('BANG reconnect retains the display but fences play until a fresh pair', () => {
  const h = setupBang(); const socket = h.mount();
  socket.receive('game_state', bangPublic(4)); socket.receive('private_state', bangPrivate(4));
  socket.receive('disconnect');
  assert.equal(h.store.getState().bangSyncing, true);
  socket.receive('game_state', bangPublic(5)); socket.receive('private_state', bangPrivate(5));
  assert.equal(h.store.getState().bangPublic.revision, 4);
  socket.receive('connect');
  assert.equal(socket.sent.at(-1).event, 'request_state');
  socket.receive('private_state', bangPrivate(4));
  assert.equal(h.store.getState().bangSyncing, true);
  socket.receive('game_state', bangPublic(4));
  assert.equal(h.store.getState().bangSyncing, false);
});

test('BANG monotonic rematches reject delayed previous-match state', () => {
  const h = setupBang(); const socket = h.mount();
  socket.receive('game_state', bangPublic(90, { status: 'game_over' }));
  socket.receive('private_state', bangPrivate(90));
  socket.receive('game_state', bangPublic(91)); socket.receive('private_state', bangPrivate(0));
  assert.equal(h.store.getState().bangPublic.status, 'game_over');
  assert.equal(h.store.getState().bangSyncing, true);
  socket.receive('private_state', bangPrivate(91)); socket.receive('game_state', bangPublic(89));
  assert.equal(h.store.getState().bangPublic.status, 'playing');
  assert.equal(h.store.getState().bangPrivate.revision, 91);
});

function setupTokyo() {
  const h = setup();
  h.store.getState().setRoom({ roomCode: 'ABCD-EFGH', gameId: 'king_of_tokyo' });
  return h;
}

test('King of Tokyo adopts its own complete viewer frame, including revision zero', () => {
  const h = setupTokyo(); const socket = h.mount();
  assert.equal(h.store.getState().kingOfTokyoSyncing, true);
  const state = tokyoState(0, { labCard: { instanceId: 'private-lab', cardId: 'mimic' } });
  socket.receive('game_state', state);
  assert.equal(h.store.getState().kingOfTokyoPublic, state);
  assert.equal(h.store.getState().kingOfTokyoSyncing, false);
  socket.receive('private_state', { ...state, playerId: 'p0' });
  assert.equal(h.store.getState().kingOfTokyoPublic, state);
});

test('King of Tokyo rejects wrong or absent viewer/room identity and invalid revisions', () => {
  const h = setupTokyo(); const socket = h.mount();
  for (const extra of [
    { roomCode: 'OTHER' }, { roomCode: undefined },
    { viewerPlayerId: 'p1' }, { viewerPlayerId: null }, { viewerPlayerId: undefined },
    { gameId: 'coup' }, { gameId: undefined },
  ]) socket.receive('game_state', tokyoState(0, extra));
  for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    socket.receive('game_state', tokyoState(revision));
  }
  assert.equal(h.store.getState().kingOfTokyoPublic, null);
  assert.equal(h.store.getState().kingOfTokyoSyncing, true);
});

test('King of Tokyo rejects stale frames and previous-match revisions', () => {
  const h = setupTokyo(); const socket = h.mount();
  socket.receive('game_state', tokyoState(3));
  socket.receive('game_state', tokyoState(5));
  socket.receive('game_state', tokyoState(4));
  assert.equal(h.store.getState().kingOfTokyoPublic.revision, 5);
  socket.receive('game_state', tokyoState(90, { status: 'game_over' }));
  socket.receive('game_state', tokyoState(91));
  socket.receive('game_state', tokyoState(0));
  assert.equal(h.store.getState().kingOfTokyoPublic.revision, 91);
  assert.equal(h.store.getState().kingOfTokyoPublic.status, 'playing');
});

test('King of Tokyo reconnect retains the display but needs a fresh owned frame', () => {
  const h = setupTokyo(); const socket = h.mount();
  socket.receive('game_state', tokyoState(4));
  socket.receive('disconnect');
  assert.equal(h.store.getState().kingOfTokyoSyncing, true);
  socket.receive('game_state', tokyoState(5));
  assert.equal(h.store.getState().kingOfTokyoPublic.revision, 4);
  socket.receive('connect');
  assert.equal(socket.sent.at(-1).event, 'request_state');
  socket.receive('game_state', tokyoState(3));
  socket.receive('game_state', tokyoState(4, { viewerPlayerId: 'p1' }));
  assert.equal(h.store.getState().kingOfTokyoSyncing, true);
  socket.receive('game_state', tokyoState(4));
  assert.equal(h.store.getState().kingOfTokyoSyncing, false);
});

test('King of Tokyo viewer data clears on identity replacement and ignores retired callbacks', () => {
  const h = setupTokyo(); const socket = h.mount();
  const state = tokyoState(4, { labCard: { instanceId: 'private-lab' } });
  socket.receive('game_state', state);
  const oldFrame = socket.callback('game_state');
  h.store.getState().setAuth(auth('new-token', 'p1'));
  assert.equal(h.store.getState().kingOfTokyoPublic, null);
  assert.equal(h.store.getState().kingOfTokyoSyncing, true);
  oldFrame(state);
  assert.equal(h.store.getState().kingOfTokyoPublic, null);
  h.mount().receive('game_state', tokyoState(4));
  assert.equal(h.store.getState().kingOfTokyoPublic, null);
});

function setupSkull() {
  const h = setup();
  h.store.getState().setRoom({ roomCode: 'ABCD-EFGH', gameId: 'skull_king' });
  return h;
}

test('Skull King adopts only complete public/private pairs, including revision zero', () => {
  const h = setupSkull(); const socket = h.mount();
  socket.receive('game_state', skullPublic(0));
  assert.equal(h.store.getState().skullKingPublic, null);
  assert.equal(h.store.getState().skullKingSyncing, true);
  socket.receive('private_state', skullPrivate(0));
  assert.equal(h.store.getState().skullKingSyncing, false);
  socket.receive('game_state', skullPublic(1));
  assert.equal(h.store.getState().skullKingPublic.revision, 0);
  assert.equal(h.store.getState().skullKingSyncing, true);
  socket.receive('private_state', skullPrivate(1));
  assert.equal(h.store.getState().skullKingPrivate.revision, 1);
  assert.equal(h.store.getState().skullKingSyncing, false);
  for (const state of h.changes) {
    if (state.skullKingPublic && state.skullKingPrivate) {
      assert.equal(state.skullKingPublic.revision, state.skullKingPrivate.revision);
    }
  }
});

test('Skull King rejects stale partial frames in either arrival order', () => {
  for (const privateFirst of [false, true]) {
    const h = setupSkull(); const socket = h.mount();
    socket.receive('game_state', skullPublic(3)); socket.receive('private_state', skullPrivate(3));
    const first = privateFirst ? 'private_state' : 'game_state';
    const second = privateFirst ? 'game_state' : 'private_state';
    const leading = privateFirst ? skullPrivate : skullPublic;
    const trailing = privateFirst ? skullPublic : skullPrivate;
    socket.receive(first, leading(5)); socket.receive(first, leading(4));
    assert.equal(h.store.getState().skullKingPublic.revision, 3);
    assert.equal(h.store.getState().skullKingSyncing, true);
    socket.receive(second, trailing(6)); socket.receive(second, trailing(5));
    assert.equal(h.store.getState().skullKingPublic.revision, 3);
    socket.receive(first, leading(6));
    assert.equal(h.store.getState().skullKingPublic.revision, 6);
    assert.equal(h.store.getState().skullKingPrivate.revision, 6);
    assert.equal(h.store.getState().skullKingSyncing, false);
  }
});

test('Skull King rejects missing or wrong identity and malformed revisions', () => {
  const h = setupSkull(); const socket = h.mount();
  for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    socket.receive('game_state', skullPublic(revision)); socket.receive('private_state', skullPrivate(revision));
  }
  for (const roomCode of ['OTHER', undefined]) {
    socket.receive('game_state', skullPublic(0, { roomCode }));
    socket.receive('private_state', skullPrivate(0, { roomCode }));
  }
  for (const playerId of ['other', undefined]) socket.receive('private_state', skullPrivate(0, { playerId }));
  socket.receive('game_state', skullPublic(0, { gameId: undefined }));
  socket.receive('game_state', coupPublic(0)); socket.receive('private_state', coupPrivate(0));
  assert.equal(h.store.getState().skullKingPublic, null);
  assert.equal(h.store.getState().skullKingPrivate, null);
  assert.equal(h.store.getState().coupPublic, null);
});

test('Skull King reconnect retains the last display but requires a fresh complete pair', () => {
  const h = setupSkull(); const socket = h.mount();
  socket.receive('game_state', skullPublic(4)); socket.receive('private_state', skullPrivate(4));
  socket.receive('disconnect');
  assert.equal(h.store.getState().skullKingSyncing, true);
  socket.receive('game_state', skullPublic(5)); socket.receive('private_state', skullPrivate(5));
  assert.equal(h.store.getState().skullKingPublic.revision, 4);
  socket.receive('connect');
  assert.equal(socket.sent.at(-1).event, 'request_state');
  socket.receive('private_state', skullPrivate(4));
  assert.equal(h.store.getState().skullKingSyncing, true);
  socket.receive('game_state', skullPublic(4));
  assert.equal(h.store.getState().skullKingSyncing, false);
});

test('Skull King monotonic rematches reject delayed previous-voyage frames', () => {
  const h = setupSkull(); const socket = h.mount();
  socket.receive('game_state', skullPublic(90, { status: 'game_over' }));
  socket.receive('private_state', skullPrivate(90));
  socket.receive('game_state', skullPublic(91)); socket.receive('private_state', skullPrivate(0));
  assert.equal(h.store.getState().skullKingPublic.status, 'game_over');
  assert.equal(h.store.getState().skullKingSyncing, true);
  socket.receive('private_state', skullPrivate(91)); socket.receive('game_state', skullPublic(89));
  assert.equal(h.store.getState().skullKingPublic.status, 'playing');
  assert.equal(h.store.getState().skullKingPrivate.revision, 91);
});

test('Skull King private hand clears on identity replacement and ignores retired callbacks', () => {
  const h = setupSkull(); const socket = h.mount();
  socket.receive('game_state', skullPublic(4));
  socket.receive('private_state', skullPrivate(4, { hand: ['old secret'] }));
  const oldPublic = socket.callback('game_state'); const oldPrivate = socket.callback('private_state');
  h.store.getState().setAuth(auth('new-token', 'p1'));
  assert.equal(h.store.getState().skullKingPublic, null);
  assert.equal(h.store.getState().skullKingPrivate, null);
  assert.equal(h.store.getState().skullKingSyncing, true);
  oldPublic(skullPublic(5)); oldPrivate(skullPrivate(5));
  assert.equal(h.store.getState().skullKingPrivate, null);
});

function setupCitadels() {
  const h = setup();
  h.store.getState().setRoom({ roomCode: 'ABCD-EFGH', gameId: 'citadels' });
  return h;
}

test('Citadels adopts complete revision-zero and later viewer pairs atomically', () => {
  const h = setupCitadels(); const socket = h.mount();
  socket.receive('game_state', citadelsPublic(0));
  assert.equal(h.store.getState().citadelsPublic, null);
  assert.equal(h.store.getState().citadelsSyncing, true);
  socket.receive('private_state', citadelsPrivate(0));
  assert.equal(h.store.getState().citadelsSyncing, false);
  socket.receive('game_state', citadelsPublic(1));
  assert.equal(h.store.getState().citadelsPublic.revision, 0);
  assert.equal(h.store.getState().citadelsSyncing, true);
  socket.receive('private_state', citadelsPrivate(1));
  assert.equal(h.store.getState().citadelsPrivate.revision, 1);
  assert.equal(h.store.getState().citadelsSyncing, false);
  for (const state of h.changes) {
    if (state.citadelsPublic && state.citadelsPrivate) {
      assert.equal(state.citadelsPublic.revision, state.citadelsPrivate.revision);
    }
  }
});

test('Citadels rejects stale partial frames in either arrival order', () => {
  for (const privateFirst of [false, true]) {
    const h = setupCitadels(); const socket = h.mount();
    socket.receive('game_state', citadelsPublic(3)); socket.receive('private_state', citadelsPrivate(3));
    const first = privateFirst ? 'private_state' : 'game_state';
    const second = privateFirst ? 'game_state' : 'private_state';
    const leading = privateFirst ? citadelsPrivate : citadelsPublic;
    const trailing = privateFirst ? citadelsPublic : citadelsPrivate;
    socket.receive(first, leading(5)); socket.receive(first, leading(4));
    assert.equal(h.store.getState().citadelsPublic.revision, 3);
    assert.equal(h.store.getState().citadelsSyncing, true);
    socket.receive(second, trailing(6)); socket.receive(second, trailing(5));
    assert.equal(h.store.getState().citadelsPublic.revision, 3);
    socket.receive(first, leading(6));
    assert.equal(h.store.getState().citadelsPublic.revision, 6);
    assert.equal(h.store.getState().citadelsPrivate.revision, 6);
    assert.equal(h.store.getState().citadelsSyncing, false);
  }
});

test('Citadels requires room and player identity plus a valid revision', () => {
  const h = setupCitadels(); const socket = h.mount();
  for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    socket.receive('game_state', citadelsPublic(revision)); socket.receive('private_state', citadelsPrivate(revision));
  }
  for (const roomCode of ['OTHER', undefined]) {
    socket.receive('game_state', citadelsPublic(0, { roomCode }));
    socket.receive('private_state', citadelsPrivate(0, { roomCode }));
  }
  for (const playerId of ['other', undefined]) socket.receive('private_state', citadelsPrivate(0, { playerId }));
  socket.receive('game_state', citadelsPublic(0, { gameId: undefined }));
  socket.receive('game_state', skullPublic(0)); socket.receive('private_state', skullPrivate(0));
  assert.equal(h.store.getState().citadelsPublic, null);
  assert.equal(h.store.getState().citadelsPrivate, null);
  assert.equal(h.store.getState().skullKingPublic, null);
});

test('Citadels reconnect preserves display but needs a fresh complete viewer pair', () => {
  const h = setupCitadels(); const socket = h.mount();
  socket.receive('game_state', citadelsPublic(4)); socket.receive('private_state', citadelsPrivate(4));
  socket.receive('disconnect');
  assert.equal(h.store.getState().citadelsSyncing, true);
  socket.receive('game_state', citadelsPublic(5)); socket.receive('private_state', citadelsPrivate(5));
  assert.equal(h.store.getState().citadelsPublic.revision, 4);
  socket.receive('connect');
  assert.equal(socket.sent.at(-1).event, 'request_state');
  socket.receive('private_state', citadelsPrivate(4));
  assert.equal(h.store.getState().citadelsSyncing, true);
  socket.receive('game_state', citadelsPublic(4));
  assert.equal(h.store.getState().citadelsSyncing, false);
});

test('Citadels monotonic rematches reject old terminal and private draft frames', () => {
  const h = setupCitadels(); const socket = h.mount();
  socket.receive('game_state', citadelsPublic(90, { status: 'game_over' }));
  socket.receive('private_state', citadelsPrivate(90));
  socket.receive('game_state', citadelsPublic(91)); socket.receive('private_state', citadelsPrivate(0));
  assert.equal(h.store.getState().citadelsPublic.status, 'game_over');
  assert.equal(h.store.getState().citadelsSyncing, true);
  socket.receive('private_state', citadelsPrivate(91)); socket.receive('game_state', citadelsPublic(89));
  assert.equal(h.store.getState().citadelsPublic.status, 'playing');
  assert.equal(h.store.getState().citadelsPrivate.revision, 91);
});

test('Citadels private draft clears on identity replacement and ignores retired callbacks', () => {
  const h = setupCitadels(); const socket = h.mount();
  socket.receive('game_state', citadelsPublic(4));
  socket.receive('private_state', citadelsPrivate(4, { hand: ['old secret'], chosenRole: 'assassin' }));
  const oldPublic = socket.callback('game_state'); const oldPrivate = socket.callback('private_state');
  h.store.getState().setAuth(auth('new-token', 'p1'));
  assert.equal(h.store.getState().citadelsPublic, null);
  assert.equal(h.store.getState().citadelsPrivate, null);
  assert.equal(h.store.getState().citadelsSyncing, true);
  oldPublic(citadelsPublic(5)); oldPrivate(citadelsPrivate(5));
  assert.equal(h.store.getState().citadelsPrivate, null);
});

test('Citadels adopts round-boundary removal with the new private draft, not stale choices', () => {
  const h = setupCitadels(); const socket = h.mount();
  const players = ['p0', 'p1', 'p2', 'p3', 'p4'].map(playerId => ({ playerId, forfeited: playerId === 'p4' }));
  socket.receive('game_state', citadelsPublic(10, {
    phase: 'action', roundNumber: 1, turnOrder: players.map(player => player.playerId), players,
    terminationReason: null,
  }));
  socket.receive('private_state', citadelsPrivate(10, { chosenRole: 'magician', availableRoles: [] }));
  socket.receive('game_state', citadelsPublic(12, {
    phase: 'drafting', roundNumber: 2, turnOrder: ['p0', 'p1', 'p2', 'p3'], players,
    terminationReason: null,
  }));
  socket.receive('private_state', citadelsPrivate(10, { chosenRole: 'magician', availableRoles: [] }));
  socket.receive('private_state', citadelsPrivate(12, { playerId: 'p4', hand: ['departed secret'] }));
  assert.equal(h.store.getState().citadelsPublic.roundNumber, 1);
  assert.equal(h.store.getState().citadelsPrivate.chosenRole, 'magician');
  assert.equal(h.store.getState().citadelsSyncing, true);
  socket.receive('private_state', citadelsPrivate(12, { chosenRole: null, availableRoles: ['king', 'bishop'] }));
  const current = h.store.getState();
  assert.equal(current.citadelsPublic.roundNumber, 2);
  assert.deepEqual(current.citadelsPublic.turnOrder, ['p0', 'p1', 'p2', 'p3']);
  assert.equal(current.citadelsPublic.players.length, 5);
  assert.equal(current.citadelsPrivate.chosenRole, null);
  assert.deepEqual(current.citadelsPrivate.availableRoles, ['king', 'bishop']);
  assert.equal(current.citadelsSyncing, false);
  for (const state of h.changes) {
    if (state.citadelsPublic && state.citadelsPrivate) {
      assert.equal(state.citadelsPublic.revision, state.citadelsPrivate.revision);
    }
  }
});

test('Citadels pairs no-winner termination and clears it on a fresh rematch', () => {
  const h = setupCitadels(); const socket = h.mount();
  socket.receive('game_state', citadelsPublic(20, { phase: 'choose_cards', terminationReason: null }));
  socket.receive('private_state', citadelsPrivate(20, { drawnCards: ['plan-a', 'plan-b'] }));
  socket.receive('private_state', citadelsPrivate(21, { drawnCards: [], canAct: false, availableRoles: [] }));
  assert.equal(h.store.getState().citadelsPublic.status, 'playing');
  assert.deepEqual(h.store.getState().citadelsPrivate.drawnCards, ['plan-a', 'plan-b']);
  assert.equal(h.store.getState().citadelsSyncing, true);
  socket.receive('game_state', citadelsPublic(21, {
    status: 'game_over', phase: 'game_over', terminationReason: 'not_enough_players',
    winnerIds: [], scoreBreakdowns: {}, activePlayerId: null, draftPlayerId: null,
  }));
  assert.equal(h.store.getState().citadelsPublic.terminationReason, 'not_enough_players');
  assert.deepEqual(h.store.getState().citadelsPublic.winnerIds, []);
  assert.deepEqual(h.store.getState().citadelsPrivate.drawnCards, []);
  assert.equal(h.store.getState().citadelsSyncing, false);
  socket.receive('game_state', citadelsPublic(22, { phase: 'drafting', terminationReason: null }));
  socket.receive('private_state', citadelsPrivate(22, { drawnCards: [], availableRoles: ['king'] }));
  socket.receive('game_state', citadelsPublic(21, { status: 'game_over', terminationReason: 'not_enough_players' }));
  assert.equal(h.store.getState().citadelsPublic.status, 'playing');
  assert.equal(h.store.getState().citadelsPublic.terminationReason, null);
  assert.deepEqual(h.store.getState().citadelsPrivate.availableRoles, ['king']);
});

function setupNotAlone() {
  const h = setup();
  h.store.getState().setRoom({ roomCode: 'ABCD-EFGH', gameId: 'not_alone' });
  return h;
}

test('Not Alone adopts complete revision-zero and later viewer pairs atomically', () => {
  const h = setupNotAlone(); const socket = h.mount();
  socket.receive('game_state', notAlonePublic(0));
  assert.equal(h.store.getState().notAlonePublic, null);
  assert.equal(h.store.getState().notAloneSyncing, true);
  socket.receive('private_state', notAlonePrivate(0));
  assert.equal(h.store.getState().notAloneSyncing, false);
  socket.receive('game_state', notAlonePublic(1));
  assert.equal(h.store.getState().notAlonePublic.revision, 0);
  assert.equal(h.store.getState().notAloneSyncing, true);
  socket.receive('private_state', notAlonePrivate(1));
  assert.equal(h.store.getState().notAlonePrivate.revision, 1);
  assert.equal(h.store.getState().notAloneSyncing, false);
  for (const state of h.changes) {
    if (state.notAlonePublic && state.notAlonePrivate) {
      assert.equal(state.notAlonePublic.revision, state.notAlonePrivate.revision);
    }
  }
});

test('Not Alone rejects stale partial frames in either arrival order', () => {
  for (const privateFirst of [false, true]) {
    const h = setupNotAlone(); const socket = h.mount();
    socket.receive('game_state', notAlonePublic(3)); socket.receive('private_state', notAlonePrivate(3));
    const first = privateFirst ? 'private_state' : 'game_state';
    const second = privateFirst ? 'game_state' : 'private_state';
    const leading = privateFirst ? notAlonePrivate : notAlonePublic;
    const trailing = privateFirst ? notAlonePublic : notAlonePrivate;
    socket.receive(first, leading(5)); socket.receive(first, leading(4));
    assert.equal(h.store.getState().notAlonePublic.revision, 3);
    assert.equal(h.store.getState().notAloneSyncing, true);
    socket.receive(second, trailing(6)); socket.receive(second, trailing(5));
    assert.equal(h.store.getState().notAlonePublic.revision, 3);
    socket.receive(first, leading(6));
    assert.equal(h.store.getState().notAlonePublic.revision, 6);
    assert.equal(h.store.getState().notAlonePrivate.revision, 6);
    assert.equal(h.store.getState().notAloneSyncing, false);
  }
});

test('Not Alone requires room and player identity plus a valid revision', () => {
  const h = setupNotAlone(); const socket = h.mount();
  for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    socket.receive('game_state', notAlonePublic(revision)); socket.receive('private_state', notAlonePrivate(revision));
  }
  for (const roomCode of ['OTHER', undefined]) {
    socket.receive('game_state', notAlonePublic(0, { roomCode }));
    socket.receive('private_state', notAlonePrivate(0, { roomCode }));
  }
  for (const playerId of ['other', undefined]) socket.receive('private_state', notAlonePrivate(0, { playerId }));
  for (const viewerPlayerId of ['other', undefined]) socket.receive('game_state', notAlonePublic(0, { viewerPlayerId }));
  socket.receive('game_state', notAlonePublic(0, { gameId: undefined }));
  socket.receive('game_state', citadelsPublic(0)); socket.receive('private_state', citadelsPrivate(0));
  assert.equal(h.store.getState().notAlonePublic, null);
  assert.equal(h.store.getState().notAlonePrivate, null);
  assert.equal(h.store.getState().citadelsPublic, null);
});

test('Not Alone reconnect preserves display but requires a fresh complete pair', () => {
  const h = setupNotAlone(); const socket = h.mount();
  socket.receive('game_state', notAlonePublic(4)); socket.receive('private_state', notAlonePrivate(4));
  socket.receive('disconnect');
  assert.equal(h.store.getState().notAloneSyncing, true);
  socket.receive('game_state', notAlonePublic(5)); socket.receive('private_state', notAlonePrivate(5));
  assert.equal(h.store.getState().notAlonePublic.revision, 4);
  socket.receive('connect');
  assert.equal(socket.sent.at(-1).event, 'request_state');
  socket.receive('private_state', notAlonePrivate(4));
  assert.equal(h.store.getState().notAloneSyncing, true);
  socket.receive('game_state', notAlonePublic(4));
  assert.equal(h.store.getState().notAloneSyncing, false);
});

test('Not Alone rematch rejects old terminal and hidden destination frames', () => {
  const h = setupNotAlone(); const socket = h.mount();
  socket.receive('game_state', notAlonePublic(90, { status: 'game_over' }));
  socket.receive('private_state', notAlonePrivate(90, { selectedPlaces: [8] }));
  socket.receive('game_state', notAlonePublic(91)); socket.receive('private_state', notAlonePrivate(0));
  assert.equal(h.store.getState().notAlonePublic.status, 'game_over');
  assert.equal(h.store.getState().notAloneSyncing, true);
  socket.receive('private_state', notAlonePrivate(91, { selectedPlaces: [] }));
  socket.receive('game_state', notAlonePublic(89));
  assert.equal(h.store.getState().notAlonePublic.status, 'playing');
  assert.deepEqual(h.store.getState().notAlonePrivate.selectedPlaces, []);
});

test('Not Alone identity replacement clears private information and retires callbacks', () => {
  const h = setupNotAlone(); const socket = h.mount();
  socket.receive('game_state', notAlonePublic(4));
  socket.receive('private_state', notAlonePrivate(4, { role: 'creature', huntHand: ['despair'] }));
  const oldPublic = socket.callback('game_state'); const oldPrivate = socket.callback('private_state');
  h.store.getState().setAuth(auth('new-token', 'p1'));
  assert.equal(h.store.getState().notAlonePublic, null);
  assert.equal(h.store.getState().notAlonePrivate, null);
  assert.equal(h.store.getState().notAloneSyncing, true);
  oldPublic(notAlonePublic(5)); oldPrivate(notAlonePrivate(5));
  assert.equal(h.store.getState().notAlonePrivate, null);
});

test('Not Alone Shelter choice and public reckoning advance together', () => {
  const h = setupNotAlone(); const socket = h.mount();
  socket.receive('game_state', notAlonePublic(20, { phase: 'reckoning', pendingPlayerId: 'p0' }));
  socket.receive('private_state', notAlonePrivate(20, { canChooseSurvivalCard: true, survivalChoiceCards: ['dodge', 'gate'] }));
  socket.receive('private_state', notAlonePrivate(21, { canChooseSurvivalCard: false, survivalChoiceCards: [] }));
  assert.equal(h.store.getState().notAlonePublic.pendingPlayerId, 'p0');
  assert.equal(h.store.getState().notAlonePrivate.canChooseSurvivalCard, true);
  assert.equal(h.store.getState().notAloneSyncing, true);
  socket.receive('game_state', notAlonePublic(21, { phase: 'reckoning', pendingPlayerId: 'p2' }));
  assert.equal(h.store.getState().notAlonePublic.pendingPlayerId, 'p2');
  assert.deepEqual(h.store.getState().notAlonePrivate.survivalChoiceCards, []);
  assert.equal(h.store.getState().notAloneSyncing, false);
});

test('Not Alone copied power options advance atomically within the same physical event', () => {
  const h = setupNotAlone(); const socket = h.mount();
  const publicEvent = { phase: 'reckoning', pendingPlayerId: 'p0', pendingPlaceId: 1, pendingPlaceIndex: 0 };
  socket.receive('game_state', notAlonePublic(30, publicEvent));
  socket.receive('private_state', notAlonePrivate(30, {
    resolutionOptions: { effectivePlaceId: 1, copyablePlaceIds: [5], roverPlaceIds: [], mustUsePlacePower: false },
  }));
  socket.receive('private_state', notAlonePrivate(31, {
    resolutionOptions: { effectivePlaceId: 5, copyablePlaceIds: [], roverPlaceIds: [6, 7], mustUsePlacePower: true },
  }));
  assert.equal(h.store.getState().notAlonePrivate.resolutionOptions.effectivePlaceId, 1);
  assert.equal(h.store.getState().notAloneSyncing, true);
  socket.receive('game_state', notAlonePublic(31, publicEvent));
  assert.equal(h.store.getState().notAlonePublic.pendingPlaceId, 1);
  assert.equal(h.store.getState().notAlonePrivate.resolutionOptions.effectivePlaceId, 5);
  assert.deepEqual(h.store.getState().notAlonePrivate.resolutionOptions.roverPlaceIds, [6, 7]);
  assert.equal(h.store.getState().notAloneSyncing, false);
});

test('Not Alone pairs round-boundary retirement with the surviving private decision', () => {
  for (const privateFirst of [false, true]) {
    const h = setupNotAlone(); const socket = h.mount();
    const players = ['p0', 'p1', 'p2'].map(playerId => ({ playerId, forfeited: playerId === 'p2' }));
    socket.receive('game_state', notAlonePublic(50, {
      phase: 'end_of_turn', roundNumber: 1, huntedOrder: ['p1', 'p2'], players,
      rescueGoal: 14, assimilationGoal: 8,
    }));
    socket.receive('private_state', notAlonePrivate(50, { canEndTurn: true }));
    const nextPublic = notAlonePublic(51, {
      phase: 'hunted_planning', roundNumber: 2, huntedOrder: ['p1'], players,
      rescueGoal: 14, assimilationGoal: 8,
    });
    const nextPrivate = notAlonePrivate(51, { canEndTurn: false, selectedPlaces: [], cardChoice: null });
    socket.receive(privateFirst ? 'private_state' : 'game_state', privateFirst ? nextPrivate : nextPublic);
    socket.receive('private_state', notAlonePrivate(50, { canEndTurn: true }));
    socket.receive('private_state', notAlonePrivate(51, { playerId: 'p2', survivalHand: ['departed secret'] }));
    assert.equal(h.store.getState().notAlonePublic.roundNumber, 1);
    assert.equal(h.store.getState().notAlonePrivate.canEndTurn, true);
    assert.equal(h.store.getState().notAloneSyncing, true);
    socket.receive(privateFirst ? 'game_state' : 'private_state', privateFirst ? nextPublic : nextPrivate);
    const current = h.store.getState();
    assert.equal(current.notAlonePublic.roundNumber, 2);
    assert.deepEqual(current.notAlonePublic.huntedOrder, ['p1']);
    assert.equal(current.notAlonePublic.players.length, 3);
    assert.equal(current.notAlonePublic.rescueGoal, 14);
    assert.equal(current.notAlonePublic.assimilationGoal, 8);
    assert.equal(current.notAlonePrivate.canEndTurn, false);
    assert.equal(current.notAloneSyncing, false);
    for (const state of h.changes) {
      if (state.notAlonePublic && state.notAlonePrivate) {
        assert.equal(state.notAlonePublic.revision, state.notAlonePrivate.revision);
      }
    }
  }
});

test('Not Alone rematch replaces retired history without adopting an old private frame', () => {
  const h = setupNotAlone(); const socket = h.mount();
  socket.receive('game_state', notAlonePublic(90, {
    status: 'game_over', huntedOrder: ['p1'], rescueGoal: 14, assimilationGoal: 8,
    players: [{ playerId: 'p0' }, { playerId: 'p1' }, { playerId: 'p2', forfeited: true }],
  }));
  socket.receive('private_state', notAlonePrivate(90, { selectedPlaces: [2], canEndTurn: false }));
  socket.receive('game_state', notAlonePublic(91, {
    huntedOrder: ['p1'], rescueGoal: 13, assimilationGoal: 7,
    players: [{ playerId: 'p0' }, { playerId: 'p1' }],
  }));
  socket.receive('private_state', notAlonePrivate(90, { selectedPlaces: [2] }));
  assert.equal(h.store.getState().notAlonePublic.players.length, 3);
  assert.equal(h.store.getState().notAloneSyncing, true);
  socket.receive('private_state', notAlonePrivate(91, { selectedPlaces: [], survivalChoiceCards: [] }));
  assert.equal(h.store.getState().notAlonePublic.players.length, 2);
  assert.equal(h.store.getState().notAlonePublic.rescueGoal, 13);
  assert.deepEqual(h.store.getState().notAlonePrivate.selectedPlaces, []);
  assert.equal(h.store.getState().notAloneSyncing, false);
});

test('Not Alone never adopts another viewer public discard trail into an established pair', () => {
  const h = setupNotAlone(); const socket = h.mount();
  socket.receive('game_state', notAlonePublic(40, { players: [{ playerId: 'p1', discard: [], discardCount: 2 }] }));
  socket.receive('private_state', notAlonePrivate(40));
  socket.receive('game_state', notAlonePublic(41, { viewerPlayerId: 'p1', players: [{ playerId: 'p1', discard: [2, 4], discardCount: 2 }] }));
  socket.receive('private_state', notAlonePrivate(41));
  assert.equal(h.store.getState().notAlonePublic.revision, 40);
  assert.deepEqual(h.store.getState().notAlonePublic.players[0].discard, []);
  assert.equal(h.store.getState().notAloneSyncing, true);
  socket.receive('game_state', notAlonePublic(41, { players: [{ playerId: 'p1', discard: [], discardCount: 2 }] }));
  assert.equal(h.store.getState().notAlonePublic.revision, 41);
  assert.deepEqual(h.store.getState().notAlonePublic.players[0].discard, []);
  assert.equal(h.store.getState().notAloneSyncing, false);
});

function setupLibertalia() {
  const h = setup();
  h.store.getState().setRoom({ roomCode: 'ABCD-EFGH', gameId: 'libertalia' });
  return h;
}

test('Libertalia commits matching public and private frames atomically', () => {
  const h = setupLibertalia(); const socket = h.mount();
  socket.receive('game_state', libertaliaPublic(0));
  assert.equal(h.store.getState().libertaliaPublic, null);
  assert.equal(h.store.getState().libertaliaSyncing, true);
  socket.receive('private_state', libertaliaPrivate(0));
  assert.equal(h.store.getState().libertaliaSyncing, false);
  socket.receive('private_state', libertaliaPrivate(1, { hand: [4, 9] }));
  assert.equal(h.store.getState().libertaliaPublic.revision, 0);
  assert.equal(h.store.getState().libertaliaSyncing, true);
  socket.receive('game_state', libertaliaPublic(1));
  assert.deepEqual(h.store.getState().libertaliaPrivate.hand, [4, 9]);
  assert.equal(h.store.getState().libertaliaSyncing, false);
  for (const state of h.changes) {
    if (state.libertaliaPublic && state.libertaliaPrivate) {
      assert.equal(state.libertaliaPublic.revision, state.libertaliaPrivate.revision);
    }
  }
});

test('Libertalia ignores regressive partial frames in either arrival order', () => {
  for (const privateFirst of [false, true]) {
    const h = setupLibertalia(); const socket = h.mount();
    socket.receive('game_state', libertaliaPublic(3)); socket.receive('private_state', libertaliaPrivate(3));
    const first = privateFirst ? 'private_state' : 'game_state';
    const second = privateFirst ? 'game_state' : 'private_state';
    const leading = privateFirst ? libertaliaPrivate : libertaliaPublic;
    const trailing = privateFirst ? libertaliaPublic : libertaliaPrivate;
    socket.receive(first, leading(5)); socket.receive(first, leading(4));
    assert.equal(h.store.getState().libertaliaPublic.revision, 3);
    assert.equal(h.store.getState().libertaliaSyncing, true);
    socket.receive(second, trailing(6)); socket.receive(second, trailing(5));
    assert.equal(h.store.getState().libertaliaPublic.revision, 3);
    socket.receive(first, leading(6));
    assert.equal(h.store.getState().libertaliaPublic.revision, 6);
    assert.equal(h.store.getState().libertaliaPrivate.revision, 6);
    assert.equal(h.store.getState().libertaliaSyncing, false);
  }
});

test('Libertalia requires explicit room, player and safe revision identity', () => {
  const h = setupLibertalia(); const socket = h.mount();
  for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    socket.receive('game_state', libertaliaPublic(revision)); socket.receive('private_state', libertaliaPrivate(revision));
  }
  for (const roomCode of ['OTHER', undefined]) {
    socket.receive('game_state', libertaliaPublic(0, { roomCode }));
    socket.receive('private_state', libertaliaPrivate(0, { roomCode }));
  }
  for (const playerId of ['other', undefined]) socket.receive('private_state', libertaliaPrivate(0, { playerId }));
  socket.receive('game_state', libertaliaPublic(0, { gameId: undefined }));
  socket.receive('game_state', notAlonePublic(0)); socket.receive('private_state', notAlonePrivate(0));
  assert.equal(h.store.getState().libertaliaPublic, null);
  assert.equal(h.store.getState().libertaliaPrivate, null);
  assert.equal(h.store.getState().notAlonePublic, null);
});

test('Libertalia reconnect preserves the display but requires a fresh matching pair', () => {
  const h = setupLibertalia(); const socket = h.mount();
  socket.receive('game_state', libertaliaPublic(4)); socket.receive('private_state', libertaliaPrivate(4));
  socket.receive('disconnect');
  assert.equal(h.store.getState().libertaliaSyncing, true);
  socket.receive('game_state', libertaliaPublic(5)); socket.receive('private_state', libertaliaPrivate(5));
  assert.equal(h.store.getState().libertaliaPublic.revision, 4);
  socket.receive('connect');
  assert.equal(socket.sent.at(-1).event, 'request_state');
  socket.receive('private_state', libertaliaPrivate(4));
  assert.equal(h.store.getState().libertaliaSyncing, true);
  socket.receive('game_state', libertaliaPublic(4));
  assert.equal(h.store.getState().libertaliaSyncing, false);
});

test('Libertalia rematch rejects old results and prior-voyage private hands', () => {
  const h = setupLibertalia(); const socket = h.mount();
  socket.receive('game_state', libertaliaPublic(90, { status: 'game_over', voyage: 3 }));
  socket.receive('private_state', libertaliaPrivate(90, { hand: [3], selectedRank: 8 }));
  socket.receive('game_state', libertaliaPublic(91, { voyage: 1 }));
  socket.receive('private_state', libertaliaPrivate(0));
  assert.equal(h.store.getState().libertaliaPublic.status, 'game_over');
  assert.equal(h.store.getState().libertaliaSyncing, true);
  socket.receive('private_state', libertaliaPrivate(91, { hand: [10, 13], selectedRank: null }));
  socket.receive('game_state', libertaliaPublic(89));
  assert.equal(h.store.getState().libertaliaPublic.status, 'playing');
  assert.equal(h.store.getState().libertaliaPrivate.selectedRank, null);
  assert.deepEqual(h.store.getState().libertaliaPrivate.hand, [10, 13]);
});

test('Libertalia identity replacement clears private choices and retires callbacks', () => {
  const h = setupLibertalia(); const socket = h.mount();
  socket.receive('game_state', libertaliaPublic(4));
  socket.receive('private_state', libertaliaPrivate(4, { hand: [31], pendingChoice: { id: 2, kind: 'graveyard_character' } }));
  const oldPublic = socket.callback('game_state'); const oldPrivate = socket.callback('private_state');
  h.store.getState().setAuth(auth('new-token', 'p1'));
  assert.equal(h.store.getState().libertaliaPublic, null);
  assert.equal(h.store.getState().libertaliaPrivate, null);
  assert.equal(h.store.getState().libertaliaSyncing, true);
  oldPublic(libertaliaPublic(5)); oldPrivate(libertaliaPrivate(5));
  assert.equal(h.store.getState().libertaliaPrivate, null);
});

test('Libertalia private effect choices advance with the matching public phase', () => {
  const h = setupLibertalia(); const socket = h.mount();
  socket.receive('game_state', libertaliaPublic(20, { phase: 'effect_choice', pendingPlayerId: 'p0' }));
  socket.receive('private_state', libertaliaPrivate(20, { pendingChoice: { id: 3, kind: 'graveyard_character', options: [{ id: 'secret', rank: 31 }] } }));
  socket.receive('private_state', libertaliaPrivate(21, { pendingChoice: null, canSelect: true }));
  assert.equal(h.store.getState().libertaliaPublic.phase, 'effect_choice');
  assert.equal(h.store.getState().libertaliaPrivate.pendingChoice.id, 3);
  assert.equal(h.store.getState().libertaliaSyncing, true);
  socket.receive('game_state', libertaliaPublic(21, { phase: 'selection', pendingPlayerId: null }));
  assert.equal(h.store.getState().libertaliaPublic.phase, 'selection');
  assert.equal(h.store.getState().libertaliaPrivate.pendingChoice, null);
  assert.equal(h.store.getState().libertaliaSyncing, false);
});

test('Libertalia pairs day-boundary retirement and the following voyage setup', () => {
  const h = setupLibertalia(); const socket = h.mount();
  const players = ['p0', 'p1', 'p2'].map(playerId => ({ playerId, forfeited: playerId === 'p2' }));
  const remainingLoot = [[], [{ id: 4, kind: 'map' }, { id: 5, kind: 'chest' }, { id: 6, kind: 'relic' }]];
  socket.receive('game_state', libertaliaPublic(34, { phase: 'effect_choice', day: 1, voyage: 1, voyagePlayerCount: 3, players, turnOrder: ['p0', 'p1', 'p2'], lootDays: remainingLoot }));
  socket.receive('private_state', libertaliaPrivate(34, { pendingChoice: { id: 9, kind: 'ability' }, canSelect: false }));
  socket.receive('game_state', libertaliaPublic(35, { phase: 'selection', day: 2, voyage: 1, voyagePlayerCount: 3, players, turnOrder: ['p0', 'p1'], lootDays: remainingLoot }));
  assert.equal(h.store.getState().libertaliaPublic.day, 1);
  assert.equal(h.store.getState().libertaliaPrivate.pendingChoice.id, 9);
  assert.equal(h.store.getState().libertaliaSyncing, true);
  socket.receive('private_state', libertaliaPrivate(35, { pendingChoice: null, canSelect: true }));
  assert.deepEqual(h.store.getState().libertaliaPublic.turnOrder, ['p0', 'p1']);
  assert.equal(h.store.getState().libertaliaPublic.players.length, 3);
  assert.equal(h.store.getState().libertaliaPublic.voyagePlayerCount, 3);
  assert.deepEqual(h.store.getState().libertaliaPublic.lootDays, remainingLoot);
  socket.receive('private_state', libertaliaPrivate(50, { hand: [5, 17, 28], pendingChoice: null }));
  socket.receive('game_state', libertaliaPublic(49, { voyage: 1, voyagePlayerCount: 3 }));
  assert.equal(h.store.getState().libertaliaPublic.revision, 35);
  const nextLoot = [[{ id: 7, kind: 'barrel' }, { id: 8, kind: 'amulet' }, { id: 9, kind: 'hook' }]];
  socket.receive('game_state', libertaliaPublic(50, { phase: 'selection', voyage: 2, day: 1, voyagePlayerCount: 2, players, turnOrder: ['p0', 'p1'], lootDays: nextLoot }));
  assert.equal(h.store.getState().libertaliaSyncing, false);
  assert.equal(h.store.getState().libertaliaPublic.voyagePlayerCount, 2);
  assert.deepEqual(h.store.getState().libertaliaPublic.lootDays, nextLoot);
  assert.deepEqual(h.store.getState().libertaliaPrivate.hand, [5, 17, 28]);
});

test('Libertalia forfeit results and rematch never retain an obsolete private decision', () => {
  const h = setupLibertalia(); const socket = h.mount();
  socket.receive('game_state', libertaliaPublic(20, { phase: 'effect_choice' }));
  socket.receive('private_state', libertaliaPrivate(20, { pendingChoice: { id: 4, kind: 'loot_current' } }));
  socket.receive('private_state', libertaliaPrivate(21, { pendingChoice: null, canSelect: false }));
  assert.equal(h.store.getState().libertaliaPrivate.pendingChoice.id, 4);
  socket.receive('game_state', libertaliaPublic(21, { status: 'game_over', phase: 'game_over', endReason: 'forfeit', winnerPlayerIds: ['p0'] }));
  assert.equal(h.store.getState().libertaliaPublic.endReason, 'forfeit');
  assert.equal(h.store.getState().libertaliaPrivate.pendingChoice, null);
  socket.receive('game_state', libertaliaPublic(22, { status: 'playing', phase: 'selection', endReason: null, players: [{ playerId: 'p0', forfeited: false }, { playerId: 'new', forfeited: false }], voyagePlayerCount: 2 }));
  socket.receive('private_state', libertaliaPrivate(21, { pendingChoice: { id: 4 } }));
  assert.equal(h.store.getState().libertaliaPublic.status, 'game_over');
  socket.receive('private_state', libertaliaPrivate(22, { pendingChoice: null, canSelect: true, selectedRank: null }));
  assert.equal(h.store.getState().libertaliaPublic.endReason, null);
  assert.equal(h.store.getState().libertaliaPublic.players[1].playerId, 'new');
  assert.equal(h.store.getState().libertaliaSyncing, false);
  assert.equal(h.store.getState().libertaliaPrivate.pendingChoice, null);
});

function setupColt() {
  const h = setup();
  h.store.getState().setRoom({ roomCode: 'ABCD-EFGH', gameId: 'colt_express' });
  return h;
}

test('Colt Express adopts revision zero and later public/private pairs atomically', () => {
  const h = setupColt(); const socket = h.mount();
  socket.receive('game_state', coltPublic(0));
  assert.equal(h.store.getState().coltPublic, null);
  assert.equal(h.store.getState().coltSyncing, true);
  socket.receive('private_state', coltPrivate(0));
  assert.equal(h.store.getState().coltSyncing, false);
  socket.receive('game_state', coltPublic(1));
  assert.equal(h.store.getState().coltPublic.revision, 0);
  assert.equal(h.store.getState().coltPrivate.revision, 0);
  assert.equal(h.store.getState().coltSyncing, true);
  socket.receive('private_state', coltPrivate(1));
  assert.equal(h.store.getState().coltPublic.revision, 1);
  assert.equal(h.store.getState().coltSyncing, false);
  for (const state of h.changes) {
    if (state.coltPublic && state.coltPrivate) assert.equal(state.coltPublic.revision, state.coltPrivate.revision);
  }
});

test('Colt Express private-first and interleaved frames never roll back the pair', () => {
  const h = setupColt(); const socket = h.mount();
  socket.receive('private_state', coltPrivate(4));
  socket.receive('game_state', coltPublic(3));
  assert.equal(h.store.getState().coltPublic, null);
  socket.receive('game_state', coltPublic(4));
  socket.receive('game_state', coltPublic(5));
  socket.receive('private_state', coltPrivate(6));
  socket.receive('private_state', coltPrivate(5));
  assert.equal(h.store.getState().coltPublic.revision, 4);
  assert.equal(h.store.getState().coltSyncing, true);
  socket.receive('game_state', coltPublic(6));
  socket.receive('game_state', coltPublic(2));
  socket.receive('private_state', coltPrivate(2));
  assert.equal(h.store.getState().coltPublic.revision, 6);
  assert.equal(h.store.getState().coltSyncing, false);
});

test('Colt Express rejects missing or foreign identities, unsafe revisions and cross-game frames', () => {
  const h = setupColt(); const socket = h.mount();
  for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, '1']) {
    socket.receive('game_state', coltPublic(revision));
    socket.receive('private_state', coltPrivate(revision));
  }
  for (const roomCode of [undefined, null, 'OTHER']) {
    socket.receive('game_state', coltPublic(1, { roomCode }));
    socket.receive('private_state', coltPrivate(1, { roomCode }));
  }
  for (const gameId of [undefined, 'unknown', 'libertalia']) {
    socket.receive('game_state', coltPublic(1, { gameId }));
    socket.receive('private_state', coltPrivate(1, { gameId }));
  }
  assert.equal(h.store.getState().coltPublic, null);
  assert.equal(h.store.getState().coltPrivate, null);
  socket.receive('game_state', coltPublic(1));
  for (const playerId of [undefined, null, 'other']) socket.receive('private_state', coltPrivate(1, { playerId }));
  assert.equal(h.store.getState().coltPublic, null);
  assert.equal(h.store.getState().coltSyncing, true);
  socket.receive('private_state', coltPrivate(1));
  assert.equal(h.store.getState().coltPublic.revision, 1);
  assert.equal(h.store.getState().libertaliaPublic, null);
  assert.equal(h.store.getState().libertaliaPrivate, null);
});

test('Colt Express reconnect needs a fresh complete pair while preserving the last display', () => {
  const h = setupColt(); const socket = h.mount();
  socket.receive('game_state', coltPublic(4));
  socket.receive('private_state', coltPrivate(4));
  socket.receive('game_state', coltPublic(5));
  socket.receive('disconnect');
  assert.equal(h.store.getState().coltSyncing, true);
  socket.receive('private_state', coltPrivate(5));
  assert.equal(h.store.getState().coltPublic.revision, 4);
  socket.receive('connect');
  assert.equal(socket.sent.at(-1).event, 'request_state');
  socket.receive('private_state', coltPrivate(5));
  assert.equal(h.store.getState().coltPublic.revision, 4);
  assert.equal(h.store.getState().coltSyncing, true);
  socket.receive('game_state', coltPublic(5));
  assert.equal(h.store.getState().coltPublic.revision, 5);
  assert.equal(h.store.getState().coltSyncing, false);
});

test('Colt Express session replacement clears the hand and retires captured callbacks', () => {
  const h = setupColt(); const socket = h.mount();
  socket.receive('game_state', coltPublic(4));
  socket.receive('private_state', coltPrivate(4, { hand: [{ id: 'private-card' }] }));
  const oldPublic = socket.callback('game_state'); const oldPrivate = socket.callback('private_state');
  h.store.getState().setAuth(auth('new-token', 'p1'));
  assert.equal(h.store.getState().coltPublic, null);
  assert.equal(h.store.getState().coltPrivate, null);
  assert.equal(h.store.getState().coltSyncing, true);
  oldPublic(coltPublic(5)); oldPrivate(coltPrivate(5));
  assert.equal(h.store.getState().coltPublic, null);
  assert.equal(h.store.getState().coltPrivate, null);
});

test('Colt Express two-bandit setup and reserve choices change with their public phase', () => {
  const h = setupColt(); const socket = h.mount();
  socket.receive('game_state', coltPublic(2, { twoBanditMode: true, phase: 'team_setup' }));
  socket.receive('private_state', coltPrivate(2, { canAssignStart: true, canReserve: false, reserveOptions: [] }));
  socket.receive('private_state', coltPrivate(3, { canAssignStart: false, canReserve: true, reserveOptions: [{ id: 'reserve-card', action: 'rob', ownerBandit: 1 }] }));
  assert.equal(h.store.getState().coltPublic.phase, 'team_setup');
  assert.equal(h.store.getState().coltPrivate.canAssignStart, true);
  assert.equal(h.store.getState().coltSyncing, true);
  socket.receive('game_state', coltPublic(3, { twoBanditMode: true, phase: 'reserve_card' }));
  assert.equal(h.store.getState().coltPrivate.canAssignStart, false);
  assert.equal(h.store.getState().coltPrivate.reserveOptions[0].ownerBandit, 1);
  assert.equal(h.store.getState().coltSyncing, false);
});

test('Colt Express chosen character and its private permission become visible together', () => {
  const h = setupColt(); const socket = h.mount();
  socket.receive('game_state', coltPublic(0, { phase: 'character_selection', firstPlayerId: null, availableCharacters: ['ghost', 'doc'], players: [{ playerId: 'p0', character: null, characters: [], characterChosen: false, positions: [] }] }));
  socket.receive('private_state', coltPrivate(0, { canChooseCharacter: true, canProgram: false }));
  socket.receive('game_state', coltPublic(1, { phase: 'character_selection', firstPlayerId: null, availableCharacters: ['doc'], players: [{ playerId: 'p0', character: 'ghost', characters: ['ghost'], characterChosen: true, positions: [] }] }));
  assert.equal(h.store.getState().coltPublic.players[0].character, null);
  assert.equal(h.store.getState().coltPrivate.canChooseCharacter, true);
  assert.equal(h.store.getState().coltSyncing, true);
  socket.receive('private_state', coltPrivate(1, { canChooseCharacter: false, canProgram: false }));
  assert.equal(h.store.getState().coltPublic.players[0].character, 'ghost');
  assert.equal(h.store.getState().coltPrivate.canChooseCharacter, false);
  assert.equal(h.store.getState().coltPublic.firstPlayerId, null);
});

test('Colt Express last character selection cannot combine a dealt hand with unfinished setup', () => {
  const h = setupColt(); const socket = h.mount();
  socket.receive('game_state', coltPublic(2, { phase: 'character_selection', firstPlayerId: null }));
  socket.receive('private_state', coltPrivate(2, { canChooseCharacter: false, canProgram: false, hand: [] }));
  socket.receive('private_state', coltPrivate(3, { canChooseCharacter: false, canProgram: true, hand: [{ id: 'dealt-card' }] }));
  assert.equal(h.store.getState().coltPublic.phase, 'character_selection');
  assert.equal(h.store.getState().coltPrivate.hand.length, 0);
  socket.receive('game_state', coltPublic(3, { phase: 'programming', firstPlayerId: 'p0', programmingPlayerId: 'p0' }));
  assert.equal(h.store.getState().coltPrivate.hand[0].id, 'dealt-card');
  assert.equal(h.store.getState().coltPublic.firstPlayerId, 'p0');
  assert.equal(h.store.getState().coltPrivate.canProgram, true);
  assert.equal(h.store.getState().coltSyncing, false);
});

test('Colt Express pending execution choice cannot use the next phase with old permissions', () => {
  const h = setupColt(); const socket = h.mount();
  socket.receive('game_state', coltPublic(20, { phase: 'pending_choice', pending: { playerId: 'p0', action: 'shoot' } }));
  socket.receive('private_state', coltPrivate(20, { canChoose: true, canProgram: false }));
  socket.receive('game_state', coltPublic(21, { phase: 'programming', pending: null, round: 2 }));
  assert.equal(h.store.getState().coltPublic.phase, 'pending_choice');
  assert.equal(h.store.getState().coltPrivate.canChoose, true);
  socket.receive('private_state', coltPrivate(21, { canChoose: false, canProgram: true, hand: [{ id: 'new-hand' }] }));
  assert.equal(h.store.getState().coltPublic.phase, 'programming');
  assert.equal(h.store.getState().coltPrivate.canChoose, false);
  assert.equal(h.store.getState().coltPrivate.hand[0].id, 'new-hand');
});

test('Colt Express monotonic rematch never combines results with a new private hand', () => {
  const h = setupColt(); const socket = h.mount();
  socket.receive('game_state', coltPublic(90, { status: 'game_over', phase: 'game_over' }));
  socket.receive('private_state', coltPrivate(90, { canProgram: false }));
  socket.receive('private_state', coltPrivate(91, { canProgram: true, hand: [{ id: 'new-match' }] }));
  assert.equal(h.store.getState().coltPublic.status, 'game_over');
  assert.equal(h.store.getState().coltPrivate.canProgram, false);
  socket.receive('game_state', coltPublic(91, { phase: 'programming' }));
  socket.receive('game_state', coltPublic(0));
  socket.receive('private_state', coltPrivate(0));
  assert.equal(h.store.getState().coltPublic.status, 'playing');
  assert.equal(h.store.getState().coltPrivate.hand[0].id, 'new-match');
  assert.equal(h.store.getState().coltSyncing, false);
});

test('Colt Express pairs speeding action number with the remaining hand and Ghost permission', () => {
  const h = setupColt(); const socket = h.mount();
  socket.receive('game_state', coltPublic(7, { phase: 'programming', turnType: 'speeding', programmingActionNumber: 1 }));
  socket.receive('private_state', coltPrivate(7, { canProgram: true, canHideFirstAction: true, hand: [{ id: 'first' }, { id: 'second' }] }));
  socket.receive('game_state', coltPublic(8, { phase: 'programming', turnType: 'speeding', programmingActionNumber: 2 }));
  assert.equal(h.store.getState().coltPublic.programmingActionNumber, 1);
  assert.equal(h.store.getState().coltPrivate.canHideFirstAction, true);
  assert.equal(h.store.getState().coltSyncing, true);
  socket.receive('private_state', coltPrivate(8, { canProgram: true, canHideFirstAction: false, hand: [{ id: 'second' }] }));
  assert.equal(h.store.getState().coltPublic.programmingActionNumber, 2);
  assert.equal(h.store.getState().coltPrivate.canHideFirstAction, false);
  assert.equal(h.store.getState().coltPrivate.hand.length, 1);
});

test('Colt Express round-boundary retirement preserves original mode and pairs the surviving hand', () => {
  const h = setupColt(); const socket = h.mount();
  const players = ['p0', 'p1', 'p2'].map(playerId => ({ playerId, forfeited: playerId === 'p2' }));
  socket.receive('game_state', coltPublic(30, { phase: 'pending_choice', round: 1, players, turnOrder: ['p0', 'p1', 'p2'], initialPlayerCount: 3, twoBanditMode: false, trainCars: 4 }));
  socket.receive('private_state', coltPrivate(30, { canChoose: true, canProgram: false }));
  socket.receive('private_state', coltPrivate(31, { canChoose: false, canProgram: true, hand: [{ id: 'next-round' }] }));
  assert.equal(h.store.getState().coltPublic.round, 1);
  assert.equal(h.store.getState().coltPrivate.canChoose, true);
  socket.receive('game_state', coltPublic(31, { phase: 'programming', round: 2, players, turnOrder: ['p0', 'p1'], initialPlayerCount: 3, twoBanditMode: false, trainCars: 4 }));
  assert.equal(h.store.getState().coltPublic.round, 2);
  assert.equal(h.store.getState().coltPublic.players.length, 3);
  assert.deepEqual(h.store.getState().coltPublic.turnOrder, ['p0', 'p1']);
  assert.equal(h.store.getState().coltPublic.twoBanditMode, false);
  assert.equal(h.store.getState().coltPublic.initialPlayerCount, 3);
  assert.equal(h.store.getState().coltPublic.trainCars, 4);
  assert.equal(h.store.getState().coltPrivate.canChoose, false);
  assert.equal(h.store.getState().coltPrivate.hand[0].id, 'next-round');
});

test('Colt Express forfeit terminal clears private permissions only with its matching public frame', () => {
  const h = setupColt(); const socket = h.mount();
  socket.receive('game_state', coltPublic(20, { phase: 'pending_choice', pending: { playerId: 'p0', action: 'rob' } }));
  socket.receive('private_state', coltPrivate(20, { canChoose: true }));
  socket.receive('game_state', coltPublic(21, { status: 'game_over', phase: 'game_over', pending: null, endReason: 'forfeit', winnerPlayerIds: [] }));
  assert.equal(h.store.getState().coltPublic.phase, 'pending_choice');
  assert.equal(h.store.getState().coltSyncing, true);
  socket.receive('private_state', coltPrivate(21, { canChoose: false, canProgram: false }));
  assert.equal(h.store.getState().coltPublic.endReason, 'forfeit');
  assert.deepEqual(h.store.getState().coltPublic.winnerPlayerIds, []);
  assert.equal(h.store.getState().coltPrivate.canChoose, false);
  assert.equal(h.store.getState().coltSyncing, false);
});

test('room updates cannot replace a different authenticated room', () => {
  const h = setup();
  const socket = h.mount();
  socket.receive('room_updated', { roomCode: 'OTHER', gameId: 'bang' });
  assert.equal(h.store.getState().room.gameId, 'saboteur');
});

test('old callbacks cannot mutate a newly adopted session before effect cleanup', async () => {
  const h = setup();
  const socket = h.mount();
  h.store.getState().setAuth(auth('new-session'));
  h.store.getState().setRoom({ roomCode: 'ABCD-EFGH', gameId: 'saboteur' });
  socket.receive('room_updated', { roomCode: 'ABCD-EFGH', gameId: 'bang' });
  socket.receive('game_state', publicState(1));
  socket.receive('private_state', privateState(1));
  socket.receive('session_replaced');
  socket.receive('connect_error', new Error('INVALID_TOKEN'));
  await tick();
  assert.equal(h.store.getState().token, 'new-session');
  assert.equal(h.store.getState().room.gameId, 'saboteur');
  assert.equal(h.store.getState().publicState, null);
  assert.equal(h.removedTokens.length, 0);
  assert.equal(h.routes.length, 0);
});

test('terminal session cleanup is single-flight and awaits token-matched removal', async () => {
  let release;
  const h = setup(() => new Promise((resolve) => { release = resolve; }));
  const socket = h.mount();
  socket.receive('player_kicked');
  socket.receive('session_replaced');
  socket.receive('server_error', { message: 'Missing room' });
  assert.deepEqual(h.removedTokens, ['original']);
  assert.equal(h.store.getState().token, 'original');
  assert.equal(h.routes.length, 0);
  release();
  await tick();
  assert.equal(h.store.getState().token, null);
  assert.deepEqual(h.routes, ['/']);
  assert.equal(h.dialog().title, 'Removed from room');
});

test('malformed terminal errors cannot throw or erase the authenticated seat', async () => {
  const h = setupSkull(); const socket = h.mount();
  for (const payload of [null, undefined, false, 42, 'invalid', [], {}, { message: 12 }]) {
    assert.doesNotThrow(() => socket.receive('server_error', payload));
    assert.doesNotThrow(() => socket.receive('connect_error', payload));
  }
  await tick();
  assert.equal(h.store.getState().token, 'original');
  assert.equal(h.removedTokens.length, 0);
  assert.equal(socket.disconnected, 0);
});

test('valid terminal errors still clear the owned seat and explain recovery', async () => {
  for (const [event, payload, title] of [
    ['server_error', { message: 'This captain seat is no longer available' }, 'Session ended'],
    ['connect_error', new Error('INVALID_TOKEN'), 'Session expired'],
  ]) {
    const h = setupSkull(); const socket = h.mount();
    socket.receive(event, payload);
    await tick();
    assert.equal(h.store.getState().token, null);
    assert.deepEqual(h.removedTokens, ['original']);
    assert.equal(h.dialog().title, title);
    assert.deepEqual(h.routes, ['/']);
  }
});

test('delayed terminal cleanup cannot reroute or clear a newer session', async () => {
  let release;
  const h = setup(() => new Promise((resolve) => { release = resolve; }));
  const oldSocket = h.mount();
  oldSocket.receive('session_replaced');
  h.store.getState().setAuth(auth('new-session', 'p1', 'IJKL-MNOP'));
  const nextSocket = h.mount();
  release();
  await tick();
  assert.equal(h.store.getState().token, 'new-session');
  assert.equal(h.routes.length, 0);
  assert.equal(h.dialogs.length, 0);
  assert.equal(h.hook.getSocket(), nextSocket);
  assert.equal(nextSocket.disconnected, 0);
});

test('failed saved-seat cleanup stays retryable without dropping authentication', async () => {
  let attempts = 0;
  const h = setup(async () => { if (++attempts === 1) throw new Error('Locked storage'); });
  const socket = h.mount();
  socket.receive('player_kicked');
  await tick();
  assert.equal(h.store.getState().token, 'original');
  assert.equal(h.routes.length, 0);
  assert.equal(h.dialog().title, 'Could not clear saved seat');
  h.dialog().buttons[0].onPress();
  await tick();
  assert.equal(h.store.getState().token, null);
  assert.equal(h.dialog().title, 'Removed from room');
  assert.equal(h.removedTokens.length, 2);
});

test('cleanup invalidates captured callbacks and removes only its own failure dialog', async () => {
  const h = setup(async () => { throw new Error('Locked storage'); });
  const socket = h.mount();
  const lateState = socket.callback('game_state');
  socket.receive('player_kicked');
  await tick();
  h.unmount();
  assert.equal(h.dialog(), null);
  assert.equal(socket.listenerCount, 0);
  lateState(publicState(4));
  assert.equal(h.store.getState().publicState, null);
  const nextSocket = h.mount();
  nextSocket.receive('player_kicked');
  await tick();
  h.replaceDialog();
  h.unmount();
  assert.equal(h.dialog().title, 'A newer dialog');
});

test('an old cleanup retry cannot affect a newer session or its dialog', async () => {
  const h = setup(async () => { throw new Error('Locked storage'); });
  const socket = h.mount();
  const oldTerminalEvent = socket.callback('server_error');
  socket.receive('player_kicked');
  await tick();
  const oldRetry = h.dialog().buttons[0].onPress;
  h.store.getState().setAuth(auth('new-session'));
  h.replaceDialog();
  h.mount();
  oldRetry();
  oldTerminalEvent({ message: 'Old failure' });
  await tick();
  assert.equal(h.store.getState().token, 'new-session');
  assert.deepEqual(h.removedTokens, ['original']);
  assert.equal(h.routes.length, 0);
  assert.equal(h.dialog().title, 'A newer dialog');
});

test('clearing state restores the synchronisation fence', () => {
  const h = setup();
  h.store.getState().setSaboteurState(publicState(1), privateState(1));
  h.store.getState().setCoupState(coupPublic(0), coupPrivate(0));
  h.store.getState().setBangState(bangPublic(0), bangPrivate(0));
  h.store.getState().setKingOfTokyoPublic(tokyoState(0));
  h.store.getState().setSkullKingState(skullPublic(0), skullPrivate(0));
  h.store.getState().setCitadelsState(citadelsPublic(0), citadelsPrivate(0));
  h.store.getState().setNotAloneState(notAlonePublic(0), notAlonePrivate(0));
  h.store.getState().setLibertaliaState(libertaliaPublic(0), libertaliaPrivate(0));
  h.store.getState().setColtState(coltPublic(0), coltPrivate(0));
  h.store.getState().clearAll();
  assert.equal(h.store.getState().saboteurSyncing, true);
  assert.equal(h.store.getState().publicState, null);
  assert.equal(h.store.getState().privateState, null);
  assert.equal(h.store.getState().coupSyncing, true);
  assert.equal(h.store.getState().coupPublic, null);
  assert.equal(h.store.getState().coupPrivate, null);
  assert.equal(h.store.getState().bangSyncing, true);
  assert.equal(h.store.getState().bangPublic, null);
  assert.equal(h.store.getState().bangPrivate, null);
  assert.equal(h.store.getState().kingOfTokyoSyncing, true);
  assert.equal(h.store.getState().kingOfTokyoPublic, null);
  assert.equal(h.store.getState().skullKingSyncing, true);
  assert.equal(h.store.getState().skullKingPublic, null);
  assert.equal(h.store.getState().skullKingPrivate, null);
  assert.equal(h.store.getState().citadelsSyncing, true);
  assert.equal(h.store.getState().citadelsPublic, null);
  assert.equal(h.store.getState().citadelsPrivate, null);
  assert.equal(h.store.getState().notAloneSyncing, true);
  assert.equal(h.store.getState().notAlonePublic, null);
  assert.equal(h.store.getState().notAlonePrivate, null);
  assert.equal(h.store.getState().libertaliaSyncing, true);
  assert.equal(h.store.getState().libertaliaPublic, null);
  assert.equal(h.store.getState().libertaliaPrivate, null);
  assert.equal(h.store.getState().coltSyncing, true);
  assert.equal(h.store.getState().coltPublic, null);
  assert.equal(h.store.getState().coltPrivate, null);
});
