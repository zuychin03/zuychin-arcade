import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RemainingJoin } from '../../components/remaining/RemainingJoin';
import { CARTOGRAPHERS as C } from '../../components/cartographers/palette';
export default function JoinCartographers() {
  return <RemainingJoin title="JOIN THE CARTOGRAPHERS" palette={C} mark={<MaterialCommunityIcons name="map-outline" size={64} color={C.accent} />} />;
}
