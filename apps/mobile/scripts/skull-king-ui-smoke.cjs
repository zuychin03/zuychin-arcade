const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { createEvidence, bundleFence, guardNetwork, local, redact } = require('./skull-ui-evidence.cjs');

const BASE_URL = process.env.SKULL_KING_WEB_URL ?? 'http://127.0.0.1:8081';
const TARGET = process.env.SKULL_KING_UI_TARGET ?? 'full';
const API_URL = process.env.SKULL_KING_API_URL ?? 'http://127.0.0.1:3213';
const BROWSER_PATH = process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const outputDir = process.env.SKULL_KING_UI_OUTPUT_DIR ?? path.join(os.tmpdir(), `zuychin-arcade-skull-king-ui-${runId}`);
const consoleIssues = [];
let qa = null;

async function resize(page, dimensions) {
  const before = page.viewport();
  await page.setViewport({ ...before, ...dimensions, deviceScaleFactor: 1, isMobile: before.isMobile, hasTouch: before.hasTouch });
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function waitUntil(check, message, timeout = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${message}`);
}

async function visibleButtonData(page, scope = 'body') {
  return page.evaluate(selector => [...document.querySelectorAll(selector)]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        label: element.getAttribute('aria-label'),
        disabled: element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled'),
        visible: !element.closest('[aria-hidden="true"]') && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0,
        width: rect.width,
        height: rect.height,
      };
    })
    .filter((item) => item.visible && item.label), `${scope} [role="button"][aria-label]`);
}

async function hasButton(page, pattern, enabledOnly = true, scope = 'body') {
  return (await visibleButtonData(page, scope)).some((button) => pattern.test(button.label) && (!enabledOnly || !button.disabled));
}

async function findButton(page, pattern, enabledOnly = true, scope = 'body') {
  const buttons = await page.$$(`${scope} [role="button"][aria-label]`);
  for (const button of buttons) {
    const matches = await button.evaluate((element, matcher) => {
      const regex = new RegExp(matcher.source, matcher.flags);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const disabled = element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
      return regex.test(element.getAttribute('aria-label') ?? '')
        && !element.closest('[aria-hidden="true"]')
        && rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > 0
        && (!matcher.enabledOnly || !disabled);
    }, { source: pattern.source, flags: pattern.flags, enabledOnly });
    if (matches) return button;
    await button.dispose();
  }
  return null;
}

async function clickButton(page, pattern, timeout = 45_000, scope = 'body') {
  await waitUntil(() => hasButton(page, pattern, true, scope), `enabled button ${pattern}`, timeout);
  const button = await findButton(page, pattern, true, scope);
  assert(button, `Could not find enabled button ${pattern}`);
  try {
    await button.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await waitUntil(async () => {
      const settled = await button.boundingBox();
      return Boolean(settled && settled.width >= 48 && settled.height >= 48);
    }, `settled touch target ${pattern}`, 3_000);
    const bounds = await button.boundingBox();
    assert(bounds && bounds.width >= 48 && bounds.height >= 48, `Touch target too small for ${pattern}: ${JSON.stringify(bounds)}`);
    const matchedLabel = await button.evaluate(n => n.getAttribute('aria-label'));
    if (scope !== 'body') await waitUntil(() => button.evaluate(n => {
      const r = n.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === n || n.contains(top);
    }), `Unobscured scoped target ${matchedLabel}`, 3000);
    if (page.viewport().hasTouch) await button.tap(); else await button.click();
    if (qa) { qa.evidence.inputs ??= []; qa.evidence.inputs.push({ actor: qa.actors.get(page)?.name, method: page.viewport().hasTouch ? 'touch' : 'pointer', control: String(pattern), matchedLabel, scope }); }
    await delay(100);
  } finally {
    await button.dispose();
  }
}

async function setInput(page, label, value) {
  await waitUntil(async () => {
    const handles = await page.$$(`input[aria-label="${label}"]`);
    for (const handle of handles) {
      const visible = await handle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      await handle.dispose();
      if (visible) return true;
    }
    return false;
  }, `visible input ${label}`);
  const handle = await page.$(`input[aria-label="${label}"]`);
  assert(handle, `Input not found: ${label}`);
  try {
    await handle.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    if (value) await page.keyboard.type(value);
    await waitUntil(() => handle.evaluate((element, expected) => element.value === expected, value), `${label} value`);
  } finally {
    await handle.dispose();
  }
}

async function waitForText(page, text, timeout = 45_000) {
  await page.waitForFunction((needle) => document.body.innerText.includes(needle), { timeout }, text);
}

async function waitForPath(page, suffix) {
  await page.waitForFunction((expected) => location.pathname.endsWith(expected), { timeout: 45_000 }, suffix);
}

async function screenshot(page, name, options = {}) {
  if (qa) return qa.capture(page, name, typeof options === 'object' ? options : {});
  await page.evaluate(() => document.fonts.ready);
  await delay(160);
  await page.screenshot({ path: path.join(outputDir, name), fullPage: false });
}

async function assertNoHorizontalOverflow(player) {
  const result = await player.page.evaluate(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert(result.documentWidth <= result.width + 1 && result.bodyWidth <= result.width + 1, `${player.name} has horizontal page overflow: ${JSON.stringify(result)}`);
}

async function assertVisibleTouchTargets(player) {
  const undersized = (await visibleButtonData(player.page)).filter((button) => button.width < 48 || button.height < 48);
  assert(undersized.length === 0, `${player.name} has undersized visible controls: ${JSON.stringify(undersized)}`);
}

async function openPlayer(browser, name, width, height, reduceMotion = false) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, hasTouch: width < 768, isMobile: width < 768 });
  if (qa) await guardNetwork(page, qa.origins, qa.evidence.blockedRequests);
  if (reduceMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('console', (message) => {
    if (message.text().includes('[Reanimated] Reduced motion setting is enabled')) return;
    if (['warning', 'error'].includes(message.type())) consoleIssues.push({ player: name, type: message.type(), text: redact(message.text(), [...qa?.secrets ?? []]) });
  });
  page.on('pageerror', (error) => consoleIssues.push({ player: name, type: 'pageerror', text: redact(error.message, [...qa?.secrets ?? []]) }));
  const player = { name, width, height, context, page, acks: [], rejections: [], public: null, private: null };
  if (qa) qa.register(player);
  page.on('response', async response => {
    try {
      const url = new URL(response.url());
      if (qa && /\/rooms\/[^/]+\/leave$/.test(url.pathname) && response.request().method() === 'POST') {
        qa.evidence.cleanup.push({ actor: name, normalUI: !player.fallbackCleanup, status: response.status(), authCleared: false }); qa.persist();
      }
    } catch {}
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    if (!response.payloadData.startsWith('42')) return;
    let frame;
    try { frame = JSON.parse(response.payloadData.slice(2)); } catch { return; }
    const [event, state] = frame;
    if (event === 'room_updated') player.room = state;
    if (event === 'game_state' && state?.gameId === 'skull_king') player.public = state;
    if (event === 'private_state' && state?.gameId === 'skull_king') player.private = state;
    if (event === 'skull_king:action_accepted') { player.acks.push(state); player.lastAcceptedAt = Date.now(); }
    if (event === 'action_rejected') player.rejections.push(state);
  });
  return player;
}

async function joinPlayer(player, roomCode, password, options = {}) {
  await player.page.goto(`${BASE_URL}/skull-king/join`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await setInput(player.page, 'Your name', player.name);
  if (options.validation) {
    await setInput(player.page, 'Room code', 'BAD');
    await clickButton(player.page, /^JOIN GAME$/);
    await waitForText(player.page, 'Enter a valid room code');
    await screenshot(player.page, '04-join-validation-360.png');
  }
  await setInput(player.page, 'Room code', roomCode);
  if (options.wrongPassword) {
    const issueStart = consoleIssues.length;
    await setInput(player.page, 'Room password, optional', password.trim());
    await clickButton(player.page, /^JOIN GAME$/);
    await waitForText(player.page, 'Wrong password');
    await delay(100);
    const expected403 = consoleIssues.findIndex((issue, index) => index >= issueStart
      && issue.player === player.name
      && issue.type === 'error'
      && issue.text === 'Failed to load resource: the server responded with a status of 403 (Forbidden)');
    if (expected403 >= 0) consoleIssues.splice(expected403, 1);
    await screenshot(player.page, '05-wrong-password-360.png');
  }
  await setInput(player.page, 'Room password, optional', password);
  await clickButton(player.page, /^JOIN GAME$/);
  await waitForPath(player.page, '/skull-king/lobby');
  if (qa) await qa.ready(player.page);
}

async function exerciseSharedFocusAtZoom(player) {
  await resize(player.page, { width: 1280, height: 900 });
  await player.page.goto(`${BASE_URL}/skull-king`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForText(player.page, 'SKULL KING');
  await player.page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await waitUntil(async () => {
    await player.page.keyboard.press('Tab');
    return player.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Your name');
  }, 'keyboard traversal reaches input', 5_000);
  const inputFocus = await player.page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const style = getComputedStyle(active);
    return { label: active.getAttribute('aria-label'), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  assert(inputFocus?.outlineStyle === 'solid' && Number.parseFloat(inputFocus.outlineWidth) >= 3, `Input focus is not visible at 200%: ${JSON.stringify(inputFocus)}`);

  await clickButton(player.page, /^HOW TO PLAY$/);
  await waitForText(player.page, 'Digital Base Voyage');
  await player.page.keyboard.press('Tab');
  const modalFocus = await player.page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const style = getComputedStyle(active);
    return { label: active.getAttribute('aria-label'), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  assert(['Close rules', 'Skull King rules and card reference'].includes(modalFocus?.label) && modalFocus.outlineStyle === 'solid' && Number.parseFloat(modalFocus.outlineWidth) >= 3, `Modal focus is not visible at high DPI: ${JSON.stringify(modalFocus)}`);
  await screenshot(player.page, '00-keyboard-focus-200-percent.png', { scale: true });
  await player.page.keyboard.press('Escape');
  await waitUntil(
    () => player.page.evaluate(() => !document.getElementById('rules-reference-sheet')),
    'Escape closes the rules dialog',
  );
  const keyboardRestore = await player.page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const style = getComputedStyle(active);
    return { label: active.getAttribute('aria-label'), focusVisible: active.matches(':focus-visible'), outlineStyle: style.outlineStyle };
  });
  assert(keyboardRestore?.label === 'HOW TO PLAY' && keyboardRestore.focusVisible && keyboardRestore.outlineStyle === 'solid', `Keyboard focus was not restored visibly: ${JSON.stringify(keyboardRestore)}`);

  await player.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForText(player.page, 'SKULL KING');
  await clickButton(player.page, /^HOW TO PLAY$/);
  await waitForText(player.page, 'Digital Base Voyage');
  await clickButton(player.page, /^Close rules$/);
  await delay(100);
  const pointerRestore = await player.page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const style = getComputedStyle(active);
    return { label: active.getAttribute('aria-label'), focusVisible: active.matches(':focus-visible'), outlineStyle: style.outlineStyle };
  });
  assert(pointerRestore?.label === 'HOW TO PLAY' && !pointerRestore.focusVisible && pointerRestore.outlineStyle === 'none', `Pointer focus left a persistent outline: ${JSON.stringify(pointerRestore)}`);
  await resize(player.page, { width: player.width, height: player.height });
}

async function createRoomJourney(host, password) {
  await host.page.goto(`${BASE_URL}/skull-king`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForText(host.page, 'SKULL KING');
  await waitUntil(() => hasButton(host.page, /^Back to arcade$/), 'accessible landing Back control');
  await setInput(host.page, 'Your name', '');
  await clickButton(host.page, /^CREATE ROOM$/);
  await delay(600);
  const validationBody = await host.page.evaluate(() => document.body.innerText);
  assert(validationBody.includes('Enter the name other players will see.'), `Name validation did not render. URL: ${host.page.url()}. Body: ${validationBody.slice(0, 800)}`);
  await assertNoHorizontalOverflow(host);
  await assertVisibleTouchTargets(host);
  await screenshot(host.page, '01-landing-validation-320.png', true);
  await resize(host.page, { width: 375, height: 844 });
  await setInput(host.page, 'Your name', host.name);
  await setInput(host.page, 'Room password, optional', password);
  await clickButton(host.page, /^HOW TO PLAY$/);
  await waitForText(host.page, 'Digital Base Voyage');
  await waitForText(host.page, 'Graybeard neutral-hand variant');
  await waitForText(host.page, 'play another full round until the tie is broken');
  const rulesFocus = await host.page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  assert(rulesFocus === 'Close rules', `Rules did not receive initial focus: ${rulesFocus}`);
  await screenshot(host.page, '02-rules-390.png');
  await clickButton(host.page, /^Close rules$/);
  await clickButton(host.page, /^CREATE ROOM$/);
  await waitForPath(host.page, '/skull-king/lobby');
  const roomCode = await host.page.evaluate(() => document.body.innerText.match(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/)?.[0] ?? null);
  assert(roomCode, 'Room code was not visible after creation');
  await screenshot(host.page, '03-host-lobby-390.png', true);
  return roomCode;
}

async function exerciseLobbyPresence(players) {
  const [host, reconnecting] = players;
  await assertNoHorizontalOverflow(host);
  await assertVisibleTouchTargets(host);
  assert(await hasButton(host.page, /^START GAME$/), 'Host cannot start with three connected players');

  await reconnecting.page.goto('about:blank');
  await waitUntil(() => hasButton(host.page, /^WAITING FOR RECONNECTION$/, false), 'offline seat shown in start gate', 20_000);
  const offlineButton = (await visibleButtonData(host.page)).find((button) => button.label === 'WAITING FOR RECONNECTION');
  assert(offlineButton?.disabled, 'Host Start Voyage remains enabled while a seat is reconnecting');
  await screenshot(host.page, '06-lobby-offline-seat-390.png', { allowDisconnected: true });

  await reconnecting.page.goto(`${BASE_URL}/skull-king/lobby`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForPath(reconnecting.page, '/skull-king/lobby');
  await waitUntil(() => hasButton(host.page, /^START GAME$/), 'seat reconnect and start gate recovery', 30_000);

  const guard = players[2];
  await guard.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => null);
  await waitForText(guard.page, 'Leave room?');
  await clickButton(guard.page, /^STAY$/);
  await waitForPath(guard.page, '/skull-king/lobby');
}

async function assertBiddingLayout(player, expectRoundTen = false) {
  const result = await player.page.evaluate(() => {
    const hand = [...document.querySelectorAll('*')].find((element) => element.textContent === 'YOUR HAND');
    const bids = [...document.querySelectorAll('[role="button"][aria-label^="Bid "]')];
    const visibleBids = bids.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    return {
      handTop: hand?.getBoundingClientRect().top ?? null,
      firstBidTop: visibleBids[0]?.getBoundingClientRect().top ?? null,
      bidCount: visibleBids.length,
      bidBounds: visibleBids.map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.getAttribute('aria-label'), width: rect.width, height: rect.height, left: rect.left, right: rect.right };
      }),
      playButtonCount: [...document.querySelectorAll('[role="button"][aria-label^="Play "]')].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length,
      readableCardCount: [...document.querySelectorAll('[aria-label]')].filter((element) => {
        if (element.getAttribute('role') === 'button') return false;
        const label = element.getAttribute('aria-label') ?? '';
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && /^(green|purple|yellow|black) \d+$|^(Pirate|Tigress|Skull King|Mermaid|Escape)$/i.test(label);
      }).length,
      viewportWidth: innerWidth,
    };
  });
  assert(result.handTop !== null && result.firstBidTop !== null && result.handTop < result.firstBidTop, `Bid controls appear before hand: ${JSON.stringify(result)}`);
  assert(result.playButtonCount === 0, `Bidding hand exposes disabled play buttons: ${JSON.stringify(result)}`);
  assert(result.readableCardCount === result.bidCount - 1, `Bidding hand cards are not readable information: ${JSON.stringify(result)}`);
  assert(result.bidBounds.every((item) => item.width >= 48 && item.height >= 48 && item.left >= -1 && item.right <= result.viewportWidth + 1), `Bid targets clip or shrink: ${JSON.stringify(result)}`);
  if (expectRoundTen) assert(result.bidCount === 11, `Round ten did not expose bids 0–10: ${JSON.stringify(result)}`);
}

async function exerciseTwoHundredPercentZoom(player, name) {
  const original = player.page.viewport();
  await resize(player.page, { width: player.width >= 768 ? 1280 : 375, height: player.width >= 768 ? 900 : 844 });
  await delay(250);
  await assertNoHorizontalOverflow(player);
  await assertVisibleTouchTargets(player);
  const actions = await visibleButtonData(player.page);
  assert(actions.some((button) => /^Bid /.test(button.label)), '200% zoom lost bid actions');
  await player.page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await waitUntil(async () => {
    await player.page.keyboard.press('Tab');
    return player.page.evaluate(() => /^Bid /.test(document.activeElement?.getAttribute('aria-label') ?? ''));
  }, 'keyboard traversal reaches a bid at 200% zoom', 5_000);
  const focus = await player.page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const style = getComputedStyle(active);
    return { label: active.getAttribute('aria-label'), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  assert(focus?.label && focus.outlineStyle !== 'none' && Number.parseFloat(focus.outlineWidth) > 0, `200% zoom keyboard focus is not visible: ${JSON.stringify(focus)}`);
  await screenshot(player.page, name, { scale: true, afterScale: async () => {
    await waitUntil(async () => {
      await player.page.keyboard.press('Tab');
      return player.page.evaluate(() => /^Bid /.test(document.activeElement?.getAttribute('aria-label') ?? ''));
    }, 'keyboard bid focus with persistent doubled text', 5000);
    const scaledFocus = await player.page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label'), outline: getComputedStyle(document.activeElement).outlineStyle }));
    assert(scaledFocus.outline !== 'none', 'Enlarged keyboard focus lacks outline');
  } });
  if (original) await resize(player.page, original);
  await delay(180);
}

async function captureMatrix(players, stage, frame = null) {
  if (!qa) return;
  const phone = players[0], desktop = players.at(-1);
  for (const [width, height] of [[320, 800], [375, 844], [414, 896], [768, 1024], [1280, 900], [844, 390]]) {
    const actor = width === 1280 ? desktop : phone, previous = actor.page.viewport();
    try { await resize(actor.page, { width, height }); await screenshot(actor.page, `${stage}-${width}x${height}.png`, { frame }); }
    finally { await resize(actor.page, previous); }
  }
  for (const actor of [phone, desktop]) {
    const previous = actor.page.viewport(), wide = actor === desktop;
    try {
      await resize(actor.page, { width: wide ? 1280 : 375, height: wide ? 900 : 844 });
      await screenshot(actor.page, `${stage}-${wide ? 'desktop' : 'phone'}-text200.png`, { scale: true, frame });
    } finally { await resize(actor.page, previous); }
  }
}

async function exerciseHandRail(player, stage, keyboard = false, { scale = false } = {}) {
  const marked = await player.page.evaluate(() => {
    const heading = [...document.querySelectorAll('*')].find(n => n.textContent === 'YOUR HAND' && !n.children.length);
    let owner = heading?.parentElement;
    while (owner && ![...owner.querySelectorAll('[aria-label]')].some(n => /^(Play )?(green|purple|yellow|black) \d+$|^(Play )?(Pirate|Tigress|Skull King|Mermaid|Escape)$/i.test(n.getAttribute('aria-label') ?? ''))) owner = owner.parentElement;
    if (!owner) return null;
    const rail = [...owner.querySelectorAll('*')].find(n => ['auto', 'scroll'].includes(getComputedStyle(n).overflowX));
    if (!rail) return null;
    rail.setAttribute('data-skull-qa-hand-rail', 'true');
    const cards = [...rail.querySelectorAll('[aria-label]')].filter(n => /^(Play )?(green|purple|yellow|black) \d+$|^(Play )?(Pirate|Tigress|Skull King|Mermaid|Escape)$/i.test(n.getAttribute('aria-label') ?? ''));
    cards.forEach((n, index) => n.setAttribute('data-skull-qa-hand-card', String(index)));
    return { count: cards.length, width: rail.clientWidth, scrollWidth: rail.scrollWidth };
  });
  assert(marked?.count, 'Real private hand rail not found');
  const revision = player.public.revision;
  for (const [edge, index] of [['first', 0], ['last', marked.count - 1]]) {
    const selector = `[data-skull-qa-hand-card="${index}"]`;
    const capture = await screenshot(player.page, `${stage}-hand-${edge}.png`, { frame: selector, scale });
    const framed = capture.metrics.frame, r = framed.bounds, v = framed.visibleBounds;
    const geometry = { ...r, scrollAncestors: framed.scrollAncestors, visible: r.left >= v.left - 1 && r.right <= v.right + 1 && r.top >= v.top - 1 && r.bottom <= v.bottom + 1 };
    assert(geometry.visible, 'Framed hand face must be fully in the viewport');
    qa?.evidence.handRails?.push({ file: capture?.file, edge, ...marked, ...geometry });
  }
  if (keyboard) {
    await player.page.evaluate(() => document.activeElement?.blur());
    const seen = new Set();
    for (let step = 0; step < 70; step++) {
      await player.page.keyboard.press('Tab');
      const focus = await player.page.evaluate(() => {
        const n = document.activeElement, r = n?.getBoundingClientRect();
        return n?.matches('[role="button"][data-skull-qa-hand-card]') ? { index: n.getAttribute('data-skull-qa-hand-card'), visible: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1 } : null;
      });
      if (focus) { assert(focus.visible, 'Keyboard focused hand card is clipped'); seen.add(focus.index); }
      if (seen.size >= 2) break;
    }
    assert(seen.size >= Math.min(2, marked.count), 'Keyboard did not reach hand cards');
    if (qa) qa.evidence.handKeyboard = { reachedCards: seen.size, revision };
  }
  assert(player.public.revision === revision, 'Inspecting hand must not play a card');
  qa?.persist();
}

async function proveHiddenBid(players, bidder) {
  for (const observer of players.filter(p => p !== bidder)) {
    await waitUntil(() => observer.public?.phase === 'bidding' && observer.public.players.find(p => p.playerId === bidder.private.playerId)?.bidSubmitted, 'Opponent sees committed bid only');
    assert(observer.public.players.every(p => p.bid === null), 'Public projection disclosed a secret bid');
    const proof = await observer.page.evaluate(name => {
      const row = [...document.querySelectorAll('[aria-label]')].find(n => n.getAttribute('aria-label')?.startsWith(name + '.') && n.getAttribute('aria-label')?.includes('Bid locked'));
      if (!row) return null;
      return { label: row.getAttribute('aria-label'), text: row.textContent, images: [...row.querySelectorAll('img')].map(n => new URL(n.currentSrc || n.src).pathname), backs: [...row.querySelectorAll('[data-testid*="back"]')].map(n => ({ label: n.getAttribute('aria-label'), text: n.textContent, images: [...n.querySelectorAll('img')].map(image => new URL(image.currentSrc || image.src).pathname) })) };
    }, bidder.name);
    assert(proof && !/\b\d+\s+(?:of\s+\d+\s+)?tricks\b/i.test(proof.label), 'Opponent roster disclosed numeric bid');
    assert(!proof.images.some(source => /skull-(?:special|card)-/.test(source)), 'Opponent roster must not use private card faces');
    if (proof.backs.length > 1) assert(new Set(proof.backs.map(back => JSON.stringify(back))).size === 1, 'Unknown backs must not encode identities');
    if (!proof.backs.length && qa && !qa.evidence.gaps.includes('No opponent card-back elements are rendered; public count/locked marker privacy checked instead')) qa.evidence.gaps.push('No opponent card-back elements are rendered; public count/locked marker privacy checked instead');
    qa?.evidence.hiddenBids?.push({ observer: observer.name, revision: observer.public.revision, publicBidsAllNull: true, proof });
  }
  qa?.persist();
}

async function enabledLabels(player, pattern) {
  return (await visibleButtonData(player.page)).filter((button) => !button.disabled && pattern.test(button.label)).map((button) => button.label);
}

function roundNumberFromText(text) {
  const normal = text.match(/ROUND (\d+) \/ 10/);
  if (normal) return Number(normal[1]);
  const tiebreak = text.match(/TIEBREAKER (\d+)/);
  return tiebreak ? 10 + Number(tiebreak[1]) : null;
}

async function submitAvailableBids(players, evidence) {
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const labels = await enabledLabels(player, /^Bid \d+ tricks?$/);
    if (labels.length === 0) continue;
    const values = labels.map((label) => Number(label.match(/\d+/)?.[0])).filter(Number.isFinite);
    const roundText = await player.page.evaluate(() => document.body.innerText);
    const round = roundNumberFromText(roundText);
    if (evidence.visuals && round === 1 && index === 0 && !evidence.roundOneBidding) {
      await assertBiddingLayout(player);
      await screenshot(player.page, '07-round-1-bidding-390.png');
      evidence.roundOneBidding = true;
    }
    if (evidence.visuals && round === 2 && index === 2 && !evidence.zoom200) {
      await exerciseTwoHundredPercentZoom(player, '09-gameplay-200-percent.png');
      evidence.zoom200 = true;
    }
    if (evidence.visuals && round === 2 && !evidence.roundScoreVisible) {
      const scoreEvidence = await player.page.evaluate(() => ({
        visible: document.body.innerText.match(/LAST [+-]\d+ · (EXACT|MISSED)/g)?.length ?? 0,
        labelled: [...document.querySelectorAll('[aria-label]')].filter((element) => /Last round [+-]\d+, (exact|missed) bid\./.test(element.getAttribute('aria-label') ?? '')).length,
      }));
      assert(scoreEvidence.visible === 3 && scoreEvidence.labelled === 3, `Last-round scoring is not visible and labelled for every seat: ${JSON.stringify(scoreEvidence)}`);
      await screenshot(player.page, '07b-round-score-390.png');
      await clickButton(player.page, /^Show completed-round scorecard$/);
      await waitForText(player.page, 'Round score = base + awarded bonus.');
      await screenshot(player.page, '07c-completed-scorecard.png', { frame: '[data-testid="skull-score-ledger"]' });
      await clickButton(player.page, /^Hide completed-round scorecard$/);
      evidence.roundScoreVisible = true;
    }
    if (evidence.visuals && round === 10 && index === 0 && !evidence.roundTenBids) {
      const original = player.page.viewport();
      await resize(player.page, { width: 320, height: 800 });
      await delay(180);
      await assertBiddingLayout(player, true);
      await assertNoHorizontalOverflow(player);
      await screenshot(player.page, '11-round-10-bids-320.png', true);
      await exerciseHandRail(player, 'round10-bidding');
      await exerciseHandRail(player, 'round10-bidding-text200', false, { scale: true });
      if (original) await resize(player.page, original);
      evidence.roundTenBids = true;
    }
    assert(player.public?.revision === player.private?.revision, 'Bidding uses own paired projection');
    const choice = index === 0 ? 0 : index === 1 ? Math.max(...values) : Math.min(1, Math.max(...values));
    await clickButton(player.page, new RegExp(`^Bid ${choice} ${choice === 1 ? 'trick' : 'tricks'}$`));
    if (evidence.visuals && index === 0 && round === 1) {
      await waitUntil(async () => {
        const label = await players[1].page.evaluate((name) => [...document.querySelectorAll('[aria-label]')].map((element) => element.getAttribute('aria-label')).find((value) => value?.startsWith(`${name}.`) && value.includes('Bid locked')) ?? null, player.name);
        return Boolean(label && !label.includes('0 tricks'));
      }, 'first bid remains hidden from opponent');
      evidence.hiddenBid = true;
      await proveHiddenBid(players, player);
      await screenshot(players[1].page, 'secret-bid-opponent-view.png');
    }
  }
}

async function playAvailableCard(players, evidence) {
  for (const player of players) {
    const enabled = await enabledLabels(player, /^Play /);
    if (enabled.length === 0) continue;
    const allCards = (await visibleButtonData(player.page)).filter((button) => /^Play /.test(button.label));
    if (allCards.some((button) => button.disabled) && allCards.some((button) => !button.disabled)) evidence.followSuitRestriction = true;
    const body = await player.page.evaluate(() => document.body.innerText);
    const round = roundNumberFromText(body);
    if (evidence.visuals && round === 10 && !evidence.handKeyboard) {
      await exerciseHandRail(player, 'round10-playing', true);
      evidence.handKeyboard = true;
    }
    if (evidence.visuals && round === 3 && !evidence.gameRecovery) {
      const ownId = player.private.playerId;
      const hand = player.private.hand.map((card) => card.id).sort();
      player.public = null;
      player.private = null;
      await player.page.goto('about:blank');
      await player.page.goto(`${BASE_URL}/skull-king/game`, { waitUntil: 'domcontentloaded' });
      await waitUntil(() => player.private?.playerId === ownId && player.public?.revision === player.private?.revision, 'Same-seat paired game recovery');
      assert(JSON.stringify(player.private.hand.map((card) => card.id).sort()) === JSON.stringify(hand), 'Recovery changed the own private hand');
      await waitUntil(() => hasButton(player.page, /^Play /), 'Recovered own play controls');
      const recoveryRevision = player.public.revision;
      player.public = null; player.private = null;
      await player.page.reload({ waitUntil: 'domcontentloaded' });
      await waitUntil(() => player.private?.playerId === ownId && player.public?.revision === player.private?.revision && player.public.revision >= recoveryRevision, 'Reload preserves paired owner');
      assert(JSON.stringify(player.private.hand.map(card => card.id).sort()) === JSON.stringify(hand), 'Reload changed private hand');
      await screenshot(player.page, 'same-seat-reload-private-hand.png');
      evidence.gameRecovery = true;
    }
    if (evidence.visuals && !evidence.mobileTrick) {
      const original = player.page.viewport();
      await resize(player.page, { width: 320, height: 800 });
      await delay(180);
      await assertNoHorizontalOverflow(player);
      await assertVisibleTouchTargets(player);
      await screenshot(player.page, '08-current-turn-320.png', true);
      if (original) await resize(player.page, original);
      evidence.mobileTrick = true;
    }
    if (evidence.visuals && round === 3 && !evidence.tablet) {
      const tablet = players[1];
      const original = tablet.page.viewport();
      await resize(tablet.page, { width: 768, height: 1024 });
      await delay(180);
      await assertNoHorizontalOverflow(tablet);
      await screenshot(tablet.page, '10-gameplay-tablet-768.png', true);
      if (original) await resize(tablet.page, original);
      evidence.tablet = true;
    }
    assert(player.public?.revision === player.private?.revision && player.public.currentPlayerId === player.private.playerId, 'Play uses own acting paired projection');
    const label = enabled[0];
    if (evidence.visuals && !evidence.specialArt?.includes(label) && /Play (Tigress|Skull King|Pirate|Mermaid|Escape)/.test(label)) {
      const face = await findButton(player.page, new RegExp(`^${label}$`));
      await face.evaluate(n => n.setAttribute('data-skull-qa-special-face', 'true')); await face.dispose();
      await screenshot(player.page, `natural-${label.toLowerCase().replaceAll(' ', '-')}-art.png`, { frame: '[data-skull-qa-special-face="true"]' });
      await player.page.$$eval('[data-skull-qa-special-face]', nodes => nodes.forEach(n => n.removeAttribute('data-skull-qa-special-face')));
      evidence.specialArt ??= []; evidence.specialArt.push(label);
    }
    const acceptedBefore = player.acks.length;
    await clickButton(player.page, new RegExp(`^${label.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')}$`));
    if (label === 'Play Tigress') {
      await waitUntil(
        () => player.page.evaluate(() => Boolean(document.getElementById('skull-king-tigress-choice'))),
        'Tigress choice dialog',
      );
      const dialog = await player.page.evaluate(() => {
        const element = document.getElementById('skull-king-tigress-choice');
        return element ? {
          role: element.getAttribute('role'),
          ariaModal: element.getAttribute('aria-modal'),
          label: element.getAttribute('aria-label'),
          containsFocus: element.contains(document.activeElement),
        } : null;
      });
      assert(
        dialog?.role === 'dialog'
          && dialog.ariaModal === 'true'
          && dialog.label === 'Choose how the Tigress plays dialog'
          && dialog.containsFocus,
        `Tigress dialog semantics/focus are incomplete: ${JSON.stringify(dialog)}`,
      );
      for (let index = 0; index < 5; index += 1) await player.page.keyboard.press('Tab');
      const trapped = await player.page.evaluate(() => document.getElementById('skull-king-tigress-choice')?.contains(document.activeElement) ?? false);
      assert(trapped, 'Keyboard focus escaped the Tigress dialog');
      if (evidence.visuals && !evidence.tigressChoice) await screenshot(player.page, '10a-tigress-dialog.png');
      if (evidence.visuals && !evidence.tigressCancel) {
        const revision = player.public.revision;
        await player.page.keyboard.press('Escape');
        await waitUntil(() => player.page.evaluate(() => !document.getElementById('skull-king-tigress-choice')), 'Cancel Tigress mode');
        assert(player.public.revision === revision && player.private.hand.some(card => card.kind === 'tigress'), 'Cancel must preserve the private Tigress and revision');
        await clickButton(player.page, /^Play Tigress$/);
        await screenshot(player.page, 'tigress-phone-text200.png', { scale: true, frame: '#skull-king-tigress-choice' });
        evidence.tigressCancel = true;
      }
      await clickButton(player.page, /^PLAY AS ESCAPE$/);
      evidence.tigressChoice = true;
      evidence.tigressDialogSemantics = true;
    }
    await waitUntil(() => player.acks.length > acceptedBefore && player.public?.revision === player.private?.revision && player.public.revision >= player.acks.at(-1).revision, 'Own accepted play adopted');
    const longNameSeat = players.find(p => /^\S{20}$/.test(p.name));
    if (evidence.visuals && !evidence.longNameTrick && longNameSeat && player.public.currentTrick.some(card => card.playerId === longNameSeat.private.playerId)) {
      const phone = players[0];
      await waitUntil(() => phone.public?.revision === player.public.revision && phone.private?.revision === player.public.revision, 'Phone observes current public long-name trick');
      const original = phone.page.viewport();
      assert(original.hasTouch, 'Long-name phone proof uses a touch context');
      try {
        for (const width of [320, 375]) {
          await resize(phone.page, { width, height: 844 });
          await screenshot(phone.page, `long-name-public-trick-${width}-text200.png`, { scale: true, frame: '#skull-current-trick' });
        }
      } finally { await resize(phone.page, original); }
      evidence.longNameTrick = { name: longNameSeat.name, revision: player.public.revision };
    }
    if (evidence.visuals && !evidence.populatedTrick && player.public.currentTrick.length) {
      const selector = await player.page.evaluate(() => {
        const root = document.getElementById('skull-current-trick');
        if (root) return '#skull-current-trick';
        const heading = [...document.querySelectorAll('*')].find(n => !n.children.length && n.textContent.startsWith('CURRENT TRICK'));
        let area = heading?.parentElement;
        while (area && ![...area.querySelectorAll('[aria-label]')].some(n => /^(green|purple|yellow|black) \d+$|^(Pirate|Tigress|Skull King|Mermaid|Escape|Tigress as)/i.test(n.getAttribute('aria-label') ?? ''))) area = area.parentElement;
        if (!area) return null;
        area.setAttribute('data-skull-qa-trick', 'true'); return '[data-skull-qa-trick="true"]';
      });
      assert(selector, 'Populated public trick surface not found');
      await screenshot(player.page, 'natural-populated-trick.png', { frame: selector });
      evidence.populatedTrick = true;
    }
    evidence.plays += 1;
    return true;
  }
  return false;
}

async function playFullVoyage(players, { visuals = true } = {}) {
  const evidence = {
    visuals,
    roundOneBidding: false,
    hiddenBid: false,
    mobileTrick: false,
    zoom200: false,
    tablet: false,
    roundTenBids: false,
    followSuitRestriction: false,
    tigressChoice: false,
    tigressDialogSemantics: false,
    roundScoreVisible: false,
    plays: 0,
  };
  const started = Date.now();
  while (Date.now() - started < 900_000 && evidence.plays < 360) {
    if (await hasButton(players[0].page, /^PLAY AGAIN$/)) break;
    const bidAvailable = await Promise.all(players.map((player) => hasButton(player.page, /^Bid \d+ tricks?$/)));
    if (bidAvailable.some(Boolean)) {
      await submitAvailableBids(players, evidence);
      await delay(80);
      continue;
    }
    if (await playAvailableCard(players, evidence)) {
      await delay(70);
      continue;
    }
    await delay(100);
  }
  assert(await hasButton(players[0].page, /^PLAY AGAIN$/), `Voyage did not reach game over after ${evidence.plays} plays`);
  assert(evidence.plays >= 165, `Full ten-round voyage played too few cards: ${evidence.plays}`);
  if (visuals) {
    assert(evidence.roundOneBidding && evidence.hiddenBid && evidence.mobileTrick && evidence.zoom200 && evidence.tablet && evidence.roundTenBids && evidence.roundScoreVisible && evidence.longNameTrick, `Required rendered evidence missing: ${JSON.stringify(evidence)}`);
    if (!evidence.followSuitRestriction) qa?.evidence.gaps.push('No naturally rendered follow-suit restriction');
    if (!evidence.tigressChoice) qa?.evidence.gaps.push('No natural Tigress mode choice');
    for (const special of ['Pirate', 'Tigress', 'Skull King', 'Mermaid', 'Escape']) if (!evidence.specialArt?.includes('Play ' + special)) qa?.evidence.gaps.push(`No natural ${special} artwork capture`);
    qa?.evidence.gaps.push('Tigress Pirate mode, Mermaid capture bonus and eight-seat cap/tie-break require separately labelled fixtures; departure policy is not exercised by the natural run');
  }
  return evidence;
}

async function exerciseRematchShortageRecovery(host) {
  await waitForText(host.page, 'REMATCH UNAVAILABLE · NEED 2 NEW CAPTAINS');
  await waitUntil(() => hasButton(host.page, /^START A NEW ROOM$/), 'new-room recovery action');
  const shortage = await host.page.evaluate(() => ({
    text: document.body.innerText,
    label: [...document.querySelectorAll('[aria-label]')]
      .map((element) => element.getAttribute('aria-label'))
      .find((value) => value?.startsWith('Rematch unavailable. Need 2 new captains.')) ?? null,
  }));
  assert(shortage.label?.includes('Finished rooms cannot accept replacement captains. Start a new room.'), `Rematch-shortage explanation is incomplete: ${JSON.stringify(shortage)}`);
  assert(!shortage.text.includes('WAITING FOR 0 TO RECONNECT'), 'Rematch shortage retained the misleading reconnect state');
  await screenshot(host.page, '15-rematch-unavailable.png');
  await clickButton(host.page, /^START A NEW ROOM$/);
  await waitForPath(host.page, '/skull-king');
  await waitForText(host.page, 'SKULL KING');
  assert(host.page.url().endsWith('/skull-king'), `New-room recovery was redirected elsewhere: ${host.page.url()}`);
  await delay(600);
  const staleModal = await host.page.evaluate(() => document.querySelectorAll('[role="dialog"], [aria-modal="true"]').length);
  assert(staleModal === 0, `New-room landing retained ${staleModal} modal/backdrop element(s)`);
  await screenshot(host.page, '16-start-new-room.png');
}

async function exerciseGameOverAndRematch(players) {
  const host = players[0];
  await waitForText(host.page, 'WINS');
  const dialog = await host.page.evaluate(() => {
    const element = document.getElementById('skull-king-game-over');
    return element ? {
      role: element.getAttribute('role'),
      ariaModal: element.getAttribute('aria-modal'),
      label: element.getAttribute('aria-label'),
    } : null;
  });
  assert(
    dialog?.role === 'dialog'
      && dialog.ariaModal === 'true'
      && dialog.label?.startsWith('Voyage complete.'),
    `Game-over dialog semantics are incomplete: ${JSON.stringify(dialog)}`,
  );
  const focus = await host.page.evaluate(() => {
    const active = document.activeElement, panel = document.getElementById('skull-king-game-over');
    return { label: active?.getAttribute('aria-label'), ownedEnabledAction: Boolean(panel?.contains(active) && active?.matches('[role="button"]:not([aria-disabled="true"]),button:not([disabled])')) };
  });
  assert(focus.ownedEnabledAction, `Game-over dialog did not focus an enabled owned action: ${JSON.stringify(focus)}`);
  for (let index = 0; index < 5; index += 1) await host.page.keyboard.press('Tab');
  const trapped = await host.page.evaluate(() => document.getElementById('skull-king-game-over')?.contains(document.activeElement) ?? false);
  assert(trapped, 'Keyboard focus escaped the game-over dialog');
  await screenshot(host.page, '12-game-over-390.png');
  await captureMatrix(players, 'natural-results', '#skull-king-game-over');
  for (const player of [host, players.at(-1)]) {
    await screenshot(player.page, `results-${player === host ? 'phone' : 'desktop'}-actions-text200.png`, { scale: true, frame: '#skull-result-actions', frameAlign: 'end' });
    await screenshot(player.page, `results-${player === host ? 'phone' : 'desktop'}-roster-text200.png`, { scale: true, frame: '#skull-result-roster', frameAlign: 'end' });
  }
  await clickButton(host.page, /^Show completed-round scorecard$/);
  await waitForText(host.page, 'Round score = base + awarded bonus.');
  await screenshot(host.page, '12a-final-scorecard.png', { frame: '#skull-king-game-over [data-testid="skull-score-ledger"]' });
  await clickButton(host.page, /^Previous scored round$/);
  await screenshot(host.page, 'results-ledger-previous.png', { frame: '#skull-king-game-over [data-testid="skull-score-ledger"]', scale: true, frameAlign: 'end' });
  await clickButton(host.page, /^Next scored round$/);
  await clickButton(host.page, /^Hide completed-round scorecard$/);
  const terminalRevision = host.public.revision;

  const guest = players[1];
  await clickButton(guest.page, /^BACK TO ARCADE$/);
  await waitForText(guest.page, 'Return to the arcade?');
  await clickButton(guest.page, /^STAY$/);
  await waitForPath(guest.page, '/skull-king/game');

  await clickButton(host.page, /^PLAY AGAIN$/);
  await waitForText(host.page, 'ROUND 1 / 10');
  await waitUntil(() => hasButton(host.page, /^Bid \d+ tricks?$/), 'rematch bidding controls');
  await delay(450);
  const staleGameOver = await host.page.evaluate(() => Boolean(document.getElementById('skull-king-game-over')));
  assert(!staleGameOver, 'Game-over dialog remained in the DOM after the rematch settled');
  await waitUntil(() => host.public?.revision === host.private?.revision && host.public.revision > terminalRevision, 'Monotonic paired rematch');
  await screenshot(host.page, '13-rematch-round-1.png');

  await players[2].page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => null);
  await waitForText(players[2].page, 'Forfeit live voyage?');
  await clickButton(players[2].page, /^STAY$/);
  await waitForPath(players[2].page, '/skull-king/game');
  const rematchStart = host.public.revision;
  const voyage = await playFullVoyage(players, { visuals: false });
  await waitUntil(() => players.every(p => p.public?.status === 'game_over' && p.public.revision === p.private?.revision), 'Full rematch terminal pairs');
  const terminal = structuredClone(host.public);
  assert(terminal.players.every(p => !p.forfeited) && terminal.terminationReason === null, 'Full rematch has no forfeits or abandonment');
  assert(terminal.scoreHistory.length === terminal.roundNumber && terminal.roundNumber >= 10, 'Full rematch completed every round');
  assert(terminal.revision > rematchStart && rematchStart > terminalRevision, 'Rematch revisions remain monotonic through terminal');
  qa.evidence.rematch = { startRevision: rematchStart, terminal, voyage, accepted: players.map(p => ({ name: p.name, acks: p.acks.filter(a => a.revision > terminalRevision), rejections: p.rejections })) };
  qa.persist();
  await screenshot(host.page, 'full-rematch-terminal.png', { frame: '#skull-result-summary' });
  for (const player of [...players].reverse()) await cleanupPlayer(player);
}

function configureEvidence(config) {
  assert(!qa, 'Evidence may only be configured once per process');
  qa = createEvidence(config);
  return qa;
}

async function cleanupPlayer(player) {
  const hasAuth = await player.page.evaluate(() => Boolean(sessionStorage.getItem('za:auth'))).catch(() => Boolean(player.auth));
  if (!hasAuth) return;
  const finished = await player.page.evaluate(() => Boolean(document.getElementById('skull-king-game-over')));
  await clickButton(player.page, finished ? /^BACK TO ARCADE$/ : /^Back to arcade$/, 45000, finished ? '#skull-king-game-over' : '#skull-toolbar');
  await waitUntil(() => hasButton(player.page, /^LEAVE$/, true, '#arcade-dialog'), 'Owned leave confirmation');
  await clickButton(player.page, /^LEAVE$/, 45000, '#arcade-dialog');
  await waitForPath(player.page, '/');
  await waitUntil(() => player.page.evaluate(() => !sessionStorage.getItem('za:auth')), 'Normal leave clears auth');
  await waitUntil(() => qa.evidence.cleanup.some(r => r.actor === player.name && r.normalUI && r.status === 200), 'Normal REST leave accepted');
  for (const receipt of qa.evidence.cleanup.filter(r => r.actor === player.name && r.normalUI)) receipt.authCleared = true;
  qa.persist();
}

async function runRematchShortageTarget(players) {
  const password = 'skull-shortage-2026';
  const roomCode = await createRoomJourney(players[0], password);
  await joinPlayer(players[1], roomCode, password);
  await joinPlayer(players[2], roomCode, password);
  await waitUntil(() => hasButton(players[0].page, /^START GAME$/), 'three-player start gate');
  await clickButton(players[0].page, /^START GAME$/);
  await Promise.all(players.map((player) => waitForPath(player.page, '/skull-king/game')));
  await Promise.all(players.map((player) => waitForText(player.page, 'ROUND 1 / 10')));
  for (const [index, guest] of players.slice(1).entries()) {
    await clickButton(guest.page, index === 0 ? /^Back to arcade$/ : /^BACK TO ARCADE$/);
    await waitForText(guest.page, index === 0 ? 'Forfeit live voyage?' : 'Return to the arcade?');
    await clickButton(guest.page, /^LEAVE$/);
    await waitForPath(guest.page, '/');
    await waitUntil(() => players[0].public?.terminationReason === 'not_enough_players', 'Below-three cancellation');
  }
  await exerciseRematchShortageRecovery(players[0]);
  assert(consoleIssues.length === 0, `Console warnings/errors: ${JSON.stringify(consoleIssues)}`);
  const result = { outputDir, roomCode, target: TARGET, consoleIssues };
  fs.writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`SKULL KING UI TARGET PASS ${JSON.stringify(result)}`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  assert(!fs.existsSync(path.join(outputDir, 'receipt.json')), 'Use a fresh output directory');
  qa = createEvidence({ outputDir, base: BASE_URL, api: API_URL });
  qa.evidence.handRails = []; qa.evidence.hiddenBids = [];
  const players = [];
  let browser, watchdog;
  try {
    assert(process.env.SKULL_UI_EXCLUSIVE_WINDOW === 'granted', 'Exclusive browser window required');
    local(BASE_URL); local(API_URL);
    const certificate = process.env.QA_BROWSER_CERT_SPKI;
    assert(/^[A-Za-z0-9+/]{43}=$/.test(certificate ?? ''), 'Explicit QA certificate fingerprint required');
    qa.evidence.bundle = await bundleFence(BASE_URL + '/skull-king', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256 ?? process.env.SKULL_EXPECTED_HASH);
    const health = await fetch(API_URL, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert(health.status === 200 && (await health.json()).service === 'zuychin-arcade-server', 'Natural voyage requires ordinary API');
    const fixture = await fetch(API_URL + '/__qa/skull-king-fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert(fixture.status === 404, 'Natural voyage refuses fixture endpoints');
    qa.evidence.ordinaryAPI = true; qa.persist();
    browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--disable-dev-shm-usage', '--disable-background-timer-throttling', '--ignore-certificate-errors-spki-list=' + certificate] });
    watchdog = setTimeout(() => { qa.evidence.timeout = '25-minute overall bound'; qa.persist(); void browser.close(); }, 25 * 60 * 1000);
    await qa.calibrate(browser);
    players.push(await openPlayer(browser, 'Captain Ada', 320, 800));
    players.push(await openPlayer(browser, 'ABCDEFGHIJKLMNOPQRST', 375, 844, true));
    players.push(await openPlayer(browser, 'Captain Sam', 1280, 900));
    const { servedHash: hash, script } = qa.evidence.bundle;
    if (TARGET === 'rematch-shortage') {
      await runRematchShortageTarget(players);
      return;
    }
    await exerciseSharedFocusAtZoom(players[2]);
    await players[0].page.goto(BASE_URL + '/skull-king', { waitUntil: 'domcontentloaded' });
    await captureMatrix(players, 'entrance');
    const password = ` skull-${runId} `; qa.secrets.add(password); qa.secrets.add(password.trim());
    const roomCode = await createRoomJourney(players[0], password);
    await joinPlayer(players[1], roomCode, password, { validation: true, wrongPassword: true });
    await joinPlayer(players[2], roomCode, password);
    await waitUntil(() => hasButton(players[0].page, /^START GAME$/), 'three-player start gate');
    await exerciseLobbyPresence(players);
    await captureMatrix(players, 'lobby');
    assert(await players[1].page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'Reduced-motion browser preference was not active');
    await clickButton(players[0].page, /^START GAME$/);
    await Promise.all(players.map((player) => waitForPath(player.page, '/skull-king/game')));
    await Promise.all(players.map((player) => waitForText(player.page, 'ROUND 1 / 10')));
    await resize(players[2].page, { width: 1280, height: 900 });
    await screenshot(players[2].page, '07a-gameplay-desktop-1280.png', true);
    await captureMatrix(players, 'round1-bidding', '#skull-king-decision-heading');
    const voyage = await playFullVoyage(players);
    qa.evidence.voyage = voyage;
    await waitUntil(() => players.every(player => player.public?.status === 'game_over' && player.public.revision === player.private?.revision), 'All terminal paired frames');
    const terminal = JSON.parse(JSON.stringify(players[0].public));
    assert(terminal.players.every(player => !player.forfeited), 'Natural match has no forfeits');
    assert(terminal.scoreHistory.length === terminal.roundNumber, 'Every completed round has a scorecard');
    const accepted = players.map(player => ({ name: player.name, acks: [...player.acks], rejections: [...player.rejections] }));
    fs.writeFileSync(path.join(outputDir, 'natural-terminal.json'), JSON.stringify({ method: 'Automated browser seats using only rendered own-seat legal cards and fixed bid choices, not independent manual Astra decisions.', hash, script, terminal, accepted, voyage }, null, 2));
    await exerciseGameOverAndRematch(players);
    assert(players.every(player => player.rejections.length === 0), 'Natural games contain no command rejection');
    qa.evidence.finalBundle = await bundleFence(BASE_URL + '/skull-king', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256 ?? process.env.SKULL_EXPECTED_HASH);
    assert(consoleIssues.length === 0, `Console warnings/errors: ${JSON.stringify(consoleIssues)}`);
    const result = { outputDir, roomCode, hash, script, voyage, consoleIssues };
    fs.writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    qa.evidence.completeJourney = true;
    assert(qa.evidence.blockedRequests.length === 0, 'Network allowlist rejected a request');
  } catch (error) {
    qa.evidence.failure = redact(error.stack ?? error.message, [...qa.secrets]); qa.persist();
    throw error;
  } finally {
    clearTimeout(watchdog);
    for (const player of players) {
      try {
        let authCleared = false, readableAuth = false;
        try { authCleared = await player.page.evaluate(() => !sessionStorage.getItem('za:auth')); readableAuth = true; } catch {}
        for (const receipt of qa.evidence.cleanup.filter(r => r.actor === player.name && r.normalUI)) receipt.authCleared = authCleared;
        if (!authCleared) {
          player.fallbackCleanup = true;
          const auth = readableAuth ? await player.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null')) : player.auth;
          const fallback = auth?.token ? { status: (await fetch(API_URL + '/rooms/' + encodeURIComponent(auth.roomCode) + '/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.token }, redirect: 'error', signal: AbortSignal.timeout(10000) })).status } : { skipped: 'No owned auth available' };
          qa.evidence.cleanup.push({ actor: player.name, fallback: true, ...fallback });
        }
      } catch (error) { qa.evidence.cleanup.push({ actor: player.name, error: redact(error.message, [...qa.secrets]) }); }
      try { await player.context.close(); } catch (error) { qa.evidence.cleanup.push({ actor: player.name, contextError: redact(error.message, [...qa.secrets]) }); }
    }
    try { if (browser) { await browser.close(); qa.evidence.browserClosed = true; } }
    finally { qa.evidence.consoleIssues = consoleIssues; qa.persist(); }
  }
  assert(players.every(player => qa.evidence.cleanup.some(r => r.actor === player.name && r.normalUI && r.status === 200 && r.authCleared)), 'Every owned seat needs successful normal UI cleanup');
  assert(!qa.evidence.cleanup.some(r => r.fallback || r.error || r.contextError), 'Fallback cleanup is not normal lifecycle proof');
  qa.evidence.status = qa.evidence.findings.length ? 'journey-complete-with-visual-findings' : 'journey-complete-awaiting-independent-review'; qa.persist();
  console.log(`SKULL KING UI SMOKE COMPLETE ${outputDir}`);
}

module.exports = { openPlayer, joinPlayer, configureEvidence, cleanupPlayer, exerciseHandRail, setInput, clickButton, hasButton, visibleButtonData, waitUntil, waitForPath, waitForText, screenshot, assertNoHorizontalOverflow, assertVisibleTouchTargets, consoleIssues };

if (require.main === module) main().catch((error) => {
  if (qa) { qa.evidence.failure = redact(error.stack ?? String(error), [...qa.secrets]); qa.persist(); }
  console.error(`SKULL KING UI SMOKE FAIL: ${redact(error instanceof Error ? error.stack : String(error), [...qa?.secrets ?? []])}`);
  process.exitCode = 1;
});
