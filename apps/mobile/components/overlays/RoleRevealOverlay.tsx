import { Text, View } from 'react-native';
import type { Role } from '@zuychin-arcade/types';

interface Props {
  role: Role;
  round: number;
}

export function RoleRevealOverlay({ role, round }: Props) {
  const isSaboteur = role === 'saboteur';
  return (
    <View className="absolute inset-0 z-50 items-center justify-center bg-black/90">
      <Text className="text-lg text-mine-stone">Round {round} — your secret role</Text>
      <Text style={{ fontSize: 72 }} className="my-4">
        {isSaboteur ? '😈' : '⛏️'}
      </Text>
      <Text
        className={`text-4xl font-extrabold tracking-widest ${
          isSaboteur ? 'text-mine-danger' : 'text-mine-gold'
        }`}
      >
        {isSaboteur ? 'SABOTEUR' : 'MINER'}
      </Text>
      <Text className="mt-4 px-10 text-center text-mine-stone">
        {isSaboteur
          ? 'Stop the tunnel from reaching the gold — without getting caught.'
          : 'Dig a tunnel to the gold before the deck runs out.'}
      </Text>
    </View>
  );
}
