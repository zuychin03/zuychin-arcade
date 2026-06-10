import { Pressable, Text, View } from 'react-native';
import type { Player } from '@zuychin-arcade/types';

interface Props {
  players: Player[];
  maxPlayers: number;
  canKick: boolean;
  onKick: (playerId: string) => void;
}

export function PlayerList({ players, maxPlayers, canKick, onKick }: Props) {
  return (
    <View className="rounded-xl bg-mine-surface p-4">
      <Text className="mb-2 text-base font-semibold text-white">
        Players ({players.length}/{maxPlayers})
      </Text>
      {players.map((p) => (
        <View key={p.playerId} className="flex-row items-center justify-between py-1.5">
          <Text className={`text-base ${p.isConnected ? 'text-white' : 'text-mine-stone'}`}>
            {p.isHost ? '👑 ' : p.isConnected ? '● ' : '○ '}
            {p.displayName}
            {!p.isConnected ? ' (disconnected)' : ''}
          </Text>
          {canKick && !p.isHost && (
            <Pressable
              className="rounded-md bg-mine-danger/80 px-2.5 py-1"
              onPress={() => onKick(p.playerId)}
            >
              <Text className="font-bold text-white">✕</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}
