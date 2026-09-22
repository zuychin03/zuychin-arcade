import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { LibertaliaMark } from '../../components/remaining/RemainingArtwork';
import { LibertaliaReferenceSheet } from '../../components/libertalia/ReferenceSheet';
import { GameCover } from '../../components/ui/GameCover';
import { LIBERTALIA } from '../../constants/theme';

export default function Page() {
  return <RemainingLanding gameId="libertalia" base="/libertalia" title="LIBERTALIA" presentation="illustrated"
    tagline="Outthink rival admirals with the same crew and claim the richest loot over three voyages. Winds of Galecrest with calm-side loot, for 2–6 players."
    tags={['SECRET CREW', 'CALM-SIDE LOOT', '2–6 PLAYERS']} createLabel="ASSEMBLE A FLEET"
    mark={<LibertaliaMark size={68} />}
    hero={<GameCover nativeID="libertalia-entrance-art" source={require('../../assets/game-art/libertalia-hero.webp')} fallback={<LibertaliaMark size={100} />} />}
    renderRules={(visible, onClose) => <LibertaliaReferenceSheet visible={visible} onClose={onClose} />}
    palette={{ ...LIBERTALIA, accent: LIBERTALIA.sky, secondary: LIBERTALIA.gold }} />;
}
