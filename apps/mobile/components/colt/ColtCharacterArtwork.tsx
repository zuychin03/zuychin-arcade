import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CardIllustration } from '../ui/CardIllustration';

const portraits = {
  ghost: require('../../assets/game-art/colt-character-ghost.webp'),
  doc: require('../../assets/game-art/colt-character-doc.webp'),
  tuco: require('../../assets/game-art/colt-character-tuco.webp'),
  django: require('../../assets/game-art/colt-character-django.webp'),
  cheyenne: require('../../assets/game-art/colt-character-cheyenne.webp'),
  belle: require('../../assets/game-art/colt-character-belle.webp'),
};

export function ColtCharacterArtwork({ name, color }: { name: string; color: string }) {
  const key = name.toLowerCase();
  const fallback = <View style={{ minHeight: 112, flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="account-outline" size={48} color={color} /></View>;
  return Object.hasOwn(portraits, key) ? <CardIllustration source={portraits[key as keyof typeof portraits]} fallback={fallback} /> : fallback;
}
