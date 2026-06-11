import { Text } from 'react-native';
import { ScalePressable } from './ScalePressable';
import { ARCADE, neonBox } from '../../constants/theme';

interface Props {
  label: string;
  onPress: () => void;
  color?: string;          // neon accent
  variant?: 'solid' | 'outline' | 'ghost';
  disabled?: boolean;
}

export function NeonButton({ label, onPress, color = ARCADE.pink, variant = 'solid', disabled }: Props) {
  const solid = variant === 'solid';
  const ghost = variant === 'ghost';
  return (
    <ScalePressable
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          alignItems: 'center',
          borderRadius: 14,
          paddingVertical: 14,
          paddingHorizontal: 18,
          backgroundColor: solid ? color : ghost ? 'transparent' : ARCADE.surface,
          borderWidth: ghost ? 0 : 1.5,
          borderColor: color,
          opacity: disabled ? 0.4 : 1,
        },
        !disabled && !ghost ? neonBox(`${color}66`, 12) : null,
      ]}
    >
      <Text
        style={{
          fontSize: 16,
          fontWeight: '800',
          letterSpacing: 1,
          color: solid ? ARCADE.bg : color,
        }}
      >
        {label}
      </Text>
    </ScalePressable>
  );
}
