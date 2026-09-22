const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const puppeteer = require('puppeteer-core');
const { io } = require('socket.io-client');
const { createEvidence, bundleFence, guardNetwork, local, redact, publicPrivacy, enlargeBangText, restoreBangText, readBangFontState, validateBangFontState } = require('./bang-ui-evidence.cjs');

const CAPTURE_LIMIT = 120;
const WATCHDOG_MS = 15 * 60_000;
const CAPTURE_PLAN = Object.freeze({ requiredProfiles: 76, additionalEndpointAllowance: 44, naiveDuplicateEndpoints: 152, captureLimit: CAPTURE_LIMIT });
const NAMES = Object.freeze(['ABCDEFGHIJKLMNOPQRST', 'BCDEFGHIJKLMNOPQRSTU', 'CDEFGHIJKLMNOPQRSTUV', 'DEFGHIJKLMNOPQRSTUVW', 'EFGHIJKLMNOPQRSTUVWX', 'FGHIJKLMNOPQRSTUVWXY', 'GHIJKLMNOPQRSTUVWXYZ']);
const SOURCE_FILES = Object.freeze([
  'apps/mobile/scripts/bang-tactile-max-ui.cjs', 'apps/mobile/scripts/bang-tactile-max-ui.test.cjs', 'apps/mobile/scripts/bang-ui-evidence.cjs',
  'apps/mobile/scripts/skull-ui-evidence.cjs', 'apps/mobile/scripts/tokyo-ui-evidence.cjs',
  'apps/mobile/app/bang/game.tsx', 'apps/mobile/app/bang/_layout.tsx',
  'apps/mobile/components/bang/Card.tsx', 'apps/mobile/components/bang/CardArtwork.tsx',
  'apps/mobile/components/bang/layout.ts', 'apps/mobile/components/bang/Hand.tsx',
  'apps/mobile/scripts/bang-hand.test.cjs', 'apps/mobile/scripts/bang-layout.test.cjs', 'apps/mobile/components/bang/useBangActions.ts',
  'apps/mobile/components/ui/CardSurface.tsx', 'apps/mobile/components/ui/GameCover.tsx',
  'apps/mobile/components/ui/ScalePressable.tsx', 'apps/mobile/components/ui/ArcadeDialog.tsx',
  'apps/mobile/hooks/useSocket.ts', 'apps/mobile/hooks/useNativeLeaveGuard.ts',
  'apps/mobile/hooks/useWebBackGuard.ts', 'apps/mobile/store/useGameStore.ts',
  'apps/mobile/lib/api.ts', 'apps/mobile/lib/storage.ts', 'apps/mobile/constants/theme.ts',
  'apps/server/src/game/bang/engine.ts', 'apps/server/src/game/bang/publicState.ts',
  'apps/server/src/game/bang/socketHandlers.ts', 'apps/server/src/routes/room.ts',
  'apps/server/src/socket/roomLifecycle.ts', 'apps/server/src/store/RoomStore.ts',
  'packages/types/src/bang.ts', 'packages/types/src/bang-constants.ts',
]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(60); }
  throw Error('Timed out: ' + label);
}
function sourceHashes() {
  const root = path.resolve(__dirname, '../../..');
  return Object.fromEntries(SOURCE_FILES.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
}
function origin(value) {
  const url = local(value);
  assert(['http:', 'https:'].includes(url.protocol) && url.pathname === '/' && !url.search && !url.hash, 'A plain loopback HTTP origin is required');
  return url.origin;
}
function configFromEnv(env) {
  assert.equal(env.BANG_TACTILE_MAX_RUN, 'true', 'Explicit seven-seat preparation opt-in required');
  assert.equal(env.BANG_UI_EXCLUSIVE_WINDOW, 'granted', 'Exclusive browser window required');
  assert(env.BANG_UI_FIXTURES !== 'true' && env.BANG_UI_FIXTURES_ONLY !== 'true', 'Maximum-seat evidence uses the ordinary API only');
  const base = origin(env.BANG_WEB_URL ?? 'http://127.0.0.1:8081');
  const api = origin(env.BANG_API_URL ?? 'http://127.0.0.1:3213');
  assert.notEqual(base, api, 'Web and ordinary API origins must be distinct');
  assert(/^[a-f0-9]{64}$/.test(env.QA_EXPECTED_WEB_SHA256 ?? ''), 'Exact expected web SHA256 required');
  assert(/^[A-Za-z0-9+/]{43}=$/.test(env.QA_BROWSER_CERT_SPKI ?? ''), 'Current local proxy SPKI required');
  assert(env.QA_STATIC_ROOT && path.isAbsolute(env.QA_STATIC_ROOT), 'Absolute frozen export required');
  assert(env.BANG_TACTILE_MAX_OUTPUT_DIR && path.isAbsolute(env.BANG_TACTILE_MAX_OUTPUT_DIR), 'Absolute fresh evidence directory required');
  assert.notEqual(path.resolve(env.BANG_TACTILE_MAX_OUTPUT_DIR), path.parse(env.BANG_TACTILE_MAX_OUTPUT_DIR).root);
  return { base, api, browserApi: 'https://localhost:3214', staticRoot: env.QA_STATIC_ROOT, hash: env.QA_EXPECTED_WEB_SHA256,
    output: env.BANG_TACTILE_MAX_OUTPUT_DIR, spki: env.QA_BROWSER_CERT_SPKI,
    browserPath: env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' };
}
function validateService(value) {
  assert.equal(value?.status, 'ok');
  assert.equal(value.service, 'zuychin-arcade-server', 'Maximum-seat gate requires the ordinary server, never a fixture service');
  assert(!Object.hasOwn(value, 'scenario') && !Object.hasOwn(value, 'expectedSeats'), 'Fixture metadata is forbidden');
}
function postOptions(body, token, webOrigin) {
  return { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Origin: origin(webOrigin), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}
async function post(config, route, body, token) {
  assert(/^\/rooms\/(create|join|[A-Z0-9-]+\/leave)$/.test(route), 'Only ordinary owned-room routes are permitted');
  return fetch(config.api + route, postOptions(body, token, config.base));
}
function ownedAuth(result, displayName) {
  const auth = result?.auth ?? result;
  assert(auth?.token && typeof auth.token === 'string' && typeof auth.playerId === 'string' && auth.playerId.length > 0);
  assert(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(auth.roomCode), 'Ordinary room code required');
  assert(NAMES.includes(displayName));
  return { token: auth.token, playerId: auth.playerId, roomCode: auth.roomCode, displayName };
}
function hasPair(seat) {
  const own = seat.private, pub = seat.public, auth = seat.auth;
  return Boolean(auth && own?.gameId === 'bang' && pub?.gameId === 'bang' && own.playerId === auth.playerId
    && own.roomCode === auth.roomCode && pub.roomCode === auth.roomCode && Number.isInteger(pub.revision) && pub.revision >= 0 && own.revision === pub.revision);
}
function assertPair(seat) {
  assert(hasPair(seat), 'Capture requires the authenticated private/public pair');
  assert.deepEqual(publicPrivacy(seat.public), [], 'Public projection leaked private information');
}
function assertMountedSeats(rendered, state) {
  assert.equal(rendered.length, 7, 'Every public seat must remain mounted');
  assert.equal(new Set(rendered.map(seat => seat.id)).size, 7);
  for (const player of state.players) {
    const seat = rendered.find(row => row.id === 'bang-seat-' + player.playerId);
    assert(seat && seat.text.includes(player.displayName), 'Public station lost its exact complete name');
    if (state.status === 'game_over') {
      assert(Array.isArray(seat.statusTexts), 'Terminal station status nodes must be inspected');
      assert(!seat.statusTexts.some(text => /^(?:TAKING TURN|Active seat(?:\s*·.*)?|Distance\s+\d+(?:\s*·.*)?)$/i.test(text.trim())), 'Terminal station retained live turn or numeric distance copy');
    }
    assert(typeof seat.roleText === 'string', 'Public role badge must remain inspectable');
    if (player.role === null) {
      assert(seat.roleText.includes('Hidden role'));
      assert(!/\b(sheriff|deputy|outlaw|renegade)\b/i.test(seat.roleText + ' ' + seat.roleLabels.join(' ')), 'Concealed badge exposed role metadata');
    } else {
      const label = player.role[0].toUpperCase() + player.role.slice(1);
      assert(seat.roleText.includes(label), 'Revealed badge must match its actual public role');
    }
  }
}
function readTerminalCopy() {
  return { caption: document.querySelector('#bang-table-context')?.textContent ?? null,
    stations: [...document.querySelectorAll('[id^="bang-seat-"]')].map(node => ({ id: node.id, statusTexts: [...node.children].map(child => child.textContent.trim()) })) };
}
function assertTerminalCopy(copy, rendered, state) {
  assert.equal(state.status, 'game_over');
  assert.equal(copy.caption, 'Final table in clockwise seat order. All roles are revealed.', 'Terminal table caption must describe final order');
  assert.equal(copy.stations.length, 7);
  assert.equal(new Set(copy.stations.map(seat => seat.id)).size, 7);
  assertMountedSeats(rendered.map(seat => ({ ...seat, statusTexts: copy.stations.find(row => row.id === seat.id)?.statusTexts })), state);
  return { caption: copy.caption, stationsChecked: 7, noLiveTurnOrNumericDistance: true };
}
function selectOwners(state, seats, hostId) {
  assert.equal(state.status, 'playing');
  assert.equal(state.players.length, 7);
  assert.equal(new Set(state.players.map(p => p.playerId)).size, 7);
  assert.equal(seats.length, 7);
  const sheriffs = state.players.filter(p => p.role === 'sheriff');
  assert.equal(sheriffs.length, 1, 'Select the actual public Sheriff, never infer from host');
  const sheriff = seats.find(s => s.auth.playerId === sheriffs[0].playerId);
  assert(sheriff);
  const nonSheriffs = state.players.filter(p => p.playerId !== sheriff.auth.playerId);
  assert(nonSheriffs.every(p => p.role === null && p.alive), 'Browser owners must be concealed live non-Sheriffs');
  const ordered = [...nonSheriffs].sort((a, b) => Number(b.playerId === hostId) - Number(a.playerId === hostId));
  const owners = ordered.slice(0, 2).map(p => seats.find(s => s.auth.playerId === p.playerId));
  assert(owners.every(Boolean));
  return { sheriff, owners };
}
function capturePlan(players, owners) {
  assert.equal(players.length, 7); assert.equal(owners.length, 2);
  assert(owners.every(owner => owner.private?.hand?.[0]?.id), 'Each browser owner must have an actual private card to frame');
  return owners.flatMap((owner, ownerIndex) => [
    ...players.map(player => ({ ownerId: owner.auth.playerId, phase: 'playing', selector: '#bang-seat-' + player.playerId, name: player.displayName, label: 'station-' + players.indexOf(player), edge320: false })),
    { ownerId: owner.auth.playerId, phase: 'playing', selector: '#bang-card-hand-' + owner.private.hand[0]?.id, label: 'own-hand-card', edge320: ownerIndex === 0 },
    ...players.map(player => ({ ownerId: owner.auth.playerId, phase: 'game_over', selector: '#bang-result-row-' + player.playerId, name: player.displayName, label: 'result-' + players.indexOf(player), edge320: false })),
    { ownerId: owner.auth.playerId, phase: 'game_over', selector: '#bang-result-summary', label: 'result-actions', edge320: ownerIndex === 0 },
    { ownerId: owner.auth.playerId, phase: 'game_over', selector: '#bang-table-context', label: 'terminal-table-context', edge320: false },
    { ownerId: owner.auth.playerId, phase: 'game_over', selector: '#bang-seat-' + owner.auth.playerId, name: owner.name, label: 'terminal-own-station', edge320: false },
  ]);
}
function assertCaptureCoverage(plan, proofs, owners) {
  const expected = plan.flatMap(job => {
    const ownerIndex = owners.findIndex(owner => owner.auth.playerId === job.ownerId);
    assert(ownerIndex >= 0);
    return [ownerIndex === 0 ? 375 : 1280, ...(job.edge320 ? [320] : [])].flatMap(width => [100, 200].map(scale => ({ job, width, scale })));
  });
  assert.equal(proofs.length, expected.length, 'Every required owner, surface, size and scale must have a complete framing proof');
  for (const { job, width, scale } of expected) {
    const matches = proofs.filter(p => p.ownerId === job.ownerId && p.phase === job.phase && p.selector === job.selector && p.viewport.width === width && p.scale === scale);
    assert.equal(matches.length, 1, 'Missing or duplicate maximum-seat proof');
    assert(matches[0].complete && matches[0].phase === job.phase);
    if (job.phase === 'game_over') assert(matches[0].terminalCopyChecked, 'Terminal proof must inspect live-copy absence');
    assert.deepEqual(matches[0].endpoints, ['start', 'end']);
  }
}
function packet(value) {
  if (typeof value !== 'string' || !value.startsWith('42')) return null;
  try { const parsed = JSON.parse(value.slice(2)); return Array.isArray(parsed) ? parsed : null; } catch { return null; }
}
function observe(seat, event, payload, qa) {
  if (event === 'game_state' && payload?.gameId === 'bang') seat.public = payload;
  if (event === 'private_state' && payload?.gameId === 'bang') seat.private = payload;
  if (event === 'room_updated') seat.room = payload;
  if (event === 'bang:action_accepted') seat.accepted.push(payload);
  if (['action_rejected', 'server_error'].includes(event)) {
    qa.evidence.socketIssues.push({ actor: seat.name, event, message: redact(payload?.message ?? payload?.reason ?? 'Unknown error', [...qa.secrets]) }); qa.persist();
  }
}
async function createSocketSeat(config, name, roomCode, qa, seats) {
  const response = await post(config, roomCode ? '/rooms/join' : '/rooms/create', { displayName: name, ...(roomCode ? { roomCode } : { gameId: 'bang' }) });
  assert.equal(response.status, roomCode ? 200 : 201);
  const result = await response.json();
  const auth = ownedAuth(result, name); qa.secrets.add(auth.token);
  const seat = { auth, name, room: result.room, public: null, private: null, accepted: [], sent: [], cleaning: false, browserOwner: false };
  seats.push(seat);
  seat.socket = io(config.api, { auth: { token: auth.token }, autoConnect: false, transports: ['websocket'], reconnection: false, timeout: 10000, extraHeaders: { Origin: config.base } });
  for (const event of ['game_state', 'private_state', 'room_updated', 'bang:action_accepted', 'action_rejected', 'server_error']) seat.socket.on(event, payload => { if (!seat.browserOwner) observe(seat, event, payload, qa); });
  seat.socket.on('connect_error', error => { qa.evidence.socketIssues.push({ actor: name, event: 'connect_error', message: redact(error.message, [...qa.secrets]) }); qa.persist(); });
  seat.socket.on('disconnect', reason => {
    if (!seat.cleaning && !seat.expectedReplacement) { qa.evidence.socketIssues.push({ actor: name, event: 'unexpected-disconnect', reason }); qa.persist(); }
  });
  seat.socket.connect();
  await until(() => seat.socket.connected, 'owned synthetic socket connection');
  return seat;
}
async function recordResponse(response, seat, qa) {
  try {
    const url = new URL(response.url());
    if (qa.origins.has(url.origin) && response.request().method() === 'POST' && url.pathname === '/rooms/' + seat.auth.roomCode + '/leave') {
      qa.evidence.cleanup.push({ actor: seat.name, playerId: seat.auth.playerId, mode: 'browser-ui', normalUI: true, status: response.status(), authCleared: false }); qa.persist();
    }
  } catch (error) { qa.evidence.consoleIssues.push({ actor: seat.name, event: 'response-observer', message: redact(error.message, [...qa.secrets]) }); qa.persist(); }
}
async function adoptBrowserOwner(browser, config, qa, seat, desktop, browsers) {
  seat.context = await browser.createBrowserContext(); browsers.push(seat);
  seat.page = await seat.context.newPage(); qa.register(seat);
  await seat.page.setViewport({ width: desktop ? 1280 : 375, height: desktop ? 900 : 844, deviceScaleFactor: 1, isMobile: !desktop, hasTouch: !desktop });
  await guardNetwork(seat.page, qa.origins, qa.evidence.blockedRequests);
  await seat.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  seat.page.on('response', response => recordResponse(response, seat, qa));
  seat.page.on('pageerror', error => { qa.evidence.consoleIssues.push({ actor: seat.name, event: 'pageerror', message: redact(error.message, [...qa.secrets]) }); qa.persist(); });
  seat.page.on('console', message => {
    if (['warning', 'error'].includes(message.type()) && !message.text().includes('[Reanimated] Reduced motion')) {
      qa.evidence.consoleIssues.push({ actor: seat.name, event: message.type(), message: redact(message.text(), [...qa.secrets]) }); qa.persist();
    }
  });
  seat.cdp = await seat.page.createCDPSession(); await seat.cdp.send('Network.enable');
  seat.cdp.on('Network.webSocketCreated', ({ url }) => {
    if (new URL(url).origin.replace(/^ws/, 'http') !== config.browserApi) {
      qa.evidence.socketIssues.push({ actor: seat.name, event: 'wrong-browser-api-origin' }); qa.persist();
    }
  });
  seat.cdp.on('Network.webSocketFrameReceived', ({ response }) => { const p = packet(response.payloadData); if (p) observe(seat, p[0], p[1], qa); });
  seat.cdp.on('Network.webSocketFrameSent', ({ response }) => { const p = packet(response.payloadData); if (p && (p[0] === 'start_game' || p[0].startsWith('bang:'))) seat.sent.push(p[0]); });
  const adoption = await seat.page.evaluateOnNewDocument(({ auth, base }) => {
    if (location.origin === base && !sessionStorage.getItem('za:max-seat-adopted')) {
      sessionStorage.setItem('za:auth', JSON.stringify(auth)); sessionStorage.setItem('za:max-seat-adopted', 'true');
    }
  }, { auth: seat.auth, base: config.base });
  seat.expectedReplacement = true; seat.browserOwner = true; seat.public = null; seat.private = null;
  await seat.page.goto(config.base + '/bang/game', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await until(() => hasPair(seat) && !seat.socket.connected, 'owned browser replaces its original socket without departure');
  await seat.page.removeScriptToEvaluateOnNewDocument(adoption.identifier);
  seat.socket.disconnect();
  qa.evidence.adoptions.push({ actor: seat.name, playerId: seat.auth.playerId, oldSocketDisconnected: true, privateOwnerMatched: true, normalCreateJoin: false, viewport: seat.page.viewport() }); qa.persist();
}

function measureFrame(selector) {
  const node = document.querySelector(selector);
  if (!node) throw Error('Maximum-seat frame is missing');
  const rect = n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const visible = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
  for (let p = node.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p), r = rect(p);
    if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX)) { visible.left = Math.max(visible.left, r.left); visible.right = Math.min(visible.right, r.right); }
    if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowY)) { visible.top = Math.max(visible.top, r.top); visible.bottom = Math.min(visible.bottom, r.bottom); }
  }
  const glyphs = [], walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode, parent = text.parentElement;
    if (!text.textContent.trim() || parent.closest('[aria-hidden="true"]') || /icon|material|fontawesome/i.test(getComputedStyle(parent).fontFamily)) continue;
    glyphs.push(...window.__coupQATextGeometry(text).glyphRects);
  }
  return { text: node.textContent, bounds: rect(node), visible, glyphs };
}
function wholeFrameVisible(frame) {
  const { bounds: b, visible: v } = frame;
  return b.width > 0 && b.height > 0 && b.left >= v.left - 2 && b.right <= v.right + 2 && b.top >= v.top - 2 && b.bottom <= v.bottom + 2
    && frame.glyphs.every(g => g.left >= v.left - 2 && g.right <= v.right + 2 && g.top >= v.top - 2 && g.bottom <= v.bottom + 2);
}
function recordedFrame(frame, metrics) {
  const visible = metrics?.frameVisibleBounds;
  assert(visible && ['left', 'right', 'top', 'bottom'].every(key => Number.isFinite(visible[key])), 'Capture must record authoritative frame visibility');
  assert(visible.right >= visible.left && visible.bottom >= visible.top, 'Recorded frame visibility is invalid');
  assert(metrics.frame && ['left', 'right', 'top', 'bottom'].every(key => Number.isFinite(metrics.frame[key]) && Math.abs(frame.bounds[key] - metrics.frame[key]) <= 2), 'Frame moved after its recorded capture');
  return { ...frame, visible: {
    left: Math.max(frame.visible.left, visible.left), right: Math.min(frame.visible.right, visible.right),
    top: Math.max(frame.visible.top, visible.top), bottom: Math.min(frame.visible.bottom, visible.bottom),
  } };
}
function assertFrameCoverage(frames, expectedName) {
  assert(frames.length >= 1 && frames.length <= 2);
  const height = frames[0].bounds.height;
  assert(height > 0);
  for (const f of frames) {
    if (expectedName) assert(f.text.includes(expectedName), 'Full exact unbroken name must remain in its framed station or result');
    assert(Math.abs(f.bounds.height - height) <= 2, 'Frame geometry changed between endpoints');
    assert(f.bounds.left >= f.visible.left - 2 && f.bounds.right <= f.visible.right + 2, 'Framed node is horizontally clipped');
    assert(f.glyphs.every(g => g.left >= f.bounds.left - 2 && g.right <= f.bounds.right + 2 && g.top >= f.bounds.top - 2 && g.bottom <= f.bounds.bottom + 2), 'Live glyph escapes its owner');
  }
  if (frames.length === 1) { assert(wholeFrameVisible(frames[0]), 'One capture covers both endpoints only when the complete frame is visible'); return; }
  const slices = frames.map(f => ({ top: Math.max(0, f.visible.top - f.bounds.top), bottom: Math.min(height, f.visible.bottom - f.bounds.top) })).sort((a, b) => a.top - b.top);
  let covered = 0;
  for (const slice of slices) { assert(slice.bottom > slice.top && slice.top <= covered + 2, 'Uncaptured vertical gap between endpoints'); covered = Math.max(covered, slice.bottom); }
  assert(covered >= height - 2, 'Bottom of framed content was not captured');
}
function stampScale(qa, start, scale, baseline) {
  const attempts = qa.evidence.attempts.slice(start), files = new Set(attempts.map(a => a.file));
  for (const item of [...attempts, ...qa.evidence.captures.filter(c => files.has(c.file))]) Object.assign(item, { scale: scale ? 200 : 100, baseline });
}
async function captureJob(seat, job, qa) {
  assertPair(seat);
  assert.equal(seat.public.status, job.phase);
  const original = seat.page.viewport();
  const viewports = [original, ...(job.edge320 ? [{ ...original, width: 320 }] : [])];
  assert(!job.edge320 || original.hasTouch, '320 supplement must retain a touch owner');
  try {
    for (const viewport of viewports) {
      await seat.page.setViewport(viewport);
      for (const scale of [false, true]) {
        await qa.ready(seat.page);
        const start = qa.evidence.attempts.length;
        let baseline = null;
        const frames = [], files = [], revision = seat.public.revision;
        try {
          if (scale) baseline = await enlargeBangText(seat.page);
          for (const align of ['start', 'end']) {
            assert(qa.evidence.attempts.length < CAPTURE_LIMIT, 'Maximum-seat capture budget exceeded');
            if (scale) validateBangFontState(await seat.page.evaluate(readBangFontState));
            const record = await qa.capture(seat.page, `${seat.name}-${job.label}-${viewport.width}-${scale ? 'text200' : 'normal'}-${align}.png`, { frame: job.selector, align });
            stampScale(qa, start, scale, baseline);
            record.framedElement = recordedFrame(await seat.page.evaluate(measureFrame, job.selector), record.metrics);
            if (job.phase === 'game_over') {
              const terminalCopy = assertTerminalCopy(await seat.page.evaluate(readTerminalCopy), record.metrics.seats, seat.public);
              qa.evidence.terminalCopyAssertions.push({ file: record.file, ownerId: seat.auth.playerId, revision, ...terminalCopy });
            } else assertMountedSeats(record.metrics.seats, seat.public);
            frames.push(record.framedElement); files.push(record.file);
            if (scale) {
              record.metrics.textScaleState = await seat.page.evaluate(readBangFontState);
              validateBangFontState(record.metrics.textScaleState);
            }
            assertPair(seat); assert.equal(seat.public.revision, revision, 'Read-only maximum-seat framing must not change game revision');
            qa.persist();
            if (align === 'start' && wholeFrameVisible(record.framedElement)) break;
          }
          assertFrameCoverage(frames, job.name);
          qa.evidence.proofs.push({ actor: seat.name, ownerId: seat.auth.playerId, label: job.label, phase: job.phase, viewport, scale: scale ? 200 : 100, expectedName: job.name,
            revision, selector: job.selector, files, endpoints: ['start', 'end'], sharedEndpointImage: frames.length === 1, complete: true, terminalCopyChecked: job.phase === 'game_over' });
        } finally { stampScale(qa, start, scale, baseline); qa.persist(); if (scale) await restoreBangText(seat.page); }
      }
    }
  } finally { await seat.page.setViewport(original); }
}
async function activate(seat, label) {
  const selector = '[role="button"],button';
  await until(() => seat.page.$$eval(selector, (nodes, label) => nodes.some(n => (n.getAttribute('aria-label') ?? n.textContent).trim() === label && !n.hasAttribute('disabled') && n.getAttribute('aria-disabled') !== 'true'), label), 'enabled ' + label);
  const controls = await seat.page.$$(selector);
  try {
    for (const control of controls) {
      if (!await control.evaluate((n, label) => (n.getAttribute('aria-label') ?? n.textContent).trim() === label && n.getBoundingClientRect().height > 0 && !n.closest('[aria-hidden="true"]'), label)) continue;
      await control.evaluate(n => n.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      const box = await control.boundingBox(); assert(box && box.width >= 48 && box.height >= 48, 'Exit control must meet 48px floor');
      if (seat.page.viewport().hasTouch) await control.tap(); else { await control.focus(); await seat.page.keyboard.press('Enter'); }
      return;
    }
    throw Error('Visible exit control missing: ' + label);
  } finally { await Promise.all(controls.map(control => control.dispose())); }
}
async function leaveSocket(config, seat, qa, deliberate = false) {
  seat.cleaning = true;
  try {
    const response = await post(config, '/rooms/' + seat.auth.roomCode + '/leave', undefined, seat.auth.token);
    qa.evidence.cleanup.push({ actor: seat.name, playerId: seat.auth.playerId, mode: 'socket-owner-rest', normalUI: false, deliberateSheriffForfeit: deliberate, status: response.status });
    assert.equal(response.status, 200, 'Owned socket departure must return HTTP200'); seat.left = true;
  } finally { seat.socket?.disconnect(); qa.persist(); }
}
async function cleanupBrowser(config, seat, qa) {
  try {
    await activate(seat, seat.public?.status === 'game_over' ? 'BACK TO ARCADE' : 'Leave table');
    await activate(seat, seat.public?.status === 'game_over' ? 'LEAVE TABLE' : 'FORFEIT AND LEAVE');
    await until(() => seat.page.evaluate(() => sessionStorage.getItem('za:auth') === null && location.pathname === '/'), 'normal UI exit clears owned credentials');
    await until(() => qa.evidence.cleanup.some(row => row.playerId === seat.auth.playerId && row.mode === 'browser-ui' && row.status === 200), 'normal leave response receipt');
    const receipt = qa.evidence.cleanup.find(row => row.playerId === seat.auth.playerId && row.mode === 'browser-ui' && row.status === 200);
    receipt.authCleared = true; seat.left = true;
  } catch (error) {
    qa.evidence.cleanup.push({ actor: seat.name, mode: 'browser-ui', uiError: redact(error.message, [...qa.secrets]) });
    try {
      const response = await post(config, '/rooms/' + seat.auth.roomCode + '/leave', undefined, seat.auth.token);
      qa.evidence.cleanup.push({ actor: seat.name, mode: 'browser-fallback', fallback: true, normalUI: false, status: response.status });
      seat.left = response.status === 200;
    } catch (fallbackError) { qa.evidence.cleanup.push({ actor: seat.name, mode: 'browser-fallback', fallback: true, error: redact(fallbackError.message, [...qa.secrets]) }); }
  } finally {
    await seat.cdp?.detach().catch(() => undefined);
    try { await seat.context.close(); qa.evidence.contextsClosed.push(seat.name); }
    catch (error) { qa.evidence.cleanup.push({ actor: seat.name, contextError: redact(error.message, [...qa.secrets]) }); }
    qa.persist();
  }
}
function completionStatus(evidence) {
  const ui = evidence.cleanup.filter(row => row.mode === 'browser-ui' && row.normalUI && row.status === 200 && row.authCleared);
  const sockets = evidence.cleanup.filter(row => row.mode === 'socket-owner-rest' && row.status === 200);
  const cleanupComplete = ui.length === 2 && sockets.length === 5 && new Set([...ui, ...sockets].map(row => row.playerId)).size === 7
    && new Set(evidence.contextsClosed).size === 2 && evidence.browserClosed && !evidence.cleanup.some(row => row.error || row.uiError || row.contextError || row.browserError || row.fallback);
  return { cleanupComplete: Boolean(cleanupComplete), passed: Boolean(cleanupComplete && evidence.scenarioComplete && !evidence.failure && !evidence.watchdogExpired
    && evidence.findings.length === 0 && evidence.blockedRequests.length === 0 && evidence.socketIssues.length === 0 && evidence.consoleIssues.length === 0) };
}
async function main() {
  const config = configFromEnv(process.env);
  assert(!fs.existsSync(config.output), 'Preserve existing evidence; choose a fresh directory');
  fs.mkdirSync(config.output, { recursive: true });
  const qa = createEvidence({ outputDir: config.output, base: config.base, api: config.api });
  Object.assign(qa.evidence, { method: 'Seven ordinary API seats. Two non-Sheriff seats adopt only their own generated QA sessions into independent browsers; five stay on sockets. Read-only maximum-seat layout, then deliberate Sheriff REST forfeit. Not normal create/join coverage, natural gameplay, independent human play, native fontScale or physical-device evidence.',
    captureBudget: CAPTURE_LIMIT, capturePlanning: CAPTURE_PLAN, watchdogMs: WATCHDOG_MS, expectedSeats: 7, scenarioComplete: false, adoptions: [], proofs: [], terminalCopyAssertions: [], socketIssues: [], consoleIssues: [], contextsClosed: [],
    gaps: ['Ordinary main journey covers normal browser create/join and natural game completion.', 'Only two owners are rendered; five other owned seats use authenticated sockets.', 'Two endpoint screenshots cannot prove a frame taller than their combined visible coverage; that condition fails this gate.'] });
  let browser = null, watchdog = null; const seats = [], browsers = [];
  const health = async () => { const response = await fetch(config.api, { redirect: 'error', signal: AbortSignal.timeout(10000) }); assert.equal(response.status, 200); const value = await response.json(); validateService(value); return value; };
  try {
    qa.evidence.sourceHashes = sourceHashes(); qa.persist();
    qa.evidence.service = await health();
    qa.evidence.bundle = await bundleFence(config.base + '/bang', config.staticRoot, config.hash);
    const entry = path.resolve(config.staticRoot, '.' + qa.evidence.bundle.script);
    assert(fs.readFileSync(entry, 'utf8').includes(config.browserApi), 'Frozen web bundle must use the expected local browser API');
    qa.persist();
    browser = await puppeteer.launch({ executablePath: config.browserPath, headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + config.spki] });
    watchdog = setTimeout(() => { qa.evidence.watchdogExpired = true; qa.persist(); void browser.close(); }, WATCHDOG_MS);
    await qa.calibrate(browser);
    const host = await createSocketSeat(config, NAMES[0], null, qa, seats);
    for (const name of NAMES.slice(1)) await createSocketSeat(config, name, host.auth.roomCode, qa, seats);
    await until(() => host.room?.players.filter(p => p.isConnected && !p.hasLeft).length === 7, 'all seven ordinary seats connected');
    host.socket.emit('start_game');
    await until(() => seats.every(hasPair) && host.accepted.some(a => a.action === 'start'), 'ordinary seven-seat game start');
    seats.forEach(assertPair);
    assert.deepEqual(host.public.players.map(p => p.displayName).sort(), [...NAMES].sort());
    const { sheriff, owners } = selectOwners(host.public, seats, host.auth.playerId);
    const players = host.public.players.map(p => ({ playerId: p.playerId, displayName: p.displayName }));
    qa.evidence.selection = { originalHost: host.auth.playerId, publicSheriff: sheriff.auth.playerId, browserOwners: owners.map(s => s.auth.playerId), usedOnlyPublicRoles: true }; qa.persist();
    for (let i = 0; i < owners.length; i++) await adoptBrowserOwner(browser, config, qa, owners[i], i === 1, browsers);
    await until(() => seats.every(hasPair) && owners.every(s => s.room?.players.filter(p => p.isConnected && !p.hasLeft).length === 7), 'all seven seats paired and connected after adoption');
    assert(owners.every(s => s.private.hand.length > 0));
    const plan = capturePlan(players, owners); qa.evidence.plan = plan; qa.persist();
    for (const job of plan.filter(job => job.phase === 'playing')) await captureJob(owners.find(s => s.auth.playerId === job.ownerId), job, qa);
    assert(owners.every(s => s.sent.length === 0), 'Layout inspection must not issue gameplay commands');
    const before = owners[0].public.revision;
    await leaveSocket(config, sheriff, qa, true);
    await until(() => owners.every(s => hasPair(s) && s.public.status === 'game_over' && s.public.revision > before), 'ordinary Sheriff-forfeit terminal');
    for (const owner of owners) {
      assert.equal(owner.public.players.length, 7); assert(owner.public.players.find(p => p.playerId === sheriff.auth.playerId)?.forfeited);
      assert(owner.public.players.every(p => p.role !== null), 'Terminal roles must come from actual revealed projection');
    }
    qa.evidence.terminal = { deliberateForfeit: true, naturalGame: false, sheriffId: sheriff.auth.playerId, revision: owners[0].public.revision, winner: owners[0].public.winner,
      players: owners[0].public.players.map(p => ({ playerId: p.playerId, displayName: p.displayName, role: p.role, character: p.character, alive: p.alive, forfeited: p.forfeited })) }; qa.persist();
    for (const job of plan.filter(job => job.phase === 'game_over')) await captureJob(owners.find(s => s.auth.playerId === job.ownerId), job, qa);
    assert(owners.every(s => s.sent.length === 0), 'Result inspection must not start another game');
    assertCaptureCoverage(plan, qa.evidence.proofs, owners);
    qa.evidence.finalBundle = await bundleFence(config.base + '/bang', config.staticRoot, config.hash);
    await health(); qa.evidence.scenarioComplete = true;
  } catch (error) { qa.evidence.failure = redact(error.stack ?? error.message, [...qa.secrets]); }
  finally {
    if (watchdog) clearTimeout(watchdog);
    for (const seat of browsers.slice().reverse()) await cleanupBrowser(config, seat, qa);
    for (const seat of seats.filter(s => !browsers.includes(s) && !s.left)) {
      try { await leaveSocket(config, seat, qa); }
      catch (error) { qa.evidence.cleanup.push({ actor: seat.name, mode: 'socket-owner-rest', error: redact(error.message, [...qa.secrets]) }); }
    }
    for (const seat of seats) { seat.cleaning = true; seat.socket?.disconnect(); }
    try { if (browser) { await browser.close(); qa.evidence.browserClosed = true; } }
    catch (error) { qa.evidence.cleanup.push({ browserError: redact(error.message, [...qa.secrets]) }); }
    try { qa.evidence.finalSourceHashes = sourceHashes(); assert.deepEqual(qa.evidence.finalSourceHashes, qa.evidence.sourceHashes, 'Source changed during maximum-seat evidence'); }
    catch (error) { qa.evidence.failure ??= redact(error.message, [...qa.secrets]); }
    Object.assign(qa.evidence, completionStatus(qa.evidence)); qa.persist();
  }
  console.log(JSON.stringify({ output: config.output, passed: qa.evidence.passed, captures: qa.evidence.captures.length, browserClosed: qa.evidence.browserClosed }));
  if (!qa.evidence.passed) process.exitCode = 1;
}

module.exports = { CAPTURE_LIMIT, CAPTURE_PLAN, WATCHDOG_MS, NAMES, SOURCE_FILES, configFromEnv, validateService, postOptions, ownedAuth, hasPair, assertMountedSeats, readTerminalCopy, assertTerminalCopy, selectOwners, capturePlan, assertCaptureCoverage,
  packet, wholeFrameVisible, recordedFrame, assertFrameCoverage, completionStatus, recordResponse, sourceHashes };
if (require.main === module) main().catch(error => { console.error(redact(error.message)); process.exitCode = 1; });
