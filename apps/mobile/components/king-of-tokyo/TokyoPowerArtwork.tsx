import { View, type ImageSourcePropType } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { KingOfTokyoCardCategory, KingOfTokyoPowerCardId } from '@zuychin-arcade/types';
import { GameCover } from '../ui/GameCover';

const artwork = {
  attack: require('../../assets/game-art/tokyo-power-attack.webp'),
  defense: require('../../assets/game-art/tokyo-power-defense.webp'),
  dice: require('../../assets/game-art/tokyo-power-dice.webp'),
  energy: require('../../assets/game-art/tokyo-power-energy.webp'),
  healing: require('../../assets/game-art/tokyo-power-healing.webp'),
  market: require('../../assets/game-art/tokyo-power-market.webp'),
  victory: require('../../assets/game-art/tokyo-power-victory.webp'),
  wild: require('../../assets/game-art/tokyo-power-wild.webp'),
};

const powerArtwork: Record<KingOfTokyoPowerCardId, ImageSourcePropType> = {
  apartment_building: require('../../assets/game-art/tokyo-power-apartment_building.webp'),
  commuter_train: require('../../assets/game-art/tokyo-power-commuter_train.webp'),
  corner_store: require('../../assets/game-art/tokyo-power-corner_store.webp'),
  drop_from_high_altitude: require('../../assets/game-art/tokyo-power-drop_from_high_altitude.webp'),
  energize: require('../../assets/game-art/tokyo-power-energize.webp'),
  evacuation_orders: require('../../assets/game-art/tokyo-power-evacuation_orders.webp'),
  flame_thrower: require('../../assets/game-art/tokyo-power-flame_thrower.webp'),
  frenzy: require('../../assets/game-art/tokyo-power-frenzy.webp'),
  gas_refinery: require('../../assets/game-art/tokyo-power-gas_refinery.webp'),
  heal: require('../../assets/game-art/tokyo-power-heal.webp'),
  high_altitude_bombing: require('../../assets/game-art/tokyo-power-high_altitude_bombing.webp'),
  jet_fighters: require('../../assets/game-art/tokyo-power-jet_fighters.webp'),
  national_guard: require('../../assets/game-art/tokyo-power-national_guard.webp'),
  nuclear_power_plant: require('../../assets/game-art/tokyo-power-nuclear_power_plant.webp'),
  skyscraper: require('../../assets/game-art/tokyo-power-skyscraper.webp'),
  tanks: require('../../assets/game-art/tokyo-power-tanks.webp'),
  vast_storm: require('../../assets/game-art/tokyo-power-vast_storm.webp'),
  acid_attack: require('../../assets/game-art/tokyo-power-acid_attack.webp'),
  alien_origin: require('../../assets/game-art/tokyo-power-alien_origin.webp'),
  alpha_monster: require('../../assets/game-art/tokyo-power-alpha_monster.webp'),
  armor_plating: require('../../assets/game-art/tokyo-power-armor_plating.webp'),
  background_dweller: require('../../assets/game-art/tokyo-power-background_dweller.webp'),
  burrowing: require('../../assets/game-art/tokyo-power-burrowing.webp'),
  camouflage: require('../../assets/game-art/tokyo-power-camouflage.webp'),
  complete_destruction: require('../../assets/game-art/tokyo-power-complete_destruction.webp'),
  media_friendly: require('../../assets/game-art/tokyo-power-media_friendly.webp'),
  eater_of_the_dead: require('../../assets/game-art/tokyo-power-eater_of_the_dead.webp'),
  energy_hoarder: require('../../assets/game-art/tokyo-power-energy_hoarder.webp'),
  even_bigger: require('../../assets/game-art/tokyo-power-even_bigger.webp'),
  extra_head: require('../../assets/game-art/tokyo-power-extra_head.webp'),
  fire_breathing: require('../../assets/game-art/tokyo-power-fire_breathing.webp'),
  freeze_time: require('../../assets/game-art/tokyo-power-freeze_time.webp'),
  friend_of_children: require('../../assets/game-art/tokyo-power-friend_of_children.webp'),
  giant_brain: require('../../assets/game-art/tokyo-power-giant_brain.webp'),
  gourmet: require('../../assets/game-art/tokyo-power-gourmet.webp'),
  healing_ray: require('../../assets/game-art/tokyo-power-healing_ray.webp'),
  herbivore: require('../../assets/game-art/tokyo-power-herbivore.webp'),
  herd_culler: require('../../assets/game-art/tokyo-power-herd_culler.webp'),
  it_has_a_child: require('../../assets/game-art/tokyo-power-it_has_a_child.webp'),
  jets: require('../../assets/game-art/tokyo-power-jets.webp'),
  made_in_a_lab: require('../../assets/game-art/tokyo-power-made_in_a_lab.webp'),
  metamorph: require('../../assets/game-art/tokyo-power-metamorph.webp'),
  mimic: require('../../assets/game-art/tokyo-power-mimic.webp'),
  battery_monster: require('../../assets/game-art/tokyo-power-battery_monster.webp'),
  nova_breath: require('../../assets/game-art/tokyo-power-nova_breath.webp'),
  detritivore: require('../../assets/game-art/tokyo-power-detritivore.webp'),
  opportunist: require('../../assets/game-art/tokyo-power-opportunist.webp'),
  parasitic_tentacles: require('../../assets/game-art/tokyo-power-parasitic_tentacles.webp'),
  plot_twist: require('../../assets/game-art/tokyo-power-plot_twist.webp'),
  poison_quills: require('../../assets/game-art/tokyo-power-poison_quills.webp'),
  poison_spit: require('../../assets/game-art/tokyo-power-poison_spit.webp'),
  psychic_probe: require('../../assets/game-art/tokyo-power-psychic_probe.webp'),
  rapid_healing: require('../../assets/game-art/tokyo-power-rapid_healing.webp'),
  regeneration: require('../../assets/game-art/tokyo-power-regeneration.webp'),
  rooting_for_underdog: require('../../assets/game-art/tokyo-power-rooting_for_underdog.webp'),
  shrink_ray: require('../../assets/game-art/tokyo-power-shrink_ray.webp'),
  smoke_cloud: require('../../assets/game-art/tokyo-power-smoke_cloud.webp'),
  solar_powered: require('../../assets/game-art/tokyo-power-solar_powered.webp'),
  spiked_tail: require('../../assets/game-art/tokyo-power-spiked_tail.webp'),
  stretchy: require('../../assets/game-art/tokyo-power-stretchy.webp'),
  energy_drink: require('../../assets/game-art/tokyo-power-energy_drink.webp'),
  urbavore: require('../../assets/game-art/tokyo-power-urbavore.webp'),
  making_it_stronger: require('../../assets/game-art/tokyo-power-making_it_stronger.webp'),
  wings: require('../../assets/game-art/tokyo-power-wings.webp'),
};

export function TokyoPowerArtwork({ cardId, category, icon, color }: {
  cardId?: KingOfTokyoPowerCardId;
  category: KingOfTokyoCardCategory;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
}) {
  return <GameCover source={cardId ? powerArtwork[cardId] : artwork[category]} aspectRatio={1} rimColor={color} fallback={
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name={icon} size={52} color={color} />
    </View>
  } />;
}
