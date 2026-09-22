const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const roles = ['duke', 'assassin', 'captain', 'ambassador', 'contessa', 'inquisitor'];
const colours = { bg: '#140A12', surface: '#241221', panel: '#311828', border: '#4A2238', crimson: '#EF5775', gold: '#F4C04E', muted: '#B79AAE', text: '#F6E9F0' };
const jsx = (type, props, key) => typeof type === 'function' ? type(props) : { type, props, key };
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function load(file, modules) {
  const exports = {};
  const compiled = ts.transpileModule(read(file), { fileName: file, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  assert.deepEqual(compiled.diagnostics, []);
  vm.runInNewContext(compiled.outputText, { exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return exports;
}
function harness({ platform = 'web', width = 375, fontScale = 1 } = {}) {
  const native = { View: 'View', Text: 'Text', Image: 'Image', Platform: { OS: platform }, useWindowDimensions: () => ({ width, fontScale }), StyleSheet: { absoluteFill: {} } };
  const modules = { 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native, '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '../../constants/theme': { COUP: colours, ARCADE: colours, COUP_CHARACTER_COLOR: Object.fromEntries(roles.map(role => [role, colours.gold])) }, '../ui/ScalePressable': { ScalePressable: 'Button' } };
  const surface = load('components/ui/CardSurface.tsx', modules);
  const assets = Object.fromEntries(roles.map(role => [`../../assets/game-art/coup-character-${role}.webp`, role + '.webp']));
  const artwork = load('components/coup/CoupCharacterArtwork.tsx', { ...modules, ...assets, '../ui/GameCover': { GameCover: 'GameCover' } });
  const card = load('components/coup/CharacterCard.tsx', { ...modules, '../ui/CardSurface': surface, './CoupCharacterArtwork': artwork });
  const seat = load('components/coup/PlayerSeat.tsx', { ...modules, './CharacterCard': card, './Coin': { Coin: 'Coin' } });
  return { ...card, ...seat, ...artwork, modules };
}

test('all six revealed faces mount the correct original art with titlecase and live rules', () => {
  const { CharacterCard } = harness();
  for (const role of roles) {
    const tree = CharacterCard({ character: role, size: 'md' });
    const image = nodes(tree).find(node => node.type === 'GameCover');
    assert.equal(image.props.source, role + '.webp');
    assert.equal(image.props.aspectRatio, 1);
    assert(text(tree).includes(role[0].toUpperCase() + role.slice(1)));
    assert.equal(tree.props.accessibilityLabel, role + ', active influence');
    assert(nodes(tree).some(node => node.type === 'Text' && node.props.style.fontSize === 14));
  }
});

test('concealed trees and backs are role-independent and never mount role artwork', () => {
  const { CharacterCard } = harness();
  const baseline = CharacterCard({ faceDown: true, size: 'md', accessibilityLabel: 'Private influence 1, hidden' });
  for (const character of roles) {
    const tree = CharacterCard({ character, faceDown: true, size: 'md', accessibilityLabel: 'Private influence 1, hidden' });
    assert.equal(JSON.stringify(tree), JSON.stringify(baseline));
    assert(!nodes(tree).some(node => node.type === 'GameCover'));
    assert.doesNotMatch(JSON.stringify(tree), /\.webp|Tax|Exchange|assassinat|ambassador|inquisitor/);
  }
});

test('image failure uses the established source fence and recovers for a replacement role', () => {
  const { modules, CoupCharacterArtwork } = harness();
  let failed = null;
  const sourceRef = { current: null };
  const { GameCover } = load('components/ui/GameCover.tsx', { ...modules, react: { useRef: () => sourceRef, useState: () => [failed, value => { failed = value; }] } });
  const firstProps = CoupCharacterArtwork({ character: 'duke' }).props;
  const first = GameCover(firstProps), staleError = nodes(first).find(node => node.type === 'Image').props.onError;
  const nextProps = CoupCharacterArtwork({ character: 'ambassador' }).props;
  GameCover(nextProps); staleError(); assert.equal(failed, null);
  nodes(GameCover(nextProps)).find(node => node.type === 'Image').props.onError();
  const fallback = GameCover(nextProps);
  assert(!nodes(fallback).some(node => node.type === 'Image'));
  assert(nodes(fallback).some(node => node.type === 'Icon' && node.props.name === 'handshake'));
  assert(nodes(GameCover(firstProps)).some(node => node.type === 'Image'));
});

test('medium and large cards permit width and height growth without fixed text limits', () => {
  for (const size of ['md', 'lg']) {
    const tree = harness().CharacterCard({ character: 'ambassador', size });
    assert.equal(tree.props.style.minWidth, 'min-content');
    assert.equal(tree.props.style.maxWidth, '100%');
    assert(tree.props.style.flexBasis >= 128);
    const native = harness({ platform: 'ios', width: 320, fontScale: 2 }).CharacterCard({ character: 'ambassador', size });
    assert(native.props.style.minWidth >= 256 && native.props.style.minWidth <= 264);
    const walk = (node, ancestors = []) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'Text') {
        assert.equal(node.props.numberOfLines, undefined);
        assert.equal(node.props.adjustsFontSizeToFit, undefined);
        for (const ancestor of [...ancestors, node]) {
          assert.equal(ancestor.props.style?.height, undefined);
          assert.equal(ancestor.props.style?.maxHeight, undefined);
        }
      }
      for (const child of [node.props.children].flat(Infinity)) walk(child, [...ancestors, node]);
    };
    walk(tree);
  }
});

test('controls remain stable with supplied labels, selection, disabled state and 48px targets', () => {
  const { CharacterCard } = harness();
  let calls = 0;
  for (const disabled of [false, true]) {
    const tree = CharacterCard({ character: 'captain', size: 'md', selected: true, disabled, accessibilityLabel: 'Captain, exchange option 2', accessibilityHint: 'Remove this card', onPress() { calls++; } });
    assert.equal(tree.type, 'Button');
    assert.equal(tree.props.disabled, disabled);
    assert.equal(tree.props.accessibilityState.selected, true);
    assert.equal(tree.props.accessibilityLabel, 'Captain, exchange option 2');
    assert.equal(tree.props.accessibilityHint, 'Remove this card');
    assert.equal(tree.props.style.minHeight, 48);
    assert.equal(nodes(tree).filter(node => node.type === 'Button').length, 1);
    assert.match(text(tree), /Selected/);
    if (!disabled) tree.props.onPress();
  }
  assert.equal(calls, 1);
  const small = CharacterCard({ faceDown: true, size: 'xs', onPress() {} });
  assert.equal(small.props.style.minWidth, 48);
});

test('collection influence cards fill their assigned track without widening compact tokens', () => {
  const { CharacterCard } = harness();
  for (const faceDown of [false, true]) for (const lost of [false, true]) {
    const tree = CharacterCard({ character: 'ambassador', size: 'md', fluid: true, faceDown, lost });
    assert.equal(tree.props.style.width, '100%');
    assert.equal(tree.props.style.minWidth, 0);
    assert.equal(tree.props.style.flexBasis, undefined);
    assert.equal(tree.props.style.flexGrow, 1);
    assert.equal(tree.props.style.flexShrink, 0);
    assert.equal(tree.props.style.height, undefined);
    if (faceDown) assert.equal(tree.props.accessibilityLabel, 'Hidden influence');
    else assert.match(text(tree), /Ambassador/);
  }
  const compact = CharacterCard({ size: 'xs', faceDown: true, fluid: true });
  assert.equal(compact.props.style.width, 32);
  assert.equal(compact.props.style.flexGrow, undefined);
});

test('comparable influence faces and backs fill their row without stretching compact public miniatures', () => {
  const { CharacterCard } = harness();
  for (const size of ['xs', 'sm', 'md', 'lg']) for (const character of roles) for (const faceDown of [false, true]) for (const lost of [false, true]) for (const selected of [false, true]) {
    for (const disabled of [false, true]) for (const interactive of [false, true]) {
      let calls = 0;
      const onPress = () => { calls++; };
      const tree = CharacterCard({ character, size, faceDown, lost, selected, disabled, onPress: interactive ? onPress : undefined });
      const surface = tree.props.children, face = surface.props.children[1];
      assert.equal(surface.props.style.flexGrow, size === 'xs' ? undefined : 1);
      assert.equal(face.props.style.flexGrow, 1);
      assert.equal(tree.props.style.flexBasis, size === 'xs' ? undefined : { sm: 88, md: 128, lg: 160 }[size]);
      assert.equal(tree.props.style.width, size === 'xs' ? 32 : undefined);
      for (const node of [tree, surface, face]) {
        assert.equal(node.props.style.height, undefined); assert.equal(node.props.style.maxHeight, undefined);
      }
      if (interactive) {
        assert.equal(tree.props.onPress, onPress); assert.equal(tree.props.disabled, disabled);
        assert.equal(tree.props.accessibilityState.selected, selected);
        if (!disabled) { tree.props.onPress(); assert.equal(calls, 1); }
      } else assert.equal(tree.props.accessibilityRole, 'image');
      if (faceDown) {
        assert(!nodes(tree).some(node => node.type === 'GameCover'));
        assert.equal(tree.props.accessibilityLabel, 'Hidden influence');
      } else if (size !== 'xs') {
        assert(text(tree).includes(character[0].toUpperCase() + character.slice(1)));
        if (lost) assert.match(text(tree), /Revealed · lost/);
      }
    }
  }
  assert.match(text(CharacterCard({ character: 'duke', size: 'md' })), /Tax \+3\nBlocks aid/);
  assert.match(text(CharacterCard({ character: 'contessa', size: 'md' })), /Blocks assassination/);
});

test('lost faces stay readable with explicit status and compact public seats use only public data', () => {
  const { CharacterCard, PlayerSeat } = harness();
  const lost = CharacterCard({ character: 'duke', lost: true, size: 'md' });
  assert.match(text(lost), /Duke.*Revealed · lost/);
  assert(!nodes(lost).some(node => node.props.style?.opacity < 1));
  const player = { displayName: 'Long player display name', coins: 11, influenceCount: 1, revealedCharacters: ['duke'], eliminated: false, isCurrentTurn: true };
  const seat = PlayerSeat({ player, isMe: false, selectable: true, onSelect() {} });
  assert.equal(seat.type, 'Button');
  assert.equal(seat.props.accessibilityHint, 'Select this player as the action target');
  assert.match(text(seat), /Current turn.*Choose target.*Lost: duke/);
  assert.deepEqual(nodes(seat).filter(node => node.type === 'GameCover').map(node => node.props.source), ['duke.webp']);
  assert.equal(nodes(seat).find(node => node.type === 'Coin').props.amount, 11);
  assert.equal(JSON.stringify(seat), JSON.stringify(PlayerSeat({ player: { ...player, influences: ['assassin'], privateRole: 'ambassador' }, isMe: false, selectable: true, onSelect() {} })));
});

test('consumers reflow cards while the privacy lifecycle and decision ownership stay intact', () => {
  const source = read('app/coup/game.tsx'), reference = read('components/coup/ReferenceSheet.tsx');
  for (const selector of ['priv.influences', 'myFaceDown', 'priv.exchange.pool']) {
    assert(source.includes(`<CardGrid items={${selector}}`));
  }
  assert.equal((source.match(/minCardWidth=\{208\} maxCardWidth=\{280\} gap=\{10\} textScale=\{fontScale\}/g) ?? []).length, 3);
  assert.match(reference, /<View key=\{c\} style=\{\{ flexDirection: 'row', flexWrap: 'wrap'/);
  assert.match(source, /const isWide = winWidth >= 900/);
  assert.match(source, /const isXWide = winWidth >= 1440/);
  assert.match(source, /width: 380, borderLeftWidth/);
  assert.match(source, /ScrollView nativeID="coup-decision-panel"/);
  assert.match(source, /setTimeout\(\(\) => setShowInfluences\(false\), 15_000\)/);
  assert.match(source, /if \(state !== 'active'\) setShowInfluences\(false\)/);
  assert.match(source, /faceDown=\{!inf.revealed && !showInfluences\}/);
  assert.match(source, /const resultsWide = winWidth >= 900 \* Math.max\(1, fontScale\)/);
  assert.match(source, /const hasLeft = player.forfeited;/);
});

test('toolbar wraps bounded groups while keeping full labels, targets and handlers', () => {
  const source = ts.createSourceFile('game.tsx', read('app/coup/game.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let toolbar;
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'nativeID'
      && attribute.initializer?.text === 'coup-toolbar')) toolbar = node.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert(toolbar);
  const compiled = ts.transpileModule(`export function Toolbar() { return (${toolbar}); }`, {
    fileName: 'Toolbar.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  for (const isXWide of [false, true]) {
    for (const variant of ['classic', 'reformation']) {
      const exports = {}, calls = [];
      vm.runInNewContext(compiled.outputText, {
        exports, require: () => ({ jsx, jsxs: jsx }), View: 'View', Text: 'Text', Pressable: 'Button',
        MaterialCommunityIcons: 'Icon', COUP: colours, neonText: () => ({}), isXWide,
        pub: { variant, treasuryReserve: 12, deckSize: 7 },
        setShowRef: value => calls.push(['rules', value]), onRequestLeave: () => calls.push(['leave']),
      });
      const tree = exports.Toolbar(), [title, actions] = tree.props.children;
      assert.equal(tree.props.style.flexWrap, 'wrap');
      assert.equal(tree.props.style.flexDirection, 'row');
      assert.equal(actions.props.style.flexWrap, 'wrap');
      for (const group of [title, actions]) {
        assert.equal(group.props.style.maxWidth, '100%');
        assert.equal(group.props.style.flexShrink, 1);
      }
      const buttons = nodes(tree).filter(node => node.type === 'Button');
      assert.equal(buttons.length, isXWide ? 1 : 2);
      for (const button of buttons) {
        assert.equal(button.props.accessibilityRole, 'button');
        assert.equal(button.props.style.minHeight, 48);
        assert.equal(button.props.style.minWidth, 48);
        assert.equal(button.props.style.maxWidth, '100%');
        const label = nodes(button).find(node => node.type === 'Text');
        assert.equal(label.props.numberOfLines, undefined);
        assert.equal(label.props.style.flexShrink, 1);
        button.props.onPress();
      }
      assert.deepEqual(buttons.map(button => text(button)), isXWide ? ['Leave'] : ['Rules', 'Leave']);
      assert.deepEqual(buttons.map(button => button.props.accessibilityLabel), isXWide ? ['Leave game'] : ['Open rules', 'Leave game']);
      assert.deepEqual(calls, isXWide ? [['leave']] : [['rules', true], ['leave']]);
      assert.match(text(tree), /COUP.*7/);
      if (variant === 'reformation') assert.match(text(tree), /12/);
    }
  }
});

test('action cards use intrinsic web width and bounded native font-scaled width without changing controls', () => {
  const sourceText = read('app/coup/game.tsx');
  const source = ts.createSourceFile('game.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = [];
  let minimum;
  const visit = node => {
    if (ts.isVariableDeclaration(node)) {
      if (['ACTION_LABELS', 'ACTION_ICONS'].includes(node.name.getText(source))) declarations.push(`const ${node.getText(source)};`);
      if (node.name.getText(source) === 'actionMinimumWidth') minimum = node.initializer.getText(source);
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'renderActionButton') declarations.push(`export ${node.getText(source)}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert(minimum);
  const { modules } = harness();
  const { NeonButton } = load('components/ui/NeonButton.tsx', {
    ...modules, react: { useId: () => 'action-hint' },
    './ScalePressable': { ScalePressable: 'Button' },
    '../../constants/theme': { ARCADE: colours, neonBox: () => ({}) },
  });
  const exports = {};
  const code = `${declarations.join('\n')}\nexport function minimumWidth(Platform, winWidth, fontScale, isWide) { return ${minimum}; }`;
  const compiled = ts.transpileModule(code, { fileName: 'Actions.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  vm.runInNewContext(compiled.outputText, {
    exports, require: () => ({ jsx, jsxs: jsx }), View: 'View', Text: 'Text', MaterialCommunityIcons: 'Icon',
    NeonButton, COUP: colours,
    ACTION_META: { assassinate: { cost: 3, needsTarget: true, challengeable: true, blockableBy: ['contessa'] }, income: { cost: 0, needsTarget: false, challengeable: false, blockableBy: [] } },
  });
  assert.equal(exports.minimumWidth({ OS: 'web' }, 375, 1, false), 'min-content');
  assert.equal(exports.minimumWidth({ OS: 'ios' }, 375, 1, false), 140);
  assert.equal(exports.minimumWidth({ OS: 'ios' }, 375, 2, false), 280);
  assert.equal(exports.minimumWidth({ OS: 'android' }, 320, 3, false), 292);
  assert.equal(exports.minimumWidth({ OS: 'ios' }, 1280, 3, true), 352);
  assert.equal((sourceText.match(/beginTargeting, actionMinimumWidth\)/g) ?? []).length, 3);
  const calls = [];
  for (const [action, coins, disabled] of [['assassinate', 2, true], ['assassinate', 3, false], ['income', 0, false]]) {
    const tree = exports.renderActionButton(action, coins, false, false, true, value => calls.push(['act', value]), value => calls.push(['target', value]), 'min-content');
    assert.equal(tree.props.style.width, undefined);
    assert.equal(tree.props.style.flexBasis, '48%');
    assert.equal(tree.props.style.minWidth, 'min-content');
    assert.equal(tree.props.style.maxWidth, '100%');
    assert.equal(tree.props.style.flexGrow, 1);
    const button = nodes(tree).find(node => node.type === 'Button');
    assert.equal(button.props.disabled, disabled);
    assert.equal(button.props.accessibilityLabel, action === 'assassinate' ? 'Assassinate' : 'Income');
    assert.equal(button.props.style[0].minHeight, 48);
    const label = nodes(button).find(node => node.type === 'Text' && text(node) === button.props.accessibilityLabel);
    assert.equal(label.props.style.fontSize, 14);
    assert.equal(label.props.numberOfLines, undefined);
    assert.equal(label.props.adjustsFontSizeToFit, undefined);
    assert.match(button.props.accessibilityHint, action === 'assassinate' ? /Choose an eligible player/ : /cannot be challenged/);
    if (!disabled) button.props.onPress();
  }
  assert.deepEqual(calls, [['target', 'assassinate'], ['act', 'income']]);
});
