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
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sanitise = value => String(value).replace(/Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]');
const publicKeys = 'gameId roomCode rulesVersion revision status phase terminationReason roundNumber storytellerId clue players table result winnerIds drawCount discardCount log'.split(' ').sort();
const privateKeys = 'gameId roomCode revision playerId hand submittedCardIds votes submissionCount'.split(' ').sort();
const playerKeys = 'playerId displayName score handCount forfeited submitted voted ready'.split(' ').sort();
async function until(check, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(80); }
  throw new Error('Timed out: ' + label);
}
async function button(page, match, enabled = true) {
  for (const element of await page.$$('[role="button"],button')) {
    const info = await element.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const modal = [...document.querySelectorAll('[aria-modal="true"],#dixit-image-detail,#dixit-rules')].filter(n => n.getBoundingClientRect().width > 0).at(-1);
      return { label: (node.getAttribute('aria-label') || node.textContent).trim(), visible: rect.width > 0 && rect.height > 0 && !node.closest('[aria-hidden="true"]') && (!modal || modal.contains(node)), disabled: node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true' };
    });
    if (info.visible && (!enabled || !info.disabled) && (typeof match === 'string' ? info.label === match : match.test(info.label))) return { element, label: info.label, disabled: info.disabled };
    await element.dispose();
  }
  return null;
}
async function click(page, match) {
  await until(async () => { const found = await button(page, match); await found?.element.dispose(); return !!found; }, 'button ' + match);
  const found = await button(page, match); assert(found, 'Control disappeared before click: ' + match);
  await found.element.evaluate(n => n.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await found.element.click(); await found.element.dispose(); return found.label;
}
async function input(page, label, value) {
  const selector = '[aria-label="' + label + '"]'; await page.waitForSelector(selector);
  await page.$eval(selector, n => n.scrollIntoView({ block: 'center' })); await page.click(selector);
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace'); await page.keyboard.type(value);
}
function paired(seat) {
  return seat.auth && seat.public && seat.private && seat.public.revision === seat.private.revision
    && seat.private.playerId === seat.auth.playerId && seat.private.roomCode === seat.auth.roomCode && seat.public.roomCode === seat.auth.roomCode;
}
function sameFrame(seats) {
  const first = seats[0].public;
  return first && seats.every(s => paired(s) && s.public.revision === first.revision && s.public.roundNumber === first.roundNumber && s.public.phase === first.phase);
}
function publicPrivacy(state) {
  assert.deepEqual(Object.keys(state).sort(), publicKeys, 'Unexpected public field');
  for (const player of state.players) assert.deepEqual(Object.keys(player).sort(), playerKeys, 'Public player exposes extra data');
  for (const card of state.table) assert.deepEqual(Object.keys(card).sort(), ['cardId', 'slot'], 'Anonymous table exposes card ownership');
  if (!['reveal', 'game_over'].includes(state.phase)) assert.equal(state.result, null, 'Result disclosed before votes complete');
  if (['clue', 'submit'].includes(state.phase)) {
    assert.deepEqual(state.table, [], 'Images disclosed before submissions complete');
    assert(!state.log.some(entry => /dream-\d{2}/.test(entry.text)), 'Public log discloses a hidden card');
  }
}
function artworkInventory(root) {
  const inventory = new Map();
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else {
        const match = entry.name.match(/dixit-dream-(\d{2})[^/]*\.webp$/);
        if (match) inventory.set('dream-' + match[1], { file: path.relative(root, filename), sha256: hash(fs.readFileSync(filename)) });
      }
    }
  };
  visit(path.join(root, 'assets'));
  assert.equal(inventory.size, 84, 'Export must contain all 84 dream images');
  assert.equal(new Set([...inventory.values()].map(value => value.sha256)).size, 84, 'Deck artwork must be distinct');
  for (let i = 1; i <= 84; i++) assert(inventory.has('dream-' + String(i).padStart(2, '0')));
  return Object.fromEntries(inventory);
}

async function visualBatch(browser, origin, output, report) {
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push({ error: sanitise(error.message) }));
  const capture = async name => {
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.waitForFunction(() => [...document.images].every(i => i.complete));
    const metrics = await page.evaluate(() => ({ width: innerWidth, pageWidth: document.documentElement.scrollWidth, broken: [...document.images].filter(i => !i.naturalWidth).map(i => i.src), faces: [...document.querySelectorAll('#kraken-rules [data-testid="card-surface-face"]')].map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }), fonts: [...document.fonts].map(f => ({ family: f.family, status: f.status })) }));
    assert(metrics.pageWidth <= metrics.width + 1, name + ' overflow'); assert.deepEqual(metrics.broken, [], name + ' broken images');
    for (const a of metrics.faces) for (const b of metrics.faces) if (Math.abs(a.y - b.y) < 1) assert(Math.abs(a.height - b.height) <= 1, name + ' unequal same-row faces');
    report.captures.push({ name, ...metrics }); await page.screenshot({ path: path.join(output, name + '.png') });
  };
  for (const width of [320, 1280]) {
    await page.setViewport({ width, height: 900 });
    for (const route of ['dixit-odyssey', 'telestrations', 'cartographers-heroes', 'feed-the-kraken']) {
      await page.goto(origin + '/' + route, { waitUntil: 'networkidle0' });
      await capture(route + '-cover-' + width);
      if (route === 'cartographers-heroes') {
        assert(report.captures.at(-1).fonts.some(f => f.family.includes('Outfit_600SemiBold') && f.status === 'loaded'), 'Cartographers semibold font not loaded');
      }
      if (route !== 'feed-the-kraken') continue;
      await click(page, 'HOW TO PLAY'); await page.waitForSelector('#kraken-rules');
      assert.equal(await page.$$eval('#kraken-rules img', images => images.filter(i => /kraken-course-/.test(i.src)).length), 3);
      await capture('kraken-rules-' + width);
      await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('#kraken-rules *')].filter(n => [...n.childNodes].some(c => c.nodeType === Node.TEXT_NODE && c.textContent.trim()));
        const sizes = nodes.map(n => { const s = getComputedStyle(n); return { n, size: parseFloat(s.fontSize), line: parseFloat(s.lineHeight) }; });
        for (const { n, size, line } of sizes) { n.style.setProperty('font-size', size * 2 + 'px', 'important'); if (Number.isFinite(line)) n.style.setProperty('line-height', line * 2 + 'px', 'important'); }
      });
      await capture('kraken-rules-text200-' + width);
      for (let i = 0; i < 3; i++) {
        await page.$$eval('#kraken-rules [data-testid="card-surface-face"]', (nodes, index) => nodes[index].scrollIntoView({ block: 'center' }), i);
        await capture('kraken-card-' + i + '-text200-' + width);
      }
    }
  }
  assert.deepEqual(report.errors, []); report.checks.push('Final entrance covers, loaded Cartographers semibold, three Kraken course faces and same-row geometry at 320/1280 with simulated 200% browser text'); report.passed = true;
}

async function main() {
  const root = fs.realpathSync(process.argv[2]);
  const browserApi = 'https://localhost:3214', api = 'http://127.0.0.1:3213';
  validateExport(root, { EXPO_PUBLIC_SERVER_URL: browserApi });
  const art = artworkInventory(root);
  const entry = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/src=["']([^"']*\/_expo\/static\/js\/web\/(?:entry|index)-[a-f0-9]+\.js)/)?.[1];
  assert(entry, 'Compiled web entry required');
  const output = path.resolve(process.env.QA_DIXIT_OUTPUT || '.tmp-qa-evidence/dixit-ui-' + Date.now());
  assert(!fs.existsSync(output), 'Evidence directory must be fresh'); fs.mkdirSync(output, { recursive: true });
  const report = { method: 'Automated source-built browser UI, deterministic voting fixtures with post-selection network assertions. No injected state/actions. Not independent manual play or native-device acceptance.', bundleHash: hash(fs.readFileSync(path.join(root, entry))), artwork: art, checks: [], captures: [], rounds: [], errors: [], blocked: [], cleanup: [], passed: false };
  const credentials = prepareCertificate(), proxy = createApiProxy(credentials), sockets = new Set(), seats = [];
  let browser, origin;
  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { response.writeHead(400); response.end(); return; }
    const target = path.resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    const file = [target, target + '.html', path.join(target, 'index.html')].find(value => fs.existsSync(value) && fs.statSync(value).isFile());
    if (!file) { response.writeHead(404); response.end(); return; }
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(fs.readFileSync(file));
  });
  for (const service of [server, proxy]) service.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const cleanErrors = () => { assert.equal(report.errors.length, 0, JSON.stringify(report.errors)); assert.equal(report.blocked.length, 0, 'Nonlocal request attempted'); assert(seats.every(s => s.rejected.length === 0), 'Server rejected a UI command: ' + JSON.stringify(seats.flatMap(s => s.rejected))); };
  const settle = async label => {
    await until(() => sameFrame(seats), label); cleanErrors();
    const known = seats.flatMap(s => [...s.private.hand, ...s.private.submittedCardIds]);
    assert.equal(new Set(known).size, known.length, 'A private card appears in multiple hands/submissions');
    assert(known.every(id => art[id]), 'Unknown image in a private hand');
    assert.equal(known.length + seats[0].public.drawCount + seats[0].public.discardCount, 84, '84-card conservation across authorised views');
    for (const seat of seats) assert.equal(seat.private.hand.length, seat.public.players.find(p => p.playerId === seat.auth.playerId).handCount);
  };
  const capture = async (seat, name, expectedCards = null) => {
    await seat.page.evaluate(async () => { await document.fonts.ready; });
    await seat.page.waitForFunction(() => [...document.images].filter(img => img.getBoundingClientRect().width > 0).every(img => img.complete), { timeout: 15000 });
    const metrics = await seat.page.evaluate(() => {
      const visible = n => n.getBoundingClientRect().width > 0 && !n.closest('[aria-hidden="true"]') && getComputedStyle(n).visibility !== 'hidden';
      const modal = [...document.querySelectorAll('#dixit-image-detail,#dixit-rules')].find(visible);
      const scope = modal || document;
      return { viewport: { width: innerWidth, height: innerHeight }, pageWidth: document.documentElement.scrollWidth,
        images: [...scope.querySelectorAll('img')].filter(visible).map(n => ({ source: n.getAttribute('src'), complete: n.complete, naturalWidth: n.naturalWidth })),
        buttons: [...scope.querySelectorAll('[role="button"],button')].filter(visible).map(n => ({ label: (n.getAttribute('aria-label') || n.textContent).trim(), width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })),
        cards: [...scope.querySelectorAll('[role="button"][aria-label^="Enlarge image"]')].filter(visible).map(n => {
          const face = n.querySelector('[data-testid="card-surface-face"]'), img = face?.querySelector('img');
          const box = face?.getBoundingClientRect(), image = img?.getBoundingClientRect();
          const scale = image && img.naturalWidth ? Math.min(image.width / img.naturalWidth, image.height / img.naturalHeight) : 0;
          return { label: n.getAttribute('aria-label'), faceWidth: box?.width, faceHeight: box?.height, paintedWidth: (img?.naturalWidth || 0) * scale, paintedHeight: (img?.naturalHeight || 0) * scale };
        }) };
    });
    await seat.page.screenshot({ path: path.join(output, name + '.png') }); report.captures.push({ file: name + '.png', metrics });
    assert(metrics.pageWidth <= metrics.viewport.width + 1, name + ': horizontal page overflow');
    assert(metrics.images.every(img => img.complete && img.naturalWidth > 0), name + ': broken artwork');
    const small = metrics.buttons.filter(b => b.width < 47.5 || b.height < 47.5); assert.equal(small.length, 0, name + ': controls below48px ' + JSON.stringify(small));
    if (expectedCards !== null) assert.equal(metrics.cards.length, expectedCards, name + ': incorrect rendered card count');
    if (metrics.cards.length) {
      const first = metrics.cards[0];
      for (const card of metrics.cards) {
        assert(card.paintedWidth > 0 && card.paintedHeight > 0, name + ': artwork fallback ' + card.label);
        assert(Math.abs(card.faceWidth - first.faceWidth) <= 1 && Math.abs(card.faceHeight - first.faceHeight) <= 1, name + ': unequal painted card faces');
        assert(Math.abs(card.paintedWidth - first.paintedWidth) <= 1 && Math.abs(card.paintedHeight - first.paintedHeight) <= 1, name + ': unequal contained artwork');
      }
    }
  };
  const actor = async (name, width) => {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    const seat = { context, page, name, auth: null, public: null, private: null, rejected: [], lastAction: null, left: false }; seats.push(seat);
    await page.setViewport({ width, height: 844, deviceScaleFactor: 1 }); await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const allowed = [origin, browserApi]; await page.setRequestInterception(true);
    page.on('request', request => { const url = new URL(request.url()); if (allowed.includes(url.origin) || ['data:', 'blob:', 'about:'].includes(url.protocol)) request.continue(); else { report.blocked.push(url.origin); request.abort(); } });
    await page.evaluateOnNewDocument(origins => {
      const Native = window.WebSocket;
      window.WebSocket = new Proxy(Native, { construct(target, args) { const url = new URL(args[0], location.href); if (!origins.includes(url.origin.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'))) throw new Error('Nonlocal socket blocked'); return Reflect.construct(target, args); } });
    }, allowed);
    page.on('pageerror', error => report.errors.push({ seat: name, error: sanitise(error.message) }));
    page.on('response', async response => {
      const url = new URL(response.url());
      if (url.origin === browserApi && /\/rooms\/(create|join)$/.test(url.pathname) && response.request().method() === 'POST' && response.ok()) {
        try { const body = await response.json(); seat.auth = { token: body.token, playerId: body.playerId, roomCode: body.roomCode }; }
        catch (error) { report.errors.push({ seat: name, error: sanitise(error.message) }); }
      }
    });
    const cdp = await page.createCDPSession(); await cdp.send('Network.enable'); cdp.on('Network.webSocketCreated', event => { seat.socketId = event.requestId; });
    cdp.on('Network.webSocketFrameReceived', ({ response, requestId }) => {
      if (requestId !== seat.socketId || !response.payloadData.startsWith('42')) return;
      let frame; try { frame = JSON.parse(response.payloadData.slice(2)); } catch { return; }
      try {
        if (frame[0] === 'game_state' && frame[1]?.gameId === 'dixit_odyssey') { seat.public = frame[1]; publicPrivacy(frame[1]); }
        if (frame[0] === 'private_state' && frame[1]?.gameId === 'dixit_odyssey') {
          seat.private = frame[1]; assert.deepEqual(Object.keys(frame[1]).sort(), privateKeys); assert.equal(frame[1].playerId, seat.auth?.playerId); assert.equal(frame[1].roomCode, seat.auth?.roomCode);
        }
        if (frame[0] === 'action_rejected') seat.rejected.push(frame[1]);
      } catch (error) { report.errors.push({ seat: name, error: sanitise(error.message) }); }
    });
    cdp.on('Network.webSocketFrameSent', ({ response }) => {
      if (!response.payloadData.startsWith('42')) return; let frame; try { frame = JSON.parse(response.payloadData.slice(2)); } catch { return; }
      if (frame[0] === 'dixit:action') seat.lastAction = copy(frame[1].action);
    });
    return seat;
  };
  const chooseFirst = async seat => {
    const label = await click(seat.page, /^CHOOSE \d{2}$/), cardId = 'dream-' + label.slice(7);
    assert(seat.private.hand.includes(cardId), 'Visible card is not in viewer hand'); assert(art[cardId]); return cardId;
  };
  const command = async (seat, label, expected) => {
    const revision = seat.public.revision; seat.lastAction = null; await click(seat.page, label);
    await until(() => seat.lastAction && paired(seat) && seat.public.revision > revision, 'confirmed ' + expected.type);
    assert.deepEqual(seat.lastAction, expected, 'Visible controls emitted different command'); cleanErrors();
  };
  const inspect = async (seat, cardId, name) => {
    await click(seat.page, new RegExp('^Enlarge image ' + cardId.slice(6) + '\\.'));
    await seat.page.waitForSelector('#dixit-image-detail'); await capture(seat, name);
    const image = await seat.page.$eval('#dixit-image-detail img', img => ({ source: img.src, complete: img.complete, width: img.naturalWidth }));
    assert(image.complete && image.width > 0 && image.source.includes('dixit-dream-' + cardId.slice(6)), 'Enlargement shows wrong art');
    await click(seat.page, 'CLOSE IMAGE');
  };
  const reload = async (seat, name) => {
    const before = copy(seat.private), publicBefore = copy(seat.public); seat.public = null; seat.private = null;
    await seat.page.reload({ waitUntil: 'networkidle0' }); await until(() => paired(seat), 'reload private hand');
    assert.deepEqual(seat.private, before, 'Reload changed committed private state'); assert.deepEqual(seat.public, publicBefore, 'Reload changed table state');
    await capture(seat, name);
  };
  try {
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(3214, '127.0.0.1', resolve); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); origin = 'http://127.0.0.1:' + server.address().port;
    browser = await puppeteer.launch({ executablePath: process.env.QA_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run', '--ignore-certificate-errors-spki-list=' + credentials.spki] });
    if (process.argv.includes('--visual-only')) { await visualBatch(browser, origin, output, report); return; }
    const host = await actor('Dixit UI 1', 320); await host.page.goto(origin + '/dixit-odyssey', { waitUntil: 'networkidle0' });
    await input(host.page, 'Your name', host.name); await click(host.page, 'CREATE ROOM'); await until(() => host.auth && host.page.url().endsWith('/lobby'), 'host lobby');
    await capture(host, 'host-lobby-320');
    for (let i = 2; i <= 3; i++) {
      const seat = await actor('Dixit UI ' + i, i === 3 ? 1280 : 390); await seat.page.goto(origin + '/dixit-odyssey/join', { waitUntil: 'networkidle0' });
      await input(seat.page, 'Your name', seat.name); await input(seat.page, 'Room code', host.auth.roomCode); await click(seat.page, 'JOIN GAME');
      await until(() => seat.auth && seat.page.url().endsWith('/lobby'), 'joined lobby');
    }
    await click(host.page, 'START GAME'); await until(() => sameFrame(seats) && host.public.phase === 'clue', 'initial private hands'); cleanErrors();
    assert.equal(host.public.storytellerId, null); assert.equal(host.public.drawCount + seats.reduce((sum, seat) => sum + seat.private.hand.length, 0), 84);
    assert(seats.every(seat => seat.private.hand.length === 7));
    report.checks.push('Three isolated seats created/joined through UI; 84-card deck, seven-card hands and first-inspired storyteller opportunity');
    for (const width of [320, 375, 414, 768, 1280]) {
      await host.page.setViewport({ width, height: 844, deviceScaleFactor: 1 }); await host.page.evaluate(() => { for (const n of document.querySelectorAll('*')) if (n.scrollTop) n.scrollTop = 0; });
      await capture(host, 'hand-' + width, 7);
    }
    await host.page.setViewport({ width: 320, height: 844, deviceScaleFactor: 1 });
    await inspect(host, host.private.hand[0], 'enlarged-image-320'); await reload(host, 'hand-restored-320');
    const totals = Object.fromEntries(seats.map(s => [s.auth.playerId, 0])); let previousStoryteller = null, round = 0;
    while (host.public.status !== 'game_over' && round++ < 20) {
      await settle('round starts'); const game = host.public; assert.equal(game.phase, 'clue'); assert.equal(game.roundNumber, round);
      const teller = game.storytellerId ? seats.find(s => s.auth.playerId === game.storytellerId) : host; assert(teller);
      if (previousStoryteller !== null) { const order = game.players.map(p => p.playerId); assert.equal(teller.auth.playerId, order[(order.indexOf(previousStoryteller) + 1) % order.length]); }
      const submissions = {}, votes = {}, clues = ['A door to elsewhere', 'The quiet journey', 'Before the rain'];
      const tellerCard = await chooseFirst(teller); submissions[teller.auth.playerId] = [tellerCard];
      await input(teller.page, 'Your story clue', clues[(round - 1) % clues.length]);
      await command(teller, 'SHARE CLUE AND IMAGE', { type: 'clue', cardId: tellerCard, clue: clues[(round - 1) % clues.length] }); await settle('clue shared');
      assert.equal(host.public.phase, 'submit'); assert.equal(host.public.storytellerId, teller.auth.playerId);
      for (const seat of seats) if (seat !== teller) {
        assert.equal(seat.private.submissionCount, 2); assert.deepEqual(seat.private.submittedCardIds, []);
        const cards = [await chooseFirst(seat), await chooseFirst(seat)]; assert.notEqual(cards[0], cards[1]); submissions[seat.auth.playerId] = cards;
        await command(seat, 'LOCK IN BOTH IMAGES', { type: 'submit', cardIds: cards }); await settle('decoys submitted');
        assert.deepEqual(seat.private.submittedCardIds, cards);
        if (round === 1 && host.public.phase === 'submit') await reload(seat, 'committed-decoys-restored');
      }
      assert.equal(host.public.phase, 'vote'); assert.equal(host.public.table.length, 5);
      assert.deepEqual(host.public.table.map(c => c.cardId).sort(), Object.values(submissions).flat().sort());
      const slotFor = card => host.public.table.find(item => item.cardId === card).slot;
      const correct = slotFor(tellerCard), voters = seats.filter(s => s !== teller);
      for (const seat of seats) assert.deepEqual(seat.private.submittedCardIds, submissions[seat.auth.playerId]);
      const outcome = round === 2 ? 'none' : round === 3 ? 'all' : 'some';
      for (const [index, voter] of voters.entries()) {
        const ownSlots = submissions[voter.auth.playerId].map(slotFor);
        for (const slot of ownSlots) for (const dial of [1, 2]) {
          const own = await button(voter.page, `Place vote ${dial} on image ${slot}, your own image cannot be chosen`, false); assert(own?.disabled, 'Own image voting is enabled'); await own.element.dispose();
        }
        const other = voters[1 - index], decoy = slotFor(submissions[other.auth.playerId][0]);
        const slots = outcome === 'all' ? [correct, correct] : outcome === 'none' ? [decoy, decoy] : index === 0 ? [correct, correct] : [correct, decoy];
        for (const [dial, slot] of slots.entries()) await click(voter.page, `Place vote ${dial + 1} on image ${slot}`);
        if (round === 1 && index === 0) await capture(voter, 'dual-vote-selection-mobile', 5);
        votes[voter.auth.playerId] = slots; await command(voter, 'LOCK IN BOTH VOTES', { type: 'vote', slots }); await settle('votes committed');
        if (round === 1 && index === 0) { assert.deepEqual(voter.private.votes, slots); await reload(voter, 'sealed-votes-restored'); assert.equal(voters[1].private.votes, null); assert.equal(host.public.result, null); }
      }
      const result = host.public.result; assert(result); assert.equal(result.outcome, outcome); assert.equal(result.storytellerCardId, tellerCard);
      assert.deepEqual(Object.fromEntries(result.submissions.map(s => [s.playerId, s.cardIds])), submissions); assert.deepEqual(Object.fromEntries(result.votes.map(v => [v.playerId, v.slots])), votes);
      const expectedScores = seats.map(seat => {
        const playerId = seat.auth.playerId, ownSlots = submissions[playerId].map(slotFor), correctVotes = (votes[playerId] || []).filter(slot => slot === correct).length;
        const cluePoints = seat === teller && outcome === 'some' ? 3 : 0;
        const guessPoints = seat === teller ? 0 : outcome === 'all' ? 4 : outcome === 'none' ? 2 : correctVotes * 3;
        const decoyPoints = seat === teller ? 0 : Object.values(votes).flat().filter(slot => ownSlots.includes(slot)).length;
        const total = cluePoints + guessPoints + decoyPoints; totals[playerId] += total;
        return { playerId, correctVotes, cluePoints, guessPoints, decoyPoints, total };
      });
      assert.deepEqual([...result.scores].sort((a,b) => a.playerId.localeCompare(b.playerId)), expectedScores.sort((a,b) => a.playerId.localeCompare(b.playerId)));
      for (const seat of seats) for (const player of seat.public.players) assert.equal(player.score, totals[player.playerId]);
      report.rounds.push({ round, storytellerId: teller.auth.playerId, outcome, scores: expectedScores });
      if (round <= 3) await capture(host, 'round-' + round + '-scoring-320', 5);
      previousStoryteller = teller.auth.playerId;
      if (Math.max(...Object.values(totals)) >= 30) assert.equal(host.public.status, 'game_over', '30-point ending not applied');
      else {
        assert.equal(host.public.phase, 'reveal');
        for (const seat of seats) { await command(seat, 'READY FOR THE NEXT STORY', { type: 'ready' }); await settle('ready barrier'); }
      }
    }
    assert.equal(host.public.status, 'game_over'); await settle('final scores'); assert.equal(host.public.terminationReason, null);
    const highest = Math.max(...Object.values(totals)); assert(highest >= 30);
    const winners = Object.keys(totals).filter(id => totals[id] === highest).sort();
    for (const seat of seats) assert.deepEqual([...seat.public.winnerIds].sort(), winners);
    await capture(host, 'results-mobile-320', 5); await capture(seats[2], 'results-desktop-1280', 5);
    report.checks.push('Complete UI match through mixed/all/none voting, double and split dials, three-player double decoys, clockwise storyteller rotation and independently calculated scores to30+');
    await click(host.page, 'PLAY AGAIN'); await until(() => sameFrame(seats) && host.public.phase === 'clue' && host.public.roundNumber === 1, 'rematch');
    assert(seats.every(s => s.private.hand.length === 7 && s.private.votes === null && s.private.submittedCardIds.length === 0)); assert(host.public.players.every(p => p.score === 0));
    await click(seats[2].page, 'Leave the Dixit table'); await click(seats[2].page, 'LEAVE');
    await until(() => new URL(seats[2].page.url()).pathname === '/', 'departed seat returns to arcade'); seats[2].left = true;
    await until(() => sameFrame(seats.slice(0, 2)) && host.public.status === 'game_over', 'below-three forfeit ending');
    assert.equal(host.public.terminationReason, 'not_enough_players'); assert.deepEqual(host.public.winnerIds, []);
    await capture(host, 'forfeit-ending-320'); report.checks.push('Exact hand/committed-decoy/sealed-vote reload, rematch reset, explicit leave and no-winner ending belowthree');
    cleanErrors(); report.passed = true;
  } catch (error) {
    report.error = sanitise(error.message);
    for (const [index, seat] of seats.entries()) {
      await seat.page.screenshot({ path: path.join(output, 'failure-' + index + '.png') }).catch(() => {});
      report.errors.push({ seat: seat.name, phase: seat.public?.phase, round: seat.public?.roundNumber, text: await seat.page.evaluate(() => document.body.innerText).catch(() => '') });
    }
  } finally {
    for (const seat of seats) if (seat.auth) {
      try {
        const response = await fetch(api + '/rooms/' + seat.auth.roomCode + '/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + seat.auth.token } });
        report.cleanup.push({ seat: seat.name, status: response.status }); assert(response.ok || seat.left && [403, 404].includes(response.status), 'Cleanup HTTP ' + response.status);
      } catch (error) { report.cleanup.push({ seat: seat.name, error: sanitise(error.message) }); report.passed = false; }
    }
    if (browser) await browser.close().catch(error => { report.errors.push({ error: sanitise(error.message) }); report.passed = false; });
    for (const socket of sockets) socket.destroy(); if (server.listening) await new Promise(resolve => server.close(resolve)); if (proxy.listening) await new Promise(resolve => proxy.close(resolve));
    fs.writeFileSync(path.join(output, 'report.json'), sanitise(JSON.stringify(report, null, 2)));
  }
  console.log(JSON.stringify({ passed: report.passed, rounds: report.rounds.length, checks: report.checks, error: report.error, output }, null, 2)); if (!report.passed) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(sanitise(error.message)); process.exitCode = 1; });
