const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

assert(process.env.COUP_EVIDENCE_DIR, 'Fresh evidence directory required');
assert.equal(process.env.COUP_UI_EXCLUSIVE_WINDOW, 'granted');
assert(process.env.QA_BROWSER_CERT_SPKI, 'Local certificate pin required');
const output = path.resolve(process.env.COUP_EVIDENCE_DIR);
assert(!fs.existsSync(output), 'Preserve prior evidence');
const qa = require('./coup-ui-smoke.cjs');
const origin = process.env.COUP_WEB_URL ?? 'http://127.0.0.1:8081';
const systemPagesOnly = process.env.RULEBOOKS_SYSTEM_PAGES_ONLY === 'true';
const games = [
  ['saboteur', 'saboteur-rules-guide'], ['coup', null], ['king-of-tokyo', 'tokyo-rules-guide'],
  ['skull-king', 'skull-rules-guide'], ['citadels', 'citadels-rules-guide'], ['not-alone', 'not-alone-rules-guide'],
  ['bang', 'bang-rules-guide'], ['libertalia', 'libertalia-rules-guide'], ['colt-express', 'colt-rules-guide'],
];
const profiles = [{ name: 'phone', width: 375, height: 844, scale: 100 }, { name: 'small-text200', width: 320, height: 844, scale: 200 }, { name: 'desktop', width: 1280, height: 900, scale: 100 }, { name: 'desktop-text200', width: 1280, height: 900, scale: 200 }, { name: 'landscape', width: 844, height: 390, scale: 100 }];
const lessons = { saboteur: 'saboteur-rules-tools', coup: 'coup-rules-characters', 'king-of-tokyo': 'tokyo-rules-crossfire', 'skull-king': 'skull-rules-hierarchy', citadels: 'citadels-rules-characters', 'not-alone': 'not-alone-rules-reveal', bang: 'bang-rules-distance', libertalia: 'libertalia-rules-directions', 'colt-express': 'colt-rules-train' };
const receipt = qa.evidence;
Object.assign(receipt, { coverage: systemPagesOnly ? 'Privacy and public disabled-ranking notice at five viewport/text profiles. No gameplay or physical-device claim.' : 'Nine rulebooks from rendered entrances, authored public examples, detailed chapter access, keyboard close, privacy and disabled rankings. No gameplay or physical-device claim.', books: [], pages: [], accessibilityFindings: [] });
const persist = () => fs.writeFileSync(path.join(output, 'receipt.json'), qa.sanitise(JSON.stringify(receipt, null, 2)));

async function ready(page, selector) {
  await qa.until(() => page.$(selector), selector);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
}

async function inspectBook(seat, game, guide, profile) {
  const page = seat.page;
  await qa.setViewport(seat, profile.width, profile.height);
  await page.goto(`${origin}/${game}`, { waitUntil: 'domcontentloaded' });
  await ready(page, '[aria-label="HOW TO PLAY"]');
  await qa.click(page, 'HOW TO PLAY');
  const modal = game === 'coup' ? '#coup-rules' : '#rules-reference-sheet';
  const region = game === 'coup' ? '[aria-label="Coup rules content"]' : '#rules-reference-sheet [role="region"]';
  await ready(page, modal);
  if (guide) assert(await page.$(`[data-testid="${guide}"], #${guide}`), game + ' authored guide');
  await qa.until(() => page.$$eval(`${modal} img`, images => images.every(image => image.complete && image.naturalWidth > 0)), game + ' loaded illustrations');
  const inventory = await page.$eval(modal, node => ({ title: node.getAttribute('aria-label'), images: node.querySelectorAll('img').length, textLength: node.innerText.length }));
  await qa.capture(seat, `${game}-${profile.name}-opening`, profile.width, profile.height, { scale: profile.scale, scrollRegion: region, scrollEdge: 'top' });
  if (profile.name !== 'landscape') {
    const lesson = `#${lessons[game]}`;
    assert(await page.$(lesson), 'Exact lesson target exists');
    await qa.capture(seat, `${game}-${profile.name}-pieces`, profile.width, profile.height, { scale: profile.scale, frame: lesson });
  }
  let chapters = [];
  if (game !== 'coup' && profile.name === 'small-text200') {
    chapters = await page.$$eval(`${modal} [role="button"][aria-label]`, nodes => nodes.map(node => node.getAttribute('aria-label')).filter(label => label !== 'Close rules'));
    assert(chapters.length > 0);
    for (const chapter of chapters) await qa.click(page, chapter);
    const expandedStates = await page.$$eval(`${modal} [role="button"][aria-label]`, nodes => nodes.filter(node => node.getAttribute('aria-label') !== 'Close rules').map(node => node.getAttribute('aria-expanded')));
    if (!expandedStates.every(state => state === 'true')) receipt.accessibilityFindings.push({ game, issue: 'Chapter expanded state missing', expandedStates });
    assert(await page.$eval(modal, (node, before) => node.innerText.length > before, inventory.textLength), 'Chapters reveal retained rules');
    await qa.capture(seat, `${game}-detailed-rules-text200`, profile.width, profile.height, { scale: 200, scrollRegion: region, scrollEdge: 'bottom' });
  }
  await page.keyboard.press('Escape');
  await qa.until(() => page.$(modal).then(node => !node), 'Escape closes rulebook');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'HOW TO PLAY');
  receipt.books.push({ game, profile, inventory, chapters, keyboardClose: true });
  persist();
}

async function inspectSystemPages(seat, profile) {
  await qa.setViewport(seat, profile.width, profile.height);
  await seat.page.goto(origin + '/privacy', { waitUntil: 'domcontentloaded' });
  await ready(seat.page, 'a[href="mailto:k.duy1202@gmail.com"]');
  const privacy = await seat.page.evaluate(() => document.body.innerText);
  assert(!/RELEASE REQUIREMENT|engineering summary|publisher must|Before public release/i.test(privacy));
  await qa.capture(seat, `privacy-${profile.name}`, profile.width, profile.height, { scale: profile.scale });
  if (profile.name !== 'landscape') await qa.capture(seat, `privacy-contact-${profile.name}`, profile.width, profile.height, { scale: profile.scale, frame: 'a[href="mailto:k.duy1202@gmail.com"]' });
  const rankingResponse = seat.page.waitForResponse(response => new URL(response.url()).pathname === '/leaderboard' && response.request().method() === 'GET' && response.request().resourceType() !== 'document');
  await seat.page.goto(origin + '/leaderboard', { waitUntil: 'domcontentloaded' });
  const unavailable = await rankingResponse;
  assert.equal(unavailable.status(), 503);
  const unavailableBody = await unavailable.json();
  assert.equal(unavailableBody.code, 'RANKINGS_DISABLED');
  assert(!/database|storage|configur|connect|supabase/i.test(JSON.stringify(unavailableBody)));
  await qa.until(() => seat.page.evaluate(() => document.body.innerText.includes('Rankings are currently disabled by the administrator.')), 'disabled-ranking notice');
  const ranking = await seat.page.evaluate(() => document.body.innerText);
  assert(!/No games recorded|Check your connection|database|storage|configur|supabase/i.test(ranking));
  await qa.capture(seat, `rankings-${profile.name}`, profile.width, profile.height, { scale: profile.scale });
  receipt.pages.push({ profile, privacy: true, approvedContact: true, noInternalInstructions: true, rankingDisabledNotice: true });
  persist();
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    await qa.verifyBundle();
    const firstBundle = receipt.bundle;
    browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
      args: ['--no-first-run', '--disable-background-networking', '--ignore-certificate-errors-spki-list=' + process.env.QA_BROWSER_CERT_SPKI] });
    await qa.calibrateTextGeometry(browser);
    const phone = await qa.actor(browser, 'Rulebook Phone', 375);
    const desktop = await qa.actor(browser, 'Rulebook Desktop', 1280);
    await Promise.all([phone.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]), desktop.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])]);
    for (const [game, guide] of systemPagesOnly ? [] : games) {
      for (const profile of profiles) await inspectBook(profile.name.startsWith('desktop') ? desktop : phone, game, guide, profile);
      console.log(JSON.stringify({ game, profiles: profiles.length, findings: receipt.visualFindings.length }));
    }
    for (const profile of profiles) await inspectSystemPages(profile.name.startsWith('desktop') ? desktop : phone, profile);
    await qa.verifyBundle();
    assert.equal(receipt.bundle.sha256, firstBundle.sha256);
    receipt.expectedIssues = receipt.issues.filter(issue => issue.type === 'error' && /Failed to load resource.*503/.test(issue.text) && issue.url && new URL(issue.url).origin === 'https://localhost:3214' && new URL(issue.url).pathname === '/leaderboard');
    receipt.unexpectedIssues = receipt.issues.filter(issue => !receipt.expectedIssues.includes(issue));
    assert.equal(receipt.unexpectedIssues.length, 0);
    assert.equal(receipt.blockedRequests.length, 0);
    receipt.functionalPassed = receipt.accessibilityFindings.length === 0;
    receipt.visualPassed = receipt.visualFindings.length === 0;
    receipt.passed = receipt.functionalPassed && receipt.visualPassed;
  } catch (error) {
    receipt.error = qa.sanitise(error.stack); receipt.passed = false; process.exitCode = 1;
  } finally {
    try { if (browser) await browser.close(); receipt.browserClosed = true; } catch { receipt.browserClosed = false; }
    if (!receipt.passed || !receipt.browserClosed) process.exitCode = 1;
    persist();
    console.log(JSON.stringify({ passed: receipt.passed ?? false, books: receipt.books.length, pages: receipt.pages.length, findings: receipt.visualFindings.length, error: receipt.error, output }));
  }
}
main().catch(error => { console.error(qa.sanitise(error.stack)); process.exitCode = 1; });
