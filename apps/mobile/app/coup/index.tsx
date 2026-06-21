import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useGameStore } from '../../store/useGameStore';
import { createRoom } from '../../lib/api';
import { loadDisplayName, saveAuth, saveDisplayName } from '../../lib/storage';
import { showDialog } from '../../lib/dialog';
import { NeonButton } from '../../components/ui/NeonButton';
import { COUP, neonText } from '../../constants/theme';

export default function CoupLanding() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadDisplayName().then((n) => n && setName(n));
  }, []);

  const requireName = (): string | null => {
    const displayName = name.trim();
    if (!displayName) {
      showDialog('Enter your name first');
      return null;
    }
    void saveDisplayName(displayName);
    return displayName;
  };

  const onCreate = async () => {
    const displayName = requireName();
    if (!displayName) return;
    setBusy(true);
    try {
      const res = await createRoom(displayName, password.trim() || undefined, 'coup');
      const auth = { token: res.token, playerId: res.playerId, roomCode: res.roomCode, displayName };
      await saveAuth(auth);
      useGameStore.getState().setAuth(auth);
      useGameStore.getState().setRoom(res.room);
      router.push('/coup/lobby');
    } catch (err) {
      showDialog('Could not create room', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-coup-bg" contentContainerStyle={{ padding: 24, gap: 14 }}>
      <Animated.View entering={FadeInDown.duration(500)} className="items-center py-4">
        <Text style={{ fontSize: 64 }}>🎭</Text>
        <Text style={{ fontSize: 30, fontFamily: 'Outfit_800ExtraBold', letterSpacing: 4, marginTop: 6, ...neonText(COUP.crimson, 14) }}>
          COUP
        </Text>
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, marginTop: 8, textAlign: 'center', fontSize: 13, lineHeight: 20 }}>
          Lie, bluff and bribe your way to power.{'\n'}
          Last player with influence wins. 2–6 players.
        </Text>
        <View className="mt-3 flex-row gap-2">
          {['🗡️ bluff', '🔍 challenge', '👑 backstab'].map((tag) => (
            <View key={tag} className="rounded-full border border-coup-border bg-coup-surface px-3 py-1">
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: COUP.muted, fontSize: 11 }}>{tag}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(120).springify().damping(16)}>
        <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.muted, fontSize: 12, letterSpacing: 2, marginBottom: 8 }}>YOUR NAME</Text>
        <TextInput
          className="rounded-2xl border border-coup-border bg-coup-surface px-5 py-4 text-base text-coup-text"
          style={{ fontFamily: 'Outfit_700Bold' }}
          placeholder="e.g. Danny"
          placeholderTextColor={COUP.muted}
          maxLength={20}
          value={name}
          onChangeText={setName}
        />

        <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.muted, fontSize: 12, letterSpacing: 2, marginTop: 18, marginBottom: 8 }}>
          ROOM PASSWORD (OPTIONAL)
        </Text>
        <TextInput
          className="rounded-2xl border border-coup-border bg-coup-surface px-5 py-4 text-base text-coup-text"
          style={{ fontFamily: 'Outfit_700Bold' }}
          placeholder="leave blank for none"
          placeholderTextColor={COUP.muted}
          value={password}
          onChangeText={setPassword}
        />
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(220).springify().damping(16)} style={{ gap: 10, marginTop: 8 }}>
        <NeonButton label={busy ? 'CREATING…' : '＋ CREATE ROOM'} color={COUP.crimson} disabled={busy} onPress={() => void onCreate()} />
        <NeonButton label="JOIN WITH CODE" color={COUP.blue} variant="outline" onPress={() => router.push('/coup/join')} />
      </Animated.View>
    </ScrollView>
  );
}
