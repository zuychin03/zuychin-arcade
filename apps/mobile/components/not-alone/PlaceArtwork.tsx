import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NotAlonePlaceId } from '@zuychin-arcade/types';
import { CardIllustration } from '../ui/CardIllustration';

const artwork = {
  1: require('../../assets/game-art/not-alone-place-lair.webp'),
  2: require('../../assets/game-art/not-alone-place-jungle.webp'),
  3: require('../../assets/game-art/not-alone-place-river.webp'),
  4: require('../../assets/game-art/not-alone-place-beach.webp'),
  5: require('../../assets/game-art/not-alone-place-rover.webp'),
  6: require('../../assets/game-art/not-alone-place-swamp.webp'),
  7: require('../../assets/game-art/not-alone-place-shelter.webp'),
  8: require('../../assets/game-art/not-alone-place-wreck.webp'),
  9: require('../../assets/game-art/not-alone-place-source.webp'),
  10: require('../../assets/game-art/not-alone-place-artefact.webp'),
};

export function PlaceArtwork({ placeId, color }: { placeId: NotAlonePlaceId; color: string; compact?: boolean }) {
  return (
    <View testID={`not-alone-place-art-${placeId}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: '100%' }}>
      <CardIllustration source={artwork[placeId]} aspectRatio={1} fallback={
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name={placeId === 5 ? 'robot-outline' : placeId === 8 ? 'rocket-launch-outline' : placeId === 10 ? 'diamond-stone' : 'image-filter-hdr'} size={48} color={color} accessible={false} />
        </View>
      } />
    </View>
  );
}
