const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const theme = { bg: '#0C0D12', surface: '#171A24', panel: '#232837', border: '#424B61', ember: '#FF8A48', gold: '#F4C458', cyan: '#62D6E8', red: '#FF5E68', muted: '#9CA6B8', text: '#F8F6EE' };
const jsx = (type, props, key) => typeof type === 'function' ? type(props) : { type, props, key };
const native = { Text: 'Text', View: 'View', Image: 'Image', StyleSheet: { absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } } };
const baseModules = { 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native, 'expo-linear-gradient': { LinearGradient: 'Gradient' }, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '../ui/ScalePressable': { ScalePressable: 'Button' }, '../../constants/theme': { COLT: theme } };
function load(relative, modules = {}) {
  const filename = path.join(__dirname, '../components', relative);
  const exports = {};
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  assert.deepEqual(result.diagnostics, []);
  const dependencies = { ...baseModules, ...modules };
  vm.runInNewContext(result.outputText, { exports, require(name) { assert(name in dependencies, name); return dependencies[name]; } });
  return exports;
}
const help = load('colt/decision.ts', { '@zuychin-arcade/types': {} });
const material = load('ui/CardSurface.tsx');
let failedArtwork = null;
const currentSource = { current: null };
const cover = load('ui/GameCover.tsx', { react: { useState: () => [failedArtwork, value => { failedArtwork = value; }], useRef: () => currentSource }, '../../constants/theme': { ARCADE: theme } });
const assetMocks = Object.fromEntries(['move', 'floor', 'rob', 'shoot', 'punch', 'marshal', 'bullet'].map(action => [`../../assets/game-art/colt-action-${action}.webp`, action]));
const artwork = load('colt/ActionArtwork.tsx', { '../ui/GameCover': cover, ...assetMocks });
const portraitAssets = Object.fromEntries(['ghost', 'doc', 'tuco', 'django', 'cheyenne', 'belle'].map(id => [`../../assets/game-art/colt-character-${id}.webp`, `portrait-${id}`]));
const portraits = load('colt/ColtCharacterArtwork.tsx', { '../ui/GameCover': cover, ...portraitAssets });
const trainAssets = Object.fromEntries(['locomotive', 'carriage', 'caboose'].map(id => [`../../assets/game-art/colt-train-${id}.webp`, `train-${id}`]));
const trains = load('colt/TrainArtwork.tsx', { '../ui/GameCover': cover, ...trainAssets });
const { ActionCard, coltActionIcons } = load('colt/ActionCard.tsx', { '../ui/CardSurface': material, './decision': help, './ActionArtwork': artwork });
const { CharacterChoice, TeamChoice } = load('colt/CharacterChoice.tsx', { '../ui/CardSurface': material, './ColtCharacterArtwork': portraits });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const content = node => Array.isArray(node) ? node.map(content).join('') : node && typeof node === 'object' ? content(node.props?.children) : node == null || node === false ? '' : String(node);
const button = tree => nodes(tree).find(n => n.type === 'Button');

test('every action retains complete help, owner, stable anchor and immediate submission semantics', () => {
  for (const action of Object.keys(coltActionIcons)) {
    let calls = 0;
    const tree = ActionCard({ id: 'colt-hand-owned-card', action, owner: 'My bandit', disabled: action === 'bullet', onPress() { calls++; } });
    const control = button(tree);
    assert.equal(tree.props.nativeID, 'colt-hand-owned-card');
    assert(content(tree).includes(help.COLT_ACTION_HELP[action]));
    assert(content(tree).includes('My bandit'));
    assert.equal(control.props.accessibilityLabel, `Program ${action} for My bandit. ${help.COLT_ACTION_HELP[action]}`);
    assert.match(control.props.accessibilityHint, /Submits this action now/);
    assert.equal(control.props.disabled, action === 'bullet');
    assert.equal(control.props.style.minHeight, 48);
    assert.equal(control.props.style.opacity, 1);
    if (!control.props.disabled) { control.props.onPress(); assert.equal(calls, 1); }
    const image = nodes(tree).find(n => n.type === 'Image');
    assert.equal(image.props.source, action);
    assert.equal(image.props.resizeMode, 'contain');
  }
});

test('failed artwork falls back to the installed action glyph, and a different action recovers', () => {
  const old = nodes(artwork.ActionArtwork({ action: 'move' })).find(n => n.type === 'Image');
  const active = nodes(artwork.ActionArtwork({ action: 'shoot' })).find(n => n.type === 'Image');
  old.props.onError();
  assert.equal(failedArtwork, null);
  active.props.onError();
  const fallback = nodes(artwork.ActionArtwork({ action: 'shoot' })).find(n => n.type === 'Icon');
  assert.equal(fallback.props.name, coltActionIcons.shoot);
  assert(nodes(artwork.ActionArtwork({ action: 'move' })).some(n => n.type === 'Image'));
  failedArtwork = null;
});

test('a paired team is one legal choice with two exact portraits and both actual powers', () => {
  const characters = [{ name: 'Ghost', summary: 'Ghost power' }, { name: 'Doc', summary: 'Doc power' }];
  let calls = 0;
  const tree = TeamChoice({ characters, disabled: false, onPress() { calls++; } });
  assert.equal(nodes(tree).filter(n => n.type === 'Button').length, 1);
  assert.deepEqual(nodes(tree).filter(n => n.type === 'Image').map(n => n.props.source), ['portrait-ghost', 'portrait-doc']);
  assert.equal(button(tree).props.accessibilityLabel, 'CHOOSE GHOST & DOC');
  assert.match(button(tree).props.accessibilityHint, /Ghost power.*Doc power/);
  button(tree).props.onPress(); assert.equal(calls, 1);
});

test('all six portraits map case-insensitively and unknown identities retain a neutral fallback', () => {
  for (const id of ['ghost', 'doc', 'tuco', 'django', 'cheyenne', 'belle']) {
    const tree = portraits.ColtCharacterArtwork({ name: id.toUpperCase(), color: theme.gold });
    assert.equal(nodes(tree).find(n => n.type === 'Image').props.source, `portrait-${id}`);
    assert.equal(tree.props.style.aspectRatio, 1);
    assert.equal(tree.props.accessibilityElementsHidden, true);
  }
  for (const name of ['Unknown', '__proto__', 'constructor']) {
    const tree = portraits.ColtCharacterArtwork({ name, color: theme.gold });
    assert(!nodes(tree).some(n => n.type === 'Image'));
    assert(nodes(tree).some(n => n.type === 'Icon' && n.props.name === 'account-outline'));
  }
});

test('all three train identities preserve the full 3:2 artwork and recover with a train glyph', () => {
  for (const kind of ['locomotive', 'carriage', 'caboose']) {
    const tree = trains.TrainArtwork({ kind });
    assert.equal(tree.props.style.aspectRatio, 1.5);
    assert.equal(tree.props.pointerEvents, 'none');
    const image = nodes(tree).find(n => n.type === 'Image');
    assert.equal(image.props.source, `train-${kind}`);
    image.props.onError();
    assert(nodes(trains.TrainArtwork({ kind })).some(n => n.type === 'Icon' && n.props.name === 'train'));
    failedArtwork = null;
  }
});

test('Cover configuration and reserve keep distinct semantics, including a reservable bullet', () => {
  const cover = ActionCard({ action: 'shoot', owner: 'Doc', disabled: false, configure: true, onPress() {} });
  assert.match(button(cover).props.accessibilityHint, /Nothing is submitted yet/);
  assert.match(content(cover), /CHOOSE COVER OPTIONS/);
  const reserve = ActionCard({ action: 'bullet', owner: 'Ghost', disabled: false, mode: 'reserve', onPress() {} });
  assert.equal(button(reserve).props.disabled, false);
  assert.match(button(reserve).props.accessibilityHint, /private reserve/);
  assert.match(content(reserve), /RESERVE THIS CARD/);
  assert.doesNotMatch(content(reserve), /CANNOT BE PROGRAMMED/);
});

test('action faces fill their intrinsic row across help lengths, owners and decision states', () => {
  for (const action of Object.keys(coltActionIcons)) for (const mode of ['program', 'reserve']) for (const configure of [false, true]) for (const disabled of [false, true]) for (const fluid of [false, true]) {
    let calls = 0;
    const onPress = () => { calls++; }, owner = 'LongBanditOwnerXXXXXX';
    const tree = ActionCard({ action, owner, mode, configure, disabled, fluid, onPress });
    const control = button(tree), surface = control.props.children, face = surface.props.children[1];
    for (const node of [tree, control, surface, face]) {
      assert.equal(node.props.style.flexGrow, 1);
      assert.equal(node.props.style.height, undefined); assert.equal(node.props.style.maxHeight, undefined);
    }
    assert.equal(tree.props.style.flexBasis, fluid ? 'auto' : 240);
    assert.equal(tree.props.style.width, fluid ? '100%' : undefined);
    assert(content(tree).includes(help.COLT_ACTION_HELP[action])); assert(content(tree).includes(owner));
    assert.equal(control.props.disabled, disabled); assert.equal(control.props.onPress, onPress);
    assert.equal(nodes(tree).filter(node => node.type === 'Button').length, 1);
    assert(nodes(tree).filter(node => node.type === 'Text').every(node => node.props.numberOfLines === undefined));
    assert.equal(calls, 0); if (!disabled) { control.props.onPress(); assert.equal(calls, 1); }
  }
});

test('six character emblems are distinct installed glyphs and preserve actual power descriptions', () => {
  const definitions = load('../../../packages/types/src/colt-express-constants.ts');
  const glyphs = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');
  const emblems = [];
  for (const character of Object.values(definitions.COLT_CHARACTERS)) {
    let calls = 0;
    const tree = CharacterChoice({ character, disabled: false, onPress() { calls++; } });
    const control = button(tree), icon = nodes(tree).find(n => n.type === 'Icon');
    assert(content(tree).includes(character.summary));
    assert.equal(control.props.accessibilityLabel, `Choose ${character.name}. ${character.summary}`);
    assert.equal(control.props.style.minHeight, 48);
    control.props.onPress(); assert.equal(calls, 1);
    assert(icon.props.name in glyphs);
    emblems.push(icon.props.name);
  }
  assert.equal(new Set(emblems).size, 6);
});

test('disabled choices remain readable and do not gain secondary artwork actions', () => {
  for (const tree of [ActionCard({ action: 'shoot', owner: 'Doc', disabled: true, onPress() {} }), CharacterChoice({ character: { name: 'Ghost', summary: 'Full supplied power.' }, disabled: true, onPress() {} })]) {
    assert.equal(button(tree).props.disabled, true);
    assert.equal(button(tree).props.accessibilityState.disabled, true);
    assert.equal(nodes(tree).filter(n => n.type === 'Button').length, 1);
    const decoration = nodes(tree).filter(n => n.props.accessibilityElementsHidden);
    assert(decoration.length >= 3);
    for (const item of decoration) {
      assert.equal(item.props.pointerEvents, 'none');
      assert.equal(item.props.importantForAccessibility, 'no-hide-descendants');
    }
    const checkReadable = (node, hidden = false) => {
      if (!node || typeof node !== 'object') return;
      const decorative = hidden || node.props.accessibilityElementsHidden;
      if (!decorative) assert(!(node.props.style?.opacity < 1));
      for (const child of [node.props.children].flat(Infinity)) checkReadable(child, decorative);
    };
    checkReadable(tree);
  }
});

test('character choice labels stay inside the painted face when enlarged text wraps', () => {
  const { COLT_CHARACTERS } = load('../../../packages/types/src/colt-express-constants.ts');
  for (const character of Object.values(COLT_CHARACTERS)) for (const disabled of [false, true]) {
    const tree = CharacterChoice({ character, disabled, onPress() {} });
    const face = nodes(tree).find(node => node.props.testID === 'card-surface-face');
    const label = disabled ? 'CHOICE UNAVAILABLE' : 'CHOOSE ' + character.name.toUpperCase();
    const footer = nodes(face).find(node => node.type === 'Text' && node.props.children === label);
    assert(footer, 'The footer must not subtract from the painted face height');
    assert.equal(footer.props.style.marginTop, 'auto');
    assert.equal(footer.props.numberOfLines, undefined);
    assert.equal(nodes(tree).filter(node => node.type === 'Text' && node.props.children === label).length, 1);
  }
});

test('long live text has no line truncation or fixed-height ancestors', () => {
  const title = 'Long character identity that must wrap';
  for (const tree of [ActionCard({ action: 'marshal', owner: title, disabled: false, onPress() {} }), CharacterChoice({ character: { name: title, summary: 'An unusually long full power description that remains live, readable text.' }, disabled: false, onPress() {} })]) {
    const walk = (node, ancestors = []) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'Text') {
        assert.equal(node.props.numberOfLines, undefined);
        for (const parent of [...ancestors, node]) {
          assert.equal(parent.props.style?.height, undefined);
          assert.equal(parent.props.style?.maxHeight, undefined);
        }
      }
      for (const child of [node.props.children].flat(Infinity)) walk(child, [...ancestors, node]);
    };
    walk(tree);
  }
});
