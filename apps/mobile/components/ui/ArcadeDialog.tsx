import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { useDialogStore, type DialogButton } from '../../lib/dialog';
import { ScalePressable } from './ScalePressable';
import { ARCADE, neonText } from '../../constants/theme';

function buttonColor(style?: DialogButton['style']) {
  if (style === 'destructive') return ARCADE.red;
  if (style === 'cancel') return ARCADE.muted;
  return ARCADE.cyan;
}

/** Renders the dialog opened via showDialog(). Mounted once in the root layout. */
export function ArcadeDialogHost() {
  const dialog = useDialogStore((s) => s.dialog);
  const hide = useDialogStore((s) => s.hide);
  if (!dialog) return null;

  const onButton = (button: DialogButton) => {
    hide();
    button.onPress?.();
  };
  const onBackdrop = () => {
    const cancel = dialog.buttons.find((b) => b.style === 'cancel');
    hide();
    cancel?.onPress?.();
  };
  const row = dialog.buttons.length <= 2;

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        padding: 32,
      }}
    >
      <Pressable
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        onPress={onBackdrop}
      />
      <Animated.View
        entering={ZoomIn.springify().damping(14)}
        style={{
          width: '100%',
          maxWidth: 360,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: ARCADE.border,
          backgroundColor: ARCADE.panel,
          padding: 20,
          boxShadow: `0 0 24px ${ARCADE.purple}44`,
        }}
      >
        <Text style={{ fontSize: 17, fontFamily: 'Outfit_800ExtraBold', letterSpacing: 1, textAlign: 'center', ...neonText(ARCADE.cyan, 8) }}>
          {dialog.title}
        </Text>
        {dialog.message ? (
          <Text style={{ fontFamily: 'SpaceMono_400Regular', color: ARCADE.muted, textAlign: 'center', marginTop: 10, lineHeight: 20 }}>
            {dialog.message}
          </Text>
        ) : null}
        <View style={{ flexDirection: row ? 'row' : 'column', gap: 10, marginTop: 20 }}>
          {dialog.buttons.map((button) => {
            const color = buttonColor(button.style);
            return (
              <ScalePressable
                key={button.text}
                onPress={() => onButton(button)}
                style={{
                  flex: row ? 1 : undefined,
                  alignItems: 'center',
                  borderRadius: 12,
                  borderWidth: 1.5,
                  borderColor: color,
                  paddingVertical: 11,
                  backgroundColor: button.style === 'cancel' ? 'transparent' : `${color}22`,
                }}
              >
                <Text style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 14, letterSpacing: 1, color }}>{button.text}</Text>
              </ScalePressable>
            );
          })}
        </View>
      </Animated.View>
    </Animated.View>
  );
}
