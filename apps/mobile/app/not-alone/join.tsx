import { RemainingJoin } from '../../components/remaining/RemainingJoin';
import { NotAloneMark } from '../../components/not-alone/NotAloneArtwork';
import { NOT_ALONE_PALETTE } from '../../components/not-alone/palette';

export default function NotAloneJoin() {
  return <RemainingJoin title="FIND THE SIGNAL" mark={<NotAloneMark size={68} />} palette={NOT_ALONE_PALETTE} />;
}
