import { RemainingLanding } from '../../components/remaining/RemainingLanding';
import { BangMark } from '../../components/remaining/RemainingArtwork';
import { BangReferenceSheet } from '../../components/bang/ReferenceSheet';
import { GameCover } from '../../components/ui/GameCover';
import { BANG } from '../../constants/theme';

export default function BangLanding() {
  return <RemainingLanding gameId="bang" base="/bang" title="BANG!" presentation="illustrated"
    tagline="Read the table, protect your role, and survive a living-distance shootout where every card can expose an alliance."
    tags={['HIDDEN ROLES', 'RANGE & REACTIONS', '4–7 PLAYERS']} createLabel="OPEN A SALOON"
    mark={<BangMark size={68} />}
    hero={<GameCover nativeID="bang-entrance-art" source={require('../../assets/game-art/bang-hero.webp')} fallback={<BangMark size={100} />} />}
    renderRules={(visible, onClose) => <BangReferenceSheet visible={visible} onClose={onClose} />}
    palette={{ ...BANG, accent: BANG.gold, secondary: BANG.red }} />;
}
