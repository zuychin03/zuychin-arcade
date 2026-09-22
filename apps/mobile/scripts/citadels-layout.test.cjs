const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../app/citadels/game.tsx'), 'utf8');
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
const palette = { royal: '#79f', gold: '#fc4', crimson: '#f67', surface: '#123', panel: '#124', border: '#234' };

test('Citadels measured columns stack for phones and native enlarged text', () => {
  for (const [width, scale, expected] of [[320, 1, false], [844, 1, false], [899, 1, false], [900, 1, true], [1240, 1, true], [1240, 2, false]]) {
    assert.equal(declaration('decisionBesideTable', { playAreaWidth: width, textScale: scale }), expected);
    const wrapper = style('citadels-play-area', { decisionBesideTable: expected });
    assert.equal(wrapper.flexDirection, expected ? 'row' : 'column');
    assert.equal(wrapper.flexWrap, 'wrap');
    for (const id of ['citadels-private-table', 'citadels-public-table']) {
      const column = style(id, { decisionBesideTable: expected });
      assert.equal(column.minWidth, 0);
      assert.equal(column.maxWidth, '100%');
      assert.equal(column.flexShrink, 1);
      assert.equal(column.width, expected ? undefined : '100%');
      assert.equal(column.height, undefined);
    }
  }
});

test('nested decision attention composes both layout offsets regardless of callback order', () => {
  const area = element('citadels-play-area');
  const decision = element('citadels-decision-area');
  const privateTable = element('citadels-private-table');
  assert.equal(area.parent.openingElement.tagName.getText(ast), 'ScrollView');
  assert.equal(privateTable.parent, area);
  assert.equal(element('citadels-public-table').parent, area);
  assert.equal(decision.parent, privateTable);
  assert.equal(element('citadels-private-hand').parent, privateTable);
  assert(element('citadels-private-hand').pos < decision.pos);
  for (const order of [['area', 'decision'], ['decision', 'area']]) {
    const globals = { playAreaYRef: { current: 0 }, decisionWithinColumnYRef: { current: 0 }, decisionZoneYRef: { current: 0 }, setPlayAreaWidth: () => {} };
    const handlers = {
      area: evaluate(attribute(area, 'onLayout').expression.getText(ast), globals),
      decision: evaluate(attribute(decision, 'onLayout').expression.getText(ast), globals),
    };
    for (const name of order) handlers[name]({ nativeEvent: { layout: { width: 940, y: name === 'area' ? 214 : 360 } } });
    assert.equal(globals.decisionZoneYRef.current, 574);
    handlers.decision({ nativeEvent: { layout: { y: 460 } } });
    assert.equal(globals.decisionZoneYRef.current, 674);
  }
  assert.match(source, /scrollTo\(\{ y: Math.max\(0, decisionZoneYRef.current - 10\)/);
  assert.match(decision.getText(ast), /nativeID="citadels-decision-heading"/);
});

test('every physical-card rail reserves depth and selection space without limiting height', () => {
  const rails = descendants(element('citadels-play-area'), node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'ScrollView');
  assert.equal(rails.length, 5);
  for (const rail of rails) {
    const spacing = evaluate(attribute(rail, 'contentContainerStyle').expression.getText(ast));
    assert(spacing.paddingTop >= 12 && spacing.paddingBottom >= 16);
    assert.equal(spacing.height, undefined);
    assert(attribute(rail, 'nativeID'));
  }
  assert.match(element('citadels-hand').getText(ast), /mine.hand.map\(/);
  assert.match(element('citadels-draft').getText(ast), /mine.availableRoles.map\(/);
  assert.match(element('citadels-income').getText(ast), /mine.drawnCards.map\(/);
});

test('choice controls grow around text with a 48px floor and retain supplied action semantics', () => {
  const fn = descendants(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === 'ChoiceButton')[0];
  const button = descendants(fn, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'ScalePressable')[0];
  for (const scale of [1, 2]) {
    const sizing = evaluate(attribute(button, 'style').expression.getText(ast), { fontScale: scale, color: '#abc', CITADELS: palette, disabled: false });
    assert(sizing.minWidth >= 48 && sizing.minHeight >= 48);
    assert.equal(sizing.maxWidth, '100%');
    assert.equal(sizing.flexBasis, 184 * scale);
    assert.equal(sizing.flexShrink, 1);
    assert.equal(sizing.width, undefined);
    assert.equal(sizing.height, undefined);
  }
  assert.equal(attribute(button, 'onPress').expression.getText(ast), 'onPress');
  assert.equal(attribute(button, 'disabled').expression.getText(ast), 'disabled');
});

test('public cities and roster use public roles and actual districts, never hidden role artwork', () => {
  const table = element('citadels-public-table').getText(ast);
  assert.doesNotMatch(table, /mine\.|CitadelsRoleCard|chosenRole|numberOfLines/);
  assert.match(table, /player.revealedRole \? ` Revealed as/);
  assert.match(table, /player.city.map\(\(district\)/);
  assert.match(table, /player.city.map\(\(card\)/);
  assert.match(table, /playerForfeited\(player\)/);
  assert.match(table, /RECONNECTING · SEAT RESERVED BRIEFLY/);
});

test('unbroken names wrap intrinsically on web without unsupported native CSS', () => {
  for (const platform of ['web', 'ios', 'android']) {
    const sizing = declaration('nameWrapping', { Platform: { OS: platform } });
    assert.equal(sizing.minWidth, 0);
    assert.equal(sizing.maxWidth, '100%');
    assert.equal(sizing.overflowWrap, platform === 'web' ? 'anywhere' : undefined);
  }
  const names = descendants(ast, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'Text' && /\{player.displayName(?:\.toUpperCase\(\))?\}/.test(node.getText(ast)));
  assert(names.length >= 4);
  for (const node of names) {
    assert.match(attribute(node, 'style').expression.getText(ast), /\.\.\.nameWrapping/);
    assert.equal(attribute(node, 'numberOfLines'), undefined);
  }
  assert.match(attribute(element('citadels-completion-banner'), 'style').expression.getText(ast), /\.\.\.nameWrapping/);
});

test('results retain ranking and unscored semantics beside the original rematch and leave controls', () => {
  const summary = element('citadels-result-summary');
  const roster = element('citadels-result-roster');
  const actions = element('citadels-result-actions');
  assert.equal(summary.parent, roster.parent);
  assert.equal(actions.parent, summary);
  assert.match(summary.getText(ast), /citadelsNoWinnerMessage\(game.terminationReason\)/);
  assert.match(roster.getText(ast), /unscored \? 'COURT RECORD' : 'FINAL STANDINGS'/);
  assert.match(roster.getText(ast), /unscored \? 0 : Number\(playerForfeited\(a\)\) - Number\(playerForfeited\(b\)\)/);
  assert.match(roster.getText(ast), /score.districtPoints.*score.diversityBonus.*score.completionBonus.*score.uniqueBonus/);
  assert.match(roster.getText(ast), /'FORFEITED' : 'NOT SCORED'/);
  assert.doesNotMatch(roster.getText(ast), /numberOfLines|opacity:/);
  assert.match(actions.getText(ast), /rematchNeedsNewCourt/);
  assert.match(actions.getText(ast), /onPress=\{rematch\}/);
  assert.match(actions.getText(ast), /onPress=\{requestLeave\}/);
  assert.match(actions.getText(ast), /void leave\('\/citadels'\)/);
  assert.equal(declaration('resultsWide', { width: 1280, textScale: 1 }), true);
  assert.equal(declaration('resultsWide', { width: 1280, textScale: 2 }), false);
});
