import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SkullKingCard, SkullKingSuit } from '@zuychin-arcade/types';
import { GameCover } from '../ui/GameCover';
import { CardIllustration } from '../ui/CardIllustration';

type SpecialKind = Exclude<SkullKingCard['kind'], 'number'>;
const artwork = {
  pirate: require('../../assets/game-art/skull-special-pirate.webp'),
  tigress: require('../../assets/game-art/skull-special-tigress.webp'),
  skull_king: require('../../assets/game-art/skull-special-skull_king.webp'),
  mermaid: require('../../assets/game-art/skull-special-mermaid.webp'),
  escape: require('../../assets/game-art/skull-special-escape.webp'),
};
const icon = { pirate: 'pirate', tigress: 'cat', skull_king: 'crown', mermaid: 'waves', escape: 'run-fast' } as const;
const suits = {
  green: require('../../assets/game-art/skull-suit-green.webp'),
  purple: require('../../assets/game-art/skull-suit-purple.webp'),
  yellow: require('../../assets/game-art/skull-suit-yellow.webp'),
  black: require('../../assets/game-art/skull-suit-black.webp'),
};
const suitIcons = { green: 'anchor', purple: 'compass-outline', yellow: 'key-variant', black: 'cards-spade' } as const;

export function SkullKingCardArtwork({ kind, color }: { kind: SpecialKind; color: string }) {
  return <CardIllustration source={artwork[kind]} aspectRatio={1} fallback={
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name={icon[kind]} size={42} color={color} />
    </View>
  } />;
}

export function SkullKingSuitArtwork({ suit, color }: { suit: SkullKingSuit; color: string }) {
  return <CardIllustration source={suits[suit]} aspectRatio={1} fallback={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name={suitIcons[suit]} size={36} color={color} /></View>} />;
}

export function SkullKingDeckArtwork() {
  return <GameCover source={require('../../assets/game-art/skull-deck-back.webp')} aspectRatio={2 / 3} fallback={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="cards-playing-outline" size={24} color="#F7FAFF" /></View>} />;
}
