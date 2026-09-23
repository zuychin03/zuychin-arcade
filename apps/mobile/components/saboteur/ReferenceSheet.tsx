import { RulesReferenceSheet, type RuleSection } from '../ui/RulesReferenceSheet';
import { ARCADE, MINE } from '../../constants/theme';
import { SaboteurRulesGuide } from './RulesGuide';

const SECTIONS: RuleSection[] = [
  {
    title: 'Objective and roles',
    icon: 'target',
    entries: [
      {
        title: 'Miners',
        body: 'Build one continuous tunnel from the start card to the hidden gold. Miners win the round as soon as the gold goal is connected.',
        tag: 'secret role',
      },
      {
        title: 'Saboteurs',
        body: 'Secretly delay the dig with dead ends, damaged tools and well-timed disruption. Saboteurs win if the deck and every hand run out before gold is reached.',
        tag: 'secret role',
      },
      {
        title: 'Winning the game',
        body: 'A game lasts three rounds with new secret roles each round. The player or tied players with the most collected gold after round three win.',
      },
    ],
  },
  {
    title: 'Digital table rules',
    icon: 'cellphone-link',
    entries: [
      {
        title: 'Capped 5 × 9 mine',
        body: 'This mobile-first edition deliberately limits play to five columns and nine rows so the whole route stays observable. Paths cannot be placed beyond the marked play area.',
        tag: 'digital adaptation',
      },
      {
        title: 'Printed goal paths',
        body: 'Gold has four openings. The two stone cards have mirrored corner paths, not four-way junctions. Revealing a goal turns it to connect with the incoming tunnel; future paths must match its visible openings. A revealed goal alone may have an unavoidable mismatched neighbour.',
      },
      {
        title: 'Guaranteed saboteur',
        body: 'Shuffle the official player-count-plus-one role pool, deal one role to each player and set one extra role aside unseen. The digital safeguard reshuffles only if a deal would contain no saboteur.',
        tag: 'digital adaptation',
      },
      {
        title: 'Leaving and reconnection',
        body: 'Temporary disconnection reserves your seat during the reconnect grace period. Leaving explicitly or letting that grace expire forfeits the seat immediately: no more turns, gold or eligibility to win. With fewer than three active players, the match ends without a winner or a recorded result, even during the final gold choice.',
        tag: 'digital adaptation',
      },
      {
        title: 'Who starts',
        body: 'The room host starts round one. Later rounds start with the player to the left of whoever played or discarded the final card in the previous round.',
        tag: 'digital adaptation',
      },
    ],
  },
  {
    title: 'Your turn',
    icon: 'cards-playing-outline',
    entries: [
      {
        title: 'Play a path card',
        body: 'Place it beside an existing tunnel. Every touching edge must match, and the new path must remain connected to the start through open tunnels. Path cards may rotate 180 degrees.',
      },
      {
        title: 'Play an action card',
        body: 'Damage or repair a tool, privately inspect a goal with Map, or remove a placed tunnel card with Rockfall.',
      },
      {
        title: 'Pass',
        body: 'Select one card to discard when you cannot or do not want to play it. After playing or passing, draw one card if the deck still contains cards.',
      },
    ],
  },
  {
    title: 'Tools and actions',
    icon: 'toolbox-outline',
    entries: [
      {
        title: 'Broken tools',
        body: 'A player with any broken lantern, cart or pickaxe cannot place path cards. They may still play action cards or discard.',
      },
      {
        title: 'Repairs',
        body: 'A repair must match a broken tool. Dual-tool repair cards fix one of their pictured tools, chosen when played.',
      },
      {
        title: 'Map and Rockfall',
        body: 'Map privately shows any hidden goal and its path openings, including a goal you already mapped. The private strip stays until that goal is revealed; then use its public board paths, which may rotate on reveal. Rockfall removes a normal tunnel card, never the start or goal cards.',
      },
    ],
  },
  {
    title: 'Round rewards',
    icon: 'gold',
    entries: [
      {
        title: 'When miners win',
        body: 'Draw one gold card per active miner. The current picker privately sees every remaining value and chooses one. The route-completing miner picks first; if a saboteur completed it, start with the next miner to their right. Continue counter-clockwise.',
      },
      {
        title: 'When saboteurs win',
        body: 'One saboteur earns 4 gold; two or three earn 3 each; four earn 2 each. The original round role count sets the reward, but forfeited seats receive no further gold. Totals stay private until the final scores.',
      },
    ],
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function SaboteurReferenceSheet({ visible, onClose }: Props) {
  return (
    <RulesReferenceSheet
      visible={visible}
      gameTitle="Saboteur"
      subtitle="Secret roles · tunnel building · three rounds"
      icon="pickaxe"
      palette={{
        background: ARCADE.bg,
        surface: MINE.surface,
        panel: '#30233E',
        border: ARCADE.border,
        accent: MINE.gold,
        secondary: ARCADE.cyan,
        muted: ARCADE.muted,
        text: ARCADE.text,
      }}
      sections={SECTIONS}
      onClose={onClose}
    ><SaboteurRulesGuide /></RulesReferenceSheet>
  );
}
