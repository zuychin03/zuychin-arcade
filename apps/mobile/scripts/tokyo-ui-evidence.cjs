const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const assert = require('node:assert/strict');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const local = value => {
  const url = new URL(value);
  assert(['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'QA only permits loopback URLs');
  assert(!url.username && !url.password, 'URL credentials are forbidden');
  return url;
};

async function bundleFence(base, staticRoot, expected) {
  local(base);
  assert(/^[a-f0-9]{64}$/.test(expected ?? ''), 'An exact expected SHA256 is required');
  assert(staticRoot, 'QA_STATIC_ROOT is required');
  const response = await fetch(base, { redirect: 'error' });
  assert.equal(response.status, 200);
  const script = (await response.text()).match(/src="([^" ]+\/web\/[^" ]+\.js)"/)?.[1];
  assert(script, 'Export entry absent');
  const url = new URL(script, base);
  assert.equal(url.origin, new URL(base).origin, 'Export entry must remain same-origin');
  const root = path.resolve(staticRoot), diskPath = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
  assert(diskPath.startsWith(`${root}${path.sep}`), 'Export entry escapes static root');
  const served = await fetch(url, { redirect: 'error' });
  assert.equal(served.status, 200);
  const servedHash = hash(Buffer.from(await served.arrayBuffer())), diskHash = hash(fs.readFileSync(diskPath));
  assert.equal(servedHash, expected, 'Served bundle differs from expected');
  assert.equal(diskHash, expected, 'Disk bundle differs from expected');
  return { script: url.pathname, servedHash, diskHash, expected };
}

function permitted(value, origins) {
  if (value === 'about:blank' || /^(data:|blob:)/.test(value)) return true;
  try { const url = local(value); return origins.has(url.origin.replace(/^ws/, 'http')); } catch { return false; }
}

async function guardNetwork(page, origins, blocked) {
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (permitted(request.url(), origins)) void request.continue();
    else { blocked.push({ kind: 'request', reason: 'outside exact local origin allowlist' }); void request.abort(); }
  });
  await page.evaluateOnNewDocument(allowed => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(Target, args) {
        const url = new URL(String(args[0]), location.href);
        if (!allowed.includes(url.origin.replace(/^ws/, 'http'))) throw new Error('QA blocked nonlocal WebSocket');
        return Reflect.construct(Target, args);
      },
    });
  }, [...origins]);
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await pause(100);
}

async function restoreText(page) {
  await page.evaluate(() => {
    document.getElementById('tokyo-qa-scale')?.remove();
    for (const { node, oldId } of window.__tokyoText ?? []) {
      if (oldId === null) node.removeAttribute('data-tokyo-qa-text'); else node.setAttribute('data-tokyo-qa-text', oldId);
    }
    window.__tokyoText = [];
  });
  await settle(page);
}

async function scaleText(page) {
  await restoreText(page);
  const baseline = await page.evaluate(() => {
    const values = [], excluded = [];
    for (const node of document.querySelectorAll('body *')) {
      if (![...node.childNodes].some(c => c.nodeType === Node.TEXT_NODE && c.textContent.trim())) continue;
      const css = getComputedStyle(node), r = node.getBoundingClientRect(), text = node.textContent.trim().slice(0, 140);
      const reason = node.closest('[aria-hidden="true"]') ? 'aria-hidden' : !r.width || !r.height ? 'no-layout-box' : css.visibility !== 'visible' ? 'hidden' : /icon|material|fontawesome/i.test(css.fontFamily) ? 'icon-glyph' : null;
      if (reason) { excluded.push({ text, reason }); continue; }
      const before = parseFloat(css.fontSize);
      if (!Number.isFinite(before) || before <= 0) throw new Error('Invalid visible font');
      values.push({ node, before, line: parseFloat(css.lineHeight), family: css.fontFamily, text, oldId: node.getAttribute('data-tokyo-qa-text') });
    }
    window.__tokyoText = values;
    const style = document.createElement('style'); style.id = 'tokyo-qa-scale';
    style.textContent = values.map((v, i) => {
      v.node.setAttribute('data-tokyo-qa-text', String(i));
      return `[data-tokyo-qa-text="${i}"]{transition:none!important;font-size:${v.before * 2}px!important;${Number.isFinite(v.line) ? `line-height:${v.line * 2}px!important;` : ''}}`;
    }).join('\n');
    document.head.appendChild(style);
    return { samples: values.map(({ before, family, text }) => ({ before, family, text })), excluded };
  });
  await settle(page);
  return baseline;
}

function measuredFonts() {
  return (window.__tokyoText ?? []).map(({ node, before, family, text }) => ({ text, before, family, connected: node.isConnected, after: parseFloat(getComputedStyle(node).fontSize), afterFamily: getComputedStyle(node).fontFamily }));
}

function validateFonts(samples) {
  assert(samples.length > 0, 'No enlarged text measured');
  assert(samples.every(s => s.connected && s.afterFamily === s.family && Math.abs(s.after - s.before * 2) < 0.01), 'Post-capture text identity/doubling failed');
}

function installTextGeometry() {
  window.__coupQATextGeometry = node => {
    const range = node.ownerDocument.createRange();
    const rects = () => [...range.getClientRects()].map(r => ({ x: r.x, y: r.y, left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
    range.selectNodeContents(node);
    const rawRects = rects(), characters = [];
    let offset = 0;
    for (const character of node.textContent) {
      const end = offset + character.length;
      range.setStart(node, offset); range.setEnd(node, end);
      characters.push({ character, start: offset, end, whitespace: /^\s$/u.test(character), rects: rects() });
      offset = end;
    }
    return { text: node.textContent, rawRects, characters, glyphRects: characters.filter(c => !c.whitespace).flatMap(c => c.rects.map(r => ({ character: c.character, start: c.start, end: c.end, ...r }))) };
  };
  window.__coupQAOverflowProof = (geometry, bounds, x = true, y = false, tolerance = 1) => {
    const outside = r => (x && (r.left < bounds.left - tolerance || r.right > bounds.right + tolerance)) || (y && (r.top < bounds.top - tolerance || r.bottom > bounds.bottom + tolerance));
    const raw = geometry.flatMap(t => t.rawRects.filter(outside));
    const glyphs = geometry.flatMap(t => t.glyphRects.filter(outside));
    const whitespace = geometry.flatMap(t => t.characters.filter(c => c.whitespace).flatMap(c => c.rects.filter(outside).map(r => ({ character: c.character, start: c.start, end: c.end, ...r }))));
    const unexplained = raw.filter(r => !whitespace.some(w => ['left', 'right', 'top', 'bottom'].every(key => Math.abs(r[key] - w[key]) < 0.25)));
    return { raw, glyphs, whitespace, unexplained, classification: glyphs.length ? 'non-whitespace-overflow' : !raw.length ? 'no-overflow' : !unexplained.length && whitespace.length ? 'proven-whitespace-only' : 'unexplained-range-overflow' };
  };
}

function createEvidence({ outputDir, base, api }) {
  local(base); local(api);
  const origins = new Set([new URL(base).origin, new URL(api).origin, 'https://localhost:3214']);
  const evidence = { method: 'Automated own-view browser actions; fixtures separately labelled; synthetic CSS text scaling is not native fontScale', captures: [], attempts: [], visualFindings: [], rawRangeDiagnostics: [], cleanup: [], blockedRequests: [], browserClosed: false };
  const actors = new Map();
  const imageHashes = new Map();
  const categoryHashes = Object.fromEntries(['attack', 'defense', 'dice', 'energy', 'healing', 'market', 'victory', 'wild'].map(category => [hash(fs.readFileSync(path.join(__dirname, `../assets/game-art/tokyo-power-${category}.webp`))), category]));
  evidence.artworkSources = categoryHashes;
  let sequence = 0;
  const persist = () => { fs.mkdirSync(outputDir, { recursive: true }); fs.writeFileSync(path.join(outputDir, 'receipt.json'), `${JSON.stringify(evidence, null, 2)}\n`); };
  const register = actor => actors.set(actor.page, actor);
  async function ready(page, { disconnected = false, publicTable = false } = {}) {
    const actor = actors.get(page);
    await settle(page);
    if (actor?.lastAcceptedAt) await pause(Math.max(0, 2700 - (Date.now() - actor.lastAcceptedAt)));
    if (page.url().endsWith('/king-of-tokyo/game')) {
      const auth = await page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null'));
      assert(auth && actor?.state?.viewerPlayerId === auth.playerId && actor.state.roomCode === auth.roomCode, 'Capture requires fresh viewer-owned frame');
      await page.waitForFunction(table => Boolean(document.getElementById(table ? 'tokyo-table-state' : 'king-current-decision') || document.getElementById('king-of-tokyo-game-over')), { timeout: 10000 }, publicTable);
      if (!disconnected) assert(!(await page.$('[aria-label="Connection status"]')), 'Capture during reconnect');
    }
    await settle(page);
  }
  async function capture(page, name, { scale = false, frame = null, frameAlign = 'center', allowDisconnected = false, publicTable = false } = {}) {
    assert(sequence < 140, 'Bounded140 capture budget exceeded');
    const file = `${String(++sequence).padStart(3, '0')}-${name}`, actor = actors.get(page);
    const attempt = { file, actor: actor?.name ?? 'calibration', revision: actor?.state?.revision ?? null, scale: scale ? 200 : 100, viewport: page.viewport(), baseline: null };
    evidence.attempts.push(attempt); persist();
    try {
      await ready(page, { disconnected: allowDisconnected, publicTable });
      if (scale) { attempt.baseline = await scaleText(page); persist(); }
      if (frame) await page.$eval(frame, (n, block) => n.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' }), frameAlign);
      await settle(page);
      attempt.preCaptureFonts = await page.evaluate(measuredFonts); persist();
      await page.screenshot({ path: path.join(outputDir, file), fullPage: false });
      await page.evaluate(installTextGeometry);
      const metrics = await page.evaluate(() => {
        const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const clipped = [], controls = [];
        for (const node of document.querySelectorAll('body *')) {
          const css = getComputedStyle(node), r = rect(node);
          if (!r.width || !r.height || css.visibility !== 'visible' || node.closest('[aria-hidden="true"]')) continue;
          if (node.matches('[role="button"],button')) controls.push({ label: node.getAttribute('aria-label') ?? node.textContent.trim(), ...r });
          if (/icon|material|fontawesome/i.test(css.fontFamily)) continue;
          const texts = [...node.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
          if (!texts.length) continue;
          const geometry = texts.map(window.__coupQATextGeometry);
          let scrollX = false, scrollY = false;
          for (let parent = node; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent), b = rect(parent);
            scrollX ||= ['auto', 'scroll'].includes(style.overflowX) && parent.scrollWidth > parent.clientWidth;
            scrollY ||= ['auto', 'scroll'].includes(style.overflowY) && parent.scrollHeight > parent.clientHeight;
            const x = !scrollX && ['hidden', 'clip'].includes(style.overflowX), y = !scrollY && ['hidden', 'clip'].includes(style.overflowY);
            const proof = window.__coupQAOverflowProof(geometry, b, x, y, 2);
            if (proof.raw.length || proof.glyphs.length) {
              let visible = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
              for (let owner = node.parentElement; owner; owner = owner.parentElement) {
                const s = getComputedStyle(owner), box = rect(owner);
                if (['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowX)) { visible.left = Math.max(visible.left, box.left); visible.right = Math.min(visible.right, box.right); }
                if (['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowY)) { visible.top = Math.max(visible.top, box.top); visible.bottom = Math.min(visible.bottom, box.bottom); }
              }
              clipped.push({ text: texts.map(n => n.textContent).join(''), geometry, proof, ancestor: parent.id || parent.tagName, x, y, visibleAfterAncestorClipping: visible.right > visible.left && visible.bottom > visible.top && geometry.some(g => g.rawRects.some(b => b.right > visible.left && b.left < visible.right && b.bottom > visible.top && b.top < visible.bottom)) });
              break;
            }
          }
        }
        return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, clipped, controls,
          layout: Object.fromEntries(['tokyo-toolbar', 'king-play-area', 'king-current-decision', 'tokyo-table-state', 'tokyo-active-dice-tray', 'tokyo-public-dice-tray', 'tokyo-result-summary', 'tokyo-result-actions', 'tokyo-result-roster', 'tokyo-entrance-art', 'game-cover-tokyo'].map(id => { const n = document.getElementById(id); return [id, n ? rect(n) : null]; })),
          dice: [...document.querySelectorAll('[aria-label^="Die "]')].map(n => ({ label: n.getAttribute('aria-label'), selected: n.getAttribute('aria-selected'), text: n.textContent, ...rect(n) })),
          powerCards: [...document.querySelectorAll('[data-testid^="tokyo-power-card-"]')].map(n => ({ testID: n.getAttribute('data-testid'), text: n.textContent, ...rect(n), artwork: Boolean(n.querySelector('[data-testid^="tokyo-power-art-"] img')), selectedInstruction: n.querySelector('[data-testid^="tokyo-power-selection-"]')?.textContent ?? null })),
          regions: [...document.querySelectorAll('[role="region"],#king-current-decision,#king-of-tokyo-game-over')].map(n => ({ id: n.id, label: n.getAttribute('aria-label'), ...rect(n), scrollTop: n.scrollTop, scrollHeight: n.scrollHeight, clientHeight: n.clientHeight })) };
      });
      metrics.cardLayout = await page.evaluate(measureCardLayout);
      metrics.cardLayoutFindings = classifyCardLayout(metrics.cardLayout);
      metrics.decisionControls = await page.evaluate(measureDecisionControls);
      metrics.decisionControlFindings = classifyCardLayout(metrics.decisionControls);
      metrics.fonts = await page.evaluate(measuredFonts);
      metrics.images = await page.$$eval('img', nodes => nodes.map(n => ({ source: n.currentSrc || n.src, complete: n.complete, naturalWidth: n.naturalWidth, naturalHeight: n.naturalHeight })));
      for (const image of metrics.images) {
        if (!/^https?:/.test(image.source)) { image.source = 'inline'; continue; }
        assert(permitted(image.source, origins), 'Image source outside local allowlist');
        if (!imageHashes.has(image.source)) {
          const response = await fetch(image.source, { redirect: 'error', signal: AbortSignal.timeout(5000) });
          assert.equal(response.status, 200, 'Image retrieval failed'); imageHashes.set(image.source, hash(Buffer.from(await response.arrayBuffer())));
        }
        image.sha256 = imageHashes.get(image.source); image.category = categoryHashes[image.sha256] ?? null;
        image.source = new URL(image.source).pathname;
      }
      if (frame) metrics.frame = await page.$eval(frame, n => { const r = n.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, control: n.matches('[role="button"],button'), hit: hit === n || n.contains(hit) }; });
      const viewport = page.viewport(), png = fs.readFileSync(path.join(outputDir, file));
      const record = { ...attempt, metrics, actualViewport: viewport, png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } };
      evidence.captures.push(record); persist();
      assert.equal(metrics.width, viewport.width); assert.equal(metrics.height, viewport.height);
      assert.equal(record.png.width, viewport.width); assert.equal(record.png.height, viewport.height);
      assert.equal(metrics.touchPoints > 0, Boolean(viewport.hasTouch)); assert.equal(metrics.coarse, Boolean(viewport.hasTouch));
      if (scale) validateFonts(metrics.fonts);
      assert(metrics.images.every(i => i.complete && i.naturalWidth > 0), 'Capture contains unloaded image');
      if (metrics.frame?.control) assert(metrics.frame.left >= -1 && metrics.frame.right <= metrics.width + 1 && metrics.frame.top >= -1 && metrics.frame.bottom <= metrics.height + 1 && metrics.frame.hit, 'Framed control clipped or occluded');
      const raw = metrics.clipped.filter(c => c.proof.raw.length); if (raw.length) evidence.rawRangeDiagnostics.push({ file, entries: raw });
      const failures = metrics.clipped.filter(c => c.visibleAfterAncestorClipping && !(evidence.calibration?.passed && c.proof.classification === 'proven-whitespace-only'));
      if (failures.length) evidence.visualFindings.push({ file, kind: 'visible-text-clipping', entries: failures });
      if (metrics.cardLayoutFindings.length) evidence.visualFindings.push({ file, kind: 'card-content-layout', entries: metrics.cardLayoutFindings });
      if (metrics.decisionControlFindings.length) evidence.visualFindings.push({ file, kind: 'decision-control-layout', entries: metrics.decisionControlFindings });
      if (metrics.documentWidth > metrics.width + 1) evidence.visualFindings.push({ file, kind: 'page-horizontal-overflow' });
      const small = metrics.controls.filter(c => c.width < 48 || c.height < 48);
      if (small.length) evidence.visualFindings.push({ file, kind: 'below48-design-floor', controls: small });
      persist(); return record;
    } catch (error) {
      attempt.error = error.message; persist();
      try { await page.screenshot({ path: path.join(outputDir, `failure-${file}`), fullPage: false }); } catch {}
      throw error;
    } finally { if (scale) await restoreText(page); }
  }
  async function calibrate(browser) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage(); await page.setViewport({ width: 375, height: 420, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
      await guardNetwork(page, new Set(), evidence.blockedRequests);
      await page.setContent('<style>body{font:16px Arial}.sample{font:20px/26px monospace;overflow:hidden;margin:20px 0;background:#eee}#positive{width:80px;white-space:nowrap}#wrapped{width:2ch;white-space:pre-wrap}#clear{width:300px}</style><div id="positive" class="sample">Assassinate</div><div id="wrapped" class="sample">AB CD</div><div id="clear" class="sample">Assassinate</div>');
      await settle(page); await page.evaluate(installTextGeometry);
      await page.screenshot({ path: path.join(outputDir, 'geometry-calibration.png'), fullPage: false });
      const samples = await page.evaluate(() => Object.fromEntries(['positive', 'wrapped', 'clear'].map(id => { const n = document.getElementById(id), b = n.getBoundingClientRect(), geometry = window.__coupQATextGeometry(n.firstChild); return [id, { geometry, proof: window.__coupQAOverflowProof([geometry], b) }]; })));
      evidence.calibration = { samples, passed: false }; persist();
      assert.equal(samples.positive.proof.classification, 'non-whitespace-overflow'); assert(samples.positive.proof.glyphs.length > 0);
      assert.equal(samples.wrapped.proof.classification, 'proven-whitespace-only'); assert(samples.wrapped.proof.raw.length > 0);
      assert.equal(samples.clear.proof.classification, 'no-overflow');
      await page.setContent('<style>body{margin:0}section{position:relative;width:300px}article{position:relative;width:300px}button{width:200px;height:48px}#bad{height:180px}#bad button{position:absolute;top:210px}#next{height:100px}#good{height:100px;margin-top:100px}</style><section><article id="bad" data-testid="tokyo-power-card-bad"><button>PRIVATE BUY</button></article><article id="next" data-testid="tokyo-power-card-next">NEXT CARD</article><article id="good" data-testid="tokyo-power-card-good"><button>CONTAINED BUY</button></article></section>');
      await settle(page); await page.evaluate(installTextGeometry);
      const cardLayout = await page.evaluate(measureCardLayout), findings = classifyCardLayout(cardLayout);
      evidence.calibration.cardLayout = { measurements: cardLayout, findings, passed: false }; persist();
      await page.screenshot({ path: path.join(outputDir, 'card-layout-calibration.png'), fullPage: false });
      assert(findings.some(f => f.card === 'tokyo-power-card-bad' && f.kind === 'content-outside-card'));
      assert(findings.some(f => f.card === 'tokyo-power-card-bad' && f.kind === 'content-overlaps-sibling' && f.sibling === 'tokyo-power-card-next'));
      assert(!findings.some(f => f.card === 'tokyo-power-card-good'));
      evidence.calibration.cardLayout.passed = true;
      await page.setContent('<style>body{margin:0}#king-current-decision{position:absolute;left:10px;top:10px;width:180px;height:160px}button{position:absolute;top:10px;height:48px}#bad-action{left:120px;width:180px}#good-action{left:0;top:80px;width:180px}#tokyo-table-state{position:absolute;left:210px;top:10px;width:160px;height:160px;background:#888}</style><section id="king-current-decision"><button id="bad-action">OVERLAPPING ALTERNATIVE</button><button id="good-action">CONTAINED ALTERNATIVE</button></section><section id="tokyo-table-state">TABLE</section>');
      await settle(page);
      const decisionControls = await page.evaluate(measureDecisionControls), decisionFindings = classifyCardLayout(decisionControls);
      evidence.calibration.decisionControls = { measurements: decisionControls, findings: decisionFindings, passed: false }; persist();
      await page.screenshot({ path: path.join(outputDir, 'decision-controls-calibration.png'), fullPage: false });
      assert(decisionFindings.some(f => f.kind === 'content-outside-card' && f.content.label === 'OVERLAPPING ALTERNATIVE'));
      assert(decisionFindings.some(f => f.kind === 'content-overlaps-sibling' && f.sibling === 'tokyo-table-state'));
      assert(!decisionFindings.some(f => f.content.label === 'CONTAINED ALTERNATIVE'));
      evidence.calibration.decisionControls.passed = true; evidence.calibration.passed = true; persist();
    } finally { await context.close(); }
  }
  return { evidence, actors, origins, persist, register, ready, capture, calibrate };
}

function matchArenaLabel(label, state) {
  if (!state || ![1, 2].includes(state.tokyoCapacity)) return null;
  const city = state.players.find(player => player.tokyoZone === 'tokyo_city')?.displayName ?? 'nobody';
  const bay = state.tokyoCapacity > 1 ? state.players.find(player => player.tokyoZone === 'tokyo_bay')?.displayName ?? 'nobody' : null;
  const expected = `Tokyo arena, capacity ${state.tokyoCapacity}. City occupied by ${city}${bay === null ? ', Bay closed' : `, Bay occupied by ${bay}`}`;
  return label === expected ? { label, capacity: state.tokyoCapacity, city, bay } : null;
}

function measureCardLayout() {
  const rect = node => { const b = node.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  const visible = node => { const s = getComputedStyle(node); return s.display !== 'none' && s.visibility === 'visible' && !node.closest('[aria-hidden="true"]'); };
  const cards = [...document.querySelectorAll('[data-testid^="tokyo-power-card-"]')].filter(visible);
  const siblings = [...cards, ...document.querySelectorAll('[role="button"],button')].filter(visible);
  return { viewport: { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, cards: cards.map(card => {
    const content = [];
    for (const node of card.querySelectorAll('*')) {
      if (!visible(node)) continue;
      if (node.matches('img,[role="button"],button')) content.push({ kind: node.tagName === 'IMG' ? 'art' : 'control', label: node.getAttribute('aria-label') ?? node.textContent, bounds: rect(node) });
      for (const text of node.childNodes) if (text.nodeType === Node.TEXT_NODE && text.textContent.trim()) {
        for (const glyph of window.__coupQATextGeometry(text).glyphRects) content.push({ kind: 'glyph', label: glyph.character, bounds: glyph });
      }
    }
    return { id: card.getAttribute('data-testid'), bounds: rect(card), content, siblings: siblings.filter(n => n !== card && !card.contains(n) && !n.contains(card)).map(n => ({ id: n.getAttribute('data-testid') ?? n.getAttribute('aria-label') ?? n.textContent, bounds: rect(n) })) };
  }) };
}

function classifyCardLayout(measurements) {
  const intersect = (a, b) => ({ left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) });
  const substantial = b => b.right - b.left > 2 && b.bottom - b.top > 2;
  const findings = [];
  for (const card of measurements.cards) for (const content of card.content) {
    const b = content.bounds, owner = card.bounds;
    const outside = b.left < owner.left - 2 || b.right > owner.right + 2 || b.top < owner.top - 2 || b.bottom > owner.bottom + 2;
    if (!outside || !substantial(intersect(b, measurements.viewport))) continue;
    findings.push({ kind: 'content-outside-card', card: card.id, content, cardBounds: owner });
    for (const sibling of card.siblings) {
      const overlap = intersect(intersect(b, sibling.bounds), measurements.viewport);
      if (substantial(overlap)) findings.push({ kind: 'content-overlaps-sibling', card: card.id, sibling: sibling.id, content, siblingBounds: sibling.bounds, overlap });
    }
  }
  return findings;
}

function measureDecisionControls() {
  const rect = node => { const b = node.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  const decision = document.getElementById('king-current-decision'), table = document.getElementById('tokyo-table-state');
  const content = decision ? [...decision.querySelectorAll('[role="button"],button')].filter(n => {
    const s = getComputedStyle(n), b = rect(n);
    return s.visibility === 'visible' && s.display !== 'none' && !n.closest('[aria-hidden="true"]') && b.right > b.left && b.bottom > b.top;
  }).map(n => ({ kind: 'control', label: n.getAttribute('aria-label') ?? n.textContent.trim(), bounds: rect(n) })) : [];
  return { viewport: { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, cards: decision ? [{ id: 'king-current-decision', bounds: rect(decision), content, siblings: table ? [{ id: 'tokyo-table-state', bounds: rect(table) }] : [] }] : [] };
}

module.exports = { createEvidence, bundleFence, guardNetwork, permitted, local, validateFonts, installTextGeometry, matchArenaLabel, measureCardLayout, classifyCardLayout, measureDecisionControls };
