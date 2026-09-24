import type { DixitCardId } from './dixit-odyssey';

export const DIXIT_MIN_PLAYERS = 3;
export const DIXIT_MAX_PLAYERS = 12;
export const DIXIT_WIN_SCORE = 30;
export const DIXIT_CLUE_MAX_LENGTH = 240;
export const DIXIT_RULES_VERSION = 'odyssey-2024-base-original-art-v1';
export const DIXIT_CARD_IDS: readonly DixitCardId[] = Object.freeze(
  Array.from({ length: 84 }, (_, index) => `dream-${String(index + 1).padStart(2, '0')}` as DixitCardId),
);
