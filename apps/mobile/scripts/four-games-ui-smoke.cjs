const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const puppeteer = require('puppeteer-core');
const { prepareCertificate, createApiProxy } = require('./local-qa-proxy.cjs');
const { validateExport } = require('./validate-export-env.cjs');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sanitise = value => String(value).replace(/Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]');
async function until(check, label, timeout = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await check()) return; await pause(80); }
  throw new Error('Timed out: ' + label);
}
async function control(page, label) {
  for (const el of await page.$$('[role="button"],button')) {
    const matches = await el.evaluate((node, value) => {
      const r = node.getBoundingClientRect();
      const modal = [...document.querySelectorAll('[aria-modal="true"]')].filter(d => d.getBoundingClientRect().width > 0).at(-1);
      return (!modal || modal.contains(node)) && (node.getAttribute('aria-label') ?? node.textContent).trim() === value
        && r.width > 0 && r.height > 0 && !node.closest('[aria-hidden="true"]') && node.getAttribute('aria-disabled') !== 'true' && !node.hasAttribute('disabled');
    }, label);
    if (matches) return el;
    await el.dispose();
  }
  return null;
}
async function click(page, label) {
  await until(async () => { const el = await control(page, label); await el?.dispose(); return !!el; }, label);
  const el = await control(page, label);
  await el.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await el.click(); await el.dispose(); await pause(100);
}
async function input(page, label, value) {
  const selector = '[aria-label="' + label + '"]';
  await page.waitForSelector(selector);
  await page.$eval(selector, node => node.scrollIntoView({ block: 'center' }));
  await page.click(selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace'); await page.keyboard.type(value);
}
function paired(seat) { return seat.public && seat.private && seat.public.revision === seat.private.revision && seat.private.playerId === seat.auth?.playerId
  && seat.private.roomCode === seat.auth.roomCode && seat.public.roomCode === seat.auth.roomCode; }
function sameFrame(seats) {
  const first = seats[0].public;
  return first && seats.every(s => paired(s) && ['revision', 'phase', 'step', 'completedRounds', 'revealBook', 'revealPage'].every(key => s.public[key] === first[key]));
}
const copy = value => JSON.parse(JSON.stringify(value));
const publicKeys = 'gameId roomCode revision phase players seats scoringMode category direction completedRounds step readyIds revealBook revealPage revealOwnerId revealed scoringPages pendingScores winnerIds endReason cancelledRounds'.split(' ').sort();
const privateKeys = 'gameId roomCode playerId revision windowId seatToken choices draft predecessor'.split(' ').sort();
const words = ['Sun', 'Star', 'Moon', 'Cloud'];
function publicPrivacy(state) {
  assert.deepEqual(Object.keys(state).sort(), publicKeys, 'Unexpected public projection field');
  if (['prompt', 'draw', 'guess'].includes(state.phase)) {
    assert.equal(state.revealed, null); assert.deepEqual(state.scoringPages, []);
    for (const word of words) assert(!JSON.stringify(state).includes('"' + word + '"'), 'Secret word in public projection');
  }
}
async function renderedStrokes(page) {
  return page.$$eval('[data-testid="telestrations-drawing-input"] svg path', paths => paths.map(p => ({ d: p.getAttribute('d'), stroke: p.getAttribute('stroke'), width: p.getAttribute('stroke-width') })));
}

async function main() {
  const root = fs.realpathSync(process.argv[2]);
  const api = new URL('http://127.0.0.1:3213');
  const browserApi = 'https://localhost:3214';
  validateExport(root, { EXPO_PUBLIC_SERVER_URL: browserApi });
  const credentials = prepareCertificate(), proxy = createApiProxy(credentials);
  const output = path.resolve(process.env.QA_FOUR_GAMES_OUTPUT || '.tmp-qa-evidence/four-games-' + Date.now());
  assert(!fs.existsSync(output), 'Choose a fresh evidence directory');
  fs.mkdirSync(output, { recursive: true });
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const entry = html.match(/src=["']([^"']*\/_expo\/static\/js\/web\/(?:entry|index)-[a-f0-9]+\.js)/)?.[1];
  assert(entry, 'Compiled web export required');
  const bundleHash = hash(fs.readFileSync(path.join(root, entry)));
  const report = { method: 'Automated compiled-web UI play with deterministic fixture guesses and scoring choices. Socket projections observed for assertions, never injected. Not native-device or independent manual play.', bundleHash, checks: [], captures: [], errors: [], blocked: [], cleanup: [], counters: { submissions: 0, revealedPages: 0, scoredBooks: 0, handoffs: 0 }, passed: false };
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const candidate = path.resolve(root, '.' + pathname);
    if (candidate !== root && !candidate.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const file = [candidate, candidate + '.html', path.join(candidate, 'index.html')].find(value => fs.existsSync(value) && fs.statSync(value).isFile()) || path.join(root, '+not-found.html');
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  let origin; const allowed = [browserApi], seats = [], sockets = new Set();
  for (const service of [server, proxy]) service.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  let browser;
  const capture = async (seat, name) => {
    await seat.page.evaluate(async () => { await document.fonts.ready; });
    await seat.page.waitForFunction(() => [...document.images].filter(n => n.getBoundingClientRect().width > 0).every(n => n.complete), { timeout: 15000 });
    const file = name + '.png';
    await seat.page.screenshot({ path: path.join(output, file) });
    const metrics = await seat.page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
      images: [...document.images].filter(n => n.getBoundingClientRect().width > 0).map(n => ({ source: n.getAttribute('src'), complete: n.complete, width: n.naturalWidth })),
      buttons: [...document.querySelectorAll('[role="button"],button')].filter(n => n.getBoundingClientRect().width > 0 && !n.closest('[aria-hidden="true"]') && getComputedStyle(n).visibility !== 'hidden').map(n => ({ label: (n.getAttribute('aria-label') || n.textContent).trim().slice(0, 70), width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })) }));
    report.captures.push({ file, metrics });
    assert(metrics.documentWidth <= metrics.width + 1, name + ' horizontal page overflow');
    assert(metrics.images.every(n => n.complete && n.width > 0), name + ' broken image: ' + JSON.stringify(metrics.images.filter(n => !n.complete || !n.width)));
    const undersized = metrics.buttons.filter(n => n.width < 47.5 || n.height < 47.5);
    assert.equal(undersized.length, 0, name + ' controls below 48px: ' + JSON.stringify(undersized));
  };
  const actor = async (name, width = 390) => {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    const seat = { context, page, name, public: null, private: null, auth: null, rejected: [], sent: 0, lastSubmission: null, left: false };
    seats.push(seat);
    await page.setViewport({ width, height: 844, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (allowed.includes(url.origin) || ['data:', 'blob:', 'about:'].includes(url.protocol)) request.continue();
      else { report.blocked.push(url.origin); request.abort(); }
    });
    await page.evaluateOnNewDocument(origins => {
      const Native = window.WebSocket;
      window.WebSocket = new Proxy(Native, { construct(target, args) {
        const url = new URL(args[0], location.href);
        if (!origins.includes(url.origin.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'))) throw new Error('Nonlocal socket blocked');
        return Reflect.construct(target, args);
      } });
    }, allowed);
    page.on('pageerror', error => report.errors.push({ seat: name, error: sanitise(error.message) }));
    page.on('response', async response => {
      const url = new URL(response.url());
      if (url.origin === browserApi && /\/rooms\/(create|join)$/.test(url.pathname) && response.request().method() === 'POST' && response.ok()) {
        try {
          const body = await response.json(); seat.auth = { token: body.token, playerId: body.playerId, roomCode: body.roomCode };
        } catch (error) { report.errors.push({ seat: name, error: 'Could not observe create/join response: ' + sanitise(error.message) }); }
      }
    });
    const cdp = await page.createCDPSession(); await cdp.send('Network.enable');
    cdp.on('Network.webSocketCreated', data => { seat.socketId = data.requestId; });
    cdp.on('Network.webSocketFrameReceived', ({ response, requestId }) => {
      if (requestId !== seat.socketId || !response.payloadData.startsWith('42')) return;
      let frame; try { frame = JSON.parse(response.payloadData.slice(2)); } catch { return; }
      if (frame[0] === 'game_state' && frame[1]?.gameId === 'telestrations') {
        seat.public = frame[1];
        try { publicPrivacy(frame[1]); } catch (error) { report.errors.push({ seat: name, error: sanitise(error.message) }); }
      }
      if (frame[0] === 'private_state' && frame[1]?.gameId === 'telestrations') {
        seat.private = frame[1];
        try {
          assert.deepEqual(Object.keys(frame[1]).sort(), privateKeys, 'Unexpected private projection field');
          assert.equal(frame[1].playerId, seat.auth?.playerId, 'Private projection delivered to wrong seat');
          assert.equal(frame[1].roomCode, seat.auth?.roomCode, 'Private projection delivered to wrong room');
        } catch (error) { report.errors.push({ seat: name, error: sanitise(error.message) }); }
      }
      if (frame[0] === 'action_rejected') seat.rejected.push(frame[1]);
    });
    cdp.on('Network.webSocketFrameSent', ({ response }) => {
      if (!response.payloadData.startsWith('42')) return;
      let frame; try { frame = JSON.parse(response.payloadData.slice(2)); } catch { return; }
      if (frame[0]?.startsWith('telestrations:')) seat.sent++;
      if (frame[0] === 'telestrations:submit') seat.lastSubmission = copy(frame[1]);
    });
    return seat;
  };
  try {
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(3214, '127.0.0.1', resolve); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = 'http://127.0.0.1:' + server.address().port; allowed.push(origin);
    browser = await puppeteer.launch({ executablePath: process.env.QA_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
      args: ['--no-first-run', '--ignore-certificate-errors-spki-list=' + credentials.spki] });
    const host = await actor('Astra UI 1');
    const offersOnly = process.argv.includes('--offers-only');
    const routes = offersOnly ? [] : ['feed-the-kraken', 'telestrations', 'cartographers-heroes', 'dixit-odyssey'];
    for (const route of routes) {
      await host.page.goto(origin + '/' + route, { waitUntil: 'networkidle0' });
      await host.page.waitForSelector('input[aria-label="Your name"]');
      for (const width of [320, 375, 414, 768, 1280]) {
        await host.page.setViewport({ width, height: 844, deviceScaleFactor: 1 });
        await host.page.evaluate(() => { for (const node of document.querySelectorAll('*')) if (node.scrollTop) node.scrollTop = 0; });
        await capture(host, route + '-entrance-' + width);
        await click(host.page, 'HOW TO PLAY');
        if (route === 'telestrations') {
          const reference = await host.page.evaluate(() => document.body.innerText);
          assert(reference.includes('shuffled pool, exhausted before reuse'), 'Updated prompt-pool reference missing');
          assert(!/deterministic rotation|rotation and reuse/.test(reference), 'Old prompt adaptation remains rendered');
        }
        await capture(host, route + '-rules-' + width); await click(host.page, route === 'dixit-odyssey' ? 'CLOSE RULES' : 'Close rules');
      }
    }
    if (!offersOnly) report.checks.push('Four real entrance routes and mechanics-specific rulebooks at five viewport widths, including shuffled prompt-pool reference');
    await host.page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await host.page.goto(origin + '/telestrations', { waitUntil: 'networkidle0' });
    await input(host.page, 'Your name', host.name);
    if (!offersOnly) { await click(host.page, 'Invent within a category'); await click(host.page, 'Weather and space'); }
    await click(host.page, 'CREATE ROOM');
    await until(() => host.auth && host.page.url().endsWith('/lobby'), 'created lobby');
    await capture(host, 'telestrations-host-lobby');
    for (let i = 2; i <= 4; i++) {
      const seat = await actor('Astra UI ' + i, i === 4 ? 1280 : 390);
      await seat.page.goto(origin + '/telestrations/join', { waitUntil: 'networkidle0' });
      await input(seat.page, 'Your name', seat.name); await input(seat.page, 'Room code', host.auth.roomCode);
      await click(seat.page, 'JOIN GAME');
      await until(() => seat.auth && seat.page.url().endsWith('/lobby'), 'joined lobby');
    }
    await click(host.page, 'START GAME');
    await until(() => seats.every(s => paired(s) && s.public.phase === 'prompt'), 'private prompt pairs');
    report.checks.push('Four isolated players create/join through forms, lobby start and private paired prompt state');
    if (offersOnly) {
      assert.equal(host.public.category, null);
      const offers = seats.flatMap(seat => seat.private.choices);
      assert.equal(offers.length, 12); assert.equal(new Set(offers).size, 12);
      const selected = new Map();
      for (const seat of seats) {
        assert.equal(seat.private.choices.length, 3);
        const labels = await seat.page.$$eval('[role="button"],button', nodes => nodes.map(n => (n.getAttribute('aria-label') || n.textContent).trim()));
        assert.deepEqual(labels.filter(label => offers.includes(label)).sort(), [...seat.private.choices].sort(), 'Rendered menu must contain only own offers');
        const choice = seat.private.choices[1]; selected.set(seat.auth.playerId, choice);
        await capture(seat, 'offered-prompts-' + seat.name.replaceAll(' ', '-'));
        await click(seat.page, choice);
        await until(() => paired(seat) && seat.private.draft?.content === choice, 'saved selected offer');
        await click(seat.page, 'Lock in secret');
        await until(() => seat.lastSubmission?.content === choice && paired(seat) && (seat.private.draft?.submitted || seat.public.phase === 'draw'), 'submitted selected offer');
      }
      await until(() => sameFrame(seats) && host.public.phase === 'draw', 'offered prompt drawing handoff');
      for (const seat of seats) {
        assert.deepEqual(seat.private.predecessor, { kind: 'prompt', content: selected.get(seat.auth.playerId) });
        assert.deepEqual(seat.private.choices, []);
        assert((await seat.page.evaluate(() => document.body.innerText)).includes(selected.get(seat.auth.playerId)));
      }
      const before = copy(host.private); host.private = null; host.public = null;
      await host.page.reload({ waitUntil: 'networkidle0' }); await until(() => paired(host), 'fresh offered handoff after reload');
      assert.deepEqual(host.private, before); await capture(host, 'offered-handoff-restored');
      for (const seat of [...seats].reverse()) {
        await click(seat.page, 'Leave the sketchbooks'); await click(seat.page, 'LEAVE');
        await until(() => new URL(seat.page.url()).pathname === '/', 'normal offered-mode leave'); seat.left = true;
      }
      assert(seats.every(seat => seat.rejected.length === 0)); assert.equal(report.errors.length, 0); assert.equal(report.blocked.length, 0);
      report.checks.push('Separate offered-prompt integration smoke:12distinct private offers, own-menu rendering, visible choice/submission, authorised even-seat draw handoff, exact reload and all-seat normal UI leave. Not a full offered-mode game.');
      report.passed = true; return;
    }
    assert.equal(host.public.direction, 1); assert.equal(host.public.scoringMode, 'friendly');
    const orderedSeats = host.public.seats.map(id => seats.find(s => s.auth.playerId === id));
    assert.equal(orderedSeats.length, 4); assert(orderedSeats.every(Boolean));
    const scores = Object.fromEntries(host.public.seats.map(id => [id, 0]));
    const rounds = [];
    let steps = 0, reloaded = false, bookOwners = [];
    const verifyPrivacy = () => {
      for (const seat of seats) {
        publicPrivacy(seat.public);
        assert.deepEqual(Object.keys(seat.private).sort(), privateKeys, 'Unexpected private projection field');
        if (seat.public.phase !== 'prompt') assert.deepEqual(seat.private.choices, [], 'Old prompt offers survived the handoff');
        else assert(seat.private.choices.length <= 3 && seat.private.choices.every(choice => typeof choice === 'string'), 'Invalid own prompt offers');
      }
    };
    while (host.public.phase !== 'game_over' && steps++ < 400) {
      await until(() => sameFrame(seats), 'same paired gameplay frame'); verifyPrivacy();
      const game = host.public, phase = game.phase, round = game.completedRounds;
      const revision = game.revision;
      if (['prompt', 'draw', 'guess'].includes(phase)) {
        if (phase === 'prompt') {
          assert(!rounds[round], 'Repeated prompt window');
          rounds[round] = orderedSeats.map((s, i) => ({ ownerId: s.auth.playerId, prompt: words[(i + round) % words.length], pages: [] }));
          bookOwners = orderedSeats.map((_, i) => i);
        }
        for (const [seatIndex, seat] of orderedSeats.entries()) {
          const book = rounds[round][bookOwners[seatIndex]], windowId = seat.private.windowId;
          const word = book.prompt;
          const predecessor = phase === 'prompt' ? null : game.step === 0 ? { kind: 'prompt', content: book.prompt } : book.pages.at(-1);
          assert.deepEqual(seat.private.predecessor, predecessor, 'Wrong private predecessor for ' + seat.name);
          assert.equal(seat.private.draft.submitted, false);
          assert.equal(seat.private.draft.content, null, 'New page retained an earlier draft');
          let content;
          if (phase === 'prompt' || phase === 'guess') { content = word; await input(seat.page, phase === 'prompt' ? 'Your secret prompt' : 'Your guess', word); }
          else {
            const paper = await seat.page.waitForSelector('[data-testid="telestrations-drawing-input"]');
            await paper.evaluate(n => n.scrollIntoView({ block: 'center' })); const box = await paper.boundingBox();
            const points = word === 'Star' ? [[.5,.15],[.6,.4],[.85,.4],[.65,.57],[.73,.85],[.5,.68],[.27,.85],[.35,.57],[.15,.4],[.4,.4],[.5,.15]]
              : word === 'Cloud' ? [[.15,.6],[.15,.4],[.3,.3],[.4,.4],[.5,.2],[.65,.2],[.75,.4],[.85,.4],[.9,.6],[.15,.6]]
              : word === 'Moon' ? [[.6,.15],[.4,.2],[.25,.4],[.25,.6],[.4,.8],[.6,.85],[.45,.65],[.4,.5],[.45,.35],[.6,.15]]
              : Array.from({ length: 25 }, (_, i) => [.5 + Math.cos(i * Math.PI / 12) * .25, .5 + Math.sin(i * Math.PI / 12) * .25]);
            await seat.page.mouse.move(box.x + points[0][0] * box.width, box.y + points[0][1] * box.height); await seat.page.mouse.down();
            for (const [x, y] of points.slice(1)) await seat.page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 2 });
            await seat.page.mouse.up();
            await until(() => paired(seat) && seat.private.draft?.content?.strokes?.length > 0, 'saved drawing for ' + seat.name);
            content = copy(seat.private.draft.content);
            if (!reloaded && seat === host) {
              const paths = await renderedStrokes(host.page); assert(paths.length > 0, 'Saved drawing has no rendered paths');
              const revision = host.private.draft.revision; host.public = null; host.private = null;
              await host.page.reload({ waitUntil: 'networkidle0' });
              await until(() => paired(host) && host.private.draft?.revision === revision, 'drawing restored after reload');
              assert.equal(host.private.windowId, windowId); assert.deepEqual(host.private.draft.content, content, 'Reload changed saved strokes');
              await until(async () => (await renderedStrokes(host.page)).length === paths.length, 'restored rendered SVG');
              assert.deepEqual(await renderedStrokes(host.page), paths, 'Reload changed rendered drawing');
              await capture(host, 'telestrations-restored-drawing'); reloaded = true;
            }
          }
          seat.lastSubmission = null;
          await click(seat.page, phase === 'prompt' ? 'Lock in secret' : phase === 'draw' ? 'Lock in drawing' : 'Lock in guess');
          await until(() => seat.lastSubmission && paired(seat) && (seat.private.windowId !== windowId || seat.private.draft?.submitted), 'confirmed page for ' + seat.name);
          assert.deepEqual(seat.lastSubmission.content, content, 'Submitted content differs from authored page');
          if (phase !== 'prompt') book.pages.push({ kind: phase, authorId: seat.auth.playerId, content });
          report.counters.submissions++;
        }
        if (phase !== 'prompt' && game.step < 3) { bookOwners = [bookOwners.at(-1), ...bookOwners.slice(0, -1)]; report.counters.handoffs += 4; }
      } else if (phase === 'reveal') {
        const book = rounds[round][game.revealBook]; assert.equal(game.revealOwnerId, book.ownerId);
        assert.deepEqual(game.revealed, game.revealPage === -1 ? { kind: 'prompt', content: book.prompt } : book.pages[game.revealPage]);
        const owner = seats.find(s => s.auth.playerId === game.revealOwnerId); await click(owner.page, 'Reveal the next page');
        report.counters.revealedPages++;
      } else if (phase === 'scoring') {
        const book = rounds[round][game.revealBook];
        assert.deepEqual(game.scoringPages, book.pages.map((p, index) => ({ index, kind: p.kind, authorId: p.authorId })));
        assert.deepEqual(game.revealed, book.pages.at(-1)); assert.equal(game.revealOwnerId, book.ownerId);
        const owner = seats.find(s => s.auth.playerId === game.revealOwnerId), name = id => game.players.find(p => p.id === id).displayName;
        const drawing = game.scoringPages.find(p => p.kind === 'draw'), guess = game.scoringPages.find(p => p.kind === 'guess');
        await click(owner.page, 'Page ' + (drawing.index + 1) + ': ' + name(drawing.authorId));
        await click(owner.page, 'Page ' + (guess.index + 1) + ': ' + name(guess.authorId));
        await click(owner.page, 'Yes, a match'); await click(owner.page, 'Confirm these points');
        for (const id of [drawing.authorId, guess.authorId, book.ownerId]) scores[id]++;
        report.counters.scoredBooks++;
      } else if (phase === 'round_end') {
        await capture(host, 'telestrations-round-' + game.completedRounds);
        const opener = seats.find(s => s.auth.playerId === game.seats[0]); await click(opener.page, 'Open the next round');
      } else throw new Error('Unexpected phase ' + phase);
      await until(() => sameFrame(seats) && host.public.revision > revision, 'settled next gameplay frame');
    }
    assert.equal(host.public.phase, 'game_over'); assert.equal(host.public.completedRounds, 3); assert(reloaded);
    await until(() => sameFrame(seats) && seats.every(s => s.public.phase === 'game_over'), 'all-seat final results');
    assert.deepEqual(report.counters, { submissions: 60, revealedPages: 48, scoredBooks: 12, handoffs: 36 });
    for (const seat of seats) {
      assert.equal(seat.public.endReason, 'completed');
      for (const player of seat.public.players) { assert.equal(player.score, scores[player.id]); assert.equal(player.score, 9); }
      assert.deepEqual([...seat.public.winnerIds].sort(), [...host.public.seats].sort());
    }
    await capture(host, 'telestrations-results-mobile'); await capture(seats[3], 'telestrations-results-desktop');
    assert(seats.every(s => s.rejected.length === 0), 'UI command rejected');
    report.checks.push('Three-round automated friendly-scoring game: 60 submitted pages, 48 revealed pages, 12 scored books, unique-secret handoffs and exact draft/SVG recovery; each seat scores9 and shares victory');
    await click(host.page, 'Play again');
    await until(() => seats.every(s => paired(s) && s.public.phase === 'prompt' && s.public.completedRounds === 0), 'rematch');
    await click(seats[3].page, 'Leave the sketchbooks'); await click(seats[3].page, 'LEAVE');
    await until(() => sameFrame(seats.slice(0, 3)) && seats.slice(0, 3).every(s => s.public.phase === 'game_over'), 'below-four forfeit ending');
    await until(() => new URL(seats[3].page.url()).pathname === '/', 'departing seat returns to arcade'); seats[3].left = true;
    for (const seat of seats.slice(0, 3)) { assert.equal(seat.public.winnerIds.length, 0); assert.equal(seat.public.endReason, 'insufficient_players'); }
    assert(seats.every(s => s.rejected.length === 0), 'UI command rejected during match, rematch or leave');
    report.checks.push('Rematch starts from fresh prompts; explicit forfeit below four ends without winners');
    assert.equal(report.errors.length, 0, 'Browser exception'); assert.equal(report.blocked.length, 0, 'Nonlocal request');
    report.passed = true;
  } catch (error) {
    report.error = sanitise(error.message);
    for (let i = 0; i < seats.length; i++) {
      await seats[i].page.screenshot({ path: path.join(output, 'failure-' + i + '.png') }).catch(() => {});
      report.errors.push({ seat: seats[i].name, phase: seats[i].public?.phase, text: await seats[i].page.evaluate(() => document.body.innerText).catch(() => '') });
    }
    process.exitCode = 1;
  } finally {
    for (const seat of seats) if (seat.auth) {
      try {
        const response = await fetch(new URL('/rooms/' + seat.auth.roomCode + '/leave', api), { method: 'POST', headers: { Authorization: 'Bearer ' + seat.auth.token } });
        report.cleanup.push({ seat: seat.name, status: response.status });
        assert(response.ok || seat.left && [403, 404].includes(response.status), 'Unexpected cleanup HTTP ' + response.status);
      } catch (error) { report.cleanup.push({ seat: seat.name, error: sanitise(error.message) }); report.passed = false; }
    }
    if (browser) await browser.close().catch(error => { report.errors.push({ error: sanitise(error.message) }); report.passed = false; });
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (proxy.listening) await new Promise(resolve => proxy.close(resolve));
    fs.writeFileSync(path.join(output, 'report.json'), sanitise(JSON.stringify(report, null, 2)));
  }
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, error: report.error, output }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
async function faviconEvidence() {
  const root = fs.realpathSync(process.argv[2]), ico = fs.readFileSync(path.join(root, 'favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1);
  const entries = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
    const offset = 6 + index * 16, width = ico[offset] || 256, height = ico[offset + 1] || 256;
    const length = ico.readUInt32LE(offset + 8), start = ico.readUInt32LE(offset + 12);
    assert(start + length <= ico.length, 'Invalid ICO entry bounds');
    const single = Buffer.alloc(22 + length); single.writeUInt16LE(1, 2); single.writeUInt16LE(1, 4);
    ico.copy(single, 6, offset, offset + 16); single.writeUInt32LE(22, 18); ico.copy(single, 22, start, start + length);
    return { width, height, bytes: length, source: 'data:image/x-icon;base64,' + single.toString('base64') };
  });
  assert.deepEqual(entries.map(e => e.width).sort((a,b) => a-b), [16, 32, 48]);
  const output = path.resolve('.tmp-qa-evidence/favicon-browser-' + Date.now()); fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: process.env.QA_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run'] });
    const page = await browser.newPage(); await page.setViewport({ width: 720, height: 360, deviceScaleFactor: 1 });
    await page.setContent('<html><head><link rel="icon" href="data:image/x-icon;base64,' + ico.toString('base64') + '"></head><body style="margin:0;padding:24px;background:#0B0716;color:white;font:16px Arial"><h1 style="font-size:20px">Exported controller favicon, Chrome decode</h1><div style="display:flex;gap:48px">' + entries.map(e => '<section><p>' + e.width + ' × ' + e.height + ' native pixels</p><img data-size="' + e.width + '" width="' + e.width + '" height="' + e.height + '" src="' + e.source + '"><p>Enlarged inspection</p><img style="image-rendering:pixelated" width="144" height="144" src="' + e.source + '"></section>').join('') + '</div></body></html>');
    await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0));
    const decoded = await page.$$eval('img[data-size]', images => images.map(img => ({ expected: Number(img.dataset.size), width: img.naturalWidth, height: img.naturalHeight })));
    assert(decoded.every(e => e.expected === e.width && e.expected === e.height));
    await page.screenshot({ path: path.join(output, 'favicon-native-and-enlarged.png') });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ method: 'Chrome renders each actual ICO embedded size, native and enlarged; no source asset altered.', sha256: hash(ico), decoded, passed: true }, null, 2));
    console.log(JSON.stringify({ passed: true, output, decoded }));
  } finally { if (browser) await browser.close(); }
}
if (require.main === module) (process.argv.includes('--favicon-only') ? faviconEvidence() : main()).catch(error => { console.error(sanitise(error.message)); process.exitCode = 1; });
