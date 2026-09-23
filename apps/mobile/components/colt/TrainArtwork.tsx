import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GameCover } from '../ui/GameCover';
import { COLT as C } from '../../constants/theme';

const sources = {
  locomotive: require('../../assets/game-art/colt-train-locomotive.webp'),
  carriage: require('../../assets/game-art/colt-train-carriage.webp'),
  caboose: require('../../assets/game-art/colt-train-caboose.webp'),
};

export function TrainArtwork({ kind }: { kind: keyof typeof sources }) {
  return <GameCover source={sources[kind]} aspectRatio={1.5} rimColor={C.ember} backgroundColor={C.bg} fallback={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="train" size={36} color={C.gold} /></View>} />;
}
