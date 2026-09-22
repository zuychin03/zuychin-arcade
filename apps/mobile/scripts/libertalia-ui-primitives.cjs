const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const { redact: baseRedact, restore, settle, validateFonts } = require('./skull-ui-evidence.cjs');

function redact(value, secrets = []) {
  const scrub = text => baseRedact(text, secrets).replace(/\b(password|token|authorization)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi, '$1=[redacted]');
  if (typeof value === 'string') return scrub(value);
  return JSON.stringify(value, (key, item) => /^(token|password|authorization|credentials|auth)$/i.test(key) ? '[redacted]' : typeof item === 'string' ? scrub(item) : item);
}

function readLibertaliaFontState() {
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
  const snapshot = window.__libertaliaFontSnapshot;
  const fonts = eligible.map(({ node, css, text }) => {
    const value = values.find(value => value.node === node);
    return { text, before: value?.before, family: value?.family, connected: node.isConnected, after: parseFloat(css.fontSize), afterFamily: css.fontFamily };
  });
  return { fonts, excluded, eligibleCount: eligible.length,
    missing: eligible.filter(({ node }) => !values.some(value => value.node === node)).map(({ text }) => text),
    detachedHistory: values.filter(({ node }) => !node.isConnected).map(({ text, before, family, generation }) => ({ text, before, family, generation })),
    changedAfterConvergence: snapshot ? snapshot.filter(node => !eligible.some(item => item.node === node)).length + eligible.filter(({ node }) => !snapshot.includes(node)).length : 0 };
}

function registerLibertaliaText(generation) {
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

function validateLibertaliaFontState(state) {
  assert.equal(state.missing.length, 0, 'Current mounted text is missing its authentic font baseline');
  assert.equal(state.changedAfterConvergence, 0, 'Mounted text changed after font convergence');
  assert.equal(state.fonts.length, state.eligibleCount, 'Current mounted text coverage is incomplete');
  validateFonts(state.fonts);
}

async function restoreLibertaliaText(page) {
  await restore(page);
  await page.evaluate(() => { delete window.__libertaliaFontSnapshot; });
}

async function enlargeLibertaliaText(page) {
  await restoreLibertaliaText(page);
  let stable = 0;
  for (let generation = 0; generation < 8; generation++) {
    const added = await page.evaluate(registerLibertaliaText, generation);
    await settle(page);
    const state = await page.evaluate(readLibertaliaFontState);
    stable = added === 0 && state.missing.length === 0 ? stable + 1 : 0;
    if (stable >= 2) {
      validateLibertaliaFontState(state);
      await page.evaluate(() => {
        window.__libertaliaFontSnapshot = (window.__skullText ?? []).filter(({ node }) => {
          const css = getComputedStyle(node), box = node.getBoundingClientRect();
          const text = node.matches('input,textarea') || [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
          return text && node.isConnected && box.width > 0 && box.height > 0 && css.visibility === 'visible' && !node.closest('[aria-hidden="true"],[hidden],[inert]') && !/icon|material|fontawesome/i.test(css.fontFamily);
        }).map(({ node }) => node);
      });
      const final = await page.evaluate(readLibertaliaFontState); validateLibertaliaFontState(final);
      return { samples: final.fonts.map(({ text, before, family }) => ({ text, before, family })), excluded: final.excluded, detachedHistory: final.detachedHistory, passes: generation + 1 };
    }
  }
  throw new Error('Libertalia text enlargement did not converge within eight bounded passes');
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


function assertFrameCoverage(records) {
  assert(records.length > 0, 'Frame coverage requires captures');
  const spans = records.map(record => {
    const frame = record.metrics.frame, visible = record.metrics.frameVisibleBounds;
    assert(frame && visible && frame.width > 0 && frame.height > 0, 'Frame must be mounted');
    assert(frame.left >= visible.left - 2 && frame.right <= visible.right + 2, 'Frame escapes its visible width');
    return { start: Math.max(0, visible.top - frame.top), end: Math.min(frame.height, visible.bottom - frame.top), height: frame.height };
  }).sort((a, b) => a.start - b.start);
  assert(spans.every(span => Math.abs(span.height - spans[0].height) < 2), 'Frame changed height between captures');
  let covered = 0;
  for (const span of spans) {
    assert(span.end > span.start && span.start <= covered + 2, 'Uncaptured gap inside frame');
    covered = Math.max(covered, span.end);
  }
  assert(covered >= spans[0].height - 2, 'Frame bottom remains uncaptured');
  return { height: spans[0].height, covered, files: records.map(record => record.file) };
}

module.exports = { redact, persistReceipt, readLibertaliaFontState, registerLibertaliaText, validateLibertaliaFontState, restoreLibertaliaText, enlargeLibertaliaText, frameVisibility, assertFrameCoverage };
