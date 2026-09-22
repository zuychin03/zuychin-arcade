const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-core');

const BASE_URL = process.env.SABOTEUR_WEB_URL ?? 'http://127.0.0.1:8081';
const BROWSER_PATH = process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CERT = process.env.QA_BROWSER_CERT_SPKI ?? '3WH+FsQdhq9y2sxr1wApDTL2GeLGFO7B0aVanIXZQW4=';
const FIXTURES = process.env.SABOTEUR_UI_FIXTURES === 'true';
const MAP_BEFORE_ONLY = process.env.SABOTEUR_MAP_BEFORE_ONLY === 'true';
const RETAINED_TURN_ONLY = process.env.SABOTEUR_RETAINED_TURN_ONLY === 'true';
const outputDir = path.resolve(process.env.SABOTEUR_EVIDENCE_DIR ?? path.join(__dirname, '../../../.tmp-qa-evidence/2026-09-20/saboteur/candidate'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const evidence = { method: 'Automated isolated browser seats, not manual Astra play. Acting seat projections and rendered legal targets only.', decisions: [], rounds: [], viewports: [], screenshots: [], issues: [] };
const ownedSeats = new Set();
const secrets = new Set([' mine gate ']);
const API_URL = process.env.SABOTEUR_API_URL ?? 'http://127.0.0.1:3213';
const allowedOrigins = new Set([new URL(BASE_URL).origin, new URL(API_URL).origin, 'https://localhost:3214']);
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const local = (url) => ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password;
const sanitise = (value) => {
  let text = String(value);
  for (const secret of secrets) text = text.split(secret).join('[redacted]');
  return text.replace(/Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]');
};
evidence.coverage = 'One natural three-round match, then rematch start and deliberate below-three abandonment. Not a complete second match or native-device test.';
evidence.captures = []; evidence.cleanup = []; evidence.blockedRequests = []; evidence.visualFindings = [];
let screenshotSequence = 0;

async function setViewport(seat, width, height = 844, touch = seat.touch === true) {
  const previous = seat.page.viewport(), changedMode = !!previous.isMobile !== touch || !!previous.hasTouch !== touch;
  const hadGame = !!seat.public, priorSocket = seat.socketSequence, roomCode = seat.auth?.roomCode;
  if (changedMode && hadGame) { seat.public = null; seat.private = null; }
  if (changedMode && roomCode) seat.room = null;
  const requested = { ...previous, width, height, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, isLandscape: width > height };
  if (JSON.stringify(previous) !== JSON.stringify(requested)) await seat.page.setViewport(requested);
  seat.touch = touch;
  if (changedMode && roomCode) {
    await until(() => seat.socketSequence > priorSocket && seat.room?.roomCode === roomCode
      && seat.room.players?.some(player => player.playerId === seat.auth.playerId && player.isConnected)
      && (!hadGame || paired(seat)), 'owned recovery after emulation-mode change');
    await until(() => seat.page.evaluate(() => {
      const text = document.body.innerText;
      return !text.includes('Reconnecting. Your seat stays reserved briefly.') && !text.includes('RETRY CONNECTION')
        && !text.includes('Refreshing the room before actions are available');
    }), 'rendered recovery after emulation-mode change');
    await seat.page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  }
}

async function activate(page, element) {
  if (!page.viewport().hasTouch) { await element.click(); return; }
  const metrics = await element.evaluate(node => {
    const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { label: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 100), x: r.x, y: r.y, width: r.width, height: r.height,
      maxTouchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, hit: !!hit && (hit === node || node.contains(hit)), viewport: { width: innerWidth, height: innerHeight } };
  });
  (evidence.touchInteractions ??= []).push(metrics);
  assert(metrics.maxTouchPoints === 1 && metrics.coarse && metrics.hit, 'Touch target or emulation unavailable');
  await element.tap();
}

async function verifyBundle() {
  assert([...allowedOrigins].every((origin) => local(new URL(origin))), 'Only credential-free loopback origins are permitted');
  const expected = process.env.SABOTEUR_EXPECTED_SHA256;
  assert(/^[a-f0-9]{64}$/i.test(expected ?? ''), 'SABOTEUR_EXPECTED_SHA256 is required');
  const response = await fetch(BASE_URL, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  assert(response.ok, 'Served HTML HTTP ' + response.status);
  const html = await response.text();
  const entry = html.match(/src=["']([^"']*\/_expo\/static\/js\/web\/(?:entry|index)-[a-f0-9]+\.js)/)?.[1];
  assert(entry, 'Missing served compiled entry');
  const url = new URL(entry, BASE_URL); assert(url.origin === new URL(BASE_URL).origin, 'Foreign compiled entry');
  const bundle = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert(bundle.ok, 'Served bundle HTTP ' + bundle.status);
  const staticRoot = process.env.QA_STATIC_ROOT ?? path.resolve(__dirname, '../.expo-export-qa-web');
  const diskHTML = fs.readFileSync(path.join(staticRoot, 'index.html'), 'utf8');
  assert(diskHTML.includes(path.basename(url.pathname)), 'Disk/served HTML entry mismatch');
  const servedHash = hash(new Uint8Array(await bundle.arrayBuffer()));
  const diskHash = hash(fs.readFileSync(path.join(staticRoot, '_expo/static/js/web', path.basename(url.pathname))));
  evidence.bundle = { entry: path.basename(url.pathname), sha256: servedHash, servedHash, diskHash, expected };
  assert(servedHash === expected.toLowerCase() && diskHash === servedHash, 'Served/disk/expected bundle mismatch');
}
async function until(check, label, timeout = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await check()) return; await delay(70); }
  throw new Error('Timed out: ' + label);
}
function packet(data) { if (!data.startsWith('42')) return null; try { return JSON.parse(data.slice(2)); } catch { return null; } }
function paired(seat) {
  return seat.public && seat.private && Number.isSafeInteger(seat.public.revision) && seat.public.revision >= 0
    && seat.public.revision === seat.private.revision && seat.public.roomCode === seat.private.roomCode
    && seat.public.gameId === 'saboteur' && seat.private.gameId === 'saboteur'
    && (!seat.auth || (seat.private.playerId === seat.auth.playerId && seat.private.roomCode === seat.auth.roomCode));
}

async function actor(browser, name, width = 390) {
  assert([...allowedOrigins].every((origin) => local(new URL(origin))), 'Only credential-free loopback origins are permitted');
  const context = await browser.createBrowserContext(), page = await context.newPage();
  const seat = { context, page, name, public: null, private: null, room: null, accepted: [], rejected: [], sent: [], offline: false };
  ownedSeats.add(seat);
  seat.transactions = new Set(); seat.frames = { public: 0, private: 0 }; seat.frameSockets = { public: 0, private: 0 }; seat.socketSequence = 0; seat.leaveResponses = []; seat.auth = null;
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((allowedOrigins.has(url.origin) && local(url)) || ['data:', 'blob:', 'about:'].includes(url.protocol)) void request.continue();
    else { evidence.blockedRequests.push({ name, protocol: url.protocol, hostname: url.hostname, type: request.resourceType() }); void request.abort(); }
  });
  await page.evaluateOnNewDocument((origins) => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const url = new URL(String(args[0]), location.href);
        const origin = url.origin.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
        if (!origins.includes(origin) || url.username || url.password) throw new Error('QA blocked non-local WebSocket');
        return Reflect.construct(target, args);
      },
    });
  }, [...allowedOrigins]);
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (!allowedOrigins.has(url.origin) || response.request().method() !== 'POST') return;
    if (/\/rooms\/[^/]+\/leave$/.test(url.pathname)) seat.leaveResponses.push(response.status());
    if (/\/rooms\/(create|join)$/.test(url.pathname) && response.ok()) {
      const pending = response.json().then((body) => {
        assert(typeof body.token === 'string' && typeof body.playerId === 'string' && typeof body.roomCode === 'string', 'Malformed owned room response');
        secrets.add(body.token); seat.auth = { token: body.token, roomCode: body.roomCode, playerId: body.playerId };
      }).catch(() => { evidence.issues.push({ name, type: 'auth-capture', text: 'Could not retain owned cleanup credentials' }); });
      seat.transactions.add(pending); void pending.finally(() => seat.transactions.delete(pending));
    }
  });
  await page.setViewport({ width, height: 844, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('console', (message) => { if (!seat.offline && ['warning', 'error'].includes(message.type()) && !message.text().includes('[Reanimated] Reduced motion')) evidence.issues.push({ name, type: message.type(), text: sanitise(message.text()) }); });
  page.on('pageerror', (error) => evidence.issues.push({ name, type: 'pageerror', text: sanitise(error.message) }));
  const cdp = await page.createCDPSession(); await cdp.send('Network.enable');
  cdp.on('Network.webSocketCreated', ({ requestId }) => { seat.socketRequestId = requestId; seat.socketSequence++; });
  cdp.on('Network.webSocketFrameReceived', ({ response, requestId }) => {
    if (requestId !== seat.socketRequestId) return;
    const data = packet(response.payloadData); if (!data) return;
    if (data[0] === 'game_state' && data[1]?.gameId === 'saboteur') { seat.public = data[1]; seat.frames.public++; seat.frameSockets.public = seat.socketSequence; }
    if (data[0] === 'private_state' && data[1]?.gameId === 'saboteur') { seat.private = data[1]; seat.frames.private++; seat.frameSockets.private = seat.socketSequence; }
    if (data[0] === 'room_updated') seat.room = data[1];
    if (data[0] === 'saboteur:action_accepted') seat.accepted.push(data[1]);
    if (data[0] === 'action_rejected') seat.rejected.push(data[1]);
  });
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    const data = packet(response.payloadData);
    if (data && ['place_card', 'play_action', 'pass_turn', 'choose_gold', 'start_game'].includes(data[0])) seat.sent.push(data);
  });
  await page.goto(BASE_URL + '/saboteur', { waitUntil: 'domcontentloaded' });
  await until(() => page.$('input[aria-label="Your name"]'), name + ' landing'); return seat;
}
async function input(page, label, value) {
  const field = await page.$('input[aria-label="' + label + '"]'); assert(field, 'Missing input ' + label);
  await activate(page, field); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace');
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
async function click(page, label, duplicate = false) {
  await until(async () => { const el = await findButton(page, label); await el?.dispose(); return !!el; }, label);
  const el = await findButton(page, label); await el.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
  if (duplicate) await el.evaluate((node) => { node.click(); node.click(); }); else await activate(page, el);
  await el.dispose(); await delay(80);
}
async function clickId(page, id) {
  const selector = '[id="' + id + '"]';
  await until(() => page.$eval(selector, (node) => node.getAttribute('aria-disabled') !== 'true').catch(() => false), id);
  const el = await page.$(selector); await el.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' })); await activate(page, el); await el.dispose(); await delay(90);
}
async function capture(seat, name, width = 390, height = 844, options = {}) {
  await setViewport(seat, width, height, options.touch ?? seat.touch === true);
  const expectedViewport = seat.page.viewport();
  await seat.page.evaluate(async () => { await document.fonts.ready; }); await delay(250);
  const file = `${++screenshotSequence}-${seat.name.replace(/[^a-z0-9]+/gi, '-')}-${name}-r${seat.public?.revision ?? 'lobby'}-${width}x${height}-text${seat.textScale ?? 100}.png`;
  await seat.page.screenshot({ path: path.join(outputDir, file), fullPage: false }); evidence.screenshots.push(file);
  const metrics = await seat.page.evaluate((selectedCardId) => {
    const clipped = [];
    for (const node of document.querySelectorAll('body *')) {
      const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || style.visibility !== 'visible' || node.closest('[aria-hidden="true"]') || /icon|material|fontawesome/i.test(style.fontFamily)) continue;
      const textNodes = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
      if (!textNodes.length) continue;
      const boxes = textNodes.flatMap(child => { const range = document.createRange(); range.selectNodeContents(child); return [...range.getClientRects()]; });
      let scrollX = false, scrollY = false;
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
        const s = getComputedStyle(ancestor), r = ancestor.getBoundingClientRect();
        scrollX ||= ['auto', 'scroll'].includes(s.overflowX) && ancestor.scrollWidth > ancestor.clientWidth;
        scrollY ||= ['auto', 'scroll'].includes(s.overflowY) && ancestor.scrollHeight > ancestor.clientHeight;
        const x = !scrollX && ['hidden', 'clip'].includes(s.overflowX), y = !scrollY && ['hidden', 'clip'].includes(s.overflowY);
        if (boxes.some(b => (x && (b.left < r.left - 2 || b.right > r.right + 2)) || (y && (b.top < r.top - 2 || b.bottom > r.bottom + 2)))) {
          clipped.push({ text: textNodes.map(child => child.textContent).join('').trim().slice(0, 120), ancestor: ancestor.id || ancestor.tagName, x, y }); break;
        }
      }
    }
    const scaledText = (window.__saboteurQAText ?? []).map(({ node, size, text }) => ({ text, before: size, after: parseFloat(getComputedStyle(node).fontSize), connected: node.isConnected }));
    const selectedNode = selectedCardId ? document.getElementById('saboteur-hand-' + selectedCardId) : null;
    const r = selectedNode?.getBoundingClientRect();
    const selectedCard = r ? { x: r.x, y: r.y, width: r.width, height: r.height, selected: selectedNode.getAttribute('aria-label')?.startsWith('Selected '), fullyWithinViewport: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 } : null;
    return { width: innerWidth, height: innerHeight, devicePixelRatio, touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, visualViewport: window.visualViewport ? { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale } : null,
      document: document.documentElement.scrollWidth, cells: document.querySelectorAll('[aria-label^="Board row "]').length, clipped, scaledText, selectedCard };
  }, options.selectedCardId ?? null);
  const actualViewport = seat.page.viewport();
  evidence.captures.push({ file, actor: seat.name, revision: seat.public?.revision ?? null, textScale: seat.textScale ?? 100, expectedViewport, actualViewport, metrics, note: 'Viewport-only screenshot. Geometry and text scale measured after screenshot; nested scroll position is not a full-page claim.' });
  assert(['width', 'height', 'deviceScaleFactor', 'isMobile', 'hasTouch', 'isLandscape'].every(key => expectedViewport[key] === actualViewport[key])
    && metrics.width === width && metrics.height === height && Math.abs(metrics.devicePixelRatio - (expectedViewport.deviceScaleFactor ?? 1)) < 0.01, 'Screenshot changed actual viewport or emulation flags');
  assert(expectedViewport.hasTouch ? metrics.touchPoints === 1 && metrics.coarse : metrics.touchPoints === 0 && !metrics.coarse, 'Captured touch/coarse state differs from requested mode');
  if (options.selectedCardId) {
    (evidence.handFrames ??= []).push({ phase: 'after-screenshot', file, ...metrics.selectedCard });
    assert(metrics.selectedCard?.selected, 'Screenshot lost the selected card');
    if (!metrics.selectedCard.fullyWithinViewport) evidence.visualFindings.push({ file, type: 'selected-card-not-framed-after-screenshot', bounds: metrics.selectedCard });
  }
  if (seat.textScale === 200) assert(metrics.scaledText.length > 0 && metrics.scaledText.every(sample => sample.connected && Math.abs(sample.after - sample.before * 2) < 0.2), '200% text changed before capture');
  assert(metrics.document <= width + 1, 'Horizontal page overflow, see capture receipt'); return metrics;
}

async function measureGoals(seat) {
  return seat.page.evaluate((positions) => {
    const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const board = document.getElementById('saboteur-board');
    const scroller = board?.querySelector('[role="region"][aria-label^="Mine board"]');
    if (!board || !scroller) throw new Error('Board scroll region absent');
    const visible = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const ancestors = [];
    for (let node = scroller; node; node = node.parentElement) {
      const style = getComputedStyle(node), bounds = rect(node);
      const x = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX), y = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY);
      if (x) { visible.left = Math.max(visible.left, bounds.left); visible.right = Math.min(visible.right, bounds.right); }
      if (y) { visible.top = Math.max(visible.top, bounds.top); visible.bottom = Math.min(visible.bottom, bounds.bottom); }
      if (x || y) ancestors.push({ id: node.id || null, bounds, overflowX: style.overflowX, overflowY: style.overflowY, scrollTop: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight });
    }
    const goals = positions.map(position => {
      const id = `saboteur-cell-${position.row}-${position.col}`, node = document.getElementById(id), bounds = node ? rect(node) : null;
      return { id, position, bounds, fullyVisible: !!bounds && bounds.left >= visible.left - 1 && bounds.top >= visible.top - 1 && bounds.right <= visible.right + 1 && bounds.bottom <= visible.bottom + 1 };
    });
    return { board: rect(board), scrollViewport: rect(scroller), visibleBoardBounds: visible, scrollTop: scroller.scrollTop, clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight, ancestors, goals };
  }, seat.public.goals.map(goal => goal.position));
}

async function captureGoals(seat, width, height = 844) {
  await click(seat.page, 'GOALS');
  const afterClick = await measureGoals(seat);
  await seat.page.$eval('#saboteur-board', node => node.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' }));
  await delay(250);
  const afterOuterFrame = await measureGoals(seat);
  await capture(seat, 'goals', width, height);
  const afterScreenshot = await measureGoals(seat), file = evidence.screenshots.at(-1);
  (evidence.goalFrames ??= []).push({ file, width, height, afterClick, afterOuterFrame, afterScreenshot });
  assert(Math.abs(afterClick.scrollTop - afterOuterFrame.scrollTop) < 1 && Math.abs(afterClick.scrollTop - afterScreenshot.scrollTop) < 1, 'Outer framing or screenshot changed internal board offset');
  if (!afterScreenshot.goals.length || afterScreenshot.goals.some(goal => !goal.fullyVisible)) evidence.visualFindings.push({ file, type: 'potential-goals-jump-failure', note: 'Expected public goal cells are not fully inside the visible board region after GOALS. See exact scroll and clipping-ancestor metrics.', metrics: afterScreenshot });
}

async function phaseNotification(seat) {
  if (!seat.public) return;
  const key = `${seat.public.round}:${seat.public.status}:${seat.public.goldDistribution?.currentPickerId ?? ''}`;
  if (seat.lastNotificationPhase === key) return;
  seat.lastNotificationPhase = key;
  const observed = { revision: seat.public.revision, round: seat.public.round, status: seat.public.status, picker: seat.public.goldDistribution?.currentPickerId ?? null };
  const messages = await seat.page.$$eval('[aria-live]', nodes => nodes.filter(node => {
    const r = node.getBoundingClientRect(), s = getComputedStyle(node);
    return r.width > 0 && r.height > 0 && s.visibility === 'visible' && !node.closest('[aria-hidden="true"]');
  }).map(node => ({ id: node.id || null, text: node.textContent.trim().slice(0, 400) })));
  (evidence.phaseNotifications ??= []).push({ actor: seat.name, ...observed, revisionAfterDOMRead: seat.public?.revision,
    stableProjection: seat.public?.revision === observed.revision, lastAccepted: seat.accepted.at(-1) ?? null, messages });
}

async function presentationCapture(seat, name, width, { scale = 100, frameLabel, frameSelector, desktop = false, height = 844 } = {}) {
  await setViewport(seat, width, height, !desktop);
  try {
    if (scale === 200) await enlargeText(seat);
    if (frameLabel) {
      const button = await findButton(seat.page, frameLabel); assert(button, 'Missing framing control ' + frameLabel);
      await button.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })); await button.dispose();
    } else if (frameSelector) await seat.page.$eval(frameSelector, node => node.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' }));
    const metrics = await capture(seat, name, width, height);
    if (metrics.clipped.length) evidence.visualFindings.push({ file: evidence.screenshots.at(-1), type: 'clipped-presentation-text', textScale: scale, clipped: metrics.clipped });
    if (desktop && seat.public?.status === 'playing') {
      const layout = await seat.page.evaluate(() => {
        const bounds = id => { const node = document.getElementById(id); if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; };
        const boardScroll = document.querySelector('#saboteur-board [role="region"]');
        return { workspace: bounds('saboteur-workspace'), mine: bounds('saboteur-mine-column'), decisions: bounds('saboteur-decision-column'), hand: bounds('saboteur-hand-controls'), roster: bounds('saboteur-players'), boardScrollHeight: boardScroll?.getBoundingClientRect().height ?? 0 };
      });
      (evidence.desktopLayouts ??= []).push({ file: evidence.screenshots.at(-1), textScale: scale, layout });
      const alongside = layout.mine && layout.decisions && layout.mine.right <= layout.decisions.x + 1 && layout.mine.width >= 320 && layout.decisions.width >= 320;
      if (!alongside || layout.boardScrollHeight < height * 0.5 || !layout.hand || !layout.roster) evidence.visualFindings.push({ file: evidence.screenshots.at(-1), type: 'desktop-workspace-not-tall-and-alongside', layout });
    }
  } finally { if (scale === 200) await restoreText(seat); }
}

async function enlargeText(seat) {
  seat.textScale = 200;
  const baseline = await seat.page.evaluate(() => {
    const qaStyle = document.createElement('style'); qaStyle.id = 'saboteur-qa-no-transitions';
    qaStyle.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}'; document.head.appendChild(qaStyle);
    const values = [], excluded = [];
    for (const node of document.querySelectorAll('body *')) {
      if (!node.matches('input,textarea') && ![...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) continue;
      const style = getComputedStyle(node), bounds = node.getBoundingClientRect(), size = parseFloat(style.fontSize);
      const reason = node.closest('[aria-hidden="true"]') ? 'aria-hidden' : bounds.width <= 0 || bounds.height <= 0 ? 'no-layout-box'
        : style.visibility !== 'visible' ? 'hidden' : /icon|material|fontawesome/i.test(style.fontFamily) ? 'icon-glyph' : null;
      const text = node.getAttribute('aria-label') || node.textContent.trim().slice(0, 100);
      if (reason) { excluded.push({ text, reason }); continue; }
      if (!Number.isFinite(size) || size <= 0) throw new Error('Visible text has invalid computed font size');
      values.push({ node, size, line: parseFloat(style.lineHeight), text, originalId: node.getAttribute('data-qa-text-scale-id') });
    }
    window.__saboteurQAText = values;
    qaStyle.textContent += values.map(({ node, size, line }, index) => {
      node.setAttribute('data-qa-text-scale-id', String(index));
      return `[data-qa-text-scale-id="${index}"]{font-size:${size * 2}px!important;${Number.isFinite(line) ? `line-height:${line * 2}px!important;` : ''}}`;
    }).join('\n');
    return { count: values.length, excluded, samples: values.map(({ text, size }) => ({ text, before: size })) };
  });
  const record = { actor: seat.name, viewport: seat.page.viewport(), baseline, actual: [] };
  (evidence.enlargedText ??= []).push(record);
  assert(baseline.count > 0, 'No visible text scaled');
  await seat.page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await delay(100);
  await until(async () => {
    record.actual = await seat.page.evaluate(() => window.__saboteurQAText.map(({ node, size, text }) => ({ text, before: size, after: parseFloat(getComputedStyle(node).fontSize), connected: node.isConnected })));
    return record.actual.every(sample => sample.connected && Math.abs(sample.after - sample.before * 2) < 0.2);
  }, 'all visible text computed at 200%', 5000);
}

async function restoreText(seat) {
  await seat.page.evaluate(() => {
    for (const { node, originalId } of window.__saboteurQAText ?? []) {
      if (originalId === null) node.removeAttribute('data-qa-text-scale-id'); else node.setAttribute('data-qa-text-scale-id', originalId);
    }
    delete window.__saboteurQAText; document.getElementById('saboteur-qa-no-transitions')?.remove();
  });
  seat.textScale = 100;
}

async function phoneHandReview(seat) {
  assert(seat.private.hand.length > 0, 'Opening hand absent');
  const card = seat.private.hand.find(card => card.type === 'path') ?? seat.private.hand[0];
  await select(seat, card);
  const frameHand = async () => {
    await seat.page.$eval(`[id="saboteur-hand-${card.id}"]`, node => node.scrollIntoView({ block: 'center', inline: 'center' }));
    await delay(250);
    const rect = await seat.page.$eval(`[id="saboteur-hand-${card.id}"]`, node => {
      const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight, selected: node.getAttribute('aria-label')?.startsWith('Selected ') };
    });
    assert(rect.selected && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= rect.viewportWidth + 1 && rect.y + rect.height <= rect.viewportHeight + 1, 'Selected hand card not framed in viewport');
    (evidence.handFrames ??= []).push({ phase: 'before-screenshot', ...rect });
  };
  for (const [width, height] of [[375, 844], [414, 844], [844, 390]]) {
    await setViewport(seat, width, height, true); await frameHand();
    const metrics = await capture(seat, 'selected-card-hand', width, height, { selectedCardId: card.id });
    if (metrics.clipped.length) evidence.visualFindings.push({ file: evidence.screenshots.at(-1), type: 'clipped-gameplay-text', textScale: 100, clipped: metrics.clipped });
  }
  await setViewport(seat, 375, 844, true);
  try {
    await enlargeText(seat); await frameHand();
    const metrics = await capture(seat, 'selected-card-hand', 375, 844, { selectedCardId: card.id });
    if (metrics.clipped.length) evidence.visualFindings.push({ file: evidence.screenshots.at(-1), type: 'clipped-gameplay-text', textScale: 200, clipped: metrics.clipped });
  } finally { await restoreText(seat); }
  await click(seat.page, 'CANCEL SELECTION');
}

async function normalExit(seat, label) {
  const before = seat.leaveResponses.length;
  await click(seat.page, label);
  await until(async () => seat.leaveResponses.slice(before).includes(200) && new URL(seat.page.url()).pathname === '/'
    && await seat.page.evaluate(() => sessionStorage.getItem('za:auth') === null), seat.name + ' normal exit and cleared auth');
  seat.released = true;
  evidence.cleanup.push({ name: seat.name, normalUI: true, status: 200, authCleared: true, destination: '/' });
}

async function releaseOwnedSeats() {
  for (const seat of ownedSeats) {
    await Promise.allSettled([...seat.transactions]);
    if (seat.released) continue;
    if (!seat.auth && !seat.page.isClosed()) {
      const raw = await seat.page.evaluate(() => sessionStorage.getItem('za:auth')).catch(() => null);
      try { const auth = JSON.parse(raw); if (auth?.token && auth.roomCode && auth.playerId) { secrets.add(auth.token); seat.auth = auth; } } catch { /* A failed create may have no saved session. */ }
    }
    if (!seat.auth) {
      evidence.cleanup.push({ name: seat.name, normalUI: false, status: null, noOwnedSession: !seat.room, uncertain: !!seat.room });
      if (seat.room) { evidence.passed = false; evidence.issues.push({ name: seat.name, type: 'cleanup', text: 'Room observed without owned cleanup credentials' }); }
      continue;
    }
    let status = null;
    try {
      const response = await fetch(new URL('/rooms/' + encodeURIComponent(seat.auth.roomCode) + '/leave', API_URL), {
        method: 'POST', headers: { Authorization: 'Bearer ' + seat.auth.token }, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      status = response.status;
    } catch { /* Receipt reports unsuccessful fallback without request credentials. */ }
    evidence.cleanup.push({ name: seat.name, normalUI: false, status, fallback: true });
    if (status !== 200) { evidence.passed = false; evidence.issues.push({ name: seat.name, type: 'cleanup', text: 'Owned REST release did not return 200' }); }
  }
}
async function dismissRole(seat) { const control = await findButton(seat.page, 'HIDE SECRET ROLE'); if (control) { await activate(seat.page, control); await control.dispose(); await delay(60); } }
async function select(seat, card) {
  const id = 'saboteur-hand-' + card.id;
  const selected = await seat.page.$eval('[id="' + id + '"]', (node) => node.getAttribute('aria-label')?.startsWith('Selected ') || node.getAttribute('aria-pressed') === 'true' || node.getAttribute('aria-selected') === 'true').catch(() => false);
  if (!selected) await clickId(seat.page, id);
  await until(() => seat.page.$eval('[id="' + id + '"]', (node) => node.getAttribute('aria-label')?.startsWith('Selected ')).catch(() => false), 'selected hand card');
}
async function legalCells(seat) {
  return seat.page.$$eval('#saboteur-board [role="button"][aria-label*="Legal target."]', (nodes) => nodes.filter((node) => node.getAttribute('aria-disabled') !== 'true').map((node) => ({ id: node.id, row: Number(node.id.split('-').at(-2)), col: Number(node.id.split('-').at(-1)) })));
}
async function settled(seat, revision, action) {
  await until(() => paired(seat) && seat.public.revision > revision && seat.accepted.some((ack) => ack.action === action && ack.revision > revision), seat.name + ' ' + action + ' accepted');
  assert(seat.rejected.length === 0, 'Rejected action: ' + JSON.stringify(seat.rejected));
  evidence.decisions.push({ actor: seat.name, round: seat.public.round, fromRevision: revision, revision: seat.public.revision, action }); await delay(130);
}
async function playTurn(seat) {
  const state = seat.public, own = seat.private, revision = state.revision;
  const me = state.players.find((player) => player.playerId === own.playerId), miner = own.role === 'miner';
  const ranked = own.hand.map((card) => ({ card, score: card.type === 'path' ? (miner ? card.isDeadEnd ? -10 : 8 : card.isDeadEnd ? 8 : -1) : card.subtype.startsWith('repair_') && me.brokenTools.some((tool) => card.subtype.includes(tool)) ? 20 : card.subtype === 'map' ? 10 : card.subtype.startsWith('sabotage_') ? 4 : card.subtype === 'rockfall' && !miner ? 9 : 0 })).sort((a, b) => b.score - a.score);
  for (const { card } of ranked) {
    if (card.type === 'path' && me.brokenTools.length) continue;
    await select(seat, card);
    if (card.type === 'path') {
      for (let rotation = 0; rotation < 2; rotation++) {
        const targets = await legalCells(seat), goal = own.peekedGoals.find((peek) => peek.isGold)?.position ?? { row: 8, col: 4 };
        const bottomOpen = (rotation ? card.edges.top : card.edges.bottom) === 'open';
        targets.sort((a, b) => (b.row * 5 - Math.abs(b.col - goal.col)) - (a.row * 5 - Math.abs(a.col - goal.col)));
        if (targets.length && (!miner || !card.isDeadEnd) && (!miner || bottomOpen || targets[0].row >= 7 || rotation === 1)) {
          await clickId(seat.page, targets[0].id); await settled(seat, revision, 'place_card'); return;
        }
        if (rotation === 0) await click(seat.page, 'ROTATE');
      }
    } else if (card.subtype === 'map' || card.subtype === 'rockfall') {
      const targets = await legalCells(seat); if (card.subtype === 'rockfall' && miner) continue;
      targets.sort((a, b) => b.row - a.row);
      if (targets.length) {
        await clickId(seat.page, targets[0].id); await settled(seat, revision, 'play_action');
        if (card.subtype === 'map') seat.mapNoticeExpires = Date.now() + 4000;
        return;
      }
    } else {
      const ids = await seat.page.$$eval('#saboteur-players [role="button"][aria-label*="Eligible target."]', (nodes) => nodes.map((node) => node.id.replace('saboteur-player-', '')));
      const selected = ids.includes(own.playerId) ? own.playerId : ids[0];
      if (selected) {
        await clickId(seat.page, 'saboteur-player-' + selected);
        for (const tool of card.subtype.replace('repair_', '').split('_')) { const choice = await findButton(seat.page, tool.toUpperCase()); if (choice) { await activate(seat.page, choice); await choice.dispose(); break; } }
        await settled(seat, revision, 'play_action'); return;
      }
    }
  }
  if (own.hand.length) await select(seat, ranked.at(-1).card);
  await click(seat.page, 'PASS'); if (own.hand.length) await click(seat.page, 'PASS'); await settled(seat, revision, 'pass_turn');
}
async function runMatch(seats) {
  const capturedRounds = new Set();
  for (let step = 0; step < 650; step++) {
    await until(() => seats.every(paired), 'paired player projections'); const state = seats[0].public;
    for (const seat of seats) await phaseNotification(seat);
    for (const seat of seats) if (seat.mapNoticeExpires && Date.now() > seat.mapNoticeExpires) {
      assert(await seat.page.evaluate(() => !document.body.innerText.includes('Just worthless stone…') && !document.body.innerText.includes('That goal is the GOLD!')), 'Map notice did not expire after unrelated state updates');
      seat.mapNoticeExpires = null; evidence.mapNoticeExpired = true;
    }
    if (state.status === 'game_over') { assert(state.round === 3 && !state.terminationReason && state.winnerIds?.length, 'Match must end naturally after three rounds'); if (!capturedRounds.has(state.round)) evidence.rounds.push({ round: state.round, winner: state.roundWinner }); return state; }
    for (const seat of seats) await dismissRole(seat);
    if (state.status === 'round_end') {
      if (!capturedRounds.has(state.round)) { capturedRounds.add(state.round); evidence.rounds.push({ round: state.round, winner: state.roundWinner }); await capture(seats[0], 'round-' + state.round); }
      const picker = seats.find((seat) => seat.private.playerId === state.goldDistribution?.currentPickerId);
      if (picker) {
        await until(() => paired(picker) && picker.private.availableGoldCards?.length, 'private gold offer');
        const values = picker.private.availableGoldCards, index = values.indexOf(Math.max(...values)), revision = picker.public.revision;
        assert(seats.filter((seat) => seat !== picker).every((seat) => seat.private.availableGoldCards === null), 'Gold offers leaked to non-picker');
        await capture(picker, 'gold-choice-round-' + state.round);
        await click(picker.page, 'Choose gold card ' + (index + 1) + ', worth ' + values[index] + ' gold'); await settled(picker, revision, 'choose_gold');
      } else await delay(250);
      continue;
    }
    const current = seats.find((seat) => seat.private.playerId === state.currentTurnPlayerId); assert(current, 'Missing acting browser seat');
    await until(() => paired(current) && current.public.revision === state.revision, 'acting seat current projection'); await playTurn(current);
    if (evidence.decisions.length % 20 === 0) console.log(JSON.stringify({ progress: 'natural-match', actions: evidence.decisions.length, round: current.public.round, deck: current.public.deckSize }));
  }
  throw new Error('Natural game exceeded bounded gate');
}
async function fixtureGate(seats) {
  const host = seats[0];
  evidence.method = 'Supplementary canonical conserving fixtures with real rendered UI actions; not a natural or manual match.';
  evidence.fixtures = [];
  for (const scenario of MAP_BEFORE_ONLY || RETAINED_TURN_ONLY ? ['stone'] : ['dual_repair', 'stone', 'gold']) {
    const response = await fetch('http://127.0.0.1:3213/__qa/saboteur-fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomCode: host.public.roomCode, scenario }) });
    assert(response.ok, 'Fixture API rejected scenario'); const receipt = await response.json();
    assert(receipt.canonicalCards === 67 && receipt.goldNuggets === 44, 'Fixture conservation receipt');
    await until(() => seats.every((seat) => paired(seat) && seat.public.revision === receipt.revision), 'fixture paired projections');
    evidence.fixtures.push(receipt); await delay(200);
    if (scenario === 'dual_repair') {
      const card = host.private.hand.find((card) => card.subtype === 'repair_lantern_cart'); await select(host, card);
      await clickId(host.page, 'saboteur-player-' + host.private.playerId); await capture(host, 'dual-repair-choice', 320);
      const revision = host.public.revision; await click(host.page, 'CART'); await settled(host, revision, 'play_action');
      const tools = host.public.players.find((player) => player.playerId === host.private.playerId).brokenTools;
      assert(tools.length === 1 && tools[0] === 'lantern', 'Dual repair removed wrong tools');
      continue;
    }
    if (scenario === 'stone') {
      const card = host.private.hand.find((card) => card.subtype === 'map'); await select(host, card);
      const revision = host.public.revision; await clickId(host.page, 'saboteur-cell-8-4'); await settled(host, revision, 'play_action');
      assert(host.private.peekedGoals.length === 1 && seats.slice(1).every((seat) => seat.private.peekedGoals.length === 0), 'Private goal peek leaked');
      await capture(host, 'private-corner-map', 390);
      const knowledge = JSON.stringify(host.private.peekedGoals), secondMap = host.private.hand.find((card) => card.subtype === 'map');
      assert(secondMap, 'Second canonical Map absent'); await select(host, secondMap);
      const repeatSelectable = await host.page.$eval('#saboteur-cell-8-4', (node) => node.getAttribute('aria-disabled') !== 'true');
      receipt.repeatSelectable = repeatSelectable;
      if (!MAP_BEFORE_ONLY) {
        assert(repeatSelectable, 'Previously mapped hidden goal is not selectable');
        const before = { revision: host.public.revision, sent: host.sent.length, hand: host.private.hand.length, deck: host.public.deckSize };
        await clickId(host.page, 'saboteur-cell-8-4'); await settled(host, before.revision, 'play_action');
        assert(host.public.revision === before.revision + 1 && host.sent.length === before.sent + 1, 'Repeat Map did not consume exactly one action/revision');
        assert(!host.private.hand.some((card) => card.id === secondMap.id), 'Second Map was not consumed');
        assert(host.private.hand.length === before.hand && host.public.deckSize === before.deck - 1, 'Repeat Map consumed or drew the wrong number of cards');
        assert(JSON.stringify(host.private.peekedGoals) === knowledge && host.private.peekedGoals.length === 1, 'Repeat Map duplicated or changed private knowledge');
        assert(seats.slice(1).every((seat) => seat.private.peekedGoals.length === 0), 'Repeated Map leaked');
        receipt.repeatMap = { revision: host.public.revision, oneCardConsumed: true, oneCommand: true, oneRevision: true, privatePeekUnchanged: true };
      } else await click(host.page, 'CANCEL SELECTION');
    }
    const pathCard = host.private.hand.find((card) => card.type === 'path' && card.edges.center && (scenario === 'stone' ? card.edges.top === 'closed' && card.edges.left === 'closed' && card.edges.right === 'open' && card.edges.bottom === 'open' : card.edges.top === 'open' && card.edges.bottom === 'open'));
    assert(pathCard, 'Fixture finishing path absent'); await select(host, pathCard);
    if (scenario === 'stone') await click(host.page, 'ROTATE');
    const revision = host.public.revision; await clickId(host.page, scenario === 'stone' ? 'saboteur-cell-8-5' : 'saboteur-cell-7-4'); await settled(host, revision, 'place_card');
    if (scenario === 'stone') {
      const revealed = host.public.board.find((placed) => placed.position.row === 8 && placed.position.col === 4);
      assert(revealed?.card.subtype === 'goal_stone' && Object.values(revealed.card.edges).filter((edge) => edge === 'open').length === 2, 'Stone goal is not printed corner');
      assert(revealed.card.edges.right === 'open' && revealed.card.edges.bottom === 'open', 'Side-entered stone did not rotate');
      const obsoleteStrip = await host.page.$$eval('[aria-label^="Private map knowledge:"]', (nodes) => nodes.some((node) => node.getAttribute('aria-label').includes('CENTRE')));
      receipt.rotatedStone = { publicEdges: revealed.card.edges, retainedPrivateEdges: host.private.peekedGoals[0].edges, obsoleteStrip };
      if (!MAP_BEFORE_ONLY) assert(!obsoleteStrip && host.private.peekedGoals.length === 1, 'Revealed goal retained an obsolete private strip or lost raw history');
      await host.page.setViewport({ width: 390, height: 844 }); await delay(3700); await click(host.page, 'GOALS');
      await host.page.$eval('#saboteur-cell-8-4', (node) => node.scrollIntoView({ block: 'center' })); await delay(200);
      if (RETAINED_TURN_ONLY) {
        const copy = await host.page.evaluate(() => document.body.innerText);
        assert(host.public.currentTurnPlayerId === host.private.playerId && copy.includes('YOUR TURN'), 'Fixture actor did not retain the turn');
        assert(copy.includes('Move accepted.') && !copy.includes('Waiting for the next turn.'), 'Retained-turn acknowledgement falsely requires waiting');
        receipt.retainedTurn = { revision: host.public.revision, yourTurn: true, neutralAcknowledgement: true, falseWaitingSuffix: false };
      }
      await capture(host, 'revealed-rotated-stone', 390); continue;
    }
    assert(host.private.availableGoldCards?.join(',') === '1,3', 'Gold values not privately delivered');
    assert(seats.slice(1).every((seat) => seat.private.availableGoldCards === null), 'Gold values leaked');
    await capture(host, 'visible-gold-values', 320); await capture(host, 'visible-gold-values', 1280);
    const pickRevision = host.public.revision; await click(host.page, 'Choose gold card 2, worth 3 gold', true); await settled(host, pickRevision, 'choose_gold');
    assert(host.private.goldCollected === 3, 'Chosen gold value incorrect');
    const next = seats.find((seat) => seat.private.playerId === host.public.goldDistribution.currentPickerId);
    await until(() => next.private.availableGoldCards?.length === 1, 'next private gold offer');
    const nextRevision = next.public.revision; await click(next.page, 'Choose gold card 1, worth 1 gold'); await settled(next, nextRevision, 'choose_gold');
    await capture(host, 'gold-round-result', 390);
  }
}
const HAND_SIZING_PLAN = Object.freeze({ target: 'hand-sizing', scenario: 'stone', natural: false, appCaptureCap: 40, calibrationCaptures: 2, deadlineMs: 480000, logicalFrames: 20,
  profiles: [{ width: 375, height: 844, touch: true }, { width: 1280, height: 900, touch: false }, { width: 320, height: 844, touch: true }],
  coverage: 'First path and last Map complete faces and selected live instructions at 375 touch and 1280 fine, normal/CSS200; 320 first/last face supplement. Every capture checks all three same-role painted hand faces. Repeated Map face is DOM-checked, not separately visually reviewed. One real Map, then deliberate below-three departure. Not a natural match.' });

function handSizingTarget(env) {
  const target = env.SABOTEUR_UI_TARGET;
  assert(target === undefined || target === 'hand-sizing', 'Unknown SABOTEUR_UI_TARGET');
  if (target === undefined) return false;
  assert(env.SABOTEUR_UI_FIXTURES === 'true', 'hand-sizing requires SABOTEUR_UI_FIXTURES=true');
  assert(env.SABOTEUR_UI_EXCLUSIVE_WINDOW === 'granted', 'hand-sizing requires an exclusive browser window');
  assert(env.SABOTEUR_MAP_BEFORE_ONLY !== 'true' && env.SABOTEUR_RETAINED_TURN_ONLY !== 'true', 'hand-sizing conflicts with legacy fixture selectors');
  assert(typeof env.SABOTEUR_EVIDENCE_DIR === 'string' && env.SABOTEUR_EVIDENCE_DIR.trim(), 'Explicit fresh evidence directory required');
  assert(/^[a-f0-9]{64}$/i.test(env.SABOTEUR_EXPECTED_SHA256 ?? ''), 'Expected compiled SHA256 required');
  return true;
}

function handSizingSources() {
  const root = path.resolve(__dirname, '../../..'), files = [];
  const walk = folder => {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const file = folder + '/' + entry.name;
      if (entry.isDirectory()) walk(file); else files.push(file);
    }
  };
  for (const folder of ['apps/mobile/app', 'apps/mobile/components', 'apps/mobile/hooks', 'apps/mobile/lib', 'apps/mobile/store', 'apps/mobile/constants', 'apps/mobile/assets/game-art', 'packages/types/src', 'apps/server/src', 'apps/server/scripts/saboteur']) walk(folder);
  files.push('apps/mobile/global.css', ...['saboteur-ui-smoke.cjs', 'saboteur-ui-smoke.test.cjs', 'libertalia-ui-primitives.cjs', 'skull-ui-evidence.cjs', 'tokyo-ui-evidence.cjs'].map(file => 'apps/mobile/scripts/' + file));
  return Object.fromEntries([...new Set(files)].sort().map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
}

function measureHandFaces(nodes) {
  const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  return nodes.map(node => {
    const surfaces = [...node.querySelectorAll('div')].filter(candidate => candidate.children.length === 2
      && getComputedStyle(candidate.children[0]).position === 'absolute' && getComputedStyle(candidate.children[1]).overflow === 'hidden');
    if (surfaces.length !== 1) throw Error('Hand must contain exactly one canonical painted CardSurface');
    const face = surfaces[0].children[1], bounds = rect(face), texts = [];
    for (const child of face.querySelectorAll('*')) {
      const css = getComputedStyle(child);
      if (/icon|material|fontawesome/i.test(css.fontFamily) || child.closest('[aria-hidden="true"]')) continue;
      for (const text of child.childNodes) if (text.nodeType === Node.TEXT_NODE && text.textContent.trim()) {
        const geometry = window.__coupQATextGeometry(text);
        const words = geometry.text.match(/\S+/g) ?? [];
        const splitWords = words.filter(word => {
          const start = geometry.text.indexOf(word), end = start + word.length;
          return new Set(geometry.glyphRects.filter(g => g.start >= start && g.end <= end).map(g => Math.round(g.top))).size > 1;
        });
        texts.push({ text: text.textContent, fontSize: parseFloat(css.fontSize), fontFamily: css.fontFamily, splitWords,
          proof: window.__coupQAOverflowProof([geometry], bounds, true, true, 2) });
      }
    }
    return { id: node.id, selected: node.getAttribute('aria-label')?.startsWith('Selected '), label: node.getAttribute('aria-label'), wrapper: rect(node),
      ...bounds, layoutWidth: face.offsetWidth, layoutHeight: face.offsetHeight, scrollWidth: face.scrollWidth, clientWidth: face.clientWidth, texts, svg: !!face.querySelector('svg') };
  });
}

function assertHandFaces(boxes, cards) {
  assert(boxes.length === cards.length && cards.length === 3, 'Expected exact three-card hand');
  assert(new Set(boxes.map(box => box.id)).size === 3, 'Duplicate hand card DOM identity');
  for (const card of cards) {
    const box = boxes.find(box => box.id === 'saboteur-hand-' + card.id);
    assert(box && box.width > 0 && box.height > 0, 'Missing painted hand card');
    assert(box.scrollWidth <= box.clientWidth + 2, 'Painted hand face overflows horizontally');
    assert(box.texts.every(text => !text.proof.glyphs.length && !text.splitWords.length), 'Hand label is clipped or splits inside a word');
    if (card.type === 'path') assert(box.svg, 'Live path geometry absent');
    else assert(box.texts.some(t => t.text === 'INTEL') && box.texts.some(t => t.text === 'Map Goal'), 'Map full printed copy absent');
  }
  for (const dimension of ['width', 'height', 'layoutWidth', 'layoutHeight']) assert(Math.max(...boxes.map(b => b[dimension])) - Math.min(...boxes.map(b => b[dimension])) <= 2, 'Mixed hand painted ' + dimension + ' differs');
}

async function persistHandSample(read, cards, record, field, persist) {
  const boxes = await read();
  record[field] = boxes;
  persist();
  assertHandFaces(boxes, cards);
  return boxes;
}

function assertHandSampleStable(before, after) {
  assert(before.length === after.length, 'Painted hand identity count changed during capture');
  for (const first of before) {
    const last = after.find(box => box.id === first.id);
    assert(last && last.label === first.label && last.selected === first.selected, 'Painted hand identity or selection changed during capture');
    for (const axis of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
      assert(Number.isFinite(first[axis]) && Number.isFinite(last[axis]) && Math.abs(first[axis] - last[axis]) <= 1, 'Painted hand ' + axis + ' changed during capture');
    }
  }
}

async function handSizingCommand(seat, seats, dispatch, record, wait = until) {
  const start = { revision: seat.public.revision, accepted: seat.accepted.length, sent: seat.sent.length, rejected: seat.rejected.length };
  record.command = { beforeRevision: start.revision, rawAcknowledgements: [], rawCommands: [] };
  const validate = () => {
    const acks = seat.accepted.slice(start.accepted), sent = seat.sent.slice(start.sent);
    assert(acks.length === 1 && acks[0].action === 'play_action' && acks[0].revision === start.revision + 1, 'Expected exactly one matching Map acknowledgement');
    assert(sent.length === 1 && sent[0][0] === 'play_action', 'Expected exactly one real Map command');
    if (record.expectedMap) assert(JSON.stringify(sent[0][1]) === JSON.stringify({ ...record.expectedMap, expectedRevision: start.revision }), 'Map command payload differs from selected card and target');
    assert(seat.rejected.length === start.rejected, 'Map command rejected');
    return acks[0].revision;
  };
  try {
    await dispatch();
    await wait(() => {
      if (seat.accepted.length === start.accepted) return false;
      const revision = validate();
      return seats.every(other => paired(other) && other.public.revision === revision);
    }, 'Single Map acknowledgement and fresh projections for all owners');
    validate();
  } finally {
    record.command.rawAcknowledgements = structuredClone(seat.accepted.slice(start.accepted));
    record.command.rawCommands = structuredClone(seat.sent.slice(start.sent));
  }
  return () => {
    try { return validate(); }
    finally {
      record.command.rawAcknowledgements = structuredClone(seat.accepted.slice(start.accepted));
      record.command.rawCommands = structuredClone(seat.sent.slice(start.sent));
    }
  };
}

function handSizingCleanupPassed(cleanup, names, closed) {
  return closed && cleanup.length === names.length && names.every(name => {
    const rows = cleanup.filter(row => row.name === name);
    return rows.length === 1 && rows[0].normalUI === true && rows[0].status === 200 && rows[0].authCleared === true && !rows[0].fallback;
  });
}

async function handSizingClick(seat, selector) {
  let stable = 0, previous = null;
  await until(async () => {
    const samples = await seat.page.$$eval(selector, nodes => nodes.filter(node => {
      const r = node.getBoundingClientRect();
      return r.width && r.height && getComputedStyle(node).visibility === 'visible' && !node.closest('[aria-hidden="true"]');
    }).map(node => {
      node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { x: r.x, y: r.y, width: r.width, height: r.height, hit: !!hit && (hit === node || node.contains(hit)), enabled: !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true' };
    }));
    assert(samples.length <= 1, 'Ambiguous target control');
    const current = samples[0], stamp = JSON.stringify(current);
    stable = current?.enabled && current.hit && stamp === previous ? stable + 1 : 0;
    previous = stamp;
    return stable >= 2;
  }, 'Stable enabled single real pointer target: ' + selector, 10000);
  const element = await seat.page.$(selector); assert(element, 'Target disappeared before activation');
  try { await activate(seat.page, element); } finally { await element.dispose(); }
}

async function handSizingMain() {
  const primitives = require('./libertalia-ui-primitives.cjs');
  const visual = require('./skull-ui-evidence.cjs');
  assert([...allowedOrigins].every(origin => local(new URL(origin))), 'Only loopback origins permitted');
  assert(!fs.existsSync(outputDir) || fs.readdirSync(outputDir).length === 0, 'Use an empty fresh evidence directory');
  fs.mkdirSync(outputDir, { recursive: true });
  const persist = () => primitives.persistReceipt(outputDir, 'result.json', evidence, [...secrets]);
  Object.assign(evidence, { method: HAND_SIZING_PLAN.coverage, coverage: HAND_SIZING_PLAN.coverage, natural: false, plan: HAND_SIZING_PLAN, passed: false, frames: [], handGeometry: [], profiles: [], browserClosed: false, contextsClosed: false });
  const seats = []; let browser, watchdog, verifyCommand;
  let captures = 0;
  const proof = { revision: null, cards: [] };
  const selectorFor = card => `[id="saboteur-hand-${card.id}"]`;
  const readHand = seat => seat.page.$$eval('[id^="saboteur-hand-"][role="button"]', measureHandFaces);
  const inspect = async (seat, state) => {
    await visual.settle(seat.page);
    await seat.page.evaluate(visual.installTextGeometry);
    const sample = { profile: seat.page.viewport().width, state, actor: seat.name, revision: seat.public.revision };
    evidence.handGeometry.push(sample);
    return persistHandSample(() => readHand(seat), proof.cards, sample, 'boxes', persist);
  };
  async function frame(seat, name, selector) {
    for (const scale of [false, true]) {
      const records = [];
      try {
        if (scale) await primitives.enlargeLibertaliaText(seat.page);
        for (const align of ['start', 'end']) {
          assert(captures < HAND_SIZING_PLAN.appCaptureCap, 'Hand supplement capture cap exhausted');
          assert(await seat.page.$$eval(selector, nodes => nodes.length) === 1, 'Frame selector missing or ambiguous');
          await seat.page.$eval(selector, (node, block) => node.scrollIntoView({ block, inline: 'center', behavior: 'instant' }), align);
          const visible = await seat.page.$eval(selector, primitives.frameVisibility);
          await seat.page.$eval(selector, (node, { visible, align }) => {
            const box = node.getBoundingClientRect(), delta = align === 'start' ? box.top - visible.top : box.bottom - visible.bottom;
            for (let owner = node.parentElement; owner; owner = owner.parentElement) if (/(auto|scroll)/.test(getComputedStyle(owner).overflowY) && owner.scrollHeight > owner.clientHeight) { owner.scrollTop += delta; return; }
            window.scrollBy(0, delta);
          }, { visible, align });
          await visual.settle(seat.page);
          assert(seats.every(s => paired(s) && s.public.revision === proof.revision), 'Fixture pair changed during framing');
          await seat.page.evaluate(visual.installTextGeometry);
          const record = { file: `${String(++captures).padStart(3, '0')}-${name}-${scale ? 200 : 100}-${align}.png`, actor: seat.name, revision: proof.revision, scale: scale ? 200 : 100, selector, viewport: seat.page.viewport(), metrics: {
            frame: await seat.page.$eval(selector, node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; }),
            frameVisibleBounds: await seat.page.$eval(selector, primitives.frameVisibility),
          } };
          evidence.captures.push(record); persist();
          record.metrics.fullCopy = await seat.page.$eval(selector, frame => [...frame.querySelectorAll('*')].flatMap(node => {
            const css = getComputedStyle(node);
            if (/icon|material|fontawesome/i.test(css.fontFamily) || node.closest('[aria-hidden="true"]')) return [];
            return [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()).map(child => {
              const geometry = window.__coupQATextGeometry(child);
              return { text: child.textContent, proof: window.__coupQAOverflowProof([geometry], node.getBoundingClientRect(), true, true, 2) };
            });
          }));
          assert(record.metrics.fullCopy.every(item => !item.proof.glyphs.length), 'Full instruction/card text escapes its text box');
          record.metrics.controls = await seat.page.$eval(selector, frame => [frame, ...frame.querySelectorAll('[role="button"],button')].filter(node => node.matches('[role="button"],button')).map(node => {
            const r = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label') ?? node.textContent, width: r.width, height: r.height };
          }));
          assert(record.metrics.controls.every(control => control.width >= 48 && control.height >= 48), 'Framed hand control below 48px');
          record.metrics.preCaptureTextScaleState = scale ? await seat.page.evaluate(primitives.readLibertaliaFontState) : null;
          if (scale) primitives.validateLibertaliaFontState(record.metrics.preCaptureTextScaleState);
          await persistHandSample(() => readHand(seat), proof.cards, record.metrics, 'handFaces', persist);
          await seat.page.screenshot({ path: path.join(outputDir, record.file), fullPage: false });
          await persistHandSample(() => readHand(seat), proof.cards, record.metrics, 'postHandFaces', persist);
          assertHandSampleStable(record.metrics.handFaces, record.metrics.postHandFaces);
          const postFonts = scale ? await seat.page.evaluate(primitives.readLibertaliaFontState) : null;
          if (scale) primitives.validateLibertaliaFontState(postFonts);
          record.metrics.textScaleState = postFonts;
          assert(seats.every(s => paired(s) && s.public.revision === proof.revision), 'Fixture pair changed during screenshot');
          record.metrics.postFrame = await seat.page.$eval(selector, node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });
          record.metrics.postFrameVisibleBounds = await seat.page.$eval(selector, primitives.frameVisibility);
          for (const key of ['left', 'right', 'top', 'bottom', 'width', 'height']) assert(Math.abs(record.metrics.frame[key] - record.metrics.postFrame[key]) <= 1, 'Frame geometry changed during capture');
          for (const key of ['left', 'right', 'top', 'bottom']) assert(Math.abs(record.metrics.frameVisibleBounds[key] - record.metrics.postFrameVisibleBounds[key]) <= 1, 'Frame occlusion changed during capture');
          record.metrics.profile = await seat.page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, touch: navigator.maxTouchPoints > 0, coarse: matchMedia('(pointer: coarse)').matches }));
          const profile = record.metrics.profile;
          assert(profile.width === record.viewport.width && profile.height === record.viewport.height && profile.touch === seat.touch && profile.coarse === seat.touch, 'Screenshot profile differs from actual pointer mode');
          assert(profile.documentWidth <= profile.width + 1, 'Page horizontal overflow');
          const png = fs.readFileSync(path.join(outputDir, record.file));
          assert(png.readUInt32BE(16) === profile.width && png.readUInt32BE(20) === profile.height, 'Screenshot dimensions differ');
          records.push(record); persist();
          try { primitives.assertFrameCoverage(records); break; } catch (error) { if (align === 'end') throw error; }
        }
        evidence.frames.push({ name, scale: scale ? 200 : 100, ...primitives.assertFrameCoverage(records) }); persist();
      } finally { if (scale) await primitives.restoreLibertaliaText(seat.page); }
    }
  }
  async function work() {
    evidence.sourceBefore = handSizingSources(); await verifyBundle(); evidence.bundleBefore = { ...evidence.bundle }; persist();
    const health = await fetch(API_URL, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    assert(health.status === 200 && (await health.json()).service === 'saboteur-local-ui-fixtures', 'Exact canonical Saboteur fixture service required');
    browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + CERT] });
    const calibration = visual.createEvidence({ outputDir, base: BASE_URL, api: API_URL });
    await calibration.calibrate(browser); evidence.calibration = calibration.evidence.calibration;
    assert(evidence.calibration.passed && !calibration.evidence.blockedRequests.length, 'Both calibrated visual detectors must pass'); persist();
    const host = await actor(browser, 'Fixture Host', 375); seats.push(host);
    await setViewport(host, 375, 844, true);
    await until(() => host.page.$('input[aria-label="Your name"]'), 'Touch-profile landing mounted');
    await input(host.page, 'Your name', host.name); await click(host.page, 'CREATE ROOM');
    await until(() => host.auth && host.room && host.page.url().endsWith('/saboteur/lobby'), 'Owned host created normally');
    for (const name of ['Fixture Second', 'Fixture Third']) {
      const seat = await actor(browser, name, 375); seats.push(seat);
      await seat.page.goto(BASE_URL + '/saboteur/join', { waitUntil: 'domcontentloaded' });
      await until(() => seat.page.$('input[aria-label="Room code"]'), 'Join form mounted');
      await input(seat.page, 'Your name', name); await input(seat.page, 'Room code', host.auth.roomCode); await click(seat.page, 'JOIN GAME');
      await until(() => seat.auth && seat.room && seat.page.url().endsWith('/saboteur/lobby'), 'Owned join completed');
    }
    await until(() => seats.every(s => s.room?.players.filter(p => p.isConnected).length === 3), 'Three connected seats');
    await click(host.page, 'START GAME'); await until(() => seats.every(paired), 'Natural initial deal');
    for (const seat of seats) {
      await until(async () => { const el = await findButton(seat.page, 'HIDE SECRET ROLE'); await el?.dispose(); return !!el; }, 'Initial secret-role surface');
      await dismissRole(seat);
    }
    evidence.setup = { normalCreateJoinStart: true, startCommands: host.sent.filter(([event]) => event === 'start_game').length, seats: seats.map(s => s.name) };
    assert(evidence.setup.startCommands === 1, 'Start was not dispatched once');
    const response = await fetch(API_URL + '/__qa/saboteur-fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomCode: host.auth.roomCode, scenario: 'stone' }), redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert(response.status === 200, 'Stone fixture failed'); const receipt = await response.json();
    assert(receipt.scenario === 'stone' && receipt.canonicalCards === 67 && receipt.goldNuggets === 44, 'Canonical conserving fixture receipt differs');
    await until(() => seats.every(s => paired(s) && s.public.revision === receipt.revision), 'Fresh stone checkpoint');
    evidence.checkpoint = receipt; proof.revision = receipt.revision; proof.cards = structuredClone(host.private.hand);
    assert(proof.cards.length === 3 && proof.cards[0].type === 'path' && proof.cards.slice(1).every(c => c.subtype === 'map'), 'Canonical mixed hand changed');
    assert(host.public.currentTurnPlayerId === host.auth.playerId && seats.slice(1).every(s => s.private.hand.length === 0), 'Canonical owner projection differs');
    const endpoints = [proof.cards[0], proof.cards[2]];
    const noCommand = { sent: host.sent.length, accepted: host.accepted.length };
    for (const profile of HAND_SIZING_PLAN.profiles) {
      await setViewport(host, profile.width, profile.height, profile.touch);
      evidence.profiles.push({ requested: profile, actual: host.page.viewport(), freshSocket: host.socketSequence, ownedPair: paired(host), revision: host.public.revision });
      const baseline = await inspect(host, 'unselected');
      for (const card of endpoints) {
        const id = selectorFor(card);
        if (profile.width !== 320) {
          await handSizingClick(host, id);
          await until(() => host.page.$eval(id, node => node.getAttribute('aria-label')?.startsWith('Selected ')), 'Selected card displayed');
          const selected = await inspect(host, 'selected-' + card.id);
          for (const box of selected) {
            const previous = baseline.find(b => b.id === box.id);
            assert(Math.abs(previous.layoutWidth - box.layoutWidth) <= 2 && Math.abs(previous.layoutHeight - box.layoutHeight) <= 2, 'Selection changed intrinsic painted dimensions');
          }
          const expectedCopy = (await host.page.$eval(id, node => node.getAttribute('aria-label'))).replace(/^Selected /, '');
          await host.page.$eval('[role="button"][aria-label="CANCEL SELECTION"]', (node, copy) => {
            const group = node.parentElement;
            if (!group.textContent.includes(copy)) throw Error('Full selected-card instruction missing');
            group.setAttribute('data-sab-qa-selection', 'true');
          }, expectedCopy);
          await frame(host, `${profile.width}-${card.type}-selected-face`, id);
          await frame(host, `${profile.width}-${card.type}-full-instruction`, '[data-sab-qa-selection="true"]');
          await handSizingClick(host, '[role="button"][aria-label="CANCEL SELECTION"]');
          await until(() => host.page.$eval(id, node => !node.getAttribute('aria-label')?.startsWith('Selected ')), 'Selection cancelled');
        } else await frame(host, `320-${card.type}-edge`, id);
        assert(host.sent.length === noCommand.sent && host.accepted.length === noCommand.accepted && host.public.revision === proof.revision, 'Selection/cancel/framing sent a game command');
      }
    }
    assert(evidence.frames.length === HAND_SIZING_PLAN.logicalFrames, 'Incomplete frame inventory');
    const map = proof.cards[2]; await handSizingClick(host, selectorFor(map));
    const before = { deck: host.public.deckSize, hand: host.private.hand.length };
    evidence.expectedMap = { cardId: map.id, targetPosition: { row: 8, col: 4 } };
    verifyCommand = await handSizingCommand(host, seats, () => handSizingClick(host, '#saboteur-cell-8-4'), evidence);
    assert(!host.private.hand.some(c => c.id === map.id) && host.private.hand.length === before.hand && host.public.deckSize === before.deck - 1, 'Map did not consume one card and draw one');
    assert(host.private.peekedGoals.length === 1 && !host.private.peekedGoals[0].isGold && seats.slice(1).every(s => s.private.peekedGoals.length === 0), 'Private Map result differs or leaked');
    assert(seats.every(s => !JSON.stringify(s.public).match(/"(?:hand|role|peekedGoals|token)"/)), 'Private fields leaked into public projection');
    for (const observer of seats.slice(1)) assert(await observer.page.$$eval('[aria-label^="Private map knowledge:"]', nodes => nodes.length) === 0, 'Private map strip leaked to another viewer');
    evidence.mapPostcondition = { exactCommandAck: true, oneCardConsumedAndDrawn: true, privateStonePeekOnly: true, publicProjectionClean: true };
    verifyCommand();
    await handSizingClick(seats[2], '[role="button"][aria-label="Leave game"]');
    await handSizingClick(seats[2], '[aria-modal="true"] [role="button"][aria-label="LEAVE"]');
    await until(async () => seats[2].leaveResponses.includes(200) && new URL(seats[2].page.url()).pathname === '/' && await seats[2].page.evaluate(() => sessionStorage.getItem('za:auth') === null), 'Normal departing seat cleanup');
    seats[2].released = true; evidence.cleanup.push({ name: seats[2].name, normalUI: true, status: 200, authCleared: true });
    await until(() => seats.slice(0, 2).every(s => paired(s) && s.public.status === 'game_over' && s.public.terminationReason === 'not_enough_players'), 'Paired deliberate below-three ending');
    for (const seat of seats.slice(0, 2)) {
      await handSizingClick(seat, '[role="button"][aria-label="BACK TO ARCADE"]');
      await until(async () => seat.leaveResponses.includes(200) && new URL(seat.page.url()).pathname === '/' && await seat.page.evaluate(() => sessionStorage.getItem('za:auth') === null), 'Normal terminal seat cleanup');
      seat.released = true; evidence.cleanup.push({ name: seat.name, normalUI: true, status: 200, authCleared: true });
    }
    verifyCommand();
    assert(!evidence.blockedRequests.length && !evidence.issues.length && seats.every(s => !s.rejected.length), 'Browser, network or command issue');
    evidence.sourceAfter = handSizingSources(); assert(JSON.stringify(evidence.sourceBefore) === JSON.stringify(evidence.sourceAfter), 'Source fence changed');
    await verifyBundle(); assert(JSON.stringify(evidence.bundleBefore) === JSON.stringify(evidence.bundle), 'Bundle fence changed');
    evidence.completed = true;
  }
  try {
    await Promise.race([work(), new Promise((_, reject) => { watchdog = setTimeout(() => { evidence.deadlineExceeded = true; void browser?.close().catch(() => {}); reject(Error('Hand-sizing eight-minute deadline exceeded')); }, HAND_SIZING_PLAN.deadlineMs); })]);
  } catch (error) { evidence.error = sanitise(error.message); }
  finally {
    clearTimeout(watchdog);
    await releaseOwnedSeats().catch(error => { evidence.cleanupError = sanitise(error.message); });
    const closeResults = await Promise.allSettled(seats.map(seat => seat.context.close()));
    evidence.contextsClosed = closeResults.every(result => result.status === 'fulfilled');
    try { if (browser) { await browser.close(); evidence.browserClosed = true; } } catch (error) { evidence.browserCloseError = sanitise(error.message); }
    try {
      evidence.sourceAfter = handSizingSources();
      evidence.sourceFenceMatched = JSON.stringify(evidence.sourceBefore) === JSON.stringify(evidence.sourceAfter);
      if (evidence.bundleBefore) { await verifyBundle(); evidence.bundleFenceMatched = JSON.stringify(evidence.bundleBefore) === JSON.stringify(evidence.bundle); }
    } catch (error) { evidence.fenceError = sanitise(error.message); }
    evidence.passed = !!evidence.completed && !evidence.error && evidence.sourceFenceMatched && evidence.bundleFenceMatched
      && handSizingCleanupPassed(evidence.cleanup, ['Fixture Host', 'Fixture Second', 'Fixture Third'], evidence.contextsClosed && evidence.browserClosed);
    persist();
  }
  assert(evidence.passed, 'Hand-sizing supplement failed; see redacted result.json');
  console.log(JSON.stringify({ passed: true, natural: false, captures, calibrations: 2, outputDir }));
}

async function main() {
  if (handSizingTarget(process.env)) return handSizingMain();
  assert(!fs.existsSync(path.join(outputDir, 'result.json')), 'Use a fresh evidence directory');
  fs.mkdirSync(outputDir, { recursive: true });
  let browser;
  const seats = [];
  try {
    await verifyBundle();
    browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + CERT] });
    const host = await actor(browser, FIXTURES ? 'Fixture Host' : 'Astra Auto Host'); seats.push(host);
    await click(host.page, 'CREATE ROOM'); assert(await host.page.evaluate(() => !!document.querySelector('[role="alert"]')), 'Empty-name validation missing');
    await input(host.page, 'Your name', host.name); await host.page.keyboard.press('Enter');
    assert(await host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Room password, optional'), 'Name Enter chain');
    const password = ' mine gate '; await input(host.page, 'Room password, optional', password); await capture(host, 'landing'); await host.page.keyboard.press('Enter');
    await until(() => host.room?.roomCode && host.page.url().endsWith('/saboteur/lobby'), 'host lobby'); evidence.roomCode = host.room.roomCode;
    for (const name of FIXTURES ? ['Fixture Second', 'Fixture Third'] : ['Astra Auto Miner', 'Astra Auto Third']) {
      const seat = await actor(browser, name); seats.push(seat); await seat.page.goto(BASE_URL + '/saboteur/join', { waitUntil: 'domcontentloaded' });
      await until(() => seat.page.$('input[aria-label="Room code"]'), 'join form'); await input(seat.page, 'Your name', name); await seat.page.keyboard.press('Enter');
      assert(await seat.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Room code'), 'Join name Enter chain');
      await input(seat.page, 'Room code', host.room.roomCode); await seat.page.keyboard.press('Enter'); await input(seat.page, 'Room password, optional', password); await seat.page.keyboard.press('Enter');
      await until(() => seat.room && seat.page.url().endsWith('/saboteur/lobby'), name + ' joined');
    }
    await until(() => seats.every(seat => seat.auth) && host.room.players.filter((p) => p.isConnected).length === 3, 'three owned connected lobby seats'); await capture(host, 'lobby', 320);
    if (!FIXTURES) {
      await presentationCapture(host, 'lobby-host-controls', 1280, { desktop: true, frameLabel: 'START GAME' });
      await presentationCapture(host, 'lobby-host-controls', 1280, { desktop: true, scale: 200, frameLabel: 'START GAME' });
      await presentationCapture(host, 'lobby-host-controls', 375, { scale: 200, frameLabel: 'START GAME' });
      await setViewport(host, 375, 844, true);
    }
    await until(() => host.page.evaluate(() => window.__zuychinArcadeBackGuardReady === new URL('/saboteur/lobby', location.origin).href), 'lobby back guard ready');
    evidence.backHistory = await host.page.evaluate(() => ({ length: history.length, pathname: location.pathname }));
    await host.page.evaluate(() => history.back()); await click(host.page, 'STAY');
    await click(host.page, 'LEAVE ROOM'); await click(host.page, 'STAY'); await click(host.page, 'START GAME', true);
    await until(() => seats.every(paired), 'first private deal'); assert(host.sent.filter(([action]) => action === 'start_game').length === 1, 'Duplicate start sent');
    await until(async () => { const control = await findButton(host.page, 'HIDE SECRET ROLE'); await control?.dispose(); return !!control; }, 'initial role'); await capture(host, 'private-role', 320);
    for (const seat of seats) await dismissRole(seat);
    if (FIXTURES) {
      await fixtureGate(seats);
      assert(evidence.blockedRequests.length === 0 && evidence.issues.length === 0, 'Fixture browser/network issue');
      evidence.passed = true; return;
    }
    const desktopSeat = seats[1];
    for (const width of [320, 375, 390, 414, 768, 1280]) {
      const boardSeat = width >= 768 ? desktopSeat : host;
      const metrics = await capture(boardSeat, 'board', width); assert(metrics.cells === 45, '5 by 9 cap changed');
      const cells = await boardSeat.page.$$eval('[aria-label^="Board row "]', (nodes) => nodes.map((node) => { const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }));
      assert(cells.every((cell) => cell.width >= 48 && cell.height >= 48), 'Board cells under 48 pixels'); evidence.viewports.push({ ...metrics, minimumCellWidth: Math.min(...cells.map((cell) => cell.width)) });
      await captureGoals(boardSeat, width); await click(boardSeat.page, 'START');
    }
    await presentationCapture(host, 'landscape-board', 844, { height: 390, frameSelector: '#saboteur-board' });
    await captureGoals(host, 844, 390); await click(host.page, 'START');
    await presentationCapture(desktopSeat, 'desktop-workspace', 1280, { desktop: true, frameSelector: '#saboteur-workspace' });
    await presentationCapture(desktopSeat, 'desktop-workspace', 1280, { desktop: true, scale: 200, frameSelector: '#saboteur-workspace' });
    await presentationCapture(desktopSeat, 'desktop-hand', 1280, { desktop: true, scale: 200, frameSelector: '#saboteur-hand-controls' });
    const actingSeat = seats.find(seat => seat.private.playerId === host.public.currentTurnPlayerId);
    assert(actingSeat, 'Opening actor missing'); await phoneHandReview(actingSeat);
    await setViewport(host, 375, 844, true); const playerId = host.private.playerId;
    const frames = { ...host.frames }, reloadRevision = host.public.revision, socketSequence = host.socketSequence;
    host.public = null; host.private = null;
    await host.page.reload({ waitUntil: 'domcontentloaded' });
    await until(() => host.frames.public > frames.public && host.frames.private > frames.private
      && host.frameSockets.public > socketSequence && host.frameSockets.private > socketSequence && paired(host)
      && host.public.revision >= reloadRevision && host.page.$('[aria-label="Reveal my secret role"]'), 'fresh owned reload recovery'); await delay(400);
    evidence.reload = { samePlayer: host.private.playerId === playerId, newSocket: host.socketSequence > socketSequence, freshPublicFrames: host.frames.public - frames.public, freshPrivateFrames: host.frames.private - frames.private, beforeRevision: reloadRevision, revision: host.public.revision };
    assert(host.private.playerId === playerId, 'Reload changed seat'); assert(!(await findButton(host.page, 'HIDE SECRET ROLE')), 'Reload reopened private role'); await capture(host, 'reconnect', 375);
    const finalState = await runMatch(seats);
    await until(() => seats.every(seat => paired(seat) && seat.public.status === 'game_over' && seat.public.revision === finalState.revision), 'all owned terminal pairs');
    const terminal = state => ({ round: state.round, revision: state.revision, terminationReason: state.terminationReason, winnerIds: state.winnerIds,
      scores: state.players.map(p => ({ playerId: p.playerId, name: p.displayName, gold: p.goldCollected, forfeited: p.forfeited })) });
    evidence.final = { ...terminal(finalState), winnerCount: finalState.winnerIds.length };
    assert(finalState.players.length === 3 && finalState.players.every(player => player.forfeited === false), 'Natural match had a forfeited seat');
    assert(seats.every(seat => JSON.stringify(terminal(seat.public)) === JSON.stringify(terminal(finalState))), 'Terminal projections disagree');
    evidence.terminalPairsAgree = true;
    await capture(host, 'final-results', 375);
    await presentationCapture(host, 'final-results-controls', 375, { scale: 200, frameLabel: 'BACK TO ARCADE' });
    await presentationCapture(desktopSeat, 'final-results', 1280, { desktop: true, frameLabel: 'BACK TO ARCADE' });
    await presentationCapture(desktopSeat, 'final-results', 1280, { desktop: true, scale: 200, frameLabel: 'BACK TO ARCADE' });
    const finalRevision = finalState.revision; await click(host.page, 'PLAY AGAIN', true);
    await until(() => seats.every((seat) => paired(seat) && seat.public.status === 'playing' && seat.public.revision > finalRevision && seat.public.round === 1), 'monotonic rematch'); evidence.rematchRevision = host.public.revision;
    for (const seat of seats) await dismissRole(seat);
    for (const seat of seats) await phaseNotification(seat);
    await click(seats[2].page, 'Leave game'); await capture(seats[2], 'forfeit-confirmation', 320); await normalExit(seats[2], 'LEAVE');
    await until(() => host.public.terminationReason === 'not_enough_players', 'below-three no-winner ending'); await capture(host, 'aborted-results', 390);
    for (const seat of seats.slice(0, 2)) await phaseNotification(seat);
    assert(host.public.winnerIds.length === 0, 'Abandoned match awarded winner'); assert(await seats[2].page.evaluate(() => sessionStorage.getItem('za:auth') === null), 'Leave retained credentials');
    for (const seat of seats.slice(0, 2)) await normalExit(seat, 'BACK TO ARCADE');
    evidence.accepted = seats.reduce((total, seat) => total + seat.accepted.length, 0); evidence.rejected = seats.flatMap((seat) => seat.rejected);
    assert(evidence.blockedRequests.length === 0, 'Non-local request attempted');
    assert(evidence.issues.length === 0, 'Browser console issues: ' + JSON.stringify(evidence.issues)); assert(evidence.rejected.length === 0, 'Rejected UI commands');
    evidence.lifecyclePassed = true;
    evidence.visualPassed = evidence.visualFindings.length === 0;
    assert(evidence.visualPassed, 'Lifecycle completed, but visual clipping findings remain'); evidence.passed = true;
  } catch (error) {
    evidence.passed = false; evidence.error = sanitise(error.message);
    evidence.failureSeats = seats.map((seat) => ({ name: seat.name, publicRevision: seat.public?.revision, privateRevision: seat.private?.revision, status: seat.public?.status, round: seat.public?.round, sent: seat.sent.length, accepted: seat.accepted.length, rejected: seat.rejected }));
    for (let index = 0; index < seats.length; index++) await seats[index].page.screenshot({ path: path.join(outputDir, 'failure-' + index + '.png') }).catch(() => {});
    throw new Error(evidence.error);
  } finally {
    try { await releaseOwnedSeats(); }
    catch (error) { evidence.passed = false; evidence.cleanupError = sanitise(error.message); }
    finally {
      try { if (browser) await browser.close(); }
      catch (error) { evidence.passed = false; evidence.browserCloseError = sanitise(error.message); }
      finally {
        if (!evidence.passed) process.exitCode = 1;
        fs.writeFileSync(path.join(outputDir, 'result.json'), sanitise(JSON.stringify(evidence, null, 2)));
      }
    }
  }
  assert(evidence.passed, 'Gate or owned cleanup failed, see result.json');
  console.log(JSON.stringify({ passed: evidence.passed, bundle: evidence.bundle, actions: evidence.decisions.length, rounds: evidence.rounds, outputDir }, null, 2));
}
module.exports = { actor, input, click, clickId, dismissRole, capture, legalCells, paired, until, handSizingTarget, assertHandFaces, measureHandFaces, persistHandSample, assertHandSampleStable, handSizingCommand, handSizingCleanupPassed, handSizingSources, HAND_SIZING_PLAN };
if (require.main === module) main().catch((error) => { console.error(sanitise(error.message)); process.exitCode = 1; });
