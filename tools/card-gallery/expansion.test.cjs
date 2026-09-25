const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../../apps/mobile/node_modules/typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, 'ExpansionScene.tsx'), 'utf8');
const jsx = (type, props) => ({ type, props });
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
function load() {
  const state = [true, 0, 0]; let cursor = 0;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, URLSearchParams, require: name => {
    if (name === 'react') return { useState: () => { const index = cursor++; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; } };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { View: 'View', Text: 'Text', ScrollView: 'ScrollView', useWindowDimensions: () => ({ width: 375 }) };
    if (name === 'react-native-safe-area-context') return { SafeAreaProvider: 'SafeAreaProvider' };
    if (name === '@zuychin-arcade/types') return { CARTOGRAPHERS_CARDS: ['explore', 'hero', 'ambush'].map(kind => ({ kind })), CARTOGRAPHERS_OBJECTIVES: [{ id: 'one' }, { id: 'two' }] };
    if (name.endsWith('/theme')) return { ARCADE: {} };
    const component = name.split('/').at(-1);
    const exported = component === 'ReferenceSheet' ? ({ kraken: 'KrakenReferenceSheet', telestrations: 'TelestrationsReferenceSheet', cartographers: 'CartographersReferenceSheet', dixit: 'DixitReferenceSheet' })[name.split('/').at(-2)] : component;
    return { [exported]: exported };
  } });
  return { ...exports, state, render(family, surface = 'cards') { cursor = 0; return exports.ExpansionScene({ params: new URLSearchParams({ family, surface }) }); } };
}
test('expansion surfaces are explicit and bounded', () => {
  const h = load();
  for (const family of ['kraken', 'telestrations', 'cartographers', 'dixit']) for (const surface of ['cards', 'rules']) assert.equal(h.expansionSelection(new URLSearchParams({ family, surface })).family, family);
  for (const query of ['family=coup', 'family=kraken&surface=other', 'family=dixit&page=1', 'family=kraken&role=secret']) assert.throws(() => h.expansionSelection(new URLSearchParams(query)));
});
test('Dixit inspection and Kraken selection stay local, preserve states and increment exactly once', () => {
  const h = load();
  const cards = nodes(h.render('dixit')).filter(node => node.type === 'DreamCard');
  assert.equal(cards.length, 3); assert.equal(cards[0].props.selected, true); assert.equal(cards[1].props.selected, false);
  cards[1].props.onInspect(); assert.equal(h.state[1], 1); assert.equal(h.state[2], 1);
  const kraken = nodes(h.render('kraken'));
  assert.deepEqual(kraken.filter(node => node.type === 'CharacterCard').map(node => Boolean(node.props.compact)), [false, true]);
  const navigation = kraken.filter(node => node.type === 'NavigationCard');
  assert.equal(navigation[2].props.disabled, true);
  navigation[0].props.onSelect(); assert.equal(h.state[1], 0); assert.equal(h.state[2], 2);
});
test('all four actual references close locally and Cartographers covers each card kind', () => {
  for (const family of ['kraken', 'telestrations', 'cartographers', 'dixit']) {
    const h = load(); const guide = nodes(h.render(family, 'rules')).find(node => String(node.type).endsWith('ReferenceSheet'));
    assert(guide); assert.equal(guide.props.visible, true); guide.props.onClose(); assert.equal(h.state[0], false);
  }
  const tree = nodes(load().render('cartographers'));
  assert.deepEqual(tree.filter(node => node.type === 'ExploreCard').map(node => node.props.card.kind), ['explore', 'hero', 'ambush']);
  assert.equal(tree.filter(node => node.type === 'ObjectiveCard').length, 2);
  const drawing = nodes(load().render('telestrations')).find(node => node.type === 'Drawing');
  assert(drawing.props.drawing.strokes.every(stroke => stroke.color === 1));
  assert(!/fetch\(|socket|https?:\/\//.test(source));
});
