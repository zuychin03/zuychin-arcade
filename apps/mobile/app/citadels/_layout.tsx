import { Stack } from 'expo-router';
import { TYPOGRAPHY } from '../../constants/typography';
import { CITADELS } from '../../constants/theme';
import { ArcadeBackButton } from '../../components/ui/ArcadeBackButton';
import { RouteBackButton } from '../../components/ui/RouteBackButton';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

export default function CitadelsLayout() {
  const reduceMotion = useReducedMotionPreference();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: CITADELS.surface },
        headerTintColor: CITADELS.royal,
        headerTitleStyle: TYPOGRAPHY.navigation,
        contentStyle: { backgroundColor: CITADELS.bg },
        animation: reduceMotion ? 'none' : 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Citadels', headerLeft: () => <ArcadeBackButton color={CITADELS.royal} /> }} />
      <Stack.Screen name="join" options={{ title: 'Join Room', headerLeft: () => <RouteBackButton color={CITADELS.royal} href="/citadels" label="Back to Citadels" hint="Returns to Citadels room creation" /> }} />
      <Stack.Screen name="lobby" options={{ title: 'Waiting Room', headerBackVisible: false }} />
      <Stack.Screen name="game" options={{ headerShown: false }} />
    </Stack>
  );
}
