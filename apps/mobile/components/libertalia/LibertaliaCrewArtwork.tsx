import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GameCover } from '../ui/GameCover';
import { LIBERTALIA as C } from '../../constants/theme';

const portraits: Record<number, number> = {
  1: require('../../assets/game-art/libertalia-crew-01.webp'),
  2: require('../../assets/game-art/libertalia-crew-02.webp'),
  3: require('../../assets/game-art/libertalia-crew-03.webp'),
  4: require('../../assets/game-art/libertalia-crew-04.webp'),
  5: require('../../assets/game-art/libertalia-crew-05.webp'),
  6: require('../../assets/game-art/libertalia-crew-06.webp'),
  7: require('../../assets/game-art/libertalia-crew-07.webp'),
  8: require('../../assets/game-art/libertalia-crew-08.webp'),
  9: require('../../assets/game-art/libertalia-crew-09.webp'),
  10: require('../../assets/game-art/libertalia-crew-10.webp'),
  11: require('../../assets/game-art/libertalia-crew-11.webp'),
  12: require('../../assets/game-art/libertalia-crew-12.webp'),
  13: require('../../assets/game-art/libertalia-crew-13.webp'),
  14: require('../../assets/game-art/libertalia-crew-14.webp'),
  15: require('../../assets/game-art/libertalia-crew-15.webp'),
  16: require('../../assets/game-art/libertalia-crew-16.webp'),
  17: require('../../assets/game-art/libertalia-crew-17.webp'),
  18: require('../../assets/game-art/libertalia-crew-18.webp'),
  19: require('../../assets/game-art/libertalia-crew-19.webp'),
  20: require('../../assets/game-art/libertalia-crew-20.webp'),
  21: require('../../assets/game-art/libertalia-crew-21.webp'),
  22: require('../../assets/game-art/libertalia-crew-22.webp'),
  23: require('../../assets/game-art/libertalia-crew-23.webp'),
  24: require('../../assets/game-art/libertalia-crew-24.webp'),
  25: require('../../assets/game-art/libertalia-crew-25.webp'),
  26: require('../../assets/game-art/libertalia-crew-26.webp'),
  27: require('../../assets/game-art/libertalia-crew-27.webp'),
  28: require('../../assets/game-art/libertalia-crew-28.webp'),
  29: require('../../assets/game-art/libertalia-crew-29.webp'),
  30: require('../../assets/game-art/libertalia-crew-30.webp'),
  31: require('../../assets/game-art/libertalia-crew-31.webp'),
  32: require('../../assets/game-art/libertalia-crew-32.webp'),
  33: require('../../assets/game-art/libertalia-crew-33.webp'),
  34: require('../../assets/game-art/libertalia-crew-34.webp'),
  35: require('../../assets/game-art/libertalia-crew-35.webp'),
  36: require('../../assets/game-art/libertalia-crew-36.webp'),
  37: require('../../assets/game-art/libertalia-crew-37.webp'),
  38: require('../../assets/game-art/libertalia-crew-38.webp'),
  39: require('../../assets/game-art/libertalia-crew-39.webp'),
  40: require('../../assets/game-art/libertalia-crew-40.webp'),
};

export function LibertaliaCrewArtwork({ rank }: { rank: number }) {
  const source = portraits[rank];
  if (!source) return null;
  return <View testID={`libertalia-crew-art-${rank}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: '100%', maxWidth: 280, alignSelf: 'center' }}>
    <GameCover source={source} rimColor={C.sky} aspectRatio={1.6} backgroundColor={C.panel} fallback={
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <MaterialCommunityIcons name="account-outline" size={48} color={C.sky} accessible={false} />
      </View>
    } />
  </View>;
}
