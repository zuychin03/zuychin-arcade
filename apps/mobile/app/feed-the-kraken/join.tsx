import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RemainingJoin } from '../../components/remaining/RemainingJoin';
import { KRAKEN as C } from '../../components/kraken/palette';
export default function JoinKraken() { return <RemainingJoin title="JOIN THE CREW" palette={C} mark={<MaterialCommunityIcons name="ferry" size={64} color={C.accent} />} />; }
