const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const { io } = require('socket.io-client');
const h = require('./citadels-ui-smoke.cjs');
const { createEvidence, bundleFence, guardNetwork, local, redact, publicPrivacy } = require('./citadels-ui-evidence.cjs');

const SCENARIO = 'seven_seat_layout';
const NAMES = ['Fixture Host', 'Fixture Second', 'Fixture Third', 'Fixture Fourth', 'Fixture Fifth', 'Fixture Sixth', 'ABCDEFGHIJKLMNOPQRST'];
const PROFILES = [{ width: 320, height: 900 }, { width: 375, height: 900 }, { width: 1280, height: 900 }];

function checkProjection(seat, revision) {
  assert.equal(seat.private?.playerId, seat.auth.playerId);
  assert.equal(seat.private?.roomCode, seat.auth.roomCode);
  assert.equal(seat.public?.roomCode, seat.auth.roomCode);
  assert.equal(seat.private?.revision, revision);
  assert.equal(seat.public?.revision, revision);
  assert.equal(seat.public.players.length, 7);
  assert.deepEqual(publicPrivacy(seat.public), []);
  for (const player of seat.public.players) {
    assert.equal(player.revealedRole, player.displayName === NAMES[0] ? 'magician' : player.displayName === NAMES[6] ? 'thief' : null);
    assert.equal(player.forfeited, false);
  }
  assert.equal(seat.private.hand.length, seat.name === NAMES[0] ? 6 : 4);
  assert.equal(seat.private.canAct, seat.name === NAMES[0]);
}

function checkCardCoverage(records, cardId) {
  const id = `citadels-district-card-${cardId}`;
  const slices = records.map(record => {
    const card = record.metrics.containment.cards.find(c => c.id === id);
    assert(card, `Missing post-capture card ${id}`);
    const b = card.bounds, v = card.visibleBounds;
    assert(b.left >= v.left - 2 && b.right <= v.right + 2, 'Rail endpoint must fit horizontally');
    return { from: Math.max(0, v.top - b.top), to: Math.min(b.bottom - b.top, v.bottom - b.top), height: b.bottom - b.top };
  }).sort((a, b) => a.from - b.from);
  assert(Math.abs(slices[0].height - slices[1].height) <= 2, 'Card must remain stable between endpoint captures');
  assert(slices[0].from <= 2 && slices[0].to >= slices[1].from - 2 && slices[1].to >= slices[1].height - 2, 'Top and bottom captures must cover the full card without a gap');
  return { cardId, files: records.map(r => r.file), slices };
}

async function post(api, route, body, token) {
  local(api);
  const response = await fetch(api + route, {
    method: 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  return response;
}

function completionStatus(receipt) {
  const cleanup = receipt.cleanup;
  const cleanupComplete = Boolean(receipt.browserClosed
    && cleanup.filter(r => r.mode === 'browser-ui' && r.normalUI && r.status === 200 && r.authCleared).length === 2
    && cleanup.filter(r => r.mode === 'socket-owner-rest' && r.status === 200).length === 5
    && !cleanup.some(r => r.error || r.uiError || r.contextError || r.mode === 'browser-fallback'));
  const scopeComplete = receipt.cleanupOnly ? receipt.fixtureChecksComplete && receipt.layoutComplete === false : receipt.layoutComplete;
  return { cleanupComplete, passed: Boolean(scopeComplete && cleanupComplete && !receipt.failure && receipt.socketIssues.length === 0 && receipt.consoleIssues.length === 0) };
}

async function browserSeat(browser, name, desktop, qas, cleanup) {
  const seat = await h.openPlayer(browser, name, desktop ? 1280 : 320, 900);
  await seat.page.setViewport({ width: desktop ? 1280 : 320, height: 900, deviceScaleFactor: 1, isMobile: !desktop, hasTouch: !desktop });
  for (const qa of qas) qa.register(seat);
  await guardNetwork(seat.page, qas[0].origins, qas[0].evidence.blockedRequests);
  seat.page.on('response', response => {
    if (qas[0].origins.has(new URL(response.url()).origin) && /\/rooms\/[^/]+\/leave$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST') {
      cleanup.push({ actor: name, mode: 'browser-ui', normalUI: !seat.fallbackCleanup, status: response.status(), authCleared: false });
    }
  });
  return seat;
}

async function socketSeat(api, name, roomCode, seats, secrets, issues) {
  const response = await post(api, '/rooms/join', { roomCode, displayName: name });
  assert.equal(response.status, 200, 'Ordinary owner join must succeed');
  const auth = await response.json(); secrets.add(auth.token);
  const seat = { name, auth, public: null, private: null, socket: null, cleaning: false };
  seats.push(seat);
  const socket = io(api, { autoConnect: false, transports: ['websocket'], reconnection: false, timeout: 10000, auth: { token: auth.token } });
  seat.socket = socket;
  socket.on('game_state', state => { if (state?.gameId === 'citadels') seat.public = state; });
  socket.on('private_state', state => { if (state?.gameId === 'citadels') seat.private = state; });
  for (const event of ['connect_error', 'server_error', 'action_rejected']) socket.on(event, error => { issues.push({ actor: name, event, message: error?.message ?? error?.reason ?? String(error) }); });
  socket.on('disconnect', reason => { if (!seat.cleaning) issues.push({ actor: name, event: 'unexpected-disconnect', reason }); });
  socket.connect();
  await h.waitUntil(() => socket.connected, 'authenticated lightweight owner connection', 10000);
  return seat;
}

async function inspectPrivateDOM(seat, allSeats) {
  const expectedIds = seat.private.hand.map(c => `citadels-district-card-${c.id}`).sort();
  const rivalIds = allSeats.filter(s => s !== seat).flatMap(s => s.private.hand.map(c => `citadels-district-card-${c.id}`));
  const result = await seat.page.evaluate(({ expectedIds, rivalIds }) => {
    const ids = [...document.querySelectorAll('#citadels-hand [data-testid^="citadels-district-card-"]')].map(n => n.getAttribute('data-testid')).sort();
    return { ownMatches: JSON.stringify(ids) === JSON.stringify(expectedIds),
      rivalHandNodes: [...document.querySelectorAll('[data-testid]')].filter(n => rivalIds.includes(n.getAttribute('data-testid'))).length,
      publicRoleNodes: document.querySelectorAll('#citadels-public-table [data-testid^="citadels-role-"]').length,
      privateDecisionControls: [...document.querySelectorAll('#citadels-decision-area [role="button"]')].filter(n => n.getAttribute('aria-disabled') !== 'true').map(n => n.getAttribute('aria-label')) };
  }, { expectedIds, rivalIds });
  assert(result.ownMatches); assert.equal(result.rivalHandNodes, 0); assert.equal(result.publicRoleNodes, 0);
  if (seat.name !== NAMES[0]) assert.equal(result.privateDecisionControls.length, 0, 'Observer must not receive active-owner decisions');
  return { actor: seat.name, ...result };
}

async function captureProfile(qa, actor, seats, profile, revision) {
  await actor.page.setViewport({ ...actor.page.viewport(), ...profile, deviceScaleFactor: 1 });
  await qa.ready(actor.page);
  checkProjection(actor, revision);
  qa.evidence.privacy = [];
  for (const seat of seats.filter(s => s.page)) qa.evidence.privacy.push(await inspectPrivateDOM(seat, seats));
  qa.evidence.railCoverage = [];
  qa.evidence.fixture = { scenario: SCENARIO, seats: 7, canonicalDistricts: 68, revision, naturalGame: false, privateOwner: actor.name };
  await actor.page.evaluate(ids => {
    for (const id of ids) {
      const name = document.getElementById(`citadels-roster-name-${id}`);
      const row = name?.closest('[aria-label]');
      if (!row || !row.closest('#citadels-roster')) throw new Error('Expected public roster row is missing');
      row.setAttribute('data-citadels-seven-roster', id);
    }
  }, actor.public.players.map(p => p.playerId));
  for (const scale of [false, true]) {
    const suffix = scale ? 'text200' : 'normal';
    await qa.capture(actor.page, `decision-${suffix}.png`, { scale, frame: '#citadels-decision-heading', align: 'start' });
    for (const [index, player] of actor.public.players.entries()) {
      await qa.capture(actor.page, `roster-${index + 1}-${suffix}.png`, { scale, frame: `[data-citadels-seven-roster="${player.playerId}"]`, expectedText: player.displayName });
      await qa.capture(actor.page, `city-owner-${index + 1}-${suffix}.png`, { scale, frame: `#citadels-city-name-${player.playerId}`, expectedText: player.displayName });
      for (const [edge, card] of [['first', player.city[0]], ['last', player.city.at(-1)]]) {
        const frame = `#citadels-city-${player.playerId} [data-testid="citadels-district-card-${card.id}"]`;
        const records = [];
        for (const align of ['start', 'end']) records.push(await qa.capture(actor.page, `city-${index + 1}-${edge}-${suffix}-${align}.png`, { scale, frame, align }));
        qa.evidence.railCoverage.push({ owner: player.displayName, edge, scale: scale ? 200 : 100, ...checkCardCoverage(records, card.id) }); qa.persist();
      }
    }
    for (const [edge, card] of [['first', actor.private.hand[0]], ['last', actor.private.hand.at(-1)]]) {
      const frame = `#citadels-hand [data-testid="citadels-district-card-${card.id}"]`;
      const records = [];
      for (const align of ['start', 'end']) records.push(await qa.capture(actor.page, `own-hand-${edge}-${suffix}-${align}.png`, { scale, frame, align }));
      qa.evidence.railCoverage.push({ owner: actor.name, rail: 'private-hand', edge, scale: scale ? 200 : 100, ...checkCardCoverage(records, card.id) }); qa.persist();
    }
  }
}

async function cleanupBrowser(seat, api, cleanup, secrets) {
  try {
    const auth = await seat.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null')).catch(() => seat.auth);
    if (auth?.token) {
      secrets.add(auth.token); seat.auth = auth;
      try { await h.leavePlayerUI(seat); }
      catch (error) {
        cleanup.push({ actor: seat.name, mode: 'browser-ui', uiError: error.message });
        seat.fallbackCleanup = true;
        const response = await post(api, '/rooms/' + encodeURIComponent(auth.roomCode) + '/leave', undefined, auth.token);
        cleanup.push({ actor: seat.name, mode: 'browser-fallback', normalUI: false, status: response.status });
      }
    }
    const authCleared = await seat.page.evaluate(() => !sessionStorage.getItem('za:auth'));
    for (const record of cleanup.filter(r => r.actor === seat.name && r.normalUI)) record.authCleared = authCleared;
  } catch (error) { cleanup.push({ actor: seat.name, mode: 'browser-ui', error: error.message }); }
  finally { await seat.context.close().catch(error => cleanup.push({ actor: seat.name, contextError: error.message })); }
}

async function main() {
  const base = process.env.CITADELS_WEB_URL ?? 'http://127.0.0.1:8081', api = process.env.CITADELS_API_URL ?? 'http://127.0.0.1:3213';
  const outputDir = process.env.CITADELS_SEVEN_OUTPUT_DIR;
  const cleanupOnly = process.env.CITADELS_SEVEN_CLEANUP_ONLY === 'true';
  assert.equal(process.env.CITADELS_UI_EXCLUSIVE_WINDOW, 'granted');
  assert.equal(process.env.CITADELS_UI_FIXTURE_RUN, 'true');
  assert.equal(process.env.CITADELS_SEVEN_SEAT_LAYOUT, 'true');
  assert(outputDir && !fs.existsSync(outputDir), 'Fresh distinct seven-seat evidence directory required');
  local(base); local(api); fs.mkdirSync(outputDir, { recursive: true });
  const secrets = new Set(), seats = [], cleanup = [], socketIssues = [];
  const qas = PROFILES.map(profile => createEvidence({ outputDir: path.join(outputDir, String(profile.width)), base, api }));
  const receipt = { method: cleanupOnly
    ? 'Cleanup-only canonical seven-seat check: two own-view browser pages and five authenticated lightweight sockets, fixture projections/privacy and ordinary cleanup. No layout captures, calibration or visual acceptance; not natural seven-player gameplay.'
    : 'Opt-in canonical seven-seat layout, two own-view browser pages and five authenticated lightweight sockets. Not natural seven-player gameplay.',
  cleanupOnly, scenario: SCENARIO, profiles: cleanupOnly ? [] : PROFILES, cleanup, socketIssues, browserClosed: false, passed: false,
  ...(cleanupOnly ? { layoutComplete: false, fixtureChecksComplete: false, cleanupComplete: false } : {}) };
  const persist = () => {
    for (const qa of qas) { for (const secret of secrets) qa.secrets.add(secret); qa.evidence.cleanup = cleanup; qa.evidence.browserClosed = receipt.browserClosed; qa.persist(); }
    fs.writeFileSync(path.join(outputDir, 'receipt.json'), redact(receipt, [...secrets]) + '\n');
  };
  let browser, watchdog;
  try {
    const health = await fetch(api, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert.equal(health.status, 200);
    const service = await health.json();
    assert.equal(service.service, 'citadels-local-ui-fixtures'); assert.equal(service.sevenSeatLayout, true);
    receipt.bundle = await bundleFence(base + '/citadels', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256);
    assert(/^[A-Za-z0-9+/]{43}=$/.test(process.env.QA_BROWSER_CERT_SPKI ?? ''), 'Current SPKI fingerprint required');
    persist();
    browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + process.env.QA_BROWSER_CERT_SPKI] });
    watchdog = setTimeout(() => { receipt.watchdogExpired = true; persist(); void browser.close(); }, 20 * 60_000);
    for (const qa of qas) {
      qa.evidence.method = receipt.method; qa.evidence.bundle = receipt.bundle;
      qa.evidence.cleanupOnly = cleanupOnly;
      qa.evidence.gaps = ['Canonical fixture only, no natural seven-seat game, scoring or rematch', 'Only two seats are rendered browser clients; five are authenticated Node sockets', cleanupOnly ? 'No screenshots, layout calibration, CSS200 or visual acceptance in cleanup-only mode' : 'CSS200/emulated touch, not native fontScale or physical devices'];
      if (!cleanupOnly) await qa.calibrate(browser);
    }
    const host = await browserSeat(browser, NAMES[0], false, qas, cleanup); seats.push(host);
    const observer = await browserSeat(browser, NAMES[1], true, qas, cleanup); seats.push(observer);
    await host.page.goto(base + '/citadels', { waitUntil: 'domcontentloaded' });
    await h.setInput(host.page, 'Your name', host.name); await h.clickButton(host.page, /^CREATE ROOM$/); await h.waitForPath(host.page, '/citadels/lobby');
    host.auth = await host.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth'))); secrets.add(host.auth.token);
    await observer.page.goto(base + '/citadels/join', { waitUntil: 'domcontentloaded' });
    await h.setInput(observer.page, 'Your name', observer.name); await h.setInput(observer.page, 'Room code', host.auth.roomCode);
    await h.clickButton(observer.page, /^JOIN GAME$/); await h.waitForPath(observer.page, '/citadels/lobby');
    observer.auth = await observer.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth'))); secrets.add(observer.auth.token);
    for (const name of NAMES.slice(2)) await socketSeat(api, name, host.auth.roomCode, seats, secrets, socketIssues);
    persist();
    await h.waitUntil(() => host.room?.players.length === 7 && host.room.players.every(p => p.isConnected && !p.hasLeft), 'seven authenticated connected lobby seats');
    await h.clickButton(host.page, /^START GAME$/);
    await Promise.all([host, observer].map(s => h.waitForPath(s.page, '/citadels/game')));
    const response = await post(api, '/__qa/citadels-fixture', { roomCode: host.auth.roomCode, scenario: SCENARIO });
    assert.equal(response.status, 200);
    const installed = await response.json(); assert.equal(installed.scenario, SCENARIO); assert.equal(installed.canonicalDistricts, 68);
    await h.waitUntil(() => seats.every(s => s.public?.revision === installed.revision && s.private?.revision === installed.revision), 'seven owned public/private pairs');
    for (const seat of seats) checkProjection(seat, installed.revision);
    receipt.fixture = { ...installed, seatCount: seats.length, browserSeats: 2, socketSeats: 5, naturalGame: false };
    if (cleanupOnly) {
      receipt.privacy = [];
      for (const seat of seats.filter(s => s.page)) {
        await qas[0].ready(seat.page);
        receipt.privacy.push(await inspectPrivateDOM(seat, seats));
      }
    } else for (const [index, profile] of PROFILES.entries()) await captureProfile(qas[index], profile.width === 1280 ? observer : host, seats, profile, installed.revision);
    receipt.finalBundle = await bundleFence(base + '/citadels', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256);
    for (const qa of qas) qa.evidence.finalBundle = receipt.finalBundle;
    assert.equal(socketIssues.length, 0); assert.equal(h.consoleIssues.length, 0);
    assert(qas.every(qa => qa.evidence.findings.length === 0 && qa.evidence.blockedRequests.length === 0));
    receipt.fixtureChecksComplete = true;
    if (!cleanupOnly) receipt.layoutComplete = true;
  } catch (error) { receipt.failure = redact(error.stack ?? error.message, [...secrets]); }
  finally {
    for (const seat of seats.filter(s => s.page).reverse()) await cleanupBrowser(seat, api, cleanup, secrets);
    for (const seat of seats.filter(s => !s.page)) {
      seat.cleaning = true;
      try {
        const response = await post(api, '/rooms/' + encodeURIComponent(seat.auth.roomCode) + '/leave', undefined, seat.auth.token);
        cleanup.push({ actor: seat.name, mode: 'socket-owner-rest', normalUI: false, status: response.status });
      } catch (error) { cleanup.push({ actor: seat.name, mode: 'socket-owner-rest', error: error.message }); }
      finally { seat.socket?.disconnect(); }
    }
    clearTimeout(watchdog);
    try { if (browser) { await browser.close(); receipt.browserClosed = true; } }
    catch (error) { receipt.browserCloseError = error.message; }
    receipt.consoleIssues = h.consoleIssues;
    Object.assign(receipt, completionStatus(receipt));
    receipt.profileReceipts = qas.map((qa, index) => ({ path: `${PROFILES[index].width}/receipt.json`, captures: qa.evidence.captures.length, findings: qa.evidence.findings.length }));
    for (const qa of qas) { qa.evidence.passed = receipt.passed; qa.evidence.cleanupComplete = receipt.cleanupComplete; qa.evidence.layoutComplete = Boolean(receipt.layoutComplete); }
    persist();
  }
  assert(receipt.passed, receipt.failure ?? 'Seven-seat requested scope or owned cleanup gate failed');
  console.log(cleanupOnly ? `CITADELS SEVEN-SEAT CLEANUP CHECK COMPLETE: ${outputDir}; no visual acceptance`
    : `CITADELS SEVEN-SEAT LAYOUT COMPLETE: ${outputDir}; inspect each profile before visual acceptance`);
}

module.exports = { SCENARIO, NAMES, PROFILES, checkProjection, checkCardCoverage, post, completionStatus };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
