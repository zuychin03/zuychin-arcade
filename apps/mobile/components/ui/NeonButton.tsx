import { ReactNode, useId } from 'react';
import { Platform, Text, View } from 'react-native';
import { ScalePressable } from './ScalePressable';
import { ARCADE, neonBox } from '../../constants/theme';
import { TYPOGRAPHY } from '../../constants/typography';

interface Props {
  label: string;
  onPress: () => void;
  color?: string;          // neon accent
  solidTextColor?: string;
  outlineBackgroundColor?: string;
  variant?: 'solid' | 'outline' | 'ghost';
  disabled?: boolean;
  icon?: ReactNode;
  accessibilityHint?: string;
}

export function NeonButton({ label, onPress, color = ARCADE.pink, solidTextColor = ARCADE.bg, outlineBackgroundColor = ARCADE.surface, variant = 'solid', disabled, icon, accessibilityHint }: Props) {
  const solid = variant === 'solid';
  const ghost = variant === 'ghost';
  const hintId = useId();
  return (
    <ScalePressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      aria-describedby={Platform.OS === 'web' && accessibilityHint ? hintId : undefined}
      style={[
        {
          minHeight: 48,
          borderRadius: 14,
          paddingVertical: 12,
          paddingHorizontal: 16,
          backgroundColor: solid ? color : ghost ? 'transparent' : outlineBackgroundColor,
          borderWidth: ghost ? 0 : 1.5,
          borderColor: color,
          opacity: disabled ? 0.4 : 1,
        },
        !disabled && !ghost ? neonBox(`${color}66`, 12) : null,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {icon}
        <Text
          style={{
            ...TYPOGRAPHY.control,
            flexShrink: 1,
            minWidth: 0,
            color: solid ? solidTextColor : color,
            textAlign: 'center',
          }}
        >
          {label}
        </Text>
      </View>
      {Platform.OS === 'web' && accessibilityHint ? (
        <Text nativeID={hintId} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
          {accessibilityHint}
        </Text>
      ) : null}
    </ScalePressable>
  );
}
