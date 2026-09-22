import { RulesReferenceSheet, type RuleSection } from '../ui/RulesReferenceSheet';
import { TOKYO } from '../../constants/theme';

const SECTIONS: RuleSection[] = [
  {
    title: 'Objective and setup',
    icon: 'trophy-outline',
    entries: [
      {
        title: 'How to win',
        body: 'Reach 20 victory points and survive the turn, or become the only living monster. If every monster is eliminated at once, nobody wins.',
      },
      {
        title: 'First player',
        body: 'Every monster rolls six dice. The monster with the most Smash symbols starts; tied monsters roll again until one wins.',
      },
      {
        title: 'Starting resources',
        body: 'Each monster begins outside Tokyo with 10 health, 0 victory points and 0 energy.',
      },
      {
        title: 'Monster profiles',
        body: 'The digital table automatically assigns each seat a distinct monster profile. Profiles are cosmetic and have no special power.',
        tag: 'Adaptation',
      },
      {
        title: 'Elimination',
        body: 'At 0 health, discard your Keep cards and return all energy to the supply. Eliminated monsters no longer take turns.',
      },
    ],
  },
  {
    title: 'Roll and resolve',
    icon: 'dice-multiple',
    entries: [
      {
        title: 'Three rolls',
        body: 'Roll six dice up to three times. Before each reroll, keep or release any dice, including dice kept earlier. You may stop and resolve early.',
      },
      {
        title: 'Number sets',
        body: 'Three matching 1s, 2s or 3s score that number of points. Each additional matching die adds 1 more point.',
      },
      {
        title: 'Choose the order',
        body: 'All final results resolve, but the active monster chooses the order of points, Energy, Hearts and Smash. Each category uses the table state when it is reached, so that order can change card timing, Healing Ray targets and survival.',
      },
      {
        title: 'Energy and Hearts',
        body: 'Each Energy gains 1 energy cube. Each Heart may heal 1 health while outside Tokyo. Rolled Hearts cannot heal a monster in Tokyo.',
      },
      {
        title: 'Smash',
        body: 'Outside Tokyo, your Smash damages every monster in Tokyo. From Tokyo, it damages every monster outside Tokyo.',
      },
    ],
  },
  {
    title: 'Controlling Tokyo',
    icon: 'city-variant-outline',
    entries: [
      {
        title: 'Enter and score',
        body: 'After resolving, you must enter an open Tokyo space and gain 1 victory point, whether or not you rolled Smash. Starting your turn in Tokyo gains 2 victory points.',
      },
      {
        title: 'Yield after Smash',
        body: 'Normally, a Tokyo occupant may yield only after losing health to another monster’s rolled Smash. Jets is the exception: choose before its damage, and yielding prevents that deferred damage. The attacker fills the open space during Enter Tokyo.',
      },
      {
        title: 'Tokyo Bay',
        body: 'With 5 or 6 living monsters, City fills first and then Bay must fill if open. At 4 survivors, Bay closes: its occupant moves to an empty City, otherwise it leaves Tokyo.',
      },
    ],
  },
  {
    title: 'Power cards',
    icon: 'cards-outline',
    entries: [
      {
        title: 'The market',
        body: 'Three cards stay face-up. Buy any number you can afford; each slot refills immediately and its new card may also be bought. Spend 2 energy to replace all three, and repeat while you can pay.',
      },
      {
        title: 'Keep and Discard',
        body: 'Keep cards provide ongoing or activated powers. Discard cards resolve once and then go to the discard pile.',
      },
      {
        title: 'Reactions and tokens',
        body: 'Some powers create decisions outside your normal turn. Poison causes end-turn damage and Shrink removes dice. Rolled Hearts can remove those tokens only while outside Tokyo.',
      },
      {
        title: 'End-turn order',
        body: 'When several end-turn effects apply, choose their order. Resolving Metamorph opens a sales window; choosing Done continues the effects that remain.',
      },
      {
        title: 'Card text wins',
        body: 'Powers may change dice, damage, healing, costs, Tokyo movement or timing. The card reference shown in the market describes each implemented effect.',
      },
      {
        title: 'Regeneration',
        body: 'Regeneration adds 1 health per healing event, including card healing. Each Rapid Healing activation is a separate event. Healing Ray groups assigned Hearts per recipient; that recipient’s Regeneration adds free healing without increasing their energy payment.',
      },
    ],
  },
  {
    title: 'Digital table',
    icon: 'monitor-cellphone',
    entries: [
      {
        title: 'First match and rematch',
        body: 'The first match uses the official six-dice Smash roll-off. A digital rematch starts with the previous winner if that player is still seated; otherwise everyone rolls Smash again.',
        tag: 'Adaptation',
      },
      {
        title: 'Connection recovery',
        body: 'A brief disconnect preserves your seat for reconnection. Explicitly leaving or expired reconnect grace immediately forfeits a living monster, which cannot win. No monster is auto-played. If all remaining monsters forfeit together, the match ends without a winner or competitive result. Leaving after natural elimination or match completion does not change that result.',
        tag: 'Digital',
      },
      {
        title: 'Reaction order',
        body: 'Multiple Psychic Probe and Tokyo Yield decisions resolve clockwise from the active monster. A Smash batch finishes before a Burrowing-eliminated attacker advances.',
        tag: 'Adaptation',
      },
      {
        title: 'Defence decisions',
        body: 'Connected players decide Camouflage changes, Wings and the exact Rapid Healing amount when damage arrives. Defence preferences remain private and never auto-play a connected choice; reconnect-grace expiry forfeits the monster instead.',
        tag: 'Digital',
      },
      {
        title: 'Base deck',
        body: 'Current English publisher base rules (November 2023), with 66 power cards. The optional two-player Tokyo rewards are not enabled: entry earns 1 victory point and starting your turn there earns 2. Card descriptions are concise interface copy.',
      },
    ],
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function KingOfTokyoReferenceSheet({ visible, onClose }: Props) {
  return (
    <RulesReferenceSheet
      visible={visible}
      gameTitle="King of Tokyo"
      subtitle="Current publisher base rules · 66-card power deck"
      icon="city-variant"
      palette={{
        background: TOKYO.bg,
        surface: TOKYO.surface,
        panel: TOKYO.panel,
        border: TOKYO.border,
        accent: TOKYO.lime,
        secondary: TOKYO.cyan,
        muted: TOKYO.muted,
        text: TOKYO.text,
      }}
      sections={SECTIONS}
      onClose={onClose}
    />
  );
}
