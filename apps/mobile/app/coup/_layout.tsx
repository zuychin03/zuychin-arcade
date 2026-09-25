import { Stack } from 'expo-router';
import { TYPOGRAPHY } from '../../constants/typography';
import { COUP } from '../../constants/theme';
import { ArcadeBackButton } from '../../components/ui/ArcadeBackButton';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

export default function CoupLayout() {
  const reduceMotion = useReducedMotionPreference();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COUP.surface },
        headerTintColor: COUP.crimson,
        headerTitleStyle: TYPOGRAPHY.navigation,
        contentStyle: { backgroundColor: COUP.bg },
        animation: reduceMotion ? 'none' : 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Coup', headerLeft: () => <ArcadeBackButton color={COUP.crimson} /> }} />
      <Stack.Screen name="join" options={{ title: 'Join Room' }} />
      <Stack.Screen name="lobby" options={{ title: 'Lobby', headerBackVisible: false }} />
      <Stack.Screen name="game" options={{ headerShown: false }} />
    </Stack>
  );
}
