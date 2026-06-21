import '../global.css';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSocket } from '../hooks/useSocket';
import { useGameStore } from '../store/useGameStore';
import { loadAuth } from '../lib/storage';
import { isTokenExpired } from '../lib/tokenUtils';
import { ArcadeDialogHost } from '../components/ui/ArcadeDialog';
import { ARCADE } from '../constants/theme';
import { useFonts as useOutfit, Outfit_400Regular, Outfit_700Bold, Outfit_800ExtraBold } from '@expo-google-fonts/outfit';
import { useFonts as useSpaceMono, SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';

export default function RootLayout() {
  // Owns the socket connection for the whole app
  useSocket();

  // Rehydrate auth before any route renders — a web refresh can land directly
  // on /saboteur/game, where the socket needs the token to restore the session.
  const [authRestored, setAuthRestored] = useState(false);
  useEffect(() => {
    void loadAuth().then((auth) => {
      if (auth && !isTokenExpired(auth.token) && !useGameStore.getState().token) {
        useGameStore.getState().setAuth(auth);
      }
      setAuthRestored(true);
    });
  }, []);

  const [outfitLoaded] = useOutfit({
    Outfit_400Regular,
    Outfit_700Bold,
    Outfit_800ExtraBold,
  });

  const [spaceMonoLoaded] = useSpaceMono({
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });

  if (!outfitLoaded || !spaceMonoLoaded || !authRestored) return null;

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: ARCADE.bg },
          animation: 'fade_from_bottom',
        }}
      >
        <Stack.Screen name="(arcade)" />
        <Stack.Screen name="saboteur" />
        <Stack.Screen name="coup" />
      </Stack>
      <ArcadeDialogHost />
    </View>
  );
}
