import { Text, View } from 'react-native';
import { ARCADE, neonBox, neonText } from '../../constants/theme';

interface Props {
  width?: number;
  height?: number;
  label?: string;
}

export function CardBack({ width = 44, height = 66, label = '⛏️' }: Props) {
  const minDim = Math.min(width, height);
  return (
    <View
      style={{
        width,
        height,
        backgroundColor: '#161028',
        borderRadius: 8,
        borderWidth: 2,
        borderColor: '#FF2E88',
        alignItems: 'center',
        justifyContent: 'center',
        ...neonBox('#FF2E88', 8),
      }}
    >
      {/* Decorative inner border */}
      <View
        style={{
          position: 'absolute',
          top: 4,
          bottom: 4,
          left: 4,
          right: 4,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: 'rgba(255, 46, 136, 0.3)',
          borderStyle: 'dashed',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: minDim * 0.35, ...neonText('#FF2E88', 8) }}>{label}</Text>
        
        {/* Subtle card identifier at bottom */}
        <Text style={{ position: 'absolute', bottom: 4, fontSize: minDim * 0.14, opacity: 0.6, color: '#A855F7', fontWeight: 'bold' }}>
          ARCADE
        </Text>
      </View>
    </View>
  );
}
