const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  let failed = null;
  const current = { current: null };
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: { useRef: () => current, useState: () => [failed, value => { failed = value; }] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Image: 'Image', StyleSheet: { absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } } },
    '../../constants/theme': { ARCADE: { surface: '#111' } },
  };
  const source = fs.readFileSync(path.join(__dirname, '../components/ui/CardIllustration.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return exports.CardIllustration;
}

test('illustration fills the printed field without a second card frame or crop', () => {
  const render = harness();
  const tree = render({ source: 1, nativeID: 'art' });
  assert.equal(tree.props.nativeID, 'art');
  assert.equal(tree.props.style.width, '100%');
  assert.equal(tree.props.style.aspectRatio, 1);
  for (const key of ['borderWidth', 'borderRadius', 'boxShadow', 'padding', 'maxWidth']) assert.equal(tree.props.style[key], undefined);
  assert.equal(tree.props.children.type, 'Image');
  assert.equal(tree.props.children.props.resizeMode, 'contain');
  assert.equal(tree.props.pointerEvents, 'none');
  assert.equal(tree.props.accessible, false);
  assert.equal(tree.props.accessibilityElementsHidden, true);
  assert.equal(tree.props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(tree.props.children.props.alt, '');
});

test('fallback preserves the field and stale image errors cannot hide a new source', () => {
  const render = harness();
  const oldImage = render({ source: 1 }).props.children;
  render({ source: 2 });
  oldImage.props.onError();
  const current = render({ source: 2, fallback: 'icon' });
  assert.equal(current.props.children.type, 'Image');
  current.props.children.props.onError();
  const failed = render({ source: 2, fallback: 'icon' });
  assert.equal(failed.props.style.aspectRatio, 1);
  assert.equal(failed.props.children.type, 'View');
  assert.equal(failed.props.children.props.children, 'icon');
  assert.equal(render({ source: 3 }).props.children.type, 'Image');
});

test('only finite positive source proportions are accepted', () => {
  const render = harness();
  for (const aspectRatio of [0, -1, NaN, Infinity]) assert.equal(render({ source: 1, aspectRatio }).props.style.aspectRatio, 1);
  assert.equal(render({ source: 1, aspectRatio: 2 / 3 }).props.style.aspectRatio, 2 / 3);
});
