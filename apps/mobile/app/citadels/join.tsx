import { RemainingJoin } from '../../components/remaining/RemainingJoin';
import { CitadelsMark } from '../../components/citadels/CitadelsArtwork';
import { CITADELS_PALETTE } from '../../components/citadels/palette';

export default function CitadelsJoin() {
  return <RemainingJoin title="JOIN THE COURT" mark={<CitadelsMark size={68} />} palette={CITADELS_PALETTE} />;
}
