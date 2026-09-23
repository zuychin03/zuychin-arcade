import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GameCover } from '../ui/GameCover';
import { COUP } from '../../constants/theme';

const sources = {
  back: require('../../assets/game-art/coup-influence-back.webp'),
  loyalist: require('../../assets/game-art/coup-faction-loyalist.webp'),
  reformist: require('../../assets/game-art/coup-faction-reformist.webp'),
  treasury: require('../../assets/game-art/coup-treasury.webp'),
};
const icons = { back: 'shield-cross', loyalist: 'crown', reformist: 'fire', treasury: 'bank' } as const;

export function CoupTableArtwork({ kind }: { kind: keyof typeof sources }) {
  return <GameCover source={sources[kind]} aspectRatio={kind === 'back' ? 2 / 3 : 1} backgroundColor={COUP.panel} fallback={
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name={icons[kind]} size={28} color={COUP.gold} /></View>
  } />;
}
