const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-core');
const { actor, input, click, until } = require('./saboteur-ui-smoke.cjs');

const base = process.env.SABOTEUR_WEB_URL ?? 'http://127.0.0.1:8081';
const api = process.env.SABOTEUR_API_URL ?? 'http://127.0.0.1:3213';
const output = path.resolve(process.env.ROOM_CODE_EVIDENCE_DIR);
const expected = process.env.QA_EXPECTED_WEB_SHA256;
const assert = (value, message) => { if (!value) throw new Error(message); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const receipt = { scope: 'One ordinary owned lobby, synthetic CSS text enlargement, not native font scaling. No clipboard or share invocation.', captures: [], issues: [], cleanup: [], visualFindings: [] };
let browser, seat;

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => setTimeout(resolve, 100));
  });
}
async function viewport(width) {
  const touch = width < 1000, previous = seat.page.viewport(), sequence = seat.socketSequence;
  const changedMode = !!previous.isMobile !== touch || !!previous.hasTouch !== touch;
  if (changedMode) seat.room = null;
  await seat.page.setViewport({ width, height: 844, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, isLandscape: width > 844 });
  await until(() => (!changedMode || seat.socketSequence > sequence) && seat.room?.players.some(p => p.playerId === seat.auth.playerId && p.isConnected), 'owned connected room');
  await until(() => seat.page.evaluate(() => !/Reconnecting\. Your seat|RETRY CONNECTION|Refreshing the room/.test(document.body.innerText)), 'rendered connected room');
  await settle(seat.page);
}
async function scaleText(factor) {
  return seat.page.evaluate(factor => {
    document.getElementById('room-code-qa-style')?.remove();
    for (const item of window.__roomCodeScale ?? []) item.node.removeAttribute('data-room-code-qa');
    window.__roomCodeScale = [];
    if (factor === 1) return [];
    const style = document.createElement('style'); style.id = 'room-code-qa-style';
    style.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}';
    const values = [];
    for (const node of document.querySelectorAll('body *')) {
      if (![...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) continue;
      const s = getComputedStyle(node), r = node.getBoundingClientRect();
      if (!r.width || !r.height || s.visibility !== 'visible' || node.closest('[aria-hidden="true"]') || /icon|material|fontawesome/i.test(s.fontFamily)) continue;
      values.push({ node, before: parseFloat(s.fontSize), line: parseFloat(s.lineHeight), text: node.textContent.trim().slice(0, 120) });
    }
    window.__roomCodeScale = values;
    values.forEach((item, index) => {
      item.node.setAttribute('data-room-code-qa', String(index));
      style.textContent += `[data-room-code-qa="${index}"]{font-size:${item.before * factor}px!important;${Number.isFinite(item.line) ? `line-height:${item.line * factor}px!important;` : ''}}`;
    });
    document.head.appendChild(style);
    return values.map(({ before, text }) => ({ before, text }));
  }, factor);
}
async function capture(width, scale) {
  await viewport(width);
  const baseline = await scaleText(scale / 100); await settle(seat.page);
  const selector = '[aria-label="Room code ' + seat.auth.roomCode + '"]';
  await seat.page.$eval(selector, node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await settle(seat.page);
  const file = `room-code-${width}x844-text${scale}.png`;
  await seat.page.screenshot({ path: path.join(output, file), fullPage: false });
  const metrics = await seat.page.evaluate(selector => {
    const rect = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
    const node = document.querySelector(selector), style = getComputedStyle(node), bounds = node.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(node);
    const textRects = [...range.getClientRects()].map(rect), ancestors = [];
    let scrollX = false, scrollY = false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const s = getComputedStyle(parent), r = parent.getBoundingClientRect();
      scrollX ||= ['auto', 'scroll'].includes(s.overflowX) && parent.scrollWidth > parent.clientWidth;
      scrollY ||= ['auto', 'scroll'].includes(s.overflowY) && parent.scrollHeight > parent.clientHeight;
      const clipsX = !scrollX && ['hidden', 'clip'].includes(s.overflowX), clipsY = !scrollY && ['hidden', 'clip'].includes(s.overflowY);
      const lostX = clipsX && textRects.some(t => t.left < r.left - 2 || t.right > r.right + 2);
      const lostY = clipsY && textRects.some(t => t.top < r.top - 2 || t.bottom > r.bottom + 2);
      ancestors.push({ tag: parent.tagName, id: parent.id, bounds: rect(r), overflowX: s.overflowX, overflowY: s.overflowY, scrollWidth: parent.scrollWidth, clientWidth: parent.clientWidth, lostX, lostY });
    }
    return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches,
      code: { text: node.textContent, bounds: rect(bounds), textRects, fontSize: style.fontSize, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, whiteSpace: style.whiteSpace, textOverflow: style.textOverflow, fullyFramed: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight },
      ancestors, scaled: (window.__roomCodeScale ?? []).map(({ node: item, before, text }) => ({ text, before, after: parseFloat(getComputedStyle(item).fontSize), connected: item.isConnected })) };
  }, selector);
  const requested = seat.page.viewport();
  receipt.captures.push({ file, width, scale, baseline, requested, metrics });
  assert(metrics.width === width && metrics.height === 844 && metrics.dpr === 1 && requested.isMobile === (width < 1000) && requested.hasTouch === (width < 1000), 'Viewport flags changed');
  assert(metrics.touchPoints === (width < 1000 ? 1 : 0) && metrics.coarse === (width < 1000), 'Touch/desktop flags differ');
  assert(metrics.code.fullyFramed, 'Room code not fully framed');
  if (scale === 200) assert(baseline.length > 0 && metrics.scaled.every(x => x.connected && Math.abs(x.after - 2 * x.before) < 0.2), 'Text enlargement invalid after capture');
  if (metrics.ancestors.some(a => a.lostX || a.lostY)) receipt.visualFindings.push({ file, type: 'room-code-clipping' });
  await scaleText(1); await settle(seat.page);
}
async function main() {
  assert(!fs.existsSync(path.join(output, 'receipt.json')), 'Use fresh output'); fs.mkdirSync(output, { recursive: true });
  try {
    for (const value of [base, api]) { const url = new URL(value); assert(['localhost', '127.0.0.1'].includes(url.hostname) && !url.username && !url.password, 'Loopback only'); }
    assert(/^[a-f0-9]{64}$/.test(expected ?? ''), 'Expected bundle SHA required');
    const html = await (await fetch(base, { redirect: 'error', signal: AbortSignal.timeout(10000) })).text();
    const entry = html.match(/src=["']([^"']*\/_expo\/static\/js\/web\/(?:entry|index)-[a-f0-9]+\.js)/)?.[1];
    assert(entry, 'Missing bundle'); const url = new URL(entry, base); assert(url.origin === new URL(base).origin, 'Foreign bundle');
    const served = hash(new Uint8Array(await (await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) })).arrayBuffer()));
    const root = process.env.QA_STATIC_ROOT;
    assert(fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes(path.basename(url.pathname)), 'Disk entry differs');
    const disk = hash(fs.readFileSync(path.join(root, '_expo/static/js/web', path.basename(url.pathname))));
    receipt.bundle = { entry: path.basename(url.pathname), expected, served, disk }; assert(served === expected && disk === expected, 'Bundle mismatch');
    browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + process.env.QA_BROWSER_CERT_SPKI] });
    seat = await actor(browser, 'Room Code Zoom');
    seat.page.on('pageerror', () => receipt.issues.push('pageerror'));
    seat.page.on('requestfailed', request => { if (request.failure()?.errorText === 'net::ERR_FAILED') receipt.issues.push('failed-or-blocked-request'); });
    await input(seat.page, 'Your name', seat.name); await click(seat.page, 'CREATE ROOM');
    await until(() => seat.auth && seat.room && seat.page.url().endsWith('/saboteur/lobby'), 'owned lobby');
    for (const width of [320, 375, 1280]) for (const scale of [100, 200]) await capture(width, scale);
    await click(seat.page, 'LEAVE ROOM'); await click(seat.page, 'LEAVE');
    await until(() => seat.leaveResponses.includes(200) && new URL(seat.page.url()).pathname === '/', 'normal lobby exit');
    await until(() => seat.page.evaluate(() => sessionStorage.getItem('za:auth') === null), 'cleared auth');
    seat.released = true; receipt.cleanup.push({ normalUI: true, status: 200, authCleared: true });
    receipt.captureMatrixComplete = true; receipt.passed = receipt.visualFindings.length === 0 && receipt.issues.length === 0;
  } catch (error) { receipt.passed = false; receipt.error = String(error.message).split(seat?.auth?.token ?? '\0').join('[redacted]'); }
  finally {
    if (seat?.auth && !seat.released) {
      try {
        const response = await fetch(api + '/rooms/' + encodeURIComponent(seat.auth.roomCode) + '/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + seat.auth.token }, signal: AbortSignal.timeout(5000) });
        receipt.cleanup.push({ normalUI: false, fallback: true, status: response.status }); if (response.status !== 200) receipt.passed = false;
      } catch { receipt.cleanup.push({ normalUI: false, fallback: true, failed: true }); receipt.passed = false; }
    }
    try { if (browser) await browser.close(); receipt.browserClosed = true; } catch { receipt.browserClosed = false; receipt.passed = false; }
    fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
  }
  console.log(JSON.stringify({ passed: receipt.passed, captures: receipt.captures.length, visualFindings: receipt.visualFindings, cleanup: receipt.cleanup, error: receipt.error }));
  if (!receipt.passed) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
