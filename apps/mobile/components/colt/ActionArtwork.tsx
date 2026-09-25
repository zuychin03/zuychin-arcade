import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ColtAction } from '@zuychin-arcade/types';
import { COLT as C } from '../../constants/theme';
import { CardIllustration } from '../ui/CardIllustration';

export const coltActionIcons: Record<ColtAction | 'bullet', keyof typeof MaterialCommunityIcons.glyphMap> = { move: 'arrow-left-right', floor: 'stairs', shoot: 'pistol', punch: 'boxing-glove', rob: 'cash-multiple', marshal: 'police-badge-outline', bullet: 'close-circle-outline' };
const artwork = {
  move: require('../../assets/game-art/colt-action-move.webp'),
  floor: require('../../assets/game-art/colt-action-floor.webp'),
  rob: require('../../assets/game-art/colt-action-rob.webp'),
  shoot: require('../../assets/game-art/colt-action-shoot.webp'),
  punch: require('../../assets/game-art/colt-action-punch.webp'),
  marshal: require('../../assets/game-art/colt-action-marshal.webp'),
  bullet: require('../../assets/game-art/colt-action-bullet.webp'),
};

export function ActionArtwork({ action, size }: { action: ColtAction | 'bullet'; size?: number }) {
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: size ?? '100%', maxWidth: '100%', flexShrink: 0 }}>
    <CardIllustration source={artwork[action]} backgroundColor={C.panel} fallback={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name={coltActionIcons[action]} size={42} color={action === 'bullet' ? C.red : C.cyan} /></View>} />
  </View>;
}
