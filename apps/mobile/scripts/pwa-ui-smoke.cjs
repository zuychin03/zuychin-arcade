const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');

async function main() {
  const directory = process.argv[2] || process.env.PWA_EXPORT_DIR;
  assert(directory, 'Explicit PWA export directory required');
  const root = fs.realpathSync(directory);
  for (const file of ['index.html', 'service-worker.js', 'manifest.webmanifest', 'offline.html']) assert(fs.existsSync(path.join(root, file)), file);
  const chrome = process.env.QA_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  assert(fs.existsSync(chrome), 'Set QA_BROWSER_PATH to installed Chrome');
  const puppeteer = require('puppeteer-core');
  let version = 1, offline = false, browser, stage = 'launch';
  const checks = [], denied = [];
  const server = http.createServer((req, res) => {
    if (offline) { req.socket.destroy(); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (/^\/(api|auth|room|socket\.io)(\/|$)/.test(url.pathname)) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"fixture":"private-never-cache"}'); return; }
    const candidate = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (candidate !== root && !candidate.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const file = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, 'index.html');
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
    const bytes = fs.readFileSync(file);
    res.end(url.pathname === '/service-worker.js' ? Buffer.concat([bytes, Buffer.from(`\n// smoke deploy ${version}\n`)]) : bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = path.resolve(process.env.PWA_QA_OUTPUT || `.tmp-qa-evidence/pwa-browser-${Date.now()}`);
  assert(!fs.existsSync(output), 'Evidence directory already exists; choose a fresh PWA_QA_OUTPUT');
  fs.mkdirSync(output, { recursive: true });
  const hashes = Object.fromEntries(['index.html', 'service-worker.js'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  const workerVersion = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8').match(/"version":"([^"]+)"/)?.[1];
  const report = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ exportDirectory: root, hashes, workerVersion, fixture: 'Ephemeral loopback origin; busy second tab uses history-only fixture path, not a real game/session', checks, denied }, null, 2));
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--disable-dev-shm-usage', '--no-first-run'] });
    const page = await browser.newPage();
    const prepare = async tab => {
      await tab.setViewport({ width: 390, height: 844 });
      await tab.setRequestInterception(true);
      tab.on('request', request => { const url = request.url(); if (url.startsWith(origin + '/') || /^(data:|blob:)/.test(url)) request.continue(); else { denied.push(new URL(url).origin); request.abort(); } });
      await tab.evaluateOnNewDocument(() => { window.__pwaMessages = []; navigator.serviceWorker?.addEventListener('message', event => window.__pwaMessages.push(event.data)); });
      await tab.goto(origin, { waitUntil: 'networkidle0', timeout: 60000 });
      await tab.waitForFunction(() => navigator.serviceWorker.controller, { timeout: 30000 });
    };
    await prepare(page);
    const metadata = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      const manifest = await (await fetch(link.href)).json();
      const icons = await Promise.all(manifest.icons.map(async icon => ({ ...icon, ok: (await fetch(icon.src)).ok })));
      const favicon = document.querySelector('link[rel="icon"]');
      const faviconResponse = favicon && await fetch(favicon.href);
      return { manifest, icons, favicon: favicon?.href, faviconOk: faviconResponse?.ok, controls: Boolean(document.querySelector('[data-testid="pwa-controls"]')), text: document.body.innerText };
    });
    assert.equal(metadata.manifest.display, 'standalone'); assert.equal(metadata.manifest.scope, '/'); assert(metadata.icons.every(icon => icon.ok)); assert.equal(metadata.controls, false);
    checks.push('Export manifest/icons, active service-worker controller and unobstructed mobile library');
    assert(metadata.faviconOk);
    const faviconHash = createHash('sha256').update(fs.readFileSync(path.join(root, 'favicon.ico'))).digest('hex').slice(0, 16);
    assert.equal(new URL(metadata.favicon).searchParams.get('v'), faviconHash);
    checks.push('Browser favicon resolves to the content-versioned exported controller icon');
    const clickText = async (tab, text) => {
      await tab.bringToFront();
      await tab.waitForFunction(value => [...document.querySelectorAll('[role="button"]')].some(node => node.textContent === value), {}, text);
      await tab.evaluate(value => [...document.querySelectorAll('[role="button"]')].find(node => node.textContent === value).click(), text);
    };
    const openNavigation = async tab => {
      if (tab.viewport().width < 768 && !await tab.$('#arcade-mobile-navigation')) {
        await tab.waitForFunction(() => {
          const button = document.querySelector('[aria-label="Open navigation menu"]');
          if (!button) return false;
          const box = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
        });
        await tab.click('[aria-label="Open navigation menu"]');
      }
      await tab.waitForSelector('#pwa-sidebar-controls');
      await tab.waitForFunction(() => !document.getElementById('arcade-mobile-navigation') || document.getElementById('arcade-mobile-navigation').getBoundingClientRect().left >= -1);
    };
    const offerInstall = async tab => {
      // Headless Chrome does not consistently dispatch native install offers.
      await tab.evaluate(() => window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) })));
      await tab.waitForSelector('[data-testid="pwa-controls"]');
    };
    await openNavigation(page); await offerInstall(page);
    const placement = await page.evaluate(() => {
      const controls = document.querySelector('[data-testid="pwa-controls"]');
      const slot = document.getElementById('pwa-sidebar-controls');
      return { inside: slot.contains(controls), bottom: controls.getBoundingClientRect().bottom, height: innerHeight };
    });
    assert(placement.inside && Math.abs(placement.bottom - placement.height) <= 32, JSON.stringify(placement));
    await page.screenshot({ path: path.join(output, 'mobile-sidebar-footer.png'), fullPage: true });
    await page.click('#arcade-mobile-navigation [aria-label="Close navigation menu"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="pwa-controls"]'));
    await page.waitForFunction(() => !document.getElementById('arcade-mobile-navigation'));
    stage = 'sidebar-reopen';
    await openNavigation(page);
    await page.waitForSelector('[data-testid="pwa-controls"]');
    checks.push('Install-offer fixture renders only in sidebar footer and survives mobile drawer close/reopen');
    await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => { throw new Error('Fixture: installation unavailable'); }, userChoice: Promise.resolve({ outcome: 'dismissed' }) })));
    await clickText(page, 'Install Arcade');
    await page.waitForFunction(() => document.body.innerText.includes('Open your browser'));
    checks.push('Failed install-prompt fixture retains visible browser-menu guidance');
    for (const width of [320, 1280]) {
      await page.setViewport({ width, height: 900 });
      await openNavigation(page);
      await page.waitForFunction(() => document.querySelectorAll('#pwa-sidebar-controls').length === 1 && document.querySelector('#pwa-sidebar-controls [data-testid="pwa-controls"]'));
      await page.evaluate(() => {
        for (const node of document.querySelector('[data-testid="pwa-controls"]').querySelectorAll('*')) {
          if (node.children.length === 0 && node.textContent.trim()) { const style = getComputedStyle(node); node.style.fontSize = `${parseFloat(style.fontSize) * 2}px`; node.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`; }
        }
        document.querySelector('[data-testid="pwa-controls"]').scrollIntoView({ block: 'end' });
      });
      const geometry = await page.evaluate(() => { const root = document.querySelector('[data-testid="pwa-controls"]'); const box = root.getBoundingClientRect(); return { width: innerWidth, right: box.right, scroll: root.scrollWidth, client: root.clientWidth, overflow: [...root.querySelectorAll('*')].filter(node => node.children.length === 0 && node.textContent.trim()).some(node => { const rect = node.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 1; }) }; });
      assert(geometry.right <= width + 1 && !geometry.overflow, JSON.stringify(geometry));
      await page.screenshot({ path: path.join(output, `controls-${width}-text200.png`), fullPage: true });
      await page.evaluate(() => { for (const node of document.querySelector('[data-testid="pwa-controls"]').querySelectorAll('*')) { node.style.fontSize = ''; node.style.lineHeight = ''; } });
    }
    checks.push('Installation controls fit 320px and1280px at CSS200 text');
    await page.screenshot({ path: path.join(output, 'library-install-controls.png'), fullPage: true });
    await page.evaluate(async () => { for (const url of ['/api/auth', '/auth/session', '/room/FIXTURE', '/socket.io/?fixture=1', '/icons/icon-192.png?private=fixture']) await fetch(url, { headers: { Authorization: 'Bearer fixture-not-a-real-token' } }); });
    const cacheUrls = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat());
    assert(!cacheUrls.some(url => /\?|\/api\/|\/auth\/|\/room\/|socket\.io/.test(url)));
    checks.push('Private/API/auth/room/query fixture requests absent from CacheStorage');
    stage = 'second-tab-controller';
    const busy = await browser.newPage(); await prepare(busy);
    await busy.evaluate(() => history.pushState({ fixture: true }, '', '/pwa-busy-fixture'));
    let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    version = 2;
    stage = 'waiting-worker';
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
    await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting), { timeout: 30000, polling: 100 });
    await page.bringToFront();
    assert.equal(navigations, 0, 'Waiting update must not reload');
    const requestUpdate = tab => clickText(tab, 'Update Arcade');
    stage = 'update-button';
    await requestUpdate(page);
    stage = 'busy-tab-veto';
    await page.waitForFunction(() => window.__pwaMessages.some(message => message.type === 'UPDATE_BLOCKED'), { timeout: 15000 });
    assert.equal(navigations, 0); assert(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)));
    checks.push('Second-tab busy-path fixture blocks activation and causes no reload');
    await busy.close();
    await requestUpdate(page);
    await page.waitForFunction(() => window.__pwaMessages.some(message => message.type === 'UPDATE_APPROVED'), { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration()).waiting && !document.getElementById('root')?.inert, { timeout: 30000 });
    assert(navigations >= 1, 'Approved explicit idle update reloads the library');
    checks.push('Explicit idle update activates and reloads only after approval');
    offline = true;
    await page.goto(origin + '/offline-navigation-fixture', { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.match(await page.evaluate(() => document.body.innerText), /Your table needs a connection/);
    await page.screenshot({ path: path.join(output, 'offline-recovery.png'), fullPage: true });
    checks.push('Network-failure navigation serves public offline recovery, never a cached room');
    offline = false;
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }), page.click('a[href="/"]')]);
    await openNavigation(page); await offerInstall(page);
    await page.waitForSelector('[data-testid="pwa-controls"]');
    checks.push('Offline Try again link restores the online library');
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await page.waitForFunction(() => !/Add Arcade to your device|Install Arcade/.test(document.body.innerText));
    assert.equal(await page.evaluate(() => localStorage.getItem('arcade:pwa-installed')), '1');
    await page.reload({ waitUntil: 'networkidle0' });
    await openNavigation(page);
    assert(!await page.evaluate(() => /Add Arcade to your device|Install Arcade/.test(document.body.innerText)));
    checks.push('Installation-event fixture hides install button and remembered installation stays hidden after reload');
    report(); console.log(JSON.stringify({ passed: checks.length, checks, output }, null, 2));
  } catch (error) { checks.push({ failure: error.message, stage, stack: error.stack }); report(); throw error; }
  finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
