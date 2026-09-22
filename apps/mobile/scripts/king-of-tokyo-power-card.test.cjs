const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function render(props = {}) {
  const filename = path.join(__dirname, '../components/king-of-tokyo/PowerCard.tsx');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const element = (type, properties) => ({ type, props: properties });
  const modules = {
    react: { useRef: value => ({ current: value }) },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': { View: 'View', Text: 'Text', Platform: { OS: 'web' }, useWindowDimensions: () => ({ fontScale: 1 }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@zuychin-arcade/types': { KING_OF_TOKYO_POWER_CARD_BY_ID: {
      complete_destruction: { name: 'Complete Destruction', kind: 'keep', category: 'victory', cost: 3, effect: 'A final roll with all six faces gains 9 victory points.' },
    } },
    '../ui/ScalePressable': { ScalePressable: 'Button' },
    '../ui/CardSurface': { CardSurface: 'CardSurface' },
    './TokyoPowerArtwork': { TokyoPowerArtwork: 'Artwork' },
    '../../constants/theme': { TOKYO: { text: '#fff', lime: '#9f3', energy: '#fd6', panel: '#123', border: '#456', surface: '#012' }, neonBox: () => ({}) },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require: name => { assert(name in modules, name); return modules[name]; } }, { filename });
  return exports.PowerCard({ card: { cardId: 'complete_destruction', instanceId: 'complete_destruction:1' }, ...props });
}

const children = node => [node?.props?.children].flat().filter(child => child && typeof child === 'object');
function findPath(node, predicate, ancestors = []) {
  if (predicate(node)) return [...ancestors, node];
  for (const child of children(node)) {
    const result = findPath(child, predicate, [...ancestors, node]);
    if (result) return result;
  }
  return null;
}

test('compact power-card titles have their own full-width row outside icon and price', () => {
  const tree = render({ compact: true });
  const titlePath = findPath(tree, node => node.props?.children === 'Complete Destruction');
  const pricePath = findPath(tree, node => node.type === 'Text' && node.props?.children === 3);
  assert(titlePath && pricePath);
  assert.notEqual(titlePath.at(-3), pricePath.at(-3), 'The narrow title must not share the icon/price row');
  assert.equal(titlePath.at(-1).props.numberOfLines, undefined);
  assert.equal(titlePath.at(-1).props.style.fontSize, 15);
  assert.equal(titlePath.at(-1).props.accessibilityRole, 'header');
});

test('regular power cards retain their inline title and price layout', () => {
  const tree = render();
  const titlePath = findPath(tree, node => node.props?.children === 'Complete Destruction');
  const pricePath = findPath(tree, node => node.type === 'Text' && node.props?.children === 3);
  assert.equal(titlePath.at(-3), pricePath.at(-3));
  assert.equal(titlePath.at(-1).props.style.fontSize, 17);
});

test('compact header layout preserves action semantics and touch size', () => {
  let presses = 0;
  const tree = render({ compact: true, actionLabel: 'BUY · 3 ENERGY', onAction: () => presses++ });
  const button = findPath(tree, node => node.type === 'Button').at(-1);
  assert.equal(button.props.accessibilityLabel, 'BUY · 3 ENERGY: Complete Destruction');
  assert(button.props.style.minHeight >= 48);
  button.props.onPress();
  assert.equal(presses, 1);
});
