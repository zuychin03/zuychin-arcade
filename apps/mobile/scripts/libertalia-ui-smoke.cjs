const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createEvidence, MATRIX, CHOICE_KINDS, bundleFence, guardNetwork, local, redact, publicPrivacy } = require('./libertalia-ui-evidence.cjs');
const { persistReceipt } = require('./libertalia-ui-primitives.cjs');
const { SOURCE_FILES, CAPTURE_PLAN, CAPTURE_PLAN_NOTE, PLANNED_CAPTURES, sourceHashes, verifyFrozenEvidence, recordBrowserResponse, commandMetadata, assertCommand, completionStatus, captureFrame, lifecycleFrame, choiceFrame, choiceOptionFrame } = require('./libertalia-ui-natural.cjs');
const { activateChoice } = require('./libertalia-ui-choice.cjs');
const puppeteer = require('puppeteer-core');
const output = process.env.LIBERTALIA_UI_OUTPUT;
if (require.main === module) assert(output, 'Use a distinct LIBERTALIA_UI_OUTPUT directory');
if (output) process.env.NOT_ALONE_UI_OUTPUT_DIR = output;
const h = require('./not-alone-ui-smoke.cjs');
const origin = process.env.LIBERTALIA_WEB_URL || 'http://127.0.0.1:8081';
const api = process.env.LIBERTALIA_API_URL || 'http://127.0.0.1:3213';
let qa = null, ownsOutput = false;
const resize = (page, width, height = 844) => page.setViewport({ ...page.viewport(), width, height, deviceScaleFactor: 1 });
const writeReceipt = (name, value) => persistReceipt(output, name, value, qa?.secrets ?? []);
const exact = text => new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openPlayer(browser, name, width = 390) {
  const player = await h.openPlayer(browser, name, width, 844, true);
  qa.register(player);
  await player.page.setViewport({ width, height: 844, deviceScaleFactor: 1, hasTouch: width < 768, isMobile: width < 768 });
  await guardNetwork(player.page, qa.origins, qa.evidence.blockedRequests);
  player.inputProfile = { width, height: 844, hasTouch: width < 768, isMobile: width < 768, pointer: width < 768 ? 'coarse' : 'fine' };
  player.commandMetadata = [];
  player.responseTasks = [];
  player.page.on('response', response => {
    player.responseTasks.push(recordBrowserResponse(response, player, qa).catch(error => {
      qa.evidence.responseIssues ??= []; qa.evidence.responseIssues.push({ actor: name, message: redact(error.message, [...qa.secrets]) });
    }));
  });
  player.cdp.on('Network.webSocketFrameSent', ({ response }) => {
    if (!response.payloadData.startsWith('42')) return;
    try {
      const record = commandMetadata(JSON.parse(response.payloadData.slice(2)), player);
      if (record) player.commandMetadata.push(record);
    } catch (error) { qa.evidence.responseIssues ??= []; qa.evidence.responseIssues.push({ actor: name, message: redact(error.message, [...qa.secrets]) }); qa.persist(); }
  });
  player.cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    if (!response.payloadData.startsWith('42')) return;
    let packet;
    try { packet = JSON.parse(response.payloadData.slice(2)); } catch { return; }
    const [event, frame] = packet;
    if (event === 'room_updated') player.latestRoom = frame;
    if (event === 'game_state' && frame?.gameId === 'libertalia') {
      player.latestPublic = frame; player.publicFrames += 1;
      const leaks = publicPrivacy(frame);
      if (leaks.length) qa.evidence.findings.push({ kind: 'public-privacy', actor: name, revision: frame.revision, leaks });
    }
    if (event === 'private_state' && frame?.gameId === 'libertalia') { player.latestPrivate = frame; player.privateFrames += 1; }
    if (event === 'libertalia:action_accepted') { player.acceptedActions.push(frame); player.lastAcceptedAt = Date.now(); }
  });
  return player;
}

async function servedHash() {
  return bundleFence(origin, process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256);
}

async function paired(player, after = 0) {
  const auth = await player.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null'));
  assert(auth?.token && auth.roomCode && auth.playerId, 'Own authenticated seat required');
  player.auth = auth; qa.secrets.add(auth.token);
  await h.waitUntil(() => player.latestPublic && player.latestPrivate
    && player.latestPrivate.playerId === auth.playerId && player.latestPrivate.roomCode === auth.roomCode && player.latestPublic.roomCode === auth.roomCode
    && player.latestPublic.revision === player.latestPrivate.revision && player.latestPublic.revision >= after,
  `${player.name} own paired state`);
}

async function command(player, matcher, identity = null) {
  const before = player.acceptedActions.length, rejected = player.rejections.length, sent = player.commandMetadata.length;
  const revision = player.latestPrivate.revision, choiceId = player.latestPrivate.pendingChoice?.id ?? null;
  if (identity) await activateChoice(player, identity, qa);
  else await h.clickButton(player.page, matcher);
  await h.waitUntil(() => player.acceptedActions.length > before || player.rejections.length > rejected, `ack ${matcher}`, 15000);
  assert.equal(player.rejections.length, rejected, JSON.stringify(player.rejections.slice(rejected)));
  await paired(player, player.acceptedActions.at(-1).revision);
  const acknowledged = player.acceptedActions.at(-1);
  assert.equal(player.commandMetadata.length, sent + 1, 'Exactly one command for one explicit action');
  assertCommand(player.commandMetadata.at(-1), revision, acknowledged.action === 'choice' ? choiceId : null, acknowledged);
  if (identity) assert.deepEqual(player.commandMetadata.at(-1).optionIds, [identity.optionId], 'Exact owned option command required');
  return { ...acknowledged, command: player.commandMetadata.at(-1) };
}

async function capture(player, name, widths = null, options = {}) {
  const measurements = [];
  const frame = options.frame ?? (await player.page.$('#libertalia-results') ? '#libertalia-results' : await player.page.$('#libertalia-decision') ? '#libertalia-decision' : null);
  for (const [width, height] of widths ? widths.map(width => [width, 844]) : MATRIX) {
    await resize(player.page, width, height);
    measurements.push(await qa.capture(player.page, `${name}-${width}x${height}.png`, { ...options, frame }));
  }
  if (!widths && !options.allowTransient) for (const width of [375, 1280]) {
    await resize(player.page, width);
    measurements.push(await qa.capture(player.page, `${name}-${width}-text200.png`, { ...options, frame, scale: true }));
  }
  return measurements;
}

async function clickScoped(page, selector) {
  const control = await page.$(selector);
  assert(control, 'Scoped control exists: ' + selector);
  try {
    await control.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const bounds = await control.boundingBox();
    assert(bounds && bounds.width >= 48 && bounds.height >= 48, 'Scoped control retains 48px target');
    if (page.viewport()?.hasTouch) await control.tap(); else await control.click();
  } finally { await control.dispose(); }
}

function localState(player) {
  return { sent: player.commandMetadata.length, accepted: player.acceptedActions.length,
    publicRevision: player.latestPublic?.revision, privateRevision: player.latestPrivate?.revision,
    selectedRank: player.latestPrivate?.selectedRank, hand: [...(player.latestPrivate?.hand ?? [])] };
}

function assertLocalUnchanged(player, before) {
  assert.deepEqual(localState(player), before, 'Browsing and local proposal must not send or commit a command');
}

async function libraryEntry(player) {
  assert.equal(Boolean(player.page.viewport().hasTouch), player.inputProfile.hasTouch);
  await player.page.goto(origin, { waitUntil: 'domcontentloaded' });
  await h.waitUntil(() => player.page.$('#game-tile-libertalia'), 'Libertalia library tile');
  await captureFrame(player, 'library-' + player.inputProfile.width, '#game-tile-libertalia', qa);
  const tile = await player.page.$('#game-tile-libertalia');
  try {
    await tile.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    const bounds = await tile.boundingBox();
    assert(bounds && bounds.width >= 48 && bounds.height >= 48);
    if (player.inputProfile.hasTouch) await tile.tap();
    else { await tile.focus(); await player.page.keyboard.press('Enter'); }
  } finally { await tile.dispose(); }
  await h.waitForPath(player.page, '/libertalia');
}

async function proveHandBrowsing(player) {
  const before = localState(player), rail = '[data-testid="libertalia-hand-rail"]';
  if (!await player.page.$(rail)) {
    qa.evidence.browsing ??= []; qa.evidence.browsing.push({ actor: player.name, mode: 'grid', ranks: before.hand });
    assertLocalUnchanged(player, before); return;
  }
  const read = () => player.page.$eval(rail, node => ({ left: node.scrollLeft, maximum: node.scrollWidth - node.clientWidth }));
  const trace = [];
  for (const [label, direction] of [['Next hand card', 1], ['Previous hand card', -1]]) {
    for (let step = 0; step <= before.hand.length; step++) {
      const selector = '[aria-label="' + label + '"]';
      const disabled = await player.page.$eval(selector, node => node.getAttribute('aria-disabled') === 'true' || node.disabled === true);
      if (disabled) break;
      const old = await read(); await clickScoped(player.page, selector);
      await h.waitUntil(async () => { const next = await read(); return direction === 1 ? next.left > old.left + 1 : next.left < old.left - 1; }, 'hand browsing advances real rail');
      trace.push(await read()); assertLocalUnchanged(player, before);
      assert(step < before.hand.length, 'Hand browsing terminates within owned card count');
    }
    const end = await read();
    assert(direction === 1 ? end.left >= end.maximum - 2 : end.left <= 2, 'Hand browsing reaches actual endpoint');
  }
  qa.evidence.browsing ??= []; qa.evidence.browsing.push({ actor: player.name, mode: 'rail', ranks: before.hand, trace, scale: 200 });
  assertLocalUnchanged(player, before); qa.persist();
}

async function captureHandFaces(player) {
  const original = player.page.viewport();
  try {
    await resize(player.page, player.inputProfile.hasTouch ? 375 : 1280);
    const ranks = [...player.latestPrivate.hand];
    assert(ranks.length <= 6, 'Initial crew readability budget assumes canonical six-card hand');
    for (const [index, rank] of ranks.entries()) {
      await captureFrame(player, 'crew-' + player.inputProfile.width + '-' + rank, '#libertalia-hand-card-' + rank, qa,
        { scales: [true], prepare: index === 0 ? () => proveHandBrowsing(player) : null });
    }
    if (player.inputProfile.hasTouch) for (const rank of [ranks[0], ranks.at(-1)]) {
      await captureFrame(player, 'crew-normal-' + rank, '#libertalia-hand-card-' + rank, qa, { scales: [false] });
    }
  } finally { await player.page.setViewport(original); }
}

async function captureLootFaces(player, observed) {
  const original = player.page.viewport();
  try {
    await resize(player.page, player.inputProfile.hasTouch ? 375 : 1280);
    const available = player.latestPublic.currentLoot;
    for (const token of available) {
      if (observed.has(token.kind)) continue;
      const selector = '#libertalia-loot-area [data-testid="libertalia-loot-token-' + token.id + '"]';
      if (!await player.page.$(selector)) continue;
      await captureFrame(player, 'loot-' + token.kind, selector, qa, { scales: [true] });
      observed.add(token.kind);
    }
  } finally { await player.page.setViewport(original); }
}

async function captureResultDetails(players, name) {
  const all = [];
  for (const player of players) {
    const original = player.page.viewport();
    try {
      await resize(player.page, player.inputProfile.hasTouch ? 375 : 1280);
      assert.equal(player.latestPublic.status, 'game_over');
      assert.equal(player.latestPublic.players.length, 3);
      all.push(...await captureFrame(player, name + '-summary-' + player.inputProfile.width, '#libertalia-result-summary', qa));
      for (const [index, seat] of player.latestPublic.players.entries()) {
        all.push(...await captureFrame(player, name + '-row-' + player.inputProfile.width + '-' + index, '#libertalia-result-row-' + seat.playerId, qa,
          { scales: name === 'forfeit' ? [true] : [false, true] }));
      }
    } finally { await player.page.setViewport(original); }
  }
  return all;
}

async function normalExit(player) {
  const response = player.page.waitForResponse(r => r.request().method() === 'POST' && /\/rooms\/[^/]+\/leave$/.test(r.url()));
  response.catch(() => undefined);
  if (await player.page.$('#libertalia-results')) await clickScoped(player.page, '#libertalia-results [aria-label="BACK TO ARCADE"]');
  else await h.clickButton(player.page, /^Back to arcade$/);
  await h.waitUntil(() => player.page.$('#arcade-dialog'), 'owned Leave confirmation');
  await delay(600);
  await clickScoped(player.page, '#arcade-dialog [aria-label="LEAVE"]');
  assert.equal((await response).status(), 200);
  const entry = { actor: player.name, status: 200, normalUI: true, authCleared: false };
  qa.evidence.cleanup.push(entry); qa.persist();
  await h.waitForPath(player.page, '/');
  assert.equal(await player.page.evaluate(() => sessionStorage.getItem('za:auth')), null, 'Normal exit clears session authentication');
  entry.authCleared = true; player.left = true; qa.persist();
  return 200;
}

async function run() {
  assert.equal(process.env.LIBERTALIA_UI_EXCLUSIVE_WINDOW, 'granted', 'Exclusive browser window must be granted before launch');
  assert(!fs.existsSync(output) || fs.readdirSync(output).length === 0, 'Choose a new output directory');
  fs.mkdirSync(output, { recursive: true });
  ownsOutput = true;
  qa = createEvidence({ outputDir: output, base: origin, api });
  assert(PLANNED_CAPTURES <= 218, 'Declared capture plan exceeds bounded run');
  qa.evidence.capturePlan = CAPTURE_PLAN; qa.evidence.capturePlanNote = CAPTURE_PLAN_NOTE; qa.evidence.sourceFiles = SOURCE_FILES;
  qa.evidence.sourceHashes = sourceHashes(); qa.persist();
  qa.secrets.add('  Fleet  ');
  const receipt = { method: qa.evidence.method, capturePlanNote: CAPTURE_PLAN_NOTE, stages: [], actions: [], cleanup: [] };
  const players = [];
  let browser = null, watchdog = null;
  try {
    local(api); local(origin);
    const health = await fetch(api, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert.equal(health.ok ? (await health.json()).service : null, 'zuychin-arcade-server', 'Ordinary API only, no seeded fixture server');
    qa.evidence.service = 'zuychin-arcade-server';
    receipt.bundle = qa.evidence.bundle = await servedHash(); qa.persist();
    const cert = process.env.QA_BROWSER_CERT_SPKI?.trim();
    assert(cert && /^[A-Za-z0-9+/]{43}=$/.test(cert), 'Supply the local SHA-256 certificate fingerprint');
    browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true,
      args: ['--ignore-certificate-errors-spki-list=' + cert] });
    watchdog = setTimeout(() => { qa.evidence.watchdogExpired = true; qa.evidence.gaps.push('30-minute watchdog expired'); qa.persist(); void browser.close(); }, 30 * 60_000);
    await qa.calibrate(browser);
    for (const [index, name] of ['Voyage Admiral', 'Voyage Navigator', 'Voyage Boatswain'].entries()) players.push(await openPlayer(browser, name, [375, 414, 1280][index]));
    const host = players[0];
    await libraryEntry(host); await libraryEntry(players[2]);
    await h.waitForText(host.page, 'ASSEMBLE A FLEET');
    receipt.stages.push({ landing: await capture(host, '01-landing') });
    await resize(host.page, 375); await lifecycleFrame(host, 'create-phone', 'CREATE ROOM', true, qa);
    await lifecycleFrame(players[2], 'create-desktop', 'CREATE ROOM', true, qa);
    await h.setInput(host.page, 'Your name', host.name); await h.setInput(host.page, 'Room password, optional', '  Fleet  ');
    const created = host.page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/rooms/create'));
    await h.clickButton(host.page, /^CREATE ROOM$/);
    assert.equal(JSON.parse((await created).request().postData()).password, '  Fleet  ');
    await h.waitForPath(host.page, '/libertalia/lobby');
    const code = await h.roomCodeFromLobby(host.page); receipt.roomCode = code;
    for (const player of players.slice(1)) {
      await player.page.goto(origin + '/libertalia/join');
      await h.setInput(player.page, 'Your name', player.name); await h.setInput(player.page, 'Room code', code); await h.setInput(player.page, 'Room password, optional', '  Fleet  ');
      await lifecycleFrame(player, 'join-' + player.inputProfile.width, 'JOIN GAME', true, qa);
      await h.clickButton(player.page, /^JOIN GAME$/); await h.waitForPath(player.page, '/libertalia/lobby');
    }
    receipt.stages.push({ lobby: await capture(host, '02-lobby') });
    await capture(players[2], '02-lobby-desktop-pointer', [1280]);
    await resize(host.page, 375);
    for (const label of ['START GAME', 'HOW TO PLAY', 'LEAVE ROOM']) await lifecycleFrame(host, 'lobby-' + label.toLowerCase().replaceAll(' ', '-'), label, false, qa);
    for (const label of ['HOW TO PLAY', 'LEAVE ROOM']) await lifecycleFrame(players[2], 'desktop-lobby-' + label.toLowerCase().replaceAll(' ', '-'), label, false, qa);
    await h.clickButton(host.page, /^START GAME$/); await h.waitForPath(host.page, '/libertalia/game');
    await Promise.all(players.map(p => paired(p)));
    receipt.stages.push({ game: await capture(host, '03-game') });
    await capture(players[2], '03-game-desktop-pointer', [1280]);
    await capture(players[2], '03-game-desktop-pointer-text200', [1280], { scale: true });
    const firstCrew = (await h.enabledLabels(host.page)).find(label => label.startsWith('Choose '));
    assert(firstCrew, 'Own crew control exists');
    const localBefore = localState(host);
    await h.clickButton(host.page, exact(firstCrew));
    await h.waitUntil(() => host.page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('CONFIRM #')), 'crew confirmation focus');
    await h.clickButton(host.page, /^CANCEL SELECTION$/);
    await h.waitUntil(() => host.page.evaluate(label => document.activeElement?.getAttribute('aria-label') === label, firstCrew), 'Cancel restores chosen crew');
    assertLocalUnchanged(host, localBefore);
    assert(firstCrew.includes('. Timing: '), 'Crew accessible name includes printed timing');
    const submittedRank = host.latestPrivate.hand[0], proposedRank = host.latestPrivate.hand[1];
    assert.notEqual(submittedRank, proposedRank);
    const crewLabel = async rank => (await h.enabledLabels(host.page)).find(label => label.startsWith('Choose ') && label.includes(`, rank ${rank}.`));
    await h.clickButton(host.page, exact(await crewLabel(submittedRank)));
    receipt.actions.push(await command(host, new RegExp(`^CONFIRM #${submittedRank} `)));
    assert.equal(host.latestPrivate.selectedRank, submittedRank);
    await h.waitUntil(async () => (await crewLabel(submittedRank))?.endsWith('Current secret choice.'), 'submitted secret choice label');
    assert(!(await h.enabledLabels(host.page)).some(label => label.startsWith('CONFIRM #')), 'Submitted choice needs no second confirmation');
    const proposalBefore = localState(host);
    await h.clickButton(host.page, exact(await crewLabel(proposedRank)));
    await h.waitUntil(async () => (await crewLabel(proposedRank))?.endsWith('Proposed choice, not submitted.'), 'local proposal label');
    assert((await crewLabel(submittedRank)).endsWith('Current secret choice.'));
    assert.equal(host.latestPrivate.selectedRank, submittedRank, 'Local proposal does not replace authoritative choice');
    assertLocalUnchanged(host, proposalBefore);
    receipt.selectionStates = { submittedRank, proposedRank };
    await captureHandFaces(host); await captureHandFaces(players[2]);
    await h.clickButton(host.page, /^INSPECT VOYAGE LOOT$/);
    await h.waitUntil(() => host.page.evaluate(() => document.activeElement?.id === 'libertalia-loot'), 'voyage loot jump focus');
    const observedLoot = new Set();
    await captureLootFaces(host, observedLoot);
    await h.clickButton(host.page, /^CANCEL SELECTION$/);
    assert.equal(host.latestPrivate.selectedRank, submittedRank);
    assert((await crewLabel(submittedRank)).endsWith('Current secret choice.'));
    assert(!(await h.enabledLabels(host.page)).some(label => label.startsWith('CONFIRM #')));
    await h.clickButton(host.page, /^Open rulebook$/); await h.waitUntil(() => host.page.$('#rules-reference-sheet'), 'rulebook');
    await delay(400); await host.page.keyboard.press('Escape');
    await h.waitUntil(() => host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Open rulebook'), 'rules opener restored');
    const untouched = host.latestPrivate, publicFrames = host.publicFrames, privateFrames = host.privateFrames;
    await host.page.reload({ waitUntil: 'domcontentloaded' });
    await h.waitUntil(() => host.publicFrames > publicFrames && host.privateFrames > privateFrames, 'fresh reload pair');
    await paired(host);
    assert.deepEqual(host.latestPrivate.hand, untouched.hand); assert.equal(host.latestPrivate.selectedRank, untouched.selectedRank);
    await h.waitUntil(async () => (await crewLabel(submittedRank))?.endsWith('Current secret choice.'), 'Submitted state survives reload');
    receipt.descendants = { reputation: await captureFrame(host, 'reputation', '#libertalia-reputation', qa, { scales: [false] }) };
    let attempts = 0;
    const choices = new Set();
    const capturedVoyages = new Set([1]);
    while (host.latestPublic.status !== 'game_over') {
      assert(attempts++ < 1200, 'Bounded full voyage');
      let acted = false;
      for (const [index, player] of players.entries()) {
        await paired(player);
        const pub = player.latestPublic, mine = player.latestPrivate;
        if (pub.status === 'game_over') break;
        if (!capturedVoyages.has(pub.voyage)) {
          await capture(player, `voyage-${pub.voyage}-crew`, [375, 1280], { frame: '#libertalia-hand' });
          capturedVoyages.add(pub.voyage);
        }
        const choice = mine.pendingChoice;
        if (choice) {
          let proof = null;
          if (!choices.has(choice.kind)) {
            assert(CHOICE_KINDS.includes(choice.kind), 'Declared choice kind');
            await resize(player.page, player.inputProfile.hasTouch ? 375 : 1280);
            proof = { actor: player.name, owner: mine.playerId, revision: mine.revision, choiceId: choice.id, kind: choice.kind,
              voyage: pub.voyage, day: pub.day, phase: pub.phase, inputProfile: player.inputProfile,
              scope: 'Full instruction and deterministic policy option only; not a full option inventory',
              instruction: await choiceFrame(player, 'choice-' + choice.kind + '-instruction', 'instruction', null, qa) };
            receipt.choiceFrames ??= []; receipt.choiceFrames.push(proof);
          }
          choices.add(choice.kind);
          await captureLootFaces(player, observedLoot);
          if (!choice.options.length) {
            assert(choice.optional, 'Required choice has legal options');
            if (proof) { proof.optionIds = []; proof.pass = await choiceFrame(player, 'choice-' + choice.kind + '-pass', 'control', 'PASS THIS ABILITY', qa); }
            receipt.actions.push(await command(player, /^PASS THIS ABILITY$/));
            assert.deepEqual(receipt.actions.at(-1).command.optionIds, []); acted = true; break;
          }
          const option = choice.options[(pub.day + index) % choice.options.length];
          const owner = option.playerId ? option.playerId === mine.playerId ? 'You' : pub.players.find(p => p.playerId === option.playerId)?.displayName : null;
          const prefix = option.label + (owner ? ` · ${owner}` : '') + (option.detail ? `. ${option.detail}` : '');
          const label = (await h.enabledLabels(player.page)).find(text => text === prefix || text.startsWith(prefix + '. Timing: ') || text.startsWith(prefix + '. Calm-side effect: '));
          assert(label, `Projected choice is rendered: ${prefix}`);
          if (option.rank !== undefined) assert(label.includes('. Timing: '), 'Ranked choice exposes authoritative timing and effect');
          const identity = { choiceId: choice.id, optionId: option.id, label, revision: mine.revision };
          if (proof) proof.optionIds = [option.id];
          if (choice.max > 1) {
            const before = localState(player);
            await activateChoice(player, identity, qa); assertLocalUnchanged(player, before);
            if (proof) {
              proof.option = await choiceOptionFrame(player, 'choice-' + choice.kind + '-selected', identity, qa);
              proof.confirm = await choiceFrame(player, 'choice-' + choice.kind + '-confirm', 'control', 'CONFIRM 1 CHOICES', qa);
              assert.equal(proof.option.selected, 'true', 'Local chosen option is visibly selected');
            }
            assertLocalUnchanged(player, before);
            receipt.actions.push(await command(player, /^CONFIRM \d+ CHOICES$/));
          } else {
            if (proof) proof.option = await choiceOptionFrame(player, 'choice-' + choice.kind + '-option', identity, qa);
            receipt.actions.push(await command(player, exact(label), identity));
          }
          assert.deepEqual(receipt.actions.at(-1).command.optionIds, [option.id], 'Exact owner policy option is submitted once');
          acted = true; break;
        }
        if (mine.canSelect && mine.selectedRank === null) {
          const rank = mine.hand[(pub.day + index) % mine.hand.length];
          const buttons = await h.enabledLabels(player.page);
          const label = buttons.find(text => text.startsWith('Choose ') && text.includes(`, rank ${rank}.`));
          assert(label, `Own rank ${rank} is selectable`);
          await h.clickButton(player.page, exact(label));
          receipt.actions.push(await command(player, new RegExp(`^CONFIRM #${rank} `)));
          acted = true; break;
        }
      }
      if (!acted) await delay(150);
    }
    await Promise.all(players.map(p => paired(p, host.latestPublic.revision)));
    receipt.terminal = host.latestPublic;
    assert.equal(receipt.terminal.voyage, 3); assert.equal(receipt.terminal.endReason, 'score');
    assert(receipt.terminal.players.every(p => !p.forfeited)); assert(receipt.terminal.winnerPlayerIds.length > 0);
    receipt.choiceKinds = [...choices];
    receipt.stages.push({ results: await captureResultDetails([host, players[2]], 'natural') });
    receipt.resultOrder = await host.page.evaluate(names => [...document.querySelectorAll('#libertalia-results div')]
      .filter(node => [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && names.includes(child.textContent)))
      .map(node => node.textContent), receipt.terminal.players.map(p => p.displayName));
    const sorted = [...receipt.terminal.players].sort((a, b) => Number(a.forfeited) - Number(b.forfeited)
      || Number(receipt.terminal.winnerPlayerIds.includes(b.playerId)) - Number(receipt.terminal.winnerPlayerIds.includes(a.playerId))
      || b.score - a.score || b.reputation - a.reputation);
    assert.deepEqual(receipt.resultOrder, sorted.map(p => p.displayName));
    const reconnecting = players[2], gameUrl = reconnecting.page.url();
    reconnecting.cleanupAuth = await reconnecting.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') || 'null'));
    assert(reconnecting.cleanupAuth?.token, 'Owned recovery credentials remain available in memory');
    reconnecting.restoreUrl = gameUrl;
    await reconnecting.page.goto('about:blank');
    await h.waitUntil(() => host.latestRoom?.players.some(p => p.playerId === reconnecting.latestPrivate.playerId && !p.isConnected && !p.hasLeft), 'Terminal seat reconnecting', 8000);
    assert.equal(host.latestRoom.players.filter(p => p.isConnected && !p.hasLeft).length, 2);
    await h.waitUntil(() => host.page.evaluate(() => document.body.textContent.includes('Waiting for an admiral to reconnect or their reconnect grace to expire before a rematch.')), 'Explicit reconnect grace reason', 3000);
    assert(!(await h.enabledLabels(host.page)).includes('PLAY AGAIN'));
    receipt.rematchReconnect = { connected: 2, metrics: await capture(host, '04a-rematch-reconnecting', [320, 1280], { allowTransient: true }) };
    const reconnectPublic = reconnecting.publicFrames, reconnectPrivate = reconnecting.privateFrames;
    await reconnecting.page.goto(gameUrl);
    delete reconnecting.restoreUrl;
    await h.waitUntil(() => reconnecting.publicFrames > reconnectPublic && reconnecting.privateFrames > reconnectPrivate, 'Fresh terminal reconnect pair', 8000);
    await paired(reconnecting, receipt.terminal.revision);
    await h.waitUntil(async () => (await h.enabledLabels(host.page)).includes('PLAY AGAIN'), 'Rematch restored after reconnect', 3000);
    assert.equal(host.latestPublic.revision, receipt.terminal.revision);
    assert.deepEqual(host.latestPublic.players.map(p => [p.playerId, p.score, p.forfeited]), receipt.terminal.players.map(p => [p.playerId, p.score, p.forfeited]));
    receipt.rematchReconnect.restored = true;
    await command(host, /^PLAY AGAIN$/);
    assert(host.latestPublic.revision > receipt.terminal.revision); assert.equal(host.latestPublic.voyage, 1);
    receipt.rematchRevision = host.latestPublic.revision;
    await capture(host, '05-rematch-start', [375, 1280]);
    for (const player of players.slice(1)) {
      receipt.cleanup.push(await normalExit(player));
    }
    await h.waitUntil(() => host.latestPublic.status === 'game_over', 'forfeit terminal');
    assert.equal(host.latestPublic.endReason, 'forfeit');
    receipt.forfeitTerminal = host.latestPublic;
    await captureResultDetails([host], 'forfeit');
    receipt.cleanup.push(await normalExit(host)); receipt.status = 'passed';
    qa.evidence.observedLootKinds = [...observedLoot];
    qa.evidence.rareBranchGaps = { choices: CHOICE_KINDS.filter(kind => !choices.has(kind)), additional: ['two-player neutral Midshipman', 'maximum six-seat layout', 'empty-hand continuation', 'simultaneous Wind Nymph night clash', 'native-device and independent human play'] };
  } catch (error) { receipt.status = 'failed'; receipt.error = error.stack; process.exitCode = 1; }
  finally {
    if (watchdog) clearTimeout(watchdog);
    for (const player of qa.actors.values()) {
      let currentAuth = null;
      try { currentAuth = await player.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') || 'null')); } catch {}
      const auth = currentAuth ?? player.auth ?? player.cleanupAuth;
      if (auth?.token) qa.secrets.add(auth.token);
      if (!player.left && auth?.token && auth.roomCode) {
        try {
          const response = await fetch(api + '/rooms/' + encodeURIComponent(auth.roomCode) + '/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.token }, redirect: 'error', signal: AbortSignal.timeout(5000) });
          qa.evidence.cleanup.push({ actor: player.name, status: response.status, normalUI: false, fallback: true });
        } catch (error) { qa.evidence.cleanup.push({ actor: player.name, normalUI: false, fallback: true, error: error.message }); }
      }
      await player.cdp?.detach().catch(() => undefined);
      try { await player.context.close(); qa.evidence.cleanup.push({ actor: player.name, contextClosed: true }); }
      catch (error) { qa.evidence.cleanup.push({ actor: player.name, contextClosed: false, error: error.message }); }
    }
    try { if (browser) { await browser.close(); qa.evidence.browserClosed = true; } }
    catch (error) { qa.evidence.cleanup.push({ browserCloseError: error.message }); receipt.status = 'failed'; process.exitCode = 1; }
    try { await verifyFrozenEvidence(qa, origin); }
    catch (error) { qa.evidence.freezeError = redact(error.message, [...qa.secrets]); receipt.status = 'failed'; receipt.error ??= error.stack; process.exitCode = 1; }
    receipt.allClientsClosed = qa.evidence.browserClosed && [...qa.actors.values()].every(player => qa.evidence.cleanup.some(entry => entry.actor === player.name && entry.contextClosed === true));
    receipt.rejections = players.flatMap(p => p.rejections); receipt.consoleIssues = h.consoleIssues;
    if (receipt.status === 'passed' && (receipt.rejections.length || receipt.consoleIssues.length || qa.evidence.blockedRequests.length)) { receipt.status = 'failed'; receipt.error = 'Unexpected rejected commands, browser console issues or nonlocal requests'; process.exitCode = 1; }
    await Promise.all([...qa.actors.values()].flatMap(player => player.responseTasks));
    qa.evidence.commands = [...qa.actors.values()].flatMap(player => player.commandMetadata);
    qa.evidence.finalIssues = [...receipt.rejections, ...receipt.consoleIssues];
    qa.evidence.failure = receipt.status !== 'passed';
    qa.evidence.completion = completionStatus(qa.evidence, [...qa.actors.values()].map(player => player.name));
    if (!qa.evidence.completion.passed) { receipt.status = 'failed'; receipt.error ??= 'Incomplete evidence, freeze or normal cleanup'; process.exitCode = 1; }
    qa.evidence.functionalStatus = receipt.status;
    qa.evidence.visualStatus = qa.evidence.findings.length ? 'findings-require-review' : 'requires-personal-capture-review';
    qa.persist(); writeReceipt('receipt.json', receipt);
    writeReceipt('cleanup.json', { browserClosed: qa.evidence.browserClosed, entries: qa.evidence.cleanup });
    console.log(redact({ status: receipt.status, decisions: receipt.actions.length, terminal: receipt.terminal?.revision, error: receipt.error, output }, [...qa.secrets]));
  }
}
module.exports = { openPlayer, servedHash, paired, command, capture, normalExit, localState, assertLocalUnchanged, captureHandFaces, captureLootFaces, captureResultDetails, proveHandBrowsing };
if (require.main === module) run().catch(error => {
  if (ownsOutput) writeReceipt('failure.json', { error: error.stack });
  console.error(redact({ error: error.message }, [...(qa?.secrets ?? [])])); process.exitCode = 1;
});
