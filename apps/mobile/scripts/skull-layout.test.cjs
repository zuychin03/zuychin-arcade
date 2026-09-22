const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../app/skull-king/game.tsx'), 'utf8');
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
const palette = { teal: '#fff', gold: '#fc4', coral: '#f67', surface: '#123', border: '#234' };

test('Skull desktop columns use measured width and stack for native enlarged text', () => {
  for (const [width, scale, expected] of [[320, 1, false], [844, 1, false], [899, 1, false], [900, 1, true], [1240, 1, true], [1240, 2, false]]) {
    assert.equal(declaration('decisionBesideTable', { playAreaWidth: width, textScale: scale }), expected);
    const wrapper = style('skull-play-area', { decisionBesideTable: expected });
    assert.equal(wrapper.flexDirection, expected ? 'row' : 'column');
    assert.equal(wrapper.flexWrap, 'wrap');
    for (const id of ['skull-decision-area', 'skull-public-table']) {
      const column = style(id, { decisionBesideTable: expected, narrow: false, myTurn: true, game: { phase: 'bidding' }, SKULL_KING: palette });
      assert.equal(column.minWidth, 0);
      assert.equal(column.maxWidth, '100%');
      assert.equal(column.flexShrink, 1);
      assert.equal(column.width, expected ? undefined : '100%');
      assert.equal(column.height, undefined);
    }
  }
});

test('decision attention measures the direct scroll child, with one hand beside one public table', () => {
  const area = element('skull-play-area');
  const decision = element('skull-decision-area');
  assert.equal(area.parent.openingElement.tagName.getText(ast), 'ScrollView');
  assert.equal(decision.parent, area);
  assert.equal(element('skull-public-table').parent, area);
  assert.equal(element('skull-current-trick').parent, element('skull-public-table'));
  assert.equal(element('skull-scoreboard').parent, element('skull-public-table'));
  assert.equal(attribute(decision, 'onLayout'), undefined);
  const ref = { current: 0 }; let measured = 0;
  const onLayout = evaluate(attribute(area, 'onLayout').expression.getText(ast), {
    decisionZoneYRef: ref, setPlayAreaWidth: value => { measured = value; },
  });
  onLayout({ nativeEvent: { layout: { width: 940, y: 214 } } });
  assert.equal(measured, 940); assert.equal(ref.current, 214);
  assert.match(source, /scrollTo\(\{ y: Math.max\(0, decisionZoneYRef.current - 8\)/);
  assert.match(decision.getText(ast), /nativeID="skull-king-decision-heading"/);
  const rail = element('skull-hand');
  const padding = evaluate(attribute(rail, 'contentContainerStyle').expression.getText(ast));
  assert(padding.paddingTop >= 10 && padding.paddingBottom >= 10);
  assert.match(rail.getText(ast), /mine.legalCardIds.includes\(card.id\)/);
});

test('bid counters have a 48px floor but grow with two-digit text without changing secret commands', () => {
  const counters = element('skull-bid-counters');
  const control = descendants(counters, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'ScalePressable')[0];
  for (const busy of [false, true]) {
    const sizing = evaluate(attribute(control, 'style').expression.getText(ast), { busy, SKULL_KING: palette });
    assert.equal(sizing.minWidth, 48); assert.equal(sizing.minHeight, 48);
    assert.equal(sizing.width, undefined); assert.equal(sizing.height, undefined);
    assert(sizing.paddingHorizontal > 0 && sizing.paddingVertical > 0);
    assert.equal(evaluate(attribute(control, 'disabled').expression.getText(ast), { busy }), busy);
  }
  const calls = [];
  const press = evaluate(attribute(control, 'onPress').expression.getText(ast), { bid: 10, sendAction: (...args) => calls.push(args) });
  press();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['skull_king:bid', 'Bid 10', { bid: 10 }, { kind: 'bid', bid: 10 }]]);
});

test('live table owners and scoreboard retain full names, active-seat counts and hidden-bid guards', () => {
  const trick = element('skull-current-trick').getText(ast);
  const scoreboard = element('skull-scoreboard').getText(ast);
  assert.match(trick, /game.currentTrick.map\(/);
  assert.match(trick, /game.turnOrder.length/);
  assert.match(trick, /player.playerId === card.playerId/);
  assert.doesNotMatch(trick, /numberOfLines|width: 76/);
  assert.match(scoreboard, /game.bidsRevealed \? `\$\{player.tricksWon\} \/ \$\{player.bid\} TRICKS` : player.bidSubmitted \? 'BID LOCKED'/);
  assert.match(scoreboard, /skullKingForfeitStatus\(game, player\)/);
  assert.doesNotMatch(scoreboard, /opacity:|numberOfLines/);
  assert.doesNotMatch(element('skull-toolbar').getText(ast), /numberOfLines/);
});

test('unbroken public owner names may wrap without widening the physical card holder', () => {
  const owners = descendants(element('skull-current-trick'), node => ts.isJsxElement(node) && attribute(node, 'nativeID')?.expression?.getText(ast).includes('skull-trick-owner-'));
  assert.equal(owners.length, 1);
  for (const platform of ['web', 'ios', 'android']) {
    const sizing = evaluate(attribute(owners[0], 'style').expression.getText(ast), { Platform: { OS: platform }, SKULL_KING: palette });
    assert.equal(sizing.width, '100%');
    assert.equal(sizing.minWidth, 0);
    assert.equal(sizing.overflowWrap, platform === 'web' ? 'anywhere' : undefined);
    assert.equal(sizing.height, undefined);
  }
  assert.equal(attribute(owners[0], 'numberOfLines'), undefined);
});

test('results keep outcome and actions together, ordered full-name standings beside them and the ledger below', () => {
  const summary = element('skull-result-summary');
  const roster = element('skull-result-roster');
  assert.equal(summary.parent, roster.parent);
  assert.equal(element('skull-result-actions').parent, summary);
  assert.match(summary.getText(ast), /noWinnerCopy.detail/);
  assert.match(roster.getText(ast), /winner \? 'FINAL STANDINGS' : 'VOYAGE RECORD'/);
  assert.match(roster.getText(ast), /Number\(a.forfeited\) - Number\(b.forfeited\) \|\| b.totalScore - a.totalScore/);
  assert.match(roster.getText(ast), /FORFEITED · \$\{player.totalScore\} HISTORICAL/);
  assert.doesNotMatch(roster.getText(ast), /numberOfLines|opacity:/);
  const ledger = descendants(element('skull-king-game-over'), node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'SkullKingScorecard');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].parent, element('skull-king-game-over'));
  assert.match(ledger[0].getText(ast), /history=\{game.scoreHistory \?\? \[\]\}/);
  assert.equal(declaration('resultsWide', { width: 1280, textScale: 1 }), true);
  assert.equal(declaration('resultsWide', { width: 1280, textScale: 2 }), false);
});
