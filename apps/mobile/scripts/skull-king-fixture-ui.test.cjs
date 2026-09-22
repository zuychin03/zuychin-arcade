const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { targetMode, scenarios, paired, assertComparable, measurePaintedFaces, ownedCommand, finishCommandJournal, createSupplement, supplementSources } = require('./skull-king-fixture-ui.cjs');
const { assertFrameCoverage } = require('./libertalia-ui-primitives.cjs');

function probe(options = {}) {
  let revision = 7, restores = 0, screenshots = 0, position = 'start';
  const dependencies = {
    async enlargeLibertaliaText() { if (options.enlargeFailure) throw Error('convergence'); },
    async restoreLibertaliaText() { restores++; },
    readLibertaliaFontState() {},
    validateLibertaliaFontState(value) { assert.equal(value.valid, true); },
    frameVisibility() {}, assertFrameCoverage,
  };
  const originalScreenshot = async () => { screenshots++; if (options.stateChange) revision++; return 'png'; };
  const page = {
    screenshot: originalScreenshot,
    async $$eval() { return options.ambiguous ? 2 : 1; },
    async evaluate() { return { valid: !options.fontFailure }; },
    async $eval(selector, fn, argument) {
      if (typeof argument === 'string') position = argument;
      if (fn === dependencies.frameVisibility) return { left: 0, right: 375, top: 64, bottom: 800 };
      if (fn.toString().includes('return { left:')) {
        const height = options.tall ? 1000 : 250, top = position === 'start' ? 64 : 800 - height;
        return { left: 20, right: 300, width: 280, height, top, bottom: top + height };
      }
      return null;
    },
  };
  const recorder = {
    evidence: { captures: [], attempts: [] }, persist() {},
    async capture(target, file, captureOptions) {
      await target.screenshot();
      const record = { file, captureOptions, metrics: options.privacy ? { privacyGaps: ['hidden'] } : {} };
      this.evidence.captures.push(record); this.evidence.attempts.push({ file }); return record;
    },
  };
  const supplement = createSupplement(recorder, options.cap ?? 8, dependencies);
  return { ...supplement, page, recorder, originalScreenshot, counts: () => ({ restores, screenshots }), revision: () => revision };
}

test('opt-in is exact and leaves all five legacy scenarios intact', () => {
  assert.equal(targetMode(undefined), false); assert.equal(targetMode('card-sizing'), true);
  for (const value of ['', 'royal_bonus', 'all', 'CARD-SIZING']) assert.throws(() => targetMode(value));
  assert.deepEqual(scenarios, ['tigress_follow', 'character_lead', 'royal_bonus', 'royal_terminal', 'eight_final_tie']);
});

test('pair ownership requires both fresh projections and exact owner', () => {
  const seat = { auth: { roomCode: 'ROOM', playerId: 'one' }, public: { revision: 7, roomCode: 'ROOM' }, private: { revision: 7, roomCode: 'ROOM', playerId: 'one' } };
  assert(paired(seat, 7)); seat.private.playerId = 'two'; assert(!paired(seat, 7));
});

test('row geometry rejects trailing banners, unequal heights and overflow', () => {
  const box = { top: 0, bottom: 300, height: 300, width: 250, scrollWidth: 250, clientWidth: 250 };
  assert.doesNotThrow(() => assertComparable([box, { ...box }], true));
  assert.throws(() => assertComparable([box, { ...box, width: 510, top: 350, bottom: 650 }], true), /Trailing/);
  assert.throws(() => assertComparable([box, { ...box, bottom: 310 }]), /unequal/);
  assert.throws(() => assertComparable([box, { ...box, scrollWidth: 270 }]), /horizontally/);
});

test('equal outer wrappers cannot hide unequal painted CardSurface faces', () => {
  const node = height => {
    const box = value => ({ top: 20, bottom: 20 + value, height: value, width: 240 });
    const edge = { style: { position: 'absolute' } };
    const face = { style: { overflow: 'hidden' }, getBoundingClientRect: () => box(height), scrollWidth: 240, clientWidth: 240 };
    return { firstElementChild: { children: [edge, face] }, getBoundingClientRect: () => box(500), scrollWidth: 240, clientWidth: 240, getAttribute: () => 'face', textContent: 'Complete rules' };
  };
  const boxes = vm.runInNewContext(`(${measurePaintedFaces})(nodes)`, { nodes: [node(400), node(430)], getComputedStyle: item => item.style });
  assert.equal(boxes[0].wrapper.height, boxes[1].wrapper.height);
  assert.throws(() => assertComparable(boxes, true), /unequal/);
  assert.throws(() => vm.runInNewContext(`(${measurePaintedFaces})(nodes)`, { nodes: [{}], getComputedStyle: item => item.style }), /canonical CardSurface/);
});

test('public-table readiness reaches the actual recorder for both normal and CSS200 shots', async () => {
  const p = probe(); await p.frame({ page: p.page }, 'observer', '#tray', p.revision, null, { publicTable: true });
  assert.equal(p.recorder.evidence.captures.length, 2);
  assert(p.recorder.evidence.captures.every(record => record.captureOptions.publicTable === true));
});

test('owned command waits for the accepted revision pair and dispatches only once', async () => {
  const seat = { page: {}, acks: [] }, record = { commands: [], ackStart: 0 };
  let revision = 7, clicks = 0;
  await ownedCommand({ seat, pattern: /^ROLL DICE$/, actions: ['roll'], revision: () => revision, paired: value => value === revision,
    click: async () => { clicks++; seat.acks.push({ action: 'roll', revision: 8 }); },
    wait: async predicate => { assert.equal(predicate(), false); revision = 8; assert.equal(predicate(), true); }, record, persist() {} });
  assert.equal(clicks, 1); assert.deepEqual(record.commandAttempts[0].rawDelta, [{ action: 'roll', revision: 8 }]);
  finishCommandJournal(seat, record);
  seat.acks.push({ action: 'roll', revision: 8 });
  assert.throws(() => finishCommandJournal(seat, record), /duplicate/);
  assert.equal(record.rawAcknowledgements.length, 2);
});

test('duplicate, unexpected and reordered acknowledgement deltas fail without deduplication', async () => {
  for (const [actions, raw] of [
    [['roll'], [{ action: 'roll', revision: 8 }, { action: 'roll', revision: 8 }]],
    [['play'], [{ action: 'roll', revision: 8 }]],
    [['set_kept', 'roll'], [{ action: 'roll', revision: 8 }, { action: 'set_kept', revision: 9 }]],
  ]) {
    const seat = { page: {}, acks: [] }, record = { commands: [] }; let clicks = 0;
    await assert.rejects(ownedCommand({ seat, pattern: /^ACTION$/, actions, revision: () => 7, paired: () => true,
      click: async () => { clicks++; seat.acks.push(...raw); }, wait: async predicate => predicate(), record, persist() {} }), /acknowledgement/);
    assert.equal(clicks, 1); assert.deepEqual(record.commandAttempts[0].rawDelta, raw); assert.equal(record.commands.length, 0);
  }
});

test('full short frames deduplicate edges and preserve strict scale receipt', async () => {
  const p = probe(); await p.frame({ page: p.page }, 'face', '#face', p.revision); p.finish(2);
  assert.deepEqual(p.counts(), { restores: 1, screenshots: 2 });
  assert.deepEqual(p.proof.frames.map(frame => frame.scale), [100, 200]);
  assert.equal(p.recorder.evidence.captures[1].metrics.textScaleState.valid, true);
  assert.equal(p.recorder.evidence.attempts[1].scale, 200);
  assert.equal(p.page.screenshot, p.originalScreenshot);
});

test('two edges use sticky header/footer visibility to prove contiguous tall face coverage', async () => {
  const p = probe({ tall: true }); await p.frame({ page: p.page }, 'face', '#face', p.revision); p.finish(2);
  assert.equal(p.counts().screenshots, 4); assert(p.proof.frames.every(frame => frame.covered === 1000));
});

test('font convergence failure restores scaling; malformed fonts and changed state fail', async () => {
  for (const options of [{ enlargeFailure: true }, { fontFailure: true }, { stateChange: true }]) {
    const p = probe(options); await assert.rejects(p.frame({ page: p.page }, 'face', '#face', p.revision));
    assert.equal(p.page.screenshot, p.originalScreenshot);
    if (!options.stateChange) assert.equal(p.counts().restores, 1);
  }
});

test('ambiguous frames, budget exhaustion, missing inventory and privacy gaps cannot pass', async () => {
  for (const options of [{ ambiguous: true }, { cap: 1 }]) {
    const p = probe(options); await assert.rejects(p.frame({ page: p.page }, 'face', '#face', p.revision));
  }
  const p = probe({ privacy: true }); await p.frame({ page: p.page }, 'face', '#face', p.revision);
  assert.throws(() => p.finish(4), /inventory/); assert.throws(() => p.finish(2), /privacy/);
});

test('supplement fence includes route parents, components, canonical constructors and both drivers/tests', () => {
  const hashes = supplementSources();
  for (const file of ['apps/mobile/app/skull-king/game.tsx', 'apps/mobile/hooks/useIntrinsicCardHeight.ts', 'apps/mobile/components/king-of-tokyo/PowerCardCollection.tsx', 'apps/server/scripts/skull-king/ui-fixtures.ts', 'apps/server/scripts/king-of-tokyo/ui-fixtures.ts', 'apps/mobile/scripts/skull-king-fixture-ui.test.cjs', 'apps/mobile/scripts/king-of-tokyo-fixture-ui.test.cjs']) assert.match(hashes[file], /^[a-f0-9]{64}$/);
  const source = fs.readFileSync(require.resolve('./skull-king-fixture-ui.cjs'), 'utf8');
  assert.match(source, /supplement \? \['royal_bonus'\]/);
  assert.match(source, /supplement\.finish\(12\)/);
  assert.match(source, /targeted \? 4 : 12/);
  assert.match(source, /await command\(\/\^Play Mermaid\$\//);
});

module.exports = { probe };
