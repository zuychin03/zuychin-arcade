const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { createEvidence, bundleFence, guardNetwork, local, matchArenaLabel } = require('./tokyo-ui-evidence.cjs');

const BASE_URL = process.env.TOKYO_WEB_URL ?? 'http://127.0.0.1:8081';
const API_URL = process.env.TOKYO_API_URL ?? 'http://127.0.0.1:3213';
const BROWSER_PATH = process.env.BROWSER_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const outputDir = process.env.TOKYO_UI_OUTPUT_DIR ?? path.join(os.tmpdir(), `zuychin-arcade-tokyo-ui-${runId}`);
const consoleIssues = [];
const qa = createEvidence({ outputDir, base: BASE_URL, api: API_URL });
qa.evidence.consoleIssues = consoleIssues;
const ownedPlayers = [];
const safeError = error => String(error instanceof Error ? error.message : error).replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted]');

async function rememberAuth(actor) {
  if (new URL(actor.page.url()).origin !== new URL(BASE_URL).origin) return;
  const auth = await actor.page.evaluate(() => JSON.parse(sessionStorage.getItem('za:auth') ?? 'null'));
  if (auth?.token && auth?.playerId && auth?.roomCode) actor.auth = auth;
}

async function cleanupPlayer(actor) {
  if (actor.cleaned) return;
  await rememberAuth(actor).catch(() => {});
  if (!actor.auth) { actor.cleaned = true; return; }
  const result = { actor: actor.name, normalUI: false, status: null, authCleared: false };
  try {
    const leaveResponse = actor.page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/rooms/${actor.auth.roomCode}/leave`, { timeout: 10000 });
    leaveResponse.catch(() => {});
    if (await hasButton(actor.page, /^LEAVE TABLE$/)) await clickButton(actor.page, /^LEAVE TABLE$/, 3000);
    else if (await hasButton(actor.page, /^LEAVE ROOM$/)) await clickButton(actor.page, /^LEAVE ROOM$/, 3000);
    else await clickButton(actor.page, /^Leave game$/, 3000);
    if (await hasButton(actor.page, /^LEAVE$/)) await clickButton(actor.page, /^LEAVE$/, 3000);
    result.status = (await leaveResponse).status();
    await waitUntil(() => actor.page.evaluate(() => location.pathname === '/' && sessionStorage.getItem('za:auth') === null), 'normal leave and auth clearance', 10000);
    assert(result.status === 200, 'Normal leave failed'); result.normalUI = true; result.authCleared = true;
  } catch (error) {
    result.uiError = safeError(error);
    const response = await fetch(`${API_URL}/rooms/${actor.auth.roomCode}/leave`, { method: 'POST', headers: { Authorization: `Bearer ${actor.auth.token}` }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    result.status = response.status();
    assert(response.status === 200, 'Owned fallback leave failed');
  } finally { qa.evidence.cleanup.push(result); qa.persist(); }
  actor.cleaned = true;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const checkpoint = (message) => console.log(`[tokyo-ui-smoke] ${message}`);

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function waitUntil(check, message, timeout = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await delay(120);
  }
  throw new Error(`Timed out: ${message}`);
}

async function setInput(page, label, value) {
  const selector = `input[aria-label="${label}"]`;
  await waitUntil(() => page.evaluate((inputLabel) => [...document.querySelectorAll(`input[aria-label="${inputLabel}"]`)]
    .some((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }), label), `visible input ${label}`);
  const inputs = await page.$$(selector);
  let input = null;
  for (const candidate of inputs) {
    const visible = await candidate.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });
    if (visible && !input) input = candidate;
    else await candidate.dispose();
  }
  assert(input, `Could not find visible input ${label}`);
  try {
    await input.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    if (value) await page.keyboard.type(value);
    await waitUntil(() => input.evaluate((element, expectedValue) => element.value === expectedValue, value), `input ${label} value` , 10_000);
    await delay(80);
  } finally {
    await input.dispose();
  }
}

async function buttonLabels(page, enabledOnly = false) {
  return page.evaluate((onlyEnabled) => [...document.querySelectorAll('[role="button"][aria-label]')]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      return visible && (!onlyEnabled || (element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('disabled')));
    })
    .map((element) => element.getAttribute('aria-label'))
    .filter(Boolean), enabledOnly);
}

async function hasButton(page, pattern, enabledOnly = true) {
  return (await buttonLabels(page, enabledOnly)).some((label) => pattern.test(label));
}

async function findButtonHandle(page, pattern) {
  const buttons = await page.$$('[role="button"][aria-label]');
  for (let index = 0; index < buttons.length; index += 1) {
    const button = buttons[index];
    const matches = await button.evaluate((element, matcher) => {
      const pattern = new RegExp(matcher.source, matcher.flags);
      const label = element.getAttribute('aria-label') ?? '';
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return pattern.test(label)
        && rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && element.getAttribute('aria-disabled') !== 'true'
        && !element.hasAttribute('disabled');
    }, { source: pattern.source, flags: pattern.flags });
    if (matches) {
      await Promise.all(buttons.slice(index + 1).map((candidate) => candidate.dispose()));
      return button;
    }
    await button.dispose();
  }
  return null;
}

async function scrollButtonIntoClickableView(button) {
  await button.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await delay(80);
  return button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const x = rect.left + (rect.width / 2);
    const y = rect.top + (rect.height / 2);
    const hit = document.elementFromPoint(x, y);
    return {
      label: element.getAttribute('aria-label'),
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
      viewport: { width: innerWidth, height: innerHeight },
      visible: rect.width > 0
        && rect.height > 0
        && rect.left >= -1
        && rect.right <= innerWidth + 1
        && rect.top >= -1
        && rect.bottom <= innerHeight + 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.visibility !== 'collapse'
        && Number.parseFloat(style.opacity || '1') > 0
        && style.pointerEvents !== 'none',
      hit: hit === element || element.contains(hit),
      hitLabel: hit instanceof HTMLElement ? hit.getAttribute('aria-label') ?? hit.textContent?.trim().slice(0, 120) : null,
    };
  });
}

async function clickButton(page, pattern, timeout = 45_000) {
  await waitUntil(() => hasButton(page, pattern), `button ${pattern}`, timeout);
  const button = await findButtonHandle(page, pattern);
  assert(button, `Could not find enabled button ${pattern}`);
  try {
    const clickability = await scrollButtonIntoClickableView(button);
    assert(clickability.visible, `Button is outside the usable viewport: ${JSON.stringify(clickability)}`);
    assert(clickability.hit, `Button is occluded at its centre point: ${JSON.stringify(clickability)}`);
    const bounds = await button.boundingBox();
    assert(bounds && bounds.width > 0 && bounds.height > 0, `Button has no clickable bounds: ${JSON.stringify(clickability)}`);
    if (page.viewport()?.hasTouch) await page.touchscreen.tap(bounds.x + (bounds.width / 2), bounds.y + (bounds.height / 2));
    else await page.mouse.click(bounds.x + (bounds.width / 2), bounds.y + (bounds.height / 2));
    await delay(140);
  } finally {
    await button.dispose();
  }
}

async function clickButtonsConcurrently(players, pattern) {
  const targets = [];
  try {
    for (const player of players) {
      const button = await findButtonHandle(player.page, pattern);
      assert(button, `${player.name} lost concurrent button ${pattern}`);
      const clickability = await scrollButtonIntoClickableView(button);
      assert(clickability.visible && clickability.hit, `${player.name}'s concurrent button is not reachable: ${JSON.stringify(clickability)}`);
      const bounds = await button.boundingBox();
      assert(bounds && bounds.width > 0 && bounds.height > 0, `${player.name}'s concurrent button has no bounds`);
      targets.push({ player, button, bounds });
    }
    await Promise.all(targets.map(({ player, bounds }) => player.page.viewport()?.hasTouch
      ? player.page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      : player.page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)));
    await delay(300);
  } finally {
    await Promise.all(targets.map(({ button }) => button.dispose()));
  }
}

async function waitForText(page, text, timeout = 45_000) {
  await page.waitForFunction((needle) => document.body.innerText.includes(needle), { timeout }, text);
}

async function scrollTextIntoView(page, text) {
  await waitForText(page, text);
  const found = await page.evaluate((needle) => {
    const element = [...document.querySelectorAll('*')]
      .find((candidate) => candidate.children.length === 0 && candidate.textContent?.includes(needle));
    if (!(element instanceof HTMLElement)) return false;
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  }, text);
  assert(found, `Could not find rendered text ${text}`);
  await waitUntil(() => page.evaluate((needle) => {
    const element = [...document.querySelectorAll('*')]
      .find((candidate) => candidate.children.length === 0 && candidate.textContent?.includes(needle));
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0
      && rect.left >= -1 && rect.right <= innerWidth + 1
      && rect.top >= -1 && rect.bottom <= innerHeight + 1
      && style.display !== 'none' && style.visibility !== 'hidden';
  }, text), `text in usable viewport: ${text}`);
}

async function waitForPath(page, suffix) {
  await page.waitForFunction((expected) => location.pathname.endsWith(expected), { timeout: 45_000 }, suffix);
}

async function scrollEvidenceState(page) {
  return page.evaluate(() => {
    const candidates = [document.scrollingElement, ...document.querySelectorAll('*')]
      .filter((element) => element instanceof HTMLElement)
      .map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const scrollRange = element.scrollHeight - element.clientHeight;
        const explicitScroller = style.overflowY === 'auto' || style.overflowY === 'scroll';
        return { element, rect, scrollRange, explicitScroller };
      })
      .filter(({ element, rect, scrollRange, explicitScroller }) => scrollRange > 4
        && rect.width > 0
        && rect.height > 0
        && (explicitScroller || document.scrollingElement === element))
      .sort((left, right) => {
        if (left.explicitScroller !== right.explicitScroller) return Number(right.explicitScroller) - Number(left.explicitScroller);
        if (left.scrollRange !== right.scrollRange) return right.scrollRange - left.scrollRange;
        return (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height);
      });
    const selected = candidates[0]?.element ?? document.scrollingElement;
    if (!(selected instanceof HTMLElement)) return null;
    return {
      original: selected.scrollTop,
      maximum: Math.max(0, selected.scrollHeight - selected.clientHeight),
    };
  });
}

async function setPrimaryScrollPosition(page, position) {
  return page.evaluate((nextPosition) => {
    const candidates = [document.scrollingElement, ...document.querySelectorAll('*')]
      .filter((element) => element instanceof HTMLElement)
      .map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const scrollRange = element.scrollHeight - element.clientHeight;
        const explicitScroller = style.overflowY === 'auto' || style.overflowY === 'scroll';
        return { element, rect, scrollRange, explicitScroller };
      })
      .filter(({ element, rect, scrollRange, explicitScroller }) => scrollRange > 4
        && rect.width > 0
        && rect.height > 0
        && (explicitScroller || document.scrollingElement === element))
      .sort((left, right) => {
        if (left.explicitScroller !== right.explicitScroller) return Number(right.explicitScroller) - Number(left.explicitScroller);
        if (left.scrollRange !== right.scrollRange) return right.scrollRange - left.scrollRange;
        return (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height);
      });
    const selected = candidates[0]?.element ?? document.scrollingElement;
    if (!(selected instanceof HTMLElement)) return null;
    selected.scrollTop = Math.max(0, Math.min(nextPosition, selected.scrollHeight - selected.clientHeight));
    return selected.scrollTop;
  }, position);
}

async function screenshot(page, name, includeScrollEvidence = false) {
  await qa.capture(page, name, { allowDisconnected: name.includes('offline-gate') });
  if (!includeScrollEvidence) return;

  const scroll = await scrollEvidenceState(page);
  if (!scroll || scroll.maximum <= 4) return;
  const extension = path.extname(name);
  const stem = name.slice(0, -extension.length);
  const positions = [
    ['top', 0],
    ['bottom', scroll.maximum],
  ];
  try {
    for (const [label, position] of positions) {
      if (Math.abs(position - scroll.original) <= 4) continue;
      await setPrimaryScrollPosition(page, position);
      await delay(160);
      await qa.capture(page, `${stem}-scroll-${label}${extension}`, { allowDisconnected: name.includes('offline-gate') });
    }
  } finally {
    await setPrimaryScrollPosition(page, scroll.original);
  }
}

async function screenshotButtonInView(page, name, pattern) {
  const button = await findButtonHandle(page, pattern);
  assert(button, `Could not find evidence button ${pattern}`);
  try {
    const clickability = await scrollButtonIntoClickableView(button);
    assert(clickability.visible && clickability.hit, `Evidence button is not physically reachable: ${JSON.stringify(clickability)}`);
    await qa.capture(page, name);
  } finally {
    await button.dispose();
  }
}

async function openPlayer(browser, name, width, height) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const requestIssues = [];
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 600, hasTouch: width < 600 });
  await guardNetwork(page, qa.origins, qa.evidence.blockedRequests);
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleIssues.push({ player: name, type: message.type(), text: safeError(message.text()) });
    }
  });
  page.on('pageerror', (error) => consoleIssues.push({ player: name, type: 'pageerror', text: safeError(error) }));
  page.on('requestfailed', (request) => {
    requestIssues.push({
      kind: 'requestfailed',
      method: request.method(),
      url: request.url().replace(/[?#].*$/, ''),
      reason: request.failure()?.errorText ?? 'unknown',
    });
    if (requestIssues.length > 20) requestIssues.shift();
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    requestIssues.push({
      kind: 'http',
      method: response.request().method(),
      url: response.url().replace(/[?#].*$/, ''),
      status: response.status(),
    });
    if (requestIssues.length > 20) requestIssues.shift();
  });
  const actor = { name, context, page, requestIssues, left: false, width, height, state: null, acks: [], rejects: [] };
  ownedPlayers.push(actor); qa.register(actor);
  page.on('response', response => {
    if (response.request().method() === 'POST' && /^\/rooms\/(create|join)$/.test(new URL(response.url()).pathname)) void response.json().then(value => {
      if (value?.token && value?.playerId && value?.roomCode) actor.auth = { token: value.token, playerId: value.playerId, roomCode: value.roomCode };
    }).catch(() => {});
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    if (!response.payloadData.startsWith('42')) return;
    try {
      const [event, value] = JSON.parse(response.payloadData.slice(2));
      if (event === 'game_state' && value?.gameId === 'king_of_tokyo' && Number.isSafeInteger(value.revision)
        && (!actor.auth || value.viewerPlayerId === actor.auth.playerId && value.roomCode === actor.auth.roomCode)
        && (!actor.state || value.revision >= actor.state.revision)) actor.state = value;
      if (event === 'king_of_tokyo:action_accepted') { actor.acks.push(value); actor.lastAcceptedAt = Date.now(); }
      if (event === 'action_rejected') actor.rejects.push(value);
    } catch {}
  });
  return actor;
}

async function collectJoinDiagnostics(player) {
  const pageState = await player.page.evaluate(() => ({
    url: location.href.replace(/[?#].*$/, ''),
    readyState: document.readyState,
    viewport: { width: innerWidth, height: innerHeight },
    documentSize: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    activeElement: document.activeElement instanceof HTMLElement
      ? document.activeElement.getAttribute('aria-label') ?? document.activeElement.tagName
      : null,
    inputs: [...document.querySelectorAll('input')].map((input) => ({
      label: input.getAttribute('aria-label'),
      type: input.type,
      valueLength: input.value.length,
    })),
    buttons: [...document.querySelectorAll('[role="button"][aria-label]')].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.getAttribute('aria-label'),
        disabled: element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled'),
        rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
      };
    }),
    scrollSurfaces: [...document.querySelectorAll('*')]
      .filter((element) => element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 4)
      .map((element) => ({
        tag: element.tagName,
        label: element.getAttribute('aria-label'),
        scrollTop: element.scrollTop,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
      }))
      .sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight))
      .slice(0, 8),
    text: document.body?.innerText.slice(0, 2500) ?? '',
  }));
  return {
    ...pageState,
    requestIssues: player.requestIssues.slice(-10),
    consoleIssues: consoleIssues.filter((issue) => issue.player === player.name).slice(-10),
  };
}

async function joinPlayer(player, roomCode, password, options = {}) {
  try {
    await player.page.goto(`${BASE_URL}/king-of-tokyo/join`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (options.headerBack) {
      const originalViewport = player.page.viewport();
      await player.page.setViewport({ ...originalViewport, width: 320, height: 800 });
      try {
        await waitUntil(() => hasButton(player.page, /^Back to King of Tokyo$/, false), 'Join header Back mounted');
        const rect = await player.page.evaluate(() => {
          const element = document.querySelector('[role="button"][aria-label="Back to King of Tokyo"]');
          if (!(element instanceof HTMLElement)) return null;
          const bounds = element.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height, left: bounds.left, right: bounds.right, viewportWidth: innerWidth };
        });
        assert(rect && rect.width >= 48 && rect.height >= 48 && rect.left >= -1 && rect.right <= rect.viewportWidth + 1, `Join header Back target failed at 320px: ${JSON.stringify(rect)}`);
        await clickButton(player.page, /^Back to King of Tokyo$/);
        await player.page.waitForFunction(() => location.pathname === '/king-of-tokyo', { timeout: 45_000 });
        await setInput(player.page, 'Your name', player.name);
        await clickButton(player.page, /^JOIN WITH CODE$/);
        await waitForPath(player.page, '/king-of-tokyo/join');
      } finally {
        if (originalViewport) await player.page.setViewport(originalViewport);
      }
    }
    await setInput(player.page, 'Your name', player.name);
    if (options.validation) {
      await setInput(player.page, 'Room code', 'BAD');
      await clickButton(player.page, /^JOIN GAME$/);
      await waitForText(player.page, 'Enter a valid room code');
    }
    await setInput(player.page, 'Room code', roomCode);
    if (options.wrongPassword) {
      const expectedRequestStart = player.requestIssues.length;
      const expectedConsoleStart = consoleIssues.length;
      await setInput(player.page, 'Room password, optional', password !== password.trim() ? password.trim() : 'wrong-password');
      await clickButton(player.page, /^JOIN GAME$/);
      await waitUntil(() => player.requestIssues.slice(expectedRequestStart).some(issue => issue.status === 403), 'wrong password rejected');
      if (await hasButton(player.page, /^OK$/)) await clickButton(player.page, /^OK$/);
      await waitUntil(() => hasButton(player.page, /^JOIN GAME$/), 'wrong-password request settled');
      assert(
        player.requestIssues.slice(expectedRequestStart).some((issue) =>
          issue.kind === 'http' && issue.status === 403 && issue.method === 'POST' && issue.url.endsWith('/rooms/join')),
        'Wrong-password validation did not receive the expected room-join 403',
      );
      for (let index = consoleIssues.length - 1; index >= expectedConsoleStart; index -= 1) {
        const issue = consoleIssues[index];
        if (issue.player === player.name && issue.type === 'error' && /Failed to load resource:.*403 \(Forbidden\)/.test(issue.text)) {
          consoleIssues.splice(index, 1);
        }
      }
    }
    await setInput(player.page, 'Room password, optional', password);
    await clickButton(player.page, /^JOIN GAME$/);
    await waitForPath(player.page, '/king-of-tokyo/lobby');
  } catch (error) {
    const safeName = player.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'guest';
    let screenshotPath = null;
    let diagnostics = null;
    try {
      screenshotPath = path.join(outputDir, `join-failure-${safeName}.png`);
      await player.page.screenshot({ path: screenshotPath, fullPage: false });
    } catch (screenshotError) {
      screenshotPath = `unavailable: ${screenshotError instanceof Error ? screenshotError.message : String(screenshotError)}`;
    }
    try {
      diagnostics = await collectJoinDiagnostics(player);
    } catch (diagnosticError) {
      diagnostics = { unavailable: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) };
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Guest join failed for ${player.name} in room ${roomCode}: ${reason}\nScreenshot: ${screenshotPath}\nDiagnostics: ${JSON.stringify(diagnostics, null, 2)}`);
  }
}

async function createMatch(browser, prefix, specs, password, evidencePrefix) {
  const players = [];
  for (const spec of specs) players.push(await openPlayer(browser, `${prefix} ${spec.name}`, spec.width, spec.height));
  const host = players[0];
  await host.page.goto(`${BASE_URL}/king-of-tokyo`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await setInput(host.page, 'Your name', host.name);
  await setInput(host.page, 'Room password, optional', password);
  const landingViewport = host.page.viewport();
  await host.page.setViewport({ ...landingViewport, width: 320, height: 800 });
  try {
    const backBounds = await host.page.evaluate(() => {
      const element = document.querySelector('[role="button"][aria-label="Back to arcade"]');
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, viewportWidth: innerWidth };
    });
    assert(backBounds && backBounds.width >= 48 && backBounds.height >= 48 && backBounds.left >= -1 && backBounds.right <= backBounds.viewportWidth + 1, `Landing Back target failed at 320px: ${JSON.stringify(backBounds)}`);
    await screenshot(host.page, `${evidencePrefix}-01a-landing-320.png`, true);
  } finally {
    if (landingViewport) await host.page.setViewport(landingViewport);
  }
  await screenshot(host.page, `${evidencePrefix}-01-landing-${host.width}.png`, true);
  const entranceDesktop = players.find(p => p.width >= 1000);
  if (entranceDesktop) {
    await entranceDesktop.page.goto(`${BASE_URL}/king-of-tokyo`, { waitUntil: 'domcontentloaded' });
    await screenshot(entranceDesktop.page, `${evidencePrefix}-01b-entrance-desktop.png`);
  }
  const phoneEntrance = host.page.viewport();
  try { await host.page.setViewport({ ...phoneEntrance, width: 844, height: 390 }); await screenshot(host.page, `${evidencePrefix}-01c-entrance-short-landscape.png`); }
  finally { await host.page.setViewport(phoneEntrance); }
  await clickButton(host.page, /^HOW TO PLAY$/);
  await waitForText(host.page, 'DIGITAL TABLE');
  await waitForText(host.page, 'whether or not you rolled Smash');
  await waitForText(host.page, 'Bay closes');
  await screenshot(host.page, `${evidencePrefix}-02-rules-${host.width}.png`);
  await scrollTextIntoView(host.page, 'Rolled Hearts cannot heal a monster in Tokyo.');
  await screenshot(host.page, `${evidencePrefix}-02a-rules-tokyo-hearts-${host.width}.png`);
  await clickButton(host.page, /^Close rules$/);
  await clickButton(host.page, /^CREATE ROOM$/);
  await waitForPath(host.page, '/king-of-tokyo/lobby');
  await rememberAuth(host);
  const roomCode = await host.page.evaluate(() => document.body.innerText.match(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/)?.[0] ?? null);
  assert(roomCode, 'Room code was not visible after creation');

  await joinPlayer(players[1], roomCode, password, { validation: true, wrongPassword: true, headerBack: true });
  await waitForText(host.page, players[1].name);
  await rememberAuth(players[1]);

  await players[1].page.goto('about:blank');
  await waitUntil(() => host.page.evaluate((name) => document.body.innerText.includes(name) && document.body.innerText.includes('RECONNECTING'), players[1].name), 'offline reservation shown in lobby');
  assert(await hasButton(host.page, /^WAITING FOR RECONNECTION$/, false), 'offline reservation incorrectly enabled Start');
  await screenshot(host.page, `${evidencePrefix}-03-lobby-offline-gate-${host.width}.png`, true);
  await players[1].page.goto(`${BASE_URL}/king-of-tokyo/lobby`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForPath(players[1].page, '/king-of-tokyo/lobby');
  await waitUntil(() => hasButton(host.page, /^START GAME$/), 'reconnected player restored Start eligibility');

  for (let index = 2; index < players.length; index += 1) {
    await joinPlayer(players[index], roomCode, password);
  }
  await waitForText(host.page, players.at(-1).name);
  await assertRoomCodeFits(host, roomCode);
  await assertRoomCodeFits(players[1], roomCode);
  await assertLobbyHeaderHasNoAction(host);
  await exerciseLobbyAt320(host, roomCode, `${evidencePrefix}-04a-lobby-320.png`);
  await screenshot(host.page, `${evidencePrefix}-04-lobby-mobile-${host.width}.png`, true);
  const desktop = players.find((player) => player.width >= 1000);
  if (desktop) await screenshot(desktop.page, `${evidencePrefix}-05-lobby-desktop-${desktop.width}.png`, true);
  if (desktop) await exerciseTwoHundredPercentZoom(desktop, `${evidencePrefix}-05a-lobby-200-percent.png`, [/^HOW TO PLAY$/, /^LEAVE ROOM$/]);
  await exerciseTwoHundredPercentZoom(host, `${evidencePrefix}-05b-lobby-phone-200-percent.png`, [/^START GAME$/, /^LEAVE ROOM$/]);

  const guardPlayer = desktop ?? players[1];
  await guardPlayer.page.waitForFunction(() => window.__zuychinArcadeBackGuardReady === location.href, { timeout: 45_000 });
  await guardPlayer.page.evaluate(() => setTimeout(() => history.back(), 0));
  await waitForText(guardPlayer.page, 'Leave room?');
  assert(await guardPlayer.page.evaluate(() => location.pathname === '/king-of-tokyo/lobby'), 'Browser Back escaped the active lobby');
  await guardPlayer.page.keyboard.press('Tab');
  await waitUntil(() => guardPlayer.page.evaluate(() => {
    const active = document.activeElement;
    const dialog = document.querySelector('[role="alertdialog"]');
    if (!active || !dialog || active === document.body) return false;
    let portal = dialog;
    while (portal.parentElement && portal.parentElement !== document.body) portal = portal.parentElement;
    return portal.contains(active);
  }), 'leave dialog keyboard focus');
  await clickButton(guardPlayer.page, /^STAY$/);
  assert(await guardPlayer.page.evaluate(() => location.pathname === '/king-of-tokyo/lobby'), 'Stay did not preserve lobby route');

  await clickButton(host.page, /^START GAME$/);
  await Promise.all(players.map((player) => waitForPath(player.page, '/king-of-tokyo/game')));
  checkpoint(`${players.length}-player room ${roomCode} entered gameplay`);
  return { players, roomCode, host, sawHealingRuleInRulebook: true };
}

async function findPlayerWithButton(players, pattern) {
  for (const player of players.filter((candidate) => !candidate.left)) {
    if (await hasButton(player.page, pattern)) return player;
  }
  return null;
}

async function findPlayerWithText(players, text) {
  for (const player of players.filter((candidate) => !candidate.left)) {
    if (await player.page.evaluate((value) => document.body.innerText.includes(value), text)) return player;
  }
  return null;
}

async function panelState(observer, displayName) {
  const label = await observer.page.evaluate((name) => [...document.querySelectorAll('[aria-label]')]
    .map((element) => element.getAttribute('aria-label'))
    .find((value) => value?.startsWith(`${name}.`) && value.includes(' health, ') && value.includes(' victory points,')) ?? null, displayName);
  if (!label) return null;
  const match = label.match(/\. ([^.]+)\. (\d+) health, (\d+) victory points, (\d+) energy, (\d+) power cards/);
  return match ? { label, status: match[1], health: Number(match[2]), vp: Number(match[3]), energy: Number(match[4]), powers: Number(match[5]) } : { label };
}

async function arenaState(observer) {
  const label = await observer.page.evaluate(() => [...document.querySelectorAll('[aria-label]')]
    .map((element) => element.getAttribute('aria-label'))
    .find((value) => value?.startsWith('Tokyo arena,')) ?? null);
  return matchArenaLabel(label, observer.state);
}

async function assertNoHorizontalOverflow(player) {
  const dimensions = await player.page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert(dimensions.content <= dimensions.viewport + 1, `${player.name} has horizontal overflow ${JSON.stringify(dimensions)}`);
}

async function assertRoomCodeFits(player, roomCode) {
  const result = await player.page.evaluate((label) => {
    const element = document.querySelector(`[aria-label="${label}"]`);
    if (!(element instanceof HTMLElement)) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: innerWidth, whiteSpace: style.whiteSpace };
  }, `Room code ${roomCode}`);
  assert(result, `Room code ${roomCode} was not exposed semantically`);
  assert(result.left >= -1 && result.right <= result.viewportWidth + 1, `Room code clipped: ${JSON.stringify(result)}`);
}

async function assertLobbyHeaderHasNoAction(player) {
  const actions = await player.page.evaluate(() => [...document.querySelectorAll('[role="button"], [role="link"], a, button')]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '', x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })
    .filter((item) => item.width > 0 && item.height > 0 && item.y < 72));
  assert(actions.length === 0, `Lobby exposed an unexpected header action: ${JSON.stringify(actions)}`);
}

async function exerciseLobbyAt320(player, roomCode, name) {
  const originalViewport = player.page.viewport();
  await player.page.setViewport({ ...originalViewport, width: 320, height: 800 });
  try {
    await delay(200);
    await assertNoHorizontalOverflow(player);
    await assertRoomCodeFits(player, roomCode);
    await assertLobbyHeaderHasNoAction(player);
    await screenshot(player.page, name, true);
  } finally {
    if (originalViewport) await player.page.setViewport(originalViewport);
  }
}

async function exerciseTwoHundredPercentZoom(player, name, requiredButtons) {
  await qa.capture(player.page, name, { scale: true });
  for (let index = 0; index < requiredButtons.length; index += 1) {
    const button = await findButtonHandle(player.page, requiredButtons[index]);
    assert(button, `Missing enlarged control ${requiredButtons[index]}`);
    const id = `tokyo-qa-control-${index}`;
    await button.evaluate((node, value) => node.setAttribute('data-tokyo-qa-control', value), id);
    try {
      await qa.capture(player.page, name.replace('.png', `-control-${index}.png`), { scale: true, frame: `[data-tokyo-qa-control="${id}"]` });
    } finally { await button.evaluate(node => node.removeAttribute('data-tokyo-qa-control')); await button.dispose(); }
  }
}

async function syncDiceSelection(player, strategy, forceNoSmash) {
  const dice = await player.page.evaluate(() => [...document.querySelectorAll('[role="button"][aria-label^="Die "]')].map((element) => ({
    label: element.getAttribute('aria-label'),
    selected: element.getAttribute('aria-selected') === 'true',
  })));
  const parsed = dice.map((die, index) => {
    const match = die.label?.match(/^Die (\d+): ([^,]+)(?:, .+)?$/);
    return { ...die, index, face: match?.[2] ?? 'not rolled' };
  });
  let desiredFaces = new Set();
  if (forceNoSmash) {
    desiredFaces = new Set(parsed.filter((die) => die.face !== 'smash').map((die) => die.index));
  } else if (strategy === 'energy') {
    desiredFaces = new Set(parsed.filter((die) => die.face === 'energy').map((die) => die.index));
  } else if (strategy === 'combat') {
    desiredFaces = new Set(parsed.filter((die) => die.face === 'smash').map((die) => die.index));
  } else if (strategy === 'hearts') {
    desiredFaces = new Set(parsed.filter((die) => die.face === 'heal').map((die) => die.index));
  } else {
    const groups = [1, 2, 3].map((face) => ({ face: String(face), count: parsed.filter((die) => die.face === String(face)).length }));
    groups.sort((a, b) => b.count - a.count || Number(b.face) - Number(a.face));
    desiredFaces = new Set(parsed.filter((die) => die.face === groups[0].face).map((die) => die.index));
  }
  let toggled = false;
  for (const die of parsed) {
    if (die.selected !== desiredFaces.has(die.index)) {
      await clickButton(player.page, new RegExp(`^Die ${die.index + 1}:`));
      toggled = true;
    }
  }
  return { parsed, toggled };
}

async function marketButton(player, { keepOnly = false, discardOnly = false, cardName = null, excludeCardNames = [] } = {}) {
  return player.page.evaluate(({ onlyKeep, onlyDiscard, wantedCard, excludedCards }) => {
    const buttons = [...document.querySelectorAll('[role="button"][aria-label^="BUY "]')];
    for (const button of buttons) {
      const label = button.getAttribute('aria-label') ?? '';
      if (button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('disabled')) continue;
      if (wantedCard && !label.endsWith(`: ${wantedCard}`)) continue;
      if (excludedCards.some((cardName) => label.endsWith(`: ${cardName}`))) continue;
      let node = button.parentElement;
      let cardText = '';
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        const text = node.innerText ?? '';
        if (text.length < 900 && /(?:KEEP|DISCARD) ·/.test(text)) {
          cardText = text;
          break;
        }
      }
      if (onlyKeep && !cardText.includes('KEEP ·')) continue;
      if (onlyDiscard && !cardText.includes('DISCARD ·')) continue;
      return { label, keep: cardText.includes('KEEP ·') };
    }
    return null;
  }, { onlyKeep: keepOnly, onlyDiscard: discardOnly, wantedCard: cardName, excludedCards: excludeCardNames });
}

async function clickExactLabel(page, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await clickButton(page, new RegExp(`^${escaped}$`));
}

async function chooseMimicTarget(player, players, evidencePrefix) {
  await waitForText(player.page, 'CHOOSE MIMIC POWER');
  assert(!await hasButton(player.page, /^CHOOSE COPY: Mimic$/, false), 'Initial Mimic still exposed the duplicate deep-card chooser');
  const observer = players.find((candidate) => !candidate.left && candidate !== player);
  if (observer) {
    await waitUntil(
      () => observer.page.evaluate((ownerName) => document.body.innerText.includes(`${ownerName} is choosing Mimic`), player.name),
      'Mimic owner named to other viewers',
    );
  }
  const eligibleNames = players.filter((candidate) => !candidate.left).map((candidate) => candidate.name);
  const originalViewport = player.page.viewport();
  await player.page.setViewport({ ...originalViewport, width: 320, height: 800 });
  try {
    await assertNoHorizontalOverflow(player);
    const mimicState = await player.page.evaluate((names) => {
      const controls = [...document.querySelectorAll('[role="button"][aria-label]')];
      const blockedPattern = /^(?:BUY(?:\s|\s*·)|SWEEP ALL 3|END TURN$|DONE SELLING$|SELL\s*·|PASS$|EXTRA REROLL|REROLL A 3|CHANGE DIE|CHOOSE COPY:|HEAL (?!1\s*·\s*2 ENERGY))/;
      const enabledBlocked = controls
        .filter((element) => element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('disabled'))
        .map((element) => element.getAttribute('aria-label') ?? '')
        .filter((label) => blockedPattern.test(label));
      const heading = [...document.querySelectorAll('*')]
        .find((element) => element.children.length === 0 && element.textContent?.trim() === 'CHOOSE MIMIC POWER');
      const target = controls
        .map((element) => ({ element, label: element.getAttribute('aria-label') ?? '' }))
        .filter(({ element, label }) => names.some((name) => label.startsWith(`COPY ${name} · `)) && element.getAttribute('aria-disabled') !== 'true')
        .sort((left, right) => right.label.length - left.label.length)
        .map(({ element, label }) => {
          element.scrollIntoView({ block: 'center', inline: 'nearest' });
          const rect = element.getBoundingClientRect();
          const headingRect = heading?.getBoundingClientRect();
          return {
            label,
            left: rect.left,
            right: rect.right,
            viewportWidth: innerWidth,
            targetDocumentTop: rect.top + scrollY,
            headingDocumentBottom: headingRect ? headingRect.bottom + scrollY : null,
          };
        })[0] ?? null;
      return { enabledBlocked, target };
    }, eligibleNames);
    const target = mimicState.target;
    assert(target, 'Mimic target list was empty');
    assert(target.left >= -1 && target.right <= target.viewportWidth + 1, `Mimic target overflowed at 320px: ${JSON.stringify(target)}`);
    assert(target.headingDocumentBottom !== null && target.targetDocumentTop > target.headingDocumentBottom && target.targetDocumentTop - target.headingDocumentBottom < 500, `Mimic target was not surfaced beneath the status: ${JSON.stringify(target)}`);
    assert(mimicState.enabledBlocked.length === 0, `Initial Mimic left server-blocked actions enabled: ${JSON.stringify(mimicState.enabledBlocked)}`);
    await screenshot(player.page, `${evidencePrefix}-09-mimic-target-320.png`);
    await clickExactLabel(player.page, target.label);
    await waitUntil(
      () => player.page.evaluate(() => !document.body.innerText.includes('CHOOSE MIMIC POWER')),
      'Mimic target resolved',
    );
  } finally {
    if (originalViewport) await player.page.setViewport(originalViewport);
  }
}

async function leaveActivePlayer(player, observer, evidenceName) {
  await clickButton(player.page, /^Leave game$/);
  await waitForText(player.page, 'Leaving forfeits your monster');
  await screenshot(player.page, evidenceName);
  await clickButton(player.page, /^LEAVE$/);
  await player.page.waitForFunction(() => location.pathname === '/' || location.pathname === '', { timeout: 45_000 });
  player.left = true;
  await waitUntil(async () => (await panelState(observer, player.name))?.status === 'LEFT', `${player.name} marked LEFT`);
  await player.page.evaluate(() => setTimeout(() => history.back(), 0));
  await delay(500);
  const pathname = await player.page.evaluate(() => location.pathname);
  assert(pathname === '/' || pathname === '', `Confirmed Leave resurrected a protected route: ${pathname}`);
  return pathname || '/';
}

async function exerciseGameBackGuard(player) {
  await player.page.waitForFunction(() => window.__zuychinArcadeBackGuardReady === location.href, { timeout: 45_000 });
  await player.page.evaluate(() => setTimeout(() => history.back(), 0));
  await waitForText(player.page, 'Leaving forfeits your monster');
  assert(await player.page.evaluate(() => location.pathname === '/king-of-tokyo/game'), 'Browser Back escaped active game');
  await clickButton(player.page, /^STAY$/);
}

async function driveMatch(players, options) {
  const evidence = {
    actions: 0,
    sawOrderChoice: false,
    sawDiceSelection: false,
    sawReroll: false,
    sawForcedCity: false,
    sawForcedNoSmashCity: false,
    sawBay: false,
    sawBayMigration: false,
    sawYield: false,
    sawCityBayDecisionSequence: false,
    sawPurchase: false,
    sawKeepPurchase: false,
    sawSweep: false,
    sawMimicCopy: false,
    sawMetamorphPurchase: false,
    sawMetamorphWindow: false,
    sawMetamorphSale: false,
    sawHealingRestriction: false,
    sawHealingRayAssignment: false,
    confirmedLeaveBackPath: null,
    firstResolutionHadSmash: null,
    sawDefenseDecision: false,
    sawConcurrentFirstRoll: false,
    maxConcurrentFirstRollers: 0,
  };
  const keepOwners = new Set();
  const nonMetamorphKeepOwners = new Set();
  const metamorphOwners = new Set();
  let firstResolutionPending = true;
  let marketSweeps = 0;
  let idleLoops = 0;
  let consecutiveTokyoDecisions = 0;
  const materialCaptures = new Set();

  while (true) {
    if (evidence.actions > 800) throw new Error(`Match exceeded bounded 800 decisions: ${JSON.stringify(evidence)}`);
    const activePlayers = players.filter((player) => !player.left);
    if (activePlayers.some((player) => player.page.url().includes('/king-of-tokyo/game') && player.page.url())) {
      const gameOverPlayer = await findPlayerWithButton(activePlayers, /^LEAVE TABLE$/);
      if (gameOverPlayer) break;
    }

    const observer = activePlayers[0];
    const arena = await arenaState(observer);
    if (arena?.city && arena.city !== 'nobody') evidence.sawForcedCity = true;
    if (arena?.bay && arena.bay !== 'nobody') evidence.sawBay = true;

    if (options.leaveCityForBay && evidence.sawBay && evidence.sawCityBayDecisionSequence && !evidence.sawBayMigration) {
      const cityPlayer = players.find((player) => player.name === arena.city && !player.left);
      const bayName = arena.bay;
      assert(cityPlayer && bayName, `Could not identify City/Bay occupants from ${arena.label}`);
      evidence.confirmedLeaveBackPath = await leaveActivePlayer(cityPlayer, observer === cityPlayer ? activePlayers.find((player) => player !== cityPlayer) : observer, `${options.prefix}-11-city-leave.png`);
      const nextObserver = players.find((player) => !player.left);
      await waitUntil(async () => {
        const nextArena = await arenaState(nextObserver);
        return nextArena?.capacity === 1 && nextArena.city === bayName;
      }, 'Bay occupant moved into empty City when five players dropped to four');
      evidence.sawBayMigration = true;
      await screenshot(nextObserver.page, `${options.prefix}-12-bay-closed-migration.png`, true);
      checkpoint(`Tokyo Bay closed and ${bayName} moved to City after ${cityPlayer.name} left`);
      continue;
    }

    const firstRollers = [];
    for (const player of activePlayers) {
      if (await hasButton(player.page, /^ROLL 6 DICE FOR FIRST$/)) firstRollers.push(player);
    }
    if (firstRollers.length > 0) {
      consecutiveTokyoDecisions = 0;
      if (firstRollers.length > 1) {
        await clickButtonsConcurrently(firstRollers, /^ROLL 6 DICE FOR FIRST$/);
        evidence.sawConcurrentFirstRoll = true;
        evidence.maxConcurrentFirstRollers = Math.max(evidence.maxConcurrentFirstRollers, firstRollers.length);
        for (const player of firstRollers) {
          const body = await player.page.evaluate(() => document.body.innerText);
          assert(!body.includes('Action not accepted'), `${player.name}'s same-round first roll was rejected`);
        }
      } else {
        await clickButton(firstRollers[0].page, /^ROLL 6 DICE FOR FIRST$/);
      }
      evidence.actions += firstRollers.length;
      idleLoops = 0;
      continue;
    }

    const mimicPlayer = await findPlayerWithText(activePlayers, 'CHOOSE MIMIC POWER');
    if (mimicPlayer) {
      consecutiveTokyoDecisions = 0;
      await chooseMimicTarget(mimicPlayer, players, options.prefix);
      evidence.sawMimicCopy = true;
      evidence.actions += 1;
      await screenshot(mimicPlayer.page, `${options.prefix}-10-mimic-copy.png`, true);
      continue;
    }

    const psychic = await findPlayerWithButton(activePlayers, /^PASS PSYCHIC PROBE$/);
    if (psychic) {
      consecutiveTokyoDecisions = 0;
      await clickButton(psychic.page, /^PASS PSYCHIC PROBE$/);
      evidence.actions += 1;
      continue;
    }

    const camouflageDefender = await findPlayerWithButton(activePlayers, /^KEEP CAMOUFLAGE ROLL$/);
    if (camouflageDefender) {
      evidence.sawDefenseDecision = true;
      await clickButton(camouflageDefender.page, /^KEEP CAMOUFLAGE ROLL$/);
      evidence.actions += 1;
      continue;
    }

    const wingsDefender = await findPlayerWithButton(activePlayers, /^CONTINUE WITHOUT WINGS$/);
    if (wingsDefender) {
      evidence.sawDefenseDecision = true;
      const action = await hasButton(wingsDefender.page, /^USE WINGS · 2 ENERGY$/)
        ? /^USE WINGS · 2 ENERGY$/
        : /^CONTINUE WITHOUT WINGS$/;
      await clickButton(wingsDefender.page, action);
      evidence.actions += 1;
      continue;
    }

    const rapidDefender = await findPlayerWithButton(activePlayers, /^TAKE DAMAGE WITHOUT HEALING$/);
    if (rapidDefender) {
      evidence.sawDefenseDecision = true;
      await clickButton(rapidDefender.page, /^TAKE DAMAGE WITHOUT HEALING$/);
      evidence.actions += 1;
      continue;
    }

    const freezePlayer = await findPlayerWithButton(activePlayers, /^TAKE EXTRA TURN$/);
    if (freezePlayer) {
      consecutiveTokyoDecisions = 0;
      await clickButton(freezePlayer.page, /^DECLINE$/);
      evidence.actions += 1;
      continue;
    }

    const tokyoDecider = await findPlayerWithButton(activePlayers, /^STAY IN TOKYO$/);
    if (tokyoDecider) {
      const state = await panelState(tokyoDecider, tokyoDecider.name);
      consecutiveTokyoDecisions += 1;
      evidence.sawCityBayDecisionSequence ||= consecutiveTokyoDecisions >= 2;
      const shouldYield = options.victory === 'points' || (!options.leaveCityForBay && (state?.health ?? 10) <= 6);
      await clickButton(tokyoDecider.page, shouldYield ? /^YIELD TOKYO$/ : /^STAY IN TOKYO$/);
      evidence.sawYield ||= shouldYield;
      evidence.actions += 1;
      continue;
    }
    consecutiveTokyoDecisions = 0;

    const opportunist = await findPlayerWithButton(activePlayers, /^PASS$/);
    if (opportunist && await opportunist.page.evaluate(() => document.body.innerText.includes('OPPORTUNIST WINDOW'))) {
      await clickButton(opportunist.page, /^PASS$/);
      evidence.actions += 1;
      continue;
    }

    const seller = await findPlayerWithButton(activePlayers, /^DONE SELLING$/);
    if (seller) {
      evidence.sawMetamorphWindow = true;
      const saleLabels = (await buttonLabels(seller.page, true)).filter((label) => /^SELL · \d+ ENERGY:/.test(label));
      if (!evidence.sawMetamorphSale && saleLabels.length > 0) {
        const sale = saleLabels.find((label) => !label.endsWith(': Metamorph')) ?? saleLabels[0];
        await clickExactLabel(seller.page, sale);
        evidence.sawMetamorphSale = true;
        evidence.actions += 1;
        await screenshot(seller.page, `${options.prefix}-10a-metamorph-sale.png`, true);
        continue;
      }
      await clickButton(seller.page, /^DONE SELLING$/);
      evidence.actions += 1;
      continue;
    }

    const endEffect = await findPlayerWithButton(activePlayers, /^(TAKE \d+ POISON DAMAGE|OPEN METAMORPH SALES|ENERGY HOARDER|HERBIVORE|ROOTING FOR THE UNDERDOG|SOLAR POWERED)/);
    if (endEffect) {
      const label = (await buttonLabels(endEffect.page, true)).find((value) => /^(TAKE \d+ POISON DAMAGE|OPEN METAMORPH SALES|ENERGY HOARDER|HERBIVORE|ROOTING FOR THE UNDERDOG|SOLAR POWERED)/.test(value));
      await clickExactLabel(endEffect.page, label);
      evidence.actions += 1;
      continue;
    }

    const heartAllocator = await findPlayerWithButton(activePlayers, /^CONFIRM HEARTS$/);
    if (heartAllocator) {
      const healingTarget = (await buttonLabels(heartAllocator.page, true)).find((label) => /^HEAL /.test(label));
      if (healingTarget) {
        await clickExactLabel(heartAllocator.page, healingTarget);
        evidence.sawHealingRayAssignment = true;
      }
      const heartBody = await heartAllocator.page.evaluate(() => document.body.innerText);
      if (/^TOKYO (?:CITY|BAY)$/.test((await panelState(heartAllocator, heartAllocator.name))?.status ?? '') && heartBody.includes('cannot heal you in Tokyo')) {
        evidence.sawHealingRestriction = true;
      }
      await clickButton(heartAllocator.page, /^CONFIRM HEARTS$/);
      evidence.actions += 1;
      if (firstResolutionPending) {
        await waitUntil(async () => {
          const nextArena = await arenaState(activePlayers[0]);
          return Boolean(nextArena?.city && nextArena.city !== 'nobody');
        }, 'mandatory first Tokyo City entry after Heart allocation');
        evidence.sawForcedNoSmashCity = !evidence.firstResolutionHadSmash;
        firstResolutionPending = false;
      }
      continue;
    }

    const resolver = await findPlayerWithButton(activePlayers, /^CONFIRM RESULT ORDER$/);
    if (resolver) {
      const diceLabels = await resolver.page.evaluate(() => [...document.querySelectorAll('[aria-label^="Die "]')].map((element) => element.getAttribute('aria-label') ?? ''));
      const hasSmash = diceLabels.some((label) => label.includes(': smash'));
      if (firstResolutionPending) evidence.firstResolutionHadSmash = hasSmash;
      if (!evidence.sawOrderChoice) {
        await clickButton(resolver.page, /^Move Smash earlier$/);
        await clickButton(resolver.page, /^Move Smash earlier$/);
        evidence.sawOrderChoice = true;
        await screenshot(resolver.page, `${options.prefix}-08-result-order-${resolver.width}.png`, true);
      }
      await clickButton(resolver.page, /^CONFIRM RESULT ORDER$/);
      evidence.actions += 1;
      if (firstResolutionPending) {
        await waitUntil(async () => (await findPlayerWithButton(activePlayers, /^CONFIRM HEARTS$/)) !== null || await (async () => {
          const nextArena = await arenaState(activePlayers[0]);
          return Boolean(nextArena?.city && nextArena.city !== 'nobody');
        })(), 'first result reached Heart allocation or mandatory Tokyo entry');
        const nextArena = await arenaState(activePlayers[0]);
        if (nextArena?.city && nextArena.city !== 'nobody') {
          evidence.sawForcedNoSmashCity = !hasSmash;
          firstResolutionPending = false;
        }
      }
      continue;
    }

    const roller = await findPlayerWithButton(activePlayers, /^ROLL DICE$/);
    if (roller) {
      await clickButton(roller.page, /^ROLL DICE$/);
      evidence.actions += 1;
      continue;
    }

    const diceChooser = await findPlayerWithButton(activePlayers, /^(REROLL \(|RESOLVE DICE$)/);
    if (diceChooser) {
      const marketDone = options.boundedMarket || !options.marketCoverage || (evidence.sawSweep && evidence.sawKeepPurchase && evidence.sawMimicCopy && evidence.sawMetamorphSale);
      const actor = await panelState(diceChooser, diceChooser.name);
      const shouldProveTokyoHealing = !evidence.sawHealingRestriction && /^TOKYO (?:CITY|BAY)$/.test(actor?.status ?? '');
      if (shouldProveTokyoHealing) {
        const body = await diceChooser.page.evaluate(() => document.body.innerText);
        evidence.sawHealingRestriction = body.includes('ROLLED HEARTS CANNOT HEAL YOU WHILE IN TOKYO');
        if (evidence.sawHealingRestriction) {
          await screenshot(diceChooser.page, `${options.prefix}-08a-tokyo-heart-warning-${diceChooser.width}.png`, true);
        }
      }
      const strategy = shouldProveTokyoHealing ? 'hearts' : marketDone ? options.victory : 'energy';
      const { parsed, toggled } = await syncDiceSelection(diceChooser, strategy, firstResolutionPending);
      const diceMode = diceChooser.page.viewport().hasTouch ? 'phone' : 'desktop';
      if (!options.finishWithoutRematch && !materialCaptures.has(`dice-${diceMode}`)) {
        await qa.capture(diceChooser.page, `${options.prefix}-kept-dice-${diceMode}.png`, { frame: '#king-current-decision' });
        await qa.capture(diceChooser.page, `${options.prefix}-kept-dice-${diceMode}-text200.png`, { scale: true, frame: '#king-current-decision' });
        materialCaptures.add(`dice-${diceMode}`);
      }
      evidence.sawDiceSelection ||= toggled;
      if (await hasButton(diceChooser.page, /^REROLL \(/)) {
        await clickButton(diceChooser.page, /^REROLL \(/);
        evidence.sawReroll = true;
      } else {
        if (firstResolutionPending) evidence.firstResolutionHadSmash = parsed.some((die) => die.face === 'smash');
        await clickButton(diceChooser.page, /^RESOLVE DICE$/);
      }
      evidence.actions += 1;
      continue;
    }

    const buyer = await findPlayerWithButton(activePlayers, /^END TURN$/);
    if (buyer) {
      const marketMode = buyer.page.viewport().hasTouch ? 'phone' : 'desktop';
      if (!options.finishWithoutRematch && !materialCaptures.has(`market-${marketMode}`)) {
        await qa.capture(buyer.page, `${options.prefix}-market-${marketMode}.png`, { frame: '#king-current-decision' });
        await qa.capture(buyer.page, `${options.prefix}-market-${marketMode}-text200.png`, { scale: true, frame: '#king-current-decision' });
        materialCaptures.add(`market-${marketMode}`);
      }
      if (options.boundedMarket) {
        const bought = buyer.acks.filter(ack => ack.action === 'buy_card').length;
        const purchase = bought < 2 ? await marketButton(buyer) : null;
        if (purchase) {
          await clickExactLabel(buyer.page, purchase.label);
          evidence.sawPurchase = true;
        } else if (!evidence.sawSweep && await hasButton(buyer.page, /^SWEEP ALL 3/)) {
          await clickButton(buyer.page, /^SWEEP ALL 3/);
          evidence.sawSweep = true;
        } else await clickButton(buyer.page, /^END TURN$/);
        evidence.actions += 1;
        continue;
      }
      if (!options.marketCoverage) {
        await clickButton(buyer.page, /^END TURN$/);
        evidence.actions += 1;
        continue;
      }
      const labels = await buttonLabels(buyer.page, false);
      const marketHasMimic = labels.some((label) => /^BUY .*: Mimic$/.test(label));
      const marketHasMetamorph = labels.some((label) => /^BUY .*: Metamorph$/.test(label));

      if (metamorphOwners.has(buyer.name) && !evidence.sawMetamorphWindow) {
        await clickButton(buyer.page, /^END TURN$/);
        evidence.actions += 1;
        continue;
      }

      const metamorphBuy = await marketButton(buyer, { cardName: 'Metamorph' });
      if (metamorphBuy && nonMetamorphKeepOwners.has(buyer.name)) {
        await clickExactLabel(buyer.page, metamorphBuy.label);
        metamorphOwners.add(buyer.name);
        keepOwners.add(buyer.name);
        evidence.sawMetamorphPurchase = true;
        evidence.sawPurchase = true;
        evidence.actions += 1;
        continue;
      }

      const mimicBuy = await marketButton(buyer, { cardName: 'Mimic' });
      if (mimicBuy && keepOwners.size >= 2) {
        await clickExactLabel(buyer.page, mimicBuy.label);
        evidence.sawPurchase = true;
        evidence.actions += 1;
        continue;
      }
      if (keepOwners.size < 2 && !keepOwners.has(buyer.name)) {
        const keepBuy = await marketButton(buyer, { keepOnly: true, excludeCardNames: ['Mimic', 'Metamorph'] });
        if (keepBuy) {
          await clickExactLabel(buyer.page, keepBuy.label);
          keepOwners.add(buyer.name);
          nonMetamorphKeepOwners.add(buyer.name);
          evidence.sawPurchase = true;
          evidence.sawKeepPurchase = true;
          evidence.actions += 1;
          continue;
        }
      }
      if ((marketHasMimic || marketHasMetamorph) && keepOwners.size < 2) {
        const nonMimicBuy = await marketButton(buyer, { discardOnly: keepOwners.has(buyer.name), excludeCardNames: ['Mimic', 'Metamorph'] });
        if (nonMimicBuy) {
          await clickExactLabel(buyer.page, nonMimicBuy.label);
          evidence.sawPurchase = true;
          evidence.actions += 1;
          continue;
        }
      }
      if ((!marketHasMimic && !evidence.sawMimicCopy || !marketHasMetamorph && !evidence.sawMetamorphPurchase) && marketSweeps < 80 && await hasButton(buyer.page, /^SWEEP ALL 3/)) {
        await clickButton(buyer.page, /^SWEEP ALL 3/);
        evidence.sawSweep = true;
        marketSweeps += 1;
        evidence.actions += 1;
        continue;
      }
      if (!evidence.sawPurchase) {
        const anyBuy = await marketButton(buyer);
        if (anyBuy) {
          await clickExactLabel(buyer.page, anyBuy.label);
          evidence.sawPurchase = true;
          evidence.actions += 1;
          continue;
        }
      }
      await clickButton(buyer.page, /^END TURN$/);
      evidence.actions += 1;
      continue;
    }

    idleLoops += 1;
    if (idleLoops > 20) {
      const diagnostics = [];
      for (const player of activePlayers) diagnostics.push({ name: player.name, path: new URL(player.page.url()).pathname, buttons: await buttonLabels(player.page, true), body: (await player.page.evaluate(() => document.body.innerText)).slice(0, 800) });
      throw new Error(`No actionable King of Tokyo decision: ${JSON.stringify(diagnostics)}`);
    }
    await delay(200);
  }

  const gameOverObserver = players.find((player) => !player.left);
  await waitForText(gameOverObserver.page, 'LEAVE TABLE');
  const winnerLabel = await gameOverObserver.page.evaluate(() => [...document.querySelectorAll('[aria-label]')]
    .map((element) => element.getAttribute('aria-label'))
    .find((label) => label?.includes('. WINNER.')) ?? null);
  const winnerName = winnerLabel?.split(',')[0]?.split('.')[0] ?? null;
  const outcomeText = await gameOverObserver.page.evaluate(() => document.body.innerText);
  const victoryType = outcomeText.includes('Last living monster standing') ? 'last_monster_standing' : outcomeText.includes('survived the turn') ? 'victory_points' : 'mutual_destruction';
  assert(winnerName || victoryType === 'mutual_destruction', 'Game-over overlay did not expose a winner or mutual destruction');
  await screenshot(gameOverObserver.page, `${options.prefix}-13-game-over-${gameOverObserver.width}.png`);
  const desktop = players.find((player) => !player.left && player.width >= 1000);
  if (desktop && desktop !== gameOverObserver) await screenshot(desktop.page, `${options.prefix}-14-game-over-desktop.png`);
  await exerciseTwoHundredPercentZoom(gameOverObserver, `${options.prefix}-14a-results-phone-text200.png`, [/^LEAVE TABLE$/]);
  if (desktop) await exerciseTwoHundredPercentZoom(desktop, `${options.prefix}-14b-results-desktop-text200.png`, [/^LEAVE TABLE$/]);

  evidence.terminal = gameOverObserver.state ? { revision: gameOverObserver.state.revision, winnerId: gameOverObserver.state.winnerId, victoryType: gameOverObserver.state.victoryType, players: gameOverObserver.state.players.map(({ playerId, displayName, forfeited, eliminated }) => ({ playerId, displayName, forfeited, eliminated })) } : null;
  assert(evidence.terminal && evidence.terminal.players.every(player => !player.forfeited), 'Natural terminal must retain every non-forfeited seat');
  if (options.finishWithoutRematch) return { ...evidence, winnerName, victoryType, marketSweeps };
  const host = await findPlayerWithButton(players.filter((player) => !player.left), /^PLAY AGAIN$/);
  assert(host, 'Connected room host did not receive Play Again');
  await clickButton(host.page, /^PLAY AGAIN$/);
  await waitUntil(async () => {
    const winner = players.find((player) => player.name === winnerName);
    return winner && await hasButton(winner.page, /^ROLL DICE$/);
  }, 'previous winner became rematch starter');
  assert(!(await Promise.all(players.filter((player) => !player.left).map((player) => hasButton(player.page, /^ROLL 6 DICE FOR FIRST$/, false)))).some(Boolean), 'Rematch incorrectly reopened first-player roll-off');
  const winner = players.find((player) => player.name === winnerName);
  await screenshot(winner.page, `${options.prefix}-15-rematch-winner-first.png`, true);
  evidence.rematchRevision = host.state.revision;
  assert(evidence.rematchRevision > evidence.terminal.revision, 'Rematch revision is not monotonic');
  return { ...evidence, winnerName, victoryType, marketSweeps };
}

async function runFourPlayerMatch(browser) {
  const { players, host, sawHealingRuleInRulebook } = await createMatch(browser, 'Metro', [
    { name: 'Long Alice Nam', width: 375, height: 844 },
    { name: 'Bob', width: 320, height: 800 },
    { name: 'Long Carol Nam', width: 1280, height: 900 },
    { name: 'Dave', width: 414, height: 844 },
  ], ' tokyo-test ', '4p');
  try {
    await screenshot(players[1].page, '4p-06-game-320.png', true);
    await screenshotButtonInView(players[1].page, '4p-06a-game-320-first-action.png', /^ROLL 6 DICE FOR FIRST$/);
    await screenshot(players[2].page, '4p-07-game-desktop.png', true);
    const desktopViewport = players[2].page.viewport();
    await players[2].page.setViewport({ ...desktopViewport, width: 768, height: 1024 });
    try {
      await assertNoHorizontalOverflow(players[2]);
      await screenshot(players[2].page, '4p-07b-game-tablet-768.png', true);
    } finally {
      if (desktopViewport) await players[2].page.setViewport(desktopViewport);
    }
    await exerciseTwoHundredPercentZoom(players[2], '4p-07a-game-200-percent.png', [/^Open rulebook$/, /^Leave game$/]);
    await exerciseTwoHundredPercentZoom(host, '4p-07c-game-phone-text200.png', [/^Open rulebook$/, /^Leave game$/]);
    await screenshot(players[3].page, '4p-07d-game-phone414.png');
    const phoneViewport = host.page.viewport();
    try { await host.page.setViewport({ ...phoneViewport, width: 844, height: 390 }); await screenshot(host.page, '4p-07e-game-short-landscape.png', true); }
    finally { await host.page.setViewport(phoneViewport); }
    await assertNoHorizontalOverflow(players[1]);
    await exerciseGameBackGuard(players[1]);
    const recoveredIdentity = host.state?.viewerPlayerId;
    const beforeReloadRevision = host.state?.revision;
    host.state = null;
    await host.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForPath(host.page, '/king-of-tokyo/game');
    await waitForText(host.page, 'KING OF TOKYO');
    await waitUntil(() => host.state?.viewerPlayerId === recoveredIdentity && host.state.revision >= beforeReloadRevision, 'same viewer recovered a fresh authoritative frame');
    const evidence = await driveMatch(players, { prefix: '4p', victory: 'points', leaveCityForBay: false, marketCoverage: true, boundedMarket: true });
    assert(evidence.sawForcedCity, '4-player UI did not prove mandatory Tokyo City entry');
    checkpoint(evidence.sawForcedNoSmashCity
      ? '4-player rendered run also observed mandatory City entry without Smash'
      : '4-player first resolver rolled Smash; deterministic socket coverage proves the zero-Smash entry branch');
    assert(evidence.sawConcurrentFirstRoll && evidence.maxConcurrentFirstRollers === 4, '4-player UI did not submit every first-player roll from one shared round snapshot');
    assert(evidence.sawOrderChoice, '4-player UI never exercised result ordering');
    checkpoint(`Market observations: buy=${evidence.sawPurchase}, sweep=${evidence.sawSweep}; missing rare branches use separate canonical fixtures.`);
    checkpoint(evidence.sawMimicCopy
      ? '4-player shuffled market exposed and completed Mimic'
      : 'Mimic did not surface before game-over in this shuffled market; deterministic card tests remain authoritative');
    checkpoint(evidence.sawMetamorphPurchase && evidence.sawMetamorphWindow && evidence.sawMetamorphSale
      ? '4-player shuffled market completed Metamorph purchase, sale and Done'
      : 'Metamorph did not complete before game-over in this shuffled market; deterministic card tests remain authoritative');
    assert(['victory_points', 'last_monster_standing'].includes(evidence.victoryType), `4-player match returned invalid victory type ${evidence.victoryType}`);
    const rematch = await driveMatch(players, { prefix: '4p-rematch', victory: 'points', leaveCityForBay: false, marketCoverage: true, boundedMarket: true, finishWithoutRematch: true });
    assert(rematch.terminal.revision > evidence.rematchRevision, 'Full rematch did not advance to natural terminal');
    return { ...evidence, fullRematch: rematch, sawHealingRuleInRulebook, acknowledgements: players.map(player => ({ name: player.name, accepted: player.acks, rejected: player.rejects })) };
  } catch (error) {
    qa.evidence.failureActors = [];
    for (const [index, player] of players.entries()) {
      const frame = player.state;
      const detail = { actor: player.name, revision: frame?.revision, phase: frame?.phase, accepted: player.acks, rejected: player.rejects };
      detail.rendered = await player.page.evaluate(() => ({ text: document.body.innerText, arena: [...document.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label')).find(label => label?.startsWith('Tokyo arena,')) })).catch(() => null);
      detail.screenshot = `failure-actor-${index}.png`;
      await player.page.screenshot({ path: path.join(outputDir, detail.screenshot), fullPage: false }).catch(() => { detail.screenshot = null; });
      qa.evidence.failureActors.push(detail);
    }
    qa.persist();
    throw error;
  } finally {
    for (const player of players) {
      await cleanupPlayer(player).catch(error => { qa.evidence.cleanup.push({ actor: player.name, failure: safeError(error) }); qa.persist(); });
    }
    await Promise.all(players.map((player) => player.context.close()));
  }
}

async function runFivePlayerMatch(browser) {
  const { players, sawHealingRuleInRulebook } = await createMatch(browser, 'Bay', [
    { name: 'Aki', width: 390, height: 844 },
    { name: 'Bo', width: 360, height: 800 },
    { name: 'Cleo', width: 1280, height: 900 },
    { name: 'Dax', width: 390, height: 844 },
    { name: 'Emi', width: 390, height: 844 },
  ], 'bay-test', '5p');
  try {
    const evidence = await driveMatch(players, { prefix: '5p', victory: 'combat', leaveCityForBay: true, marketCoverage: false });
    assert(evidence.sawConcurrentFirstRoll && evidence.maxConcurrentFirstRollers === 5, '5-player UI did not submit every first-player roll from one shared round snapshot');
    assert(evidence.sawBay && evidence.sawBayMigration, '5-player UI missed Bay fill or close migration');
    assert(evidence.sawCityBayDecisionSequence, '5-player UI missed consecutive City and Bay Smash decisions');
    assert(evidence.confirmedLeaveBackPath === '/', '5-player confirmed Leave did not clean browser history');
    assert(['victory_points', 'last_monster_standing'].includes(evidence.victoryType), `5-player match returned invalid victory type ${evidence.victoryType}`);
    return { ...evidence, sawHealingRuleInRulebook };
  } finally {
    for (const player of players) await cleanupPlayer(player).catch(error => { qa.evidence.cleanup.push({ actor: player.name, failure: safeError(error) }); qa.persist(); });
    await Promise.all(players.map((player) => player.context.close()));
  }
}

async function main() {
  assert(process.env.TOKYO_UI_EXCLUSIVE_WINDOW === 'granted', 'Explicit exclusive browser window required');
  assert(process.env.TOKYO_LEGACY_FIVE_PLAYER !== 'true', 'Use separately labelled canonical Bay fixtures, not the inherited departure campaign');
  local(API_URL);
  fs.mkdirSync(outputDir, { recursive: true });
  assert(!fs.existsSync(path.join(outputDir, 'receipt.json')), 'Use a fresh output directory');
  const expected = process.env.QA_EXPECTED_WEB_SHA256 ?? process.env.TOKYO_EXPECTED_SHA256;
  qa.evidence.bundle = await bundleFence(BASE_URL, process.env.QA_STATIC_ROOT, expected); qa.persist();
  const service = await (await fetch(API_URL, { redirect: 'error' })).json();
  assert(service.service === 'zuychin-arcade-server', 'Natural mode requires the ordinary API identity');
  const fixtureProbe = await fetch(API_URL + '/__qa/king-of-tokyo-fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', redirect: 'error' });
  assert(fixtureProbe.status === 404, 'Natural mode requires fixture endpoint absent');
  const browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + process.env.QA_BROWSER_CERT_SPKI] });
  try {
    await qa.calibrate(browser);
    const fourPlayer = await runFourPlayerMatch(browser);
    qa.evidence.fourPlayer = fourPlayer;
    assert(fourPlayer.sawHealingRuleInRulebook, 'No-healing rulebook entry absent');
    assert(fourPlayer.sawDiceSelection && fourPlayer.sawReroll, 'Dice selection/reroll coverage absent');
    assert(fourPlayer.acknowledgements.every(actor => actor.rejected.length === 0), 'Unexpected gameplay rejection');
    assert(consoleIssues.length === 0, 'Browser issues recorded');
    assert(qa.evidence.blockedRequests.length === 0, 'Network allowlist violation');
    assert(qa.evidence.cleanup.length === 4 && qa.evidence.cleanup.every(r => r.normalUI && r.status === 200 && r.authCleared), 'All four normal exits must clear authentication');
    qa.evidence.finalBundle = await bundleFence(BASE_URL, process.env.QA_STATIC_ROOT, expected);
    qa.evidence.lifecyclePassed = true;
    qa.evidence.visualPassed = qa.evidence.visualFindings.length === 0;
    assert(qa.evidence.visualPassed, 'Visual findings retained for review');
    qa.evidence.passed = true;
  } catch (error) {
    qa.evidence.error = safeError(error); qa.evidence.passed = false; throw error;
  } finally {
    for (const actor of ownedPlayers) if (!actor.cleaned) await cleanupPlayer(actor).catch(error => { qa.evidence.cleanup.push({ actor: actor.name, failure: safeError(error) }); });
    await browser.close(); qa.evidence.browserClosed = true; qa.evidence.consoleIssues = consoleIssues; qa.persist();
  }
  console.log(JSON.stringify({ passed: qa.evidence.passed, outputDir, captures: qa.evidence.captures.length, terminal: qa.evidence.fourPlayer?.terminal }));
}

module.exports = { openPlayer, setInput, clickButton, waitForPath, waitUntil, buttonLabels, screenshot, joinPlayer, setPrimaryScrollPosition, cleanupPlayer, qa, exerciseTwoHundredPercentZoom, runFivePlayerMatch };

if (require.main === module) main().catch((error) => {
  console.error(`KING OF TOKYO UI SMOKE FAIL: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
