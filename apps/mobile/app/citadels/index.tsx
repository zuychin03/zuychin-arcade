import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { CitadelsMark } from '../../components/citadels/CitadelsArtwork';
import { GameCover } from '../../components/ui/GameCover';
import { CitadelsReferenceSheet } from '../../components/citadels/ReferenceSheet';
import { CITADELS_PALETTE } from '../../components/citadels/palette';

export default function CitadelsLanding() {
  return <RemainingLanding gameId="citadels" base="/citadels" title="CITADELS" presentation="illustrated"
    tagline="Draft a secret identity, read your rivals, wield a new power each round, and raise the kingdom's most prestigious city."
    tags={['SECRET ROLES', 'CITY BUILDING', '4–7 PLAYERS']} createLabel="ENTER THE COURT"
    mark={<CitadelsMark size={68} />}
    hero={<GameCover nativeID="citadels-entrance-art" source={require('../../assets/game-art/citadels-hero.webp')} fallback={<CitadelsMark size={100} />} />}
    renderRules={(visible, onClose) => <CitadelsReferenceSheet visible={visible} onClose={onClose} />}
    palette={CITADELS_PALETTE} />;
}
