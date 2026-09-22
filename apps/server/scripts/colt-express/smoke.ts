import assert from 'node:assert/strict';
import { complete, harness, paired, start, until } from './protocolHarness.js';

let commands = 0;
for (let count = 2; count <= 6; count += 1) {
  const h = await harness();
  try {
    const clients = await h.group(count, ' train ');
    await start(clients);
    const first = await complete(clients);
    const old = clients[count - 1]!;
    old.socket.disconnect();
    clients[count - 1] = await h.connect(old.auth);
    await paired(clients, clients[0]!.game!.revision);
    await start(clients);
    const second = await complete(clients);
    commands += first + second;
    for (const client of clients) {
      assert.equal(client.rejections.length, 0);
      assert.equal((await h.request(`/rooms/${client.auth.roomCode}/leave`, {}, client.auth.token)).status, 200);
      await until(() => !client.socket.connected);
    }
    console.log(JSON.stringify({ players: count, games: 2, first, rematch: second, normalExits: count }));
  } finally { await h.close(); }
}
console.log(JSON.stringify({ games: 10, acceptedCommands: commands, hostedPersistence: false }));
