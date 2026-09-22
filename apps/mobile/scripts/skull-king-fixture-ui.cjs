const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const h = require('./skull-king-ui-smoke.cjs');
const { local, bundleFence, redact } = require('./skull-ui-evidence.cjs');
const { createHash } = require('node:crypto');
const textProof = require('./libertalia-ui-primitives.cjs');

const base = process.env.SKULL_KING_WEB_URL ?? 'http://127.0.0.1:8081';
const api = process.env.SKULL_KING_API_URL ?? 'http://127.0.0.1:3213';
const names = ['Fixture Host', 'Fixture Second', 'Fixture Third', 'Fixture Fourth', 'Fixture Fifth', 'Fixture Sixth', 'Fixture Seventh', 'Fixture Eighth'];
const scenarios = ['tigress_follow', 'character_lead', 'royal_bonus', 'royal_terminal', 'eight_final_tie'];
let qa;

function targetMode(value) {
  assert(value === undefined || value === 'card-sizing', 'Unknown fixture target; use card-sizing or omit it');
  return value === 'card-sizing';
}

function supplementSources() {
  const root = path.resolve(__dirname, '../../..');
  const folders = ['apps/mobile/app', 'apps/mobile/components', 'apps/mobile/hooks', 'apps/mobile/lib', 'apps/mobile/store', 'apps/mobile/constants', 'apps/mobile/assets/game-art', 'packages/types/src', 'apps/server/src', 'apps/server/scripts/king-of-tokyo', 'apps/server/scripts/skull-king'];
  const files = ['apps/mobile/global.css', ...['king-of-tokyo-fixture-ui', 'skull-king-fixture-ui', 'king-of-tokyo-ui-smoke', 'skull-king-ui-smoke', 'tokyo-ui-evidence', 'skull-ui-evidence', 'libertalia-ui-primitives'].map(name => `apps/mobile/scripts/${name}.cjs`), ...['king-of-tokyo-fixture-ui', 'skull-king-fixture-ui'].map(name => `apps/mobile/scripts/${name}.test.cjs`)];
  const walk = folder => {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const file = folder + '/' + entry.name;
      if (entry.isDirectory()) walk(file); else files.push(file);
    }
  };
  folders.forEach(walk);
  return Object.fromEntries([...new Set(files)].sort().map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
}

function assertComparable(boxes, equalWidths = false) {
  assert(boxes.length > 1 && boxes.every(box => box.width > 0 && box.height > 0), 'Comparable collection is missing faces');
  if (equalWidths) assert(Math.max(...boxes.map(b => b.width)) - Math.min(...boxes.map(b => b.width)) <= 2, 'Trailing card width differs');
  for (const box of boxes) {
    const row = boxes.filter(other => Math.abs(other.top - box.top) <= 2);
    assert(Math.max(...row.map(b => b.bottom)) - Math.min(...row.map(b => b.bottom)) <= 2, 'Comparable row faces have unequal heights');
    assert(box.scrollWidth <= box.clientWidth + 2, 'Card content overflows horizontally');
  }
}

function measurePaintedFaces(nodes) {
  const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width, height: r.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }; };
  return nodes.map(node => {
    const surface = node.firstElementChild, edge = surface?.children[0], face = surface?.children[1];
    if (!surface || !edge || !face || surface.children.length !== 2 || getComputedStyle(edge).position !== 'absolute' || getComputedStyle(face).overflow !== 'hidden') throw Error('Expected canonical CardSurface edge/painted-face structure');
    return { id: node.getAttribute('data-testid'), label: node.getAttribute('aria-label'), text: node.textContent, wrapper: rect(node), ...rect(face) };
  });
}

function assertAckDelta(delta, actions, revision) {
  assert.equal(delta.length, actions.length, 'Unexpected acknowledgement count');
  assert.deepEqual(delta.map(ack => ack.action), actions, 'Unexpected acknowledgement action');
  delta.forEach((ack, index) => assert.equal(ack.revision, revision + index + 1, 'Unexpected acknowledgement revision'));
}

async function ownedCommand({ seat, pattern, actions, revision, paired, click, wait, record, persist }) {
  const before = seat.acks.length, startRevision = revision();
  const attempt = { control: String(pattern), expectedActions: actions, beforeRevision: startRevision, rawDelta: [] };
  (record.commandAttempts ??= []).push(attempt);
  try {
    await click(seat.page, pattern);
    await wait(() => {
      const delta = seat.acks.slice(before);
      if (delta.length < actions.length) return false;
      assertAckDelta(delta, actions, startRevision);
      return paired(delta.at(-1).revision);
    }, 'Exactly one matching acknowledgement per expected command, then fresh owned state');
    const delta = seat.acks.slice(before); assertAckDelta(delta, actions, startRevision);
    record.commands.push(...delta);
  } finally { attempt.rawDelta = structuredClone(seat.acks.slice(before)); attempt.afterRevision = revision(); persist(); }
}

function finishCommandJournal(seat, record) {
  record.rawAcknowledgements = structuredClone(seat.acks.slice(record.ackStart));
  assert.deepEqual(record.rawAcknowledgements, record.commands, 'Late, duplicate or unaccounted acknowledgement');
}

function createSupplement(recorder, cap, dependencies = textProof) {
  const proof = { natural: false, cap, captures: 0, frames: [], geometry: [], profiles: [], method: 'Seeded canonical checkpoint, real browser controls, full changed faces and labels. CSS200 is synthetic text scaling, not native fontScale.' };
  recorder.evidence.supplement = proof;
  async function frame(seat, name, selector, revision, inspect = null, { publicTable = false } = {}) {
    const page = seat.page;
    const proofRevision = revision();
    for (const scale of [false, true]) {
      const records = [];
      try {
        if (scale) await dependencies.enlargeLibertaliaText(page);
        for (const align of ['start', 'end']) {
          assert(proof.captures < cap, 'Supplement capture cap exhausted');
          assert.equal(await page.$$eval(selector, nodes => nodes.length), 1, 'Frame selector must be unique');
          await page.$eval(selector, (node, block) => node.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' }), align);
          const visible = await page.$eval(selector, dependencies.frameVisibility);
          await page.$eval(selector, (node, { visible, align }) => {
            const box = node.getBoundingClientRect(), delta = align === 'start' ? box.top - visible.top : box.bottom - visible.bottom;
            for (let owner = node.parentElement; owner; owner = owner.parentElement) {
              if (/(auto|scroll)/.test(getComputedStyle(owner).overflowY) && owner.scrollHeight > owner.clientHeight) { owner.scrollTop += delta; return; }
            }
            window.scrollBy(0, delta);
          }, { visible, align });
          const original = page.screenshot;
          let measured, beforeFonts, afterFonts;
          page.screenshot = async function (...args) {
            assert.equal(revision(), proofRevision, 'Fixture state changed before screenshot');
            if (scale) { beforeFonts = await page.evaluate(dependencies.readLibertaliaFontState); dependencies.validateLibertaliaFontState(beforeFonts); }
            measured = { frame: await page.$eval(selector, node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; }), frameVisibleBounds: await page.$eval(selector, dependencies.frameVisibility) };
            const result = await original.apply(this, args);
            if (scale) { afterFonts = await page.evaluate(dependencies.readLibertaliaFontState); dependencies.validateLibertaliaFontState(afterFonts); }
            assert.equal(revision(), proofRevision, 'Fixture state changed during screenshot');
            return result;
          };
          let record;
          try { proof.captures++; record = await recorder.capture(page, `${name}-${scale ? 200 : 100}-${align}.png`, { publicTable }); }
          finally { page.screenshot = original; }
          Object.assign(record.metrics, measured, scale ? { textScaleState: afterFonts, preCaptureTextScaleState: beforeFonts } : {});
          record.scale = scale ? 200 : 100;
          record.fixtureSelector = selector;
          const attempt = recorder.evidence.attempts?.find(item => item.file === record.file);
          if (attempt) attempt.scale = record.scale;
          records.push(record);
          if (inspect) proof.geometry.push({ file: record.file, ...(await inspect(page)) });
          try { dependencies.assertFrameCoverage(records); break; } catch (error) { if (align === 'end') throw error; }
        }
        proof.frames.push({ name, scale: scale ? 200 : 100, revision: revision(), ...dependencies.assertFrameCoverage(records) });
        recorder.persist();
      } finally { if (scale) await dependencies.restoreLibertaliaText(page); }
    }
  }
  function finish(expectedFrames) {
    assert.equal(proof.frames.length, expectedFrames, 'Incomplete planned frame inventory');
    assert(proof.captures <= cap);
    const records = recorder.evidence.captures;
    assert(records.every(record => !(record.metrics?.privacyGaps?.length || record.metrics?.selectorGaps?.length)), 'Capture privacy or selector gap');
    recorder.persist();
  }
  return { proof, frame, finish };
}

function paired(seat, revision) {
  return seat.auth && seat.public?.revision === revision && seat.private?.revision === revision
    && seat.public.roomCode === seat.auth.roomCode && seat.private.roomCode === seat.auth.roomCode
    && seat.private.playerId === seat.auth.playerId;
}

async function capturePair(seat, name, frame) {
  await qa.capture(seat.page, name + '-normal.png', { frame });
  await qa.capture(seat.page, name + '-text200.png', { frame, scale: true });
}

async function runRoom(browser, count, supplement = null) {
  const seats = [];
  try {
    for (let i = 0; i < count; i++) {
      const desktop = count === 8 ? i === 0 : i === 1;
      seats.push(await h.openPlayer(browser, names[i], desktop ? 1280 : 375, 900));
    }
    const host = seats[0];
    await host.page.goto(base + '/skull-king', { waitUntil: 'domcontentloaded' });
    await h.setInput(host.page, 'Your name', host.name);
    await h.clickButton(host.page, /^CREATE ROOM$/);
    await h.waitForPath(host.page, '/skull-king/lobby'); await qa.ready(host.page);
    const code = host.auth.roomCode;
    for (const seat of seats.slice(1)) await h.joinPlayer(seat, code, '');
    await h.clickButton(host.page, /^START GAME$/);
    await Promise.all(seats.map(s => h.waitForPath(s.page, '/skull-king/game')));
    await Promise.all(seats.map(s => qa.ready(s.page)));
    for (const scenario of supplement ? ['royal_bonus'] : scenarios.filter(s => (s === 'eight_final_tie') === (count === 8))) {
      const response = await fetch(api + '/__qa/skull-king-fixture', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomCode: code, scenario }),
        redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 200);
      const checkpoint = await response.json(); assert.equal(checkpoint.canonicalCards, 70);
      await h.waitUntil(() => seats.every(s => paired(s, checkpoint.revision)), 'Every fixture viewer has its own fresh pair');
      const record = { scenario, count, revision: checkpoint.revision, canonicalCards: checkpoint.canonicalCards, commands: [] };
      if (supplement) record.ackStart = host.acks.length;
      qa.evidence.fixtureCases.push(record); qa.persist();
      assert.equal(host.public.currentPlayerId, host.auth.playerId);
      assert(seats.slice(1).every(s => s.private.legalCardIds.length === 0), 'Only the acting owner has legal cards');
      if (supplement) {
        assert.equal(host.public.currentTrick.length, 3);
        record.publicCards = structuredClone(host.public.currentTrick);
        for (const seat of seats.slice(0, 2)) {
          supplement.proof.profiles.push({ actor: seat.name, viewport: seat.page.viewport(), role: 'public-trick viewer' });
          for (const card of host.public.currentTrick) {
            const selector = `[data-skull-qa-entry="${card.playerId}"]`;
            await seat.page.$eval(`#skull-trick-owner-${card.playerId}`, (node, id) => node.parentElement.setAttribute('data-skull-qa-entry', id), card.playerId);
            const owner = host.public.players.find(player => player.playerId === card.playerId);
            assert(owner);
            assert.equal(await seat.page.$eval(`#skull-trick-owner-${card.playerId}`, node => node.textContent), owner.displayName);
            await supplement.frame(seat, `${seat === host ? 'phone' : 'desktop'}-public-${card.id}`, selector, () => seat.public.revision, async page => {
              const boxes = await page.$$eval('#skull-current-trick [data-testid^="skull-card-"]', measurePaintedFaces);
              assertComparable(boxes); assert(Math.max(...boxes.map(box => box.height)) - Math.min(...boxes.map(box => box.height)) <= 2, 'Public trick face heights differ'); return { boxes };
            });
          }
        }
      } else {
        await capturePair(host, `${count}p-${scenario}-decision`, '#skull-decision-area');
        await capturePair(host, `${count}p-${scenario}-public-trick`, '#skull-current-trick');
      }
      record.artwork = await host.page.evaluate(() => [...document.querySelectorAll('[data-testid^="skull-card-"]')].map(n => ({ card: n.getAttribute('data-testid'), images: [...n.querySelectorAll('img')].map(image => ({ source: new URL(image.currentSrc || image.src).pathname, loaded: image.complete && image.naturalWidth > 0 })) })));
      for (const face of record.artwork) {
        const id = face.card.slice('skull-card-'.length), kind = id === 'skull-king' ? 'skull_king' : id.replace(/-\d+$/, '');
        if (['pirate', 'tigress', 'skull_king', 'mermaid', 'escape'].includes(kind)) {
          assert(face.images.some(image => image.loaded && image.source.includes('skull-special-' + kind)), `Printed kind artwork mismatch for ${id}`);
        } else assert.equal(face.images.length, 0, 'Numbered suit/rank cards must not borrow character artwork');
      }
      async function command(pattern) {
        if (supplement) return ownedCommand({ seat: host, pattern, actions: ['play'], revision: () => host.public.revision, paired: revision => seats.every(seat => paired(seat, revision)), click: h.clickButton, wait: h.waitUntil, record, persist: qa.persist });
        const before = host.acks.length, revision = host.public.revision;
        await h.clickButton(host.page, pattern);
        await h.waitUntil(() => host.acks.length > before && paired(host, host.acks.at(-1).revision), 'Owned fixture command acknowledged and paired');
        const ack = host.acks.at(-1); assert.equal(ack.action, 'play'); assert(ack.revision > revision);
        record.commands.push(ack); qa.persist();
      }
      if (scenario === 'tigress_follow') {
        assert.deepEqual([...host.private.legalCardIds].sort(), ['green-1', 'tigress']);
        const before = host.public.revision;
        await h.clickButton(host.page, /^Play Tigress$/);
        await h.waitForText(host.page, 'PLAY AS PIRATE');
        await capturePair(host, 'tigress-pirate-choice', '#skull-king-tigress-choice');
        await host.page.keyboard.press('Escape');
        await h.waitUntil(() => host.page.evaluate(() => !document.getElementById('skull-king-tigress-choice')), 'Tigress cancelled without commit');
        assert.equal(host.public.revision, before); assert(host.private.hand.some(c => c.id === 'tigress'));
        record.cancelFocus = await host.page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
        assert.equal(record.cancelFocus, 'Play Tigress');
        await h.clickButton(host.page, /^Play Tigress$/); await command(/^PLAY AS PIRATE$/);
        assert.equal(host.public.lastTrick.cards.find(c => c.id === 'tigress')?.tigressMode, 'pirate');
        assert.equal(host.public.lastTrick.winnerId, seats[3].auth.playerId);
        record.publicResolvedMode = 'pirate';
      } else if (scenario === 'character_lead') {
        assert.deepEqual([...host.private.legalCardIds].sort(), ['green-1', 'yellow-14']);
        await command(/^Play yellow 14$/);
        assert.equal(host.public.currentTrick.at(-1).id, 'yellow-14');
        record.offSuitAfterCharacterLead = true;
      } else if (scenario === 'royal_bonus' || scenario === 'royal_terminal') {
        await command(/^Play Mermaid$/);
        const scored = host.public.scoreHistory.at(-1).players.find(p => p.playerId === host.auth.playerId);
        assert.equal(scored.baseScore, 20); assert.equal(scored.bonus, 50); assert.equal(scored.roundScore, 70);
        record.score = scored;
        if (scenario === 'royal_terminal') {
          assert.equal(host.public.status, 'game_over'); assert.equal(host.public.terminationReason, null);
          assert.deepEqual(host.public.winnerIds, [host.auth.playerId]); assert.equal(scored.totalScore, 270);
          record.terminal = structuredClone(host.public);
          for (const seat of seats.slice(0, 2)) {
            const prefix = seat === host ? 'phone' : 'desktop';
            await capturePair(seat, `royal-terminal-${prefix}-summary`, '#skull-result-summary');
            await capturePair(seat, `royal-terminal-${prefix}-roster`, '#skull-result-roster');
          }
          await h.clickButton(host.page, /^Show completed-round scorecard$/, 45000, '#skull-king-game-over');
          await h.waitForText(host.page, 'Round score = base + awarded bonus.');
          for (const frameAlign of ['start', 'end']) await qa.capture(host.page, `royal-terminal-awarded-bonus-${frameAlign}-text200.png`, { frame: '#skull-king-game-over [data-testid="skull-score-ledger"]', scale: true, frameAlign });
        } else {
          assert.equal(host.public.phase, 'bidding'); assert.equal(host.public.roundNumber, 2);
          if (!supplement) await capturePair(host, 'royal-bonus-next-round', '#skull-scoreboard');
        }
      } else {
        await command(/^Play black 14$/);
        assert.equal(host.public.phase, 'bidding'); assert.equal(host.public.roundNumber, 11);
        assert.equal(host.public.cardsPerPlayer, 8); assert.equal(host.public.scoreHistory.at(-1).cardsPerPlayer, 8);
        await h.waitUntil(() => seats.every(s => paired(s, host.public.revision)), 'Eight-seat tie continuation paired');
        assert(seats.every(s => s.private.hand.length === 8));
        assert(host.public.players.every(p => p.bid === null), 'New tiebreak bids stay hidden');
        record.round11 = { roundNumber: host.public.roundNumber, cardsPerPlayer: host.public.cardsPerPlayer, hiddenBids: true, scoreHistory: host.public.scoreHistory };
        await capturePair(host, 'eight-seat-capped-tiebreak-desktop', '#skull-decision-area');
        await capturePair(seats[1], 'eight-seat-capped-tiebreak-phone', '#skull-decision-area');
        await h.exerciseHandRail(seats[1], 'eight-seat-hand');
        await h.exerciseHandRail(seats[1], 'eight-seat-hand-text200', false, { scale: true });
      }
      if (supplement) { await qa.ready(host.page); finishCommandJournal(host, record); }
      assert(seats.every(s => s.rejections.length === 0), 'Fixture command rejection'); qa.persist();
    }
  } finally {
    for (const seat of [...seats].reverse()) {
      try { await h.cleanupPlayer(seat); }
      catch (error) {
        qa.evidence.cleanup.push({ actor: seat.name, failed: redact(error.message, [...qa.secrets]) });
        try {
          const auth = await seat.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null')).catch(() => seat.auth);
          if (auth?.token) {
            seat.fallbackCleanup = true;
            const response = await fetch(api + '/rooms/' + encodeURIComponent(auth.roomCode) + '/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.token }, redirect: 'error', signal: AbortSignal.timeout(10000) });
            qa.evidence.cleanup.push({ actor: seat.name, fallback: true, normalUI: false, status: response.status });
          }
        } catch (fallback) { qa.evidence.cleanup.push({ actor: seat.name, error: redact(fallback.message, [...qa.secrets]) }); }
      }
      try { await seat.context.close(); } catch (error) { qa.evidence.cleanup.push({ actor: seat.name, contextError: error.message }); }
      qa.persist();
    }
  }
}

async function main() {
  const targeted = targetMode(process.env.SKULL_UI_FIXTURE_TARGET);
  assert.equal(process.env.SKULL_UI_EXCLUSIVE_WINDOW, 'granted'); assert.equal(process.env.SKULL_UI_FIXTURE_RUN, 'true');
  const outputDir = process.env.SKULL_KING_UI_OUTPUT_DIR;
  assert(outputDir, 'Fresh explicit fixture output directory required'); assert(!fs.existsSync(path.join(outputDir, 'receipt.json')));
  local(base); local(api);
  const certificate = process.env.QA_BROWSER_CERT_SPKI; assert.match(certificate ?? '', /^[A-Za-z0-9+/]{43}=$/);
  qa = h.configureEvidence({ outputDir, base, api });
  qa.evidence.method = 'Separately gated canonical70-card checkpoints followed by owned browser commands. Not natural voyages or independent manual play.';
  qa.evidence.fixtureCases = []; qa.evidence.handRails = []; qa.persist();
  const supplement = targeted ? createSupplement(qa, 32) : null;
  if (targeted) { qa.evidence.sourceHashes = supplementSources(); qa.persist(); }
  let browser, watchdog;
  try {
    const health = await fetch(api, { redirect: 'error', signal: AbortSignal.timeout(10000) }); assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'skull-king-local-ui-fixtures', 'Fixture runner refuses ordinary API');
    qa.evidence.bundle = await bundleFence(base + '/skull-king', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256);
    browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--disable-background-timer-throttling', '--ignore-certificate-errors-spki-list=' + certificate] });
    watchdog = setTimeout(() => { qa.evidence.timeout = '20-minute fixture bound'; qa.persist(); void browser.close(); }, 20 * 60 * 1000);
    await qa.calibrate(browser); await runRoom(browser, 4, supplement); if (!targeted) await runRoom(browser, 8);
    qa.evidence.finalBundle = await bundleFence(base + '/skull-king', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256);
    if (targeted) { supplement.finish(12); qa.evidence.finalSourceHashes = supplementSources(); assert.deepEqual(qa.evidence.finalSourceHashes, qa.evidence.sourceHashes); }
    assert.equal(qa.evidence.fixtureCases.length, targeted ? 1 : 5);
    assert.equal(qa.evidence.findings.length, 0, 'Fixture visual findings are retained');
    assert.equal(qa.evidence.blockedRequests.length, 0); assert.equal(h.consoleIssues.length, 0);
    assert.equal(qa.evidence.cleanup.length, targeted ? 4 : 12); assert(qa.evidence.cleanup.every(c => c.normalUI && c.status === 200 && c.authCleared));
    qa.evidence.passed = true;
  } catch (error) { qa.evidence.failure = redact(error.stack ?? error.message, [...qa.secrets]); qa.evidence.passed = false; throw error; }
  finally {
    clearTimeout(watchdog);
    try { if (browser) { await browser.close(); qa.evidence.browserClosed = true; } }
    finally { qa.evidence.consoleIssues = h.consoleIssues; qa.persist(); }
  }
}

module.exports = { paired, scenarios, targetMode, supplementSources, assertComparable, measurePaintedFaces, assertAckDelta, ownedCommand, finishCommandJournal, createSupplement };
if (require.main === module) main().catch(error => { console.error(redact(error.stack ?? error.message, [...qa?.secrets ?? []])); process.exitCode = 1; });
