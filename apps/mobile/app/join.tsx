import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useGameStore } from '../store/useGameStore';
import { getRoom, joinRoom } from '../lib/api';
import { loadDisplayName, saveAuth } from '../lib/storage';

export default function JoinScreen() {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  // Auto-uppercase and check whether the room needs a password
  useEffect(() => {
    const trimmed = code.trim();
    if (!/^[A-Z]+-\d{2}$/.test(trimmed)) {
      setNeedsPassword(false);
      return;
    }
    let cancelled = false;
    void getRoom(trimmed)
      .then((room) => !cancelled && setNeedsPassword(room.hasPassword))
      .catch(() => !cancelled && setNeedsPassword(false));
    return () => {
      cancelled = true;
    };
  }, [code]);

  const onJoin = async () => {
    const roomCode = code.trim().toUpperCase();
    if (!roomCode) return Alert.alert('Enter a room code');
    setBusy(true);
    try {
      const displayName = (await loadDisplayName()) ?? 'Player';
      const res = await joinRoom(roomCode, displayName, password || undefined);
      const auth = {
        token: res.token,
        playerId: res.playerId,
        roomCode: res.roomCode,
        displayName,
      };
      await saveAuth(auth);
      useGameStore.getState().setAuth(auth);
      useGameStore.getState().setRoom(res.room);
      router.replace('/lobby');
    } catch (err) {
      Alert.alert('Could not join', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-mine-bg px-8 pt-10">
      <Text className="mb-1 text-sm text-mine-stone">Room code</Text>
      <TextInput
        className="rounded-xl bg-mine-surface px-4 py-3 text-center text-2xl font-bold tracking-widest text-mine-gold"
        placeholder="GOLD-42"
        placeholderTextColor="#6B7280"
        autoCapitalize="characters"
        autoCorrect={false}
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
      />

      {needsPassword && (
        <>
          <Text className="mb-1 mt-4 text-sm text-mine-stone">Password</Text>
          <TextInput
            className="rounded-xl bg-mine-surface px-4 py-3 text-base text-white"
            placeholder="room password"
            placeholderTextColor="#6B7280"
            value={password}
            onChangeText={setPassword}
          />
        </>
      )}

      <Pressable
        className="mt-6 items-center rounded-xl bg-mine-gold py-4 active:opacity-80"
        disabled={busy}
        onPress={() => void onJoin()}
      >
        <Text className="text-lg font-bold text-mine-bg">{busy ? 'Joining…' : 'Join Game'}</Text>
      </Pressable>
    </View>
  );
}
