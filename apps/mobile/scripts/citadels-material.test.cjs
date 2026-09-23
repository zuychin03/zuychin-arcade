const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const CITADELS = { bg: '#090D1A', surface: '#10182D', panel: '#18233F', royal: '#7395FF', gold: '#F4C04E', crimson: '#FF6577', emerald: '#43D6A0', violet: '#BA8CFF', muted: '#A3AEC8', text: '#F6F8FF' };
const jsx = (type, props, key) => typeof type === 'function' ? type(props) : { type, props, key };
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);

function load(file, modules) {
  const filename = path.resolve(__dirname, '..', file), exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual(compiled.diagnostics, []);
  vm.runInNewContext(compiled.outputText, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return exports;
}

const definitions = load('../../packages/types/src/citadels-constants.ts', {});
function harness({ platform = 'web', fontScale = 1, width = 375 } = {}) {
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    'react-native': { View: 'View', Text: 'Text', Image: 'Image', StyleSheet: { absoluteFill: {} }, Platform: { OS: platform }, useWindowDimensions: () => ({ width, fontScale }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '@zuychin-arcade/types': definitions,
    '../../constants/theme': { CITADELS, ARCADE: CITADELS }, '../ui/ScalePressable': { ScalePressable: 'Button' }, '../ui/GameCover': { GameCover: 'Cover' },
  };
  for (const color of ['noble', 'religious', 'trade', 'military', 'unique']) modules[`../../assets/game-art/citadels-district-${color}.webp`] = color;
  for (const { templateId } of definitions.CITADELS_DISTRICT_MANIFEST) modules[`../../assets/game-art/citadels-district-${templateId}.webp`] = templateId;
  for (const { role } of definitions.CITADELS_ROLES) modules[`../../assets/game-art/citadels-role-${role}.webp`] = role;
  modules['../ui/CardSurface'] = load('components/ui/CardSurface.tsx', modules);
  modules['./CitadelsDistrictArtwork'] = load('components/citadels/CitadelsDistrictArtwork.tsx', modules);
  modules['./CitadelsRoleArtwork'] = load('components/citadels/CitadelsRoleArtwork.tsx', modules);
  return { ...load('components/citadels/CitadelsCard.tsx', modules), modules };
}

test('every canonical district preserves printed identity, gold and complete Outfit effect alongside individual art', () => {
  const { CitadelsDistrictView } = harness();
  for (const template of definitions.CITADELS_DISTRICT_MANIFEST) {
    const card = { ...template, id: 'instance-' + template.templateId };
    const original = JSON.stringify(card);
    const tree = CitadelsDistrictView({ card, compact: true });
    assert.equal(tree.props.testID, 'citadels-district-card-' + card.id);
    assert.equal(tree.props.accessibilityLabel, `${card.name}, ${card.cost} gold, ${card.color} district.${card.effectText ? ' ' + card.effectText : ''}`);
    assert(text(tree).includes(card.name)); assert(text(tree).includes(String(card.cost)));
    const cover = nodes(tree).find(node => node.type === 'Cover');
    assert.equal(cover.props.source, card.templateId); assert.equal(cover.props.aspectRatio, 1.1);
    assert.equal(cover.props.fallback.props.source, card.color);
    assert.equal(cover.props.fallback.props.aspectRatio, 1.1);
    assert(nodes(tree).some(node => node.props.testID === 'citadels-district-art-' + card.id));
    if (card.effectText) {
      const effect = nodes(tree).find(node => node.type === 'Text' && node.props.children === card.effectText);
      assert.equal(effect.props.style.fontFamily, 'Outfit_400Regular'); assert(effect.props.style.fontSize >= 14);
    }
    assert(!text(tree).includes(card.id)); assert.equal(JSON.stringify(card), original);
  }
});

test('Haunted Quarter and School of Magic retain exact identity and unique category despite rule exceptions', () => {
  const { CitadelsDistrictView } = harness();
  for (const templateId of ['haunted_quarter', 'school_of_magic']) {
    const card = { ...definitions.CITADELS_DISTRICT_MANIFEST.find(card => card.templateId === templateId), id: templateId };
    const tree = CitadelsDistrictView({ card, actionLabel: 'BUILD · 1 GOLD' });
    const cover = nodes(tree).find(node => node.type === 'Cover');
    assert.equal(cover.props.source, templateId);
    assert.equal(cover.props.fallback.props.source, 'unique');
    assert(text(tree).includes(card.effectText)); assert(text(tree).includes('BUILD · 1 GOLD'));
    assert(tree.props.accessibilityLabel.includes(`${card.cost} gold, unique district.`));
    assert.equal(nodes(tree).find(node => node.type === 'Cover').props.aspectRatio, 1);
  }
});

test('whole-card action labels, disabled state and non-colour selection remain exact without nested buttons', () => {
  const { CitadelsDistrictView, CitadelsRoleCard } = harness(); let count = 0;
  const card = { id: 'plan', name: 'Imperial Treasury', cost: 5, color: 'unique', effectText: 'Complete unique effect.' };
  for (const disabled of [false, true]) for (const kind of ['district', 'role']) {
    const actionLabel = kind === 'district' ? 'DESTROY · 4 GOLD' : 'CHOOSE SECRETLY';
    const tree = kind === 'district' ? CitadelsDistrictView({ card, selected: true, disabled, actionLabel, onPress() { count++; } })
      : CitadelsRoleCard({ role: 'warlord', selected: true, disabled, actionLabel, onPress() { count++; } });
    assert.equal(tree.type, 'Button'); assert.equal(tree.props.disabled, disabled);
    assert.equal(tree.props.accessibilityState.selected, true); assert.equal(tree.props.accessibilityState.disabled, disabled);
    assert(tree.props.accessibilityLabel.startsWith(actionLabel + '. '));
    assert(tree.props.style.minHeight >= 48); assert.equal(nodes(tree).filter(node => node.type === 'Button').length, 1);
    assert(text(tree).includes('Selected')); assert(nodes(tree).some(node => node.props.name === 'check-circle'));
    if (!disabled) tree.props.onPress();
  }
  assert.equal(count, 2);
});

test('unknown district identities retain category imagery and a final vector fallback', () => {
  const { CitadelsDistrictView } = harness();
  for (const templateId of ['future-district', '__proto__', 'constructor']) {
    const tree = CitadelsDistrictView({ card: { id: 'future', templateId, name: 'Future district', cost: 3, color: 'trade' } });
    const cover = nodes(tree).find(node => node.type === 'Cover');
    assert.equal(cover.props.source, 'trade');
    assert.equal(cover.props.aspectRatio, 1);
    assert(nodes(cover.props.fallback).some(node => node.type === 'Icon' && node.props.name === 'storefront-outline'));
    assert(text(tree).includes('Future district'));
  }
});

test('all eight portraits retain real rank, name, summary, bounded footprint and role-specific fallback', () => {
  const { CitadelsRoleCard } = harness();
  const icons = ['knife-military', 'hand-coin-outline', 'magic-staff', 'crown', 'chess-bishop', 'storefront-outline', 'compass-outline', 'shield-sword-outline'];
  for (const [index, info] of definitions.CITADELS_ROLES.entries()) {
    const tree = CitadelsRoleCard({ role: info.role, compact: true, actionLabel: 'LOCKED · PRIVATE' });
    assert.equal(tree.props.testID, 'citadels-role-card-' + info.role);
    assert.equal(tree.props.accessibilityLabel, `LOCKED · PRIVATE. ${info.name}, rank ${info.rank}. ${info.summary}`);
    assert(text(tree).includes('Rank ' + info.rank)); assert(text(tree).includes(info.name)); assert(text(tree).includes(info.summary));
    const cover = nodes(tree).find(node => node.type === 'Cover');
    assert.equal(cover.props.source, info.role); assert.equal(cover.props.aspectRatio, 1);
    const icon = nodes(cover.props.fallback).find(node => node.type === 'Icon' && node.props.name === icons[index]);
    assert(icon.props.size >= 46);
    const insignia = nodes(tree).find(node => node.props.testID === 'citadels-role-insignia-' + info.role);
    assert.equal(insignia.props.accessibilityElementsHidden, true); assert.equal(insignia.props.pointerEvents, 'none');
    assert.equal(insignia.props.style.minHeight, 112);
    assert.equal(insignia.props.children.props.style.width, '100%');
    assert.equal(insignia.props.children.props.style.maxWidth, 168);
    assert.equal(cover.props.rimColor, icon.props.color);
    const rank = nodes(tree).find(node => node.type === 'Text' && text(node).startsWith('Rank '));
    assert.equal(rank.props.style.position, undefined);
  }
});

test('all role faces fill stretched display wrappers without imposing a fixed text height', () => {
  for (const platform of ['web', 'ios', 'android']) for (const fontScale of [1, 2]) {
    const { CitadelsRoleCard } = harness({ platform, fontScale, width: 320 });
    for (const info of definitions.CITADELS_ROLES) for (const interactive of [false, true]) {
      const tree = CitadelsRoleCard({ role: info.role, fill: true, onPress: interactive ? () => {} : undefined });
      const face = nodes(tree).find(node => node.props.testID === `citadels-role-card-${info.role}`);
      assert.equal(face.props.style.flexGrow, 1);
      assert.equal(face.props.style.alignSelf, 'stretch');
      assert.equal(face.props.style.height, undefined);
      assert(text(face).includes(info.summary));
      assert(nodes(face).filter(node => node.type === 'Text').every(node => node.props.numberOfLines === undefined));
    }
  }
});

test('selected district and role suppress only redundant SELECTED action text, not semantics or other actions', () => {
  const { CitadelsDistrictView, CitadelsRoleCard } = harness();
  const card = { id: 'selected', name: 'Temple', cost: 1, color: 'religious', effectText: 'Printed effect.' };
  const onPress = () => {};
  for (const kind of ['district', 'role']) for (const interactive of [false, true]) for (const disabled of [false, true]) {
    const description = kind === 'district' ? 'Temple, 1 gold, religious district. Printed effect.'
      : `${definitions.CITADELS_ROLE_BY_ID.warlord.name}, rank ${definitions.CITADELS_ROLE_BY_ID.warlord.rank}. ${definitions.CITADELS_ROLE_BY_ID.warlord.summary}`;
    const render = (selected, actionLabel) => {
      const props = { selected, actionLabel, disabled, onPress: interactive ? onPress : undefined };
      return kind === 'district' ? CitadelsDistrictView({ card, ...props }) : CitadelsRoleCard({ role: 'warlord', ...props });
    };
    const selected = render(true, 'SELECTED');
    const selectedTexts = nodes(selected).filter(node => node.type === 'Text' && /^selected$/i.test(text(node)));
    assert.equal(selectedTexts.length, 1); assert.equal(text(selectedTexts[0]), 'Selected');
    assert.equal(nodes(selected).filter(node => node.props.name === 'check-circle').length, 1);
    assert.equal(selected.props.accessibilityLabel, `SELECTED. ${description}`);
    assert.equal(selected.type, interactive ? 'Button' : 'View');
    if (interactive) {
      assert.equal(selected.props.onPress, onPress); assert.equal(selected.props.disabled, disabled);
      assert.equal(selected.props.accessibilityState.selected, true); assert.equal(selected.props.accessibilityState.disabled, disabled);
    }
    for (const actionLabel of ['BUILD · 1 GOLD', 'DESTROY · 0 GOLD', 'CHOOSE SECRETLY']) {
      const tree = render(true, actionLabel);
      assert.equal(nodes(tree).filter(node => node.type === 'Text' && text(node) === actionLabel).length, 1);
      assert.equal(tree.props.accessibilityLabel, `${actionLabel}. ${description}`);
    }
    const unselected = render(false, 'SELECTED');
    assert.equal(nodes(unselected).filter(node => node.type === 'Text' && text(node) === 'SELECTED').length, 1);
    assert(!nodes(unselected).some(node => node.props.name === 'check-circle'));
  }
});

test('native scaling and web intrinsic width preserve full content without fixed height or disabled scaling', () => {
  const web = harness(), native = harness({ platform: 'ios', fontScale: 2, width: 320 });
  assert.equal(web.citadelsCardWidth('district', true), 176); assert.equal(web.citadelsCardWidth('district', false), 208);
  assert.equal(web.citadelsCardWidth('role', true), 180); assert.equal(web.citadelsCardWidth('role', false), 208);
  assert.equal(web.citadelsCardWidth('role', true, NaN), 180);
  const card = { id: 'long', name: 'Observatory of the Imperial Treasury', cost: 6, color: 'unique', effectText: 'Full untruncated unique effect with several clauses and requirements.' };
  for (const compact of [true, false]) for (const kind of ['district', 'role']) {
    const render = h => kind === 'district' ? h.CitadelsDistrictView({ card, compact }) : h.CitadelsRoleCard({ role: 'architect', compact });
    const tree = render(web), enlarged = render(native);
    assert.equal(tree.props.style.minWidth, 'min-content'); assert.equal(tree.props.style.flexBasis, undefined); assert.equal(tree.props.style.height, undefined);
    assert.equal(enlarged.props.style.width, 256); assert.equal(enlarged.props.style.maxWidth, 256); assert.equal(enlarged.props.style.minWidth, undefined);
    assert(nodes(enlarged).filter(node => node.type === 'Text').every(node => node.props.numberOfLines === undefined && node.props.allowFontScaling !== false && node.props.style.height === undefined));
  }
});

test('source-fenced image fallback ignores retired category errors and stays outside accessibility', () => {
  const { modules } = harness(); let failed = null; const ref = { current: null };
  const { GameCover } = load('components/ui/GameCover.tsx', { ...modules, react: { useState: () => [failed, value => { failed = value; }], useRef: () => ref } });
  const first = GameCover({ source: 'noble', fallback: 'noble emblem' });
  const firstError = nodes(first).find(node => node.type === 'Image').props.onError;
  const current = GameCover({ source: 'unique', fallback: 'unique emblem' });
  firstError(); assert.equal(failed, null);
  nodes(current).find(node => node.type === 'Image').props.onError(); assert.equal(failed, 'unique');
  const fallback = GameCover({ source: 'unique', fallback: 'unique emblem' });
  assert(text(fallback).includes('unique emblem')); assert(!nodes(fallback).some(node => node.type === 'Image'));
  assert.equal(fallback.props.accessibilityElementsHidden, true);
});
