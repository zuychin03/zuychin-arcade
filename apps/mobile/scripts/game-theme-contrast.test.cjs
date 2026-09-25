const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const jsx = (type, props) => ({ type, props });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function load(file, modules) {
  const exports = {};
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return exports;
}
const native = { Platform: { OS: 'web' }, StyleSheet: { create: value => value }, Text: 'Text', View: 'View' };
const theme = load('constants/theme.ts', { 'react-native': native });
const { TELESTRATIONS: T, KRAKEN: K, ARCADE } = theme;
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
const modules = { react: { useId: () => 'hint' }, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native, '../ui/ScalePressable': { ScalePressable: 'Button' }, './ScalePressable': { ScalePressable: 'Button' }, '../../constants/theme': theme, '../../constants/typography': require('./lib/typography-fixture.cjs') };

test('every shared game palette keeps body and muted copy readable on its text surfaces', () => {
  const palettes = Object.entries(theme).filter(([, value]) => value && typeof value === 'object' && value.text && value.muted);
  assert(palettes.length >= 13);
  for (const [name, palette] of palettes) {
    for (const foreground of ['text', 'muted']) for (const background of ['bg', 'surface', 'panel']) {
      if (!palette[background]) continue;
      assert(contrast(palette[foreground], palette[background]) >= 4.5, `${name}.${foreground} on ${background}`);
    }
  }
});

test('paper and raspberry text stays readable across all Telestrations surfaces', () => {
  assert(luminance(T.bg) > .8);
  for (const foreground of [T.text, T.muted, T.accent, T.secondary, T.danger]) {
    for (const background of [T.bg, T.surface, T.panel]) assert(contrast(foreground, background) >= 4.5, `${foreground} on ${background}`);
  }
  assert(contrast(T.onAccent, T.accent) >= 4.5);
  assert(contrast(T.catalogueAccent, ARCADE.surface) >= 4.5);
  assert(contrast(T.catalogueAccent, ARCADE.panel) >= 4.5);
});

test('Kraken retains its distinct deep-sea identity and semantic course and ink colours remain fixed', () => {
  assert.equal(K.bg, '#081D27');
  assert.equal(K.accent, '#8AE5DD');
  assert.notEqual(K.accent, T.accent);
  assert.match(read('components/kraken/NavigationCard.tsx'), /red: '#FF9297', blue: '#8DD8FF', yellow: '#FFE28D'/);
  const ink = fs.readFileSync(path.join(__dirname, '../../..', 'packages/types/src/telestrations-constants.ts'), 'utf8');
  assert.match(ink, /\['#f8fafc', '#171923', '#ff6685', '#ffbc57', '#f5e663', '#63d9a0', '#65baff', '#b799ff'\]/);
});

test('game palette reexports and catalogue use the authoritative tokens', () => {
  for (const [folder, name] of [['telestrations', 'TELESTRATIONS'], ['kraken', 'KRAKEN']]) {
    const actual = load(`components/${folder}/palette.ts`, { '../../constants/theme': theme });
    assert.equal(actual[name], theme[name]);
    for (const route of ['index', 'join', 'lobby', 'game', '_layout']) {
      const directory = folder === 'kraken' ? 'feed-the-kraken' : folder;
      assert.match(read(`app/${directory}/${route}.tsx`), new RegExp(`components/${folder}/palette`));
    }
  }
  const catalogue = read('app/(arcade)/index.tsx');
  assert.match(catalogue, /title="TELESTRATIONS"[^\n]*accent=\{TELESTRATIONS.catalogueAccent\}/);
  assert.match(catalogue, /title="FEED THE KRAKEN"[^\n]*accent=\{KRAKEN.accent\}/);
});

test('light-theme solid and outlined controls retain readable text and ordinary button semantics', () => {
  const { NeonButton } = load('components/ui/NeonButton.tsx', modules);
  const { BookButton } = load('components/telestrations/Controls.tsx', { ...modules, './palette': { TELESTRATIONS: T } });
  for (const variant of ['solid', 'outline']) {
    let presses = 0;
    const button = NeonButton({ label: 'Continue', variant, color: T.accent, solidTextColor: T.onAccent, outlineBackgroundColor: T.controlSurface, onPress: () => presses++ });
    const style = button.props.style[0];
    const label = nodes(button).find(node => node.type === 'Text');
    assert(contrast(label.props.style.color, style.backgroundColor) >= 4.5);
    assert.equal(style.minHeight, 48);
    button.props.onPress();
    assert.equal(presses, 1);
  }
  for (const selected of [true, false]) {
    const button = BookButton({ label: 'Select', selected, onPress() {} });
    const label = nodes(button).find(node => node.type === 'Text');
    assert(contrast(label.props.style.color, button.props.style.backgroundColor) >= 4.5);
    assert.equal(button.props.accessibilityState.selected, selected);
  }
  const unchanged = NeonButton({ label: 'Default', onPress() {} });
  assert.equal(nodes(unchanged).find(node => node.type === 'Text').props.style.color, ARCADE.bg);
  assert.equal(NeonButton({ label: 'Default', variant: 'outline', onPress() {} }).props.style[0].backgroundColor, ARCADE.surface);
});

test('gameplay controls share button typography without losing each game palette or selection semantics', () => {
  const role = modules['../../constants/typography'].TYPOGRAPHY.control;
  for (const [game, exportName, paletteName, palette] of [['kraken', 'HelmButton', 'KRAKEN', K], ['telestrations', 'BookButton', 'TELESTRATIONS', T]]) {
    const button = load(`components/${game}/Controls.tsx`, { ...modules, './palette': { [paletteName]: palette } })[exportName];
    for (const selected of [true, false]) {
      const tree = button({ label: 'A complete wrapping action', selected, onPress() {} });
      const label = nodes(tree).find(node => node.type === 'Text');
      for (const key of ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing']) assert.equal(label.props.style[key], role[key]);
      assert.equal(label.props.style.flexShrink, 1);
      assert.equal(label.props.numberOfLines, undefined);
      assert.equal(tree.props.style.minHeight, 48);
      assert.equal(tree.props.accessibilityState.selected, selected);
      assert(contrast(label.props.style.color, tree.props.style.backgroundColor) >= 4.5);
    }
  }
});
