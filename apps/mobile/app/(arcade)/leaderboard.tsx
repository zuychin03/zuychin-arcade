import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { GameId, LeaderboardRow } from '@zuychin-arcade/types';
import { getLeaderboard } from '../../lib/api';
import { ARCADE, neonText } from '../../constants/theme';

const RANK_COLORS = [ARCADE.pink, ARCADE.purple, ARCADE.blue];

const TABS: Array<{ id: GameId; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }> = [
  { id: 'saboteur', label: 'Saboteur', icon: 'pickaxe' },
  { id: 'coup', label: 'Coup', icon: 'drama-masks' },
];

export default function LeaderboardScreen() {
  const [game, setGame] = useState<GameId>('saboteur');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setRows(await getLeaderboard(game));
    } catch {
      // server offline — show empty state
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [game]);

  useEffect(() => {
    void load();
  }, [load]);

  const isCoup = game === 'coup';

  return (
    <View className="flex-1 bg-arcade-bg pt-16">
      <Text style={{ textAlign: 'center', fontSize: 24, fontWeight: '900', letterSpacing: 4, ...neonText(ARCADE.cyan, 12) }}>
        HIGH SCORES
      </Text>
      <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, textAlign: 'center', fontSize: 12, marginTop: 4, marginBottom: 12 }}>
        {isCoup ? 'all-time Coup wins' : 'all-time Saboteur nuggets'}
      </Text>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 14 }}>
        {TABS.map((t) => {
          const active = t.id === game;
          return (
            <Pressable
              key={t.id}
              onPress={() => setGame(t.id)}
              style={{
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: active ? ARCADE.cyan : ARCADE.border,
                backgroundColor: active ? ARCADE.surface : 'transparent',
                paddingHorizontal: 16,
                paddingVertical: 7,
                boxShadow: active ? `0 0 10px ${ARCADE.cyan}55` : undefined,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialCommunityIcons name={t.icon} size={15} color={active ? ARCADE.cyan : ARCADE.muted} />
                <Text style={{ fontFamily: 'Outfit_700Bold', color: active ? ARCADE.cyan : ARCADE.muted, fontSize: 13 }}>{t.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.display_name}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={ARCADE.cyan} />
        }
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        ListEmptyComponent={
          loaded ? (
            <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, textAlign: 'center', marginTop: 40, lineHeight: 20 }}>
              No games recorded yet.{'\n'}Finish a game to flash your name in neon!
            </Text>
          ) : null
        }
        renderItem={({ item, index }) => {
          const accent = RANK_COLORS[index] ?? ARCADE.border;
          return (
            <Animated.View
              entering={FadeInUp.delay(Math.min(index, 10) * 60).springify().damping(18)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 8,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: accent,
                backgroundColor: ARCADE.surface,
                paddingHorizontal: 14,
                paddingVertical: 12,
                boxShadow: index < 3 ? `0 0 10px ${accent}55` : undefined,
              }}
            >
              <Text style={{ width: 36, fontSize: 16, fontWeight: '900', ...(index < 3 ? neonText(accent, 8) : { color: ARCADE.muted }) }}>
                {index + 1}
              </Text>
              <Text style={{ flex: 1, color: ARCADE.text, fontWeight: '600' }}>{item.display_name}</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: ARCADE.muted, fontSize: 11 }}>
                  {item.games_played} games{isCoup ? '' : ` · ${item.wins} wins`}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <MaterialCommunityIcons name={isCoup ? 'trophy-outline' : 'cash-multiple'} size={16} color="#F5C518" />
                  <Text style={{ fontWeight: '800', ...neonText('#F5C518', 6) }}>{isCoup ? item.wins : item.total_nuggets}</Text>
                </View>
              </View>
            </Animated.View>
          );
        }}
      />
    </View>
  );
}
