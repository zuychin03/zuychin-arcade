import { RulesReferenceSheet, type RuleSection } from '../ui/RulesReferenceSheet';
import { SKULL_KING } from '../../constants/theme';
import { SkullKingRulesGuide } from './RulesGuide';

const SECTIONS: RuleSection[] = [
  { title: 'This digital voyage', icon: 'map-outline', entries: [
    { title: 'Digital Base Voyage', body: 'This table uses the classic 70-card deck: 56 numbered cards, 5 Pirates, the Tigress, the Skull King, 2 Mermaids and 5 Escapes. Advanced current-edition cards and pirate powers are not included.' },
    { title: 'Three to eight players', body: 'This release supports 3–8 players. The current physical game also supports two players through the Graybeard neutral-hand variant, which is not included here.' },
    { title: 'Disconnecting and leaving', body: 'A temporary disconnection keeps your seat during reconnect grace. Leaving or letting that grace expire forfeits immediately: no further points and no victory. The seat plays legal cards automatically only through the current round, then is removed before the next deal.' },
    { title: 'Fewer than three captains', body: 'If fewer than three eligible captains remain, the voyage ends immediately without a winner or competitive result. The unfinished round is not scored. Previously completed scorecards remain available.' },
  ]},
  { title: 'Voyage and bidding', icon: 'ship-wheel', entries: [
    { title: 'Ten rounds', body: 'Round 1 deals one card to each captain, round 2 deals two, and so on. With eight players, the last two rounds deal eight cards each.' },
    { title: 'Secret prediction', body: 'Before every round, each captain secretly predicts how many tricks they will win. All bids are revealed together once everyone locks in.' },
    { title: 'Lead and follow', body: 'The captain left of the dealer leads the first trick. If a numbered suit leads, play that suit when you can. A special card may always be played.' },
  ]},
  { title: 'Who wins a trick', icon: 'sword-cross', entries: [
    { title: 'Numbered cards', body: 'Black is trump. Otherwise, the highest number in the led suit wins. Other colored suits cannot win that trick.' },
    { title: 'Escapes', body: 'An Escape normally loses. If every card is an Escape, the first Escape wins. After opening Escapes, the first non-Escape establishes play: a numbered card sets its suit, while a character leaves the trick without a lead suit.' },
    { title: 'Pirates and Tigress', body: 'Pirates beat numbered cards and mermaids; the first pirate wins ties. When playing the Tigress, choose whether she counts as a Pirate or Escape.' },
    { title: 'Skull King and Mermaids', body: 'The Skull King defeats pirates and numbered cards. A Mermaid defeats the Skull King and numbered cards, but loses to pirates. If all three appear, the first Mermaid wins.' },
  ]},
  { title: 'Scoring', icon: 'star-four-points-outline', entries: [
    { title: 'Positive bids', body: 'Hit a bid above zero for 20 points per trick. Miss it and lose 10 points for every trick above or below the bid.' },
    { title: 'Zero bids', body: 'A successful zero bid earns 10 points per card dealt. Winning any trick instead loses that same amount.' },
    { title: 'Capture bonuses', body: 'Only an exact bidder keeps bonuses: colored 14s are 10, black 14 is 20, Pirate over Mermaid is 20, Skull King over each Pirate is 30, and Mermaid over Skull King is 40.' },
    { title: 'Victory', body: 'The highest eligible total after round ten wins. If the lead is tied, the remaining eligible captains play another full round until the tie is broken.' },
  ]},
];

export function SkullKingReferenceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return <RulesReferenceSheet visible={visible} gameTitle="Skull King" subtitle="Digital Base Voyage · 3–8 players · 10 rounds" icon="pirate" palette={{ background: SKULL_KING.bg, surface: SKULL_KING.surface, panel: SKULL_KING.panel, border: SKULL_KING.border, accent: SKULL_KING.teal, secondary: SKULL_KING.gold, muted: SKULL_KING.muted, text: SKULL_KING.text }} sections={SECTIONS} onClose={onClose}><SkullKingRulesGuide /></RulesReferenceSheet>;
}
