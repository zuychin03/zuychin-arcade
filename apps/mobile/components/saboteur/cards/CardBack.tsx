import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CardSurface } from '../../ui/CardSurface';
import { GameCover } from '../../ui/GameCover';

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
    <LinearGradient colors={['#573D35', '#31212B', '#201622']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{
        width,
        height,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 4,
          bottom: 4,
          left: 4,
          right: 4,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: '#9A7455',
          borderBottomColor: '#21131C',
          borderRightColor: '#21131C',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <GameCover source={artwork} aspectRatio={1} rimColor="#BC9261" backgroundColor="#31212B" fallback={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name={icon} size={minDim * 0.38} color="#E6BE81" /></View>
        } />
      </View>
    </LinearGradient>
    </CardSurface>
  );
}
