import type { FeedTheKrakenCharacter, FeedTheKrakenJourney, FeedTheKrakenMapAction, FeedTheKrakenMapNode, FeedTheKrakenNavigationCard } from './feed-the-kraken.js';

export const FEED_THE_KRAKEN_RULES_VERSION = 'base-1.0-digital-1';
export const FEED_THE_KRAKEN_CHARACTERS: readonly FeedTheKrakenCharacter[] = [
  'kleptomaniac', 'troublemaker', 'gunsmith', 'peacemaker', 'gunslinger', 'minstrel', 'boatswain',
  'herbalist', 'lookout', 'master_strategist', 'smuggler', 'agitator', 'adviser', 'chief_cook',
  'rabble_rouser', 'archivist', 'mentor', 'spiritualist', 'debt_collector', 'negotiator', 'instigator',
];
export const FEED_THE_KRAKEN_CHARACTER_NAMES: Record<FeedTheKrakenCharacter, string> = {
  kleptomaniac: 'Kleptomaniac', troublemaker: 'Troublemaker', gunsmith: 'Gunsmith', peacemaker: 'Peacemaker',
  gunslinger: 'Gunslinger', minstrel: 'Minstrel', boatswain: 'Boatswain', herbalist: 'Herbalist', lookout: 'Look-Out',
  master_strategist: 'Master Strategist', smuggler: 'Smuggler', agitator: 'Agitator', adviser: 'Adviser',
  chief_cook: 'Chief Cook', rabble_rouser: 'Rabble-Rouser', archivist: 'Archivist', mentor: 'Mentor',
  spiritualist: 'Spiritualist', debt_collector: 'Debt Collector', negotiator: 'Negotiator', instigator: 'Instigator',
};
export const FEED_THE_KRAKEN_CHARACTER_SUMMARIES: Record<FeedTheKrakenCharacter, string> = {
  kleptomaniac: 'Take one gun from a chosen crew member.', troublemaker: 'Double one player’s revealed gun strength for this mutiny.',
  gunsmith: 'Pay one gun. While revealed, recover one spent gun after each successful mutiny.',
  peacemaker: 'Return one player’s revealed guns and remove their bid from this mutiny.', gunslinger: 'Take two guns from the supply.',
  minstrel: 'After appointment, exclude two players from the next mutiny.', boatswain: 'Before cards are drawn, swap lieutenant and navigator.',
  herbalist: 'Before appointment, move an off-duty sign to a different player.', lookout: 'Inspect the top navigation card, then keep or discard it.',
  master_strategist: 'After bids are revealed, recover your bid unless you become captain.', smuggler: 'Before drawing, let captain or lieutenant draw three cards.',
  agitator: 'After appointment, require two players to bid at least one gun if able.', adviser: 'Before appointment, select the lieutenant.',
  chief_cook: 'Before appointment, pass captaincy clockwise to the crew member with the smallest resume.',
  rabble_rouser: 'After bids are revealed, halve the mutiny threshold, rounding up.', archivist: 'Before drawing, let captain or lieutenant replace their hand with two new cards.',
  mentor: 'Hide another player’s revealed character so they can use it again.', spiritualist: 'After yellow navigation, two players each give a gun to a chosen recipient.',
  debt_collector: 'After appointment, one navigation-team member gives a gun to each colleague.',
  negotiator: 'After appointment, set the next mutiny threshold to one and cap each bid at one.',
  instigator: 'After reveal, invite another player to add all remaining guns. If declined, recover this ability.',
};

export function feedTheKrakenDeck(journey: FeedTheKrakenJourney): FeedTheKrakenNavigationCard[] {
  const specs = [
    ['yellow', 'uprising', journey === 'quick' ? 5 : 6], ['blue', 'drunk', journey === 'quick' ? 3 : 4],
    ['blue', 'disarmed', 2], ['red', 'drunk', 5], ['red', 'mermaid', 2], ['red', 'telescope', 2], ['red', 'armed', journey === 'quick' ? 0 : 2],
  ] as const;
  return specs.flatMap(([colour, effect, count]) => Array.from({ length: count }, (_, i) => ({ id: `${colour}-${effect}-${i}`, colour, effect })));
}

const quickRows = [[0], [-1, 1], [-2, 0, 2], [-1, 1], [-2, 0, 2], [-3, -1, 1, 3], [-2, 0, 2], [-1, 1], [0]];
const longRows = [[0], [-1, 1], [0], [-1, 1], [-2, 0, 2], [-1, 1], [-2, 0, 2], [-3, -1, 1, 3], [-2, 0, 2], [-1, 1], [0]];
const quickExceptions: Record<string, [string, string, string]> = {
  '-2,2': ['-2,4', '-1,3', '-2,4'], '0,2': ['-1,3', '1,3', '-1,3'], '2,2': ['1,3', '2,4', '2,4'],
  '-3,5': ['pirate', '-2,6', '-2,6'], '3,5': ['2,6', 'sailor', '2,6'],
  '-2,6': ['pirate', '-1,7', '-1,7'], '2,6': ['1,7', 'sailor', '1,7'],
  '-1,7': ['pirate', '0,8', 'pirate'], '1,7': ['0,8', 'sailor', 'sailor'], '0,8': ['pirate', 'sailor', 'cult'],
};
const longExceptions: Record<string, [string, string, string]> = {
  '-1,1': ['-1,3', '0,2', '-1,3'], '1,1': ['0,2', '1,3', '1,3'],
  '-2,4': ['-2,6', '-1,5', '-2,6'], '0,4': ['-1,5', '1,5', '-1,5'], '2,4': ['1,5', '2,6', '2,6'],
  '-3,7': ['pirate', '-2,8', '-2,8'], '3,7': ['2,8', 'sailor', '2,8'],
  '-2,8': ['pirate', '-1,9', '-1,9'], '2,8': ['1,9', 'sailor', '1,9'],
  '-1,9': ['pirate', '0,10', 'pirate'], '1,9': ['0,10', 'sailor', 'sailor'], '0,10': ['pirate', 'sailor', 'cult'],
};
function chart(journey: FeedTheKrakenJourney): Record<string, FeedTheKrakenMapNode> {
  const quick = journey === 'quick';
  const actions: Record<string, FeedTheKrakenMapAction> = quick
    ? { '-1,3': 'cabin', '1,3': 'cabin', '-2,4': 'cabin', '-1,7': 'feeding', '1,7': 'feeding' }
    : { '-1,3': 'cabin', '1,3': 'cabin', '-2,4': 'cabin', '0,4': 'cabin', '0,6': 'tongue', '-1,7': 'flogging', '1,7': 'flogging', '-1,9': 'feeding', '1,9': 'feeding', '0,10': 'feeding' };
  return Object.fromEntries((quick ? quickRows : longRows).flatMap((xs, y) => xs.map((x) => {
    const id = `${x},${y}`;
    const [red, blue, yellow] = (quick ? quickExceptions : longExceptions)[id] ?? [`${x - 1},${y + 1}`, `${x + 1},${y + 1}`, `${x},${y + 2}`];
    return [id, { id, x, y, routes: { red, blue, yellow }, ...(actions[id] ? { action: actions[id] } : {}), beforeSupply: !quick && (y <= 5 || id === '0,6') }];
  })));
}
export const FEED_THE_KRAKEN_MAPS = { quick: chart('quick'), long: chart('long') };
export const FEED_THE_KRAKEN_DIGITAL_CLARIFICATIONS = [
  'Reaction powers use clockwise priority from the captain, not network arrival order.',
  'Gun transfers are limited by available guns. Mentor must target another player.',
  'Cult searches inspect original faction chips; normal cabin searches inspect current affiliation.',
  'A ritual with no eligible effect completes neutrally without revealing why.',
  'Forfeiting removes victory eligibility but never counts as a feeding sacrifice.',
];
