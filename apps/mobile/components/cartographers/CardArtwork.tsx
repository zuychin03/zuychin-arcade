import type { ImageSourcePropType } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CardIllustration } from '../ui/CardIllustration';
import { CARTOGRAPHERS as C } from './palette';

export function CardArtwork({ source }: { source: ImageSourcePropType }) {
  return <CardIllustration source={source} aspectRatio={640 / 427} backgroundColor={C.bg}
    fallback={<MaterialCommunityIcons name="image-filter-hdr" size={48} color={C.muted} />} />;
}
