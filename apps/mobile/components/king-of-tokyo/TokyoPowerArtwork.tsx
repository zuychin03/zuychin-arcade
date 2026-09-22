import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { KingOfTokyoCardCategory } from '@zuychin-arcade/types';
import { GameCover } from '../ui/GameCover';

const artwork = {
  attack: require('../../assets/game-art/tokyo-power-attack.webp'),
  defense: require('../../assets/game-art/tokyo-power-defense.webp'),
  dice: require('../../assets/game-art/tokyo-power-dice.webp'),
  energy: require('../../assets/game-art/tokyo-power-energy.webp'),
  healing: require('../../assets/game-art/tokyo-power-healing.webp'),
  market: require('../../assets/game-art/tokyo-power-market.webp'),
  victory: require('../../assets/game-art/tokyo-power-victory.webp'),
  wild: require('../../assets/game-art/tokyo-power-wild.webp'),
};

export function TokyoPowerArtwork({ category, icon, color }: {
  category: KingOfTokyoCardCategory;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
}) {
  return <GameCover source={artwork[category]} aspectRatio={1} fallback={
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name={icon} size={52} color={color} />
    </View>
  } />;
}
