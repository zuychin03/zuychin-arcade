import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { ARCADE } from '../../../constants/theme';

interface Props {
  selected: boolean;
  onPress: () => void;
  children: ReactNode;
}

/** Hand card wrapper: lifts and glows when selected. */
export function HandCard({ selected, onPress, children }: Props) {
  const lift = useSharedValue(0);

  useEffect(() => {
    lift.value = withSpring(selected ? 1 : 0, { damping: 14, stiffness: 220 });
  }, [selected, lift]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value * -10 }, { scale: 1 + lift.value * 0.08 }],
  }));

  return (
    <Pressable onPress={onPress}>
      <Animated.View
        style={[
          {
            padding: 3,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: selected ? ARCADE.cyan : 'transparent',
            boxShadow: selected ? `0 0 12px ${ARCADE.cyan}88` : undefined,
          },
          animated,
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
