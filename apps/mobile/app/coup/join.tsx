import { RemainingJoin } from '../../components/remaining/RemainingJoin';
import { CoupMark } from '../../components/coup/CoupArtwork';
import { COUP_PALETTE } from '../../components/coup/palette';

export default function CoupJoinScreen() {
  return <RemainingJoin title="JOIN THE COURT" mark={<CoupMark size={68} />} palette={COUP_PALETTE} />;
}
