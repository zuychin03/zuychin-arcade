import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
const KEY_BYTES = 32;
const FORMAT = 'scrypt-v1';

export async function hashRoomPassword(password: string | null): Promise<string | null> {
  if (password === null) return null;
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, KEY_BYTES) as Buffer;
  return `${FORMAT}:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

export async function verifyRoomPassword(password: string, encoded: string): Promise<boolean> {
  const [format, saltText, keyText, ...rest] = encoded.split(':');
  if (format !== FORMAT || !saltText || !keyText || rest.length > 0) return false;

  try {
    const expected = Buffer.from(keyText, 'base64url');
    if (expected.length !== KEY_BYTES) return false;
    const actual = await deriveKey(password, Buffer.from(saltText, 'base64url'), KEY_BYTES) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
