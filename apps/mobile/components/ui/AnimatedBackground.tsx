import { useEffect } from 'react';
import { View, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { ARCADE } from '../../constants/theme';

export default function AnimatedBackground() {
  const { width, height } = useWindowDimensions();

  const glow1X = useSharedValue(-100);
  const glow1Y = useSharedValue(-100);
  const glow2X = useSharedValue(width);
  const glow2Y = useSharedValue(height);

  useEffect(() => {
    glow1X.value = withRepeat(
      withSequence(
        withTiming(width * 0.5, { duration: 15000, easing: Easing.inOut(Easing.ease) }),
        withTiming(-100, { duration: 15000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    glow1Y.value = withRepeat(
      withSequence(
        withTiming(height * 0.5, { duration: 12000, easing: Easing.inOut(Easing.ease) }),
        withTiming(-100, { duration: 12000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    glow2X.value = withRepeat(
      withSequence(
        withTiming(width * 0.2, { duration: 18000, easing: Easing.inOut(Easing.ease) }),
        withTiming(width + 100, { duration: 18000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    glow2Y.value = withRepeat(
      withSequence(
        withTiming(height * 0.2, { duration: 14000, easing: Easing.inOut(Easing.ease) }),
        withTiming(height + 100, { duration: 14000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, [width, height]);

  const style1 = useAnimatedStyle(() => ({
    transform: [{ translateX: glow1X.value }, { translateY: glow1Y.value }],
  }));

  const style2 = useAnimatedStyle(() => ({
    transform: [{ translateX: glow2X.value }, { translateY: glow2Y.value }],
  }));

  const webBlur = Platform.OS === 'web' ? { filter: 'blur(80px)' } : {};

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: ARCADE.bg, overflow: 'hidden' }]}>
      <Animated.View
        style={[
          styles.glow,
          { backgroundColor: ARCADE.purple, ...webBlur as any },
          style1,
        ]}
      />
      <Animated.View
        style={[
          styles.glow,
          { backgroundColor: ARCADE.cyan, ...webBlur as any },
          style2,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    opacity: 0.15,
  },
});
