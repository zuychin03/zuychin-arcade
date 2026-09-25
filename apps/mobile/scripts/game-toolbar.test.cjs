const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const jsx = (type, props) => ({ type, props });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];

function render(route, recovery = false) {
  const filename = path.join(__dirname, '../app', route, 'game.tsx');
  const players = [{ playerId: 'p1', id: 'p1', displayName: 'Player', score: 0, totalScore: 0, coins: 0, scores: [] }];
  const room = { roomCode: 'TEST-ROOM', players: [{ playerId: 'p1', isHost: true, isConnected: true, hasLeft: false }] };
  const pair = { roomCode: room.roomCode, playerId: 'p1', revision: 1 };
  const state = { room, playerId: 'p1', token: 'local-fixture',
    cartographersPublic: { ...pair, status: 'game_over', phase: 'game_over', players, season: 0, winnerIds: ['p1'], objectiveIds: [], revealedCardIds: [] },
    cartographersPrivate: { ...pair, assignments: [], resultMaps: [], map: { coins: 0 } },
    telestrationsPublic: { ...pair, phase: 'game_over', players, seats: ['p1'], completedRounds: 3, winnerIds: ['p1'], scoringMode: 'friendly', direction: 1, pendingScores: {}, cancelledRounds: [] },
    telestrationsPrivate: recovery ? null : { ...pair, windowId: 'finished' },
  };
  const modules = {
    react: { useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {} },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'web' }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 320, fontScale: 2 }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@zuychin-arcade/types': { CARTOGRAPHERS_SEASONS: [{ name: 'Spring', edicts: [0, 1] }], CARTOGRAPHERS_CARD_BY_ID: {}, CARTOGRAPHERS_OBJECTIVE_BY_ID: {} },
    '../../store/useGameStore': { useGameStore: selector => selector(state) },
    '../../components/cartographers/palette': { CARTOGRAPHERS: {} },
    '../../components/telestrations/palette': { TELESTRATIONS: { onAccent: '#FFF8EE', controlSurface: '#F3E9DE' } },
    '../../components/telestrations/Controls': { BookButton: 'Button', typography: {} },
  };
  for (const [folder, names] of [['ui', ['ScalePressable', 'GameRecovery', 'CardSurface', 'NeonButton', 'CardGrid']], ['cartographers', ['PlacementEditor', 'MapBoard', 'ObjectiveCard', 'ExploreCard']], ['telestrations', ['BookDraft', 'Drawing', 'Scoring']]]) {
    for (const name of names) modules[`../../components/${folder}/${name}`] = { [name]: name };
  }
  for (const game of ['Cartographers', 'Telestrations']) {
    const folder = game.toLowerCase();
    modules[`../../components/${folder}/ReferenceSheet`] = { [`${game}ReferenceSheet`]: 'Reference' };
    modules[`../../components/${folder}/use${game}Actions`] = { [`use${game}Actions`]: () => ({ busy: false, pending: false, send() {} }) };
    modules[`../../components/${folder}/use${game}Leave`] = { [`use${game}Leave`]: () => ({ leaving: false, requestLeave() {} }) };
  }
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return nodes(exports.default());
}

test('Telestrations private-state recovery receives its light-theme control colours', () => {
  const recovery = render('telestrations', true).find(node => node.type === 'GameRecovery');
  assert(recovery);
  assert.equal(recovery.props.solidTextColor, '#FFF8EE');
  assert.equal(recovery.props.outlineBackgroundColor, '#F3E9DE');
});

for (const route of ['telestrations', 'cartographers-heroes']) {
  test(`${route} toolbar wraps actions as one group without compressing its title into a zero-basis column`, () => {
    const tree = render(route);
    const toolbar = tree.find(node => node.props?.testID === 'game-toolbar');
    const title = tree.find(node => node.props?.testID === 'game-toolbar-title');
    const actions = tree.find(node => node.props?.testID === 'game-toolbar-actions');
    assert.equal(toolbar.props.style.flexWrap, 'wrap');
    assert.equal(title.props.style.flexBasis, 'auto');
    assert.equal(title.props.style.flexGrow, 1);
    assert.equal(title.props.style.flexShrink, 1);
    assert.equal(title.props.style.maxWidth, '100%');
    assert.equal(actions.props.style.flexShrink, 0);
    const buttons = nodes(actions).filter(node => node.type === 'ScalePressable');
    assert.equal(buttons.length, 2);
    for (const button of buttons) {
      assert.equal(button.props.style.width, 48);
      assert.equal(button.props.style.minHeight, 48);
      assert.equal(typeof button.props.onPress, 'function');
      assert(button.props.accessibilityLabel);
    }
    for (const text of nodes(title).filter(node => node.type === 'Text')) {
      assert.equal(text.props.numberOfLines, undefined);
      assert.equal(text.props.allowFontScaling, undefined);
    }
  });
}
