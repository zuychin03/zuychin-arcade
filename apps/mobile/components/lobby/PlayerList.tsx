import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInLeft } from 'react-native-reanimated';
import type { Player } from '@zuychin-arcade/types';
import { ARCADE } from '../../constants/theme';

interface Props {
  players: Player[];
  maxPlayers: number;
  canKick: boolean;
  onKick: (playerId: string) => void;
}

export function PlayerList({ players, maxPlayers, canKick, onKick }: Props) {
  return (
    <View className="rounded-2xl border border-arcade-border bg-arcade-surface p-4">
      <Text className="mb-2 text-xs font-bold tracking-widest text-arcade-muted">
        PLAYERS ({players.length}/{maxPlayers})
      </Text>
      {players.map((p, i) => (
        <Animated.View
          key={p.playerId}
          entering={FadeInLeft.delay(i * 60).springify().damping(18)}
          className="flex-row items-center justify-between py-2"
        >
          <Text className={`text-base ${p.isConnected ? 'text-arcade-text' : 'text-arcade-muted'}`}>
            {p.isHost ? '👑 ' : p.isConnected ? '🟢 ' : '⚪ '}
            {p.displayName}
            {!p.isConnected ? ' (offline)' : ''}
          </Text>
          {canKick && !p.isHost && (
            <Pressable
              className="rounded-lg px-2.5 py-1"
              style={{ borderWidth: 1, borderColor: ARCADE.red }}
              onPress={() => onKick(p.playerId)}
            >
              <Text style={{ color: ARCADE.red, fontWeight: '800' }}>✕</Text>
            </Pressable>
          )}
        </Animated.View>
      ))}
    </View>
  );
}
