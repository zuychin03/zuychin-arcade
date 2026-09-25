import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NotAloneHuntCardId, NotAloneSurvivalCardId } from '@zuychin-arcade/types';
import { CardIllustration } from '../ui/CardIllustration';

const artwork = {
  adrenaline: require('../../assets/game-art/not-alone-survival-adrenaline.webp'),
  amplifier: require('../../assets/game-art/not-alone-survival-amplifier.webp'),
  detector: require('../../assets/game-art/not-alone-survival-detector.webp'),
  dodge: require('../../assets/game-art/not-alone-survival-dodge.webp'),
  double_back: require('../../assets/game-art/not-alone-survival-double_back.webp'),
  drone: require('../../assets/game-art/not-alone-survival-drone.webp'),
  gate: require('../../assets/game-art/not-alone-survival-gate.webp'),
  hologram: require('../../assets/game-art/not-alone-survival-hologram.webp'),
  ingenuity: require('../../assets/game-art/not-alone-survival-ingenuity.webp'),
  sacrifice: require('../../assets/game-art/not-alone-survival-sacrifice.webp'),
  sixth_sense: require('../../assets/game-art/not-alone-survival-sixth_sense.webp'),
  smokescreen: require('../../assets/game-art/not-alone-survival-smokescreen.webp'),
  strike_back: require('../../assets/game-art/not-alone-survival-strike_back.webp'),
  vortex: require('../../assets/game-art/not-alone-survival-vortex.webp'),
  wrong_track: require('../../assets/game-art/not-alone-survival-wrong_track.webp'),
  anticipation: require('../../assets/game-art/not-alone-hunt-anticipation.webp'),
  ascendancy: require('../../assets/game-art/not-alone-hunt-ascendancy.webp'),
  cataclysm: require('../../assets/game-art/not-alone-hunt-cataclysm.webp'),
  clone: require('../../assets/game-art/not-alone-hunt-clone.webp'),
  despair: require('../../assets/game-art/not-alone-hunt-despair.webp'),
  detour: require('../../assets/game-art/not-alone-hunt-detour.webp'),
  fierceness: require('../../assets/game-art/not-alone-hunt-fierceness.webp'),
  flashback: require('../../assets/game-art/not-alone-hunt-flashback.webp'),
  forbidden_zone: require('../../assets/game-art/not-alone-hunt-forbidden_zone.webp'),
  force_field: require('../../assets/game-art/not-alone-hunt-force_field.webp'),
  interference: require('../../assets/game-art/not-alone-hunt-interference.webp'),
  mirage: require('../../assets/game-art/not-alone-hunt-mirage.webp'),
  mutation: require('../../assets/game-art/not-alone-hunt-mutation.webp'),
  persecution: require('../../assets/game-art/not-alone-hunt-persecution.webp'),
  phobia: require('../../assets/game-art/not-alone-hunt-phobia.webp'),
  scream: require('../../assets/game-art/not-alone-hunt-scream.webp'),
  stasis: require('../../assets/game-art/not-alone-hunt-stasis.webp'),
  toxin: require('../../assets/game-art/not-alone-hunt-toxin.webp'),
  tracking: require('../../assets/game-art/not-alone-hunt-tracking.webp'),
  virus: require('../../assets/game-art/not-alone-hunt-virus.webp'),
} satisfies Record<NotAloneHuntCardId | NotAloneSurvivalCardId, number>;

export function PowerArtwork({ cardId, color }: { cardId: string; color: string }) {
  const source = Object.prototype.hasOwnProperty.call(artwork, cardId) ? artwork[cardId as keyof typeof artwork] : undefined;
  return <View testID={`not-alone-power-art-${cardId}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: '100%' }}>
    {source === undefined ? <View style={{ aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="cards-outline" size={48} color={color} accessible={false} /></View> : <CardIllustration source={source} aspectRatio={1} fallback={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="cards-outline" size={48} color={color} accessible={false} /></View>} />}
  </View>;
}
