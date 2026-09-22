const assert = require('node:assert/strict');
const { enlargeBangText, restoreBangText, readBangFontState, validateBangFontState } = require('./bang-ui-evidence.cjs');

const PROFILES = Object.freeze([{ width: 375, scale: 100 }, { width: 375, scale: 200 }, { width: 1280, scale: 200 }].map(Object.freeze));
const SHARED_CAPTURE_LIMIT = 180;
const LIFECYCLE_ALLOWANCE = 58;
const LEGACY_ALLOWANCE = 3;
const panel = (selector, required = []) => ({ kind: 'panel', selector, required });
const text = (scope, includes) => ({ kind: 'text', scope, includes });
const button = (scope, label) => ({ kind: 'button', scope, label });
const faces = (source, prefix, count, names) => ({ kind: 'cards', source, prefix, count, ...(names ? { names } : {}) });
const choice = panel('#bang-current-choice');
const sid = {
  ready: { owner: 'Lyra', flag: 'canRescue', frames: [choice] },
  selected: { owner: 'Lyra', flag: 'canRescue', selected: ['hand', 2], frames: [text('#bang-hand', 'Sid Ketchum: choose two cards to heal'), faces('hand', 'hand', 2), button('#bang-hand', 'HEAL WITH TWO CARDS (2/2)')] },
};
const MANIFEST = {
  lucky_check: { ready: { owner: 'Noor', flag: 'canChooseCheck', frames: [text('#bang-current-choice', 'Hearts succeed.'), faces('check', 'check', 2)] } },
  sid_rescue: sid,
  sid_two_alive: Object.fromEntries(Object.entries(sid).map(([key, spec]) => [key, { ...spec, living: 2 }])),
  beer_rescue: {
    ready: { owner: 'Noor', flag: 'canRescue', lives: 2, frames: [choice, faces('hand', 'hand', 2, ['beer'])] },
    one_beer: { owner: 'Noor', flag: 'canRescue', lives: 1, frames: [choice, faces('hand', 'hand', 1, ['beer'])] },
  },
  discard_order: { selected: { owner: 'Noor', flag: 'canChooseDiscardOrder', selected: ['order', 2], frames: [
    text('body', 'You are eliminated and can no longer win.'), text('#bang-current-choice', 'Select every card in the order to discard it.'),
    faces('order', 'order', 2), button('#bang-current-choice', 'CONFIRM ORDER (2/2)'),
  ] } },
  kit_draw: { selected: { owner: 'Echo', flag: 'canChooseDraw', selected: ['draw', 2], frames: [
    text('#bang-current-choice', 'Select two cards to keep.'), faces('draw', 'draw', 3), button('#bang-current-choice', 'KEEP SELECTED (2/2)'),
  ] } },
  jesse_draw: { ready: { owner: 'Echo', flag: 'canChooseDraw', drawKind: 'jesse_jones', frames: [choice] } },
  pedro_draw: { ready: { owner: 'Echo', flag: 'canChooseDraw', drawKind: 'pedro_ramirez', frames: [choice] } },
  calamity_play: {
    targets: { owner: 'Echo', flag: 'canPlay', selected: ['hand', 1], frames: [faces('hand', 'hand', 1, ['missed']), panel('#bang-play-options', ['Play BANG!', 'TARGET Astra Host', 'CANCEL PLAY'])] },
    response: { owner: 'Astra Host', flag: 'canRespond', frames: [choice] },
  },
  self_zones: {
    panic_targets: { owner: 'Echo', flag: 'canPlay', selected: ['hand', 1, ['panic']], frames: [faces('hand', 'hand', 1, ['panic']), panel('#bang-play-options', ['Target: Echo (you)', 'IN PLAY: Mustang', 'BACK TO TARGETS', 'CANCEL PLAY'])] },
    cat_targets: { owner: 'Echo', flag: 'canPlay', selected: ['hand', 1, ['cat_balou']], frames: [faces('hand', 'hand', 1, ['cat_balou']), panel('#bang-play-options', ['Target: Echo (you)', 'IN PLAY: Scope', 'BACK TO TARGETS', 'CANCEL PLAY'])] },
  },
  barrel_choice: {
    ready: { owner: 'Echo', flag: 'canRespond', barrels: 2, frames: [choice] },
    remaining: { owner: 'Echo', flag: 'canRespond', barrels: 1, frames: [choice] },
  },
};
function deepFreeze(value) { Object.values(value).forEach(child => { if (child && typeof child === 'object') deepFreeze(child); }); return Object.freeze(value); }
deepFreeze(MANIFEST);
const BATCHES = deepFreeze(Object.fromEntries(Object.entries({
  'check-rescue': ['lucky_check', 'sid_rescue', 'sid_two_alive', 'beer_rescue'],
  'draw-order': ['discard_order', 'kit_draw', 'jesse_draw', 'pedro_draw'],
  'targets-response': ['calamity_play', 'self_zones', 'barrel_choice'],
}).map(([name, scenarios]) => {
  const frames = scenarios.reduce((sum, scenario) => sum + Object.values(MANIFEST[scenario]).reduce((count, state) => count + state.frames.reduce((n, frame) => n + (frame.count ?? 1), 0), 0), 0);
  const profiles = frames * PROFILES.length, maxCaptures = profiles * 2;
  return [name, { scenarios, frames, profiles, maxCaptures, conservativeCeiling: LIFECYCLE_ALLOWANCE + LEGACY_ALLOWANCE + maxCaptures }];
})));

function sourceCards(actor, source) {
  const sources = { hand: actor.private.hand, check: actor.public.drawCheck?.cards, order: actor.private.discardOrderCards, draw: actor.private.drawChoice?.options };
  assert(Array.isArray(sources[source]), 'Required owner/public card projection is missing');
  return sources[source];
}
function matchingCards(actor, descriptor) {
  const cards = sourceCards(actor, descriptor.source).filter(card => !descriptor.names || descriptor.names.includes(card.name));
  assert.equal(cards.length, descriptor.count, 'Fixture card count differs from the declared manifest');
  assert(cards.every(card => typeof card.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(card.id)), 'Projected card ID must be selector-safe');
  assert.equal(new Set(cards.map(card => card.id)).size, cards.length, 'Projected card IDs must be unique');
  return cards;
}
function stateSpec(scenario, state) {
  assert(Object.hasOwn(MANIFEST, scenario) && Object.hasOwn(MANIFEST[scenario], state), 'Unknown fixture state');
  return MANIFEST[scenario][state];
}
function assertOwner(actor, spec) {
  const p = actor.private, g = actor.public;
  assert(p?.gameId === 'bang' && g?.gameId === 'bang' && g.status === 'playing', 'Fixture framing needs an active BANG pair');
  assert(Number.isInteger(g.revision) && g.revision === p.revision && g.roomCode === p.roomCode, 'Fixture projections must be paired');
  assert.equal(actor.name, spec.owner, 'Fixture state must be captured by its actual decision owner');
  assert(g.players.some(player => player.playerId === p.playerId && player.displayName === spec.owner), 'Private owner does not match the public seat');
  assert.equal(p[spec.flag], true, 'Fixture decision is not owned by this seat');
  if (spec.lives !== undefined) assert.equal(g.rescue?.livesNeeded, spec.lives, 'Wrong rescue stage');
  if (spec.barrels !== undefined) assert.equal(p.barrelOptions?.length, spec.barrels, 'Wrong defence-source stage');
  if (spec.living !== undefined) assert.equal(g.players.filter(player => player.alive).length, spec.living, 'Wrong living-seat stage');
  if (spec.drawKind) assert.equal(p.drawChoice?.kind, spec.drawKind, 'Wrong draw-choice kind');
}
function expandFrames(actor, scenario, state) {
  const spec = stateSpec(scenario, state); assertOwner(actor, spec);
  return spec.frames.flatMap((descriptor, index) => descriptor.kind === 'cards'
    ? matchingCards(actor, descriptor).map((card, i) => ({ kind: 'card', selector: `[id="bang-card-${descriptor.prefix}-${card.id}"]`, key: `${index}-${i}`, cardId: card.id }))
    : [{ ...descriptor, key: String(index) }]);
}
function expectedSelection(actor, spec) {
  if (!spec.selected) return [];
  const [source, count, names] = spec.selected;
  const cards = sourceCards(actor, source).filter(card => !names || names.includes(card.name));
  assert(cards.length >= count, 'Fixture selection source is incomplete');
  return cards.slice(0, count).map(card => `bang-card-${source}-${card.id}`).sort();
}
function expectedOrder(actor, scenario) {
  return scenario === 'discard_order' ? sourceCards(actor, 'order').map((card, index) => ({ id: `bang-card-order-${card.id}`, order: index + 1 })) : [];
}

function selectionSnapshot() {
  return [...document.querySelectorAll('[id^="bang-card-"]')].filter(node => node.querySelector('[role="button"][aria-pressed="true"]')).map(node => node.id).sort();
}
function orderSnapshot() {
  return [...document.querySelectorAll('[id^="bang-card-order-"]')].map(node => {
    const label = node.querySelector('[role="button"]')?.getAttribute('aria-label') ?? '';
    return { id: node.id, order: Number(label.match(/ Selection (\d+)\./)?.[1] ?? 0) };
  }).sort((a, b) => a.order - b.order);
}
function markFrame({ descriptor, marker }) {
  const visible = node => {
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return box.width > 0 && box.height > 0 && style.visibility === 'visible' && !node.closest('[aria-hidden="true"]');
  };
  let matches;
  if (descriptor.selector) matches = [...document.querySelectorAll(descriptor.selector)].filter(visible);
  else {
    const scopes = document.querySelectorAll(descriptor.scope);
    if (scopes.length !== 1) throw Error('Fixture frame scope is missing or ambiguous');
    if (descriptor.kind === 'button') matches = [...scopes[0].querySelectorAll('[role="button"],button')].filter(node => node.getAttribute('aria-label') === descriptor.label && visible(node));
    else {
      const candidates = [...scopes[0].querySelectorAll('*')].filter(node => visible(node) && node.textContent.includes(descriptor.includes));
      matches = candidates.filter(node => !candidates.some(other => other !== node && node.contains(other)));
    }
  }
  if (matches.length !== 1) throw Error('Fixture frame is missing or ambiguous');
  const node = matches[0];
  if (descriptor.required?.some(text => !node.textContent.includes(text))) throw Error('Fixture panel is not at the declared local-choice stage');
  if (descriptor.kind !== 'card' && (node.matches('[id^="bang-card-"]') || node.querySelector('[id^="bang-card-"]'))) throw Error('Instruction/action frames must not contain full cards');
  if (node.hasAttribute('data-bang-qa-fixture') && node.getAttribute('data-bang-qa-fixture') !== marker) throw Error('Fixture frame marker is already owned');
  const existing = [...document.querySelectorAll('[data-bang-qa-fixture]')].filter(item => item.getAttribute('data-bang-qa-fixture') === marker);
  if (existing.some(item => item !== node)) throw Error('Fixture frame marker is ambiguous');
  node.setAttribute('data-bang-qa-fixture', marker);
  return `[data-bang-qa-fixture="${marker}"]`;
}
function clearMarkers(prefix) {
  for (const node of document.querySelectorAll('[data-bang-qa-fixture]')) if (node.getAttribute('data-bang-qa-fixture').startsWith(prefix)) node.removeAttribute('data-bang-qa-fixture');
}
function frameGeometry(selector) {
  const nodes = document.querySelectorAll(selector);
  if (nodes.length !== 1) throw Error('Captured fixture frame is missing or ambiguous');
  const node = nodes[0], box = node.getBoundingClientRect(), glyphs = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode, parent = text.parentElement;
    if (!text.textContent.trim() || parent.closest('[aria-hidden="true"]') || /icon|material|fontawesome/i.test(getComputedStyle(parent).fontFamily)) continue;
    glyphs.push(...window.__coupQATextGeometry(text).glyphRects);
  }
  return { bounds: { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height }, glyphs };
}
function measuredFrame(record, measured) {
  const v = record.metrics?.frameVisibleBounds, b = record.metrics?.frame;
  assert(v && b && ['left', 'right', 'top', 'bottom'].every(key => Number.isFinite(v[key]) && Number.isFinite(b[key]) && Math.abs(b[key] - measured.bounds[key]) <= 2), 'Missing or stale recorded frame visibility');
  assert(v.right > v.left && v.bottom > v.top && b.height > 0 && b.width > 0, 'Frame has no visible capture area');
  assert(b.left >= v.left - 2 && b.right <= v.right + 2, 'Fixture frame is horizontally clipped');
  assert(measured.glyphs.length > 0, 'Fixture frame must contain readable live text');
  assert(measured.glyphs.every(g => g.left >= b.left - 2 && g.right <= b.right + 2 && g.top >= b.top - 2 && g.bottom <= b.bottom + 2), 'Fixture glyph escapes its frame');
  return { bounds: b, visible: v, glyphs: measured.glyphs };
}
function wholeFrameVisible(frame) {
  const { bounds: b, visible: v } = frame;
  return b.left >= v.left - 2 && b.right <= v.right + 2 && b.top >= v.top - 2 && b.bottom <= v.bottom + 2
    && frame.glyphs.every(g => g.left >= v.left - 2 && g.right <= v.right + 2 && g.top >= v.top - 2 && g.bottom <= v.bottom + 2);
}
function assertFrameCoverage(frames) {
  assert(frames.length === 1 || frames.length === 2, 'Fixture frame has a fixed two-capture maximum');
  if (frames.length === 1) { assert(wholeFrameVisible(frames[0]), 'Single screenshot cannot cover hidden fixture content'); return; }
  const height = frames[0].bounds.height;
  assert(frames.every(frame => Math.abs(frame.bounds.height - height) <= 2), 'Fixture frame changed height between endpoints');
  const slices = frames.map(({ bounds: b, visible: v }) => ({ start: Math.max(0, v.top - b.top), end: Math.min(height, v.bottom - b.top) })).sort((a, b) => a.start - b.start);
  let reached = 0;
  for (const slice of slices) { assert(slice.start <= reached + 2 && slice.end > slice.start, 'Fixture endpoint images leave an unreadable gap'); reached = Math.max(reached, slice.end); }
  assert(reached >= height - 2, 'Fixture frame bottom is missing');
}
function assertCapacity(batch, used, reserved = LEGACY_ALLOWANCE, limit = SHARED_CAPTURE_LIMIT) {
  assert(Object.hasOwn(BATCHES, batch), 'Select one explicit fixture-only batch');
  assert([used, reserved, limit].every(Number.isInteger) && used >= 0 && reserved >= 0 && limit > 0 && limit <= SHARED_CAPTURE_LIMIT, 'Invalid fixture capture capacity');
  assert(used + BATCHES[batch].maxCaptures + reserved <= limit, 'Insufficient capture capacity; split the fixture batch instead of weakening framing');
}
function assertStable(actor, before, spec) {
  assertOwner(actor, spec);
  assert.equal(actor.private.playerId, before.ownerId, 'Fixture owner changed while framing');
  assert.equal(actor.public.revision, before.revision, 'Fixture revision changed while framing');
  assert.equal(actor.public.phase, before.phase, 'Fixture phase changed while framing');
  assert.equal(actor.sent.length, before.sent, 'Framing must not send game commands');
}

function createFixtureFraming(qa, { batch, reservedCaptures = LEGACY_ALLOWANCE } = {}) {
  assert(qa.evidence.service === 'bang-local-ui-fixtures' && qa.evidence.mode === 'canonical-fixtures-only', 'Framing requires an explicitly gated fixture-only evidence run');
  assertCapacity(batch, qa.evidence.attempts.length, reservedCaptures);
  const completed = new Set(), proofs = [], plan = BATCHES[batch], firstAttempt = qa.evidence.attempts.length;
  qa.evidence.fixtureFraming = { batch, plan, profiles: PROFILES, scope: 'Seeded owner-view evidence; viewport-only resizing retains each original input profile', proofs, completed: [] };
  qa.persist();
  return {
    async captureState(actor, scenario, state) {
      assert(plan.scenarios.includes(scenario), 'Scenario is outside this fixture batch');
      const key = `${scenario}/${state}`, spec = stateSpec(scenario, state);
      assert(!completed.has(key), 'Fixture state was already captured');
      const frames = expandFrames(actor, scenario, state), selected = expectedSelection(actor, spec);
      const order = expectedOrder(actor, scenario);
      const assertSelection = async () => {
        assert.deepEqual(await actor.page.evaluate(selectionSnapshot), selected, 'Fixture selection differs from the declared capture state');
        if (order.length) assert.deepEqual(await actor.page.evaluate(orderSnapshot), order, 'Fixture discard-order numbers differ from the declared selection');
      };
      const before = { ownerId: actor.private.playerId, revision: actor.public.revision, phase: actor.public.phase, sent: actor.sent.length };
      const original = actor.page.viewport(), markerPrefix = `fixture-${scenario}-${state}-`;
      try {
        for (const profile of PROFILES) {
          await actor.page.setViewport({ ...original, width: profile.width, height: 844, deviceScaleFactor: 1 });
          await qa.ready(actor.page); assertStable(actor, before, spec);
          await assertSelection();
          const attemptStart = qa.evidence.attempts.length;
          let baseline = null;
          try {
            if (profile.scale === 200) baseline = await enlargeBangText(actor.page);
            for (const descriptor of frames) {
              const frameProof = [], files = [], marker = markerPrefix + descriptor.key;
              let input;
              const selector = await actor.page.evaluate(markFrame, { descriptor, marker });
              for (const align of ['start', 'end']) {
                assert(qa.evidence.attempts.length - firstAttempt < plan.maxCaptures, 'Fixture batch capture budget exceeded');
                assert(qa.evidence.attempts.length + reservedCaptures < SHARED_CAPTURE_LIMIT, 'Fixture run capture reserve exhausted');
                assertStable(actor, before, spec);
                const record = await qa.capture(actor.page, `${marker}-${profile.width}-${profile.scale}-${align}.png`, { frame: selector, align, prepare: async () => {
                  assertStable(actor, before, spec);
                  assert.equal(await actor.page.evaluate(markFrame, { descriptor, marker }), selector);
                  await assertSelection();
                  if (baseline) validateBangFontState(await actor.page.evaluate(readBangFontState));
                } });
                record.scale = profile.scale; if (baseline) record.baseline = baseline;
                const attempt = qa.evidence.attempts.find(item => item.file === record.file);
                assert(attempt, 'Fixture capture attempt is missing'); attempt.scale = profile.scale; if (baseline) attempt.baseline = baseline;
                if (baseline) { record.fixtureFontState = await actor.page.evaluate(readBangFontState); validateBangFontState(record.fixtureFontState); }
                assert.equal(Boolean(record.viewport.hasTouch), Boolean(original.hasTouch), 'Viewport-only fixture evidence must retain its original touch profile');
                assert.equal(Boolean(record.metrics.coarse), Boolean(original.hasTouch), 'Actual pointer profile differs from its owner');
                assert.equal(record.metrics.touchPoints > 0, Boolean(original.hasTouch), 'Actual touch support differs from its owner');
                input = { viewportOnly: true, originalWidth: original.width, hasTouch: Boolean(original.hasTouch), isMobile: Boolean(original.isMobile), coarse: record.metrics.coarse, touchPoints: record.metrics.touchPoints };
                const measured = measuredFrame(record, await actor.page.evaluate(frameGeometry, selector));
                assertStable(actor, before, spec);
                await assertSelection();
                record.fixtureFrame = { scenario, state, ownerId: before.ownerId, revision: before.revision, selection: selected, selectionOrder: order, descriptorKey: descriptor.key, geometry: measured };
                frameProof.push(measured); files.push(record.file); qa.persist();
                if (wholeFrameVisible(measured)) break;
              }
              assertFrameCoverage(frameProof);
              proofs.push({ scenario, state, owner: spec.owner, ownerId: before.ownerId, revision: before.revision, selection: selected, selectionOrder: order,
                descriptorKey: descriptor.key, cardId: descriptor.cardId ?? null, profile, input, files, complete: true });
              qa.persist();
            }
          } finally {
            const attempts = qa.evidence.attempts.slice(attemptStart), files = new Set(attempts.map(attempt => attempt.file));
            for (const record of [...attempts, ...(qa.evidence.captures ?? []).filter(record => files.has(record.file))]) {
              record.scale = profile.scale; if (baseline) record.baseline = baseline;
            }
            qa.persist();
            if (profile.scale === 200) await restoreBangText(actor.page);
          }
        }
        completed.add(key); qa.evidence.fixtureFraming.completed = [...completed]; qa.persist();
      } finally { await actor.page.evaluate(clearMarkers, markerPrefix); await actor.page.setViewport(original); }
    },
    assertComplete() {
      const required = plan.scenarios.flatMap(scenario => Object.keys(MANIFEST[scenario]).map(state => `${scenario}/${state}`));
      assert.deepEqual([...completed].sort(), required.sort(), 'Fixture batch is missing declared states');
      assert.equal(proofs.length, plan.profiles, 'Fixture batch is missing declared frame/profile proofs');
      assert(proofs.every(proof => proof.complete));
      qa.evidence.fixtureFraming.complete = true; qa.persist();
      return { batch, states: completed.size, profiles: proofs.length, captures: qa.evidence.attempts.length - firstAttempt };
    },
  };
}

module.exports = { MANIFEST, BATCHES, PROFILES, SHARED_CAPTURE_LIMIT, LIFECYCLE_ALLOWANCE, LEGACY_ALLOWANCE, expandFrames, expectedSelection, expectedOrder,
  assertOwner, assertCapacity, assertStable, markFrame, selectionSnapshot, orderSnapshot, frameGeometry, measuredFrame, wholeFrameVisible, assertFrameCoverage, createFixtureFraming };
