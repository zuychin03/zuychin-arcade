import { Text, View } from 'react-native';

interface Props {
  size?: number;
  label?: string;
}

export function CardBack({ size = 44, label = '⛏️' }: Props) {
  return (
    <View
      style={{ width: size, height: size }}
      className="items-center justify-center rounded-sm border border-mine-gold/40 bg-mine-tunnel/40"
    >
      <Text style={{ fontSize: size * 0.4 }}>{label}</Text>
    </View>
  );
}
