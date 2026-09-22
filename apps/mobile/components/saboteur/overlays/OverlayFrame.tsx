import type { ReactNode } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useReducedMotionPreference } from '../../../hooks/useReducedMotionPreference';
import { useWebModalFocus } from '../../../hooks/useWebModalFocus';
import { useDialogStore } from '../../../lib/dialog';
import { ARCADE } from '../../../constants/theme';

export function OverlayFrame({ id, label, onEscape, children }: {
  id: string; label: string; onEscape: () => void; children: ReactNode;
}) {
  const reducedMotion = useReducedMotionPreference();
  const dialog = useDialogStore((state) => state.dialog);
  useWebModalFocus(!dialog, id, onEscape);
  return <Animated.View nativeID={id} role="dialog" aria-modal accessibilityViewIsModal accessibilityLabel={label}
    entering={reducedMotion ? undefined : FadeIn.duration(160)}
    style={{ position: 'absolute', inset: 0, zIndex: 50, backgroundColor: ARCADE.bg }}>
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
      <ScrollView tabIndex={Platform.OS === 'web' ? 0 : undefined} role={Platform.OS === 'web' ? 'region' : undefined}
        accessibilityLabel={label + ' details'} showsVerticalScrollIndicator
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View style={{ width: '100%', maxWidth: 540, gap: 18 }}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  </Animated.View>;
}
