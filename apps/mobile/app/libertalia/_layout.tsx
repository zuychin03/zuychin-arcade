import { Stack } from 'expo-router';
import { TYPOGRAPHY } from '../../constants/typography';
import { LIBERTALIA } from '../../constants/theme';
import { ArcadeBackButton } from '../../components/ui/ArcadeBackButton';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

export default function Layout() {
  const reduceMotion = useReducedMotionPreference();
  return <Stack screenOptions={{ headerStyle: { backgroundColor: LIBERTALIA.surface }, headerTintColor: LIBERTALIA.sky, headerTitleStyle: TYPOGRAPHY.navigation, contentStyle: { backgroundColor: LIBERTALIA.bg }, animation: reduceMotion ? 'none' : 'slide_from_right' }}>
    <Stack.Screen name="index" options={{ title: 'Libertalia', headerLeft: () => <ArcadeBackButton color={LIBERTALIA.sky} /> }} />
    <Stack.Screen name="join" options={{ title: 'Join Fleet' }} />
    <Stack.Screen name="lobby" options={{ title: 'Waiting Room', headerBackVisible: false }} />
    <Stack.Screen name="game" options={{ headerShown: false }} />
  </Stack>;
}
