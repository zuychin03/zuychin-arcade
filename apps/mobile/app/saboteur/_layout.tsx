import { Stack } from 'expo-router';
import { ARCADE } from '../../constants/theme';

export default function SaboteurLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: ARCADE.surface },
        headerTintColor: ARCADE.pink,
        headerTitleStyle: { fontWeight: '800' },
        contentStyle: { backgroundColor: ARCADE.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'SABOTEUR' }} />
      <Stack.Screen name="join" options={{ title: 'Join Room' }} />
      <Stack.Screen name="lobby" options={{ title: 'Lobby', headerBackVisible: false }} />
      <Stack.Screen name="game" options={{ headerShown: false }} />
    </Stack>
  );
}
