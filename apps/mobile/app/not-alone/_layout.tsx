import { Stack } from 'expo-router';
import { TYPOGRAPHY } from '../../constants/typography';
import { NOT_ALONE } from '../../constants/theme';
import { ArcadeBackButton } from '../../components/ui/ArcadeBackButton';
import { RouteBackButton } from '../../components/ui/RouteBackButton';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

export default function NotAloneLayout() {
  const reduceMotion = useReducedMotionPreference();
  return <Stack screenOptions={{ headerStyle: { backgroundColor: NOT_ALONE.surface }, headerTintColor: NOT_ALONE.signal, headerTitleStyle: TYPOGRAPHY.navigation, contentStyle: { backgroundColor: NOT_ALONE.bg }, animation: reduceMotion ? 'none' : 'slide_from_right' }}>
    <Stack.Screen name="index" options={{ title: 'Not Alone', headerLeft: () => <ArcadeBackButton color={NOT_ALONE.signal} /> }}/>
    <Stack.Screen name="join" options={{ title: 'Join Signal', headerLeft: () => <RouteBackButton color={NOT_ALONE.signal} href="/not-alone" label="Back to Not Alone" hint="Returns to Not Alone room creation" /> }}/>
    <Stack.Screen name="lobby" options={{ title: 'Waiting Room', headerBackVisible: false }}/>
    <Stack.Screen name="game" options={{ headerShown: false }}/>
  </Stack>;
}
