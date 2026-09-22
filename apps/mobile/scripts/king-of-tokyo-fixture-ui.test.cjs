const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { scenarios, targetScenarios, targetMode, captureSizing, measureMarketLayout, assertMarketPacking } = require('./king-of-tokyo-fixture-ui.cjs');
const h = require('./king-of-tokyo-ui-smoke.cjs');

test('Tokyo sizing opt-in preserves the complete default ten-case campaign', () => {
  assert.equal(targetMode(undefined), false); assert.equal(targetMode('card-sizing'), true); assert.throws(() => targetMode('bay_occupied'));
  assert.deepEqual(targetScenarios, ['bay_occupied', 'card_headings']);
  assert.equal(scenarios.length, 10); assert(scenarios.includes('lab') && scenarios.includes('rapid_regeneration'));
});

test('targeted inventory covers both active ownership profiles and real kept/purchase controls', () => {
  const source = fs.readFileSync(require.resolve('./king-of-tokyo-fixture-ui.cjs'), 'utf8');
  assert.match(source, /count === 6 \? i === 0 : i === 1/);
  assert.match(source, /runRoom\(browser, 5, supplement\); await runRoom\(browser, 6, supplement\)/);
  assert.match(source, /await command\(\/\^ROLL DICE\$\//);
  assert.match(source, /host\.state\.rollCount === 2 && host\.state\.dice\[0\]\.kept && pairedAll\(\)/);
  assert.match(source, /await command\(\/\^BUY .*Regeneration/);
  assert.match(source, /#tokyo-active-dice-tray/); assert.match(source, /#tokyo-public-dice-tray/);
  assert.match(source, /assertComparable\(boxes, true\)/);
  assert.match(source, /createSupplement\(h\.qa, 64\)/); assert.match(source, /supplement\.finish\(24\)/);
  assert.match(source, /normalUI && c\.status === 200 && c\.authCleared/);
});

test('runtime market supplement captures every exact face and purchased identity without setup shots', async () => {
  const original = h.waitUntil, originalPersist = h.qa.persist;
  h.waitUntil = async predicate => assert(await predicate());
  h.qa.persist = () => {};
  try {
    const market = ['complete_destruction', 'apartment_building', 'regeneration'].map((cardId, index) => ({ cardId, instanceId: 'card-' + index }));
    const state = { revision: 10, market, players: [{ playerId: 'host', powerCards: [] }] };
    const seats = ['host', 'observer'].map(name => ({ name, auth: { playerId: name }, state: { ...state, viewerPlayerId: name }, page: { viewport: () => ({ width: name === 'host' ? 375 : 1280 }), async $eval() { return { width: 738, gap: 9, minimum: 240, textScale: 1 }; }, async $$eval() { return market.map(card => ({ id: card.instanceId, top: 0, bottom: 400, width: 240, height: 400, scrollWidth: 240, clientWidth: 240 })); } } }));
    const frames = [], record = {}, supplement = { proof: { profiles: [] }, async frame(seat, name, selector, revision, inspect) { frames.push({ name, selector, revision: revision() }); if (inspect) await inspect(seat.page); } };
    const commands = [];
    await captureSizing(seats, 'card_headings', 5, record, async pattern => {
      commands.push(String(pattern)); for (const seat of seats) seat.state.revision = 11;
      state.players[0].powerCards.push(market[2]);
    }, supplement);
    assert.equal(frames.length, 4); assert.equal(commands.length, 1);
    assert.deepEqual(frames.slice(0, 3).map(frame => frame.selector), market.map(card => `[data-testid="tokyo-power-card-${card.instanceId}"]`));
    assert.equal(frames[3].revision, 11); assert.equal(record.purchased.instanceId, 'card-2');
    assert.equal(record.marketLayouts.length, 3);
  } finally { h.waitUntil = original; h.qa.persist = originalPersist; }
});

test('actual fractional collection width and live heading scale determine market packing', () => {
  const heading = { fontSize: '17px' }, collection = { columnGap: '9px', getBoundingClientRect: () => ({ width: 632.875 }), querySelector: () => heading };
  const result = vm.runInNewContext(`(${measureMarketLayout})(collection)`, { collection, getComputedStyle: node => node });
  assert.equal(result.width, 632.875); assert.equal(result.gap, 9); assert.equal(result.textScale, 1);
  const boxes = tops => tops.map(top => ({ top }));
  assertMarketPacking({ ...result, boxes: boxes([0, 0, 400]) });
  assert.throws(() => assertMarketPacking({ ...result, boxes: boxes([0, 400, 800]) }), /available columns/);
  assert.throws(() => assertMarketPacking({ ...result, boxes: boxes([0, 0, 0]) }), /available columns/);
  assertMarketPacking({ ...result, textScale: 2, boxes: boxes([0, 400, 800]) });
  assertMarketPacking({ ...result, width: 296, boxes: boxes([0, 400, 800]) });
  assert.throws(() => assertMarketPacking({ ...result, boxes: boxes([0, 0, -400]) }), /row order/);
  for (const key of ['width', 'gap', 'textScale']) assert.throws(() => assertMarketPacking({ ...result, [key]: NaN, boxes: boxes([0, 0, 400]) }), /Invalid/);
  heading.fontSize = '34px';
  assert.equal(vm.runInNewContext(`(${measureMarketLayout})(collection)`, { collection, getComputedStyle: node => node }).textScale, 2);
  heading.fontSize = '30px';
  const compact = vm.runInNewContext(`(${measureMarketLayout})(collection, true)`, { collection, getComputedStyle: node => node });
  assert.equal(compact.minimum, 180); assert.equal(compact.textScale, 2);
  assertMarketPacking({ ...compact, width: 400, textScale: 1, boxes: boxes([0, 0, 400]) });
  assertMarketPacking({ ...compact, width: 400, boxes: boxes([0, 400, 800]) });
});

test('runtime bay supplement reads the real aria-pressed keep marker then waits for owned reroll projections', async () => {
  const originalWait = h.waitUntil, originalClick = h.clickButton;
  h.waitUntil = async predicate => assert(await predicate());
  let selected = false;
  const queriedAttributes = [];
  h.clickButton = async (_page, pattern) => { assert.equal(String(pattern), '/^Die 1:/'); selected = true; };
  try {
    const seats = ['host', 'observer'].map(name => ({ name, auth: { playerId: name }, acks: [], state: { revision: 10, viewerPlayerId: name, dice: Array.from({ length: 6 }, () => ({ face: 'energy', kept: false })) }, page: { viewport: () => ({ width: name === 'host' ? 375 : 1280 }), async $eval(selector, callback) {
      assert.equal(selector, '#tokyo-active-dice-tray [aria-label^="Die 1:"]');
      return callback({ getAttribute(attribute) { queriedAttributes.push(attribute); return attribute === 'aria-pressed' ? String(selected) : null; } });
    }, async $$eval() { return Array.from({ length: 6 }, (_, index) => ({ label: `Die ${index + 1}: energy${index ? '' : ', kept'}`, top: 0, bottom: 100, width: 88, height: 100, scrollWidth: 88, clientWidth: 88 })); } } }));
    const record = { commands: [] }, frames = [], commands = [];
    const supplement = { proof: { profiles: [] }, async frame(seat, name, selector, revision, inspect, options) { frames.push({ name, selector, revision: revision(), options }); await inspect(seat.page); } };
    await captureSizing(seats, 'bay_occupied', 5, record, async (pattern, actions) => {
      commands.push(String(pattern));
      const reroll = commands.length === 2;
      for (const action of actions) {
        for (const seat of seats) { seat.state.revision++; seat.state.phase = 'choosing_dice'; seat.state.rollCount = reroll ? 2 : 1; seat.state.dice[0].kept = reroll; }
        const ack = { action, revision: seats[0].state.revision }; seats[0].acks.push(ack); record.commands.push(ack);
      }
    }, supplement);
    assert.deepEqual(commands, ['/^ROLL DICE$/', '/^REROLL \\(/']);
    assert.deepEqual(frames.map(frame => frame.selector), ['#tokyo-active-dice-tray', '#tokyo-public-dice-tray']);
    assert(record.dice[0].kept); assert.equal(record.commands.length, 3);
    assert.equal(frames[0].options.publicTable, false); assert.equal(frames[1].options.publicTable, true);
    assert.deepEqual(record.commands.map(ack => ack.action), ['roll', 'set_kept', 'roll']);
    assert.deepEqual(queriedAttributes, ['aria-pressed']);
  } finally { h.waitUntil = originalWait; h.clickButton = originalClick; }
});
