const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../components/remaining/RemainingLanding.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];

function harness({ presentation, width = 320, height = 900, fontScale = 1, reduced = false, createPending, storagePending, storedName } = {}) {
  const hooks = [];
  const effects = [];
  const calls = [];
  let cursor = 0;
  let tree;
  let mounted = true;
  let lateWrites = 0;
  let blur;
  let computedTitleSize = NaN;
  const response = { token: 'synthetic', roomCode: 'TEST-ROOM', playerId: 'p1', room: { gameId: 'saboteur' } };
  const react = {
    useState(initial) { const i = cursor++; hooks[i] ??= { value: initial }; return [hooks[i].value, value => { if (!mounted) lateWrites++; hooks[i].value = value; }]; },
    useRef(initial) { const i = cursor++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useCallback(fn) { cursor++; return fn; },
    useEffect(fn) { const i = cursor++; if (!hooks[i]) { hooks[i] = {}; effects.push(() => { hooks[i].cleanup = fn(); }); } },
  };
  const jsx = (type, props) => {
    if (type === 'TextInput') props.ref.current = { focus: () => calls.push(['focus', props.accessibilityLabel]) };
    if (type === 'Text' && props.ref) props.ref.current = {};
    return { type, props };
  };
  const animation = { duration: () => animation, delay: () => animation, springify: () => animation, damping: () => animation };
  const modules = {
    '../../constants/typography': require('./lib/typography-fixture.cjs'),
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', TextInput: 'TextInput', ScrollView: 'ScrollView', Platform: { OS: 'web' }, useWindowDimensions: () => ({ width, height, fontScale }) },
    'react-native-reanimated': { default: { View: 'Animated.View' }, FadeInDown: animation, FadeInUp: animation },
    'expo-router': { router: { push: route => calls.push(['push', route]) }, useFocusEffect: fn => { react.useEffect(() => { blur = fn(); return blur; }); } },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' },
    '../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => reduced },
    '../../constants/theme': { ARCADE: { bg: '#120D1D', pink: '#FF2E88' }, neonText: () => ({ textShadowColor: 'gold' }) },
    '../ui/NeonButton': { NeonButton: 'NeonButton' }, '../ui/ScalePressable': { ScalePressable: 'ScalePressable' },
    '../../lib/api': { createRoom: async (...args) => { calls.push(['createRoom', ...args]); return createPending ? createPending.promise : response; }, leaveRoom: async (...args) => { calls.push(['leaveRoom', ...args]); } },
    '../../lib/storage': {
      loadDisplayName: async () => storedName?.promise,
      saveDisplayName: async name => { calls.push(['saveDisplayName', name]); },
      clearAuthIfMatches: async token => { calls.push(['clearAuthIfMatches', token]); },
      saveAuthIfCurrent: async (auth, current) => { calls.push(['saveAuthIfCurrent', auth]); if (storagePending) await storagePending.promise; return current(); },
    },
    '../../store/useGameStore': { useGameStore: { getState: () => ({ setAuth: value => calls.push(['setAuth', value]), setRoom: value => calls.push(['setRoom', value]) }) } },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, Error, window: { getComputedStyle: () => ({ fontSize: String(computedTitleSize) }) }, require: id => { assert(id in modules, id); return modules[id]; } });
  const props = { presentation, gameId: 'saboteur', base: '/saboteur', title: 'SABOTEUR', tagline: 'Dig towards the gold, protect your tools, and decide who you trust.', tags: ['SECRET ROLES', '3–10 PLAYERS', '3 ROUNDS'], createLabel: 'OPEN THE MINE', mark: { type: 'Mark', props: {} }, hero: { type: 'Art', props: {} }, palette: Object.fromEntries(['bg', 'surface', 'panel', 'border', 'accent', 'secondary', 'muted', 'text'].map(key => [key, key])), renderRules: (visible, onClose) => ({ type: 'Rules', props: { visible, onClose } }) };
  const render = () => { cursor = 0; tree = exports.RemainingLanding(props); while (effects.length) effects.shift()(); };
  const find = label => { const found = nodes(tree).find(node => node.props.accessibilityLabel === label || node.props.label === label); assert(found, label); return found.props; };
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); if (mounted) render(); };
  render();
  return { calls, response, props, find, render, flush, nodes: () => nodes(tree), count: name => calls.filter(call => call[0] === name).length,
    fill: (label, value) => { find(label).onChangeText(value); render(); },
    layout: width => { nodes(tree).find(node => node.props.onLayout)?.props.onLayout({ nativeEvent: { layout: { width } } }); render(); },
    titleScale: scale => { computedTitleSize = (width < 360 ? 24 : width < 560 ? 28 : 36) * scale; nodes(tree).find(node => node.props.children === props.title && node.props.onLayout).props.onLayout(); render(); },
    blur: () => blur(), unmount: () => { mounted = false; hooks.forEach(hook => hook?.cleanup?.()); }, lateWrites: () => lateWrites,
  };
}

test('classic remains the default with its existing hero, marks, controls and width', () => {
  const h = harness();
  assert.equal(h.nodes().filter(node => node.type === 'Mark').length, 2);
  assert.equal(h.nodes().filter(node => node.type === 'NeonButton').length, 3);
  assert(h.nodes().some(node => node.props.style?.maxWidth === 720));
  assert(h.nodes().some(node => node.props.style?.boxShadow?.startsWith('0 0')));
});

test('optional-password guidance remains visible when empty or typed in either presentation', () => {
  for (const presentation of ['classic', 'illustrated']) {
    const h = harness({ presentation });
    for (const value of ['', 'private table']) {
      h.fill('Room password, optional', value);
      const password = h.find('Room password, optional');
      assert.equal(password.placeholder, 'Password');
      assert.equal(password.secureTextEntry, true);
      assert.equal(password.maxLength, 64);
      assert.equal(password.value, value);
      const helpers = h.nodes().filter(node => node.props.children === 'Leave blank for an open room');
      assert.equal(helpers.length, 1);
      assert.equal(helpers[0].props.style.fontSize, 16);
      assert.equal(helpers[0].props.style.height, undefined);
      assert.equal(helpers[0].props.numberOfLines, undefined);
    }
  }
});

test('illustrated layout follows measured parent width and enlarged native text', () => {
  for (const [width, fontScale, expected] of [[320, 1, 'column'], [720, 1, 'row'], [768, 1, 'row'], [1000, 1, 'row'], [1120, 1.5, 'row'], [1120, 2, 'column']]) {
    const h = harness({ presentation: 'illustrated', width: 1280, fontScale });
    h.layout(width);
    const container = h.nodes().find(node => node.props.onLayout);
    assert.equal(container.props.style.flexDirection, expected);
    assert.equal(container.props.style.maxWidth, 1120);
    assert.equal(h.nodes().filter(node => node.type === 'Mark').length, 0);
    assert.equal(h.nodes().filter(node => node.type === 'Art').length, 1);
  }
});

test('web title enlargement stacks columns and restores the original layout without shrinking text', () => {
  const h = harness({ presentation: 'illustrated', width: 768 });
  h.layout(720);
  const direction = () => h.nodes().find(node => node.props.onLayout).props.style.flexDirection;
  assert.equal(direction(), 'row');
  h.titleScale(2); assert.equal(direction(), 'column');
  assert.equal(h.nodes().find(node => node.props.children === h.props.title).props.style.fontSize, 36);
  h.titleScale(1); assert.equal(direction(), 'row');
  h.titleScale(NaN); assert.equal(direction(), 'row');
});

test('illustrated entrance title uses a readable narrow-phone base with unchanged body text', () => {
  for (const [width, size] of [[320, 24], [359, 24], [360, 28], [375, 28], [768, 36]]) {
    const h = harness({ presentation: 'illustrated', width });
    const title = h.nodes().find(node => node.props.children === h.props.title);
    assert.equal(title.props.style.fontSize, size);
    assert.equal(title.props.allowFontScaling, undefined);
    assert.equal(title.props.numberOfLines, undefined);
    assert.equal(h.nodes().find(node => node.props.children === h.props.tagline).props.style.fontSize, 16);
  }
});

test('short landscape bounds the complete illustration and keeps narrow introductions beside it', () => {
  for (const [width, height, measuredWidth, row, artWidth] of [[844, 390, 796, true, '100%'], [568, 320, 520, false, '30%'], [844, 390, 796, false, '30%']]) {
    const fontScale = width === 844 && !row ? 2 : 1;
    const h = harness({ presentation: 'illustrated', width, height, fontScale });
    h.layout(measuredWidth);
    const container = h.nodes().find(node => node.props.onLayout);
    assert.equal(container.props.style.flexDirection, row ? 'row' : 'column');
    const art = h.nodes().find(node => node.props.children?.type === 'Art');
    assert.equal(art.props.style.width, artWidth);
    assert.equal(art.props.style.maxWidth, height * 0.6);
    assert.equal(art.props.style.height, undefined);
    assert.equal(art.props.style.flexShrink, 0);
  }
  const portrait = harness({ presentation: 'illustrated', width: 375, height: 812 });
  const art = portrait.nodes().find(node => node.props.children?.type === 'Art');
  assert.equal(art.props.style.width, '100%');
  assert.equal(art.props.style.maxWidth, undefined);
});

test('illustrated copy grows naturally, retains semantics and removes glow and entrance movement', () => {
  const h = harness({ presentation: 'illustrated' });
  for (const node of h.nodes()) {
    assert.equal(node.props.style?.height, undefined);
    assert.equal(node.props.style?.maxHeight, undefined);
    assert.equal(node.props.numberOfLines, undefined);
    assert.equal(node.props.style?.boxShadow, undefined);
    if (node.type === 'Animated.View') assert.equal(node.props.entering, undefined);
  }
  const tagline = h.nodes().find(node => node.props.children === h.props.tagline);
  assert.equal(tagline.props.style.fontFamily, 'Outfit_400Regular');
  assert.equal(tagline.props.style.fontSize, 16);
  assert.equal(h.nodes().filter(node => node.props.accessibilityRole === 'header').length, 2);
  for (const label of ['CREATE ROOM', 'JOIN WITH CODE', 'HOW TO PLAY']) {
    const button = h.nodes().find(node => node.props.label === label);
    const rendered = button.type(button.props);
    assert.equal(rendered.type, 'ScalePressable');
    assert.equal(rendered.props.accessibilityLabel, label);
    assert.equal(rendered.props.style.minHeight, 48);
    assert.equal(rendered.props.style.boxShadow, undefined);
  }
});

test('both variants honour reduced motion and maintain keyboard/rules/join actions', async () => {
  for (const presentation of ['classic', 'illustrated']) {
    const h = harness({ presentation, reduced: true });
    for (const node of h.nodes().filter(node => node.type === 'Animated.View')) assert.equal(node.props.entering, undefined);
    h.find('CREATE ROOM').onPress();
    assert(h.calls.some(call => call[0] === 'focus' && call[1] === 'Your name'));
    h.find('Your name').onSubmitEditing();
    assert(h.calls.some(call => call[0] === 'focus' && call[1] === 'Room password, optional'));
    h.find('HOW TO PLAY').onPress(); h.render();
    assert.equal(h.nodes().find(node => node.type === 'Rules').props.visible, true);
    h.nodes().find(node => node.type === 'Rules').props.onClose(); h.render();
    assert.equal(h.nodes().find(node => node.type === 'Rules').props.visible, false);
    h.find('JOIN WITH CODE').onPress();
    assert(h.calls.some(call => call[0] === 'push' && call[1] === '/saboteur/join'));
    await h.flush();
  }
});

for (const presentation of ['classic', 'illustrated']) {
  test(`${presentation}: actual create body preserves password, duplicate fence and busy controls`, async () => {
    const pending = deferred();
    const h = harness({ presentation, createPending: pending });
    h.fill('Your name', ' Miner '); h.fill('Room password, optional', ' exact ');
    h.find('CREATE ROOM').onPress(); h.find('Room password, optional').onSubmitEditing(); h.render();
    assert.equal(h.count('createRoom'), 1);
    assert.deepEqual(h.calls.find(call => call[0] === 'createRoom'), ['createRoom', 'Miner', ' exact ', 'saboteur', undefined]);
    for (const label of ['CREATING…', 'JOIN WITH CODE', 'HOW TO PLAY']) assert.equal(h.find(label).disabled, true);
    assert.equal(h.find('Your name').editable, false);
    pending.resolve(h.response); await h.flush();
    assert.equal(h.count('setAuth'), 1);
    assert(h.calls.some(call => call[0] === 'push' && call[1] === '/saboteur/lobby'));
    assert.equal(h.count('leaveRoom'), 0);
  });

  test(`${presentation}: abandoned creation releases its seat without adopting or late state writes`, async () => {
    const pending = deferred();
    const h = harness({ presentation, createPending: pending });
    h.fill('Your name', 'Miner'); h.find('CREATE ROOM').onPress(); h.unmount();
    pending.resolve(h.response); await h.flush();
    assert.equal(h.count('leaveRoom'), 1);
    assert.equal(h.count('saveAuthIfCurrent'), 0);
    assert.equal(h.count('setAuth'), 0);
    assert.equal(h.count('push'), 0);
    assert.equal(h.lateWrites(), 0);
  });

  test(`${presentation}: late storage completion after blur clears only created credentials`, async () => {
    const pending = deferred();
    const h = harness({ presentation, storagePending: pending });
    h.fill('Your name', 'Miner'); h.find('CREATE ROOM').onPress(); await h.flush(); h.blur();
    pending.resolve(); await h.flush();
    assert.deepEqual(h.calls.find(call => call[0] === 'clearAuthIfMatches'), ['clearAuthIfMatches', h.response.token]);
    assert.equal(h.count('leaveRoom'), 1);
    assert.equal(h.count('setAuth'), 0);
    assert.equal(h.count('push'), 0);
  });
}

test('illustrated storage failure remains retryable and late remembered name cannot overwrite edits', async () => {
  const pending = deferred(); const name = deferred();
  const h = harness({ presentation: 'illustrated', storagePending: pending, storedName: name });
  h.fill('Your name', 'Chosen'); h.find('CREATE ROOM').onPress(); await h.flush();
  name.resolve('Old'); pending.reject(new Error('Storage unavailable')); await h.flush();
  assert.equal(h.find('Your name').value, 'Chosen');
  assert.equal(h.find('CREATE ROOM').disabled, false);
  assert.equal(h.count('leaveRoom'), 1);
  assert(h.nodes().some(node => node.props.accessibilityRole === 'alert' && node.props.children === 'Storage unavailable'));
});

test('all nine illustrated entrances use their own static scenes and preserve fallbacks', () => {
  const route = fs.readFileSync(path.join(__dirname, '../app/saboteur/index.tsx'), 'utf8');
  assert.match(route, /presentation="illustrated"/);
  assert.match(route, /<GameCover nativeID="saboteur-entrance-art" source=\{require\('\.\.\/\.\.\/assets\/game-art\/saboteur-hero\.webp'\)\}/);
  assert(!route.includes('SaboteurHeroArtwork'));
  const colt = fs.readFileSync(path.join(__dirname, '../app/colt-express/index.tsx'), 'utf8');
  assert.match(colt, /presentation="illustrated"/);
  assert.match(colt, /colt-hero\.webp/);
  assert.match(colt, /nativeID="colt-entrance-art"/);
  assert(!colt.includes('RemainingHero'));
  const coup = fs.readFileSync(path.join(__dirname, '../app/coup/index.tsx'), 'utf8');
  assert.match(coup, /presentation="illustrated"/);
  assert.match(coup, /coup-hero\.webp/);
  assert.match(coup, /nativeID="coup-entrance-art"/);
  assert.match(coup, /fallback=\{<CoupMark size=\{100\}/);
  assert(!coup.includes('CoupHeroArtwork'));
  for (const [game, artwork] of [['king-of-tokyo', 'tokyo'], ['skull-king', 'skull'], ['citadels', 'citadels'], ['not-alone', 'not-alone'], ['bang', 'bang'], ['libertalia', 'libertalia']]) {
    const entrance = fs.readFileSync(path.join(__dirname, '../app', game, 'index.tsx'), 'utf8');
    assert(entrance.includes('presentation="illustrated"'));
    assert(entrance.includes(`${artwork}-hero.webp`));
    assert(entrance.includes(`nativeID="${artwork}-entrance-art"`));
    assert(entrance.includes('fallback='));
    assert(!entrance.includes('RemainingHero'));
  }
});

function coverHarness() {
  let failed = null;
  const sourceRef = { current: null };
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: { useState: () => [failed, value => { failed = value; }], useRef: () => sourceRef },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'react-native': { Image: 'Image', View: 'View', StyleSheet: { absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } } },
    '../../constants/theme': { ARCADE: { surface: 'surface' } },
  };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/ui/GameCover.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => { assert(id in modules, id); return modules[id]; } });
  return props => exports.GameCover(props);
}

test('Coup lobby identity uses only decorative identical concealed influences', () => {
  const jsx = (type, props) => ({ type, props });
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View' },
    './CharacterCard': { CharacterCard: 'CharacterCard' },
  };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/coup/CoupTableMark.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => { assert(id in modules, id); return modules[id]; } });
  const tree = exports.CoupTableMark();
  assert.equal(tree.props.accessible, false);
  assert.equal(tree.props.accessibilityElementsHidden, true);
  assert.equal(tree.props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(tree.props.pointerEvents, 'none');
  const cards = nodes(tree).filter(node => node.type === 'CharacterCard');
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.equal(card.props.faceDown, true);
    assert.equal(card.props.character, undefined);
    assert.equal(card.props.onPress, undefined);
    assert.equal(card.props.size, 'xs');
  }
  const lobby = fs.readFileSync(path.join(__dirname, '../app/coup/lobby.tsx'), 'utf8');
  assert.match(lobby, /mark=\{<CoupTableMark \/>\}/);
  assert.match(lobby, /state\.room\?\.config\.coupVariant \?\? 'base'/);
  assert.match(lobby, /minPlayers=\{COUP_LIMITS\[variant\]\.min\}/);
  assert.match(lobby, /variant=\{variant\}/);
});

test('GameCover reserves a decorative noninteractive full-composition ratio without animation', () => {
  const tree = coverHarness()({ source: 1, nativeID: 'saboteur-entrance-art' });
  assert.equal(tree.props.nativeID, 'saboteur-entrance-art');
  assert.equal(tree.props.style.aspectRatio, 1.5);
  assert.equal(tree.props.style.width, '100%');
  assert.equal(tree.props.pointerEvents, 'none');
  assert.equal(tree.props.accessible, false);
  assert.equal(tree.props.accessibilityElementsHidden, true);
  assert.equal(tree.props.importantForAccessibility, 'no-hide-descendants');
  const image = nodes(tree).find(node => node.type === 'Image');
  assert.equal(image.props.resizeMode, 'contain');
  assert.equal(image.props.alt, '');
  assert.equal(image.props.source, 1);
  const imageStyle = Object.assign({}, ...image.props.style);
  assert.equal(imageStyle.width, '100%');
  assert.equal(imageStyle.height, '100%');
  assert.equal(imageStyle.position, 'absolute');
  assert.equal(tree.props.entering, undefined);
});

test('GameCover retains geometry on errors and does not let an old source error hide its replacement', () => {
  const render = coverHarness(); const fallback = { type: 'Fallback', props: {} };
  const image = tree => nodes(tree).find(node => node.type === 'Image');
  const hasFallback = tree => nodes(tree).includes(fallback);
  const previous = render({ source: 1, fallback, aspectRatio: 2 });
  image(previous).props.onError();
  const failed = render({ source: 1, fallback, aspectRatio: 2 });
  assert(hasFallback(failed));
  assert.equal(image(failed), undefined);
  assert.equal(failed.props.style.aspectRatio, 2);
  const next = render({ source: 2, fallback, aspectRatio: 2 });
  image(previous).props.onError();
  assert.equal(image(render({ source: 2, fallback })).props.source, 2);
  image(next).props.onError();
  assert(hasFallback(render({ source: 2, fallback })));
  image(previous).props.onError();
  assert(hasFallback(render({ source: 2, fallback })));
  assert.equal(image(render({ source: 3 })).props.source, 3);
});

test('GameCover rejects invalid ratios without losing its loading footprint', () => {
  const render = coverHarness();
  for (const aspectRatio of [0, -1, NaN, Infinity]) assert.equal(render({ source: 1, aspectRatio }).props.style.aspectRatio, 1.5);
});
