const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const repoRoot = path.resolve(__dirname, '../../..');
const webUrl = new URL(process.env.QA_WEB_URL ?? 'http://127.0.0.1:8081');
const apiUrl = new URL(process.env.QA_API_URL ?? 'https://localhost:3214');
for (const url of [webUrl, apiUrl]) assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'This harness only uses loopback services.');
const spki = process.env.QA_BROWSER_CERT_SPKI?.trim();
assert(spki && /^[A-Za-z0-9+/]{43}=$/.test(spki), 'QA_BROWSER_CERT_SPKI must be the local certificate public fingerprint.');
const staticRoot = path.resolve(process.env.QA_STATIC_ROOT ?? path.join(repoRoot, 'apps/mobile/.expo-export-qa-web'));
const outputDir = path.resolve(process.env.QA_UI_OUTPUT_DIR ?? path.join(repoRoot, '.tmp-qa-evidence', new Date().toISOString().slice(0, 10), `session-leaderboard-${Date.now()}`));
const sourceFiles = [
  'apps/mobile/app/(arcade)/index.tsx', 'apps/mobile/app/(arcade)/leaderboard.tsx', 'apps/mobile/lib/api.ts',
  'apps/mobile/lib/storage.ts', 'apps/mobile/app/_layout.tsx', 'apps/mobile/hooks/useSocket.ts',
  'apps/server/src/routes/room.ts', 'apps/mobile/scripts/session-leaderboard-ui-smoke.cjs',
];
const hash = (content) => crypto.createHash('sha256').update(content).digest('hex');
const sourceHashes = () => Object.fromEntries(sourceFiles.map((file) => [file, hash(fs.readFileSync(path.join(repoRoot, file)))]));
function buildEvidence() {
  const html = fs.readFileSync(path.join(staticRoot, 'index.html'), 'utf8');
  const entry = html.match(/_expo\/static\/js\/web\/((?:entry|index)-[a-f0-9]+\.js)/)?.[1];
  assert(entry, 'Static export entry was not found.');
  const buffer = fs.readFileSync(path.join(staticRoot, '_expo/static/js/web', entry));
  assert(buffer.includes(apiUrl.origin), 'The export uses a different API origin.');
  assert(buffer.includes('RETRY SESSION') && buffer.includes('RETRY SCORES'), 'The export predates these recovery fixes.');
  return { entry, sha256: hash(buffer), apiOrigin: apiUrl.origin, certificateFingerprint: spki };
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const screenshots = [];
const issues = [];
const expectedResourceErrors = [];
const observedFailures = [];

async function text(page, value) {
  await page.waitForFunction((expected) => document.body.innerText.includes(expected), { timeout: 20_000 }, value);
}

async function click(page, label, minimum = 44) {
  const selector = '[role="button"],button';
  await page.waitForFunction((query, expected) => [...document.querySelectorAll(query)].some((element) =>
    (element.getAttribute('aria-label') === expected || element.innerText.split('\n').some((line) => line.trim() === expected))
    && element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('disabled')),
  { timeout: 15_000 }, selector, label);
  const handles = await page.$$(selector);
  try {
    for (const handle of handles) {
      if (!await handle.evaluate((element, expected) => element.getAttribute('aria-label') === expected || element.innerText.split('\n').some((line) => line.trim() === expected), label)) continue;
      await handle.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      const bounds = await handle.boundingBox();
      assert(bounds && bounds.width >= minimum && bounds.height >= minimum, `${label} has a small touch target.`);
      await handle.click();
      return;
    }
    assert.fail(`Missing button: ${label}`);
  } finally { await Promise.all(handles.map((handle) => handle.dispose())); }
}

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await pause(180);
  const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => ({ fontSize: Number.parseFloat(getComputedStyle(node).fontSize), text: node.textContent })) }));
  assert(metrics.scrollWidth <= metrics.width + 1, `${name} has horizontal page overflow.`);
  assert(metrics.alerts.every((alert) => alert.fontSize >= 16), `${name} has an unreadable alert.`);
  await page.screenshot({ path: path.join(outputDir, name) });
  screenshots.push({ name, metrics });
}

async function sessionMatches(page, seat) {
  return page.evaluate((expected) => {
    const auth = JSON.parse(sessionStorage.getItem('za:auth') ?? 'null');
    return auth?.token === expected.token && auth?.playerId === expected.playerId && auth?.roomCode === expected.roomCode;
  }, seat);
}

async function exercise(browser, width) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height: width === 320 ? 800 : 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const mode = { room: null, board: null };
  const delayed = [];
  const intercepted = [];
  const responseHeaders = { 'access-control-allow-origin': webUrl.origin, 'cache-control': 'no-store' };
  let seat;
  page.on('pageerror', (error) => issues.push({ width, type: 'pageerror', message: error.message }));
  page.on('console', (message) => {
    if (!['error', 'warn'].includes(message.type())) return;
    const item = { width, type: message.type(), message: message.text(), url: message.location().url };
    if (item.url?.startsWith(apiUrl.origin) && item.message.startsWith('Failed to load resource:')) expectedResourceErrors.push(item);
    else issues.push(item);
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(apiUrl.origin)) observedFailures.push({ width, path: new URL(request.url()).pathname, error: request.failure()?.errorText });
  });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    void (async () => {
      const url = new URL(request.url());
      if (url.origin !== apiUrl.origin || request.method() !== 'GET') return request.continue();
      const roomRequest = seat && url.pathname === `/rooms/${seat.roomCode}`;
      if (roomRequest && mode.room) {
        intercepted.push(`room:${mode.room}`);
        if (mode.room === 'offline') return request.abort('internetdisconnected');
        return request.respond({ status: mode.room, contentType: 'application/json', headers: responseHeaders, body: JSON.stringify({ message: 'Controlled room lookup response' }) });
      }
      if (url.pathname === '/leaderboard' && mode.board) {
        const game = url.searchParams.get('game');
        intercepted.push(`board:${mode.board}:${game}`);
        if (mode.board === 'race' && game === 'saboteur') { delayed.push(request); return; }
        const rows = mode.board === 'race' ? [{ display_name: 'QA Coup latest', games_played: 2, total_nuggets: 0, wins: 2 }] : [];
        return request.respond({ status: mode.board === 'unavailable' ? 503 : 200, contentType: 'application/json', headers: responseHeaders,
          body: JSON.stringify(mode.board === 'unavailable' ? { message: 'Scores unavailable' } : rows) });
      }
      return request.continue();
    })().catch((error) => { if (!request.isInterceptResolutionHandled()) issues.push({ width, type: 'interception', message: error.message }); });
  });
  try {
    await page.goto(`${webUrl.origin}/not-alone`, { waitUntil: 'networkidle0', timeout: 45_000 });
    await text(page, 'OPEN A SIGNAL');
    const nameInput = await page.$('input[aria-label="Your name"]');
    assert(nameInput, 'Create-room name field missing.');
    await nameInput.click();
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
    await page.keyboard.type(`QA Recovery ${width}`);
    await click(page, 'CREATE ROOM', 48);
    await page.waitForFunction(() => location.pathname.endsWith('/not-alone/lobby') && sessionStorage.getItem('za:auth'), { timeout: 20_000 });
    seat = await page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth')));
    assert(seat?.token && seat.roomCode, 'Real lobby creation did not save a session.');

    for (const failure of ['offline', 429, 503]) {
      mode.room = failure;
      await page.goto(webUrl.origin, { waitUntil: 'networkidle0', timeout: 30_000 });
      await text(page, 'Your saved seat is still on this device.');
      assert(await sessionMatches(page, seat), `${failure} erased valid credentials.`);
      if (failure === 503) await capture(page, `hub-unavailable-${width}.png`);
      mode.room = null;
      await click(page, 'RETRY SESSION', 48);
      await text(page, 'Back to lobby');
      assert(await sessionMatches(page, seat), 'Retry replaced or erased the saved seat.');
    }
    await capture(page, `hub-resumed-${width}.png`);
    mode.room = 404;
    await page.goto(webUrl.origin, { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.waitForFunction(() => sessionStorage.getItem('za:auth') === null, { timeout: 15_000 });
    assert(await page.evaluate(() => !document.body.innerText.includes('Back to lobby')), 'A confirmed missing session left a resume banner.');
    mode.room = null;
    await capture(page, `hub-confirmed-gone-${width}.png`);

    mode.board = 'unavailable';
    await page.goto(`${webUrl.origin}/leaderboard`, { waitUntil: 'networkidle0', timeout: 30_000 });
    await text(page, 'Scores are unavailable right now.');
    assert(await page.evaluate(() => !document.body.innerText.includes('No games recorded')), '503 was shown as an empty leaderboard.');
    await capture(page, `leaderboard-unavailable-${width}.png`);
    mode.board = 'empty';
    await click(page, 'RETRY SCORES', 48);
    await text(page, 'No games recorded yet.');
    await capture(page, `leaderboard-empty-${width}.png`);

    const filters = [
      ['Saboteur', 'nuggets'], ['Coup', 'wins'], ['King of Tokyo', 'wins'], ['Skull King', 'points'],
      ['Citadels', 'points'], ['Not Alone', 'wins'], ['BANG!', 'wins'], ['Libertalia', 'points'], ['Colt Express', 'loot'],
    ];
    for (const [label, metric] of filters) {
      await click(page, label);
      await text(page, `all-time ${label} ${metric}`);
      await text(page, 'No games recorded yet.');
      const selected = await page.evaluate((name) => [...document.querySelectorAll('[aria-pressed="true"]')].map((node) => node.getAttribute('aria-label')).join() === name, label);
      assert(selected, `${label} is not the only announced selected filter.`);
    }
    await capture(page, `leaderboard-colt-loot-${width}.png`);
    await page.focus('[role="button"][aria-label="Saboteur"]');
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Coup'), 'Keyboard Tab did not reach the next game filter.');
    await page.keyboard.press('Space');
    await text(page, 'all-time Coup wins');
    await click(page, 'Saboteur');
    await text(page, 'No games recorded yet.');

    mode.board = 'race';
    await click(page, 'REFRESH SCORES', 48);
    await page.waitForFunction(() => document.body.innerText.includes('Loading scores…'), { timeout: 10_000 });
    for (let attempt = 0; attempt < 20 && delayed.length === 0; attempt++) await pause(50);
    assert(delayed.length === 1, 'The old Saboteur request was not held.');
    await click(page, 'Coup');
    await text(page, 'QA Coup latest');
    for (const request of delayed) {
      try {
        await request.respond({ status: 200, contentType: 'application/json', headers: responseHeaders,
          body: JSON.stringify([{ display_name: 'QA old Saboteur', games_played: 8, total_nuggets: 40, wins: 1 }]) });
      } catch { /* The old request may already have been cancelled by the tab change. */ }
    }
    await pause(300);
    assert(await page.evaluate(() => document.body.innerText.includes('QA Coup latest') && !document.body.innerText.includes('QA old Saboteur')), 'Late response replaced the active game board.');
    await capture(page, `leaderboard-latest-only-${width}.png`);
    assert(intercepted.includes('room:offline') && intercepted.includes('room:429') && intercepted.includes('room:503') && intercepted.includes('room:404'), 'Missing room-failure interception.');
    console.log(`Session and leaderboard browser checks passed at ${width}px.`);
    return { width, actualUiCreation: true, preservedFailures: ['offline', 429, 503], confirmed404Cleared: true,
      leaderboardModes: ['503', '200 empty', 'late old filter response'], filters, keyboardFilterNavigation: true, intercepted };
  } finally {
    mode.room = null;
    mode.board = null;
    if (seat) {
      const status = await page.evaluate(async (origin, saved) => (await fetch(`${origin}/rooms/${saved.roomCode}/leave`, {
        method: 'POST', headers: { Authorization: `Bearer ${saved.token}` },
      })).status, apiUrl.origin, seat).catch(() => 0);
      if (![200, 403, 404].includes(status)) issues.push({ width, type: 'cleanup', status });
    }
    await context.close();
  }
}

async function main() {
  const sources = sourceHashes();
  const build = buildEvidence();
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true,
    args: [`--ignore-certificate-errors-spki-list=${spki}`, '--disable-dev-shm-usage'] });
  try {
    const checks = [];
    for (const width of [320, 1280]) checks.push(await exercise(browser, width));
    assert.deepEqual(sourceHashes(), sources, 'Audited source changed during browser checks.');
    assert.deepEqual(buildEvidence(), build, 'Export changed during browser checks.');
    const result = { pass: issues.length === 0, outputDir, sourceHashes: sources, build, checks, screenshots, issues, expectedResourceErrors, observedFailures,
      boundaries: 'Real local UI-created room sessions; only GET failures and leaderboard rows are response fixtures. No hosted services or native devices tested.' };
    fs.writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    assert.equal(issues.length, 0, `Unexpected browser issues: ${JSON.stringify(issues)}`);
    console.log(`SESSION LEADERBOARD UI PASS ${outputDir}`);
  } catch (error) {
    fs.writeFileSync(path.join(outputDir, 'failure.json'), `${JSON.stringify({ message: error.message, screenshots, issues, expectedResourceErrors, observedFailures }, null, 2)}\n`);
    throw error;
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
