const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { createEvidence, MATRIX, bundleFence, guardNetwork, local, redact } = require('./citadels-ui-evidence.cjs');

const BASE_URL = process.env.CITADELS_WEB_URL ?? 'http://127.0.0.1:8081';
const API_URL = process.env.CITADELS_API_URL ?? 'http://127.0.0.1:3213';
const BROWSER_PATH = process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const QA_BROWSER_CERT_SPKI = process.env.QA_BROWSER_CERT_SPKI;
const FOCUS_ONLY = process.env.CITADELS_UI_FOCUS_ONLY === 'true';
const FOCUS_STABILITY_ONLY = process.env.CITADELS_UI_FOCUS_STABILITY_ONLY === 'true';
const RECOVERY_ONLY = process.env.CITADELS_UI_RECOVERY_ONLY === 'true';
const SHORTAGE_FOLLOWUP = process.env.CITADELS_UI_SHORTAGE_FOLLOWUP === 'true';
const LONG_NAME = 'ABCDEFGHIJKLMNOPQRST';
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const outputDir = process.env.CITADELS_UI_OUTPUT_DIR ?? path.join(os.tmpdir(), `zuychin-arcade-citadels-ui-${runId}`);
const consoleIssues = [];
const coverage = new Set();
const screenshots = new Set();
const incomeTurns = new Map();
const attempted = new Set();
let qa = null;
let ownsOutput = false;
const safe = value => redact(value, [...(qa?.secrets ?? [])]);
const writeReceipt = (name, value) => fs.writeFileSync(path.join(outputDir, name), safe(value) + '\n');
const resize = (page, width, height) => page.setViewport({ ...page.viewport(), width, height, deviceScaleFactor: 1 });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const checkpoint = (message) => console.log(`[citadels-ui-smoke] ${message}`);

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function hasVisibleFocusOutline(value) {
  return Boolean(
    value
    && value.outlineStyle
    && value.outlineStyle !== 'none'
    && Number.parseFloat(value.outlineWidth) >= 3,
  );
}

function isAuthoredFocusColour(value) {
  const colour = value?.toLowerCase().replaceAll(' ', '');
  return colour === '#f7faff' || colour === 'rgb(247,250,255)' || colour === 'rgba(247,250,255,1)';
}

function hasAuthoredFocusOutline(value) {
  return Boolean(
    hasVisibleFocusOutline(value)
    && value.outlineStyle === 'solid'
    && isAuthoredFocusColour(value.outlineColor)
    && Number.parseFloat(value.outlineOffset) >= 3,
  );
}

function assertUiSource() {
  assert(hasVisibleFocusOutline({ outlineStyle: 'auto', outlineWidth: '3px' }), 'Browser-managed 3px focus outlines must pass');
  assert(!hasVisibleFocusOutline({ outlineStyle: 'none', outlineWidth: '3px' }), 'Invisible focus outlines must fail');
  assert(!hasVisibleFocusOutline({ outlineStyle: 'solid', outlineWidth: '0px' }), 'Zero-width focus outlines must fail');
  assert(hasAuthoredFocusOutline({ outlineStyle: 'solid', outlineWidth: '3px', outlineColor: 'rgb(247, 250, 255)', outlineOffset: '3px' }), 'Authored focus treatment must pass');
  assert(!hasAuthoredFocusOutline({ outlineStyle: 'auto', outlineWidth: '3px', outlineColor: 'rgb(16, 16, 16)', outlineOffset: '0px' }), 'UA focus treatment must not satisfy the authored-style gate');
  const source = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const globalCss = source('global.css');
  const landing = source(path.join('app', 'citadels', 'index.tsx'));
  const join = source(path.join('app', 'citadels', 'join.tsx'));
  const lobby = source(path.join('app', 'citadels', 'lobby.tsx'));
  const game = source(path.join('app', 'citadels', 'game.tsx'));
  const reference = source(path.join('components', 'citadels', 'ReferenceSheet.tsx'));
  const cards = source(path.join('components', 'citadels', 'CitadelsCard.tsx'));
  const hook = source(path.join('components', 'citadels', 'useCitadelsActions.ts'));
  const required = [
    [landing, 'shared create ownership', 'RemainingLanding'],
    [join, 'shared exact password join', 'RemainingJoin'],
    [lobby, 'shared lobby ownership', 'RemainingLobby'],
    [game, 'owned cleanup', 'await clearAuthIfMatches(token)'],
    [game, 'authoritative legal build choices', 'mine.legalBuildCardIds'],
    [game, 'owned result prompt', 'isCitadelsLeavePromptCurrent'],
    [hook, 'semantic acknowledgement', "socket.on('citadels:action_accepted', accepted)"],
    [hook, 'synchronous duplicate fence', 'pendingRef.current'],
    [hook, 'atomic pairing fence', 'latest.citadelsSyncing'],
    [reference, 'custom selection disclosure', 'not a publisher-defined scenario'],
    [cards, 'complete live district rules', 'card.effectText'],
    [globalCss, 'authored focus colour', 'outline-color: #f7faff !important'],
  ];
  for (const [text, label, fragment] of required) assert(text.includes(fragment), `Missing ${label} source guard`);
  assert(!game.toLowerCase().includes('graveyard'), 'Removed Graveyard decision remains in Citadels game UI');
  assert(!reference.toLowerCase().includes('classic'), 'Misleading Classic claim remains in Citadels rules');
}

async function waitUntil(check, message, timeout = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${message}`);
}

async function visibleButtonData(page, enabledOnly = false) {
  return page.evaluate((onlyEnabled) => [...document.querySelectorAll('[role="button"][aria-label]')]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const disabled = element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
      return {
        label: element.getAttribute('aria-label'),
        disabled,
        visible: !element.closest('[aria-hidden="true"]') && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0,
        width: rect.width,
        height: rect.height,
      };
    })
    .filter((item) => item.visible && item.label && (!onlyEnabled || !item.disabled)), enabledOnly);
}

async function enabledLabels(page) {
  return (await visibleButtonData(page, true)).map((button) => button.label);
}

async function findButton(page, matcher, enabledOnly = true, scope = 'body') {
  const buttons = await page.$$(`${scope} [role="button"][aria-label]`);
  for (const button of buttons) {
    const matches = await button.evaluate((element, data) => {
      const regex = new RegExp(data.source, data.flags);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const disabled = element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
      return regex.test(element.getAttribute('aria-label') ?? '')
        && !element.closest('[aria-hidden="true"]') && rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > 0
        && (!data.enabledOnly || !disabled);
    }, { source: matcher.source, flags: matcher.flags, enabledOnly });
    if (matches) return button;
    await button.dispose();
  }
  return null;
}

async function hasButton(page, matcher, enabledOnly = true, scope = 'body') {
  const button = await findButton(page, matcher, enabledOnly, scope);
  if (!button) return false;
  await button.dispose();
  return true;
}

async function clickButton(page, matcher, timeout = 45_000, scope = 'body') {
  await waitUntil(() => hasButton(page, matcher, true, scope), `enabled button ${matcher} in ${scope}`, timeout);
  await waitUntil(async () => {
    const candidate = await findButton(page, matcher, true, scope);
    if (!candidate) return false;
    try {
      const bounds = await candidate.boundingBox();
      return Boolean(bounds && bounds.width >= 48 && bounds.height >= 48);
    } finally {
      await candidate.dispose();
    }
  }, `settled 48px touch target ${matcher}`, timeout);
  const button = await findButton(page, matcher, true, scope);
  assert(button, `Could not find enabled button ${matcher}`);
  try {
    await button.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await delay(80);
    const bounds = await button.boundingBox();
    assert(bounds && bounds.width >= 48 && bounds.height >= 48, `Touch target too small for ${matcher}: ${JSON.stringify(bounds)}`);
    if (scope !== 'body') await waitUntil(() => button.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === element || element.contains(hit);
    }), `unoccluded ${matcher} in ${scope}`, timeout);
    if (page.viewport()?.hasTouch) await button.tap(); else await button.click();
    await delay(120);
  } finally {
    await button.dispose();
  }
}

async function leavePlayerUI(player) {
  const page = player.page;
  const surface = await page.evaluate(() => document.getElementById('citadels-game-over') ? 'results'
    : document.getElementById('citadels-toolbar') ? 'game' : 'other');
  if (surface === 'results') await clickButton(page, /^BACK TO ARCADE$/, 5000, '#citadels-game-over');
  else if (surface === 'game') await clickButton(page, /^Back to arcade$/, 5000, '#citadels-toolbar');
  else if (await hasButton(page, /^LEAVE ROOM$/)) await clickButton(page, /^LEAVE ROOM$/);
  else await clickButton(page, /^BACK TO ARCADE$/i, 5000);
  await waitUntil(() => page.evaluate(() => Boolean(document.getElementById('arcade-dialog')) || !sessionStorage.getItem('za:auth')), 'owned leave confirmation or completed recovery', 5000);
  const confirmation = await page.evaluate(() => Boolean(document.getElementById('arcade-dialog')));
  if (confirmation) await clickButton(page, /^LEAVE$/, 5000, '#arcade-dialog');
  await waitForPath(page, '/');
  await waitUntil(() => page.evaluate(() => !sessionStorage.getItem('za:auth')), 'normal UI session cleanup', 5000);
}

async function naturalTerminal(players) {
  await waitUntil(() => players.every(player => player.public?.status === 'game_over'
    && player.private?.revision === player.public.revision
    && player.public.roomCode === player.auth?.roomCode
    && player.private.roomCode === player.auth?.roomCode
    && player.private.playerId === player.auth?.playerId), 'all natural terminal viewers paired');
  const terminal = structuredClone(players[0].public);
  assert(terminal.terminationReason === null && terminal.winnerIds.length > 0
    && terminal.players.every(player => !player.forfeited), 'Natural court requires scored winners without forfeiture');
  assert(players.every(player => JSON.stringify(player.public) === JSON.stringify(terminal)), 'Natural terminal public projections agree');
  return terminal;
}

async function clickExactLabel(page, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await clickButton(page, new RegExp(`^${escaped}$`));
}

async function setInput(page, label, value) {
  await waitUntil(() => page.evaluate((inputLabel) => [...document.querySelectorAll(`input[aria-label="${inputLabel}"]`)].some((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }), label), `visible input ${label}`);
  const input = await page.$(`input[aria-label="${label}"]`);
  assert(input, `Input not found: ${label}`);
  try {
    await input.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    if (value) await page.keyboard.type(value);
    await waitUntil(() => input.evaluate((element, expected) => element.value === expected, value), `${label} value`);
  } finally {
    await input.dispose();
  }
}

async function text(page) {
  return page.evaluate(() => document.body.innerText);
}

async function waitForText(page, needle, timeout = 45_000) {
  await page.waitForFunction((value) => document.body.innerText.includes(value), { timeout }, needle);
}

async function waitForPath(page, suffix) {
  await page.waitForFunction((expected) => location.pathname.endsWith(expected), { timeout: 45_000 }, suffix);
}

async function screenshot(page, name) {
  if (screenshots.has(name)) return;
  if (qa) await qa.capture(page, name, { allowTransient: /disconnect|recovery-/.test(name) });
  else { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(outputDir, name), fullPage: false }); }
  screenshots.add(name);
}

async function captureMatrix(player, phase, frame = null) {
  if (!qa || coverage.has(`matrix:${phase}`)) return;
  const original = player.page.viewport();
  try {
    for (const [width, height] of MATRIX) {
      await resize(player.page, width, height);
      await qa.capture(player.page, `${phase}-${width}x${height}.png`, { frame });
    }
    for (const width of [375, 1280]) {
      await resize(player.page, width, 844);
      await qa.capture(player.page, `${phase}-${width}x844-text200.png`, { scale: true, frame });
    }
    coverage.add(`matrix:${phase}`);
  } finally { await player.page.setViewport(original); }
}

async function scrollMain(page, target = 'top') {
  await page.evaluate((position) => {
    const scrolling = [...document.querySelectorAll('*')]
      .filter((element) => element.scrollHeight > element.clientHeight + 20)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
    if (position === 'decision') {
      document.getElementById('citadels-decision-heading')?.scrollIntoView({ block: 'start', inline: 'nearest' });
    } else {
      window.scrollTo(0, 0);
      if (scrolling) scrolling.scrollTop = 0;
    }
  }, target);
  await delay(120);
}

async function assertNoHorizontalOverflow(player) {
  const result = await player.page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
  assert(result.documentWidth <= result.width + 1 && result.bodyWidth <= result.width + 1, `${player.name} has horizontal page overflow: ${JSON.stringify(result)}`);
}

async function assertVisibleTouchTargets(player) {
  const undersized = (await visibleButtonData(player.page)).filter((button) => button.width < 48 || button.height < 48);
  assert(undersized.length === 0, `${player.name} has undersized controls: ${JSON.stringify(undersized)}`);
}

async function openPlayer(browser, name, width, height, reduceMotion = false) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const player = { name, width, height, context, page, left: false, intentionalOffline: false, public: null, private: null, acks: [], rejections: [] };
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: Boolean(qa) && width < 768, hasTouch: Boolean(qa) && width < 768 });
  if (qa) {
    qa.register(player); await guardNetwork(page, qa.origins, qa.evidence.blockedRequests);
    page.on('response', async response => {
      try {
        const url = new URL(response.url());
        if (qa.origins.has(url.origin) && /\/rooms\/[^/]+\/leave$/.test(url.pathname) && response.request().method() === 'POST') {
          qa.evidence.cleanup.push({ actor: name, normalUI: !player.fallbackCleanup, status: response.status(), authCleared: false }); qa.persist();
        }
        if (qa.origins.has(url.origin) && /\/rooms(?:\/[^/]+\/join)?$/.test(url.pathname) && response.request().method() === 'POST' && response.ok()) {
          const body = await response.json(); if (body.token) { qa.secrets.add(body.token); player.auth = body; }
        }
      } catch (error) { if (qa) qa.evidence.gaps.push({ kind: 'response-observation', message: safe(error.message) }); }
    });
  }
  if (reduceMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('console', (message) => {
    if (message.text().includes('[Reanimated] Reduced motion setting is enabled')) return;
    if (player.intentionalOffline) return;
    if (['warning', 'error'].includes(message.type())) consoleIssues.push({ player: name, type: message.type(), text: message.text() });
  });
  page.on('pageerror', (error) => {
    if (!player.intentionalOffline) consoleIssues.push({ player: name, type: 'pageerror', text: error.message });
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    if (!response.payloadData.startsWith('42')) return;
    let frame;
    try { frame = JSON.parse(response.payloadData.slice(2)); } catch { return; }
    const [event, state] = frame;
    if (event === 'game_state' && state?.gameId === 'citadels') player.public = state;
    if (event === 'private_state' && state?.gameId === 'citadels') player.private = state;
    if (event === 'room_updated') player.room = state;
    if (event === 'citadels:action_accepted') { player.acks.push(state); player.lastAcceptedAt = Date.now(); }
    if (event === 'action_rejected') player.rejections.push(state);
  });
  return player;
}

async function removeExpectedHttpIssue(playerName, status) {
  await delay(100);
  const index = consoleIssues.findIndex((issue) => issue.player === playerName && issue.type === 'error' && issue.text === `Failed to load resource: the server responded with a status of ${status}`);
  if (index >= 0) consoleIssues.splice(index, 1);
}

async function joinPlayer(player, roomCode, password, options = {}) {
  await player.page.goto(`${BASE_URL}/citadels/join`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await setInput(player.page, 'Your name', player.name);
  if (options.validation) {
    await setInput(player.page, 'Room code', 'BAD');
    await clickButton(player.page, /^JOIN GAME$/);
    await waitForText(player.page, 'Enter a valid room code');
    await screenshot(player.page, `04-join-validation-${player.width}.png`);
  }
  await setInput(player.page, 'Room code', roomCode);
  if (options.wrongPassword) {
    await setInput(player.page, 'Room password, optional', password !== password.trim() ? password.trim() : 'wrong-password');
    await clickButton(player.page, /^JOIN GAME$/);
    await waitForText(player.page, 'Wrong password');
    await removeExpectedHttpIssue(player.name, '403 (Forbidden)');
    await screenshot(player.page, `05-wrong-password-${player.width}.png`);
  }
  await setInput(player.page, 'Room password, optional', password);
  await clickButton(player.page, /^JOIN GAME$/);
  await waitForPath(player.page, '/citadels/lobby');
}

async function exerciseFocusAndLanding(host) {
  await resize(host.page, 320, 780);
  await host.page.goto(`${BASE_URL}/citadels`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForText(host.page, 'ENTER THE COURT');
  await captureMatrix(host, 'entrance');
  await host.page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await waitUntil(async () => {
    await host.page.keyboard.press('Tab');
    return host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Your name');
  }, 'keyboard focus reaches name input', 6_000);
  await waitUntil(() => host.page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.matches(':focus-visible')) return false;
    const style = getComputedStyle(active);
    const colour = style.outlineColor.replaceAll(' ', '').toLowerCase();
    return style.outlineStyle === 'solid'
      && Number.parseFloat(style.outlineWidth) >= 3
      && colour === 'rgb(247,250,255)'
      && Number.parseFloat(style.outlineOffset) >= 3;
  }), 'authored keyboard focus style settles', 6_000);
  const inputFocus = await host.page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const style = getComputedStyle(active);
    const focusRules = [];
    const matchedOutlineRules = [];
    const styleSheets = [...document.styleSheets].map((sheet) => {
      const evidence = { href: sheet.href, ownerTag: sheet.ownerNode?.nodeName ?? null, disabled: sheet.disabled, focusRules: [], matchedOutlineRules: [], accessError: null };
      try {
        const visit = (rules) => {
          for (const rule of [...rules]) {
            if (rule.cssText.includes(':focus-visible')) evidence.focusRules.push(rule.cssText);
            if (rule instanceof CSSStyleRule && rule.style.cssText.includes('outline')) {
              try {
                if (active.matches(rule.selectorText)) {
                  evidence.matchedOutlineRules.push({
                    selector: rule.selectorText,
                    declarations: rule.style.cssText,
                    priorities: {
                      outline: rule.style.getPropertyPriority('outline'),
                      outlineColor: rule.style.getPropertyPriority('outline-color'),
                      outlineOffset: rule.style.getPropertyPriority('outline-offset'),
                      outlineStyle: rule.style.getPropertyPriority('outline-style'),
                      outlineWidth: rule.style.getPropertyPriority('outline-width'),
                    },
                  });
                }
              } catch {
                // Ignore selectors unsupported by the current browser.
              }
            }
            if ('cssRules' in rule && rule.cssRules) visit(rule.cssRules);
          }
        };
        visit(sheet.cssRules);
      } catch (error) {
        evidence.accessError = error instanceof Error ? error.message : String(error);
      }
      focusRules.push(...evidence.focusRules);
      matchedOutlineRules.push(...evidence.matchedOutlineRules.map((rule) => ({ ...rule, href: evidence.href })));
      return evidence;
    });
    return {
      active: {
        tagName: active.tagName,
        type: active.getAttribute('type'),
        label: active.getAttribute('aria-label'),
        className: active.className,
      },
      matchesFocus: active.matches(':focus'),
      matchesFocusVisible: active.matches(':focus-visible'),
      computed: {
        outline: style.outline,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        outlineOffset: style.outlineOffset,
        boxShadow: style.boxShadow,
      },
      linkedStyleSheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.href),
      styleSheets,
      focusRules,
      matchedOutlineRules,
      inlineStyle: active.getAttribute('style'),
      location: location.href,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      userAgent: navigator.userAgent,
    };
  });
  if (inputFocus) {
    const session = await host.page.createCDPSession();
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[aria-label="Your name"]' });
    const [matched, computed] = await Promise.all([
      session.send('CSS.getMatchedStylesForNode', { nodeId }),
      session.send('CSS.getComputedStyleForNode', { nodeId }),
    ]);
    inputFocus.cdp = {
      computed: computed.computedStyle.filter((property) => property.name.startsWith('outline')),
      matchedRules: matched.matchedCSSRules
        .map((entry) => ({
          origin: entry.rule.origin,
          selector: entry.rule.selectorList.text,
          matchingSelectors: entry.matchingSelectors,
          properties: entry.rule.style.cssProperties
            .filter((property) => property.name.startsWith('outline'))
            .map(({ name, value, important, disabled, implicit }) => ({ name, value, important, disabled, implicit })),
        }))
        .filter((entry) => entry.properties.length > 0),
      inlineProperties: matched.inlineStyle?.cssProperties
        .filter((property) => property.name.startsWith('outline'))
        .map(({ name, value, important, disabled, implicit }) => ({ name, value, important, disabled, implicit })) ?? [],
    };
    await session.detach();
  }
  writeReceipt('focus-evidence.json', inputFocus);
  await screenshot(host.page, '00a-keyboard-focus-input-320.png');
  assert(inputFocus?.matchesFocus && inputFocus.matchesFocusVisible, `Tab focus did not match :focus-visible: ${JSON.stringify(inputFocus)}`);
  assert(inputFocus.focusRules.some((rule) => rule.includes(':focus-visible') && (rule.includes('#f7faff') || rule.includes('rgb(247, 250, 255)'))), `Authored focus-visible CSS rule was not loaded: ${JSON.stringify(inputFocus.styleSheets)}`);
  assert(hasAuthoredFocusOutline(inputFocus.computed), `Authored input focus treatment is not active: ${JSON.stringify(inputFocus)}`);
  await resize(host.page, 844, 390);
  await clickButton(host.page, /^HOW TO PLAY$/);
  await waitForText(host.page, 'Digital Original Cast');
  await waitUntil(() => host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Close rules'), 'rules dialog focus');
  const dialog = await host.page.evaluate(() => {
    const panel = document.getElementById('rules-reference-sheet');
    return panel ? { role: panel.getAttribute('role'), modal: panel.getAttribute('aria-modal'), label: panel.getAttribute('aria-label') } : null;
  });
  assert(dialog?.role === 'dialog' && dialog.modal === 'true' && dialog.label === 'Citadels rulebook', `Rules semantics wrong: ${JSON.stringify(dialog)}`);
  await screenshot(host.page, '00-keyboard-focus-rules-844x390.png');
  if (qa) { await resize(host.page, 375, 844); await qa.capture(host.page, 'rules-375-text200.png', { scale: true, frame: '#rules-reference-sheet' }); }
  await host.page.keyboard.press('Escape');
  await waitUntil(() => host.page.evaluate(() => !document.getElementById('rules-reference-sheet')), 'Escape closes rules');
  await resize(host.page, 320, 780);
  await setInput(host.page, 'Your name', '');
  await clickButton(host.page, /^CREATE ROOM$/);
  await waitForText(host.page, 'Enter the name other players will see.');
  await screenshot(host.page, '01-landing-validation-320.png', true);
  await assertNoHorizontalOverflow(host);
  await assertVisibleTouchTargets(host);
  return inputFocus;
}

function roundFrom(body) {
  return Number(body.match(/ROUND (\d+)/)?.[1] ?? 0);
}

function handCountFrom(body) {
  return Number(body.match(/YOUR DISTRICT HAND\s+(\d+) plan/i)?.[1] ?? 0);
}

function roleFromChoiceLabel(label) {
  return label.match(/^CHOOSE SECRETLY\. ([^,]+), rank/i)?.[1]?.toLowerCase().replaceAll(' ', '_') ?? null;
}

async function maybeCaptureGameplay(player, body, matchNumber) {
  if (body.includes('CHOOSE YOUR SECRET CHARACTER')) await screenshot(player.page, `07-match-${matchNumber}-draft-${player.width}.png`);
  if ((body.includes('ACTION STEP') || body.includes('CHOOSE INCOME')) && !coverage.has('matrix:decision')) {
    await captureMatrix(player, 'decision', '#citadels-decision-heading');
    await captureRails(player, 'own-hand');
  }
  if (!player.page.viewport().hasTouch && !coverage.has('desktop-pointer-game')) {
    const original = player.page.viewport();
    await resize(player.page, 1280, 900); await scrollMain(player.page, 'top');
    await screenshot(player.page, 'desktop-pointer-game-1280.png');
    if (qa) await qa.capture(player.page, 'desktop-pointer-game-1280-text200.png', { scale: true, frame: '#citadels-decision-heading' });
    await player.page.setViewport(original); coverage.add('desktop-pointer-game');
  }
}

async function captureRails(player, stage) {
  if (!qa || coverage.has(`rails:${stage}`)) return;
  const selectors = await player.page.evaluate(() => [...document.querySelectorAll('*')].filter(n => ['auto', 'scroll'].includes(getComputedStyle(n).overflowX) && n.scrollWidth > n.clientWidth + 1).slice(0, 8).map((n, index) => {
    n.setAttribute('data-citadels-qa-rail', String(index)); return { selector: `[data-citadels-qa-rail="${index}"]`, previous: n.scrollLeft };
  }));
  try {
    for (const { selector } of selectors) {
      await player.page.$eval(selector, n => { n.scrollLeft = 0; });
      await qa.capture(player.page, `${stage}-rail-${selectors.findIndex(s => s.selector === selector)}-start.png`, { frame: selector });
      await player.page.$eval(selector, n => { n.scrollLeft = n.scrollWidth; });
      await qa.capture(player.page, `${stage}-rail-${selectors.findIndex(s => s.selector === selector)}-end.png`, { frame: selector });
    }
    coverage.add(`rails:${stage}`);
  } finally {
    for (const { selector, previous } of selectors) await player.page.$eval(selector, (n, left) => { n.scrollLeft = left; n.removeAttribute('data-citadels-qa-rail'); }, previous);
  }
}

async function captureLongNames(players) {
  if (!qa) return;
  const named = players.find(player => player.name === LONG_NAME);
  if (!named?.auth?.playerId) return;
  for (const [mode, player, widths] of [
    ['phone', players.find(p => p.page.viewport().hasTouch), [320, 375]],
    ['desktop', players.find(p => !p.page.viewport().hasTouch), [1280]],
  ]) {
    if (!player || !player.page.url().includes('/citadels/game')) continue;
    const targets = [
      ['roster', `#citadels-roster-name-${named.auth.playerId}`, LONG_NAME],
      ['city', `#citadels-city-name-${named.auth.playerId}`, LONG_NAME],
    ];
    if (player.public?.firstCompletedPlayerId) {
      const completed = player.public.players.find(p => p.playerId === player.public.firstCompletedPlayerId);
      if (completed) targets.push(['completion', '#citadels-completion-banner', completed.displayName]);
    }
    const original = player.page.viewport();
    try {
      for (const [kind, selector, expectedText] of targets) {
        if (coverage.has(`names:${mode}:${kind}`) || !await player.page.$(selector)) continue;
        for (const width of widths) {
          await resize(player.page, width, 844);
          await qa.capture(player.page, `names-${mode}-${kind}-${width}-text200.png`, { scale: true, frame: selector, expectedText });
        }
        coverage.add(`names:${mode}:${kind}`);
        qa.evidence.nameFrames ??= [];
        qa.evidence.nameFrames.push({ mode, kind, expectedText, longName: expectedText === LONG_NAME });
        qa.persist();
      }
    } finally { await player.page.setViewport(original); }
  }
}

async function performOneAction(players, matchNumber) {
  await captureLongNames(players);
  for (const player of players.filter((candidate) => !candidate.left)) {
    if (!player.page.url().includes('/citadels/game')) continue;
    const body = await text(player.page);
    if (body.includes('IS MASTER BUILDER') || body.includes('NO WINNER')) continue;
    await maybeCaptureGameplay(player, body, matchNumber);
    const labels = await enabledLabels(player.page);
    const round = roundFrom(body);
    const attemptKey = (action) => `${matchNumber}:${round}:${player.name}:${action}`;

    const roleTarget = labels.find((label) => /^[1-8] · [A-Z ]+$/.test(label));
    if (roleTarget) {
      coverage.add(body.includes('LOSE ITS TURN') ? 'assassinate' : 'rob');
      await clickExactLabel(player.page, roleTarget);
      return true;
    }

    const swapTarget = labels.find((label) => / · \d+ CARDS$/.test(label));
    if (body.includes('SWAP YOUR ENTIRE HAND WITH') && swapTarget) {
      coverage.add('magician_swap');
      await scrollMain(player.page, 'decision');
      await screenshot(player.page, `12-match-${matchNumber}-magician-swap.png`);
      await clickExactLabel(player.page, swapTarget);
      return true;
    }

    const redrawConfirmation = labels.find((label) => /^REDRAW [1-9]\d* PLANS?$/.test(label));
    if (redrawConfirmation) {
      coverage.add('magician_redraw');
      await scrollMain(player.page, 'decision');
      await screenshot(player.page, `13-match-${matchNumber}-magician-redraw.png`);
      await clickExactLabel(player.page, redrawConfirmation);
      return true;
    }

    const laboratoryConfirmation = labels.find((label) => /^DISCARD 1 PLAN · GAIN 2 GOLD$/.test(label));
    if (laboratoryConfirmation) {
      coverage.add('laboratory');
      await scrollMain(player.page, 'decision');
      await screenshot(player.page, `14-match-${matchNumber}-laboratory.png`);
      await clickExactLabel(player.page, laboratoryConfirmation);
      return true;
    }

    if (body.includes('SELECT PLANS TO REPLACE') || body.includes('SELECT ONE PLAN FOR THE LABORATORY')) {
      const selectable = labels.find((label) => /^SELECT\. /.test(label));
      if (selectable) {
        await clickExactLabel(player.page, selectable);
        return true;
      }
      const cancel = labels.find((label) => /^CANCEL PLAN SELECTION$/.test(label));
      if (cancel) {
        await clickExactLabel(player.page, cancel);
        return true;
      }
    }

    if (body.includes('CHOOSE A LEGAL DISTRICT TO DESTROY')) {
      const destroyTarget = labels.find((label) => /^DESTROY · \d+ GOLD\./.test(label));
      if (destroyTarget) {
        coverage.add('warlord_destroy');
        await scrollMain(player.page, 'decision');
        await screenshot(player.page, `15-match-${matchNumber}-warlord-targets.png`);
        await clickExactLabel(player.page, destroyTarget);
        return true;
      }
      attempted.add(attemptKey('warlord_destroy'));
      if (labels.includes('CANCEL DESTRUCTION')) {
        await clickExactLabel(player.page, 'CANCEL DESTRUCTION');
        return true;
      }
    }

    const draftChoices = labels.filter((label) => /^CHOOSE SECRETLY\. /.test(label));
    if (draftChoices.length) {
      if (qa && !coverage.has('rails:private-draft')) await captureRails(player, 'private-draft');
      const rolePriority = ['assassin', 'thief', 'magician', 'architect', 'warlord', 'king', 'bishop', 'merchant'];
      const choice = rolePriority
        .map((role) => draftChoices.find((label) => roleFromChoiceLabel(label) === role && !coverage.has(`role:${role}`)))
        .find(Boolean) ?? draftChoices[0];
      const role = roleFromChoiceLabel(choice);
      if (role) coverage.add(`role:${role}`);
      await clickExactLabel(player.page, choice);
      return true;
    }

    if (labels.includes('NAME A CHARACTER') && !coverage.has('assassinate')) {
      await clickExactLabel(player.page, 'NAME A CHARACTER');
      return true;
    }
    if (labels.includes('SET A ROBBERY') && !coverage.has('rob')) {
      await clickExactLabel(player.page, 'SET A ROBBERY');
      return true;
    }
    if (labels.includes('REDRAW SELECTED PLANS') && !coverage.has('magician_redraw')) {
      await clickExactLabel(player.page, 'REDRAW SELECTED PLANS');
      return true;
    }
    if (labels.includes('SWAP ENTIRE HAND') && !coverage.has('magician_swap')) {
      await clickExactLabel(player.page, 'SWAP ENTIRE HAND');
      return true;
    }
    if (labels.includes('DRAW 2 ARCHITECT PLANS') && !coverage.has('architect_draw')) {
      coverage.add('architect_draw');
      await clickExactLabel(player.page, 'DRAW 2 ARCHITECT PLANS');
      return true;
    }
    if (labels.includes('USE LABORATORY') && !coverage.has('laboratory')) {
      await clickExactLabel(player.page, 'USE LABORATORY');
      return true;
    }
    if (labels.includes('USE SMITHY · PAY 2 GOLD') && !coverage.has('smithy')) {
      coverage.add('smithy');
      await clickExactLabel(player.page, 'USE SMITHY · PAY 2 GOLD');
      return true;
    }
    if (labels.includes('DESTROY A DISTRICT') && !coverage.has('warlord_destroy') && !attempted.has(attemptKey('warlord_destroy'))) {
      await clickExactLabel(player.page, 'DESTROY A DISTRICT');
      return true;
    }
    if (labels.includes('COLLECT DISTRICT TAX')) {
      coverage.add('district_tax');
      await clickExactLabel(player.page, 'COLLECT DISTRICT TAX');
      return true;
    }

    const keep = labels.find((label) => /^KEEP THIS PLAN\. /.test(label));
    if (keep) {
      if (qa && !coverage.has('private-income-choice')) {
        await scrollMain(player.page, 'decision'); await screenshot(player.page, 'private-income-keep.png');
        coverage.add('private-income-choice');
      }
      coverage.add('keep_district');
      await clickExactLabel(player.page, keep);
      return true;
    }

    const goldIncome = labels.find((label) => /^TAKE [23] GOLD$/.test(label));
    const cardIncome = labels.find((label) => /^DRAW [23] · KEEP (?:1|ALL)$/.test(label));
    if (goldIncome || cardIncome) {
      const incomeKey = `${matchNumber}:${player.name}`;
      const incomeNumber = (incomeTurns.get(incomeKey) ?? 0) + 1;
      incomeTurns.set(incomeKey, incomeNumber);
      const handCount = handCountFrom(body);
      const takeCards = Boolean(cardIncome) && (handCount <= 2 || incomeNumber % 4 === 0);
      coverage.add(takeCards ? 'income_cards' : 'income_gold');
      await clickExactLabel(player.page, takeCards ? cardIncome : goldIncome ?? cardIncome);
      return true;
    }

    const build = labels.find((label) => /^BUILD · \d+ GOLD\./.test(label));
    if (build) {
      coverage.add('build');
      await clickExactLabel(player.page, build);
      return true;
    }

    if (labels.includes('END CHARACTER TURN')) {
      if (qa && player.public?.players.some(p => p.city.length >= 3) && !coverage.has('rails:populated-cities')) await captureRails(player, 'populated-cities');
      coverage.add('end_turn');
      await clickExactLabel(player.page, 'END CHARACTER TURN');
      return true;
    }
  }
  return false;
}

async function driveFullMatch(players, matchNumber) {
  let idleLoops = 0;
  let actions = 0;
  const deadline = Date.now() + 18 * 60_000;
  for (let loop = 0; loop < 2_400; loop += 1) {
    assert(Date.now() < deadline, 'Natural court exceeded its 18-minute runtime budget');
    const livePlayers = players.filter((player) => !player.left);
    const bodies = await Promise.all(livePlayers.map((player) => text(player.page)));
    if (bodies.some((body) => body.includes('IS MASTER BUILDER') || body.includes('NO WINNER'))) {
      checkpoint(`match ${matchNumber} complete after ${actions} rendered actions`);
      return actions;
    }
    if (await performOneAction(livePlayers, matchNumber)) {
      actions += 1;
      idleLoops = 0;
      if (actions % 100 === 0) checkpoint(`match ${matchNumber}: ${actions} rendered actions`);
      await delay(80);
      continue;
    }
    idleLoops += 1;
    if (idleLoops > 100) {
      const diagnostics = [];
      for (const player of livePlayers) diagnostics.push({ name: player.name, path: new URL(player.page.url()).pathname, labels: await enabledLabels(player.page), body: (await text(player.page)).slice(0, 900) });
      throw new Error(`No actionable Citadels decision: ${JSON.stringify(diagnostics)}`);
    }
    await delay(120);
  }
  throw new Error(`Citadels match ${matchNumber} exceeded the rendered action limit`);
}

async function roomCodeFromLobby(page) {
  const label = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')]
    .map((element) => element.getAttribute('aria-label'))
    .find((value) => value?.startsWith('Room code ')) ?? null);
  const roomCode = label?.slice('Room code '.length) ?? null;
  assert(roomCode && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(roomCode), `Invalid lobby room code label: ${label}`);
  return roomCode;
}

async function assertGameOverDialog(player) {
  const semantics = await player.page.evaluate(() => {
    const dialog = document.getElementById('citadels-game-over');
    return dialog ? {
      role: dialog.getAttribute('role'),
      modal: dialog.getAttribute('aria-modal'),
      focusInside: dialog.contains(document.activeElement),
      label: dialog.getAttribute('aria-label'),
    } : null;
  });
  assert(semantics?.role === 'dialog' && semantics.modal === 'true', `Game-over semantics are wrong: ${JSON.stringify(semantics)}`);
  assert(semantics.focusInside, `Game-over focus escaped the dialog: ${JSON.stringify(semantics)}`);
}

async function exerciseFocusStability(players) {
  const host = players[0];
  await host.page.goto(`${BASE_URL}/citadels`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await setInput(host.page, 'Your name', host.name);
  await clickButton(host.page, /^CREATE ROOM$/);
  await waitForPath(host.page, '/citadels/lobby');
  const roomCode = await roomCodeFromLobby(host.page);
  for (const player of players.slice(1)) await joinPlayer(player, roomCode, '');
  await clickButton(host.page, /^START GAME$/);
  await Promise.all(players.map((player) => waitForPath(player.page, '/citadels/game')));
  checkpoint(`focus stability room ${roomCode}`);

  let chooser = null;
  let actions = 0;
  for (let step = 0; step < 180 && !chooser; step += 1) {
    let acted = false;
    for (const player of players) {
      const labels = await enabledLabels(player.page);
      if (labels.includes('REDRAW SELECTED PLANS') && labels.some((label) => /^DRAW [23] · KEEP 1$/.test(label))) {
        chooser = player;
        break;
      }
      const draft = labels.filter((label) => /^CHOOSE SECRETLY\. /.test(label));
      const roleOrder = ['magician', 'king', 'bishop', 'merchant', 'architect', 'warlord', 'thief', 'assassin'];
      const choice = roleOrder.map((role) => draft.find((label) => roleFromChoiceLabel(label) === role)).find(Boolean)
        ?? labels.find((label) => /^TAKE [23] GOLD$/.test(label))
        ?? labels.find((label) => label === 'END CHARACTER TURN');
      if (choice) {
        await clickExactLabel(player.page, choice);
        actions += 1;
        acted = true;
        break;
      }
    }
    if (!acted && !chooser) await delay(150);
  }
  assert(chooser, 'No Magician reached an uncollected income decision within the bounded focus setup');
  await resize(chooser.page, 390, 844);
  await clickButton(chooser.page, /^REDRAW SELECTED PLANS$/);
  const selectable = (await enabledLabels(chooser.page)).filter((label) => /^SELECT\. /.test(label));
  assert(selectable.length >= 2, 'Focus regression needs two private district choices');
  await clickExactLabel(chooser.page, selectable[0]);
  await waitForText(chooser.page, 'REDRAW 1 PLAN');
  const focusTarget = await findButton(chooser.page, new RegExp(`^${selectable[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  assert(focusTarget, 'Second private district control disappeared');
  await focusTarget.evaluate((element) => {
    element.setAttribute('data-focus-stability-target', 'true');
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus({ preventScroll: true });
  });
  await focusTarget.dispose();
  await delay(200);
  const snapshot = () => chooser.page.evaluate(() => {
    const target = document.querySelector('[data-focus-stability-target="true"]');
    const scroll = [];
    for (let element = target; element; element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1) {
        scroll.push({ top: element.scrollTop, left: element.scrollLeft });
      }
    }
    return {
      targetFocused: document.activeElement === target,
      focusLabel: document.activeElement?.getAttribute('aria-label'),
      selectedLabels: [...document.querySelectorAll('[role="button"][aria-label]')].filter((element) => element.getAttribute('aria-label').startsWith('SELECTED. ')).map((element) => element.getAttribute('aria-label')),
      selectedStates: [...document.querySelectorAll('[role="button"][aria-label]')].filter((element) => element.getAttribute('aria-label').startsWith('SELECTED. ')).map((element) => ({ selected: element.getAttribute('aria-selected'), pressed: element.getAttribute('aria-pressed') })),
      scroll,
    };
  });
  const before = await snapshot();
  assert(before.targetFocused && before.selectedLabels.length > 0, `Focus setup failed: ${JSON.stringify(before)}`);
  assert(before.selectedStates.every((state) => state.pressed === 'true' && state.selected === null), `Selected district buttons need pressed semantics: ${JSON.stringify(before.selectedStates)}`);
  await screenshot(chooser.page, 'focus-stability-before-disconnect-390.png');

  const leaving = players.find((player) => player !== chooser);
  leaving.intentionalOffline = true;
  await leaving.page.goto('about:blank');
  await waitForText(chooser.page, 'RECONNECTING · SEAT RESERVED BRIEFLY');
  await delay(350);
  const after = await snapshot();
  assert(after.targetFocused, `Unrelated disconnect stole district focus: ${JSON.stringify(after)}`);
  assert(JSON.stringify(after.selectedLabels) === JSON.stringify(before.selectedLabels), 'Unrelated disconnect changed the local card selection');
  assert(after.selectedStates.every((state) => state.pressed === 'true' && state.selected === null), 'Unrelated disconnect lost selected-button semantics');
  assert(JSON.stringify(after.scroll) === JSON.stringify(before.scroll), `Unrelated disconnect moved the reading position: ${JSON.stringify({ before, after })}`);
  await screenshot(chooser.page, 'focus-stability-after-disconnect-390.png');
  await leaving.page.goto(`${BASE_URL}/citadels/game`);
  await waitForText(leaving.page, 'YOUR DISTRICT HAND');
  leaving.intentionalOffline = false;

  await clickButton(chooser.page, /^CANCEL PLAN SELECTION$/);
  await clickButton(chooser.page, /^DRAW [23] · KEEP 1$/);
  await waitUntil(() => hasButton(chooser.page, /^KEEP THIS PLAN\. /), 'new mandatory income-card choice');
  await waitUntil(() => chooser.page.evaluate(() => document.activeElement?.id === 'citadels-decision-heading'), 'new mandatory decision receives focus');
  await screenshot(chooser.page, 'focus-stability-new-mandatory-choice-390.png');
  assert(consoleIssues.length === 0, `Console warnings/errors: ${JSON.stringify(consoleIssues)}`);
  return { roomCode, setupActions: actions, chooser: chooser.name, forfeitingPlayer: leaving.name, before, after, mandatoryDecisionFocused: true };
}

async function exerciseDirectRecovery(host) {
  await resize(host.page, 320, 780);
  await host.page.goto(`${BASE_URL}/citadels`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await setInput(host.page, 'Your name', host.name);
  await clickButton(host.page, /^CREATE ROOM$/);
  await waitForPath(host.page, '/citadels/lobby');
  const roomCode = await roomCodeFromLobby(host.page);
  await host.page.goto(`${BASE_URL}/citadels/game`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForText(host.page, 'RESTORING GAME');
  await assertNoHorizontalOverflow(host);
  await assertVisibleTouchTargets(host);
  await screenshot(host.page, 'recovery-direct-entry-320.png');
  const typography = await host.page.evaluate(() => {
    const element = [...document.querySelectorAll('[aria-live="polite"]')].find((node) => node.textContent.includes('Restoring the royal court'));
    return element ? { fontSize: getComputedStyle(element).fontSize, lineHeight: getComputedStyle(element).lineHeight } : null;
  });
  assert(typography?.fontSize === '14px' && typography?.lineHeight === '20px', `Recovery message is too small: ${JSON.stringify(typography)}`);
  await host.page.evaluate(() => {
    window.__recoveryEvidence = [];
    const remove = Storage.prototype.removeItem;
    let failOnce = true;
    Storage.prototype.removeItem = function (key) {
      if (this === sessionStorage && key === 'za:auth') {
        window.__recoveryEvidence.push({ event: 'clear', failed: failOnce });
        if (failOnce) {
          failOnce = false;
          throw new Error('QA storage removal failure');
        }
      }
      return remove.call(this, key);
    };
    for (const method of ['replaceState', 'pushState']) {
      const original = history[method];
      history[method] = function (...args) {
        if (args[2] && new URL(args[2], location.origin).pathname === '/') {
          window.__recoveryEvidence.push({ event: 'navigate-home', authPresent: sessionStorage.getItem('za:auth') !== null });
        }
        return original.apply(this, args);
      };
    }
  });
  await clickButton(host.page, /^BACK TO ARCADE$/);
  await waitForText(host.page, 'Your saved session could not be cleared');
  assert(new URL(host.page.url()).pathname === '/citadels/game', 'Failed session cleanup unexpectedly navigated away');
  assert(await host.page.evaluate(() => sessionStorage.getItem('za:auth') !== null), 'Failed cleanup unexpectedly discarded stored credentials');
  await screenshot(host.page, 'recovery-retryable-error-320.png');
  await clickButton(host.page, /^BACK TO ARCADE$/);
  await waitForPath(host.page, '/');
  const events = await host.page.evaluate(() => window.__recoveryEvidence);
  const navigations = events.filter((event) => event.event === 'navigate-home');
  assert(navigations.length > 0 && navigations.every((event) => !event.authPresent), `Navigation preceded storage cleanup: ${JSON.stringify(events)}`);
  assert(await host.page.evaluate(() => sessionStorage.getItem('za:auth')) === null, 'Direct-entry recovery retained stored authentication');
  await delay(250);
  assert(consoleIssues.length === 0, `Recovery console warnings/errors: ${JSON.stringify(consoleIssues)}`);
  await screenshot(host.page, 'recovery-returned-to-arcade-320.png');
  return { roomCode, typography, events, consoleIssues };
}

async function main() {
  assert(!fs.existsSync(outputDir), 'Choose a new output directory; prior evidence must remain intact');
  fs.mkdirSync(outputDir, { recursive: true }); ownsOutput = true;
  qa = createEvidence({ outputDir, base: BASE_URL, api: API_URL });
  qa.secrets.add(' royal-court '); qa.secrets.add('royal-court'); qa.secrets.add('wrong-password');
  let browser = null, watchdog = null;
  const players = [];
  try {
    assert(process.env.CITADELS_UI_EXCLUSIVE_WINDOW === 'granted', 'Exclusive browser window must be explicitly granted');
    assertUiSource();
    local(API_URL);
    const health = await fetch(API_URL, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert(health.ok && (await health.json()).service === 'zuychin-arcade-server', 'Natural court requires ordinary API');
    const fixture = await fetch(API_URL + '/__qa/citadels-fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert(fixture.status === 404, 'Natural court refuses fixture endpoint');
    const bundle = await bundleFence(BASE_URL + '/citadels', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256);
    qa.evidence.bundle = bundle; qa.persist(); writeReceipt('bundle.json', bundle);
    assert(/^[A-Za-z0-9+/]{43}=$/.test(QA_BROWSER_CERT_SPKI ?? ''), 'Provide the current QA certificate SPKI fingerprint');
    browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--disable-dev-shm-usage', `--ignore-certificate-errors-spki-list=${QA_BROWSER_CERT_SPKI}`] });
    watchdog = setTimeout(() => { qa.evidence.watchdogExpired = true; qa.persist(); void browser.close(); }, 25 * 60_000);
    await qa.calibrate(browser);
    const host = await openPlayer(browser, 'Aurelia Host', 390, 844, true);
    players.push(host);
    if (RECOVERY_ONLY) {
      const recovery = await exerciseDirectRecovery(host);
      const result = { outputDir, recovery, screenshots: [...screenshots].sort() };
      writeReceipt('recovery-result.json', result);
      qa.evidence.checkMode = 'recovery-only';
      return;
    }
    const borin = await openPlayer(browser, 'Borin', 320, 780);
    const cyra = await openPlayer(browser, LONG_NAME, 360, 800);
    const dorian = await openPlayer(browser, 'Dorian', 768, 900);
    players.push(borin, cyra, dorian);

    if (FOCUS_STABILITY_ONLY) {
      const focusStability = await exerciseFocusStability(players);
      const result = { outputDir, consoleIssues, focusStability, screenshots: [...screenshots].sort() };
      writeReceipt('focus-stability-result.json', result);
      qa.evidence.checkMode = 'focus-stability-only';
      return;
    }

    const focusEvidence = await exerciseFocusAndLanding(host);
    if (FOCUS_ONLY) {
      assert(consoleIssues.length === 0, `Console warnings/errors: ${JSON.stringify(consoleIssues)}`);
      const result = { outputDir, consoleIssues, focusPredicate: 'authored solid #f7faff outline at least 3px wide with at least 3px offset', focusEvidence, screenshots: [...screenshots].sort() };
      writeReceipt('focus-result.json', result);
      qa.evidence.checkMode = 'focus-only';
      return;
    }
    await resize(host.page, host.width, host.height);
    await setInput(host.page, 'Your name', host.name);
    await setInput(host.page, 'Room password, optional', ' royal-court ');
    await clickButton(host.page, /^CREATE ROOM$/);
    await waitForPath(host.page, '/citadels/lobby');
    const roomCode = await roomCodeFromLobby(host.page);
    checkpoint(`created isolated room ${roomCode}`);

    await joinPlayer(borin, roomCode, ' royal-court ', { validation: true, wrongPassword: true });
    await joinPlayer(cyra, roomCode, ' royal-court ');
    await joinPlayer(dorian, roomCode, ' royal-court ');
    await waitForText(host.page, '4/7');
    await captureMatrix(host, 'lobby');
    await screenshot(host.page, '02-lobby-host-390.png', true);
    await screenshot(borin.page, '03-lobby-guest-320.png', true);
    await assertNoHorizontalOverflow(host);
    await assertNoHorizontalOverflow(borin);
    await assertVisibleTouchTargets(host);
    await assertVisibleTouchTargets(borin);

    cyra.intentionalOffline = true;
    await cyra.page.setOfflineMode(true);
    await waitForText(host.page, 'RECONNECTING · SEAT RESERVED');
    await screenshot(host.page, '06-lobby-disconnected-seat-390.png', true);
    assert(await hasButton(host.page, /^WAITING FOR RECONNECTION$/, false), 'Host did not see a truthful disabled reconnect state');
    await cyra.page.setOfflineMode(false);
    await cyra.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForPath(cyra.page, '/citadels/lobby');
    await waitForText(cyra.page, 'Secretly draft');
    cyra.intentionalOffline = false;
    await waitUntil(() => hasButton(host.page, /^START GAME$/), 'rejoined seat restores start');

    await clickButton(host.page, /^START GAME$/);
    await Promise.all(players.map((player) => waitForPath(player.page, '/citadels/game')));
    await waitUntil(async () => (await Promise.all(players.map((player) => hasButton(player.page, /^CHOOSE SECRETLY\. /)))).filter(Boolean).length === 1, 'exactly one private drafter');

    const errorsBeforeReload = consoleIssues.length;
    await borin.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForPath(borin.page, '/citadels/game');
    await waitForText(borin.page, 'YOUR DISTRICT HAND');
    assert(consoleIssues.length === errorsBeforeReload, 'Reloading a live private seat produced a browser error');

    const firstMatchActions = await driveFullMatch(players, 1);
    const terminal = await naturalTerminal(players);
    writeReceipt('natural-terminal.json', terminal);
    writeReceipt('natural-journey.json', {
      bundle, terminalRevision: terminal.revision, roundNumber: terminal.roundNumber,
      method: 'Automated real-pointer browser strategies, not independent manual Astra choices.',
      renderedInteractions: firstMatchActions,
      seats: players.map(player => ({ name: player.name, gameplayAcknowledgements: player.acks.filter(ack => ack.action !== 'start').length, rejections: player.rejections })),
    });
    await waitForText(host.page, 'IS MASTER BUILDER');
    await assertGameOverDialog(host);
    await captureMatrix(host, 'results', '#citadels-game-over');
    for (const width of [375, 1280]) {
      await resize(dorian.page, width, 844);
      for (const align of ['start', 'end']) await qa.capture(dorian.page, `results-pointer-${width}-text200-${align}.png`, { scale: true, frame: '#citadels-game-over', align });
    }
    await resize(dorian.page, dorian.width, dorian.height);
    await assertVisibleTouchTargets(host);
    await screenshot(host.page, '16-match-1-game-over-mobile-390.png');
    const hostViewport = host.page.viewport();
    await resize(host.page, 1280, 900);
    await screenshot(host.page, '17-match-1-game-over-desktop-1280.png');
    if (hostViewport) await host.page.setViewport(hostViewport);

    await clickButton(host.page, /^PLAY AGAIN$/, 45000, '#citadels-game-over');
    await waitForText(host.page, 'ROUND 1');
    await waitUntil(async () => (await Promise.all(players.map((player) => hasButton(player.page, /^CHOOSE SECRETLY\. /)))).filter(Boolean).length === 1, 'clean rematch draft');
    await waitUntil(() => players.every(player => player.public?.revision === terminal.revision + 1 && player.private?.revision === player.public.revision), 'monotonic fresh rematch pair');
    const rematchStartRevision = host.public.revision;
    await scrollMain(host.page, 'top');
    await screenshot(host.page, '18-rematch-round-one-390.png');
    const rematchErrorsBeforeReload = consoleIssues.length;
    await dorian.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForPath(dorian.page, '/citadels/game');
    await waitForText(dorian.page, 'ROUND 1');
    assert(consoleIssues.length === rematchErrorsBeforeReload, 'Reloading during rematch sync produced a browser error');

    await cyra.page.goBack().catch(() => undefined);
    await waitForText(cyra.page, 'Forfeit this court?');
    await clickButton(cyra.page, /^STAY$/, 45000, '#arcade-dialog');
    await waitUntil(async () => !(await text(cyra.page)).includes('Forfeit this court?'), 'Stay closes forfeit confirmation');
    assert(new URL(cyra.page.url()).pathname.endsWith('/citadels/game'), 'Browser Back escaped the protected live game');
    const secondMatchActions = await driveFullMatch(players, 2);
    const rematchTerminal = await naturalTerminal(players);
    assert(rematchTerminal.revision > rematchStartRevision, 'Full rematch must advance to its own terminal');
    writeReceipt('rematch-terminal.json', rematchTerminal);
    qa.evidence.rematch = { startRevision: rematchStartRevision, terminal: rematchTerminal, renderedInteractions: secondMatchActions };
    qa.persist();
    await screenshot(host.page, '19-full-rematch-terminal.png');

    if (SHORTAGE_FOLLOWUP) {
      await clickButton(host.page, /^PLAY AGAIN$/, 45000, '#citadels-game-over');
      await waitUntil(() => host.public?.phase === 'drafting' && host.public.revision > rematchTerminal.revision, 'separate third-court shortage setup');
      await clickButton(cyra.page, /^Back to arcade$/, 45000, '#citadels-toolbar');
      await waitForText(cyra.page, 'Forfeit this court?');
      await screenshot(cyra.page, '19-live-forfeit-confirmation-360.png');
      await clickButton(cyra.page, /^LEAVE$/, 45000, '#arcade-dialog');
      await waitForPath(cyra.page, '/');
      await delay(400);
      assert(new URL(cyra.page.url()).pathname === '/', 'Confirmed leave did not settle at the arcade');
      assert(await cyra.page.evaluate(() => sessionStorage.getItem('za:auth')) === null, 'Confirmed leave did not await web auth cleanup');
      cyra.left = true;
      await waitForText(host.page, 'NO WINNER');
      assert(host.public.terminationReason === 'not_enough_players' && host.public.winnerIds.length === 0, 'Four-to-three departure must cancel immediately');
      assert(Object.keys(host.public.scoreBreakdowns).length === 0, 'Separate shortage court must not score cities');
      const shortageTerminal = structuredClone(host.public);
      await screenshot(host.page, '20-rematch-no-winner-390.png', true);

      await waitForText(host.page, 'REMATCH UNAVAILABLE · NEED 1 NEW BUILDER');
      assert(!(await text(host.page)).includes('WAITING FOR 0'), 'Finished room rendered the impossible WAITING FOR 0 state');
      await assertGameOverDialog(host);
      await screenshot(host.page, '21-rematch-unavailable-390.png');
      await clickButton(host.page, /^START A NEW ROOM$/, 45000, '#citadels-game-over');
      await waitForPath(host.page, '/citadels');
      await delay(500);
      assert(new URL(host.page.url()).pathname.endsWith('/citadels'), 'New-room navigation did not settle on Citadels creation');
      assert(await host.page.evaluate(() => sessionStorage.getItem('za:auth')) === null, 'New-room navigation did not await web auth cleanup');
      qa.evidence.shortageFollowup = { separateFromNaturalMatches: true, terminal: shortageTerminal, proof: 'Third court deliberately ended by normal UI leave; not a full natural rematch' };
    }

    const requiredCoverage = ['income_gold', 'income_cards', 'keep_district', 'build', 'end_turn'];
    for (const action of requiredCoverage) assert(coverage.has(action), `Rendered full games missed ${action}`);
    for (const mode of ['phone', 'desktop']) for (const kind of ['roster', 'city']) assert(coverage.has(`names:${mode}:${kind}`), `Missing enlarged long-name ${mode} ${kind} frame`);
    if (!qa.evidence.nameFrames?.some(frame => frame.kind === 'completion' && frame.longName)) qa.evidence.gaps.push({ kind: 'natural-branch-not-encountered', branch: '20-character player first-completion banner' });
    assert(consoleIssues.length === 0, `Console warnings/errors: ${JSON.stringify(consoleIssues)}`);
    const result = {
      outputDir,
      bundle,
      method: 'Four isolated browser seats with an automated projection/DOM-driven policy and real pointer inputs. Not independent manual Astra decisions.',
      terminal: { revision: terminal.revision, roundNumber: terminal.roundNumber, winnerIds: terminal.winnerIds, players: terminal.players, scoreBreakdowns: terminal.scoreBreakdowns },
      acknowledgements: players.map((player) => ({ name: player.name, count: player.acks.length, rejections: player.rejections })),
      roomCode,
      consoleIssues,
      firstMatchActions,
      secondMatchActions,
      rematchTerminal,
      coverage: [...coverage].sort(),
      screenshots: [...screenshots].sort(),
      journeys: ['landing validation', 'password create', 'join validation', 'wrong password', 'lobby disconnect and reconnect', 'full natural game', 'full natural rematch', 'browser Back stay guard', ...(SHORTAGE_FOLLOWUP ? ['separate third-court four-to-three immediate no-winner', 'rematch shortage', 'awaited new-room cleanup'] : [])],
    };
    writeReceipt('result.json', result);
    qa.evidence.finalBundle = await bundleFence(BASE_URL + '/citadels', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256);
    qa.evidence.completeJourney = true;
    qa.evidence.gaps.push(...['magician_redraw', 'warlord_destroy', 'laboratory', 'smithy', 'architect_draw', 'magician_swap'].filter(branch => !coverage.has(branch)).map(branch => ({ kind: 'natural-branch-not-encountered', branch })));
    qa.evidence.gaps.push({ kind: 'not-covered', branches: ['seven-seat layout', 'all unique district effects', 'killed Merchant private notice', 'Library and Observatory draws', 'final tie-break', 'current-round forfeit autopilot with at least four eligible seats', 'native device and physical touch'] });
    qa.evidence.gaps.push({ kind: 'separate-verification', branches: ['concealed role-holder DOM and identical-back comparison require integrated stable selectors', 'focus-stability-only and recovery-only modes are separate runs', 'category hash mapping is not unique-building portrait fidelity'] });
    assert(qa.evidence.blockedRequests.length === 0, 'Network allowlist rejected a request');
  } catch (error) {
    qa.evidence.failure = safe(error.stack ?? error.message); qa.persist(); throw error;
  } finally {
    clearTimeout(watchdog);
    for (const player of players) {
      try {
        await player.page.setOfflineMode(false);
        let auth = await player.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null')).catch(() => player.auth);
        if (auth?.token) {
          qa.secrets.add(auth.token); player.auth = auth;
          try {
            await leavePlayerUI(player);
          } catch (error) { qa.evidence.cleanup.push({ actor: player.name, uiError: safe(error.message) }); }
          auth = await player.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null')).catch(() => player.auth);
          if (auth?.token) {
            player.fallbackCleanup = true;
            const response = await fetch(API_URL + '/rooms/' + encodeURIComponent(auth.roomCode) + '/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.token }, redirect: 'error', signal: AbortSignal.timeout(10000) });
            qa.evidence.cleanup.push({ actor: player.name, fallback: true, normalUI: false, status: response.status });
          }
        }
        const authCleared = await player.page.evaluate(() => !sessionStorage.getItem('za:auth')).catch(() => false);
        for (const receipt of qa.evidence.cleanup.filter(r => r.actor === player.name && r.normalUI)) receipt.authCleared = authCleared;
      } catch (error) { qa.evidence.cleanup.push({ actor: player.name, error: safe(error.message) }); }
      try { await player.context.close(); } catch (error) { qa.evidence.cleanup.push({ actor: player.name, contextError: safe(error.message) }); }
    }
    try { if (browser) { await browser.close(); qa.evidence.browserClosed = true; } }
    finally { qa.evidence.consoleIssues = consoleIssues; qa.evidence.coverage = [...coverage].sort(); qa.persist(); }
    if (qa.evidence.completeJourney) {
      assert(players.every(player => qa.evidence.cleanup.some(r => r.actor === player.name && r.normalUI && r.status === 200 && r.authCleared)), 'Every owned seat requires normal UI cleanup');
      assert(!qa.evidence.cleanup.some(r => r.fallback || r.error || r.uiError || r.contextError), 'Fallback cleanup is not normal lifecycle proof');
    }
  }
  console.log(`CITADELS UI AUTOMATION COMPLETE: ${outputDir}; visual findings require independent review`);
}

module.exports = { openPlayer, setInput, clickButton, hasButton, visibleButtonData, enabledLabels, waitUntil, waitForPath, waitForText, screenshot, assertNoHorizontalOverflow, assertVisibleTouchTargets, consoleIssues, performOneAction, leavePlayerUI, naturalTerminal };

if (require.main === module) main().catch((error) => {
  if (ownsOutput) writeReceipt('failure.txt', `${error instanceof Error ? error.stack : String(error)}\nConsole issues: ${JSON.stringify(consoleIssues)}\nCoverage: ${JSON.stringify([...coverage].sort())}`);
  console.error(safe(`CITADELS UI SMOKE FAIL: ${error instanceof Error ? error.stack : String(error)}`));
  console.error(`Artifacts: ${outputDir}`);
  process.exitCode = 1;
});
