import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COUP, neonBox, neonText } from '../../constants/theme';

interface Props {
  amount?: number | null;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

const METALLIC_CORE = ['#3E250A', '#1C1004', '#4D300F'] as const;
const GRAD_START = { x: 0, y: 0 };
const GRAD_END = { x: 1, y: 1 };

export function Coin({ amount, size = 'sm', showText = false }: Props) {
  const dims = {
    sm: { disc: 18, border: 1.5, innerOffset: 2, font: 12, gap: 5 },
    md: { disc: 26, border: 2, innerOffset: 3, font: 15, gap: 6 },
    lg: { disc: 38, border: 2.5, innerOffset: 4, font: 20, gap: 8 },
  }[size];

  const disc = (
    <LinearGradient
      accessible={!showText}
      accessibilityRole="image"
      accessibilityLabel="Gold nugget"
      colors={METALLIC_CORE}
      start={GRAD_START}
      end={GRAD_END}
      style={[
        {
          width: dims.disc,
          height: dims.disc,
          borderRadius: dims.disc / 2,
          borderWidth: dims.border,
          borderColor: COUP.gold,
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        },
        neonBox('rgba(244, 192, 78, 0.55)', dims.disc * 0.45),
      ]}
    >
      <View
        style={{
          position: 'absolute',
          top: dims.innerOffset,
          left: dims.innerOffset,
          right: dims.innerOffset,
          bottom: dims.innerOffset,
          borderRadius: (dims.disc - dims.innerOffset * 2) / 2,
          borderWidth: 1.0,
          borderColor: 'rgba(244, 192, 78, 0.65)',
        }}
      />
      <MaterialCommunityIcons name="gold" size={dims.disc * 0.5} color={COUP.gold} />
    </LinearGradient>
  );

  if (showText && amount !== undefined) {
    return (
      <View
        accessible
        accessibilityLabel={amount === null ? 'Gold total hidden' : `${amount} gold`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: dims.gap }}
      >
        {disc}
        <Text
          style={{
            fontFamily: 'Outfit_800ExtraBold',
            fontSize: dims.font,
            ...neonText('rgba(244, 192, 78, 0.3)', 6),
            color: COUP.gold,
          }}
        >
          {amount === null ? '?' : amount}
        </Text>
      </View>
    );
  }

  return disc;
}
