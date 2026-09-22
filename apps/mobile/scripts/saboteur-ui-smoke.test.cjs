const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { handSizingTarget, assertHandFaces, measureHandFaces, persistHandSample, assertHandSampleStable, handSizingCommand, handSizingCleanupPassed, handSizingSources, HAND_SIZING_PLAN } = require('./saboteur-ui-smoke.cjs');

const valid = { SABOTEUR_UI_TARGET: 'hand-sizing', SABOTEUR_UI_FIXTURES: 'true', SABOTEUR_UI_EXCLUSIVE_WINDOW: 'granted', SABOTEUR_EVIDENCE_DIR: 'fresh', SABOTEUR_EXPECTED_SHA256: 'a'.repeat(64) };
const cards = [{ id: 'path', type: 'path' }, { id: 'map-1', type: 'action', subtype: 'map' }, { id: 'map-2', type: 'action', subtype: 'map' }];
function boxes() {
  return cards.map((card, index) => ({ id: 'saboteur-hand-' + card.id, label: card.type, selected: false, left: index * 164, right: index * 164 + 152, top: 40, bottom: 268, width: 152, height: 228, layoutWidth: 152, layoutHeight: 228,
    scrollWidth: 152, clientWidth: 152, svg: card.type === 'path', texts: card.type === 'path' ? [] : ['INTEL', 'Map Goal'].map(text => ({ text, splitWords: [], proof: { glyphs: [] } })) }));
}

test('target is explicit and incompatible selectors fail before the default runner has side effects', () => {
  assert.equal(handSizingTarget({}), false);
  assert.equal(handSizingTarget({ SABOTEUR_UI_FIXTURES: 'true', SABOTEUR_MAP_BEFORE_ONLY: 'true' }), false);
  assert.equal(handSizingTarget(valid), true);
  for (const target of ['', 'stone', 'HAND-SIZING', 'all']) assert.throws(() => handSizingTarget({ ...valid, SABOTEUR_UI_TARGET: target }), /Unknown/);
  for (const key of ['SABOTEUR_UI_FIXTURES', 'SABOTEUR_UI_EXCLUSIVE_WINDOW', 'SABOTEUR_EVIDENCE_DIR', 'SABOTEUR_EXPECTED_SHA256']) {
    const env = { ...valid }; delete env[key]; assert.throws(() => handSizingTarget(env));
  }
  for (const key of ['SABOTEUR_MAP_BEFORE_ONLY', 'SABOTEUR_RETAINED_TURN_ONLY']) assert.throws(() => handSizingTarget({ ...valid, [key]: 'true' }), /conflicts/);
  const source = fs.readFileSync(__dirname + '/saboteur-ui-smoke.cjs', 'utf8');
  const body = source.slice(source.indexOf('async function main()'));
  assert(body.indexOf('handSizingTarget(process.env)') < body.indexOf('fs.mkdirSync'));
});

test('finite plan reserves both frame edges within forty app images and discloses seeded coverage', () => {
  assert.equal(HAND_SIZING_PLAN.logicalFrames, (2 * 2 * 2 * 2) + (2 * 2));
  assert.equal(HAND_SIZING_PLAN.logicalFrames * 2, HAND_SIZING_PLAN.appCaptureCap);
  assert.equal(HAND_SIZING_PLAN.calibrationCaptures, 2);
  assert.equal(HAND_SIZING_PLAN.deadlineMs, 8 * 60 * 1000);
  assert.equal(HAND_SIZING_PLAN.natural, false);
  assert.equal(HAND_SIZING_PLAN.scenario, 'stone');
  assert.deepEqual(HAND_SIZING_PLAN.profiles.map(p => [p.width, p.touch]), [[375, true], [1280, false], [320, true]]);
  assert.match(HAND_SIZING_PLAN.coverage, /Repeated Map face is DOM-checked/);
});

test('painted face constraints reject unequal width/height, clipping, split words, missing copy and identity', () => {
  assert.doesNotThrow(() => assertHandFaces(boxes(), cards));
  for (const dimension of ['width', 'height', 'layoutWidth', 'layoutHeight']) {
    const changed = boxes(); changed[1][dimension] += 10;
    assert.throws(() => assertHandFaces(changed, cards), /differs/);
  }
  let changed = boxes(); changed[0].svg = false; assert.throws(() => assertHandFaces(changed, cards), /path geometry/);
  changed = boxes(); changed[2].texts.pop(); assert.throws(() => assertHandFaces(changed, cards), /printed copy/);
  changed = boxes(); changed[2].texts[0].splitWords.push('INTEL'); assert.throws(() => assertHandFaces(changed, cards), /splits/);
  changed = boxes(); changed[2].texts[0].proof.glyphs.push({ character: 'L' }); assert.throws(() => assertHandFaces(changed, cards), /clipped/);
  changed = boxes(); changed[2].scrollWidth += 10; assert.throws(() => assertHandFaces(changed, cards), /horizontally/);
  changed = boxes(); changed[2].id = changed[1].id; assert.throws(() => assertHandFaces(changed, cards), /Duplicate/);
  assert.throws(() => assertHandFaces(boxes().slice(0, 2), cards), /three-card/);
});

test('actual DOM probe measures the inner painted face rather than equal outside wrappers', () => {
  const node = (id, height) => {
    const rect = h => ({ left: 10, right: 162, top: 30, bottom: 30 + h, width: 152, height: h });
    const face = { getBoundingClientRect: () => rect(height), offsetWidth: 152, offsetHeight: height, scrollWidth: 152, clientWidth: 152,
      style: { overflow: 'hidden' }, querySelectorAll: () => [], querySelector: () => true };
    const surface = { children: [{ style: { position: 'absolute' } }, face] };
    return { id, querySelectorAll: () => [surface], getBoundingClientRect: () => rect(500), getAttribute: () => 'Path' };
  };
  const measured = vm.runInNewContext(`(${measureHandFaces})(nodes)`, { nodes: [node('one', 228), node('two', 250)], getComputedStyle: node => node.style });
  assert.equal(measured[0].wrapper.height, measured[1].wrapper.height);
  assert.notEqual(measured[0].height, measured[1].height);
  assert.equal(measured[0].layoutHeight, 228);
  assert.throws(() => vm.runInNewContext(`(${measureHandFaces})(nodes)`, { nodes: [{ querySelectorAll: () => [] }] }), /canonical painted/);
});

test('every failing raw painted-face sample is persisted before validation throws', async () => {
  for (const field of ['boxes', 'handFaces', 'postHandFaces']) {
    const record = {}, snapshots = [];
    const raw = boxes(); raw[1].height = 245;
    let reads = 0;
    await assert.rejects(persistHandSample(async () => { reads++; return raw; }, cards, record, field, () => snapshots.push(structuredClone(record))), /height differs/);
    assert.equal(reads, 1);
    assert.equal(snapshots.length, 1);
    assert.deepEqual(snapshots[0][field], raw);
    assert.equal(snapshots[0][field].length, 3);
    assert.equal(snapshots[0][field][1].height, 245);
  }
});

test('unchanged sizes cannot conceal a shifted painted face across the screenshot', async () => {
  const record = {}, snapshots = [];
  const before = boxes(), after = boxes();
  after[2].left += 12; after[2].right += 12;
  const persist = () => snapshots.push(structuredClone(record));
  await persistHandSample(async () => before, cards, record, 'handFaces', persist);
  await persistHandSample(async () => after, cards, record, 'postHandFaces', persist);
  assert.equal(after[2].width, before[2].width);
  assert.equal(after[2].height, before[2].height);
  assert.throws(() => assertHandSampleStable(record.handFaces, record.postHandFaces), /left changed/);
  assert.deepEqual(snapshots.at(-1), { handFaces: before, postHandFaces: after });
});

test('capture stability checks all six painted axes, full identity and selected state', () => {
  const before = boxes();
  assert.doesNotThrow(() => assertHandSampleStable(before, structuredClone(before)));
  for (const axis of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
    const after = boxes(); after[1][axis] += 3;
    assert.throws(() => assertHandSampleStable(before, after), new RegExp(axis + ' changed'));
    after[1][axis] = NaN; assert.throws(() => assertHandSampleStable(before, after), new RegExp(axis + ' changed'));
  }
  for (const patch of [{ id: 'replacement' }, { label: 'wrong face' }, { selected: true }]) {
    const after = boxes(); Object.assign(after[1], patch);
    assert.throws(() => assertHandSampleStable(before, after), /identity or selection/);
  }
  assert.throws(() => assertHandSampleStable(before, before.slice(1)), /identity count/);
});

function seat(id = 'host') {
  const frame = { gameId: 'saboteur', roomCode: 'ROOM', revision: 7 };
  return { auth: { roomCode: 'ROOM', playerId: id }, public: { ...frame }, private: { ...frame, playerId: id }, accepted: [], sent: [], rejected: [] };
}
const expectedMap = { cardId: 'map-2', targetPosition: { row: 8, col: 4 } };
function sendMap(owner) { owner.sent.push(['play_action', { ...expectedMap, expectedRevision: 7 }]); owner.accepted.push({ action: 'play_action', revision: 8 }); }

test('ack-before-state waits for every fresh owner pair and issues only one Map input', async () => {
  const owner = seat(), other = seat('other'), record = { expectedMap }; let inputs = 0;
  const verify = await handSizingCommand(owner, [owner, other], async () => { inputs++; sendMap(owner); }, record, async check => {
    assert.equal(check(), false);
    owner.public.revision = owner.private.revision = 8; assert.equal(check(), false);
    other.public.revision = 8; assert.equal(check(), false);
    other.private.revision = 8; assert.equal(check(), true);
  });
  assert.equal(inputs, 1); assert.equal(record.command.rawAcknowledgements.length, 1); verify();
  owner.accepted.push({ action: 'play_action', revision: 8 }); assert.throws(verify, /exactly one/);
  assert.equal(record.command.rawAcknowledgements.length, 2);
});

test('raw duplicate, wrong action, wrong revision, wrong payload and extra commands fail without deduplication', async () => {
  for (const mutate of [
    owner => owner.accepted.push({ action: 'play_action', revision: 8 }),
    owner => { owner.accepted[0].action = 'pass_turn'; },
    owner => { owner.accepted[0].revision = 9; },
    owner => { owner.sent[0][1].cardId = 'map-1'; },
    owner => owner.sent.push(['play_action', {}]),
    owner => owner.rejected.push({ message: 'rejected' }),
  ]) {
    const owner = seat(), record = { expectedMap }; let inputs = 0;
    await assert.rejects(handSizingCommand(owner, [owner], async () => { inputs++; sendMap(owner); mutate(owner); }, record, async check => check()));
    assert.equal(inputs, 1);
    assert.deepEqual(record.command.rawAcknowledgements, owner.accepted);
    assert.deepEqual(record.command.rawCommands, owner.sent);
  }
});

test('cleanup cannot pass REST fallback, missing owners, duplicated receipts, stale auth or open contexts', () => {
  const names = ['host', 'second', 'third'];
  const rows = names.map(name => ({ name, normalUI: true, status: 200, authCleared: true }));
  assert(handSizingCleanupPassed(rows, names, true));
  assert(!handSizingCleanupPassed(rows, names, false));
  assert(!handSizingCleanupPassed(rows.slice(0, 2), names, true));
  assert(!handSizingCleanupPassed([...rows, rows[0]], names, true));
  for (const patch of [{ fallback: true }, { status: 204 }, { normalUI: false }, { authCleared: false }]) assert(!handSizingCleanupPassed([{ ...rows[0], ...patch }, ...rows.slice(1)], names, true));
});

test('source fence includes new sizing, shared scale/framing dependencies and canonical constructor', () => {
  const source = handSizingSources();
  for (const file of ['apps/mobile/app/saboteur/game.tsx', 'apps/mobile/components/saboteur/cards/ActionCardView.tsx', 'apps/mobile/components/saboteur/cards/PathCardView.tsx', 'apps/mobile/components/saboteur/cards/HandCard.tsx', 'apps/mobile/hooks/useMeasuredTextScale.ts', 'apps/mobile/scripts/saboteur-ui-smoke.cjs', 'apps/mobile/scripts/saboteur-ui-smoke.test.cjs', 'apps/mobile/scripts/libertalia-ui-primitives.cjs', 'apps/mobile/scripts/skull-ui-evidence.cjs', 'apps/mobile/scripts/tokyo-ui-evidence.cjs', 'apps/server/scripts/saboteur/ui-fixture-server.ts']) assert.match(source[file], /^[a-f0-9]{64}$/);
});
