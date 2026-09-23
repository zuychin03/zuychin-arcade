const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const variant = process.env.COUP_UI_VARIANT ?? 'reformation';
assert(['base', 'reformation'].includes(variant));
assert(process.env.COUP_EVIDENCE_DIR, 'Explicit fresh evidence directory required');
assert(process.env.COUP_UI_EXCLUSIVE_WINDOW === 'granted', 'Exclusive browser ownership required');
assert(process.env.QA_BROWSER_CERT_SPKI, 'Local certificate pin required');
const output = path.resolve(process.env.COUP_EVIDENCE_DIR);
assert(!fs.existsSync(output), 'Preserve previous evidence; choose a fresh directory');
const qa = require('./coup-ui-smoke.cjs');
const { actor, click, input, capture, paired, until, evidence, decision, action } = qa;
const origin = process.env.COUP_WEB_URL ?? 'http://127.0.0.1:8081';
const persist = () => fs.writeFileSync(path.join(output, 'receipt.json'), qa.sanitise(JSON.stringify(evidence, null, 2)));
const seats = [];
const covered = new Set();
const phases = new Set();
Object.assign(evidence, { variant, coverage: 'One natural four-browser-seat match, version selection, lobby, owner-only choices, rematch and normal exit. Browser emulation is not native-device evidence.' });

async function pairedTable() {
  await until(() => seats.every(paired) && new Set(seats.map(seat => seat.public.revision)).size === 1, 'matching room/player/revision pairs');
  for (const seat of seats) {
    const pending = seat.public.pending;
    assert(!seat.public.players.some(player => 'influences' in player));
    assert(!('examineCharacter' in pending) && !('exchangePool' in pending));
    if (pending.phase !== 'awaiting_examine' || pending.actorId !== seat.private.playerId) assert.equal(seat.private.examine, null);
    if (pending.phase !== 'awaiting_exchange' || pending.actorId !== seat.private.playerId) assert.equal(seat.private.exchange, null);
  }
}

function eligibleTargets(state, own) {
  const living = state.players.filter(player => !player.eliminated && !player.forfeited);
  const united = new Set(living.map(player => player.allegiance)).size === 1;
  return living.filter(player => player.playerId !== own.playerId && (state.variant === 'base' || united || player.allegiance !== own.allegiance));
}

async function decisionCapture(seat, name, label, scale = 100) {
  if (covered.has(name)) return;
  const revision = seat.public.revision;
  await capture(seat, name, seat.touch ? 375 : 1280, 844, { scale, frameLabel: label });
  assert.equal(seat.public.revision, revision, 'Timed decision changed during capture');
  covered.add(name);
}

async function play() {
  const agenda = variant === 'reformation'
    ? [['Convert Self', 'Exchange'], ['Convert Other', 'Foreign Aid'], ['Embezzle', 'Tax', 'Steal'], ['Examine', 'Exchange']]
    : [['Exchange'], ['Tax'], ['Foreign Aid'], ['Steal']];
  for (let step = 0; step < 260; step++) {
    await pairedTable();
    const state = seats[0].public, pending = state.pending;
    if (state.status === 'game_over') {
      assert(state.winnerId && !state.terminationReason);
      assert(state.players.every(player => !player.forfeited));
      evidence.phases = [...phases];
      return state;
    }
    phases.add(pending.phase);
    const seat = seats.find(candidate => pending.waitingOn.includes(candidate.private.playerId));
    assert(seat, `No decision owner for ${pending.phase}`);
    const mine = seat.private;
    const own = state.players.find(player => player.playerId === mine.playerId);
    const cards = mine.influences.filter(card => !card.revealed).map(card => card.character);
    switch (pending.phase) {
      case 'awaiting_allegiance':
        await decisionCapture(seat, 'starting-allegiance', 'REFORMIST');
        await decision(seat, 'REFORMIST', 'choose_allegiance');
        break;
      case 'awaiting_action': {
        const index = seats.indexOf(seat), turn = seat.turns ?? 0;
        seat.turns = turn + 1;
        let label = own.coins >= 7 ? 'Coup' : agenda[index][turn] ?? 'Tax';
        const targets = eligibleTargets(state, own).sort((a, b) => b.influenceCount - a.influenceCount);
        let target;
        if (['Coup', 'Examine', 'Steal'].includes(label)) {
          target = targets.find(player => label !== 'Steal' || player.coins > 0);
          if (!target) label = 'Income';
        }
        if (label === 'Convert Other') target = state.players.find(player => player.playerId === seats[0].private.playerId);
        if (variant === 'reformation' && !covered.has('faction-actions')) await decisionCapture(seat, 'faction-actions', 'Convert Self', 200);
        await action(seat, label, target);
        evidence.actions ??= [];
        evidence.actions.push(label);
        break;
      }
      case 'awaiting_action_challenge':
        await decision(seat, pending.action === 'embezzle' ? 'CHALLENGE' : 'ALLOW');
        break;
      case 'awaiting_block_challenge':
      case 'awaiting_block':
        await decision(seat, 'ALLOW');
        break;
      case 'awaiting_challenge_decision': {
        const reverse = pending.action === 'embezzle' && !pending.blockerId;
        const claim = pending.blockCharacter ?? pending.claimedCharacter;
        const prove = reverse ? !cards.includes('duke') : cards.includes(claim);
        const label = prove ? reverse ? 'PROVE NO DUKE' : 'PROVE ' + claim.toUpperCase() : 'CONCEDE';
        await decisionCapture(seat, reverse ? 'no-duke-proof-or-concession' : 'claim-proof', label);
        await decision(seat, label, 'resolve_challenge');
        break;
      }
      case 'awaiting_lose_influence':
        await decision(seat, 'Lose ' + cards[0] + ' influence', 'lose_influence');
        break;
      case 'awaiting_exchange': {
        const offer = mine.exchange;
        assert(offer);
        assert.equal(offer.pool.length, offer.keepCount + (variant === 'base' ? 2 : 1));
        for (let index = 0; index < offer.keepCount; index++) await click(seat.page, offer.pool[index] + ', exchange option ' + (index + 1));
        const label = `CONFIRM (${offer.keepCount}/${offer.keepCount})`;
        await decisionCapture(seat, 'exchange-' + (seat.touch ? 'phone' : 'desktop'), label, 200);
        await decision(seat, label, 'exchange');
        break;
      }
      case 'awaiting_examine_selection': {
        const label = 'Show ' + cards[0] + ' privately';
        await decisionCapture(seat, 'examined-player-selects', label);
        await decision(seat, label, 'examine_select');
        break;
      }
      case 'awaiting_examine': {
        assert(mine.examine);
        for (const other of seats.filter(other => other !== seat)) {
          assert.equal(other.private.examine, null);
          assert.equal(await other.page.$$eval('[aria-label^="Privately examined "]', nodes => nodes.length), 0);
        }
        if (!covered.has('private-examination-reload')) {
          const revision = state.revision, identity = mine.playerId, character = mine.examine.character;
          seat.public = null; seat.private = null;
          await seat.page.reload({ waitUntil: 'domcontentloaded' });
          await until(() => paired(seat) && seat.private.examine && seat.public.revision === revision, 'private examination recovered after reload');
          assert.equal(seat.private.playerId, identity);
          assert.equal(seat.private.examine.character, character);
          covered.add('private-examination-reload');
        }
        await decisionCapture(seat, 'inquisitor-private-decision', 'FORCE REPLACEMENT', 200);
        await decision(seat, 'FORCE REPLACEMENT', 'examine');
        break;
      }
      default: throw new Error('Unhandled phase ' + pending.phase);
    }
    if (step % 20 === 0) { persist(); console.log(JSON.stringify({ variant, decisions: evidence.decisions.length, phase: pending.phase })); }
  }
  throw new Error('Match exceeded bounded decision count');
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    await qa.verifyBundle();
    browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
      args: ['--no-first-run', '--disable-background-networking', '--ignore-certificate-errors-spki-list=' + process.env.QA_BROWSER_CERT_SPKI] });
    await qa.calibrateTextGeometry(browser);
    for (const [name, width] of [['Court Host', 375], ['Court Challenger', 320], ['Court Witness', 414], ['Court Examiner', 1280]]) seats.push(await actor(browser, name, width));
    const host = seats[0], desktop = seats[3];
    for (const seat of [host, desktop]) {
      await click(seat.page, 'Reformation with Inquisitor, 2 to 10 players');
      await capture(seat, 'version-choice-reformation', seat.touch ? 320 : 1280, 844, { scale: 200, frameLabel: 'Reformation with Inquisitor, 2 to 10 players' });
      await click(seat.page, 'Base Coup, 2 to 6 players');
      assert(await seat.page.$eval('[aria-label="Base Coup, 2 to 6 players"]', node => node.getAttribute('aria-pressed') === 'true'));
      if (variant === 'reformation') await click(seat.page, 'Reformation with Inquisitor, 2 to 10 players');
    }
    await qa.setViewport(host, 375);
    await input(host.page, 'Your name', host.name);
    await click(host.page, 'CREATE ROOM');
    await until(() => host.room?.roomCode && host.auth, 'host lobby');
    assert.equal(host.room.config.coupVariant, variant);
    assert.equal(host.room.maxPlayers, variant === 'base' ? 6 : 10);
    for (const seat of seats.slice(1)) {
      await seat.page.goto(origin + '/coup/join', { waitUntil: 'domcontentloaded' });
      await until(() => seat.page.$('input[aria-label="Your name"]'), 'join form ready');
      await input(seat.page, 'Your name', seat.name);
      await input(seat.page, 'Room code', host.room.roomCode);
      await click(seat.page, 'JOIN GAME');
      await until(() => seat.room?.roomCode === host.room.roomCode && seat.auth, 'joined lobby');
      assert.equal(seat.room.config.coupVariant, variant);
    }
    await until(() => seats.every(seat => seat.room?.players.every(player => player.isConnected)), 'four connected lobby seats');
    await capture(host, 'lobby-version', 375, 844, { frameLabel: 'START GAME' });
    await capture(desktop, 'lobby-version-desktop', 1280);
    await click(host.page, 'START GAME');
    await pairedTable();
    assert(seats.every(seat => seat.public.variant === variant));
    const result = await play();
    await capture(host, 'natural-results', 320, 844, { frameLabel: 'PLAY AGAIN' });
    await capture(desktop, 'natural-results-desktop', 1280, 844, { scale: 200, frameLabel: 'LEAVE TABLE' });
    evidence.result = { revision: result.revision, winnerId: result.winnerId, forfeits: 0 };
    assert(evidence.actions.includes(variant === 'base' ? 'Exchange' : 'Examine'));
    if (variant === 'reformation') for (const phase of ['awaiting_allegiance','awaiting_examine_selection','awaiting_examine','awaiting_challenge_decision','awaiting_exchange']) assert(phases.has(phase), phase);
    await click(host.page, 'PLAY AGAIN');
    await until(() => seats.every(seat => paired(seat) && seat.public.status === 'playing' && seat.public.revision > result.revision), 'monotonic rematch');
    assert.equal(host.public.variant, variant);
    assert.equal(host.public.currentTurnPlayerId, result.winnerId);
    evidence.rematch = { winnerStarts: true, variantRetained: true, revision: host.public.revision };
    await qa.leaveSeats(seats);
    const firstBundle = evidence.bundle;
    await qa.verifyBundle(); evidence.finalBundle = evidence.bundle;
    assert.equal(evidence.bundle.sha256, firstBundle.sha256);
    assert.equal(evidence.issues.length, 0);
    assert.equal(evidence.blockedRequests.length, 0);
    assert(seats.every(seat => seat.rejected.length === 0));
    evidence.covered = [...covered];
    evidence.lifecyclePassed = true;
    evidence.visualPassed = evidence.visualFindings.length === 0;
    assert(evidence.visualPassed, 'Rendered layout findings require review');
    evidence.passed = true;
  } catch (error) {
    evidence.error = qa.sanitise(error.stack); evidence.passed = false;
    for (const [index, seat] of seats.entries()) await seat.page.screenshot({ path: path.join(output, `failure-${index}.png`), fullPage: false }).catch(() => {});
    throw error;
  } finally {
    try { await qa.releaseOwnedSeats(); } catch { evidence.cleanupFailed = true; }
    try { if (browser) await browser.close(); evidence.browserClosed = true; } catch { evidence.browserClosed = false; }
    if (evidence.cleanupFailed || !evidence.browserClosed) { evidence.passed = false; process.exitCode = 1; }
    persist();
    console.log(JSON.stringify({ variant, passed: evidence.passed ?? false, decisions: evidence.decisions.length, phases: evidence.phases, findings: evidence.visualFindings.length, output }));
  }
}

main().catch(error => { console.error(qa.sanitise(error.message)); process.exitCode = 1; });
