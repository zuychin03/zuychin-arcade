const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createRequire } = require('node:module');
const { fixtureRunMode, CAPTURE_PLAN, SOURCE_FILES } = require('./bang-ui-smoke.cjs');
const { BATCHES, MANIFEST, LIFECYCLE_ALLOWANCE, LEGACY_ALLOWANCE } = require('./bang-fixture-framing.cjs');
const filename = path.join(__dirname, 'bang-ui-smoke.cjs'), source = fs.readFileSync(filename, 'utf8');
const localRequire = createRequire(filename);

test('explicit fixture batch guards preserve ordinary147 and legacy combined172 without silently changing modes', () => {
  assert.equal(fixtureRunMode({}).upperBound, 147);
  assert.equal(fixtureRunMode({ BANG_UI_FIXTURES: 'true' }).upperBound, 172);
  assert.equal(fixtureRunMode({}).capturePlan, CAPTURE_PLAN);
  for (const [batch, plan] of Object.entries(BATCHES)) {
    const actual = fixtureRunMode({ BANG_UI_FIXTURES: 'true', BANG_UI_FIXTURES_ONLY: 'true', BANG_UI_FIXTURE_BATCH: batch });
    assert.equal(actual.batch, batch); assert.equal(actual.upperBound, plan.conservativeCeiling); assert(actual.upperBound <= 180);
  }
  for (const env of [
    { BANG_UI_FIXTURES_ONLY: 'true' }, { BANG_UI_FIXTURES: 'true', BANG_UI_FIXTURES_ONLY: 'true' },
    { BANG_UI_FIXTURE_BATCH: '' }, { BANG_UI_FIXTURE_BATCH: 'check-rescue' },
    { BANG_UI_FIXTURES: 'true', BANG_UI_FIXTURE_BATCH: 'check-rescue' },
    { BANG_UI_FIXTURES: 'true', BANG_UI_FIXTURES_ONLY: 'true', BANG_UI_FIXTURE_BATCH: 'unknown' },
    { BANG_UI_FIXTURES: 'true', BANG_UI_FIXTURES_ONLY: 'true', BANG_UI_FIXTURE_BATCH: 'check-rescue', BANG_UI_BEFORE_ONLY: 'true' },
  ]) assert.throws(() => fixtureRunMode(env));
});

function load(env, overrides = {}, tail = '') {
  const module = { exports: {} }, context = { module, __dirname, URL, AbortSignal, console, setTimeout: fn => { fn(); return 1; }, clearTimeout() {},
    process: { env, pid: 123, version: process.version }, ...overrides.globals,
    require: name => Object.hasOwn(overrides.modules ?? {}, name) ? overrides.modules[name] : localRequire(name),
  };
  vm.runInNewContext(source + '\nmodule.exports.testMain = main;\n' + tail, context, { filename });
  return module.exports;
}

test('invalid batch fails main before filesystem creation, API calls, recorder setup or browser launch', async () => {
  const operations = [];
  const driver = load({ BANG_UI_FIXTURE_BATCH: 'check-rescue' }, { modules: {
    'node:fs': { ...fs, existsSync() { operations.push('filesystem'); return false; }, mkdirSync() { operations.push('mkdir'); } },
    'puppeteer-core': { launch() { operations.push('browser'); } },
    './bang-ui-evidence.cjs': { ...localRequire('./bang-ui-evidence.cjs'), createEvidence() { operations.push('recorder'); } },
  }, globals: { fetch() { operations.push('API'); } } });
  await assert.rejects(driver.testMain(), /only in fixture-only mode/);
  assert.deepEqual(operations, []);
});

function fixtureRuntime(batch, { failComplete = false } = {}) {
  const seeded = [], framed = [], legacy = [], clicks = [], decisions = [], receipts = [];
  let current, revision = 0, completed = false, factoryCalls = 0;
  const actors = ['Astra Host', 'Lyra', 'Noor', 'Echo'].map((name, i) => ({ name, id: `p${i}`, accepted: [], rejected: [], sent: [], localPicks: [], room: { players: [] } }));
  const named = name => actors.find(actor => actor.name === name);
  const shared = { players: actors.map(actor => ({ playerId: actor.id, displayName: actor.name, isConnected: true, health: 4, handCount: 1 })) };
  const card = (name, id = name + '-1') => ({ id, name });
  const bump = actor => { revision++; for (const person of actors) { person.public.revision = revision; person.private.revision = revision; } actor.accepted.push({ revision }); };
  const setup = scenario => {
    current = scenario; seeded.push(scenario); revision += 10;
    for (const actor of actors) {
      actor.localPicks = []; actor.localTarget = null; actor.room = shared;
      actor.public = { revision, phase: 'fixture', players: shared.players, discardTop: card('beer', 'public-beer') };
      actor.private = { revision, playerId: actor.id, hand: [], canPlay: false };
    }
    const spec = Object.values(MANIFEST[scenario])[0], owner = named(spec.owner); owner.private[spec.flag] = true;
    if (scenario.startsWith('sid_')) owner.private.hand = [card('bang'), card('missed')];
    if (scenario === 'beer_rescue') { owner.private.hand = [card('beer'), card('beer', 'beer-2')]; owner.public.rescue = { livesNeeded: 2 }; }
    if (scenario === 'discard_order') owner.private.discardOrderCards = [card('beer'), card('barrel')];
    if (scenario === 'kit_draw') owner.private.drawChoice = { options: [card('bang'), card('beer'), card('missed')] };
    if (scenario === 'calamity_play') owner.private.hand = [card('missed')];
    if (scenario === 'self_zones') owner.private.hand = [card('panic'), card('cat_balou')];
    if (scenario === 'barrel_choice') owner.private.barrelOptions = ['barrel', 'jourdonnais'];
    shared.players[0].handCount = 1;
  };
  for (const actor of actors) {
    let viewport = { width: actor.name === 'Echo' ? 1280 : 375, height: 844, hasTouch: actor.name !== 'Echo' };
    actor.page = { viewport: () => viewport, setViewport: async next => { viewport = next; },
      focus: async () => {}, keyboard: { press: async () => {} },
      $: async () => ({}), $eval: async (_selector, fn) => fn.toString().includes('getBoundingClientRect') ? { top: 100, bottom: 400, focused: true, height: 844 } : true,
      evaluate: async fn => fn.toString().includes('label: document.activeElement') ? { label: 'TARGET', scroll: 200 } : true,
      setOfflineMode: async offline => { shared.players.find(player => player.playerId === actor.id).isConnected = !offline; },
      reload: async () => { shared.players.find(player => player.playerId === actor.id).isConnected = true; },
    };
  }
  const act = async (actor, step) => {
    if (current === 'lucky_check') actor.public.phase = 'play';
    else if (current.startsWith('sid_')) shared.players.find(player => player.playerId === actor.id).health = 1;
    else if (current === 'beer_rescue') { actor.public.rescue.livesNeeded--; actor.private.hand.shift(); actor.private.canRescue = actor.public.rescue.livesNeeded > 0; if (!actor.private.canRescue) shared.players.find(player => player.playerId === actor.id).health = 1; }
    else if (current === 'discard_order') actor.public.discardTop = card('barrel');
    else if (current === 'kit_draw') actor.private.hand = actor.private.drawChoice.options.slice(0, 2);
    else if (current === 'barrel_choice') { actor.private.barrelOptions.shift(); actor.private.canRespond = step !== 4; }
    bump(actor);
  };
  const click = async (page, label) => {
    const actor = actors.find(item => item.page === page); clicks.push(label);
    if (label === 'SID KETCHUM: DISCARD TWO TO HEAL') { actor.sidOpen = true; return; }
    if (label.startsWith('HEAL WITH') || label.startsWith('CONFIRM ORDER') || label.startsWith('KEEP SELECTED')) {
      assert.equal(actor.localPicks.length, 2); await act(actor, 1); return;
    }
    if (label === 'TAKE FROM Astra Host') { actor.private.hand = [card('bang'), card('beer')]; shared.players[0].handCount = 0; bump(actor); }
    if (label === 'TAKE Beer') { actor.private.hand = [actor.public.discardTop, card('bang')]; bump(actor); }
    if (label === 'TARGET Astra Host · DISTANCE 1') { named('Astra Host').private.canRespond = true; bump(actor); }
    if (label === 'TARGET Echo (YOU)') actor.localTarget = 'self';
    if (label === 'IN PLAY: Mustang') { actor.private.hand.push(card('mustang')); bump(actor); }
    if (label === 'IN PLAY: Scope') { actor.public.discardTop = card('scope'); bump(actor); }
  };
  const qa = { evidence: { service: 'bang-local-ui-fixtures', mode: 'canonical-fixtures-only', attempts: [] }, capture: async (_page, file) => { legacy.push(file); }, persist() {} };
  const framingModule = { BATCHES, LIFECYCLE_ALLOWANCE, LEGACY_ALLOWANCE, createFixtureFraming: (_qa, options) => {
    factoryCalls++; assert.equal(options.batch, batch);
    return { captureState: async (actor, scenario, state) => {
      const spec = MANIFEST[scenario][state]; assert.equal(actor.name, spec.owner); framed.push(`${scenario}/${state}`);
      if (state === 'selected') { assert.equal(actor.localPicks.length, 2); if (scenario.startsWith('sid_')) assert(actor.sidOpen); }
      if (scenario === 'self_zones') assert.equal(actor.localTarget, 'self');
      if (state === 'one_beer') assert.equal(actor.public.rescue.livesNeeded, 1);
      if (state === 'remaining') assert.equal(actor.private.barrelOptions.length, 1);
      if (state === 'response') assert(actor.private.canRespond);
    }, assertComplete: () => { if (failComplete) throw Error('Missing declared frame'); completed = true; } };
  } };
  const driver = load({ BANG_UI_FIXTURES: 'true' }, { modules: { './bang-fixture-framing.cjs': framingModule,
    './bang-ui-evidence.cjs': { ...localRequire('./bang-ui-evidence.cjs'), persistReceipt: (_directory, _name, value) => { receipts.push(value); } },
  }, globals: {
    fetch: async (_url, options) => { setup(JSON.parse(options.body).scenario); return { ok: true, json: async () => ({ canonicalCards: 80, revision }) }; },
    hooks: { qa, click, act, capture: async (_actor, name) => { legacy.push(name); }, card: async (actor, id) => { actor.localPicks.push(id); },
      receipt: (_name, value) => { receipts.push(value); }, decisions },
  } }, `qa=hooks.qa; click=hooks.click; driveDecision=hooks.act; capture=hooks.capture; card=hooks.card; textVisible=async()=>true; until=async(check,label)=>{if(!await check())throw Error(label);};
    module.exports.recorded={decisions,coverage,screenshots};
    module.exports.runFixtures=async(actors,code,batch)=>{await fixtures(actors,code,batch);};`);
  return { async run() { await driver.runFixtures(actors, 'QAQA-QAQA', batch); }, seeded, framed, legacy, clicks, actors, receipts,
    complete: () => completed, factories: () => factoryCalls, driver };
}

test('each batch seeds only its named cases and captures all declared intermediate states before confirmation', async () => {
  for (const [batch, plan] of Object.entries(BATCHES)) {
    const run = fixtureRuntime(batch); await run.run();
    assert.deepEqual(run.seeded, plan.scenarios);
    assert.deepEqual(run.framed.sort(), plan.scenarios.flatMap(scenario => Object.keys(MANIFEST[scenario]).map(state => `${scenario}/${state}`)).sort());
    assert(run.complete()); assert.equal(run.factories(), 1);
    assert.equal(run.legacy.length, batch === 'check-rescue' ? 2 : batch === 'targets-response' ? 1 : 0);
    assert(run.actors.every(actor => actor.rejected.length === 0));
  }
});

test('legacy combined fixtures retain all eleven cases, twenty-two setup images and three extra frames', async () => {
  const run = fixtureRuntime(null); await run.run();
  assert.deepEqual(run.seeded, Object.keys(MANIFEST)); assert.equal(run.legacy.length, 25);
  assert.equal(run.factories(), 0); assert.deepEqual(run.framed, []);
});

test('missing framed-state completion rejects the fixture batch before its final receipt', async () => {
  const run = fixtureRuntime('draw-order', { failComplete: true });
  await assert.rejects(run.run(), /Missing declared frame/); assert.equal(run.complete(), false);
  assert.deepEqual(run.receipts, []);
});

test('source fences include helper and runtime integration tests; batch completion precedes normal cleanup', () => {
  for (const file of ['bang-fixture-framing.cjs', 'bang-fixture-framing.test.cjs', 'bang-fixture-integration.test.cjs']) assert(SOURCE_FILES.some(entry => entry.endsWith('/' + file)));
  assert(source.indexOf('const runMode = fixtureRunMode();') < source.indexOf('fs.mkdirSync(outputDir'));
  const branch = source.slice(source.indexOf('if (FIXTURES_ONLY) {'), source.indexOf('const active = actors.find', source.indexOf('if (FIXTURES_ONLY) {')));
  assert(branch.indexOf('await fixtures(actors, roomCode, runMode.batch)') < branch.indexOf('await normalExit(actor)'));
  assert.match(source, /if \(framed\) framed.assertComplete\(\)/);
});
