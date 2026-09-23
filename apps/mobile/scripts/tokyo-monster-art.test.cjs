const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const names = ['voltclaw', 'emberback', 'prism-moth', 'abyssal', 'scrap-sentinel', 'riftfang'];
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function harness() {
  let failed = new Set();
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: { useState: () => [failed, update => { failed = update(failed); }] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Image: 'Image' },
    'react-native-svg': Object.fromEntries(['default', 'Circle', 'Defs', 'Ellipse', 'G', 'LinearGradient', 'Line', 'Path', 'Polygon', 'Rect', 'Stop'].map(key => [key, key === 'default' ? 'Svg' : key])),
    '../../constants/theme': { TOKYO: { border: '#43886C', danger: '#FF5F6C' }, neonBox: () => ({}) },
    ...Object.fromEntries(names.map(name => [`../../assets/game-art/tokyo-monster-${name}.webp`, name])),
  };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../components/king-of-tokyo/MonsterAvatar.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  vm.runInNewContext(compiled.outputText, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return exports;
}

test('six profile portraits preserve sizes, decorative semantics and deterministic assignment', () => {
  const { MonsterAvatar, monsterProfile } = harness();
  for (const size of [45, 54]) for (let index = 0; index < 6; index++) {
    const tree = MonsterAvatar({ seed: 'player', profileIndex: index, size });
    const image = nodes(tree).find(node => node.type === 'Image');
    assert.equal(image.props.source, names[index]);
    assert.equal(image.props.resizeMode, 'contain');
    assert.equal(image.props.accessible, false);
    assert.equal(tree.props.pointerEvents, 'none');
    assert.equal(tree.props.style[0].width, size);
    assert(tree.props.accessibilityLabel.includes(monsterProfile('player', index).name));
  }
  assert.equal(monsterProfile('player', -1).name, 'Riftfang');
  assert.equal(monsterProfile('player', 6).name, 'Voltclaw');
  assert.equal(monsterProfile('player').name, monsterProfile('player').name);
});

test('failed portraits fall back individually and keep live elimination overlay', () => {
  const { MonsterAvatar } = harness();
  const render = index => MonsterAvatar({ seed: 'player', profileIndex: index, active: true, eliminated: true });
  const before = render(0);
  nodes(before).find(node => node.type === 'Image').props.onError();
  const fallback = render(0);
  assert.equal(nodes(fallback).filter(node => node.type === 'Image').length, 0);
  assert(nodes(fallback).some(node => node.type === 'Path'));
  assert.equal(nodes(render(1)).filter(node => node.type === 'Image').length, 1);
  for (const tree of [before, fallback]) {
    const overlay = tree.props.children.at(-1);
    assert.equal(nodes(overlay).filter(node => node.type === 'Line' && node.props.strokeWidth === '8').length, 2);
    assert.equal(nodes(overlay).find(node => node.type === 'Circle').props.strokeWidth, 4);
    assert(tree.props.accessibilityLabel.includes('eliminated'));
  }
});

test('all runtime portraits have checked source provenance and bounded bytes', () => {
  for (const name of names) {
    const root = path.join(__dirname, '../assets/game-art');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, `tokyo-monster-${name}-manifest.json`), 'utf8'));
    const output = manifest.outputs[0];
    assert.equal(output.width, 320);
    assert.equal(output.height, 320);
    assert.equal(fs.statSync(path.join(root, output.file)).size, output.bytes);
    assert(output.bytes <= 48 * 1024);
    assert(fs.existsSync(path.join(__dirname, '../../..', manifest.source.file)));
  }
});
