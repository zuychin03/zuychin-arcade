import { useEffect } from 'react';
import { View, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { ARCADE } from '../../constants/theme';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

export default function AnimatedBackground() {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotionPreference();

  const glow1X = useSharedValue(-100);
  const glow1Y = useSharedValue(-100);
  const glow2X = useSharedValue(width);
  const glow2Y = useSharedValue(height);

  useEffect(() => {
    cancelAnimation(glow1X);
    cancelAnimation(glow1Y);
    cancelAnimation(glow2X);
    cancelAnimation(glow2Y);
    if (reduceMotion) {
      glow1X.value = width * 0.1 - 100;
      glow1Y.value = height * 0.1 - 100;
      glow2X.value = width * 0.75 - 100;
      glow2Y.value = height * 0.7 - 100;
      return;
    }

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
    return () => {
      cancelAnimation(glow1X);
      cancelAnimation(glow1Y);
      cancelAnimation(glow2X);
      cancelAnimation(glow2Y);
    };
  }, [glow1X, glow1Y, glow2X, glow2Y, height, reduceMotion, width]);

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
