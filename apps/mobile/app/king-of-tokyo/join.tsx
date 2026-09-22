import { RemainingJoin } from '../../components/remaining/RemainingJoin';
import { TokyoMark } from '../../components/king-of-tokyo/TokyoArtwork';
import { TOKYO_PALETTE } from '../../components/king-of-tokyo/palette';

export default function KingOfTokyoJoin() {
  return <RemainingJoin title="ENTER TOKYO" mark={<TokyoMark size={68} />} palette={TOKYO_PALETTE} />;
}
