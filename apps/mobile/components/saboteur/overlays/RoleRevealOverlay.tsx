import { Text } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Role } from '@zuychin-arcade/types';
import { ARCADE, OVERLAY_FILL, neonText } from '../../../constants/theme';

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
        <Text style={{ fontFamily: 'Outfit_700Bold', color: ARCADE.muted, fontSize: 14, letterSpacing: 2 }}>ROUND {round} — YOUR SECRET ROLE</Text>
        <MaterialCommunityIcons name={isSaboteur ? 'emoticon-devil-outline' : 'pickaxe'} size={84} color={accent} style={{ marginVertical: 16 }} />
        <Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 40, letterSpacing: 6, ...neonText(accent, 20) }}>
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
