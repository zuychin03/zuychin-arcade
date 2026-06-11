import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeInUp, ZoomIn } from 'react-native-reanimated';
import type { SaboteurPublicState } from '@zuychin-arcade/types';
import { NeonButton } from '../ui/NeonButton';
import { ARCADE, neonText } from '../../constants/theme';

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
      className="absolute inset-0 z-50 items-center justify-center bg-black/95 px-6"
    >
      <Animated.Text entering={ZoomIn.springify().damping(9)} style={{ fontSize: 64 }}>
        🏆
      </Animated.Text>
      <Animated.Text
        entering={ZoomIn.delay(150).springify().damping(12)}
        style={{ fontSize: 34, fontWeight: '900', letterSpacing: 4, marginVertical: 8, ...neonText(ARCADE.pink, 18) }}
      >
        GAME OVER
      </Animated.Text>

      <Animated.View
        entering={FadeInUp.delay(300).springify().damping(16)}
        className="w-full rounded-2xl border border-arcade-border bg-arcade-surface p-4"
      >
        {ranked.map((p, i) => (
          <Animated.View
            key={p.playerId}
            entering={FadeInUp.delay(400 + i * 90)}
            className="flex-row items-center justify-between py-2"
          >
            <Text
              style={
                winners.has(p.playerId)
                  ? { fontSize: 16, fontWeight: '800', ...neonText(GOLD, 8) }
                  : { fontSize: 15, color: ARCADE.text }
              }
            >
              {i + 1}. {p.displayName} {winners.has(p.playerId) ? '👑' : ''}{' '}
              {state.revealedRoles?.find((r) => r.playerId === p.playerId)?.role === 'saboteur' ? '😈' : '⛏️'}
            </Text>
            <Text style={{ fontSize: 15, fontWeight: '700', ...neonText(GOLD, 6) }}>
              {p.goldCollected} 🪙
            </Text>
          </Animated.View>
        ))}
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(650).springify().damping(16)} className="mt-7 w-full gap-3">
        {isHost && <NeonButton label="▶ PLAY AGAIN" color={ARCADE.pink} onPress={onPlayAgain} />}
        <NeonButton label="BACK TO ARCADE" color={ARCADE.blue} variant="outline" onPress={onLeave} />
      </Animated.View>
    </Animated.View>
  );
}
