const assert = require('node:assert/strict');
const { redact } = require('./libertalia-ui-primitives.cjs');

function choiceSelector(choiceId, optionId) {
  assert(Number.isSafeInteger(choiceId) && choiceId >= 0, 'Explicit choice ID required');
  assert(typeof optionId === 'string' && optionId.length > 0, 'Explicit opaque option ID required');
  return '#libertalia-decision-area [data-testid="libertalia-choice-' + choiceId + '-' + encodeURIComponent(optionId) + '"]';
}

function assertOwnedChoice(actor, identity) {
  const own = actor.latestPrivate, pub = actor.latestPublic, pending = own?.pendingChoice;
  assert(actor.auth?.playerId && actor.auth.roomCode, 'Authenticated owner required');
  assert(own?.playerId === actor.auth.playerId && own.roomCode === actor.auth.roomCode && pub?.roomCode === own.roomCode, 'Choice belongs to acting owner room');
  assert(Number.isSafeInteger(identity.revision) && own.revision === identity.revision && pub.revision === identity.revision, 'Choice revision changed before input');
  assert(pending?.playerId === own.playerId && pending.id === identity.choiceId, 'Current owned pending choice required');
  assert(pending.options.some(option => option.id === identity.optionId), 'Exact option belongs to current pending choice');
  assert(typeof identity.label === 'string' && identity.label.trim(), 'Expected rendered label required');
  return choiceSelector(identity.choiceId, identity.optionId);
}

function readChoiceTarget({ selector, label }) {
  const nodes = [...document.querySelectorAll(selector)];
  if (nodes.length > 1) throw Error('Ambiguous exact choice identity');
  if (!nodes.length) return { ready: false, reason: 'unmounted' };
  const node = nodes[0], bounds = node.getBoundingClientRect(), css = getComputedStyle(node);
  if (node.getAttribute('aria-label') !== label) throw Error('Exact choice identity has unexpected label');
  if (!node.matches('[role="button"],button')) throw Error('Choice identity must target the actual option control');
  window.__libertaliaQAChoiceIdentity ??= { nodes: new WeakMap(), sequence: 0 };
  const identity = window.__libertaliaQAChoiceIdentity;
  if (!identity.nodes.has(node)) identity.nodes.set(node, ++identity.sequence);
  const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  const ready = node.isConnected && !node.closest('[hidden],[inert],[aria-hidden="true"]')
    && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && css.visibility === 'visible'
    && Number(css.opacity) > 0 && css.pointerEvents !== 'none' && bounds.width >= 48 && bounds.height >= 48
    && bounds.left + bounds.width / 2 >= 0 && bounds.top + bounds.height / 2 >= 0
    && bounds.left + bounds.width / 2 <= innerWidth && bounds.top + bounds.height / 2 <= innerHeight
    && Boolean(hit && (hit === node || node.contains(hit)));
  return { ready, nodeId: identity.nodes.get(node), label, text: node.textContent, selected: node.getAttribute('aria-selected'),
    left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
    viewportWidth: innerWidth, viewportHeight: innerHeight, scrollX, scrollY };
}

function stableChoiceSample(previous, current) {
  return Boolean(previous?.ready && current?.ready && previous.nodeId === current.nodeId
    && ['left', 'top', 'width', 'height', 'viewportWidth', 'viewportHeight', 'scrollX', 'scrollY']
      .every(key => Number.isFinite(current[key]) && Math.abs(previous[key] - current[key]) <= 0.5));
}

async function choiceIdentity(actor, identity) {
  const selector = assertOwnedChoice(actor, identity);
  const target = await actor.page.evaluate(readChoiceTarget, { selector, label: identity.label });
  assert(target.nodeId && target.width > 0 && target.height > 0, 'Exact choice control must be rendered');
  assertOwnedChoice(actor, identity);
  return { ...identity, selector, ...target };
}

async function activateChoice(actor, identity, recorder, { timeoutMs = 10000, intervalMs = 60 } = {}) {
  const selector = assertOwnedChoice(actor, identity), page = actor.page;
  const record = { actor: actor.name, owner: actor.auth.playerId, ...identity, selector, inputProfile: actor.inputProfile, samples: [], dispatched: false };
  recorder.evidence.choiceInputs ??= []; recorder.evidence.choiceInputs.push(record); recorder.persist();
  let handle;
  try {
    const originalViewport = page.viewport(), end = Date.now() + timeoutMs;
    assert.equal(Boolean(originalViewport.hasTouch), Boolean(actor.inputProfile.hasTouch), 'Original pointer profile required');
    let previous = null, stable = 0, scrolledNode = null;
    while (Date.now() < end) {
      assertOwnedChoice(actor, identity);
      assert.deepEqual(page.viewport(), originalViewport, 'Viewport changed during choice activation');
      const sample = await page.evaluate(readChoiceTarget, { selector, label: identity.label });
      record.samples.push(sample);
      if (sample.nodeId && sample.nodeId !== scrolledNode) {
        await page.$eval(selector, node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
        scrolledNode = sample.nodeId; stable = 0; previous = null;
      } else {
        stable = stableChoiceSample(previous, sample) ? stable + 1 : 0;
        previous = sample;
        if (stable >= 3) break;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    assert(stable >= 3, 'Choice control did not become enabled, stable and hit-testable');
    handle = await page.$(selector); assert(handle, 'Choice control disappeared before dispatch');
    assert(await handle.evaluate((node, target) => node.isConnected && node === document.querySelector(target), selector), 'Choice control remounted before dispatch');
    const final = await page.evaluate(readChoiceTarget, { selector, label: identity.label });
    assert(stableChoiceSample(previous, final), 'Choice geometry or mounted identity changed before dispatch');
    assertOwnedChoice(actor, identity); assert.deepEqual(page.viewport(), originalViewport, 'Viewport changed before choice dispatch');
    record.beforeDispatch = final; record.dispatchAttempted = true; recorder.persist();
    if (actor.inputProfile.hasTouch) await handle.tap(); else await handle.click();
    record.dispatched = true; recorder.persist();
  } catch (error) {
    record.error = redact(error.message, [...(recorder.secrets ?? [])]);
    try { recorder.persist(); } catch (failure) { record.receiptError = redact(failure.message, [...(recorder.secrets ?? [])]); }
    throw error;
  } finally { await handle?.dispose().catch(() => undefined); }
  return record;
}

module.exports = { choiceSelector, assertOwnedChoice, readChoiceTarget, stableChoiceSample, choiceIdentity, activateChoice };
