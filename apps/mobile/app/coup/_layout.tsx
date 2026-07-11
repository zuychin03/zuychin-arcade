import { Stack } from 'expo-router';
import { COUP } from '../../constants/theme';

export default function CoupLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COUP.surface },
        headerTintColor: COUP.crimson,
        headerTitleStyle: { fontWeight: '800' },
        contentStyle: { backgroundColor: COUP.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'COUP' }} />
      <Stack.Screen name="join" options={{ title: 'Join Room' }} />
      <Stack.Screen name="lobby" options={{ title: 'Lobby', headerBackVisible: false }} />
      <Stack.Screen name="game" options={{ headerShown: false }} />
    </Stack>
  );
}
