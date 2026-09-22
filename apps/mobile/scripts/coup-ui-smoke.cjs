const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-core');

const BASE_URL = process.env.COUP_WEB_URL ?? 'http://127.0.0.1:8081';
const BROWSER_PATH = process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CERT = process.env.QA_BROWSER_CERT_SPKI;
const CONFIRM_ONLY = process.env.COUP_UI_CONFIRM_ONLY === 'true';
const outputDir = path.resolve(process.env.COUP_EVIDENCE_DIR ?? path.join(__dirname, '../../../.tmp-qa-evidence/2026-09-20/coup/candidate'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const evidence = { method: 'Automated isolated browser seats, not manual Astra play. Acting seat projections and rendered legal targets only.', decisions: [], viewports: [], screenshots: [], issues: [] };
const API_URL = process.env.COUP_API_URL ?? 'http://127.0.0.1:3213';
const allowedOrigins = new Set([new URL(BASE_URL).origin, new URL(API_URL).origin, 'https://localhost:3214']);
const ownedSeats = new Set(), secrets = new Set([' court pass ']);
const local = url => ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sanitise = value => { let text = String(value); for (const secret of secrets) text = text.split(secret).join('[redacted]'); return text.replace(/Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]'); };
Object.assign(evidence, { captures: [], cleanup: [], blockedRequests: [], visualFindings: [], rawRangeDiagnostics: [], touchInteractions: [], coverage: 'One complete ordinary match, then monotonic rematch start and deliberate departures. Not a second full match or physical native-device evidence.' });
let screenshotSequence = 0;
const roles = ['duke', 'assassin', 'captain', 'ambassador', 'contessa', 'inquisitor'];
const artHashes = Object.fromEntries(roles.map(role => [role, hash(fs.readFileSync(path.resolve(__dirname, '../assets/game-art/coup-character-' + role + '.webp')))]));
const seenArt = new Set(), checkedChoices = new Set(), checkedLoss = new Set();
const imageHashes = new Map();
let logReviewed = false;
Object.assign(evidence, { artwork: [], artworkSources: artHashes, hiddenCards: [], choiceCaptures: [], textScaleDiagnostics: [], captureAttempts: [] });
function persist() { fs.writeFileSync(path.join(outputDir, 'receipt.json'), sanitise(JSON.stringify(evidence, null, 2))); }
async function verifyBundle() {
  assert([...allowedOrigins].every(origin => local(new URL(origin))), 'Loopback origins only');
  const expected = process.env.COUP_EXPECTED_SHA256 ?? process.env.QA_EXPECTED_WEB_SHA256;
  assert(/^[a-f0-9]{64}$/i.test(expected ?? ''), 'Expected bundle SHA required');
  const response = await fetch(BASE_URL, { redirect: 'error', signal: AbortSignal.timeout(10000) }); assert(response.ok, 'HTML HTTP ' + response.status);
  const html = await response.text(), entry = html.match(/src=["']([^"']*\/_expo\/static\/js\/web\/(?:index|entry)-[a-f0-9]+\.js)/)?.[1]; assert(entry, 'Missing served bundle');
  const url = new URL(entry, BASE_URL); assert(url.origin === new URL(BASE_URL).origin, 'Foreign bundle');
  const bundle = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) }); assert(bundle.ok, 'Bundle HTTP ' + bundle.status);
  const root = process.env.QA_STATIC_ROOT ?? path.resolve(__dirname, '../.expo-export-qa-web');
  assert(fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes(path.basename(url.pathname)), 'Disk HTML entry differs');
  const servedHash = hash(new Uint8Array(await bundle.arrayBuffer())), diskHash = hash(fs.readFileSync(path.join(root, '_expo/static/js/web', path.basename(url.pathname))));
  evidence.bundle = { entry: path.basename(url.pathname), sha256: servedHash, servedHash, diskHash, expected };
  assert(servedHash === expected.toLowerCase() && diskHash === servedHash, 'Served/disk/expected bundle mismatch');
}
async function until(check, label, timeout = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await check()) return; await delay(70); }
  throw new Error('Timed out: ' + label);
}
function packet(data) { if (!data.startsWith('42')) return null; try { return JSON.parse(data.slice(2)); } catch { return null; } }
function paired(seat) { return seat.public?.gameId === 'coup' && seat.private?.gameId === 'coup' && Number.isSafeInteger(seat.public.revision) && seat.public.revision >= 0 && seat.public.revision === seat.private.revision && seat.public.roomCode === seat.private.roomCode && seat.public.players.some((player) => player.playerId === seat.private.playerId) && (!seat.auth || (seat.private.playerId === seat.auth.playerId && seat.private.roomCode === seat.auth.roomCode)); }

async function actor(browser, name, width = 390) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  const seat = { context, page, name, public: null, private: null, room: null, accepted: [], rejected: [], sent: [], offline: false, touch: width < 900, auth: null, socketSequence: 0, frames: { public: 0, private: 0 }, frameSockets: {}, leaveResponses: [], transactions: new Set() };
  ownedSeats.add(seat);
  assert([...allowedOrigins].every(origin => local(new URL(origin))), 'Loopback origins only');
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if ((allowedOrigins.has(url.origin) && local(url)) || ['data:', 'blob:', 'about:'].includes(url.protocol)) void request.continue();
    else { evidence.blockedRequests.push({ name, hostname: url.hostname, protocol: url.protocol }); void request.abort(); }
  });
  await page.evaluateOnNewDocument(origins => {
    const NativeSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeSocket, { construct(target, args) {
      const url = new URL(String(args[0]), location.href), origin = url.origin.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
      if (!origins.includes(origin) || url.username || url.password) throw new Error('QA blocked non-local WebSocket');
      return Reflect.construct(target, args);
    } });
  }, [...allowedOrigins]);
  page.on('response', response => {
    const url = new URL(response.url()); if (!allowedOrigins.has(url.origin) || response.request().method() !== 'POST') return;
    if (/\/rooms\/[^/]+\/leave$/.test(url.pathname)) seat.leaveResponses.push(response.status());
    if (/\/rooms\/(create|join)$/.test(url.pathname) && response.ok()) {
      const pending = response.json().then(body => {
        assert(typeof body.token === 'string' && typeof body.playerId === 'string' && typeof body.roomCode === 'string', 'Malformed owned authentication response');
        secrets.add(body.token); seat.auth = { token: body.token, playerId: body.playerId, roomCode: body.roomCode };
      }).catch(() => evidence.issues.push({ name, type: 'owned-auth-capture' }));
      seat.transactions.add(pending); void pending.finally(() => seat.transactions.delete(pending));
    }
  });
  await page.setViewport({ width, height: 844, deviceScaleFactor: 1, isMobile: seat.touch, hasTouch: seat.touch, isLandscape: width > 844 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('console', (message) => {
    if (seat.expectedPasswordError && /Failed to load resource.*(?:401|403)/.test(message.text())) return;
    if (!seat.offline && ['warning', 'error'].includes(message.type()) && !message.text().includes('[Reanimated] Reduced motion')) evidence.issues.push({ name, type: message.type(), text: sanitise(message.text()) });
  });
  page.on('pageerror', (error) => evidence.issues.push({ name, type: 'pageerror', text: sanitise(error.message) }));
  const cdp = await page.createCDPSession(); await cdp.send('Network.enable');
  cdp.on('Network.webSocketCreated', ({ requestId }) => { seat.socketRequestId = requestId; seat.socketSequence++; });
  cdp.on('Network.webSocketFrameReceived', ({ response, requestId }) => {
    if (requestId !== seat.socketRequestId) return;
    const data = packet(response.payloadData); if (!data) return;
    if (data[0] === 'game_state' && data[1]?.gameId === 'coup') { seat.public = data[1]; seat.frames.public++; seat.frameSockets.public = seat.socketSequence; }
    if (data[0] === 'private_state' && data[1]?.gameId === 'coup') { seat.private = data[1]; seat.frames.private++; seat.frameSockets.private = seat.socketSequence; }
    if (data[0] === 'room_updated') seat.room = data[1];
    if (data[0] === 'coup:action_accepted') { seat.accepted.push(data[1]); seat.lastAcceptedAt = Date.now(); }
    if (data[0] === 'action_rejected') seat.rejected.push(data[1]);
  });
  cdp.on('Network.webSocketFrameSent', ({ response, requestId }) => {
    if (requestId !== seat.socketRequestId) return;
    const data = packet(response.payloadData);
    if (data && ['coup:action', 'coup:respond', 'coup:lose_influence', 'coup:exchange', 'coup:resolve_challenge', 'start_game'].includes(data[0])) seat.sent.push(data);
  });
  await page.goto(BASE_URL + '/coup', { waitUntil: 'domcontentloaded' });
  await until(() => page.$('input[aria-label="Your name"]'), name + ' landing'); return seat;
}
async function input(page, label, value) {
  const field = await page.$('input[aria-label="' + label + '"]'); assert(field, 'Missing input ' + label);
  await field.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' })); await activate(page, field); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace');
  if (value) await page.keyboard.type(value); await field.dispose();
}
async function findButton(page, label) {
  for (const element of await page.$$('[role="button"],button')) {
    const match = await element.evaluate((node, expected) => {
      const rect = node.getBoundingClientRect();
      const dialogs = [...document.querySelectorAll('[aria-modal="true"]')].filter((dialog) => dialog.getBoundingClientRect().width > 0);
      const modal = dialogs.at(-1);
      return (!modal || modal.contains(node)) && (node.getAttribute('aria-label') ?? node.textContent)?.trim() === expected && rect.width > 0 && rect.height > 0 && !node.closest('[aria-hidden="true"]') && node.getAttribute('aria-disabled') !== 'true' && !node.hasAttribute('disabled');
    }, label);
    if (match) return element; await element.dispose();
  }
  return null;
}
async function click(page, label) {
  await until(async () => { const el = await findButton(page, label); await el?.dispose(); return !!el; }, label);
  const el = await findButton(page, label); await el.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await activate(page, el);
  await el.dispose(); await delay(80);
}
async function activate(page, element) {
  if (!page.viewport().hasTouch) { await element.click(); return; }
  const metrics = await element.evaluate(node => {
    const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { label: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 100), x: r.x, y: r.y, width: r.width, height: r.height, touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, hit: !!hit && (hit === node || node.contains(hit)) };
  });
  evidence.touchInteractions.push(metrics); assert(metrics.touchPoints === 1 && metrics.coarse && metrics.hit, 'Touch target unavailable'); await element.tap();
}
async function settleLayout(page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await new Promise(resolve => setTimeout(resolve, 100)); });
}
async function setViewport(seat, width, height = 844) {
  const requested = { width, height, deviceScaleFactor: 1, isMobile: seat.touch, hasTouch: seat.touch, isLandscape: width > height };
  if (JSON.stringify(seat.page.viewport()) !== JSON.stringify(requested)) await seat.page.setViewport(requested);
  if (seat.auth) {
    await until(() => seat.room?.players.some(p => p.playerId === seat.auth.playerId && p.isConnected) && (!seat.public || paired(seat)), 'owned connected capture state');
    await until(() => seat.page.evaluate(() => !/Reconnecting\. Your seat|RETRY CONNECTION|Refreshing the room/.test(document.body.innerText)), 'rendered capture recovery');
  }
  await settleLayout(seat.page);
}
async function renderedReady(seat) {
  const wait = Math.max(0, (seat.lastAcceptedAt ?? 0) + 2700 - Date.now()); if (wait) await delay(wait);
  await until(async () => {
    if (seat.public && !paired(seat)) return false;
    const rendered = await seat.page.evaluate(() => {
      const shown = node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !node.closest('[aria-hidden="true"]'); };
      return { results: !!document.getElementById('coup-results'), decision: !!document.getElementById('coup-decision-panel'),
        labels: [...document.querySelectorAll('[aria-label]')].filter(shown).map(n => n.getAttribute('aria-label')),
        transient: [...document.querySelectorAll('[aria-live]')].filter(shown).some(n => /accepted\.|SENT · WAITING FOR SERVER/.test(n.textContent)) };
    });
    if (rendered.transient) return false;
    if (!seat.public) return true;
    if (seat.public.status === 'game_over') return rendered.results;
    if (!rendered.decision) return false;
    if (seat.public.pending.waitingOn.includes(seat.private.playerId)) {
      if (seat.public.pending.phase === 'awaiting_exchange') return !!seat.private.exchange && rendered.labels.some(l => /, exchange option \d+$/.test(l));
      if (seat.public.pending.phase === 'awaiting_lose_influence') return rendered.labels.some(l => /^Lose \w+ influence$/.test(l));
    }
    return true;
  }, 'settled paired rendered phase', 6000);
  await settleLayout(seat.page);
}
async function textScale(seat, factor) {
  const baseline = await seat.page.evaluate(factor => {
    for (const { node, originalId } of window.__coupQAText ?? []) { if (originalId === null) node.removeAttribute('data-coup-qa-text'); else node.setAttribute('data-coup-qa-text', originalId); }
    delete window.__coupQAText; document.getElementById('coup-qa-text-style')?.remove();
    if (factor === 1) return null;
    const values = [], excluded = [], style = document.createElement('style'); style.id = 'coup-qa-text-style';
    style.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}';
    for (const node of document.querySelectorAll('body *')) {
      if (!node.matches('input,textarea') && ![...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) continue;
      const s = getComputedStyle(node), r = node.getBoundingClientRect(), text = node.getAttribute('aria-label') || node.textContent.trim().slice(0, 100);
      const reason = node.closest('[aria-hidden="true"]') ? 'aria-hidden' : !r.width || !r.height ? 'no-layout-box' : s.visibility !== 'visible' ? 'hidden' : /icon|material|fontawesome/i.test(s.fontFamily) ? 'icon-glyph' : null;
      if (reason) { excluded.push({ text, reason }); continue; }
      const size = parseFloat(s.fontSize); if (!Number.isFinite(size) || size <= 0) throw new Error('Visible text has invalid font size');
      values.push({ node, size, line: parseFloat(s.lineHeight), family: s.fontFamily, text, originalId: node.getAttribute('data-coup-qa-text') });
    }
    window.__coupQAText = values;
    style.textContent += values.map(({ node, size, line }, i) => { node.setAttribute('data-coup-qa-text', String(i)); return `[data-coup-qa-text="${i}"]{font-size:${size * factor}px!important;${Number.isFinite(line) ? `line-height:${line * factor}px!important;` : ''}}`; }).join('\n');
    document.head.appendChild(style);
    return { count: values.length, excluded, samples: values.map(({ size, family, text }) => ({ before: size, family, text })) };
  }, factor);
  seat.textScale = factor * 100; await settleLayout(seat.page); return baseline;
}
function installTextGeometry() {
  window.__coupQATextGeometry = node => {
    const range = node.ownerDocument.createRange();
    const rects = () => [...range.getClientRects()].map(r => ({ x: r.x, y: r.y, left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
    range.selectNodeContents(node);
    const rawRects = rects(), characters = [];
    let offset = 0;
    for (const character of node.textContent) {
      const end = offset + character.length;
      range.setStart(node, offset); range.setEnd(node, end);
      characters.push({ character, start: offset, end, whitespace: /^\s$/u.test(character), rects: rects() });
      offset = end;
    }
    return { text: node.textContent, rawRects, characters, glyphRects: characters.filter(c => !c.whitespace).flatMap(c => c.rects.map(r => ({ character: c.character, start: c.start, end: c.end, ...r }))) };
  };
  window.__coupQAOverflowProof = (geometry, bounds, x = true, y = false, tolerance = 1) => {
    const outside = r => (x && (r.left < bounds.left - tolerance || r.right > bounds.right + tolerance)) || (y && (r.top < bounds.top - tolerance || r.bottom > bounds.bottom + tolerance));
    const raw = geometry.flatMap(t => t.rawRects.filter(outside));
    const glyphs = geometry.flatMap(t => t.glyphRects.filter(outside));
    const whitespace = geometry.flatMap(t => t.characters.filter(c => c.whitespace).flatMap(c => c.rects.filter(outside).map(r => ({ character: c.character, start: c.start, end: c.end, ...r }))));
    const unexplained = raw.filter(r => !whitespace.some(w => ['left', 'right', 'top', 'bottom'].every(key => Math.abs(r[key] - w[key]) < 0.25)));
    return { raw, glyphs, whitespace, unexplained, classification: glyphs.length ? 'non-whitespace-overflow' : !raw.length ? 'no-overflow' : !unexplained.length && whitespace.length ? 'proven-whitespace-only' : 'unexplained-range-overflow' };
  };
}
async function calibrateTextGeometry(browser) {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setViewport({ width: 375, height: 420, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.setRequestInterception(true);
    page.on('request', request => { if (request.url() === 'about:blank') void request.continue(); else { evidence.blockedRequests.push({ context: 'geometry-calibration', reason: 'unexpected fixture request' }); void request.abort(); } });
    await page.setContent('<!doctype html><meta charset="utf-8"><style>body{background:#fff;color:#111;font:16px Arial;margin:16px}.sample{font:20px/26px monospace;overflow:hidden;border:0;background:#eee;margin:8px 0 24px}#positive{width:80px;white-space:nowrap}#wrapped{width:2ch;white-space:pre-wrap}#clear{width:300px;white-space:nowrap}</style><p>Positive control: clipped visible label</p><div class="sample" id="positive">Assassinate</div><p>Wrapped line-end whitespace control</p><div class="sample" id="wrapped">AB CD</div><p>Unclipped visible label control</p><div class="sample" id="clear">Assassinate</div>');
    await page.evaluate(() => document.fonts.ready); await settleLayout(page); await page.evaluate(installTextGeometry);
    const file = 'geometry-calibration.png';
    await page.screenshot({ path: path.join(outputDir, file), fullPage: false });
    const samples = await page.evaluate(() => Object.fromEntries(['positive', 'wrapped', 'clear'].map(id => {
      const node = document.getElementById(id), b = node.getBoundingClientRect(), geometry = window.__coupQATextGeometry(node.firstChild);
      const bounds = { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      return [id, { bounds, geometry, proof: window.__coupQAOverflowProof([geometry], bounds) }];
    })));
    evidence.detectorCalibration = { file, samples, passed: false, note: 'Isolated about:blank controls, no application or game state.' }; persist();
    assert(samples.positive.proof.classification === 'non-whitespace-overflow' && samples.positive.proof.glyphs.length > 0, 'Positive control missed clipped Assassinate glyphs');
    assert(samples.wrapped.proof.classification === 'proven-whitespace-only' && samples.wrapped.proof.raw.length > 0, 'Wrapped whitespace not exactly explained by code-point geometry');
    assert(samples.clear.proof.classification === 'no-overflow', 'Unclipped control reported overflow');
    evidence.detectorCalibration.passed = true; persist();
  } finally { await context.close(); }
}
async function capture(seat, name, width = 390, height = 844, options = {}) {
  assert(screenshotSequence < 180, 'Bounded capture budget exceeded');
  const attempt = { name, actor: seat.name, width, height, scale: options.scale ?? 100, revision: seat.public?.revision ?? null, phase: seat.public?.pending?.phase ?? null };
  evidence.captureAttempts.push(attempt); persist();
  await setViewport(seat, width, height);
  await renderedReady(seat);
  const scale = options.scale ?? 100;
  let baseline = null;
  const diagnostic = { ...attempt, baseline, stage: 'before-baseline' }; evidence.textScaleDiagnostics.push(diagnostic); persist();
  try {
    baseline = scale === 200 ? await textScale(seat, 2) : null;
    diagnostic.baseline = baseline; diagnostic.stage = 'baseline'; persist();
    if (options.auditAction) await seat.page.evaluate(label => {
      const button = [...document.querySelectorAll('#coup-decision-panel [role="button"]')].find(n => n.getAttribute('aria-label') === label);
      if (!button) throw new Error('Missing action wrapper: ' + label);
      button.parentElement.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    }, options.auditAction);
    if (options.auditLog) await seat.page.evaluate(which => {
      const region = document.querySelector('[aria-label="Scrollable table log"]');
      if (!region) throw new Error('Missing table log');
      const rows = [...region.querySelectorAll('*')].filter(n => [...n.childNodes].some(c => c.nodeType === Node.TEXT_NODE && c.textContent.trim()));
      const row = which === 'oldest' ? rows[0] : which === 'latest' ? rows.at(-1) : rows.reduce((a, b) => a.textContent.length >= b.textContent.length ? a : b);
      if (!row) throw new Error('Missing retained log row');
      document.querySelector('[data-coup-qa-log]')?.removeAttribute('data-coup-qa-log'); row.setAttribute('data-coup-qa-log', which);
      region.scrollIntoView({ block: 'center', behavior: 'instant' }); row.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    }, options.auditLog);
    if (options.auditLeave) {
      const rules = await findButton(seat.page, 'Open rules'); assert(rules, 'Header rules target absent');
      await rules.evaluate(n => n.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      await rules.focus(); await rules.dispose(); await seat.page.keyboard.press('Tab');
    }
    if (options.auditOrnament) await seat.page.evaluate(() => {
      const title = [...document.querySelectorAll('[role="heading"]')].find(n => n.textContent.trim() === 'COUP TABLE');
      if (!title) throw new Error('Missing lobby table title');
      title.parentElement.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    });
    if (options.scrollRegion) await seat.page.$eval(options.scrollRegion, (node, edge) => { node.scrollTop = edge === 'bottom' ? node.scrollHeight : 0; }, options.scrollEdge ?? 'top');
    if (options.frameLabel) {
      const button = await findButton(seat.page, options.frameLabel); assert(button, 'Missing capture control ' + options.frameLabel);
      await button.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })); await button.dispose();
    } else if (options.frame) await seat.page.$eval(options.frame, node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    await settleLayout(seat.page);
    diagnostic.preCapture = await seat.page.evaluate(() => (window.__coupQAText ?? []).map(({ node, size, family, text }) => ({ text, before: size, family, connected: node.isConnected, after: parseFloat(getComputedStyle(node).fontSize), afterFamily: getComputedStyle(node).fontFamily })));
    diagnostic.stage = 'pre-capture'; persist();
    const requested = seat.page.viewport(), file = `${++screenshotSequence}-${seat.name.replace(/[^a-z0-9]+/gi, '-')}-${name}-${width}x${height}-text${scale}.png`;
    await seat.page.screenshot({ path: path.join(outputDir, file), fullPage: false }); evidence.screenshots.push(file);
    await seat.page.evaluate(installTextGeometry);
    const metrics = await seat.page.evaluate(() => {
      const clipped = [];
      for (const node of document.querySelectorAll('body *')) {
        const s = getComputedStyle(node), r = node.getBoundingClientRect();
        if (!r.width || !r.height || s.visibility !== 'visible' || node.closest('[aria-hidden="true"]') || /icon|material|fontawesome/i.test(s.fontFamily)) continue;
        const texts = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()); if (!texts.length) continue;
        const boxes = texts.flatMap(child => { const range = document.createRange(); range.selectNodeContents(child); return [...range.getClientRects()]; });
        let scrollX = false, scrollY = false;
        for (let parent = node; parent; parent = parent.parentElement) {
          const p = getComputedStyle(parent), b = parent.getBoundingClientRect();
          scrollX ||= ['auto', 'scroll'].includes(p.overflowX) && parent.scrollWidth > parent.clientWidth;
          scrollY ||= ['auto', 'scroll'].includes(p.overflowY) && parent.scrollHeight > parent.clientHeight;
          const x = !scrollX && ['hidden', 'clip'].includes(p.overflowX), y = !scrollY && ['hidden', 'clip'].includes(p.overflowY);
          if (boxes.some(t => (x && (t.left < b.left - 2 || t.right > b.right + 2)) || (y && (t.top < b.top - 2 || t.bottom > b.bottom + 2)))) {
            const clip = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
            for (let owner = node.parentElement; owner; owner = owner.parentElement) {
              const css = getComputedStyle(owner), bounds = owner.getBoundingClientRect();
              if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX)) { clip.left = Math.max(clip.left, bounds.left); clip.right = Math.min(clip.right, bounds.right); }
              if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY)) { clip.top = Math.max(clip.top, bounds.top); clip.bottom = Math.min(clip.bottom, bounds.bottom); }
            }
            const geometry = texts.map(child => window.__coupQATextGeometry(child));
            const overflowProof = window.__coupQAOverflowProof(geometry, b, x, y, 2), glyphLoss = overflowProof.glyphs;
            clipped.push({ text: texts.map(t => t.textContent).join('').slice(0, 120), ancestor: parent.id || parent.tagName, x, y, geometry, glyphLoss,
              overflowProof, classification: overflowProof.classification,
              viewportVisible: boxes.some(t => t.bottom > 0 && t.top < innerHeight && t.right > 0 && t.left < innerWidth),
              visibleAfterAncestorClipping: clip.right > clip.left && clip.bottom > clip.top && boxes.some(t => t.bottom > clip.top && t.top < clip.bottom && t.right > clip.left && t.left < clip.right), clippingIntersection: clip }); break;
          }
        }
      }
      const bounds = id => { const node = document.getElementById(id); if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scrollTop: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }; };
      return { width: innerWidth, height: innerHeight, document: document.documentElement.scrollWidth, dpr: devicePixelRatio, touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches,
        clipped, layout: { seats: bounds('coup-seats'), decisions: bounds('coup-decision-panel'), results: bounds('coup-results') },
        scaled: (window.__coupQAText ?? []).map(({ node, size, family, text }) => ({ text, before: size, family, afterFamily: getComputedStyle(node).fontFamily, after: parseFloat(getComputedStyle(node).fontSize), connected: node.isConnected })),
        controls: [...document.querySelectorAll('[role="button"],button')].filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !node.closest('[aria-hidden="true"]'); }).map(node => { const r = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 80), x: r.x, y: r.y, width: r.width, height: r.height, disabled: node.getAttribute('aria-disabled') === 'true' || node.hasAttribute('disabled') }; }) };
    });
    evidence.captures.push({ file, actor: seat.name, revision: seat.public?.revision ?? null, scale, baseline, requested, actualViewport: seat.page.viewport(), metrics, note: 'Viewport-only; post-capture font identity and geometry. CSS text enlargement is not native fontScale.' });
    metrics.scrollRegions = await seat.page.$$eval('[role="region"]', nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label'), x: r.x, y: r.y, width: r.width, height: r.height, scrollTop: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }; }));
    if (options.frame) {
      metrics.frame = await seat.page.$eval(options.frame, node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    }
    if (options.auditAction || options.auditLog || options.auditLeave || options.auditOrnament || options.auditCover) {
      metrics.targeted = await seat.page.evaluate(rule => {
        const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        const text = node => [...node.querySelectorAll('*'), node].filter(n => getComputedStyle(n).opacity !== '0').flatMap(n => [...n.childNodes].filter(c => c.nodeType === Node.TEXT_NODE && c.textContent.trim()).map(c => { const geometry = window.__coupQATextGeometry(c); return { ...geometry, rects: geometry.rawRects }; }));
        const glyphLoss = (texts, bounds) => texts.flatMap(t => t.glyphRects.filter(r => r.x < Math.max(0, bounds.x) - 1 || r.right > Math.min(innerWidth, bounds.right) + 1));
        const horizontalProof = (texts, bounds) => window.__coupQAOverflowProof(texts, { left: Math.max(0, bounds.x), right: Math.min(innerWidth, bounds.right), top: bounds.y, bottom: bounds.bottom });
        const framed = r => r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
        if (rule.auditAction) {
          const button = [...document.querySelectorAll('#coup-decision-panel [role="button"]')].find(n => n.getAttribute('aria-label') === rule.auditAction), wrapper = button.parentElement, region = document.getElementById('coup-decision-panel');
          const bounds = rect(region), buttonBounds = rect(button), texts = text(wrapper);
          return { kind: 'action-and-visible-hint', label: rule.auditAction, button: buttonBounds, wrapper: rect(wrapper), region: bounds, scrollTop: region.scrollTop, texts,
            buttonFramed: framed(buttonBounds) && buttonBounds.y >= bounds.y - 1 && buttonBounds.bottom <= bounds.bottom + 1,
            allTextFramed: texts.every(t => t.rects.every(r => r.y >= Math.max(0, bounds.y) - 1 && r.bottom <= Math.min(innerHeight, bounds.bottom) + 1)),
            glyphHorizontalLoss: glyphLoss(texts, bounds),
            horizontalProof: horizontalProof(texts, bounds),
            horizontalLoss: texts.flatMap(t => t.rects.filter(r => r.x < Math.max(0, bounds.x) - 1 || r.right > Math.min(innerWidth, bounds.right) + 1).map(r => ({ text: t.text, ...r }))),
            visibleText: texts.filter(t => t.rects.some(r => r.bottom > bounds.y && r.y < bounds.bottom && r.bottom > 0 && r.y < innerHeight)).map(t => t.text) };
        }
        if (rule.auditLog) {
          const row = document.querySelector('[data-coup-qa-log]'), region = document.querySelector('[aria-label="Scrollable table log"]'), bounds = rect(region), texts = text(row);
          return { kind: 'retained-log-row', which: rule.auditLog, row: rect(row), region: bounds, texts, scrollTop: region.scrollTop, scrollHeight: region.scrollHeight, clientHeight: region.clientHeight,
            glyphHorizontalLoss: glyphLoss(texts, bounds),
            horizontalProof: horizontalProof(texts, bounds),
            visible: texts.some(t => t.rects.some(r => r.bottom > Math.max(0, bounds.y) && r.y < Math.min(innerHeight, bounds.bottom))),
            horizontalLoss: texts.flatMap(t => t.rects.filter(r => r.x < Math.max(0, bounds.x) - 1 || r.right > Math.min(innerWidth, bounds.right) + 1).map(r => ({ text: t.text, ...r }))) };
        }
        if (rule.auditLeave) {
          const node = document.querySelector('[aria-label="Leave game"]'), bounds = rect(node), hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          return { kind: 'leave-target', bounds, fullyFramed: framed(bounds), hit: !!hit && (hit === node || node.contains(hit)), keyboardFocused: document.activeElement === node };
        }
        if (rule.auditOrnament) {
          const title = [...document.querySelectorAll('[role="heading"]')].find(n => n.textContent.trim() === 'COUP TABLE');
          if (!title) throw new Error('Missing lobby table title');
          const titleBounds = rect(title), mark = title.parentElement.firstElementChild;
          const pieces = [mark, ...mark.querySelectorAll('*')].filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(rect);
          return { kind: 'lobby-mark-title', title: titleBounds, pieces, intersects: pieces.some(r => r.x < titleBounds.right && r.right > titleBounds.x && r.y < titleBounds.bottom && r.bottom > titleBounds.y) };
        }
        const cover = document.getElementById('game-cover-coup'), tile = document.getElementById('game-tile-coup'), bounds = rect(cover), image = cover.querySelector('img');
        return { kind: 'library-cover', cover: bounds, tile: rect(tile), fullyFramed: framed(bounds), loaded: !!image && image.complete && image.naturalWidth > 0, imageWidth: image?.naturalWidth, imageHeight: image?.naturalHeight, ratio: bounds.width / bounds.height };
      }, options);
      const target = metrics.targeted;
      const whitespaceProven = evidence.detectorCalibration?.passed && target.horizontalProof?.classification === 'proven-whitespace-only';
      if (target.horizontalLoss?.length) evidence.rawRangeDiagnostics.push({ file, type: 'targeted-raw-range', raw: target.horizontalLoss, proof: target.horizontalProof });
      if ((target.horizontalLoss?.length && !whitespaceProven) || target.glyphHorizontalLoss?.length || target.buttonFramed === false || target.allTextFramed === false || target.visible === false || target.intersects || target.fullyFramed === false || target.hit === false || target.keyboardFocused === false || target.loaded === false) evidence.visualFindings.push({ file, type: 'targeted-correction-check', target });
    }
    diagnostic.postCapture = metrics.scaled; diagnostic.failedNodes = metrics.scaled.filter(t => !t.connected || t.family !== t.afterFamily || Math.abs(t.after - t.before * 2) >= 0.2); diagnostic.stage = 'post-capture'; attempt.file = file; persist();
    const png = fs.readFileSync(path.join(outputDir, file)); assert(png.readUInt32BE(16) === width && png.readUInt32BE(20) === height, 'PNG dimensions differ from viewport');
    assert(JSON.stringify(requested) === JSON.stringify(seat.page.viewport()) && metrics.width === width && metrics.height === height && metrics.dpr === 1, 'Screenshot changed viewport');
    assert(metrics.touchPoints === (seat.touch ? 1 : 0) && metrics.coarse === seat.touch, 'Capture mode mismatch');
    if (scale === 200) assert(baseline.count > 0 && metrics.scaled.every(t => t.connected && t.family === t.afterFamily && Math.abs(t.after - t.before * 2) < 0.2), 'Text identity/200% scale changed after capture');
    if (metrics.clipped.length) evidence.rawRangeDiagnostics.push({ file, type: 'general-raw-range', entries: metrics.clipped.map(({ text, ancestor, overflowProof }) => ({ text, ancestor, overflowProof })) });
    const actualClipping = metrics.clipped.filter(item => !evidence.detectorCalibration?.passed || item.classification !== 'proven-whitespace-only');
    if (metrics.document > width + 1 || actualClipping.length) evidence.visualFindings.push({ file, type: 'text-or-page-overflow', document: metrics.document, clipped: actualClipping });
    const small = metrics.controls.filter(control => control.width < 44 || control.height < 44);
    if (small.length) evidence.visualFindings.push({ file, type: 'under-44-control', controls: small });
    if (options.frameLabel) {
      const control = metrics.controls.find(item => item.label === options.frameLabel);
      assert(control && control.x >= -1 && control.y >= -1 && control.x + control.width <= width + 1 && control.y + control.height <= height + 1, 'Capture control not framed after screenshot');
    }
    if (options.frame && /active private influence|#coup-rules \[aria-label=/.test(options.frame)) {
      const r = metrics.frame; assert(r.x >= -1 && r.y >= -1 && r.x + r.width <= width + 1 && r.y + r.height <= height + 1, 'Role face not fully framed after screenshot');
    }
    attempt.passed = true; return metrics;
  } catch (error) {
    attempt.error = sanitise(error.message); diagnostic.stage = 'failed';
    diagnostic.failureNodes = await seat.page.evaluate(() => (window.__coupQAText ?? []).map(({ node, size, family, text }) => ({ text, before: size, family, connected: node.isConnected, after: parseFloat(getComputedStyle(node).fontSize), afterFamily: getComputedStyle(node).fontFamily }))).catch(() => null);
    const file = `${++screenshotSequence}-capture-failure-${name}.png`; await seat.page.screenshot({ path: path.join(outputDir, file), fullPage: false }).then(() => { attempt.failureImage = file; }).catch(() => {}); persist(); throw error;
  } finally { if (scale === 200) await textScale(seat, 1); }
}

async function buttonPattern(page, pattern) {
  for (const el of await page.$$('[role="button"][aria-label]')) {
    const label = await el.evaluate((node) => node.getAttribute('aria-label'));
    if (pattern.test(label)) { const enabled = await findButton(page, label); await el.dispose(); if (enabled) { await enabled.dispose(); return label; } }
    else await el.dispose();
  }
  return null;
}
async function artworkGate(seat, scope = 'body') {
  await until(() => seat.page.$$eval(scope + ' img', images => images.every(img => img.complete && img.naturalWidth > 0)), 'loaded role artwork', 5000);
  const faces = await seat.page.$$eval(scope + ' [aria-label]', nodes => nodes.flatMap(node => {
    const label = node.getAttribute('aria-label'), r = node.getBoundingClientRect();
    if (!r.width || !r.height) return [];
    const match = label.match(/^(duke|assassin|captain|ambassador|contessa|inquisitor), (?:active|revealed|exchange)/) || label.match(/^Lose (\w+) influence$/) || label.match(/, revealed (\w+)$/);
    if (!match) return [];
    const images = [...node.querySelectorAll('img')].map(img => ({ src: img.currentSrc || img.src, loaded: img.complete && img.naturalWidth > 0 }));
    return [{ role: match[1], label, images }];
  }));
  assert(faces.length > 0, 'No role faces found in expected scope ' + scope);
  if (scope === '#coup-rules') assert(roles.slice(0, 5).every(role => faces.some(face => face.role === role)), 'Base reference omits a role face');
  for (const face of faces) {
    assert(roles.includes(face.role) && face.images.length > 0, 'Role face lacks expected illustration: ' + face.label);
    for (const img of face.images) {
      assert(img.loaded, 'Role illustration did not load: ' + face.label);
      const url = new URL(img.src, BASE_URL); assert(allowedOrigins.has(url.origin) && local(url), 'Foreign role artwork');
      if (!imageHashes.has(url.href)) { const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) }); assert(response.ok, 'Artwork HTTP ' + response.status); imageHashes.set(url.href, hash(new Uint8Array(await response.arrayBuffer()))); }
      assert(imageHashes.get(url.href) === artHashes[face.role], 'Wrong artwork mapped to ' + face.role);
    }
    seenArt.add(face.role);
  }
  evidence.artwork.push({ actor: seat.name, revision: seat.public?.revision, scope, faces });
}
async function hiddenGate(seat) {
  const cards = await seat.page.$$eval('#coup-seats [aria-label]', nodes => nodes.filter(n => /, hidden influence \d+$/.test(n.getAttribute('aria-label'))).map(node => ({
    label: node.getAttribute('aria-label'), images: node.querySelectorAll('img').length,
    markup: node.innerHTML, art: [...node.querySelectorAll('*')].map(n => getComputedStyle(n).backgroundImage).filter(v => v !== 'none'),
  })));
  assert(cards.length > 0, 'No public hidden influences to inspect');
  assert(cards.every(card => !card.images && !card.art.length && !/duke|assassin|captain|ambassador|contessa|inquisitor/i.test(card.markup)), 'Hidden public card exposes role image or metadata');
  assert(new Set(cards.map(card => card.markup)).size === 1, 'Public hidden card backs differ');
  evidence.hiddenCards.push({ actor: seat.name, revision: seat.public.revision, count: cards.length, identical: true, roleImages: false, roleMetadata: false });
}
async function choiceReview(seat, phase) {
  const mode = seat.touch ? 'phone' : 'desktop', key = phase + ':' + mode;
  if (checkedChoices.has(key)) return;
  const revision = seat.public.revision, started = Date.now(), width = seat.touch ? 375 : 1280, deadline = seat.public.pending.deadline;
  assert(deadline === null || deadline - started > 12000, 'Insufficient actual deadline remaining for mandatory-choice capture');
  const label = await buttonPattern(seat.page, phase === 'awaiting_exchange' ? /, exchange option 1$/ : /^Lose \w+ influence$/);
  assert(label, 'Required choice not rendered');
  await artworkGate(seat, '#coup-decision-panel');
  await capture(seat, phase, width, 844, { frameLabel: label });
  await capture(seat, phase, width, 844, { scale: 200, frameLabel: label });
  assert(paired(seat) && seat.public.revision === revision && seat.public.pending.phase === phase, 'Required choice changed during capture, possibly deadline settlement');
  checkedChoices.add(key); evidence.choiceCaptures.push({ phase, mode, revision, elapsedMs: Date.now() - started, remainingDeadlineMs: deadline === null ? null : deadline - Date.now() });
}
async function lostFaceReview(seats) {
  for (const seat of [seats[0], seats[2]]) {
    const mode = seat.touch ? 'phone' : 'desktop'; if (checkedLoss.has(mode)) continue;
    const player = seat.public.players.find(p => p.revealedCharacters.length); if (!player) continue;
    const role = player.revealedCharacters[0], label = player.displayName + ', revealed ' + role;
    await artworkGate(seat, '#coup-seats');
    await capture(seat, 'public-lost-role', seat.touch ? 375 : 1280, 844, { frame: '[aria-label=' + JSON.stringify(label) + ']' });
    checkedLoss.add(mode);
  }
}
async function actionLayoutReview(seat) {
  assert(seat.public.pending.phase === 'awaiting_action' && seat.public.currentTurnPlayerId === seat.private.playerId, 'Action review requires untimed owned turn');
  const revision = seat.public.revision;
  const labels = await seat.page.$$eval('#coup-decision-panel [role="button"][aria-label]', nodes => nodes.map(n => n.getAttribute('aria-label')));
  assert(labels.length >= 7, 'Expected base Coup actions including disabled ones');
  for (const [width, scale] of [[375, 200], [414, 100]]) for (const label of labels) {
    await capture(seat, 'action-hint-' + label.toLowerCase().replace(/\W+/g, '-'), width, 844, { scale, auditAction: label });
  }
  await capture(seat, 'header-leave-keyboard', 375, 844, { scale: 200, auditLeave: true });
  assert(paired(seat) && seat.public.revision === revision && seat.public.pending.phase === 'awaiting_action', 'Nonmutating action review changed state');
}
async function logLayoutReview(seats) {
  if (logReviewed || seats[0].public.revision < 20) return;
  assert(seats[0].public.pending.phase === 'awaiting_action', 'Log review requires untimed turn');
  const revision = seats[0].public.revision;
  for (const seat of [seats[0], seats[2]]) for (const scale of [100, 200]) for (const which of ['oldest', 'longest', 'latest']) {
    await capture(seat, 'log-' + which, seat.touch ? 375 : 1280, 844, { scale, auditLog: which });
  }
  assert(seats.every(seat => paired(seat) && seat.public.revision === revision), 'Nonmutating log review changed state');
  logReviewed = true;
}
async function entranceReview(host, desktop) {
  for (const seat of [host, desktop]) {
    await seat.page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await until(() => seat.page.$('#game-cover-coup img'), 'Library Coup artwork');
    await until(() => seat.page.$eval('#game-cover-coup img', img => img.complete && img.naturalWidth > 0), 'Loaded library cover');
    await capture(seat, 'library-coup-cover', seat.touch ? 375 : 1280, 844, { frame: '#game-cover-coup', auditCover: true });
    await seat.page.goto(BASE_URL + '/coup', { waitUntil: 'domcontentloaded' });
    await until(() => seat.page.$('input[aria-label="Your name"]'), 'Untouched entrance');
    await until(() => seat.page.$eval('#coup-entrance-art img', img => img.complete && img.naturalWidth > 0), 'Loaded entrance illustration');
    await capture(seat, 'entrance-top', seat.touch ? 375 : 1280, 844, { frame: '#coup-entrance-art' });
    await capture(seat, 'entrance-create', seat.touch ? 375 : 1280, 844, { frameLabel: 'CREATE ROOM' });
  }
  await capture(host, 'entrance-landscape-art', 844, 390, { frame: '#coup-entrance-art' });
  await capture(host, 'entrance-landscape-create', 844, 390, { frameLabel: 'CREATE ROOM' });
  await setViewport(host, 375);
}
async function settled(seat, revision, action) {
  await until(() => paired(seat) && seat.public.revision > revision && seat.accepted.some((ack) => ack.action === action && ack.revision > revision), seat.name + ' ' + action);
  assert(!seat.rejected.length, 'Rejected action: ' + JSON.stringify(seat.rejected));
  evidence.decisions.push({ actor: seat.name, fromRevision: revision, revision: seat.public.revision, action });
  await delay(130);
}
async function decision(seat, label, kind = 'respond') {
  const revision = seat.public.revision; await click(seat.page, label); await settled(seat, revision, kind);
}
async function chooseTarget(seat, target) {
  const labels = await seat.page.$$eval('[role="button"][aria-label*="available target"]', (nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  const label = labels.find((value) => value.startsWith(target.displayName + '.'));
  assert(label, 'Rendered eligible target absent'); await click(seat.page, label);
}
async function action(seat, label, target) {
  const revision = seat.public.revision; await click(seat.page, label);
  if (target) await chooseTarget(seat, target); await settled(seat, revision, 'action');
}
async function exchange(seat, captureShort = false) {
  const offer = seat.private.exchange; assert(offer, 'Private exchange missing');
  const captureConfirmation = !checkedChoices.has('awaiting_exchange:' + (seat.touch ? 'phone' : 'desktop'));
  await choiceReview(seat, 'awaiting_exchange');
  if (captureShort) await capture(seat, 'exchange-before-choice', 320, 640);
  const score = (c) => ({ duke: 5, contessa: 4, assassin: 3, captain: 2, ambassador: 1 })[c] ?? 0;
  const options = offer.pool.map((card, index) => ({ card, index })).sort((a, b) => score(b.card) - score(a.card)).slice(0, offer.keepCount);
  for (const choice of options) await click(seat.page, choice.card + ', exchange option ' + (choice.index + 1));
  const label = 'CONFIRM (' + offer.keepCount + '/' + offer.keepCount + ')';
  const button = await findButton(seat.page, label); assert(button, 'Exchange confirm missing');
  await button.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  if (captureShort) {
    const bounds = await button.evaluate((node) => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, viewport: innerHeight }));
    assert(bounds.top >= 0 && bounds.bottom <= bounds.viewport, 'Exchange confirm clipped: ' + JSON.stringify(bounds));
    await capture(seat, 'exchange-confirm-reachable', 320, 640, { frameLabel: label });
    evidence.exchangeReachability = await button.evaluate(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, viewport: innerHeight }));
    assert(evidence.exchangeReachability.top >= 0 && evidence.exchangeReachability.bottom <= evidence.exchangeReachability.viewport, 'Exchange confirm moved after screenshot');
  }
  await button.dispose();
  if (captureConfirmation) {
    const revision = seat.public.revision;
    await capture(seat, 'exchange-confirm-enlarged', seat.touch ? 375 : 1280, 844, { scale: 200, frameLabel: label });
    assert(paired(seat) && seat.public.revision === revision && seat.public.pending.phase === 'awaiting_exchange', 'Exchange changed before explicit confirmation');
  }
  await decision(seat, label, 'exchange');
  if (captureShort) await setViewport(seat, 375, 844);
}
async function runMatch(seats) {
  const seen = new Set();
  for (let step = 0; step < 220; step++) {
    await until(() => seats.every(paired) && new Set(seats.map((seat) => seat.public.revision)).size === 1, 'all clients paired');
    const state = seats[0].public, pending = state.pending;
    if (state.status === 'game_over') {
      assert(state.winnerId && !state.terminationReason && !state.players.some((player) => player.forfeited), 'Natural result required, no forfeits');
      evidence.phases = [...seen]; return state;
    }
    seen.add(pending.phase);
    const seat = seats.find((candidate) => candidate.private.playerId === (pending.phase === 'awaiting_action' ? state.currentTurnPlayerId : pending.waitingOn[0]));
    assert(seat, 'No acting seat for ' + pending.phase);
    const own = seat.private, mine = state.players.find((player) => player.playerId === own.playerId);
    const cards = own.influences.filter((card) => !card.revealed).map((card) => card.character);
    const targets = state.players.filter((player) => player.playerId !== own.playerId && !player.eliminated && !player.forfeited).sort((a, b) => b.influenceCount - a.influenceCount || b.coins - a.coins);
    if (pending.phase === 'awaiting_action') {
      await logLayoutReview(seats);
      await lostFaceReview(seats);
      if (!seat.touch && !seat.exchangeAttempted) { seat.exchangeAttempted = true; await action(seat, 'Exchange'); }
      else if (mine.coins >= 7) await action(seat, 'Coup', targets[0]);
      else if (cards.includes('assassin') && mine.coins >= 3 && (seat.attackAttempts ?? 0) < 2) { seat.attackAttempts = (seat.attackAttempts ?? 0) + 1; await action(seat, 'Assassinate', targets[0]); }
      else if (cards.includes('duke')) await action(seat, 'Tax');
      else if (cards.includes('captain') && targets.some((target) => target.coins >= 2) && (seat.attackAttempts ?? 0) < 2) { seat.attackAttempts = (seat.attackAttempts ?? 0) + 1; await action(seat, 'Steal', targets.find((target) => target.coins >= 2)); }
      else await action(seat, 'Income');
    } else if (pending.phase === 'awaiting_exchange') await exchange(seat);
    else if (pending.phase === 'awaiting_lose_influence') {
      await choiceReview(seat, 'awaiting_lose_influence');
      const preference = ['ambassador', 'captain', 'assassin', 'contessa', 'duke'];
      const card = preference.find((name) => cards.includes(name));
      await decision(seat, 'Lose ' + card + ' influence', 'lose_influence');
    } else if (pending.phase === 'awaiting_challenge_decision') {
      const claim = pending.blockCharacter ?? pending.claimedCharacter;
      await decision(seat, cards.includes(claim) ? 'PROVE ' + claim.toUpperCase() : 'CONCEDE', 'resolve_challenge');
    } else if (pending.phase === 'awaiting_block') {
      const canBlock = (pending.action === 'foreign_aid' ? ['duke'] : pending.action === 'steal' ? ['captain', 'ambassador'] : ['contessa']).find((card) => cards.includes(card));
      await decision(seat, canBlock ? 'BLOCK (' + canBlock.toUpperCase() + ')' : 'ALLOW');
    } else {
      const claim = pending.blockCharacter ?? pending.claimedCharacter;
      const known = cards.filter((card) => card === claim).length + state.players.flatMap((player) => player.revealedCharacters).filter((card) => card === claim).length;
      const challenge = known === 3 || (state.revision % 11 === 0 && mine.influenceCount === 2);
      await decision(seat, challenge ? pending.phase === 'awaiting_block_challenge' ? 'CHALLENGE BLOCK' : 'CHALLENGE' : 'ALLOW');
    }
    if (evidence.decisions.length % 20 === 0) console.log(JSON.stringify({ progress: 'natural-match', decisions: evidence.decisions.length, revision: seat.public.revision }));
  }
  throw new Error('Natural match exceeded 220 decisions');
}
async function backStay(seat) {
  await until(() => seat.page.evaluate(() => window.__zuychinArcadeBackGuardReady === location.href), 'Back guard armed');
  const revision = seat.public?.revision;
  await seat.page.evaluate(() => history.back()); await click(seat.page, 'STAY');
  if (revision !== undefined) assert(seat.public.revision === revision, 'Back Stay changed game');
}
async function rulesGate(seat) {
  await setViewport(seat, seat.touch ? 375 : 1280);
  await click(seat.page, 'Open rules');
  await seat.page.keyboard.press('Tab');
  const region = await seat.page.$('#coup-rules [role="region"]'); assert(region, 'Focusable rulebook region');
  await region.focus(); await seat.page.keyboard.press('PageDown'); await delay(120);
  assert(await region.evaluate((node) => node.scrollTop > 0), 'Keyboard did not scroll rules');
  await artworkGate(seat, '#coup-rules');
  await capture(seat, 'reference-top', seat.touch ? 375 : 1280, 844, { scrollRegion: '#coup-rules [role="region"]' });
  await capture(seat, 'reference-roles', seat.touch ? 375 : 1280, 844, { scale: 200, frame: '#coup-rules [aria-label="duke, active influence"]' });
  await seat.page.keyboard.press('Escape');
  assert(await seat.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Open rules'), 'Rules did not restore opener focus');
  evidence.rulesKeyboard ??= []; evidence.rulesKeyboard.push({ actor: seat.name, mode: seat.touch ? 'phone' : 'desktop', pageDown: true, escapeRestoredOpener: true }); await region.dispose();
}

async function cancelFocusGate(seat) {
  const steal = await findButton(seat.page, 'Steal'); assert(steal, 'Steal action missing');
  await steal.focus(); await seat.page.keyboard.press('Enter'); await steal.dispose();
  await until(() => seat.page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.includes('available target')), 'target focus');
  const cancel = await findButton(seat.page, 'CANCEL'); assert(cancel, 'Cancel missing');
  await cancel.focus(); await seat.page.keyboard.press('Enter'); await cancel.dispose();
  await until(() => seat.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Steal'), 'Cancel restores remounted Steal');
  evidence.cancelFocus = true;
}

async function leaveSeats(seats) {
  for (const seat of seats) {
    const leave = await buttonPattern(seat.page, /^(Leave game|LEAVE TABLE)$/);
    assert(leave, 'Normal leave control absent for ' + seat.name);
    await click(seat.page, leave); await click(seat.page, 'LEAVE');
    await until(() => seat.leaveResponses.includes(200) && new URL(seat.page.url()).pathname === '/', 'normal leave completed');
    await until(() => seat.page.evaluate(() => sessionStorage.getItem('za:auth') === null), 'normal leave cleared authentication');
    seat.released = true; evidence.cleanup.push({ actor: seat.name, normalUI: true, status: 200, authCleared: true, destination: '/' });
  }
}
async function releaseOwnedSeats() {
  for (const seat of ownedSeats) {
    await Promise.allSettled([...seat.transactions]);
    if (!seat.auth || seat.released) continue;
    try {
      const response = await fetch(API_URL + '/rooms/' + encodeURIComponent(seat.auth.roomCode) + '/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + seat.auth.token }, signal: AbortSignal.timeout(5000) });
      evidence.cleanup.push({ actor: seat.name, normalUI: false, fallback: true, status: response.status });
      if (response.status !== 200) evidence.cleanupFailed = true;
    } catch { evidence.cleanup.push({ actor: seat.name, normalUI: false, fallback: true, failed: true }); evidence.cleanupFailed = true; }
  }
}

async function main() {
  assert(!fs.existsSync(path.join(outputDir, 'receipt.json')), 'Use a fresh evidence directory');
  assert(CERT && process.env.COUP_UI_EXCLUSIVE_WINDOW === 'granted', 'Explicit browser window and certificate pin required');
  fs.mkdirSync(outputDir, { recursive: true });
  let browser;
  const seats = [];
  try {
    await verifyBundle();
    browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + CERT] });
    await calibrateTextGeometry(browser);
    for (const [name, width] of [['Astra UI Court', 375], ['Court Challenger', 320], ['Royal Long Name Seat', 1280], ['Fourth Court Seat', 414]]) seats.push(await actor(browser, name, width));
    const host = seats[0], password = ' court pass ';
    await entranceReview(host, seats[2]);
    await click(host.page, 'CREATE ROOM');
    assert(await host.page.evaluate(() => !!document.querySelector('[role="alert"]')), 'Empty-name validation absent');
    await input(host.page, 'Your name', host.name); await host.page.keyboard.press('Enter');
    assert(await host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Room password, optional'), 'Name Enter did not focus password');
    await input(host.page, 'Room password, optional', password);
    await capture(host, 'landing', 390);
    await host.page.keyboard.press('Enter');
    await until(() => host.room?.roomCode, 'created lobby'); const roomCode = host.room.roomCode; evidence.roomCode = roomCode;
    for (const seat of seats.slice(1)) {
      await seat.page.goto(BASE_URL + '/coup/join', { waitUntil: 'domcontentloaded' });
      await until(() => seat.page.$('input[aria-label="Your name"]'), 'join inputs');
      await input(seat.page, 'Your name', seat.name); await input(seat.page, 'Room code', roomCode);
      if (seat === seats[1]) {
        seat.expectedPasswordError = true;
        await input(seat.page, 'Room password, optional', password.trim()); await click(seat.page, 'JOIN GAME');
        await until(() => seat.page.evaluate(() => document.body.innerText.toLowerCase().includes('password') && !!document.querySelector('[role="alert"]')), 'exact-password mismatch');
        assert(!seat.room, 'Trimmed password was accepted');
        seat.expectedPasswordError = false; evidence.exactPassword = true;
      }
      await input(seat.page, 'Room password, optional', password); await seat.page.keyboard.press('Enter');
      await until(() => seat.room?.roomCode === roomCode, 'joined lobby');
    }
    await until(() => seats.every(seat => seat.auth && seat.room?.players.every(p => p.isConnected)), 'owned connected lobby roster');
    await backStay(seats[2]);
    await capture(host, 'lobby', 375);
    await capture(host, 'lobby-room-code', 375, 844, { scale: 200, frame: '[aria-label^="Room code "]' });
    await capture(host, 'lobby-mark-title', 375, 844, { scale: 200, auditOrnament: true });
    await capture(host, 'lobby-host-controls', 375, 844, { scale: 200, frameLabel: 'START GAME' });
    await capture(seats[2], 'lobby', 1280);
    await capture(seats[2], 'lobby-room-code', 1280, 844, { scale: 200, frame: '[aria-label^="Room code "]' });
    await capture(seats[2], 'lobby-mark-title', 1280, 844, { scale: 200, auditOrnament: true });
    await click(host.page, 'START GAME'); await until(() => seats.every(paired), 'initial game pairs');
    await backStay(host); await rulesGate(host); await rulesGate(seats[2]);
    await hiddenGate(host); await hiddenGate(seats[2]);
    await actionLayoutReview(host);
    for (const width of [320, 375, 414]) evidence.viewports.push(await capture(host, 'game', width));
    for (const width of [768, 1280, 1440]) evidence.viewports.push(await capture(seats[2], 'game-desktop', width));
    await capture(host, 'game-landscape', 844, 390, { frame: '#coup-decision-panel' });
    await capture(host, 'game-decision', 375, 844, { scale: 200, frame: '#coup-decision-panel' });
    await capture(seats[2], 'game-decision', 1280, 844, { scale: 200, frame: '#coup-decision-panel' });
    for (const seat of [host, seats[2]]) {
      await setViewport(seat, seat.touch ? 375 : 1280, 844);
      await click(seat.page, 'REVEAL PRIVATE CARDS');
      await artworkGate(seat);
      await capture(seat, 'owned-private-influences', seat.touch ? 375 : 1280, 844, { frame: '[aria-label*="active private influence"]' });
      await capture(seat, 'owned-private-influences', seat.touch ? 375 : 1280, 844, { scale: 200, frame: '[aria-label*="active private influence"]' });
      assert(await seat.page.$('[aria-label*="active private influence"]'), 'Private reveal expired during capture');
      await click(seat.page, 'HIDE PRIVATE CARDS');
      assert(await seat.page.evaluate(() => !document.querySelector('[aria-label*="active private influence"]')), 'Hide retained private faces');
    }
    await cancelFocusGate(host);
    // A legal opening bluff exercises exchange without reading another seat's cards.
    await action(host, 'Exchange');
    if (CONFIRM_ONLY) {
      assert(await host.page.evaluate(() => document.body.innerText.includes('Exchange accepted.') && !document.body.innerText.includes('Exchange confirmed.')), 'Acknowledgement implies effect resolution');
      evidence.acceptedCopy = true;
    }
    while (host.public.pending.phase === 'awaiting_action_challenge') {
      const responder = seats.find((seat) => seat.private.playerId === host.public.pending.waitingOn[0]);
      await decision(responder, 'ALLOW');
    }
    await until(() => paired(host) && host.private.exchange, 'opening exchange'); await exchange(host, true);
    const beforeReload = host.public.revision, beforeSocket = host.socketSequence, beforeFrames = { ...host.frames }, playerId = host.private.playerId;
    host.public = null; host.private = null;
    await host.page.reload({ waitUntil: 'domcontentloaded' });
    await until(async () => paired(host) && host.socketSequence > beforeSocket && host.frameSockets.public === host.socketSequence && host.frameSockets.private === host.socketSequence && host.frames.public > beforeFrames.public && host.frames.private > beforeFrames.private && host.public.revision === beforeReload && host.private.playerId === playerId && !!(await host.page.$('#coup-decision-panel')), 'fresh paired reload recovery');
    assert(await host.page.evaluate(() => !document.querySelector('[aria-label*="active private influence"]')), 'Reload exposed private cards');
    evidence.recovery = { freshSocket: true, freshPublicFrames: host.frames.public - beforeFrames.public, freshPrivateFrames: host.frames.private - beforeFrames.private, samePlayer: true, revision: host.public.revision, privateFacesHidden: true };
    if (CONFIRM_ONLY) {
      evidence.method = 'Targeted real-browser confirmation of loaded fonts, accepted-action copy, Cancel focus and short-screen exchange. Not a complete natural match.';
      await leaveSeats(seats); evidence.lifecyclePassed = false; evidence.visualPassed = evidence.visualFindings.length === 0; evidence.passed = evidence.visualPassed && evidence.issues.length === 0; return;
    }
    const result = await runMatch(seats);
    await until(() => seats.every(seat => paired(seat) && seat.public.status === 'game_over' && seat.public.revision === result.revision && seat.public.winnerId === result.winnerId && !seat.public.terminationReason && seat.public.players.every(p => !p.forfeited)), 'all natural terminal pairs');
    await capture(host, 'results', 320, 844, { frame: '#coup-results' });
    await capture(host, 'results', 375, 844, { scale: 200, scrollRegion: '[aria-label="Coup match results"]' });
    await capture(host, 'results-controls', 375, 844, { scale: 200, frameLabel: 'LEAVE TABLE' });
    await capture(seats[2], 'results', 1280, 844, { frame: '#coup-results' });
    await capture(seats[2], 'results', 1280, 844, { scale: 200, scrollRegion: '[aria-label="Coup match results"]' });
    await capture(seats[2], 'results-controls', 1280, 844, { scale: 200, frameLabel: 'LEAVE TABLE' });
    for (const seat of [host, seats[2]]) await capture(seat, 'results-final-roster', seat.touch ? 375 : 1280, 844, { scale: 200, scrollRegion: '[aria-label="Coup match results"]', scrollEdge: 'bottom' });
    evidence.result = { revision: result.revision, winnerId: result.winnerId, forfeits: result.players.filter((player) => player.forfeited).length };
    evidence.artworkCoverage = { observed: [...seenArt], unavailable: roles.filter(role => !seenArt.has(role)), note: 'Base Coup does not expose Inquisitor. Six local source hashes are recorded; no unsupported variant or fixture was forced.' };
    evidence.choiceCoverage = { observed: [...checkedChoices], uncovered: ['awaiting_exchange:phone', 'awaiting_exchange:desktop', 'awaiting_lose_influence:phone', 'awaiting_lose_influence:desktop'].filter(key => !checkedChoices.has(key)) };
    await click(host.page, 'PLAY AGAIN'); await until(() => seats.every(seat => paired(seat) && seat.public.status === 'playing' && seat.public.revision > result.revision), 'monotonic rematch');
    assert(host.public.currentTurnPlayerId === result.winnerId, 'Previous winner must begin rematch');
    evidence.rematch = { revision: host.public.revision, winnerStarts: true };
    await capture(host, 'rematch', 390);
    await leaveSeats(seats);
    const firstBundle = evidence.bundle; await verifyBundle(); evidence.finalBundle = evidence.bundle; evidence.bundle = firstBundle;
    evidence.accepted = seats.reduce((sum, seat) => sum + seat.accepted.length, 0); evidence.rejected = seats.flatMap(seat => seat.rejected);
    assert(evidence.issues.length === 0 && evidence.blockedRequests.length === 0 && evidence.rejected.length === 0, 'Browser, network or protocol issue');
    evidence.lifecyclePassed = true; evidence.visualPassed = evidence.visualFindings.length === 0;
    assert(evidence.visualPassed, 'Lifecycle completed with visual findings'); evidence.passed = true;
  } catch (error) {
    evidence.passed = false; evidence.error = sanitise(error.stack); for (let i = 0; i < seats.length; i++) await seats[i].page.screenshot({ path: path.join(outputDir, 'failure-' + i + '.png'), fullPage: false }).catch(() => {}); throw error;
  } finally {
    try { await releaseOwnedSeats(); } catch { evidence.cleanupFailed = true; }
    try { if (browser) await browser.close(); evidence.browserClosed = true; } catch { evidence.browserClosed = false; }
    if (evidence.cleanupFailed || !evidence.browserClosed || !evidence.passed) { evidence.passed = false; process.exitCode = 1; }
    fs.writeFileSync(path.join(outputDir, 'receipt.json'), sanitise(JSON.stringify(evidence, null, 2)));
    console.log(JSON.stringify({ evidence: outputDir, passed: evidence.passed ?? false, decisions: evidence.decisions.length, result: evidence.result, issues: evidence.issues }));
  }
}
module.exports = { actor, click, input, capture, buttonPattern, paired, until, backStay, evidence, installTextGeometry };
if (require.main === module) main().catch((error) => { console.error(sanitise(error.message)); process.exitCode = 1; });
