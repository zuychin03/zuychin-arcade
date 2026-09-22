const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { bundleFence, guardNetwork, local, validateFonts, installTextGeometry } = require('./tokyo-ui-evidence.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SKULL_CONTAINMENT = { game: 'skull', cardSelector: '[data-testid^="skull-card-"]', decisionId: 'skull-decision-area', headingId: 'skull-king-decision-heading', siblingIds: ['skull-current-trick', 'skull-scoreboard'] };

function measureContainment(config) {
  const rect = node => { const b = node.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  const viewport = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
  const shown = node => { const s = getComputedStyle(node); return s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity) > 0 && !node.closest('[aria-hidden="true"]'); };
  const visibleBounds = node => {
    const result = { ...viewport };
    for (let owner = node.parentElement; owner; owner = owner.parentElement) {
      const s = getComputedStyle(owner), b = rect(owner);
      if (['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowX)) { result.left = Math.max(result.left, b.left); result.right = Math.min(result.right, b.right); }
      if (['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowY)) { result.top = Math.max(result.top, b.top); result.bottom = Math.min(result.bottom, b.bottom); }
    }
    return result;
  };
  const identity = n => n.id || n.getAttribute('data-testid') || n.getAttribute('aria-label') || n.tagName;
  const labelledCards = [...document.querySelectorAll('[aria-label]')].filter(n => {
    const label = n.getAttribute('aria-label');
    return config.game === 'skull' ? /^(?:Play )?(?:(?:green|purple|yellow|black) \d+|Pirate|Tigress(?: as (?:pirate|escape))?|Skull King|Mermaid|Escape)$/.test(label)
      : /, (?:noble|religious|trade|military|unique) district\./.test(label) || /^(?:CHOOSE SECRETLY\. |LOCKED · PRIVATE\. )[^,]+, rank [1-8]\./.test(label);
  }).map(n => parseFloat(getComputedStyle(n).borderTopWidth) > 0 ? n : [...n.children].find(c => parseFloat(getComputedStyle(c).borderTopWidth) > 0) ?? n);
  const cards = [...new Set([...document.querySelectorAll(config.cardSelector), ...labelledCards])].filter(shown);
  const decision = document.getElementById(config.decisionId) ?? document.getElementById(config.headingId)?.parentElement;
  const tables = config.siblingIds.map(id => document.getElementById(id)).filter(n => n && shown(n));
  const controls = [...document.querySelectorAll('[role="button"],button')].filter(shown);
  const describe = n => ({ id: identity(n), bounds: rect(n), visibleBounds: visibleBounds(n) });
  const result = cards.map(card => {
    const content = [];
    for (const node of [card, ...card.querySelectorAll('*')]) {
      if (!shown(node)) continue;
      if (node !== card && node.matches('img,[role="button"],button')) content.push({ kind: node.tagName === 'IMG' ? 'art' : 'control', label: node.getAttribute('aria-label') ?? node.textContent, bounds: rect(node), visibleBounds: visibleBounds(node) });
      if (/icon|material|fontawesome/i.test(getComputedStyle(node).fontFamily)) continue;
      for (const text of node.childNodes) if (text.nodeType === Node.TEXT_NODE && text.textContent.trim()) {
        for (const glyph of window.__coupQATextGeometry(text).glyphRects) content.push({ kind: 'glyph', label: glyph.character, bounds: glyph, visibleBounds: visibleBounds(node) });
      }
    }
    return { ...describe(card), kind: 'card', content, siblings: [...cards, ...controls].filter(n => n !== card && !card.contains(n) && !n.contains(card)).map(describe) };
  });
  if (decision && shown(decision)) result.push({ ...describe(decision), kind: 'decision', content: controls.filter(n => decision.contains(n)).map(n => ({ kind: 'control', label: n.getAttribute('aria-label') ?? n.textContent, bounds: rect(n), visibleBounds: visibleBounds(n) })), siblings: tables.filter(n => !decision.contains(n) && !n.contains(decision)).map(describe) });
  return { viewport, boundaries: { cardCount: cards.length, decision: decision ? identity(decision) : null, siblingIds: tables.map(identity) }, cards: result };
}

function classifyContainment(measurements) {
  const intersect = (a, b) => ({ left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) });
  const substantial = b => b.right - b.left > 2 && b.bottom - b.top > 2;
  const findings = [];
  for (const card of measurements.cards) for (const content of card.content) {
    const owner = card.bounds, visible = intersect(intersect(content.bounds, measurements.viewport), content.visibleBounds ?? measurements.viewport);
    const escapes = [
      { ...visible, right: Math.min(visible.right, owner.left) }, { ...visible, left: Math.max(visible.left, owner.right) },
      { ...visible, bottom: Math.min(visible.bottom, owner.top) }, { ...visible, top: Math.max(visible.top, owner.bottom) },
    ].filter(substantial);
    if (!escapes.length) continue;
    findings.push({ kind: 'content-outside-boundary', boundaryKind: card.kind, boundary: card.id, content, boundaryBounds: owner, visibleEscapes: escapes });
    for (const sibling of card.siblings) {
      const overlap = intersect(intersect(visible, sibling.bounds), sibling.visibleBounds ?? measurements.viewport);
      if (substantial(overlap)) findings.push({ kind: 'content-overlaps-sibling', boundary: card.id, sibling: sibling.id, content, siblingBounds: sibling.bounds, overlap });
    }
  }
  return findings;
}

async function calibrateContainment(page, config, outputDir, evidence, persist) {
  const cardId = config.game === 'skull' ? 'skull-card-' : 'citadels-district-card-';
  await page.setContent(`<style>body{margin:0}article{position:absolute;left:10px;width:140px;border:1px solid #444}button{height:48px;width:120px}#bad{top:10px;height:55px}#bad button{position:absolute;top:70px}#next{top:80px;height:70px}#good{left:200px;top:10px;height:100px}#rail{position:absolute;left:10px;top:180px;width:150px;height:70px;overflow-x:auto;overflow-y:hidden}#rail>div{width:500px}#rail button{margin-left:220px}#${config.decisionId}{position:absolute;left:10px;top:270px;width:140px;height:120px}#${config.decisionId}>button{position:absolute;left:90px;top:0}#${config.decisionId}>button+button{left:0;top:60px}#${config.siblingIds[0]}{position:absolute;left:170px;top:270px;width:180px;height:120px;background:#ddd}</style><article id="bad" data-testid="${cardId}bad"><button>ESCAPED CARD</button></article><article id="next" data-testid="${cardId}next">NEXT CARD</article><article id="good" data-testid="${cardId}good"><button>CONTAINED CARD</button></article><div id="rail" data-testid="${cardId}rail"><div><button>OFFSCREEN RAIL</button></div></div><section id="${config.decisionId}"><button>ESCAPED CONTROL</button><button>CONTAINED CONTROL</button></section><section id="${config.siblingIds[0]}">TABLE</section>`);
  await settle(page); await page.evaluate(installTextGeometry);
  await page.screenshot({ path: path.join(outputDir, 'containment-calibration.png'), fullPage: false });
  const measurements = await page.evaluate(measureContainment, config), findings = classifyContainment(measurements);
  evidence.calibration.containment = { measurements, findings, passed: false }; persist();
  assert(findings.some(f => f.boundary === 'bad' && f.kind === 'content-outside-boundary'));
  assert(findings.some(f => f.boundary === 'bad' && f.sibling === 'next'));
  assert(findings.some(f => f.content.label === 'ESCAPED CONTROL' && f.sibling === config.siblingIds[0]));
  assert(!findings.some(f => f.boundary === 'good' || f.content.label === 'CONTAINED CONTROL' || f.content.label === 'OFFSCREEN RAIL'));
  evidence.calibration.containment.passed = true; persist();
}

function redact(value, secrets = []) {
  let result = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secrets) if (secret) result = result.split(secret).join('[redacted]');
  return result.replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [redacted]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]');
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await pause(100);
}

function fonts() {
  return (window.__skullText ?? []).map(({ node, before, family, text }) => ({ text, before, family, connected: node.isConnected, after: parseFloat(getComputedStyle(node).fontSize), afterFamily: getComputedStyle(node).fontFamily }));
}

async function restore(page) {
  await page.evaluate(() => {
    document.getElementById('skull-qa-scale')?.remove();
    for (const { node, previous } of window.__skullText ?? []) {
      if (previous === null) node.removeAttribute('data-skull-qa-text'); else node.setAttribute('data-skull-qa-text', previous);
    }
    window.__skullText = [];
  });
  await settle(page);
}

async function enlarge(page) {
  await restore(page);
  const baseline = await page.evaluate(() => {
    const values = [], excluded = [];
    for (const node of document.querySelectorAll('body *')) {
      if (![...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) continue;
      const css = getComputedStyle(node), box = node.getBoundingClientRect(), text = node.textContent.trim().slice(0, 150);
      const reason = node.closest('[aria-hidden="true"]') ? 'aria-hidden' : !box.width || !box.height ? 'no-box' : css.visibility !== 'visible' ? 'hidden' : /icon|material|fontawesome/i.test(css.fontFamily) ? 'icon-glyph' : null;
      if (reason) { excluded.push({ text, reason }); continue; }
      values.push({ node, before: parseFloat(css.fontSize), line: parseFloat(css.lineHeight), family: css.fontFamily, text, previous: node.getAttribute('data-skull-qa-text') });
    }
    window.__skullText = values;
    const style = document.createElement('style'); style.id = 'skull-qa-scale';
    style.textContent = values.map((v, i) => {
      if (!Number.isFinite(v.before) || v.before <= 0) throw new Error('Invalid baseline font');
      v.node.setAttribute('data-skull-qa-text', String(i));
      return `[data-skull-qa-text="${i}"]{transition:none!important;font-size:${v.before * 2}px!important;${Number.isFinite(v.line) ? `line-height:${v.line * 2}px!important;` : ''}}`;
    }).join('\n');
    document.head.appendChild(style);
    return { samples: values.map(({ before, family, text }) => ({ before, family, text })), excluded };
  });
  await settle(page);
  return baseline;
}

function metrics() {
  const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const clipped = [], controls = [];
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
    if (/icon|material|fontawesome/i.test(css.fontFamily)) continue;
    const texts = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
    if (!texts.length) continue;
    const geometry = texts.map(window.__coupQATextGeometry);
    let scrollX = false, scrollY = false;
    for (let owner = node; owner; owner = owner.parentElement) {
      const s = getComputedStyle(owner), b = rect(owner);
      scrollX ||= ['auto', 'scroll'].includes(s.overflowX) && owner.scrollWidth > owner.clientWidth;
      scrollY ||= ['auto', 'scroll'].includes(s.overflowY) && owner.scrollHeight > owner.clientHeight;
      const proof = window.__coupQAOverflowProof(geometry, b, !scrollX && ['hidden', 'clip'].includes(s.overflowX), !scrollY && ['hidden', 'clip'].includes(s.overflowY), 2);
      if (proof.raw.length || proof.glyphs.length) {
        clipped.push({ text: texts.map(child => child.textContent).join(''), geometry, proof, ancestor: owner.id || owner.tagName,
          visible: onScreen && geometry.some(g => g.glyphRects.some(r => r.right > visible.left && r.left < visible.right && r.bottom > visible.top && r.top < visible.bottom)) });
        break;
      }
    }
  }
  const handHeading = [...document.querySelectorAll('*')].find(n => n.textContent === 'YOUR HAND' && !n.children.length);
  const decision = document.getElementById('skull-king-decision-heading');
  const regions = [...document.querySelectorAll('[role="region"],[role="dialog"]')].map(n => ({ id: n.id, label: n.getAttribute('aria-label'), ...rect(n), scrollTop: n.scrollTop, scrollHeight: n.scrollHeight, clientHeight: n.clientHeight }));
  return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, clipped, controls, regions,
    layout: Object.fromEntries(['skull-toolbar', 'skull-play-area', 'skull-decision-area', 'skull-current-trick', 'skull-scoreboard', 'skull-result-summary', 'skull-result-roster', 'skull-king-game-over'].map(id => { const n = document.getElementById(id); return [id, n ? rect(n) : null]; })),
    decision: decision ? rect(decision) : null, handHeading: handHeading ? rect(handHeading) : null,
    images: [...document.querySelectorAll('img')].map(n => ({ source: /^(https?:)/.test(n.currentSrc || n.src) ? new URL(n.currentSrc || n.src).pathname : 'inline', complete: n.complete, naturalWidth: n.naturalWidth, ...rect(n) })) };
}

function createEvidence({ outputDir, base, api }) {
  local(base); local(api);
  const origins = new Set([new URL(base).origin, new URL(api).origin, 'https://localhost:3214']);
  const actors = new Map(), secrets = new Set();
  const evidence = { method: 'Three automated own-seat browser policies, not independent manual choices. CSS200 is not native fontScale or physical-device evidence.', captures: [], attempts: [], findings: [], rawRangeDiagnostics: [], cleanup: [], gaps: [], blockedRequests: [], browserClosed: false };
  let sequence = 0;
  const persist = () => { fs.mkdirSync(outputDir, { recursive: true }); fs.writeFileSync(path.join(outputDir, 'receipt.json'), redact(evidence, [...secrets]) + '\n'); };
  const register = actor => actors.set(actor.page, actor);
  async function ready(page, allowDisconnected = false) {
    const actor = actors.get(page);
    await settle(page);
    if (actor?.lastAcceptedAt) await pause(Math.max(0, 2700 - (Date.now() - actor.lastAcceptedAt)));
    if (/\/skull-king\/(game|lobby)$/.test(new URL(page.url()).pathname)) {
      const auth = await page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null'));
      assert(auth?.token && auth.playerId && auth.roomCode, 'Own room auth is required');
      secrets.add(auth.token); actor.auth = auth;
      if (!allowDisconnected) await page.waitForFunction(() => !/Reconnecting|Refreshing|Retry connection/i.test(document.body.innerText), { timeout: 10000 });
      if (page.url().endsWith('/game')) {
        assert.equal(actor.private?.playerId, auth.playerId); assert.equal(actor.private?.roomCode, auth.roomCode);
        assert.equal(actor.public?.roomCode, auth.roomCode); assert.equal(actor.public?.revision, actor.private?.revision);
        await page.waitForFunction(() => Boolean(document.getElementById('skull-king-decision-heading') || document.getElementById('skull-king-game-over')), { timeout: 10000 });
      } else if (!allowDisconnected) {
        const deadline = Date.now() + 10000;
        while (!actor.room?.players.some(p => p.playerId === auth.playerId && p.isConnected && !p.hasLeft) && Date.now() < deadline) await pause(50);
        assert(actor.room?.players.some(p => p.playerId === auth.playerId && p.isConnected && !p.hasLeft), 'Own lobby seat must be connected');
      }
    }
    await settle(page);
  }
  async function capture(page, name, { scale = false, frame = null, frameAlign = 'center', allowDisconnected = false, afterScale = null } = {}) {
    assert(sequence < 110, 'Bounded capture budget exceeded');
    const file = `${String(++sequence).padStart(3, '0')}-${name}`, actor = actors.get(page);
    const attempt = { file, actor: actor?.name ?? 'calibration', revision: actor?.public?.revision ?? null, scale: scale ? 200 : 100, viewport: page.viewport() };
    evidence.attempts.push(attempt); persist();
    try {
      await ready(page, allowDisconnected);
      if (scale) { attempt.baseline = await enlarge(page); persist(); }
      if (afterScale) await afterScale();
      if (frame) await page.$eval(frame, (n, block) => n.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' }), frameAlign);
      await settle(page); attempt.preCaptureFonts = await page.evaluate(fonts); persist();
      await page.screenshot({ path: path.join(outputDir, file), fullPage: false });
      await page.evaluate(installTextGeometry);
      const post = await page.evaluate(metrics); post.fonts = await page.evaluate(fonts);
      if (frame) post.frame = await page.$eval(frame, n => {
        const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const bounds = rect(n), visible = { left: 0, right: innerWidth, top: 0, bottom: innerHeight }, scrollAncestors = [];
        for (let owner = n.parentElement; owner; owner = owner.parentElement) {
          const css = getComputedStyle(owner), b = rect(owner);
          if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX)) { visible.left = Math.max(visible.left, b.left); visible.right = Math.min(visible.right, b.right); }
          if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY)) { visible.top = Math.max(visible.top, b.top); visible.bottom = Math.min(visible.bottom, b.bottom); }
          if (['auto', 'scroll'].includes(css.overflowY) || ['auto', 'scroll'].includes(css.overflowX)) scrollAncestors.push({ id: owner.id, bounds: b, scrollTop: owner.scrollTop, scrollLeft: owner.scrollLeft, clientHeight: owner.clientHeight, scrollHeight: owner.scrollHeight, clientWidth: owner.clientWidth, scrollWidth: owner.scrollWidth });
        }
        return { bounds, visibleBounds: visible, scrollAncestors, intersects: Math.min(bounds.right, visible.right) > Math.max(bounds.left, visible.left) && Math.min(bounds.bottom, visible.bottom) > Math.max(bounds.top, visible.top) };
      });
      post.containment = await page.evaluate(measureContainment, SKULL_CONTAINMENT);
      post.containmentFindings = classifyContainment(post.containment);
      const png = fs.readFileSync(path.join(outputDir, file)), viewport = page.viewport();
      const record = { ...attempt, metrics: post, viewport, png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } };
      evidence.captures.push(record); persist();
      if (frame) assert(post.frame.intersects, 'Requested frame is outside the captured viewport or clipping ancestor');
      assert.equal(post.width, viewport.width); assert.equal(post.height, viewport.height);
      assert.equal(record.png.width, viewport.width); assert.equal(record.png.height, viewport.height);
      assert.equal(post.touchPoints > 0, Boolean(viewport.hasTouch)); assert.equal(post.coarse, Boolean(viewport.hasTouch));
      if (scale) validateFonts(post.fonts);
      assert(post.images.every(image => image.complete && image.naturalWidth > 0), 'Capture contains unloaded images');
      const raw = post.clipped.filter(c => c.proof.raw.length);
      if (raw.length) evidence.rawRangeDiagnostics.push({ file, entries: raw });
      const clipping = post.clipped.filter(c => c.visible && !(evidence.calibration?.passed && c.proof.classification === 'proven-whitespace-only'));
      if (clipping.length) evidence.findings.push({ file, kind: 'visible-text-clipping', entries: clipping });
      if (post.containmentFindings.length) evidence.findings.push({ file, kind: 'card-control-containment', entries: post.containmentFindings });
      if (post.documentWidth > post.width + 1) evidence.findings.push({ file, kind: 'page-horizontal-overflow' });
      const small = post.controls.filter(c => c.width < 48 || c.height < 48);
      if (small.length) evidence.findings.push({ file, kind: 'below48-target', controls: small });
      persist(); return record;
    } catch (error) {
      attempt.error = redact(error.message, [...secrets]);
      try { attempt.failureFonts = await page.evaluate(fonts); await page.screenshot({ path: path.join(outputDir, 'failure-' + file), fullPage: false }); } catch {}
      persist(); throw error;
    } finally { if (scale) await restore(page); }
  }
  async function calibrate(browser) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage(); await page.setViewport({ width: 375, height: 420, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
      await guardNetwork(page, new Set(), evidence.blockedRequests);
      await page.setContent('<style>body{font:16px Arial}.sample{font:20px/26px monospace;overflow:hidden;margin:20px 0}#positive{width:80px;white-space:nowrap}#wrapped{width:2ch;white-space:pre-wrap}#clear{width:300px}</style><div id="positive" class="sample">Assassinate</div><div id="wrapped" class="sample">AB CD</div><div id="clear" class="sample">Assassinate</div>');
      await settle(page); await page.evaluate(installTextGeometry);
      await page.screenshot({ path: path.join(outputDir, 'geometry-calibration.png'), fullPage: false });
      const samples = await page.evaluate(() => Object.fromEntries(['positive', 'wrapped', 'clear'].map(id => { const n = document.getElementById(id), geometry = window.__coupQATextGeometry(n.firstChild); return [id, { geometry, proof: window.__coupQAOverflowProof([geometry], n.getBoundingClientRect()) }]; })));
      evidence.calibration = { samples, passed: false }; persist();
      assert.equal(samples.positive.proof.classification, 'non-whitespace-overflow');
      assert.equal(samples.wrapped.proof.classification, 'proven-whitespace-only');
      assert.equal(samples.clear.proof.classification, 'no-overflow');
      await calibrateContainment(page, SKULL_CONTAINMENT, outputDir, evidence, persist);
      evidence.calibration.passed = true; persist();
    } finally { await context.close(); }
  }
  return { evidence, actors, secrets, origins, persist, register, ready, capture, calibrate };
}

module.exports = { createEvidence, bundleFence, guardNetwork, local, validateFonts, installTextGeometry, redact, enlarge, restore, settle, measureContainment, classifyContainment, calibrateContainment, SKULL_CONTAINMENT };
