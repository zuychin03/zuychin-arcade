import { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { ScalePressable } from './ScalePressable';
import { ARCADE, neonBox } from '../../constants/theme';

interface Props {
  label: string;
  onPress: () => void;
  color?: string;          // neon accent
  variant?: 'solid' | 'outline' | 'ghost';
  disabled?: boolean;
  icon?: ReactNode;
}

export function NeonButton({ label, onPress, color = ARCADE.pink, variant = 'solid', disabled, icon }: Props) {
  const solid = variant === 'solid';
  const ghost = variant === 'ghost';
  return (
    <ScalePressable
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          borderRadius: 14,
          paddingVertical: 12,
          paddingHorizontal: 16,
          backgroundColor: solid ? color : ghost ? 'transparent' : ARCADE.surface,
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
            fontFamily: 'Outfit_800ExtraBold',
            fontSize: 14,
            letterSpacing: 1,
            color: solid ? ARCADE.bg : color,
            textAlign: 'center',
          }}
        >
          {label}
        </Text>
      </View>
    </ScalePressable>
  );
}

