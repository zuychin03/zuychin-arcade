const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const puppeteer = require('puppeteer-core');
const outputBase = process.env.COLT_UI_OUTPUT;
if (require.main === module) assert(outputBase, 'Use a distinct COLT_UI_OUTPUT directory');
let output;
const h = require('./not-alone-ui-smoke.cjs');
const origin = process.env.COLT_WEB_URL || 'http://127.0.0.1:8081';
const apiOrigin = process.env.COLT_API_URL || 'http://127.0.0.1:3213';
const certificate = process.env.QA_BROWSER_CERT_SPKI || 'Z8YnVWQ04oHbbGNWI2KQMckrUKXbQ8d+781cTo5IKQY=';
const local = url => ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password;
const allowedOrigins = new Set([new URL(origin).origin, new URL(apiOrigin).origin, 'https://localhost:3214']);
const secrets = new Set(['  Rail  ']);
let currentReceipt, screenshotSequence = 0;
const ownedPlayers = new Set();
const sanitise = value => {
  let text = String(value);
  for (const secret of secrets) text = text.split(secret).join('[redacted]');
  return text.replace(/Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]');
};
const exact = label => new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openPlayer(browser, name, width = 375, touch = true) {
  const context = await browser.createBrowserContext();
  const player = { context, page: await context.newPage(), name, touch, publicFrames: 0, privateFrames: 0, acceptedActions: [], rejections: [], transactions: new Set(), socketSequence: 0, auth: null, left: false };
  ownedPlayers.add(player);
  const page = player.page;
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(30000);
  await page.setViewport({ width, height: 844, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, isLandscape: false });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if ((allowedOrigins.has(url.origin) && local(url)) || ['data:', 'blob:', 'about:'].includes(url.protocol)) void request.continue();
    else { currentReceipt.blockedRequests.push({ actor: name, protocol: url.protocol, hostname: url.hostname, type: request.resourceType() }); void request.abort(); }
  });
  await page.evaluateOnNewDocument(origins => {
    window.WebSocket = new Proxy(window.WebSocket, { construct(target, args) {
      const url = new URL(String(args[0]), location.href), socketOrigin = url.origin.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
      if (!origins.includes(socketOrigin) || url.username || url.password) throw new Error('QA blocked non-local WebSocket');
      return Reflect.construct(target, args);
    } });
  }, [...allowedOrigins]);
  page.on('response', response => {
    const url = new URL(response.url());
    if (!allowedOrigins.has(url.origin) || response.request().method() !== 'POST' || !/\/rooms\/(create|join)$/.test(url.pathname) || !response.ok()) return;
    const transaction = response.json().then(body => {
      assert(typeof body.token === 'string' && typeof body.playerId === 'string' && typeof body.roomCode === 'string', 'Malformed owned credentials');
      secrets.add(body.token); player.auth = { token: body.token, playerId: body.playerId, roomCode: body.roomCode };
    }).catch(() => currentReceipt.consoleIssues.push({ actor: name, type: 'auth-capture', text: 'Owned cleanup credentials unavailable' }));
    player.transactions.add(transaction); void transaction.finally(() => player.transactions.delete(transaction));
  });
  page.on('console', message => { if (['warning', 'error'].includes(message.type()) && !message.text().includes('[Reanimated] Reduced motion')) currentReceipt.consoleIssues.push({ actor: name, type: message.type(), text: sanitise(message.text()) }); });
  page.on('pageerror', error => currentReceipt.consoleIssues.push({ actor: name, type: 'pageerror', text: sanitise(error.message) }));
  player.cdp = await page.createCDPSession(); await player.cdp.send('Network.enable');
  player.cdp.on('Network.webSocketCreated', ({ requestId }) => { player.socketId = requestId; player.socketSequence++; player.latestPublic = null; player.latestPrivate = null; });
  player.cdp.on('Network.webSocketFrameReceived', ({ response, requestId }) => {
    if (requestId !== player.socketId || !response.payloadData.startsWith('42')) return;
    let packet; try { packet = JSON.parse(response.payloadData.slice(2)); } catch { return; }
    if (!Array.isArray(packet)) return;
    const [event, frame] = packet;
    if (event === 'room_updated') player.latestRoom = frame;
    if (event === 'game_state' && frame?.gameId === 'colt_express') { player.latestPublic = frame; player.publicFrames++; }
    if (event === 'private_state' && frame?.gameId === 'colt_express') { player.latestPrivate = frame; player.privateFrames++; }
    if (event === 'colt:action_accepted') { player.acceptedActions.push(frame); player.lastAcceptedAt = Date.now(); player.onCommandJournal?.(); }
    if (event === 'action_rejected') player.rejections.push(frame);
  });
  player.cdp.on('Network.webSocketFrameSent', ({ response, requestId }) => {
    if (currentReceipt?.target !== 'card-sizing' || requestId !== player.socketId || !response.payloadData.startsWith('42')) return;
    let packet; try { packet = JSON.parse(response.payloadData.slice(2)); } catch { return; }
    if (Array.isArray(packet) && typeof packet[0] === 'string' && (packet[0] === 'start_game' || packet[0].startsWith('colt:'))) {
      (player.sentCommands ||= []).push({ event: packet[0], payload: packet[1] ?? null });
      player.onCommandJournal?.();
    }
  });
  return player;
}
async function servedHash() {
  assert([...allowedOrigins].every(value => local(new URL(value))), 'Only credential-free loopback origins permitted');
  const expected = process.env.QA_EXPECTED_WEB_SHA256;
  assert(/^[a-f0-9]{64}$/i.test(expected || ''), 'QA_EXPECTED_WEB_SHA256 required');
  assert(process.env.QA_STATIC_ROOT, 'QA_STATIC_ROOT required');
  const response = await fetch(origin + '/colt-express', { redirect: 'error', signal: AbortSignal.timeout(10000) });
  assert(response.ok, 'Served HTML unavailable');
  const script = (await response.text()).match(/src=["']([^"']*\/_expo\/static\/js\/web\/(?:index|entry)-[a-f0-9]+\.js)/)?.[1];
  assert(script, 'Compiled entry unavailable');
  const url = new URL(script, origin); assert.equal(url.origin, new URL(origin).origin, 'Foreign entry');
  const bundle = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) }); assert(bundle.ok, 'Served bundle unavailable');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const served = hash(new Uint8Array(await bundle.arrayBuffer()));
  const root = path.resolve(process.env.QA_STATIC_ROOT), name = path.basename(url.pathname);
  assert(fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes(name), 'Disk/served entry mismatch');
  const disk = hash(fs.readFileSync(path.join(root, '_expo/static/js/web', name)));
  assert.equal(served, expected.toLowerCase(), 'Served/expected bundle mismatch'); assert.equal(disk, served, 'Disk/served bundle mismatch');
  return { entry: name, served, disk, expected };
}
async function paired(player, revision = 0) {
  await h.waitUntil(() => player.latestPublic && player.latestPrivate && player.latestPublic.roomCode === player.latestPrivate.roomCode
    && player.auth && player.latestPrivate.playerId === player.auth.playerId && player.latestPrivate.roomCode === player.auth.roomCode
    && Number.isSafeInteger(player.latestPublic.revision) && player.latestPublic.revision >= 0
    && player.latestPublic.revision === player.latestPrivate.revision && player.latestPublic.revision >= revision, 'Owned paired state', 10000);
}
function canonicalView(player) {
  return { publicRevision: player.latestPublic?.revision ?? null, privateRevision: player.latestPrivate?.revision ?? null,
    status: player.latestPublic?.status ?? null, phase: player.latestPublic?.phase ?? null,
    round: player.latestPublic?.round ?? null, socketSequence: player.socketSequence,
    ownPair: !!player.auth && player.latestPrivate?.playerId === player.auth.playerId && player.latestPrivate?.roomCode === player.auth.roomCode && player.latestPublic?.roomCode === player.auth.roomCode };
}
function persistTextDiagnostics() {
  fs.writeFileSync(path.join(output, 'text-scale-diagnostics.json'), sanitise(JSON.stringify(currentReceipt.textScaleDiagnostics || [], null, 2)));
}
async function settledCaptureState(player) {
  if (player.latestPublic) await paired(player);
  const wait = Math.max(0, (player.lastAcceptedAt || 0) + 2700 - Date.now()); if (wait) await delay(wait);
  await h.waitUntil(async () => {
    if (player.latestPublic) await paired(player);
    const state = canonicalView(player);
    const rendered = await player.page.evaluate(() => {
      const visible = node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !node.closest('[aria-hidden="true"]'); };
      return { decision: document.getElementById('colt-decision')?.textContent.trim() ?? null,
        results: !!document.getElementById('colt-results') && visible(document.getElementById('colt-results')),
        transients: [...document.querySelectorAll('body *')].filter(node => visible(node) && [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && /(?: accepted\.$|Restoring the connection|RETRY CONNECTION)/.test(child.textContent.trim()))).map(node => node.textContent.trim().slice(0, 160)) };
    });
    if (rendered.transients.length) return false;
    if (!player.latestPublic) return true;
    const mine = player.latestPrivate;
    const expected = state.status === 'game_over' ? 'THE ROBBERY IS OVER' : mine.canChooseCharacter ? 'CHOOSE YOUR CHARACTER' : state.phase === 'character_selection' ? 'YOUR CHARACTER IS CONFIRMED' : mine.canChooseTeam ? 'CHOOSE YOUR TWO-BANDIT TEAM' : mine.canAssignStart ? 'CHOOSE YOUR SECRET FORMATION' : mine.canReserve ? 'RESERVE YOUR ROUND CARD' : mine.canProgram ? 'YOUR TURN TO PROGRAM' : mine.canChoose ? 'YOUR EXECUTION CHOICE' : 'WATCH THE TRAIN';
    return state.publicRevision === player.latestPublic.revision && state.publicRevision === state.privateRevision && state.ownPair
      && (state.status === 'game_over' ? rendered.results : rendered.decision === expected || rendered.decision === 'CHOOSE OPTIONAL COVER');
  }, 'Settled owned phase without accepted-message transient', 7000);
  await player.page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }); await delay(100);
}
async function clickButton(page, matcher, sectionId, selector) {
  await h.waitUntil(() => h.hasButton(page, matcher), 'Enabled ' + matcher, 15000);
  const handles = await page.$$('[role="button"][aria-label]'); let target;
  try {
    for (const handle of handles) if (await handle.evaluate((node, rule) => {
      const r = node.getBoundingClientRect(), modal = [...document.querySelectorAll('[aria-modal="true"]')].filter(n => n.getBoundingClientRect().width > 0).at(-1);
      const headingSection = rule.sectionId ? document.getElementById(rule.sectionId)?.parentElement : null;
      const section = rule.sectionId === 'colt-program' ? headingSection?.parentElement : headingSection;
      return (!rule.sectionId || section?.contains(node)) && (!rule.selector || node.closest(rule.selector)) && new RegExp(rule.source, rule.flags).test(node.getAttribute('aria-label') || '') && r.width > 0 && r.height > 0 && node.getAttribute('aria-disabled') !== 'true' && !node.hasAttribute('disabled') && !node.closest('[aria-hidden="true"]') && (!modal || modal.contains(node));
    }, { source: matcher.source, flags: matcher.flags, sectionId, selector })) { target = handle; break; }
    assert(target, 'Missing enabled control ' + matcher);
    await target.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })); await delay(80);
    const metrics = await target.evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { width: r.width, height: r.height, touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, hit: !!hit && (hit === node || node.contains(hit)) }; });
    assert(metrics.width >= 47.9 && metrics.height >= 47.9 && metrics.hit, 'Control hit area unavailable');
    if (page.viewport().hasTouch) { assert(metrics.touchPoints === 1 && metrics.coarse, 'Touch emulation unavailable'); await target.tap(); }
    else await target.click();
    currentReceipt.interactions.push({ method: page.viewport().hasTouch ? 'touch' : 'mouse', control: matcher.source, ...metrics });
    await delay(90);
  } finally { await Promise.all(handles.map(handle => handle.dispose())); }
}
async function command(player, matcher, selector) {
  const before = player.acceptedActions.length, rejected = player.rejections.length;
  await clickButton(player.page, matcher, undefined, selector);
  await h.waitUntil(() => player.acceptedActions.length > before || player.rejections.length > rejected, `Receipt for ${matcher}`, 12000);
  assert.equal(player.rejections.length, rejected, JSON.stringify(player.rejections.slice(rejected)));
  await paired(player, player.acceptedActions.at(-1).revision);
  return { player: player.name, ...player.acceptedActions.at(-1) };
}
async function setViewport(player, width, height = 844) {
  const before = await player.page.evaluate(() => performance.timeOrigin);
  await player.page.setViewport({ ...player.page.viewport(), width, height, deviceScaleFactor: 1, isLandscape: width > height });
  assert.equal(await player.page.evaluate(() => performance.timeOrigin), before, 'Viewport change unexpectedly reloaded the seat');
  await player.page.evaluate(() => document.fonts.ready); await delay(200);
}
async function frame(player, headingId) {
  await player.page.evaluate(id => {
    const node = document.getElementById(id) || [...document.querySelectorAll('[role="heading"]')].find(n => n.textContent === id);
    node?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
  }, headingId);
}
async function screenshot(player, name) {
  assert(screenshotSequence < 200, 'Bounded screenshot budget exceeded');
  const expected = player.page.viewport(), filename = `${++screenshotSequence}-${name}-${expected.width}x${expected.height}-${player.touch ? 'touch' : 'desktop'}-text${player.textScale || 100}.png`;
  await player.page.screenshot({ path: path.join(output, filename), fullPage: false });
  const png = fs.readFileSync(path.join(output, filename));
  const imageDimensions = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  const metrics = await player.page.evaluate(() => {
    const rect = node => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const section = title => [...document.querySelectorAll('[role="heading"]')].find(n => n.textContent === title)?.parentElement;
    const controls = [...document.querySelectorAll('[role="button"]')].filter(n => !n.closest('[aria-hidden="true"]')).map(n => ({ label: n.getAttribute('aria-label'), ...rect(n) })).filter(r => r.width > 0 && r.height > 0);
    const scaledText = (window.__coltQAText || []).map(({ node, size, family, text }) => ({ text, before: size, family, afterFamily: getComputedStyle(node).fontFamily, after: parseFloat(getComputedStyle(node).fontSize), connected: node.isConnected }));
    return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches,
      documentWidth: document.documentElement.scrollWidth, small: controls.filter(r => r.width < 47.9 || r.height < 47.9), scaledText,
      layout: { train: rect(document.getElementById('colt-train')?.parentElement), hand: rect(section('YOUR PRIVATE HAND')), program: rect(section('SHARED PROGRAM')) } };
  });
  const actual = player.page.viewport();
  const textMeasurement = await textBounds(player, 'body');
  metrics.clipped = textMeasurement.violations;
  if (metrics.clipped.length) currentReceipt.visualFindings.push({ filename, type: 'clipped-text-after-capture', textScale: player.textScale || 100, clipped: metrics.clipped });
  const record = { filename, actor: player.name, expected, actual, imageDimensions, revision: player.latestPublic?.revision ?? null, textScale: player.textScale || 100, metrics, method: 'Viewport-only; PNG dimensions, geometry, mode and computed text measured after capture.' };
  currentReceipt.captures.push(record);
  for (const key of ['width', 'height', 'deviceScaleFactor', 'isMobile', 'hasTouch', 'isLandscape']) assert.equal(actual[key], expected[key], 'Capture changed ' + key);
  assert.equal(metrics.width, expected.width); assert.equal(metrics.height, expected.height); assert.equal(metrics.dpr, 1);
  assert.equal(imageDimensions.width, expected.width); assert.equal(imageDimensions.height, expected.height);
  assert.equal(metrics.touchPoints, player.touch ? 1 : 0); assert.equal(metrics.coarse, player.touch);
  assert(metrics.documentWidth <= expected.width + 1, 'Horizontal page overflow'); assert.deepEqual(metrics.small, [], 'Controls below48px');
  if (player.textScale === 200) assert(metrics.scaledText.length && metrics.scaledText.every(sample => sample.connected && sample.family === sample.afterFamily && Math.abs(sample.after - sample.before * 2) < 0.2), '200% text changed after screenshot');
  if (!player.touch && metrics.layout.hand && metrics.layout.program) {
    const { hand, program, train } = metrics.layout;
    const alongside = hand.right <= program.x + 1 && Math.abs(hand.y - program.y) < 3;
    const emptyHand = player.latestPrivate?.hand.length === 0;
    const fullProgram = !!train && program.width >= train.width - 2 && program.y >= hand.bottom - 1;
    currentReceipt.desktopLayouts.push({ filename, phase: player.latestPublic?.phase, emptyHand, textScale: player.textScale || 100, ...metrics.layout, alongside, fullProgram });
    if (!train || train.width < 900 || (emptyHand ? !fullProgram : player.textScale !== 200 && !alongside)) currentReceipt.visualFindings.push({ filename, type: 'desktop-layout', emptyHand, ...metrics.layout });
  }
  return record;
}
async function capture(player, name, widths, headingId = 'colt-decision') {
  const original = player.page.viewport();
  const sizes = player.touch ? (widths || [320, 375, 414, 768, 1280, { width: 844, height: 390 }]) : [1280];
  const measurements = [];
  try { for (const size of sizes) {
    const width = typeof size === 'number' ? size : size.width, height = typeof size === 'number' ? 844 : size.height;
    await setViewport(player, width, height); await frame(player, headingId);
    measurements.push(await screenshot(player, name));
  } } finally { await setViewport(player, original.width, original.height); }
  return measurements;
}
async function textBounds(player, id) {
  return player.page.evaluate(id => {
    const heading = document.getElementById(id) || [...document.querySelectorAll('[role="heading"]')].find(e => e.textContent === id);
    const root = id === 'body' ? document.body : heading?.parentElement;
    if (!root) throw Error('Missing section ' + id);
    const violations = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let measured = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode; if (!node.textContent.trim()) continue;
      if (node.parentElement.closest('[aria-hidden="true"]') || /icon|material|fontawesome/i.test(getComputedStyle(node.parentElement).fontFamily)) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        measured++;
        let scrollX = false, scrollY = false;
        for (let ancestor = node.parentElement; ancestor && ancestor !== root.parentElement; ancestor = ancestor.parentElement) {
          const css = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
          scrollX ||= ['scroll', 'auto'].includes(css.overflowX) && ancestor.scrollWidth > ancestor.clientWidth;
          scrollY ||= ['scroll', 'auto'].includes(css.overflowY) && ancestor.scrollHeight > ancestor.clientHeight;
          if (!scrollX && ['hidden', 'clip'].includes(css.overflowX) && (rect.left < box.left - 2 || rect.right > box.right + 2)) violations.push({ text: node.textContent, axis: 'x' });
          if (!scrollY && ['hidden', 'clip'].includes(css.overflowY) && (rect.top < box.top - 2 || rect.bottom > box.bottom + 2)) violations.push({ text: node.textContent, axis: 'y' });
        }
      }
    }
    return { measured, violations };
  }, id);
}
async function enlarged(player, name) {
  const original = player.page.viewport(), captures = [];
  const diagnostic = { actor: player.name, name, beforeReady: canonicalView(player), baseline: null, computedAttempts: [], captures };
  (currentReceipt.textScaleDiagnostics ||= []).push(diagnostic); persistTextDiagnostics();
  await setViewport(player, player.touch ? 375 : 1280);
  try {
    if (new URL(player.page.url()).pathname.endsWith('/lobby')) {
      await h.waitUntil(async () => {
        if (!player.auth || player.latestRoom?.roomCode !== player.auth.roomCode || !player.latestRoom.players.some(seat => seat.playerId === player.auth.playerId && seat.isConnected)) return false;
        return player.page.evaluate(({ name, roomCode }) => {
          const text = document.body.innerText;
          return text.includes(name) && text.replace(/[^a-z0-9]/gi, '').includes(roomCode.replace(/[^a-z0-9]/gi, '')) && !/reconnecting|refreshing|retry\s+connection/i.test(text);
        }, { name: player.name, roomCode: player.auth.roomCode });
      }, 'Rendered owned lobby without connection transients', 15000);
    }
    await settledCaptureState(player); diagnostic.beforeBaseline = canonicalView(player);
    const baseline = await player.page.evaluate(() => {
      const style = document.createElement('style'); style.id = 'colt-qa-text-style';
      style.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}'; document.head.appendChild(style);
      const values = [];
      for (const node of document.querySelectorAll('body *')) {
        if (!node.matches('input,textarea') && ![...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) continue;
        const css = getComputedStyle(node), r = node.getBoundingClientRect();
        if (node.closest('[aria-hidden="true"]') || r.width <= 0 || r.height <= 0 || css.visibility !== 'visible' || /icon|material|fontawesome/i.test(css.fontFamily)) continue;
        values.push({ node, size: parseFloat(css.fontSize), line: parseFloat(css.lineHeight), family: css.fontFamily, originalId: node.getAttribute('data-colt-text-size'), text: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 100) });
      }
      window.__coltQAText = values;
      style.textContent += values.map(({ node, size, line }, index) => { node.setAttribute('data-colt-text-size', String(index)); return `[data-colt-text-size="${index}"]{font-size:${size * 2}px!important;${Number.isFinite(line) ? `line-height:${line * 2}px!important` : ''}}`; }).join('\n');
      return values.map(({ size, family, text }) => ({ size, family, text }));
    });
    diagnostic.baseline = baseline; persistTextDiagnostics();
    player.textScale = 200; assert(baseline.length, 'No text enlarged');
    await player.page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    await delay(100);
    await h.waitUntil(async () => {
      const nodes = await player.page.evaluate(() => (window.__coltQAText || []).map(({ node, size, family, text }) => ({ text, before: size, family, afterFamily: getComputedStyle(node).fontFamily, after: node.isConnected ? parseFloat(getComputedStyle(node).fontSize) : null, connected: node.isConnected })));
      diagnostic.computedAttempts.push({ at: new Date().toISOString(), view: canonicalView(player), nodes });
      if (diagnostic.computedAttempts.length === 1) persistTextDiagnostics();
      return nodes.length === baseline.length && nodes.every(sample => sample.connected && sample.family === sample.afterFamily && Math.abs(sample.after - sample.before * 2) < 0.2);
    }, 'Persistent200% text', 5000);
    persistTextDiagnostics();
    const results = await player.page.evaluate(() => document.getElementById('colt-results')?.getBoundingClientRect().width > 0);
    const targets = results ? [] : await player.page.evaluate(() => document.getElementById('colt-decision') ? ['colt-decision', 'colt-train', ...(document.getElementById('colt-reserve') ? ['colt-reserve'] : []), 'colt-hand', 'colt-program'] : []);
    if (results) {
      for (const position of ['top', 'controls']) {
        const scroll = await frameResults(player, position);
        const record = await screenshot(player, name + '-results-' + position);
        const after = await resultsMetrics(player);
        assert(Math.abs(after.scrollTop - scroll.scrollTop) < 1, 'Results screenshot changed ScrollView offset');
        if (position === 'top') assert(after.headingVisible, 'Result heading not visible after screenshot');
        else assert(after.controls.length && after.controls.every(control => control.visible), 'Result controls not reachable after screenshot');
        captures.push({ filename: record.filename, position, before: scroll, after });
      }
    }
    if (!targets.length && !results) captures.push(await screenshot(player, name));
    for (const id of targets) {
      await frame(player, id); const record = await screenshot(player, name + '-' + id.replace(/\W+/g, '-')); const bounds = await textBounds(player, id);
      if (bounds.violations.length) currentReceipt.visualFindings.push({ filename: record.filename, type: 'clipped200%text', ...bounds });
      captures.push({ filename: record.filename, section: id, ...bounds });
    }
    diagnostic.passed = true; persistTextDiagnostics();
    return { baseline, captures, scope: 'Persistent CSS text enlargement, not OS font scaling or browser zoom.' };
  } catch (error) {
    diagnostic.error = sanitise(error.message); diagnostic.failureView = canonicalView(player);
    diagnostic.failedNodes = await player.page.evaluate(() => (window.__coltQAText || []).map(({ node, size, family, text }) => ({ text, before: size, family, afterFamily: getComputedStyle(node).fontFamily, after: node.isConnected ? parseFloat(getComputedStyle(node).fontSize) : null, connected: node.isConnected }))).catch(() => []);
    if (screenshotSequence < 200) {
      diagnostic.failureImage = `${++screenshotSequence}-text-failure-${name.replace(/[^a-z0-9]+/gi, '-')}-${player.touch ? 'touch' : 'desktop'}.png`;
      await player.page.screenshot({ path: path.join(output, diagnostic.failureImage), fullPage: false }).catch(() => { diagnostic.failureImageUnavailable = true; });
    }
    persistTextDiagnostics(); throw error;
  } finally {
    await player.page.evaluate(() => { for (const { node, originalId } of window.__coltQAText || []) { if (originalId === null) node.removeAttribute('data-colt-text-size'); else node.setAttribute('data-colt-text-size', originalId); } delete window.__coltQAText; document.getElementById('colt-qa-text-style')?.remove(); });
    player.textScale = 100; await setViewport(player, original.width, original.height);
  }
}
async function resultsMetrics(player, position) {
  return player.page.evaluate(position => {
    const root = document.getElementById('colt-results'); if (!root) throw Error('Missing result dialog');
    const scroller = [...root.querySelectorAll('*')].find(node => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
    if (!scroller) throw Error('Missing result ScrollView');
    if (position) scroller.scrollTop = position === 'top' ? 0 : scroller.scrollHeight;
    const viewport = scroller.getBoundingClientRect(), rootRect = root.getBoundingClientRect();
    const visible = node => { const r = node.getBoundingClientRect(); return r.top >= Math.max(0, viewport.top) - 1 && r.bottom <= Math.min(innerHeight, viewport.bottom) + 1 && r.left >= Math.max(0, viewport.left) - 1 && r.right <= Math.min(innerWidth, viewport.right) + 1; };
    return { scrollTop: scroller.scrollTop, clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight,
      dialog: { x: rootRect.x, y: rootRect.y, width: rootRect.width, height: rootRect.height },
      viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
      headingVisible: !!root.querySelector('[role="heading"]') && visible(root.querySelector('[role="heading"]')),
      controls: [...root.querySelectorAll('[role="button"]')].filter(node => node.getBoundingClientRect().width > 0).map(node => ({ label: node.getAttribute('aria-label'), visible: visible(node) })) };
  }, position);
}
async function frameResults(player, position) {
  await resultsMetrics(player, position); await delay(120); return resultsMetrics(player);
}
async function leave(player, label) {
  const response = player.page.waitForResponse(r => r.request().method() === 'POST' && /\/rooms\/[^/]+\/leave$/.test(r.url())); response.catch(() => undefined);
  await clickButton(player.page, exact(label));
  await h.waitUntil(() => player.page.$('#arcade-dialog'), 'Owned Leave dialog'); await delay(650);
  await clickButton(player.page, /^LEAVE$/);
  assert.equal((await response).status(), 200); await h.waitForPath(player.page, '/');
  assert.equal(await player.page.evaluate(() => sessionStorage.getItem('za:auth')), null, 'Exit clears owned session'); player.left = true;
  return 200;
}
async function shortcutGate(player, receipt) {
  const mine = player.latestPrivate, sectionId = mine.canReserve ? 'colt-reserve' : mine.canProgram ? 'colt-hand' : mine.canChoose ? 'colt-program' : null;
  if (!sectionId) return;
  const mode = player.touch ? 'touch' : 'desktop', key = mode + ':' + sectionId;
  receipt.shortcuts ||= {}; if (receipt.shortcuts[key]) return;
  const label = sectionId === 'colt-reserve' ? 'CHOOSE RESERVE CARD' : sectionId === 'colt-hand' ? 'CHOOSE FROM YOUR HAND' : 'VIEW SHARED PROGRAM';
  const revision = player.latestPublic.revision;
  await clickButton(player.page, exact(label));
  await h.waitUntil(() => player.page.evaluate(id => document.activeElement?.id === id, sectionId), 'Shortcut focuses ' + sectionId);
  const destination = await screenshot(player, 'shortcut-' + sectionId);
  await clickButton(player.page, /^RETURN TO DECISION$/, sectionId);
  await h.waitUntil(() => player.page.evaluate(() => document.activeElement?.id === 'colt-decision'), 'Return shortcut focuses decision');
  const bounds = await player.page.$eval('#colt-decision', node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, viewport: innerHeight }; });
  assert(bounds.top >= 0 && bounds.bottom <= bounds.viewport, 'Returned decision not framed');
  assert.equal(player.latestPublic.revision, revision, 'Navigation changed authoritative game');
  receipt.shortcuts[key] = { destination: destination.filename, revision, returnedDecision: bounds };
}
async function actionFace(player, label, receipt) {
  const mode = player.touch ? 'touch' : 'desktop'; receipt.actionFaces ||= {};
  if (receipt.actionFaces[mode] || !/^(Program |Reserve |Configure optional Cover for )/.test(label)) return;
  const handle = (await player.page.$$('[role="button"][aria-label]'));
  try {
    for (const node of handle) if (await node.evaluate((element, expected) => element.getAttribute('aria-label') === expected, label)) {
      await node.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })); await delay(120);
      const capture = await screenshot(player, 'full-next-action-face');
      const bounds = await node.evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, fullFaceVisible: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, text: element.textContent }; });
      receipt.actionFaces[mode] = { file: capture.filename, label, bounds, scope: 'Candidate chosen by the driver for its next command, not an invented deferred selection state.' };
      if (!bounds.fullFaceVisible) receipt.visualFindings.push({ filename: capture.filename, type: 'action-face-not-fully-framed', bounds });
      return;
    }
    throw Error('Chosen action face absent');
  } finally { await Promise.all(handle.map(node => node.dispose())); }
}
async function naturalPublicCaptures(players, receipt) {
  receipt.populatedTrain ||= {}; receipt.concealedProgram ||= {};
  for (const player of players) {
    await paired(player, receipt.actions.at(-1)?.revision ?? 0); const game = player.latestPublic, mode = player.touch ? 'touch' : 'desktop';
    if (game.status === 'game_over') continue;
    if (!receipt.populatedTrain[mode] && game.players.some(p => game.turnOrder.includes(p.playerId) && p.positions.length)) {
      await frame(player, 'colt-train');
      receipt.populatedTrain[mode] = { revision: game.revision, publicPieces: game.players.filter(p => game.turnOrder.includes(p.playerId)).map(p => ({ playerId: p.playerId, positions: p.positions })), captures: await capture(player, 'populated-train', player.touch ? [375, { width: 844, height: 390 }] : [1280], 'colt-train') };
    }
    const index = game.program.findIndex(card => !card.faceUp);
    if (index < 0 || receipt.concealedProgram[mode]) continue;
    const card = game.program[index]; assert.equal(card.action, null, 'Hidden public action leaked'); assert.equal(card.ownerBandit, null, 'Hidden public bandit leaked');
    const id = 'colt-program-card-' + index;
    await h.waitUntil(() => player.page.$('#' + id), 'Natural concealed programme item');
    await player.page.$eval('#' + id, node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })); await delay(120);
    const concealedCapture = await screenshot(player, 'natural-concealed-programme');
    const rendered = await player.page.$eval('#' + id, node => { const r = node.getBoundingClientRect(); return { text: node.textContent, labels: [...node.querySelectorAll('[aria-label]')].map(n => n.getAttribute('aria-label')), images: [...node.querySelectorAll('img')].map(n => n.getAttribute('src')), bounds: { x: r.x, y: r.y, width: r.width, height: r.height }, fullyVisible: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; });
    assert(rendered.text.includes('FACE DOWN'), 'Natural hidden programme back absent');
    assert(!/\b(MOVE|FLOOR|SHOOT|PUNCH|ROB|MARSHAL|GHOST|DOC|TUCO|DJANGO|CHEYENNE|BELLE)\b/.test([rendered.text, ...rendered.labels].join(' ')), 'Concealed programme exposes action or bandit text');
    assert(!rendered.images.some(src => /(?:action|bandit)-(?:move|floor|shoot|punch|rob|marshal|ghost|doc|tuco|django|cheyenne|belle)/i.test(src)), 'Concealed programme has identity-specific artwork');
    receipt.concealedProgram[mode] = { revision: game.revision, index, publicAction: card.action, publicOwner: card.ownerBandit, filename: concealedCapture.filename, rendered, source: 'Naturally programmed face-down card, no fixture or state mutation.' };
    if (!rendered.fullyVisible) receipt.visualFindings.push({ filename: concealedCapture.filename, type: 'concealed-back-not-fully-framed', bounds: rendered.bounds });
  }
}
async function act(player, receipt) {
  await paired(player); const mine = player.latestPrivate, game = player.latestPublic;
  await shortcutGate(player, receipt);
  const labels = await h.enabledLabels(player.page);
  const mode = player.touch ? 'touch' : 'desktop';
  let label;
  if (mine.canChooseCharacter) {
    label = labels.find(l => l.startsWith('Choose '));
    if (!receipt.characterCapture[mode]) { receipt.characterCapture[mode] = await capture(player, '06-character-choice'); receipt.stages.push({ characterText: await enlarged(player, '06-character-choice') }); }
  }
  else if (mine.canChooseTeam) label = labels.find(l => l.startsWith('CHOOSE '));
  else if (mine.canAssignStart) label = labels.find(l => l.endsWith(' IN CABOOSE'));
  else if (mine.canReserve) label = labels.find(l => /^Reserve (?!bullet)/.test(l)) || labels.find(l => l.startsWith('Reserve '));
  else if (mine.canChoose) {
    const option = game.pending.options[(receipt.actions.length + game.round) % game.pending.options.length]; label = option.label;
    receipt.requiredChoiceLabels ||= [];
    for (const option of game.pending.options) if (!receipt.requiredChoiceLabels.includes(option.label)) receipt.requiredChoiceLabels.push(option.label);
    if (!receipt.choiceCapture[mode]) { receipt.choiceCapture[mode] = await capture(player, '07-required-choice', [320, 1280]); receipt.stages.push({ choiceText: await enlarged(player, '07-required-choice') }); }
  } else if (mine.canProgram) {
    if (!receipt.programCapture[mode]) { receipt.programCapture[mode] = await capture(player, '06-program'); receipt.stages.push({ programText: await enlarged(player, '06-program') });
      receipt.stages.push({ hand: await capture(player, '06-private-hand', [375, 1280], 'YOUR PRIVATE HAND'), program: await capture(player, '06-shared-program', [375, 1280], 'SHARED PROGRAM') }); }
    if (mine.canHideFirstAction && !receipt.ghostToggle) {
      await clickButton(player.page, /^Ghost first action: face up$/); receipt.ghostToggle = true;
    }
    const cover = labels.find(l => l.startsWith('Configure optional Cover for'));
    if (cover) {
      await actionFace(player, cover, receipt);
      await clickButton(player.page, exact(cover));
      if (!receipt.coverCancel) {
        const revision = game.revision; await clickButton(player.page, /^CANCEL COVER$/);
        await h.waitUntil(() => player.page.evaluate(label => document.activeElement?.getAttribute('aria-label') === label, cover), 'Cover Cancel restores opener');
        assert.equal(player.latestPublic.revision, revision); receipt.coverCancel = true;
        await clickButton(player.page, exact(cover)); receipt.coverCapture = await capture(player, '06-cover', [320, 1280]);
      }
      const configured = await h.enabledLabels(player.page); label = configured.find(l => l.startsWith('PROGRAM SHOOT + ')) || 'PROGRAM SHOOT ONLY';
    } else {
      const playable = labels.filter(l => l.startsWith('Program '));
      label = playable.length ? playable[(game.round + game.slot + receipt.actions.length) % playable.length] : 'DRAW 3 INSTEAD';
    }
  } else return false;
  assert(label, 'Authoritative action has a rendered control');
  await actionFace(player, label, receipt);
  receipt.phases.add(game.phase); if (game.turnType) receipt.turnTypes.add(game.turnType);
  receipt.actions.push(await command(player, exact(label))); return true;
}
async function runMatch(count) {
  const receipt = { method: 'Automated natural five-round match with isolated synthetic seats. Own projections drive legal rendered controls. Fixed touch and desktop modes; not manual play, physical-device testing or competitive strategy.', count, stages: [], actions: [], phases: new Set(), turnTypes: new Set(), cleanup: [], captures: [], desktopLayouts: [], interactions: [], blockedRequests: [], consoleIssues: [], visualFindings: [], characterCapture: {}, choiceCapture: {}, programCapture: {} };
  currentReceipt = receipt; ownedPlayers.clear(); screenshotSequence = 0;
  const players = []; let browser;
  try {
    receipt.bundle = await servedHash();
    browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + certificate] });
    const names = ['Conductor Alexandria', 'Bandit Bartholomew X', 'Traveller Cassandra'].slice(0, count);
    assert(names.every(name => [...name].length <= 20), 'Names respect the20-character limit');
    for (const [index, name] of names.entries()) players.push(await openPlayer(browser, name, index === 1 ? 1280 : 375, index !== 1));
    const host = players[0]; await host.page.goto(origin + '/colt-express'); await h.waitForText(host.page, 'BOARD THE TRAIN');
    receipt.stages.push({ landing: await capture(host, '01-landing'), landingText: await enlarged(host, '01-landing') });
    const desktop = players[1]; await desktop.page.goto(origin + '/colt-express'); await h.waitForText(desktop.page, 'BOARD THE TRAIN');
    receipt.stages.push({ desktopLanding: await capture(desktop, '01-landing'), desktopLandingText: await enlarged(desktop, '01-landing') });
    await h.setInput(host.page, 'Your name', host.name); await h.setInput(host.page, 'Room password, optional', '  Rail  ');
    const created = host.page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/rooms/create')); created.catch(() => undefined);
    await clickButton(host.page, /^CREATE ROOM$/); assert.equal(JSON.parse((await created).request().postData()).password, '  Rail  ');
    await h.waitForPath(host.page, '/colt-express/lobby'); const code = await h.roomCodeFromLobby(host.page); receipt.roomCode = code;
    for (const player of players.slice(1)) {
      await player.page.goto(origin + '/colt-express/join'); await h.waitForText(player.page, 'JOIN GAME'); receipt.stages.push({ join: await capture(player, '02-join'), joinText: await enlarged(player, '02-join') });
      await h.setInput(player.page, 'Your name', player.name); await h.setInput(player.page, 'Room code', code); await h.setInput(player.page, 'Room password, optional', '  Rail  ');
      await clickButton(player.page, /^JOIN GAME$/); await h.waitForPath(player.page, '/colt-express/lobby');
    }
    await h.waitUntil(() => players.every(p => p.auth) && host.latestRoom?.players.filter(p => p.isConnected).length === count, 'Owned connected lobby seats', 15000);
    receipt.stages.push({ lobby: await capture(host, '03-lobby'), lobbyText: await enlarged(host, '03-lobby'), desktopLobby: await capture(desktop, '03-lobby'), desktopLobbyText: await enlarged(desktop, '03-lobby') });
    receipt.actions.push(await command(host, /^START GAME$/)); await h.waitForPath(host.page, '/colt-express/game');
    await Promise.all(players.map(p => paired(p))); assert.equal(host.latestPublic.twoBanditMode, count === 2);
    receipt.initialFloorLoot = host.latestPublic.lootBySpace;
    receipt.stages.push({ game: await capture(host, '04-game'), desktopGame: await capture(desktop, '04-game') });
    await clickButton(host.page, /^Open rulebook$/); await h.waitUntil(() => host.page.$('#rules-reference-sheet'), 'Rules'); await delay(400);
    await host.page.keyboard.press('Tab'); await host.page.keyboard.press('PageDown'); await host.page.keyboard.press('End'); await host.page.keyboard.press('Escape');
    await h.waitUntil(() => host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Open rulebook'), 'Rules restores opener');
    const beforePublic = host.publicFrames, beforePrivate = host.privateFrames, revision = host.latestPublic.revision;
    await host.page.reload(); await h.waitUntil(() => host.publicFrames > beforePublic && host.privateFrames > beforePrivate, 'Fresh reload frames'); await paired(host, revision); assert.equal(host.latestPublic.revision, revision);
    receipt.reload = { revision, freshPair: true };
    await clickButton(host.page, /^INSPECT TRAIN$/); receipt.stages.push({ train: await capture(host, '05-train', [320, 375, 414, 768, 1280, { width: 844, height: 390 }], 'colt-train'), desktopTrain: await capture(desktop, '05-train', [1280], 'colt-train') });
    await setViewport(host, 320);
    await clickButton(host.page, /^NEXT CAR$/); receipt.trainScroll = await host.page.evaluate(() => [...document.querySelectorAll('div')].some(e => e.scrollLeft > 0)); assert(receipt.trainScroll);
    await clickButton(host.page, /^PREVIOUS CAR$/); await clickButton(host.page, /^RETURN TO DECISION$/);
    receipt.textScale = await enlarged(host, '05-game'); receipt.desktopTextScale = await enlarged(desktop, '05-game');
    const deadline = Date.now() + 15 * 60 * 1000;
    while (host.latestPublic.status !== 'game_over') {
      assert(Date.now() < deadline, 'Natural match deadline'); assert(receipt.actions.length < 1200);
      let acted = false;
      for (const player of players) if (await act(player, receipt)) { acted = true; break; }
      if (acted) await naturalPublicCaptures(players, receipt);
      if (!acted) await delay(100);
    }
    await Promise.all(players.map(p => paired(p, host.latestPublic.revision)));
    receipt.terminal = host.latestPublic;
    assert.equal(receipt.terminal.round, 5); assert.equal(receipt.terminal.endReason, 'score'); assert(receipt.terminal.players.every(p => !p.forfeited));
    await h.waitUntil(() => host.page.evaluate(() => document.getElementById('colt-results')?.contains(document.activeElement)), 'Results focus', 3000);
    receipt.stages.push({ results: await capture(host, '08-natural-results', [320, 375, 414, { width: 844, height: 390 }], 'colt-results'), desktopResults: await capture(desktop, '08-natural-results', [1280], 'colt-results'), resultText: await enlarged(host, '08-natural-results'), desktopResultText: await enlarged(desktop, '08-natural-results') });
    receipt.actions.push(await command(host, /^PLAY AGAIN$/)); assert(host.latestPublic.revision > receipt.terminal.revision); assert.equal(host.latestPublic.round, 1);
    receipt.rematchRevision = host.latestPublic.revision;
    receipt.stages.push({ rematch: await capture(host, '09-rematch', [375]), desktopRematch: await capture(desktop, '09-rematch') });
    for (const player of players.slice(1)) receipt.cleanup.push(await leave(player, 'Back to arcade'));
    await h.waitUntil(() => host.latestPublic.status === 'game_over', 'Forfeit result'); assert.equal(host.latestPublic.endReason, 'forfeit');
    receipt.forfeitTerminal = host.latestPublic;
    receipt.cleanup.push(await leave(host, 'BACK TO ARCADE')); receipt.status = 'passed';
    receipt.uncovered = [count === 3 ? 'Two-bandit Cover is not applicable to three-player mode.' : null, !receipt.coverCancel && count === 2 ? 'Cover cancellation was not reached naturally.' : null, !receipt.ghostToggle ? 'Optional Ghost toggle was not reached naturally.' : null, !receipt.choiceCapture.touch ? 'No execution choice captured in touch mode.' : null, !receipt.choiceCapture.desktop ? 'No execution choice captured in desktop mode.' : null, !receipt.concealedProgram?.touch ? 'No naturally concealed programme back captured in touch mode.' : null, !receipt.concealedProgram?.desktop ? 'No naturally concealed programme back captured in desktop mode.' : null, 'No physical-device or independent manual validation.', 'Only rematch start and deliberate departure, not a second complete match.'].filter(Boolean);
    receipt.finalBundle = await servedHash(); assert.equal(receipt.finalBundle.served, receipt.bundle.served, 'Bundle changed during journey');
  } catch (error) {
    receipt.status = 'failed'; receipt.error = sanitise(error.stack); process.exitCode = 1; receipt.failureImages = [];
    for (const player of ownedPlayers) {
      if (screenshotSequence >= 200 || player.page.isClosed()) continue;
      const filename = `${++screenshotSequence}-failure-${player.name.replace(/[^a-z0-9]+/gi, '-')}.png`;
      const record = { filename, view: canonicalView(player) }; receipt.failureImages.push(record);
      await player.page.screenshot({ path: path.join(output, filename), fullPage: false }).catch(() => { record.unavailable = true; });
    }
  }
  finally {
    try {
      for (const player of ownedPlayers) {
        await Promise.allSettled([...player.transactions]);
        if (player.left) continue;
        if (!player.auth && !player.page.isClosed()) {
          const auth = await player.page.evaluate(() => { try { return JSON.parse(sessionStorage.getItem('za:auth') || 'null'); } catch { return null; } }).catch(() => null);
          if (auth?.token && auth.playerId && auth.roomCode) { secrets.add(auth.token); player.auth = auth; }
        }
        if (!player.auth) { receipt.cleanup.push({ actor: player.name, noOwnedSession: !player.latestRoom }); if (player.latestRoom) receipt.cleanupFailure = true; continue; }
        let status = null;
        try { status = (await fetch(new URL('/rooms/' + encodeURIComponent(player.auth.roomCode) + '/leave', apiOrigin), { method: 'POST', headers: { Authorization: 'Bearer ' + player.auth.token }, redirect: 'error', signal: AbortSignal.timeout(5000) })).status; } catch { /* Credentials stay in memory. */ }
        receipt.cleanup.push({ actor: player.name, fallback: true, status }); player.left = status === 200; if (!player.left) receipt.cleanupFailure = true;
      }
    } catch (error) { receipt.cleanupFailure = true; receipt.cleanupError = sanitise(error.message); }
    finally { if (browser) { try { await browser.close(); receipt.allClientsClosed = true; } catch { receipt.allClientsClosed = false; receipt.cleanupFailure = true; } } }
    receipt.phases = [...receipt.phases]; receipt.turnTypes = [...receipt.turnTypes]; receipt.rejections = players.flatMap(p => p.rejections);
    if (receipt.status === 'passed' && (receipt.rejections.length || receipt.consoleIssues.length || receipt.blockedRequests.length || receipt.visualFindings.length || receipt.cleanupFailure)) { receipt.status = 'failed'; receipt.error = 'Console, rejection, network, visual or owned-cleanup gate failed'; process.exitCode = 1; }
    fs.writeFileSync(path.join(output, 'receipt.json'), sanitise(JSON.stringify(receipt, null, 2)));
    console.log(JSON.stringify({ count, status: receipt.status, actions: receipt.actions.length, output, error: sanitise(receipt.error || '') }));
  }
  return receipt.status;
}
const CARD_SIZING_LIMITS = Object.freeze({ commands: 32, milliseconds: 8 * 60 * 1000, images: 80, calibrations: 2 });
const CARD_SIZING_SOURCES = Object.freeze([
  ...['_layout', 'index', 'join', 'lobby', 'game'].map(name => `apps/mobile/app/colt-express/${name}.tsx`),
  ...['ActionCard', 'ActionArtwork', 'CharacterChoice', 'TrainBoard', 'ReferenceSheet'].map(name => `apps/mobile/components/colt/${name}.tsx`),
  ...['decision', 'useColtActions', 'useColtDecisionAttention'].map(name => `apps/mobile/components/colt/${name}.ts`),
  ...['CardGrid', 'CardSurface', 'ScalePressable', 'NeonButton', 'GameCover'].map(name => `apps/mobile/components/ui/${name}.tsx`),
  ...['useIntrinsicCardHeight', 'useMeasuredLayoutWidth', 'useSocket', 'useWebModalFocus'].map(name => `apps/mobile/hooks/${name}.ts`),
  ...['colt-ui-smoke', 'skull-ui-evidence', 'tokyo-ui-evidence', 'not-alone-ui-smoke', 'libertalia-ui-primitives'].map(name => `apps/mobile/scripts/${name}.cjs`),
  'apps/mobile/scripts/colt-card-sizing-ui.test.cjs', 'apps/mobile/constants/theme.ts', 'apps/mobile/global.css',
  'apps/mobile/store/useGameStore.ts', 'apps/mobile/lib/api.ts', 'apps/mobile/lib/storage.ts',
  'packages/types/src/colt-express.ts', 'packages/types/src/colt-express-constants.ts',
  ...['move', 'floor', 'shoot', 'punch', 'rob', 'marshal', 'bullet'].map(name => `apps/mobile/assets/game-art/colt-action-${name}.webp`),
]);
function coltTargetConfig(env) {
  const target = env.COLT_UI_TARGET ?? 'full-match';
  assert(['full-match', 'card-sizing'].includes(target), 'Unknown COLT_UI_TARGET');
  if (target === 'card-sizing') {
    assert.equal(env.COLT_UI_PLAYERS, '2', 'Card sizing requires explicit COLT_UI_PLAYERS=2');
    for (const key of ['COLT_UI_FIXTURES', 'COLT_UI_CASES', 'COLT_UI_SCENARIO', 'COLT_UI_MAX_COMMANDS', 'COLT_UI_CAPTURE_LIMIT']) assert(!env[key], `Conflicting ${key}`);
    for (const key of ['COLT_UI_OUTPUT', 'QA_STATIC_ROOT']) assert(env[key] && path.isAbsolute(env[key]), `Absolute ${key} required`);
    assert(/^[a-f0-9]{64}$/i.test(env.QA_EXPECTED_WEB_SHA256 ?? ''), 'Frozen expected hash required');
    for (const value of [env.COLT_WEB_URL ?? 'http://127.0.0.1:8081', env.COLT_API_URL ?? 'http://127.0.0.1:3213']) {
      const url = new URL(value); assert(local(url) && url.pathname === '/' && !url.search && !url.hash, 'Plain loopback service origins required');
    }
  }
  const counts = env.COLT_UI_PLAYERS ? [Number(env.COLT_UI_PLAYERS)] : [2, 3];
  assert(counts.every(count => [2, 3].includes(count)), 'Choose2or3players');
  return { target, counts };
}
function sizingBudget(receipt, started, now = Date.now(), next = 'command') {
  assert(now - started < CARD_SIZING_LIMITS.milliseconds, 'Card sizing eight-minute deadline');
  if (next === 'command') assert(receipt.actions.length < CARD_SIZING_LIMITS.commands, 'Card sizing command ceiling');
  if (next === 'capture') assert(receipt.attempts.length < CARD_SIZING_LIMITS.images - 1, 'Card sizing image ceiling, including failure image');
}
function sizingSourceHashes(read = file => fs.readFileSync(path.resolve(__dirname, '../../..', file))) {
  return Object.fromEntries(CARD_SIZING_SOURCES.map(file => [file, createHash('sha256').update(read(file)).digest('hex')]));
}
function assertSizingCommand({ before, after, revision, accepted, sent, action, payload }) {
  assert.equal(after, before + 1, 'Exactly one acknowledgement per real command');
  assert.equal(accepted.action, action); assert.equal(accepted.revision, revision + 1, 'Exact revision sequence');
  assert.equal(sent.length, 1, 'Exactly one browser socket command');
  assert.equal(sent[0].event, action === 'start' ? 'start_game' : 'colt:' + action);
  if (action === 'start') assert(sent[0].payload === null || Object.keys(sent[0].payload).length === 0);
  else assert.deepEqual(sent[0].payload, { ...payload, expectedRevision: revision }, 'Rendered control submitted different identity');
}
function sizingJournals(players) {
  return Object.fromEntries(players.map(player => [player.name, structuredClone({ sent: player.sentCommands ?? [], accepted: player.acceptedActions })]));
}
function assertSizingJournals(journals, attempts) {
  assert(attempts.every(attempt => attempt.status === 'accepted'), 'Command attempt did not pass validation');
  assert(attempts.every(attempt => Object.hasOwn(journals, attempt.actor)), 'Command actor is missing its raw journal');
  for (const [actor, journal] of Object.entries(journals)) {
    const expected = attempts.filter(attempt => attempt.actor === actor);
    const sent = journal.sent.map(command => command.event === 'start_game' && command.payload === null ? { ...command, payload: {} } : command);
    assert.deepEqual(sent, expected.map(attempt => ({ event: attempt.action === 'start' ? 'start_game' : 'colt:' + attempt.action, payload: attempt.action === 'start' ? {} : { ...attempt.payload, expectedRevision: attempt.revision } })), 'Exact sent-command journal mismatch for ' + actor);
    assert.deepEqual(journal.accepted, expected.map(attempt => ({ action: attempt.action, revision: attempt.revision + 1 })), 'Exact acknowledgement journal mismatch for ' + actor);
  }
}
async function recordSizingCommand({ actor, action, payload, revision, attempts, readJournals, persist, perform }) {
  const attempt = { actor, action, payload: structuredClone(payload), revision, status: 'prepared', beforeJournal: readJournals() };
  attempts.push(attempt); persist();
  try {
    assertSizingJournals(attempt.beforeJournal, attempts.slice(0, -1));
    const accepted = await perform();
    attempt.afterJournal = readJournals(); attempt.accepted = accepted; persist();
    const before = attempt.beforeJournal[actor], after = attempt.afterJournal[actor];
    attempt.delta = { sent: after.sent.slice(before.sent.length), accepted: after.accepted.slice(before.accepted.length) }; persist();
    assertSizingCommand({ before: before.accepted.length, after: after.accepted.length, revision, accepted, sent: attempt.delta.sent, action, payload });
    attempt.status = 'accepted'; persist();
    assertSizingJournals(attempt.afterJournal, attempts);
    return accepted;
  } catch (error) {
    attempt.afterJournal = readJournals();
    const before = attempt.beforeJournal[actor], after = attempt.afterJournal[actor];
    attempt.delta = { sent: after.sent.slice(before.sent.length), accepted: after.accepted.slice(before.accepted.length) };
    attempt.status = 'failed'; attempt.failure = sanitise(error.message); persist(); throw error;
  }
}
function classifySizing(cards, role) {
  assert(cards.length >= 2, 'Comparable card family requires at least two actual faces');
  const failures = [], rows = [];
  for (const card of cards) {
    assert(card.face && card.edge && card.face.width > 0 && card.face.height > 0, 'Missing painted CardSurface geometry');
    if (Math.abs(card.face.width - cards[0].face.width) > 1) failures.push({ kind: 'unequal-face-width', index: card.index });
    let row = rows.find(row => Math.abs(row.top - card.root.top) < 2);
    if (!row) { row = { top: card.root.top, cards: [] }; rows.push(row); } row.cards.push(card);
    if (card.face.left < card.root.left - 1 || card.face.right > card.root.right + 1 || card.edge.bottom > card.root.bottom + 1) failures.push({ kind: 'face-or-edge-outside-owner', index: card.index });
    if (card.images.some(image => !image.complete || image.naturalWidth <= 0)) failures.push({ kind: 'unloaded-art', index: card.index });
  }
  for (const row of rows) for (const card of row.cards) if (Math.abs(card.face.height - row.cards[0].face.height) > 1) failures.push({ kind: 'unequal-same-row-face-height', index: card.index });
  if (role === 'program') for (const card of cards) if (Math.abs(card.face.height - cards[0].face.height) > 1) failures.push({ kind: 'unequal-program-face-height', index: card.index });
  return { failures, rows: rows.map(row => ({ top: row.top, indices: row.cards.map(card => card.index) })) };
}
function assertSizingStable(before, after) {
  assert.equal(after.length, before.length, 'Painted collection changed during screenshot');
  for (const [index, card] of before.entries()) {
    const next = after[index];
    for (const key of ['index', 'id', 'label', 'text']) assert.equal(next[key], card[key], 'Painted card identity changed: ' + key);
    for (const part of ['face', 'edge', 'root']) for (const axis of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
      assert(Number.isFinite(card[part]?.[axis]) && Number.isFinite(next[part]?.[axis]), 'Missing finite painted geometry');
      assert(Math.abs(next[part][axis] - card[part][axis]) <= 0.5, `Painted ${part}.${axis} moved during screenshot`);
    }
  }
}
async function sizingScreenshot({ measure, shoot, raw, persist, role }) {
  try {
    raw.before = await measure(); persist();
    const result = await shoot();
    raw.after = await measure(); persist();
    assertSizingStable(raw.before, raw.after);
    raw.classification = classifySizing(raw.after, role); persist();
    assert.deepEqual(raw.classification.failures, [], 'Actual painted faces are inconsistent');
    raw.passed = true; persist(); return result;
  } catch (error) { raw.failure = sanitise(error.message); persist(); throw error; }
}
function measureSizing(role) {
  const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const liveText = node => [node, ...node.querySelectorAll('*')].filter(element => !element.closest('[aria-hidden="true"]') && !/icon|material|fontawesome/i.test(getComputedStyle(element).fontFamily ?? ''))
    .flatMap(element => [...element.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent.trim())).filter(Boolean).join(' ');
  const roots = role === 'program' ? [...document.querySelectorAll('[id^="colt-program-card-"]')]
    : role === 'hand' ? [...document.querySelectorAll('[id^="colt-hand-"]')]
      : [...(document.getElementById('colt-reserve')?.parentElement.querySelectorAll('[role="button"][aria-label^="Reserve "]') ?? [])].map(button => button.parentElement);
  return roots.map((root, index) => {
    root.setAttribute('data-colt-sizing', role + '-' + index);
    const surface = [root, ...root.querySelectorAll('*')].find(node => {
      const [edge, face] = node.children;
      return edge && face && getComputedStyle(edge).position === 'absolute' && parseFloat(getComputedStyle(edge).bottom) < 0 && getComputedStyle(face).overflow === 'hidden';
    });
    if (!surface) return { index, id: root.id, root: rect(root), face: null, edge: null, missingSurface: true };
    const [edge, face] = surface.children;
    return { index, id: root.id, root: rect(root), face: rect(face), edge: rect(edge),
      text: liveText(face), label: root.querySelector('[role="button"]')?.getAttribute('aria-label') ?? root.getAttribute('aria-label'),
      captions: role === 'program' ? [...root.children].filter(node => !node.contains(surface)).map(node => ({ text: node.textContent, bounds: rect(node) })) : [],
      images: [...face.querySelectorAll('img')].map(image => ({ complete: image.complete, naturalWidth: image.naturalWidth, source: image.currentSrc || image.src, bounds: rect(image) })) };
  });
}
function sizingComplete(receipt) {
  return receipt.scenarioComplete === true && receipt.freezeVerified === true && receipt.browserClosed === true && receipt.calibration?.passed === true
    && receipt.actions.length <= CARD_SIZING_LIMITS.commands && receipt.captures.length <= CARD_SIZING_LIMITS.images
    && receipt.cleanup.length === 2 && receipt.cleanup.every(item => item.status === 200 && item.normalUI && item.authClear && !item.fallback)
    && !receipt.findings.length && !receipt.visualFindings.length && !receipt.consoleIssues.length && !receipt.blockedRequests.length
    && receipt.contextsClosed?.length === 2 && receipt.contextsClosed.every(item => item.closed) && receipt.commandJournalVerified === true
    && !receipt.failure && !receipt.rejections.length;
}
async function runCardSizing() {
  const { createEvidence, settle } = require('./skull-ui-evidence.cjs');
  const { enlargeLibertaliaText, restoreLibertaliaText, readLibertaliaFontState, validateLibertaliaFontState, assertFrameCoverage, frameVisibility, persistReceipt } = require('./libertalia-ui-primitives.cjs');
  const qa = createEvidence({ outputDir: output, base: origin, api: apiOrigin }), receipt = qa.evidence;
  Object.assign(receipt, { target: 'card-sizing', method: 'Real two-seat Colt route sizing supplement. Natural setup and early first-round commands, then deliberate forfeit and two normal UI exits. Not a natural full match.', limits: CARD_SIZING_LIMITS,
    actions: [], commandAttempts: [], commandJournals: {}, journalChecks: [], interactions: [], consoleIssues: [], visualFindings: [], families: [], rawCollections: [], frameProofs: [], programmeStates: [], contextsClosed: [], rejections: [], sources: CARD_SIZING_SOURCES });
  currentReceipt = receipt; ownedPlayers.clear(); screenshotSequence = 0;
  const players = [], started = Date.now(); let browser, deadlineTimer;
  const persist = () => persistReceipt(output, 'receipt.json', receipt, secrets);
  const readJournals = () => sizingJournals([...ownedPlayers]);
  function reconcileJournals(stage) {
    receipt.commandJournals = readJournals();
    const check = { stage, journals: receipt.commandJournals, passed: false }; receipt.journalChecks.push(check); persist();
    try { assertSizingJournals(check.journals, receipt.commandAttempts); check.passed = true; persist(); }
    catch (error) { check.failure = sanitise(error.message); persist(); throw error; }
  }
  const artwork = new Map();
  async function verifyArtwork(cards, projected) {
    for (const card of cards) for (const image of card.images) {
      if (!artwork.has(image.source)) {
        const url = new URL(image.source, origin), root = path.resolve(process.env.QA_STATIC_ROOT);
        const disk = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        assert.equal(url.origin, new URL(origin).origin); assert(disk.startsWith(root + path.sep));
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) }); assert.equal(response.status, 200);
        const hash = bytes => createHash('sha256').update(bytes).digest('hex');
        const served = hash(new Uint8Array(await response.arrayBuffer())); assert.equal(served, hash(fs.readFileSync(disk)));
        artwork.set(image.source, { source: url.pathname, served, disk: served });
      }
      const action = projected[card.index].action;
      assert(/^(move|floor|shoot|punch|rob|marshal|bullet)$/.test(action), 'Private or revealed action owns its artwork');
      const expected = createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../assets/game-art/colt-action-' + action + '.webp'))).digest('hex');
      assert.equal(artwork.get(image.source).served, expected, 'Actual action artwork differs from its authoritative identity');
    }
    receipt.artwork = [...artwork.values()];
  }
  async function send(player, label, action, payload = {}, selector) {
    sizingBudget(receipt, started);
    const revision = action === 'start' ? -1 : player.latestPublic.revision;
    const accepted = await recordSizingCommand({ actor: player.name, action, payload, revision, attempts: receipt.commandAttempts, readJournals, persist, perform: () => command(player, exact(label), selector) });
    receipt.actions.push({ ...accepted, beforeRevision: revision, sent: receipt.commandAttempts.at(-1).delta.sent[0] });
    for (const seat of players) await paired(seat, accepted.revision);
    persist();
  }
  async function recordFrame(player, role, index, scale, stage) {
    const selector = `[data-colt-sizing="${role}-${index}"]`, records = [];
    for (const align of ['start', 'end']) {
      sizingBudget(receipt, started, Date.now(), 'capture');
      const before = canonicalView(player);
      const screenshot = player.page.screenshot;
      let record;
      try {
        player.page.screenshot = async options => {
          if (path.basename(String(options.path)).startsWith('failure-')) return screenshot.call(player.page, options);
          const raw = { stage, role, index, scale, actor: player.name, file: path.basename(String(options.path)) };
          receipt.rawCollections.push(raw); persist();
          return sizingScreenshot({ raw, role, persist, measure: () => player.page.evaluate(measureSizing, role), shoot: () => screenshot.call(player.page, options) });
        };
        record = await qa.capture(player.page, `${stage}-${role}-${index}-${player.touch ? 'phone' : 'desktop'}-${player.page.viewport().width}-text${scale}-${align}.png`, { frame: selector, frameAlign: align });
      } finally { player.page.screenshot = screenshot; }
      receipt.attempts.at(-1).scale = scale;
      record.scale = scale; record.ownedPair = before;
      record.metrics.frame = record.metrics.frame.bounds;
      record.metrics.frameVisibleBounds = await player.page.$eval(selector, frameVisibility);
      const cards = receipt.rawCollections.at(-1).after, classified = classifySizing(cards, role);
      record.cardSizing = { role, cards, ...classified };
      assert.deepEqual(classified.failures, [], 'Actual painted faces are inconsistent');
      if (scale === 200) { record.fontState = await player.page.evaluate(readLibertaliaFontState); validateLibertaliaFontState(record.fontState); }
      assert.deepEqual(canonicalView(player), before, 'Capture changed authoritative paired state');
      reconcileJournals('after-capture:' + record.file);
      records.push(record); persist();
      try { const proof = assertFrameCoverage(records); receipt.frameProofs.push({ stage, role, index, actor: player.name, scale, width: player.page.viewport().width, ...proof }); return; } catch (error) { if (align === 'end') throw error; }
    }
  }
  async function family(player, role, stage, indices, widths = [player.touch ? 375 : 1280], scales = [100, 200]) {
    const original = player.page.viewport();
    try { for (const width of widths) for (const scale of scales) {
      sizingBudget(receipt, started, Date.now(), 'capture'); await setViewport(player, width); await settledCaptureState(player);
      try {
        if (scale === 200) await enlargeLibertaliaText(player.page);
        await settle(player.page);
        const cards = await player.page.evaluate(measureSizing, role), expected = role === 'program' ? player.latestPublic.program.length : role === 'hand' ? player.latestPrivate.hand.length : player.latestPrivate.reserveOptions.length;
        const sample = { stage, role, actor: player.name, viewport: player.page.viewport(), scale, revision: player.latestPublic.revision, cards, expected };
        receipt.families.push(sample); persist();
        assert.equal(cards.length, expected, 'Actual collection must match the authoritative projection');
        const classified = classifySizing(cards, role); Object.assign(sample, classified); persist(); assert.deepEqual(classified.failures, []);
        if (role === 'hand') assert.deepEqual(cards.map(card => card.id), player.latestPrivate.hand.map(card => 'colt-hand-' + card.id));
        await verifyArtwork(cards, role === 'program' ? player.latestPublic.program : role === 'hand' ? player.latestPrivate.hand : player.latestPrivate.reserveOptions);
        if (role !== 'program') assert(cards.every(card => card.images.length > 0), 'Private action artwork missing');
        if (role === 'program') for (const card of cards) {
          const projected = player.latestPublic.program[card.index];
          if (!projected.faceUp) { assert.equal(projected.action, null); assert.equal(projected.ownerBandit, null); assert.equal(card.text.trim(), 'FACE DOWN'); assert.equal(card.images.length, 0); }
          else { assert(card.text.includes(projected.action.toUpperCase())); assert(card.images.length > 0, 'Revealed action artwork missing'); }
          const active = card.index === player.latestPublic.executionIndex && player.latestPublic.phase !== 'programming';
          const state = active ? 'RESOLVING NOW' : card.index < player.latestPublic.executionIndex ? 'RESOLVED' : 'QUEUED';
          assert(card.captions.some(caption => caption.text === `${card.index + 1}. ${state}`), 'Programme caption must match actual execution state');
        }
        sample.passed = true; persist();
        const requested = [...new Set(indices ? indices(cards.length) : [0, cards.length - 1])];
        for (const index of requested) await recordFrame(player, role, index, scale, stage);
      } finally { if (scale === 200) await restoreLibertaliaText(player.page); }
    } } finally { await setViewport(player, original.width, original.height); }
  }
  try {
    receipt.sourceHashes = sizingSourceHashes(); receipt.bundle = await servedHash(); persist();
    browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + certificate] });
    deadlineTimer = setTimeout(() => { receipt.failure = 'Card sizing eight-minute hard deadline'; void browser.close().catch(() => {}); }, Math.max(1, CARD_SIZING_LIMITS.milliseconds - (Date.now() - started)));
    for (const [index, name] of ['Conductor Alexandria', 'Bandit Bartholomew X'].entries()) {
      const player = await openPlayer(browser, name, index ? 1280 : 375, !index); players.push(player);
      player.onCommandJournal = () => { receipt.commandJournals = readJournals(); persist(); };
      qa.register({ page: player.page, name, get public() { return player.latestPublic; }, get lastAcceptedAt() { return player.lastAcceptedAt; } });
    }
    let calibrationPage;
    await qa.calibrate({ createBrowserContext: async () => ({ newPage: async () => { calibrationPage = await players[0].context.newPage(); return calibrationPage; }, close: async () => calibrationPage?.close() }) });
    receipt.calibrationScope = 'Generic glyph/containment positive controls in a temporary page of the first owned context; two calibration PNGs. Colt-specific painted-face classification is tested separately.';
    const [host, desktop] = players;
    await host.page.goto(origin + '/colt-express'); await h.waitForText(host.page, 'BOARD THE TRAIN');
    await h.setInput(host.page, 'Your name', host.name); await clickButton(host.page, /^CREATE ROOM$/);
    await h.waitForPath(host.page, '/colt-express/lobby'); const code = await h.roomCodeFromLobby(host.page);
    await desktop.page.goto(origin + '/colt-express/join'); await h.setInput(desktop.page, 'Your name', desktop.name); await h.setInput(desktop.page, 'Room code', code); await clickButton(desktop.page, /^JOIN GAME$/);
    await h.waitUntil(() => players.every(player => player.auth) && host.latestRoom?.players.filter(player => player.isConnected).length === 2, 'Two owned connected seats');
    for (const player of players) { qa.secrets.add(player.auth.token); secrets.add(player.auth.token); }
    await send(host, 'START GAME', 'start');
    await Promise.all(players.map(player => h.waitForPath(player.page, '/colt-express/game')));
    while (host.latestPublic.phase !== 'reserve_card') {
      let acted = false;
      for (const player of players) {
        await paired(player); const mine = player.latestPrivate, game = player.latestPublic;
        if (mine.canChooseTeam) {
          let index = game.availableTeams.findIndex(team => team.includes('ghost')); if (index < 0) index = 0;
          const team = game.availableTeams[index];
          await send(player, 'CHOOSE ' + team.map(name => name.toUpperCase()).join(' & '), 'choose-team', { teamIndex: index });
          receipt.teamChoices ??= []; receipt.teamChoices.push({ actor: player.name, team }); acted = true; break;
        }
        if (mine.canAssignStart) { const self = game.players.find(seat => seat.playerId === player.auth.playerId); await send(player, self.characters[0].toUpperCase() + ' IN CABOOSE', 'assign-start', { cabooseBandit: 0 }); acted = true; break; }
      }
      assert(acted, 'Setup must expose a legal own-seat control');
    }
    for (const player of players) await family(player, 'reserve', 'reserve');
    for (const player of players) {
      const card = player.latestPrivate.reserveOptions.find(card => card.action === 'move'); assert(card, 'Canonical reserve contains Move');
      const labels = await h.enabledLabels(player.page), owner = player.latestPublic.players.find(seat => seat.playerId === player.auth.playerId).characters[card.ownerBandit];
      const label = labels.find(label => label.startsWith('Reserve move for ' + owner[0].toUpperCase() + owner.slice(1) + '.')); assert(label);
      await player.page.evaluate(measureSizing, 'reserve');
      const index = player.latestPrivate.reserveOptions.findIndex(option => option.id === card.id);
      await send(player, label, 'reserve', { cardId: card.id }, `[data-colt-sizing="reserve-${index}"]`);
      (receipt.reservedMoves ??= []).push({ actor: player.name, cardId: card.id });
    }
    for (const player of players) await family(player, 'hand', 'initial-hand');
    await family(host, 'hand', 'narrow-hand', undefined, [320], [200]);
    while (host.latestPublic.phase === 'programming') {
      const player = players.find(player => player.latestPrivate.canProgram); assert(player, 'Programming owner is present');
      const hand = player.latestPrivate.hand, reserved = receipt.reservedMoves.find(move => move.actor === player.name);
      const card = hand.find(card => card.id === reserved.cardId) ?? hand.find(card => ['move', 'marshal', 'rob', 'punch', 'floor'].includes(card.action));
      if (card) {
        const selector = '#colt-hand-' + card.id;
        const label = await player.page.$eval(selector + ' [role="button"]', node => node.getAttribute('aria-label'));
        if (player.latestPrivate.canHideFirstAction) await clickButton(player.page, /^Ghost first action: face up$/);
        await send(player, label, 'program', { cardId: card.id, ...(player.latestPrivate.canHideFirstAction ? { faceDown: true } : {}) }, selector);
      } else await send(player, 'DRAW 3 INSTEAD', 'program', { draw: true });
      if (!receipt.queuedProgramme && host.latestPublic.program.length >= 3 && host.latestPublic.phase === 'programming') {
        for (const seat of players) await family(seat, 'program', 'queued-programme'); receipt.queuedProgramme = true;
      }
    }
    assert(receipt.queuedProgramme, 'At least three queued programme entries must be captured');
    while (!(host.latestPublic.phase === 'pending_choice' && host.latestPublic.executionIndex > 0 && host.latestPublic.executionIndex < host.latestPublic.program.length - 1)) {
      const player = players.find(player => player.latestPrivate.canChoose); assert(player, 'Early execution must expose a real choice');
      const option = player.latestPublic.pending.options[0]; await send(player, option.label, 'choose', { optionId: option.id });
    }
    for (const player of players) {
      const index = player.latestPublic.executionIndex;
      await family(player, 'program', 'execution-programme', count => [0, index, count - 1]);
      receipt.programmeStates.push({ actor: player.name, revision: player.latestPublic.revision, executionIndex: index, statuses: ['RESOLVED', 'RESOLVING NOW', 'QUEUED'] });
    }
    receipt.cleanup.push({ actor: desktop.name, status: await leave(desktop, 'Back to arcade'), normalUI: true, authClear: true });
    await h.waitUntil(() => host.latestPublic?.status === 'game_over', 'Deliberate forfeit result'); await paired(host);
    assert.equal(host.latestPublic.endReason, 'forfeit'); receipt.forfeitTerminal = host.latestPublic;
    receipt.cleanup.push({ actor: host.name, status: await leave(host, 'BACK TO ARCADE'), normalUI: true, authClear: true });
    reconcileJournals('after-normal-ui-cleanup');
    sizingBudget(receipt, started, Date.now(), 'complete');
    receipt.scenarioComplete = true;
  } catch (error) { receipt.failure ??= sanitise(error.stack); }
  finally {
    clearTimeout(deadlineTimer);
    for (const player of ownedPlayers) {
      await Promise.allSettled([...player.transactions]);
      if (!player.auth && !player.page.isClosed()) {
        const auth = await player.page.evaluate(() => { try { return JSON.parse(sessionStorage.getItem('za:auth') || 'null'); } catch { return null; } }).catch(() => null);
        if (auth?.token && auth.playerId && auth.roomCode) { secrets.add(auth.token); player.auth = auth; }
      }
      if (!player.left && player.auth) {
        let status = null; try { status = (await fetch(new URL('/rooms/' + encodeURIComponent(player.auth.roomCode) + '/leave', apiOrigin), { method: 'POST', headers: { Authorization: 'Bearer ' + player.auth.token }, signal: AbortSignal.timeout(5000), redirect: 'error' })).status; } catch {}
        receipt.cleanup.push({ actor: player.name, fallback: true, status, normalUI: false, authClear: false });
        receipt.failure ??= 'Normal UI cleanup was not completed';
      }
      try { await player.context.close(); receipt.contextsClosed.push({ actor: player.name, closed: true }); } catch (error) { receipt.contextsClosed.push({ actor: player.name, closed: false }); receipt.failure ??= sanitise(error.message); }
    }
    try { if (browser) { await browser.close(); receipt.browserClosed = true; } } catch (error) { receipt.failure ??= sanitise(error.message); }
    try { reconcileJournals('after-context-and-browser-closure'); receipt.commandJournalVerified = true; } catch (error) { receipt.failure ??= sanitise(error.message); }
    try { receipt.finalSourceHashes = sizingSourceHashes(); assert.deepEqual(receipt.finalSourceHashes, receipt.sourceHashes); receipt.finalBundle = await servedHash(); assert.deepEqual(receipt.finalBundle, receipt.bundle); receipt.freezeVerified = true; } catch (error) { receipt.failure ??= sanitise(error.message); }
    receipt.rejections = players.flatMap(player => player.rejections);
    receipt.elapsedMs = Date.now() - started;
    const images = fs.readdirSync(output).filter(file => file.endsWith('.png'));
    receipt.imageCount = images.length; if (images.length > CARD_SIZING_LIMITS.images + CARD_SIZING_LIMITS.calibrations) receipt.failure ??= 'Physical PNG ceiling exceeded';
    receipt.passed = sizingComplete(receipt); receipt.status = receipt.passed ? 'passed' : 'failed';
    receipt.gaps = ['Deliberate first-round forfeit, not a natural five-round match or rematch.', 'First/last private faces and sampled public programme faces, not every artwork or option.', 'CSS200 and emulated input, not native text scale or physical-device evidence.'];
    persist(); if (!receipt.passed) process.exitCode = 1;
    console.log(JSON.stringify({ target: receipt.target, status: receipt.status, actions: receipt.actions.length, captures: receipt.captures.length, output }));
  }
  return receipt.status;
}
async function run() {
  const { target, counts } = coltTargetConfig(process.env);
  assert.equal(process.env.COLT_UI_EXCLUSIVE_WINDOW, 'granted', 'Wait for the coordinator to grant an exclusive browser window');
  assert(/^[A-Za-z0-9+/]{43}=$/.test(certificate), 'Invalid certificate fingerprint');
  const base = path.resolve(outputBase); fs.mkdirSync(base, { recursive: true });
  const runRoot = fs.mkdtempSync(path.join(base, 'colt-' + new Date().toISOString().replace(/[:.]/g, '-') + '-'));
  const results = [];
  for (const count of counts) { output = path.join(runRoot, count + '-players'); fs.mkdirSync(output); results.push({ count, target, status: await (target === 'card-sizing' ? runCardSizing() : runMatch(count)) }); if (results.at(-1).status !== 'passed') break; }
  fs.writeFileSync(path.join(runRoot, 'suite.json'), JSON.stringify({ requested: counts, results, complete: results.length === counts.length && results.every(result => result.status === 'passed') }, null, 2));
}
module.exports = { openPlayer, servedHash, paired, command, capture, textBounds, enlarged, exact, coltTargetConfig, CARD_SIZING_LIMITS, CARD_SIZING_SOURCES, sizingSourceHashes, sizingBudget, assertSizingCommand, sizingJournals, assertSizingJournals, recordSizingCommand, classifySizing, assertSizingStable, sizingScreenshot, measureSizing, sizingComplete };
if (require.main === module) run().catch(error => { console.error(sanitise(error.stack)); process.exitCode = 1; });
