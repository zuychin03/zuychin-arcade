import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useGameStore } from '../store/useGameStore';
import { createRoom, getRoom } from '../lib/api';
import { isTokenExpired } from '../lib/tokenUtils';
import { clearAuth, loadAuth, loadDisplayName, saveAuth, saveDisplayName } from '../lib/storage';

export default function HomeScreen() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const setAuth = useGameStore((s) => s.setAuth);
  const setRoom = useGameStore((s) => s.setRoom);

  // Restore a previous session: valid token + room still alive → rejoin
  useEffect(() => {
    void (async () => {
      const savedName = await loadDisplayName();
      if (savedName) setName(savedName);
      const auth = await loadAuth();
      if (auth && !isTokenExpired(auth.token)) {
        try {
          const room = await getRoom(auth.roomCode);
          if (room.players.some((p) => p.playerId === auth.playerId)) {
            setAuth(auth);
            setRoom(room);
            router.replace(room.status === 'in_game' ? '/game' : '/lobby');
            return;
          }
        } catch {
          // room is gone — fall through to home
        }
      }
      await clearAuth();
      setRestoring(false);
    })();
  }, [setAuth, setRoom]);

  const onCreate = async () => {
    const displayName = name.trim();
    if (!displayName) return Alert.alert('Enter your name first');
    setBusy(true);
    try {
      await saveDisplayName(displayName);
      const res = await createRoom(displayName, password.trim() || undefined);
      const auth = {
        token: res.token,
        playerId: res.playerId,
        roomCode: res.roomCode,
        displayName,
      };
      await saveAuth(auth);
      useGameStore.getState().setAuth(auth);
      useGameStore.getState().setRoom(res.room);
      router.push('/lobby');
    } catch (err) {
      Alert.alert('Could not create room', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  if (restoring) {
    return (
      <View className="flex-1 items-center justify-center bg-mine-bg">
        <ActivityIndicator color="#F5C518" size="large" />
      </View>
    );
  }

  return (
    <View className="flex-1 justify-center bg-mine-bg px-8">
      <Text className="text-center text-5xl">⛏️</Text>
      <Text className="mt-2 text-center text-3xl font-extrabold tracking-wide text-mine-gold">
        zuychin-arcade
      </Text>
      <Text className="mb-10 mt-1 text-center text-mine-stone">Saboteur — dig or deceive</Text>

      <Text className="mb-1 text-sm text-mine-stone">Your name</Text>
      <TextInput
        className="rounded-xl bg-mine-surface px-4 py-3 text-base text-white"
        placeholder="e.g. Danny"
        placeholderTextColor="#6B7280"
        maxLength={20}
        value={name}
        onChangeText={setName}
      />

      {showPassword && (
        <>
          <Text className="mb-1 mt-3 text-sm text-mine-stone">Room password (optional)</Text>
          <TextInput
            className="rounded-xl bg-mine-surface px-4 py-3 text-base text-white"
            placeholder="leave empty for open room"
            placeholderTextColor="#6B7280"
            value={password}
            onChangeText={setPassword}
          />
        </>
      )}

      <Pressable
        className="mt-6 items-center rounded-xl bg-mine-gold py-4 active:opacity-80"
        disabled={busy}
        onPress={() => (showPassword ? void onCreate() : setShowPassword(true))}
      >
        <Text className="text-lg font-bold text-mine-bg">
          {busy ? 'Creating…' : showPassword ? 'Create Room ✓' : 'Create Room'}
        </Text>
      </Pressable>

      <Pressable
        className="mt-3 items-center rounded-xl border border-mine-gold py-4 active:opacity-80"
        onPress={() => {
          if (!name.trim()) return Alert.alert('Enter your name first');
          void saveDisplayName(name.trim());
          router.push('/join');
        }}
      >
        <Text className="text-lg font-bold text-mine-gold">Join Room</Text>
      </Pressable>

      <Link href="/leaderboard" asChild>
        <Pressable className="mt-8 items-center">
          <Text className="text-mine-stone underline">🏆 Leaderboard</Text>
        </Pressable>
      </Link>
    </View>
  );
}
