const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const NOT_ALONE = { bg: '#0D0818', surface: '#17102A', panel: '#24163B', border: '#4A3470', signal: '#B57BFF', creature: '#FF6685', amber: '#F6C85F', muted: '#A798BF', text: '#F8F3FF' };
const placeNames = ['lair', 'jungle', 'river', 'beach', 'rover', 'swamp', 'shelter', 'wreck', 'source', 'artefact'];
const jsx = (type, props, key) => typeof type === 'function' ? type(props) : { type, props, key };
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);

function load(file, modules, globals = {}) {
  const filename = path.resolve(__dirname, '..', file), exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual(compiled.diagnostics, []);
  vm.runInNewContext(compiled.outputText, { ...globals, exports, require: name => { assert(name in modules, name); return modules[name]; } });
  return exports;
}

const definitions = load('../../packages/types/src/not-alone-constants.ts', {});
function harness({ platform = 'web', fontScale = 1, width = 375, actualSurface = false } = {}) {
  let measuredScale = 1, measuredFont = 18;
  const textRef = { current: null };
  const modules = {
    '../../constants/typography': require('./lib/typography-fixture.cjs'),
    react: { useRef: () => textRef, useState: () => [measuredScale, value => { measuredScale = value; }] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', Image: 'Image', StyleSheet: { absoluteFill: {} }, Platform: { OS: platform }, useWindowDimensions: () => ({ width, fontScale }) },
    '@expo/vector-icons': { MaterialCommunityIcons: 'Icon' }, '@zuychin-arcade/types': definitions,
    '../../constants/theme': { NOT_ALONE, ARCADE: NOT_ALONE }, '../ui/ScalePressable': { ScalePressable: 'Button' }, '../ui/CardIllustration': { CardIllustration: 'Cover' },
  };
  modules['../../hooks/useMeasuredTextScale'] = load('hooks/useMeasuredTextScale.ts', modules, {
    window: { getComputedStyle: node => { assert.equal(node, textRef.current); return { fontSize: `${measuredFont}px` }; } },
  });
  for (const name of placeNames) modules[`../../assets/game-art/not-alone-place-${name}.webp`] = name;
  modules['expo-linear-gradient'] = { LinearGradient: 'Gradient' };
  modules['../ui/CardSurface'] = actualSurface ? load('components/ui/CardSurface.tsx', modules) : { CardSurface: 'Surface' };
  for (const [family, cards] of [['survival', definitions.NOT_ALONE_SURVIVAL_CARDS], ['hunt', definitions.NOT_ALONE_HUNT_CARDS]]) {
    for (const card of cards) modules[`../../assets/game-art/not-alone-${family}-${card.id}.webp`] = `${family}-${card.id}`;
  }
  modules['./PowerArtwork'] = load('components/not-alone/PowerArtwork.tsx', modules);
  modules['./PlaceArtwork'] = load('components/not-alone/PlaceArtwork.tsx', modules);
  return { ...load('components/not-alone/PlaceCard.tsx', modules), ...load('components/not-alone/CardChip.tsx', modules), modules, setMeasuredFont: value => { measuredFont = value; }, setWidth: value => { width = value; } };
}

test('all ten Place identities use canonical prepared art and verbatim live powers', () => {
  const { NotAlonePlaceCard } = harness();
  for (const place of definitions.NOT_ALONE_PLACES) {
    const tree = NotAlonePlaceCard({ placeId: place.id });
    assert.equal(tree.props.testID, `not-alone-place-card-${place.id}`);
    assert.equal(tree.props.accessibilityLabel, `Place ${place.id}, ${place.name}. ${place.summary}`);
    assert.equal(tree.props.accessible, true);
    assert(text(tree).includes(place.name)); assert(text(tree).includes(`Place ${place.id}`));
    const power = nodes(tree).find(node => node.type === 'Text' && node.props.children === place.summary);
    assert.equal(power.props.style.fontFamily, 'Outfit_400Regular'); assert(power.props.style.fontSize >= 14); assert(power.props.style.lineHeight >= 20);
    const cover = nodes(tree).find(node => node.type === 'Cover');
    assert.equal(cover.props.source, placeNames[place.id - 1]);
    assert(fs.existsSync(path.resolve(__dirname, '../assets/game-art', `not-alone-place-${placeNames[place.id - 1]}.webp`)));
    const art = nodes(tree).find(node => node.props.testID === `not-alone-place-art-${place.id}`);
    assert.equal(art.props.accessibilityElementsHidden, true); assert.equal(art.props.pointerEvents, 'none');
    assert.equal(nodes(tree).filter(node => node.type === 'Button').length, 0);
  }
});

test('selected, blocked, ineffective and unavailable states preserve exact action semantics without conflation', () => {
  const { NotAlonePlaceCard } = harness(), place = definitions.NOT_ALONE_PLACE_BY_ID[10], onPress = () => {};
  for (const selected of [false, true]) for (const disabled of [false, true]) for (const selectionBlocked of [false, true]) for (const powerDisabled of [false, true]) {
    const tree = NotAlonePlaceCard({ placeId: 10, selected, disabled, selectionBlocked, powerDisabled, onPress });
    const buttons = nodes(tree).filter(node => node.type === 'Button'); assert.equal(buttons.length, 1);
    const button = buttons[0];
    assert.equal(button.props.accessibilityLabel, `Place 10, ${place.name}. ${place.summary}${selected ? ' Selected.' : ''}${selectionBlocked ? ' Inaccessible this turn.' : ''}${powerDisabled ? ' Place power ineffective this turn.' : ''}${disabled && !selectionBlocked ? ' Not available.' : ''}`);
    assert.equal(button.props.onPress, onPress); assert.equal(button.props.disabled, disabled || selectionBlocked);
    assert.equal(button.props.accessibilityState.disabled, disabled || selectionBlocked); assert.equal(button.props.accessibilityState.selected, selected);
    assert.equal(button.props.accessibilityHint, disabled || selectionBlocked ? undefined : 'Select this Place card');
    assert(button.props.style.minHeight >= 48); assert.equal(tree.props.accessible, false);
    assert.equal(nodes(tree).filter(node => node.type === 'Text' && text(node) === 'Selected').length, Number(selected));
    assert.equal(nodes(tree).filter(node => node.props.name === 'check-circle').length, Number(selected));
    if (selectionBlocked) assert(text(tree).includes('INACCESSIBLE'));
    if (powerDisabled) assert(text(tree).includes('POWER INEFFECTIVE'));
    if (powerDisabled && !disabled && !selectionBlocked) assert(nodes(tree).some(node => node.props.name === 'flash-off'));
    if (disabled || selectionBlocked) assert(nodes(tree).some(node => node.props.name === 'lock-outline'));
    const surface = nodes(tree).find(node => node.type === 'Surface');
    assert.equal(surface.props.disabled, undefined); assert.equal(surface.props.selected, selected); assert.equal(surface.props.depth, 3);
  }
});

test('River cards announce immediate commitment while ordinary choices retain deferred selection hints', () => {
  const { NotAlonePlaceCard } = harness();
  const hint = 'Choose this as your real destination immediately';
  const onPress = () => {};
  const button = props => nodes(NotAlonePlaceCard({ placeId: 3, onPress, ...props })).find(node => node.type === 'Button');
  assert.equal(button({}).props.accessibilityHint, 'Select this Place card');
  assert.equal(button({ accessibilityHint: hint }).props.accessibilityHint, hint);
  assert.equal(button({ accessibilityHint: hint }).props.onPress, onPress);
  assert.equal(button({ accessibilityHint: hint, disabled: true }).props.accessibilityHint, undefined);
  assert.equal(button({ accessibilityHint: hint, selectionBlocked: true }).props.accessibilityHint, undefined);
  const game = fs.readFileSync(path.resolve(__dirname, '../app/not-alone/game.tsx'), 'utf8');
  const river = game.slice(game.indexOf('!tableChoicePending && mine.canChooseRiver'), game.indexOf('!tableChoicePending && mine.canSelect'));
  assert(river.includes(`accessibilityHint="${hint}"`));
  assert.match(river, /onPress=\{\(\) => sendAction\('notalone:river-choice', 'river_choice'/);
});

test('Place focus is forwarded only for enabled actions and never selects or commits a card', () => {
  for (const platform of ['web', 'ios', 'android']) {
    const { NotAlonePlaceCard } = harness({ platform });
    for (const disabled of [false, true]) for (const selectionBlocked of [false, true]) {
      let focuses = 0, presses = 0;
      const onFocus = () => { focuses++; }, onPress = () => { presses++; };
      const tree = NotAlonePlaceCard({ placeId: 3, selected: true, disabled, selectionBlocked, powerDisabled: true, onFocus, onPress });
      const button = nodes(tree).find(node => node.type === 'Button');
      assert.equal(button.props.onFocus, disabled || selectionBlocked ? undefined : onFocus);
      button.props.onFocus?.();
      assert.equal(focuses, disabled || selectionBlocked ? 0 : 1); assert.equal(presses, 0);
      assert.equal(button.props.accessibilityState.selected, true); assert.equal(button.props.onPress, onPress);
      assert.match(button.props.accessibilityLabel, /Place 3, The River\./);
      assert.equal(nodes(tree).filter(node => node.type === 'Text' && text(node) === 'Selected').length, 1);
    }
    const informational = NotAlonePlaceCard({ placeId: 3, onFocus() { assert.fail('Informational card cannot focus an action'); } });
    assert.equal(informational.props.onFocus, undefined); assert(!nodes(informational).some(node => node.type === 'Button'));
  }
});

test('Place width grows for native text without content-derived width, while fluid cards retain their measured owner', () => {
  for (const compact of [false, true]) {
    const web = harness().NotAlonePlaceCard({ placeId: 10, compact });
    assert.equal(web.props.style.width, compact ? 176 : 208); assert.equal(web.props.style.minWidth, 0);
    const native = harness({ platform: 'ios', width: 320, fontScale: 2 }).NotAlonePlaceCard({ placeId: 10, compact });
    assert.equal(native.props.style.width, 256); assert.equal(native.props.style.maxWidth, '100%');
    const fluid = harness({ platform: 'android', width: 320, fontScale: 2 }).NotAlonePlaceCard({ placeId: 10, compact, fluid: true });
    assert.equal(fluid.props.style.width, '100%'); assert.equal(fluid.props.style.minWidth, 0);
    assert.equal(harness({ fontScale: NaN }).NotAlonePlaceCard({ placeId: 10, compact }).props.style.width, compact ? 176 : 208);
    const art = nodes(fluid).find(node => node.props.testID === 'not-alone-place-art-10');
    const cover = nodes(art).find(node => node.type === 'Cover');
    assert.equal(cover.props.aspectRatio, 1);
    assert.equal(art.props.style.width, '100%');
    assert.equal(art.props.style.maxWidth, undefined);
    for (const tree of [web, native, fluid]) {
      assert.equal(tree.props.style.height, undefined); assert.equal(tree.props.style.paddingBottom, 3);
      assert(nodes(tree).filter(node => node.type === 'Text').every(node => node.props.numberOfLines === undefined && node.props.allowFontScaling !== false && node.props.style.height === undefined && node.props.style.width === undefined));
    }
  }
});

test('measured Place names give mixed states the same bounded width and reset after text or viewport changes', () => {
  for (const platform of ['web', 'ios', 'android']) for (const compact of [false, true]) for (const scale of [1, 2]) {
    const h = harness({ platform, fontScale: platform === 'web' ? 1 : scale, width: 1280 });
    const variants = [
      { placeId: 1 },
      { placeId: 7, selected: true },
      { placeId: 10, selected: true, selectionBlocked: true, powerDisabled: true },
      { placeId: 5, disabled: true },
    ];
    let presses = 0, focuses = 0, faceHeight = 0;
    const onPress = () => { presses++; }, onFocus = () => { focuses++; };
    const faceSizing = { minimumHeight: 480, measurementKey: 'current-face', onMeasure: value => { faceHeight = value; } };
    for (const viewport of [1280, 320, 375, 1280]) for (const observedScale of [scale, 1, scale]) {
      h.setWidth(viewport); h.setMeasuredFont(18 * observedScale);
      for (const fluid of [false, true]) for (const variant of variants) {
        const props = { ...variant, compact, fluid, faceSizing, onPress, onFocus };
        const first = h.NotAlonePlaceCard(props);
        const name = nodes(first).find(node => node.type === 'Text' && node.props.children === definitions.NOT_ALONE_PLACE_BY_ID[variant.placeId].name);
        assert.equal(name.props.style.fontSize, 18); assert(name.props.ref);
        name.props.ref.current = {}; name.props.onLayout();
        const tree = h.NotAlonePlaceCard(props);
        const effectiveScale = platform === 'web' ? observedScale : scale;
        const expected = fluid ? '100%' : Math.min((compact ? 176 : 208) * effectiveScale, viewport - 64);
        assert.equal(tree.props.style.width, expected); assert.equal(tree.props.style.minWidth, 0);
        assert.equal(tree.props.style.maxWidth, '100%'); assert.equal(tree.props.style.flexGrow, fluid ? 1 : undefined);
        assert.equal(tree.props.style.minHeight, 483);
        const measurement = nodes(tree).find(node => node.key === 'current-face');
        measurement.props.onLayout({ nativeEvent: { layout: { height: 417 } } }); assert.equal(faceHeight, 417);
        const button = nodes(tree).find(node => node.type === 'Button');
        assert.equal(button.props.onPress, onPress);
        assert.equal(button.props.onFocus, variant.disabled || variant.selectionBlocked ? undefined : onFocus);
        assert.equal(button.props.accessibilityState.selected, !!variant.selected);
        assert.equal(button.props.disabled, !!(variant.disabled || variant.selectionBlocked));
        assert(text(tree).includes(definitions.NOT_ALONE_PLACE_BY_ID[variant.placeId].summary));
        if (variant.selectionBlocked) assert(text(tree).includes('INACCESSIBLE · POWER INEFFECTIVE'));
        assert(nodes(tree).filter(node => node.type === 'Text').every(node => node.props.numberOfLines === undefined && node.props.style.height === undefined));
      }
    }
    assert.equal(presses, 0); assert.equal(focuses, 0);
  }
});

test('physical faces never dim disabled copy and reserve their shallow edge inside the test bounds', () => {
  const { NotAlonePlaceCard, CardChip } = harness({ actualSurface: true });
  for (const tree of [NotAlonePlaceCard({ placeId: 1, disabled: true, selected: true }), CardChip({ cardId: 'private', title: 'Unavailable · P2', body: 'Complete rules.', color: NOT_ALONE.creature, disabled: true, needsOptions: false, onPress() {} })]) {
    assert.equal(tree.props.style.paddingBottom, 3);
    const surface = nodes(tree).find(node => node.props.pointerEvents === 'box-none' && node.props.style?.opacity !== undefined);
    assert.equal(surface.props.style.opacity, 1);
    const edge = nodes(tree).find(node => node.props.style?.bottom === -3); assert(edge);
    assert.equal(edge.props.pointerEvents, 'none'); assert.equal(edge.props.accessibilityElementsHidden, true);
    assert(!nodes(tree).filter(node => node.type === 'Text').some(node => node.props.style?.opacity !== undefined));
  }
});

test('private CardChip keeps all three exact labels, hints, enabled states and caller actions', () => {
  const { CardChip } = harness(), onPress = () => {};
  for (const disabled of [false, true]) for (const needsOptions of [false, true]) {
    const title = 'Forbidden Zone · P2', body = 'Every Hunted discards one Place card.';
    const tree = CardChip({ cardId: 'forbidden_zone', title, body, color: NOT_ALONE.creature, disabled, needsOptions, onPress });
    assert.equal(tree.props.testID, 'not-alone-card-chip-forbidden_zone'); assert.equal(tree.props.style.width, 220); assert.equal(tree.props.style.maxWidth, '100%');
    const buttons = nodes(tree).filter(node => node.type === 'Button'); assert.equal(buttons.length, 1);
    const button = buttons[0], action = disabled ? 'NOT AVAILABLE NOW' : needsOptions ? 'CHOOSE OPTIONS' : 'PLAY CARD NOW';
    assert.equal(button.props.accessibilityLabel, `${title}. ${body} ${action}`);
    assert.equal(button.props.accessibilityHint, disabled ? 'This card is unavailable during the current decision' : needsOptions ? 'Choose options before playing this card' : 'Plays this card immediately');
    assert.equal(button.props.disabled, disabled); assert.equal(button.props.accessibilityState.disabled, disabled); assert.equal(button.props.onPress, onPress); assert(button.props.style.minHeight >= 48);
    assert.equal(nodes(tree).filter(node => node.type === 'Text' && text(node) === action).length, 1);
    assert(text(tree).includes(title)); assert(text(tree).includes(body)); assert(!text(tree).includes('forbidden_zone'));
    assert.equal(nodes(tree).find(node => node.type === 'Cover').props.source, 'hunt-forbidden_zone');
    assert.equal(nodes(tree).find(node => node.type === 'Surface').props.disabled, undefined);
  }
});

test('every canonical Hunt and Survival card keeps complete title, phase and prose with caller-controlled width', () => {
  const { CardChip } = harness({ platform: 'android', fontScale: 2 });
  for (const card of [...definitions.NOT_ALONE_HUNT_CARDS, ...definitions.NOT_ALONE_SURVIVAL_CARDS]) {
    const title = `${card.name} · P${card.phase || 'COPY'}`;
    const tree = CardChip({ cardId: card.id, width: 284, title, body: card.summary, color: NOT_ALONE.signal, disabled: false, needsOptions: true, onPress() {} });
    assert.equal(tree.props.style.width, 284); assert.equal(tree.props.style.height, undefined);
    assert(text(tree).includes(title)); assert(text(tree).includes(card.summary));
    const copy = nodes(tree).filter(node => node.type === 'Text');
    assert(copy.every(node => node.props.style.fontSize >= 14 && node.props.style.lineHeight >= 20 && node.props.numberOfLines === undefined && node.props.allowFontScaling !== false && node.props.style.height === undefined));
  }
});

test('all 35 power identities preserve complete copy, bounded decorative artwork and canonical source receipts', () => {
  const { CardChip, modules } = harness();
  const seen = new Set();
  for (const [family, cards] of [['survival', definitions.NOT_ALONE_SURVIVAL_CARDS], ['hunt', definitions.NOT_ALONE_HUNT_CARDS]]) {
    for (const card of cards) {
      const tree = CardChip({ cardId: card.id, title: card.name, body: card.summary, color: NOT_ALONE.signal, disabled: false, needsOptions: true, onPress() {} });
      const art = nodes(tree).find(node => node.props.testID === `not-alone-power-art-${card.id}`);
      assert.equal(art.props.style.width, '100%');
      assert.equal(art.props.style.maxWidth, undefined);
      assert.equal(art.props.pointerEvents, 'none');
      assert.equal(art.props.accessibilityElementsHidden, true);
      const cover = nodes(art).find(node => node.type === 'Cover');
      assert.equal(cover.props.source, `${family}-${card.id}`);
      assert.equal(cover.props.aspectRatio, 1);
      assert.equal(cover.props.rimColor, undefined);
      assert(text(tree).includes(card.summary));
      assert.equal(nodes(tree).filter(node => node.type === 'Button').length, 1);
      assert(nodes(tree).filter(node => node.type === 'Text').every(node => node.props.numberOfLines === undefined));
      seen.add(cover.props.source);
      const key = `not-alone-${family}-${card.id}`;
      const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../assets/game-art', `${key}-manifest.json`), 'utf8'));
      assert.equal(manifest.source.file, `docs/design/game-art/${key}.png`);
      assert(manifest.outputs[0].bytes <= 48 * 1024);
    }
  }
  assert.equal(seen.size, 35);
  const unknown = modules['./PowerArtwork'].PowerArtwork({ cardId: 'unknown', color: NOT_ALONE.signal });
  assert(!nodes(unknown).some(node => node.type === 'Cover'));
  assert(nodes(unknown).some(node => node.props.name === 'cards-outline'));
});

test('public rules examples reuse exact power identities and measure the ten-Place catalogue independently', () => {
  const { modules, NotAlonePlaceCard } = harness();
  modules['./PlaceCard'] = { NotAlonePlaceCard };
  const measuredIds = [];
  modules['../../hooks/useIntrinsicCardHeight'] = { useIntrinsicCardHeight(ids) {
    assert.equal(ids.length, 10);
    return { forCard(id) { measuredIds.push(id); return { minimumHeight: 480, measurementKey: 'rules', onMeasure() {} }; } };
  } };
  const { NotAloneRulesGuide } = load('components/not-alone/RulesGuide.tsx', modules);
  const tree = NotAloneRulesGuide();
  assert.equal(measuredIds.length, 10);
  const covers = nodes(tree).filter(node => node.type === 'Cover');
  for (const [source, card] of [['survival-dodge', definitions.NOT_ALONE_SURVIVAL_BY_ID.dodge], ['hunt-clone', definitions.NOT_ALONE_HUNT_BY_ID.clone]]) {
    assert.equal(covers.filter(node => node.props.source === source).length, 1);
    assert(text(tree).includes(card.summary));
  }
  assert(text(tree).includes('Public examples only, not anyone’s hand.'));
  assert(!nodes(tree).some(node => node.type === 'Button'));
  for (const surface of nodes(tree).filter(node => node.type === 'Surface')) {
    const power = nodes(surface).find(node => node.props.testID?.startsWith('not-alone-power-art-'));
    if (power) assert([surface.props.children].flat(Infinity).includes(power));
  }
});

test('private power cards place full-width art directly on their single outer face', () => {
  const { CardChip } = harness();
  const tree = CardChip({ cardId: 'dodge', title: 'Dodge', body: 'Complete rules', color: NOT_ALONE.signal, disabled: false, needsOptions: false, onPress() {} });
  const surfaces = nodes(tree).filter(node => node.type === 'Surface');
  assert.equal(surfaces.length, 1);
  const art = nodes(tree).find(node => node.props.testID === 'not-alone-power-art-dodge');
  assert([surfaces[0].props.children].flat(Infinity).includes(art));
  assert.equal(art.props.style.width, '100%');
  for (const field of ['padding', 'maxWidth', 'borderRadius', 'borderWidth']) assert.equal(art.props.style[field], undefined);
});

test('card illustration fences retired Place errors and exposes only decorative fallback for the current source', () => {
  let failed = null; const sourceRef = { current: null }, { modules } = harness();
  modules.react = { useState: () => [failed, value => { failed = value; }], useRef: () => sourceRef };
  const { CardIllustration } = load('components/ui/CardIllustration.tsx', modules);
  const { PlaceArtwork } = modules['./PlaceArtwork'];
  const lair = nodes(PlaceArtwork({ placeId: 1, color: NOT_ALONE.signal })).find(node => node.type === 'Cover');
  const rover = nodes(PlaceArtwork({ placeId: 5, color: NOT_ALONE.signal })).find(node => node.type === 'Cover');
  const old = CardIllustration(lair.props), current = CardIllustration(rover.props);
  nodes(old).find(node => node.type === 'Image').props.onError(); assert.equal(failed, null);
  nodes(current).find(node => node.type === 'Image').props.onError(); assert.equal(failed, 'rover');
  const fallback = CardIllustration(rover.props);
  assert(!nodes(fallback).some(node => node.type === 'Image')); assert(nodes(fallback).some(node => node.props.name === 'robot-outline'));
  assert.equal(fallback.props.accessibilityElementsHidden, true); assert.equal(fallback.props.pointerEvents, 'none');
  const recovered = CardIllustration(lair.props);
  assert.equal(nodes(recovered).find(node => node.type === 'Image').props.source, 'lair');
});
