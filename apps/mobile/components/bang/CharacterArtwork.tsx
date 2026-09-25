import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BangCharacterId } from '@zuychin-arcade/types';
import { GameCover } from '../ui/GameCover';
import { CardIllustration } from '../ui/CardIllustration';
import { BANG } from '../../constants/theme';

const portraits = {
  bart_cassidy: require('../../assets/game-art/bang-character-bart_cassidy.webp'),
  black_jack: require('../../assets/game-art/bang-character-black_jack.webp'),
  calamity_janet: require('../../assets/game-art/bang-character-calamity_janet.webp'),
  el_gringo: require('../../assets/game-art/bang-character-el_gringo.webp'),
  jesse_jones: require('../../assets/game-art/bang-character-jesse_jones.webp'),
  jourdonnais: require('../../assets/game-art/bang-character-jourdonnais.webp'),
  kit_carlson: require('../../assets/game-art/bang-character-kit_carlson.webp'),
  lucky_duke: require('../../assets/game-art/bang-character-lucky_duke.webp'),
  paul_regret: require('../../assets/game-art/bang-character-paul_regret.webp'),
  pedro_ramirez: require('../../assets/game-art/bang-character-pedro_ramirez.webp'),
  rose_doolan: require('../../assets/game-art/bang-character-rose_doolan.webp'),
  sid_ketchum: require('../../assets/game-art/bang-character-sid_ketchum.webp'),
  slab_the_killer: require('../../assets/game-art/bang-character-slab_the_killer.webp'),
  suzy_lafayette: require('../../assets/game-art/bang-character-suzy_lafayette.webp'),
  vulture_sam: require('../../assets/game-art/bang-character-vulture_sam.webp'),
  willy_the_kid: require('../../assets/game-art/bang-character-willy_the_kid.webp'),
} satisfies Record<BangCharacterId, number>;

export function BangCharacterArtwork({ character, size = 96, fluid = false }: { character: BangCharacterId; size?: number; fluid?: boolean }) {
  if (fluid) return <CardIllustration source={portraits[character]} backgroundColor={BANG.panel} fallback={<MaterialCommunityIcons name="account-outline" size={40} color={BANG.sand} accessible={false} />} />;
  return <View testID={`bang-character-art-${character}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: size, maxWidth: '100%', flexShrink: 0, alignSelf: 'center' }}>
    <GameCover source={portraits[character]} aspectRatio={1} backgroundColor={BANG.panel} rimColor={BANG.gold} fallback={
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="account-outline" size={40} color={BANG.sand} accessible={false} /></View>
    } />
  </View>;
}
