import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import type { LeaderboardRow } from '@zuychin-arcade/types';
import { getLeaderboard } from '../lib/api';

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
    <View className="flex-1 bg-mine-bg">
      <FlatList
        data={rows}
        keyExtractor={(r) => r.display_name}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor="#F5C518" />}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <View className="mb-2 flex-row px-3">
            <Text className="w-8 text-xs text-mine-stone">#</Text>
            <Text className="flex-1 text-xs text-mine-stone">Player</Text>
            <Text className="w-14 text-right text-xs text-mine-stone">Games</Text>
            <Text className="w-12 text-right text-xs text-mine-stone">Wins</Text>
            <Text className="w-14 text-right text-xs text-mine-stone">🪙</Text>
          </View>
        }
        ListEmptyComponent={
          loaded ? (
            <Text className="mt-10 text-center text-mine-stone">
              No games recorded yet. Finish a game to appear here!
            </Text>
          ) : null
        }
        renderItem={({ item, index }) => (
          <View className="mb-1 flex-row items-center rounded-lg bg-mine-surface px-3 py-2.5">
            <Text className="w-8 font-bold text-mine-gold">{index + 1}</Text>
            <Text className="flex-1 text-white">{item.display_name}</Text>
            <Text className="w-14 text-right text-mine-stone">{item.games_played}</Text>
            <Text className="w-12 text-right text-mine-stone">{item.wins}</Text>
            <Text className="w-14 text-right font-semibold text-mine-gold">{item.total_nuggets}</Text>
          </View>
        )}
      />
    </View>
  );
}
