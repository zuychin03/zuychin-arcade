const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { names, scenarios, checkProjection, selectedCardDom, assertSelectedCard } = require('./citadels-fixture-ui.cjs');
const source = fs.readFileSync(path.join(__dirname, 'citadels-fixture-ui.cjs'), 'utf8');
const canonical = fs.readFileSync(path.join(__dirname, '../../server/scripts/citadels/ui-fixtures.ts'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../../server/scripts/citadels/ui-fixture-server.ts'), 'utf8');

test('supplementary scenarios and synthetic four-seat identities match canonical gates exactly', () => {
  const canonicalScenarios = canonical.match(/CITADELS_UI_FIXTURE_SCENARIOS = \[([\s\S]*?)\] as const/)[1].match(/'[^']+'/g).map(value => value.slice(1, -1));
  const canonicalNames = server.match(/const names = \[([^\]]+)\]/)[1].match(/'[^']+'/g).map(value => value.slice(1, -1));
  assert.deepEqual(scenarios, canonicalScenarios); assert.deepEqual(names, canonicalNames);
  assert.match(canonical, /assert.equal\(players.length, 4/);
  assert.match(source, /does not execute the separately gated seven-seat layout scenario/);
  assert.match(canonical, /CITADELS_SEVEN_LAYOUT_SCENARIO = 'seven_seat_layout'/);
  assert.doesNotMatch(source, /Seven-seat constructors are not supported/);
  assert.equal((source.match(/await runRoom\(browser, qa, base, api,/g) ?? []).length, 2);
});

test('owned projection fence rejects mismatched seats, revisions and public private-data fields', () => {
  const seat = { auth: { playerId: 'own', roomCode: 'COUR-T123' }, private: { playerId: 'own', roomCode: 'COUR-T123', revision: 20 }, public: { roomCode: 'COUR-T123', revision: 20, players: [{ revealedRole: null, handCount: 4, city: [] }] } };
  checkProjection(seat);
  for (const changed of [
    { ...seat, private: { ...seat.private, playerId: 'other' } },
    { ...seat, private: { ...seat.private, revision: 19 } },
    { ...seat, public: { ...seat.public, roomCode: 'OTHER' } },
    { ...seat, public: { ...seat.public, players: [{ chosenRole: 'merchant' }] } },
  ]) assert.throws(() => checkProjection(changed));
});

test('fixture launch is exclusive, local, exact-hash fenced and refuses ordinary API', () => {
  assert.match(source, /CITADELS_UI_EXCLUSIVE_WINDOW, 'granted'/);
  assert.match(source, /CITADELS_UI_FIXTURE_RUN, 'true'/);
  assert.match(source, /outputDir && !fs.existsSync\(outputDir\)/);
  assert.match(source, /local\(base\); local\(api\)/);
  assert.match(source, /citadels-local-ui-fixtures/);
  assert.match(source, /qa.evidence.finalBundle = await bundleFence/);
  assert.match(source, /guardNetwork\(seat.page, qa.origins/);
  assert.match(source, /canonicalDistricts, 68/);
  assert.doesNotMatch(source, /io\(|socket.emit|__qa\/citadels-fixture[^\n]+playerId/);
});

test('cards and private notices receive owner/nonowner checks without manufacturing role reveals', () => {
  assert.match(source, /host.private.drawnCards.length, 3/);
  assert.match(source, /seats.slice\(1\).every\(s => s.private.drawnCards.length === 0\)/);
  assert.match(source, /Only Magician receives private selection controls/);
  assert.match(source, /own\(victim\).revealedRole, null/);
  assert.match(source, /for \(const nonowner of seats.filter\(s => s !== victim\)\)/);
  assert.match(source, /Your Merchant was killed by the Assassin\./);
  assert.match(source, /does not exhaustively prove private-card artwork DOM absence across every nonowner surface/);
  assert.doesNotMatch(source, /requires integrated scoped card testIDs/);
});

test('selected-card DOM reader counts standalone visible text once, not wrapper text or hidden descendants', () => {
  const element = (text = '', attrs = {}, style = {}) => ({
    isConnected: true, parentElement: null, attrs, style,
    childNodes: text ? [{ nodeType: 3, textContent: text }] : [], children: [],
    getAttribute(name) { return this.attrs[name] ?? null; }, hasAttribute(name) { return name in this.attrs; },
    getBoundingClientRect() { return { width: 176, height: 48 }; },
    querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]); },
    append(child) { child.parentElement = this; this.children.push(child); this.childNodes.push(child); return child; },
  });
  const label = 'SELECTED. Temple, 1 gold, religious district.';
  const root = element('', { role: 'button', 'aria-label': label, 'aria-pressed': 'true', 'aria-disabled': 'false' });
  const wrapper = root.append(element()); wrapper.append(element('Selected'));
  root.append(element('Selected district rules are not a standalone cue'));
  root.append(element('SELECTED', {}, { display: 'none' }));
  root.append(element('', { 'aria-hidden': 'true' })).append(element('SELECTED'));
  const read = () => JSON.parse(JSON.stringify(vm.runInNewContext(`(${selectedCardDom})(root)`, {
    root, Node: { TEXT_NODE: 3 }, getComputedStyle: node => ({ display: 'block', visibility: 'visible', opacity: '1', ...node.style }),
  })));
  const valid = read(); assert.deepEqual(valid.cues, ['Selected']); assertSelectedCard(valid, label);
  root.append(element('SELECTED'));
  assert.deepEqual(read().cues, ['Selected', 'SELECTED']); assert.throws(() => assertSelectedCard(read(), label), /exactly one visible/);
  for (const mutation of [{ pressed: null }, { pressed: 'false' }, { enabled: false }, { shown: false }, { label: 'SELECT. Temple' }, { cues: [] }]) assert.throws(() => assertSelectedCard({ ...valid, ...mutation }, label));
});

test('Magician and Laboratory assert the framed selected card after their captures and preserve emitted web semantics', () => {
  assert.equal((source.match(/await checkSelectedCard\(host.page,/g) ?? []).length, 2);
  for (const suffix of ['selected-hand', 'laboratory-selection']) {
    const after = source.slice(source.indexOf(`await capture(host, '${suffix}'`));
    assert(after.indexOf('await checkSelectedCard(') < after.indexOf('await noControls('));
  }
  const pressable = fs.readFileSync(path.join(__dirname, '../components/ui/ScalePressable.tsx'), 'utf8');
  assert.match(pressable, /'aria-pressed': accessibilityState\?\.selected/);
  assert(source.indexOf('record.selectedCard = snapshot; qa.persist()') < source.indexOf('assertSelectedCard(snapshot, expectedLabel);'));
});

test('legal UI actions confirm settlement, cancellation restores focus, scoring reconciles live components', () => {
  assert.match(source, /seat.acks.length > before/);
  assert.match(source, /seat.private\?\.revision === seat.public\?\.revision/);
  assert.match(source, /redraw cancel restores opener/);
  assert.match(source, /assert.equal\(host.public.revision, revision\)/);
  assert.match(source, /score.total, score.districtPoints \+ score.diversityBonus \+ score.completionBonus \+ score.uniqueBonus/);
  assert.match(source, /Math.max\(0, castle.cost - 1\) \+ 1/);
  assert.match(source, /BISHOP PROTECTED/); assert.match(source, /KEEP PROTECTED/); assert.match(source, /COMPLETE CITY/);
});

test('fixture evidence preserves input mode, frames whole choices and separates normal/fallback cleanup', () => {
  assert.match(source, /isMobile: !desktop, hasTouch: !desktop/);
  assert.match(source, /scale: true, align: 'start'/); assert.match(source, /scale: true, align: 'end'/);
  assert.match(source, /await qa.calibrate\(browser\)/);
  assert.match(source, /normalUI: !seat.fallbackCleanup/);
  assert.match(source, /r.normalUI && r.status === 200 && r.authCleared/);
  assert.match(source, /fallback: true/);
  assert.match(source, /20 \* 60_000/);
  assert.match(source, /await browser.close\(\); qa.evidence.browserClosed = true/);
  assert.match(source, /redact\(error.stack \?\? error.message, \[\.\.\.qa.secrets\]\)/);
  assert.doesNotMatch(source, /fullPage: true|deviceScaleFactor: 2/);
});

test('fixture cleanup reuses modal-scoped actual UI exit and Fetch status property', () => {
  assert.match(source, /await h.leavePlayerUI\(seat\)/);
  assert.match(source, /fallback: true, normalUI: false, status: response\.status \}/);
  const fallback = source.slice(source.indexOf('const response = await fetch(api'), source.indexOf('const authCleared ='));
  assert.doesNotMatch(fallback, /response\.status\(\)/);
});
