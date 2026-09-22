import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_PATTERN } from '@zuychin-arcade/types';

// Eight unambiguous base-32 characters provide 40 bits of room-code entropy.
export { ROOM_CODE_PATTERN };

export function generateRoomCode(): string {
  const segment = () => Array.from(
    { length: 4 },
    () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
  ).join('');
  return `${segment()}-${segment()}`;
}

export function isRoomCode(value: string): boolean {
  return ROOM_CODE_PATTERN.test(value.toUpperCase().trim());
}

export function generateUniqueRoomCode(exists: (code: string) => boolean): string {
  for (let i = 0; i < 10; i++) {
    const code = generateRoomCode();
    if (!exists(code)) return code;
  }
  throw new Error('Could not generate a unique room code');
}
