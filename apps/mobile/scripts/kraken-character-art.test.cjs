const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const jsx = (type, props) => typeof type === 'function' ? type(props) : ({ type, props });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
function load(relative, modules) {
  const filename = path.join(root, relative), exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => {
    if (name.endsWith('.webp')) { assert(fs.statSync(path.resolve(path.dirname(filename), name)).isFile()); return name; }
    assert(name in modules, name); return modules[name];
  } });
  return exports;
}
const types = load('packages/types/src/feed-the-kraken-constants.ts', {});
function harness(component) {
  let failed = null;
  const currentSource = { current: null };
  const modules = {
    react: { useState: initial => [component === 'CharacterCard' ? failed : initial, value => { failed = value; }], useRef: () => currentSource },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Image: 'Image', Text: 'Text', View: 'View', StyleSheet: { absoluteFill: {} }, useWindowDimensions: () => ({ fontScale: 2 }) },
    '../../constants/theme': { ARCADE: {} },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '@zuychin-arcade/types': types,
    '../ui/CardSurface': { CardSurface: 'Surface' },
    '../ui/CardGrid': { CardGrid: 'Grid' },
    './NavigationCard': { NavigationCard: 'NavigationCard' },
    './decisions': { targetSlots: () => [], characterTargets: () => [] },
    './palette': { KRAKEN: { panel: '#123', bg: '#012', surface: '#234', accent: '#abc', border: '#678' } },
    './Controls': { HelmButton: 'Button', typography: { body: {}, heading: {}, muted: {} } },
  };
  modules['../ui/CardIllustration'] = load('apps/mobile/components/ui/CardIllustration.tsx', modules);
  return load(`apps/mobile/components/kraken/${component}.tsx`, modules);
}

test('all 21 original portraits have distinct sources, bounded derivatives and verified manifests', () => {
  const hashes = new Set();
  for (const id of types.FEED_THE_KRAKEN_CHARACTERS) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, `apps/mobile/assets/game-art/kraken-character-${id}-manifest.json`)));
    const source = fs.readFileSync(path.join(root, manifest.source.file));
    const output = manifest.outputs[0];
    const bytes = fs.readFileSync(path.join(root, 'apps/mobile/assets/game-art', output.file));
    assert.equal(createHash('sha256').update(source).digest('hex'), manifest.source.sha256);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), output.sha256);
    assert.equal(output.width, 480); assert.equal(output.height, 720); assert(bytes.length <= 70 * 1024);
    assert(fs.readFileSync(path.join(root, `docs/design/game-art/kraken-character-${id}-prompt.md`), 'utf8').includes('built-in image_gen'));
    hashes.add(manifest.source.sha256);
  }
  assert.equal(hashes.size, 21);
});

test('every character renders its full portrait and scalable live rules; compact copies can wrap', () => {
  const { CharacterCard, KRAKEN_CHARACTER_IMAGES } = harness('CharacterCard');
  assert.deepEqual(Object.keys(KRAKEN_CHARACTER_IMAGES), Array.from(types.FEED_THE_KRAKEN_CHARACTERS));
  for (const character of types.FEED_THE_KRAKEN_CHARACTERS) {
    const tree = CharacterCard({ character });
    assert.equal(tree.type, 'Surface'); assert.equal(tree.props.fill, true); assert.equal(tree.props.height, undefined);
    const list = nodes(tree), image = list.find(n => n.type === 'Image');
    assert.equal(image.props.resizeMode, 'contain'); assert.equal(image.props.accessible, false);
    assert(list.some(n => n.props?.style?.aspectRatio === 2 / 3));
    assert.equal(tree.props.children.props.style.padding, undefined);
    assert.equal(list.find(n => n.props?.testID === 'card-illustration').props.style.borderRadius, undefined);
    for (const expected of [types.FEED_THE_KRAKEN_CHARACTER_NAMES[character], types.FEED_THE_KRAKEN_CHARACTER_SUMMARIES[character]]) {
      const text = list.find(n => n.type === 'Text' && n.props.children === expected);
      assert(text); assert.equal(text.props.numberOfLines, undefined); assert.equal(text.props.allowFontScaling, undefined);
    }
    const compact = CharacterCard({ character, compact: true });
    assert.equal(compact.props.style.flexWrap, 'wrap');
    assert(nodes(compact).some(n => n.props?.style?.flexBasis === 180));
  }
});

test('failed portraits retain names and abilities without poisoning another character', () => {
  const { CharacterCard } = harness('CharacterCard');
  nodes(CharacterCard({ character: 'herbalist' })).find(n => n.type === 'Image').props.onError();
  const failed = nodes(CharacterCard({ character: 'herbalist' }));
  assert(!failed.some(n => n.type === 'Image'));
  assert(failed.some(n => n.type === 'Text' && n.props.children === 'Herbalist'));
  assert(nodes(CharacterCard({ character: 'lookout' })).some(n => n.type === 'Image'));
});

test('portrait-owned priority copy is omitted without changing character/pass actions', () => {
  const { DecisionPanel } = harness('DecisionPanel');
  const actions = [];
  const props = { game: { phase: 'priority', window: 'before_appointment', players: [] }, mine: { canAct: true, canUseCharacter: true, character: 'gunslinger', playerId: 'p0' }, busy: false, send: action => { actions.push(action); return true; } };
  const complete = nodes(DecisionPanel(props));
  assert(complete.some(n => n.type === 'Text' && n.props.children === 'Gunslinger'));
  const compact = nodes(DecisionPanel({ ...props, showCharacterCopy: false }));
  assert(!compact.some(n => n.type === 'Text' && n.props.children === 'Gunslinger'));
  assert(!compact.some(n => n.type === 'Text' && n.props.children === types.FEED_THE_KRAKEN_CHARACTER_SUMMARIES.gunslinger));
  const buttons = compact.filter(n => n.type === 'Button');
  assert.deepEqual(buttons.map(n => n.props.label), ['Reveal and use character', 'Pass this window']);
  buttons.forEach(n => n.props.onPress());
  assert.equal(JSON.stringify(actions), JSON.stringify([{ type: 'character', targets: [] }, { type: 'pass' }]));
});

test('game consumer mounts portraits only for opened private information or public characters', () => {
  const source = fs.readFileSync(path.join(root, 'apps/mobile/app/feed-the-kraken/game.tsx'), 'utf8');
  assert.match(source, /\{revealed \? <CardSurface[\s\S]*?<CharacterCard character=\{mine\.character\} compact/);
  assert.match(source, /\{p\.character \? <CharacterCard character=\{p\.character\} compact \/> : null\}/);
  assert.match(source, /showCharacterCopy=\{false\}/);
  assert.doesNotMatch(source, /\{N\[mine\.character\]\}/);
});
