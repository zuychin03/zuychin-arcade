import { RulesReferenceSheet, type RuleSection } from '../ui/RulesReferenceSheet';
import { CITADELS } from '../../constants/theme';
import { CitadelsRulesGuide } from './RulesGuide';

const SECTIONS: RuleSection[] = [
  {
    title: 'This digital table',
    icon: 'information-outline',
    entries: [
      {
        title: 'Digital Original Cast',
        tag: '4–7 players',
        body: 'This table follows the current revised core with the original rank 1–8 character cast, 54 basic district cards and the 14 enabled unique-district cards. Cities complete at seven districts.',
      },
      {
        title: 'Deliberate scope',
        body: 'The 2–3 player dual-character mode, 8-player games that require a rank-9 character, alternate character casts and unlisted unique districts are not included in this digital subset.',
      },
      {
        title: 'Curated custom set',
        body: 'Our custom selection uses 14 official unique districts: Haunted Quarter, Keep, Imperial Treasury, Map Room, Laboratory, Observatory, Smithy, Library, School of Magic, Dragon Gate, Great Wall, Wishing Well, Factory and Gold Mine. It is not a publisher-defined scenario.',
      },
      {
        title: 'Seat recovery and forfeits',
        body: 'A disconnected seat is reserved briefly so the same session can reconnect. Leaving or letting that grace expire forfeits immediately. Legal autopilot finishes only the current round, then the seat is removed before the next draft. Forfeited builders cannot win. If fewer than four eligible builders remain, the court ends immediately with no winner, final scoring or competitive result.',
      },
    ],
  },
  {
    title: 'Round structure',
    icon: 'crown-outline',
    entries: [
      {
        title: 'Secret character draft',
        body: 'This digital table assigns the first crown at random rather than by age. Later crowns follow the King rules. The crowned player drafts first, then choices pass around the table. Some roles are removed face up and at least one remains hidden, so a missing role is never certain to be held.',
      },
      {
        title: 'Characters are called by rank',
        body: 'Ranks 1 through 8 act in order, not seating order. Reveal only when your character is called. A murdered character stays silent and loses the whole turn.',
      },
      {
        title: 'Gather resources',
        body: 'During every character turn, you must take two gold or draw district cards and keep one before building. Observatory and Library change how card income is drawn or kept.',
      },
      {
        title: 'Build and use abilities',
        body: 'You must gather resources before building. An ability without a specified time may be used at any point during your turn, including before gathering. Normally, you may build one district before ending the turn.',
      },
      {
        title: 'Digital tablekeeping',
        body: 'The table automatically resolves the mandatory King crown and the Merchant’s strictly beneficial extra gold. Other optional character abilities remain your choice.',
      },
    ],
  },
  {
    title: 'The eight characters',
    icon: 'account-group-outline',
    entries: [
      {
        title: '1 Assassin · 2 Thief',
        body: 'The Assassin names a role that loses its turn. The Thief names a legal role and takes all its gold when that role is called. Neither power targets a named player directly.',
      },
      {
        title: '3 Magician',
        body: 'Once per turn, swap your entire district hand with another player, or discard any number of your cards and draw the same number.',
      },
      {
        title: '4 King · 5 Bishop · 6 Merchant',
        body: 'The King receives the crown and taxes noble districts. The Bishop taxes religious districts and is protected from the Warlord. The Merchant gains an extra gold and taxes trade districts.',
      },
      {
        title: '7 Architect · 8 Warlord',
        body: 'The Architect draws two extra districts and may build up to three. The Warlord taxes military districts and can pay one less than a district’s cost to destroy a legal target.',
      },
    ],
  },
  {
    title: 'Cities and victory',
    icon: 'castle',
    entries: [
      {
        title: 'Building restrictions',
        body: 'You cannot build two districts with the same name. A completed seven-district city cannot be attacked by the Warlord. The final round still calls every remaining character.',
      },
      {
        title: 'Revised scoring',
        body: 'Score every district’s printed cost, 3 points for having all five district types, 4 points for completing first, or 2 points for another completed city. Enabled unique districts can add more.',
      },
      {
        title: 'Tiebreak',
        body: 'After final scoring, a tie goes to the tied builder whose character had the highest rank actually revealed in the final round. A murdered non-King stays unrevealed; a murdered King reveals at round end.',
      },
      {
        title: 'Haunted Quarter and Wishing Well',
        body: 'Haunted Quarter may substitute for one missing district type, but stops counting as a unique district when it does. Wishing Well scores one point for every unique district in its city, including itself, except a Haunted Quarter assigned another type.',
      },
    ],
  },
];

export function CitadelsReferenceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <RulesReferenceSheet
      visible={visible}
      gameTitle="Citadels"
      subtitle="Digital Original Cast · 4–7 builders · seven-district cities"
      icon="castle"
      palette={{ background: CITADELS.bg, surface: CITADELS.surface, panel: CITADELS.panel, border: CITADELS.border, accent: CITADELS.royal, secondary: CITADELS.gold, muted: CITADELS.muted, text: CITADELS.text }}
      sections={SECTIONS}
      onClose={onClose}
    ><CitadelsRulesGuide /></RulesReferenceSheet>
  );
}
