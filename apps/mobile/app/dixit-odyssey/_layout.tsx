import { Stack } from 'expo-router';
import { DIXIT } from '../../constants/theme';
import { ArcadeBackButton } from '../../components/ui/ArcadeBackButton';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

export default function Layout() {
  const reduced = useReducedMotionPreference();
  return <Stack screenOptions={{ headerStyle: { backgroundColor: DIXIT.surface }, headerTintColor: DIXIT.accent,
    contentStyle: { backgroundColor: DIXIT.bg }, animation: reduced ? 'none' : 'slide_from_right' }}>
    <Stack.Screen name="index" options={{ title: 'Dixit Odyssey', headerLeft: () => <ArcadeBackButton color={DIXIT.accent} /> }} />
    <Stack.Screen name="join" options={{ title: 'Join a Story' }} />
    <Stack.Screen name="lobby" options={{ title: 'Waiting Room', headerBackVisible: false }} />
    <Stack.Screen name="game" options={{ headerShown: false }} />
  </Stack>;
}
