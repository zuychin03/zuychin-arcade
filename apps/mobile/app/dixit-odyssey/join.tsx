import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RemainingJoin } from '../../components/remaining/RemainingJoin';
import { DIXIT } from '../../constants/theme';

export default function JoinDixit() {
  return <RemainingJoin title="JOIN A STORY" palette={DIXIT}
    mark={<MaterialCommunityIcons name="cards-outline" size={64} color={DIXIT.accent} />} />;
}
