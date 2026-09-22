const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../app/king-of-tokyo/game.tsx'), 'utf8');
const ast = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function descendants(node, predicate) {
  const found = [];
  function visit(item) { if (predicate(item)) found.push(item); ts.forEachChild(item, visit); }
  visit(node);
  return found;
}
const attribute = (element, name) => element.openingElement.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.text === name)?.initializer;
function element(id) {
  const matches = descendants(ast, node => ts.isJsxElement(node) && attribute(node, 'nativeID')?.text === id);
  assert.equal(matches.length, 1, `One ${id} owner`);
  return matches[0];
}
function evaluate(expression, globals = {}) {
  const code = ts.transpileModule(`globalThis.result = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { ...globals };
  vm.runInNewContext(code, context);
  return context.result;
}
const style = (id, globals) => evaluate(attribute(element(id), 'style').expression.getText(ast), globals);
function declaration(name, globals) {
  const node = descendants(ast, item => ts.isVariableDeclaration(item) && item.name.getText(ast) === name)[0];
  assert(node?.initializer);
  return evaluate(node.initializer.getText(ast), globals);
}

test('desktop columns use measured play width and yield to native enlarged text', () => {
  for (const [width, scale, expected] of [[320, 1, false], [844, 1, false], [959, 1, false], [960, 1, true], [1200, 1, true], [1200, 2, false]]) {
    assert.equal(declaration('decisionBesideTable', { showDecisionZone: true, playAreaWidth: width, textScale: scale }), expected);
    const wrapper = style('king-play-area', { decisionBesideTable: expected });
    assert.equal(wrapper.flexDirection, expected ? 'row' : 'column');
    assert.equal(wrapper.flexWrap, 'wrap');
    const column = style('king-current-decision', { decisionBesideTable: expected, columnMinimum: 0 });
    assert.equal(column.maxWidth, '100%');
    assert.equal(column.minWidth, 0);
    assert.equal(column.flexShrink, 1);
    assert.equal(column.width, expected ? undefined : '100%');
  }
  assert.equal(declaration('decisionBesideTable', { showDecisionZone: false, playAreaWidth: 1200, textScale: 1 }), false);
  assert.equal(declaration('isWide', { decisionBesideTable: false, playAreaWidth: 1200, textScale: 1 }), true);
});

test('decision and public table are siblings and scroll focus measures their direct scroll child', () => {
  const area = element('king-play-area');
  assert.equal(area.parent.openingElement.tagName.getText(ast), 'ScrollView');
  const decision = element('king-current-decision');
  assert.equal(decision.parent.parent.parent.parent, area);
  assert.equal(element('tokyo-table-state').parent, area);
  assert.equal(attribute(decision, 'onLayout'), undefined);
  const ref = { current: 0 }; let measured = 0;
  const onLayout = evaluate(attribute(area, 'onLayout').expression.getText(ast), {
    decisionZoneYRef: ref, setPlayAreaWidth: value => { measured = value; },
  });
  onLayout({ nativeEvent: { layout: { width: 1080, y: 236 } } });
  assert.equal(measured, 1080); assert.equal(ref.current, 236);
  assert.match(source, /scrollTo\(\{ y: Math.max\(0, decisionZoneYRef.current - 12\)/);
});

test('both trays wrap the actual authoritative dice without fixed slot heights', () => {
  for (const id of ['tokyo-active-dice-tray', 'tokyo-public-dice-tray']) {
    const tray = style(id, { TOKYO: { border: '#263' } });
    assert.equal(tray.flexWrap, 'wrap');
    assert.equal(tray.alignItems, 'stretch');
    assert.equal(tray.height, undefined);
    assert(tray.paddingBottom >= tray.padding + 4);
    assert.match(element(id).getText(ast), /game.dice.map\(/);
  }
});

test('active, public and defence dice share the measured live heading scale', () => {
  const dice = descendants(ast, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'TokyoDie');
  assert.equal(dice.length, 3);
  for (const die of dice) {
    const scale = die.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.text === 'textScale');
    assert.equal(scale.initializer.expression.getText(ast), 'dieTextScale');
  }
  const section = descendants(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === 'SectionTitle')[0];
  const sectionHeading = descendants(section, node => ts.isJsxElement(node) && attribute(node, 'ref')?.expression?.getText(ast) === 'textRef')[0];
  const decisionHeading = descendants(ast, node => ts.isJsxElement(node) && attribute(node, 'ref')?.expression?.getText(ast) === 'decisionHeadingRef')[0];
  for (const [heading, refName, callbackName, base] of [[sectionHeading, 'textRef', 'onTextScale', 13], [decisionHeading, 'decisionHeadingRef', 'setDieTextScale', 12]]) {
    const ref = { current: {} }, measured = []; let font = base + 'px';
    const globals = { [refName]: ref, [callbackName]: value => measured.push(value), Platform: { OS: 'web' }, window: { getComputedStyle: () => ({ fontSize: font }) } };
    const callback = evaluate(attribute(heading, 'onLayout').expression.getText(ast), globals);
    callback(); font = base * 2 + 'px'; callback(); font = base + 'px'; callback();
    assert.deepEqual(measured, [1, 2, 1]);
    font = 'invalid'; callback(); ref.current = null; callback(); globals.Platform.OS = 'ios'; callback();
    assert.deepEqual(measured, [1, 2, 1]);
  }
  assert.match(source, /title="CURRENT DICE" onTextScale=\{setDieTextScale\}/);
});

test('defence alternatives retain full column width and preference targets retain a 48px floor', () => {
  for (const id of ['tokyo-camouflage-actions', 'tokyo-wings-actions', 'tokyo-rapid-healing-actions']) {
    const actions = style(id);
    assert.equal(actions.width, '100%');
    assert.equal(actions.minWidth, 0);
    assert.equal(actions.flexDirection, 'column');
    assert.equal(actions.height, undefined);
    assert.equal(actions.maxHeight, undefined);
  }
  const chip = descendants(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === 'ChoiceChip')[0];
  const control = descendants(chip, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'ScalePressable')[0];
  const target = evaluate(attribute(control, 'style').expression.getText(ast), { active: false, color: '#fff', disabled: false, TOKYO: { border: '#263', surface: '#123' } });
  assert.equal(target.minWidth, 48);
  assert.equal(target.minHeight, 48);
  assert.equal(target.height, undefined);
});

test('results preserve one outcome/actions group and live unclamped roster with stable avatar indices', () => {
  const summary = element('tokyo-result-summary');
  const roster = element('tokyo-result-roster');
  assert.equal(summary.parent, roster.parent);
  assert.equal(element('tokyo-result-actions').parent, summary);
  assert.match(roster.getText(ast), /game.players.map\(\(player, index\)/);
  assert.match(roster.getText(ast), /profileIndex=\{index\}/);
  assert.match(roster.getText(ast), /player.forfeited \? 'FORFEITED'/);
  assert.doesNotMatch(roster.getText(ast), /numberOfLines|\.sort\(/);
  assert.match(summary.getText(ast), /game.terminationReason/);
  assert.match(summary.getText(ast), /game.victoryType === 'victory_points'/);
  assert.match(summary.getText(ast), /game.victoryType === 'last_monster_standing'/);
});
