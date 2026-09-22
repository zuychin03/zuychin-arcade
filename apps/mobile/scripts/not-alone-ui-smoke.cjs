const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-core');
const { createEvidence, MATRIX, bundleFence, guardNetwork, local, redact } = require('./not-alone-ui-evidence.cjs');
const { ownViewPolicy, assertOwnViewMode, OWN_VIEW_METHOD } = require('./not-alone-own-view-policy.cjs');
const { beginChoiceEvidence, selectionEvidence, confirmChoiceEvidence, desktopResultEvidence } = require('./not-alone-choice-evidence.cjs');
const API_URL = process.env.NOT_ALONE_API_URL ?? 'http://127.0.0.1:3213';
let qa = null, ownsOutput = false;
const resize = (page, width, height) => page.setViewport({ ...page.viewport(), width, height, deviceScaleFactor: 1 });
const writeReceipt = (name, value) => fs.writeFileSync(path.join(outputDir, name), redact(value, [...(qa?.secrets ?? [])]) + '\n');

const BASE_URL = process.env.NOT_ALONE_WEB_URL ?? 'http://127.0.0.1:8081';
const BROWSER_PATH = process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const QA_BROWSER_CERT_SPKI = process.env.QA_BROWSER_CERT_SPKI?.trim();
if (QA_BROWSER_CERT_SPKI && !/^[A-Za-z0-9+/]{43}=$/.test(QA_BROWSER_CERT_SPKI)) {
  throw new Error('QA_BROWSER_CERT_SPKI must be one SHA-256 certificate fingerprint in base64.');
}
const FOCUS_ONLY = process.env.NOT_ALONE_UI_FOCUS_ONLY === 'true';
const FOCUS_STABILITY_ONLY = process.env.NOT_ALONE_UI_FOCUS_STABILITY_ONLY === 'true';
const OWN_VIEW = process.env.NOT_ALONE_UI_OWN_VIEW === 'true';
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const outputDir = process.env.NOT_ALONE_UI_OUTPUT_DIR
  ?? path.join(os.tmpdir(), `zuychin-arcade-not-alone-ui-${runId}`);
const consoleIssues = [];
const coverage = new Set();
const screenshots = new Set();
const privateLeakChecks = [];
const lateHuntCards = new Set(['cataclysm', 'detour']);
const endHuntCards = new Set(['stasis', 'tracking']);

function titleCaseCard(cardId) {
  return cardId.split('_').map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(' ');
}

function escapedPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const checkpoint = (message) => console.log(`[not-alone-ui-smoke] ${message}`);

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

function auditedSourceHashes() {
  const root = path.resolve(__dirname, '../../..');
  const files = [
    'apps/mobile/app/not-alone/game.tsx',
    'apps/mobile/app/not-alone/index.tsx',
    'apps/mobile/app/not-alone/join.tsx',
    'apps/mobile/app/not-alone/lobby.tsx',
    'apps/mobile/scripts/not-alone-ui-smoke.cjs',
    'apps/mobile/scripts/not-alone-ui-evidence.cjs',
    'apps/mobile/scripts/not-alone-own-view-policy.cjs',
    'apps/mobile/scripts/not-alone-choice-evidence.cjs',
    'apps/mobile/scripts/skull-ui-evidence.cjs',
    'apps/mobile/scripts/tokyo-ui-evidence.cjs',
    'apps/mobile/metro.config.js',
    'apps/mobile/components/ui/GameRecovery.tsx',
    'apps/mobile/components/ui/ScalePressable.tsx',
    'apps/mobile/components/ui/CardSurface.tsx',
    'apps/mobile/components/ui/GameCover.tsx',
    'apps/mobile/components/not-alone/PlaceCard.tsx',
    'apps/mobile/components/not-alone/PlaceArtwork.tsx',
    'apps/mobile/components/not-alone/CardChip.tsx',
    'apps/mobile/components/not-alone/PlaceChoiceRow.tsx',
    'apps/mobile/components/not-alone/NotAloneArtwork.tsx',
    'apps/mobile/components/not-alone/useNotAloneActions.ts',
    'apps/mobile/components/not-alone/useNotAloneDecisionAttention.ts',
    'apps/server/src/game/not-alone/engine.ts',
    'apps/server/src/game/not-alone/publicState.ts',
    'pnpm-lock.yaml',
    'package.json',
    'patches/@expo__metro-file-map@56.0.4.patch',
  ];
  return Object.fromEntries(files.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
}

function exportedBuildEvidence() {
  if (!process.env.QA_STATIC_ROOT) return null;
  const root = path.resolve(process.env.QA_STATIC_ROOT);
  const bundleDirectory = path.join(root, '_expo', 'static', 'js', 'web');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const entryName = html.match(/_expo\/static\/js\/web\/((?:entry|index)-[a-f0-9]+\.js)/)?.[1];
  assert(entryName, 'QA static export is missing its entry bundle');
  const entrySource = fs.readFileSync(path.join(bundleDirectory, entryName));
  assert(entrySource.includes('https://localhost:3214'), 'QA static export does not contain the local HTTPS API origin; rebuild with a cleared transform cache');
  const sha256 = crypto.createHash('sha256').update(entrySource).digest('hex');
  if (process.env.QA_EXPECTED_WEB_SHA256) assert(sha256 === process.env.QA_EXPECTED_WEB_SHA256, 'Export hash differs from the frozen candidate');
  return { root, entryBundle: path.join('_expo', 'static', 'js', 'web', entryName),
    sha256: crypto.createHash('sha256').update(entrySource).digest('hex'),
    apiOrigin: 'https://localhost:3214', certificateFingerprint: QA_BROWSER_CERT_SPKI ?? null };
}

function assertUiSource() {
  const game = source('app/not-alone/game.tsx');
  const hook = source('components/not-alone/useNotAloneActions.ts');
  const lobby = source('app/not-alone/lobby.tsx');
  assert(hook.includes('notAloneSyncing') && hook.includes('viewerPlayerId'), 'Missing paired viewer fence');
  assert(game.includes('useNotAloneActions') && game.includes('isNotAloneLeavePromptCurrent'), 'Missing owned command/leave lifecycle');
  assert(lobby.includes('notAlonePublic && state.notAlonePrivate && !state.notAloneSyncing'), 'Lobby may navigate before own pair');
  assert(game.includes('mine.resolutionOptions') && game.includes('mine.canChooseSurvivalCard'), 'Missing authoritative private decisions');
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
        visible: rect.width > 0 && rect.height > 0 && style.display !== 'none'
          && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0,
        width: rect.width,
        height: rect.height,
      };
    })
    .filter((item) => item.visible && item.label && (!onlyEnabled || !item.disabled)), enabledOnly);
}

async function enabledLabels(page) {
  return (await visibleButtonData(page, true)).map((button) => button.label);
}

async function findButton(page, matcher, enabledOnly = true) {
  const buttons = await page.$$('[role="button"][aria-label]');
  for (const button of buttons) {
    const matches = await button.evaluate((element, data) => {
      const regex = new RegExp(data.source, data.flags);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const disabled = element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
      return regex.test(element.getAttribute('aria-label') ?? '')
        && rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > 0
        && (!data.enabledOnly || !disabled);
    }, { source: matcher.source, flags: matcher.flags, enabledOnly });
    if (matches) return button;
    await button.dispose();
  }
  return null;
}

async function hasButton(page, matcher, enabledOnly = true) {
  const button = await findButton(page, matcher, enabledOnly);
  if (!button) return false;
  await button.dispose();
  return true;
}

async function clickButton(page, matcher, timeout = 45_000) {
  await waitUntil(() => hasButton(page, matcher), `enabled button ${matcher}`, timeout);
  const button = await findButton(page, matcher);
  assert(button, `Could not find enabled button ${matcher}`);
  try {
    await button.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await delay(80);
    const bounds = await button.boundingBox();
    assert(bounds && bounds.width >= 48 && bounds.height >= 48, `Touch target too small for ${matcher}: ${JSON.stringify(bounds)}`);
    if (page.viewport()?.hasTouch) await button.tap(); else await button.click();
    await delay(120);
  } finally {
    await button.dispose();
  }
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

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

async function waitForText(page, value, timeout = 45_000) {
  await page.waitForFunction((expected) => document.body.innerText.includes(expected), { timeout }, value);
}

async function waitForPath(page, suffix) {
  await page.waitForFunction((expected) => location.pathname.endsWith(expected), { timeout: 45_000 }, suffix);
}

async function screenshot(page, name, frame = null) {
  assert(frame === null || (typeof frame === 'string' && frame.length > 0), 'Screenshot frame must be a selector or null');
  if (screenshots.has(name)) return;
  screenshots.add(name);
  if (qa) return qa.capture(page, name, { allowTransient: /reconnecting/.test(name), frame, align: frame ? 'start' : 'center' });
  await page.evaluate(() => document.fonts.ready);
  await delay(150);
  await page.screenshot({ path: path.join(outputDir, name), fullPage: false });
}

async function captureMatrix(player, label, frame = null) {
  if (!qa || coverage.has('matrix:' + label)) return;
  const original = player.page.viewport();
  try {
    for (const [width, height] of MATRIX) {
      await resize(player.page, width, height);
      await qa.capture(player.page, label + '-' + width + 'x' + height + '.png', { frame });
    }
    for (const width of [375, 1280]) {
      await resize(player.page, width, 844);
      await qa.capture(player.page, label + '-' + width + '-text200.png', { frame, scale: true });
    }
    coverage.add('matrix:' + label);
  } finally { await player.page.setViewport(original); }
}

async function captureRailEnds(player, id) {
  if (!qa) return;
  const original = player.page.viewport();
  try {
    await resize(player.page, 375, 844);
    const saved = await player.page.evaluate(sectionId => {
      const section = document.getElementById(sectionId)?.parentElement;
      return [...(section?.querySelectorAll('*') ?? [])].filter(n => ['auto', 'scroll'].includes(getComputedStyle(n).overflowX) && n.scrollWidth > n.clientWidth + 1)
        .map((n, index) => { n.dataset.notAloneQaRail = sectionId + '-' + index; return { key: n.dataset.notAloneQaRail, left: n.scrollLeft }; });
    }, id);
    try {
      for (const rail of saved) for (const end of ['start', 'end']) {
        const selector = '[data-not-alone-qa-rail="' + rail.key + '"]';
        await player.page.$eval(selector, (n, destination) => { n.scrollLeft = destination === 'start' ? 0 : n.scrollWidth; }, end);
        await qa.capture(player.page, player.name + '-' + rail.key + '-' + end + '.png', { frame: selector });
      }
      if (!saved.length) qa.evidence.gaps.push(player.name + ': no horizontal rail mounted in ' + id);
    } finally {
      await player.page.evaluate(items => { for (const item of items) { const n = document.querySelector('[data-not-alone-qa-rail="' + item.key + '"]'); if (n) { n.scrollLeft = item.left; delete n.dataset.notAloneQaRail; } } }, saved);
      qa.persist();
    }
  } finally { await player.page.setViewport(original); }
}

async function scrollMain(page, destination = 'top') {
  await page.evaluate((target) => {
    const scrolling = [...document.querySelectorAll('*')]
      .filter((element) => element.scrollHeight > element.clientHeight + 20)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
    if (target === 'decision') document.getElementById('not-alone-decision-heading')?.scrollIntoView({ block: 'start' });
    else {
      window.scrollTo(0, 0);
      if (scrolling) scrolling.scrollTop = 0;
    }
  }, destination);
  await delay(120);
}

async function assertNoHorizontalOverflow(player) {
  const widths = await player.page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1,
    `${player.name} has horizontal overflow: ${JSON.stringify(widths)}`);
}

async function assertVisibleTouchTargets(player) {
  const undersized = (await visibleButtonData(player.page)).filter((button) => button.width < 48 || button.height < 48);
  assert(undersized.length === 0, `${player.name} has undersized controls: ${JSON.stringify(undersized)}`);
}

function socketPacket(data) {
  if (typeof data !== 'string' || !data.startsWith('42')) return null;
  try {
    const packet = JSON.parse(data.slice(2));
    return Array.isArray(packet) && typeof packet[0] === 'string' ? packet : null;
  } catch {
    return null;
  }
}

async function openPlayer(browser, name, width, height, reduceMotion = false) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const player = {
    name,
    width,
    height,
    context,
    page,
    left: false,
    intentionalOffline: false,
    latestPublic: null,
    latestPrivate: null,
    publicFrames: 0,
    privateFrames: 0,
    acceptedActions: [],
    sentActions: [],
    sentPackets: [],
    rejections: [],
  };
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: Boolean(qa) && width < 768, hasTouch: Boolean(qa) && width < 768 });
  if (qa) {
    qa.register(player);
    await guardNetwork(page, qa.origins, qa.evidence.blockedRequests);
    page.on('response', async response => {
      try {
        const url = new URL(response.url());
        if (!qa.origins.has(url.origin)) return;
        if (/\/rooms(?:\/join)?$/.test(url.pathname) && response.ok()) {
          const result = await response.json();
          const auth = result.auth ?? result;
          if (auth.token) { qa.secrets.add(auth.token); player.auth = auth; }
        }
        if (/\/rooms\/[^/]+\/leave$/.test(url.pathname)) {
          qa.evidence.cleanup.push({ actor: name, status: response.status(), normalUI: !player.fallbackCleanup });
          qa.persist();
        }
      } catch {}
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
    const packet = socketPacket(response.payloadData);
    if (!packet) return;
    if (packet[0] === 'notalone:action_accepted' && typeof packet[1]?.action === 'string') {
      player.acceptedActions.push(packet[1]);
      player.lastAcceptedAt = Date.now();
    }
    if (packet[0] === 'room_updated') player.room = packet[1];
    if (packet[0] === 'action_rejected') player.rejections.push(packet[1]);
    if (packet[0] === 'game_state' && packet[1]?.gameId === 'not_alone') {
      player.latestPublic = packet[1];
      player.publicFrames += 1;
    }
    if (packet[0] === 'private_state' && packet[1]?.gameId === 'not_alone') {
      player.latestPrivate = packet[1];
      player.privateFrames += 1;
    }
  });
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    const packet = socketPacket(response.payloadData);
    if (packet?.[0]?.startsWith('notalone:')) {
      player.sentActions.push(packet[0]);
      player.sentPackets.push(packet);
    }
  });
  player.cdp = cdp;
  return player;
}

async function exerciseFocusAndLanding(host) {
  await resize(host.page, 320, 780);
  await host.page.goto(`${BASE_URL}/not-alone`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForText(host.page, 'OPEN A SIGNAL');
  await host.page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await waitUntil(async () => {
    await host.page.keyboard.press('Tab');
    return host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Your name');
  }, 'real Tab reaches the name field', 6_000);
  await waitUntil(() => host.page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.matches(':focus-visible')) return false;
    const style = getComputedStyle(active);
    return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 3;
  }), 'visible keyboard focus ring', 6_000);
  const focusEvidence = await host.page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const computed = getComputedStyle(active);
    const matchingRules = [];
    const focusRules = [];
    for (const sheet of [...document.styleSheets]) {
      try {
        const visit = (rules) => {
          for (const rule of [...rules]) {
            if (rule.cssText.includes(':focus-visible')) focusRules.push({ href: sheet.href, text: rule.cssText });
            if (rule instanceof CSSStyleRule && rule.style.cssText.includes('outline')) {
              try {
                if (active.matches(rule.selectorText)) matchingRules.push({ href: sheet.href, selector: rule.selectorText, declarations: rule.style.cssText });
              } catch {
                // Ignore selectors that this browser cannot evaluate.
              }
            }
            if ('cssRules' in rule && rule.cssRules) visit(rule.cssRules);
          }
        };
        visit(sheet.cssRules);
      } catch {
        // Cross-origin style sheets are reported separately by linkedStyleSheets.
      }
    }
    return {
      label: active.getAttribute('aria-label'),
      matchesFocus: active.matches(':focus'),
      matchesFocusVisible: active.matches(':focus-visible'),
      computed: {
        outlineStyle: computed.outlineStyle,
        outlineWidth: computed.outlineWidth,
        outlineColor: computed.outlineColor,
        outlineOffset: computed.outlineOffset,
        backgroundColor: computed.backgroundColor,
      },
      matchingRules,
      focusRules,
      linkedStyleSheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.href),
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    };
  });
  assert(focusEvidence?.matchesFocusVisible, `Focused input did not match :focus-visible: ${JSON.stringify(focusEvidence)}`);
  assert(focusEvidence.focusRules.some(({ text }) => (text.includes('#f7faff') || text.includes('rgb(247, 250, 255)')) && text.includes('3px')),
    `Authored focus rule was not loaded: ${JSON.stringify(focusEvidence)}`);
  assert(focusEvidence.matchingRules.some(({ declarations }) => declarations.includes('rgb(247, 250, 255)') && declarations.includes('3px')),
    `Authored focus rule did not match the input: ${JSON.stringify(focusEvidence)}`);
  assert(focusEvidence.computed.outlineStyle !== 'none' && Number.parseFloat(focusEvidence.computed.outlineWidth) >= 3,
    `Computed focus ring is not visible: ${JSON.stringify(focusEvidence)}`);
  writeReceipt('focus-evidence.json', focusEvidence);
  await screenshot(host.page, '00-keyboard-focus-320.png');

  await resize(host.page, 320, 780);
  await clickButton(host.page, /^HOW TO PLAY$/);
  await waitForText(host.page, 'Original 2016 base game');
  await resize(host.page, 320, 780);
  await waitUntil(() => host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Close rules'), 'rules dialog receives focus');
  const rulesSemantics = await host.page.evaluate(() => {
    const panel = document.getElementById('rules-reference-sheet');
    return panel ? { role: panel.getAttribute('role'), modal: panel.getAttribute('aria-modal'), label: panel.getAttribute('aria-label') } : null;
  });
  assert(rulesSemantics?.role === 'dialog' && rulesSemantics.modal === 'true', `Rules dialog semantics are wrong: ${JSON.stringify(rulesSemantics)}`);
  if (qa) await qa.capture(host.page, '01-rules-320-text200.png', { scale: true, frame: '#rules-reference-sheet' });
  else await screenshot(host.page, '01-rules-320.png');
  await assertNoHorizontalOverflow(host);
  await host.page.keyboard.press('Escape');
  await waitUntil(() => host.page.evaluate(() => !document.getElementById('rules-reference-sheet')), 'Escape closes rules');

  await resize(host.page, 320, 780);
  await setInput(host.page, 'Your name', '');
  await clickButton(host.page, /^CREATE ROOM$/);
  await waitForText(host.page, 'Enter the name other players will see.');
  await screenshot(host.page, '02-create-validation-320.png');
  await assertNoHorizontalOverflow(host);
  await assertVisibleTouchTargets(host);
  await setInput(host.page, 'Your name', 'Keyboard Scout');
  await host.page.keyboard.press('Enter');
  await waitUntil(() => host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Room password, optional'), 'landing Enter moves to password');
  assert(await host.page.evaluate(() => document.activeElement?.getAttribute('type') === 'password'), 'Landing password is not a secure web input');

  await host.page.goto(`${BASE_URL}/not-alone/join`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForText(host.page, 'FIND THE SIGNAL');
  await setInput(host.page, 'Your name', 'Keyboard Scout');
  await host.page.keyboard.press('Enter');
  await waitUntil(() => host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Room code'), 'join Enter moves from name to code');
  await host.page.keyboard.type('ABCD1234');
  await host.page.keyboard.press('Enter');
  await waitUntil(() => host.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Room password, optional'), 'join Enter moves from code to password');
  assert(await host.page.evaluate(() => document.activeElement?.getAttribute('type') === 'password'), 'Join password is not a secure web input');
  await screenshot(host.page, '02a-join-keyboard-320.png');
  await host.page.goto(`${BASE_URL}/not-alone`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForText(host.page, 'OPEN A SIGNAL');
  await resize(host.page, 1280, 820);
  await screenshot(host.page, '02b-landing-wide-1280.png');
  await captureMatrix(host, 'entrance');
  await assertNoHorizontalOverflow(host);
  await assertVisibleTouchTargets(host);
  coverage.add('keyboard_focus');
  coverage.add('keyboard_enter_flow');
  coverage.add('rules_dialog');
  coverage.add('landing_validation');
  return focusEvidence;
}

async function roomCodeFromLobby(page) {
  const label = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')]
    .map((element) => element.getAttribute('aria-label'))
    .find((value) => value?.startsWith('Room code ')) ?? null);
  const roomCode = label?.slice('Room code '.length) ?? null;
  assert(roomCode && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(roomCode), `Invalid room code label: ${label}`);
  return roomCode;
}

async function removeExpectedHttpIssue(playerName, status) {
  await delay(100);
  const index = consoleIssues.findIndex((issue) => issue.player === playerName
    && issue.type === 'error' && issue.text === `Failed to load resource: the server responded with a status of ${status}`);
  if (index >= 0) consoleIssues.splice(index, 1);
}

async function joinPlayer(player, roomCode, password, options = {}) {
  await player.page.goto(`${BASE_URL}/not-alone/join`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await setInput(player.page, 'Your name', player.name);
  if (options.validation) {
    await setInput(player.page, 'Room code', 'BAD');
    await clickButton(player.page, /^JOIN GAME$/);
    await waitForText(player.page, 'Enter a valid room code');
    await screenshot(player.page, '04-join-validation-360.png');
    coverage.add('join_validation');
  }
  await setInput(player.page, 'Room code', roomCode);
  if (options.wrongPassword) {
    await setInput(player.page, 'Room password, optional', 'wrong-signal');
    await clickButton(player.page, /^JOIN GAME$/);
    await waitForText(player.page, 'Wrong password');
    await removeExpectedHttpIssue(player.name, '403 (Forbidden)');
    await screenshot(player.page, '05-wrong-password-360.png');
    coverage.add('wrong_password');
  }
  await setInput(player.page, 'Room password, optional', password);
  await clickButton(player.page, /^JOIN GAME$/);
  await waitForPath(player.page, '/not-alone/lobby');
}

async function waitForPairedState(player, timeout = 45_000) {
  await waitUntil(() => player.latestPublic && player.latestPrivate
    && player.latestPublic.revision === player.latestPrivate.revision, `${player.name} paired private/public state`, timeout);
  return { publicState: player.latestPublic, privateState: player.latestPrivate };
}

async function submitAndWait(player, submit, label) {
  const before = player.latestPrivate?.revision ?? -1;
  const rejectionsBefore = player.rejections.length;
  await submit();
  await waitUntil(() => player.rejections.length > rejectionsBefore || (player.latestPublic && player.latestPrivate
    && player.latestPublic.revision === player.latestPrivate.revision
    && (player.latestPublic.revision > before || player.latestPublic.status === 'game_over')),
  `${player.name} state after ${label}`);
  if (player.rejections.length > rejectionsBefore) {
    const rejection = player.rejections.at(-1);
    const sent = player.sentPackets.at(-1);
    throw new Error(`${player.name} ${label} rejected: ${JSON.stringify({ rejection, sent, before })}`);
  }
  await waitUntil(async () => !(await bodyText(player.page)).includes('Updating the table…'), `${player.name} UI settles after ${label}`);
}

async function clickDialogButton(page, label) {
  await waitUntil(() => page.evaluate((expected) => {
    const dialog = document.getElementById('arcade-dialog');
    return Boolean(dialog && [...dialog.querySelectorAll('[role="button"][aria-label]')]
      .some((button) => button.getAttribute('aria-label') === expected));
  }, label), `dialog button ${label}`);
  const clicked = await page.evaluate((expected) => {
    const dialog = document.getElementById('arcade-dialog');
    const button = dialog && [...dialog.querySelectorAll('[role="button"][aria-label]')]
      .find((candidate) => candidate.getAttribute('aria-label') === expected);
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  }, label);
  assert(clicked, `Could not click dialog button ${label}`);
  await delay(120);
}

function livePlayers(players) {
  return players.filter((player) => !player.left && player.page.url().includes('/not-alone/game'));
}

function observePhase(player) {
  const phase = player.latestPublic?.phase;
  if (phase) coverage.add(`phase:${phase}`);
}

function expectedArtemiaAvailable(state) {
  if (state.rescueProgress >= state.rescueGoal) return false;
  if (state.boardFace === 'continuous') return state.rescueProgress >= state.rescueGoal - 6;
  const firstAlternatingSpace = state.rescueGoal - 11;
  return state.rescueProgress >= firstAlternatingSpace
    && (state.rescueProgress - firstAlternatingSpace) % 2 === 0;
}

function checkArtemiaRound(state, previous = null) {
  assert(Number.isSafeInteger(state.roundNumber) && state.roundNumber > 0, 'Artemia observation requires a valid round');
  assert(typeof state.artemiaAvailable === 'boolean', 'Artemia availability must be boolean');
  assert(['continuous', 'alternating'].includes(state.boardFace), 'Unknown Artemia board face');
  if (previous) {
    assert(state.roomCode === previous.roomCode && state.boardFace === previous.boardFace && state.rescueGoal === previous.rescueGoal,
      'Artemia board identity changed within a match');
    if (state.roundNumber === previous.roundNumber) {
      assert(state.artemiaAvailable === previous.available, 'Artemia availability changed within the round');
      return previous;
    }
    assert(state.roundNumber === previous.roundNumber + 1, 'Artemia observation skipped or reversed a round');
  }
  assert(state.status === 'playing' && state.phase === 'hunted_planning', 'Artemia observation missed the new-round baseline');
  assert(state.artemiaAvailable === expectedArtemiaAvailable(state),
    `${state.boardFace} face projected the wrong initial Artemia status at Rescue ${state.rescueProgress}/${state.rescueGoal}`);
  return Object.freeze({ roomCode: state.roomCode, roundNumber: state.roundNumber, boardFace: state.boardFace,
    rescueGoal: state.rescueGoal, startRescueProgress: state.rescueProgress, available: state.artemiaAvailable, revision: state.revision });
}

async function observeBoardStatus(player, previous, matchNumber) {
  const state = player.latestPublic;
  if (!state) return previous;
  if (qa) qa.evidence.lastBoardObservation = { match: matchNumber, round: state.roundNumber, phase: state.phase,
    revision: state.revision, rescueProgress: state.rescueProgress, rescueGoal: state.rescueGoal,
    boardFace: state.boardFace, artemiaAvailable: state.artemiaAvailable };
  const observed = checkArtemiaRound(state, previous);
  if (qa && observed !== previous) {
    (qa.evidence.artemiaRoundBaselines ??= []).push({ match: matchNumber, ...observed }); qa.persist();
  }
  if (state.status === 'game_over') {
    await waitForText(player.page, `FINAL ROUND · ARTEMIA WAS ${state.artemiaAvailable ? 'ACTIVE' : 'INACTIVE'}`);
    return observed;
  }
  const status = state.artemiaAvailable ? 'ACTIVE THIS ROUND' : 'INACTIVE THIS ROUND';
  const key = `artemia-status:${state.boardFace}:${state.artemiaAvailable ? 'active' : 'inactive'}`;
  if (coverage.has(key)) return observed;
  await waitForText(player.page, `${state.boardFace === 'continuous' ? 'CONTINUOUS' : 'ALTERNATING'} FACE`);
  await waitForText(player.page, `ARTEMIA · ${status}`);
  const accessible = await player.page.evaluate((face, active) => [...document.querySelectorAll('[aria-label]')]
    .some((element) => element.getAttribute('aria-label')?.includes(`${face} FACE. Artemia is ${active ? 'active' : 'inactive'} this round.`)),
  state.boardFace === 'continuous' ? 'CONTINUOUS' : 'ALTERNATING', state.artemiaAvailable);
  assert(accessible, `${state.boardFace} Artemia status was not exposed to assistive technology`);
  coverage.add(key);
  return observed;
}

async function assertHiddenDestinations(players) {
  for (const viewer of livePlayers(players)) {
    const { publicState, privateState } = await waitForPairedState(viewer);
    assert(!JSON.stringify(publicState).includes('selectedPlaces'), `${viewer.name} public projection contains selectedPlaces`);
    assert(publicState.players.every((player) => player.revealedPlaces.length === 0), `${viewer.name} saw a destination before reveal`);
    assert(publicState.players.every((player) => player.originalRevealedPlaces.length === 0), `${viewer.name} saw an original physical Place before reveal`);
    if (privateState.role === 'creature') {
      assert(privateState.placeHand.length === 0 && privateState.selectedPlaces.length === 0,
        'Creature private projection contains a Hunted Place hand or destination');
    } else {
      assert(Object.keys(privateState.revealedHuntedHands).length === 0,
        `${viewer.name} received Creature-only Phobia intelligence`);
    }
  }
  privateLeakChecks.push({ round: players[0]?.latestPublic?.roundNumber ?? null, viewers: livePlayers(players).length, passed: true });
  coverage.add('hidden_destinations');
}

async function assertPublicTrails(players) {
  for (const viewer of livePlayers(players)) {
    await waitForPairedState(viewer);
    for (const hunted of viewer.latestPublic.players.filter((player) => player.role === 'hunted')) {
      const trail = await viewer.page.$eval(`#not-alone-trail-${hunted.playerId}`, (element) => element.textContent);
      if (hunted.discard.length) {
        const visibleIds = [...trail.matchAll(/#(\d+) /g)].map((match) => Number(match[1]));
        assert(JSON.stringify(visibleIds) === JSON.stringify(hunted.discard), `${viewer.name} public trail differs from their authorised projection`);
      } else {
        assert(trail === (hunted.discardCount > 0 ? 'Hidden by Smokescreen this round.' : 'No discarded Places.'),
          `${viewer.name} empty/redacted public trail is misleading`);
      }
    }
  }
  coverage.add('public_discard_trails');
}

async function clickPlace(page, placeId) {
  await clickButton(page, new RegExp(`^Place ${placeId},`));
}

function commonAvailablePlaces(players) {
  const hunted = livePlayers(players).filter((player) => player.latestPrivate?.role === 'hunted');
  if (!hunted.length) return [];
  const blocked = new Set(hunted[0].latestPublic?.selectionBlockedPlaces ?? []);
  return hunted[0].latestPrivate.placeHand.filter((place) => !blocked.has(place)
    && hunted.every((player) => player.latestPrivate.placeHand.includes(place)));
}

function desiredExplorationPlaces(player, players, strategy, plans) {
  const state = player.latestPublic;
  const mine = player.latestPrivate;
  const key = `${state.roundNumber}:${strategy}`;
  const blocked = new Set(state.selectionBlockedPlaces);
  const available = mine.placeHand.filter((place) => !blocked.has(place));
  if (strategy === 'escape' && state.roundNumber <= 7) {
    const earlyRoute = [5, 7, 1, 3, 5, 10, 1];
    const destination = earlyRoute[state.roundNumber - 1];
    return [destination, ...available.filter((place) => place !== destination)]
      .filter((place) => available.includes(place)).slice(0, mine.requiredSelectionCount);
  }
  if (!plans.has(key)) {
    const common = commonAvailablePlaces(players);
    const priorities = strategy === 'escape'
      ? state.roundNumber === 1 ? [3, 1, 2, 4, 5]
        : state.roundNumber === 2 ? [1, 2, 4, 5, 3]
          : state.roundNumber === 3 ? [5, 1, 2, 4, 3]
            : state.roundNumber === 4 ? [10, 1, 2, 4, 3, 5]
              : [10, 8, 4, 3, 5, 1, 2, 6, 7, 9]
      : [1, 2, 3, 4, 5, 10, 8, 6, 7, 9];
    const ordered = [...priorities.filter((place) => common.includes(place)), ...common.filter((place) => !priorities.includes(place))];
    plans.set(key, ordered.slice(0, Math.max(1, mine.requiredSelectionCount)));
  }
  const shared = plans.get(key).filter((place) => available.includes(place));
  const choices = [...shared, ...available.filter((place) => !shared.includes(place))].slice(0, mine.requiredSelectionCount);
  return choices;
}

function creatureDestination(players, strategy) {
  const huntedSelections = livePlayers(players)
    .filter((player) => player.latestPrivate?.role === 'hunted')
    .flatMap((player) => player.latestPrivate.selectedPlaces ?? []);
  if (strategy === 'catch') return huntedSelections[0] ?? 1;
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((place) => !huntedSelections.includes(place)) ?? 1;
}

function requiredTokenPlaceCount(state, token) {
  if (token === 'creature') return 1;
  const effective = state.effectiveHuntCardIds ?? [];
  if (token === 'target' && effective.some((cardId) => cardId === 'force_field' || cardId === 'mirage')) return 2;
  if (token === 'artemia' && effective.includes('virus')) return 2;
  return 1;
}

function adjacentPlacePair(placeId) {
  const candidates = placeId === 10 ? [10, 9] : [placeId, placeId + 1];
  const row = (place) => place <= 5 ? 0 : 1;
  return row(candidates[0]) === row(candidates[1]) ? candidates : [placeId, placeId - 1];
}

async function placeHuntToken(player, token, placeId) {
  const openLabel = token === 'creature' ? /^PLACE CREATURE$/ : token === 'target' ? /^PLACE TARGET$/ : /^PLACE ARTEMIA$/;
  await clickButton(player.page, openLabel);
  const places = requiredTokenPlaceCount(player.latestPublic, token) === 2 ? adjacentPlacePair(placeId) : [placeId];
  for (const place of places) await clickPlace(player.page, place);
  await submitAndWait(player, () => clickButton(player.page, new RegExp(`^PLACE ${token.toUpperCase()} TOKEN$`)), `place ${token} token`);
  coverage.add(`token:${token}`);
}

function chooseHuntCard(mine, state) {
  const playable = mine.playableHuntCardIds ?? [];
  if (!playable.length) return null;
  const lateInHand = mine.huntHand.filter((cardId) => lateHuntCards.has(cardId));
  const endInHand = mine.huntHand.filter((cardId) => endHuntCards.has(cardId));
  if (!coverage.has('late_hunt') && lateInHand.length) {
    if (state.phase !== 'reckoning') return null;
    return lateInHand.find((cardId) => playable.includes(cardId)) ?? playable[0];
  }
  if (!coverage.has('end_hunt') && endInHand.length) {
    if (state.phase !== 'end_of_turn') return null;
    return endInHand.find((cardId) => playable.includes(cardId)) ?? playable[0];
  }
  return playable.find((cardId) => cardId !== 'flashback') ?? playable[0];
}

async function playHuntCard(player, cardId, matchNumber) {
  const mine = player.latestPrivate;
  const state = player.latestPublic;
  const effect = cardId === 'flashback' ? mine.lastDiscardedHuntCard : cardId;
  const cardName = titleCaseCard(cardId);
  const cardButton = new RegExp(`^${escapedPattern(cardName)} · P`);
  const needsForm = ['anticipation', 'ascendancy', 'phobia', 'detour', 'cataclysm', 'force_field'].includes(effect);
  let detourOption = null;

  if (!needsForm) {
    await submitAndWait(player, () => clickButton(player.page, cardButton), `play ${cardName}`);
  } else {
    await clickButton(player.page, cardButton);
    if (['anticipation', 'ascendancy', 'phobia', 'detour'].includes(effect)) {
      const targetIds = effect === 'ascendancy'
        ? mine.huntOptions.ascendancyTargetPlayerIds
        : effect === 'phobia'
          ? mine.huntOptions.phobiaTargetPlayerIds
          : effect === 'detour'
            ? [...new Set(mine.huntOptions.detourOptions.map((candidate) => candidate.playerId))]
            : mine.huntOptions.targetPlayerIds;
      const targetId = targetIds[0];
      const target = state.players.find((candidate) => candidate.playerId === targetId);
      assert(target, `${cardName} has no projected Hunted target`);
      await clickButton(player.page, new RegExp(`^${escapedPattern(target.displayName.toUpperCase())}$`));
      if (effect === 'detour') {
        detourOption = mine.huntOptions.detourOptions.find((candidate) => candidate.playerId === targetId);
        assert(detourOption, 'Detour has no projected physical-slot option');
        await clickButton(player.page, new RegExp(`^MOVE SLOT ${detourOption.placeIndex + 1} · CURRENT ${detourOption.originPlaceId} `));
        await clickPlace(player.page, detourOption.destinationPlaceIds[0]);
        coverage.add('detour_slot_identity');
      }
    } else if (effect === 'cataclysm') {
      const place = mine.huntOptions.cataclysmPlaceIds[0];
      assert(place, 'Playable Cataclysm has no projected meaningful target');
      await clickPlace(player.page, place);
    } else {
      for (const place of [1, 2]) await clickPlace(player.page, place);
    }
    await submitAndWait(player, () => clickButton(player.page, new RegExp(`^CONFIRM ${escapedPattern(cardName.toUpperCase())}$`)), `confirm ${cardName}`);
  }

  coverage.add(`hunt-card:${cardId}`);
  if (effect === 'mirage') coverage.add(state.huntTokens.target.length ? 'mirage:reuse-target' : 'mirage:immediate-no-footprint');
  if (effect === 'anticipation') {
    assert(player.latestPublic.anticipationTargetPlayerId, 'Anticipation target was not retained in the public projection');
    await waitForText(player.page, 'ANTICIPATION TARGET');
    coverage.add('anticipation:public-target');
  }
  if (detourOption) {
    const projected = player.latestPublic.players.find((candidate) => candidate.playerId === detourOption.playerId);
    assert(projected?.originalRevealedPlaces[detourOption.placeIndex] === detourOption.originPlaceId,
      'Detour original physical slot was not projected after reveal');
    assert(projected.revealedPlaces[detourOption.placeIndex] === detourOption.destinationPlaceIds[0],
      'Detour current destination did not match the selected projected destination');
    await waitForText(player.page, `SLOT ${detourOption.placeIndex + 1} #${detourOption.originPlaceId}→#${detourOption.destinationPlaceIds[0]}`);
    coverage.add('persistent_moved_trace');
  }
  if (state.phase === 'reckoning' && lateHuntCards.has(effect)) {
    coverage.add('late_hunt');
    await screenshot(player.page, `13-match-${matchNumber}-late-${effect}-reaction-${player.width}.png`);
  }
  if (state.phase === 'end_of_turn' && endHuntCards.has(effect)) {
    coverage.add('end_hunt');
    await screenshot(player.page, `13-match-${matchNumber}-end-${effect}-reaction-${player.width}.png`);
  }
}

async function chooseResolution(player, matchNumber, strategy, ownPlan = null) {
  const options = player.latestPrivate.resolutionOptions;
  assert(options, `${player.name} can resolve without projected options`);
  coverage.add(`resolution-stage:${options.stage}`);
  if (options.effectivePlaceId !== options.placeId) coverage.add('moved_or_copied_place');

  const useSpecialPower = ownPlan ? ownPlan.resolution.usePower : strategy === 'escape'
    && options.canUsePlacePower
    && ([3, 5, 10].includes(options.effectivePlaceId)
      || (options.effectivePlaceId === 7 && !coverage.has('shelter_choice_reload')));
  const chooseProjectedHazards = async () => {
    if (options.canLoseWillForScream) {
      await clickButton(player.page, /^LOSE 1 WILL$/);
      coverage.add('atomic-scream-choice');
    } else if (options.screamDiscardCount > 0) {
      await clickButton(player.page, new RegExp(`^DISCARD ${options.screamDiscardCount} PLACES$`));
      for (const place of options.screamDiscardPlaceIds.slice(0, options.screamDiscardCount)) await clickPlace(player.page, place);
      coverage.add('atomic-scream-choice');
    }
    if (options.toxinSurvivalCardIds.length) {
      await clickButton(player.page, new RegExp(`^${escapedPattern(titleCaseCard(options.toxinSurvivalCardIds[0]).toUpperCase())}$`));
      coverage.add('atomic-toxin-choice');
    }
    if ((options.canLoseWillForScream || options.screamDiscardCount > 0) && options.toxinSurvivalCardIds.length) {
      coverage.add('stacked-scream-toxin');
      await screenshot(player.page, `14-match-${matchNumber}-stacked-scream-toxin-${player.width}.png`);
    }
  };
  if (!useSpecialPower && options.canRecoverPlace) {
    await clickButton(player.page, options.recoverCount ? /^RECOVER ONE PLACE$/ : /^SKIP PLACE POWER$/);
    await chooseProjectedHazards();
    if (options.recoverCount) await clickPlace(player.page, options.recoverablePlaceIds[0]);
    await submitAndWait(player, () => clickButton(player.page, /^CONFIRM RESOLUTION$/), 'recover instead of Place power');
    coverage.add('recover');
    return;
  }

  if (!options.canUsePlacePower) {
    await clickButton(player.page, /^RESOLVE INTERCEPTION$/);
    await chooseProjectedHazards();
    await submitAndWait(player, () => clickButton(player.page, /^CONTINUE RECKONING$/), 'resolve interception');
    coverage.add('interception');
    return;
  }

  await clickButton(player.page, /^USE PLACE POWER$/);
  await chooseProjectedHazards();
  const place = options.effectivePlaceId;
  if (place === 1) {
    await clickButton(player.page, /^RECOVER (?:NO|\d+) DISCARDED$/);
    for (const recover of options.powerRecoverablePlaceIds.slice(0, options.powerRecoveryCount)) await clickPlace(player.page, recover);
  } else if (place === 2 || place === 6) {
    const persecutionChoice = options.canReturnPlayedPlace && player.latestPublic.effectiveHuntCardIds.includes('persecution');
    if (persecutionChoice) {
      const returnedName = options.returnablePlayedPlaceId === 2 ? 'THE JUNGLE' : 'THE SWAMP';
      await clickButton(player.page, new RegExp(`^RETURN PLAYED ${returnedName}$`));
      coverage.add('persecution:return-played-choice');
    } else {
      for (const recover of options.powerRecoverablePlaceIds.slice(0, options.powerRecoveryCount)) await clickPlace(player.page, recover);
    }
  } else if (place === 4) {
    await clickButton(player.page, options.beachChoices.includes('launch') ? /^LAUNCH · \+1 RESCUE$/ : /^CHARGE BEACON$/);
  } else if (place === 5) {
    const rover = ownPlan ? ownPlan.resolution.rover : !coverage.has('shelter_choice_reload') && options.roverPlaceIds.includes(7)
      ? 7
      : options.roverPlaceIds.includes(10) ? 10 : options.roverPlaceIds[0];
    assert(rover, 'Rover power has no projected advanced Place choice');
    await clickPlace(player.page, rover);
    if (rover === 7) coverage.add('shelter_card_acquired');
  } else if (place === 9) {
    if (options.sourceChoices.includes('card')) await clickButton(player.page, /^DRAW SURVIVAL CARD$/);
    else {
      await clickButton(player.page, /^RESTORE 1 WILL$/);
      const target = options.healTargetPlayerIds[0];
      const displayName = player.latestPublic.players.find((candidate) => candidate.playerId === target)?.displayName;
      assert(displayName, 'Source Will choice has no projected target name');
      await clickButton(player.page, new RegExp(`^${escapedPattern(displayName.toUpperCase())}$`));
    }
  }
  if ([3, 5, 10].includes(place)) await screenshot(player.page, `14-match-${matchNumber}-place-${place}-power-${player.width}.png`, '#not-alone-decision-area');
  await submitAndWait(player, () => clickButton(player.page, /^CONFIRM RESOLUTION$/), `resolve Place ${place} power`);
  coverage.add(`place-power:${place}`);
}

async function performOneAction(players, matchNumber, strategy, plans) {
  const orderedPlayers = [...livePlayers(players)].sort((left, right) =>
    Number(Boolean(right.latestPrivate?.cardChoice)) - Number(Boolean(left.latestPrivate?.cardChoice)));
  for (const player of orderedPlayers) {
    await waitForPairedState(player);
    observePhase(player);
    const state = player.latestPublic;
    const mine = player.latestPrivate;
    if (state.status === 'game_over') continue;
    const ownPlan = strategy === 'own-view' ? ownViewPolicy(state, mine) : null;

    if (!coverage.has('private_hand_navigation') && await hasButton(player.page, /^VIEW \d+ PLAYABLE (?:HUNT|SURVIVAL) CARDS?$/)) {
      await clickButton(player.page, /^VIEW \d+ PLAYABLE (?:HUNT|SURVIVAL) CARDS?$/);
      assert(await player.page.evaluate(() => document.activeElement?.id === 'not-alone-private-hand'), 'Hand shortcut did not move keyboard focus');
      await screenshot(player.page, `11-private-hand-navigation-${player.width}.png`);
      await clickButton(player.page, /^RETURN TO CURRENT DECISION$/);
      assert(await player.page.evaluate(() => document.activeElement?.id === 'not-alone-decision-heading'), 'Return shortcut did not restore decision focus');
      coverage.add('private_hand_navigation');
    }
    if (mine.role === 'creature' && state.phase === 'creature_planning' && state.roundNumber > 1
      && !state.pendingCardChoice && !coverage.has('public_trail_navigation')) {
      await clickButton(player.page, /^STUDY PUBLIC DISCARD TRAILS$/);
      assert(await player.page.evaluate(() => document.activeElement?.id === 'not-alone-public-trails'), 'Trail shortcut did not move keyboard focus');
      const originalViewport = player.page.viewport();
      for (const width of [320, 1280]) {
        await resize(player.page, width, 820);
        await screenshot(player.page, `11-public-discard-trails-${width}.png`, '#not-alone-public-trails');
        await assertNoHorizontalOverflow(player);
      }
      if (originalViewport) await player.page.setViewport(originalViewport);
      await clickButton(player.page, /^RETURN TO CURRENT DECISION$/);
      coverage.add('public_trail_navigation');
    }

    if (state.pendingCardChoice) {
      const labels = (await visibleButtonData(player.page, false)).map((button) => button.label);
      const conflicting = labels.filter((label) => /^(?:PLACE (?:CREATURE|TARGET|ARTEMIA)|(?:CREATURE|TARGET|ARTEMIA) ·|LOCK HUNT POSITIONS|REVEAL DESTINATIONS|PASS REACTION|ADVANCE RECKONING|FINISH ROUND|USE PLACE POWER|RECOVER ONE PLACE|SKIP PLACE POWER|RESOLVE INTERCEPTION|CONFIRM RESOLUTION|CONTINUE RECKONING)/.test(label));
      assert(conflicting.length === 0,
        `${player.name} saw underlying action controls during ${state.pendingCardChoice.kind}: ${JSON.stringify(conflicting)}`);
      coverage.add('pending_card_choice_exclusive');
      if (!mine.cardChoice) continue;
    }

    if (mine.cardChoice) {
      const count = mine.cardChoice.count;
      if (mine.cardChoice.kind === 'artefact_order') {
        for (const placeIndex of ownPlan?.cardChoiceIndexes ?? mine.cardChoice.placeIndexes.slice(0, count)) {
          await clickButton(player.page, new RegExp(`^SLOT ${placeIndex + 1} ·`));
        }
      } else {
        for (const place of ownPlan?.cardChoicePlaces ?? mine.cardChoice.placeOptions.slice(0, count)) await clickPlace(player.page, place);
      }
      const label = mine.cardChoice.kind === 'phobia'
        ? new RegExp(`^KEEP ${count} HIDDEN$`)
        : mine.cardChoice.kind === 'artefact_order'
          ? /^CONFIRM ARTEFACT ORDER$/
          : mine.cardChoice.kind === 'forbidden_zone' ? /^SEAL PRIVATE DISCARD$/ : new RegExp(`^DISCARD ${count}$`);
      await submitAndWait(player, () => clickButton(player.page, label), `resolve ${mine.cardChoice.kind}`);
      coverage.add(`card-choice:${mine.cardChoice.kind}`);
      if (mine.cardChoice.kind === 'forbidden_zone' && player.latestPublic.pendingCardChoice?.kind === 'forbidden_zone') {
        assert(player.latestPrivate.cardChoiceSubmitted === true, 'Forbidden Zone did not project this viewer\'s sealed submission');
        const pending = player.latestPublic.pendingCardChoice;
        assert(pending.submittedCount > 0 && pending.submittedCount < pending.eligibleCount,
          `Forbidden Zone anonymous progress is invalid: ${JSON.stringify(pending)}`);
        await waitForText(player.page, 'YOUR CHOICE IS SEALED');
        if (!coverage.has('forbidden:sealed-reload')) {
          await screenshot(player.page, `12-match-${matchNumber}-forbidden-sealed-${player.width}.png`);
          const privateFrames = player.privateFrames;
          const issuesBeforeReload = consoleIssues.length;
          await player.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
          await waitUntil(() => player.privateFrames > privateFrames, 'Forbidden Zone private state after reload');
          await waitForPairedState(player);
          assert(player.latestPrivate.cardChoiceSubmitted === true, 'Reload lost the viewer-private Forbidden Zone submitted state');
          await waitForText(player.page, 'YOUR CHOICE IS SEALED');
          assert(consoleIssues.length === issuesBeforeReload, 'Forbidden Zone reload produced a browser issue');
          coverage.add('forbidden:sealed-reload');
        }
      }
      return true;
    }

    if (mine.canChooseSurvivalCard) {
      for (const cardId of mine.survivalChoiceCards) {
        const cardHeading = `${titleCaseCard(cardId)} · PHASE`;
        assert((await bodyText(player.page)).includes(cardHeading), `Shelter choice has no phase heading for ${cardId}`);
      }
      const assertExclusiveShelterChoice = async () => {
        const labels = (await visibleButtonData(player.page, false)).map((button) => button.label);
        const exposedResolution = labels.filter((label) => [
          'USE PLACE POWER',
          'RECOVER ONE PLACE',
          'SKIP PLACE POWER',
          'RESOLVE INTERCEPTION',
          'CONFIRM RESOLUTION',
          'CONTINUE RECKONING',
        ].includes(label));
        assert(exposedResolution.length === 0,
          `Shelter keep-one decision exposed underlying resolution controls: ${JSON.stringify(exposedResolution)}`);
      };
      await assertExclusiveShelterChoice();
      if (!coverage.has('shelter_choice_reload')) {
        const privateFrames = player.privateFrames;
        await player.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
        await waitUntil(() => player.privateFrames > privateFrames, 'Shelter choice private state after reload');
        await waitForPairedState(player);
        assert(player.latestPrivate.canChooseSurvivalCard === true, 'Reload lost the mandatory Shelter keep-one decision');
        await assertExclusiveShelterChoice();
        await screenshot(player.page, `14-match-${matchNumber}-shelter-choice-reload-${player.width}.png`);
        coverage.add('shelter_choice_reload');
      }
      const labels = await enabledLabels(player.page);
      const ownKeep = ownPlan ? ownViewPolicy(player.latestPublic, player.latestPrivate).survivalChoiceCardId : null;
      assert(!ownPlan || ownKeep, 'Owned Shelter frame has no keep-one option');
      const keep = ownPlan ? labels.find(label => label === `KEEP ${titleCaseCard(ownKeep).toUpperCase()}`) : labels.find((label) => label.startsWith('KEEP '));
      assert(keep, 'Shelter decision did not render an enabled keep option');
      const sentBefore = player.sentActions.filter((action) => action === 'notalone:survival-choice').length;
      const acceptedBefore = player.acceptedActions.filter((item) => item.action === 'survival_choice').length;
      await submitAndWait(player, async () => {
        const button = await findButton(player.page, new RegExp(`^${escapedPattern(keep)}$`));
        assert(button, 'Shelter keep-one option disappeared before rapid-submit check');
        try {
          await button.evaluate((element) => {
            element.click();
            element.click();
          });
        } finally {
          await button.dispose();
        }
      }, 'keep Shelter Survival card');
      await delay(200);
      const sentAfter = player.sentActions.filter((action) => action === 'notalone:survival-choice').length;
      const acceptedAfter = player.acceptedActions.filter((item) => item.action === 'survival_choice').length;
      assert(sentAfter - sentBefore === 1, `Rapid Shelter activation emitted ${sentAfter - sentBefore} commands`);
      assert(acceptedAfter - acceptedBefore === 1, `Rapid Shelter activation received ${acceptedAfter - acceptedBefore} accepted actions`);
      coverage.add('shelter_double_submit_fence');
      coverage.add('shelter_choice');
      return true;
    }

    if (mine.canChooseRiver) {
      const choice = ownPlan ? ownPlan.riverChoice : mine.selectedPlaces[0];
      assert(choice, 'River decision has no prepared destination');
      await submitAndWait(player, () => clickPlace(player.page, choice), 'choose real River destination');
      coverage.add('river_choice');
      return true;
    }

    if (mine.role === 'creature') {
      const rehearsingEarlyRoute = strategy === 'escape' && state.roundNumber <= 7;
      const huntCardId = ownPlan ? ownPlan.huntCardId : rehearsingEarlyRoute ? null : chooseHuntCard(mine, state);
      if (huntCardId) {
        await playHuntCard(player, huntCardId, matchNumber);
        return true;
      }
    }

    if (mine.canSelect) {
      const choices = ownPlan ? ownPlan.explorationPlaces : desiredExplorationPlaces(player, players, strategy, plans);
      if (choices.length < mine.requiredSelectionCount) {
        assert(!ownPlan || ownPlan.giveUp, 'Insufficient own legal Places without a projected Give Up action');
        await clickButton(player.page, /^GIVE UP$/);
        await submitAndWait(player, () => clickDialogButton(player.page, 'GIVE UP'), 'give up');
        coverage.add('give_up');
        if (!ownPlan) plans.delete(`${state.roundNumber}:${strategy}`);
        return true;
      }
      const choiceKey = 'place-row-evidence:' + player.name;
      const checkChoices = ownPlan && qa && ['Lyra', 'Noor'].includes(player.name)
        && mine.placeHand.length >= 3 && !coverage.has(choiceKey);
      const choiceSession = checkChoices ? await beginChoiceEvidence(player, qa) : null;
      try {
        for (const place of choices) await clickPlace(player.page, place);
        if (choiceSession) await selectionEvidence(choiceSession, choices);
        await submitAndWait(player, () => clickButton(player.page, new RegExp(`^LOCK ${mine.requiredSelectionCount} SECRET PLACE`)), 'lock secret destination');
        if (choiceSession) { confirmChoiceEvidence(choiceSession); coverage.add(choiceKey); }
      } finally {
        if (choiceSession) await player.page.setViewport(choiceSession.originalViewport);
      }
      coverage.add(`selection:${mine.selectionMode}`);
      return true;
    }

    if (mine.canPass) {
      const focusObserver = !coverage.has('stable_remote_reaction_focus')
        ? livePlayers(players).find((candidate) => candidate !== player && candidate.latestPrivate?.canPass
          && candidate.latestPrivate?.role === 'hunted' && candidate.latestPrivate?.survivalHand.length)
        : null;
      if (focusObserver) {
        await focusObserver.page.evaluate(() => {
          const hand = document.getElementById('not-alone-private-hand');
          hand.setAttribute('tabindex', '-1');
          hand.scrollIntoView({ block: 'start' });
          hand.focus({ preventScroll: true });
        });
      }
      await submitAndWait(player, () => clickButton(player.page, /^PASS REACTION$/), `pass ${state.phase}`);
      if (focusObserver) {
        await waitForPairedState(focusObserver);
        if (focusObserver.latestPrivate.canPass && focusObserver.latestPublic.phase === state.phase) {
          await delay(180);
          const focusId = await focusObserver.page.evaluate(() => document.activeElement?.id);
          assert(focusId === 'not-alone-private-hand', `Another player's pass stole focus from the private hand: ${focusId}`);
          coverage.add('stable_remote_reaction_focus');
        }
      }
      coverage.add(`pass:${state.phase}`);
      return true;
    }

    if (mine.canBeginHunt) {
      await submitAndWait(player, () => clickButton(player.page, /^BEGIN THE HUNT$/), 'begin Hunt');
      coverage.add('begin_hunt');
      return true;
    }

    if (mine.canLockHunt) {
      await submitAndWait(player, () => clickButton(player.page, /^LOCK HUNT POSITIONS$/), 'lock Hunt positions');
      coverage.add('lock_hunt');
      return true;
    }

    if (mine.canReveal) {
      await submitAndWait(player, () => clickButton(player.page, /^REVEAL DESTINATIONS$/), 'reveal destinations');
      coverage.add('reveal');
      return true;
    }

    if (mine.canBeginReckoning) {
      await submitAndWait(player, () => clickButton(player.page, /^ADVANCE RECKONING$/), 'advance Reckoning');
      coverage.add('begin_reckoning');
      return true;
    }

    if (mine.canResolve) {
      await chooseResolution(player, matchNumber, strategy, ownPlan);
      return true;
    }

    if (mine.canEndTurn) {
      await submitAndWait(player, () => clickButton(player.page, /^FINISH ROUND$/), 'finish round');
      coverage.add('end_turn');
      return true;
    }

    if (mine.role === 'creature' && state.phase === 'creature_planning') {
      const labels = await enabledLabels(player.page);
      const destination = ownPlan ? ownPlan.creatureDestination : creatureDestination(players, strategy);
      if (labels.includes('PLACE CREATURE')) {
        await placeHuntToken(player, 'creature', destination);
        return true;
      }
      if (labels.includes('PLACE TARGET')) {
        await placeHuntToken(player, 'target', destination);
        return true;
      }
      if (labels.includes('PLACE ARTEMIA')) {
        const artemiaPlace = ownPlan ? ownPlan.artemiaDestination : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((place) => place !== destination) ?? 2;
        await placeHuntToken(player, 'artemia', artemiaPlace);
        return true;
      }
    }
  }
  return false;
}

async function captureGameplay(players, matchNumber) {
  if (coverage.has('gameplay-evidence:' + matchNumber)) return;
  const host = players.find(player => player.latestPrivate?.role === 'creature');
  const hunted = players.find(player => player.latestPrivate?.role === 'hunted');
  if (!host || !hunted) return;
  if (matchNumber === 1 && qa) {
    await captureMatrix(host, 'creature-decision', '#not-alone-decision-heading');
    await captureMatrix(hunted, 'hunted-decision', '#not-alone-decision-heading');
    await captureMatrix(players.find(player => !player.left && !player.page.viewport()?.hasTouch), 'desktop-pointer-decision', '#not-alone-decision-heading');
    for (const player of [host, hunted]) for (const id of ['not-alone-private-hand', 'not-alone-public-trails']) {
      await qa.capture(player.page, player.name + '-' + id + '.png', { frame: '#' + id });
      await captureRailEnds(player, id);
    }
    coverage.add('responsive_gameplay');
    coverage.add('actual_text_scale_200');
  } else {
    await screenshot(host.page, 'match-' + matchNumber + '-creature.png');
    await screenshot(hunted.page, 'match-' + matchNumber + '-hunted.png');
  }
  coverage.add('gameplay-evidence:' + matchNumber);
}

async function driveFullMatch(players, matchNumber, strategy, onProgress) {
  assert(strategy !== 'own-view' || !onProgress, 'Own-view natural runs cannot use an external gameplay progress callback');
  let actions = 0;
  let idleLoops = 0;
  let privacyRound = 0;
  let observedBoardRound = null;
  const plans = new Map();
  for (let loop = 0; loop < 2_000; loop += 1) {
    const active = livePlayers(players);
    for (const player of active) {
      if (player.latestPublic && player.latestPrivate) observePhase(player);
    }
    const state = active[0] ? (await waitForPairedState(active[0])).publicState : null;
    if (state) {
      observedBoardRound = await observeBoardStatus(active[0], observedBoardRound, matchNumber);
    }
    if (state?.status === 'game_over') {
      checkpoint(`match ${matchNumber} complete after ${actions} rendered actions`);
      return actions;
    }
    if (state?.phase === 'exploration_reaction' && state.roundNumber !== privacyRound) {
      await assertHiddenDestinations(players);
      await assertPublicTrails(players);
      privacyRound = state.roundNumber;
      if (state.roundNumber === 1) await captureGameplay(players, matchNumber);
    }
    if (onProgress && await onProgress({ players, state, actions, matchNumber })) {
      idleLoops = 0;
      continue;
    }
    if (await performOneAction(players, matchNumber, strategy, plans)) {
      actions += 1;
      idleLoops = 0;
      if (actions % 50 === 0) checkpoint(`match ${matchNumber}: ${actions} rendered actions, round ${state?.roundNumber ?? '?'}`);
      await delay(80);
      continue;
    }
    idleLoops += 1;
    if (idleLoops > 100) {
      const diagnostics = [];
      for (const player of active) diagnostics.push({
        name: player.name,
        path: new URL(player.page.url()).pathname,
        revision: player.latestPrivate?.revision,
        publicPhase: player.latestPublic?.phase,
        privateFlags: player.latestPrivate ? Object.fromEntries(Object.entries(player.latestPrivate).filter(([key, value]) => key.startsWith('can') && value)) : {},
        labels: await enabledLabels(player.page),
        body: (await bodyText(player.page)).slice(0, 900),
      });
      throw new Error(`No actionable NOT ALONE decision: ${JSON.stringify(diagnostics)}`);
    }
    await delay(120);
  }
  throw new Error(`NOT ALONE match ${matchNumber} exceeded the rendered action limit`);
}

async function assertGameOverDialog(player) {
  await waitUntil(() => player.page.evaluate(() => Boolean(document.getElementById('not-alone-game-over'))), 'game-over dialog');
  const semantics = await player.page.evaluate(() => {
    const dialog = document.getElementById('not-alone-game-over');
    return dialog ? {
      role: dialog.getAttribute('role'),
      modal: dialog.getAttribute('aria-modal'),
      label: dialog.getAttribute('aria-label'),
      focusInside: dialog.contains(document.activeElement),
    } : null;
  });
  assert(semantics?.role === 'dialog' && semantics.modal === 'true' && semantics.focusInside,
    `Game-over dialog semantics/focus are wrong: ${JSON.stringify(semantics)}`);
}

async function exerciseChoiceStability(host, firstHunted, secondHunted) {
  await waitUntil(() => host.latestPublic?.phase === 'exploration_reaction'
    && firstHunted.latestPrivate?.survivalHand.includes('sacrifice')
    && secondHunted.latestPrivate?.survivalHand.includes('smokescreen'), 'real engine focus fixture');
  await Promise.all([host, firstHunted, secondHunted].map((player) => waitForPairedState(player)));
  const originalViewport = host.page.viewport();
  const meterBounds = [];
  for (const width of [320, 360, 390, 768, 1280]) {
    await resize(host.page, width, 820);
    await scrollMain(host.page);
    assert(await host.page.$eval('#not-alone-mode-summary', (element) => element.textContent)
      === 'Original 2016 base · Digital adaptations in How to play', 'Gameplay header lost the concise adaptation pointer');
    await assertNoHorizontalOverflow(host);
    await screenshot(host.page, `focused-game-header-${width}.png`);
    const meters = await host.page.evaluate(() => ['rescue', 'assimilation'].map((name) => {
      const meter = document.getElementById(`not-alone-meter-${name}`)
        ?? document.querySelector(`[aria-label^="${name.toUpperCase()}:"]`);
      if (!meter) return { name, missing: true };
      const bounds = meter.getBoundingClientRect();
      const clipped = [...meter.querySelectorAll('*')].filter((element) => {
        const child = element.getBoundingClientRect();
        return child.left < bounds.left - 1 || child.right > bounds.right + 1;
      }).map((element) => element.textContent);
      return { name, width: bounds.width, clipped };
    }));
    assert(meters.every((meter) => !meter.missing && meter.clipped.length === 0),
      `Meter contents exceed their cards at ${width}px: ${JSON.stringify(meters)}`);
    meterBounds.push({ viewport: width, meters });
  }
  if (originalViewport) await host.page.setViewport(originalViewport);
  await clickButton(host.page, /^How to play$/);
  await waitForText(host.page, host.latestPublic.modeDescription);
  await screenshot(host.page, 'focused-full-rules-disclosure-390.png');
  await clickButton(host.page, /^Close rules$/);
  await clickButton(firstHunted.page, /^Sacrifice · P1/);
  const unselected = await findButton(firstHunted.page, /^Place 1,/);
  assert(await unselected?.evaluate((element) => element.getAttribute('aria-pressed')) === 'false',
    'Unselected Sacrifice Place1 is missing false pressed semantics');
  await unselected.dispose();
  await clickPlace(firstHunted.page, 1);
  const chosen = await findButton(firstHunted.page, /^Place 1,/);
  assert(chosen, 'Sacrifice choice has no Place1 control');
  await chosen.evaluate((element) => element.focus());
  const selectionProof = async () => firstHunted.page.evaluate(() => {
    const active = document.activeElement;
    const scroll = [...document.querySelectorAll('*')].filter((element) => element.scrollHeight > element.clientHeight + 20)
      .sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))[0];
    const label = active?.getAttribute('aria-label');
    return { label, selected: label?.endsWith(' Selected.') === true, ariaPressed: active?.getAttribute('aria-pressed'), scrollTop: scroll?.scrollTop ?? 0 };
  });
  const before = await selectionProof();
  await screenshot(firstHunted.page, 'focus-stability-before-remote-pass-360.png');
  assert(before.selected && before.ariaPressed === 'true', `Sacrifice Place1 was not selected: ${JSON.stringify(before)}`);
  const revision = firstHunted.latestPublic.revision;
  await submitAndWait(secondHunted, () => clickButton(secondHunted.page, /^PASS REACTION$/), 'fixture remote pass');
  await waitUntil(() => firstHunted.latestPublic.revision > revision, 'first Hunted receives remote revision');
  await waitForPairedState(firstHunted);
  await delay(200);
  const after = await selectionProof();
  assert(after.label === before.label && after.selected && after.ariaPressed === 'true' && Math.abs(after.scrollTop - before.scrollTop) <= 1,
    `Remote pass changed local selection/focus/scroll: ${JSON.stringify({ before, after })}`);
  assert(await hasButton(firstHunted.page, /^CONFIRM SACRIFICE$/), 'Remote pass closed the still-legal Sacrifice form');
  const staleSubmit = await findButton(firstHunted.page, /^CONFIRM SACRIFICE$/);
  assert(staleSubmit, 'Sacrifice form has no enabled submit control');
  await screenshot(firstHunted.page, 'focus-stability-after-remote-pass-360.png');
  const commandsBeforeInvalidation = firstHunted.sentActions.length;
  await submitAndWait(host, () => clickButton(host.page, /^Despair · P1/), 'fixture Despair invalidation');
  await waitUntil(() => firstHunted.latestPublic.phase === 'hunted_planning', 'Despair returns all destinations');
  await waitForPairedState(firstHunted);
  await delay(200);
  assert(!await hasButton(firstHunted.page, /^CONFIRM SACRIFICE$/, false), 'Despair left stale Sacrifice form open');
  assert(!firstHunted.latestPrivate.playableSurvivalCardIds.includes('sacrifice'), 'Despair still advertises Sacrifice');
  await staleSubmit.evaluate((element) => element.click());
  await staleSubmit.dispose();
  await chosen.dispose();
  assert(firstHunted.sentActions.length === commandsBeforeInvalidation, 'Detached stale control submitted an action');
  await screenshot(firstHunted.page, 'focus-stability-after-despair-360.png');
  return { before, after, meterBounds, invalidation: 'Despair reset destinations and disabled Survival', staleCommandsSent: 0 };
}

async function main() {
  assertOwnViewMode({ ownView: OWN_VIEW, focusOnly: FOCUS_ONLY, focusStabilityOnly: FOCUS_STABILITY_ONLY, fixtureRun: process.env.NOT_ALONE_UI_FIXTURE_RUN === 'true' });
  assert(!fs.existsSync(outputDir), 'Choose a new output directory; prior evidence must remain intact');
  fs.mkdirSync(outputDir, { recursive: true }); ownsOutput = true;
  qa = createEvidence({ outputDir, base: BASE_URL, api: API_URL });
  for (const secret of [' artemia-signal ', 'artemia-signal', 'wrong-password']) qa.secrets.add(secret);
  if (OWN_VIEW) {
    qa.evidence.method = OWN_VIEW_METHOD;
    qa.evidence.gaps.push('Own-view mode is automated and deterministic, not independent human competitive play. Optional Survival reactions and Resist choices are not exercised by this policy.');
  } else qa.evidence.gaps.push('Separate owner-view natural gate required: each seat may use only its private frame and projected public information. Coordinated catch/escape is branch coverage, not independent competitive play.');
  qa.evidence.mode = OWN_VIEW ? 'own-view-natural' : 'legacy-coordinated';
  qa.evidence.completedNaturalGames = [];
  qa.evidence.gaps.push('Native devices and fontScale remain untested.', 'Shelter reload/double-submit is unproven unless its strict natural branch is reached in this run.');
  let browser = null, watchdog = null;
  const players = [];
  try {
    assert(process.env.NOT_ALONE_UI_EXCLUSIVE_WINDOW === 'granted', 'Exclusive browser window must be explicitly granted');
    const fixtureMode = FOCUS_STABILITY_ONLY && process.env.NOT_ALONE_UI_FIXTURE_RUN === 'true';
    assert(!FOCUS_STABILITY_ONLY || fixtureMode, 'Focus stability requires explicit NOT_ALONE_UI_FIXTURE_RUN opt-in');
    assertUiSource(); local(API_URL);
    const sourceHashes = auditedSourceHashes(), exportedBuild = exportedBuildEvidence();
    qa.evidence.sourceHashes = sourceHashes;
    qa.evidence.exportedBuild = exportedBuild; qa.persist();
    const health = await fetch(API_URL, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    const service = health.ok ? (await health.json()).service : null;
    assert(service === (fixtureMode ? 'not-alone-ui-fixture' : 'zuychin-arcade-server'), 'API service must match the explicitly chosen ordinary or fixture mode');
    qa.evidence.service = service;
    if (fixtureMode) qa.evidence.method = 'Isolated canonical fixture branch coverage, not natural or independent competitive play.';
    const bundle = await bundleFence(BASE_URL + '/not-alone', process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256);
    const servedHash = bundle.servedHash;
    qa.evidence.bundle = bundle; qa.persist();
    assert(/^[A-Za-z0-9+/]{43}=$/.test(QA_BROWSER_CERT_SPKI ?? ''), 'Provide current QA certificate SPKI');
    browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true,
      args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + QA_BROWSER_CERT_SPKI] });
    watchdog = setTimeout(() => { qa.evidence.watchdogExpired = true; qa.persist(); void browser.close(); }, 30 * 60_000);
    await qa.calibrate(browser);
    const host = await openPlayer(browser, 'Astra Host', 390, 844, true);
    const lyra = await openPlayer(browser, 'Lyra', 360, 800);
    const noor = await openPlayer(browser, 'Noor', 768, 900);
    const echo = await openPlayer(browser, 'Echo', 1280, 820);
    players.push(host, lyra, noor, echo);
    const matchPlayers = [host, lyra, noor];

    const focusEvidence = FOCUS_STABILITY_ONLY ? null : await exerciseFocusAndLanding(host);
    if (FOCUS_STABILITY_ONLY) {
      await host.page.goto(`${BASE_URL}/not-alone`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForText(host.page, 'OPEN A SIGNAL');
    }
    if (FOCUS_ONLY) {
      assert(consoleIssues.length === 0, `Console warnings/errors: ${JSON.stringify(consoleIssues)}`);
      const result = {
        outputDir,
        consoleIssues,
        focusPredicate: 'loaded and matching authored 3px #f7faff rule, plus a computed non-none ring at least 3px wide',
        focusEvidence,
        screenshots: [...screenshots].sort(),
      };
      writeReceipt('focus-result.json', result);
      checkpoint('Focus checks completed; inspect evidence receipt.');
      return;
    }

    await resize(host.page, 390, 844);
    await setInput(host.page, 'Your name', host.name);
    await setInput(host.page, 'Room password, optional', ' artemia-signal ');
    await clickButton(host.page, /^CREATE ROOM$/);
    await waitForPath(host.page, '/not-alone/lobby');
    const roomCode = await roomCodeFromLobby(host.page);
    checkpoint(`created isolated room ${roomCode}`);

    await joinPlayer(lyra, roomCode, ' artemia-signal ', { validation: true, wrongPassword: true });
    await joinPlayer(noor, roomCode, ' artemia-signal ');
    if (!FOCUS_STABILITY_ONLY) {
    await joinPlayer(echo, roomCode, ' artemia-signal ');
    await waitForText(host.page, '4/7');
    await screenshot(echo.page, '03a-lobby-wide-1280.png');
    await echo.page.goBack().catch(() => undefined);
    await waitForText(echo.page, 'Leave room?');
    await clickDialogButton(echo.page, 'STAY');
    await waitUntil(() => echo.page.evaluate(() => !document.getElementById('arcade-dialog')), 'Stay closes lobby Back confirmation');
    assert(new URL(echo.page.url()).pathname.endsWith('/not-alone/lobby'), 'Browser Back escaped the protected lobby');
    coverage.add('lobby_back_guard');
    await clickButton(echo.page, /^LEAVE ROOM$/);
    await waitForText(echo.page, 'Leave room?');
    await clickDialogButton(echo.page, 'LEAVE');
    await waitForPath(echo.page, '/');
    await waitUntil(() => echo.page.evaluate(() => sessionStorage.getItem('za:auth') === null), 'temporary lobby seat clears local auth');
    await waitForText(host.page, '3/7');
    coverage.add('lobby_leave');
    await joinPlayer(echo, roomCode, ' artemia-signal ');
    await waitForText(host.page, '4/7');
    await clickButton(host.page, /^Remove Echo$/);
    await clickDialogButton(host.page, 'REMOVE');
    await waitUntil(async () => !(await bodyText(host.page)).includes('Echo'), 'host removes temporary lobby seat');
    await waitUntil(() => echo.page.evaluate(() => sessionStorage.getItem('za:auth') === null), 'removed seat clears authentication');
    echo.left = true;
    qa.evidence.cleanup.push({ actor: echo.name, normalUI: true, hostRemoval: true, authCleared: await echo.page.evaluate(() => sessionStorage.getItem('za:auth') === null) }); qa.persist();
    coverage.add('lobby_host_remove');
    await waitForText(host.page, '3/7');
    await screenshot(host.page, '03-lobby-host-390.png');
    await screenshot(lyra.page, '06-lobby-hunted-360.png');
    await screenshot(noor.page, '07-lobby-tablet-768.png');
    await captureMatrix(host, 'lobby');
    await assertNoHorizontalOverflow(host);
    await assertNoHorizontalOverflow(lyra);
    await assertNoHorizontalOverflow(noor);
    await assertVisibleTouchTargets(host);
    await assertVisibleTouchTargets(lyra);
    coverage.add('password_room');
    coverage.add('lobby');

    noor.intentionalOffline = true;
    await noor.page.setOfflineMode(true);
    await waitForText(host.page, 'RECONNECTING · SEAT RESERVED');
    assert(await hasButton(host.page, /^WAITING FOR RECONNECTION$/, false), 'Host did not see the disabled reconnect start state');
    await screenshot(host.page, '07a-lobby-reconnecting-390.png');
    await noor.page.setOfflineMode(false);
    await noor.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForPath(noor.page, '/not-alone/lobby');
    await waitForText(noor.page, 'NOT ALONE TABLE');
    noor.intentionalOffline = false;
    await waitUntil(() => hasButton(host.page, /^START GAME$/), 'reconnected seat restores start');
    coverage.add('lobby_reconnect');
    }
    await clickButton(host.page, /^Alternating board face$/i);
    coverage.add('board_face:alternating');

    await clickButton(host.page, /^START GAME$/);
    await Promise.all(matchPlayers.map((player) => waitForPath(player.page, '/not-alone/game')));
    await Promise.all(matchPlayers.map((player) => waitForPairedState(player)));
    assert(host.latestPrivate.role === 'creature', 'Host was not assigned the disclosed Creature role');
    assert(lyra.latestPrivate.role === 'hunted' && noor.latestPrivate.role === 'hunted', 'Guests were not assigned the disclosed Hunted role');
    assert(host.latestPublic.boardFace === 'alternating', 'Lobby board-face choice did not reach authoritative game state');
    coverage.add('role:creature');
    coverage.add('role:hunted');

    if (FOCUS_STABILITY_ONLY) {
      const focusStability = await exerciseChoiceStability(host, lyra, noor);
      assert(consoleIssues.length === 0, `Console warnings/errors: ${JSON.stringify(consoleIssues)}`);
      assert(players.every((player) => player.rejections.length === 0), 'Focus fixture had an unexpected rejected action');
      const result = { outputDir, sourceHashes, exportedBuild, focusStability, consoleIssues, screenshots: [...screenshots].sort(),
        runtime: { node: process.version, browser: await browser.version(), webUrl: BASE_URL },
        scope: 'Real engine fixture, concise responsive header with full rules disclosure, pressed selection semantics, legal live Sacrifice choice, remote pass, Despair invalidation. Full lifecycle is a separate run.' };
      assert(JSON.stringify(sourceHashes) === JSON.stringify(auditedSourceHashes()), 'Audited source changed during focus fixture');
      assert(JSON.stringify(exportedBuild) === JSON.stringify(exportedBuildEvidence()), 'Exported bundle changed during focus fixture');
      writeReceipt('focus-stability-result.json', result);
      checkpoint('Fixture focus stability checks completed; inspect evidence receipt.');
      return;
    }

    const reloadFrames = lyra.privateFrames;
    const errorsBeforeReload = consoleIssues.length;
    await lyra.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForPath(lyra.page, '/not-alone/game');
    await waitUntil(() => lyra.privateFrames > reloadFrames, 'live Hunted private state reload');
    await waitForPairedState(lyra);
    assert(consoleIssues.length === errorsBeforeReload, 'Reloading a live Hunted seat produced a browser issue');
    coverage.add('live_reload');

    const firstMatchActions = OWN_VIEW ? await driveFullMatch(players, 1, 'own-view') : await driveFullMatch(players, 1, 'catch');
    const firstTerminal = JSON.parse(JSON.stringify(host.latestPublic));
    assert(firstTerminal.players.every(player => !player.forfeited), 'First natural match included a forfeit');
    assert(firstTerminal.status === 'game_over' && firstTerminal.endReason === 'track', 'First natural match did not finish through a track');
    qa.evidence.completedNaturalGames.push({ match: 1, revision: firstTerminal.revision, winner: firstTerminal.winner, endReason: firstTerminal.endReason }); qa.persist();
    await assertGameOverDialog(host);
    await screenshot(host.page, '15-match-1-game-over-390.png');
    await captureMatrix(host, 'results', '#not-alone-game-over');
    const hostViewport = host.page.viewport();
    await resize(host.page, 1280, 900);
    await screenshot(host.page, '16-match-1-game-over-1280.png');
    if (hostViewport) await host.page.setViewport(hostViewport);
    await assertGameOverDialog(noor);
    await desktopResultEvidence(noor, qa);
    await assertVisibleTouchTargets(host);

    const rematchFrame = host.publicFrames;
    await clickButton(host.page, /^CONTINUOUS$/);
    coverage.add('board_face:continuous');
    await clickButton(host.page, /^PLAY AGAIN$/);
    await waitUntil(() => host.publicFrames > rematchFrame && host.latestPublic?.status === 'playing'
      && host.latestPublic?.roundNumber === 1, 'clean rematch begins');
    await Promise.all(matchPlayers.map((player) => waitForPairedState(player)));
    assert(host.latestPublic.boardFace === 'continuous', 'Rematch board-face choice did not reach authoritative game state');
    await screenshot(host.page, '17-clean-rematch-round-1-390.png');
    coverage.add('clean_rematch');

    const rematchReloadFrames = noor.privateFrames;
    const rematchErrorsBeforeReload = consoleIssues.length;
    await noor.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForPath(noor.page, '/not-alone/game');
    await waitUntil(() => noor.privateFrames > rematchReloadFrames, 'rematch private state reload');
    await waitForPairedState(noor);
    assert(consoleIssues.length === rematchErrorsBeforeReload, 'Reloading the rematch produced a browser issue');
    coverage.add('rematch_reload');

    await clickButton(lyra.page, /^Back to arcade$/);
    await waitForText(lyra.page, 'Forfeit this expedition?');
    await clickDialogButton(lyra.page, 'STAY');
    await waitUntil(() => lyra.page.evaluate(() => !document.getElementById('arcade-dialog')), 'Stay retains live seat');
    coverage.add('browser_back_guard');
    const secondMatchActions = OWN_VIEW ? await driveFullMatch(players, 2, 'own-view') : await driveFullMatch(players, 2, 'escape');
    const secondTerminal = JSON.parse(JSON.stringify(host.latestPublic));
    assert(secondTerminal.players.every(player => !player.forfeited), 'Second natural match included a forfeit');
    assert(secondTerminal.status === 'game_over' && secondTerminal.endReason === 'track', 'Second natural match did not finish through a track');
    qa.evidence.completedNaturalGames.push({ match: 2, revision: secondTerminal.revision, winner: secondTerminal.winner, endReason: secondTerminal.endReason }); qa.persist();
    await assertGameOverDialog(host);
    await screenshot(host.page, '20-match-2-game-over-390.png');

    for (const player of [lyra, noor]) {
      await clickButton(player.page, /^BACK TO ARCADE$/);
      await waitForText(player.page, 'Return to the arcade?');
      await clickDialogButton(player.page, 'LEAVE');
      await waitForPath(player.page, '/');
      await waitUntil(() => player.page.evaluate(() => sessionStorage.getItem('za:auth') === null), 'finished seat auth cleared');
      player.left = true;
    }
    await waitForText(host.page, 'REMATCH UNAVAILABLE · NEED 1 NEW PLAYER');
    await screenshot(host.page, '21-rematch-shortage-390.png');
    coverage.add('rematch_shortage');
    await clickButton(host.page, /^START A NEW ROOM$/);
    await waitForPath(host.page, '/not-alone');
    await waitUntil(() => host.page.evaluate(() => sessionStorage.getItem('za:auth') === null), 'host auth cleared');
    host.left = true;
    coverage.add('new_room_cleanup');

    const requiredCoverage = [
      'phase:hunted_planning', 'phase:exploration_reaction', 'phase:creature_planning',
      'phase:hunting_reaction', 'phase:reckoning', 'phase:end_of_turn', 'phase:game_over',
      'lock_hunt', 'hidden_destinations', 'public_discard_trails',
      'lobby_host_remove', 'lobby_leave', 'lobby_back_guard', 'board_face:alternating',
      'board_face:continuous', 'browser_back_guard', 'rematch_shortage',
    ];
    for (const item of requiredCoverage) assert(coverage.has(item), `Rendered lifecycle missed ${item}`);
    assert(consoleIssues.length === 0, `Console warnings/errors: ${JSON.stringify(consoleIssues)}`);
    const actionRejections = players.flatMap((player) => player.rejections.map((rejection) => ({ player: player.name, rejection })));
    assert(actionRejections.length === 0, `Unexpected socket action rejections: ${JSON.stringify(actionRejections)}`);

    const result = {
      outputDir,
      sourceHashes,
      exportedBuild,
      servedHash,
      runtime: { node: process.version, browser: await browser.version(), webUrl: BASE_URL },
      roomCode,
      consoleIssues,
      focusEvidence,
      firstMatchActions,
      secondMatchActions,
      firstTerminal, secondTerminal,
      method: OWN_VIEW ? OWN_VIEW_METHOD : "Coordinated ordinary-server browser functional coverage. A central scripted driver reads all synthetic seats' private wire projections and deliberately coordinates Creature hits/misses; this is not fair competitive or own-view-only play. No engine-state injection. Independent manual Astra play and canonical fixtures are separate evidence.",
      mode: qa.evidence.mode,
      completedNaturalGames: qa.evidence.completedNaturalGames,
      websocketFrames: Object.fromEntries(players.map((player) => [player.name, {
        public: player.publicFrames,
        private: player.privateFrames,
        sent: player.sentActions.length,
        accepted: player.acceptedActions.length,
        rejections: player.rejections.length,
      }])),
      privateLeakChecks,
      coverage: [...coverage].sort(),
      screenshots: [...screenshots].sort(),
      viewports: MATRIX, textScale: 'Persistent stylesheet 200%, strict same-node and computed-font observations after viewport-only capture',
      journeys: [
        'keyboard focus and rules dialog',
        'create validation and password room',
        'join validation and wrong password',
        'host and Hunted lobby',
        'disconnect reservation and reconnect',
        'live reload and paired private/public sync',
        'full first natural game',
        'clean rematch',
        'projected private choices encountered during natural play',
        'browser Back stay guard',
        'live leave confirmation cancelled without forfeit',
        'full rematch',
        'finished-room shortage',
        'awaited new-room cleanup',
      ],
    };
    assert(JSON.stringify(sourceHashes) === JSON.stringify(auditedSourceHashes()), 'Audited source changed during this rendered run');
    assert(JSON.stringify(exportedBuild) === JSON.stringify(exportedBuildEvidence()), 'Exported bundle changed during this rendered run');
    qa.evidence.coverage = [...coverage].sort();
    if (OWN_VIEW) for (const name of ['Lyra', 'Noor']) assert(coverage.has('place-row-evidence:' + name), `Natural Place row evidence not reached for ${name}`);
    qa.evidence.rareBranchGaps = ['shelter_choice_reload', 'shelter_double_submit_fence', 'forbidden:sealed-reload'].filter(key => !coverage.has(key));
    qa.persist();
    writeReceipt('result.json', result);
    checkpoint('Functional driver completed. Inspect receipt findings and captures before any visual acceptance.');
  } catch (error) {
    qa.evidence.failure = redact(error.stack ?? error.message ?? String(error), [...qa.secrets]);
    qa.persist();
    throw error;
  } finally {
    if (watchdog) clearTimeout(watchdog);
    for (const player of qa.actors.values()) {
      let auth = player.auth ?? null;
      try { auth = await player.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') || 'null')) ?? auth; } catch {}
      if (auth?.token) qa.secrets.add(auth.token);
      if (!player.left && auth?.token && auth.roomCode) {
        player.fallbackCleanup = true;
        try {
          const response = await fetch(API_URL + '/rooms/' + encodeURIComponent(auth.roomCode) + '/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.token }, redirect: 'error', signal: AbortSignal.timeout(5000) });
          qa.evidence.cleanup.push({ actor: player.name, status: response.status, normalUI: false, fallback: true });
        } catch (error) { qa.evidence.cleanup.push({ actor: player.name, normalUI: false, fallback: true, error: error.message }); }
      }
      try {
        const authCleared = await player.page.evaluate(() => sessionStorage.getItem('za:auth') === null);
        for (const record of qa.evidence.cleanup.filter(record => record.actor === player.name && record.normalUI)) record.authCleared = authCleared;
      } catch {}
      await player.cdp?.detach().catch(() => undefined);
      try { await player.context.close(); qa.evidence.cleanup.push({ actor: player.name, contextClosed: true }); }
      catch (error) { qa.evidence.cleanup.push({ actor: player.name, contextClosed: false, error: error.message }); }
    }
    try { if (browser) { await browser.close(); qa.evidence.browserClosed = true; } }
    finally { qa.evidence.finalConsoleIssues = consoleIssues; qa.persist(); writeReceipt('cleanup.json', { browserClosed: qa.evidence.browserClosed, entries: qa.evidence.cleanup }); }
  }
}

module.exports = { checkArtemiaRound, driveFullMatch, assertGameOverDialog, joinPlayer, roomCodeFromLobby, clickDialogButton, exportedBuildEvidence, openPlayer, setInput, clickButton, hasButton, enabledLabels, waitUntil, waitForText, waitForPath, screenshot, bodyText, consoleIssues, performOneAction, waitForPairedState };

if (require.main === module) main().catch(error => {
  if (ownsOutput) writeReceipt('failure.txt', { error: error instanceof Error ? error.stack : String(error), consoleIssues, coverage: [...coverage].sort() });
  console.error(redact({ failure: error.message, outputDir }, [...(qa?.secrets ?? [])]));
  process.exitCode = 1;
});
