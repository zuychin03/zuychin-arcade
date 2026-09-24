const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const puppeteer = require('puppeteer-core');
const { prepareCertificate, createApiProxy } = require('./local-qa-proxy.cjs');
const { validateExport } = require('./validate-export-env.cjs');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const copy = value => JSON.parse(JSON.stringify(value));
const sanitise = value => String(value).replace(/Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]');
async function until(check, label, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await pause(70); }
  throw new Error('Timed out: ' + label);
}
async function button(page, label, occurrence = 0) {
  for (const handle of await page.$$('[role="button"],button')) {
    const item = await handle.evaluate(node => {
      const r = node.getBoundingClientRect();
      const modal = [...document.querySelectorAll('[aria-modal="true"],#kraken-rules')].filter(n => n.getBoundingClientRect().width > 0).at(-1);
      return { label: (node.getAttribute('aria-label') || node.textContent).trim(), available: r.width > 0 && r.height > 0 && !node.closest('[aria-hidden="true"]') && !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true' && (!modal || modal.contains(node)) };
    });
    if (item.available && (typeof label === 'string' ? item.label === label : label.test(item.label)) && occurrence-- === 0) return handle;
    await handle.dispose();
  }
  return null;
}
async function click(page, label, occurrence = 0) {
  await until(async () => { const h = await button(page, label, occurrence); await h?.dispose(); return !!h; }, 'visible control ' + label);
  const h = await button(page, label, occurrence); assert(h);
  await h.evaluate(n => n.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  const r = await h.boundingBox(); assert(r && r.width >= 47.5 && r.height >= 47.5, 'Target below 48px: ' + label);
  await h.click(); await h.dispose();
}
async function input(page, label, value) {
  const selector = '[aria-label="' + label + '"]'; await page.waitForSelector(selector);
  await page.$eval(selector, n => n.scrollIntoView({ block: 'center' })); await page.click(selector);
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type(value);
}
function paired(s) { return s.auth && s.public && s.private && s.public.revision === s.private.revision && s.private.playerId === s.auth.playerId && s.private.viewerPlayerId === s.auth.playerId && s.private.roomCode === s.auth.roomCode && s.public.roomCode === s.auth.roomCode; }
function privacy(g) {
  for (const key of ['draw', 'discard', 'hands', 'submissions', 'rituals', 'ritualPendingIds', 'ritualDecision', 'ritualWindowRevision', 'ritualGunCount']) assert(!(key in g), 'Public secret field ' + key);
  for (const p of g.players) {
    for (const key of ['originalFaction', 'observations', 'knownLeaderId', 'knownPirateIds']) assert(!(key in p), 'Public role knowledge');
    if (g.status !== 'game_over') assert.equal(p.faction, null);
    if (g.phase === 'mutiny') assert.equal(p.guns, null);
  }
  if (g.phase === 'mutiny') assert.equal(g.bids, null);
  if (g.phase === 'ritual') { assert.equal(g.pendingPlayerId, null); assert.deepEqual(g.readyPlayerIds, []); }
}
async function main() {
  assert(process.argv.includes('--run'), 'Prepared only. Pass --run after browser/proxy ownership is granted.');
  const root = fs.realpathSync(process.argv.find(a => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1]) || path.join(__dirname, '../dist/four-games-review-final'));
  const browserApi = 'https://localhost:3214', api = 'http://127.0.0.1:3213';
  validateExport(root, { EXPO_PUBLIC_SERVER_URL: browserApi });
  const entry = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/src=["']([^"']*\/_expo\/static\/js\/web\/(?:entry|index)-[a-f0-9]+\.js)/)?.[1]; assert(entry);
  const output = path.resolve(process.env.QA_KRAKEN_OUTPUT || '.tmp-qa-evidence/kraken-ui-' + Date.now());
  assert(!fs.existsSync(output), 'Use a fresh evidence directory'); fs.mkdirSync(output, { recursive: true });
  const report = { method: 'Automated real-browser UI, five isolated contexts. All game commands use visible controls; network frames are read-only assertions. Own-hand-only card policy, no cross-seat role strategy. Not manual play or native-device acceptance.', bundleHash: createHash('sha256').update(fs.readFileSync(path.join(root, entry))).digest('hex'), phases: [], captures: [], checks: [], actions: 0, errors: [], blocked: [], cleanup: [], passed: false };
  const credentials = prepareCertificate(), proxy = createApiProxy(credentials), sockets = new Set(), seats = [];
  let browser, origin;
  const server = http.createServer((req, res) => {
    let pathname; try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
    const target = path.resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const file = [target, target + '.html', path.join(target, 'index.html')].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!file) { res.writeHead(404); res.end(); return; }
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(file));
  });
  for (const service of [server, proxy]) service.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const active = () => seats.filter(s => !s.left);
  const clean = () => { assert.deepEqual(report.errors, []); assert.deepEqual(report.blocked, []); assert.deepEqual(seats.flatMap(s => s.rejected), []); };
  const settle = async () => { await until(() => active().every(paired) && active().every(s => s.public.revision === active()[0].public.revision), 'paired private/public revisions'); clean(); };
  const actor = async (name, width) => {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    const seat = { context, page, name, auth: null, public: null, private: null, rejected: [], lastAction: null, left: false }; seats.push(seat);
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 }); await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const allowed = [origin, browserApi]; await page.setRequestInterception(true);
    page.on('request', r => { const u = new URL(r.url()); if (allowed.includes(u.origin) || ['data:', 'blob:', 'about:'].includes(u.protocol)) r.continue(); else { report.blocked.push(u.origin); r.abort(); } });
    await page.evaluateOnNewDocument(origins => {
      const Native = window.WebSocket;
      window.WebSocket = new Proxy(Native, { construct(target, args) { const u = new URL(args[0], location.href); if (!origins.includes(u.origin.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'))) throw new Error('Nonlocal socket blocked'); return Reflect.construct(target, args); } });
    }, allowed);
    page.on('pageerror', e => report.errors.push({ seat: name, message: sanitise(e.message) }));
    page.on('response', async r => {
      const u = new URL(r.url());
      if (u.origin === browserApi && /\/rooms\/(create|join)$/.test(u.pathname) && r.request().method() === 'POST' && r.ok()) {
        try { const a = await r.json(); seat.auth = { token: a.token, playerId: a.playerId, roomCode: a.roomCode }; } catch (e) { report.errors.push(sanitise(e.message)); }
      }
    });
    const cdp = await page.createCDPSession(); await cdp.send('Network.enable');
    cdp.on('Network.webSocketCreated', e => { seat.socketId = e.requestId; });
    cdp.on('Network.webSocketFrameReceived', ({ requestId, response }) => {
      if (requestId !== seat.socketId || !response.payloadData.startsWith('42')) return;
      let frame; try { frame = JSON.parse(response.payloadData.slice(2)); } catch { return; }
      try {
        if (frame[0] === 'game_state' && frame[1]?.gameId === 'feed_the_kraken') { privacy(frame[1]); seat.public = frame[1]; }
        if (frame[0] === 'private_state' && frame[1]?.gameId === 'feed_the_kraken') { assert.equal(frame[1].playerId, seat.auth?.playerId); assert.equal(frame[1].viewerPlayerId, seat.auth?.playerId); seat.private = frame[1]; }
        if (frame[0] === 'action_rejected') seat.rejected.push(frame[1]);
      } catch (e) { report.errors.push({ seat: name, message: sanitise(e.message) }); }
    });
    cdp.on('Network.webSocketFrameSent', ({ response }) => {
      if (!response.payloadData.startsWith('42')) return;
      try { const f = JSON.parse(response.payloadData.slice(2)); if (f[0] === 'kraken:action') seat.lastAction = f[1].action; } catch { /* Ignore non-JSON transport packets. */ }
    });
    return seat;
  };
  const capture = async (seat, name) => {
    await seat.page.evaluate(async () => { await document.fonts.ready; });
    await seat.page.waitForFunction(() => [...document.images].filter(n => n.getBoundingClientRect().width > 0).every(n => n.complete));
    const metrics = await seat.page.evaluate(() => {
      const visible = n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[aria-hidden="true"]'); };
      const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, targets: [...document.querySelectorAll('[role="button"],button')].filter(visible).map(n => ({ label: n.getAttribute('aria-label') || n.textContent, ...rect(n) })), faces: [...document.querySelectorAll('[aria-label^="Select "] [data-testid="card-surface-face"]')].filter(visible).map(rect), broken: [...document.images].filter(visible).filter(n => n.complete && !n.naturalWidth).map(n => n.src) };
    });
    assert(metrics.pageWidth <= metrics.width + 1, name + ': horizontal page overflow'); assert.deepEqual(metrics.broken, []);
    for (const t of metrics.targets) assert(t.width >= 47.5 && t.height >= 47.5, name + ': target below 48px ' + t.label);
    for (const a of metrics.faces) for (const b of metrics.faces) if (Math.abs(a.y - b.y) < 1) assert(Math.abs(a.height - b.height) <= 1, 'Unequal same-row navigation faces');
    report.captures.push({ name, ...metrics }); await seat.page.screenshot({ path: path.join(output, name + '.png') });
  };
  const shipVisible = async seat => {
    const selector = 'svg[aria-label="quick voyage chart; ship at ' + seat.public.nodeId + '"]';
    await seat.page.waitForSelector(selector);
    await seat.page.$eval(selector, svg => {
      let n = svg.parentElement; while (n && n.getBoundingClientRect().height !== 360) n = n.parentElement;
      (n || svg).scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    if (['pirate', 'sailor', 'cult'].includes(seat.public.nodeId)) return;
    const result = await seat.page.$eval(selector, svg => {
      const ring = svg.querySelector('circle[r="14"]'); if (!ring) return false;
      const r = ring.getBoundingClientRect(); let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
      for (let p = ring.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p), b = p.getBoundingClientRect();
        if (/(hidden|auto|scroll)/.test(s.overflowX)) { left = Math.max(left, b.left); right = Math.min(right, b.right); }
        if (/(hidden|auto|scroll)/.test(s.overflowY)) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
      }
      return r.left >= left - 1 && r.right <= right + 1 && r.top >= top - 1 && r.bottom <= bottom + 1;
    }); assert(result, 'Ship ring clipped after movement to ' + seat.public.nodeId);
  };
  const command = async (seat, label, expected) => {
    const revision = seat.public.revision; seat.lastAction = null; await click(seat.page, label);
    await until(() => seat.lastAction && paired(seat) && seat.public.revision > revision, 'accepted ' + expected.type);
    assert.deepEqual(seat.lastAction, expected); report.actions++; await settle();
  };
  const open = async seat => { const h = await button(seat.page, 'Open my private panel'); if (h) { await h.dispose(); await click(seat.page, 'Open my private panel'); } };
  const reload = async seat => {
    const before = copy(seat.private), pub = copy(seat.public); seat.public = null; seat.private = null;
    await seat.page.reload({ waitUntil: 'networkidle0' }); await settle(); assert.deepEqual(seat.private, before); assert.deepEqual(seat.public, pub);
    const closed = await button(seat.page, 'Open my private panel'); assert(closed, 'Reload must conceal private panel'); await closed.dispose();
  };
  const play = async (host, prefix) => {
    let moved = host.public.nodeId, reloaded = false;
    for (let turn = 0; turn < 1800 && host.public.status !== 'game_over'; turn++) {
      await settle(); const seat = active().find(s => s.private.canAct); assert(seat, 'No visible decision can advance voyage');
      const g = copy(seat.public), mine = copy(seat.private), phase = g.phase;
      if (!report.phases.includes(phase)) report.phases.push(phase);
      await open(seat);
      assert((await seat.page.evaluate(() => document.body.innerText)).includes('Private · ' + mine.faction.replaceAll('_', ' ')), 'Private panel does not show its owner faction');
      if (!report.captures.some(c => c.name === prefix + '-' + phase)) {
        await capture(seat, prefix + '-' + phase);
        if (phase === 'navigation' || phase === 'navigator') {
          const viewport = seat.page.viewport();
          for (const width of [375, 1280, 320]) { await seat.page.setViewport({ width, height: 900 }); await capture(seat, prefix + '-' + phase + '-' + width); }
          await seat.page.setViewport(viewport);
        }
      }
      const name = id => g.players.find(p => p.playerId === id).displayName;
      if (phase === 'priority') await command(seat, 'Pass this window', { type: 'pass' });
      else if (phase === 'appointment') {
        const lieutenantId = g.effects.forcedLieutenantId || mine.legalTargetIds[0], navigatorId = mine.legalTargetIds.find(id => id !== lieutenantId);
        if (!g.effects.forcedLieutenantId) await click(seat.page, name(lieutenantId));
        await click(seat.page, name(navigatorId), g.effects.forcedLieutenantId ? 0 : 1);
        await command(seat, 'Confirm navigation team', { type: 'appoint', lieutenantId, navigatorId });
      } else if (phase === 'mutiny') await command(seat, `Seal bid: ${mine.minimumBid} guns`, { type: 'bid', guns: mine.minimumBid });
      else if (phase === 'navigation' || phase === 'navigator') {
        const card = [...mine.navigationCards].sort((a, b) => ['uprising', 'telescope'].indexOf(b.effect) - ['uprising', 'telescope'].indexOf(a.effect))[0];
        await click(seat.page, `Select ${card.colour} / ${card.effect}`);
        await command(seat, phase === 'navigation' ? 'Send this card' : 'Sail this course', { type: phase === 'navigation' ? 'submit_navigation' : 'navigate', cardId: card.id });
      } else if (phase === 'telescope') { assert.equal(mine.navigationCards.length, 1); await command(seat, 'Keep it on top', { type: 'telescope', discard: false }); }
      else if (phase === 'ritual' && mine.ritual === null) await command(seat, 'Complete private ritual', { type: 'ritual' });
      else if (phase === 'ritual' && mine.ritual === 'stash') {
        await click(seat.page, String(mine.ritualGunCount));
        await command(seat, 'Confirm distribution', { type: 'ritual', allocations: Object.fromEntries(mine.legalTargetIds.map((id, i) => [id, i === 0 ? mine.ritualGunCount : 0])) });
      } else if (phase === 'instigator') await command(seat, 'Decline', { type: 'instigator', accept: false });
      else {
        const playerId = mine.legalTargetIds[0]; assert(playerId, 'Missing private legal target'); await click(seat.page, name(playerId));
        if (g.mapAction === 'feeding') await click(seat.page, 'Review feeding');
        await command(seat, g.mapAction === 'feeding' ? 'Confirm sacrifice' : 'Confirm choice', { type: phase === 'tie_veto' ? 'veto' : phase === 'emergency' ? 'emergency' : phase === 'ritual' ? 'ritual' : 'target', playerId });
      }
      if (!reloaded && phase === 'mutiny') { await reload(seat); reloaded = true; report.checks.push(prefix + ': sealed bid/private identity survive UI reload'); }
      if (host.public.nodeId !== moved) { await shipVisible(host); moved = host.public.nodeId; }
    }
    assert.equal(host.public.status, 'game_over', 'Bounded UI voyage did not finish');
    const g = host.public; assert(['destination', 'leader_fed'].includes(g.endReason), 'Expected natural terminal, got ' + g.endReason);
    const winners = g.players.filter(p => !p.forfeited && (g.winner === 'cult' ? ['cultist', 'cult_leader'].includes(p.faction) : p.faction === g.winner)).map(p => p.playerId).sort();
    assert.deepEqual([...g.winnerIds].sort(), winners, 'Printed faction eligibility, excluding forfeits');
    await capture(host, prefix + '-terminal'); report.checks.push(prefix + ': natural full UI voyage and independently checked faction winners');
  };
  try {
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(3214, '127.0.0.1', resolve); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); origin = 'http://127.0.0.1:' + server.address().port;
    browser = await puppeteer.launch({ executablePath: process.env.QA_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run', '--ignore-certificate-errors-spki-list=' + credentials.spki] });
    const host = await actor('Kraken UI 1', 375); await host.page.goto(origin + '/feed-the-kraken', { waitUntil: 'networkidle0' });
    await input(host.page, 'Your name', host.name); await click(host.page, 'CREATE ROOM'); await until(() => host.auth && host.page.url().endsWith('/lobby'), 'host lobby');
    await capture(host, 'lobby-375');
    for (let i = 2; i <= 5; i++) {
      const seat = await actor('Kraken UI ' + i, i === 3 ? 1280 : i === 5 ? 320 : 375);
      await seat.page.goto(origin + '/feed-the-kraken/join', { waitUntil: 'networkidle0' }); await input(seat.page, 'Your name', seat.name); await input(seat.page, 'Room code', host.auth.roomCode); await click(seat.page, 'JOIN GAME');
      await until(() => seat.auth && seat.page.url().endsWith('/lobby'), 'joined lobby');
    }
    await click(host.page, 'START GAME'); await settle(); assert.equal(host.public.journey, 'quick'); assert.equal(host.public.players.length, 5);
    for (const width of [375, 1280, 320]) {
      await host.page.setViewport({ width, height: 900 }); await click(host.page, 'Find ship'); await shipVisible(host); await capture(host, 'initial-' + width);
      const chart = await host.page.$eval('svg[aria-label^="quick voyage chart"]', svg => ({ labels: [...svg.querySelectorAll('text')].map(n => n.textContent), paths: svg.querySelectorAll('path').length, width: svg.getBoundingClientRect().width }));
      assert(chart.labels.includes('Departure') && chart.labels.some(t => /^W\d+$/.test(t)), 'Readable waypoint labels missing');
      assert(chart.labels.includes('Crimson Cove') && chart.labels.includes('Bluewater Bay') && chart.labels.includes('Kraken'), 'Named destinations missing');
      assert(chart.paths >= 3, 'SVG vessel hull and sails missing');
      await click(host.page, 'Zoom in'); await click(host.page, 'Find ship'); await shipVisible(host);
      const zoomed = await host.page.$eval('svg[aria-label^="quick voyage chart"]', svg => svg.getBoundingClientRect().width); assert(zoomed > chart.width);
      await capture(host, 'chart-zoom-' + width); await click(host.page, 'Zoom out'); await click(host.page, 'Find ship'); await shipVisible(host);
      report.checks.push(`Chart ${width}px: named waypoints/destinations, vessel SVG, zoom and Find ship`);
    }
    await host.page.setViewport({ width: 375, height: 900 }); await reload(host); await play(host, 'first');
    const revision = host.public.revision; await click(host.page, 'Sail again'); await until(() => paired(host) && host.public.revision > revision && host.public.status === 'playing', 'rematch'); await settle();
    assert.equal(host.public.round, 1); assert.equal(host.public.nodeId, '0,0'); assert(host.public.players.every(p => p.aboard && !p.forfeited && p.resume.length === 0));
    assert(seats.every(s => s.private.observations.length === 0 && s.private.ritual === null && s.private.ritualGunCount === 0));
    const departed = seats[4]; await click(departed.page, 'Leave voyage'); await click(departed.page, 'LEAVE'); await until(() => new URL(departed.page.url()).pathname === '/', 'explicit leave'); departed.left = true; await settle();
    assert(host.public.players.find(p => p.playerId === departed.auth.playerId).forfeited); await reload(host); await play(host, 'forfeit-rematch');
    assert(!host.public.winnerIds.includes(departed.auth.playerId)); report.checks.push('Rematch reset; explicit non-sacrifice forfeit, continued voyage and winner exclusion');
    report.uncoveredPhases = ['priority', 'appointment', 'mutiny', 'navigation', 'navigator', 'ritual', 'map_action', 'effect_target', 'telescope'].filter(p => !report.phases.includes(p));
    clean(); report.passed = true;
  } catch (e) {
    report.error = sanitise(e.message);
    for (const [i, s] of seats.entries()) await s.page.screenshot({ path: path.join(output, 'failure-' + i + '.png') }).catch(() => {});
  } finally {
    for (const s of seats) if (s.auth) {
      try { const r = await fetch(api + '/rooms/' + s.auth.roomCode + '/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + s.auth.token } }); report.cleanup.push({ seat: s.name, status: r.status }); assert(r.ok || s.left && [403, 404].includes(r.status)); }
      catch (e) { report.cleanup.push({ seat: s.name, error: sanitise(e.message) }); report.passed = false; }
    }
    if (browser) await browser.close().catch(e => { report.errors.push(sanitise(e.message)); report.passed = false; });
    for (const socket of sockets) socket.destroy(); if (server.listening) await new Promise(r => server.close(r)); if (proxy.listening) await new Promise(r => proxy.close(r));
    fs.writeFileSync(path.join(output, 'report.json'), sanitise(JSON.stringify(report, null, 2)));
  }
  console.log(JSON.stringify({ passed: report.passed, actions: report.actions, phases: report.phases, uncoveredPhases: report.uncoveredPhases, error: report.error, output }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
if (require.main === module) main().catch(e => { console.error(sanitise(e.message)); process.exitCode = 1; });
