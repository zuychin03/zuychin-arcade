import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CoupCharacter } from '@zuychin-arcade/types';
import { CardIllustration } from '../ui/CardIllustration';
import { COUP_CHARACTER_COLOR } from '../../constants/theme';

const sources = {
  duke: require('../../assets/game-art/coup-character-duke.webp'),
  assassin: require('../../assets/game-art/coup-character-assassin.webp'),
  captain: require('../../assets/game-art/coup-character-captain.webp'),
  ambassador: require('../../assets/game-art/coup-character-ambassador.webp'),
  contessa: require('../../assets/game-art/coup-character-contessa.webp'),
  inquisitor: require('../../assets/game-art/coup-character-inquisitor.webp'),
};
const icons: Record<CoupCharacter, keyof typeof MaterialCommunityIcons.glyphMap> = { duke: 'crown', assassin: 'sword', captain: 'anchor', ambassador: 'handshake', contessa: 'shield-crown', inquisitor: 'magnify' };

export function CoupCharacterArtwork({ character }: { character: CoupCharacter }) {
  return <CardIllustration source={sources[character]} aspectRatio={1} fallback={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name={icons[character]} size={32} color={COUP_CHARACTER_COLOR[character]} /></View>} />;
}
