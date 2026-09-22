import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { SkullKingMark } from '../../components/skull-king/SkullKingArtwork';
import { GameCover } from '../../components/ui/GameCover';
import { SkullKingReferenceSheet } from '../../components/skull-king/ReferenceSheet';
import { SKULL_KING_PALETTE } from '../../components/skull-king/palette';

export default function SkullKingLanding() {
  return <RemainingLanding gameId="skull_king" base="/skull-king" title="SKULL KING" presentation="illustrated"
    tagline="Predict your haul, command pirates and mermaids, and win exactly the tricks you promised across ten escalating rounds."
    tags={['TRICK TAKING', 'SECRET BIDS', '3–8 PLAYERS']} createLabel="CREATE ROOM"
    mark={<SkullKingMark size={68} />}
    hero={<GameCover nativeID="skull-entrance-art" source={require('../../assets/game-art/skull-hero.webp')} fallback={<SkullKingMark size={100} />} />}
    renderRules={(visible, onClose) => <SkullKingReferenceSheet visible={visible} onClose={onClose} />}
    palette={SKULL_KING_PALETTE} />;
}
