const fs = require('node:fs');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const h = require('./citadels-ui-smoke.cjs');
const { createEvidence, bundleFence, guardNetwork, local, redact, publicPrivacy } = require('./citadels-ui-evidence.cjs');

const names = ['Fixture Host', 'Fixture Second', 'Fixture Third', 'Fixture Fourth'];
const scenarios = ['magician_redraw', 'warlord_targets', 'district_abilities', 'observatory_draw', 'library_draw', 'final_scoring', 'killed_merchant'];
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const own = seat => seat.public.players.find(p => p.playerId === seat.auth.playerId);
const exact = label => new RegExp(`^${escapeRegex(label)}$`);
const labels = page => page.evaluate(() => [...document.querySelectorAll('[aria-label]')].filter(n => !n.closest('[aria-hidden="true"]')).map(n => n.getAttribute('aria-label')));

function checkProjection(seat) {
  assert.equal(seat.private.playerId, seat.auth.playerId);
  assert.equal(seat.private.roomCode, seat.auth.roomCode);
  assert.equal(seat.public.roomCode, seat.auth.roomCode);
  assert.equal(seat.public.revision, seat.private.revision);
  assert.deepEqual(publicPrivacy(seat.public), []);
}

async function openSeat(browser, qa, name, desktop) {
  const seat = await h.openPlayer(browser, name, desktop ? 1280 : 375, 844);
  qa.register(seat);
  await seat.page.setViewport({ width: desktop ? 1280 : 375, height: 844, deviceScaleFactor: 1, isMobile: !desktop, hasTouch: !desktop });
  await guardNetwork(seat.page, qa.origins, qa.evidence.blockedRequests);
  seat.page.on('response', response => {
    const url = new URL(response.url());
    if (qa.origins.has(url.origin) && /\/rooms\/[^/]+\/leave$/.test(url.pathname) && response.request().method() === 'POST') {
      qa.evidence.cleanup.push({ actor: name, batch: seat.batch, normalUI: !seat.fallbackCleanup, status: response.status(), authCleared: false }); qa.persist();
    }
  });
  return seat;
}

async function cleanup(seat, qa, api) {
  try {
    let auth = await seat.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null')).catch(() => seat.auth);
    if (auth?.token) {
      qa.secrets.add(auth.token);
      try {
        await h.leavePlayerUI(seat);
      } catch (error) { qa.evidence.cleanup.push({ actor: seat.name, batch: seat.batch, uiError: redact(error.message, [...qa.secrets]) }); }
      auth = await seat.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null')).catch(() => seat.auth);
      if (auth?.token) {
        seat.fallbackCleanup = true;
        const response = await fetch(api + '/rooms/' + encodeURIComponent(auth.roomCode) + '/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.token }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        qa.evidence.cleanup.push({ actor: seat.name, batch: seat.batch, fallback: true, normalUI: false, status: response.status });
      }
    }
    const authCleared = await seat.page.evaluate(() => !sessionStorage.getItem('za:auth')).catch(() => false);
    for (const record of qa.evidence.cleanup.filter(r => r.actor === seat.name && r.batch === seat.batch && r.normalUI)) record.authCleared = authCleared;
  } catch (error) { qa.evidence.cleanup.push({ actor: seat.name, batch: seat.batch, error: redact(error.message, [...qa.secrets]) }); }
  finally { await seat.context.close().catch(error => { qa.evidence.cleanup.push({ actor: seat.name, batch: seat.batch, contextError: redact(error.message, [...qa.secrets]) }); }); qa.persist(); }
}

async function frameLabel(page, label) {
  await page.evaluate(value => {
    document.querySelector('[data-citadels-fixture-frame]')?.removeAttribute('data-citadels-fixture-frame');
    const node = [...document.querySelectorAll('[aria-label]')].find(n => n.getAttribute('aria-label') === value && !n.closest('[aria-hidden="true"]'));
    if (!node) throw new Error('Requested fixture control is not rendered');
    node.setAttribute('data-citadels-fixture-frame', 'true');
  }, label);
  return '[data-citadels-fixture-frame]';
}

function selectedCardDom(node) {
  const shown = element => {
    const bounds = element.getBoundingClientRect();
    if (!element.isConnected || !bounds.width || !bounds.height) return false;
    for (let owner = element; owner; owner = owner.parentElement) {
      const style = getComputedStyle(owner);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 || owner.getAttribute('aria-hidden') === 'true' || owner.hasAttribute('hidden')) return false;
    }
    return true;
  };
  const cues = [node, ...node.querySelectorAll('*')].filter(shown).flatMap(element => {
    const directText = [...element.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('').trim();
    return /^selected$/i.test(directText) ? [directText] : [];
  });
  return { label: node.getAttribute('aria-label'), role: node.getAttribute('role'), pressed: node.getAttribute('aria-pressed'),
    enabled: node.getAttribute('aria-disabled') !== 'true' && !node.hasAttribute('disabled'), shown: shown(node), cues,
    visibilityScope: 'CSS-visible rendered text in the whole framed card, including its scroll-reachable content' };
}

function assertSelectedCard(snapshot, expectedLabel) {
  assert.equal(snapshot.label, expectedLabel, 'Selected card retains its complete SELECTED. accessibility label');
  assert.match(snapshot.label, /^SELECTED\. /);
  assert.equal(snapshot.role, 'button');
  assert.equal(snapshot.pressed, 'true', 'ScalePressable exposes selected state as aria-pressed on web');
  assert.equal(snapshot.enabled, true, 'Selected card remains enabled');
  assert.equal(snapshot.shown, true, 'Selected card remains rendered');
  assert.deepEqual(snapshot.cues, ['Selected'], 'Selected card has exactly one visible standalone Selected cue');
}

async function checkSelectedCard(page, expectedLabel, record, qa) {
  const snapshot = await page.$eval('[data-citadels-fixture-frame]', selectedCardDom);
  record.selectedCard = snapshot; qa.persist();
  assertSelectedCard(snapshot, expectedLabel);
}

async function runRoom(browser, qa, base, api, desktop) {
  const seats = [], batch = desktop ? 'desktop' : 'phone';
  try {
    for (const [i, name] of names.entries()) {
      const seat = await openSeat(browser, qa, name, i === 0 ? desktop : !desktop); seat.batch = batch; seats.push(seat);
    }
    const host = seats[0], observer = seats[2];
    await host.page.goto(base + '/citadels', { waitUntil: 'domcontentloaded' });
    await h.setInput(host.page, 'Your name', host.name); await h.clickButton(host.page, /^CREATE ROOM$/);
    await h.waitForPath(host.page, '/citadels/lobby');
    host.auth = await host.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth'))); qa.secrets.add(host.auth.token);
    const roomCode = host.auth.roomCode;
    for (const seat of seats.slice(1)) {
      await seat.page.goto(base + '/citadels/join', { waitUntil: 'domcontentloaded' });
      await h.setInput(seat.page, 'Your name', seat.name); await h.setInput(seat.page, 'Room code', roomCode);
      await h.clickButton(seat.page, /^JOIN GAME$/); await h.waitForPath(seat.page, '/citadels/lobby');
      seat.auth = await seat.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth'))); qa.secrets.add(seat.auth.token);
    }
    await h.clickButton(host.page, /^START GAME$/);
    await Promise.all(seats.map(seat => h.waitForPath(seat.page, '/citadels/game')));
    for (const scenario of scenarios) {
      const response = await fetch(api + '/__qa/citadels-fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomCode, scenario }), redirect: 'error', signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200);
      const installed = await response.json(); assert.equal(installed.scenario, scenario); assert.equal(installed.canonicalDistricts, 68);
      await h.waitUntil(() => seats.every(s => s.public?.revision === installed.revision && s.private?.revision === installed.revision), 'paired canonical fixture revision');
      seats.forEach(checkProjection);
      const record = { batch, scenario, canonicalDistricts: 68, revision: installed.revision, commands: [], privacy: [] };
      qa.evidence.fixtureCases.push(record); qa.persist();
      const command = async (seat, pattern) => {
        const before = seat.acks.length, revision = seat.public.revision;
        await h.clickButton(seat.page, pattern);
        await h.waitUntil(() => seat.acks.length > before && seat.public?.revision >= seat.acks.at(-1).revision && seat.private?.revision === seat.public?.revision, 'accepted owned fixture command');
        const ack = seat.acks.at(-1); assert(ack.revision > revision); checkProjection(seat);
        record.commands.push({ actor: seat.name, action: ack.action, revision: ack.revision }); qa.persist();
      };
      const capture = async (seat, suffix, frame = '#citadels-decision-heading') => {
        await qa.capture(seat.page, `${batch}-${scenario}-${suffix}-normal.png`, { frame });
        await qa.capture(seat.page, `${batch}-${scenario}-${suffix}-200-top.png`, { frame, scale: true, align: 'start' });
        await qa.capture(seat.page, `${batch}-${scenario}-${suffix}-200-bottom.png`, { frame, scale: true, align: 'end' });
      };
      const noControls = async (seat, pattern) => assert(!(await h.enabledLabels(seat.page)).some(label => pattern.test(label)), 'Nonowner must not receive private decision controls');
      if (scenario === 'magician_redraw') {
        assert.equal(host.private.chosenRole, 'magician'); assert.equal(host.private.hand.length, 6);
        await h.clickButton(host.page, /^REDRAW SELECTED PLANS$/);
        const choices = (await h.enabledLabels(host.page)).filter(label => /^SELECT\. /.test(label)); assert.equal(choices.length, 6);
        await h.waitUntil(() => host.page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('SELECT.')), 'redraw owns initial hand focus');
        await h.clickButton(host.page, exact(choices[0])); await h.clickButton(host.page, exact(choices[1]));
        await capture(host, 'selected-hand', await frameLabel(host.page, choices[0].replace(/^SELECT\./, 'SELECTED.')));
        await checkSelectedCard(host.page, choices[0].replace(/^SELECT\./, 'SELECTED.'), record, qa);
        await noControls(observer, /^(SELECT\.|REDRAW \d)/); record.privacy.push('Only Magician receives private selection controls');
        const revision = host.public.revision;
        await h.clickButton(host.page, /^CANCEL PLAN SELECTION$/);
        await h.waitUntil(() => host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'REDRAW SELECTED PLANS'), 'redraw cancel restores opener');
        assert.equal(host.public.revision, revision);
        await h.clickButton(host.page, /^REDRAW SELECTED PLANS$/);
        await h.clickButton(host.page, exact(choices[0])); await h.clickButton(host.page, exact(choices[1]));
        const discarded = host.private.hand.slice(0, 2).map(c => c.id);
        await command(host, /^REDRAW 2 PLANS$/);
        assert.equal(host.private.hand.length, 6); assert(discarded.every(id => !host.private.hand.some(c => c.id === id)));
      } else if (scenario === 'warlord_targets') {
        await h.clickButton(host.page, /^DESTROY A DISTRICT$/);
        const all = await labels(host.page);
        assert(all.some(l => /^BISHOP PROTECTED\. Temple,/.test(l)));
        assert(all.some(l => /^KEEP PROTECTED\. Keep,/.test(l)));
        assert(all.some(l => /^COMPLETE CITY\. Tavern,/.test(l)));
        const castle = seats[2].public.players.find(p => p.playerId === seats[2].auth.playerId).city.find(c => c.templateId === 'castle');
        const price = Math.max(0, castle.cost - 1) + 1;
        const choice = (await h.enabledLabels(host.page)).find(l => l.startsWith(`DESTROY · ${price} GOLD. Castle,`)); assert(choice);
        await capture(host, 'great-wall-target', await frameLabel(host.page, choice));
        await noControls(observer, /^DESTROY ·/); record.privacy.push('Public target cities, owner-only destroy controls');
        const gold = own(host).gold;
        await command(host, exact(choice));
        assert.equal(own(host).gold, gold - price);
        assert(!host.public.players.find(p => p.playerId === seats[2].auth.playerId).city.some(c => c.id === castle.id));
      } else if (scenario === 'district_abilities') {
        const count = host.private.hand.length, gold = own(host).gold;
        await h.clickButton(host.page, /^USE LABORATORY$/);
        const choices = (await h.enabledLabels(host.page)).filter(l => /^SELECT\. /.test(l)); assert.equal(choices.length, 5);
        await h.clickButton(host.page, exact(choices[0]));
        await capture(host, 'laboratory-selection', await frameLabel(host.page, choices[0].replace(/^SELECT\./, 'SELECTED.')));
        await checkSelectedCard(host.page, choices[0].replace(/^SELECT\./, 'SELECTED.'), record, qa);
        await noControls(observer, /^(SELECT\.|DISCARD 1 PLAN|USE LABORATORY|USE SMITHY)/);
        await command(host, /^DISCARD 1 PLAN · GAIN 2 GOLD$/);
        assert.equal(host.private.hand.length, count - 1); assert.equal(own(host).gold, gold + 2);
        await command(host, /^USE SMITHY · PAY 2 GOLD$/);
        assert.equal(host.private.hand.length, count + 2); assert.equal(own(host).gold, gold);
        record.privacy.push('Laboratory/Smithy update own hand only; observers receive counts and public city');
      } else if (scenario === 'observatory_draw') {
        assert.equal(host.private.drawnCards.length, 3); assert.equal(host.public.phase, 'choose_cards');
        assert(seats.slice(1).every(s => s.private.drawnCards.length === 0));
        const choice = (await h.enabledLabels(host.page)).find(l => /^KEEP THIS PLAN\./.test(l)); assert(choice);
        await capture(host, 'three-private-draws', await frameLabel(host.page, choice));
        await noControls(observer, /^KEEP THIS PLAN\./); record.privacy.push('Three drawn cards only in owner projection and Keep controls');
        const kept = host.private.drawnCards.find(c => choice.startsWith(`KEEP THIS PLAN. ${c.name},`)); assert(kept);
        const count = host.private.hand.length;
        await command(host, exact(choice));
        assert.equal(host.private.hand.length, count + 1); assert(host.private.hand.some(c => c.id === kept.id)); assert.equal(host.private.drawnCards.length, 0);
      } else if (scenario === 'library_draw') {
        await capture(host, 'keep-all-income');
        const count = host.private.hand.length;
        await noControls(observer, /^DRAW 3 · KEEP ALL$/);
        await command(host, /^DRAW 3 · KEEP ALL$/);
        assert.equal(host.private.hand.length, count + 3); assert.equal(host.private.drawnCards.length, 0); assert.equal(host.public.phase, 'action');
        record.privacy.push('Library adds all three to own hand without exposing a Keep chooser');
      } else if (scenario === 'final_scoring') {
        const choice = (await h.enabledLabels(host.page)).find(l => /^BUILD · \d+ GOLD\. Map Room,/.test(l)); assert(choice);
        await command(host, exact(choice)); assert.equal(own(host).city.length, 7);
        await command(host, /^END CHARACTER TURN$/);
        await h.waitUntil(() => seats.every(s => s.public?.status === 'game_over'), 'canonical final court scored');
        assert(host.public.winnerIds.length > 0);
        for (const score of Object.values(host.public.scoreBreakdowns)) assert.equal(score.total, score.districtPoints + score.diversityBonus + score.completionBonus + score.uniqueBonus);
        record.scoreBreakdowns = host.public.scoreBreakdowns;
        await capture(host, 'final-ledger', '#citadels-game-over');
      } else if (scenario === 'killed_merchant') {
        assert.equal(seats[1].private.chosenRole, 'merchant'); assert.equal(own(seats[1]).revealedRole, null);
        await h.clickButton(host.page, /^NAME A CHARACTER$/); await command(host, /^6 · MERCHANT$/);
        const victim = seats[1];
        await h.waitForText(victim.page, 'Your Merchant was killed by the Assassin.');
        assert.equal(own(victim).revealedRole, null);
        for (const nonowner of seats.filter(s => s !== victim)) {
          assert(!(await nonowner.page.evaluate(() => document.body.innerText)).includes('Your Merchant was killed by the Assassin.'));
          assert(!await nonowner.page.evaluate(() => [...document.querySelectorAll('[aria-label]')].some(n => n.getAttribute('aria-label') === 'Your secret character is Merchant, rank 6.')));
        }
        await noControls(victim, /^(TAKE \d|DRAW \d|BUILD ·|END CHARACTER TURN|COLLECT DISTRICT TAX)/);
        await capture(victim, 'private-killed-notice');
        record.privacy.push('Killed role mark is public; player-role association and skipped-turn copy remain owner-only');
      }
      await qa.capture(observer.page, `${batch}-${scenario}-nonowner.png`, { frame: scenario === 'final_scoring' ? '#citadels-game-over' : '#citadels-decision-heading' });
      assert(seats.every(s => s.rejections.length === 0), 'Fixture actions must remain legal'); qa.persist();
    }
  } finally { for (const seat of seats) await cleanup(seat, qa, api); }
}

async function main() {
  const base = process.env.CITADELS_WEB_URL ?? 'http://127.0.0.1:8081', api = process.env.CITADELS_API_URL ?? 'http://127.0.0.1:3213';
  const outputDir = process.env.CITADELS_FIXTURE_OUTPUT_DIR;
  assert.equal(process.env.CITADELS_UI_EXCLUSIVE_WINDOW, 'granted'); assert.equal(process.env.CITADELS_UI_FIXTURE_RUN, 'true');
  assert(outputDir && !fs.existsSync(outputDir), 'Fresh distinct fixture directory required'); local(base); local(api);
  fs.mkdirSync(outputDir, { recursive: true });
  const qa = createEvidence({ outputDir, base, api });
  qa.evidence.method = 'Separately gated canonical68-district four-seat checkpoints with own-view UI commands, not natural full-game or seven-seat evidence';
  qa.evidence.fixtureCases = []; qa.evidence.gaps = ['This four-seat runner does not execute the separately gated seven-seat layout scenario', 'This runner checks projected privacy and nonowner controls, but does not exhaustively prove private-card artwork DOM absence across every nonowner surface', 'Physical-device and native fontScale behaviour are not covered'];
  let browser, watchdog;
  try {
    const health = await fetch(api, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert.equal((await health.json()).service, 'citadels-local-ui-fixtures', 'Fixture runner refuses ordinary API');
    qa.evidence.bundle = await bundleFence(base + '/citadels', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256); qa.persist();
    assert(/^[A-Za-z0-9+/]{43}=$/.test(process.env.QA_BROWSER_CERT_SPKI ?? ''), 'Current SPKI fingerprint required');
    browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + process.env.QA_BROWSER_CERT_SPKI] });
    watchdog = setTimeout(() => { qa.evidence.watchdogExpired = true; qa.persist(); void browser.close(); }, 20 * 60_000);
    await qa.calibrate(browser);
    await runRoom(browser, qa, base, api, false); await runRoom(browser, qa, base, api, true);
    qa.evidence.finalBundle = await bundleFence(base + '/citadels', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256);
    assert.equal(qa.evidence.blockedRequests.length, 0); assert.equal(h.consoleIssues.length, 0);
    assert.equal(qa.evidence.cleanup.filter(r => r.normalUI && r.status === 200 && r.authCleared).length, 8);
    assert(!qa.evidence.cleanup.some(r => r.fallback || r.error || r.uiError || r.contextError));
    qa.evidence.automationComplete = true;
  } catch (error) {
    qa.evidence.failure = redact(error.stack ?? error.message, [...qa.secrets]); qa.persist();
    throw new Error(redact(error.message, [...qa.secrets]));
  } finally {
    clearTimeout(watchdog);
    try { if (browser) { await browser.close(); qa.evidence.browserClosed = true; } }
    finally { qa.evidence.consoleIssues = h.consoleIssues; qa.persist(); }
  }
  console.log(`CITADELS FIXTURE AUTOMATION COMPLETE: ${outputDir}; review raw captures and findings separately`);
}

module.exports = { names, scenarios, checkProjection, selectedCardDom, assertSelectedCard };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
