import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COUP, neonBox } from '../../constants/theme';

interface Props {
  amount?: number;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

const METALLIC_CORE = ['#3E250A', '#1C1004', '#4D300F'] as const; // High-contrast metallic cyber-gold core
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
      colors={METALLIC_CORE}
      start={GRAD_START}
      end={GRAD_END}
      style={[
        {
          width: dims.disc,
          height: dims.disc,
          borderRadius: dims.disc / 2,
          borderWidth: dims.border,
          borderColor: COUP.gold, // Glowing gold outer rim
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        },
        neonBox('rgba(244, 192, 78, 0.55)', dims.disc * 0.45), // Futuristic neon gold glow
      ]}
    >
      {/* High-tech inner ring groove */}
      <View
        style={{
          position: 'absolute',
          top: dims.innerOffset,
          left: dims.innerOffset,
          right: dims.innerOffset,
          bottom: dims.innerOffset,
          borderRadius: (dims.disc - dims.innerOffset * 2) / 2,
          borderWidth: 1.0,
          borderColor: 'rgba(244, 192, 78, 0.65)', // Sleek glowing groove
        }}
      />
      {/* Holographic glowing center symbol */}
      <Text
        style={{
          fontSize: dims.disc * 0.45,
          fontFamily: 'Outfit_800ExtraBold',
          color: COUP.gold,
          textAlign: 'center',
          textShadowColor: 'rgba(244, 192, 78, 0.9)',
          textShadowRadius: 6,
          textShadowOffset: { width: 0, height: 0 },
        }}
      >
        $
      </Text>
    </LinearGradient>
  );

  if (showText && amount !== undefined) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: dims.gap }}>
        {disc}
        <Text
          style={{
            fontFamily: 'Outfit_800ExtraBold',
            color: COUP.gold,
            fontSize: dims.font,
            textShadowColor: 'rgba(244, 192, 78, 0.3)',
            textShadowRadius: 6,
            textShadowOffset: { width: 0, height: 0 },
          }}
        >
          {amount}
        </Text>
      </View>
    );
  }

  return disc;
}
