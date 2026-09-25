import { Stack } from 'expo-router';
import { TYPOGRAPHY } from '../../constants/typography';
import { BANG } from '../../constants/theme';
import { ArcadeBackButton } from '../../components/ui/ArcadeBackButton';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

export default function Layout() {
  const reduceMotion = useReducedMotionPreference();
  return <Stack screenOptions={{ headerStyle: { backgroundColor: BANG.surface }, headerTintColor: BANG.gold, headerTitleStyle: TYPOGRAPHY.navigation, contentStyle: { backgroundColor: BANG.bg }, animation: reduceMotion ? 'none' : 'slide_from_right' }}>
    <Stack.Screen name="index" options={{ title: 'BANG!', headerLeft: () => <ArcadeBackButton color={BANG.gold} /> }} />
    <Stack.Screen name="join" options={{ title: 'Join Shootout' }} />
    <Stack.Screen name="lobby" options={{ title: 'Waiting Room', headerBackVisible: false }} />
    <Stack.Screen name="game" options={{ headerShown: false }} />
  </Stack>;
}
