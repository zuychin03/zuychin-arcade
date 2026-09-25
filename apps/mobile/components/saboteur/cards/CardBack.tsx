import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CardSurface } from '../../ui/CardSurface';
import { CardIllustration } from '../../ui/CardIllustration';

const artwork = require('../../../assets/game-art/saboteur-deck-back.webp');

interface Props {
  width?: number;
  height?: number;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  depth?: number;
}

export function CardBack({ width = 44, height = 66, icon = 'pickaxe', depth = 3 }: Props) {
  const minDim = Math.min(width, height);
  return (
    <CardSurface width={width} height={height} depth={depth} radius={8} faceColor="#30202B" edgeColor="#160E16" highlightColor="#BC9261">
      <CardIllustration source={artwork} aspectRatio={width / height} backgroundColor="#31212B" fallback={
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name={icon} size={minDim * 0.38} color="#E6BE81" /></View>
      } />
    </CardSurface>
  );
}
