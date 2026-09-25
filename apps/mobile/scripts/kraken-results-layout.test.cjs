const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const jsx = (type, props) => ({ type, props });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function render({ over = true, host = true, seats = 5, connected = true, busy = false, leaving = false, width = 375 } = {}) {
  const pair = { roomCode: 'LOCAL', revision: 1 };
  const players = Array.from({ length: seats }, (_, i) => ({ playerId: `p${i}`, displayName: `Player ${i}`, isHost: host && i === 0, isConnected: connected, aboard: true, resume: [], notFactions: [] }));
  const store = {
    playerId: 'p0', token: 'local-fixture', room: { ...pair, players },
    krakenPublic: { ...pair, status: over ? 'game_over' : 'playing', phase: over ? 'game_over' : 'nomination', journey: 'short', players, winner: 'sailors', winnerIds: ['p0'], endReason: 'destination', effects: { doubledPlayerIds: [] }, log: [] },
    krakenPrivate: { ...pair, playerId: 'p0', viewerPlayerId: 'p0', canAct: true },
  };
  const calls = [];
  const modules = {
    react: { useEffect() {}, useState: value => [value, () => {}] }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Text: 'Text', View: 'View', ScrollView: 'ScrollView', useWindowDimensions: () => ({ width, fontScale: 1 }), AppState: {} },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../store/useGameStore': { useGameStore: select => select(store) },
    '../../components/kraken/Controls': { HelmButton: 'Button', typography: {} },
    '../../components/kraken/palette': { KRAKEN: {} },
    '../../components/kraken/decisions': { phaseNames: { game_over: 'Voyage ended', nomination: 'Nomination' } },
    '../../components/kraken/useKrakenActions': { useKrakenActions: () => ({ busy, send: action => calls.push(action) }) },
    '../../components/kraken/useKrakenLeave': { useKrakenLeave: () => ({ leaving, requestLeave() {} }) },
    '../../components/kraken/ReferenceSheet': { KrakenReferenceSheet: 'Reference' },
  };
  for (const [folder, names] of [['ui', ['GameRecovery', 'CardSurface']], ['kraken', ['CharacterCard', 'VoyageMap', 'DecisionPanel']]]) {
    for (const name of names) modules[`../../components/${folder}/${name}`] = { [name]: name };
  }
  const filename = path.join(__dirname, '../app/feed-the-kraken/game.tsx');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return { tree: nodes(exports.default()), calls };
}

test('Kraken result and next action precede the inspectable map on phones and desktops', () => {
  for (const width of [320, 375, 1280]) {
    const { tree, calls } = render({ width });
    const result = tree.find(node => node.props.testID === 'kraken-results');
    assert(result); assert(tree.indexOf(result) < tree.findIndex(node => node.type === 'VoyageMap'));
    assert(nodes(result).some(node => node.props.accessibilityRole === 'header'));
    const rematch = nodes(result).find(node => node.type === 'Button');
    assert.equal(rematch.props.label, 'Sail again'); assert.equal(rematch.props.disabled, false);
    rematch.props.onPress(); assert.deepEqual(calls, ['start']);
    assert(!tree.some(node => node.props.label === 'Open my private panel'));
  }
});

test('result positioning preserves eligibility, host and active-voyage guards', () => {
  for (const options of [{ seats: 4 }, { connected: false }, { busy: true }, { leaving: true }]) {
    assert.equal(render(options).tree.find(node => node.props.label === 'Sail again').props.disabled, true);
  }
  assert(!render({ host: false }).tree.some(node => node.props.label === 'Sail again'));
  const active = render({ over: false }).tree;
  assert(!active.some(node => node.props.testID === 'kraken-results'));
  assert(active.some(node => node.props.label === 'Open my private panel'));
  assert(active.some(node => node.type === 'VoyageMap'));
});
