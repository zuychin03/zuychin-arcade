const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../..');
function load(relative, modules = {}) {
  const filename = path.join(root, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) {
    if (name.endsWith('.webp')) return path.resolve(path.dirname(filename), name);
    assert(name in modules, name); return modules[name];
  } }, { filename });
  return exports;
}
const constants = load('packages/types/src/cartographers-heroes-constants.ts');
const artwork = load('apps/mobile/components/cartographers/artwork.ts');
test('every drawing card has distinct artwork and every objective has its family artwork', () => {
  assert.deepEqual(Object.keys(artwork.CARTOGRAPHERS_CARD_ART).sort(), Array.from(constants.CARTOGRAPHERS_CARDS, card => card.id).sort());
  assert.equal(new Set(Object.values(artwork.CARTOGRAPHERS_CARD_ART)).size, 19);
  assert.equal(Object.keys(artwork.CARTOGRAPHERS_OBJECTIVE_ART).length, 4);
  for (const objective of constants.CARTOGRAPHERS_OBJECTIVES) assert(artwork.CARTOGRAPHERS_OBJECTIVE_ART[objective.category]);
});
test('all 23 originals, prompts and bounded derivatives match their provenance manifests', () => {
  const hashes = new Set(); let total = 0;
  for (const file of [...Object.values(artwork.CARTOGRAPHERS_CARD_ART), ...Object.values(artwork.CARTOGRAPHERS_OBJECTIVE_ART)]) {
    const manifest = JSON.parse(fs.readFileSync(file.replace('.webp', '-manifest.json'), 'utf8'));
    const output = fs.readFileSync(file), source = fs.readFileSync(path.join(root, manifest.source.file));
    const hash = value => createHash('sha256').update(value).digest('hex');
    assert.equal(hash(output), manifest.outputs[0].sha256);
    assert.equal(hash(source), manifest.source.sha256);
    assert.equal(output.length, manifest.outputs[0].bytes);
    assert(output.length <= 90 * 1024);
    assert.equal(manifest.outputs[0].width, 640);
    assert.equal(manifest.outputs[0].height, 427);
    assert.equal(manifest.transform, 'width-only resize; full composition; no crop or padding');
    assert(fs.readFileSync(path.join(root, manifest.source.file.replace('.png', '-prompt.md')), 'utf8').includes('image_gen'));
    hashes.add(hash(source)); total += output.length;
  }
  assert.equal(hashes.size, 23);
  assert(total <= 23 * 90 * 1024);
});
test('artwork is separate from untruncated live card rules and shape guides', () => {
  const jsx = (type, props) => ({ type, props });
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Image: 'Image', Text: 'Text', View: 'View' },
    '../ui/CardSurface': { CardSurface: 'CardSurface' },
    './palette': { CARTOGRAPHERS: {} },
    './artwork': artwork,
    './CardArtwork': { CardArtwork: 'CardArtwork' },
    './MapBoard': { ShapeDiagram: 'ShapeDiagram', TERRAIN: Object.fromEntries(['forest', 'village', 'farm', 'water', 'monster', 'hero', 'mountain'].map(t => [t, { label: t }])) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    './objectives': load('apps/mobile/components/cartographers/objectives.ts'),
  };
  const { ExploreCard } = load('apps/mobile/components/cartographers/ExploreCard.tsx', modules);
  const { ObjectiveCard } = load('apps/mobile/components/cartographers/ObjectiveCard.tsx', modules);
  const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
  const cards = [...Array.from(constants.CARTOGRAPHERS_CARDS, card => ExploreCard({ card })), ...Array.from(constants.CARTOGRAPHERS_OBJECTIVES, objective => ObjectiveCard({ objective }))];
  for (const card of cards) {
    const nodes = walk(card), images = nodes.filter(n => n.type === 'CardArtwork');
    assert.equal(images.length, 1); assert(images[0].props.source);
    for (const text of nodes.filter(n => n.type === 'Text')) assert.equal(text.props.numberOfLines, undefined);
  }
  for (const card of constants.CARTOGRAPHERS_CARDS) assert(walk(ExploreCard({ card })).some(n => n.type === 'ShapeDiagram'));
});
test('art frame bounds tablet height and isolates a failed image from the next source', () => {
  let failed = null;
  const jsx = (type, props) => ({ type, props });
  const { CardArtwork } = load('apps/mobile/components/cartographers/CardArtwork.tsx', {
    react: { useState: () => [failed, value => { failed = value; }] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Image: 'Image', View: 'View' },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    './palette': { CARTOGRAPHERS: {} },
  });
  const first = CardArtwork({ source: 'first' });
  assert.equal(first.props.style.width, '100%');
  assert.equal(first.props.style.maxWidth, 480);
  assert.equal(first.props.style.aspectRatio, 1.5);
  assert.equal(first.props.accessible, false);
  assert.equal(first.props.children.props.resizeMode, 'contain');
  first.props.children.props.onError();
  assert.equal(CardArtwork({ source: 'first' }).props.children.type, 'Icon');
  const next = CardArtwork({ source: 'second' });
  assert.equal(next.props.children.type, 'Image');
  assert.equal(next.props.children.props.source, 'second');
  first.props.children.props.onError();
  assert.equal(CardArtwork({ source: 'second' }).props.children.type, 'Image');
});
