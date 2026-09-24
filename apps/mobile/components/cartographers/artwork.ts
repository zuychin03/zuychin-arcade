import type { ImageSourcePropType } from 'react-native';
import type { CartographersObjective } from '@zuychin-arcade/types';

export const CARTOGRAPHERS_CARD_ART: Readonly<Record<string, ImageSourcePropType>> = {
  lagoon: require('../../assets/game-art/cartographers-lagoon.webp'),
  pasture: require('../../assets/game-art/cartographers-pasture.webp'),
  settlement: require('../../assets/game-art/cartographers-settlement.webp'),
  timber_grove: require('../../assets/game-art/cartographers-timber_grove.webp'),
  hillside_terrace: require('../../assets/game-art/cartographers-hillside_terrace.webp'),
  frontier_dwelling: require('../../assets/game-art/cartographers-frontier_dwelling.webp'),
  wildwood_garden: require('../../assets/game-art/cartographers-wildwood_garden.webp'),
  woodland_crossroads: require('../../assets/game-art/cartographers-woodland_crossroads.webp'),
  coastal_encampment: require('../../assets/game-art/cartographers-coastal_encampment.webp'),
  mangrove_swamp: require('../../assets/game-art/cartographers-mangrove_swamp.webp'),
  kethras_gates: require('../../assets/game-art/cartographers-kethras_gates.webp'),
  dobrik: require('../../assets/game-art/cartographers-dobrik.webp'),
  wren: require('../../assets/game-art/cartographers-wren.webp'),
  freyla: require('../../assets/game-art/cartographers-freyla.webp'),
  dal: require('../../assets/game-art/cartographers-dal.webp'),
  dragon: require('../../assets/game-art/cartographers-dragon.webp'),
  zombie: require('../../assets/game-art/cartographers-zombie.webp'),
  troll: require('../../assets/game-art/cartographers-troll.webp'),
  gorgon: require('../../assets/game-art/cartographers-gorgon.webp'),
};

export const CARTOGRAPHERS_OBJECTIVE_ART: Readonly<Record<CartographersObjective['category'], ImageSourcePropType>> = {
  forest: require('../../assets/game-art/cartographers-objective-forest.webp'),
  village: require('../../assets/game-art/cartographers-objective-village.webp'),
  farm_water: require('../../assets/game-art/cartographers-objective-farm-water.webp'),
  general: require('../../assets/game-art/cartographers-objective-general.webp'),
};
