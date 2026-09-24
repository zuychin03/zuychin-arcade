import { Stack } from 'expo-router';
import { ArcadeBackButton } from '../../components/ui/ArcadeBackButton';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { CARTOGRAPHERS as C } from '../../components/cartographers/palette';
export default function Layout() {
  const reduced = useReducedMotionPreference();
  return <Stack screenOptions={{ headerStyle: { backgroundColor: C.surface }, headerTintColor: C.accent, contentStyle: { backgroundColor: C.bg }, animation: reduced ? 'none' : 'slide_from_right' }}>
    <Stack.Screen name="index" options={{ title: 'Cartographers Heroes', headerLeft: () => <ArcadeBackButton color={C.accent} /> }} />
    <Stack.Screen name="join" options={{ title: 'Join a Table' }} />
    <Stack.Screen name="lobby" options={{ title: 'Waiting Room', headerBackVisible: false }} />
    <Stack.Screen name="game" options={{ headerShown: false }} />
  </Stack>;
}
