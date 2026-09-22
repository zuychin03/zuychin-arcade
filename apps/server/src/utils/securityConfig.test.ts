import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { configuredTrustProxy } from './securityConfig.js';

test('proxy trust defaults off and accepts only explicit address allowlists', () => {
  assert.equal(configuredTrustProxy({}), false);
  assert.equal(configuredTrustProxy({ ARCADE_TRUST_PROXY_CIDRS: '  ' }), false);
  assert.deepEqual(configuredTrustProxy({
    ARCADE_TRUST_PROXY_CIDRS: ' 192.0.2.0/24, ::1/128, 198.51.100.4, ::1/128 ',
  }), ['192.0.2.0/24', '::1/128', '198.51.100.4']);
});

test('legacy hop-count trust requires an explicit migration', () => {
  for (const legacy of ['1', '0', '11', 'true']) {
    assert.throws(() => configuredTrustProxy({
      ARCADE_TRUST_PROXY_HOPS: legacy,
      ARCADE_TRUST_PROXY_CIDRS: '192.0.2.0/24',
    }), /ARCADE_TRUST_PROXY_CIDRS/);
  }
});

for (const value of ['true', '*', 'loopback', 'example.com', '127.0.0.1/33', '::1/129',
  '0.0.0.0/0', '::/0', '127.0.0.1/1.5', '127.0.0.1,', '127.0.0.1,,::1',
  'https://secret@example.invalid', '127.0.0.1/32/1', '127.0.0.1/', 'fe80::1%eth0',
  '::ffff:0.0.0.0/96', '0:0:0:0:0:ffff:0:0/96', '::ffff:192.0.2.1/1',
  '::/80', '::1234/80', '::/1', '0.0.0.0/1,128.0.0.0/1',
  '0.0.0.1/1,::ffff:128.0.0.1/97', '::/1,8000::/1',
  '::fffe:0:0/95', '1.2.3.4/1,198.51.100.8/1']) {
  test(`rejects unsafe proxy configuration ${value.includes('secret') ? '(redacted)' : value}`, () => {
    assert.throws(() => configuredTrustProxy({ ARCADE_TRUST_PROXY_CIDRS: value }), (error: Error) => {
      assert.equal(error.message.includes('secret'), false);
      return /ARCADE_TRUST_PROXY_CIDRS/.test(error.message);
    });
  });
}

async function inspect(remoteAddress: string, forwarded: string, allowlist = '192.0.2.0/24') {
  const app = Fastify({ trustProxy: configuredTrustProxy({ ARCADE_TRUST_PROXY_CIDRS: allowlist }) });
  app.get('/', (request) => ({ ip: request.ip, host: request.host, protocol: request.protocol }));
  try {
    const response = await app.inject({
      method: 'GET', url: '/', remoteAddress,
      headers: {
        host: 'arcade.example', 'x-forwarded-for': forwarded,
        'x-forwarded-host': 'forwarded.example', 'x-forwarded-proto': 'https',
      },
    });
    assert.equal(response.statusCode, 200);
    return response.json<{ ip: string; host: string; protocol: string }>();
  } finally {
    await app.close();
  }
}

test('untrusted peers cannot spoof identity, host or protocol', async () => {
  assert.deepEqual(await inspect('198.51.100.8', '203.0.113.77'), {
    ip: '198.51.100.8', host: 'arcade.example', protocol: 'http',
  });
});

test('verified proxy addresses can supply forwarded headers', async () => {
  assert.deepEqual(await inspect('192.0.2.4', '203.0.113.77'), {
    ip: '203.0.113.77', host: 'forwarded.example', protocol: 'https',
  });
});

test('forwarded client traversal stops at the nearest untrusted hop', async () => {
  assert.equal((await inspect('192.0.2.4', '203.0.113.77, 198.51.100.8')).ip, '198.51.100.8');
});

test('IPv6 proxy addresses and mapped IPv4 addresses preserve the trust boundary', async () => {
  assert.equal((await inspect('2001:db8:1::4', '203.0.113.77', '2001:db8:1::/48')).ip, '203.0.113.77');
  assert.equal((await inspect('2001:db8:2::4', '203.0.113.77', '2001:db8:1::/48')).host, 'arcade.example');
  assert.equal((await inspect('::ffff:192.0.2.4', '203.0.113.77')).ip, '203.0.113.77');
  assert.equal((await inspect('::ffff:192.0.2.4', '203.0.113.77', '::ffff:192.0.2.0/120')).ip, '203.0.113.77');
  assert.equal((await inspect('::ffff:198.51.100.8', '203.0.113.77')).host, 'arcade.example');
});

test('non-universal ranges remain valid after canonicalising host bits and mixed families', async () => {
  assert.deepEqual(configuredTrustProxy({ ARCADE_TRUST_PROXY_CIDRS: '::/96,::ffff:192.0.2.1/120,198.51.100.7/24' }),
    ['::/96', '::ffff:192.0.2.1/120', '198.51.100.7/24']);
  assert.equal((await inspect('192.0.2.4', '203.0.113.77', '::ffff:192.0.2.1/120')).ip, '203.0.113.77');
  assert.equal((await inspect('198.51.100.8', '203.0.113.77', '::/96')).host, 'arcade.example');
  assert.deepEqual(configuredTrustProxy({ ARCADE_TRUST_PROXY_CIDRS: '0.0.0.0/2,128.0.0.0/1' }),
    ['0.0.0.0/2', '128.0.0.0/1']);
});
