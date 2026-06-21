import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useGameStore } from '../../store/useGameStore';
import { getRoom, joinRoom } from '../../lib/api';
import { loadDisplayName, saveAuth } from '../../lib/storage';
import { showDialog } from '../../lib/dialog';
import { NeonButton } from '../../components/ui/NeonButton';
import { COUP } from '../../constants/theme';

export default function CoupJoinScreen() {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [busy, setBusy] = useState(false);

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
      // Route by the room's actual game so a mis-pasted code still lands right.
      router.replace(res.room.gameId === 'coup' ? '/coup/lobby' : '/saboteur/lobby');
    } catch (err) {
      showDialog('Could not join', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-coup-bg px-8 pt-10">
      <Animated.View entering={FadeInDown.duration(400)}>
        <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.muted, fontSize: 12, letterSpacing: 2, marginBottom: 8 }}>ROOM CODE</Text>
        <TextInput
          className="rounded-2xl border-2 border-coup-blue bg-coup-surface px-4 py-4 text-center text-3xl text-coup-gold"
          style={{ fontFamily: 'Outfit_800ExtraBold', letterSpacing: 4, boxShadow: `0 0 12px ${COUP.blue}44` }}
          placeholder="GOLD-42"
          placeholderTextColor={COUP.border}
          autoCapitalize="characters"
          autoCorrect={false}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
        />
      </Animated.View>

      {needsPassword && (
        <Animated.View entering={FadeInUp.springify().damping(16)}>
          <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.muted, fontSize: 12, letterSpacing: 2, marginTop: 20, marginBottom: 8 }}>
            ROOM PASSWORD
          </Text>
          <TextInput
            className="rounded-2xl border border-coup-border bg-coup-surface px-5 py-4 text-base text-coup-text"
            style={{ fontFamily: 'Outfit_700Bold' }}
            placeholder="room password"
            placeholderTextColor={COUP.muted}
            value={password}
            onChangeText={setPassword}
          />
        </Animated.View>
      )}

      <View className="mt-6">
        <NeonButton label={busy ? 'JOINING…' : 'JOIN GAME'} color={COUP.blue} disabled={busy} onPress={() => void onJoin()} />
      </View>
    </View>
  );
}
