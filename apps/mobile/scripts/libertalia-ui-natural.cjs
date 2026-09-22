const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { bundleFence } = require('./skull-ui-evidence.cjs');
const { redact, assertFrameCoverage } = require('./libertalia-ui-primitives.cjs');
const { choiceIdentity } = require('./libertalia-ui-choice.cjs');

const SOURCE_FILES = Object.freeze([
  ...['_layout', 'index', 'join', 'lobby', 'game'].map(name => 'apps/mobile/app/libertalia/' + name + '.tsx'),
  ...['CrewCard', 'Hand', 'Loot', 'LibertaliaArtwork', 'ReferenceSheet'].map(name => 'apps/mobile/components/libertalia/' + name + '.tsx'),
  ...['layout', 'decision', 'useLibertaliaActions', 'useLibertaliaDecisionAttention'].map(name => 'apps/mobile/components/libertalia/' + name + '.ts'),
  ...['RemainingLanding', 'RemainingJoin', 'RemainingLobby', 'RemainingArtwork', 'RemainingRules'].map(name => 'apps/mobile/components/remaining/' + name + '.tsx'),
  ...['GameTile', 'GameCover', 'CardSurface', 'CardGrid', 'NeonButton', 'ScalePressable', 'ArcadeDialog', 'RulesReferenceSheet', 'GameRecovery'].map(name => 'apps/mobile/components/ui/' + name + '.tsx'),
  'apps/mobile/app/(arcade)/index.tsx', 'apps/mobile/app/_layout.tsx', 'apps/mobile/constants/theme.ts',
  'apps/mobile/hooks/useSocket.ts', 'apps/mobile/hooks/useWebModalFocus.ts', 'apps/mobile/hooks/useMeasuredLayoutWidth.ts', 'apps/mobile/store/useGameStore.ts',
  'apps/mobile/lib/api.ts', 'apps/mobile/lib/storage.ts', 'apps/mobile/global.css',
  'packages/types/src/libertalia.ts', 'packages/types/src/libertalia-constants.ts',
  ...['libertalia-material', 'libertalia-layout', 'libertalia-hand', 'libertalia-client', 'libertalia-ui-evidence', 'libertalia-ui-hardening'].map(name => 'apps/mobile/scripts/' + name + '.test.cjs'),
  ...['scale-pressable', 'card-surface', 'card-grid'].map(name => 'apps/mobile/scripts/' + name + '.test.cjs'),
  ...['libertalia-ui-smoke', 'libertalia-ui-evidence', 'libertalia-ui-primitives', 'libertalia-ui-natural', 'libertalia-ui-choice', 'not-alone-ui-smoke', 'not-alone-ui-evidence', 'skull-ui-evidence', 'tokyo-ui-evidence'].map(name => 'apps/mobile/scripts/' + name + '.cjs'),
  ...['cover', 'hero'].map(name => 'apps/mobile/assets/game-art/libertalia-' + name + '.webp'),
  'apps/mobile/assets/game-art/libertalia-manifest.json',
  ...['loot-map', 'loot-barrel', 'loot-amulet', 'loot-chest', 'loot-hook', 'loot-saber', 'loot-relic', 'phase-daytime', 'phase-dusk', 'phase-night', 'phase-anchor'].flatMap(name => [
    'apps/mobile/assets/game-art/libertalia-' + name + '.webp', 'apps/mobile/assets/game-art/libertalia-' + name + '-manifest.json',
  ]),
]);

const CAPTURE_PLAN = Object.freeze({
  library: 8, entrance: 8, lifecycleForms: 16, lobby: 9, lobbyActions: 5,
  initialGame: 10, handFaces: 28, tableDetails: 16, observedChoices: 60,
  voyageTransitions: 4, results: 32, recovery: 2, rematch: 2, forfeit: 12, reserve: 6,
});
const CAPTURE_PLAN_NOTE = '218 replaces the earlier 178 ceiling: ten naturally encountered choice kinds reserve six edges each for full instruction, deterministic policy option and required confirm, not an all-option inventory.';
const PLANNED_CAPTURES = Object.values(CAPTURE_PLAN).reduce((sum, value) => sum + value, 0);

function sourceHashes(read = file => fs.readFileSync(path.resolve(__dirname, '../../..', file))) {
  return Object.fromEntries(SOURCE_FILES.map(file => [file, createHash('sha256').update(read(file)).digest('hex')]));
}

async function verifyFrozenEvidence(recorder, base, checks = {}) {
  recorder.evidence.finalSourceHashes = (checks.sourceHashes ?? sourceHashes)(); recorder.persist();
  assert.deepEqual(recorder.evidence.finalSourceHashes, recorder.evidence.sourceHashes, 'Source or artwork changed during run');
  recorder.evidence.finalBundle = await (checks.bundleFence ?? bundleFence)(base, process.env.QA_STATIC_ROOT, process.env.QA_EXPECTED_WEB_SHA256); recorder.persist();
  assert.deepEqual(recorder.evidence.finalBundle, recorder.evidence.bundle, 'Served or disk bundle changed during run');
  recorder.evidence.freezeVerified = true; recorder.persist();
}

async function recordBrowserResponse(response, actor, recorder) {
  try {
    const url = new URL(response.url());
    if (!recorder.origins.has(url.origin) || response.request().method() !== 'POST') return;
    if (['/rooms/create', '/rooms/join'].includes(url.pathname) && response.ok()) {
      const result = await response.json(), auth = result.auth ?? result;
      assert(auth?.token && auth.playerId && auth.roomCode, 'Authentication response missing owned session fields');
      recorder.secrets.add(auth.token); actor.auth = auth;
    }
  } catch (error) {
    recorder.evidence.responseIssues ??= [];
    recorder.evidence.responseIssues.push({ actor: actor.name, message: redact(error.message, [...recorder.secrets]) });
    recorder.persist();
  }
}

function commandMetadata(packet, actor) {
  if (!Array.isArray(packet) || !/^(libertalia:(select|choice)|start_game)$/.test(packet[0])) return null;
  const payload = packet[1] ?? {};
  return {
    event: packet[0], actor: actor.name, expectedRevision: payload.expectedRevision,
    choiceId: payload.choiceId ?? null, rank: payload.rank ?? null,
    optionIds: Array.isArray(payload.optionIds) ? [...payload.optionIds] : null,
    pairedRevision: actor.latestPrivate?.revision,
    pendingChoiceId: actor.latestPrivate?.pendingChoice?.id ?? null,
  };
}

function assertCommand(command, previousRevision, choiceId, accepted) {
  assert(command, 'One attributable outgoing command required');
  if (command.event === 'start_game') assert.equal(command.expectedRevision, undefined, 'Generic start has no fabricated revision field');
  else {
    assert(Number.isSafeInteger(command.expectedRevision));
    assert.equal(command.expectedRevision, previousRevision, 'Command must use acting owner paired revision');
  }
  assert.equal(command.pairedRevision, previousRevision, 'Send observer must see the owner pair');
  assert.equal(command.choiceId, choiceId, 'Choice command must use current owner choice ID');
  assert.equal(command.event, accepted.action === 'start' ? 'start_game' : 'libertalia:' + accepted.action, 'Acknowledgement must match emitted action');
  assert(accepted.revision > previousRevision, 'Acknowledgement advances revision');
}

function completionStatus(evidence, names) {
  const cleanupComplete = names.length === 3 && evidence.browserClosed && names.every(name =>
    evidence.cleanup.some(record => record.actor === name && record.normalUI && record.status === 200 && record.authCleared)
    && evidence.cleanup.some(record => record.actor === name && record.contextClosed === true))
    && !evidence.cleanup.some(record => record.fallback || record.error || record.contextClosed === false);
  const privacyGaps = evidence.captures.flatMap(record => record.metrics?.privacyGaps ?? []);
  const selectorGaps = evidence.captures.flatMap(record => record.metrics?.selectorGaps ?? []);
  return { cleanupComplete: Boolean(cleanupComplete), privacyGaps, selectorGaps,
    passed: Boolean(cleanupComplete && evidence.freezeVerified && !evidence.failure && !evidence.watchdogExpired
      && !evidence.findings.length && !evidence.blockedRequests.length && !(evidence.responseIssues ?? []).length
      && !(evidence.finalIssues ?? []).length && !privacyGaps.length && !selectorGaps.length) };
}

async function captureFrame(actor, name, selector, recorder, { scales = [false, true], prepare = null } = {}) {
  const proofs = [];
  for (const scale of scales) {
    const records = [await recorder.capture(actor.page, name + '-' + (scale ? 200 : 100) + '-start.png', { frame: selector, align: 'start', scale, prepare })];
    let proof;
    try { proof = assertFrameCoverage(records); } catch {
      records.push(await recorder.capture(actor.page, name + '-' + (scale ? 200 : 100) + '-end.png', { frame: selector, align: 'end', scale }));
      proof = assertFrameCoverage(records);
    }
    proofs.push({ ...proof, actor: actor.name, selector, scale: scale ? 200 : 100, inputProfile: actor.inputProfile, viewport: actor.page.viewport() });
  }
  recorder.evidence.frameProofs ??= []; recorder.evidence.frameProofs.push(...proofs); recorder.persist();
  return proofs;
}

function markLifecycleFrame({ label, form }) {
  document.querySelector('[data-libertalia-qa-lifecycle]')?.removeAttribute('data-libertalia-qa-lifecycle');
  const visible = node => {
    const r = node.getBoundingClientRect();
    return node.isConnected && r.width > 0 && r.height > 0 && !node.closest('[hidden],[inert],[aria-hidden="true"]') && getComputedStyle(node).visibility === 'visible';
  };
  const controls = [...document.querySelectorAll('[role="button"],button')].filter(node => visible(node) && (node.getAttribute('aria-label') ?? node.textContent).trim() === label);
  if (controls.length !== 1) throw Error('Expected exactly one rendered lifecycle control: ' + label);
  let node = controls[0];
  if (form) while (node && !node.querySelector('input[aria-label="Your name"]')) node = node.parentElement;
  if (!node || node === document.body || !visible(node)) throw Error('Missing bounded lifecycle form');
  node.setAttribute('data-libertalia-qa-lifecycle', 'frame');
}

async function lifecycleFrame(actor, name, label, form, recorder) {
  await actor.page.evaluate(markLifecycleFrame, { label, form });
  try { return await captureFrame(actor, name, '[data-libertalia-qa-lifecycle="frame"]', recorder, { scales: form ? [false, true] : [true] }); }
  finally { await actor.page.evaluate(() => document.querySelector('[data-libertalia-qa-lifecycle]')?.removeAttribute('data-libertalia-qa-lifecycle')); }
}

function markChoiceFrame({ part, label }) {
  document.querySelector('[data-libertalia-qa-choice]')?.removeAttribute('data-libertalia-qa-choice');
  const area = document.getElementById('libertalia-decision-area');
  const heading = document.getElementById('libertalia-decision');
  if (!area || !heading || !area.contains(heading)) throw Error('Missing decision context');
  let node;
  if (part === 'instruction') {
    node = heading.nextElementSibling;
    if (node?.getAttribute('aria-live') !== 'polite') throw Error('Missing actual decision instruction');
  } else {
    const controls = [...area.querySelectorAll('[role="button"],button')].filter(control => (control.getAttribute('aria-label') ?? control.textContent).trim() === label);
    if (controls.length !== 1) throw Error('Expected exactly one owned choice control');
    node = controls[0];
  }
  const bounds = node.getBoundingClientRect();
  if (!node.isConnected || bounds.width <= 0 || bounds.height <= 0 || node.closest('[hidden],[inert],[aria-hidden="true"]')) throw Error('Choice frame is not rendered');
  node.setAttribute('data-libertalia-qa-choice', 'frame');
  return { title: heading.textContent.trim(), text: node.textContent.trim(), label: node.getAttribute('aria-label'), selected: node.getAttribute('aria-selected'), part };
}

async function choiceFrame(actor, name, part, label, recorder) {
  const content = await actor.page.evaluate(markChoiceFrame, { part, label });
  try { return { ...content, proofs: await captureFrame(actor, name, '[data-libertalia-qa-choice="frame"]', recorder, { scales: [true] }) }; }
  finally { await actor.page.evaluate(() => document.querySelector('[data-libertalia-qa-choice]')?.removeAttribute('data-libertalia-qa-choice')); }
}

async function choiceOptionFrame(actor, name, identity, recorder) {
  let content = await choiceIdentity(actor, identity);
  const proofs = await captureFrame(actor, name, content.selector, recorder, { scales: [true], prepare: async () => { content = await choiceIdentity(actor, identity); } });
  return { ...content, proofs };
}

module.exports = { SOURCE_FILES, CAPTURE_PLAN, CAPTURE_PLAN_NOTE, PLANNED_CAPTURES, sourceHashes, verifyFrozenEvidence, recordBrowserResponse, commandMetadata, assertCommand, completionStatus, captureFrame, markLifecycleFrame, lifecycleFrame, markChoiceFrame, choiceFrame, choiceOptionFrame };
