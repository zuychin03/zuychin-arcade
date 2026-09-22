const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, RAIL, SUMMARY, actionSnapshot, assertNoSubmission, selectedIds, assertWholeCard, assertFocusedPlaceVisible, stampExternalScale, confirmChoiceEvidence, restingTransform, waitForBrowseRest } = require('./not-alone-choice-evidence.cjs');
const helper = fs.readFileSync(path.join(__dirname, 'not-alone-choice-evidence.cjs'), 'utf8');
const driver = fs.readFileSync(path.join(__dirname, 'not-alone-ui-smoke.cjs'), 'utf8');

function actor() {
  return { sentActions: [], acceptedActions: [], rejections: [], latestPublic: { revision: 10 }, latestPrivate: { revision: 10, selectedPlaces: [] } };
}

test('browse proof rejects commands, acknowledgements, rejection, revisions and submitted choices', () => {
  const before = actionSnapshot(actor());
  assertNoSubmission(before, actionSnapshot(actor()));
  for (const change of [
    p => p.sentActions.push('notalone:select'), p => p.acceptedActions.push({ action: 'select' }),
    p => p.rejections.push({}), p => p.latestPublic.revision++, p => p.latestPrivate.revision++,
    p => p.latestPrivate.selectedPlaces.push(1),
  ]) {
    const player = actor(); change(player);
    assert.throws(() => assertNoSubmission(before, actionSnapshot(player)));
  }
});

test('local selection accepts either RN pressed or selected semantics without treating disabled as selected', () => {
  assert.deepEqual(selectedIds({ cards: [{ id: 5, pressed: 'true' }, { id: 2, selected: 'true' }, { id: 1, pressed: 'false', disabled: true }] }), [2, 5]);
});

test('whole-card proof requires complete overlapping vertical slices and ancestor-horizontal containment', () => {
  const frame = (top, visible = { left: 10, right: 310, top: 0, bottom: 600 }) => ({ cards: [{ id: 1, bounds: { left: 20, right: 300, top, bottom: top + 900, height: 900 }, visible }] });
  assertWholeCard([frame(0), frame(-300)], 1);
  assert.throws(() => assertWholeCard([frame(-50), frame(-300)], 1), /vertical gap/);
  assert.throws(() => assertWholeCard([frame(0)], 1), /bottom is not captured/);
  assert.throws(() => assertWholeCard([frame(0), frame(-700)], 1), /vertical gap/);
  assert.throws(() => assertWholeCard([frame(0, { left: 50, right: 310, top: 0, bottom: 1000 })], 1), /horizontally clipped/);
  assert.throws(() => assertWholeCard([{ cards: [] }], 1), /Missing captured/);
});

test('only one acknowledged policy confirmation completes the row proof', () => {
  const player = actor(), before = actionSnapshot(player), record = { policyChoices: [3] }, qa = { persist() {} };
  const session = { player, before, record, qa };
  assert.throws(() => confirmChoiceEvidence(session));
  player.sentActions.push('notalone:select'); player.acceptedActions.push({ action: 'select', revision: 11 });
  player.latestPrivate = { revision: 11, selectedPlaces: [3] }; player.latestPublic.revision = 11;
  confirmChoiceEvidence(session); assert.equal(record.complete, true);
  player.acceptedActions[0].revision = 10; assert.throws(() => confirmChoiceEvidence(session)); player.acceptedActions[0].revision = 11;
  player.latestPublic.revision = 10; assert.throws(() => confirmChoiceEvidence(session)); player.latestPublic.revision = 11;
  player.sentActions.push('notalone:select'); assert.throws(() => confirmChoiceEvidence(session));
  player.sentActions.pop(); player.latestPrivate.selectedPlaces = [4]; assert.throws(() => confirmChoiceEvidence(session));
});

test('row queries exclude public duplicate faces and browse controls use real touch or keyboard', () => {
  for (const selector of [ROOT, RAIL, SUMMARY]) assert(selector.startsWith('#not-alone-decision-area '));
  assert.match(helper, /button\.tap\(\)/);
  assert.match(helper, /keyboard\.press\(direction === 'Next' \? 'Enter' : 'Space'\)/);
  assert.match(helper, /keyboard\.press\('Tab'\)/);
  assert.match(helper, /initial.cards.filter\(c => !c.disabled\)/);
  assert.doesNotMatch(helper, /\.emit\(|fetch\(|\.latestPrivate.*other|scrollLeft\s*=/);
});

test('CSS200 retains post-screenshot fonts and full per-card geometry before restoration', () => {
  assert(helper.indexOf('await qa.capture(player.page, name') < helper.indexOf('const row = await player.page.evaluate(measureChoices'));
  assert.match(helper, /validateFonts\(capture.metrics.fonts\)/);
  assert.match(helper, /finally \{\s+stampExternalScale\(qa.evidence, attemptIndex, scale, baseline\); qa.persist\(\);\s+if \(scale\) await restore\(player.page\)/);
  assert.match(helper, /for \(const card of initial.cards\)/);
  assert.match(helper, /assertWholeCard\(frames, card.id\)/);
  assert.match(helper, /record.frames.push/);
});

test('failed externally scaled captures retain CSS200 baseline without relabelling previous evidence', () => {
  const baseline = { samples: [{ before: 16, family: 'Outfit', text: 'Place' }] };
  const evidence = { attempts: [{ file: 'normal.png', scale: 100 }, { file: 'failed.png', scale: 100, error: 'Capture failed' }], captures: [{ file: 'normal.png', scale: 100 }] };
  stampExternalScale(evidence, 1, true, baseline);
  assert.equal(evidence.attempts[0].scale, 100);
  assert.equal(evidence.captures[0].scale, 100);
  assert.equal(evidence.attempts[1].scale, 200);
  assert.deepEqual(evidence.attempts[1].baseline, baseline);
  assert.equal(evidence.attempts[1].error, 'Capture failed');
  evidence.captures.push({ file: 'failed.png', scale: 100 });
  stampExternalScale(evidence, 1, true, baseline);
  assert.equal(evidence.captures[1].scale, 200);
});

test('two owner roles retain fixed input flags, separate confirmation and actual desktop terminal', () => {
  assert.match(helper, /\.\.\.originalViewport, width: desktop \? 1280 : 375/);
  assert.match(helper, /initial.input.fine, desktop/);
  assert.match(helper, /finally \{ await player.page.setViewport\(original\); \}/);
  assert.match(helper, /#not-alone-game-over \[aria-label="BACK TO ARCADE"\]/);
  assert.match(driver, /await desktopResultEvidence\(noor, qa\)/);
  const start = driver.indexOf("const choiceKey = 'place-row-evidence:'");
  const end = driver.indexOf('coverage.add(`selection:', start);
  const selection = driver.slice(start, end);
  assert(selection.indexOf('beginChoiceEvidence') < selection.indexOf('for (const place of choices)'));
  assert(selection.indexOf('selectionEvidence(choiceSession, choices)') < selection.indexOf('await submitAndWait'));
  assert(selection.indexOf('await submitAndWait') < selection.indexOf('confirmChoiceEvidence(choiceSession)'));
  assert.match(selection, /ownPlan && qa/);
  assert.match(selection, /\['Lyra', 'Noor'\]/);
  assert.match(selection, /mine.placeHand.length >= 3/);
});

test('freeze hash inventory covers row, physical cards, art, hooks and presentation dependencies', () => {
  for (const name of ['PlaceCard', 'PlaceArtwork', 'CardChip', 'PlaceChoiceRow', 'NotAloneArtwork', 'useNotAloneActions', 'useNotAloneDecisionAttention']) {
    assert(driver.includes(`apps/mobile/components/not-alone/${name}.${name.startsWith('use') ? 'ts' : 'tsx'}`));
  }
  for (const name of ['CardSurface', 'GameCover', 'ScalePressable']) assert(driver.includes(`apps/mobile/components/ui/${name}.tsx`));
  assert(driver.includes('apps/mobile/scripts/not-alone-choice-evidence.cjs'));
});

function browseSample(width = 48, transform = 'matrix(1, 0, 0, 1, 0, 0)') {
  return { timestamp: 0, connected: true, focus: true, rect: { left: 100, top: 50, width, height: width },
    computedWidth: '48px', computedHeight: '48px', transform, offsetWidth: 48, offsetHeight: 48, clientWidth: 46, clientHeight: 46 };
}

function browseClock() {
  let elapsed = 0;
  return { now: () => elapsed, pause: async ms => { elapsed += ms; } };
}

test('browse rest sampler preserves press-release geometry before enforcing the exact 48px floor', async () => {
  const record = { samples: [] }, clock = browseClock(), snapshots = [], actorBefore = actionSnapshot(actor());
  const input = [browseSample(45.6, 'matrix(0.95, 0, 0, 0.95, 0, 0)'), browseSample(47.999, 'matrix(0.99998, 0, 0, 0.99998, 0, 0)'), browseSample()];
  let index = 0;
  const resting = await waitForBrowseRest(async () => ({ ...input[Math.min(index++, 2)], timestamp: clock.now() }), record, () => snapshots.push(structuredClone(record)), clock);
  assert.equal(resting.rect.width, 48); assert.equal(record.resting, true); assert.equal(record.samples.length, 5);
  assert.equal(record.samples[0].rect.width, 45.6); assert.equal(record.samples[1].rect.width, 47.999);
  assert.equal(record.samples[0].computedWidth, '48px'); assert.equal(record.samples[0].clientWidth, 46);
  assert(snapshots.length >= 5); assertNoSubmission(actorBefore, actionSnapshot(actor()));
});

test('stable undersized controls fail without rounding and preserve all failing samples', async () => {
  for (const width of [44, 47.999999]) {
    const record = { samples: [] }, clock = browseClock(); let saved;
    await assert.rejects(waitForBrowseRest(async () => ({ ...browseSample(width), timestamp: clock.now() }), record,
      () => { saved = structuredClone(record); }, clock), /below 48px at rest/);
    assert.equal(saved.samples.length, 3); assert.equal(saved.samples[2].rect.width, width); assert.match(saved.error, /below 48/);
    assert.notEqual(record.resting, true);
  }
});

test('never-resting or unstable controls fail within 1500ms and preserve diagnostics', async () => {
  for (const changing of [false, true]) {
    const record = { samples: [] }, clock = browseClock(); let index = 0, saved;
    await assert.rejects(waitForBrowseRest(async () => ({ ...browseSample(changing ? 48 + (++index % 2) : 47,
      changing ? 'none' : 'matrix(0.98, 0, 0, 0.98, 0, 0)'), timestamp: clock.now() }), record,
    () => { saved = structuredClone(record); }, clock), /within 1500ms/);
    assert.equal(clock.now(), 1500); assert.equal(saved.elapsedMs, 1500); assert(saved.samples.length > 3);
    assert.match(saved.error, /did not settle/);
  }
});

test('rest identity does not accept a residual scale or translation; detached controls fail closed', async () => {
  assert(restingTransform('none')); assert(restingTransform('matrix(1, 0, 0, 1, 0, 0)'));
  assert(restingTransform('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'));
  assert(!restingTransform('matrix(0.999999, 0, 0, 0.999999, 0, 0)'));
  assert(!restingTransform('matrix(1, 0, 0, 1, 0.1, 0)'));
  const record = { samples: [] };
  await assert.rejects(waitForBrowseRest(async () => ({ ...browseSample(), connected: false }), record, () => {}, browseClock()), /detached/);
  assert.equal(record.samples.length, 1); assert.match(record.error, /detached/);
});

test('keyboard failure captures the untouched viewport and retains the original failure after visibility changes', async t => {
  const outputDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'not-alone-keyboard-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true }));
  const before = { cards: [{ id: 3, bounds: { left: 661, right: 961 }, visible: { left: 35, right: 696 } }], rail: { left: 0 } };
  const after = { cards: [{ id: 3, bounds: { left: 37, right: 337 }, visible: { left: 35, right: 696 } }], rail: { left: 624 } };
  const calls = [], png = Buffer.alloc(24); png.writeUInt32BE(1280, 16); png.writeUInt32BE(900, 20);
  const page = { viewport: () => ({ width: 1280, height: 900, hasTouch: false }),
    screenshot: async options => { calls.push('screenshot'); assert.deepEqual(options, { type: 'png', fullPage: false }); return png; },
    evaluate: async (fn, selector) => { calls.push('measure'); assert.equal(fn.name, 'measureChoices'); assert.equal(selector, ROOT); return after; } };
  const record = {}, qa = { outputDir, evidence: { attempts: [], captures: [], captureBudget: 160 }, persist: () => calls.push('persist') };
  await assert.rejects(assertFocusedPlaceVisible({ page }, qa, record, before, 3), /Focused Place remains outside/);
  assert(calls.indexOf('persist') < calls.indexOf('screenshot'));
  assert.equal(calls[calls.indexOf('screenshot') + 1], 'measure');
  const diagnostic = record.keyboardFailures[0];
  assert.deepEqual(diagnostic.before, before); assert.deepEqual(diagnostic.after, after);
  assert.deepEqual(diagnostic.png, { width: 1280, height: 900 });
  assert.equal(diagnostic.diagnosticOnly, true); assert.equal(diagnostic.visualPass, false);
  assert.equal(qa.evidence.attempts.length, 1); assert.equal(qa.evidence.captures.length, 0);
  assert(fs.existsSync(path.join(outputDir, diagnostic.file)));
  assert.equal(diagnostic.error, undefined);
});

test('keyboard diagnostics fail closed at the shared budget and retain redacted screenshot errors', async () => {
  const state = { cards: [], rail: { left: 0 } };
  for (const exhausted of [false, true]) {
    let shots = 0;
    const qa = { outputDir: path.resolve('.'), secrets: new Set(['synthetic-secret']),
      evidence: { attempts: exhausted ? Array(160).fill({}) : [], captureBudget: 160 }, persist() {} };
    const record = {}, page = { viewport: () => ({ width: 1280, height: 900 }),
      screenshot: async () => { shots++; throw Error('capture synthetic-secret'); } };
    await assert.rejects(assertFocusedPlaceVisible({ page }, qa, record, state, 3), /Focused Place remains outside/);
    assert.equal(shots, exhausted ? 0 : 1);
    assert.equal(qa.evidence.attempts.length, exhausted ? 160 : 1);
    assert.match(record.keyboardFailures[0].error, exhausted ? /budget exceeded/ : /capture \[REDACTED\]/);
  }
});

test('visible focused cards do not capture or change the no-command proof', async () => {
  const player = actor(), before = actionSnapshot(player);
  await assertFocusedPlaceVisible(player, {}, {}, { cards: [{ id: 1, bounds: { left: 37, right: 337 }, visible: { left: 35, right: 696 } }] }, 1);
  assertNoSubmission(before, actionSnapshot(player));
  const diagnosticSource = helper.slice(helper.indexOf('async function assertFocusedPlaceVisible'), helper.indexOf('function assertWholeCard'));
  assert.doesNotMatch(diagnosticSource, /qa\.capture|ready\(|settle\(|scrollIntoView|setViewport|\.focus\(/);
});
