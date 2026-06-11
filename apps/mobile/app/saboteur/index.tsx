import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useGameStore } from '../../store/useGameStore';
import { createRoom } from '../../lib/api';
import { loadDisplayName, saveAuth, saveDisplayName } from '../../lib/storage';
import { showDialog } from '../../lib/dialog';
import { NeonButton } from '../../components/ui/NeonButton';
import { ARCADE, neonText } from '../../constants/theme';

export default function SaboteurLanding() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showCreate, setShowCreate] = useState(false);
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
      const res = await createRoom(displayName, password.trim() || undefined);
      const auth = { token: res.token, playerId: res.playerId, roomCode: res.roomCode, displayName };
      await saveAuth(auth);
      useGameStore.getState().setAuth(auth);
      useGameStore.getState().setRoom(res.room);
      router.push('/saboteur/lobby');
    } catch (err) {
      showDialog('Could not create room', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-arcade-bg" contentContainerStyle={{ padding: 24, gap: 14 }}>
      {/* Hero */}
      <Animated.View entering={FadeInDown.duration(500)} className="items-center py-4">
        <Text style={{ fontSize: 64 }}>⛏️</Text>
        <Text style={{ fontSize: 28, fontWeight: '900', letterSpacing: 3, marginTop: 6, ...neonText(ARCADE.pink, 14) }}>
          SABOTEUR
        </Text>
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, textAlign: 'center', fontSize: 14, lineHeight: 20, marginTop: 8 }}>
          Miners dig for gold. Saboteurs secretly wreck the dig.
          Nobody knows who's who. 3–10 players, 3 rounds.
        </Text>
        <View className="mt-3 flex-row gap-2">
          {['🕵️ hidden roles', '🃏 card game', '🪙 most gold wins'].map((tag) => (
            <View key={tag} className="rounded-full border border-arcade-border bg-arcade-surface px-3 py-1">
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, fontSize: 11 }}>{tag}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Name */}
      <Animated.View entering={FadeInUp.delay(120).springify().damping(16)}>
        <Text style={{ fontFamily: 'SpaceMono_700Bold', color: ARCADE.muted, fontSize: 12, letterSpacing: 2, marginBottom: 8 }}>YOUR NAME</Text>
        <TextInput
          className="rounded-2xl border border-arcade-border bg-arcade-surface px-5 py-4 text-base font-bold text-arcade-text"
          placeholder="e.g. Danny"
          placeholderTextColor={ARCADE.muted}
          maxLength={20}
          value={name}
          onChangeText={setName}
        />
      </Animated.View>

      {/* Create flow */}
      <Animated.View entering={FadeInUp.delay(200).springify().damping(16)} style={{ gap: 12 }}>
        {showCreate && (
          <View>
            <Text style={{ fontFamily: 'SpaceMono_700Bold', color: ARCADE.muted, fontSize: 12, letterSpacing: 2, marginBottom: 8 }}>
              ROOM PASSWORD (OPTIONAL)
            </Text>
            <TextInput
              className="rounded-2xl border border-arcade-border bg-arcade-surface px-5 py-4 text-base text-arcade-text"
              placeholder="leave empty for an open room"
              placeholderTextColor={ARCADE.muted}
              value={password}
              onChangeText={setPassword}
            />
          </View>
        )}
        <NeonButton
          label={busy ? 'CREATING…' : showCreate ? 'CREATE ROOM ✓' : 'CREATE ROOM'}
          color={ARCADE.pink}
          disabled={busy}
          onPress={() => (showCreate ? void onCreate() : setShowCreate(true))}
        />
        <NeonButton
          label="JOIN WITH CODE"
          color={ARCADE.blue}
          variant="outline"
          onPress={() => {
            if (requireName()) router.push('/saboteur/join');
          }}
        />
      </Animated.View>
    </ScrollView>
  );
}
