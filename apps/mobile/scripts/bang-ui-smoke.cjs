const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-core');
const { createEvidence, persistReceipt, MATRIX, CAPTURE_LIMIT, bundleFence, guardNetwork, local, redact, publicPrivacy } = require('./bang-ui-evidence.cjs');
const { BATCHES: FIXTURE_BATCHES, LIFECYCLE_ALLOWANCE, LEGACY_ALLOWANCE, createFixtureFraming } = require('./bang-fixture-framing.cjs');
const API_URL = process.env.BANG_API_URL ?? 'http://127.0.0.1:3213';
let qa = null, ownsOutput = false;
const resize = (page, width, height = 844) => page.setViewport({ ...page.viewport(), width, height, deviceScaleFactor: 1 });
const writeReceipt = (name, value) => persistReceipt(outputDir, name, value, qa?.secrets ?? []);

const BASE_URL = process.env.BANG_WEB_URL ?? 'http://127.0.0.1:8081';
const BROWSER_PATH = process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CERT_SPKI = process.env.QA_BROWSER_CERT_SPKI?.trim();
if (CERT_SPKI && !/^[A-Za-z0-9+/]{43}=$/.test(CERT_SPKI)) throw new Error('Supply one SHA-256 certificate fingerprint.');
const BEFORE_ONLY = process.env.BANG_UI_BEFORE_ONLY === 'true';
const FIXTURES = process.env.BANG_UI_FIXTURES === 'true';
const FIXTURES_ONLY = process.env.BANG_UI_FIXTURES_ONLY === 'true';
const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const outputDir = process.env.BANG_UI_OUTPUT_DIR ?? path.resolve(__dirname, '../../../.tmp-qa-evidence/bang', runId);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const issues = [];
const screenshots = [];
const coverage = new Set();
const decisions = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const CAPTURE_PLAN = Object.freeze({ library: 8, entrance: 11, join: 1, lobby: 12, lifecycleFraming: 26, staleDialog: 1, initialGameplay: 25, gameDetails: 4, handReadability: 16, naturalPhases: 8, results: 33, rematch: 2 });
const FIXTURE_CAPTURE_BUDGET = 25;
const SOURCE_FILES = Object.freeze([
  ...['_layout.tsx', 'index.tsx', 'join.tsx', 'lobby.tsx', 'game.tsx'].map(file => 'apps/mobile/app/bang/' + file),
  ...['Card.tsx', 'CardArtwork.tsx', 'Hand.tsx', 'layout.ts', 'ReferenceSheet.tsx', 'useBangActions.ts'].map(file => 'apps/mobile/components/bang/' + file),
  ...['GameCover.tsx', 'GameTile.tsx', 'CardSurface.tsx', 'ScalePressable.tsx', 'NeonButton.tsx', 'GameRecovery.tsx', 'ArcadeDialog.tsx', 'RulesReferenceSheet.tsx', 'RouteBackButton.tsx', 'ArcadeBackButton.tsx', 'AnimatedBackground.tsx'].map(file => 'apps/mobile/components/ui/' + file),
  ...['RemainingLanding.tsx', 'RemainingJoin.tsx', 'RemainingLobby.tsx', 'RemainingArtwork.tsx'].map(file => 'apps/mobile/components/remaining/' + file),
  ...['ThemedRoster.tsx', 'RoomCodeDisplay.tsx'].map(file => 'apps/mobile/components/lobby/' + file),
  ...['MobileHeader.tsx', 'MobileDrawer.tsx', 'Sidebar.tsx', 'ZuychinLogo.tsx'].map(file => 'apps/mobile/components/navigation/' + file),
  ...['useSocket.ts', 'useWebBackGuard.ts', 'useNativeLeaveGuard.ts', 'useWebModalFocus.ts', 'useReducedMotionPreference.ts'].map(file => 'apps/mobile/hooks/' + file),
  ...['api.ts', 'storage.ts', 'dialog.ts', 'gameRoutes.ts', 'tokenUtils.ts', 'webBackGuardDispatcher.ts'].map(file => 'apps/mobile/lib/' + file),
  ...['bang-ui-evidence.cjs', 'bang-ui-smoke.cjs', 'bang-ui-evidence.test.cjs', 'bang-fixture-framing.cjs', 'bang-fixture-framing.test.cjs', 'bang-fixture-integration.test.cjs', 'bang-material.test.cjs', 'bang-hand.test.cjs', 'bang-layout.test.cjs', 'bang-client.test.cjs', 'skull-ui-evidence.cjs', 'tokyo-ui-evidence.cjs'].map(file => 'apps/mobile/scripts/' + file),
  ...['cover', 'hero', 'card-attack', 'card-response', 'card-recovery', 'card-supply', 'card-interference', 'card-equipment', 'card-weapon'].map(file => 'apps/mobile/assets/game-art/bang-' + file + '.webp'),
  'apps/mobile/app/_layout.tsx', 'apps/mobile/app/(arcade)/_layout.tsx', 'apps/mobile/app/(arcade)/index.tsx',
  'apps/mobile/constants/theme.ts', 'apps/mobile/constants/config.ts', 'apps/mobile/constants/arcadeLogo.ts', 'apps/mobile/store/useGameStore.ts',
  'apps/mobile/global.css', 'apps/mobile/metro.config.js', 'apps/mobile/package.json',
  'packages/types/src/bang.ts', 'packages/types/src/bang-constants.ts',
]);

function fixtureRunMode(env = process.env) {
  const fixtures = env.BANG_UI_FIXTURES === 'true', only = env.BANG_UI_FIXTURES_ONLY === 'true', before = env.BANG_UI_BEFORE_ONLY === 'true';
  const hasBatch = env.BANG_UI_FIXTURE_BATCH !== undefined, batch = env.BANG_UI_FIXTURE_BATCH;
  assert(!only || fixtures, 'Fixture-only mode also requires BANG_UI_FIXTURES=true');
  assert(!hasBatch || only, 'A fixture batch is supported only in fixture-only mode');
  assert(!only || !before, 'Fixture-only batches cannot be combined with baseline-only mode');
  assert(!only || Object.hasOwn(FIXTURE_BATCHES, batch ?? ''), 'Fixture-only mode requires an explicit valid BANG_UI_FIXTURE_BATCH');
  const capturePlan = only ? { lifecycle: LIFECYCLE_ALLOWANCE, legacyExtras: LEGACY_ALLOWANCE, framedFixtures: FIXTURE_BATCHES[batch].maxCaptures } : CAPTURE_PLAN;
  const upperBound = Object.values(capturePlan).reduce((sum, count) => sum + count, 0) + (fixtures && !only ? FIXTURE_CAPTURE_BUDGET : 0);
  assert(upperBound <= CAPTURE_LIMIT, 'Capture plan exceeds the hard limit');
  return { batch: only ? batch : null, capturePlan, upperBound };
}

function sourceHashes(read = file => fs.readFileSync(path.resolve(__dirname, '../../..', file))) {
  return Object.fromEntries(SOURCE_FILES.map(file => [file, crypto.createHash('sha256').update(read(file)).digest('hex')]));
}

async function verifyFrozenEvidence(recorder, exportedBuild, checks = {}) {
  recorder.evidence.finalSourceHashes = (checks.sourceHashes ?? sourceHashes)(); recorder.persist();
  assert(JSON.stringify(recorder.evidence.finalSourceHashes) === JSON.stringify(recorder.evidence.sourceHashes), 'Source or artwork changed during run');
  recorder.evidence.finalBundle = await (checks.bundleFence ?? bundleFence)(BASE_URL + '/bang', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256); recorder.persist();
  assert(JSON.stringify(recorder.evidence.finalBundle) === JSON.stringify(recorder.evidence.bundle), 'Served or disk bundle changed during run');
  assert(JSON.stringify((checks.bundleEvidence ?? bundleEvidence)()) === JSON.stringify(exportedBuild), 'Bundle changed during run');
  recorder.evidence.freezeVerified = true; recorder.persist();
}

function completionStatus(evidence, actorNames) {
  const cleanupComplete = actorNames.length === 4 && evidence.browserClosed && actorNames.every(name =>
    evidence.cleanup.some(record => record.actor === name && record.normalUI && record.status === 200 && record.authCleared)
    && evidence.cleanup.some(record => record.actor === name && record.contextClosed === true))
    && !evidence.cleanup.some(record => record.fallback || record.error || record.contextClosed === false);
  const rolePrivacyGaps = evidence.captures.flatMap(record => record.metrics?.rolePrivacyGaps ?? []);
  return { cleanupComplete: Boolean(cleanupComplete), rolePrivacyGaps, passed: Boolean(cleanupComplete
    && evidence.freezeVerified && !evidence.failure && !evidence.watchdogExpired
    && evidence.findings.length === 0 && evidence.blockedRequests.length === 0
    && (evidence.finalIssues ?? []).length === 0 && (evidence.responseIssues ?? []).length === 0 && rolePrivacyGaps.length === 0) };
}

async function until(check, label, timeout = 45_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await delay(80);
  }
  throw new Error(`Timed out: ${label}`);
}

function bundleEvidence() {
  if (!process.env.QA_STATIC_ROOT) return null;
  const root = path.resolve(process.env.QA_STATIC_ROOT);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const entry = html.match(/_expo\/static\/js\/web\/((?:entry|index)-[a-f0-9]+\.js)/)?.[1];
  assert(entry, 'Missing exported entry bundle');
  const source = fs.readFileSync(path.join(root, '_expo/static/js/web', entry));
  assert(source.includes('https://localhost:3214'), 'Export contains the wrong API origin');
  return { entry, sha256: crypto.createHash('sha256').update(source).digest('hex'), certificateFingerprint: CERT_SPKI };
}

function packet(data) {
  if (!data.startsWith('42')) return null;
  try { return JSON.parse(data.slice(2)); } catch { return null; }
}

async function recordBrowserResponse(response, actor, recorder, recordedIssues = issues) {
  try {
    const url = new URL(response.url());
    if (!recorder.origins.has(url.origin) || response.request().method() !== 'POST') return;
    if (['/rooms/create', '/rooms/join'].includes(url.pathname) && response.ok()) {
      const result = await response.json(), auth = result.auth ?? result;
      if (auth.token) { recorder.secrets.add(auth.token); actor.auth = auth; }
    }
    if (/^\/rooms\/[^/]+\/leave$/.test(url.pathname)) {
      recorder.evidence.cleanup.push({ actor: actor.name, status: response.status(), normalUI: !actor.fallbackCleanup }); recorder.persist();
    }
  } catch (error) {
    recordedIssues.push({ player: actor.name, type: 'response-observer', text: redact(error.message, [...recorder.secrets]) });
    recorder.evidence.responseIssues = recordedIssues.filter(issue => issue.type === 'response-observer'); recorder.persist();
  }
}

async function player(browser, name, width = 390) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const actor = { name, context, page, public: null, private: null, room: null, accepted: [], sent: [], rejected: [], intentionalOffline: false };
  qa.register(actor);
  await page.setViewport({ width, height: 844, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768 });
  await guardNetwork(page, qa.origins, qa.evidence.blockedRequests);
  page.on('response', response => recordBrowserResponse(response, actor, qa));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('console', (message) => {
    if (!actor.intentionalOffline && ['warning', 'error'].includes(message.type()) && !message.text().includes('[Reanimated] Reduced motion')) {
      issues.push({ player: name, type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => issues.push({ player: name, type: 'pageerror', text: error.message }));
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    const message = packet(response.payloadData);
    if (!message) return;
    if (message[0] === 'game_state' && message[1]?.gameId === 'bang') {
      actor.public = message[1];
      const leaks = publicPrivacy(actor.public);
      if (leaks.length) issues.push({ player: name, type: 'public-privacy', leaks });
    }
    if (message[0] === 'private_state' && message[1]?.gameId === 'bang') actor.private = message[1];
    if (message[0] === 'bang:action_accepted') { actor.accepted.push(message[1]); actor.lastAcceptedAt = Date.now(); }
    if (message[0] === 'action_rejected') actor.rejected.push(message[1]);
    if (message[0] === 'room_updated') actor.room = message[1];
  });
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    const message = packet(response.payloadData);
    if (message?.[0]?.startsWith('bang:')) actor.sent.push(message);
  });
  await page.goto(`${BASE_URL}/bang`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  actor.cdp = cdp;
  await until(() => page.$('input[aria-label="Your name"]'), `${name} landing`);
  return actor;
}

async function input(page, label, value) {
  const field = await page.$(`input[aria-label="${label}"]`);
  assert(field, `Missing input ${label}`);
  await field.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (value) await page.keyboard.type(value);
  await field.dispose();
}

async function button(page, label) {
  const controls = await page.$$('[role="button"],button');
  for (const control of controls) {
    if (await control.evaluate((element, expected) => {
      const bounds = element.getBoundingClientRect();
      return (element.getAttribute('aria-label') ?? element.textContent)?.trim() === expected
        && bounds.width > 0 && bounds.height > 0 && !element.closest('[aria-hidden="true"]') && getComputedStyle(element).visibility === 'visible' && !element.hasAttribute('disabled')
        && element.getAttribute('aria-disabled') !== 'true';
    }, label)) return control;
    await control.dispose();
  }
  return null;
}

async function click(page, label, duplicate = false) {
  await until(async () => { const found = await button(page, label); await found?.dispose(); return !!found; }, label);
  const control = await button(page, label);
  await control.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const bounds = await control.boundingBox();
  assert(bounds && bounds.width >= 48 && bounds.height >= 48, 'Activated control is below 48px: ' + label);
  if (duplicate) await control.evaluate((element) => { element.click(); element.click(); });
  else if (page.viewport()?.hasTouch) await control.tap(); else await control.click();
  await control.dispose();
  await delay(120);
}

async function capture(actor, name, width) {
  await resize(actor.page, width);
  await actor.page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll('*')) if (element.scrollHeight > element.clientHeight + 20) element.scrollTop = 0;
  });
  const filename = name + '-' + width + '.png';
  await qa.capture(actor.page, filename, { allowTransient: /reserved|stale-lobby-dialog/.test(name) });
  screenshots.push(filename);
}

async function captureMatrix(actor, name, frame = null) {
  if (coverage.has('matrix:' + name)) return;
  const original = actor.page.viewport();
  try {
    for (const [width, height] of MATRIX) {
      await resize(actor.page, width, height);
      await qa.capture(actor.page, name + '-' + width + 'x' + height + '.png', { frame });
    }
    for (const width of [375, 1280]) {
      await resize(actor.page, width);
      await qa.capture(actor.page, name + '-' + width + '-text200.png', { frame, scale: true });
    }
    coverage.add('matrix:' + name);
  } finally { await actor.page.setViewport(original); }
}

function assertFrameCoverage(records) {
  assert(records.length > 0, 'Framed evidence is missing');
  const intervals = records.map(({ metrics }) => {
    const frame = metrics.frame;
    const visible = metrics.frameVisibleBounds ?? { left: 0, right: metrics.width, top: 0, bottom: metrics.height };
    assert(frame && frame.width > 0 && frame.height > 0, 'Captured frame must be mounted');
    assert(frame.left >= visible.left - 2 && frame.right <= visible.right + 2, 'Captured frame escapes viewport width or its clipping container');
    return { start: Math.max(0, visible.top - frame.top), end: Math.min(frame.height, visible.bottom - frame.top), height: frame.height };
  }).sort((a, b) => a.start - b.start);
  const height = intervals[0].height;
  let reached = 0;
  for (const interval of intervals) {
    assert(Math.abs(interval.height - height) <= 2, 'Framed content changed height between screenshots');
    assert(interval.start <= reached + 2 && interval.end > interval.start, 'Framed screenshots leave unreadable content between viewports');
    reached = Math.max(reached, interval.end);
  }
  assert(reached >= height - 2, 'Framed screenshots miss the end of the content');
}

async function captureFrameEdges(actor, name, frame, recorder = qa, prepare = null, scales = [false, true]) {
  for (const scale of scales) {
    const records = [];
    for (const align of ['start', 'end']) records.push(await recorder.capture(actor.page, `${name}-${scale ? 'text200' : 'text100'}-${align}.png`, { frame, align, scale, ...(prepare && align === 'start' ? { prepare: () => prepare(scale) } : {}) }));
    assertFrameCoverage(records);
  }
}

function markLifecycleFrame({ label, form }) {
  const rendered = node => {
    const box = node.getBoundingClientRect();
    if (!node.isConnected || box.width <= 0 || box.height <= 0 || node.closest('[aria-hidden="true"],[hidden],[inert]')) return false;
    for (let owner = node; owner; owner = owner.parentElement) {
      const css = getComputedStyle(owner);
      if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) return false;
    }
    return true;
  };
  const matches = [...document.querySelectorAll('[role="button"],button')]
    .filter(node => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === label && rendered(node));
  if (matches.length !== 1) throw new Error(`Expected one rendered lifecycle control ${label}, found ${matches.length}`);
  let node = matches[0];
  if (form) while (node && !node.querySelector('input[aria-label="Your name"]')) node = node.parentElement;
  if (!node || node === document.body || !rendered(node)) throw new Error('Missing bounded lifecycle form');
  node.setAttribute('data-bang-qa-lifecycle', 'frame');
}

async function captureLifecycleFrame(actor, name, label, form = false, recorder = qa, width = 375) {
  const original = actor.page.viewport();
  try {
    assert([375, 1280].includes(width) && Boolean(actor.page.viewport().hasTouch) === (width === 375), 'Lifecycle input context must match its requested viewport');
    await resize(actor.page, width);
    await actor.page.evaluate(markLifecycleFrame, { label, form });
    await captureFrameEdges(actor, name + '-' + width, '[data-bang-qa-lifecycle="frame"]', recorder, null, form ? [false, true] : [true]);
  } finally {
    await actor.page.evaluate(() => document.querySelector('[data-bang-qa-lifecycle]')?.removeAttribute('data-bang-qa-lifecycle'));
    await actor.page.setViewport(original);
  }
}

function handBrowseState() {
  const rail = document.querySelector('[data-testid="bang-hand-rail"]');
  if (!rail) throw new Error('Narrow hand rail is required');
  const box = rail.getBoundingClientRect();
  const cards = [...rail.querySelectorAll('[id^="bang-card-hand-"]')].map(node => {
    const rect = node.getBoundingClientRect(), control = node.querySelector('[role="button"],button');
    return { id: node.id, visible: rect.left >= box.left - 2 && rect.right <= box.right + 2,
      selected: control?.getAttribute('aria-selected'), label: control?.getAttribute('aria-label'),
      enabled: Boolean(control && !control.hasAttribute('disabled') && control.getAttribute('aria-disabled') !== 'true' && control.tabIndex >= 0), focused: control === document.activeElement };
  });
  return { cards, left: rail.scrollLeft, maximum: rail.scrollWidth - rail.clientWidth, position: document.querySelector('[data-testid="bang-hand-position"]')?.textContent };
}

function assertBrowseUnchanged(actor, before, current) {
  assert(actor.public.revision === before.revision && actor.private.revision === before.revision, 'Hand browsing changed game revision');
  assert(actor.sent.length === before.sent && actor.accepted.length === before.accepted, 'Hand browsing emitted or accepted a command');
  assert(JSON.stringify(current.cards.map(({ id, selected, label }) => ({ id, selected, label }))) === before.selection, 'Hand browsing changed card selection or action labels');
}

async function proveHandBrowsing(actor, scale, recorder = qa) {
  const initial = await actor.page.evaluate(handBrowseState);
  const before = { revision: actor.public.revision, sent: actor.sent.length, accepted: actor.accepted.length,
    selection: JSON.stringify(initial.cards.map(({ id, selected, label }) => ({ id, selected, label }))) };
  const expected = actor.private.hand.map(card => 'bang-card-hand-' + card.id);
  assert(expected.length > 2 && expected.length <= 30, 'Browse proof needs a bounded real hand');
  assert(JSON.stringify(initial.cards.map(card => card.id)) === JSON.stringify(expected), 'Rail cards differ from this actor own hand');
  const seen = new Set(), steps = [];
  for (const direction of ['Previous hand card', 'Next hand card']) {
    for (let step = 0; step <= expected.length + 1; step++) {
      const state = await actor.page.evaluate(handBrowseState);
      assertBrowseUnchanged(actor, before, state);
      state.cards.filter(card => card.visible).forEach(card => seen.add(card.id));
      const control = await button(actor.page, direction);
      if (!control) break;
      await control.dispose();
      assert(step < expected.length + 1, 'Hand browsing failed to reach its endpoint');
      await click(actor.page, direction);
      const after = await actor.page.evaluate(handBrowseState);
      assert(Math.abs(after.left - state.left) > 1, 'Browse button did not move the hand');
      steps.push({ direction, left: after.left, position: after.position });
    }
  }
  assert(expected.every(id => seen.has(id)), 'Browse controls did not reveal every actual hand card');
  const enabled = initial.cards.filter(card => card.enabled).map(card => card.id);
  assert(enabled.length >= 2, 'Keyboard hand proof requires two naturally enabled cards');
  await actor.page.focus(`[id="${enabled[0]}"] [role="button"]`);
  const focused = [];
  for (const id of enabled) {
    if (focused.length) await actor.page.keyboard.press('Tab');
    await until(async () => { const state = await actor.page.evaluate(handBrowseState); return state.cards.some(card => card.id === id && card.focused && card.visible); }, 'Tab reveals enabled hand card ' + id, 3000);
    assertBrowseUnchanged(actor, before, await actor.page.evaluate(handBrowseState)); focused.push(id);
  }
  for (let step = 0; step <= expected.length + 1; step++) {
    const control = await button(actor.page, 'Previous hand card');
    if (!control) break;
    await control.dispose(); assert(step < expected.length + 1, 'Hand reset failed'); await click(actor.page, 'Previous hand card');
  }
  assertBrowseUnchanged(actor, before, await actor.page.evaluate(handBrowseState));
  recorder.evidence.handBrowsing ??= [];
  recorder.evidence.handBrowsing.push({ actor: actor.name, revision: before.revision, width: actor.page.viewport().width, scale: scale ? 200 : 100, cards: expected, revealed: [...seen], focused, steps, commandsEmitted: 0, selectionUnchanged: true, disabledFocusClaim: false }); recorder.persist();
}

async function captureHandReadability(actor, recorder = qa) {
  const original = actor.page.viewport();
  try {
    assert(actor.page.viewport().hasTouch, 'Phone hand proof needs a real touch context');
    for (const width of [320, 375]) {
      await resize(actor.page, width);
      for (const [index, card] of [actor.private.hand[0], actor.private.hand.at(-1)].entries()) {
        await captureFrameEdges(actor, `hand-${width}-${index ? 'last' : 'first'}`, `[id="bang-card-hand-${card.id}"]`, recorder,
          index === 0 ? scale => proveHandBrowsing(actor, scale, recorder) : null);
      }
    }
    coverage.add('responsive:full_card_readability_at320_text200');
    coverage.add('hand:all_cards_browse_without_command_and_tab_reveal');
  } finally { await actor.page.setViewport(original); }
}

async function captureLibraryEntry(actor, width, recorder = qa) {
  const original = actor.page.viewport();
  try {
    await resize(actor.page, width);
    assert(Boolean(actor.page.viewport().hasTouch) === (width === 375), 'Library input context must match its viewport');
    await actor.page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await until(() => actor.page.$('#game-tile-bang'), 'BANG library tile');
    await captureFrameEdges(actor, 'library-' + width, '#game-tile-bang', recorder);
    const tile = await actor.page.$('#game-tile-bang');
    try {
      await tile.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
      const bounds = await tile.boundingBox();
      assert(bounds && bounds.width >= 48 && bounds.height >= 48, 'Library tile must be a 48px target');
      if (actor.page.viewport().hasTouch) await tile.tap();
      else { await tile.focus(); await actor.page.keyboard.press('Enter'); }
    } finally { await tile.dispose(); }
    await until(async () => new URL(actor.page.url()).pathname === '/bang' && await actor.page.$('input[aria-label="Your name"]'), 'library opens BANG entrance');
    coverage.add('library:' + (width === 375 ? 'touch' : 'keyboard'));
  } finally { await actor.page.setViewport(original); }
}

async function captureResultDetails(actors, recorder = qa) {
  const phone = actors[0], desktop = actors.find(actor => !actor.page.viewport().hasTouch);
  assert(phone.page.viewport().hasTouch && desktop, 'Results need separate touch and fine-pointer contexts');
  for (const [actor, width] of [[phone, 375], [desktop, 1280]]) {
    const original = actor.page.viewport();
    try {
      await resize(actor.page, width);
      assert(actor.public.status === 'game_over' && actor.public.players.length === 4, 'Results must include all four seats');
      await captureFrameEdges(actor, 'results-summary-' + width, '#bang-result-summary', recorder);
      for (const [index, player] of actor.public.players.entries()) for (const scale of [false, true]) {
        const frame = `[id="bang-result-row-${player.playerId}"]`;
        const record = await recorder.capture(actor.page, `results-${width}-row-${index + 1}-${scale ? 'text200' : 'text100'}.png`, { frame, scale });
        assertFrameCoverage([record]);
      }
    } finally { await actor.page.setViewport(original); }
  }
  coverage.add('results:all_four_rows_and_actions_touch_pointer_text200');
}

async function railEnds(actor) {
  const rails = await actor.page.evaluate(() => [...document.querySelectorAll('*')]
    .filter(n => ['auto', 'scroll'].includes(getComputedStyle(n).overflowX) && n.scrollWidth > n.clientWidth + 1)
    .map((n, index) => { n.dataset.bangQaRail = String(index); return { key: String(index), left: n.scrollLeft }; }));
  try {
    for (const rail of rails.slice(0, 4)) for (const end of ['start', 'end']) {
      const selector = '[data-bang-qa-rail="' + rail.key + '"]';
      await actor.page.$eval(selector, (n, side) => { n.scrollLeft = side === 'start' ? 0 : n.scrollWidth; }, end);
      await qa.capture(actor.page, actor.name + '-rail-' + rail.key + '-' + end + '.png', { frame: selector });
    }
    if (!rails.length) qa.evidence.gaps.push(actor.name + ': no horizontal rails mounted at initial gameplay capture');
    if (rails.length > 4) qa.evidence.gaps.push('More than four rails mounted: additional endpoints not captured');
  } finally {
    await actor.page.evaluate(items => { for (const item of items) { const n = document.querySelector('[data-bang-qa-rail="' + item.key + '"]'); if (n) { n.scrollLeft = item.left; delete n.dataset.bangQaRail; } } }, rails);
    qa.persist();
  }
}

async function normalExit(actor) {
  const auth = await actor.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') || 'null'));
  if (!auth) { actor.left = true; return; }
  if (actor.page.url().endsWith('/bang/lobby')) {
    await click(actor.page, 'LEAVE ROOM'); await click(actor.page, 'LEAVE');
  } else if (actor.page.url().endsWith('/bang/game')) {
    await click(actor.page, actor.public?.status === 'game_over' ? 'BACK TO ARCADE' : 'Leave table');
    await click(actor.page, actor.public?.status === 'game_over' ? 'LEAVE TABLE' : 'FORFEIT AND LEAVE');
  } else throw new Error('Owned room is not on a normal exit surface');
  await until(() => actor.page.evaluate(() => sessionStorage.getItem('za:auth') === null), actor.name + ' normal exit clears authentication');
  actor.left = true;
  const receipt = qa.evidence.cleanup.filter(item => item.actor === actor.name && item.normalUI).at(-1);
  assert(receipt?.status === 200, 'Normal exit requires a successful leave receipt');
  receipt.authCleared = true; qa.persist();
}

async function resultFrame(actor) {
  return actor.page.evaluate(() => {
    if (document.getElementById('bang-results')) return '#bang-results';
    const heading = [...document.querySelectorAll('[role="heading"]')].find(node => /^(Final standings|No winner:)/.test(node.textContent));
    if (!heading?.parentElement) throw new Error('Inline BANG results panel is missing');
    heading.parentElement.dataset.bangQaResults = 'true';
    return '[data-bang-qa-results="true"]';
  });
}

function cardActivationTrace({ selector, mode, phase }) {
  if (mode === 'start') {
    if (window.__bangCardTrace) throw new Error('Card activation trace already active');
    const ancestors = node => {
      const result = [];
      for (let item = node; item && result.length < 8; item = item.parentElement) result.push({ id: item.id || null, testId: item.getAttribute('data-testid'), role: item.getAttribute('role') });
      return result;
    };
    const bounds = node => {
      if (!node) return null;
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    const snapshot = (name, event) => {
      const node = document.querySelector(selector), rail = document.querySelector('[data-testid="bang-hand-rail"]');
      const point = event?.changedTouches?.[0] ?? event;
      const box = bounds(node);
      const x = Number.isFinite(point?.clientX) ? point.clientX : box ? box.x + box.width / 2 : null;
      const y = Number.isFinite(point?.clientY) ? point.clientY : box ? box.y + box.height / 2 : null;
      const wrapper = node?.closest('[id^="bang-card-"]')?.parentElement;
      return { phase: name, time: performance.now(), bounds: box, wrapperOffsetLeft: wrapper?.offsetLeft ?? null,
        rail: rail ? { left: rail.scrollLeft, width: rail.clientWidth, scrollWidth: rail.scrollWidth, bounds: bounds(rail) } : null,
        point: { x, y }, hit: x === null ? [] : ancestors(document.elementFromPoint(x, y)), target: ancestors(event?.target),
        focus: ancestors(document.activeElement), selected: node?.getAttribute('aria-pressed'), disabled: node?.getAttribute('aria-disabled'),
        position: document.querySelector('[data-testid="bang-hand-position"]')?.textContent ?? null,
        selectedCards: [...document.querySelectorAll('[id^="bang-card-hand-"] [aria-pressed="true"]')].map(item => item.closest('[id^="bang-card-"]').id),
        playControls: [...document.querySelectorAll('[role="button"]')].filter(item => (item.getAttribute('aria-label') ?? '').startsWith('PLAY ') && item.getBoundingClientRect().width > 0).map(item => item.getAttribute('aria-label')).slice(0, 8) };
    };
    const state = { events: [], dropped: 0, snapshot, listener: null };
    state.listener = event => {
      if (state.events.length < 16) state.events.push(snapshot(event.type, event)); else state.dropped++;
    };
    for (const type of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'focusin', 'click']) document.addEventListener(type, state.listener, true);
    window.__bangCardTrace = state;
  }
  const state = window.__bangCardTrace;
  if (!state) throw new Error('Card activation trace is missing');
  const result = { snapshot: state.snapshot(phase), events: state.events, dropped: state.dropped };
  if (mode === 'stop') {
    for (const type of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'focusin', 'click']) document.removeEventListener(type, state.listener, true);
    delete window.__bangCardTrace;
  }
  return result;
}

async function card(actor, id, prefix = 'hand', recorder = qa) {
  const selector = `[id="bang-card-${prefix}-${id}"] [role="button"]`;
  await until(() => actor.page.$eval(selector, (element) => element.getAttribute('aria-disabled') !== 'true').catch(() => false), `usable ${prefix} card ${id}`);
  const element = await actor.page.$(selector);
  const trace = { actor: actor.name, id, prefix, name: actor.private?.hand?.find(item => item.id === id)?.name ?? null,
    revision: actor.public?.revision, privateRevision: actor.private?.revision, viewport: actor.page.viewport(), stages: [] };
  let started = false;
  try {
    trace.stages.push(await actor.page.evaluate(cardActivationTrace, { selector, mode: 'start', phase: 'before-scroll' })); started = true;
    await element.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const bounds = await element.boundingBox();
    assert(bounds && bounds.width >= 48 && bounds.height >= 48, 'Activated card is below 48px');
    trace.stages.push(await actor.page.evaluate(cardActivationTrace, { selector, mode: 'read', phase: 'before-activation' }));
    if (actor.page.viewport()?.hasTouch) await element.tap(); else await element.click();
    await delay(70);
  } catch (error) { trace.error = error.message; throw error; }
  finally {
    try { if (started) trace.stages.push(await actor.page.evaluate(cardActivationTrace, { selector, mode: 'stop', phase: 'after-activation' })); }
    finally {
      await element.dispose();
      trace.afterRevision = actor.public?.revision; trace.afterPrivateRevision = actor.private?.revision;
      recorder.evidence.cardActivations ??= [];
      recorder.evidence.cardActivations.push(trace);
      if (recorder.evidence.cardActivations.length > 32) { recorder.evidence.cardActivations.shift(); recorder.evidence.cardActivationsDropped = (recorder.evidence.cardActivationsDropped ?? 0) + 1; }
      recorder.persist();
    }
  }
}

async function textVisible(page, text) {
  return page.evaluate((needle) => document.body.innerText.includes(needle), text);
}

async function captureSection(actor, title, filename) {
  await actor.page.evaluate((text) => {
    const heading = [...document.querySelectorAll('[role="heading"]')].find((node) => node.textContent === text);
    if (!heading) throw new Error(`Missing section ${text}`);
    heading.scrollIntoView({ block: 'start' });
  }, title);
  await delay(150);
  await qa.capture(actor.page, filename);
  screenshots.push(filename);
}

function chooseTarget(actor, options) {
  const p = actor.private;
  const players = actor.public.players;
  const other = options.filter((target) => target.playerId !== p.playerId);
  return (p.role === 'outlaw' ? other.find((target) => players.find((player) => player.playerId === target.playerId)?.role === 'sheriff')
    : other.find((target) => players.find((player) => player.playerId === target.playerId)?.role !== 'sheriff')) ?? other[0] ?? options[0];
}

async function driveDecision(actor, step) {
  const p = actor.private;
  const g = actor.public;
  const mine = g.players.find((player) => player.playerId === p.playerId);
  const before = g.revision;
  const acceptedBefore = actor.accepted.length;
  let action;
  let duplicated = false;
  if (p.canChooseCheck) {
    action = 'choose_check';
    const safe = g.drawCheck.cards.find((item) => g.drawCheck.kind === 'dynamite' ? !(item.suit === 'spades' && +item.rank >= 2 && +item.rank <= 9) : item.suit === 'hearts');
    await card(actor, (safe ?? g.drawCheck.cards[0]).id, 'check');
  } else if (p.canChooseDiscardOrder) {
    action = 'discard_order';
    for (const item of p.discardOrderCards) await card(actor, item.id, 'order');
    await click(actor.page, `CONFIRM ORDER (${p.discardOrderCards.length}/${p.discardOrderCards.length})`);
  } else if (p.canRescue) {
    if (p.rescueBeerCardIds.length) { action = 'rescue'; await card(actor, p.rescueBeerCardIds[0]); coverage.add('rescue:beer'); }
    else if (p.canUseSid) {
      action = 'sid_ketchum';
      await click(actor.page, 'SID KETCHUM: DISCARD TWO TO HEAL');
      for (const item of p.hand.slice(0, 2)) await card(actor, item.id);
      await click(actor.page, 'HEAL WITH TWO CARDS (2/2)'); coverage.add('rescue:sid');
    } else { action = 'rescue'; await click(actor.page, 'ACCEPT ELIMINATION'); }
  } else if (p.canRespond) {
    if (p.barrelOptions.length) { action = 'use_barrel'; await click(actor.page, `TRY ${p.barrelOptions[0].toUpperCase()}`); }
    else if (p.responseCardIds.length && step % 3 !== 0) { action = 'respond'; await card(actor, p.responseCardIds[0]); coverage.add(`response:${g.pending.response}`); }
    else { action = 'respond'; await click(actor.page, 'TAKE THE HIT'); coverage.add('response:damage'); }
  } else if (p.canChooseStore) { action = 'choose_store'; await card(actor, g.pending.storeCards[0].id, 'store'); }
  else if (p.canChooseDraw) {
    action = 'choose_draw'; coverage.add(`draw:${p.drawChoice.kind}`);
    if (p.drawChoice.kind === 'kit_carlson') {
      for (const item of p.drawChoice.options.slice(0, 2)) await card(actor, item.id, 'draw');
      await click(actor.page, 'KEEP SELECTED (2/2)');
    } else await click(actor.page, 'DRAW TWO FROM DECK');
  } else if (p.canDiscard) {
    action = 'discard';
    const count = p.hand.length - mine.health;
    for (const item of p.hand.slice(0, count)) await card(actor, item.id);
    await click(actor.page, `DISCARD SELECTED (${count}/${count})`);
  } else if (p.canPlay) {
    const option = p.playOptions.find((item) => ['bang', 'duel', 'indians', 'gatling'].includes(item.effectiveName))
      ?? p.playOptions.find((item) => !['saloon', 'beer'].includes(item.effectiveName))
      ?? p.playOptions[0];
    if (option) {
      action = 'play';
      duplicated = !coverage.has('actions:double_submit_fenced');
      const item = p.hand.find((held) => held.id === option.cardId);
      coverage.add(`play:${option.effectiveName}`);
      await card(actor, item.id);
      if (option.targets.length) {
        const target = chooseTarget(actor, option.targets);
        const player = g.players.find((person) => person.playerId === target.playerId);
        await click(actor.page, `TARGET ${player.displayName}${player.playerId === p.playerId ? ' (YOU)' : ` · DISTANCE ${player.distanceFromActive}`}`, duplicated && option.effectiveName !== 'panic' && option.effectiveName !== 'cat_balou');
        if (option.effectiveName === 'panic' || option.effectiveName === 'cat_balou') {
          if (target.hand) await click(actor.page, `RANDOM HAND CARD · ${player.handCount}`, duplicated);
          else {
            const id = target.equipmentCardIds[0];
            const targetCard = player.equipment.find((equipment) => equipment.id === id);
            const label = await actor.page.evaluate((cardName) => [...document.querySelectorAll('[role="button"]')].map((node) => node.getAttribute('aria-label')).find((text) => text?.startsWith('IN PLAY:') && text.toLowerCase().replace(/[^a-z]/g, '').includes(cardName.replaceAll('_', ''))), targetCard.name);
            assert(label, `Missing equipment target ${targetCard.name}`);
            await click(actor.page, label, duplicated);
          }
        }
      } else {
        const label = await actor.page.evaluate(() => [...document.querySelectorAll('[role="button"]')].map((node) => node.getAttribute('aria-label')).find((text) => text?.startsWith('PLAY ') && text !== 'PLAY AGAIN'));
        assert(label, `Missing play confirmation for ${item.name}`);
        await click(actor.page, label, duplicated);
      }
    } else { action = 'end_turn'; await click(actor.page, 'END TURN'); }
  } else throw new Error(`No legal visible decision for ${actor.name}, ${g.phase}`);
  await until(() => actor.accepted.length > acceptedBefore && actor.public.revision > before && actor.public.revision === actor.private.revision, `${actor.name} ${action} acknowledgement`);
  coverage.add(action);
  if (duplicated) {
    assert(actor.sent.filter((message) => message[0] === 'bang:play' && message[1].expectedRevision === before).length === 1, 'Double UI submit emitted more than one gameplay command');
    coverage.add('actions:double_submit_fenced');
  }
  decisions.push({ player: actor.name, revision: before, phase: g.phase, action, acceptedRevision: actor.accepted.at(-1).revision });
}

async function completeMatch(actors) {
  for (let step = 0; step < 900; step++) {
    await until(() => actors.every((actor) => actor.public && actor.private && actor.public.revision === actor.private.revision && actor.public.revision === actors[0].public.revision), 'all four clients synchronised');
    if (actors[0].public.status === 'game_over') {
      assert(coverage.has('hand:all_cards_browse_without_command_and_tab_reveal'), 'Natural match did not supply the required owned-hand browse and keyboard path');
      return;
    }
    const actor = actors.find((item) => ['canPlay', 'canRespond', 'canChooseStore', 'canChooseDraw', 'canChooseCheck', 'canRescue', 'canChooseDiscardOrder', 'canDiscard'].some((flag) => item.private[flag]));
    assert(actor, `No actor can advance ${actors[0].public.phase}`);
    if (!coverage.has('hand:all_cards_browse_without_command_and_tab_reveal') && actor.page.viewport().hasTouch && actor.private.canPlay && actor.private.hand.length > 2 && actor.private.playOptions.length >= 2) await captureHandReadability(actor);
    if (step % 30 === 0) console.log(`BANG UI step ${step}, turn ${actor.public.turnNumber}, phase ${actor.public.phase}`);
    const captureKey = 'natural-phase:' + actor.public.phase;
    if (!coverage.has(captureKey)) {
      await qa.capture(actor.page, captureKey.replace(':', '-') + '.png', { frame: await actor.page.$('#bang-current-choice') ? '#bang-current-choice' : null });
      coverage.add(captureKey);
    }
    await driveDecision(actor, step);
    assert(actors.every((item) => item.rejected.length === 0), `Rejected UI action: ${JSON.stringify(actors.flatMap((item) => item.rejected))}`);
  }
  throw new Error('Match did not terminate within 900 real UI decisions');
}

async function fixtures(actors, roomCode, batch = null) {
  const fixtureReceipts = [];
  const framed = batch ? createFixtureFraming(qa, { batch }) : null;
  const includes = scenario => !batch || FIXTURE_BATCHES[batch].scenarios.includes(scenario);
  const frame = (actor, scenario, state) => framed?.captureState(actor, scenario, state);
  const confirm = async (actor, action, label) => {
    const revision = actor.public.revision, accepted = actor.accepted.length, phase = actor.public.phase;
    await click(actor.page, label);
    await until(() => actor.accepted.length > accepted && actor.public.revision > revision && actor.public.revision === actor.private.revision, `${actor.name} fixture ${action} acknowledgement`);
    assert(actors.every(item => item.rejected.length === 0), 'Fixture confirmation was rejected');
    coverage.add(action);
    decisions.push({ player: actor.name, revision, phase, action, acceptedRevision: actor.accepted.at(-1).revision });
  };
  const setup = async (scenario) => {
    assert(FIXTURES && qa.evidence.service === 'bang-local-ui-fixtures', 'Fixture mutation requires explicit gated fixture service');
    const response = await fetch(API_URL + '/__qa/bang-fixture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomCode, scenario }), redirect: 'error', signal: AbortSignal.timeout(10000) });
    const receipt = await response.json();
    assert(response.ok && receipt.canonicalCards === 80, `Fixture ${scenario} rejected: ${JSON.stringify(receipt)}`);
    await until(() => actors.every((actor) => actor.public.revision === receipt.revision && actor.private.revision === receipt.revision), `${scenario} all client projections`);
    fixtureReceipts.push(receipt);
    await delay(180);
    const chooser = actors.find(actor => ['canPlay', 'canRespond', 'canChooseStore', 'canChooseDraw', 'canChooseCheck', 'canRescue', 'canChooseDiscardOrder', 'canDiscard'].some(flag => actor.private[flag]));
    if (chooser && !framed) {
      const original = chooser.page.viewport();
      try {
        for (const [width, scale] of [[375, false], [1280, true]]) {
          await resize(chooser.page, width);
          await qa.capture(chooser.page, 'fixture-' + scenario + '-' + width + (scale ? '-text200' : '') + '.png', { scale, frame: await chooser.page.$('#bang-current-choice') ? '#bang-current-choice' : null });
        }
      } finally { await chooser.page.setViewport(original); }
    }
  };
  const actorNamed = (name) => actors.find((actor) => actor.name === name);
  const noor = actorNamed('Noor'), lyra = actorNamed('Lyra'), echo = actorNamed('Echo'), host = actorNamed('Astra Host');
  if (includes('lucky_check')) {
  await setup('lucky_check');
  await frame(noor, 'lucky_check', 'ready');
  await capture(noor, 'fixture-01-lucky-check', 320);
  await driveDecision(noor, 1);
  assert(noor.public.phase === 'play', 'Lucky Duke chosen heart did not avoid shot');
  coverage.add('fixture:lucky_duke_choice');
  }
  for (const scenario of ['sid_rescue', 'sid_two_alive'].filter(includes)) {
    await setup(scenario);
    if (framed) {
      await frame(lyra, scenario, 'ready');
      await click(lyra.page, 'SID KETCHUM: DISCARD TWO TO HEAL');
      for (const item of lyra.private.hand.slice(0, 2)) await card(lyra, item.id);
      await frame(lyra, scenario, 'selected');
      await confirm(lyra, 'sid_ketchum', 'HEAL WITH TWO CARDS (2/2)');
      coverage.add('rescue:sid');
    } else await driveDecision(lyra, 1);
    assert(lyra.public.players.find((player) => player.playerId === lyra.private.playerId).health === 1, `${scenario} failed to heal to1`);
    coverage.add(`fixture:${scenario}`);
  }
  if (includes('beer_rescue')) {
  await setup('beer_rescue');
  await frame(noor, 'beer_rescue', 'ready');
  await capture(noor, 'fixture-02-multiple-beer-rescue', 390);
  await driveDecision(noor, 1);
  assert(noor.private.canRescue && noor.public.rescue.livesNeeded === 1, 'First Beer incorrectly ended two-life rescue');
  await frame(noor, 'beer_rescue', 'one_beer');
  await driveDecision(noor, 2);
  assert(!noor.private.canRescue && noor.public.players.find((player) => player.playerId === noor.private.playerId).health === 1, 'Second Beer did not complete rescue');
  coverage.add('fixture:multiple_beer_rescue');
  }
  if (includes('discard_order')) {
  await setup('discard_order');
  assert(await textVisible(noor.page, 'Your move'), 'Eliminated discard chooser lacks action headline');
  assert(await textVisible(noor.page, 'can no longer win'), 'Eliminated Renegade still told team can win');
  if (framed) {
    for (const item of noor.private.discardOrderCards) await card(noor, item.id, 'order');
    await frame(noor, 'discard_order', 'selected');
    await confirm(noor, 'discard_order', `CONFIRM ORDER (${noor.private.discardOrderCards.length}/${noor.private.discardOrderCards.length})`);
  } else await driveDecision(noor, 1);
  assert(noor.public.discardTop.name === 'barrel', 'Chosen final discarded card not on top');
  coverage.add('fixture:eliminated_order_and_renegade_copy');
  }
  if (includes('kit_draw')) {
  await setup('kit_draw');
  if (framed) {
    for (const item of echo.private.drawChoice.options.slice(0, 2)) await card(echo, item.id, 'draw');
    await frame(echo, 'kit_draw', 'selected');
    await confirm(echo, 'choose_draw', 'KEEP SELECTED (2/2)');
    coverage.add('draw:kit_carlson');
  } else await driveDecision(echo, 1);
  assert(echo.private.hand.length === 2, 'Kit draw did not keep two selected cards');
  coverage.add('fixture:kit_draw');
  }
  let revision;
  if (includes('jesse_draw')) {
  await setup('jesse_draw');
  await frame(echo, 'jesse_draw', 'ready');
  revision = echo.public.revision;
  await click(echo.page, 'TAKE FROM Astra Host');
  await until(() => echo.public.revision > revision && echo.private.hand.length === 2, 'Jesse draws from visible chosen hand');
  assert(echo.public.players.find((player) => player.displayName === 'Astra Host').handCount === 0, 'Jesse did not take other hand card');
  coverage.add('fixture:jesse_ability');
  }
  if (includes('pedro_draw')) {
  await setup('pedro_draw');
  await frame(echo, 'pedro_draw', 'ready');
  const discardId = echo.public.discardTop.id;
  revision = echo.public.revision;
  await click(echo.page, 'TAKE Beer');
  await until(() => echo.public.revision > revision && echo.private.hand.some((item) => item.id === discardId), 'Pedro takes actual public discard');
  coverage.add('fixture:pedro_ability');
  }
  if (includes('calamity_play')) {
  await setup('calamity_play');
  await until(() => echo.page.evaluate(() => !document.body.innerText.includes('confirmed.')), 'previous action confirmation settles before focus stability check');
  const missedId = echo.private.hand[0].id;
  const selector = `[id="bang-card-hand-${missedId}"] [role="button"]`;
  await echo.page.focus(selector);
  await echo.page.keyboard.press('Enter');
  await until(() => echo.page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('TARGET ')), 'keyboard card selection focuses targets');
  await click(echo.page, 'CANCEL PLAY');
  assert(await echo.page.$eval(selector, (element) => element === document.activeElement), 'Cancel did not restore selected card focus');
  await card(echo, missedId);
  await frame(echo, 'calamity_play', 'targets');
  const focusBeforeRefresh = await echo.page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label'), scroll: [...document.querySelectorAll('*')].find((node) => node.scrollHeight > node.clientHeight + 100 && node.scrollTop > 0)?.scrollTop ?? 0 }));
  const other = host;
  other.intentionalOffline = true;
  await other.page.setOfflineMode(true);
  await until(() => echo.room.players.some((player) => player.displayName === host.name && !player.isConnected), 'unrelated seat disconnect');
  const focusAfterRefresh = await echo.page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label'), scroll: [...document.querySelectorAll('*')].find((node) => node.scrollHeight > node.clientHeight + 100 && node.scrollTop > 0)?.scrollTop ?? 0 }));
  writeReceipt('unrelated-focus.json', { focusBeforeRefresh, focusAfterRefresh });
  assert(JSON.stringify(focusBeforeRefresh) === JSON.stringify(focusAfterRefresh), `Unrelated seat update stole target focus or scroll: ${JSON.stringify({ focusBeforeRefresh, focusAfterRefresh })}`);
  await other.page.setOfflineMode(false);
  await other.page.reload({ waitUntil: 'domcontentloaded' });
  await until(() => echo.room.players.every((player) => player.isConnected), 'fixture host reconnect');
  other.intentionalOffline = false;
  await host.page.evaluate(() => { for (const node of document.querySelectorAll('*')) if (node.scrollHeight > node.clientHeight + 50) node.scrollTop = node.scrollHeight; });
  revision = echo.public.revision;
  await click(echo.page, 'TARGET Astra Host · DISTANCE 1');
  await until(() => echo.public.revision > revision && host.private.canRespond, 'Calamity Missed as BANG');
  await delay(200);
  const attention = await host.page.$eval('#bang-current-choice', (element) => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, focused: document.activeElement === element, height: window.innerHeight }));
  assert(attention.top >= 0 && attention.top < attention.height && attention.focused, `Required response failed to gain visible focus: ${JSON.stringify(attention)}`);
  await qa.capture(host.page, 'fixture-03-required-response-attention.png');
  screenshots.push('fixture-03-required-response-attention.png');
  await frame(host, 'calamity_play', 'response');
  coverage.add('fixture:calamity_keyboard_target_and_cancel');
  coverage.add('fixture:unrelated_seat_preserves_selection_focus_scroll');
  coverage.add('fixture:new_response_visible_and_focused');
  }
  if (includes('self_zones')) {
  await setup('self_zones');
  for (const [cardName, equipment] of [['panic', 'Mustang'], ['cat_balou', 'Scope']]) {
    const chosen = echo.private.hand.find((item) => item.name === cardName);
    await card(echo, chosen.id);
    await click(echo.page, 'TARGET Echo (YOU)');
    await frame(echo, 'self_zones', cardName === 'panic' ? 'panic_targets' : 'cat_targets');
    revision = echo.public.revision;
    await click(echo.page, `IN PLAY: ${equipment}`);
    await until(() => echo.public.revision > revision && echo.public.revision === echo.private.revision, `self ${cardName} equipment target`);
  }
  assert(echo.private.hand.some((item) => item.name === 'mustang'), 'Self Panic did not recover equipment');
  assert(echo.public.discardTop.name === 'scope', 'Self Cat Balou did not discard chosen equipment');
  coverage.add('fixture:self_panic_cat_equipment_zones');
  }
  if (includes('barrel_choice')) {
  await setup('barrel_choice');
  await frame(echo, 'barrel_choice', 'ready');
  await driveDecision(echo, 1);
  assert(echo.private.canRespond && echo.private.barrelOptions.length === 1, 'Failed check did not preserve second defence source');
  await frame(echo, 'barrel_choice', 'remaining');
  await driveDecision(echo, 2);
  if (echo.private.canRespond) await driveDecision(echo, 4);
  coverage.add('fixture:independent_barrel_and_jourdonnais');
  }
  if (framed) framed.assertComplete();
  assert(actors.every(actor => actor.rejected.length === 0), 'Fixture action was rejected');
  writeReceipt('fixture-receipts.json', { scope: 'Deliberately seeded legal-conserving rare branches, separate from natural full match', batch, fixtureReceipts });
}

async function main() {
  const runMode = fixtureRunMode();
  assert(!fs.existsSync(outputDir), 'Choose a new output directory; preserve prior evidence');
  fs.mkdirSync(outputDir, { recursive: true }); ownsOutput = true;
  qa = createEvidence({ outputDir, base: BASE_URL, api: API_URL }); qa.secrets.add(' frontier '); qa.secrets.add('frontier');
  qa.evidence.capturePlan = runMode.capturePlan;
  qa.evidence.plannedCaptureUpperBound = runMode.upperBound;
  qa.evidence.fixtureBatch = runMode.batch;
  if (runMode.batch) qa.evidence.method = `Seeded canonical BANG fixture-only batch: ${runMode.batch}. Four owned browser seats; viewport-only framing retains their original input profiles. No natural full match or Sheriff-forfeit rematch claim.`;
  assert(qa.evidence.plannedCaptureUpperBound <= CAPTURE_LIMIT, 'Capture plan exceeds the hard limit');
  qa.evidence.gaps.push('Automated policy, not independent manual play or physical devices.', 'Only four seats: five-to-seven-player layout remains unverified.', runMode.batch ? 'Seeded batch only; natural matches and rematches are outside this run.' : 'Rematch ends through a scripted Sheriff forfeit, not a second natural completion.');
  let browser = null, watchdog = null, exportedBuild = null;
  const actors = [];
  try {
    assert(process.env.BANG_UI_EXCLUSIVE_WINDOW === 'granted', 'Exclusive browser window must be explicitly granted');
    assert(!FIXTURES_ONLY || FIXTURES, 'Fixture-only mode also requires BANG_UI_FIXTURES=true');
    qa.evidence.sourceHashes = sourceHashes();
    exportedBuild = bundleEvidence(); qa.evidence.exportedBuild = exportedBuild; qa.persist();
    local(API_URL);
    const health = await fetch(API_URL, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    const service = health.ok ? (await health.json()).service : null;
    assert(service === (FIXTURES ? 'bang-local-ui-fixtures' : 'zuychin-arcade-server'), 'API service must match explicit ordinary or fixture mode');
    qa.evidence.service = service; qa.evidence.mode = BEFORE_ONLY ? 'baseline-only' : FIXTURES_ONLY ? 'canonical-fixtures-only' : FIXTURES ? 'engine-generated-game-and-separate-fixtures-on-fixture-server' : 'ordinary-api-natural-game-and-scripted-forfeit-rematch';
    qa.evidence.bundle = await bundleFence(BASE_URL + '/bang', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256);
    qa.persist();
    assert(/^[A-Za-z0-9+/]{43}=$/.test(CERT_SPKI ?? ''), 'Provide current QA certificate SPKI');
    browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + CERT_SPKI] });
    watchdog = setTimeout(() => { qa.evidence.watchdogExpired = true; qa.persist(); void browser.close(); }, 30 * 60_000);
    await qa.calibrate(browser);
    for (const [index, name] of ['Astra Host', 'Lyra', 'Noor', 'Echo'].entries()) {
      actors.push(await player(browser, name, [390, 360, 768, 1280][index]));
    }
    const host = actors[0];
    await captureLibraryEntry(host, 375);
    await captureLibraryEntry(actors[3], 1280);
    await capture(host, '01-landing', 320);
    await capture(host, '01-landing', 1280);
    await captureMatrix(host, 'entrance');
    await captureLifecycleFrame(host, 'entrance-form', 'CREATE ROOM', true);
    await captureLifecycleFrame(actors[3], 'entrance-form-desktop-pointer', 'CREATE ROOM', true, qa, 1280);
    await capture(actors[3], '01-landing-desktop-pointer', 1280);
    if (!BEFORE_ONLY) {
      await input(host.page, 'Your name', '');
      await click(host.page, 'CREATE ROOM');
      assert(await textVisible(host.page, 'name'), 'Missing inline name validation');
      assert(host.page.url().endsWith('/bang'), 'Empty name created a room');
      coverage.add('create:inline_validation');
    }
    await input(host.page, 'Your name', host.name);
    const password = BEFORE_ONLY ? '' : ' frontier ';
    if (password) {
      await host.page.keyboard.press('Enter');
      assert(await host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Room password, optional'), 'Name Enter did not focus password');
      await input(host.page, 'Room password, optional', password);
      await host.page.keyboard.press('Enter');
      coverage.add('create:keyboard');
    } else await click(host.page, 'CREATE ROOM');
    await until(() => host.page.url().endsWith('/bang/lobby'), 'created lobby');
    const roomCode = await host.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth')).roomCode);
    for (const actor of actors.slice(1)) {
      await actor.page.goto(`${BASE_URL}/bang/join`, { waitUntil: 'domcontentloaded' });
      await until(() => actor.page.$('input[aria-label="Room code"]'), 'join form');
      await input(actor.page, 'Your name', actor.name);
      await input(actor.page, 'Room code', roomCode);
      if (password) await input(actor.page, 'Room password, optional', password);
      if (actor === actors[1]) {
        await capture(actor, '02-join', 320);
        await captureLifecycleFrame(actor, 'join-form', 'JOIN GAME', true);
      }
      if (actor === actors[3]) await captureLifecycleFrame(actor, 'join-form-desktop-pointer', 'JOIN GAME', true, qa, 1280);
      await click(actor.page, 'JOIN GAME');
      await until(() => actor.page.url().endsWith('/bang/lobby'), `${actor.name} lobby`);
    }
    coverage.add('create_join:four_real_contexts');
    if (!BEFORE_ONLY && !FIXTURES_ONLY) {
      const reconnect = actors[1];
      reconnect.intentionalOffline = true;
      await reconnect.page.setOfflineMode(true);
      await until(() => host.room?.players.some((player) => player.displayName === reconnect.name && !player.isConnected), 'reserved lobby seat');
      assert(await textVisible(host.page, 'WAITING FOR RECONNECTION'), 'Host could start while a seat was reserved');
      await capture(host, '03-lobby-reserved', 320);
      await reconnect.page.setOfflineMode(false);
      await reconnect.page.reload({ waitUntil: 'domcontentloaded' });
      await until(() => host.room?.players.every((player) => player.isConnected), 'lobby reconnect');
      reconnect.intentionalOffline = false;
      coverage.add('lobby:reconnect_and_start_gate');
      await click(host.page, 'LEAVE ROOM');
      await click(host.page, 'STAY');
      assert(host.page.url().endsWith('/bang/lobby'), 'Lobby cancel leave changed route');
      coverage.add('lobby:cancel_leave');
    }
    await capture(host, '03-lobby', 320);
    await capture(host, '03-lobby', 1280);
    await captureMatrix(host, 'lobby');
    for (const label of ['START GAME', 'HOW TO PLAY', 'LEAVE ROOM']) await captureLifecycleFrame(host, 'lobby-action-' + label.toLowerCase().replaceAll(' ', '-'), label);
    for (const label of ['HOW TO PLAY', 'LEAVE ROOM']) await captureLifecycleFrame(actors[3], 'lobby-action-desktop-pointer-' + label.toLowerCase().replaceAll(' ', '-'), label, false, qa, 1280);
    await capture(actors[3], '03-lobby-desktop-pointer', 1280);
    if (!BEFORE_ONLY) await click(actors[2].page, 'LEAVE ROOM');
    await click(host.page, 'START GAME');
    await until(() => actors.every((actor) => actor.public && actor.private && actor.public.revision === actor.private.revision), 'paired initial game state');
    if (!BEFORE_ONLY && await textVisible(actors[2].page, 'Release your seat and return to the arcade?')) {
      await capture(actors[2], '03b-stale-lobby-dialog-after-start', 390);
      console.log('FINDING: lobby leave dialog persists with pre-game wording after host starts');
      coverage.add('finding:lobby_dialog_persists_after_start');
      await click(actors[2].page, 'STAY');
      if (FIXTURES) throw new Error('Stale lobby prompt regression remains after shared fix');
    } else if (!BEFORE_ONLY) coverage.add('lobby:stale_leave_prompt_cleared');
    if (FIXTURES_ONLY) {
      await fixtures(actors, roomCode, runMode.batch);
      assert(!issues.length, `Unexpected browser warnings/errors: ${JSON.stringify(issues)}`);
      for (const actor of actors) await normalExit(actor);
      await verifyFrozenEvidence(qa, exportedBuild);
      writeReceipt('summary.json', { scope: 'Targeted conserving rare-branch UI confirmation; no natural full match claim in this run', fixtureBatch: runMode.batch, exportedBuild, coverage: [...coverage], decisions, screenshots, issues });
      qa.evidence.coverage = [...coverage]; qa.persist();
      return;
    }
    const active = actors.find((actor) => actor.public.activePlayerId === actor.private.playerId);
    await captureMatrix(active, 'decision', '#bang-current-choice');
    await captureMatrix(actors.find(actor => !actor.page.viewport()?.hasTouch), 'desktop-pointer-game');
    await resize(active.page, 375); await railEnds(active);
    await capture(actors.find((actor) => actor !== active), '05-waiting-game', 360, true);
    if (!BEFORE_ONLY) {
      const desktop = actors.find(actor => !actor.page.viewport().hasTouch);
      await resize(desktop.page, 1280);
      await captureSection(desktop, 'Around the table', '06-all-seats-desktop-pointer-1280.png');
      await resize(active.page, 320);
      await captureSection(active, 'Around the table', '06-all-seats-320.png');
      await click(active.page, 'Open rules');
      await capture(active, '07-rules', 320);
      assert(await textVisible(active.page, 'General FAQ'), 'New edition reference missing');
      if (FIXTURES) {
        const region = await active.page.$('[role="region"][tabindex="0"]');
        assert(region, 'Rulebook scrolling region is not keyboard focusable');
        await region.focus();
        await active.page.keyboard.press('PageDown');
        await delay(350);
        assert(await region.evaluate((element) => element.scrollTop > 0), 'PageDown cannot scroll rulebook');
        await active.page.keyboard.press('Escape');
        await until(() => active.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Open rules'), 'Escape returns rulebook opener focus');
        coverage.add('rules:keyboard_scroll_escape_return');
      } else await click(active.page, 'Close rules');
      coverage.add('rules:full_reference');
      await click(active.page, 'Leave table');
      assert(await textVisible(active.page, 'immediately eliminates'), 'Forfeit warning missing immediate elimination');
      await capture(active, '08-forfeit-confirmation', 320);
      await click(active.page, 'STAY');
      coverage.add('game:cancel_forfeit');
      const reload = actors.find((actor) => actor !== active);
      const identity = reload.private.playerId;
      const hand = reload.private.hand.map((item) => item.id).join();
      reload.public = null; reload.private = null;
      await reload.page.reload({ waitUntil: 'domcontentloaded' });
      await until(() => reload.public && reload.private && reload.public.revision === reload.private.revision, 'game reload paired state');
      assert(reload.private.playerId === identity && reload.private.hand.map((item) => item.id).join() === hand, 'Reload changed private identity or hand');
      coverage.add('game:reload_private_recovery');
      await completeMatch(actors);
      assert(actors.every((actor) => actor.public.players.every((person) => person.role)), 'Results failed to reveal all roles');
      await captureMatrix(host, 'results', await resultFrame(host));
      await capture(actors.find(actor => !actor.page.viewport()?.hasTouch), '09-results-desktop-pointer', 1280);
      await captureResultDetails(actors);
      coverage.add('game:complete_match');
      coverage.add('results:roles_revealed');
      const beforeRematch = host.public.revision;
      const ackBefore = host.accepted.length;
      await click(host.page, 'PLAY AGAIN');
      await until(() => host.accepted.length > ackBefore && actors.every((actor) => actor.public.status === 'playing' && actor.public.revision === beforeRematch + 1 && actor.public.revision === actor.private.revision), 'fresh monotonic rematch');
      assert(actors.every((actor) => actor.public.players.filter((person) => person.role).length === 1), 'Rematch leaked hidden roles');
      coverage.add('rematch:all_clients_fresh_private_deal');
      await capture(host, '10-rematch', 390);
      if (FIXTURES) await fixtures(actors, roomCode);
      const sheriff = actors.find((actor) => actor.private.role === 'sheriff');
      await click(sheriff.page, 'Leave table');
      await click(sheriff.page, 'FORFEIT AND LEAVE');
      await until(() => !sheriff.page.url().includes('/bang/game'), 'sheriff returned to arcade');
      const survivors = actors.filter((actor) => actor !== sheriff);
      await until(() => survivors.every((actor) => actor.public.status === 'game_over'), 'Sheriff forfeit ends match');
      assert(survivors[0].public.players.find((person) => person.playerId === sheriff.private.playerId)?.forfeited, 'Sheriff forfeit flag missing');
      await capture(survivors[0], '11-sheriff-forfeit-results', 390);
      coverage.add('forfeit:sheriff_terminal');
      const survivingHost = survivors.find((actor) => actor.room?.players.some((person) => person.playerId === actor.private.playerId && person.isHost));
      assert(!await button(survivingHost.page, 'PLAY AGAIN'), 'Rematch enabled with only three connected seats');
      coverage.add('rematch:insufficient_players_disabled');
      await click(survivors[0].page, 'BACK TO ARCADE');
      await click(survivors[0].page, 'LEAVE TABLE');
      await until(() => !survivors[0].page.url().includes('/bang/game'), 'results exit');
      coverage.add('results:exit');
    }
    assert(!issues.length, `Unexpected browser warnings/errors: ${JSON.stringify(issues)}`);
    const result = { scope: BEFORE_ONLY ? 'Before-state rendered audit only, no full match claim' : 'One automated four-client game using each acting seat own projections, followed by scripted Sheriff-forfeit rematch branch. Optional conserving fixtures are separate. Not independent manual testers.', exportedBuild, roomCode, screenshots, issues, coverage: [...coverage], decisions,
      runtime: { browser: await browser.version(), node: process.version, webUrl: BASE_URL },
      finalPublicState: actors[0].public };
    for (const actor of actors) await normalExit(actor);
    await verifyFrozenEvidence(qa, exportedBuild);
    writeReceipt(BEFORE_ONLY ? 'baseline.json' : 'summary.json', result);
    qa.evidence.coverage = [...coverage];
    qa.evidence.rareBranchGaps = ['choose_check', 'choose_store', 'choose_draw', 'discard_order', 'rescue:beer', 'rescue:sid'].filter(key => !coverage.has(key));
    qa.persist();
  } catch (error) {
    qa.evidence.failure = redact(error.stack ?? error.message ?? String(error), [...qa.secrets]); qa.persist();
    writeReceipt('partial-evidence.json', { exportedBuild, coverage: [...coverage], decisions, screenshots, issues, error: error.message });
    for (const [index, actor] of actors.entries()) await actor.page.screenshot({ path: path.join(outputDir, `failure-client-${index}.png`) }).catch(() => undefined);
    throw error;
  } finally {
    if (watchdog) clearTimeout(watchdog);
    for (const actor of qa.actors.values()) {
      let currentAuth = null, authReadSucceeded = false;
      try { currentAuth = await actor.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') || 'null')); authReadSucceeded = true; } catch {}
      const auth = currentAuth ?? actor.auth;
      if (auth?.token) qa.secrets.add(auth.token);
      const normal = qa.evidence.cleanup.filter(record => record.actor === actor.name && record.normalUI && record.status === 200).at(-1);
      if (normal && authReadSucceeded && !currentAuth) { normal.authCleared = true; actor.left = true; }
      if (!actor.left && auth?.token && auth.roomCode) {
        actor.fallbackCleanup = true;
        try {
          const response = await fetch(API_URL + '/rooms/' + encodeURIComponent(auth.roomCode) + '/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.token }, redirect: 'error', signal: AbortSignal.timeout(5000) });
          qa.evidence.cleanup.push({ actor: actor.name, status: response.status, normalUI: false, fallback: true });
        } catch (error) { qa.evidence.cleanup.push({ actor: actor.name, normalUI: false, fallback: true, error: error.message }); }
      }
      await actor.cdp?.detach().catch(() => undefined);
      try { await actor.context.close(); qa.evidence.cleanup.push({ actor: actor.name, contextClosed: true }); }
      catch (error) { qa.evidence.cleanup.push({ actor: actor.name, contextClosed: false, error: error.message }); }
    }
    try { if (browser) { await browser.close(); qa.evidence.browserClosed = true; } }
    finally {
      qa.evidence.finalIssues = issues;
      qa.evidence.completion = completionStatus(qa.evidence, [...qa.actors.values()].map(actor => actor.name));
      const failedAcceptance = !qa.evidence.failure && !qa.evidence.completion.passed;
      if (failedAcceptance) qa.evidence.failure = 'BANG evidence acceptance failed: inspect findings, privacy gaps, browser issues and cleanup';
      qa.persist(); writeReceipt('cleanup.json', { browserClosed: qa.evidence.browserClosed, entries: qa.evidence.cleanup, completion: qa.evidence.completion });
      assert(!failedAcceptance, qa.evidence.failure);
      if (qa.evidence.completion.passed) console.log('BANG evidence passed all capture, freeze and cleanup gates: ' + outputDir);
    }
  }
}

module.exports = { fixtures, fixtureRunMode, card, cardActivationTrace, chooseTarget, driveDecision, completeMatch, recordBrowserResponse, CAPTURE_PLAN, FIXTURE_CAPTURE_BUDGET, SOURCE_FILES, sourceHashes, verifyFrozenEvidence, completionStatus, assertFrameCoverage, captureFrameEdges, captureLibraryEntry, captureResultDetails, captureLifecycleFrame, markLifecycleFrame, handBrowseState, assertBrowseUnchanged, proveHandBrowsing, captureHandReadability };

if (require.main === module) main().catch(error => {
  if (ownsOutput) writeReceipt('failure.txt', { error: error.stack ?? String(error), issues });
  console.error(redact({ error: error.message, outputDir }, [...(qa?.secrets ?? [])]));
  process.exitCode = 1;
});
