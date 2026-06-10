import '../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSocket } from '../hooks/useSocket';

export default function RootLayout() {
  // Owns the socket connection for the whole app
  useSocket();

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1A1208' },
          headerTintColor: '#F5C518',
          contentStyle: { backgroundColor: '#1A1208' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'zuychin-arcade', headerShown: false }} />
        <Stack.Screen name="join" options={{ title: 'Join Room' }} />
        <Stack.Screen name="lobby" options={{ title: 'Lobby', headerBackVisible: false }} />
        <Stack.Screen name="game" options={{ headerShown: false }} />
        <Stack.Screen name="leaderboard" options={{ title: 'Leaderboard' }} />
      </Stack>
    </>
  );
}
