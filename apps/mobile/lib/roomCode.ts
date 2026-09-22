import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_EXAMPLE,
  ROOM_CODE_PATTERN,
} from '@zuychin-arcade/types';

export { ROOM_CODE_EXAMPLE, ROOM_CODE_PATTERN };

const allowedRoomCodeCharacters = new Set(ROOM_CODE_ALPHABET);

export function formatRoomCodeInput(value: string): string {
  let characters = '';
  for (const inputCharacter of value) {
    const character = inputCharacter >= 'a' && inputCharacter <= 'z'
      ? inputCharacter.toUpperCase()
      : inputCharacter;
    if (allowedRoomCodeCharacters.has(character)) characters += character;
    if (characters.length === 8) break;
  }
  return characters.length > 4
    ? `${characters.slice(0, 4)}-${characters.slice(4)}`
    : characters;
}
