import { Text, View } from 'react-native';
import type { SaboteurPublicState } from '@zuychin-arcade/types';

interface Props {
  state: SaboteurPublicState;
}

export function RoundEndOverlay({ state }: Props) {
  const minersWon = state.roundWinner === 'miners';
  const waitingOnPick = state.goldDistribution?.currentPickerId ?? null;
  const pickerName = waitingOnPick
    ? state.players.find((p) => p.playerId === waitingOnPick)?.displayName
    : null;

  return (
    <View className="absolute inset-0 z-40 items-center justify-center bg-black/90 px-6">
      <Text style={{ fontSize: 56 }}>{minersWon ? '💰' : '😈'}</Text>
      <Text className={`my-2 text-3xl font-extrabold ${minersWon ? 'text-mine-gold' : 'text-mine-danger'}`}>
        {minersWon ? 'MINERS WIN!' : 'SABOTEURS WIN!'}
      </Text>
      <Text className="mb-4 text-mine-stone">Round {state.round} of 3</Text>

      <View className="w-full rounded-xl bg-mine-surface p-4">
        {state.revealedRoles?.map((r) => {
          const gold = state.players.find((p) => p.playerId === r.playerId)?.goldCollected ?? 0;
          return (
            <View key={r.playerId} className="flex-row items-center justify-between py-1">
              <Text className="text-base text-white">
                {r.role === 'saboteur' ? '😈' : '⛏️'} {r.displayName}
              </Text>
              <Text className="text-base text-mine-gold">{gold} 🪙</Text>
            </View>
          );
        })}
      </View>

      {pickerName && (
        <Text className="mt-4 text-center text-mine-gold">
          Waiting for {pickerName} to pick a gold card…
        </Text>
      )}
      {!pickerName && (
        <Text className="mt-4 text-mine-stone">
          {state.round < 3 ? 'Next round starting soon…' : 'Tallying final scores…'}
        </Text>
      )}
    </View>
  );
}
