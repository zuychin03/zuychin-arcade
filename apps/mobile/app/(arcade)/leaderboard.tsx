import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import type { LeaderboardRow } from '@zuychin-arcade/types';
import { getLeaderboard } from '../../lib/api';
import { ARCADE, neonText } from '../../constants/theme';

const RANK_COLORS = [ARCADE.pink, ARCADE.purple, ARCADE.blue];

export default function LeaderboardScreen() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setRows(await getLeaderboard());
    } catch {
      // server offline — show empty state
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View className="flex-1 bg-arcade-bg pt-16">
      <Text style={{ textAlign: 'center', fontSize: 24, fontWeight: '900', letterSpacing: 4, ...neonText(ARCADE.cyan, 12) }}>
        HIGH SCORES
      </Text>
      <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, textAlign: 'center', fontSize: 12, marginTop: 4, marginBottom: 16 }}>
        all-time nuggets across every game
      </Text>
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
                  {item.games_played} games · {item.wins} wins
                </Text>
                <Text style={{ fontWeight: '800', ...neonText('#F5C518', 6) }}>🪙 {item.total_nuggets}</Text>
              </View>
            </Animated.View>
          );
        }}
      />
    </View>
  );
}
