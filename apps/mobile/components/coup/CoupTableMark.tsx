import { View } from 'react-native';
import { CharacterCard } from './CharacterCard';

export function CoupTableMark() {
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 }}>
    <View style={{ transform: [{ rotate: '-6deg' }] }}><CharacterCard faceDown size="xs" /></View>
    <View style={{ transform: [{ rotate: '6deg' }] }}><CharacterCard faceDown size="xs" /></View>
  </View>;
}
