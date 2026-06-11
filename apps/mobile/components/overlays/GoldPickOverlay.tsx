import { Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { ScalePressable } from '../ui/ScalePressable';
import { ARCADE, neonText } from '../../constants/theme';

const GOLD = '#F5C518';

interface Props {
  availableCards: number[];
  onPick: (value: number) => void;
}

export function GoldPickOverlay({ availableCards, onPick }: Props) {
  return (
    <Animated.View
      entering={FadeIn.duration(250)}
      className="absolute inset-0 z-50 items-center justify-center bg-black/95 px-6"
    >
      <Text style={{ fontSize: 26, fontWeight: '900', letterSpacing: 2, ...neonText(GOLD, 16) }}>
        PICK YOUR GOLD!
      </Text>
      <Text className="mb-7 mt-2 text-center text-arcade-muted">
        Take one nugget card — the rest pass on to the next miner.
      </Text>
      <View className="flex-row flex-wrap justify-center gap-3">
        {availableCards.map((value, i) => (
          <Animated.View key={`${value}-${i}`} entering={ZoomIn.delay(150 + i * 110).springify().damping(11)}>
            <ScalePressable
              onPress={() => onPick(value)}
              scaleTo={0.9}
              style={{
                height: 132,
                width: 96,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 16,
                borderWidth: 2,
                borderColor: GOLD,
                backgroundColor: ARCADE.surface,
                boxShadow: `0 0 14px ${GOLD}55`,
              }}
            >
              <Text style={{ fontSize: 34 }}>🪙</Text>
              <Text style={{ fontSize: 32, fontWeight: '900', marginTop: 6, ...neonText(GOLD, 10) }}>{value}</Text>
              <Text className="text-xs text-arcade-muted">nugget{value > 1 ? 's' : ''}</Text>
            </ScalePressable>
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}
