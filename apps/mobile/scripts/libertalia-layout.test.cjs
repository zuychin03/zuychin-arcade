const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { LIBERTALIA_CREW } = require('../../../packages/types/src/libertalia-constants.ts');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(file, modules, globals = {}) {
  const exports = {};
  vm.runInNewContext(compile(read(file)), { exports, ...globals, require: name => { assert(name in modules, name); return modules[name]; } });
  return exports;
}
const layout = load('components/libertalia/layout.ts', {});
const decision = load('components/libertalia/decision.ts', { '@zuychin-arcade/types': { LIBERTALIA_CREW, LIBERTALIA_MIN_PLAYERS: 2 } });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const find = (tree, id) => nodes(tree).find(node => node.props.nativeID === id);
const source = read('app/libertalia/game.tsx');

test('measured desktop primary/table and modal columns stack at enlarged text without window-only breakpoints', () => {
  for (const scale of [1, 1.25, 1.5, 2, 3]) {
    assert.equal(layout.libertaliaLayout(980 * scale + 19, scale).besideTable, false);
    assert.equal(layout.libertaliaLayout(980 * scale + 20, scale).besideTable, true);
    assert.equal(layout.libertaliaLayout(760 * scale + 19, scale).besideResults, false);
    assert.equal(layout.libertaliaLayout(760 * scale + 20, scale).besideResults, true);
  }
  for (const width of [0, -1, NaN, Infinity, 320, 375, 414, 768]) assert.equal(layout.libertaliaLayout(width).besideTable, false);
  assert.equal(layout.libertaliaLayout(1252, 1).besideTable, true);
  assert.equal(layout.libertaliaLayout(1252, 2).besideTable, false);
  assert.equal(layout.libertaliaLayout(1000, NaN).besideTable, true);
});

function routeHarness({ platform = 'ios', pendingChoice = null, status = 'playing', island = [], ready = false } = {}) {
  const moves = [], sent = [], focus = [], refs = [];
  const states = []; let cursor = 0;
  let resultFontSize = 25;
  const player = { playerId: 'a', displayName: 'Owner', forfeited: false, handCount: 2, ship: [3], loot: [{ id: 2, kind: 'barrel' }], graveyardCount: 1, doubloons: 7, score: 19, ready, reputation: 1 };
  const game = { gameId: 'libertalia', revision: 4, status, voyage: 1, day: 1, daysInVoyage: 4, phase: 'selection', players: [player], turnOrder: ['a'], winnerPlayerIds: status === 'game_over' ? ['a'] : [], endReason: status === 'game_over' ? 'score' : null, currentLoot: [{ id: 1, kind: 'relic' }], lootDays: [[{ id: 1, kind: 'relic' }]], reputationTrack: [{ tokenId: 'r', playerId: 'a', displayName: 'Owner', position: 0, value: 8, active: false }], island, log: [] };
  const mine = { hand: [1, 2], graveyard: [4], selectedRank: null, canSelect: true, pendingChoice };
  const store = { libertaliaPublic: game, libertaliaPrivate: mine, room: { roomCode: 'LOCAL', players: [{ playerId: 'a', isHost: true, isConnected: true }, { playerId: 'b', isHost: false, isConnected: true }] }, token: 'synthetic', playerId: 'a' };
  const useGameStore = selector => selector(store); useGameStore.getState = () => store;
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  let attention;
  const modules = {
    react: { useState: value => { const index = cursor++; if (!(index in states)) states[index] = value; return [states[index], next => { states[index] = next; }]; }, useRef: value => { const ref = { current: value }; refs.push(ref); return ref; }, useCallback: fn => fn, useEffect() {}, useLayoutEffect() {} },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { AccessibilityInfo: { setAccessibilityFocus: node => focus.push(node) }, BackHandler: {}, Modal: 'Modal', Platform: { OS: platform }, ScrollView: 'ScrollView', StyleSheet: { create: value => value }, Text: 'Text', View: 'View', findNodeHandle: node => node, useWindowDimensions: () => ({ width: 1280, fontScale: 1 }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-router': { router: {} }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@zuychin-arcade/types': { LIBERTALIA_CREW }, '../../store/useGameStore': { useGameStore }, '../../hooks/useSocket': { getSocket() {} },
    '../../hooks/useNativeLeaveGuard': { useNativeLeaveGuard: () => () => {} }, '../../hooks/useWebBackGuard': { useWebBackGuard() {} }, '../../hooks/useWebModalFocus': { useWebModalFocus() {} },
    '../../components/ui/ScalePressable': { ScalePressable: 'Button' }, '../../components/ui/NeonButton': { NeonButton: 'Button' }, '../../components/ui/GameRecovery': { GameRecovery: 'Recovery' },
    '../../components/ui/CardGrid': { CardGrid: props => jsx('View', { ...props, style: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' }, children: props.items.map((item, index) => props.renderItem(item, props.minCardWidth, index)) }) },
    '../../components/libertalia/CrewCard': { CrewCard: 'CrewCard' }, '../../components/libertalia/Hand': { LibertaliaHand: 'Hand' }, '../../components/libertalia/Loot': { LibertaliaLootCollection: props => jsx('LootCollection', { ...props, children: props.tokens.map(token => jsx('Loot', { token, compact: props.compact })) }) },
    '../../components/libertalia/LibertaliaArtwork': { LibertaliaLootArtwork: 'LootArt', LibertaliaPhaseArtwork: 'PhaseArt' }, '../../components/libertalia/layout': layout,
    '../../components/libertalia/ReferenceSheet': { LibertaliaReferenceSheet: 'Rules' },
    '../../components/libertalia/useLibertaliaActions': { useLibertaliaActions: () => ({ connected: true, synced: true, send: (...args) => sent.push(args) }) },
    '../../components/libertalia/useLibertaliaDecisionAttention': { useLibertaliaDecisionAttention: (key, blocked, callback) => { attention = { key, blocked, callback }; } },
    '../../components/libertalia/decision': decision, '../../constants/theme': { LIBERTALIA: {} }, '../../lib/api': { leaveRoom() {} }, '../../lib/storage': { clearAuthIfMatches() {} },
    '../../lib/dialog': { showDialog() {}, useDialogStore: selector => selector({ dialog: null }) },
  };
  const { default: render } = load('app/libertalia/game.tsx', modules, { requestAnimationFrame: callback => { callback(); return 1; }, document: { getElementById: () => ({}) }, window: { getComputedStyle: () => ({ fontSize: String(resultFontSize) }) } });
  const tree = render();
  for (const node of nodes(tree)) {
    if (node.type === 'ScrollView' && node.props.ref) node.props.ref.current = { scrollTo: move => moves.push(move) };
    if (node.props.nativeID === 'libertalia-decision') node.props.ref.current = 'decision-heading';
  }
  return { tree, moves, sent, focus, refs, attention, store, setResultFontSize(value) { resultFontSize = value; }, rerender() { cursor = 0; return render(); } };
}

test('nested native decision and loot offsets remain in the actual outer scroll owner', () => {
  for (const platform of ['ios', 'android']) {
    const h = routeHarness({ platform });
    const play = find(h.tree, 'libertalia-play-area');
    const primary = play.props.children[0], publicTable = find(h.tree, 'libertalia-public-table');
    const measure = (node, y) => node.props.onLayout({ nativeEvent: { layout: { y, width: 1252 } } });
    measure(play, 30); measure(primary, 9); measure(publicTable, 90);
    measure(find(h.tree, 'libertalia-decision-area'), 7); measure(find(h.tree, 'libertalia-loot-area'), 17);
    assert.equal(h.attention.callback(), true); assert.equal(h.moves.at(-1).y, 46); assert.deepEqual(h.focus, ['decision-heading']);
    nodes(h.tree).find(node => node.props.label === 'INSPECT VOYAGE LOOT').props.onPress();
    assert.equal(h.moves.at(-1).y, 137); assert(h.moves.every(move => move.animated === false));
    measure(publicTable, 700); nodes(h.tree).find(node => node.props.label === 'INSPECT VOYAGE LOOT').props.onPress(); assert.equal(h.moves.at(-1).y, 747);
    assert.equal(h.attention.key, 'crew:1:1'); assert.deepEqual(h.sent, []);
  }
});

test('public stations keep neutral identity, exact tokens, inactive reputation and secret-safe readiness', () => {
  const h = routeHarness({ ready: true, island: [{ id: 'neutral', playerId: null, rank: 20.5, name: 'Midshipman', neutral: true }, { id: 'crew', playerId: 'a', rank: 11, name: 'Carpenter', neutral: false }] });
  assert.equal(nodes(find(h.tree, 'libertalia-island-neutral')).filter(node => node.type === 'PhaseArt').length, 0);
  assert.equal(nodes(find(h.tree, 'libertalia-island-crew')).find(node => node.type === 'PhaseArt').props.phase, 'daytime');
  const ready = nodes(h.tree).find(node => node.props.testID === 'libertalia-ready-a');
  assert.equal(ready.props.accessibilityLabel, 'Secret selection submitted'); assert.equal(nodes(ready).filter(node => node.type === 'CrewCard' || node.type === 'PhaseArt').length, 0);
  assert.match(find(h.tree, 'libertalia-reputation-r').props.accessibilityLabel, /8 starting doubloons, inactive token/);
  assert.deepEqual(nodes(find(h.tree, 'libertalia-ship-a')).filter(node => node.type === 'CrewCard').map(node => node.props.rank), [3]);
  assert.equal(nodes(find(h.tree, 'libertalia-graveyard')).filter(node => node.type === 'CrewCard').length, 0);
  assert.deepEqual(nodes(h.tree).filter(node => node.type === 'Loot').map(node => node.props.token.id), [1, 2]);
});

test('pending art uses actual public loot IDs, excludes swaps and retains exact option action payload', () => {
  for (const [kind, lootId, expected] of [['loot_current', 1, 'relic'], ['loot_ship', 2, 'barrel'], ['loot_current', 2, null], ['loot_swap', 1, null]]) {
    const pendingChoice = { id: 17, kind, prompt: 'Choose', min: 1, max: 1, optional: false, options: [{ id: 'option', label: 'Not a parsed kind', lootId }] };
    const h = routeHarness({ pendingChoice });
    const area = find(h.tree, 'libertalia-decision-area');
    assert.deepEqual(nodes(area).filter(node => node.type === 'LootArt').map(node => node.props.kind), expected ? [expected] : []);
    const button = nodes(area).find(node => node.props.accessibilityLabel?.startsWith('Not a parsed kind'));
    button.props.onPress(); assert.equal(h.sent[0][0], 'choice'); assert.equal(h.sent[0][1].choiceId, 17); assert.deepEqual(Array.from(h.sent[0][1].optionIds), ['option']); assert.equal(h.sent[0][3], 4);
  }
});

test('current, voyage and collected loot share scaled collections with exact public order', () => {
  for (const platform of ['web', 'ios', 'android']) {
    const h = routeHarness({ platform });
    const tokens = ['amulet', 'hook', 'relic'].map((kind, id) => ({ kind, id: id + 10 }));
    h.store.libertaliaPublic.currentLoot = tokens;
    h.store.libertaliaPublic.lootDays = [tokens, [], tokens.slice(0, 2)];
    h.store.libertaliaPublic.players[0].loot = tokens.slice(1);
    let tree = h.rerender();
    const collections = () => nodes(tree).filter(node => node.type === 'LootCollection');
    assert.equal(collections().length, 2);
    nodes(tree).find(node => node.props.label === 'VIEW ALL VOYAGE LOOT').props.onPress();
    tree = h.rerender();
    assert.equal(collections().length, 5);
    for (const [id, expected, compact] of [
      ['libertalia-current-loot-grid', tokens, undefined],
      ['libertalia-voyage-loot-grid-1', tokens, true],
      ['libertalia-voyage-loot-grid-2', [], true],
      ['libertalia-voyage-loot-grid-3', tokens.slice(0, 2), true],
      ['libertalia-collected-loot-grid-a', tokens.slice(1), true],
    ]) {
      const grid = collections().find(node => node.props.testID === id);
      assert(grid, id); assert.deepEqual(grid.props.tokens, expected);
      assert.equal(grid.props.compact, compact); assert.equal(grid.props.textScale, 1);
    }
    assert(nodes(tree).some(node => node.props.children === 'Row cleared'));
    nodes(tree).find(node => node.props.label === 'HIDE VOYAGE LOOT').props.onPress();
    tree = h.rerender(); assert.equal(collections().length, 2); assert.deepEqual(h.sent, []);
  }
});

test('public crew rows and island faces stretch per row while choice options stay natural-height list items', () => {
  const ranks = [18, 19, 11, 35];
  const island = ranks.map(rank => ({ id: `crew-${rank}`, rank, playerId: 'a', name: LIBERTALIA_CREW[rank - 1].name, neutral: false }));
  const pendingChoice = { id: 17, kind: 'ship_character', prompt: 'Choose crew', min: 1, max: 1, optional: false,
    options: ranks.map(rank => ({ id: `ship:a:${rank}`, label: LIBERTALIA_CREW[rank - 1].name, playerId: 'a', rank })) };
  const h = routeHarness({ island, pendingChoice });
  h.store.libertaliaPublic.players[0].ship = ranks;
  const tree = h.rerender(), ship = find(tree, 'libertalia-ship-a');
  const grid = ship.props.children;
  assert.equal(grid.props.style.flexDirection, 'row'); assert.equal(grid.props.style.flexWrap, 'wrap');
  assert.equal(grid.props.style.alignItems, 'stretch');
  assert.equal(grid.props.minCardWidth, 250); assert.equal(grid.props.maxCardWidth, 320);
  assert(nodes(ship).filter(node => node.type === 'CrewCard').every(node => node.props.fluid));
  assert.deepEqual(nodes(ship).filter(node => node.type === 'CrewCard').map(node => node.props.rank), ranks);
  const parentOf = child => nodes(tree).find(node => [node.props.children].flat(Infinity).includes(child));
  for (const rank of ranks) {
    const slot = find(tree, `libertalia-island-crew-${rank}`), row = parentOf(slot);
    assert.equal(row.props.style.flexDirection, 'row'); assert.equal(row.props.style.alignItems ?? 'stretch', 'stretch');
    assert.equal(slot.props.style.alignSelf, undefined);
    assert.equal(slot.props.style.height, undefined); assert.equal(slot.props.style.maxHeight, undefined);
    assert(nodes(slot).some(node => node.props.children === LIBERTALIA_CREW[rank - 1].summary));
    const option = nodes(tree).find(node => node.props.testID === `libertalia-choice-17-${encodeURIComponent(`ship:a:${rank}`)}`);
    assert.equal(parentOf(option).props.style.flexDirection ?? 'column', 'column');
    assert.equal(option.props.style.height, undefined); assert.equal(option.props.style.maxHeight, undefined);
    assert.equal(option.props.style.flexGrow, undefined);
    assert(nodes(option).some(node => node.props.children === LIBERTALIA_CREW[rank - 1].summary));
  }
  assert.deepEqual(h.sent, []);
});

test('results keep one protected modal, summary actions and complete stable roster framing', () => {
  const h = routeHarness({ status: 'game_over' });
  const modal = find(h.tree, 'libertalia-results'), summary = find(modal, 'libertalia-result-summary'), roster = find(modal, 'libertalia-result-roster');
  assert.equal(modal.props.role, 'dialog'); assert.equal(modal.props['aria-modal'], true);
  assert(nodes(summary).some(node => node.props.label === 'PLAY AGAIN')); assert(nodes(summary).some(node => node.props.label === 'BACK TO ARCADE'));
  assert(find(roster, 'libertalia-result-row-a')); assert.equal(nodes(modal).filter(node => node.type === 'ScrollView').length, 1);
  assert.match(source, /useWebModalFocus\(Boolean\(gameOver && !rules && !dialogOpen\), 'libertalia-results', requestLeave\)/);
  assert.match(source, /libertaliaResultPlayers\(game\)\.map/);
});

test('identical loot labels retain distinct exact pending-choice identities and action payloads', () => {
  const pendingChoice = { id: 45, kind: 'loot_ship', prompt: 'Thief: take loot.', min: 1, max: 1, optional: false,
    options: [21, 24].map(id => ({ id: `ship:a:${id}`, label: 'AMULET', playerId: 'a', lootId: id })) };
  const h = routeHarness({ pendingChoice });
  h.store.libertaliaPublic.players[0].loot = [21, 24].map(id => ({ id, kind: 'amulet' }));
  const buttons = nodes(find(h.rerender(), 'libertalia-decision-area')).filter(node => node.props.testID?.startsWith('libertalia-choice-45-'));
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].props.accessibilityLabel, buttons[1].props.accessibilityLabel);
  for (const [index, id] of [21, 24].entries()) {
    assert.equal(buttons[index].props.testID, `libertalia-choice-45-${encodeURIComponent(`ship:a:${id}`)}`);
    buttons[index].props.onPress();
    assert.equal(h.sent[index][0], 'choice'); assert.equal(h.sent[index][1].choiceId, 45);
    assert.deepEqual(Array.from(h.sent[index][1].optionIds), [`ship:a:${id}`]);
  }
});

test('modal measures its own enlarged text even when the underlying toolbar is inert', () => {
  const h = routeHarness({ status: 'game_over', platform: 'web' });
  const direction = tree => nodes(find(tree, 'libertalia-results')).find(node => node.type === 'ScrollView').props.contentContainerStyle.flexDirection;
  assert.equal(direction(h.tree), 'row');
  h.setResultFontSize(50); find(h.tree, 'libertalia-result-title').props.onLayout();
  assert.equal(direction(h.rerender()), 'column');
  h.setResultFontSize(25); find(h.tree, 'libertalia-result-title').props.onLayout();
  assert.equal(direction(h.rerender()), 'row');
  find(h.tree, 'libertalia-results').props.onLayout({ nativeEvent: { layout: { width: 343 } } });
  assert.equal(direction(h.rerender()), 'column');
});
