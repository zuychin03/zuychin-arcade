import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CitadelsDistrictColor } from '@zuychin-arcade/types';
import { GameCover } from '../ui/GameCover';

const artwork = {
  noble: require('../../assets/game-art/citadels-district-noble.webp'),
  religious: require('../../assets/game-art/citadels-district-religious.webp'),
  trade: require('../../assets/game-art/citadels-district-trade.webp'),
  military: require('../../assets/game-art/citadels-district-military.webp'),
  unique: require('../../assets/game-art/citadels-district-unique.webp'),
};

export const citadelsDistrictIcons = {
  noble: 'crown-outline', religious: 'church-outline', trade: 'storefront-outline',
  military: 'shield-sword-outline', unique: 'star-four-points-outline',
} as const;

export function CitadelsDistrictArtwork({ category, color, compact }: { category: CitadelsDistrictColor; color: string; compact: boolean }) {
  return <GameCover source={artwork[category]} aspectRatio={compact ? 1.1 : 1} fallback={
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name={citadelsDistrictIcons[category]} size={48} color={color} accessible={false} />
    </View>
  } />;
}
