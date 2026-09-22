const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const { bundleFence, guardNetwork, local, validateFonts, installTextGeometry, redact, restore, settle, measureContainment, classifyContainment, calibrateContainment } = require('./skull-ui-evidence.cjs');

const MATRIX = [[320, 780], [375, 844], [414, 896], [768, 900], [1280, 900], [844, 390]];
const CAPTURE_LIMIT = 180;
const CARD_ART_FAMILY = Object.freeze({
  bang: 'attack', gatling: 'attack', indians: 'attack', duel: 'attack',
  missed: 'response', beer: 'recovery', saloon: 'recovery',
  stagecoach: 'supply', wells_fargo: 'supply', general_store: 'supply',
  panic: 'interference', cat_balou: 'interference',
  barrel: 'equipment', dynamite: 'equipment', scope: 'equipment', mustang: 'equipment', jail: 'equipment',
  volcanic: 'weapon', schofield: 'weapon', remington: 'weapon', rev_carabine: 'weapon', winchester: 'weapon',
});
const ART_FAMILIES = ['attack', 'response', 'recovery', 'supply', 'interference', 'equipment', 'weapon'];
const LAYOUT_IDS = ['bang-toolbar', 'bang-play-area', 'bang-decision-area', 'bang-current-choice', 'bang-play-options', 'bang-hand', 'bang-public-table', 'bang-results', 'bang-result-summary', 'bang-result-roster'];
const BANG_CONTAINMENT = { game: 'bang', cardSelector: '[id^="bang-card-"]', decisionId: 'bang-decision-area', headingId: 'bang-current-choice', siblingIds: ['bang-public-table'] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fontSamples = () => (window.__skullText ?? []).filter(({ node }) => node.isConnected).map(({ node, before, family, text }) => ({ text, before, family, connected: node.isConnected, after: parseFloat(getComputedStyle(node).fontSize), afterFamily: getComputedStyle(node).fontFamily }));

function readBangFontState() {
  const values = window.__skullText ?? [], eligible = [], excluded = [];
  for (const node of document.querySelectorAll('body *')) {
    const input = node.matches('input,textarea');
    if (!input && ![...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) continue;
    const css = getComputedStyle(node), box = node.getBoundingClientRect();
    const text = input ? 'Input: ' + (node.getAttribute('aria-label') ?? node.type ?? 'field') : node.textContent.trim().slice(0, 150);
    const reason = node.closest('[aria-hidden="true"],[hidden],[inert]') ? 'hidden-ancestor' : !box.width || !box.height ? 'no-box' : css.visibility !== 'visible' ? 'hidden' : /icon|material|fontawesome/i.test(css.fontFamily) ? 'icon-glyph' : null;
    if (reason) { excluded.push({ text, reason }); continue; }
    eligible.push({ node, css, text });
  }
  const snapshot = window.__bangFontSnapshot;
  const fonts = eligible.map(({ node, css, text }) => {
    const value = values.find(value => value.node === node);
    return { text, before: value?.before, family: value?.family, connected: node.isConnected, after: parseFloat(css.fontSize), afterFamily: css.fontFamily };
  });
  return { fonts, excluded, eligibleCount: eligible.length,
    missing: eligible.filter(({ node }) => !values.some(value => value.node === node)).map(({ text }) => text),
    detachedHistory: values.filter(({ node }) => !node.isConnected).map(({ text, before, family, generation }) => ({ text, before, family, generation })),
    changedAfterConvergence: snapshot ? snapshot.filter(node => !eligible.some(item => item.node === node)).length + eligible.filter(({ node }) => !snapshot.includes(node)).length : 0 };
}

function registerBangText(generation) {
  const values = window.__skullText ??= [];
  let style = document.getElementById('skull-qa-scale');
  if (!style) { style = document.createElement('style'); style.id = 'skull-qa-scale'; document.head.appendChild(style); }
  const candidates = [...document.querySelectorAll('body *')].filter(node => {
    if (values.some(value => value.node === node)) return false;
    if (!node.matches('input,textarea') && ![...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) return false;
    const css = getComputedStyle(node), box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && css.visibility === 'visible' && !node.closest('[aria-hidden="true"],[hidden],[inert]') && !/icon|material|fontawesome/i.test(css.fontFamily);
  });
  const previousDisabled = style.disabled;
  const added = [];
  try {
    style.disabled = true;
    for (const node of candidates) {
      const css = getComputedStyle(node), input = node.matches('input,textarea');
      const value = { node, before: parseFloat(css.fontSize), line: parseFloat(css.lineHeight), family: css.fontFamily,
        text: input ? 'Input: ' + (node.getAttribute('aria-label') ?? node.type ?? 'field') : node.textContent.trim().slice(0, 150),
        previous: node.getAttribute('data-skull-qa-text'), generation };
      if (!Number.isFinite(value.before) || value.before <= 0) throw new Error('Invalid authentic text baseline');
      added.push(value);
    }
  } finally { style.disabled = previousDisabled; }
  for (const value of added) {
    const index = values.length; values.push(value); value.node.setAttribute('data-skull-qa-text', String(index));
    style.textContent += `[data-skull-qa-text="${index}"]{transition:none!important;font-size:${value.before * 2}px!important;${Number.isFinite(value.line) ? `line-height:${value.line * 2}px!important;` : ''}}`;
  }
  return added.length;
}

function validateBangFontState(state) {
  assert.equal(state.missing.length, 0, 'Current mounted text is missing its authentic font baseline');
  assert.equal(state.changedAfterConvergence, 0, 'Mounted text changed after font convergence');
  assert.equal(state.fonts.length, state.eligibleCount, 'Current mounted text coverage is incomplete');
  validateFonts(state.fonts);
}

async function restoreBangText(page) {
  await restore(page);
  await page.evaluate(() => { delete window.__bangFontSnapshot; });
}

async function enlargeBangText(page) {
  await restoreBangText(page);
  let stable = 0;
  for (let generation = 0; generation < 8; generation++) {
    const added = await page.evaluate(registerBangText, generation);
    await settle(page);
    const state = await page.evaluate(readBangFontState);
    stable = added === 0 && state.missing.length === 0 ? stable + 1 : 0;
    if (stable >= 2) {
      validateBangFontState(state);
      await page.evaluate(() => {
        window.__bangFontSnapshot = (window.__skullText ?? []).filter(({ node }) => {
          const css = getComputedStyle(node), box = node.getBoundingClientRect();
          const text = node.matches('input,textarea') || [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
          return text && node.isConnected && box.width > 0 && box.height > 0 && css.visibility === 'visible' && !node.closest('[aria-hidden="true"],[hidden],[inert]') && !/icon|material|fontawesome/i.test(css.fontFamily);
        }).map(({ node }) => node);
      });
      const final = await page.evaluate(readBangFontState); validateBangFontState(final);
      return { samples: final.fonts.map(({ text, before, family }) => ({ text, before, family })), excluded: final.excluded, detachedHistory: final.detachedHistory, passes: generation + 1 };
    }
  }
  throw new Error('BANG text enlargement did not converge within eight bounded passes');
}

function checkReceiptDirectory(directory) {
  assert.notEqual(directory, path.parse(directory).root, 'Receipt output must not be a filesystem root');
  for (let current = directory; ; current = path.dirname(current)) {
    try {
      const entry = fs.lstatSync(current);
      assert(!entry.isSymbolicLink() && entry.isDirectory(), 'Receipt output must use real directories');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === path.dirname(current)) break;
  }
}

function checkReceiptTarget(receipt) {
  try {
    const entry = fs.lstatSync(receipt);
    assert(!entry.isSymbolicLink() && entry.isFile(), 'Receipt target must be a regular file');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function renameReceipt(temporary, receipt, directory) {
  const started = performance.now(), waitCell = new Int32Array(new SharedArrayBuffer(4));
  let firstError;
  for (;;) {
    if (firstError && performance.now() - started >= 2000) throw firstError;
    checkReceiptDirectory(directory); checkReceiptTarget(receipt);
    try { fs.renameSync(temporary, receipt); return; } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      firstError ??= error;
      const remaining = 2000 - (performance.now() - started);
      if (remaining <= 0) throw firstError;
      Atomics.wait(waitCell, 0, 0, Math.min(25, remaining));
    }
  }
}

function persistReceipt(outputDir, name, value, secrets = []) {
  assert(typeof outputDir === 'string' && outputDir.trim(), 'Receipt output directory required');
  assert(typeof name === 'string' && /^[a-z][a-z0-9-]*\.(json|txt)$/.test(name), 'Receipt filename must be a plain JSON or text basename');
  const serialised = redact(value, [...secrets]) + '\n';
  const directory = path.resolve(outputDir), receipt = path.join(directory, name);
  checkReceiptDirectory(directory);
  fs.mkdirSync(directory, { recursive: true });
  checkReceiptDirectory(directory); checkReceiptTarget(receipt);
  const temporary = path.join(directory, `.receipt-${process.pid}-${randomUUID()}.tmp`);
  let descriptor, ownedTemporary = false;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600); ownedTemporary = true;
    fs.writeFileSync(descriptor, serialised, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    renameReceipt(temporary, receipt, directory); ownedTemporary = false;
  } catch (error) {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} }
    if (ownedTemporary) {
      try { checkReceiptDirectory(directory); fs.unlinkSync(temporary); } catch {}
    }
    throw error;
  }
}


function publicPrivacy(state) {
  const findings = [];
  for (const player of state?.players ?? []) {
    if (Object.hasOwn(player, 'hand')) findings.push('public-hand');
    if (state.status !== 'game_over' && player.alive && player.role !== null && player.role !== 'sheriff') findings.push('concealed-role');
  }
  if (state?.drawChoice && Object.hasOwn(state.drawChoice, 'options')) findings.push('private-draw-options');
  if (state?.discardOrder && Object.hasOwn(state.discardOrder, 'cards')) findings.push('private-discard-order');
  return findings;
}

function authorisedCards(actor) {
  const pub = actor?.public, own = actor?.private;
  const cards = [...(own?.hand ?? []), ...(own?.drawChoice?.options ?? []), ...(own?.discardOrderCards ?? []),
    ...(pub?.pending?.storeCards ?? []), ...(pub?.drawCheck?.cards ?? []), ...(pub?.players ?? []).flatMap(p => p.equipment ?? []), ...(pub?.discardTop ? [pub.discardTop] : [])];
  return [...new Map(cards.map(card => [card.id, card])).values()];
}

function verifyCard(rendered, card, images) {
  assert(rendered.label.includes(', ' + card.rank + ' of ' + card.suit + '.'), 'Printed rank and suit must remain exact accessible live text');
  assert(Object.hasOwn(CARD_ART_FAMILY, card.name), 'Unknown printed card name');
  for (const source of rendered.sources) {
    const image = images.find(item => item.source === source);
    assert.equal(image?.artwork, 'bang-card-' + CARD_ART_FAMILY[card.name], 'Art follows printed identity, never effective play identity');
  }
}

function verifySeats(seats, state) {
  for (const seat of seats) {
    const player = state?.players.find(item => seat.id === 'bang-seat-' + item.playerId);
    assert(player, 'Rendered public seat must belong to the public projection');
    if (player.role === null && seat.roleText !== null) {
      assert(/Hidden role/i.test(seat.roleText), 'Concealed public role must retain its unknown label');
      assert(!/\b(sheriff|deputy|outlaw|renegade)\b/i.test(seat.roleText + ' ' + seat.roleLabels.join(' ')), 'Unknown public role may not contain hidden identity metadata');
    }
  }
}

function frameVisibility(node) {
  const visible = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
  for (let owner = node.parentElement; owner; owner = owner.parentElement) {
    const css = getComputedStyle(owner), box = owner.getBoundingClientRect();
    if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX)) { visible.left = Math.max(visible.left, box.left); visible.right = Math.min(visible.right, box.right); }
    if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY)) { visible.top = Math.max(visible.top, box.top); visible.bottom = Math.min(visible.bottom, box.bottom); }
  }
  const box = node.getBoundingClientRect();
  for (const overlay of document.querySelectorAll('body *')) {
    const css = getComputedStyle(overlay), b = overlay.getBoundingClientRect();
    if (!['fixed', 'sticky'].includes(css.position) || css.visibility !== 'visible' || !b.height || overlay.contains(node) || node.contains(overlay) || b.right <= box.left || b.left >= box.right) continue;
    if (b.top <= 1 && b.bottom < innerHeight) visible.top = Math.max(visible.top, b.bottom);
    if (b.bottom >= innerHeight - 1 && b.top > 0) visible.bottom = Math.min(visible.bottom, b.top);
  }
  return visible;
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
    cards: [...document.querySelectorAll('[id^="bang-card-"]')].map(n => ({
      id: n.id, label: n.getAttribute('aria-label') ?? n.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '',
      text: n.textContent, sources: [...n.querySelectorAll('img')].map(image => /^(https?:)/.test(image.currentSrc || image.src) ? new URL(image.currentSrc || image.src).pathname : 'inline'),
    })),
    seats: [...document.querySelectorAll('[id^="bang-seat-"]')].map(n => {
      const role = n.querySelector('[data-testid^="bang-public-role-"]');
      return { id: n.id, text: n.textContent, roleText: role?.textContent ?? null, roleLabels: role ? [role.getAttribute('aria-label') ?? '', ...[...role.querySelectorAll('[aria-label]')].map(child => child.getAttribute('aria-label'))] : [] };
    }),
    images: [...document.querySelectorAll('img')].map(n => {
      return { source: /^(https?:)/.test(n.currentSrc || n.src) ? new URL(n.currentSrc || n.src).pathname : 'inline', complete: n.complete, naturalWidth: n.naturalWidth, ...rect(n) };
    }) };
}

function createEvidence({ outputDir, base, api }) {
  local(base); local(api);
  const origins = new Set([new URL(base).origin, new URL(api).origin, 'https://localhost:3214']);
  const actors = new Map(), secrets = new Set(), assetCache = new Map();
  const evidence = { method: "Automated four-seat policy: each gameplay decision uses the acting seat private frame and public projection. Scripted Sheriff-forfeit rematch ending and optional canonical fixtures are separate branch coverage. Not independent manual testers, native fontScale or physical-device evidence.", captureBudget: CAPTURE_LIMIT, captures: [], attempts: [], findings: [], rawRangeDiagnostics: [], blockedRequests: [], cleanup: [], gaps: [], browserClosed: false };
  const persist = () => persistReceipt(outputDir, 'receipt.json', evidence, secrets);
  const register = actor => actors.set(actor.page, actor);
  async function ready(page, allowTransient = false) {
    const actor = actors.get(page);
    await settle(page);
    if (actor?.lastAcceptedAt) await pause(Math.max(0, 2700 - (Date.now() - actor.lastAcceptedAt)));
    if (/\/bang\/(game|lobby)$/.test(new URL(page.url()).pathname)) {
      const auth = await page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null'));
      if (auth?.token) { secrets.add(auth.token); actor.auth = auth; }
      if (!allowTransient) {
        assert(auth?.token && auth.playerId && auth.roomCode, 'Own room authentication required');
        await page.waitForFunction(() => !/Reconnecting|Refreshing|Retry connection|Synchronising your hand|Connection lost/i.test(document.body.innerText), { timeout: 10000 });
        const until = Date.now() + 10000;
        const paired = () => page.url().endsWith('/game')
          ? actor.private?.playerId === auth.playerId && actor.private?.roomCode === auth.roomCode && actor.public?.roomCode === auth.roomCode && actor.public?.revision === actor.private?.revision
          : actor.room?.players.some(p => p.playerId === auth.playerId && p.isConnected && !p.hasLeft);
        while (!paired() && Date.now() < until) await pause(50);
        assert(paired(), 'Capture requires owned paired game or connected lobby state');
        if (page.url().endsWith('/game')) assert.deepEqual(publicPrivacy(actor.public), [], 'Public projection contains private cards or a concealed role');
      }
    }
    await settle(page);
  }
  async function assets(images, cards, actor) {
    const root = path.resolve(process.env.QA_STATIC_ROOT), sources = path.resolve(__dirname, '../assets/game-art');
    const names = ['bang-cover', 'bang-hero', ...ART_FAMILIES.map(family => 'bang-card-' + family)];
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
    for (const card of cards) {
      const authorised = authorisedCards(actor);
      const matches = authorised.filter(item => card.id.endsWith('-' + item.id));
      assert.equal(matches.length, 1, 'Mounted card must match exactly one own-view or public card');
      verifyCard(card, matches[0], images);
    }
    evidence.assets = [...assetCache.values()];
    evidence.artworkNotObserved = names.filter(n => !evidence.assets.some(a => a.artwork === n));
  }
  async function capture(page, name, { scale = false, frame = null, align = 'center', allowTransient = false, prepare = null } = {}) {
    assert(evidence.attempts.length < CAPTURE_LIMIT, 'Bounded capture budget exceeded');
    const file = `${String(evidence.attempts.length + 1).padStart(3, '0')}-${name}`, actor = actors.get(page);
    const attempt = { file, actor: actor?.name, revision: actor?.public?.revision, phase: actor?.public?.phase, status: actor?.public?.status, turn: actor?.public?.turnNumber, winner: actor?.public?.winner, scale: scale ? 200 : 100, viewport: page.viewport(), frame, align, allowTransient };
    evidence.attempts.push(attempt); persist();
    try {
      await ready(page, allowTransient);
      if (scale) {
        assert(!allowTransient, 'Transient evidence cannot be a font baseline'); attempt.baseline = await enlargeBangText(page); persist();
      }
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
      if (scale) validateBangFontState(await page.evaluate(readBangFontState));
      await page.screenshot({ path: path.join(outputDir, file), fullPage: false });
      await page.evaluate(installTextGeometry);
      const post = await page.evaluate(geometry, LAYOUT_IDS); post.fonts = await page.evaluate(fontSamples);
      if (scale) post.textScaleState = await page.evaluate(readBangFontState);
      post.frame = frame ? await page.$eval(frame, node => {
        const bounds = node.getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right, height: bounds.height, width: bounds.width };
      }) : null;
      post.frameVisibleBounds = frame ? await page.$eval(frame, frameVisibility) : null;
      const containmentConfig = await page.evaluate(config => ({ ...config, decisionId: document.getElementById(config.decisionId) ? config.decisionId : 'bang-current-choice' }), BANG_CONTAINMENT);
      post.containment = await page.evaluate(measureContainment, containmentConfig);
      post.containmentFindings = classifyContainment(post.containment);
      const png = fs.readFileSync(path.join(outputDir, file)), viewport = page.viewport();
      const record = { ...attempt, metrics: post, viewport, png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } };
      evidence.captures.push(record); persist();
      assert.equal(post.width, viewport.width); assert.equal(post.height, viewport.height);
      assert.equal(record.png.width, viewport.width); assert.equal(record.png.height, viewport.height);
      assert.equal(post.touchPoints > 0, Boolean(viewport.hasTouch)); assert.equal(post.coarse, Boolean(viewport.hasTouch));
      if (scale) { validateFonts(post.fonts); validateBangFontState(post.textScaleState); }
      assert(post.images.every(i => i.complete && i.naturalWidth > 0), 'Captured images must be loaded');
      await assets(post.images, post.cards, actor);
      verifySeats(post.seats, actor?.public);
      post.rolePrivacyGaps = post.seats.filter(seat => seat.roleText === null).map(seat => seat.id);
      const raw = post.clipped.filter(c => c.proof.raw.length);
      if (raw.length) evidence.rawRangeDiagnostics.push({ file, entries: raw });
      const clipped = post.clipped.filter(c => c.visible && !(evidence.calibration?.passed && c.proof.classification === 'proven-whitespace-only'));
      if (clipped.length) evidence.findings.push({ file, kind: 'visible-text-clipping', entries: clipped });
      if (post.containmentFindings.length) evidence.findings.push({ file, kind: 'card-control-containment', entries: post.containmentFindings });
      if (post.documentWidth > post.width + 1) evidence.findings.push({ file, kind: 'page-horizontal-overflow' });
      const small = post.controls.filter(c => c.width < 48 || c.height < 48);
      if (small.length) evidence.findings.push({ file, kind: 'below48-target', controls: small });
      persist(); return record;
    } catch (error) {
      attempt.error = redact(error.message, [...secrets]);
      try { attempt.failureFonts = await page.evaluate(fontSamples); if (scale) attempt.failureTextScaleState = await page.evaluate(readBangFontState); await page.screenshot({ path: path.join(outputDir, 'failure-' + file), fullPage: false }); } catch {}
      persist(); throw error;
    } finally { if (scale) await restoreBangText(page); }
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
      await calibrateContainment(page, { ...BANG_CONTAINMENT, cardSelector: '[data-testid^="citadels-district-card-"]' }, outputDir, evidence, persist);
      evidence.calibration.passed = true; persist();
    } finally { await context.close(); }
  }
  return { evidence, actors, secrets, origins, persist, register, ready, capture, calibrate };
}

module.exports = { createEvidence, persistReceipt, MATRIX, CAPTURE_LIMIT, CARD_ART_FAMILY, ART_FAMILIES, publicPrivacy, authorisedCards, verifyCard, verifySeats, LAYOUT_IDS, bundleFence, guardNetwork, local, redact, validateFonts, BANG_CONTAINMENT, frameVisibility, registerBangText, readBangFontState, validateBangFontState, enlargeBangText, restoreBangText };
