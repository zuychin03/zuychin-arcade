import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeInUp, ZoomIn } from 'react-native-reanimated';
import type { SaboteurPublicState } from '@zuychin-arcade/types';
import { ARCADE, OVERLAY_FILL, neonText } from '../../constants/theme';

interface Props {
  state: SaboteurPublicState;
}

export function RoundEndOverlay({ state }: Props) {
  const minersWon = state.roundWinner === 'miners';
  const accent = minersWon ? '#F5C518' : ARCADE.red;
  const waitingOnPick = state.goldDistribution?.currentPickerId ?? null;
  const pickerName = waitingOnPick
    ? state.players.find((p) => p.playerId === waitingOnPick)?.displayName
    : null;

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      style={[OVERLAY_FILL, { zIndex: 40, paddingHorizontal: 24 }]}
    >
      <Animated.Text entering={ZoomIn.delay(100).springify().damping(10)} style={{ fontSize: 64 }}>
        {minersWon ? '💰' : '😈'}
      </Animated.Text>
      <Animated.Text
        entering={ZoomIn.delay(200).springify().damping(12)}
        style={{ fontSize: 32, fontWeight: '900', letterSpacing: 3, marginVertical: 8, ...neonText(accent, 18) }}
      >
        {minersWon ? 'MINERS WIN!' : 'SABOTEURS WIN!'}
      </Animated.Text>
      <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, marginBottom: 20 }}>Round {state.round} of 3</Text>

      <Animated.View
        entering={FadeInUp.delay(350).springify().damping(16)}
        style={{ width: '100%', borderRadius: 16, borderWidth: 1, borderColor: ARCADE.border, backgroundColor: ARCADE.surface, padding: 16 }}
      >
        {state.revealedRoles?.map((r, i) => {
          const gold = state.players.find((p) => p.playerId === r.playerId)?.goldCollected ?? 0;
          return (
            <Animated.View
              key={r.playerId}
              entering={FadeInUp.delay(450 + i * 80)}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}
            >
              <Text style={{ fontFamily: 'SpaceMono_400Regular', fontSize: 16, color: ARCADE.text }}>
                {r.role === 'saboteur' ? '😈' : '⛏️'} {r.displayName}
                <Text style={{ fontFamily: 'SpaceMono_400Regular', color: r.role === 'saboteur' ? ARCADE.red : ARCADE.muted, fontSize: 11 }}>
                  {'  '}{r.role}
                </Text>
              </Text>
              <Text style={{ fontSize: 15, fontWeight: '700', ...neonText('#F5C518', 6) }}>{gold} 🪙</Text>
            </Animated.View>
          );
        })}
      </Animated.View>

      <Animated.View entering={FadeIn.delay(700)}>
        {pickerName ? (
          <Text style={{ fontFamily: 'SpaceMono_400Regular', textAlign: 'center', marginTop: 20, ...neonText('#F5C518', 8) }}>
            Waiting for {pickerName} to pick a gold card…
          </Text>
        ) : (
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, marginTop: 20 }}>
            {state.round < 3 ? 'Next round starting soon…' : 'Tallying final scores…'}
          </Text>
        )}
      </Animated.View>
    </Animated.View>
  );
}
