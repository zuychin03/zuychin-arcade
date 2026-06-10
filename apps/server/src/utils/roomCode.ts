// Mining-themed word list — fits the Saboteur theme
const WORDS = [
  'GOLD', 'MOLE', 'PICK', 'CART', 'LAMP',
  'ROCK', 'VEIN', 'MINE', 'DEEP', 'DUST',
  'AXEL', 'SLAB', 'SEAM', 'LODE', 'NUGGET',
];

export function generateRoomCode(): string {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const num = String(Math.floor(Math.random() * 90) + 10);  // 10–99
  return `${word}-${num}`;
}

export function generateUniqueRoomCode(exists: (code: string) => boolean): string {
  for (let i = 0; i < 10; i++) {
    const code = generateRoomCode();
    if (!exists(code)) return code;
  }
  throw new Error('Could not generate a unique room code');
}
