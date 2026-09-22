import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { LibertaliaAbilityPhase, LibertaliaLoot } from '@zuychin-arcade/types';
import { GameCover } from '../ui/GameCover';
import { LIBERTALIA as C } from '../../constants/theme';

const lootArt = {
  map: require('../../assets/game-art/libertalia-loot-map.webp'),
  barrel: require('../../assets/game-art/libertalia-loot-barrel.webp'),
  amulet: require('../../assets/game-art/libertalia-loot-amulet.webp'),
  chest: require('../../assets/game-art/libertalia-loot-chest.webp'),
  hook: require('../../assets/game-art/libertalia-loot-hook.webp'),
  saber: require('../../assets/game-art/libertalia-loot-saber.webp'),
  relic: require('../../assets/game-art/libertalia-loot-relic.webp'),
};
const phaseArt = {
  daytime: require('../../assets/game-art/libertalia-phase-daytime.webp'),
  dusk: require('../../assets/game-art/libertalia-phase-dusk.webp'),
  night: require('../../assets/game-art/libertalia-phase-night.webp'),
  anchor: require('../../assets/game-art/libertalia-phase-anchor.webp'),
};
const lootIcons: Record<LibertaliaLoot, keyof typeof MaterialCommunityIcons.glyphMap> = {
  map: 'map-outline', barrel: 'barrel', amulet: 'necklace', chest: 'treasure-chest', hook: 'hook', saber: 'sword', relic: 'skull-outline',
};
const phaseIcons: Record<LibertaliaAbilityPhase, keyof typeof MaterialCommunityIcons.glyphMap> = {
  daytime: 'white-balance-sunny', dusk: 'weather-sunset', night: 'weather-night', anchor: 'anchor',
};

export function LibertaliaLootArtwork({ kind, size = 72 }: { kind: LibertaliaLoot; size?: number }) {
  const edge = Number.isFinite(size) ? Math.min(96, Math.max(32, size)) : 72;
  return <View testID={`libertalia-loot-art-${kind}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: edge, height: edge, flexShrink: 0, borderRadius: 12, overflow: 'hidden' }}>
    <GameCover source={lootArt[kind]} aspectRatio={1} backgroundColor={C.panel} fallback={
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name={lootIcons[kind]} size={edge * 0.6} color={kind === 'relic' ? C.violet : C.gold} accessible={false} /></View>
    } />
  </View>;
}

export function LibertaliaPhaseArtwork({ phase }: { phase: LibertaliaAbilityPhase }) {
  return <View testID={`libertalia-phase-art-${phase}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: '100%', maxWidth: 280, alignSelf: 'center' }}>
    <GameCover source={phaseArt[phase]} aspectRatio={1.6} backgroundColor={C.panel} fallback={
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name={phaseIcons[phase]} size={48} color={C.violet} accessible={false} /></View>
    } />
  </View>;
}
