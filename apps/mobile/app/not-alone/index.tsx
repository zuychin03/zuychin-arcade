import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { NotAloneMark } from '../../components/not-alone/NotAloneArtwork';
import { GameCover } from '../../components/ui/GameCover';
import { NotAloneReferenceSheet } from '../../components/not-alone/ReferenceSheet';
import { NOT_ALONE_PALETTE } from '../../components/not-alone/palette';

export default function NotAloneLanding() {
  return <RemainingLanding gameId="not_alone" base="/not-alone" title="NOT ALONE" presentation="illustrated"
    tagline="Hide among Artemia's alien places, misdirect the Creature, and keep the rescue signal alive. Create as the Creature; join as one of the Hunted."
    tags={['HIDDEN LOCATIONS', 'ONE VS MANY', '2–7 PLAYERS']} createLabel="OPEN A SIGNAL"
    mark={<NotAloneMark size={68} />}
    hero={<GameCover nativeID="not-alone-entrance-art" source={require('../../assets/game-art/not-alone-hero.webp')} fallback={<NotAloneMark size={100} />} />}
    renderRules={(visible, onClose) => <NotAloneReferenceSheet visible={visible} onClose={onClose} />}
    palette={NOT_ALONE_PALETTE} />;
}
