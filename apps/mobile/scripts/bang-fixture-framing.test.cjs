const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const h = require('./bang-fixture-framing.cjs');
const source = fs.readFileSync(path.join(__dirname, 'bang-fixture-framing.cjs'), 'utf8');

function actorFor(scenario, state) {
  const spec = h.MANIFEST[scenario][state];
  const make = names => names.map((name, index) => ({ id: `${name}-${index + 1}`, name }));
  const actor = { name: spec.owner, sent: [], public: { gameId: 'bang', roomCode: 'QAQA-QAQA', revision: 10, status: 'playing', phase: 'fixture',
    players: ['Astra Host', 'Lyra', 'Noor', 'Echo'].map((displayName, index) => ({ displayName, playerId: `p${index}`, alive: spec.living === 2 ? index < 2 : true })) },
  private: { gameId: 'bang', roomCode: 'QAQA-QAQA', revision: 10, [spec.flag]: true, hand: [] } };
  actor.private.playerId = actor.public.players.find(player => player.displayName === spec.owner).playerId;
  if (scenario === 'lucky_check') actor.public.drawCheck = { cards: make(['bang', 'beer']) };
  if (scenario.startsWith('sid_')) actor.private.hand = make(['bang', 'missed']);
  if (scenario === 'beer_rescue') { actor.private.hand = make(state === 'ready' ? ['beer', 'beer'] : ['beer']); actor.public.rescue = { livesNeeded: spec.lives }; }
  if (scenario === 'discard_order') actor.private.discardOrderCards = make(['beer', 'barrel']);
  if (scenario === 'kit_draw') actor.private.drawChoice = { options: make(['bang', 'beer', 'missed']) };
  if (spec.drawKind) actor.private.drawChoice = { kind: spec.drawKind };
  if (scenario === 'calamity_play' && state === 'targets') actor.private.hand = make(['missed']);
  if (scenario === 'self_zones') actor.private.hand = make(state === 'panic_targets' ? ['panic', 'cat_balou'] : ['cat_balou', 'mustang']);
  if (scenario === 'barrel_choice') actor.private.barrelOptions = state === 'ready' ? ['barrel', 'jourdonnais'] : ['jourdonnais'];
  Object.defineProperty(actor, 'auth', { get() { assert.fail('Framing must not read authentication'); } });
  return actor;
}
const geometry = (top = 80, height = 180) => ({ bounds: { left: 10, right: 310, width: 300, top, bottom: top + height, height }, glyphs: [{ left: 20, right: 90, top: top + 10, bottom: top + 30 }] });
const recordFor = measured => ({ metrics: { frame: measured.bounds, frameVisibleBounds: { left: 0, right: 375, top: 64, bottom: 800 } } });

test('manifest partitions all eleven canonical cases into three bounded fixture-only batches', () => {
  assert.deepEqual(Object.keys(h.MANIFEST), ['lucky_check', 'sid_rescue', 'sid_two_alive', 'beer_rescue', 'discard_order', 'kit_draw', 'jesse_draw', 'pedro_draw', 'calamity_play', 'self_zones', 'barrel_choice']);
  const members = Object.values(h.BATCHES).flatMap(batch => batch.scenarios);
  assert.equal(new Set(members).size, 11); assert.equal(members.length, 11);
  assert.deepEqual(Object.values(h.BATCHES).map(batch => batch.conservativeCeiling), [169, 133, 115]);
  assert.deepEqual(Object.values(h.BATCHES).map(batch => batch.frames), [18, 12, 9]);
  assert.deepEqual(h.PROFILES, [{ width: 375, scale: 100 }, { width: 375, scale: 200 }, { width: 1280, scale: 200 }]);
  for (const [name, batch] of Object.entries(h.BATCHES)) {
    assert.equal(batch.maxCaptures, batch.profiles * 2); assert.equal(batch.profiles, batch.frames * 3);
    h.assertCapacity(name, 58, 3);
    assert.throws(() => h.assertCapacity(name, 181 - batch.maxCaptures, 0));
  }
  assert.throws(() => h.assertCapacity('all', 0)); assert.throws(() => h.assertCapacity('check-rescue', 0, 0, 181));
  assert(Object.isFrozen(h.MANIFEST.self_zones.panic_targets.frames));
});

test('framing consumes the shared BANG-local mounted-text convergence API without importing the main driver', () => {
  const evidence = require('./bang-ui-evidence.cjs');
  for (const name of ['enlargeBangText', 'restoreBangText', 'readBangFontState', 'validateBangFontState']) assert.equal(typeof evidence[name], 'function', name);
  assert.equal(h.SHARED_CAPTURE_LIMIT, evidence.CAPTURE_LIMIT);
  assert.doesNotMatch(source, /require\(['"].*bang-ui-smoke|require\(['"].*skull-ui-evidence/);
});

test('frame expansion uses only owned/private or projected/public card IDs with exact counts and selection', () => {
  for (const [scenario, states] of Object.entries(h.MANIFEST)) for (const [state, spec] of Object.entries(states)) {
    const actor = actorFor(scenario, state), frames = h.expandFrames(actor, scenario, state);
    assert.equal(frames.length, spec.frames.reduce((n, item) => n + (item.count ?? 1), 0));
    assert.equal(h.expectedSelection(actor, spec).length, spec.selected?.[1] ?? 0);
    assert(frames.every(frame => frame.kind !== 'cards'));
    for (const frame of frames.filter(frame => frame.kind === 'card')) assert.match(frame.selector, /^\[id="bang-card-(hand|check|order|draw)-[\w-]+"\]$/);
  }
  const actor = actorFor('lucky_check', 'ready'); actor.public.drawCheck.cards.pop();
  assert.throws(() => h.expandFrames(actor, 'lucky_check', 'ready'));
  const unsafe = actorFor('calamity_play', 'targets'); unsafe.private.hand[0].id = '"] body';
  assert.throws(() => h.expandFrames(unsafe, 'calamity_play', 'targets'));
  assert.throws(() => h.expandFrames(actorFor('kit_draw', 'selected'), 'unknown', 'ready'));
});

test('owner checks reject another seat, unpaired state and wrong rescue, living or defence stages', () => {
  for (const mutate of [actor => { actor.name = 'Lyra'; }, actor => { actor.private.playerId = 'other'; }, actor => { actor.private.revision++; }, actor => { actor.public.status = 'game_over'; }, actor => { actor.private.canRescue = false; }, actor => { actor.public.rescue.livesNeeded = 1; }]) {
    const actor = actorFor('beer_rescue', 'ready'); mutate(actor); assert.throws(() => h.assertOwner(actor, h.MANIFEST.beer_rescue.ready));
  }
  const sid = actorFor('sid_two_alive', 'selected'); sid.public.players[3].alive = true;
  assert.throws(() => h.assertOwner(sid, h.MANIFEST.sid_two_alive.selected));
  const barrel = actorFor('barrel_choice', 'remaining'); barrel.private.barrelOptions.push('barrel');
  assert.throws(() => h.assertOwner(barrel, h.MANIFEST.barrel_choice.remaining));
  const jesse = actorFor('jesse_draw', 'ready'); jesse.private.drawChoice.kind = 'pedro_ramirez';
  assert.throws(() => h.assertOwner(jesse, h.MANIFEST.jesse_draw.ready));
});

test('whole-frame and contiguous endpoint proof reject header/footer occlusion, missing glyphs and gaps', () => {
  const clear = geometry(), single = h.measuredFrame(recordFor(clear), clear);
  assert(h.wholeFrameVisible(single)); h.assertFrameCoverage([single]);
  const hidden = geometry(0, 500), hiddenProof = h.measuredFrame(recordFor(hidden), hidden);
  assert.equal(h.wholeFrameVisible(hiddenProof), false); assert.throws(() => h.assertFrameCoverage([hiddenProof]));
  const footer = geometry(600, 300); assert.equal(h.wholeFrameVisible(h.measuredFrame(recordFor(footer), footer)), false);
  const frames = [geometry(64, 1000), geometry(-200, 1000)].map(g => h.measuredFrame(recordFor(g), g));
  h.assertFrameCoverage(frames);
  const gap = [geometry(64, 1600), geometry(-800, 1600)].map(g => h.measuredFrame(recordFor(g), g));
  assert.throws(() => h.assertFrameCoverage(gap));
  assert.throws(() => h.measuredFrame(recordFor(clear), { ...clear, glyphs: [] }));
  assert.throws(() => h.measuredFrame(recordFor(clear), { ...clear, glyphs: [{ left: 0, right: 90, top: 90, bottom: 110 }] }));
  assert.throws(() => h.measuredFrame({ metrics: { frame: clear.bounds } }, clear));
  assert.throws(() => h.measuredFrame(recordFor(clear), geometry(84)));
});

function markContext(matches) {
  const node = (content = 'Instruction') => ({ textContent: content, attrs: {}, getBoundingClientRect: () => ({ width: 300, height: 100 }), closest: () => null,
    matches: () => false, querySelector: () => null, querySelectorAll: () => [], contains: () => false,
    getAttribute(name) { return this.attrs[name] ?? null; }, hasAttribute(name) { return Object.hasOwn(this.attrs, name); }, setAttribute(name, value) { this.attrs[name] = value; } });
  const first = node();
  const document = { querySelectorAll: selector => selector === '[data-bang-qa-fixture]' ? [] : matches === undefined ? [first] : matches };
  return { node, first, document, getComputedStyle: () => ({ visibility: 'visible' }) };
}
function mark(context, descriptor = { kind: 'panel', selector: '#bang-current-choice' }) {
  return vm.runInNewContext(`(${h.markFrame.toString()})({descriptor,marker:'owned-frame'})`, { ...context, descriptor });
}
test('DOM markers reject missing/ambiguous matches, card-containing parent frames and wrong local-choice stages', () => {
  assert.throws(() => mark(markContext([])), /missing or ambiguous/);
  const context = markContext(); assert.equal(mark(context), '[data-bang-qa-fixture="owned-frame"]');
  assert.equal(context.first.attrs['data-bang-qa-fixture'], 'owned-frame');
  assert.throws(() => mark(markContext([context.first, context.first])), /missing or ambiguous/);
  context.first.querySelector = () => context.node(); assert.throws(() => mark(context), /must not contain full cards/);
  context.first.querySelector = () => null;
  assert.throws(() => mark(context, { kind: 'panel', selector: '#bang-play-options', required: ['Target: Echo (you)'] }), /local-choice stage/);
  context.first.attrs['data-bang-qa-fixture'] = 'other'; assert.throws(() => mark(context), /already owned/);
});

function runtime(batch, { touch = false, failure, mutate, enlargeFailure = false } = {}) {
  const events = [], mod = { exports: {} };
  vm.runInNewContext(source, { module: mod, require: name => name === './bang-ui-evidence.cjs' ? {
    enlargeBangText: async () => { events.push('enlarge'); if (enlargeFailure) throw Error('synthetic partial enlargement'); return { samples: [{ before: 14 }] }; },
    restoreBangText: async () => { events.push('restore'); },
    readBangFontState: function readBangFontState() {}, validateBangFontState: state => { assert(state.valid); events.push('fonts'); },
  } : require(name) });
  const qa = { evidence: { service: 'bang-local-ui-fixtures', mode: 'canonical-fixtures-only', attempts: Array.from({ length: 58 }, (_, index) => ({ file: `prior-${index}` })) }, persist() {}, ready: async () => {} };
  let current, selected, order;
  const page = { viewport: () => ({ ...current }), setViewport: async next => { current = next; events.push(['viewport', next.width]); },
    evaluate: async (fn, input) => {
      if (fn.name === 'selectionSnapshot') return selected;
      if (fn.name === 'orderSnapshot') return order;
      if (fn.name === 'markFrame') return `[data-bang-qa-fixture="${input.marker}"]`;
      if (fn.name === 'frameGeometry') return geometry();
      if (fn.name === 'readBangFontState') return { valid: true };
      if (fn.name === 'clearMarkers') { events.push('clear'); return; }
      assert.fail(`Unexpected browser function ${fn.name}`);
    } };
  qa.capture = async (_page, file, options) => {
    await options.prepare();
    const record = { file, viewport: page.viewport(), metrics: { ...recordFor(geometry()).metrics, fonts: { valid: true }, coarse: touch, touchPoints: touch ? 1 : 0 } };
    qa.evidence.attempts.push({ file });
    if (failure === true || failure === qa.evidence.attempts.length - 58) throw Error('synthetic capture failure');
    if (mutate) mutate();
    return record;
  };
  const framing = mod.exports.createFixtureFraming(qa, { batch });
  return { framing, qa, events, async capture(scenario, state) {
    const actor = actorFor(scenario, state);
    current = { width: touch ? 360 : 1280, height: 844, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 };
    actor.page = page; selected = mod.exports.expectedSelection(actor, h.MANIFEST[scenario][state]);
    order = mod.exports.expectedOrder(actor, scenario);
    this.actor = actor;
    return framing.captureState(actor, scenario, state);
  }, page, changeSelection() { selected = ['unexpected-selection']; } };
}

test('runtime captures every declared state/profile, records true input ownership and restores scale and viewport', async () => {
  for (const [batch, plan] of Object.entries(h.BATCHES)) for (const touch of [false, true]) {
    const run = runtime(batch, { touch });
    for (const scenario of plan.scenarios) for (const state of Object.keys(h.MANIFEST[scenario])) await run.capture(scenario, state);
    const complete = run.framing.assertComplete();
    assert.equal(complete.profiles, plan.profiles); assert.equal(complete.captures, plan.profiles);
    assert.equal(run.events.filter(e => e === 'enlarge').length, run.events.filter(e => e === 'restore').length);
    assert.equal(run.page.viewport().width, touch ? 360 : 1280);
    for (const proof of run.qa.evidence.fixtureFraming.proofs) {
      assert.equal(proof.input.viewportOnly, true); assert.equal(proof.input.hasTouch, touch); assert.equal(proof.input.coarse, touch);
      assert.equal(proof.input.touchPoints, touch ? 1 : 0); assert.equal(proof.ownerId.startsWith('p'), true);
      assert.equal(proof.revision, 10); assert.equal(proof.complete, true);
      assert.equal(proof.files.length, 1);
    }
    assert.doesNotMatch(JSON.stringify(run.qa.evidence.fixtureFraming), /token|roomCode|auth/);
  }
});

test('runtime rejects wrong batch, duplicates, missing states, changed commands/revision/selection and restores after failure', async () => {
  const run = runtime('draw-order');
  await assert.rejects(run.capture('lucky_check', 'ready'), /outside this fixture batch/);
  await run.capture('jesse_draw', 'ready');
  await assert.rejects(run.capture('jesse_draw', 'ready'), /already captured/);
  assert.throws(() => run.framing.assertComplete(), /missing declared states/);
  for (const kind of ['revision', 'command', 'selection']) {
    let broken;
    broken = runtime('draw-order', { mutate: () => {
      if (kind === 'revision') { broken.actor.public.revision++; broken.actor.private.revision++; }
      if (kind === 'command') broken.actor.sent.push('forbidden');
      if (kind === 'selection') broken.changeSelection();
    } });
    await assert.rejects(broken.capture('jesse_draw', 'ready'));
    assert.equal(broken.page.viewport().width, 1280); assert(broken.events.includes('clear'));
  }
  const failed = runtime('draw-order', { failure: 2 });
  await assert.rejects(failed.capture('jesse_draw', 'ready'), /synthetic capture failure/);
  assert.equal(failed.page.viewport().width, 1280); assert(failed.events.includes('clear'));
  assert.equal(failed.events.filter(e => e === 'enlarge').length, 1); assert.equal(failed.events.filter(e => e === 'restore').length, 1);
  assert.equal(failed.qa.evidence.attempts.at(-1).scale, 200);
  const partial = runtime('draw-order', { enlargeFailure: true });
  await assert.rejects(partial.capture('jesse_draw', 'ready'), /partial enlargement/);
  assert.equal(partial.events.filter(e => e === 'restore').length, 1); assert.equal(partial.page.viewport().width, 1280);
});

test('fixture framing is not usable on an ordinary API run or with insufficient real remaining budget', () => {
  for (const patch of [{ service: 'zuychin-arcade-server' }, { mode: 'ordinary-api-natural-game' }, { attempts: Array(100) }]) {
    const qa = { evidence: { service: 'bang-local-ui-fixtures', mode: 'canonical-fixtures-only', attempts: [], ...patch }, persist() {} };
    assert.throws(() => h.createFixtureFraming(qa, { batch: 'check-rescue' }));
  }
});
