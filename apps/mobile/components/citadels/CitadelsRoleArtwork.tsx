import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CitadelsRole } from '@zuychin-arcade/types';
import { CardIllustration } from '../ui/CardIllustration';
import { CITADELS } from '../../constants/theme';

const portraits = {
  assassin: require('../../assets/game-art/citadels-role-assassin.webp'),
  thief: require('../../assets/game-art/citadels-role-thief.webp'),
  magician: require('../../assets/game-art/citadels-role-magician.webp'),
  king: require('../../assets/game-art/citadels-role-king.webp'),
  bishop: require('../../assets/game-art/citadels-role-bishop.webp'),
  merchant: require('../../assets/game-art/citadels-role-merchant.webp'),
  architect: require('../../assets/game-art/citadels-role-architect.webp'),
  warlord: require('../../assets/game-art/citadels-role-warlord.webp'),
} satisfies Record<CitadelsRole, number>;

const icons = {
  assassin: 'knife-military', thief: 'hand-coin-outline', magician: 'magic-staff', king: 'crown',
  bishop: 'chess-bishop', merchant: 'storefront-outline', architect: 'compass-outline', warlord: 'shield-sword-outline',
} as const;

export function CitadelsRoleArtwork({ role, color }: { role: CitadelsRole; color: string }) {
  return <View testID={`citadels-role-insignia-${role}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: '100%' }}>
      <CardIllustration source={portraits[role]} aspectRatio={1} backgroundColor={CITADELS.bg} fallback={
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name={icons[role]} size={46} color={color} accessible={false} />
        </View>
      } />
  </View>;
}
