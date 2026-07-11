import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeInUp, ZoomIn } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SaboteurPublicState } from '@zuychin-arcade/types';
import { NeonButton } from '../../ui/NeonButton';
import { Coin } from '../../ui/Coin';
import { ARCADE, OVERLAY_FILL, neonText } from '../../../constants/theme';

const GOLD = '#F5C518';

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
    <Animated.View
      entering={FadeIn.duration(300)}
      style={[OVERLAY_FILL, { zIndex: 50, paddingHorizontal: 24 }]}
    >
      <MaterialCommunityIcons name="trophy-outline" size={64} color={GOLD} />
      <Animated.Text
        entering={ZoomIn.delay(150).springify().damping(12)}
        style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 34, letterSpacing: 4, marginVertical: 8, ...neonText(ARCADE.pink, 18) }}
      >
        GAME OVER
      </Animated.Text>

      <Animated.View
        entering={FadeInUp.delay(300).springify().damping(16)}
        style={{ width: '100%', borderRadius: 16, borderWidth: 1, borderColor: ARCADE.border, backgroundColor: ARCADE.surface, padding: 16 }}
      >
        {ranked.map((p, i) => (
          <Animated.View
            key={p.playerId}
            entering={FadeInUp.delay(400 + i * 90)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}
          >
            <Text
              style={
                winners.has(p.playerId)
                  ? { fontFamily: 'SpaceMono_700Bold', fontSize: 16, ...neonText(GOLD, 8) }
                  : { fontFamily: 'SpaceMono_400Regular', fontSize: 15, color: ARCADE.text }
              }
            >
              {i + 1}. {p.displayName}
            </Text>
            <Coin amount={p.goldCollected} size="sm" showText />
          </Animated.View>
        ))}
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(650).springify().damping(16)} style={{ marginTop: 28, width: '100%', gap: 12 }}>
        {isHost && <NeonButton label="PLAY AGAIN" icon={<MaterialCommunityIcons name="play" size={16} color={ARCADE.bg} />} color={ARCADE.pink} onPress={onPlayAgain} />}
        <NeonButton label="BACK TO ARCADE" color={ARCADE.blue} variant="outline" onPress={onLeave} />
      </Animated.View>
    </Animated.View>
  );
}
