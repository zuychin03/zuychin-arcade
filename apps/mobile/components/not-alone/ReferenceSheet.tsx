import { NOT_ALONE_MODE_DESCRIPTION } from '@zuychin-arcade/types';
import { RulesReferenceSheet, type RuleSection } from '../ui/RulesReferenceSheet';
import { NOT_ALONE } from '../../constants/theme';
import { NotAloneRulesGuide } from './RulesGuide';

const SECTIONS: RuleSection[] = [
  {
    title: 'Mode and table setup',
    icon: 'map-legend',
    entries: [
      { title: 'Exact content', body: NOT_ALONE_MODE_DESCRIPTION },
      { title: 'Digital setup', body: 'The room host is the Creature and chooses either printed board face. The other players are the Hunted. The app securely shuffles, deals, tracks hidden choices and resolves simultaneous effects in a deterministic order.' },
      { title: 'Shared table talk', body: 'Any Hunted communication must be public to the Creature, and cards may not be shown. This app has no room voice or chat. Remote groups should use one shared voice channel and avoid private messages.' },
    ],
  },
  {
    title: 'Digital departures',
    icon: 'account-arrow-right-outline',
    entries: [
      { title: 'Reconnect or forfeit', body: 'A temporary disconnect reserves your seat during reconnect grace. You forfeit immediately if you leave or your reconnect grace expires.' },
      { title: 'Hunted departure', body: 'A forfeited Hunted cannot win. Legal automatic play finishes the current round only, then the seat is removed before the next round. Its Place cards remain historical, not available for play. The original Rescue and Assimilation targets stay unchanged.' },
      { title: 'Terminal departures', body: 'If the Creature forfeits, the remaining eligible Hunted win. If the last eligible Hunted forfeits, the Creature wins. If neither side remains eligible, there is no winner. A completed result does not change when someone leaves.' },
    ],
  },
  {
    title: 'The two sides',
    icon: 'alien-outline',
    entries: [
      { title: 'Creature versus Hunted', body: 'The Creature advances Assimilation. All Hunted form one team and advance Rescue. A side wins immediately when its marker reaches the goal.' },
      { title: 'Hidden destinations', body: 'Each Hunted secretly chooses a Place from their hand. Readiness is public, but the destination stays hidden from the Creature and every other Hunted until reveal.' },
      { title: 'Visible discard trails', body: 'Explored Place cards normally enter a face-up personal discard pile. The Creature can study these public trails to narrow the remaining destinations.' },
    ],
  },
  {
    title: 'Each round',
    icon: 'radar',
    entries: [
      { title: '1. Exploration', body: 'The Hunted may Resist, Give Up or play a legal phase-one Survival card, then lock the required Place card or cards from hand.' },
      { title: '2. Hunting', body: 'The Creature may play legal Hunt cards, places every required Creature, Target and Artemia token, then locks the complete Hunt plan. The Hunted may then play legal phase-two reactions such as Vortex before destinations are revealed; locked Hunt tokens cannot move.' },
      { title: 'River timing', body: 'A Hunted using the River prepares two possible Places during Exploration. After every Hunt token is placed but before destinations are revealed, that player secretly chooses the real destination.' },
      { title: '3. Reckoning', body: 'Reveal destinations. Legal phase-three cards may be played throughout this phase, including later reaction windows before an affected remaining group. Resolve every safe Place effect first, then every Target, Artemia and Creature effect. Within each group, start with the Hunted to the Creature’s left and continue clockwise.' },
      { title: '4. End of round', body: 'Finish legal phase-four effects, discard played cards, refill the Creature hand to three, clear temporary effects and advance Rescue unless an effect prevents it.' },
    ],
  },
  {
    title: 'Will and hunt tokens',
    icon: 'heart-pulse',
    entries: [
      { title: 'Creature token', body: 'A caught Hunted loses one Will and cannot use or recover from that Place. Assimilation advances once if one or more Hunted are caught during the round.' },
      { title: 'Artemia token', body: 'A Hunted at Artemia privately discards one other Place card from hand and cannot resolve the explored Place. Artemia appears on marked Rescue spaces or through certain Hunt cards.' },
      { title: 'Target token', body: 'The active Hunt card defines the Target effect. It can copy the Creature token, disable Places or force another consequence.' },
      { title: 'Force Field', body: 'Force Field must be played before any Hunted locks a Place. Its two adjacent Places are inaccessible for the turn, including Detour and Vortex movement. That is different from making a Place power ineffective. The blocked footprint stays fixed even if a later Clone Target moves.' },
      { title: 'Clone and Dodge', body: 'Clone makes the Target count as a second Creature token. If both tokens catch the same Hunted, one Dodge protects that Hunted from the complete stack.' },
      { title: 'Despair', body: 'Despair prevents every Survival card play and draw for the round. If destinations were already locked, those cards return and all Hunted reselect; any Survival card already played stays spent. Shelter still recovers one discarded Place, while Source gives one Will when a legal wounded teammate exists; otherwise the normal recover option applies.' },
      { title: 'Persecution', body: 'Persecution limits each Place power to returning at most one Place card total. At the Jungle or Swamp, choose either the physical Place card you played or one card from your discard pile, not both.' },
      { title: 'Moved destinations', body: 'Detour changes where one played Place card is resolved, but it does not grant the destination card. The app keeps the original physical card and current destination separate for later returns and discards.' },
      { title: 'Losing the last Will', body: 'When a Hunted reaches zero Will during Reckoning, Assimilation advances once more. That player restores three Will and recovers every Place card.' },
    ],
  },
  {
    title: 'Recovery and Place powers',
    icon: 'cards-outline',
    entries: [
      { title: 'Resist', body: 'Before locking a destination, spend one Will to recover two discarded Places or two Will to recover four. You choose the exact cards. Spending the last Will forces a Give Up instead.' },
      { title: 'Give Up', body: 'Restore all three Will and recover every discarded Place, but immediately advance Assimilation one space. The app asks for confirmation because this helps the Creature.' },
      { title: 'Safe destination', body: 'When your Place is not blocked by a Hunt token or effect, choose its printed power or recover one discarded Place. Some Place powers present an additional exact choice.' },
      { title: 'River and Artefact', body: 'The River prepares a two-card decoy for the next round. The Artefact lets you choose and resolve two physical Place cards next round. They remain separate slots even if Detour moves both to the same destination, and the app keeps them private until reveal.' },
    ],
  },
];

export function NotAloneReferenceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <RulesReferenceSheet
      visible={visible}
      gameTitle="Not Alone"
      subtitle="Original 2016 base game · 2–7 players"
      icon="alien-outline"
      palette={{ background: NOT_ALONE.bg, surface: NOT_ALONE.surface, panel: NOT_ALONE.panel, border: NOT_ALONE.border, accent: NOT_ALONE.signal, secondary: NOT_ALONE.amber, muted: NOT_ALONE.muted, text: NOT_ALONE.text }}
      sections={SECTIONS}
      onClose={onClose}
    ><NotAloneRulesGuide /></RulesReferenceSheet>
  );
}
