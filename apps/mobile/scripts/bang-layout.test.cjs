const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const exportsLayout = {};
vm.runInNewContext(compile(read('components/bang/layout.ts')), { exports: exportsLayout });
const { bangLayout, bangDecisionOffset } = exportsLayout;
const source = read('app/bang/game.tsx');
const ast = ts.createSourceFile('game.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate, root = ast) {
  let found;
  function visit(node) { if (found) return; if (predicate(node)) found = node; else ts.forEachChild(node, visit); }
  visit(root); assert(found); return found;
}
const variable = name => find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name).initializer.getText(ast);
const element = id => find(node => ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr => attr.name?.text === 'nativeID' && attr.initializer?.text === id));
const attribute = (node, name) => node.openingElement.attributes.properties.find(attr => attr.name?.text === name).initializer.expression.getText(ast);
function evaluate(expression, globals) { const context = { ...globals }; vm.runInNewContext(compile(`globalThis.value = (${expression});`), context); return context.value; }
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(walk)];

test('measured phone/tablet widths stack; sufficient desktop room supports hand beside table', () => {
  for (const width of [0, 296, 351, 390, 744, 890]) assert.equal(bangLayout(width).besideTable, false);
  assert.equal(bangLayout(916).besideTable, true);
  assert.equal(bangLayout(1256).besideTable, true);
  for (const width of [916, 1000, 1256, 1336]) assert.equal(bangLayout(width, 2).besideTable, false);
  assert.equal(bangLayout(1816, 2).besideTable, true);
});

test('inline results have their own width and enlarged text threshold', () => {
  assert.equal(bangLayout(783).besideResults, false);
  assert.equal(bangLayout(784).besideResults, true);
  assert.equal(bangLayout(1224, 2).besideResults, false);
  assert.equal(bangLayout(1544, 2).besideResults, true);
  for (const width of [NaN, Infinity, -1]) assert.equal(bangLayout(width).besideTable, false);
  assert.equal(bangLayout(916, NaN).besideTable, true);
});

test('actual route layout callbacks compose ScrollView coordinates after wrapping or reconnect banners', () => {
  const decisionAnchors = { current: { play: 0, primary: 0, decision: 0, choice: 0, hand: 0, inHand: false } };
  const decisionY = { current: 0 };
  const globals = { decisionAnchors, decisionY, bangDecisionOffset, setPlayWidth() {} };
  globals.updateDecisionY = evaluate(variable('updateDecisionY'), globals);
  const handlers = Object.fromEntries(['bang-play-area', 'bang-decision-area', 'bang-hand'].map(id => [id, evaluate(attribute(element(id), 'onLayout'), globals)]));
  const decision = evaluate(variable('decisionLayout'), globals);
  const hand = evaluate(variable('handDecisionLayout'), globals);
  const event = y => ({ nativeEvent: { layout: { y, width: 1100 } } });
  handlers['bang-play-area'](event(210));
  handlers['bang-decision-area'](event(280));
  handlers['bang-hand'](event(240));
  decision(event(16));
  assert.equal(decisionY.current, 506);
  hand(event(0));
  assert.equal(decisionY.current, 730);
  handlers['bang-play-area'](event(390));
  assert.equal(decisionY.current, 910);
  handlers['bang-hand'](event(480));
  assert.equal(decisionY.current, 1150);
  decision(event(28));
  assert.equal(decisionY.current, 698);
});

test('CSS text height and native fontScale both drive the collapse', () => {
  const scale = values => evaluate(variable('textScale'), values);
  assert.equal(scale({ fontScale: 1, titleHeight: 56 }), 2);
  assert.equal(scale({ fontScale: 2, titleHeight: 28 }), 2);
  assert.equal(scale({ fontScale: 1, titleHeight: 28 }), 1);
});

test('response-to-hand attention updates even when the inner hand panel keeps its geometry', () => {
  const effect = find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useLayoutEffect' && node.arguments[0].getText(ast).includes('anchor.inHand'));
  const anchor = { play: 200, primary: 0, decision: 250, choice: 10, hand: 180, inHand: false };
  const decisionY = { current: 460 };
  const globals = { decisionAnchors: { current: anchor }, decisionY, bangDecisionOffset, priv: { canPlay: true, canDiscard: false } };
  evaluate(effect.arguments[0].getText(ast), globals)();
  assert.equal(decisionY.current, 630);
  assert.equal(anchor.inHand, true);
  globals.priv.canPlay = false;
  evaluate(effect.arguments[0].getText(ast), globals)();
  assert.equal(decisionY.current, 450);
  assert.equal(anchor.inHand, false);
});

test('Cancel restores the exact hand opener before clearing selected card and target', () => {
  const calls = [];
  const cancel = evaluate(variable('cancelPlay'), {
    useCallback: fn => fn, Platform: { OS: 'web' }, selectedId: 'card-42',
    document: { getElementById(id) { calls.push(id); return { querySelector(selector) { calls.push(selector); return { focus() { calls.push('focus'); } }; } }; } },
    setSelectedId: value => calls.push(['selected', value]), setTargetId: value => calls.push(['target', value]),
  });
  cancel();
  assert.deepEqual(calls, ['bang-card-hand-card-42', '[role="button"]', 'focus', ['selected', null], ['target', null]]);
});

function renderLocal(name, props, globals = {}) {
  const fn = find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
  const jsx = (type, props, key) => ({ type, props, key });
  const context = { exports: {}, View: 'View', Text: 'Text', MaterialCommunityIcons: 'Icon', styles: new Proxy({}, { get: (_, key) => key }), BANG: {}, ...globals, require: () => ({ jsx, jsxs: jsx }) };
  vm.runInNewContext(compile(`${fn}\nglobalThis.component = ${name};`), context);
  return context.component(props);
}

test('concealed badge resolves before any role-specific name or decoration lookup', () => {
  const hidden = renderLocal('RoleBadge', { role: null }, { BANG_ROLE_GUIDE: new Proxy({}, { get() { assert.fail('A hidden role must not read role-specific content'); } }) });
  const nodes = walk(hidden);
  assert.equal(nodes.find(node => node.type === 'Icon').props.name, 'help');
  assert.equal(nodes.find(node => node.type === 'Text').props.children, 'Hidden role');
  const decoration = nodes.find(node => node.props.importantForAccessibility === 'no-hide-descendants');
  assert.equal(decoration.props.accessible, false);
  assert.equal(decoration.props.accessibilityElementsHidden, true);
  for (const role of ['sheriff', 'deputy', 'outlaw', 'renegade']) {
    const tree = renderLocal('RoleBadge', { role }, { BANG_ROLE_GUIDE: { [role]: { name: role } } });
    assert.equal(walk(tree).find(node => node.type === 'Text').props.children, role);
    assert.notEqual(walk(tree).find(node => node.type === 'Icon').props.name, 'help');
  }
});

test('life rack shows exactly the projected capacity and remaining lives, including zero', () => {
  for (const maximum of [3, 4, 5]) for (const health of [0, 1, maximum]) {
    const nodes = walk(renderLocal('LifeTokens', { health, maximum }));
    const icons = nodes.filter(node => node.type === 'Icon');
    assert.equal(icons.length, maximum);
    assert.equal(icons.filter(node => node.props.name === 'heart').length, health);
    assert.equal(nodes.find(node => node.type === 'Text').props.children.join(''), `${health}/${maximum} life`);
  }
});

test('hand and public table remain separate; inline results keep summary and complete roster', () => {
  const play = element('bang-play-area');
  assert(element('bang-hand').getStart() > element('bang-decision-area').getStart());
  assert(element('bang-hand').getEnd() < element('bang-decision-area').getEnd());
  assert(element('bang-public-table').getStart() > element('bang-decision-area').getEnd());
  assert(element('bang-public-table').getEnd() < play.getEnd());
  const results = element('bang-results');
  assert(results.getText(ast).includes('game.players.map'));
  assert(element('bang-result-summary').getEnd() < element('bang-result-roster').getStart());
  assert(!results.getText(ast).includes('Modal'));
});

test('public stations show turn and distance only during a live active turn, never terminal sentinels', () => {
  const panel = find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'Panel'
    && node.openingElement.attributes.properties.some(attr => attr.name?.text === 'title' && attr.initializer?.text === 'Around the table'));
  const jsx = (type, props, key) => ({ type, props, key });
  for (const status of ['playing', 'game_over']) for (const alive of [true, false]) {
    const players = [{ playerId: 'a', displayName: 'Astra', character: 'bart', alive, equipment: [], health: alive ? 4 : 0, maxHealth: 4, handCount: 2 },
      { playerId: 'b', displayName: 'Lyra', character: 'bart', alive: true, equipment: [], health: 4, maxHealth: 4, handCount: 3, distanceFromActive: alive ? 2 : 99 }];
    const game = { status, activePlayerId: 'a', players }, active = players[0];
    const showTurn = evaluate(variable('showTurn'), { game, active });
    const tree = evaluate(panel.getText(ast), { exports: {}, game, active, showTurn, me: 'b', room: { players: [{ playerId: 'b', isConnected: true }] },
      Panel: 'Panel', View: 'View', Text: 'Text', RoleBadge: 'RoleBadge', LifeTokens: 'LifeTokens', BANG: { gold: 'gold' },
      BANG_CHARACTERS: { bart: { name: 'Bart Cassidy', summary: 'Character ability' } }, styles: new Proxy({}, { get: (_, key) => key }),
      require: () => ({ jsx, jsxs: jsx }) });
    const nodes = walk(tree), text = nodes.filter(node => node.type === 'Text').flatMap(node => [node.props.children].flat(Infinity)).join(' ');
    const live = status === 'playing' && alive;
    assert.equal(text.includes('TAKING TURN'), live);
    assert.equal(text.includes('Active seat'), live);
    assert.equal(text.includes('Distance 2'), live);
    assert(!text.includes('Distance 99'));
    assert.equal(text.includes('Distance is from Astra'), live);
    assert.equal(text.includes('Final table in clockwise seat order. All roles are revealed.'), status === 'game_over');
    assert(text.includes('Connected'));
    const station = nodes.find(node => node.props.nativeID === 'bang-seat-a');
    assert.equal(station.props.style.some(style => style?.borderColor === 'gold'), live);
  }
});
