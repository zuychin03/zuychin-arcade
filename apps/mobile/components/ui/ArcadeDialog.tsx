import { useCallback } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { useDialogStore, type DialogButton } from '../../lib/dialog';
import { ScalePressable } from './ScalePressable';
import { ARCADE, neonText } from '../../constants/theme';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { useWebModalFocus } from '../../hooks/useWebModalFocus';

function buttonColor(style?: DialogButton['style']) {
  if (style === 'destructive') return ARCADE.red;
  if (style === 'cancel') return ARCADE.muted;
  return ARCADE.cyan;
}

export function ArcadeDialogHost() {
  const reduceMotion = useReducedMotionPreference();
  const dialog = useDialogStore((s) => s.dialog);
  const hide = useDialogStore((s) => s.hide);
  const onBackdrop = useCallback(() => {
    const cancel = dialog?.buttons.find((button) => button.style === 'cancel');
    hide();
    cancel?.onPress?.();
  }, [dialog, hide]);
  useWebModalFocus(Boolean(dialog), 'arcade-dialog', onBackdrop);

  if (!dialog) return null;

  const onButton = (button: DialogButton) => {
    hide();
    button.onPress?.();
  };
  const row = dialog.buttons.length <= 2;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onBackdrop}>
      <SafeAreaProvider>
        <SafeAreaView
          accessibilityViewIsModal
          edges={{ top: 'maximum', right: 'maximum', bottom: 'maximum', left: 'maximum' }}
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: 32,
          }}
        >
          <Pressable
            accessible={false}
            focusable={false}
            importantForAccessibility="no"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            onPress={onBackdrop}
          />
          <Animated.View
            nativeID="arcade-dialog"
            accessibilityLabel={`${dialog.title} dialog`}
            accessibilityViewIsModal
            role="alertdialog"
            aria-modal
            entering={reduceMotion ? undefined : ZoomIn.springify().damping(14)}
            style={{
              width: '100%',
              maxWidth: 360,
              maxHeight: '100%',
              flexShrink: 1,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: ARCADE.border,
              backgroundColor: ARCADE.panel,
              padding: 20,
              boxShadow: `0 0 24px ${ARCADE.purple}44`,
            }}
          >
            <ScrollView
              nativeID="arcade-dialog-content"
              tabIndex={Platform.OS === 'web' ? 0 : undefined}
              role={Platform.OS === 'web' ? 'region' : undefined}
              accessibilityLabel={`${dialog.title} details`}
              style={{ flexGrow: 0, flexShrink: 1 }}
              showsVerticalScrollIndicator
            >
              <Text accessibilityRole="header" style={{ fontSize: 17, fontFamily: 'Outfit_800ExtraBold', letterSpacing: 1, textAlign: 'center', ...neonText(ARCADE.cyan, 8) }}>
                {dialog.title}
              </Text>
              {dialog.message ? (
                <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, textAlign: 'center', marginTop: 10, lineHeight: 20 }}>
                  {dialog.message}
                </Text>
              ) : null}
            </ScrollView>
            <View style={{ flexDirection: row ? 'row' : 'column', flexShrink: 0, gap: 10, marginTop: 20 }}>
              {dialog.buttons.map((button) => {
                const color = buttonColor(button.style);
                return (
                  <ScalePressable
                    key={button.text}
                    accessibilityLabel={button.text}
                    onPress={() => onButton(button)}
                    style={{
                      flex: row ? 1 : undefined,
                      minHeight: 48,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 12,
                      borderWidth: 1.5,
                      borderColor: color,
                      paddingVertical: 11,
                      paddingHorizontal: 4,
                      backgroundColor: button.style === 'cancel' ? 'transparent' : `${color}22`,
                    }}
                  >
                    <Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 14, letterSpacing: 1, color, textAlign: 'center' }}>{button.text}</Text>
                  </ScalePressable>
                );
              })}
            </View>
          </Animated.View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
