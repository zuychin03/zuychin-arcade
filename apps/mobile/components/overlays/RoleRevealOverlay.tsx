import { Text } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import type { Role } from '@zuychin-arcade/types';
import { ARCADE, neonText } from '../../constants/theme';

interface Props {
  role: Role;
  round: number;
}

export function RoleRevealOverlay({ role, round }: Props) {
  const isSaboteur = role === 'saboteur';
  const accent = isSaboteur ? ARCADE.red : '#F5C518';
  return (
    <Animated.View
      entering={FadeIn.duration(250)}
      className="absolute inset-0 z-50 items-center justify-center bg-black/95"
    >
      <Animated.View entering={ZoomIn.delay(150).springify().damping(12)} className="items-center">
        <Text className="text-sm tracking-widest text-arcade-muted">ROUND {round} — YOUR SECRET ROLE</Text>
        <Text style={{ fontSize: 84, marginVertical: 16 }}>{isSaboteur ? '😈' : '⛏️'}</Text>
        <Text style={{ fontSize: 40, fontWeight: '900', letterSpacing: 6, ...neonText(accent, 20) }}>
          {isSaboteur ? 'SABOTEUR' : 'MINER'}
        </Text>
        <Text className="mt-5 px-12 text-center leading-5 text-arcade-muted">
          {isSaboteur
            ? 'Stop the tunnel from reaching the gold — without getting caught.'
            : 'Dig a tunnel to the gold before the deck runs out.'}
        </Text>
        <Text className="mt-6 text-xs text-arcade-muted/60">tap anywhere to dismiss</Text>
      </Animated.View>
    </Animated.View>
  );
}
