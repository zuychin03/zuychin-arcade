import { Stack } from 'expo-router';
import { TYPOGRAPHY } from '../../constants/typography';
import { SKULL_KING } from '../../constants/theme';
import { ArcadeBackButton } from '../../components/ui/ArcadeBackButton';
import { RouteBackButton } from '../../components/ui/RouteBackButton';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

export default function SkullKingLayout() {
  const reduceMotion = useReducedMotionPreference();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: SKULL_KING.surface },
        headerTintColor: SKULL_KING.teal,
        headerTitleStyle: TYPOGRAPHY.navigation,
        contentStyle: { backgroundColor: SKULL_KING.bg },
        animation: reduceMotion ? 'none' : 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Skull King', headerLeft: () => <ArcadeBackButton color={SKULL_KING.teal} /> }} />
      <Stack.Screen name="join" options={{ title: 'Join Room', headerLeft: () => <RouteBackButton color={SKULL_KING.teal} href="/skull-king" label="Back to Skull King" hint="Returns to the Skull King setup screen" /> }} />
      <Stack.Screen name="lobby" options={{ title: 'Waiting Room', headerBackVisible: false }} />
      <Stack.Screen name="game" options={{ headerShown: false }} />
    </Stack>
  );
}
