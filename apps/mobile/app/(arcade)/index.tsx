import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useGameStore } from '../../store/useGameStore';
import { getRoom } from '../../lib/api';
import { isTokenExpired } from '../../lib/tokenUtils';
import { clearAuth, loadAuth } from '../../lib/storage';
import { GameTile } from '../../components/ui/GameTile';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { ARCADE, neonText } from '../../constants/theme';

export default function ArcadeHub() {
  const [restoring, setRestoring] = useState(true);
  const roomCode = useGameStore((s) => s.roomCode);
  const room = useGameStore((s) => s.room);

  // Restore a previous session: valid token + room still alive → offer resume
  useEffect(() => {
    void (async () => {
      const auth = await loadAuth();
      if (auth && !isTokenExpired(auth.token)) {
        try {
          const liveRoom = await getRoom(auth.roomCode);
          if (liveRoom.players.some((p) => p.playerId === auth.playerId)) {
            useGameStore.getState().setAuth(auth);
            useGameStore.getState().setRoom(liveRoom);
            setRestoring(false);
            return;
          }
        } catch {
          // room is gone
        }
        await clearAuth();
      }
      setRestoring(false);
    })();
  }, []);

  const hasSession = !restoring && roomCode && room;

  return (
    <ScrollView
      className="flex-1 bg-arcade-bg"
      contentContainerStyle={{ padding: 20, paddingTop: 64, gap: 14 }}
    >
      <Animated.View entering={FadeIn.duration(600)} className="mb-6">
        <Text style={{
          fontSize: 32,
          fontFamily: 'Outfit_800ExtraBold',
          letterSpacing: 2,
          ...neonText(ARCADE.pink, 12),
          color: ARCADE.text
        }}>
          READY TO PLAY?
        </Text>
        <Text style={{
          fontSize: 14,
          fontFamily: 'SpaceMono_400Regular',
          color: ARCADE.cyan,
          marginTop: 4,
          letterSpacing: 0.5
        }}>
          Choose a gamespace to start playing
        </Text>
      </Animated.View>

      {/* Resume banner when a session is alive */}
      {hasSession && (
        <Animated.View entering={FadeInDown.springify().damping(16)}>
          <ScalePressable
            onPress={() => router.push(room.status === 'in_game' ? '/saboteur/game' : '/saboteur/lobby')}
            style={{
              borderRadius: 16,
              borderWidth: 1.5,
              borderColor: ARCADE.cyan,
              backgroundColor: ARCADE.panel,
              padding: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              boxShadow: `0 0 14px ${ARCADE.cyan}55`,
            }}
          >
            <Text style={{ fontSize: 26 }}>⏯️</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Outfit_800ExtraBold', ...neonText(ARCADE.cyan, 8) }}>
                {room.status === 'in_game' ? 'Game in progress' : 'Back to lobby'}
              </Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, fontSize: 12, marginTop: 2 }}>
                Room {roomCode} · tap to rejoin
              </Text>
            </View>
            <Text style={{ color: ARCADE.cyan, fontSize: 20 }}>▶</Text>
          </ScalePressable>
        </Animated.View>
      )}

      <Text
        style={{
          color: ARCADE.muted,
          fontSize: 12,
          fontFamily: 'Outfit_700Bold',
          letterSpacing: 3,
          marginTop: 8,
        }}
      >
        GAME LIBRARY
      </Text>

      <GameTile
        index={0}
        title="SABOTEUR"
        emoji="⛏️"
        subtitle="3–10 players · hidden roles · dig for gold or sabotage the dig"
        accent={ARCADE.pink}
        onPress={() => router.push('/saboteur')}
      />
      <GameTile
        index={1}
        title="COMING SOON"
        emoji="🎲"
        subtitle="The next gamespace is being wired up…"
        accent={ARCADE.purple}
        locked
      />
      <GameTile
        index={2}
        title="COMING SOON"
        emoji="🃏"
        subtitle="The next gamespace is being wired up…"
        accent={ARCADE.blue}
        locked
      />
    </ScrollView>
  );
}
