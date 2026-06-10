import { Pressable, Text, View } from 'react-native';
import type { SaboteurPublicState } from '@zuychin-arcade/types';

interface Props {
  state: SaboteurPublicState;
  isHost: boolean;
  onPlayAgain: () => void;
  onLeave: () => void;
}

export function GameOverOverlay({ state, isHost, onPlayAgain, onLeave }: Props) {
  const ranked = [...state.players].sort((a, b) => b.goldCollected - a.goldCollected);
  const winners = new Set(state.winnerIds ?? []);

  return (
    <View className="absolute inset-0 z-50 items-center justify-center bg-black/95 px-6">
      <Text style={{ fontSize: 56 }}>🏆</Text>
      <Text className="my-2 text-3xl font-extrabold text-mine-gold">GAME OVER</Text>

      <View className="w-full rounded-xl bg-mine-surface p-4">
        {ranked.map((p, i) => (
          <View key={p.playerId} className="flex-row items-center justify-between py-1.5">
            <Text className={`text-base ${winners.has(p.playerId) ? 'font-bold text-mine-gold' : 'text-white'}`}>
              {i + 1}. {p.displayName} {winners.has(p.playerId) ? '👑' : ''}
              {'  '}
              {state.revealedRoles?.find((r) => r.playerId === p.playerId)?.role === 'saboteur' ? '😈' : '⛏️'}
            </Text>
            <Text className="text-base text-mine-gold">{p.goldCollected} 🪙</Text>
          </View>
        ))}
      </View>

      <View className="mt-6 w-full gap-3">
        {isHost && (
          <Pressable className="items-center rounded-xl bg-mine-gold py-3" onPress={onPlayAgain}>
            <Text className="text-lg font-bold text-mine-bg">Play Again</Text>
          </Pressable>
        )}
        <Pressable className="items-center rounded-xl bg-mine-surface py-3" onPress={onLeave}>
          <Text className="text-lg font-semibold text-white">Back to Home</Text>
        </Pressable>
      </View>
    </View>
  );
}
