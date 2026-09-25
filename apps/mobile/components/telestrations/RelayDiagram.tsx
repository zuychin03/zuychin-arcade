import { Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CardSurface } from '../ui/CardSurface';
import { typography as T } from './Controls';
import { TELESTRATIONS as C } from './palette';
import { useMeasuredTextScale } from '../../hooks/useMeasuredTextScale';

export function RelayDiagram() {
  const { fontScale } = useWindowDimensions();
  const { textRef, onTextLayout, textScale } = useMeasuredTextScale(16, fontScale);
  return <View accessibilityLabel="Secret prompt becomes a drawing, then a guess. Repeat and reveal." style={{ padding: 16, gap: 16 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {([
        ['text-box-outline', 'Secret prompt'], ['draw', 'Draw it'], ['thought-bubble-outline', 'Guess it'],
      ] as const).map(([icon, label], i) => <View key={label} style={{ flexGrow: 1, flexShrink: 1, flexBasis: 80 * textScale + 32, minWidth: 0, maxWidth: '100%' }}>
        <CardSurface fill faceColor={i === 1 ? C.accent : C.panel} edgeColor={C.bg} radius={12} highlightColor={C.border}>
          <View style={{ padding: 16, alignItems: 'center', gap: 12 }}>
            <MaterialCommunityIcons name={icon} size={36} color={i === 1 ? C.bg : C.accent} />
            <Text ref={i === 0 ? textRef : undefined} onLayout={i === 0 ? onTextLayout : undefined} style={[T.body, { color: i === 1 ? C.bg : C.text, textAlign: 'center', fontFamily: 'Outfit_700Bold' }]}>{label}</Text>
          </View>
        </CardSurface>
      </View>)}
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <MaterialCommunityIcons name="swap-horizontal" size={28} color={C.secondary} />
      <Text style={[T.body, { flex: 1 }]}>Pass together. See only the previous page. Discover the whole story at the reveal.</Text>
    </View>
  </View>;
}
