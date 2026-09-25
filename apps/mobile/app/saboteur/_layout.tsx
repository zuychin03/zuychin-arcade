import { Stack } from 'expo-router';
import { TYPOGRAPHY } from '../../constants/typography';
import { MINE } from '../../constants/theme';
import { ArcadeBackButton } from '../../components/ui/ArcadeBackButton';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

export default function SaboteurLayout() {
  const reduceMotion = useReducedMotionPreference();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: MINE.surface },
        headerTintColor: MINE.gold,
        headerTitleStyle: TYPOGRAPHY.navigation,
        contentStyle: { backgroundColor: MINE.bg },
        animation: reduceMotion ? 'none' : 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Saboteur', headerLeft: () => <ArcadeBackButton color={MINE.gold} /> }} />
      <Stack.Screen name="join" options={{ title: 'Join Room' }} />
      <Stack.Screen name="lobby" options={{ title: 'Lobby', headerBackVisible: false }} />
      <Stack.Screen name="game" options={{ headerShown: false }} />
    </Stack>
  );
}
