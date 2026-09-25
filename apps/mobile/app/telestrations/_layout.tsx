import { Stack } from 'expo-router';
import { TYPOGRAPHY } from '../../constants/typography';
import { ArcadeBackButton } from '../../components/ui/ArcadeBackButton';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { TELESTRATIONS as C } from '../../components/telestrations/palette';
export default function Layout() {
  const reduced = useReducedMotionPreference();
  return <Stack screenOptions={{ headerStyle: { backgroundColor: C.surface }, headerTintColor: C.accent, headerTitleStyle: TYPOGRAPHY.navigation, contentStyle: { backgroundColor: C.bg }, animation: reduced ? 'none' : 'slide_from_right' }}>
    <Stack.Screen name="index" options={{ title: 'Telestrations', headerLeft: () => <ArcadeBackButton color={C.accent} /> }} />
    <Stack.Screen name="join" options={{ title: 'Join a Sketchbook' }} />
    <Stack.Screen name="lobby" options={{ title: 'Waiting Room', headerBackVisible: false }} />
    <Stack.Screen name="game" options={{ headerShown: false }} />
  </Stack>;
}
