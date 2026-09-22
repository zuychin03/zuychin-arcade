import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SkullKingCard } from '@zuychin-arcade/types';
import { GameCover } from '../ui/GameCover';

type SpecialKind = Exclude<SkullKingCard['kind'], 'number'>;
const artwork = {
  pirate: require('../../assets/game-art/skull-special-pirate.webp'),
  tigress: require('../../assets/game-art/skull-special-tigress.webp'),
  skull_king: require('../../assets/game-art/skull-special-skull_king.webp'),
  mermaid: require('../../assets/game-art/skull-special-mermaid.webp'),
  escape: require('../../assets/game-art/skull-special-escape.webp'),
};
const icon = { pirate: 'pirate', tigress: 'cat', skull_king: 'crown', mermaid: 'waves', escape: 'run-fast' } as const;

export function SkullKingCardArtwork({ kind, color }: { kind: SpecialKind; color: string }) {
  return <GameCover source={artwork[kind]} aspectRatio={1} fallback={
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name={icon[kind]} size={42} color={color} />
    </View>
  } />;
}
