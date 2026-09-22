import { RemainingJoin } from '../../components/remaining/RemainingJoin';
import { SkullKingMark } from '../../components/skull-king/SkullKingArtwork';
import { SKULL_KING_PALETTE } from '../../components/skull-king/palette';

export default function SkullKingJoin() {
  return <RemainingJoin title="JOIN THE CREW" mark={<SkullKingMark size={68} />} palette={SKULL_KING_PALETTE} />;
}
