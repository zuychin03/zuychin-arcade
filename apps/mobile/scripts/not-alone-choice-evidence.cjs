const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const { enlarge, restore, settle, validateFonts } = require('./skull-ui-evidence.cjs');

const ROOT = '#not-alone-decision-area [data-testid="not-alone-place-choices"]';
const RAIL = ROOT + ' [data-testid="not-alone-choice-rail"]';
const SUMMARY = ROOT + ' [data-testid="not-alone-choice-summary"]';
const cardSelector = id => ROOT + ` [data-testid="not-alone-place-card-${id}"]`;
const controlSelector = direction => ROOT + ` [aria-label="${direction} Place cards"]`;

function actionSnapshot(player) {
  return { sent: player.sentActions.length, accepted: player.acceptedActions.length, rejected: player.rejections.length,
    publicRevision: player.latestPublic.revision, privateRevision: player.latestPrivate.revision,
    submitted: [...player.latestPrivate.selectedPlaces] };
}

function assertNoSubmission(before, after) {
  assert.deepEqual(after, before, 'Browsing or local selection changed an authoritative decision or sent a command');
}

function measureChoices(rootSelector) {
  const root = document.querySelector(rootSelector);
  if (!root) throw Error('Owned Place row is missing');
  const rect = n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const visible = n => {
    const b = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    for (let p = n.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p), r = rect(p);
      if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX)) { b.left = Math.max(b.left, r.left); b.right = Math.min(b.right, r.right); }
      if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowY)) { b.top = Math.max(b.top, r.top); b.bottom = Math.min(b.bottom, r.bottom); }
    }
    return b;
  };
  const describe = n => {
    const control = n.matches('[role="button"],button') ? n : n.querySelector('[role="button"],button');
    return { id: Number(n.dataset.testid?.match(/not-alone-place-card-(\d+)$/)?.[1]), bounds: rect(n), visible: visible(n),
      label: control?.getAttribute('aria-label'), pressed: control?.getAttribute('aria-pressed'), selected: control?.getAttribute('aria-selected'),
      disabled: control?.getAttribute('aria-disabled') === 'true' || Boolean(control?.hasAttribute('disabled')) };
  };
  const cards = [...root.querySelectorAll('[data-testid^="not-alone-place-card-"]')].map(describe);
  const rail = root.querySelector('[data-testid="not-alone-choice-rail"]');
  const scroll = rail && [rail, ...rail.querySelectorAll('*')].find(n => ['auto', 'scroll'].includes(getComputedStyle(n).overflowX));
  return { cards, summary: root.querySelector('[data-testid="not-alone-choice-summary"]')?.textContent ?? null,
    focus: { label: document.activeElement?.getAttribute('aria-label'), inRow: root.contains(document.activeElement) },
    rail: scroll ? { bounds: rect(scroll), left: scroll.scrollLeft, width: scroll.clientWidth, extent: scroll.scrollWidth } : null,
    input: { touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, fine: matchMedia('(pointer: fine)').matches } };
}

function selectedIds(state) {
  return state.cards.filter(c => c.pressed === 'true' || c.selected === 'true').map(c => c.id).sort((a, b) => a - b);
}

async function assertFocusedPlaceVisible(player, qa, record, state, id) {
  const card = state.cards.find(c => c.id === id);
  const visible = Boolean(card && card.bounds.left >= card.visible.left - 2 && card.bounds.right <= card.visible.right + 2);
  if (visible) return;
  const diagnostic = { kind: 'keyboard-visibility-failure', diagnosticOnly: true, visualPass: false, before: state };
  (record.keyboardFailures ??= []).push(diagnostic); qa.persist();
  try {
    assert(qa.evidence.attempts.length < qa.evidence.captureBudget, 'Bounded capture budget exceeded');
    assert(path.isAbsolute(qa.outputDir), 'Failure evidence requires an absolute output directory');
    const file = `${String(qa.evidence.attempts.length + 1).padStart(3, '0')}-choice-keyboard-failure.png`;
    Object.assign(diagnostic, { file, viewportBefore: player.page.viewport() });
    qa.evidence.attempts.push(diagnostic); qa.persist();
    const bytes = await player.page.screenshot({ type: 'png', fullPage: false });
    diagnostic.after = await player.page.evaluate(measureChoices, ROOT);
    diagnostic.viewportAfter = player.page.viewport();
    const png = Buffer.from(bytes);
    fs.writeFileSync(path.join(qa.outputDir, file), png, { flag: 'wx' });
    diagnostic.png = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    assert.equal(diagnostic.png.width, diagnostic.viewportBefore.width);
    assert.equal(diagnostic.png.height, diagnostic.viewportBefore.height);
    assert.deepEqual(diagnostic.viewportAfter, diagnostic.viewportBefore);
  } catch (error) {
    let message = String(error.message);
    for (const secret of qa.secrets ?? []) if (secret) message = message.split(secret).join('[REDACTED]');
    diagnostic.error = message;
  } finally { qa.persist(); }
  assert(visible, 'Focused Place remains outside the horizontal rail viewport');
}

function assertWholeCard(frames, id) {
  const slices = frames.map(frame => {
    const card = frame.cards.find(c => c.id === id);
    assert(card, `Missing captured Place ${id}`);
    assert(card.bounds.left >= card.visible.left - 2 && card.bounds.right <= card.visible.right + 2, `Place ${id} is horizontally clipped`);
    return { height: card.bounds.height, top: Math.max(0, card.visible.top - card.bounds.top), bottom: Math.min(card.bounds.height, card.visible.bottom - card.bounds.top) };
  });
  const height = slices[0].height;
  assert(height > 0 && slices.every(s => Math.abs(s.height - height) <= 2), 'Captured card height changed between frames');
  let covered = 0;
  for (const slice of slices.sort((a, b) => a.top - b.top)) {
    assert(slice.bottom > slice.top && slice.top <= covered + 2, `Place ${id} has an unframed vertical gap`);
    covered = Math.max(covered, slice.bottom);
  }
  assert(covered >= height - 2, `Place ${id} bottom is not captured`);
}

function stampExternalScale(evidence, attemptIndex, scale, baseline) {
  const attempts = evidence.attempts.slice(attemptIndex);
  const files = new Set(attempts.map(a => a.file));
  for (const entry of [...attempts, ...evidence.captures.filter(c => files.has(c.file))]) {
    entry.scale = scale ? 200 : 100;
    entry.baseline = baseline;
  }
}

function measureBrowseControl(node) {
  const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
  return { timestamp: Date.now(), connected: node.isConnected, focus: document.activeElement === node,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    computedWidth: style.width, computedHeight: style.height, transform: style.transform,
    offsetWidth: node.offsetWidth, offsetHeight: node.offsetHeight, clientWidth: node.clientWidth, clientHeight: node.clientHeight };
}

function restingTransform(transform) {
  if (transform === 'none') return true;
  const match = transform.match(/^matrix(3d)?\(([^)]+)\)$/);
  if (!match) return false;
  const values = match[2].split(',').map(Number);
  const identity = match[1] ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : [1, 0, 0, 1, 0, 0];
  return values.length === identity.length && values.every((value, index) => value === identity[index]);
}

async function waitForBrowseRest(sample, record, persist, { now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const start = now(); let previous = null, stable = 0;
  try {
    while (now() - start <= 1500) {
      const value = await sample(); record.samples.push(value); persist();
      assert(value.connected, 'Place browse control detached before activation');
      if (now() - start > 1500) break;
      const signature = JSON.stringify({ rect: value.rect, computedWidth: value.computedWidth, computedHeight: value.computedHeight,
        transform: value.transform, offsetWidth: value.offsetWidth, offsetHeight: value.offsetHeight, clientWidth: value.clientWidth, clientHeight: value.clientHeight });
      stable = signature === previous ? stable + 1 : 1; previous = signature;
      if (restingTransform(value.transform) && stable >= 3) {
        assert(value.rect.width >= 48 && value.rect.height >= 48, 'Place browse control below 48px at rest');
        record.resting = true; record.elapsedMs = now() - start; persist(); return value;
      }
      const remaining = 1500 - (now() - start);
      if (remaining <= 0) break;
      await pause(Math.min(80, remaining));
    }
    throw Error('Place browse control did not settle within 1500ms');
  } catch (error) { record.error = error.message; record.elapsedMs = now() - start; persist(); throw error; }
}

async function activateBrowse(player, direction, keyboard, record, qa) {
  const button = await player.page.$(controlSelector(direction));
  assert(button, `Missing ${direction} Place cards`);
  try {
    if (await button.evaluate(n => n.getAttribute('aria-disabled') === 'true' || n.hasAttribute('disabled'))) return false;
    const measurement = { direction, keyboard, samples: [], resting: false };
    (record.browseControls ??= []).push(measurement);
    measurement.samples.push({ ...await button.evaluate(measureBrowseControl), phase: 'before-framing' }); qa.persist();
    await button.evaluate(n => n.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    await settle(player.page);
    await waitForBrowseRest(() => button.evaluate(measureBrowseControl), measurement, qa.persist);
    if (keyboard) {
      await button.focus();
      await player.page.keyboard.press(direction === 'Next' ? 'Enter' : 'Space');
    } else if (player.page.viewport().hasTouch) await button.tap(); else await button.click();
    await settle(player.page);
    let previous = null, stable = 0;
    for (let sample = 0; sample < 20; sample += 1) {
      const position = (await player.page.evaluate(measureChoices, ROOT)).rail?.left;
      assert(Number.isFinite(position), 'Place rail lost its scroll owner');
      stable = previous !== null && Math.abs(position - previous) < 0.5 ? stable + 1 : 0;
      if (stable >= 3) break;
      previous = position;
      await new Promise(resolve => setTimeout(resolve, 80));
      assert(sample < 19, 'Place browse animation did not settle');
    }
    return true;
  } finally { await button.dispose(); }
}

async function scaledCapture(player, qa, record, name, frame, align, scale) {
  await qa.ready(player.page);
  const baseline = scale ? await enlarge(player.page) : null;
  const attemptIndex = qa.evidence.attempts.length;
  (record.scalingAttempts ??= []).push({ name, scale: scale ? 200 : 100, baseline }); qa.persist();
  try {
    const capture = await qa.capture(player.page, name, { frame, align });
    // Keep CSS200 installed until the post-screenshot row geometry is recorded.
    stampExternalScale(qa.evidence, attemptIndex, scale, baseline);
    const row = await player.page.evaluate(measureChoices, ROOT);
    record.frames.push({ file: capture.file, scale: capture.scale, row }); qa.persist();
    if (scale) validateFonts(capture.metrics.fonts);
    return row;
  } finally {
    stampExternalScale(qa.evidence, attemptIndex, scale, baseline); qa.persist();
    if (scale) await restore(player.page);
  }
}

async function beginChoiceEvidence(player, qa) {
  const desktop = player.name === 'Noor';
  const originalViewport = player.page.viewport();
  assert.equal(Boolean(originalViewport.hasTouch), !desktop);
  assert.equal(Boolean(originalViewport.isMobile), !desktop);
  const record = { actor: player.name, inputMode: desktop ? 'desktop-fine-pointer' : 'phone-touch', frames: [], browsing: [], complete: false };
  (qa.evidence.placeChoices ??= []).push(record); qa.persist();
  const session = { player, qa, record, originalViewport, before: actionSnapshot(player) };
  try {
    await player.page.setViewport({ ...originalViewport, width: desktop ? 1280 : 375, height: desktop ? 900 : 844 });
    await qa.ready(player.page);
    await player.page.waitForSelector(RAIL);
    const initial = await player.page.evaluate(measureChoices, ROOT);
    record.initial = initial; qa.persist();
    assert.equal(initial.input.touchPoints > 0, !desktop);
    assert.equal(initial.input.coarse, !desktop);
    assert.equal(initial.input.fine, desktop);
    assert.deepEqual(initial.cards.map(c => c.id).sort((a, b) => a - b), [...player.latestPrivate.placeHand].sort((a, b) => a - b));
    assert(initial.cards.length >= 3 && initial.rail, 'Expected naturally available horizontal choices');
    assert.deepEqual(selectedIds(initial), []);
    const reached = new Set();
    for (let step = 0; step <= initial.cards.length + 2; step += 1) {
      const state = await player.page.evaluate(measureChoices, ROOT);
      record.browsing.push(state); qa.persist();
      assertNoSubmission(session.before, actionSnapshot(player));
      assert.deepEqual(selectedIds(state), []);
      for (const card of state.cards) if (card.bounds.left >= card.visible.left - 2 && card.bounds.right <= card.visible.right + 2) reached.add(card.id);
      if (!await activateBrowse(player, 'Next', desktop, record, qa)) break;
      assert(step < initial.cards.length + 2, 'Next never reaches the rail end');
    }
    assert.deepEqual([...reached].sort((a, b) => a - b), initial.cards.map(c => c.id).sort((a, b) => a - b), 'Browse controls did not reach every full card');
    const returned = await activateBrowse(player, 'Previous', desktop, record, qa);
    assert(returned || initial.rail.extent <= initial.rail.width + 2, 'Previous cannot return from an overflowing row end');
    assertNoSubmission(session.before, actionSnapshot(player));
    if (desktop) {
      const first = await player.page.$(cardSelector(initial.cards.find(c => !c.disabled).id));
      try {
        await first.evaluate(n => (n.matches('[role="button"],button') ? n : n.querySelector('[role="button"],button')).focus());
      } finally { await first.dispose(); }
      await settle(player.page);
      const visited = new Set(); record.keyboard = [];
      for (let index = 0; index < initial.cards.length * 3 + 10; index += 1) {
        const state = await player.page.evaluate(measureChoices, ROOT);
        record.keyboard.push({ focus: state.focus, cards: state.cards, rail: state.rail });
        const id = Number(state.focus.label?.match(/^Place (\d+),/)?.[1]);
        if (state.focus.inRow && id) {
          await assertFocusedPlaceVisible(player, qa, record, state, id);
          visited.add(id);
        }
        if (initial.cards.filter(c => !c.disabled).every(c => visited.has(c.id))) break;
        await player.page.keyboard.press('Tab'); await settle(player.page);
      }
      qa.persist();
      assert.deepEqual([...visited].sort((a, b) => a - b), initial.cards.filter(c => !c.disabled).map(c => c.id).sort((a, b) => a - b), 'Keyboard cannot reach every enabled Place');
      assertNoSubmission(session.before, actionSnapshot(player));
    }
    await scaledCapture(player, qa, record, `choice-${player.name}-normal.png`, cardSelector(initial.cards[0].id), 'start', false);
    for (const card of initial.cards) {
      const frames = [];
      for (const align of ['start', 'end']) frames.push(await scaledCapture(player, qa, record, `choice-${player.name}-${card.id}-text200-${align}.png`, cardSelector(card.id), align, true));
      assertWholeCard(frames, card.id);
      assertNoSubmission(session.before, actionSnapshot(player));
    }
    return session;
  } catch (error) {
    record.error = error.message; qa.persist();
    await player.page.setViewport(originalViewport);
    throw error;
  }
}

async function selectionEvidence(session, choices) {
  const { player, qa, record } = session;
  assertNoSubmission(session.before, actionSnapshot(player));
  const selected = await player.page.evaluate(measureChoices, ROOT);
  record.selected = selected; record.policyChoices = [...choices]; qa.persist();
  assert.deepEqual(selectedIds(selected), [...choices].sort((a, b) => a - b));
  assert(selected.summary?.trim(), 'Separate own-selection summary missing');
  for (const id of choices) {
    const name = selected.cards.find(c => c.id === id).label?.match(/^Place \d+, ([^.]+)\./)?.[1];
    assert(name && selected.summary.toLowerCase().includes(name.toLowerCase()), 'Summary does not identify the chosen Place');
  }
  await activateBrowse(player, 'Next', record.inputMode === 'desktop-fine-pointer', record, qa);
  await activateBrowse(player, 'Previous', record.inputMode === 'desktop-fine-pointer', record, qa);
  assert.deepEqual(selectedIds(await player.page.evaluate(measureChoices, ROOT)), selectedIds(selected));
  assertNoSubmission(session.before, actionSnapshot(player));
  const confirm = '#not-alone-decision-area [aria-label="LOCK ' + player.latestPrivate.requiredSelectionCount + ' SECRET PLACE' + (player.latestPrivate.requiredSelectionCount === 1 ? '' : 'S') + '"]';
  const enabled = await player.page.$eval(confirm, n => n.getAttribute('aria-disabled') !== 'true' && !n.hasAttribute('disabled'));
  assert(enabled, 'Local policy selection did not enable its separate confirmation');
  await scaledCapture(player, qa, record, `choice-${player.name}-selected-summary-text200.png`, SUMMARY, 'center', true);
  await scaledCapture(player, qa, record, `choice-${player.name}-confirm-text200.png`, confirm, 'center', true);
  assertNoSubmission(session.before, actionSnapshot(player));
}

function confirmChoiceEvidence(session) {
  const { player, record, qa, before } = session;
  record.afterConfirmation = actionSnapshot(player); qa.persist();
  assert.equal(player.sentActions.length - before.sent, 1);
  assert.equal(player.sentActions.at(-1), 'notalone:select');
  assert.equal(player.acceptedActions.length - before.accepted, 1);
  assert.equal(player.acceptedActions.at(-1).action, 'select');
  assert.equal(player.rejections.length, before.rejected);
  assert.equal(player.acceptedActions.at(-1).revision, player.latestPrivate.revision);
  assert.equal(player.latestPublic.revision, player.latestPrivate.revision);
  assert(player.latestPrivate.revision > before.privateRevision);
  assert.deepEqual([...player.latestPrivate.selectedPlaces].sort((a, b) => a - b), [...record.policyChoices].sort((a, b) => a - b));
  record.complete = true; qa.persist();
}

async function desktopResultEvidence(player, qa) {
  const original = player.page.viewport();
  assert(!original.isMobile && !original.hasTouch, 'Desktop results require an existing fine-pointer owner');
  const captures = [];
  try {
    await player.page.setViewport({ ...original, width: 1280, height: 900 });
    await qa.ready(player.page);
    assert.equal(player.latestPublic.status, 'game_over');
    assert(await player.page.evaluate(() => navigator.maxTouchPoints === 0 && matchMedia('(pointer: fine)').matches && !matchMedia('(pointer: coarse)').matches), 'Results context must retain fine-pointer input');
    for (const scale of [false, true]) for (const align of ['start', 'end']) {
      const frame = align === 'start' ? '#not-alone-game-over' : '#not-alone-game-over [aria-label="BACK TO ARCADE"]';
      captures.push(await qa.capture(player.page, `results-desktop-${scale ? 'text200' : 'normal'}-${align}.png`, { scale, frame, align }));
    }
    qa.evidence.desktopResults = { actor: player.name, revision: player.latestPublic.revision, captures: captures.map(c => c.file) }; qa.persist();
  } finally { await player.page.setViewport(original); }
}

module.exports = { ROOT, RAIL, SUMMARY, measureChoices, measureBrowseControl, restingTransform, waitForBrowseRest, actionSnapshot, assertNoSubmission, selectedIds, assertWholeCard, assertFocusedPlaceVisible, stampExternalScale, beginChoiceEvidence, selectionEvidence, confirmChoiceEvidence, desktopResultEvidence };
