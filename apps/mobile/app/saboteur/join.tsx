import { RemainingJoin } from '../../components/remaining/RemainingJoin';
import { SaboteurMark } from '../../components/saboteur/SaboteurArtwork';
import { SABOTEUR_PALETTE } from '../../components/saboteur/palette';

export default function JoinScreen() {
  return <RemainingJoin title="JOIN THE MINE" mark={<SaboteurMark size={68} />} palette={SABOTEUR_PALETTE} />;
}
