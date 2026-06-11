import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useGameStore } from '../../store/useGameStore';
import { getRoom, joinRoom } from '../../lib/api';
import { loadDisplayName, saveAuth } from '../../lib/storage';
import { showDialog } from '../../lib/dialog';
import { NeonButton } from '../../components/ui/NeonButton';
import { ARCADE } from '../../constants/theme';

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
    if (!roomCode) return showDialog('Enter a room code');
    setBusy(true);
    try {
      const displayName = (await loadDisplayName()) ?? 'Player';
      const res = await joinRoom(roomCode, displayName, password || undefined);
      const auth = { token: res.token, playerId: res.playerId, roomCode: res.roomCode, displayName };
      await saveAuth(auth);
      useGameStore.getState().setAuth(auth);
      useGameStore.getState().setRoom(res.room);
      router.replace('/saboteur/lobby');
    } catch (err) {
      showDialog('Could not join', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-arcade-bg px-8 pt-10">
      <Animated.View entering={FadeInDown.duration(400)}>
        <Text style={{ fontFamily: 'SpaceMono_700Bold', color: ARCADE.muted, fontSize: 12, letterSpacing: 2, marginBottom: 8 }}>ROOM CODE</Text>
        <TextInput
          className="rounded-2xl border-2 border-arcade-blue bg-arcade-surface px-4 py-4 text-center text-3xl font-black tracking-widest text-arcade-cyan"
          style={{ boxShadow: `0 0 12px ${ARCADE.blue}44` }}
          placeholder="GOLD-42"
          placeholderTextColor={ARCADE.border}
          autoCapitalize="characters"
          autoCorrect={false}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
        />
      </Animated.View>

      {needsPassword && (
        <Animated.View entering={FadeInUp.springify().damping(16)}>
          <Text style={{ fontFamily: 'SpaceMono_700Bold', color: ARCADE.muted, fontSize: 12, letterSpacing: 2, marginTop: 20, marginBottom: 8 }}>
            ROOM PASSWORD (OPTIONAL)
          </Text>
          <TextInput
            className="rounded-2xl border border-arcade-border bg-arcade-surface px-5 py-4 text-base text-arcade-text"
            placeholder="room password"
            placeholderTextColor={ARCADE.muted}
            value={password}
            onChangeText={setPassword}
          />
        </Animated.View>
      )}

      <View className="mt-6">
        <NeonButton
          label={busy ? 'JOINING…' : 'JOIN GAME'}
          color={ARCADE.blue}
          disabled={busy}
          onPress={() => void onJoin()}
        />
      </View>
    </View>
  );
}
