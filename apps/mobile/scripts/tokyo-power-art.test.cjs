const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { KING_OF_TOKYO_POWER_CARDS } = require('../../../packages/types/src/king-of-tokyo-cards.ts');

const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function load(component, extra = {}) {
  const jsx = (type, props) => ({ type, props });
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', Image: 'Image' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../ui/GameCover': { GameCover: 'GameCover' },
    '../../constants/theme': { TOKYO: { panel: '#07130F', cyan: '#2EE6FF', lime: '#8BFF52' } },
    './MonsterAvatar': { MonsterAvatar: 'MonsterAvatar' },
    'react-native-svg': { __esModule: true, ...Object.fromEntries(['default', 'Circle', 'Defs', 'LinearGradient', 'Line', 'Path', 'Rect', 'Stop'].map(key => [key, key === 'default' ? 'Svg' : key])) },
    ...extra,
  };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../components/king-of-tokyo', `${component}.tsx`), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  vm.runInNewContext(compiled.outputText, { exports, require: name => {
    if (name.endsWith('.webp')) {
      assert(fs.existsSync(path.join(__dirname, '../components/king-of-tokyo', name)), name);
      return name;
    }
    assert(name in modules, name);
    return modules[name];
  } });
  return exports;
}

test('all 64 identities select their own complete artwork with palette rim and native fallback', () => {
  const { TokyoPowerArtwork } = load('TokyoPowerArtwork');
  const sources = new Set();
  for (const card of KING_OF_TOKYO_POWER_CARDS) {
    const tree = TokyoPowerArtwork({ cardId: card.id, category: card.category, icon: 'creation', color: '#2EE6FF' });
    assert.equal(tree.props.source, `../../assets/game-art/tokyo-power-${card.id}.webp`);
    assert.equal(tree.props.aspectRatio, 1);
    assert.equal(tree.props.rimColor, '#2EE6FF');
    assert(nodes(tree.props.fallback).some(node => node.type === 'Icon'));
    sources.add(tree.props.source);
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, `../assets/game-art/tokyo-power-${card.id}-manifest.json`), 'utf8'));
    assert.equal(manifest.outputs[0].width, 320);
    assert.equal(manifest.outputs[0].height, 320);
    assert(manifest.outputs[0].bytes <= 48 * 1024);
  }
  assert.equal(sources.size, 64);
  assert.equal(TokyoPowerArtwork({ category: 'attack', icon: 'fire', color: '#fff' }).props.source, '../../assets/game-art/tokyo-power-attack.webp');
});

test('arena backdrop is decorative, preserves live occupancy and safely falls back', () => {
  let failed = false;
  const { TokyoArena } = load('TokyoArena', { react: { useState: () => [failed, value => { failed = value; }] } });
  const props = { players: [{ playerId: 'one', displayName: 'Local player', tokyoZone: 'tokyo_city' }], currentPlayerId: 'one', capacity: 2 };
  const before = TokyoArena(props);
  const image = nodes(before).find(node => node.type === 'Image');
  assert.equal(image.props.resizeMode, 'contain');
  assert.equal(image.props.accessible, false);
  assert(nodes(before).some(node => node.type === 'View' && node.props.pointerEvents === 'none' && node.props.children === image));
  assert.match(before.props.accessibilityLabel, /City occupied by Local player, Bay occupied by nobody/);
  image.props.onError();
  const after = TokyoArena(props);
  assert(!nodes(after).some(node => node.type === 'Image'));
  assert(nodes(after).some(node => node.type === 'Svg'));
  assert.equal(after.props.accessibilityLabel, before.props.accessibilityLabel);
  assert.equal(after.props.children.at(-1).props.style.backgroundColor, '#8BFF52');
});
