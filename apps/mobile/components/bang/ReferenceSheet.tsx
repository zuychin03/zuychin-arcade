import { BANG_CHARACTERS } from '@zuychin-arcade/types';
import { RulesReferenceSheet, type RuleSection } from '../ui/RulesReferenceSheet';
import { BANG } from '../../constants/theme';
import { BANG_CARD_DETAILS, BANG_ROLE_GUIDE } from './Card';

const SECTIONS: RuleSection[] = [
  {
    title: 'Roles and victory', icon: 'badge-account-outline',
    entries: [
      ...Object.values(BANG_ROLE_GUIDE).map((role) => ({ title: role.name, body: role.goal })),
      { title: 'Who can see your role?', body: 'Only the Sheriff starts face up. Your own role stays private until you are eliminated or the game ends. Character abilities and cards in play are public.' },
    ],
  },
  {
    title: 'Your turn', icon: 'pistol',
    entries: [
      { title: 'Draw, play, discard', body: 'The Sheriff begins, then play moves clockwise. Draw two cards, make any legal plays you want, then discard down to your current life. Character abilities may change the draw.' },
      { title: 'Three limits', body: 'Normally play one BANG! per turn. Keep at most one card of each name in play and one weapon. A new weapon replaces the old one. Volcanic and Willy the Kid remove the BANG! limit.' },
      { title: 'Distance is not weapon range', body: 'Count the shorter route around living players. Mustang and Paul Regret increase distance to their owner; Scope and Rose Doolan reduce distance seen by their owner. Weapons only extend BANG! range. Panic! still needs distance 1.' },
      { title: 'Choosing cards', body: 'Hand cards stay face down to other players. Panic! and Cat Balou can target a random hand card or a specific face-up card in play. The interface offers only legal targets for the chosen card.' },
    ],
  },
  {
    title: 'Attacks and survival', icon: 'shield-outline',
    entries: [
      { title: 'Answer the current attack', body: 'BANG! and Gatling require Missed!; Indians! and Duel require BANG!. Calamity Janet may swap those card types. Slab the Killer’s BANG! requires two successful defences.' },
      { title: 'Barrel and Jourdonnais', body: 'You may try each available Barrel or Jourdonnais check before spending a Missed!. Hearts cancel one required defence. They do not answer Indians! or Duel.' },
      { title: 'Losing your last life', body: 'You may spend enough Beer cards to survive, or accept elimination. Beer has no healing effect with only two players alive. Sid Ketchum may discard pairs of cards to heal during his own play phase or while facing elimination.' },
      { title: 'Jail and Dynamite', body: 'Check Dynamite before Jail at the start of the turn. Spades 2–9 cause 3 damage; otherwise pass Dynamite clockwise. Hearts release you from Jail; otherwise discard Jail and skip your turn. The Sheriff cannot be jailed.' },
      { title: 'Rewards and penalties', body: 'Eliminating an Outlaw earns three cards. A Sheriff who eliminates a Deputy loses every hand card and card in play. Eliminated players reveal their role, but can still share their team’s eventual victory.' },
    ],
  },
  {
    title: 'Character abilities', icon: 'account-star-outline',
    entries: Object.values(BANG_CHARACTERS).map((character) => ({ title: character.name, body: character.summary })),
  },
  {
    title: 'Card effects', icon: 'cards-playing-outline',
    entries: Object.values(BANG_CARD_DETAILS).map((card) => ({ title: card.name, body: `${card.kind}. ${card.effect}` })),
  },
  {
    title: 'This digital table', icon: 'table-furniture',
    entries: [
      { title: 'Edition', body: 'Fourth-edition base game for 4–7 players, with 80 playing cards and 16 characters. Includes the publisher’s current General FAQ clarifications (2025–26 document, pages 12–14). No High Noon, tournament setup, auction or scoring rules.' },
      { title: 'Public checks and private choices', body: 'The server shuffles, deals and keeps hidden cards private. Lucky Duke chooses between two revealed check cards. Required choices must finish before play continues.' },
      { title: 'Leaving and rematches', body: 'Leaving a live game immediately eliminates your character without a kill reward. This can end the match, including when the Sheriff leaves. You forfeit any team win. A temporary disconnect gives you a grace period to reconnect; if it expires, you are eliminated. A rematch needs at least four connected players and deals fresh roles, characters and hands.' },
    ],
  },
];

export function BangReferenceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return <RulesReferenceSheet visible={visible} gameTitle="BANG!" subtitle="Fourth-edition base game · 4–7 players" icon="pistol"
    palette={{ background: BANG.bg, surface: BANG.surface, panel: BANG.panel, border: BANG.border, accent: BANG.gold, secondary: BANG.red, muted: BANG.muted, text: BANG.text }}
    sections={SECTIONS} onClose={onClose} />;
}
