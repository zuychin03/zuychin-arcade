import '../global.css';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { useSocket } from '../hooks/useSocket';
import { useGameStore } from '../store/useGameStore';
import { clearAuth, loadAuth } from '../lib/storage';
import { isTokenExpired } from '../lib/tokenUtils';
import { ArcadeDialogHost } from '../components/ui/ArcadeDialog';
import { ARCADE } from '../constants/theme';
import { useFonts as useOutfit, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold } from '@expo-google-fonts/outfit';
import { useFonts as useSpaceMono, SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { useReducedMotionPreference } from '../hooks/useReducedMotionPreference';
import PwaControls from '../components/pwa/PwaControls';

type BootShellProps = {
  error?: string;
  onContinue?: () => void;
  onRetry?: () => void;
};

function AppHead() {
  return (
    <Head>
      <title>Zuychin Arcade</title>
      <meta name="application-name" content="Zuychin Arcade" />
      <meta name="apple-mobile-web-app-title" content="Zuychin Arcade" />
      <meta name="description" content="Create a private tabletop room and play social board games with friends on web, iOS and Android." />
      <meta name="theme-color" content={ARCADE.bg} />
      <meta property="og:title" content="Zuychin Arcade" />
      <meta property="og:description" content="Create a private tabletop room and play social board games with friends." />
      <meta property="og:type" content="website" />
    </Head>
  );
}

function BootShell({ error, onContinue, onRetry }: BootShellProps) {
  return (
    <View style={styles.bootShell} accessibilityLiveRegion="polite">
      <AppHead />
      <StatusBar style="light" />
      <Text style={styles.bootBrand}>ZUYCHIN</Text>
      <Text style={styles.bootSubBrand}>ARCADE</Text>
      {error ? (
        <>
          <Text accessibilityRole="alert" style={styles.bootError}>{error}</Text>
          <View style={styles.bootActions}>
            {onRetry ? (
              <Pressable accessibilityRole="button" onPress={onRetry} style={styles.bootButton}>
                <Text style={styles.bootButtonText}>TRY AGAIN</Text>
              </Pressable>
            ) : null}
            {onContinue ? (
              <Pressable accessibilityRole="button" onPress={onContinue} style={[styles.bootButton, styles.bootButtonSecondary]}>
                <Text style={styles.bootButtonText}>CONTINUE WITHOUT SAVED SESSION</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : (
        <>
          <ActivityIndicator color={ARCADE.cyan} size="large" />
          <Text style={styles.bootMessage}>Loading the arcade…</Text>
        </>
      )}
    </View>
  );
}

export default function RootLayout() {
  useSocket();

  const [authRestored, setAuthRestored] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [ignoreFontError, setIgnoreFontError] = useState(false);
  const reduceMotion = useReducedMotionPreference();

  const restoreAuth = useCallback(async () => {
    setAuthRestored(false);
    setAuthError(null);
    try {
      const auth = await loadAuth();
      if (auth && isTokenExpired(auth.token)) {
        await clearAuth();
        return;
      }
      if (auth && !isTokenExpired(auth.token) && !useGameStore.getState().token) {
        useGameStore.getState().setAuth(auth);
      }
    } catch {
      setAuthError('Your saved game session could not be restored. You can retry or continue without it.');
    } finally {
      setAuthRestored(true);
    }
  }, []);

  useEffect(() => {
    void restoreAuth();
  }, [restoreAuth]);

  const continueWithoutAuth = useCallback(() => {
    useGameStore.getState().clearAll();
    void clearAuth().catch(() => undefined);
    setAuthError(null);
  }, []);

  const [outfitLoaded, outfitError] = useOutfit({
    Outfit_400Regular,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
  });

  const [spaceMonoLoaded, spaceMonoError] = useSpaceMono({
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });

  const fontError = outfitError ?? spaceMonoError;
  if (!authRestored || ((!outfitLoaded || !spaceMonoLoaded) && !fontError)) {
    return <BootShell />;
  }
  if (authError) {
    return <BootShell error={authError} onRetry={() => void restoreAuth()} onContinue={continueWithoutAuth} />;
  }
  if (fontError && !ignoreFontError) {
    return (
      <BootShell
        error="The arcade typefaces could not be loaded. You can continue using your system typeface."
        onContinue={() => setIgnoreFontError(true)}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <AppHead />
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: ARCADE.bg },
          animation: reduceMotion ? 'none' : 'fade_from_bottom',
        }}
      >
        <Stack.Screen name="(arcade)" />
        <Stack.Screen name="saboteur" />
        <Stack.Screen name="coup" />
        <Stack.Screen name="king-of-tokyo" />
        <Stack.Screen name="skull-king" />
        <Stack.Screen name="citadels" />
        <Stack.Screen name="not-alone" />
        <Stack.Screen name="bang" />
        <Stack.Screen name="libertalia" />
        <Stack.Screen name="colt-express" />
        <Stack.Screen name="dixit-odyssey" />
        <Stack.Screen name="feed-the-kraken" />
        <Stack.Screen name="telestrations" />
        <Stack.Screen name="cartographers-heroes" />
      </Stack>
      <PwaControls />
      <ArcadeDialogHost />
    </View>
  );
}

const styles = StyleSheet.create({
  bootShell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 28,
    backgroundColor: ARCADE.bg,
  },
  bootBrand: {
    color: ARCADE.text,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 4,
  },
  bootSubBrand: {
    marginBottom: 20,
    color: ARCADE.cyan,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 6,
  },
  bootMessage: {
    color: ARCADE.muted,
    fontSize: 14,
  },
  bootError: {
    maxWidth: 520,
    color: ARCADE.text,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  bootActions: {
    width: '100%',
    maxWidth: 420,
    gap: 10,
    marginTop: 12,
  },
  bootButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ARCADE.cyan,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: ARCADE.surface,
  },
  bootButtonSecondary: {
    borderColor: ARCADE.border,
  },
  bootButtonText: {
    color: ARCADE.text,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
  },
});
