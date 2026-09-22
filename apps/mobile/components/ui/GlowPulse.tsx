import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

interface Props {
  color: string;
  borderRadius?: number;
  borderWidth?: number;
}

/** Absolute-fill pulsing neon border. Render inside a relatively-positioned view. */
export function GlowPulse({ color, borderRadius = 6, borderWidth = 2 }: Props) {
  const pulse = useSharedValue(0);
  const reduceMotion = useReducedMotionPreference();

  useEffect(() => {
    cancelAnimation(pulse);
    pulse.value = reduceMotion ? 1 : withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);

  const animated = useAnimatedStyle(() => ({ opacity: 0.4 + pulse.value * 0.6 }));

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { borderColor: color, borderWidth, borderRadius, boxShadow: `0 0 10px ${color}`, pointerEvents: 'none' },
        animated,
      ]}
    />
  );
}
