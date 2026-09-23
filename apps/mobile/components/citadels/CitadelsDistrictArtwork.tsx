import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CitadelsDistrictColor } from '@zuychin-arcade/types';
import { GameCover } from '../ui/GameCover';

const artwork = {
  noble: require('../../assets/game-art/citadels-district-noble.webp'),
  religious: require('../../assets/game-art/citadels-district-religious.webp'),
  trade: require('../../assets/game-art/citadels-district-trade.webp'),
  military: require('../../assets/game-art/citadels-district-military.webp'),
  unique: require('../../assets/game-art/citadels-district-unique.webp'),
};

const districts = {
  wishing_well: require('../../assets/game-art/citadels-district-wishing_well.webp'),
  great_wall: require('../../assets/game-art/citadels-district-great_wall.webp'),
  manor: require('../../assets/game-art/citadels-district-manor.webp'),
  castle: require('../../assets/game-art/citadels-district-castle.webp'),
  palace: require('../../assets/game-art/citadels-district-palace.webp'),
  temple: require('../../assets/game-art/citadels-district-temple.webp'),
  church: require('../../assets/game-art/citadels-district-church.webp'),
  monastery: require('../../assets/game-art/citadels-district-monastery.webp'),
  cathedral: require('../../assets/game-art/citadels-district-cathedral.webp'),
  tavern: require('../../assets/game-art/citadels-district-tavern.webp'),
  market: require('../../assets/game-art/citadels-district-market.webp'),
  trading_post: require('../../assets/game-art/citadels-district-trading_post.webp'),
  docks: require('../../assets/game-art/citadels-district-docks.webp'),
  harbor: require('../../assets/game-art/citadels-district-harbor.webp'),
  town_hall: require('../../assets/game-art/citadels-district-town_hall.webp'),
  watchtower: require('../../assets/game-art/citadels-district-watchtower.webp'),
  prison: require('../../assets/game-art/citadels-district-prison.webp'),
  barracks: require('../../assets/game-art/citadels-district-barracks.webp'),
  fortress: require('../../assets/game-art/citadels-district-fortress.webp'),
  haunted_quarter: require('../../assets/game-art/citadels-district-haunted_quarter.webp'),
  keep: require('../../assets/game-art/citadels-district-keep.webp'),
  imperial_treasury: require('../../assets/game-art/citadels-district-imperial_treasury.webp'),
  map_room: require('../../assets/game-art/citadels-district-map_room.webp'),
  laboratory: require('../../assets/game-art/citadels-district-laboratory.webp'),
  observatory: require('../../assets/game-art/citadels-district-observatory.webp'),
  smithy: require('../../assets/game-art/citadels-district-smithy.webp'),
  library: require('../../assets/game-art/citadels-district-library.webp'),
  school_of_magic: require('../../assets/game-art/citadels-district-school_of_magic.webp'),
  dragon_gate: require('../../assets/game-art/citadels-district-dragon_gate.webp'),
  factory: require('../../assets/game-art/citadels-district-factory.webp'),
  gold_mine: require('../../assets/game-art/citadels-district-gold_mine.webp'),
};

export const citadelsDistrictIcons = {
  noble: 'crown-outline', religious: 'church-outline', trade: 'storefront-outline',
  military: 'shield-sword-outline', unique: 'star-four-points-outline',
} as const;

export function CitadelsDistrictArtwork({ templateId, category, color, compact }: { templateId: string; category: CitadelsDistrictColor; color: string; compact: boolean }) {
  const categoryArt = <GameCover source={artwork[category]} rimColor={color} aspectRatio={compact ? 1.1 : 1} fallback={
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name={citadelsDistrictIcons[category]} size={48} color={color} accessible={false} />
    </View>
  } />;
  return Object.hasOwn(districts, templateId)
    ? <GameCover source={districts[templateId as keyof typeof districts]} rimColor={color} aspectRatio={compact ? 1.1 : 1} fallback={categoryArt} />
    : categoryArt;
}
