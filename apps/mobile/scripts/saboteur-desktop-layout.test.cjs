const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const screenSource = fs.readFileSync(path.join(__dirname, '../app/saboteur/game.tsx'), 'utf8');
const screenFile = ts.createSourceFile('game.tsx', screenSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  const node = screenFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert(node, name);
  return ts.transpileModule(node.getText(screenFile), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const helpers = {};
vm.runInNewContext(declaration('mineLayout') + declaration('currentActionMessage')
  + '\nObject.assign(globalThis, { mineLayout, currentActionMessage });', helpers);

test('desktop uses adjacent columns and exposes over six mine rows instead of three', () => {
  const layout = helpers.mineLayout(1280, 844, 1);
  assert.equal(layout.wide, true);
  assert(layout.boardWidth >= 5 * 64 + 36);
  assert(1280 - layout.boardWidth - 48 >= 480);
  assert(layout.scrollViewportHeight / 92 > 6);
  assert.equal(layout.boardHeight, undefined);
});

test('phones, tablet and short landscape retain their original board allocation', () => {
  for (const [width, height] of [[320, 844], [375, 844], [414, 844], [768, 844], [844, 390]]) {
    const layout = helpers.mineLayout(width, height, 1);
    assert.equal(layout.wide, false, `${width}x${height}`);
    assert.equal(layout.boardWidth, undefined);
    assert.equal(layout.scrollViewportHeight, undefined);
    assert.equal(layout.boardHeight, height === 390 ? 280 : 324);
  }
});

test('available width and enlarged native text can reflow desktop into a stack', () => {
  assert.equal(helpers.mineLayout(1280, 844, 2).wide, false);
  assert.equal(helpers.mineLayout(900, 844, 1).wide, false);
  assert.equal(helpers.mineLayout(960, 844, 1).wide, true);
  assert.equal(helpers.mineLayout(1920, 1080, 2).wide, true);
  assert(helpers.mineLayout(1280, 390, 1).scrollViewportHeight >= 560);
});

function findJsx(id) {
  let found;
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(screenFile) === 'nativeID'
      && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === id)) found = node;
    ts.forEachChild(node, visit);
  };
  visit(screenFile);
  assert(found, id);
  return found;
}

test('mine and decision columns are siblings and decision content has no fixed height', () => {
  const workspace = findJsx('saboteur-workspace');
  const mine = findJsx('saboteur-mine-column');
  const decision = findJsx('saboteur-decision-column');
  const hand = findJsx('saboteur-hand-controls');
  assert.equal(mine.parent, workspace);
  assert.equal(decision.parent, workspace);
  assert.equal(hand.parent, decision);
  for (const node of [workspace, decision, hand]) {
    const style = node.openingElement.attributes.properties.find(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(screenFile) === 'style');
    assert(!/\b(?:height|maxHeight|overflow)\s*:/.test(style.getText(screenFile)));
  }
});

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function board(props) {
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: { useMemo: fn => fn(), useRef: () => ({ current: null }), useEffect() {} },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'Scroll', Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 1280 }) },
    '@zuychin-arcade/types': { BOARD: { playableBounds: { minRow: 0, maxRow: 8, minCol: 2, maxCol: 6 } } },
    './BoardCell': { BoardCell: 'Cell' },
    '../../../constants/theme': { ARCADE: {}, MINE: {} },
    '../../ui/NeonButton': { NeonButton: 'Button' },
    '../../../hooks/useReducedMotionPreference': { useReducedMotionPreference: () => true },
  };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../components/saboteur/board/GameBoard.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: id => { assert(id in modules, id); return modules[id]; } });
  return exports.GameBoard({ board: [], goals: [], validTargets: new Set(), actionTargets: new Set(), peekedGoals: [], round: 1, interactionActive: true, onCellPress() {}, ...props });
}

test('board honours measured column width, retains 45 cells and never shrinks below 48px', () => {
  for (const [availableWidth, expectedCellWidth] of [[440, 64], [320, 56], [276, 48]]) {
    const tree = board({ availableWidth, scrollViewportHeight: 684 });
    const cells = nodes(tree).filter(node => node.type === 'Cell');
    assert.equal(cells.length, 45);
    assert(cells.every(cell => cell.props.width === expectedCellWidth));
    assert.equal(new Set(cells.map(cell => cell.props.row)).size, 9);
    assert.equal(new Set(cells.map(cell => cell.props.col)).size, 5);
    assert.equal(nodes(tree).find(node => node.type === 'Scroll').props.style.height, 684);
    assert.equal(tree.props.style.flex, undefined);
  }
});

const sent = { token: 'session-a', roomCode: 'LOCAL', phase: '1:playing:', revision: 20 };

test('current-phase pending, rejection and confirmed messages remain visible', () => {
  for (const message of ['Move…', 'Move confirmed.', 'Action not accepted: stale move. Refreshing the mine.']) {
    assert.equal(helpers.currentActionMessage(message, sent, sent), message);
    assert.equal(helpers.currentActionMessage(message, sent, { ...sent, revision: 21 }), message);
  }
});

test('late confirmations cannot cross round, reward-picker, terminal or rematch boundaries', () => {
  for (const phase of ['1:round_end:', '1:round_end:p1', '2:playing:', '1:game_over:']) {
    assert.equal(helpers.currentActionMessage('Move confirmed.', sent, { ...sent, phase, revision: 21 }), null);
  }
  const reward = { ...sent, phase: '2:round_end:p1' };
  assert.equal(helpers.currentActionMessage('Gold choice confirmed.', reward, { ...reward, phase: '2:round_end:p2', revision: 21 }), null);
  const rematch = { ...sent, phase: '3:game_over:' };
  assert.equal(helpers.currentActionMessage('Starting a fresh match confirmed.', rematch, { ...rematch, phase: '1:game_over:', revision: 22 }), null);
});

test('acknowledgements from other sessions or superseded revisions stay hidden', () => {
  for (const current of [{ ...sent, token: 'session-b' }, { ...sent, roomCode: 'OTHER' }, { ...sent, revision: 19 }, { ...sent, revision: 22 }]) {
    assert.equal(helpers.currentActionMessage('Move confirmed.', sent, current), null);
  }
  assert.equal(helpers.currentActionMessage('Move confirmed.', null, sent), null);
});

test('all sends bind display scope only after the unchanged controller accepts the command', () => {
  let send;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(screenFile) === 'sendAction') send = node;
    ts.forEachChild(node, visit);
  };
  visit(screenFile);
  assert(send);
  const calls = [], scopes = [];
  let accepted = true;
  const context = {
    publicState: { revision: 20 }, currentMessageScope: sent,
    actions: { send: (...args) => { calls.push(args); return accepted; } },
    setActionMessageScope: scope => scopes.push(scope),
  };
  vm.runInNewContext(ts.transpileModule(`globalThis.send = ${send.initializer.getText(screenFile)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  assert.equal(context.send('pass_turn', {}, 'Pass'), true);
  assert.deepEqual(calls[0], ['pass_turn', {}, 'Pass', 20]);
  assert.equal(scopes[0].revision, 20);
  accepted = false;
  assert.equal(context.send('pass_turn', {}, 'Pass'), false);
  assert.equal(scopes.length, 1);
  accepted = true;
  context.send('play_action', { cardId: 'repair' }, 'Repair', 21);
  assert.equal(scopes[1].revision, 21);
  assert.equal((screenSource.match(/actions\.send\(/g) ?? []).length, 1);
});
