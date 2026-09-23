import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { GameId, LeaderboardRow } from '@zuychin-arcade/types';
import { ApiError, getLeaderboard } from '../../lib/api';
import { ARCADE, neonText } from '../../constants/theme';
import { NeonButton } from '../../components/ui/NeonButton';

const RANK_COLORS = [ARCADE.pink, ARCADE.purple, ARCADE.blue];

const TABS: { id: GameId; label: string; metric: 'wins' | 'nuggets' | 'points' | 'loot'; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { id: 'saboteur', label: 'Saboteur', metric: 'nuggets', icon: 'pickaxe' },
  { id: 'coup', label: 'Coup', metric: 'wins', icon: 'drama-masks' },
  { id: 'king_of_tokyo', label: 'King of Tokyo', metric: 'wins', icon: 'city-variant-outline' },
  { id: 'skull_king', label: 'Skull King', metric: 'points', icon: 'pirate' },
  { id: 'citadels', label: 'Citadels', metric: 'points', icon: 'castle' },
  { id: 'not_alone', label: 'Not Alone', metric: 'wins', icon: 'alien-outline' },
  { id: 'bang', label: 'BANG!', metric: 'wins', icon: 'pistol' },
  { id: 'libertalia', label: 'Libertalia', metric: 'points', icon: 'ship-wheel' },
  { id: 'colt_express', label: 'Colt Express', metric: 'loot', icon: 'train' },
];

export default function LeaderboardScreen() {
  const [game, setGame] = useState<GameId>('saboteur');
  const [board, setBoard] = useState<{ game: GameId; rows: LeaderboardRow[]; error: string | null; disabled: boolean; loaded: boolean }>({
    game, rows: [], error: null, disabled: false, loaded: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (requestController.current) return;
    const id = ++requestId.current;
    const controller = new AbortController();
    requestController.current = controller;
    setBoard({ game, rows: [], error: null, disabled: false, loaded: false });
    setRefreshing(true);
    try {
      const rows = await getLeaderboard(game, controller.signal);
      if (id === requestId.current) setBoard({ game, rows, error: null, disabled: false, loaded: true });
    } catch (error) {
      if (id === requestId.current) {
        const disabled = error instanceof ApiError && error.status === 503 && error.code === 'RANKINGS_DISABLED';
        setBoard({ game, rows: [], disabled, error: disabled ? null : 'Scores are unavailable right now. Check your connection and retry.', loaded: true });
      }
    } finally {
      if (id === requestId.current) {
        requestController.current = null;
        setRefreshing(false);
      }
    }
  }, [game]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [load]);

  const currentBoard = board.game === game ? board : { rows: [], error: null, disabled: false, loaded: false };
  const selectedGame = TABS.find((tab) => tab.id === game)!;
  const ranksByWins = selectedGame.metric === 'wins';

  return (
    <View className="flex-1 bg-arcade-bg pt-16">
      <Text style={{ textAlign: 'center', fontSize: 24, fontWeight: '900', letterSpacing: 4, ...neonText(ARCADE.cyan, 12) }}>
        HIGH SCORES
      </Text>
      <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, textAlign: 'center', fontSize: 12, marginTop: 4, marginBottom: 12 }}>
        all-time {selectedGame.label} {selectedGame.metric}
      </Text>

      <ScrollView horizontal style={{ flexGrow: 0, flexShrink: 0, marginBottom: 14 }} contentContainerStyle={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 6 }} showsHorizontalScrollIndicator>
        {TABS.map((t) => {
          const active = t.id === game;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: active }}
              aria-pressed={Platform.OS === 'web' ? active : undefined}
              onPress={() => setGame(t.id)}
              style={{
                minHeight: 44,
                justifyContent: 'center',
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
                <Text style={{ fontFamily: 'Outfit_700Bold', color: active ? ARCADE.cyan : ARCADE.muted, fontSize: 14 }}>{t.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
        <NeonButton label={refreshing ? 'LOADING SCORES…' : currentBoard.disabled ? 'CHECK STATUS' : currentBoard.error ? 'RETRY SCORES' : 'REFRESH SCORES'} color={ARCADE.cyan} variant="outline" disabled={refreshing} onPress={() => { void load(); }} />
      </View>

      <FlatList
        data={currentBoard.rows}
        keyExtractor={(r) => r.display_name}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={ARCADE.cyan} />
        }
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        ListEmptyComponent={
          currentBoard.disabled ? <View accessibilityLiveRegion="polite" style={{ alignSelf: 'center', width: '100%', maxWidth: 560, gap: 12, padding: 24, borderRadius: 16, backgroundColor: ARCADE.surface }}>
            <MaterialCommunityIcons name="shield-lock-outline" size={28} color={ARCADE.cyan} />
            <Text accessibilityRole="header" style={{ color: ARCADE.text, fontFamily: 'Outfit_800ExtraBold', fontSize: 22 }}>Rankings disabled</Text>
            <Text style={{ color: ARCADE.text, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 25 }}>Rankings are currently disabled by the administrator.</Text>
            <Text style={{ color: ARCADE.muted, fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 25 }}>You can still create rooms and play games.</Text>
          </View> : <Text accessibilityRole={currentBoard.error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={{ color: currentBoard.error ? ARCADE.text : ARCADE.muted, fontSize: 16, textAlign: 'center', marginTop: 24, lineHeight: 24 }}>
            {currentBoard.error ?? (currentBoard.loaded ? 'No games recorded yet.\nFinish a game to flash your name in neon!' : 'Loading scores…')}
          </Text>
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
                  {item.games_played} games{ranksByWins ? '' : ` · ${item.wins} wins`}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <MaterialCommunityIcons name={ranksByWins ? 'trophy-outline' : selectedGame.metric === 'points' ? 'star-circle-outline' : 'cash-multiple'} size={16} color="#F5C518" />
                  <Text style={{ fontWeight: '800', ...neonText('#F5C518', 6) }}>{ranksByWins ? item.wins : item.total_nuggets}</Text>
                </View>
              </View>
            </Animated.View>
          );
        }}
      />
    </View>
  );
}
