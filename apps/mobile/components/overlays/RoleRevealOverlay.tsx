import { Text } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import type { Role } from '@zuychin-arcade/types';
import { ARCADE, OVERLAY_FILL, neonText } from '../../constants/theme';

interface Props {
  role: Role;
  round: number;
}

export function RoleRevealOverlay({ role, round }: Props) {
  const isSaboteur = role === 'saboteur';
  const accent = isSaboteur ? ARCADE.red : '#F5C518';
  return (
    <Animated.View entering={FadeIn.duration(250)} style={[OVERLAY_FILL, { zIndex: 50 }]}>
      <Animated.View entering={ZoomIn.delay(150).springify().damping(12)} style={{ alignItems: 'center' }}>
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, fontSize: 14, letterSpacing: 2 }}>ROUND {round} — YOUR SECRET ROLE</Text>
        <Text style={{ fontSize: 84, marginVertical: 16 }}>{isSaboteur ? '😈' : '⛏️'}</Text>
        <Text style={{ fontSize: 40, fontWeight: '900', letterSpacing: 6, ...neonText(accent, 20) }}>
          {isSaboteur ? 'SABOTEUR' : 'MINER'}
        </Text>
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, textAlign: 'center', paddingHorizontal: 48, marginTop: 20, lineHeight: 20 }}>
          {isSaboteur
            ? 'Stop the tunnel from reaching the gold — without getting caught.'
            : 'Dig a tunnel to the gold before the deck runs out.'}
        </Text>
        <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, opacity: 0.6, marginTop: 24, fontSize: 12 }}>tap anywhere to dismiss</Text>
      </Animated.View>
    </Animated.View>
  );
}
