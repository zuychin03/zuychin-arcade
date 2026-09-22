import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { ARCADE } from '../../../constants/theme';
import { useReducedMotionPreference } from '../../../hooks/useReducedMotionPreference';

interface Props {
  nativeID?: string;
  selected: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  children: ReactNode;
}

export function HandCard({ nativeID, selected, disabled, accessibilityLabel, onPress, children }: Props) {
  const lift = useSharedValue(0);
  const reducedMotion = useReducedMotionPreference();

  useEffect(() => {
    lift.value = reducedMotion ? 0 : withSpring(selected ? 1 : 0, { damping: 14, stiffness: 220 });
  }, [selected, lift, reducedMotion]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value * -10 }, { scale: 1 + lift.value * 0.08 }],
  }));

  return (
    <Pressable
      nativeID={nativeID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={selected ? 'Tap again to deselect' : 'Select this card to play or discard'}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minWidth: 84, minHeight: 134, alignSelf: 'stretch', justifyContent: 'center', opacity: disabled ? 0.75 : 1 }}
    >
      <Animated.View
        style={[
          {
            flexGrow: 1,
            padding: 3,
            paddingBottom: 6,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: selected ? ARCADE.cyan : 'transparent',
            boxShadow: selected ? '0 8px 12px rgba(0,0,0,0.38)' : undefined,
          },
          animated,
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
