import assert from 'node:assert/strict';
import { complete, harness, rejected, start } from './protocolHarness.js';

const h = await harness();
let commands = 0;
try {
  for (const count of [2, 3, 4, 5, 6]) {
    const clients = await h.group(count);
    for (let match = 0; match < 2; match += 1) {
      await start(clients);
      if (match > 0) {
        assert.match(await rejected(clients[0]!, 'libertalia:select', {
          rank: clients[0]!.mine!.hand[0], expectedRevision: 0,
        }), /changed|refresh/i);
      }
      const accepted = await complete(clients);
      commands += accepted;
      assert.equal(clients[0]!.game!.voyage, 3);
      console.log(`${count} seats, ${match ? 'full rematch' : 'full match'}: ${accepted} accepted decisions`);
    }
    for (const client of clients) {
      assert.equal((await h.request(`/rooms/${client.auth.roomCode}/leave`, {}, client.auth.token)).status, 200);
      client.socket.disconnect();
    }
  }
  console.log(`LIBERTALIA ISOLATED SMOKE PASS: 10 full projection-only matches, ${commands} accepted commands, sender-only acknowledgements, privacy, rematch replay fence, normal exits.`);
} finally { await h.close(); }
