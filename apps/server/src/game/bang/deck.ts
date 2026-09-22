import { BANG_CARD_COUNTS, type BangCard, type BangCardName, type BangSuit } from '@zuychin-arcade/types';

export type BangRandomSource = () => number;
type Face = readonly [rank: string, suit: BangSuit];

const range = (ranks: string[], suit: BangSuit): Face[] => ranks.map((rank) => [rank, suit] as const);
const twoToAce = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

// Official DV Games base-game card list. Card checks depend on these exact faces.
const OFFICIAL_FACES: Record<BangCardName, Face[]> = {
  barrel: [['Q','spades'],['K','spades']],
  dynamite: [['2','hearts']],
  scope: [['A','spades']],
  mustang: [['8','hearts'],['9','hearts']],
  jail: [['J','spades'],['4','hearts'],['10','spades']],
  remington: [['K','clubs']],
  rev_carabine: [['A','clubs']],
  schofield: [['J','clubs'],['Q','clubs'],['K','spades']],
  volcanic: [['10','spades'],['10','clubs']],
  winchester: [['8','spades']],
  bang: [['A','spades'],...range(twoToAce,'diamonds'),...range(['2','3','4','5','6','7','8','9'],'clubs'),...range(['Q','K','A'],'hearts')],
  beer: range(['6','7','8','9','10','J'],'hearts'),
  cat_balou: [['K','hearts'],...range(['9','10','J'],'diamonds')],
  stagecoach: [['9','spades'],['9','spades']],
  duel: [['Q','diamonds'],['J','spades'],['8','clubs']],
  general_store: [['9','clubs'],['Q','spades']],
  gatling: [['10','hearts']],
  indians: [['K','diamonds'],['A','diamonds']],
  missed: [...range(['10','J','Q','K','A'],'clubs'),...range(['2','3','4','5','6','7','8'],'spades')],
  panic: [['J','hearts'],['Q','hearts'],['A','hearts'],['8','diamonds']],
  saloon: [['5','hearts']],
  wells_fargo: [['3','hearts']],
};

export function shuffleBang<T>(items: readonly T[], rng: BangRandomSource): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function createBangDeck(rng: BangRandomSource): BangCard[] {
  const cards: BangCard[] = [];
  for (const [name, faces] of Object.entries(OFFICIAL_FACES) as [BangCardName, Face[]][]) {
    if (faces.length !== BANG_CARD_COUNTS[name]) throw new Error(`BANG manifest mismatch for ${name}`);
    faces.forEach(([rank, suit], index) => cards.push({ id: `${name}-${index + 1}`, name, suit, rank }));
  }
  return shuffleBang(cards, rng);
}
