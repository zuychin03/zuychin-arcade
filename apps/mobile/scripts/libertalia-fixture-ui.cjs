const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const puppeteer = require('puppeteer-core');
const { io } = require('socket.io-client');
const { createEvidence, bundleFence, guardNetwork, local, publicPrivacy, CAPTURE_LIMIT } = require('./libertalia-ui-evidence.cjs');
const { redact } = require('./libertalia-ui-primitives.cjs');
const { SOURCE_FILES: NATURAL_SOURCES, captureFrame, commandMetadata, assertCommand } = require('./libertalia-ui-natural.cjs');
const { choiceIdentity, activateChoice } = require('./libertalia-ui-choice.cjs');
const { LIBERTALIA_CREW } = require('../../../packages/types/src/libertalia-constants.ts');
const { installTextGeometry } = require('./skull-ui-evidence.cjs');

const SCENARIOS = Object.freeze(['scout-hand', 'gunner-ship', 'necromancer-relic', 'watchman-swap', 'saber-island', 'hook-anchor', 'night-nymph-clash', 'empty-effect', 'empty-hand', 'midshipman-two', 'six-fleet', 'six-results']);
const NAMES = Object.freeze(['Fixture Host', 'Fixture Second', 'Fixture Third']);
const SIX_NAMES = Object.freeze(['FixtureHost', 'FixtureSecond', 'FixtureThird', 'FixtureFourth', 'FixtureFifth', 'FixtureSixth'].map(name => name.padEnd(20, 'X')));
const GAPS = Object.freeze(['player', 'optional', 'empty-pending', 'multi-select']);
const LOOT_HELP = Object.freeze({ map: 'Anchor: sets of 2 score 7; sets of 3 score 12. Combine sets for the best total.', barrel: 'Gain 1 reputation at dusk, then 1 doubloon at anchor.', amulet: 'Gain 3 doubloons at anchor.', chest: 'Gain 5 doubloons at anchor.', hook: 'At anchor, keep a ship character for the next voyage or gain 2 doubloons.', saber: 'At dusk, discard another admiral’s character still on the island.', relic: 'Lose 3 doubloons at anchor.' });
const WATCHDOG_MS = 20 * 60_000;
const SOURCE_FILES = Object.freeze([...new Set([...NATURAL_SOURCES,
  'apps/mobile/scripts/libertalia-fixture-ui.cjs', 'apps/mobile/scripts/libertalia-fixture-ui.test.cjs',
  'apps/server/scripts/libertalia/ui-fixtures.ts', 'apps/server/scripts/libertalia/ui-fixture-server.ts',
  'apps/server/scripts/libertalia/ui-fixtures.test.ts', 'apps/server/scripts/libertalia/ui-fixture-guards.test.ts',
  ...['engine', 'publicState', 'socketHandlers'].map(name => 'apps/server/src/game/libertalia/' + name + '.ts'),
  'apps/server/src/routes/room.ts', 'apps/server/src/socket/handlers.ts', 'apps/server/src/socket/roomLifecycle.ts', 'apps/server/src/store/RoomStore.ts',
])]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(60); }
  throw Error('Timed out: ' + label);
}
function sourceHashes(read = file => fs.readFileSync(path.resolve(__dirname, '../../..', file))) {
  return Object.fromEntries(SOURCE_FILES.map(file => [file, createHash('sha256').update(read(file)).digest('hex')]));
}
function origin(value) {
  const url = local(value);
  assert(['http:', 'https:'].includes(url.protocol) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password, 'Plain loopback origin required');
  return url.origin;
}
function namesFor(scenario) { return scenario.startsWith('six-') ? [...SIX_NAMES] : NAMES.slice(0, ['empty-hand', 'midshipman-two'].includes(scenario) ? 2 : 3); }
function planFor(scenario, seat) {
  assert(SCENARIOS.includes(scenario), 'Explicit known fixture case required');
  assert(seat === null, 'Fixture cases do not accept an implicit seat subcase');
  const frameSlotsPerPass = { 'scout-hand': 8, 'gunner-ship': 7, 'necromancer-relic': 10, 'watchman-swap': 13, 'saber-island': 7, 'hook-anchor': 12, 'night-nymph-clash': 13, 'empty-effect': 8, 'empty-hand': 15, 'midshipman-two': 13 };
  const passes = scenario.startsWith('six-') ? 1 : 2;
  const planning = scenario === 'six-fleet' ? { stationEndpoints: 52, distinctFaces: 10 * 2 * 2 * 2, supplementFace: 1 * 2 * 2, reserve: 8 }
    : scenario === 'six-results' ? { summaryAndRows: 7 * 2 * 2 * 2, supplementSummaryAndRows: 7 * 2 * 2 }
      : { declaredFrameSlots: frameSlotsPerPass[scenario] * passes * 2 * 2, reserve: 8 };
  const plan = { scenario, seat, passes, ceiling: Object.values(planning).reduce((sum, count) => sum + count, 0), planning, maxEdges: 2, scales: [100, 200], profiles: ['375-touch', '1280-fine'], supplement320: scenario.startsWith('six-') };
  assert(plan.ceiling < 178 && plan.ceiling <= CAPTURE_LIMIT, 'Fixture ceiling stays below178 even if natural evidence has a larger allowance');
  return plan;
}
const CASE_PLANS = Object.freeze(Object.fromEntries(SCENARIOS.map(scenario => [scenario, Object.freeze(planFor(scenario, null))])));
function configFromEnv(env) {
  assert.equal(env.LIBERTALIA_FIXTURE_UI_RUN, 'true', 'Explicit seeded runner opt-in required');
  assert.equal(env.LIBERTALIA_UI_EXCLUSIVE_WINDOW, 'granted', 'Exclusive browser window required');
  assert(!env.LIBERTALIA_UI_FIXTURE_BATCH, 'This runner accepts one explicit case, never an implicit batch');
  const scenario = env.LIBERTALIA_FIXTURE_CASE;
  const seat = env.LIBERTALIA_FIXTURE_SEAT === undefined ? null : Number(env.LIBERTALIA_FIXTURE_SEAT);
  const plan = planFor(scenario, seat);
  const base = origin(env.LIBERTALIA_WEB_URL ?? 'http://127.0.0.1:8081'), api = origin(env.LIBERTALIA_API_URL ?? 'http://127.0.0.1:3213');
  assert.notEqual(base, api);
  assert(/^[a-f0-9]{64}$/.test(env.QA_EXPECTED_WEB_SHA256 ?? ''), 'Expected frozen web SHA256 required');
  assert(/^[A-Za-z0-9+/]{43}=$/.test(env.QA_BROWSER_CERT_SPKI ?? ''), 'Local proxy SPKI required');
  assert(env.QA_STATIC_ROOT && path.isAbsolute(env.QA_STATIC_ROOT), 'Absolute static export required');
  assert(env.LIBERTALIA_FIXTURE_OUTPUT && path.isAbsolute(env.LIBERTALIA_FIXTURE_OUTPUT), 'Fresh absolute fixture output required');
  assert.notEqual(path.resolve(env.LIBERTALIA_FIXTURE_OUTPUT), path.parse(env.LIBERTALIA_FIXTURE_OUTPUT).root);
  return { base, api, browserApi: 'https://localhost:3214', output: env.LIBERTALIA_FIXTURE_OUTPUT, staticRoot: env.QA_STATIC_ROOT, hash: env.QA_EXPECTED_WEB_SHA256,
    spki: env.QA_BROWSER_CERT_SPKI, browserPath: env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', scenario, seat, plan };
}
function validateService(value) { assert.equal(value?.status, 'ok'); assert.equal(value.service, 'libertalia-local-ui-fixtures', 'Ordinary API must never receive fixture writes'); }
function validateManifest(value, scenario) {
  assert.deepEqual(value.scenarios.map(item => item.scenario).sort(), [...SCENARIOS].sort());
  assert.deepEqual(value.reachability.unsupported.map(item => item.case).sort(), [...GAPS].sort());
  const spec = value.scenarios.find(item => item.scenario === scenario);
  assert.deepEqual(spec.names, namesFor(scenario)); assert.equal(spec.players, spec.names.length); assert.equal(spec.ownerIndex, 0); assert.equal(spec.observerIndex, 1);
  return spec;
}
function postOptions(body, token, webOrigin) {
  return { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Origin: origin(webOrigin), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}
async function post(config, route, body, token) {
  assert(/^\/rooms\/(create|join|[A-Z0-9-]+\/leave)$/.test(route) || route === '/__qa/libertalia-fixture', 'Only owned fixture-room routes permitted');
  return fetch(config.api + route, postOptions(body, token, config.base));
}
function hasPair(actor) {
  const p = actor.latestPrivate, g = actor.latestPublic;
  return Boolean(p?.gameId === 'libertalia' && g?.gameId === 'libertalia' && p.playerId === actor.auth?.playerId && p.roomCode === actor.auth.roomCode && g.roomCode === p.roomCode && Number.isSafeInteger(g.revision) && g.revision >= 0 && p.revision === g.revision);
}
function snapshot(actor) {
  assert(hasPair(actor), 'Owned paired projections required'); assert.deepEqual(publicPrivacy(actor.latestPublic), []);
  return { revision: actor.latestPublic.revision, phase: actor.latestPublic.phase, choice: actor.latestPrivate.pendingChoice?.id ?? null, selectedRank: actor.latestPrivate.selectedRank, sent: actor.sent.length, accepted: actor.accepted.length };
}
function packet(value) { if (!value?.startsWith('42')) return null; try { const data = JSON.parse(value.slice(2)); return Array.isArray(data) ? data : null; } catch { return null; } }
function observe(actor, event, value, qa) {
  if (event === 'room_updated') actor.latestRoom = value;
  if (event === 'game_state' && value?.gameId === 'libertalia') { actor.latestPublic = value; for (const leak of publicPrivacy(value)) qa.evidence.findings.push({ kind: 'public-privacy', actor: actor.name, leak }); }
  if (event === 'private_state' && value?.gameId === 'libertalia') actor.latestPrivate = value;
  if (event === 'libertalia:action_accepted') { actor.accepted.push(value); actor.lastAcceptedAt = Date.now(); }
  if (['action_rejected', 'server_error'].includes(event)) { qa.evidence.socketIssues.push({ actor: actor.name, event, message: redact(value?.message ?? value?.reason ?? 'Rejected', [...qa.secrets]) }); qa.persist(); }
}
async function createSeat(config, qa, name, roomCode, pass, seats) {
  const response = await post(config, roomCode ? '/rooms/join' : '/rooms/create', { displayName: name, ...(roomCode ? { roomCode } : { gameId: 'libertalia' }) });
  assert.equal(response.status, roomCode ? 200 : 201);
  const result = await response.json(), auth = result.auth ?? result;
  assert(typeof auth.token === 'string' && auth.token && auth.playerId && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(auth.roomCode)); qa.secrets.add(auth.token);
  const actor = { name, pass, auth: { ...auth, displayName: name }, accepted: [], sent: [], latestRoom: result.room, latestPublic: null, latestPrivate: null };
  seats.push(actor);
  actor.socket = io(config.api, { auth: { token: auth.token }, autoConnect: false, transports: ['websocket'], reconnection: false, timeout: 10000, extraHeaders: { Origin: config.base } });
  for (const event of ['room_updated', 'game_state', 'private_state', 'libertalia:action_accepted', 'action_rejected', 'server_error']) actor.socket.on(event, value => { if (!actor.browserOwner) observe(actor, event, value, qa); });
  actor.socket.on('connect_error', error => { qa.evidence.socketIssues.push({ actor: name, event: 'connect_error', message: redact(error.message, [...qa.secrets]) }); qa.persist(); });
  actor.socket.on('disconnect', reason => { if (!actor.replacing && !actor.cleaning) { qa.evidence.socketIssues.push({ actor: name, event: 'disconnect', reason }); qa.persist(); } });
  actor.socket.connect(); await until(() => actor.socket.connected, 'owned socket connects'); return actor;
}
async function adopt(browser, config, qa, actor, touch) {
  actor.context = await browser.createBrowserContext(); actor.page = await actor.context.newPage(); qa.register(actor);
  actor.inputProfile = { width: touch ? 375 : 1280, height: touch ? 844 : 900, hasTouch: touch, isMobile: touch, pointer: touch ? 'coarse' : 'fine' };
  await actor.page.setViewport({ ...actor.inputProfile, deviceScaleFactor: 1 });
  await guardNetwork(actor.page, qa.origins, qa.evidence.blockedRequests); await actor.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  actor.page.on('pageerror', error => { qa.evidence.consoleIssues.push({ actor: actor.name, message: redact(error.message, [...qa.secrets]) }); qa.persist(); });
  actor.page.on('console', message => { if (['warning', 'error'].includes(message.type()) && !message.text().includes('[Reanimated] Reduced motion')) { qa.evidence.consoleIssues.push({ actor: actor.name, type: message.type(), message: redact(message.text(), [...qa.secrets]) }); qa.persist(); } });
  actor.page.on('response', response => {
    const url = new URL(response.url());
    if (qa.origins.has(url.origin) && response.request().method() === 'POST' && url.pathname === '/rooms/' + actor.auth.roomCode + '/leave') {
      qa.evidence.cleanup.push({ pass: actor.pass, actor: actor.name, playerId: actor.auth.playerId, mode: 'browser-ui', normalUI: true, status: response.status(), authCleared: false }); qa.persist();
    }
  });
  actor.cdp = await actor.page.createCDPSession(); await actor.cdp.send('Network.enable');
  actor.cdp.on('Network.webSocketCreated', ({ url }) => { if (new URL(url).origin.replace(/^ws/, 'http') !== config.browserApi) qa.evidence.socketIssues.push({ actor: actor.name, event: 'wrong-browser-api-origin' }); });
  actor.cdp.on('Network.webSocketFrameReceived', ({ response }) => { const data = packet(response.payloadData); if (data) observe(actor, data[0], data[1], qa); });
  actor.cdp.on('Network.webSocketFrameSent', ({ response }) => { const data = packet(response.payloadData), record = data && commandMetadata(data, actor); if (record) actor.sent.push(record); });
  const script = await actor.page.evaluateOnNewDocument(({ auth, base }) => { if (location.origin === base && !sessionStorage.getItem('za:fixture-adopted')) { sessionStorage.setItem('za:auth', JSON.stringify(auth)); sessionStorage.setItem('za:fixture-adopted', 'true'); } }, { auth: actor.auth, base: config.base });
  actor.replacing = true; actor.browserOwner = true; actor.latestPublic = null; actor.latestPrivate = null;
  await actor.page.goto(config.base + '/libertalia/game', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await until(() => hasPair(actor) && !actor.socket.connected, 'browser replaces only its own synthetic socket');
  await actor.page.removeScriptToEvaluateOnNewDocument(script.identifier); actor.socket.disconnect();
  qa.evidence.adoptions.push({ pass: actor.pass, actor: actor.name, playerId: actor.auth.playerId, normalCreateJoin: false, inputProfile: actor.inputProfile }); qa.persist();
}
function mark({ kind, value, scope = '#libertalia-decision-area', key }) {
  const root = document.querySelector(scope); if (!root) throw Error('Fixture scope missing');
  const visible = node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !node.closest('[hidden],[inert],[aria-hidden="true"]'); };
  const candidates = [...root.querySelectorAll(kind === 'button' ? '[role="button"],button' : '*')].filter(node => visible(node) && (kind === 'button' ? (node.getAttribute('aria-label') ?? node.textContent.trim()) === value : node.textContent.trim() === value));
  const matches = candidates.filter(node => !candidates.some(other => other !== node && node.contains(other)));
  if (matches.length !== 1) throw Error('Fixture leaf is missing or ambiguous');
  matches[0].setAttribute('data-libertalia-fixture', key); return '[data-libertalia-fixture="' + key + '"]';
}
async function activate(actor, label, scope = 'body') {
  let selector, button;
  try {
    await until(async () => {
      try { selector = await actor.page.evaluate(mark, { kind: 'button', value: label, scope, key: 'activate' }); return true; } catch { return false; }
    }, 'one mounted control: ' + label);
    button = await actor.page.$(selector);
    await button.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    let previous = null, stable = 0;
    await until(async () => {
      const sample = await actor.page.evaluate(activationSample, selector);
      stable = stableSample(previous, sample) ? stable + 1 : 0; previous = sample;
      return stable >= 3;
    }, 'enabled, stable and hit-testable control: ' + label);
    if (actor.inputProfile.hasTouch) await button.tap(); else await button.click();
  } finally { await button?.dispose(); await actor.page.evaluate(() => document.querySelector('[data-libertalia-fixture="activate"]')?.removeAttribute('data-libertalia-fixture')); }
}
function activationSample(selector) {
  const nodes = [...document.querySelectorAll(selector)]; if (nodes.length !== 1) return null;
  const node = nodes[0], r = node.getBoundingClientRect(), css = getComputedStyle(node);
  if (!node.isConnected || node.closest('[hidden],[inert],[aria-hidden="true"]') || node.disabled || node.getAttribute('aria-disabled') === 'true' || css.visibility !== 'visible' || Number(css.opacity) === 0 || css.pointerEvents === 'none' || r.width < 48 || r.height < 48) return null;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!hit || hit !== node && !node.contains(hit)) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}
function stableSample(previous, current) { return Boolean(previous && current && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(current[key]) && Math.abs(current[key] - previous[key]) <= 0.5)); }
function optionLabel(option, actor, kind) {
  const owner = option.playerId ? option.playerId === actor.auth.playerId ? 'You' : actor.latestPublic.players.find(p => p.playerId === option.playerId)?.displayName : null;
  const crew = option.rank === undefined ? null : LIBERTALIA_CREW[option.rank - 1];
  const tokens = kind === 'loot_current' ? actor.latestPublic.currentLoot : actor.latestPublic.players.flatMap(p => p.loot);
  const loot = ['loot_current', 'loot_ship'].includes(kind) && tokens.find(t => t.id === option.lootId);
  return `${option.label}${owner ? ` · ${owner}` : ''}${option.detail ? `. ${option.detail}` : ''}${crew ? `. Timing: ${crew.phases.join(', ')}. ${crew.summary}` : ''}${loot ? `. Calm-side effect: ${LOOT_HELP[loot.kind]}` : ''}`;
}
async function command(actor, label, qa, identity = null) {
  const before = snapshot(actor), issues = qa.evidence.socketIssues.length;
  if (identity) await activateChoice(actor, identity, qa);
  else await activate(actor, label);
  await until(() => actor.accepted.length > before.accepted || qa.evidence.socketIssues.length > issues, 'canonical UI action acknowledgement');
  assert.equal(qa.evidence.socketIssues.length, issues);
  const accepted = actor.accepted.at(-1); await until(() => hasPair(actor) && actor.latestPublic.revision >= accepted.revision, 'accepted paired state');
  assert.equal(actor.sent.length, before.sent + 1); assertCommand(actor.sent.at(-1), before.revision, accepted.action === 'choice' ? before.choice : null, accepted);
  if (identity) assert.deepEqual(actor.sent.at(-1).optionIds, [identity.optionId], 'Exact owned fixture option command required');
  qa.evidence.commands.push({ pass: actor.pass, actor: actor.name, ...actor.sent.at(-1), accepted }); qa.persist(); return accepted;
}
async function framed(actor, key, selector, qa, prepare = null) {
  const before = snapshot(actor), start = qa.evidence.captures.length;
  assert(start + 4 <= qa.evidence.capturePlan.ceiling, 'Insufficient conservative endpoint budget');
  const proofs = await captureFrame(actor, `pass${actor.pass}-${key}-${actor.page.viewport().width}`, selector, qa, { prepare });
  assert.deepEqual(snapshot(actor), before, 'Framing must not change the choice, revision, selection or command history');
  qa.evidence.inventory.push({ pass: actor.pass, key, actor: actor.name, playerId: actor.auth.playerId, ...before, viewport: actor.page.viewport(), inputProfile: actor.inputProfile, proofs }); qa.persist();
}
function readLootGrid({ selector }) {
  const rect = node => { if (!node) return null; const r = node.getBoundingClientRect(); return Object.fromEntries(['left', 'right', 'top', 'bottom', 'width', 'height'].map(key => [key, r[key]])); };
  const roots = [...document.querySelectorAll(selector)], grid = roots[0];
  const title = [...(document.getElementById('libertalia-toolbar')?.querySelectorAll('*') ?? [])].find(node => /^VOYAGE \d OF 3$/.test(node.textContent.trim()) && !node.children.length);
  return { matches: roots.length, grid: rect(grid), title: rect(title), cards: [...(grid?.children ?? [])].map(wrapper => {
    const roots = [...wrapper.querySelectorAll('[data-testid^="libertalia-loot-token-"]')], token = roots[0], surface = token?.firstElementChild, face = surface?.children[1];
    const glyphs = [];
    if (token) {
      const walker = document.createTreeWalker(token, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode;
        if (!text.textContent.trim() || text.parentElement.closest('[aria-hidden="true"]') || /icon|material|fontawesome/i.test(getComputedStyle(text.parentElement).fontFamily)) continue;
        glyphs.push(...window.__coupQATextGeometry(text).glyphRects.map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })));
      }
    }
    return { matches: roots.length, id: token?.getAttribute('data-testid'), label: token?.getAttribute('aria-label'), text: token?.textContent, wrapper: rect(wrapper), root: rect(token), face: rect(face), faceOverflow: face ? getComputedStyle(face).overflow : null, glyphs };
  }) };
}
function assertLootGrid(sample, spec) {
  const axes = ['left', 'right', 'top', 'bottom', 'width', 'height'];
  const bounds = value => assert(value && axes.every(axis => Number.isFinite(value[axis])) && value.width > 0 && value.height > 0, 'Loot has finite positive geometry');
  assert.equal(sample.matches, 1, 'One scoped loot collection required'); bounds(sample.grid); bounds(sample.title);
  assert.equal(sample.cards.length, spec.tokens.length); assert(spec.tokens.length > 0);
  const scale = Math.max(1, Math.round(sample.title.height) / 24), minimum = (spec.compact ? 120 : 260) * scale;
  const columns = Math.max(1, Math.floor((sample.grid.width + 8) / (minimum + 8)));
  const width = Math.min((spec.compact ? 180 : 420) * scale, (sample.grid.width - 8 * (columns - 1)) / columns);
  const near = (actual, expected, message) => assert(Math.abs(actual - expected) <= 0.5, message);
  for (const [index, card] of sample.cards.entries()) {
    const token = spec.tokens[index]; assert.equal(card.matches, 1);
    assert.equal(card.id, 'libertalia-loot-token-' + token.id, 'Exact public loot order and identity');
    assert.equal(card.label, `${token.kind}. ${LOOT_HELP[token.kind]}`, 'Complete accessible loot effect');
    assert(card.text.includes(token.kind.toUpperCase()), 'Live loot kind missing');
    if (!spec.compact) assert(card.text.includes(LOOT_HELP[token.kind]), 'Full calm-side effect missing');
    for (const key of ['wrapper', 'root', 'face']) { bounds(card[key]); near(card[key].width, width, 'Count-independent loot track width'); }
    near(card.root.height, card.wrapper.height, 'Loot root fills stretched track'); near(card.face.height, card.root.height - 4, 'Painted loot face fills its root above depth allowance');
    assert(['hidden', 'clip'].includes(card.faceOverflow), 'Measured loot node must be the painted clipped face');
    assert(card.face.left >= sample.grid.left - 0.5 && card.face.right <= sample.grid.right + 0.5, 'Loot remains inside collection');
    const rowStart = sample.cards[index - index % columns];
    near(card.wrapper.left, sample.grid.left + index % columns * (width + 8), 'Loot tracks must pack without underfilled rows');
    near(card.wrapper.top, rowStart.wrapper.top, 'Expected loot row occupancy');
    near(card.face.top, rowStart.face.top, 'Same-row painted top'); near(card.face.height, rowStart.face.height, 'Same-row painted loot height');
    if (index >= columns && index % columns === 0) assert(card.wrapper.top >= sample.cards[index - columns].wrapper.bottom + 7.5, 'Distinct loot rows cannot overlap');
    assert(card.glyphs.length > 0, 'Actual live loot glyphs required');
    for (const glyph of card.glyphs) assert(glyph.left >= card.face.left - 2 && glyph.right <= card.face.right + 2 && glyph.top >= card.face.top - 2 && glyph.bottom <= card.face.bottom + 2, 'Live loot glyph clips outside painted face');
  }
  return { columns, width, scale };
}
function assertStableLoot(before, after, spec) {
  assertLootGrid(before, spec); assertLootGrid(after, spec);
  for (const [index, card] of before.cards.entries()) {
    const next = after.cards[index]; assert.equal(next.id, card.id); assert.equal(next.text, card.text); assert.equal(next.label, card.label);
    for (const key of ['wrapper', 'root', 'face']) for (const axis of ['left', 'right', 'top', 'bottom', 'width', 'height']) assert(Math.abs(card[key][axis] - next[key][axis]) <= 0.5, 'Loot moved during screenshot: ' + key + '.' + axis);
  }
  for (const axis of ['left', 'right', 'top', 'bottom', 'width', 'height']) assert(Math.abs(before.grid[axis] - after.grid[axis]) <= 0.5, 'Loot collection moved during screenshot');
}
function lootRecorder(qa, actor, spec) {
  return { ...qa, capture: async (page, name, options) => {
    assert.equal(page, actor.page);
    await page.evaluate(installTextGeometry);
    const screenshot = page.screenshot;
    page.screenshot = async (...args) => {
      if (path.basename(String(args[0]?.path ?? '')).startsWith('failure-')) return screenshot.apply(page, args);
      const record = { file: path.basename(String(args[0]?.path ?? name)), actor: actor.name, pass: actor.pass, revision: actor.latestPublic.revision, viewport: page.viewport(), scale: options.scale ? 200 : 100, selector: spec.selector, compact: spec.compact, expected: spec.tokens, validated: false };
      (qa.evidence.lootChecks ??= []).push(record); qa.persist();
      record.before = await page.evaluate(readLootGrid, spec); qa.persist();
      const result = await screenshot.apply(page, args);
      record.after = await page.evaluate(readLootGrid, spec); qa.persist();
      assertStableLoot(record.before, record.after, spec); record.validated = true; qa.persist(); return result;
    };
    try { return await qa.capture(page, name, options); }
    finally { page.screenshot = screenshot; }
  } };
}
async function emptyHandLoot(actor, qa) {
  const before = snapshot(actor), current = { selector: '[data-testid="libertalia-current-loot-grid"]', compact: false, tokens: actor.latestPublic.currentLoot };
  await framed(actor, 'current-loot-grid', current.selector, lootRecorder(qa, actor, current));
  const day = actor.latestPublic.lootDays.findIndex(tokens => tokens.length > 0); assert(day >= 0);
  const outlook = { selector: `[data-testid="libertalia-voyage-loot-grid-${day + 1}"]`, compact: true, tokens: actor.latestPublic.lootDays[day] };
  await activate(actor, 'VIEW ALL VOYAGE LOOT', '#libertalia-loot-area');
  let failure;
  try {
    await until(async () => actor.page.$$eval(outlook.selector, nodes => nodes.length === 1), 'disclosed nonempty voyage loot');
    assert.deepEqual(snapshot(actor), before, 'Opening public outlook sends no game command');
    await framed(actor, 'voyage-loot-grid', outlook.selector, lootRecorder(qa, actor, outlook));
  } catch (error) { failure = error; throw error; }
  finally {
    try {
      await activate(actor, 'HIDE VOYAGE LOOT', '#libertalia-loot-area');
      await until(async () => actor.page.$$eval(outlook.selector, nodes => nodes.length === 0), 'voyage loot safely closed');
    } catch (error) {
      if (!failure) throw error;
      qa.evidence.findings.push({ kind: 'loot-outlook-close', message: redact(error.message, [...(qa.secrets ?? [])]) }); qa.persist();
    }
  }
  assert.deepEqual(snapshot(actor), before, 'Browsing loot cannot change game state or commands');
}
async function leaf(actor, key, value, qa, scope) {
  const selector = await actor.page.evaluate(mark, { kind: 'text', value, key, scope });
  try { await framed(actor, key, selector, qa); }
  finally { await actor.page.evaluate(key => { for (const node of document.querySelectorAll('[data-libertalia-fixture]')) if (node.getAttribute('data-libertalia-fixture') === key) node.removeAttribute('data-libertalia-fixture'); }, key); }
}
async function choiceFrames(actor, stage, qa) {
  const pending = actor.latestPrivate.pendingChoice;
  assert(pending && pending.playerId === actor.auth.playerId && pending.min === 1 && pending.max === 1 && !pending.optional && pending.options.length > 0 && pending.options.length <= 9);
  await leaf(actor, stage + '-prompt', pending.prompt, qa);
  for (let i = 0; i < pending.options.length; i++) {
    const option = pending.options[i], label = optionLabel(option, actor, pending.kind);
    const identity = { choiceId: pending.id, optionId: option.id, label, revision: actor.latestPrivate.revision };
    const { selector } = await choiceIdentity(actor, identity);
    const liveText = await actor.page.$eval(selector, node => node.textContent);
    assert(liveText.includes(option.label)); if (option.rank) assert(liveText.includes(LIBERTALIA_CREW[option.rank - 1].summary), 'Full option rule text must be live, not only accessible copy');
    await framed(actor, stage + '-option' + i, selector, qa, async () => { await choiceIdentity(actor, identity); });
  }
  qa.evidence.stages.push({ pass: actor.pass, stage, owner: actor.name, playerId: actor.auth.playerId, revision: actor.latestPublic.revision, kind: pending.kind, choiceId: pending.id, optionIds: pending.options.map(o => o.id), immediateSingleChoice: true, selectedState: 'not-applicable: one click submits immediately' }); qa.persist();
}

function assertPostcondition(scenario, actors, before) {
  const [host, second] = actors, g = host.latestPublic, h = host.latestPrivate;
  const owner = g.players.find(p => p.playerId === host.auth.playerId), other = g.players.find(p => p.playerId === second.auth.playerId);
  assert(g.revision > before.revision || ['six-fleet', 'six-results'].includes(scenario));
  if (scenario === 'scout-hand') { assert(h.graveyard.includes(1)); assert(!h.hand.includes(6)); }
  if (scenario === 'gunner-ship') { assert(!other.ship.includes(8)); assert(second.latestPrivate.graveyard.includes(8)); assert.equal(owner.reputation, Math.max(0, before.reputation - 1)); if (before.reputation === 0) assert.equal(owner.doubloons, Math.max(0, before.doubloons - 1)); }
  if (scenario === 'necromancer-relic') { assert(owner.ship.includes(7)); assert(!h.graveyard.includes(7)); assert(!owner.loot.some(t => t.id === 41)); }
  if (scenario === 'watchman-swap') { assert(g.lootDays[0].some(t => t.id === 19)); assert(g.lootDays[1].some(t => t.id === 1)); assert.equal(owner.loot.length, before.lootCount); }
  if (scenario === 'saber-island') { assert(second.latestPrivate.graveyard.includes(5)); assert(!actors[2].latestPrivate.graveyard.includes(5)); assert(owner.loot.some(t => t.id === 35)); }
  if (scenario === 'hook-anchor') { assert.equal(g.voyage, 2); assert(owner.ship.includes(29)); }
  if (scenario === 'night-nymph-clash') { assert.equal(g.day, 2); assert(h.graveyard.includes(37)); assert(second.latestPrivate.graveyard.includes(37)); assert(!owner.ship.includes(37) && !other.ship.includes(37)); assert.equal(owner.doubloons, before.doubloons + 2); assert.equal(other.doubloons, 11); }
  if (scenario === 'empty-effect') assert.equal(g.day, 2);
  if (scenario === 'midshipman-two') { assert(!g.currentLoot.some(t => t.id === before.removedLoot)); assert(!owner.loot.some(t => t.id === before.removedLoot)); assert.equal(g.reputationTrack.filter(t => !t.active).length, 4); }
  if (scenario === 'empty-hand') { assert.equal(g.voyage, 2); assert.equal(h.hand.length, 6); assert.equal(owner.forfeited, false); }
  if (scenario === 'six-results') { assert.equal(g.status, 'game_over'); assert.equal(g.endReason, 'score'); assert.equal(g.players.length, 6); assert(g.players.every(p => !p.forfeited)); assert(g.winnerPlayerIds.length > 0); for (const id of g.winnerPlayerIds) assert.equal(g.players.find(p => p.playerId === id).score, Math.max(...g.players.map(p => p.score))); }
  return { scenario, revision: g.revision, phase: g.phase, voyage: g.voyage, day: g.day, independentlyChecked: true };
}
async function choose(actor, id, qa) {
  const pending = actor.latestPrivate.pendingChoice, option = pending?.options.find(o => o.id === id);
  assert(option, 'Exact canonical option must belong to current owner');
  const label = optionLabel(option, actor, pending.kind);
  await command(actor, label, qa, { choiceId: pending.id, optionId: id, label, revision: actor.latestPrivate.revision });
}
async function selectCrew(actor, rank, qa, captureCandidate = false) {
  const crew = LIBERTALIA_CREW[rank - 1]; assert(actor.latestPrivate.canSelect && actor.latestPrivate.hand.includes(rank));
  const before = snapshot(actor);
  await activate(actor, `Choose ${crew.name}, rank ${rank}. Timing: ${crew.phases.join(', ')}. ${crew.summary}`);
  assert.deepEqual(snapshot(actor), before, 'Local candidate is not a committed action');
  if (captureCandidate) {
    await framed(actor, 'candidate-card', '#libertalia-hand-card-' + rank, qa);
    const selector = await actor.page.evaluate(mark, { kind: 'button', value: `CONFIRM #${rank} ${crew.name.toUpperCase()}`, scope: '#libertalia-hand', key: 'candidate-confirm' });
    await framed(actor, 'candidate-confirm', selector, qa);
  }
  await command(actor, `CONFIRM #${rank} ${crew.name.toUpperCase()}`, qa);
}
async function pairedAll(actors, revision) { await until(() => actors.every(actor => hasPair(actor) && actor.latestPublic.revision >= revision), 'all owned views catch up'); }
async function neutralFrames(host, qa) {
  const neutral = host.latestPublic.island.find(card => card.neutral);
  assert(neutral?.rank === 20.5 && neutral.name === 'Midshipman' && neutral.playerId === null);
  assert(typeof neutral.id === 'string' && neutral.id.length && [...neutral.id].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127), 'Neutral piece requires a valid opaque ID');
  const selector = '[id=' + JSON.stringify('libertalia-island-' + neutral.id) + ']';
  assert.equal(await host.page.$eval(selector, node => node.querySelectorAll('img,[data-testid^="libertalia-crew-card-"]').length), 0, 'Neutral Midshipman has no Freed Prisoner art');
  await framed(host, 'neutral-midshipman', selector, qa);
  await framed(host, 'inactive-reputation', '#libertalia-reputation', qa);
}

async function branch(actors, config, qa) {
  const [host, second] = actors, scenario = config.scenario;
  const owner = host.latestPublic.players.find(p => p.playerId === host.auth.playerId);
  const before = { revision: host.latestPublic.revision, reputation: owner.reputation, lootCount: owner.loot.length, doubloons: owner.doubloons,
    removedLoot: host.latestPrivate.pendingChoice?.options[0]?.lootId };
  if (scenario === 'empty-hand') {
    assert.deepEqual(host.latestPrivate.hand, []); assert.equal(host.latestPrivate.canSelect, false); assert.equal(owner.forfeited, false);
    await framed(host, 'empty-hand-decision', '#libertalia-decision-area', qa); await framed(host, 'empty-hand-private', '#libertalia-hand', qa);
    await emptyHandLoot(host, qa);
    await selectCrew(second, second.latestPrivate.hand[0], qa, true);
    for (let step = 0; host.latestPublic.voyage === 1; step++) {
      assert(step < 80, 'Exhaustion continuation exceeded fixed command bound');
      await pairedAll(actors, Math.max(...actors.map(a => a.latestPublic.revision)));
      const actor = actors.find(a => a.latestPrivate.pendingChoice); assert(actor?.page, 'Exhaustion continuation needs an actual browser owner');
      const pending = actor.latestPrivate.pendingChoice;
      await choose(actor, (pending.options.find(o => o.label !== 'SABER') ?? pending.options[0]).id, qa);
      await pairedAll(actors, actor.latestPublic.revision);
    }
    await framed(host, 'replenished-crew', '#libertalia-hand-card-' + host.latestPrivate.hand[0], qa);
  } else {
    if (scenario === 'midshipman-two') await neutralFrames(host, qa);
    await choiceFrames(host, 'initial', qa);
    const ids = { 'scout-hand': `hand:${host.auth.playerId}:6`, 'gunner-ship': `ship:${second.auth.playerId}:8`, 'necromancer-relic': `ship:${host.auth.playerId}:41`, 'watchman-swap': 'swap:1:19', 'saber-island': host.latestPrivate.pendingChoice.options.find(o => o.playerId === second.auth.playerId)?.id,
      'hook-anchor': 'keep', 'night-nymph-clash': 'night:37', 'empty-effect': host.latestPrivate.pendingChoice.options[0].id, 'midshipman-two': host.latestPrivate.pendingChoice.options[0].id };
    await choose(host, ids[scenario], qa); await pairedAll(actors, host.latestPublic.revision);
    if (scenario === 'necromancer-relic' || scenario === 'hook-anchor') {
      await choiceFrames(host, 'nested', qa);
      await choose(host, scenario === 'necromancer-relic' ? `grave:${host.auth.playerId}:7` : `ship:${host.auth.playerId}:29`, qa);
    }
    if (scenario === 'night-nymph-clash') {
      assert(!host.latestPublic.players.find(p => p.playerId === host.auth.playerId).ship.includes(37));
      assert(second.latestPublic.players.find(p => p.playerId === second.auth.playerId).ship.includes(37));
      await choiceFrames(second, 'second-owner-same-clash', qa); await choose(second, 'night:24', qa);
    }
    await pairedAll(actors, Math.max(...actors.map(a => a.latestPublic.revision)));
    if (scenario === 'empty-effect') {
      for (let step = 0; host.latestPublic.day === 1; step++) {
        assert(step < 12, 'Empty-effect day continuation bounded');
        const actor = actors.find(a => a.latestPrivate.pendingChoice); assert(actor);
        if (actor.page) await choose(actor, actor.latestPrivate.pendingChoice.options[0].id, qa);
        else await socketChoice(actor, qa);
        await pairedAll(actors, actor.latestPublic.revision);
      }
    }
    if (['necromancer-relic', 'hook-anchor'].includes(scenario)) await framed(host, 'retained-full-crew', `#libertalia-ship-${host.auth.playerId} [data-testid="libertalia-crew-card-${scenario === 'hook-anchor' ? 29 : 7}"]`, qa);
    else await framed(host, 'post-decision-heading', '#libertalia-decision', qa);
  }
  qa.evidence.postconditions.push({ pass: host.pass, ...assertPostcondition(scenario, actors, before) }); qa.persist();
}
async function socketChoice(actor, qa) {
  const before = snapshot(actor), p = actor.latestPrivate.pendingChoice;
  const payload = { expectedRevision: before.revision, choiceId: p.id, optionIds: [p.options[0].id] };
  const record = commandMetadata(['libertalia:choice', payload], actor); actor.sent.push(record); actor.socket.emit('libertalia:choice', payload);
  await until(() => actor.accepted.length > before.accepted, 'owned extra socket acknowledgement');
  const accepted = actor.accepted.at(-1);
  await until(() => hasPair(actor) && actor.latestPublic.revision >= accepted.revision, 'owned extra socket accepted pair');
  assertCommand(record, before.revision, before.choice, accepted);
  qa.evidence.commands.push({ pass: actor.pass, actor: actor.name, mode: 'socket-only', ...record, accepted }); qa.persist();
}
function inspectFleet({ players, definitions }) {
  if (players.length !== 6 || players.some(player => player.ship.length !== 10)) throw Error('Expected finite six-by-ten fleet');
  const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  return players.map(player => {
    const station = document.getElementById('libertalia-seat-' + player.playerId), ship = document.getElementById('libertalia-ship-' + player.playerId);
    if (!station || !ship || !station.textContent.includes(player.displayName)) throw Error('Complete exact fleet name missing');
    const cards = [...ship.querySelectorAll('[data-testid^="libertalia-crew-card-"]')];
    if (cards.length !== player.ship.length) throw Error('Fleet card count differs from public projection');
    return { playerId: player.playerId, displayName: player.displayName, cards: cards.map((card, index) => {
      const rank = Number(card.dataset.testid.split('-').at(-1)), crew = definitions.find(item => item.rank === rank), bounds = rect(card), parent = rect(ship);
      if (rank !== player.ship[index] || !crew || !card.textContent.includes(crew.name) || !card.textContent.includes(crew.summary)) throw Error('Full fleet crew text/order missing');
      if (bounds.left < parent.left - 2 || bounds.right > parent.right + 2 || card.scrollWidth > card.clientWidth + 2) throw Error('Fleet card horizontally clipped');
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode;
        if (!text.textContent.trim() || text.parentElement.closest('[aria-hidden="true"]') || /icon|material|fontawesome/i.test(getComputedStyle(text.parentElement).fontFamily)) continue;
        if (window.__coupQATextGeometry(text).glyphRects.some(glyph => glyph.left < bounds.left - 2 || glyph.right > bounds.right + 2)) throw Error('Fleet live rule glyph horizontally clipped');
      }
      return { rank, fullText: true, bounds, offscreenAllowed: true };
    }) };
  });
}
function assertSegmentVisible(segment, record) {
  const b = record.metrics.frame, v = record.metrics.frameVisibleBounds;
  assert(b && v); const absolute = { left: b.left + segment.left, right: b.left + segment.right, top: b.top + segment.top, bottom: b.top + segment.bottom };
  assert(absolute.left >= v.left - 2 && absolute.right <= v.right + 2 && absolute.top >= v.top - 2 && absolute.bottom <= v.bottom + 2, 'Station header/loot must be fully visible in its endpoint image');
}
async function stationEndpoints(actor, player, qa, scales = [false, true]) {
  const selector = '#libertalia-seat-' + player.playerId;
  const recorder = lootRecorder(qa, actor, { selector: `[data-testid="libertalia-collected-loot-grid-${player.playerId}"]`, compact: true, tokens: player.loot });
  for (const scale of scales) for (const align of ['start', 'end']) {
    const before = snapshot(actor); let segments;
    assert(qa.evidence.captures.length + 1 <= qa.evidence.capturePlan.ceiling);
    const record = await recorder.capture(actor.page, `pass${actor.pass}-station-${player.playerId}-${actor.page.viewport().width}-${scale ? 200 : 100}-${align}.png`, { frame: selector, align, scale, prepare: async () => {
      const page = actor.page;
      await page.evaluate(installTextGeometry);
      qa.evidence.fleetChecks.push({ pass: actor.pass, viewport: page.viewport(), scale: scale ? 200 : 100, rows: await page.evaluate(inspectFleet, { players: actor.latestPublic.players, definitions: LIBERTALIA_CREW }) });
      segments = await page.$eval(selector, (node, edge) => {
        const r = node.getBoundingClientRect(), children = [...node.children];
        const targets = edge === 'start' ? children.slice(0, 3) : [children.at(-1)];
        return targets.map(target => { const b = target.getBoundingClientRect(); return { left: b.left - r.left, right: b.right - r.left, top: b.top - r.top, bottom: b.bottom - r.top }; });
      }, align);
    } });
    for (const segment of segments) assertSegmentVisible(segment, record);
    assert.deepEqual(snapshot(actor), before);
    qa.evidence.stationEndpoints.push({ actor: actor.name, pass: actor.pass, playerId: player.playerId, viewport: actor.page.viewport(), scale: scale ? 200 : 100, align, file: record.file, headerOrLootFullyVisible: true, completeStationBody: false }); qa.persist();
  }
}
async function publicCase(actors, config, qa) {
  const owners = actors.slice(0, 2), players = owners[0].latestPublic.players;
  assert.deepEqual(players.map(p => p.displayName), [...SIX_NAMES]);
  for (const actor of owners) {
    if (config.scenario === 'six-results') {
      assertPostcondition('six-results', actors, { revision: actor.latestPublic.revision });
      await framed(actor, 'results-summary-actions', '#libertalia-result-summary', qa);
      for (const player of players) {
        const selector = '#libertalia-result-row-' + player.playerId;
        assert(await actor.page.$eval(selector, (node, name) => node.textContent.includes(name), player.displayName));
        await framed(actor, 'result-' + player.playerId, selector, qa);
      }
    } else {
      assert(players.every(p => p.ship.length === 10 && p.loot.length === 2));
      for (const player of players) await stationEndpoints(actor, player, qa);
      for (const rank of [...new Set(players.flatMap(p => p.ship))]) {
        const player = players.find(p => p.ship.includes(rank));
        await framed(actor, 'distinct-fleet-rank-' + rank, `#libertalia-ship-${player.playerId} [data-testid="libertalia-crew-card-${rank}"]`, qa);
        qa.evidence.faceDeduplication.push({ actor: actor.name, rank, proofKey: 'distinct-fleet-rank-' + rank, repeatedOwnerIds: players.filter(p => p.ship.includes(rank)).map(p => p.playerId), claim: 'Shared rank/component face proof; not sixty separately visually reviewed faces.' });
      }
    }
  }
  const phone = owners.find(actor => actor.inputProfile.hasTouch), original = phone.page.viewport();
  try {
    await phone.page.setViewport({ ...original, width: 320 });
    if (config.scenario === 'six-results') {
      await framed(phone, '320-results-summary-actions', '#libertalia-result-summary', qa);
      for (const player of players) await framed(phone, '320-result-' + player.playerId, '#libertalia-result-row-' + player.playerId, qa);
    } else {
      await stationEndpoints(phone, players.at(-1), qa);
      const longestRank = [...new Set(players.flatMap(p => p.ship))].sort((a, b) => LIBERTALIA_CREW[b - 1].summary.length - LIBERTALIA_CREW[a - 1].summary.length)[0];
      await framed(phone, '320-longest-rule-face', `#libertalia-ship-${players[0].playerId} [data-testid="libertalia-crew-card-${longestRank}"]`, qa);
    }
  } finally { await phone.page.setViewport(original); }
  qa.evidence.postconditions.push({ pass: owners[0].pass, scenario: config.scenario, independentPublicProof: true }); qa.persist();
}
async function cleanupSeat(actor, config, qa) {
  actor.cleaning = true;
  try {
    if (actor.page) {
      await qa.ready(actor.page);
      await activate(actor, actor.latestPublic?.status === 'game_over' ? 'BACK TO ARCADE' : 'Back to arcade');
      await until(() => actor.page.$('#arcade-dialog'), 'owned leave dialog mounts'); await activate(actor, 'LEAVE', '#arcade-dialog');
      await until(() => actor.page.evaluate(() => sessionStorage.getItem('za:auth') === null && location.pathname === '/'), 'normal UI leave and auth clear');
      await until(() => qa.evidence.cleanup.some(row => row.playerId === actor.auth.playerId && row.normalUI && row.status === 200), 'leave HTTP200 receipt');
      qa.evidence.cleanup.find(row => row.playerId === actor.auth.playerId && row.normalUI && row.status === 200).authCleared = true;
    } else {
      const response = await post(config, '/rooms/' + actor.auth.roomCode + '/leave', undefined, actor.auth.token); assert.equal(response.status, 200);
      qa.evidence.cleanup.push({ pass: actor.pass, actor: actor.name, playerId: actor.auth.playerId, mode: 'socket-rest', status: response.status, normalUI: false });
    }
    actor.left = true;
  } catch (error) {
    qa.evidence.cleanup.push({ pass: actor.pass, actor: actor.name, error: redact(error.message, [...qa.secrets]) });
    try { const response = await post(config, '/rooms/' + actor.auth.roomCode + '/leave', undefined, actor.auth.token); qa.evidence.cleanup.push({ pass: actor.pass, actor: actor.name, fallback: true, status: response.status }); } catch (fallback) { qa.evidence.cleanup.push({ actor: actor.name, fallback: true, error: redact(fallback.message, [...qa.secrets]) }); }
  } finally {
    actor.socket?.disconnect(); await actor.cdp?.detach().catch(() => undefined);
    if (actor.context) { try { await actor.context.close(); qa.evidence.contextsClosed.push(actor.auth.playerId); } catch (error) { qa.evidence.cleanup.push({ actor: actor.name, error: redact(error.message, [...qa.secrets]) }); } }
    qa.persist();
  }
}
function completionStatus(evidence, ownedSeats) {
  const privacyGaps = evidence.captures.flatMap(record => record.metrics?.privacyGaps ?? []);
  const selectorGaps = evidence.captures.flatMap(record => record.metrics?.selectorGaps ?? []);
  const cleanupComplete = evidence.browserClosed && ownedSeats.length > 0 && ownedSeats.every(seat => evidence.cleanup.some(row => row.playerId === seat.playerId && row.status === 200 && (seat.browserOwner ? row.normalUI && row.authCleared && evidence.contextsClosed.includes(seat.playerId) : row.mode === 'socket-rest')))
    && !evidence.cleanup.some(row => row.error || row.fallback);
  return { cleanupComplete: Boolean(cleanupComplete), privacyGaps, selectorGaps, passed: Boolean(cleanupComplete && evidence.scenarioComplete && evidence.freezeVerified && !evidence.failure && !evidence.watchdogExpired && !evidence.findings.length && !evidence.blockedRequests.length && !evidence.socketIssues.length && !evidence.consoleIssues.length && !privacyGaps.length && !selectorGaps.length && evidence.captures.length <= evidence.capturePlan.ceiling) };
}
function assertInventory(evidence, plan) {
  const inventory = evidence.inventory;
  assert.equal(evidence.passes.length, plan.passes); assert.equal(evidence.postconditions.length, plan.passes);
  for (const pass of evidence.passes) {
    assert.equal(pass.natural, false);
    assert.deepEqual(pass.ownerProfiles.map(row => row.inputProfile.pointer).sort(), ['coarse', 'fine']);
    const expectedStages = ['empty-hand', 'six-fleet', 'six-results'].includes(plan.scenario) ? []
      : ['initial', ...(['necromancer-relic', 'hook-anchor'].includes(plan.scenario) ? ['nested'] : plan.scenario === 'night-nymph-clash' ? ['second-owner-same-clash'] : [])];
    assert.deepEqual(evidence.stages.filter(stage => stage.pass === pass.pass).map(stage => stage.stage), expectedStages);
    for (const stage of evidence.stages.filter(stage => stage.pass === pass.pass)) {
      for (const key of [stage.stage + '-prompt', ...stage.optionIds.map((_, i) => stage.stage + '-option' + i)]) assert.equal(inventory.filter(row => row.pass === pass.pass && row.key === key).length, 1, 'Every declared option and prompt needs full framing');
    }
  }
  for (const row of inventory) {
    assert.deepEqual(row.proofs.map(proof => proof.scale), [100, 200]);
    for (const proof of row.proofs) assert(proof.covered >= proof.height - 2 && proof.files.length >= 1 && proof.files.length <= 2);
  }
  if (plan.scenario === 'empty-hand') for (let pass = 0; pass < 2; pass++) for (const key of ['empty-hand-decision', 'empty-hand-private', 'current-loot-grid', 'voyage-loot-grid', 'candidate-card', 'candidate-confirm', 'replenished-crew']) assert.equal(inventory.filter(row => row.pass === pass && row.key === key).length, 1);
  if (['empty-hand', 'six-fleet'].includes(plan.scenario)) {
    const files = plan.scenario === 'six-fleet' ? evidence.stationEndpoints.map(row => row.file) : inventory.filter(row => ['current-loot-grid', 'voyage-loot-grid'].includes(row.key)).flatMap(row => row.proofs.flatMap(proof => proof.files));
    for (const file of files) assert.equal(evidence.lootChecks.filter(row => row.file === file && row.validated).length, 1, 'Every loot screenshot needs its stable pre/post painted geometry');
    assert.equal(evidence.lootChecks.length, files.length);
  }
  if (plan.scenario === 'six-fleet') {
    assert.equal(evidence.faceDeduplication.length, 20); assert.equal(evidence.stationEndpoints.length, 52); assert.equal(evidence.fleetChecks.length, 52);
    const roster = evidence.passes[0].roster;
    for (const owner of evidence.passes[0].ownerProfiles) for (const player of roster) for (const scale of [100, 200]) for (const align of ['start', 'end']) assert.equal(evidence.stationEndpoints.filter(row => row.actor === owner.actor && row.playerId === player.playerId && row.viewport.width === owner.inputProfile.width && row.scale === scale && row.align === align).length, 1);
    for (const owner of evidence.passes[0].ownerProfiles) {
      const copies = evidence.faceDeduplication.filter(row => row.actor === owner.actor); assert.equal(new Set(copies.map(row => row.rank)).size, 10);
      for (const copy of copies) { assert.deepEqual([...copy.repeatedOwnerIds].sort(), roster.map(row => row.playerId).sort()); assert.equal(inventory.filter(row => row.actor === owner.actor && row.key === copy.proofKey && row.viewport.width === owner.inputProfile.width).length, 1); }
    }
  }
  if (plan.scenario === 'six-results') {
    assert.equal(inventory.length, 21);
    for (const owner of evidence.passes[0].ownerProfiles) for (const key of ['results-summary-actions', ...evidence.passes[0].roster.map(row => 'result-' + row.playerId)]) assert.equal(inventory.filter(row => row.actor === owner.actor && row.key === key && row.viewport.width === owner.inputProfile.width).length, 1);
  }
  assert(evidence.captures.length <= plan.ceiling);
  return true;
}
async function main() {
  const config = configFromEnv(process.env);
  assert(!fs.existsSync(config.output), 'Existing evidence must be preserved'); fs.mkdirSync(config.output, { recursive: true });
  const qa = createEvidence({ outputDir: config.output, base: config.base, api: config.api });
  Object.assign(qa.evidence, { natural: false, method: 'Explicit canonical seeded checkpoints. Browser owners adopt only their own generated QA sessions, not normal create/join coverage. Private cases use two fresh rooms with swapped real input-profile ownership. No native or physical-device claim.', scenario: config.scenario, capturePlan: config.plan, gaps: [...GAPS, 'Hook coins alternative is engine-tested, not this keep-path visual run.'], adoptions: [], commands: [], inventory: [], stages: [], postconditions: [], stationEndpoints: [], faceDeduplication: [], fleetChecks: [], socketIssues: [], consoleIssues: [], contextsClosed: [], passes: [] });
  const owned = []; let browser, watchdog;
  try {
    qa.evidence.sourceHashes = sourceHashes(); qa.persist();
    const response = await fetch(config.api, { redirect: 'error', signal: AbortSignal.timeout(10000) }); assert.equal(response.status, 200); validateService(await response.json());
    const manifestResponse = await fetch(config.api + '/__qa/libertalia-fixtures', { redirect: 'error', signal: AbortSignal.timeout(10000) }); assert.equal(manifestResponse.status, 200);
    const spec = validateManifest(await manifestResponse.json(), config.scenario); qa.evidence.manifest = { scenario: spec.scenario, names: spec.names, kind: spec.kind, postcondition: spec.postcondition };
    qa.evidence.bundle = await bundleFence(config.base + '/libertalia', config.staticRoot, config.hash);
    assert(fs.readFileSync(path.resolve(config.staticRoot, '.' + qa.evidence.bundle.script), 'utf8').includes(config.browserApi)); qa.persist();
    browser = await puppeteer.launch({ executablePath: config.browserPath, headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + config.spki] });
    watchdog = setTimeout(() => { qa.evidence.watchdogExpired = true; qa.persist(); void browser.close(); }, WATCHDOG_MS);
    await qa.calibrate(browser);
    for (let pass = 0; pass < config.plan.passes; pass++) {
      const seats = [];
      try {
        for (const name of spec.names) await createSeat(config, qa, name, seats[0]?.auth.roomCode, pass, seats);
        const host = seats[0]; await until(() => host.latestRoom?.players.filter(p => p.isConnected && !p.hasLeft).length === spec.players, 'exact connected roster');
        host.socket.emit('start_game'); await until(() => seats.every(hasPair) && host.accepted.some(a => a.action === 'start'), 'canonical ordinary start before seeding');
        for (let i = 0; i < 2; i++) await adopt(browser, config, qa, seats[i], pass === 0 ? i === 0 : i === 1);
        await until(() => seats.every(hasPair) && host.latestRoom?.players.every(p => p.isConnected && !p.hasLeft), 'all owners connected after adoption');
        const seeded = await post(config, '/__qa/libertalia-fixture', { roomCode: host.auth.roomCode, scenario: config.scenario }); assert.equal(seeded.status, 200);
        const checkpoint = await seeded.json(); assert.equal(checkpoint.scenario, config.scenario); await pairedAll(seats, checkpoint.checkpoint.revision);
        assert.deepEqual(host.latestPublic.players.map(p => p.displayName), spec.names); assert.equal(host.latestPrivate.pendingChoice?.kind ?? null, spec.kind);
        qa.evidence.passes.push({ pass, roomCode: host.auth.roomCode, seededRevision: host.latestPublic.revision, roster: host.latestPublic.players.map(p => ({ playerId: p.playerId, displayName: p.displayName })), ownerProfiles: seats.slice(0, 2).map(actor => ({ actor: actor.name, inputProfile: actor.inputProfile })), natural: false }); qa.persist();
        if (config.scenario === 'night-nymph-clash') { assert.deepEqual(checkpoint.checkpoint.nightNymphOwners, seats.slice(0, 2).map(actor => actor.auth.playerId)); qa.evidence.passes.at(-1).sameClashOwners = [...checkpoint.checkpoint.nightNymphOwners]; }
        if (config.scenario.startsWith('six-')) await publicCase(seats, config, qa); else await branch(seats, config, qa);
      } finally {
        owned.push(...seats.map(actor => ({ playerId: actor.auth.playerId, browserOwner: Boolean(actor.context) })));
        for (const actor of [...seats.slice(0, 2).reverse(), ...seats.slice(2)]) await cleanupSeat(actor, config, qa);
      }
    }
    assertInventory(qa.evidence, config.plan); qa.evidence.scenarioComplete = true;
  } catch (error) { qa.evidence.failure = redact(error.stack ?? error.message, [...qa.secrets]); }
  finally {
    if (watchdog) clearTimeout(watchdog);
    try { if (browser) { await browser.close(); qa.evidence.browserClosed = true; } } catch (error) { qa.evidence.cleanup.push({ error: redact(error.message, [...qa.secrets]) }); }
    try { qa.evidence.finalSourceHashes = sourceHashes(); assert.deepEqual(qa.evidence.finalSourceHashes, qa.evidence.sourceHashes); qa.evidence.finalBundle = await bundleFence(config.base + '/libertalia', config.staticRoot, config.hash); assert.deepEqual(qa.evidence.finalBundle, qa.evidence.bundle); qa.evidence.freezeVerified = true; } catch (error) { qa.evidence.failure ??= redact(error.message, [...qa.secrets]); }
    Object.assign(qa.evidence, completionStatus(qa.evidence, owned)); qa.persist();
  }
  console.log(JSON.stringify({ scenario: config.scenario, output: config.output, passed: qa.evidence.passed, captures: qa.evidence.captures.length, browserClosed: qa.evidence.browserClosed }));
  if (!qa.evidence.passed) process.exitCode = 1;
}

module.exports = { SCENARIOS, CASE_PLANS, NAMES, SIX_NAMES, GAPS, WATCHDOG_MS, SOURCE_FILES, namesFor, planFor, configFromEnv, validateService, validateManifest, sourceHashes, postOptions, hasPair, snapshot, packet, mark, optionLabel, framed, choiceFrames, neutralFrames, assertPostcondition, assertSegmentVisible, completionStatus, inspectFleet, assertInventory, activationSample, stableSample, activate, stationEndpoints, socketChoice, LOOT_HELP, readLootGrid, assertLootGrid, assertStableLoot, lootRecorder, emptyHandLoot };
if (require.main === module) main().catch(error => { console.error(redact(error.message)); process.exitCode = 1; });
