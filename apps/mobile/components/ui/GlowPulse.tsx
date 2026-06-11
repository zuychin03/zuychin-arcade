import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  color: string;
  borderRadius?: number;
  borderWidth?: number;
}

/** Absolute-fill pulsing neon border. Render inside a relatively-positioned view. */
export function GlowPulse({ color, borderRadius = 6, borderWidth = 2 }: Props) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: 0.4 + pulse.value * 0.6 }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { borderColor: color, borderWidth, borderRadius, boxShadow: `0 0 10px ${color}` },
        animated,
      ]}
    />
  );
}
