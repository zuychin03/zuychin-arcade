const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const jsx = (type, props) => typeof type === 'function' ? type(props) : ({ type, props });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];

function cardHarness() {
  let failed = null;
  const currentSource = { current: null };
  const exports = {};
  const filename = path.join(__dirname, '../components/kraken/NavigationCard.tsx');
  const modules = {
    react: { useState: () => [failed, value => { failed = value; }], useRef: () => currentSource },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Image: 'Image', Text: 'Text', View: 'View', StyleSheet: { absoluteFill: {} } },
    '../../constants/theme': { ARCADE: {} },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../ui/CardSurface': { CardSurface: 'Surface' },
    '../ui/ScalePressable': { ScalePressable: 'Button' },
    './palette': { KRAKEN: { panel: '#123', bg: '#012', surface: '#234', text: '#fff', border: '#678' } },
    './Controls': { typography: { body: { fontSize: 16 }, heading: { fontSize: 21 } } },
  };
  const illustration = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/ui/CardIllustration.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: illustration, require: name => { assert(name in modules, name); return modules[name]; } });
  modules['../ui/CardIllustration'] = illustration;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => {
    if (name.endsWith('.webp')) { assert(fs.statSync(path.resolve(path.dirname(filename), name)).isFile()); return name; }
    assert(name in modules, name); return modules[name];
  } });
  return exports;
}

test('all three courses share a growing tactile face and an uncropped illustration footprint', () => {
  const { NavigationCard, COURSES, NAVIGATION_EFFECTS } = cardHarness();
  assert.equal(Object.keys(COURSES).length, 3); assert.equal(Object.keys(NAVIGATION_EFFECTS).length, 6);
  for (const colour of Object.keys(COURSES)) for (const effect of Object.keys(NAVIGATION_EFFECTS)) {
    const tree = NavigationCard({ card: { colour, effect } });
    assert.equal(tree.type, 'Surface'); assert.equal(tree.props.fill, true);
    assert.equal(tree.props.height, undefined, 'Rules must be allowed to enlarge');
    const list = nodes(tree), image = list.find(n => n.type === 'Image');
    assert.equal(image.props.resizeMode, 'contain');
    assert(list.some(n => n.props?.style?.aspectRatio === 1.5));
    const field = list.find(n => n.props?.testID === 'card-illustration');
    assert.equal(field.props.style.width, '100%');
    assert.equal(field.props.style.borderRadius, undefined);
    assert.equal(tree.props.children.props.style.padding, undefined);
    assert.equal(list.some(n => n.type === 'Button'), false, 'Reference faces are not fake controls');
    for (const text of list.filter(n => n.type === 'Text')) {
      assert.equal(text.props.numberOfLines, undefined); assert.equal(text.props.allowFontScaling, undefined);
    }
  }
});

test('selection is one labelled touch target with explicit state and exact callback', () => {
  const { NavigationCard } = cardHarness(); let selected = 0;
  const tree = NavigationCard({ card: { colour: 'red', effect: 'telescope' }, selected: true, disabled: true, onSelect: () => selected++ });
  assert.equal(tree.type, 'Button'); assert.equal(tree.props.accessibilityLabel, 'Select red / telescope');
  assert.equal(tree.props.accessibilityState.selected, true); assert.equal(tree.props.disabled, true);
  assert.equal(tree.props.style.flexGrow, 1, 'The pressable must fill the equal-height grid row');
  tree.props.onPress(); assert.equal(selected, 1);
  const surface = nodes(tree).find(n => n.type === 'Surface');
  assert.equal(surface.props.selected, true); assert.equal(surface.props.disabled, true);
});

test('a failed image keeps the readable course and effect, without poisoning another course', () => {
  const { NavigationCard } = cardHarness();
  let tree = NavigationCard({ card: { colour: 'blue', effect: 'drunk' } });
  nodes(tree).find(n => n.type === 'Image').props.onError();
  tree = NavigationCard({ card: { colour: 'blue', effect: 'drunk' } });
  assert.equal(nodes(tree).some(n => n.type === 'Image'), false);
  assert(nodes(tree).some(n => n.type === 'Text' && n.props.children === 'Blue course'));
  assert(nodes(tree).some(n => n.type === 'Text' && n.props.children === 'Drunk'));
  assert(nodes(NavigationCard({ card: { colour: 'red', effect: 'telescope' } })).some(n => n.type === 'Image'));
});

test('late course errors cannot replace a newer loaded illustration', () => {
  const { NavigationCard } = cardHarness();
  const render = colour => NavigationCard({ card: { colour, effect: 'drunk' } });
  const oldError = nodes(render('blue')).find(n => n.type === 'Image').props.onError;
  render('red'); oldError();
  assert(nodes(render('red')).some(n => n.type === 'Image'));
  assert(nodes(render('blue')).some(n => n.type === 'Image'));
});
