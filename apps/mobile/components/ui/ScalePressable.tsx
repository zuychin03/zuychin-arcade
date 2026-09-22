import type { ReactNode } from 'react';
import { Platform, Pressable, type AccessibilityState, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  children: ReactNode;
  onPress?: () => void;
  onFocus?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  'aria-describedby'?: string;
}

export function ScalePressable({
  children,
  onPress,
  onFocus,
  disabled,
  style,
  scaleTo = 0.95,
  testID,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  'aria-describedby': ariaDescribedBy,
}: Props) {
  const reduceMotion = useReducedMotionPreference();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const effectiveDisabled = disabled || accessibilityState?.disabled === true;
  const webState = Platform.OS === 'web' ? {
    'aria-pressed': accessibilityState?.selected,
    'aria-busy': accessibilityState?.busy,
    'aria-expanded': accessibilityState?.expanded,
    'aria-disabled': effectiveDisabled,
  } : undefined;

  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, disabled: effectiveDisabled }}
      {...webState}
      aria-describedby={ariaDescribedBy}
      onPress={onPress}
      onFocus={onFocus}
      disabled={effectiveDisabled}
      onPressIn={() => {
        scale.value = reduceMotion ? 1 : withSpring(scaleTo, { damping: 15, stiffness: 300 });
      }}
      onPressOut={() => {
        scale.value = reduceMotion ? 1 : withSpring(1, { damping: 15, stiffness: 300 });
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
