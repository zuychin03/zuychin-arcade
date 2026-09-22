const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const h = require('./king-of-tokyo-ui-smoke.cjs');
const { bundleFence, local } = require('./tokyo-ui-evidence.cjs');
const { targetMode, supplementSources, assertComparable, measurePaintedFaces, ownedCommand, finishCommandJournal, createSupplement } = require('./skull-king-fixture-ui.cjs');

const base = process.env.TOKYO_WEB_URL ?? 'http://127.0.0.1:8081';
const api = process.env.TOKYO_API_URL ?? 'http://127.0.0.1:3213';
const names = ['Fixture Host', 'Fixture Second', 'Fixture Third', 'Fixture Fourth', 'Fixture Fifth', 'Fixture Sixth'].map(name => `${name} Longest`.slice(0, 20));
const scenarios = ['bay_occupied', 'mimic_initial', 'mimic_retarget', 'dfa', 'lab', 'opportunist', 'hearts', 'defence', 'rapid_regeneration', 'card_headings'];
const targetScenarios = Object.freeze(['bay_occupied', 'card_headings']);

function measureMarketLayout(collection, compact) {
  const heading = collection.querySelector('[data-testid^="tokyo-power-card-"] [role="heading"]');
  if (!heading) throw Error('Actual market heading is missing');
  return { width: collection.getBoundingClientRect().width, gap: Number.parseFloat(getComputedStyle(collection).columnGap), minimum: compact ? 180 : 240, textScale: Number.parseFloat(getComputedStyle(heading).fontSize) / (compact ? 15 : 17) };
}

function assertMarketPacking({ width, gap, minimum, textScale, boxes }) {
  assert(Number.isFinite(width) && width > 0 && Number.isFinite(gap) && gap >= 0 && Number.isFinite(textScale) && textScale > 0, 'Invalid market layout measurements');
  assert([180, 240].includes(minimum), 'Unknown market card size');
  assert(boxes.length > 0 && boxes.every(box => Number.isFinite(box.top)), 'Market rows are missing');
  const columns = Math.min(boxes.length, Math.max(1, Math.floor((width + gap) / (minimum * Math.max(1, textScale) + gap))));
  for (let i = 1; i < boxes.length; i++) {
    const sameRow = Math.abs(boxes[i].top - boxes[i - 1].top) <= 2;
    assert.equal(sameRow, i % columns !== 0, 'Market cards do not fill the available columns');
    if (!sameRow) assert(boxes[i].top > boxes[i - 1].top, 'Market row order changed');
  }
}

async function captureSizing(seats, scenario, count, record, command, supplement) {
  const [host, observer] = seats;
  const prefix = `${count}p-${scenario}`;
  const pairedAll = () => seats.every(seat => seat.state?.revision === host.state.revision && seat.state.viewerPlayerId === seat.auth.playerId);
  if (scenario === 'bay_occupied') {
    await command(/^ROLL DICE$/, ['roll']);
    assert.equal(host.state.phase, 'choosing_dice');
    const revision = host.state.revision, before = host.acks.length;
    await h.clickButton(host.page, /^Die 1:/);
    await h.waitUntil(() => host.page.$eval('#tokyo-active-dice-tray [aria-label^="Die 1:"]', node => node.getAttribute('aria-pressed') === 'true'), 'Local keep marker');
    assert.equal(host.state.revision, revision); assert.equal(host.acks.length, before);
    await command(/^REROLL \(/, ['set_kept', 'roll']);
    await h.waitUntil(() => host.state.rollCount === 2 && host.state.dice[0].kept && pairedAll(), 'Real kept-dice reroll reaches every owned viewer');
    record.dice = structuredClone(host.state.dice);
    for (const [seat, tray] of [[host, '#tokyo-active-dice-tray'], [observer, '#tokyo-public-dice-tray']]) {
      supplement.proof.profiles.push({ actor: seat.name, viewport: seat.page.viewport(), role: seat === host ? 'active dice owner' : 'public dice observer', count });
      await supplement.frame(seat, prefix + (seat === host ? '-active' : '-public'), tray, () => seat.state.revision, async page => {
        const boxes = await page.$$eval(tray + ' [aria-label^="Die "]', measurePaintedFaces);
        assert.equal(boxes.length, 6); assert.match(boxes[0].label, /kept/); assertComparable(boxes);
        return { tray, boxes };
      }, { publicTable: seat === observer });
    }
  } else {
    assert.equal(scenario, 'card_headings');
    const market = structuredClone(host.state.market);
    assert.deepEqual(market.map(card => card.cardId), ['complete_destruction', 'apartment_building', 'regeneration']);
    const marketSelector = '#king-current-decision [data-testid^="tokyo-power-card-"]';
    supplement.proof.profiles.push({ actor: host.name, viewport: host.page.viewport(), role: 'market buyer', count });
    for (const card of market) {
      await supplement.frame(host, `${prefix}-${card.cardId}`, `[data-testid="tokyo-power-card-${card.instanceId}"]`, () => host.state.revision, async page => {
        const boxes = await page.$$eval(marketSelector, measurePaintedFaces);
        const layout = { ...await page.$eval('#king-current-decision [data-testid="tokyo-power-collection"]', measureMarketLayout, page.viewport().width < 560), boxes };
        (record.marketLayouts ??= []).push(layout); h.qa.persist();
        assert.equal(boxes.length, 3); assertComparable(boxes, true); assertMarketPacking(layout); return layout;
      });
    }
    await command(/^BUY .*: Regeneration$/, ['buy_card']);
    await h.waitUntil(pairedAll, 'Purchase reaches every owned viewer');
    const purchased = host.state.players.find(player => player.playerId === host.auth.playerId).powerCards.find(card => card.instanceId === market[2].instanceId);
    assert.equal(purchased?.cardId, 'regeneration'); record.purchased = { instanceId: purchased.instanceId, cardId: purchased.cardId };
    await supplement.frame(host, prefix + '-owned-regeneration', `[data-testid="tokyo-power-card-${purchased.instanceId}"]`, () => host.state.revision);
  }
}

async function runRoom(browser, count, supplement = null) {
  const seats = [], cases = [];
  try {
    for (let i = 0; i < count; i++) {
      const desktop = count === 6 ? i === 0 : i === 1;
      seats.push(await h.openPlayer(browser, names[i], desktop ? 1280 : 375, 844));
    }
    const host = seats[0], observer = seats[1], own = () => host.state.players.find(p => p.playerId === host.state.viewerPlayerId);
    await host.page.goto(base + '/king-of-tokyo', { waitUntil: 'domcontentloaded' });
    await h.setInput(host.page, 'Your name', host.name); await h.clickButton(host.page, /^CREATE ROOM$/);
    await h.waitForPath(host.page, '/king-of-tokyo/lobby');
    const code = await host.page.evaluate(() => document.body.innerText.match(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/)?.[0]);
    assert(code);
    for (const seat of seats.slice(1)) await h.joinPlayer(seat, code, '');
    await h.clickButton(host.page, /^START GAME$/);
    await Promise.all(seats.map(seat => h.waitForPath(seat.page, '/king-of-tokyo/game')));
    for (const scenario of supplement ? targetScenarios : scenarios) {
      const response = await fetch(api + '/__qa/king-of-tokyo-fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomCode: code, scenario }), redirect: 'error', signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200);
      const value = await response.json(); assert.equal(value.canonicalCards, 66);
      await h.waitUntil(() => seats.every(s => s.state?.revision === value.revision && s.state?.viewerPlayerId === s.auth?.playerId), 'fresh viewer-owned fixture frames');
      const record = { count, scenario, fixtureRevision: value.revision, canonicalCards: value.canonicalCards, commands: [] };
      if (supplement) record.ackStart = host.acks.length;
      cases.push(record); h.qa.evidence.fixtureCases = [...(h.qa.evidence.fixtureCases ?? []), record]; h.qa.persist();
      async function command(pattern, actions) {
        if (supplement) return ownedCommand({ seat: host, pattern, actions, revision: () => host.state.revision, paired: revision => seats.every(seat => seat.state?.revision === revision && seat.state.viewerPlayerId === seat.auth.playerId), click: h.clickButton, wait: h.waitUntil, record, persist: h.qa.persist });
        const before = host.acks.length, revision = host.state.revision;
        await h.clickButton(host.page, pattern);
        await h.waitUntil(() => host.acks.length > before && host.state.revision >= host.acks.at(-1).revision, 'accepted owned fixture command');
        const ack = host.acks.at(-1); assert(ack.revision > revision); record.commands.push(ack); h.qa.persist();
      }
      if (scenario === 'bay_occupied') {
        assert.equal(host.state.players.filter(p => p.tokyoZone).length, 2);
        const arena = await host.page.$('[aria-label^="Tokyo arena,"]'); assert(arena);
        const label = await arena.evaluate(n => n.getAttribute('aria-label')); assert.match(label, /capacity 2/); await arena.dispose();
        record.arena = label;
      }
      if (supplement) {
        await captureSizing(seats, scenario, count, record, command, supplement);
        finishCommandJournal(host, record);
        assert(seats.every(seat => seat.rejects.length === 0), 'Targeted fixture command rejection');
        h.qa.persist(); continue;
      }
      if (scenario === 'mimic_retarget') await h.clickButton(host.page, /^CHOOSE COPY: Mimic$/);
      if (scenario === 'hearts') { await h.clickButton(host.page, new RegExp(`^HEAL ${names[1]}$`)); await h.clickButton(host.page, /^Increase poison tokens$/); }
      if (scenario === 'defence') { await h.clickButton(host.page, /^Die 1:/); await h.clickButton(host.page, /^Die 2:/); }
      if (scenario === 'rapid_regeneration') await h.clickButton(host.page, /^Increase rapid healing activations$/);
      const frame = scenario === 'bay_occupied' ? '[aria-label^="Tokyo arena,"]' : '#king-current-decision';
      await h.qa.capture(host.page, `${count}p-${scenario}-normal.png`, { frame });
      await h.qa.capture(host.page, `${count}p-${scenario}-text200.png`, { scale: true, frame });
      if (scenario === 'rapid_regeneration') {
        const off = '#tokyo-preferences [aria-label="OFF"]';
        await h.qa.capture(host.page, `${count}p-rapid-preferences-normal.png`, { frame: off });
        await h.qa.capture(host.page, `${count}p-rapid-preferences-text200.png`, { scale: true, frame: off });
      }
      if (count === 5 && ['bay_occupied', 'card_headings'].includes(scenario)) {
        const viewport = host.page.viewport();
        try { await host.page.setViewport({ ...viewport, width: 320 }); await h.qa.capture(host.page, `${count}p-${scenario}-320-text200.png`, { scale: true, frame }); }
        finally { await host.page.setViewport(viewport); }
      }
      if (['card_headings', 'mimic_retarget', 'lab', 'opportunist'].includes(scenario)) {
        const wanted = scenario === 'mimic_retarget' ? own().powerCards.find(c => c.cardId === 'mimic').instanceId : scenario === 'lab' ? host.state.labCard.instanceId : scenario === 'opportunist' ? host.state.pendingOpportunistCardInstanceId : host.state.market[0].instanceId;
        if (scenario === 'opportunist') {
          assert.equal(host.state.pendingOpportunistPlayerId, host.state.viewerPlayerId);
          assert.equal(host.state.market.find(c => c?.instanceId === wanted)?.cardId, 'complete_destruction');
        }
        const card = await host.page.$(`#king-current-decision [data-testid="tokyo-power-card-${wanted}"]`);
        assert(card, 'Owned decision must expose an actual power card wrapper');
        const testID = await card.evaluate(n => n.getAttribute('data-testid')); await card.dispose();
        const cardSelector = `#king-current-decision [data-testid="${testID}"]`;
        if (scenario === 'opportunist') {
          await h.qa.capture(host.page, `${count}p-${scenario}-card-top-normal.png`, { frame: cardSelector, frameAlign: 'start' });
          await h.qa.capture(host.page, `${count}p-${scenario}-card-bottom-normal.png`, { frame: cardSelector, frameAlign: 'end' });
        }
        await h.qa.capture(host.page, `${count}p-${scenario}-card-top-text200.png`, { scale: true, frame: cardSelector, frameAlign: 'start' });
        await h.qa.capture(host.page, `${count}p-${scenario}-card-bottom-text200.png`, { scale: true, frame: cardSelector, frameAlign: 'end' });
      }
      if (scenario === 'mimic_initial') {
        const target = own().powerCards.find(c => c.cardId === 'acid_attack');
        await command(new RegExp(`^COPY ${names[0]} · Acid Attack$`));
        assert.equal(own().powerCards.find(c => c.cardId === 'mimic').mimicTargetInstanceId, target.instanceId);
      } else if (scenario === 'mimic_retarget') {
        await h.clickButton(host.page, /^CANCEL MIMIC SELECTION: Mimic$/);
        record.cancelFocus = await host.page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
        assert.equal(record.cancelFocus, 'CHOOSE COPY: Mimic');
        await h.clickButton(host.page, /^CHOOSE COPY: Mimic$/); await command(new RegExp(`^${names[0]} · Acid Attack$`));
      } else if (scenario === 'dfa') {
        await command(/^BUY .*: Death from Above$/); assert.equal(own().victoryPoints, 3); assert.equal(own().tokyoZone, 'tokyo_city'); assert.equal(host.state.players.filter(p => p.tokyoZone).length, 1);
      } else if (scenario === 'lab') {
        assert.equal(host.state.labCard.cardId, 'heal'); assert(seats.slice(1).every(s => s.state.labCard === null));
        for (const seat of seats.slice(1)) assert(!(await h.buttonLabels(seat.page)).includes('BUY PRIVATE TOP CARD: Heal'));
        await h.qa.capture(observer.page, `${count}p-lab-nonowner.png`, { frame: '#tokyo-table-state', publicTable: true });
        const revision = host.state.revision; host.state = null;
        await host.page.reload({ waitUntil: 'domcontentloaded' });
        await h.waitUntil(() => host.state?.revision === revision && host.state.viewerPlayerId === host.auth.playerId, 'Lab owner reload');
        assert.equal(host.state.labCard.cardId, 'heal'); await command(/^BUY PRIVATE TOP CARD: Heal$/); assert.equal(own().health, 9);
        record.privateOfferReload = true;
      } else if (scenario === 'opportunist') {
        const instanceId = host.state.pendingOpportunistCardInstanceId;
        await command(/^BUY WITH OPPORTUNIST$/);
        assert(own().powerCards.some(card => card.cardId === 'complete_destruction' && card.instanceId === instanceId));
        record.purchasedCard = { cardId: 'complete_destruction', instanceId };
      } else if (scenario === 'hearts') {
        await command(/^CONFIRM HEARTS$/); assert.equal(own().poisonTokens, 0); assert.equal(own().health, 9);
      } else if (scenario === 'defence') {
        await command(/^CHANGE 2 TO HEART · 4 ENERGY$/); assert.equal(own().health, 10); assert.equal(own().energy, 16);
      } else if (scenario === 'rapid_regeneration') {
        assert.equal(host.state.pendingDefenseDecision.healingPerActivation, 2);
        await command(/^HEAL 2 · 2 ENERGY$/); assert.equal(own().health, 3); assert.equal(own().energy, 4);
      }
      h.qa.persist();
    }
    assert(seats.every(s => s.rejects.length === 0), 'Fixture action rejection');
    return cases;
  } finally {
    for (const seat of seats) await h.cleanupPlayer(seat).catch(error => { h.qa.evidence.cleanup.push({ actor: seat.name, failed: error.message }); h.qa.persist(); });
    for (const seat of seats) await seat.context.close();
  }
}

async function main() {
  const targeted = targetMode(process.env.TOKYO_UI_FIXTURE_TARGET);
  assert.equal(process.env.TOKYO_UI_EXCLUSIVE_WINDOW, 'granted');
  assert.equal(process.env.TOKYO_UI_FIXTURE_RUN, 'true');
  assert(process.env.TOKYO_UI_OUTPUT_DIR, 'Distinct fixture output required'); local(base); local(api);
  assert(!fs.existsSync(path.join(process.env.TOKYO_UI_OUTPUT_DIR, 'receipt.json')), 'Fresh fixture output required');
  const health = await (await fetch(api, { redirect: 'error' })).json();
  assert.equal(health.service, 'king-of-tokyo-local-ui-fixtures', 'Fixture runner refuses ordinary API');
  const expected = process.env.QA_EXPECTED_WEB_SHA256;
  h.qa.evidence.bundle = await bundleFence(base, process.env.QA_STATIC_ROOT, expected);
  h.qa.evidence.method = 'Separately gated canonical66-card five/six-seat checkpoints with normal UI commands, not natural gameplay'; h.qa.persist();
  const supplement = targeted ? createSupplement(h.qa, 64) : null;
  if (targeted) { h.qa.evidence.sourceHashes = supplementSources(); h.qa.persist(); }
  const browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--ignore-certificate-errors-spki-list=' + process.env.QA_BROWSER_CERT_SPKI] });
  const watchdog = targeted ? setTimeout(() => { h.qa.evidence.timeout = '20-minute targeted fixture bound'; h.qa.persist(); void browser.close(); }, 20 * 60 * 1000) : null;
  try {
    await h.qa.calibrate(browser);
    await runRoom(browser, 5, supplement); await runRoom(browser, 6, supplement);
    h.qa.evidence.finalBundle = await bundleFence(base, process.env.QA_STATIC_ROOT, expected);
    if (targeted) { supplement.finish(24); assert.equal(h.qa.evidence.fixtureCases.length, 4); h.qa.evidence.finalSourceHashes = supplementSources(); assert.deepEqual(h.qa.evidence.finalSourceHashes, h.qa.evidence.sourceHashes); }
    assert.equal(h.qa.evidence.visualFindings.length, 0, 'Fixture visual findings retained');
    assert.equal(h.qa.evidence.blockedRequests.length, 0);
    assert.equal(h.qa.evidence.consoleIssues.length, 0);
    assert.equal(h.qa.evidence.cleanup.length, 11); assert(h.qa.evidence.cleanup.every(c => c.normalUI && c.status === 200 && c.authCleared));
    h.qa.evidence.passed = true;
  } catch (error) { h.qa.evidence.error = error.message; h.qa.evidence.passed = false; throw error; }
  finally { clearTimeout(watchdog); await browser.close(); h.qa.evidence.browserClosed = true; h.qa.persist(); }
}
module.exports = { scenarios, targetScenarios, captureSizing, targetMode, measureMarketLayout, assertMarketPacking };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
