import { useState } from 'react';
import { Image, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ColtAction } from '@zuychin-arcade/types';
import { COLT as C } from '../../constants/theme';

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

export function ActionArtwork({ action, size = 112 }: { action: ColtAction | 'bullet'; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: size, height: size, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 8, overflow: 'hidden', backgroundColor: C.surface }}>
    {failed === action ? <MaterialCommunityIcons name={coltActionIcons[action]} size={42} color={action === 'bullet' ? C.red : C.cyan} /> : <Image source={artwork[action]} resizeMode="contain" onError={() => setFailed(action)} style={{ width: '100%', height: '100%' }} />}
  </View>;
}
