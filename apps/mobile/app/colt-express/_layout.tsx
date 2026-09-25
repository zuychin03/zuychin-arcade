import { Stack } from 'expo-router';
import { TYPOGRAPHY } from '../../constants/typography';
import { COLT } from '../../constants/theme';
import { ArcadeBackButton } from '../../components/ui/ArcadeBackButton';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

export default function Layout() {
  const reduceMotion = useReducedMotionPreference();
  return <Stack screenOptions={{ headerStyle: { backgroundColor: COLT.surface }, headerTintColor: COLT.ember, headerTitleStyle: TYPOGRAPHY.navigation, contentStyle: { backgroundColor: COLT.bg }, animation: reduceMotion ? 'none' : 'slide_from_right' }}>
    <Stack.Screen name="index" options={{ title: 'Colt Express', headerLeft: () => <ArcadeBackButton color={COLT.ember} /> }} />
    <Stack.Screen name="join" options={{ title: 'Join Robbery' }} />
    <Stack.Screen name="lobby" options={{ title: 'Waiting Room', headerBackVisible: false }} />
    <Stack.Screen name="game" options={{ headerShown: false }} />
  </Stack>;
}
