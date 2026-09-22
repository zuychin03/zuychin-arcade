import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable } from 'react-native';

interface Props {
  color: string;
  href: Href;
  label: string;
  hint: string;
}

export function RouteBackButton({ color, href, label, hint }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={() => router.replace(href)}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <MaterialCommunityIcons name="arrow-left" size={24} color={color} />
    </Pressable>
  );
}
