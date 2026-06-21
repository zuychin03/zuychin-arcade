import { Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { ScalePressable } from '../../ui/ScalePressable';
import { ARCADE, OVERLAY_FILL, neonText } from '../../../constants/theme';

const GOLD = '#F5C518';

interface Props {
  cardCount: number;
  onPick: (cardIndex: number) => void;
}

export function GoldPickOverlay({ cardCount, onPick }: Props) {
  return (
    <Animated.View
      entering={FadeIn.duration(250)}
      style={[OVERLAY_FILL, { zIndex: 50, paddingHorizontal: 24 }]}
    >
      <Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 26, letterSpacing: 2, ...neonText(GOLD, 16) }}>
        PICK YOUR GOLD!
      </Text>
      <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, textAlign: 'center', marginTop: 8, marginBottom: 28, paddingHorizontal: 24, lineHeight: 20 }}>
        The nugget cards are face-down — take one and see what you got. The rest pass on to the next miner.
      </Text>
      <View className="flex-row flex-wrap justify-center gap-3">
        {Array.from({ length: cardCount }, (_, i) => (
          <Animated.View key={i} entering={ZoomIn.delay(150 + i * 110).springify().damping(11)}>
            <ScalePressable
              onPress={() => onPick(i)}
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
              <Text style={{ fontSize: 32, fontWeight: '900', marginTop: 6, ...neonText(GOLD, 10) }}>?</Text>
              <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, fontSize: 12 }}>face-down</Text>
            </ScalePressable>
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}
