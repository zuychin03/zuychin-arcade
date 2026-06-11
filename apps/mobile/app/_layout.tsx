import '../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSocket } from '../hooks/useSocket';
import { ARCADE } from '../constants/theme';

export default function RootLayout() {
  // Owns the socket connection for the whole app
  useSocket();

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: ARCADE.bg },
          animation: 'fade_from_bottom',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="saboteur" />
      </Stack>
    </>
  );
}
