const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function render(game, name, textScale = 1) {
  const filename = path.join(__dirname, '../components', game, 'RulesGuide.tsx');
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const palette = new Proxy({}, { get: () => '#ffffff' });
  const modules = {
    '../../constants/typography': require('./lib/typography-fixture.cjs'),
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Text: 'Text', View: 'View', StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 320, fontScale: textScale }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../../constants/theme': { ARCADE: palette, MINE: palette, TOKYO: palette, SKULL_KING: palette },
    '../../hooks/useMeasuredTextScale': { useMeasuredTextScale: () => ({ textScale, textRef: null, onTextLayout() {} }) },
    '../../hooks/useIntrinsicCardHeight': { useIntrinsicCardHeight: (ids, key) => ({ forCard: id => {
      assert(ids.includes(id));
      return { minimumHeight: 220, measurementKey: key, onMeasure() {} };
    } }) },
    './cards/PathCardView': { PathCardView: 'PathCard' },
    './cards/ActionCardView': { ActionCardView: 'ActionCard' },
    './TokyoDie': { TokyoDie: 'Die' },
    './SkullKingCard': { SkullKingCardView: 'SkullCard' },
  };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: id => { assert.ok(id in modules, `Unexpected dependency: ${id}`); return modules[id]; } });
  const tree = exports[name]();
  const nodes = [];
  function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    nodes.push(node); walk(node.props?.children);
  }
  walk(tree);
  return { nodes, text: JSON.stringify(tree) };
}

test('Saboteur demonstrates a connected route, 180-degree rotation and matching repairs', () => {
  const { nodes, text } = render('saboteur', 'SaboteurRulesGuide');
  const paths = nodes.filter(n => n.type === 'PathCard');
  assert.equal(paths.length, 5);
  assert.ok(paths.slice(0, 3).every(n => n.props.card.edges.left === 'open' && n.props.card.edges.right === 'open'));
  assert.equal(paths[3].props.card, paths[4].props.card);
  assert.equal(paths[4].props.rotated, true);
  assert.match(text, /5 columns × 9 rows/);
  assert.match(text, /still play an action or discard/);
  assert.deepEqual(nodes.filter(n => n.type === 'ActionCard').map(n => n.props.card.subtype), ['sabotage_pickaxe', 'repair_pickaxe']);
});

test('Saboteur action examples enlarge with text while staying inside a 320px phone', () => {
  for (const scale of [1, 2]) {
    const { nodes } = render('saboteur', 'SaboteurRulesGuide', scale);
    for (const node of nodes.filter(n => n.type === 'ActionCard')) assert.equal(node.props.width, 96 * scale);
  }
});

test('Tokyo uses six noninteractive dice and identifies kept dice without changing gameplay', () => {
  const { nodes, text } = render('king-of-tokyo', 'TokyoRulesGuide');
  const dice = nodes.filter(n => n.type === 'Die');
  assert.equal(dice.length, 6);
  assert.ok(dice.every(n => n.props.interactive === false));
  assert.deepEqual(dice.slice(0, 3).map(n => [n.props.face, n.props.selectionState]), [[2, 'kept'], [2, 'kept'], [2, 'kept']]);
  assert.match(text, /four 2s score 3/);
  assert.match(text, /Rolled Hearts cannot heal you here/);
  assert.match(text, /every monster outside/);
  assert.match(text, /every Tokyo occupant/);
});

test('Tokyo forwards measured text enlargement to all six authentic dice', () => {
  const { nodes } = render('king-of-tokyo', 'TokyoRulesGuide', 2);
  const dice = nodes.filter(n => n.type === 'Die');
  assert.equal(dice.length, 6);
  assert.ok(dice.every(n => n.props.textScale === 2));
});

test('Skull King demonstrates trump and the three-way Mermaid exception with authentic cards', () => {
  const { nodes, text } = render('skull-king', 'SkullKingRulesGuide');
  const cards = nodes.filter(n => n.type === 'SkullCard');
  assert.deepEqual(cards.map(n => n.props.card.kind), ['number', 'number', 'pirate', 'skull_king', 'mermaid']);
  assert.ok(cards.every(n => !n.props.onPress));
  assert.ok(cards.every(n => n.props.faceSizing.minimumHeight === 220 && n.props.faceSizing.measurementKey === 'rules:320:1'));
  assert.equal(cards[1].props.card.suit, 'black');
  assert.match(text, /all three appear, the first Mermaid wins/);
  assert.match(text, /3 × 20 = \+60/);
  assert.match(text, /No tricks: \+40/);
  assert.match(text, /Any trick: −40/);
});

test('Instructional text uses live, unclamped type of at least 16px in all three guides', () => {
  for (const [game, name] of [['saboteur', 'SaboteurRulesGuide'], ['king-of-tokyo', 'TokyoRulesGuide'], ['skull-king', 'SkullKingRulesGuide']]) {
    const { nodes } = render(game, name, 2);
    for (const node of nodes.filter(n => n.type === 'Text')) {
      const style = Object.assign({}, ...[node.props.style].flat());
      assert.ok(style.fontSize >= 16, `${game} has undersized guide copy`);
      assert.equal(node.props.numberOfLines, undefined);
      assert.notEqual(style.fontFamily, 'Outfit_600SemiBold');
    }
  }
});
