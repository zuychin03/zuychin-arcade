import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { CoupMark } from '../../components/coup/CoupArtwork';
import { GameCover } from '../../components/ui/GameCover';
import { ReferenceSheet } from '../../components/coup/ReferenceSheet';
import { COUP_PALETTE } from '../../components/coup/palette';

export default function CoupLanding() {
  return <RemainingLanding gameId="coup" base="/coup" title="COUP" presentation="illustrated"
    tagline="Claim any character, bluff without blinking and challenge the court before your last influence is exposed."
    tags={['BLUFF', 'CHALLENGE', '2–6 PLAYERS']} createLabel="ENTER THE COURT"
    mark={<CoupMark size={68} />}
    hero={<GameCover nativeID="coup-entrance-art" source={require('../../assets/game-art/coup-hero.webp')} fallback={<CoupMark size={100} />} />}
    renderRules={(visible, onClose) => <ReferenceSheet visible={visible} variant="base" onClose={onClose} />}
    palette={COUP_PALETTE} />;
}
