import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BangCardName } from '@zuychin-arcade/types';
import { GameCover } from '../ui/GameCover';
import { BANG } from '../../constants/theme';

const artwork = {
  attack: require('../../assets/game-art/bang-card-attack.webp'),
  response: require('../../assets/game-art/bang-card-response.webp'),
  recovery: require('../../assets/game-art/bang-card-recovery.webp'),
  supply: require('../../assets/game-art/bang-card-supply.webp'),
  interference: require('../../assets/game-art/bang-card-interference.webp'),
  equipment: require('../../assets/game-art/bang-card-equipment.webp'),
  weapon: require('../../assets/game-art/bang-card-weapon.webp'),
};

const identities = {
  bang: require('../../assets/game-art/bang-card-bang.webp'),
  missed: require('../../assets/game-art/bang-card-missed.webp'),
  beer: require('../../assets/game-art/bang-card-beer.webp'),
  saloon: require('../../assets/game-art/bang-card-saloon.webp'),
  stagecoach: require('../../assets/game-art/bang-card-stagecoach.webp'),
  wells_fargo: require('../../assets/game-art/bang-card-wells_fargo.webp'),
  general_store: require('../../assets/game-art/bang-card-general_store.webp'),
  panic: require('../../assets/game-art/bang-card-panic.webp'),
  cat_balou: require('../../assets/game-art/bang-card-cat_balou.webp'),
  gatling: require('../../assets/game-art/bang-card-gatling.webp'),
  indians: require('../../assets/game-art/bang-card-indians.webp'),
  duel: require('../../assets/game-art/bang-card-duel.webp'),
  barrel: require('../../assets/game-art/bang-card-barrel.webp'),
  dynamite: require('../../assets/game-art/bang-card-dynamite.webp'),
  scope: require('../../assets/game-art/bang-card-scope.webp'),
  mustang: require('../../assets/game-art/bang-card-mustang.webp'),
  jail: require('../../assets/game-art/bang-card-jail.webp'),
  volcanic: require('../../assets/game-art/bang-card-volcanic.webp'),
  schofield: require('../../assets/game-art/bang-card-schofield.webp'),
  remington: require('../../assets/game-art/bang-card-remington.webp'),
  rev_carabine: require('../../assets/game-art/bang-card-rev_carabine.webp'),
  winchester: require('../../assets/game-art/bang-card-winchester.webp'),
} satisfies Record<BangCardName, number>;

export const BANG_CARD_ART_FAMILY: Record<BangCardName, keyof typeof artwork> = {
  bang: 'attack', gatling: 'attack', indians: 'attack', duel: 'attack',
  missed: 'response', beer: 'recovery', saloon: 'recovery',
  stagecoach: 'supply', wells_fargo: 'supply', general_store: 'supply',
  panic: 'interference', cat_balou: 'interference',
  barrel: 'equipment', dynamite: 'equipment', scope: 'equipment', mustang: 'equipment', jail: 'equipment',
  volcanic: 'weapon', schofield: 'weapon', remington: 'weapon', rev_carabine: 'weapon', winchester: 'weapon',
};

export const BANG_CARD_EMBLEM: Record<BangCardName, keyof typeof MaterialCommunityIcons.glyphMap> = {
  bang: 'bullseye-arrow', gatling: 'bullseye-arrow', indians: 'cards', duel: 'sword-cross',
  missed: 'shield-outline', beer: 'beer', saloon: 'glass-mug-variant',
  stagecoach: 'package-variant', wells_fargo: 'treasure-chest', general_store: 'storefront-outline',
  panic: 'hand-back-right-outline', cat_balou: 'card-remove-outline',
  barrel: 'barrel', dynamite: 'timer-sand', scope: 'binoculars', mustang: 'horseshoe', jail: 'lock-outline',
  volcanic: 'pistol', schofield: 'pistol', remington: 'pistol', rev_carabine: 'pistol', winchester: 'pistol',
};

export function BangCardArtwork({ name }: { name: BangCardName }) {
  return <View testID={`bang-card-art-${name}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: '100%', maxWidth: 260, alignSelf: 'center' }}>
    <GameCover source={identities[name]} aspectRatio={1.6} backgroundColor={BANG.panel} rimColor={BANG.gold} fallback={<GameCover source={artwork[BANG_CARD_ART_FAMILY[name]]} aspectRatio={1.6} backgroundColor={BANG.panel} rimColor={BANG.gold} fallback={
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BANG.panel }}>
        <MaterialCommunityIcons name={BANG_CARD_EMBLEM[name]} size={48} color={BANG.sand} accessible={false} />
      </View>
    } />} />
  </View>;
}
