import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { accepted, assertPrivacy, harness, until, rejected, start, complete, step, paired } from '../../../scripts/colt-express/protocolHarness.js';
import { chooseProjectionCommand } from '../../../scripts/colt-express/projectionDriver.js';
import { roomStore } from '../../store/RoomStore.js';
import { io } from 'socket.io-client';
import { markPlayerDisconnected } from '../../socket/roomLifecycle.js';
import { isColtProgramPayload, isColtChoicePayload, isColtAssignStartPayload, isColtChooseCharacterPayload, isColtChooseTeamPayload, isColtReservePayload, isColtStartPayload, buildColtResult, recoverDisconnectedColtPlayers } from './socketHandlers.js';
import { toColtPrivateState } from './publicState.js';
import { validateColt } from './engine.js';

async function startWithCharacters(clients: Parameters<typeof start>[0]) {
  await start(clients);
  while (clients[0]!.game!.phase === 'character_selection') assert.ok(await step(clients));
}

function stateOf(code: string) {
  const game = roomStore.get(code)!.game;
  assert.equal(game?.id, 'colt_express');
  if (game?.id !== 'colt_express') throw new Error('Missing Colt game');
  return game.state;
}

test('simultaneous character choice is exact-revision, unique, one-time and private before final setup', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await start(clients);
    assert.equal(clients[0]!.game!.phase, 'character_selection');
    assert.equal(clients[0]!.game!.firstPlayerId, null);
    assert.equal(clients[0]!.game!.availableCharacters.length, 6);
    for (const client of clients) {
      assert.equal(client.mine!.canChooseCharacter, true);
      assert.deepEqual(client.mine!.hand, []);
      assert.ok(client.game!.players.every((player) => player.character === null && player.characters.length === 0 && player.positions.length === 0));
    }
    const payload = { character: 'ghost', expectedRevision: 0 };
    clients[0]!.socket.emit('colt:choose-character', payload);
    clients[1]!.socket.emit('colt:choose-character', payload);
    await until(() => clients.reduce((sum, client) => sum + client.rejections.length, 0) === 1);
    await paired(clients, 1);
    assert.equal(clients.reduce((sum, client) => sum + client.acks.filter((ack) => ack.action === 'choose-character').length, 0), 1);
    const chosen = clients.find((client) => !client.mine!.canChooseCharacter)!;
    const unchosen = clients.find((client) => client.mine!.canChooseCharacter)!;
    assert.match(await rejected(chosen, 'colt:choose-character', { character: 'doc', expectedRevision: 1 }), /already|choose|selected/i);
    assert.match(await rejected(unchosen, 'colt:choose-character', { character: 'ghost', expectedRevision: 1 }), /available|taken|chosen|character/i);
    assert.equal(chosen.game!.revision, 1);
    assert.ok(clients.every((client) => client.mine!.hand.length === 0 && client.game!.players.every((player) => player.positions.length === 0)));
    const oldIndex = clients.indexOf(chosen);
    const replacement = await h.connect(chosen.auth);
    clients[oldIndex] = replacement;
    await until(() => !chosen.socket.connected && replacement.mine !== null);
    assert.equal(replacement.mine!.canChooseCharacter, false);
    assert.deepEqual(replacement.mine!.hand, []);
    while (clients[0]!.game!.phase === 'character_selection') assert.ok(await step(clients));
    assert.equal(clients[0]!.game!.phase, 'programming');
    assert.equal(new Set(clients[0]!.game!.players.map((player) => player.character)).size, 3);
    assert.ok(clients.every((client) => client.mine!.hand.length >= 6));
    assert.ok(clients[0]!.game!.players.every((player) => player.positions.length === 1));
  } finally { await h.close(); }
});

test('malformed and missing-revision character commands cannot claim a bandit', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await start(clients);
    for (const payload of [null, [], {}, { character: 'ghost' }, { character: 'invented', expectedRevision: 0 }, { character: 'doc', expectedRevision: 0, other: true }]) assert.match(await rejected(clients[0]!, 'colt:choose-character', payload), /payload/i);
    assert.equal(clients[0]!.game!.revision, 0);
    assert.ok(clients[0]!.game!.players.every((player) => !player.characterChosen));
    assert.ok(await step(clients));
  } finally { await h.close(); }
});

for (const chosen of [false, true]) {
  test(`character setup REST forfeit (already chosen=${chosen}) retires without fresh programming`, async () => {
    const h = await harness();
    try {
      const clients = await h.group(4);
      await start(clients);
      const departed = clients.shift()!;
      const game = stateOf(departed.auth.roomCode);
      if (chosen) {
        const ack = await accepted(departed, 'colt:choose-character', { character: 'ghost', expectedRevision: 0 }, 'choose-character');
        await paired([departed, ...clients], ack.revision);
      }
      assert.equal((await h.request(`/rooms/${departed.auth.roomCode}/leave`, {}, departed.auth.token)).status, 200);
      await until(() => game.players.get(departed.auth.playerId)!.forfeited);
      await paired(clients, game.revision);
      assert.ok(!clients[0]!.game!.turnOrder.includes(departed.auth.playerId));
      assert.equal(clients[0]!.game!.availableCharacters.includes('ghost'), !chosen);
      assert.equal(game.program.length, 0);
      while (clients[0]!.game!.phase === 'character_selection') assert.ok(await step(clients));
      assert.equal(clients[0]!.game!.phase, 'programming');
      assert.equal(clients[0]!.game!.players.length, 4);
      assert.equal(clients[0]!.game!.twoBanditMode, false);
      assert.equal(toColtPrivateState(game, departed.auth.playerId).canChooseCharacter, false);
      assert.equal(toColtPrivateState(game, departed.auth.playerId).hand.length, 0);
      assert.ok(await step(clients));
    } finally { await h.close(); }
  });
}

test('last unchosen seat grace expiry unblocks two original single-bandit survivors', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await start(clients);
    for (const client of clients.slice(0, 2)) {
      const character = client.game!.availableCharacters[0]!;
      const ack = await accepted(client, 'colt:choose-character', { character, expectedRevision: client.game!.revision }, 'choose-character');
      await paired(clients, ack.revision);
    }
    const departed = clients.pop()!;
    const room = roomStore.get(departed.auth.roomCode)!;
    const game = stateOf(room.roomCode);
    departed.socket.disconnect();
    await until(() => !room.players.get(departed.auth.playerId)!.isConnected);
    markPlayerDisconnected(h.server, room, departed.auth.playerId, null, 20);
    await until(() => game.players.get(departed.auth.playerId)!.forfeited);
    await paired(clients, game.revision);
    assert.equal(clients[0]!.game!.phase, 'programming');
    assert.equal(clients[0]!.game!.twoBanditMode, false);
    assert.equal(clients[0]!.game!.turnOrder.length, 2);
    assert.ok(clients.every((client) => client.game!.players.find((player) => player.playerId === client.auth.playerId)!.characters.length === 1));
    assert.ok(await step(clients));
  } finally { await h.close(); }
});

test('actual finalizer calls the disabled/mock result writer once, never for abandonment', () => {
  const source = ts.createSourceFile('socketHandlers.ts', readFileSync(new URL('./socketHandlers.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'finalize');
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const winners of [['winner'], []]) {
    let writes = 0, updates = 0;
    const game = { status: 'game_over', winnerPlayerIds: winners };
    const room = { status: 'in_game', roomCode: 'MOCK', timer: null };
    const context = { state: () => game, buildColtResult: () => winners.length ? { players: [] } : null,
      saveGameResult: () => { writes += 1; return Promise.resolve('disabled'); },
      getRoomPublicState: () => ({}), clearTimeout, finalize: undefined as unknown };
    runInNewContext(code, context);
    const finalize = context.finalize as (io: unknown, room: unknown) => void;
    const io = { to: () => ({ emit: () => { updates += 1; } }) };
    finalize(io, room); finalize(io, room); finalize(io, room);
    assert.equal(writes, winners.length ? 1 : 0);
    assert.equal(updates, 1);
    assert.equal(room.status, 'finished');
  }
});

test('canonical Cheyenne escrow survives real REST departure and stale continuation is rejected', async () => {
  const h = await harness();
  try {
    const clients = await h.group(4);
    await startWithCharacters(clients);
    const game = stateOf(clients[0]!.auth.roomCode);
    const actor = clients[0]!, victim = clients[1]!;
    game.firstIndex = 0;
    game.currentRoundCard = { ...game.currentRoundCard, turns: ['standard'], event: 'none' };
    game.slots = 1;
    const player = game.players.get(actor.auth.playerId)!;
    const cheyenne = [...game.players.values()].find((candidate) => candidate.characters[0] === 'cheyenne');
    if (cheyenne) cheyenne.characters[0] = player.characters[0]!;
    player.characters[0] = 'cheyenne';
    const victimPlayer = game.players.get(victim.auth.playerId)!;
    if (victimPlayer.characters[0] === 'belle') {
      const replacement = [...game.players.values()].find((candidate) => candidate !== player && candidate !== victimPlayer)!;
      victimPlayer.characters[0] = replacement.characters[0]!; replacement.characters[0] = 'belle';
    }
    for (const candidate of game.players.values()) candidate.positions[0] = { carIndex: 0, level: 'inside' };
    let punch = player.hand.find((card) => card.action === 'punch');
    if (!punch) { punch = player.deck.splice(player.deck.findIndex((card) => card.action === 'punch'), 1)[0]!; player.hand.push(punch); }
    validateColt(game);
    for (const client of clients) { client.game = null; client.mine = null; client.socket.emit('request_state'); }
    await paired(clients, game.revision);
    let ack = await accepted(actor, 'colt:program', { cardId: punch.id, expectedRevision: game.revision }, 'program');
    await paired(clients, ack.revision);
    while (clients[0]!.game!.phase === 'programming') {
      const next = clients.find((client) => client.mine!.canProgram)!;
      ack = await accepted(next, 'colt:program', { draw: true, expectedRevision: next.game!.revision }, 'program');
      await paired(clients, ack.revision);
    }
    const option = actor.game!.pending!.options.find((choice) => choice.id.startsWith(victim.auth.playerId))!;
    ack = await accepted(actor, 'colt:choose', { optionId: option.id, expectedRevision: actor.game!.revision }, 'choose');
    await paired(clients, ack.revision);
    assert.equal(game.pendingEvent?.kind, 'cheyenne');
    const escrow = game.pendingEvent!.loot!.id;
    const stale = { optionId: 'take', expectedRevision: game.revision };
    assert.equal((await h.request(`/rooms/${actor.auth.roomCode}/leave`, {}, actor.auth.token)).status, 200);
    await until(() => player.forfeited);
    const survivors = clients.slice(1);
    await paired(survivors, game.revision);
    assert.equal(game.pendingEvent, null);
    assert.ok(Object.values(game.lootBySpace).flat().some((loot) => loot.id === escrow));
    assert.ok(!player.lootByBandit.flat().some((loot) => loot.id === escrow));
    assert.match(await rejected(survivors[0]!, 'colt:choose', stale), /changed/i);
    validateColt(game);
  } finally { await h.close(); }
});

for (const faceDown of [false, true]) {
  test(`canonical Ghost explicit faceDown=${faceDown} is acknowledged and projected without leaking a hidden action`, async () => {
    const h = await harness();
    try {
      const clients = await h.group(3);
      await startWithCharacters(clients);
      const actor = clients.find((client) => client.mine!.canProgram)!;
      const game = stateOf(actor.auth.roomCode);
      const player = game.players.get(actor.auth.playerId)!;
      const ghost = [...game.players.values()].find((candidate) => candidate.characters[0] === 'ghost');
      if (ghost) ghost.characters[0] = player.characters[0]!;
      player.characters[0] = 'ghost';
      validateColt(game);
      for (const client of clients) { client.game = null; client.mine = null; client.socket.emit('request_state'); }
      await paired(clients, game.revision);
      assert.equal(actor.mine!.canHideFirstAction, true);
      const card = actor.mine!.hand.find((candidate) => candidate.action !== 'bullet')!;
      const payload = { cardId: card.id, faceDown, expectedRevision: actor.game!.revision };
      const ack = await accepted(actor, 'colt:program', payload, 'program');
      await paired(clients, ack.revision);
      for (const client of clients) {
        const publicCard = client.game!.program[0]!;
        assert.equal(publicCard.faceUp, !faceDown);
        assert.equal(publicCard.action, faceDown ? null : card.action);
        assert.equal(publicCard.ownerBandit, faceDown ? null : card.ownerBandit);
      }
      assert.match(await rejected(actor, 'colt:program', payload), /changed/i);
    } finally { await h.close(); }
  });
}

test('canonical optional Pickpocket expiry skips fresh loot and retires before the next round', async () => {
  const h = await harness();
  try {
    const clients = await h.group(4);
    await startWithCharacters(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    const game = stateOf(room.roomCode);
    game.firstIndex = 0;
    game.currentRoundCard = { ...game.currentRoundCard, turns: ['standard'], event: 'pickpocketing' };
    game.slots = 1;
    game.turnOrder.forEach((id, index) => { game.players.get(id)!.positions[0] = { carIndex: index, level: 'inside' }; });
    const ghost = game.players.get(clients[0]!.auth.playerId)!;
    const purse = ghost.lootByBandit[0]!.pop()!;
    game.lootBySpace['0:inside']!.push(purse);
    validateColt(game);
    for (const client of clients) { client.game = null; client.mine = null; client.socket.emit('request_state'); }
    await paired(clients, game.revision);
    while (clients[0]!.game!.phase === 'programming') {
      const actor = clients.find((client) => client.mine!.canProgram)!;
      const ack = await accepted(actor, 'colt:program', { draw: true, expectedRevision: actor.game!.revision }, 'program');
      await paired(clients, ack.revision);
    }
    assert.equal(game.pendingEvent?.kind, 'pickpocket');
    assert.equal(game.pending!.playerId, ghost.playerId);
    const departed = clients.shift()!;
    departed.socket.disconnect();
    await until(() => !room.players.get(ghost.playerId)!.isConnected);
    markPlayerDisconnected(h.server, room, ghost.playerId, null, 20);
    await until(() => ghost.forfeited);
    await paired(clients, game.revision);
    assert.equal(ghost.lootByBandit[0]!.length, 0);
    assert.notEqual(game.pending?.playerId, ghost.playerId);
    while (clients[0]!.game!.round === 1) assert.ok(await step(clients));
    assert.ok(!clients[0]!.game!.turnOrder.includes(ghost.playerId));
    validateColt(game);
  } finally { await h.close(); }
});

test('REST departure skips new programming, retires next round and survivors complete normally', async () => {
  const h = await harness();
  try {
    const clients = await h.group(4);
    await startWithCharacters(clients);
    const departed = clients.find((client) => client.mine!.canProgram)!;
    const survivors = clients.filter((client) => client !== departed);
    const code = departed.auth.roomCode;
    const game = stateOf(code);
    const priorProgram = game.program.length;
    assert.equal((await h.request(`/rooms/${code}/leave`, {}, departed.auth.token)).status, 200);
    await until(() => game.players.get(departed.auth.playerId)!.forfeited);
    await paired(survivors, game.revision);
    assert.equal(game.program.length, priorProgram, 'Forfeit invented a new programmed card');
    assert.notEqual(survivors[0]!.game!.programmingPlayerId, departed.auth.playerId);
    const privateGhost = toColtPrivateState(game, departed.auth.playerId);
    for (const flag of ['canAssignStart', 'canChooseTeam', 'canReserve', 'canProgram', 'canChoose'] as const) assert.equal(privateGhost[flag], false);
    while (survivors[0]!.game!.round === 1) assert.ok(await step(survivors));
    const publicGhost = survivors[0]!.game!.players.find((player) => player.playerId === departed.auth.playerId)!;
    assert.equal(publicGhost.forfeited, true);
    const archived = structuredClone(publicGhost);
    assert.equal(survivors[0]!.game!.turnOrder.includes(departed.auth.playerId), false);
    assert.equal(survivors[0]!.game!.initialPlayerCount, 4);
    assert.equal(survivors[0]!.game!.twoBanditMode, false);
    while (survivors[0]!.game!.status === 'playing') {
      assert.ok(!survivors[0]!.game!.pending?.options.some((option) => option.id.startsWith(departed.auth.playerId)));
      assert.ok(await step(survivors));
    }
    assert.equal(survivors[0]!.game!.endReason, 'score');
    const terminalGhost = survivors[0]!.game!.players.find((player) => player.playerId === departed.auth.playerId)!;
    assert.deepEqual(terminalGhost.positions, archived.positions, 'Retired historical position changed');
    assert.equal(terminalGhost.bulletsFired, archived.bulletsFired);
    assert.equal(terminalGhost.receivedBullets, archived.receivedBullets);
    assert.equal(terminalGhost.lootCount, archived.lootCount);
    const result = buildColtResult(game)!;
    assert.equal(result.players.length, 3);
    assert.ok(!result.players.some((player) => player.playerId === departed.auth.playerId));
    assert.equal(result.roundsPlayed, 5);
    const host = survivors.find((client) => client.room!.players.some((player) => player.playerId === client.auth.playerId && player.isHost))!;
    const ordered = [host, ...survivors.filter((client) => client !== host)];
    await start(ordered);
    assert.equal(ordered[0]!.game!.players.length, 3);
    assert.ok(!ordered[0]!.game!.players.some((player) => player.playerId === departed.auth.playerId));
  } finally { await h.close(); }
});

test('pending committed action forfeiture settles legally and does not strand the next player', async () => {
  const h = await harness();
  try {
    const clients = await h.group(4);
    await startWithCharacters(clients);
    let count = 0;
    while (!clients.some((client) => client.mine!.canChoose)) { assert.ok(count++ < 500); assert.ok(await step(clients)); }
    const departed = clients.find((client) => client.mine!.canChoose)!;
    const survivors = clients.filter((client) => client !== departed);
    const game = stateOf(departed.auth.roomCode);
    const oldRevision = game.revision;
    assert.equal((await h.request(`/rooms/${departed.auth.roomCode}/leave`, {}, departed.auth.token)).status, 200);
    await until(() => game.players.get(departed.auth.playerId)!.forfeited);
    await paired(survivors, game.revision);
    assert.ok(game.revision > oldRevision);
    assert.notEqual(survivors[0]!.game!.pending?.playerId, departed.auth.playerId);
    assert.ok(await step(survivors));
    await complete(survivors);
    assert.equal(buildColtResult(game)!.players.length, 3);
  } finally { await h.close(); }
});

test('final-round departure is excluded from natural scoring and later exits cannot rewrite it', async () => {
  const h = await harness();
  try {
    const clients = await h.group(4);
    await startWithCharacters(clients);
    while (clients[0]!.game!.round < 5) assert.ok(await step(clients));
    const departed = clients.find((client) => client.mine!.canProgram)!;
    const survivors = clients.filter((client) => client !== departed);
    const game = stateOf(departed.auth.roomCode);
    assert.equal((await h.request(`/rooms/${departed.auth.roomCode}/leave`, {}, departed.auth.token)).status, 200);
    await until(() => game.players.get(departed.auth.playerId)!.forfeited);
    await paired(survivors, game.revision);
    await complete(survivors);
    assert.equal(survivors[0]!.game!.endReason, 'score');
    assert.ok(!game.winnerPlayerIds.includes(departed.auth.playerId));
    const result = structuredClone(buildColtResult(game)!);
    assert.equal(result.players.length, 3);
    for (const row of result.players) assert.equal(row.score, survivors[0]!.game!.players.find((player) => player.playerId === row.playerId)!.finalScore);
    const leaver = survivors.shift()!;
    assert.equal((await h.request(`/rooms/${leaver.auth.roomCode}/leave`, {}, leaver.auth.token)).status, 200);
    assert.equal(game.players.get(leaver.auth.playerId)!.forfeited, false);
    assert.deepEqual(buildColtResult(game), result);
  } finally { await h.close(); }
});

for (const phase of ['team_selection', 'team_setup', 'reserve_card', 'programming', 'pending_choice']) {
  test(`two-player explicit departure in ${phase} crowns only the eligible survivor`, async () => {
    const h = await harness();
    try {
      const clients = await h.group(2);
      await startWithCharacters(clients);
      let count = 0;
      while (clients[0]!.game!.phase !== phase) { assert.ok(count++ < 500); assert.ok(await step(clients)); }
      const departed = clients.find((client) => client.mine!.canChoose || client.mine!.canChooseTeam || client.mine!.canProgram) ?? clients[0]!;
      const survivor = clients.find((client) => client !== departed)!;
      const game = stateOf(departed.auth.roomCode);
      assert.equal((await h.request(`/rooms/${departed.auth.roomCode}/leave`, {}, departed.auth.token)).status, 200);
      await until(() => survivor.game?.status === 'game_over');
      assert.equal(survivor.game!.endReason, 'forfeit');
      assert.deepEqual(survivor.game!.winnerPlayerIds, [survivor.auth.playerId]);
      assert.equal(buildColtResult(game)!.players.length, 1);
      assert.equal(buildColtResult(game)!.roundsPlayed, game.round);
      const terminal = structuredClone(survivor.game);
      survivor.socket.emit('request_state');
      assert.equal(recoverDisconnectedColtPlayers(h.server, roomStore.get(departed.auth.roomCode)!), false);
      assert.deepEqual(survivor.game, terminal);
    } finally { await h.close(); }
  });
}

for (const entry of ['command', 'request_state']) {
  test(`overdue batch is recovered before ${entry}, without a phantom winner or fresh card`, async () => {
    const h = await harness();
    try {
      const clients = await h.group(4);
      await startWithCharacters(clients);
      const actor = clients.find((client) => client.mine!.canProgram)!;
      const peers = clients.filter((client) => client !== actor);
      const room = roomStore.get(actor.auth.roomCode)!;
      const game = stateOf(room.roomCode);
      const command = chooseProjectionCommand(actor.game!, actor.mine!)!;
      for (const client of peers) {
        client.socket.disconnect();
        await until(() => !room.players.get(client.auth.playerId)!.isConnected);
        const seat = room.players.get(client.auth.playerId)!;
        roomStore.clearPresenceTimer(seat);
        seat.reconnectDeadlineAt = Date.now() - 1;
      }
      if (entry === 'command') assert.match(await rejected(actor, command.event, command.payload), /changed/i);
      else actor.socket.emit('request_state');
      await until(() => actor.game?.status === 'game_over');
      assert.equal(game.program.length, 0);
      assert.deepEqual(game.winnerPlayerIds, [actor.auth.playerId]);
      assert.ok(peers.every((client) => game.players.get(client.auth.playerId)!.forfeited));
      assert.equal(buildColtResult(game)!.players.length, 1);
    } finally { await h.close(); }
  });
}

test('simultaneous scheduler expiry of every seat abandons without a competitive result', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await startWithCharacters(clients);
    const room = roomStore.get(clients[0]!.auth.roomCode)!;
    const game = stateOf(room.roomCode);
    for (const client of clients) {
      client.socket.disconnect();
      await until(() => !room.players.get(client.auth.playerId)!.isConnected);
      const seat = room.players.get(client.auth.playerId)!;
      roomStore.clearPresenceTimer(seat);
      seat.reconnectDeadlineAt = Date.now() - 1;
    }
    markPlayerDisconnected(h.server, room, clients[0]!.auth.playerId, null, 0);
    await until(() => game.status === 'game_over');
    assert.equal(game.endReason, 'forfeit');
    assert.deepEqual(game.winnerPlayerIds, []);
    assert.ok([...game.players.values()].every((player) => player.forfeited));
    assert.equal(buildColtResult(game), null);
    const revision = game.revision;
    assert.equal(recoverDisconnectedColtPlayers(h.server, room), false);
    assert.equal(game.revision, revision);
  } finally { await h.close(); }
});

test('actual default reconnect grace preserves eligibility before30s and forfeits after expiry', async (t) => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await startWithCharacters(clients);
    const departed = clients.find((client) => client.mine!.canProgram)!;
    const survivors = clients.filter((client) => client !== departed);
    const room = roomStore.get(departed.auth.roomCode)!;
    const game = stateOf(room.roomCode);
    const started = Date.now();
    departed.socket.disconnect();
    await until(() => !room.players.get(departed.auth.playerId)!.isConnected);
    const seat = room.players.get(departed.auth.playerId)!;
    assert.equal(seat.reconnectDeadlineAt! - seat.disconnectedAt!, 30_000);
    await new Promise((resolve) => setTimeout(resolve, 25_000));
    assert.equal(game.players.get(departed.auth.playerId)!.forfeited, false);
    assert.equal(game.revision, clients.length);
    await until(() => game.players.get(departed.auth.playerId)!.forfeited, 'normal30s expiry', 8_000);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 30_000);
    await paired(survivors, game.revision);
    while (survivors[0]!.game!.round === 1) assert.ok(await step(survivors));
    assert.ok(!survivors[0]!.game!.turnOrder.includes(departed.auth.playerId));
    assert.equal(survivors[0]!.game!.twoBanditMode, false);
    t.diagnostic(`Actual grace elapsed ${elapsed}ms; no manual deadline or shortened timer`);
  } finally { await h.close(); }
});

test('valid gameplay before start rejects rather than silently timing out', async () => {
  const h = await harness();
  try {
    const clients = await h.group(2);
    let snapshots = 0;
    clients[0]!.socket.on('room_updated', () => { snapshots += 1; });
    clients[0]!.socket.emit('request_state');
    await until(() => snapshots > 0, 'fresh lobby request_state');
    assert.match(await rejected(clients[0]!, 'colt:program', { draw: true, expectedRevision: 0 }), /not started/i);
    assert.equal(clients[0]!.game, null);
  } finally { await h.close(); }
});

test('malformed start does not prune an overdue reserved seat', async () => {
  const h = await harness();
  try {
    const clients = await h.group(2);
    const reservation = await h.join(clients[0]!.auth.roomCode, 'Reserved');
    const room = roomStore.get(reservation.roomCode)!;
    const seat = room.players.get(reservation.playerId)!;
    roomStore.clearPresenceTimer(seat);
    seat.reconnectDeadlineAt = Date.now() - 1;
    assert.match(await rejected(clients[0]!, 'start_game', { bad: true }), /invalid/i);
    assert.equal(room.players.has(reservation.playerId), true);
    assert.equal(room.game, null);
    assert.equal(room.status, 'lobby');
  } finally { await h.close(); }
});

test('password is exact, room is capped at six, and host authority is enforced', async () => {
  const h = await harness();
  try {
    const clients = await h.group(6, ' gale ');
    const host = clients[0]!;
    assert.equal(host.room!.maxPlayers, 6);
    assert.equal(host.room!.hasPassword, true);
    assert.equal((await h.request('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Wrong', password: 'gale' })).status, 403);
    assert.equal((await h.request('/rooms/join', { roomCode: host.auth.roomCode, displayName: 'Overflow', password: ' gale ' })).status, 409);
    assert.match(await rejected(clients[1]!, 'start_game', {}), /host/i);
    assert.equal((await h.request(`/rooms/${host.auth.roomCode}/kick`, { targetPlayerId: clients[2]!.auth.playerId }, clients[1]!.auth.token)).status, 403);
    assert.equal((await h.request(`/rooms/${host.auth.roomCode}/kick`, { targetPlayerId: clients[5]!.auth.playerId }, host.auth.token)).status, 200);
    await until(() => !clients[5]!.socket.connected);
    const remaining = clients.slice(0, 5);
    await start(remaining);
    assert.equal((await h.request(`/rooms/${host.auth.roomCode}/kick`, { targetPlayerId: clients[2]!.auth.playerId }, host.auth.token)).status, 409);
    assert.match(await rejected(host, 'start_game', {}), /progress/i);
  } finally { await h.close(); }
});

test('unconnected reservations and solo host cannot start', async () => {
  const h = await harness();
  try {
    const host = await h.connect(await h.create());
    assert.match(await rejected(host, 'start_game', {}), /at least 2/i);
    await h.join(host.auth.roomCode, 'Reserved');
    assert.match(await rejected(host, 'start_game', {}), /connecting/i);
    assert.equal(host.game, null);
  } finally { await h.close(); }
});

test('invalid socket tokens and foreign-room REST authority are rejected', async () => {
  const h = await harness();
  try {
    const clients = await h.group(2);
    const stranger = await h.create('Stranger');
    assert.equal((await h.request(`/rooms/${clients[0]!.auth.roomCode}/leave`, {}, stranger.token)).status, 403);
    assert.equal((await h.request(`/rooms/${clients[0]!.auth.roomCode}/leave`, {})).status, 401);
    const socket = io(h.url, { transports: ['websocket'], auth: { token: 'invalid' }, reconnection: false, autoConnect: false });
    try {
      const error = new Promise<Error>((resolve) => socket.once('connect_error', resolve));
      socket.connect();
      assert.match((await error).message, /INVALID_TOKEN/);
    } finally { socket.disconnect(); }
    assert.equal(clients[0]!.game, null);
  } finally { await h.close(); }
});

test('lobby host departure transfers start authority to a connected guest', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    const host = clients.shift()!;
    assert.equal((await h.request(`/rooms/${host.auth.roomCode}/leave`, {}, host.auth.token)).status, 200);
    await until(() => clients[0]!.room!.players.some((player) => player.playerId === clients[0]!.auth.playerId && player.isHost));
    await startWithCharacters(clients);
    assert.equal(clients[0]!.game!.players.length, 2);
  } finally { await h.close(); }
});

test('strict schemas reject unknown fields, unsafe revisions and ambiguous programming', () => {
  const validators = [
    [isColtChooseCharacterPayload, { character: 'ghost' }],
    [isColtProgramPayload, { cardId: 'card' }],
    [isColtChoicePayload, { optionId: 'option' }],
    [isColtAssignStartPayload, { cabooseBandit: 0 }],
    [isColtChooseTeamPayload, { teamIndex: 0 }],
    [isColtReservePayload, { cardId: 'card' }],
  ] as const;
  for (const [validate, valid] of validators) {
    assert.ok(validate({ ...valid, expectedRevision: 0 }));
    for (const revision of [undefined, null, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0']) assert.equal(validate({ ...valid, expectedRevision: revision }), false);
    assert.equal(validate({ ...valid, expectedRevision: 0, playerId: 'other' }), false);
    for (const malformed of [null, [], true, 2, 'card']) assert.equal(validate(malformed), false);
  }
  for (const payload of [null, [], false, { unexpected: true }]) assert.equal(isColtStartPayload(payload), false);
  assert.ok(isColtStartPayload(undefined));
  assert.ok(isColtStartPayload({}));
  assert.ok(isColtProgramPayload({ draw: true, expectedRevision: 0 }));
  for (const payload of [{ draw: false }, { draw: true, cardId: 'card' }, { cardId: '' }, { cardId: 'x', coverCardId: 'x' }, { draw: true, coverCardId: 'x' }]) assert.equal(isColtProgramPayload({ ...payload, expectedRevision: 0 }), false);
});

test('malformed host start is rejected without starting the room', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    clients[0]!.socket.emit('start_game', { unexpected: true });
    await until(() => clients[0]!.rejections.length > 0 || clients[0]!.game !== null);
    assert.equal(clients[0]!.game, null);
    assert.match(clients[0]!.rejections.at(-1)!, /payload/i);
  } finally { await h.close(); }
});

test('missing revision cannot mutate a legal programming decision', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    clients[0]!.socket.emit('start_game', {});
    await until(() => clients.every((client) => client.game && client.mine));
    while (clients[0]!.game!.phase === 'character_selection') assert.ok(await step(clients));
    const actor = clients.find((client) => client.mine!.canProgram)!;
    const revision = actor.game!.revision;
    actor.socket.emit('colt:program', { cardId: actor.mine!.hand.find((card) => card.action !== 'bullet')!.id });
    await until(() => actor.rejections.length > 0 || actor.game!.revision !== revision);
    assert.equal(actor.game!.revision, revision);
    assert.match(actor.rejections.at(-1)!, /payload/i);
  } finally { await h.close(); }
});

test('owned pending choices survive replacement and reconnect; foreign and replayed choices reject', async () => {
  const h = await harness();
  try {
    const clients = await h.group(4);
    await startWithCharacters(clients);
    let steps = 0;
    while (!clients.some((client) => client.mine!.canChoose)) {
      assert.ok(steps++ < 500);
      assert.ok(await step(clients));
    }
    const old = clients.find((client) => client.mine!.canChoose)!;
    const index = clients.indexOf(old);
    const snapshot = structuredClone(old.mine);
    const next = await h.connect(old.auth);
    clients[index] = next;
    await until(() => !old.socket.connected && next.mine !== null);
    assert.deepEqual(next.mine, snapshot);
    assertPrivacy(next);
    const other = clients.find((client) => client !== next)!;
    assert.equal(other.mine!.canChoose, false);
    const payload = { optionId: next.game!.pending!.options[0]!.id, expectedRevision: next.game!.revision };
    assert.match(await rejected(other, 'colt:choose', payload), /choice|choose|turn|waiting/i);
    assert.match(await rejected(next, 'colt:choose', { ...payload, optionId: 'invented' }), /choice|option|legal/i);
    const ack = await accepted(next, 'colt:choose', payload, 'choose');
    await paired(clients, ack.revision);
    assert.match(await rejected(next, 'colt:choose', payload), /changed|refresh|choice|choose/i);
    next.socket.disconnect();
    const restored = await h.connect(next.auth);
    clients[index] = restored;
    await paired(clients, ack.revision);
    assert.deepEqual(restored.mine, next.mine);
  } finally { await h.close(); }
});

test('duplicate programming commits once and wrong actor cannot consume a card', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await startWithCharacters(clients);
    const actor = clients.find((client) => client.mine!.canProgram)!;
    const other = clients.find((client) => client !== actor)!;
    const command = chooseProjectionCommand(actor.game!, actor.mine!)!;
    assert.match(await rejected(other, command.event, { ...command.payload, cardId: other.mine!.hand[0]!.id }), /turn/i);
    const before = actor.acks.length;
    actor.socket.emit(command.event, command.payload);
    actor.socket.emit(command.event, command.payload);
    await until(() => actor.acks.length === before + 1 && actor.rejections.length === 1);
    await paired(clients, command.payload.expectedRevision + 1);
    assert.equal(actor.mine!.programmedCardIds.length, 1);
    assert.ok(!actor.mine!.hand.some((card) => card.id === command.payload.cardId));
    assert.match(actor.rejections[0]!, /changed|refresh/i);
    for (const peer of clients.filter((client) => client !== actor)) assert.equal(peer.acks.filter((ack) => ack.action === 'program').length, 0);
  } finally { await h.close(); }
});

test('two-player private setup races retain exact revisions and conceal both positions until ready', async () => {
  const h = await harness();
  try {
    const clients = await h.group(2);
    await startWithCharacters(clients);
    while (clients[0]!.game!.phase === 'team_selection') assert.ok(await step(clients));
    const revision = clients[0]!.game!.revision;
    clients.forEach((client) => client.socket.emit('colt:assign-start', { cabooseBandit: 1, expectedRevision: revision }));
    await until(() => clients.reduce((n, client) => n + client.rejections.length, 0) === 1);
    await paired(clients, revision + 1);
    assert.equal(clients.reduce((n, client) => n + client.acks.filter((ack) => ack.action === 'assign-start').length, 0), 1);
    clients.forEach(assertPrivacy);
    const retry = clients.find((client) => client.mine!.canAssignStart)!;
    const ack = await accepted(retry, 'colt:assign-start', { cabooseBandit: 0, expectedRevision: revision + 1 }, 'assign-start');
    await paired(clients, ack.revision);
    assert.equal(clients[0]!.game!.phase, 'reserve_card');
    assert.ok(clients[0]!.game!.players.every((player) => player.positions.length === 2));
  } finally { await h.close(); }
});

test('malformed commands never mutate any active phase', async () => {
  const h = await harness();
  try {
    const clients = await h.group(3);
    await startWithCharacters(clients);
    const actor = clients[0]!;
    for (const event of ['program', 'assign-start', 'choose-team', 'choose-character', 'reserve', 'choose']) {
      for (const payload of [null, [], {}, { expectedRevision: 0 }, { expectedRevision: 0, rogue: true }]) assert.match(await rejected(actor, `colt:${event}`, payload), /payload/i);
    }
    assert.equal(actor.game!.revision, clients.length);
    assert.ok(await step(clients));
  } finally { await h.close(); }
});

for (let count = 2; count <= 6; count += 1) {
  test(`${count} seats complete all five rounds and a full rematch using only owned projections`, async () => {
    const h = await harness();
    try {
      const clients = await h.group(count);
      await start(clients);
      const old = clients.map((client) => ({ client, command: chooseProjectionCommand(client.game!, client.mine!) })).find((entry) => entry.command)!;
      const first = await complete(clients);
      assert.equal(clients[0]!.game!.round, 5);
      const terminal = clients[0]!.game!.revision;
      await start(clients);
      assert.equal(clients[0]!.game!.revision, terminal + 1);
      await rejected(old.client, old.command!.event, old.command!.payload);
      await paired(clients, terminal + 1);
      assert.ok(await step(clients));
      const second = 1 + await complete(clients);
      const finished = structuredClone(clients[1]!.game);
      assert.match(await rejected(clients[0]!, 'colt:program', { draw: true, expectedRevision: finished!.revision }), /turn|over|program/i);
      assert.deepEqual(clients[1]!.game, finished);
      assert.equal((await h.request(`/rooms/${clients[0]!.auth.roomCode}/leave`, {}, clients[0]!.auth.token)).status, 200);
      clients[1]!.socket.emit('request_state');
      await until(() => clients[1]!.room!.players.length === count - 1);
      assert.deepEqual(clients[1]!.game, finished, 'Completed game changed after normal exit');
      console.log(JSON.stringify({ count, games: 2, acceptedCommands: first + second }));
    } finally { await h.close(); }
  });
}
