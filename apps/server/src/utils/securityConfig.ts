import { isIP } from 'node:net';

export const REST_BODY_LIMIT_BYTES = 16 * 1024;
export const SOCKET_PAYLOAD_LIMIT_BYTES = 64 * 1024;
export const AUTH_TOKEN_LIMIT_CHARS = 4 * 1024;

const IPV4_MAPPED_START = 0xffffn << 32n;
type AddressRange = readonly [bigint, bigint];

function proxyRange(address: string, version: number, prefix: number): AddressRange {
  let value: bigint;
  if (version === 4) {
    value = IPV4_MAPPED_START + address.split('.').reduce((sum, part) => (sum << 8n) + BigInt(part), 0n);
    prefix += 96;
  } else {
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const [left, right] = canonical.split('::');
    const leading = left!.split(':').filter(Boolean);
    const trailing = right?.split(':').filter(Boolean) ?? [];
    const words = right === undefined ? leading : [...leading, ...Array<string>(8 - leading.length - trailing.length).fill('0'), ...trailing];
    value = words.reduce((sum, word) => (sum << 16n) + BigInt(`0x${word}`), 0n);
  }
  const hostBits = BigInt(128 - prefix);
  const start = (value >> hostBits) << hostBits;
  return [start, start + (1n << hostBits) - 1n];
}

function coversRange(ranges: AddressRange[], start: bigint, end: bigint): boolean {
  let next = start;
  for (const [low, high] of [...ranges].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) {
    if (high < next) continue;
    if (low > next) return false;
    next = high + 1n;
    if (next > end) return true;
  }
  return false;
}

export function isInsecureLocalDev(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ARCADE_INSECURE_LOCAL_DEV?.trim().toLowerCase() === 'true';
}

export function serverListenHost(env: NodeJS.ProcessEnv = process.env): string {
  if (isInsecureLocalDev(env)) return '127.0.0.1';
  return env.HOST?.trim() || '0.0.0.0';
}

export function configuredTrustProxy(env: NodeJS.ProcessEnv = process.env): false | string[] {
  if (env.ARCADE_TRUST_PROXY_HOPS?.trim()) {
    throw new Error('ARCADE_TRUST_PROXY_HOPS is unsupported; use verified proxy addresses in ARCADE_TRUST_PROXY_CIDRS');
  }
  const configured = env.ARCADE_TRUST_PROXY_CIDRS?.trim();
  if (!configured) return false;
  const addresses = configured.split(',').map((value) => value.trim());
  const ranges: AddressRange[] = [];
  for (const entry of addresses) {
    const [address, prefix, extra] = entry.split('/');
    const version = isIP(address ?? '');
    const maxPrefix = version === 4 ? 32 : 128;
    if (!version || address?.includes('%') || extra !== undefined ||
      (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > maxPrefix))) {
      throw new Error('ARCADE_TRUST_PROXY_CIDRS requires explicit IP addresses or CIDR ranges with a nonzero prefix');
    }
    ranges.push(proxyRange(address!, version, prefix === undefined ? maxPrefix : Number(prefix)));
  }
  // Fastify also compares IPv4 peers against IPv6 mapped ranges.
  if (coversRange(ranges, IPV4_MAPPED_START, IPV4_MAPPED_START + (1n << 32n) - 1n) ||
    coversRange(ranges, 0n, (1n << 128n) - 1n)) {
    throw new Error('ARCADE_TRUST_PROXY_CIDRS must not collectively trust every IPv4 or IPv6 address');
  }
  return [...new Set(addresses)];
}
