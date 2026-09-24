import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RemainingJoin } from '../../components/remaining/RemainingJoin';
import { TELESTRATIONS as C } from '../../components/telestrations/palette';
export default function JoinTelestrations() { return <RemainingJoin title="JOIN A SKETCHBOOK" palette={C} mark={<MaterialCommunityIcons name="draw" size={64} color={C.accent} />} />; }
