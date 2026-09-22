const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { bundleFence, guardNetwork, local, validateFonts, installTextGeometry, settle, measureContainment, classifyContainment, calibrateContainment } = require('./skull-ui-evidence.cjs');

const { redact, persistReceipt, enlargeLibertaliaText, restoreLibertaliaText, readLibertaliaFontState, validateLibertaliaFontState, frameVisibility } = require('./libertalia-ui-primitives.cjs');
const CAPTURE_LIMIT = 218;
const MATRIX = [[320, 780], [375, 844], [414, 896], [768, 900], [1280, 900], [844, 390]];
const { LIBERTALIA_CREW } = require('../../../packages/types/src/libertalia-constants.ts');
const LOOT_KINDS = ['map', 'barrel', 'amulet', 'chest', 'hook', 'saber', 'relic'];
const PHASES = ['daytime', 'dusk', 'night', 'anchor'];
const CHOICE_KINDS = ['hand_character', 'ship_character', 'graveyard_character', 'island_character', 'loot_current', 'loot_ship', 'loot_swap', 'player', 'ability', 'hook_option'];
const LAYOUT_IDS = ['libertalia-toolbar', 'libertalia-play-area', 'libertalia-decision-area', 'libertalia-decision', 'libertalia-hand', 'libertalia-loot', 'libertalia-island', 'libertalia-reputation', 'libertalia-fleet', 'libertalia-graveyard', 'libertalia-results', 'libertalia-result-summary', 'libertalia-result-roster'];
const LIBERTALIA_CONTAINMENT = { game: 'libertalia', cardSelector: '[data-testid^="libertalia-crew-card-"],[data-testid^="libertalia-loot-token-"]', decisionId: 'libertalia-decision-area', headingId: 'libertalia-decision', siblingIds: ['libertalia-public-table', 'libertalia-fleet'] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fontSamples = () => (window.__skullText ?? []).filter(({ node }) => node.isConnected).map(({ node, before, family, text }) => ({ text, before, family, connected: node.isConnected, after: parseFloat(getComputedStyle(node).fontSize), afterFamily: getComputedStyle(node).fontFamily }));

function persistContainment(outputDir, capture, measurements, secrets = []) {
  assert(/^\d{3}-[^/\\]+\.png$/.test(capture), 'Containment requires an owned capture filename');
  const index = Number(capture.slice(0, 3));
  assert(index >= 1 && index <= CAPTURE_LIMIT, 'Containment capture index exceeds the finite budget');
  const file = `containment-${String(index).padStart(3, '0')}.json`;
  assert(!fs.existsSync(path.join(outputDir, file)), 'Containment sidecars cannot overwrite earlier raw evidence');
  persistReceipt(outputDir, file, { schema: 1, capture, measurements }, secrets);
  const bytes = fs.readFileSync(path.join(outputDir, file));
  return { storage: 'json-sidecar', schema: 1, file, capture, sha256: hash(bytes), bytes: bytes.length,
    cardCount: measurements.cards.length,
    contentCount: measurements.cards.reduce((count, card) => count + card.content.length, 0),
    siblingCount: measurements.cards.reduce((count, card) => count + card.siblings.length, 0) };
}


function publicPrivacy(state) {
  const findings = [];
  for (const player of state?.players ?? []) for (const key of ['hand', 'graveyard', 'selectedRank', 'pendingChoice']) {
    if (Object.hasOwn(player, key)) findings.push('public-player-' + key);
  }
  for (const key of ['hand', 'graveyard', 'selectedRank', 'pendingChoice']) if (state && Object.hasOwn(state, key)) findings.push('public-state-' + key);
  return findings;
}

function crewAllowed(rank, zone, actor) {
  const own = actor?.latestPrivate, pub = actor?.latestPublic;
  if (zone === 'libertalia-hand') return own?.hand.includes(rank);
  if (zone === 'libertalia-graveyard') return own?.graveyard.includes(rank);
  if (zone?.startsWith('libertalia-ship-')) return pub?.players.find(player => zone === 'libertalia-ship-' + player.playerId)?.ship.includes(rank);
  if (zone === 'libertalia-decision-area') return own?.pendingChoice?.options.some(option => option.rank === rank);
  return false;
}

function publicLoot(state) {
  return [...new Map([...(state?.currentLoot ?? []), ...(state?.lootDays ?? []).flat(), ...(state?.players ?? []).flatMap(player => player.loot)].map(token => [token.id, token])).values()];
}

function verifyCrew(card, actor, images) {
  assert(crewAllowed(card.rank, card.zone, actor), 'Crew face requires owned private or exact public-ship authority');
  const crew = LIBERTALIA_CREW[card.rank - 1];
  assert(crew && card.text.includes(crew.name), 'Full printed crew identity must remain live');
  assert(card.text.includes(crew.summary), 'Full canonical crew effect must remain live');
  for (const phase of crew.phases) assert(card.phaseLabels.includes(phase), 'Every printed phase badge remains present');
  for (const source of card.sources) assert.equal(images.find(image => image.source === source)?.artwork, 'libertalia-phase-' + crew.phases[0], 'Crew art uses first printed phase, not current game phase');
}

function verifyLoot(token, state, images) {
  const projected = publicLoot(state).find(item => item.id === token.id);
  assert(projected && LOOT_KINDS.includes(projected.kind), 'Loot artwork must resolve from public token ID');
  assert(token.text.toLowerCase().includes(projected.kind), 'Live loot kind remains present');
  for (const source of token.sources) assert.equal(images.find(image => image.source === source)?.artwork, 'libertalia-loot-' + projected.kind, 'Loot image follows exact projected kind, never option label');
}

function verifyReady(markers, state) {
  for (const marker of markers) {
    assert(state?.players.some(player => marker.id === 'libertalia-ready-' + player.playerId), 'Ready holder belongs to a public seat');
    const text = marker.text + ' ' + marker.labels.join(' ');
    assert(!marker.sources.length && !marker.crewFaces && !/(?:rank\s*\d|#\d)/i.test(text), 'Ready backs may not reveal a selected rank or crew art');
    assert(!LIBERTALIA_CREW.some(crew => new RegExp('\\b' + crew.name + '\\b', 'i').test(text)), 'Ready backs may not reveal a crew name');
  }
}

function geometry(ids) {
  const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const clipped = [], controls = [], rails = [];
  for (const node of document.querySelectorAll('body *')) {
    const css = getComputedStyle(node), box = rect(node);
    if (!box.width || !box.height || css.visibility !== 'visible' || node.closest('[aria-hidden="true"]')) continue;
    let visible = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    for (let owner = node.parentElement; owner; owner = owner.parentElement) {
      const style = getComputedStyle(owner), b = rect(owner);
      if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) { visible.left = Math.max(visible.left, b.left); visible.right = Math.min(visible.right, b.right); }
      if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) { visible.top = Math.max(visible.top, b.top); visible.bottom = Math.min(visible.bottom, b.bottom); }
    }
    const onScreen = box.right > visible.left && box.left < visible.right && box.bottom > visible.top && box.top < visible.bottom && visible.right > visible.left && visible.bottom > visible.top;
    if (node.matches('[role="button"],button') && onScreen) controls.push({ label: node.getAttribute('aria-label') ?? node.textContent.trim(), ...box });
    if (['auto', 'scroll'].includes(css.overflowX) && node.scrollWidth > node.clientWidth + 1) rails.push({ id: node.id, ...box, scrollLeft: node.scrollLeft, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth });
    if (/icon|material|fontawesome/i.test(css.fontFamily)) continue;
    const texts = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
    if (!texts.length) continue;
    const measured = texts.map(window.__coupQATextGeometry);
    let scrollX = false, scrollY = false;
    for (let owner = node; owner; owner = owner.parentElement) {
      const s = getComputedStyle(owner), b = rect(owner);
      scrollX ||= ['auto', 'scroll'].includes(s.overflowX) && owner.scrollWidth > owner.clientWidth;
      scrollY ||= ['auto', 'scroll'].includes(s.overflowY) && owner.scrollHeight > owner.clientHeight;
      const proof = window.__coupQAOverflowProof(measured, b, !scrollX && ['hidden', 'clip'].includes(s.overflowX), !scrollY && ['hidden', 'clip'].includes(s.overflowY), 2);
      if (proof.raw.length || proof.glyphs.length) {
        clipped.push({ text: texts.map(child => child.textContent).join(''), geometry: measured, proof, ancestor: owner.id || owner.tagName,
          visible: onScreen && measured.some(g => g.glyphRects.some(r => r.right > visible.left && r.left < visible.right && r.bottom > visible.top && r.top < visible.bottom)) });
        break;
      }
    }
  }
  return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, clipped, controls, rails,
    layout: Object.fromEntries(ids.map(id => { const n = document.getElementById(id); return [id, n ? rect(n) : null]; })),
    cards: [...document.querySelectorAll('[data-testid^="libertalia-crew-card-"]')].map(n => ({
      rank: Number(n.getAttribute('data-testid').match(/(\d+)$/)?.[1]), text: n.textContent,
      phaseLabels: [...n.querySelectorAll('*')].flatMap(node => [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && /^(DAYTIME|DUSK|NIGHT|ANCHOR)$/.test(child.textContent.trim())).map(child => child.textContent.trim().toLowerCase())),
      zone: n.closest('#libertalia-hand,#libertalia-graveyard,#libertalia-decision-area,[id^="libertalia-ship-"]')?.id ?? null,
      sources: [...n.querySelectorAll('img')].map(image => /^(https?:)/.test(image.currentSrc || image.src) ? new URL(image.currentSrc || image.src).pathname : 'inline'),
    })),
    loot: [...document.querySelectorAll('[data-testid^="libertalia-loot-token-"]')].map(n => ({
      id: Number(n.getAttribute('data-testid').match(/(\d+)$/)?.[1]), text: n.textContent + ' ' + (n.getAttribute('aria-label') ?? ''),
      sources: [...n.querySelectorAll('img')].map(image => /^(https?:)/.test(image.currentSrc || image.src) ? new URL(image.currentSrc || image.src).pathname : 'inline'),
    })),
    ready: [...document.querySelectorAll('[data-testid^="libertalia-ready-"]')].map(n => ({
      id: n.getAttribute('data-testid'), text: n.textContent, labels: [n.getAttribute('aria-label') ?? '', ...[...n.querySelectorAll('[aria-label]')].map(child => child.getAttribute('aria-label'))],
      crewFaces: n.querySelectorAll('[data-testid^="libertalia-crew-card-"]').length, sources: [...n.querySelectorAll('img')].map(image => image.currentSrc || image.src),
    })),
    images: [...document.querySelectorAll('img')].map(n => {
      return { source: /^(https?:)/.test(n.currentSrc || n.src) ? new URL(n.currentSrc || n.src).pathname : 'inline', complete: n.complete, naturalWidth: n.naturalWidth, ...rect(n) };
    }) };
}

function createEvidence({ outputDir, base, api }) {
  local(base); local(api);
  const origins = new Set([new URL(base).origin, new URL(api).origin, 'https://localhost:3214']);
  const actors = new Map(), secrets = new Set(), assetCache = new Map();
  const evidence = { method: "Central scripted driver sees synthetic own-view projections. One natural three-voyage game, then rematch start and deliberate departures, not a second natural game or independent competitive play. Separate canonical fixture evidence is not part of this natural run.", captures: [], attempts: [], findings: [], rawRangeDiagnostics: [], blockedRequests: [], cleanup: [], gaps: [], browserClosed: false };
  const persist = () => persistReceipt(outputDir, 'visual-receipt.json', evidence, secrets);
  const register = actor => actors.set(actor.page, actor);
  async function ready(page, allowTransient = false) {
    const actor = actors.get(page);
    await settle(page);
    if (actor?.lastAcceptedAt) await pause(Math.max(0, 2700 - (Date.now() - actor.lastAcceptedAt)));
    if (/\/libertalia\/(game|lobby)$/.test(new URL(page.url()).pathname)) {
      const auth = await page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null'));
      if (auth?.token) { secrets.add(auth.token); actor.auth = auth; }
      if (!allowTransient) {
        assert(auth?.token && auth.playerId && auth.roomCode, 'Own room authentication required');
        await page.waitForFunction(() => !/Reconnecting|Refreshing|Retry connection|Synchronising your hand|Connection lost/i.test(document.body.innerText), { timeout: 10000 });
        const until = Date.now() + 10000;
        const connected = () => actor.latestRoom?.players.some(p => p.playerId === auth.playerId && p.isConnected && !p.hasLeft);
        const paired = () => connected() && (!page.url().endsWith('/game') ||
          actor.latestPrivate?.playerId === auth.playerId && actor.latestPrivate?.roomCode === auth.roomCode && actor.latestPublic?.roomCode === auth.roomCode && actor.latestPublic?.revision === actor.latestPrivate?.revision);
        while (!paired() && Date.now() < until) await pause(50);
        assert(paired(), 'Capture requires owned paired game or connected lobby state');
        if (page.url().endsWith('/game')) assert.deepEqual(publicPrivacy(actor.latestPublic), [], 'Public projection contains private crew, graveyard or selected rank');
      }
    }
    await settle(page);
  }
  async function assets(images, cards, loot, actor) {
    const root = path.resolve(process.env.QA_STATIC_ROOT), sources = path.resolve(__dirname, '../assets/game-art');
    const names = ['libertalia-cover', 'libertalia-hero', ...LOOT_KINDS.map(kind => 'libertalia-loot-' + kind), ...PHASES.map(phase => 'libertalia-phase-' + phase)];
    const known = new Map(names.filter(n => fs.existsSync(path.join(sources, n + '.webp'))).map(n => [hash(fs.readFileSync(path.join(sources, n + '.webp'))), n]));
    for (const image of images.filter(i => i.source !== 'inline')) {
      if (!assetCache.has(image.source)) {
        const url = new URL(image.source, base), disk = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        assert.equal(url.origin, new URL(base).origin); assert(disk.startsWith(root + path.sep));
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
        assert.equal(response.status, 200);
        const servedHash = hash(new Uint8Array(await response.arrayBuffer())), diskHash = hash(fs.readFileSync(disk));
        assert.equal(servedHash, diskHash, 'Captured asset differs from frozen disk');
        assetCache.set(image.source, { source: image.source, servedHash, diskHash, artwork: known.get(servedHash) ?? null });
      }
      image.artwork = assetCache.get(image.source).artwork;
    }
    for (const card of cards) verifyCrew(card, actor, images);
    for (const token of loot) verifyLoot(token, actor.latestPublic, images);
    evidence.assets = [...assetCache.values()];
    evidence.artworkNotObserved = names.filter(n => !evidence.assets.some(a => a.artwork === n));
  }
  async function capture(page, name, { scale = false, frame = null, align = 'center', allowTransient = false, prepare = null } = {}) {
    assert(evidence.attempts.length < CAPTURE_LIMIT, 'Bounded capture budget exceeded');
    const file = `${String(evidence.attempts.length + 1).padStart(3, '0')}-${name}`, actor = actors.get(page);
    const attempt = { file, actor: actor?.name, revision: actor?.latestPublic?.revision, phase: actor?.latestPublic?.phase, status: actor?.latestPublic?.status, voyage: actor?.latestPublic?.voyage, day: actor?.latestPublic?.day, endReason: actor?.latestPublic?.endReason, scale: scale ? 200 : 100, viewport: page.viewport(), inputProfile: actor?.inputProfile, frame, align, allowTransient };
    attempt.memory = { started: process.memoryUsage() };
    evidence.attempts.push(attempt); persist();
    try {
      await ready(page, allowTransient);
      if (scale) { assert(!allowTransient, 'Transient evidence cannot be a font baseline'); attempt.baseline = await enlargeLibertaliaText(page); persist(); }
      if (prepare) await prepare();
      if (frame) {
        await page.$eval(frame, (node, block) => node.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' }), align);
        await settle(page);
        const visible = await page.$eval(frame, frameVisibility);
        await page.$eval(frame, (n, options) => {
          const previous = [n.style.scrollMarginTop, n.style.scrollMarginBottom];
          n.style.scrollMarginTop = options.top + 'px'; n.style.scrollMarginBottom = options.bottom + 'px';
          n.scrollIntoView({ block: options.align, inline: 'nearest', behavior: 'instant' });
          [n.style.scrollMarginTop, n.style.scrollMarginBottom] = previous;
        }, { align, top: visible.top, bottom: Math.max(0, page.viewport().height - visible.bottom) });
      }
      await settle(page); attempt.preCaptureFonts = await page.evaluate(fontSamples); persist();
      if (scale) validateLibertaliaFontState(await page.evaluate(readLibertaliaFontState));
      await page.screenshot({ path: path.join(outputDir, file), fullPage: false });
      await page.evaluate(installTextGeometry);
      const post = await page.evaluate(geometry, LAYOUT_IDS); post.fonts = await page.evaluate(fontSamples);
      if (scale) post.textScaleState = await page.evaluate(readLibertaliaFontState);
      post.frame = frame ? await page.$eval(frame, node => {
        const r = node.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
      }) : null;
      post.frameVisibleBounds = frame ? await page.$eval(frame, frameVisibility) : null;
      let containment = await page.evaluate(measureContainment, LIBERTALIA_CONTAINMENT);
      attempt.memory.measured = process.memoryUsage();
      post.containment = persistContainment(outputDir, file, containment, secrets);
      attempt.containment = post.containment; persist();
      post.containmentFindings = classifyContainment(containment);
      containment = null;
      attempt.memory.archived = process.memoryUsage();
      const png = fs.readFileSync(path.join(outputDir, file)), viewport = page.viewport();
      const record = { ...attempt, metrics: post, viewport, png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } };
      evidence.captures.push(record); persist();
      assert.equal(post.width, viewport.width); assert.equal(post.height, viewport.height);
      assert.equal(record.png.width, viewport.width); assert.equal(record.png.height, viewport.height);
      assert.equal(post.touchPoints > 0, Boolean(viewport.hasTouch)); assert.equal(post.coarse, Boolean(viewport.hasTouch));
      if (scale) { validateFonts(post.fonts); validateLibertaliaFontState(post.textScaleState); }
      assert(post.images.every(i => i.complete && i.naturalWidth > 0), 'Captured images must be loaded');
      await assets(post.images, post.cards, post.loot, actor);
      verifyReady(post.ready, actor?.latestPublic);
      post.selectorGaps = actor?.latestPublic?.status === 'playing' && /\/game$/.test(new URL(page.url()).pathname) ? ['libertalia-hand', 'libertalia-fleet'].filter(id => !post.layout[id]) : [];
      post.privacyGaps = [];
      if (actor?.latestPublic?.phase === 'selection') for (const player of actor.latestPublic.players.filter(player => player.ready && !player.forfeited)) {
        if (!post.ready.some(marker => marker.id === 'libertalia-ready-' + player.playerId)) post.privacyGaps.push('Missing ready holder for public seat ' + player.playerId);
      }
      if (actor?.latestPublic?.status === 'playing' && actor?.latestPrivate?.hand.length && !post.cards.some(card => card.zone === 'libertalia-hand')) post.privacyGaps.push('No instrumented owned hand cards');
      post.artFallbacks = [...post.cards.filter(card => !card.sources.length).map(card => ({ rank: card.rank, zone: card.zone })), ...post.loot.filter(token => !token.sources.length).map(token => ({ lootId: token.id }))];
      const raw = post.clipped.filter(c => c.proof.raw.length);
      if (raw.length) evidence.rawRangeDiagnostics.push({ file, entries: raw });
      const clipped = post.clipped.filter(c => c.visible && !(evidence.calibration?.passed && c.proof.classification === 'proven-whitespace-only'));
      if (clipped.length) evidence.findings.push({ file, kind: 'visible-text-clipping', entries: clipped });
      if (post.containmentFindings.length) evidence.findings.push({ file, kind: 'card-control-containment', entries: post.containmentFindings });
      if (post.documentWidth > post.width + 1) evidence.findings.push({ file, kind: 'page-horizontal-overflow' });
      const small = post.controls.filter(c => c.width < 48 || c.height < 48);
      if (small.length) evidence.findings.push({ file, kind: 'below48-target', controls: small });
      attempt.memory.completed = process.memoryUsage();
      persist(); return record;
    } catch (error) {
      attempt.memory.failed = process.memoryUsage();
      attempt.error = redact(error.message, [...secrets]);
      try { attempt.failureFonts = await page.evaluate(fontSamples); if (scale) attempt.failureTextScaleState = await page.evaluate(readLibertaliaFontState); await page.screenshot({ path: path.join(outputDir, 'failure-' + file), fullPage: false }); } catch {}
      persist(); throw error;
    } finally { if (scale) await restoreLibertaliaText(page); }
  }
  async function calibrate(browser) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage(); await page.setViewport({ width: 375, height: 420, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
      await guardNetwork(page, new Set(), evidence.blockedRequests);
      await page.setContent('<style>body{font:16px Arial}.sample{font:20px/26px monospace;overflow:hidden;margin:20px 0}#positive{width:80px;white-space:nowrap}#wrapped{width:2ch;white-space:pre-wrap}#clear{width:300px}</style><div id="positive" class="sample">Assassinate</div><div id="wrapped" class="sample">AB CD</div><div id="clear" class="sample">Assassinate</div>');
      await settle(page); await page.evaluate(installTextGeometry);
      await page.screenshot({ path: path.join(outputDir, 'geometry-calibration.png'), fullPage: false });
      const samples = await page.evaluate(() => Object.fromEntries(['positive', 'wrapped', 'clear'].map(id => { const n = document.getElementById(id), measured = window.__coupQATextGeometry(n.firstChild); return [id, { geometry: measured, proof: window.__coupQAOverflowProof([measured], n.getBoundingClientRect()) }]; })));
      evidence.calibration = { samples, passed: false }; persist();
      assert.equal(samples.positive.proof.classification, 'non-whitespace-overflow');
      assert.equal(samples.wrapped.proof.classification, 'proven-whitespace-only');
      assert.equal(samples.clear.proof.classification, 'no-overflow');
      await calibrateContainment(page, { ...LIBERTALIA_CONTAINMENT, cardSelector: '[data-testid^="citadels-district-card-"]' }, outputDir, evidence, persist);
      evidence.calibration.passed = true; persist();
    } finally { await context.close(); }
  }
  return { evidence, actors, secrets, origins, persist, register, ready, capture, calibrate };
}

module.exports = { createEvidence, persistContainment, CAPTURE_LIMIT, MATRIX, LOOT_KINDS, PHASES, CHOICE_KINDS, publicPrivacy, crewAllowed, publicLoot, verifyCrew, verifyLoot, verifyReady, LAYOUT_IDS, bundleFence, guardNetwork, local, redact, validateFonts, LIBERTALIA_CONTAINMENT };
