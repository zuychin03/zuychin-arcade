import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export function ArcadeBackButton({ color }: { color: string }) {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="Back to arcade"
    accessibilityHint="Return to the arcade game list"
    onPress={() => { router.dismissAll(); router.replace('/'); }}
    style={({ pressed }) => ({
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: pressed ? 0.65 : 1,
    })}
  >
    <MaterialCommunityIcons name="arrow-left" size={24} color={color} />
  </Pressable>;
}
