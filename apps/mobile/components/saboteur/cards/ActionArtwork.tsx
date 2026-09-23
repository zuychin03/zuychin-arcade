import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ActionSubtype } from '@zuychin-arcade/types';
import { GameCover } from '../../ui/GameCover';

const lantern = require('../../../assets/game-art/saboteur-tool-lantern-intact.webp');
const cart = require('../../../assets/game-art/saboteur-tool-cart-intact.webp');
const pickaxe = require('../../../assets/game-art/saboteur-tool-pickaxe-intact.webp');
const artwork = {
  sabotage_lantern: [require('../../../assets/game-art/saboteur-tool-lantern-broken.webp')],
  sabotage_cart: [require('../../../assets/game-art/saboteur-tool-cart-broken.webp')],
  sabotage_pickaxe: [require('../../../assets/game-art/saboteur-tool-pickaxe-broken.webp')],
  repair_lantern: [lantern],
  repair_cart: [cart],
  repair_pickaxe: [pickaxe],
  repair_lantern_cart: [lantern, cart],
  repair_lantern_pickaxe: [lantern, pickaxe],
  repair_cart_pickaxe: [cart, pickaxe],
  map: [require('../../../assets/game-art/saboteur-action-map.webp')],
  rockfall: [require('../../../assets/game-art/saboteur-action-rockfall.webp')],
} as const;

export function ActionArtwork({ subtype, size, icons, color }: {
  subtype: ActionSubtype;
  size: number;
  icons: (keyof typeof MaterialCommunityIcons.glyphMap)[];
  color: string;
}) {
  const sources = artwork[subtype];
  const itemSize = sources.length === 1 ? size : (size - 1) / 2;
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: size, height: size, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
    {sources.map((source, index) => <View key={index} style={{ width: itemSize, height: itemSize }}>
      <GameCover source={source} aspectRatio={1} rimColor={color} backgroundColor="#241B36" fallback={
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name={icons[index]} size={itemSize * 0.65} color={color} /></View>
      } />
    </View>)}
  </View>;
}
