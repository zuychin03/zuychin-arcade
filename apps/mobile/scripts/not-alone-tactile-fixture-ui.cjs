const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const puppeteer = require('puppeteer-core');
const { io } = require('socket.io-client');
const h = require('./not-alone-ui-smoke.cjs');
const { createEvidence, hasOwnedNotAlonePair, bundleFence, guardNetwork, local, redact } = require('./not-alone-ui-evidence.cjs');
const { enlarge, restore, validateFonts } = require('./skull-ui-evidence.cjs');
const { assertWholeCard, stampExternalScale } = require('./not-alone-choice-evidence.cjs');

const SCENARIOS = Object.freeze(['shelter-choice', 'card-affordances', 'sacrifice-rebase', 'map-status', 'hidden-trails', 'sealed-choice', 'seven-final']);
const CAPTURE_LIMIT = 120;
const NAMES = Object.freeze(['ABCDEFGHIJKLMNOPQRST', 'BCDEFGHIJKLMNOPQRSTU', 'CDEFGHIJKLMNOPQRSTUV', 'DEFGHIJKLMNOPQRSTUVW', 'EFGHIJKLMNOPQRSTUVWX', 'FGHIJKLMNOPQRSTUVWXY', 'GHIJKLMNOPQRSTUVWXYZ']);
const title = id => id.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
const ownPair = seat => hasOwnedNotAlonePair(seat.auth, seat.latestPublic, seat.latestPrivate);
const SOURCE_FILES = Object.freeze([
  'apps/mobile/scripts/not-alone-tactile-fixture-ui.cjs', 'apps/mobile/scripts/not-alone-ui-smoke.cjs',
  'apps/mobile/scripts/not-alone-tactile-fixture-ui.test.cjs',
  'apps/mobile/scripts/not-alone-ui-evidence.cjs', 'apps/mobile/scripts/not-alone-choice-evidence.cjs',
  'apps/mobile/scripts/skull-ui-evidence.cjs', 'apps/mobile/scripts/tokyo-ui-evidence.cjs',
  'apps/server/scripts/not-alone/ui-fixture.ts', 'apps/server/scripts/not-alone/ui-fixtures.ts',
  'apps/server/scripts/not-alone/ui-tactile-fixtures.ts',
  'apps/server/src/game/not-alone/engine.ts', 'apps/server/src/game/not-alone/publicState.ts',
  'apps/server/src/game/not-alone/socketHandlers.ts', 'apps/mobile/app/not-alone/game.tsx',
  'apps/mobile/app/not-alone/index.tsx', 'apps/mobile/app/not-alone/lobby.tsx', 'apps/mobile/app/not-alone/join.tsx',
  'apps/mobile/components/not-alone/PlaceCard.tsx', 'apps/mobile/components/not-alone/PlaceArtwork.tsx',
  'apps/mobile/components/not-alone/PlaceChoiceRow.tsx', 'apps/mobile/components/not-alone/CardChip.tsx',
  'apps/mobile/components/not-alone/NotAloneArtwork.tsx', 'apps/mobile/components/not-alone/useNotAloneActions.ts',
  'apps/mobile/components/not-alone/useNotAloneDecisionAttention.ts', 'apps/mobile/hooks/useSocket.ts',
  'apps/mobile/hooks/useMeasuredTextScale.ts', 'apps/mobile/hooks/useIntrinsicCardHeight.ts',
  'apps/mobile/store/useGameStore.ts', 'apps/mobile/components/ui/CardSurface.tsx',
  'apps/mobile/components/ui/GameCover.tsx', 'apps/mobile/components/ui/ScalePressable.tsx',
]);
function sourceHashes() {
  const root = path.resolve(__dirname, '../../..');
  return Object.fromEntries(SOURCE_FILES.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
}

function configFromEnv(env) {
  assert.equal(env.NOT_ALONE_TACTILE_FIXTURE_RUN, 'true', 'Explicit tactile fixture opt-in required');
  assert.equal(env.NOT_ALONE_UI_EXCLUSIVE_WINDOW, 'granted', 'Exclusive browser permission required');
  const scenario = env.NOT_ALONE_TACTILE_SCENARIO;
  assert(SCENARIOS.includes(scenario), 'Unknown tactile fixture scenario');
  const base = env.NOT_ALONE_WEB_URL ?? 'http://127.0.0.1:8081';
  const api = env.NOT_ALONE_API_URL ?? 'http://127.0.0.1:3213';
  local(base); local(api);
  assert(/^[a-f0-9]{64}$/.test(env.QA_EXPECTED_WEB_SHA256 ?? ''), 'Frozen bundle SHA256 required');
  assert(/^[A-Za-z0-9+/]{43}=$/.test(env.QA_BROWSER_CERT_SPKI ?? ''), 'Current local proxy SPKI required');
  assert(env.QA_STATIC_ROOT && path.isAbsolute(env.QA_STATIC_ROOT), 'Absolute frozen export path required');
  assert(env.NOT_ALONE_TACTILE_OUTPUT_DIR && path.isAbsolute(env.NOT_ALONE_TACTILE_OUTPUT_DIR), 'Absolute fresh output path required');
  return { scenario, base, api, count: scenario === 'seven-final' ? 7 : 3, output: env.NOT_ALONE_TACTILE_OUTPUT_DIR,
    staticRoot: env.QA_STATIC_ROOT, hash: env.QA_EXPECTED_WEB_SHA256, spki: env.QA_BROWSER_CERT_SPKI,
    browserPath: env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' };
}

function validateService(health, config) {
  assert.equal(health?.status, 'ok');
  assert.equal(health.service, 'not-alone-ui-fixture', 'Ordinary servers must never run fixture evidence');
  assert.equal(health.scenario, config.scenario, 'Fixture service scenario differs from requested case');
  assert.equal(health.expectedSeats, config.count, 'Fixture service seat contract differs');
}

function postOptions(body, token) {
  return { method: 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(10000) };
}

async function post(api, route, body, token) {
  local(api);
  return fetch(api + route, postOptions(body, token));
}

function assertPair(seat) {
  assert(ownPair(seat), 'Fixture must render the authenticated owner pair');
  assert.equal(seat.latestPublic.gameId, 'not_alone');
  assert.equal(seat.latestPrivate.gameId, 'not_alone');
}

function assertAnonymousPending(state, expectedSubmitted) {
  assert.equal(state.pendingCardChoice?.kind, 'forbidden_zone');
  assert.equal(state.pendingCardChoice.playerId, null);
  assert.equal(state.pendingCardChoice.submittedCount, expectedSubmitted);
  assert.equal(state.pendingCardChoice.eligibleCount, 2);
  assert.deepEqual(Object.keys(state.pendingCardChoice).sort(), ['kind', 'playerId', 'count', 'submittedCount', 'eligibleCount'].sort());
  assert(!JSON.stringify(state).includes('sealedChoices'));
  assert(!JSON.stringify(state).includes('selectedPlaces'));
}

function assertHiddenTrails(creature, hunted) {
  const rows = creature.players.filter(p => p.role === 'hunted');
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.discardCount, 1); assert.deepEqual(row.discard, []);
    assert.deepEqual(hunted.players.find(p => p.playerId === row.playerId).discard, [3]);
  }
}

function completionStatus(evidence, count) {
  const browserExits = evidence.cleanup.filter(r => r.mode === 'browser-ui' && r.normalUI && r.status === 200 && r.authCleared);
  const socketExits = evidence.cleanup.filter(r => r.mode === 'socket-owner-rest' && r.status === 200);
  const cleanupComplete = evidence.browserClosed && browserExits.length === 2 && socketExits.length === count - 2
    && !evidence.cleanup.some(r => r.fallback || r.error || r.uiError || r.contextError);
  return { cleanupComplete: Boolean(cleanupComplete), passed: Boolean(cleanupComplete && evidence.scenarioComplete && !evidence.failure
    && !evidence.watchdogExpired && evidence.findings.length === 0 && evidence.blockedRequests.length === 0
    && evidence.socketIssues.length === 0 && evidence.consoleIssues.length === 0) };
}

async function recordBrowserResponse(response, seat, qa) {
  try {
    const url = new URL(response.url());
    if (!qa.origins.has(url.origin) || response.request().method() !== 'POST') return;
    if (['/rooms/create', '/rooms/join'].includes(url.pathname) && response.ok()) {
      const result = await response.json(), auth = result.auth ?? result;
      if (auth.token) { seat.auth = auth; qa.secrets.add(auth.token); }
    }
    if (/^\/rooms\/[^/]+\/leave$/.test(url.pathname)) {
      qa.evidence.cleanup.push({ actor: seat.name, mode: 'browser-ui', normalUI: !seat.fallbackCleanup, status: response.status(), authCleared: false }); qa.persist();
    }
  } catch (error) {
    qa.evidence.socketIssues.push({ actor: seat.name, event: 'response-observer', message: redact(error.message, [...qa.secrets]) }); qa.persist();
  }
}

async function browserSeat(browser, qa, name, desktop, seats) {
  const seat = await h.openPlayer(browser, name, desktop ? 1280 : 375, desktop ? 900 : 844);
  seats.push(seat); qa.register(seat);
  await seat.page.setViewport({ width: desktop ? 1280 : 375, height: desktop ? 900 : 844, deviceScaleFactor: 1, isMobile: !desktop, hasTouch: !desktop });
  await guardNetwork(seat.page, qa.origins, qa.evidence.blockedRequests);
  seat.page.on('response', response => recordBrowserResponse(response, seat, qa));
  return seat;
}

async function rememberAuth(seat, qa) {
  seat.auth = await seat.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null'));
  assert(seat.auth?.token && seat.auth.playerId && seat.auth.roomCode, 'Owned room authentication required');
  qa.secrets.add(seat.auth.token);
}

async function socketSeat(api, name, roomCode, qa, seats) {
  const response = await post(api, '/rooms/join', { displayName: name, roomCode });
  assert.equal(response.status, 200);
  const auth = await response.json(); qa.secrets.add(auth.token);
  const seat = { name, auth, latestPublic: null, latestPrivate: null, acceptedActions: [], rejections: [], cleaning: false };
  seats.push(seat);
  seat.socket = io(api, { auth: { token: auth.token }, autoConnect: false, transports: ['websocket'], reconnection: false, timeout: 10000 });
  seat.socket.on('game_state', state => { if (state?.gameId === 'not_alone') seat.latestPublic = state; });
  seat.socket.on('private_state', state => { if (state?.gameId === 'not_alone') seat.latestPrivate = state; });
  seat.socket.on('notalone:action_accepted', ack => seat.acceptedActions.push(ack));
  seat.socket.on('action_rejected', rejection => seat.rejections.push(rejection));
  for (const event of ['connect_error', 'server_error', 'action_rejected']) seat.socket.on(event, error => {
    qa.evidence.socketIssues.push({ actor: name, event, message: error?.message ?? error?.reason ?? String(error) }); qa.persist();
  });
  seat.socket.on('disconnect', reason => { if (!seat.cleaning) { qa.evidence.socketIssues.push({ actor: name, event: 'unexpected-disconnect', reason }); qa.persist(); } });
  seat.socket.connect();
  await h.waitUntil(() => seat.socket.connected, 'owned fixture socket connection', 10000);
  return seat;
}

async function accepted(seat, action, act, qa) {
  assertPair(seat);
  const before = { revision: seat.latestPrivate.revision, accepted: seat.acceptedActions.length, rejected: seat.rejections.length };
  await act();
  await h.waitUntil(() => seat.rejections.length > before.rejected || (seat.acceptedActions.length > before.accepted && ownPair(seat)
    && seat.latestPrivate.revision === seat.acceptedActions.at(-1)?.revision), 'owned fixture action settles');
  assert.equal(seat.rejections.length, before.rejected);
  assert.equal(seat.acceptedActions.length - before.accepted, 1);
  const ack = seat.acceptedActions.at(-1);
  assert.equal(ack.action, action); assert(ack.revision > before.revision);
  qa.evidence.commands.push({ actor: seat.name, action, before: before.revision, revision: ack.revision }); qa.persist();
}

async function socketAction(seat, event, action, payload, qa) {
  await accepted(seat, action, () => seat.socket.emit(event, { ...payload, expectedRevision: seat.latestPrivate.revision }), qa);
}

async function reloadOwned(seat, qa, predicate) {
  const before = { public: seat.publicFrames, private: seat.privateFrames, revision: seat.latestPrivate.revision };
  seat.latestPublic = null; seat.latestPrivate = null;
  await seat.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await h.waitForPath(seat.page, '/not-alone/game');
  await h.waitUntil(() => seat.publicFrames > before.public && seat.privateFrames > before.private && ownPair(seat) && predicate(seat), 'fresh owned fixture pair after reload');
  assert.equal(seat.latestPrivate.revision, before.revision);
  await qa.ready(seat.page);
  qa.evidence.reloads.push({ actor: seat.name, revision: before.revision, freshPublic: seat.publicFrames - before.public, freshPrivate: seat.privateFrames - before.private }); qa.persist();
}

async function frameLabel(page, label, scope = '#not-alone-decision-area') {
  await page.evaluate(({ label, scope }) => {
    document.querySelectorAll('[data-not-alone-fixture-frame]').forEach(n => n.removeAttribute('data-not-alone-fixture-frame'));
    const root = document.querySelector(scope);
    const node = root && [...root.querySelectorAll('[aria-label]')].find(n => n.getAttribute('aria-label') === label);
    if (!node) throw Error('Fixture frame control is missing');
    node.setAttribute('data-not-alone-fixture-frame', 'true');
  }, { label, scope });
  return '[data-not-alone-fixture-frame]';
}

function measureFrame(selector) {
  const node = document.querySelector(selector);
  if (!node) throw Error('Framed fixture element is missing');
  const rect = n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, width: r.width }; };
  const bounds = rect(node), visible = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
  for (let p = node.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p), b = rect(p);
    if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) { visible.left = Math.max(visible.left, b.left); visible.right = Math.min(visible.right, b.right); }
    if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) { visible.top = Math.max(visible.top, b.top); visible.bottom = Math.min(visible.bottom, b.bottom); }
  }
  const texts = [], walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.textContent.trim()) texts.push(window.__coupQATextGeometry(walker.currentNode));
  return { text: node.textContent, bounds, visible, texts };
}

function assertFullFrames(frames, expectedText) {
  assert(frames.length >= 2, 'Top and bottom capture proof required');
  for (const frame of frames) {
    if (expectedText !== undefined) assert.equal(frame.text, expectedText, 'Full unbroken name must survive rendering');
    for (const text of frame.texts) for (const glyph of text.glyphRects) {
      assert(glyph.left >= frame.bounds.left - 2 && glyph.right <= frame.bounds.right + 2
        && glyph.top >= frame.bounds.top - 2 && glyph.bottom <= frame.bounds.bottom + 2, 'Framed content escapes its own bounds');
    }
  }
  assertWholeCard(frames.map(frame => ({ cards: [{ id: 1, ...frame }] })), 1);
}

function measureMapCards(nodes) {
  const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  return nodes.map(node => {
    const surface = node.firstElementChild, edge = surface?.children[0], face = surface?.children[1];
    if (!surface || surface.children.length !== 2 || !edge || !face || getComputedStyle(edge).position !== 'absolute' || getComputedStyle(face).overflow !== 'hidden') throw Error('Actual map CardSurface face missing');
    return { id: Number(node.getAttribute('data-testid').replace('not-alone-place-card-', '')), wrapper: rect(node), face: rect(face), text: node.textContent };
  });
}

function assertMapCardSizes(cards) {
  assert.deepEqual(cards.map(card => card.id).sort((a, b) => a - b), Array.from({ length: 10 }, (_, index) => index + 1), 'All ten public Place cards required');
  for (const card of cards) {
    assert(Object.values(card.face).every(Number.isFinite) && card.face.width > 0 && card.face.height > 0, 'Invalid map face');
    assert(Math.abs(card.face.width - cards[0].face.width) <= 2, 'Map painted widths differ');
    assert(card.face.width <= card.wrapper.width + 2, 'Map face exceeds its wrapper');
    for (const other of cards) if (Math.abs(card.face.top - other.face.top) <= 2) assert(Math.abs(card.face.height - other.face.height) <= 2, 'Same-row map painted heights differ');
  }
  return cards;
}

function assertStableMapCards({ before, after }) {
  assertMapCardSizes(before); assertMapCardSizes(after);
  assert.deepEqual(before.map(card => card.id), after.map(card => card.id), 'Map inventory changed during capture');
  before.forEach((card, index) => {
    for (const part of ['wrapper', 'face']) for (const axis of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
      assert(Math.abs(card[part][axis] - after[index][part][axis]) <= 0.5, 'Map geometry changed during capture');
    }
  });
}

async function captureState(seat, qa, label, frame = '#not-alone-decision-area', edge320 = false, complete = false, expectedText, collection) {
  const original = seat.page.viewport();
  try {
    const profiles = [original, ...(edge320 ? [{ ...original, width: 320 }] : [])];
    assert(!edge320 || original.hasTouch, '320 edge capture must preserve a touch context');
    for (const viewport of profiles) {
      if (viewport.width !== seat.page.viewport().width) await seat.page.setViewport(viewport);
      for (const scale of [false, true]) {
        const frames = [];
        for (const align of ['start', 'end']) {
          assert(qa.evidence.attempts.length < CAPTURE_LIMIT, 'Supplemental capture budget exceeded');
          await qa.ready(seat.page);
          const baseline = scale ? await enlarge(seat.page) : null, start = qa.evidence.attempts.length;
          try {
            const capture = await qa.capture(seat.page, `${label}-${viewport.width}-${scale ? 'text200' : 'normal'}-${align}.png`, { frame, align, collection });
            stampExternalScale(qa.evidence, start, scale, baseline);
            capture.framedElement = await seat.page.evaluate(measureFrame, frame); frames.push(capture.framedElement); qa.persist();
            if (scale) validateFonts(capture.metrics.fonts);
          } finally { stampExternalScale(qa.evidence, start, scale, baseline); qa.persist(); if (scale) await restore(seat.page); }
        }
        if (complete) assertFullFrames(frames, expectedText);
      }
    }
  } finally { if (seat.page.viewport().width !== original.width) await seat.page.setViewport(original); }
}

async function noDecisionControls(seat, pattern) {
  const labels = await seat.page.$$eval('#not-alone-decision-area [role="button"]', nodes => nodes.map(n => n.getAttribute('aria-label')));
  assert(!labels.some(label => pattern.test(label ?? '')), 'Nonowner received private decision controls');
  return labels;
}

async function fixtureReady(scenario, host, owner) {
  await h.waitUntil(() => {
    if (!ownPair(host) || !ownPair(owner)) return false;
    const p = owner.latestPrivate, g = host.latestPublic;
    if (scenario === 'shelter-choice') return p.canChooseSurvivalCard && p.survivalChoiceCards.length === 2;
    if (scenario === 'card-affordances') return p.playableSurvivalCardIds.includes('sacrifice') && host.latestPrivate.playableHuntCardIds.includes('flashback');
    if (scenario === 'sacrifice-rebase') return g.phase === 'exploration_reaction' && p.playableSurvivalCardIds.includes('sacrifice');
    if (scenario === 'map-status') return g.phase === 'creature_planning' && g.selectionBlockedPlaces.length === 2 && g.disabledPlaces.length === 2;
    if (scenario === 'hidden-trails') return g.roundNumber === 2 && g.players.filter(p => p.role === 'hunted').every(p => p.discardCount === 1 && !p.discard.length);
    if (scenario === 'sealed-choice') return p.cardChoice?.kind === 'forbidden_zone' && g.pendingCardChoice?.eligibleCount === 2;
    return g.phase === 'end_of_turn' && g.players.length === 7 && host.latestPrivate.canEndTurn;
  }, 'authoritative configured fixture projection');
}

async function runScenario(config, qa, host, owner, sockets) {
  const scenario = config.scenario;
  if (scenario === 'shelter-choice') {
    const assertShelter = async () => {
      assert(owner.latestPrivate.canChooseSurvivalCard);
      await noDecisionControls(owner, /^(USE PLACE POWER|RECOVER ONE PLACE|RESOLVE INTERCEPTION|CONFIRM RESOLUTION|CONTINUE RECKONING)$/);
      assert.deepEqual(host.latestPrivate.survivalChoiceCards, []);
      await noDecisionControls(host, /^KEEP /);
    };
    await assertShelter();
    await captureState(owner, qa, 'shelter-owned'); await captureState(host, qa, 'shelter-observer');
    await reloadOwned(owner, qa, seat => seat.latestPrivate.canChooseSurvivalCard);
    await assertShelter(); await captureState(owner, qa, 'shelter-reloaded');
    const cardId = owner.latestPrivate.survivalChoiceCards[0], label = 'KEEP ' + title(cardId).toUpperCase();
    const sent = owner.sentActions.length, acknowledgements = owner.acceptedActions.length;
    await accepted(owner, 'survival_choice', async () => {
      const target = await frameLabel(owner.page, label);
      await owner.page.$eval(target, n => { n.click(); n.click(); });
    }, qa);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(owner.sentActions.length - sent, 1);
    assert.equal(owner.acceptedActions.length - acknowledgements, 1);
    assert.equal(owner.sentActions.at(-1), 'notalone:survival-choice');
    assert(!owner.latestPrivate.canChooseSurvivalCard && owner.latestPrivate.survivalHand.includes(cardId));
    qa.evidence.proofs.push({ kind: 'shelter-reload-double-submit', commands: 1, acknowledgements: 1, activation: 'Two synchronous rendered DOM click activations, not physical double-tap evidence' });
  } else if (scenario === 'card-affordances') {
    for (const [seat, cards] of [[owner, ['sacrifice', 'smokescreen']], [host, ['despair', 'anticipation', 'flashback']]]) {
      for (const card of cards) {
        // The card wrapper is unique to this viewer's private hand.
        const selector = `[data-testid="not-alone-card-chip-${card}"]`;
        await seat.page.waitForSelector(selector);
        const affordance = await seat.page.$eval(selector, n => {
          const b = n.querySelector('[role="button"]');
          return { label: b?.getAttribute('aria-label'), disabled: b?.getAttribute('aria-disabled'), text: n.textContent };
        });
        const expected = card === 'anticipation' ? 'NOT AVAILABLE NOW' : ['sacrifice', 'flashback'].includes(card) ? 'CHOOSE OPTIONS' : 'PLAY CARD NOW';
        assert(affordance.text.includes(expected)); assert.equal(affordance.disabled === 'true', card === 'anticipation');
        qa.evidence.proofs.push({ kind: 'card-affordance', actor: seat.name, card, ...affordance });
        await captureState(seat, qa, 'affordance-' + card, selector, false, true);
      }
    }
    const revision = owner.latestPublic.revision;
    await h.clickButton(owner.page, /^Sacrifice · P1/);
    await h.waitForText(owner.page, 'CONFIRM SACRIFICE');
    assert.equal(owner.latestPublic.revision, revision);
    await captureState(owner, qa, 'sacrifice-configure'); await h.clickButton(owner.page, /^CANCEL$/);
    assert.equal(owner.latestPublic.revision, revision);
    await accepted(owner, 'survival', () => h.clickButton(owner.page, /^Smokescreen · P1/), qa);
  } else if (scenario === 'sacrifice-rebase') {
    await h.clickButton(owner.page, /^Sacrifice · P1/); await h.clickButton(owner.page, /^Place 1,/);
    const label = (await h.enabledLabels(owner.page)).find(label => /^Place 1,/.test(label));
    const frame = await frameLabel(owner.page, label);
    await owner.page.$eval(frame, n => n.focus());
    const snapshot = () => owner.page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label'), pressed: document.activeElement?.getAttribute('aria-pressed'), scroll: [...document.querySelectorAll('*')].filter(n => n.scrollHeight > n.clientHeight + 20).map(n => n.scrollTop) }));
    const before = await snapshot(); assert.equal(before.pressed, 'true');
    await captureState(owner, qa, 'rebase-selected', frame);
    await owner.page.$eval(frame, n => n.focus()); const focused = await snapshot();
    await socketAction(sockets[0], 'notalone:pass', 'pass', {}, qa);
    await h.waitUntil(() => owner.latestPublic.revision === sockets[0].latestPublic.revision && ownPair(owner), 'remote pass rebases own form');
    await qa.ready(owner.page);
    const after = await snapshot(); assert.deepEqual(after, focused);
    await captureState(owner, qa, 'rebase-after-pass', frame); await captureState(host, qa, 'rebase-creature');
    const stale = await owner.page.$('#not-alone-decision-area [aria-label="CONFIRM SACRIFICE"]'); assert(stale);
    const sent = owner.sentActions.length;
    await accepted(host, 'hunt_card', () => h.clickButton(host.page, /^Despair · P1/), qa);
    await h.waitUntil(() => owner.latestPublic.phase === 'hunted_planning' && ownPair(owner), 'Despair invalidates old form');
    await noDecisionControls(owner, /^CONFIRM SACRIFICE$/);
    await stale.evaluate(n => n.click()); await stale.dispose();
    assert.equal(owner.sentActions.length, sent);
    qa.evidence.proofs.push({ kind: 'sacrifice-rebase', before, after, staleCommands: 0 });
    await captureState(owner, qa, 'rebase-invalidated');
  } else if (scenario === 'map-status') {
    assert.deepEqual(host.latestPublic.selectionBlockedPlaces, [1, 2]); assert.deepEqual(host.latestPublic.disabledPlaces, [4, 8]);
    assert.equal(host.latestPrivate.maxHuntCards, 2);
    for (const seat of [owner, host]) {
      for (const id of [1, 2, 4, 8]) {
        const selector = `#not-alone-public-table [data-testid="not-alone-place-card-${id}"]`;
        const label = await seat.page.$eval(selector, n => n.getAttribute('aria-label'));
        assert(label.includes(id < 3 ? 'Inaccessible this turn.' : 'Place power ineffective this turn.'));
        assert(!label.includes(id < 3 ? 'Place power ineffective this turn.' : 'Inaccessible this turn.'));
        await captureState(seat, qa, 'map-place-' + id, selector, false, true, undefined, {
          read: page => page.$$eval('#not-alone-public-table [data-testid^="not-alone-place-card-"]', measureMapCards),
          validate: assertStableMapCards,
        });
      }
    }
    qa.evidence.proofs.push({ kind: 'blocked-vs-ineffective', blocked: [1, 2], ineffective: [4, 8] });
  } else if (scenario === 'hidden-trails') {
    assertHiddenTrails(host.latestPublic, owner.latestPublic);
    for (const seat of [owner, host]) for (const row of seat.latestPublic.players.filter(p => p.role === 'hunted')) {
      const selector = '#not-alone-trail-' + row.playerId;
      const text = await seat.page.$eval(selector, n => n.textContent);
      assert(seat === host ? text === 'Hidden by Smokescreen this round.' : text.includes('#3'));
      qa.evidence.proofs.push({ kind: 'trail-privacy', viewer: seat.name, subject: row.playerId, text });
      await captureState(seat, qa, 'trail-' + row.playerId, selector);
    }
  } else if (scenario === 'sealed-choice') {
    assertAnonymousPending(host.latestPublic, 0); assertAnonymousPending(owner.latestPublic, 0);
    assert.equal(host.latestPrivate.cardChoice, null);
    await noDecisionControls(host, /^(SEAL PRIVATE DISCARD|Place \d+,)/);
    await captureState(owner, qa, 'sealed-unsubmitted'); await captureState(host, qa, 'sealed-observer-before');
    const choice = 2;
    assert(owner.latestPrivate.cardChoice.placeOptions.includes(choice));
    await h.clickButton(owner.page, new RegExp('^Place ' + choice + ','));
    await accepted(owner, 'card_choice', () => h.clickButton(owner.page, /^SEAL PRIVATE DISCARD$/), qa);
    await h.waitUntil(() => host.latestPublic.revision === owner.latestPublic.revision && ownPair(host), 'observer anonymous progress');
    assertAnonymousPending(host.latestPublic, 1); assert(owner.latestPrivate.cardChoiceSubmitted);
    assert(owner.latestPrivate.placeHand.includes(choice), 'Sealed choice must not be discarded before all submissions');
    await reloadOwned(owner, qa, s => s.latestPrivate.cardChoiceSubmitted);
    await noDecisionControls(owner, /^(SEAL PRIVATE DISCARD|Place \d+,)/);
    await captureState(owner, qa, 'sealed-owner-reloaded'); await captureState(host, qa, 'sealed-observer-after');
    qa.evidence.proofs.push({ kind: 'sealed-choice-anonymity', submittedCount: 1, eligibleCount: 2, ownerReloaded: true });
    assert(sockets[0].latestPrivate.cardChoice.placeOptions.includes(3));
    await socketAction(sockets[0], 'notalone:card-choice', 'card_choice', { placeIds: [3] }, qa);
    await h.waitUntil(() => ownPair(owner) && ownPair(host) && host.latestPublic.pendingCardChoice === null
      && owner.latestPublic.revision === sockets[0].latestPublic.revision, 'all sealed choices resolve legally');
    assert(!owner.latestPrivate.placeHand.includes(choice));
    qa.evidence.proofs.push({ kind: 'sealed-choice-completed', commands: 2, allSubmittedBeforeDiscard: true });
  } else if (scenario === 'seven-final') {
    assert.equal(host.latestPublic.rescueProgress, 17); assert.equal(host.latestPublic.rescueGoal, 18);
    assert(host.latestPublic.players.every(p => !p.forfeited)); assert(host.latestPrivate.canEndTurn);
    await captureState(owner, qa, 'seven-pending-owner'); await captureState(host, qa, 'seven-pending-creature');
    await accepted(host, 'end_turn', () => h.clickButton(host.page, /^FINISH ROUND$/), qa);
    await h.waitUntil(() => owner.latestPublic.status === 'game_over' && ownPair(owner), 'owner receives legal terminal');
    for (const seat of [owner, host]) {
      assert.equal(seat.latestPublic.winner, 'hunted'); assert.equal(seat.latestPublic.endReason, 'track');
      assert(seat.latestPublic.players.every(p => !p.forfeited));
      await captureState(seat, qa, 'seven-results-summary', '#not-alone-result-summary', seat === owner);
      for (const index of NAMES.keys()) {
        const selector = '#not-alone-result-roster';
        await seat.page.evaluate(({ selector, name }) => {
          const n = [...document.querySelector(selector).querySelectorAll('*')].find(n => [...n.childNodes].some(c => c.nodeType === Node.TEXT_NODE && c.textContent === name));
          if (!n) throw Error('Full result name is missing');
          n.setAttribute('data-not-alone-result-name', name);
        }, { selector, name: NAMES[index] });
        await captureState(seat, qa, 'seven-result-name-' + index, `[data-not-alone-result-name="${NAMES[index]}"]`, seat === owner, true, NAMES[index]);
      }
      await captureState(seat, qa, 'seven-result-actions', '#not-alone-result-actions');
    }
    qa.evidence.terminal = { revision: host.latestPublic.revision, winner: 'hunted', endReason: 'track', players: host.latestPublic.players.map(p => ({ playerId: p.playerId, displayName: p.displayName, forfeited: p.forfeited })) };
  }
  qa.persist();
}

async function cleanupBrowser(seat, qa, api) {
  try {
    if (!seat.auth) {
      const auth = await seat.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null')).catch(() => null);
      if (auth?.token) { seat.auth = auth; qa.secrets.add(auth.token); }
    }
    if (seat.auth?.token) {
      try {
        if (await h.hasButton(seat.page, /^CANCEL$/)) await h.clickButton(seat.page, /^CANCEL$/);
        const modal = await seat.page.$('#not-alone-game-over');
        if (modal) {
          const target = await frameLabel(seat.page, 'BACK TO ARCADE', '#not-alone-game-over');
          const button = await seat.page.$(target);
          try { await button.evaluate(n => n.scrollIntoView({ block: 'center' })); if (seat.page.viewport().hasTouch) await button.tap(); else await button.click(); }
          finally { await button.dispose(); await modal.dispose(); }
        } else if (new URL(seat.page.url()).pathname.endsWith('/lobby')) await h.clickButton(seat.page, /^LEAVE ROOM$/);
        else await h.clickButton(seat.page, /^Back to arcade$/);
        await h.clickDialogButton(seat.page, 'LEAVE');
        await h.waitUntil(() => seat.page.evaluate(() => sessionStorage.getItem('za:auth') === null), 'normal fixture exit clears authentication');
        await h.waitForPath(seat.page, '/');
        for (const entry of qa.evidence.cleanup.filter(r => r.actor === seat.name && r.normalUI)) entry.authCleared = true;
      } catch (error) {
        qa.evidence.cleanup.push({ actor: seat.name, uiError: redact(error.message, [...qa.secrets]) });
        seat.fallbackCleanup = true;
        const response = await post(api, '/rooms/' + encodeURIComponent(seat.auth.roomCode) + '/leave', undefined, seat.auth.token);
        qa.evidence.cleanup.push({ actor: seat.name, mode: 'browser-fallback', normalUI: false, fallback: true, status: response.status });
      }
    }
  } catch (error) { qa.evidence.cleanup.push({ actor: seat.name, error: redact(error.message, [...qa.secrets]) }); }
  finally {
    await seat.cdp?.detach().catch(() => undefined);
    await seat.context.close().catch(error => qa.evidence.cleanup.push({ actor: seat.name, contextError: error.message }));
    qa.persist();
  }
}

async function main() {
  const config = configFromEnv(process.env);
  assert(!fs.existsSync(config.output), 'Preserve prior evidence; choose a fresh output directory');
  fs.mkdirSync(config.output, { recursive: true });
  const qa = createEvidence({ outputDir: config.output, base: config.base, api: config.api });
  Object.assign(qa.evidence, { method: 'Separately gated canonical fixture with two owned browser views and authenticated socket extras. Real post-setup actions, not natural gameplay, independent manual play or physical-device/native fontScale evidence.',
    scenario: config.scenario, expectedSeats: config.count, captureBudget: CAPTURE_LIMIT, commands: [], reloads: [], proofs: [], socketIssues: [], consoleIssues: [], scenarioComplete: false,
    gaps: ['Only two browser owners rendered; additional seats use ordinary authenticated sockets.', 'CSS200 and browser touch emulation do not establish physical-device or native fontScale behaviour.'] });
  let browser = null, watchdog = null; const browsers = [], sockets = [];
  const health = async () => {
    const response = await fetch(config.api, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200); const value = await response.json(); validateService(value, config); return value;
  };
  try {
    qa.evidence.sourceHashes = sourceHashes(); qa.persist();
    qa.evidence.service = await health();
    qa.evidence.bundle = await bundleFence(config.base + '/not-alone', config.staticRoot, config.hash); qa.persist();
    browser = await puppeteer.launch({ executablePath: config.browserPath, headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + config.spki] });
    watchdog = setTimeout(() => { qa.evidence.watchdogExpired = true; qa.persist(); void browser.close(); }, 15 * 60_000);
    await qa.calibrate(browser);
    const host = await browserSeat(browser, qa, NAMES[0], true, browsers);
    const owner = await browserSeat(browser, qa, NAMES[1], false, browsers);
    await host.page.goto(config.base + '/not-alone', { waitUntil: 'domcontentloaded' });
    await h.setInput(host.page, 'Your name', host.name); await h.clickButton(host.page, /^CREATE ROOM$/);
    await h.waitForPath(host.page, '/not-alone/lobby'); await rememberAuth(host, qa);
    await owner.page.goto(config.base + '/not-alone/join', { waitUntil: 'domcontentloaded' });
    await h.setInput(owner.page, 'Your name', owner.name); await h.setInput(owner.page, 'Room code', host.auth.roomCode);
    await h.clickButton(owner.page, /^JOIN GAME$/); await h.waitForPath(owner.page, '/not-alone/lobby'); await rememberAuth(owner, qa);
    for (const name of NAMES.slice(2, config.count)) await socketSeat(config.api, name, host.auth.roomCode, qa, sockets);
    await h.waitUntil(() => host.room?.players.filter(p => p.isConnected && !p.hasLeft).length === config.count, 'all owned fixture seats connected');
    await h.clickButton(host.page, /^START GAME$/);
    await Promise.all(browsers.map(s => h.waitForPath(s.page, '/not-alone/game')));
    await fixtureReady(config.scenario, host, owner);
    await h.waitUntil(() => [...browsers, ...sockets].every(ownPair), 'all fixture viewer pairs');
    [...browsers, ...sockets].forEach(assertPair);
    qa.evidence.initial = { revision: host.latestPublic.revision, phase: host.latestPublic.phase, players: host.latestPublic.players.length }; qa.persist();
    await runScenario(config, qa, host, owner, sockets);
    qa.evidence.finalBundle = await bundleFence(config.base + '/not-alone', config.staticRoot, config.hash);
    await health(); qa.evidence.scenarioComplete = true;
  } catch (error) { qa.evidence.failure = redact(error.stack ?? error.message, [...qa.secrets]); }
  finally {
    if (watchdog) clearTimeout(watchdog);
    for (const seat of browsers.slice().reverse()) await cleanupBrowser(seat, qa, config.api);
    for (const seat of sockets) {
      seat.cleaning = true;
      try {
        const response = await post(config.api, '/rooms/' + encodeURIComponent(seat.auth.roomCode) + '/leave', undefined, seat.auth.token);
        qa.evidence.cleanup.push({ actor: seat.name, mode: 'socket-owner-rest', normalUI: false, status: response.status });
      } catch (error) { qa.evidence.cleanup.push({ actor: seat.name, mode: 'socket-owner-rest', error: redact(error.message, [...qa.secrets]) }); }
      finally { seat.socket?.disconnect(); }
    }
    try { if (browser) await browser.close(); qa.evidence.browserClosed = Boolean(browser); }
    catch (error) { qa.evidence.cleanup.push({ browserError: error.message }); }
    qa.evidence.consoleIssues = h.consoleIssues;
    qa.evidence.browserRejections = browsers.flatMap(s => s.rejections.map(r => ({ actor: s.name, reason: r.reason })));
    if (qa.evidence.browserRejections.length) qa.evidence.socketIssues.push(...qa.evidence.browserRejections);
    try {
      qa.evidence.finalSourceHashes = sourceHashes(); qa.persist();
      assert.deepEqual(qa.evidence.finalSourceHashes, qa.evidence.sourceHashes, 'Source changed during fixture evidence');
    } catch (error) { qa.evidence.sourceFenceFailure = redact(error.message, [...qa.secrets]); qa.evidence.failure ??= qa.evidence.sourceFenceFailure; }
    Object.assign(qa.evidence, completionStatus(qa.evidence, config.count)); qa.persist();
  }
  console.log(JSON.stringify({ output: config.output, scenario: config.scenario, passed: qa.evidence.passed, captures: qa.evidence.captures.length, browserClosed: qa.evidence.browserClosed }));
  if (!qa.evidence.passed) process.exitCode = 1;
}

module.exports = { SCENARIOS, CAPTURE_LIMIT, NAMES, SOURCE_FILES, sourceHashes, configFromEnv, validateService, postOptions, assertPair, assertAnonymousPending, assertHiddenTrails, completionStatus, recordBrowserResponse, accepted, reloadOwned, measureFrame, assertFullFrames, measureMapCards, assertMapCardSizes, assertStableMapCards, captureState, runScenario };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
