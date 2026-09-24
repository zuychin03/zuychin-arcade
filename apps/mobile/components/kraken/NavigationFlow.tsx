import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CardSurface } from '../ui/CardSurface';
import { KRAKEN as C } from './palette';
import { typography as T } from './Controls';

function CardPair({ count, caption }: { count: 1 | 2; caption: string }) {
  return <View style={{ gap: 8, alignItems: 'center' }}>
    <View accessible={false} style={{ flexDirection: 'row', gap: 6, padding: 4 }}>
      {Array.from({ length: count }, (_, index) => <CardSurface key={index} width={36} height={50} radius={6} faceColor={C.panel} edgeColor={C.bg} highlightColor={C.accent}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="compass-outline" size={24} color={C.accent} /></View>
      </CardSurface>)}
    </View>
    <Text style={[T.body, { textAlign: 'center' }]}>{caption}</Text>
  </View>;
}

export function NavigationFlow() {
  return <View style={{ gap: 16 }}>
    <Text style={T.heading}>Two hands become one course</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
      {['Captain', 'Lieutenant'].map(role => <View key={role} style={{ flex: 1, minWidth: 130, gap: 12, alignItems: 'center' }}>
        <Text style={[T.body, { fontFamily: 'Outfit_700Bold' }]}>{role}</Text>
        <CardPair count={2} caption="Draw 2" />
        <MaterialCommunityIcons name="arrow-down" size={26} color={C.secondary} accessible={false} />
        <CardPair count={1} caption="Send 1 face down" />
      </View>)}
    </View>
    <View style={{ gap: 12, alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: C.border }}>
      <Text style={[T.body, { fontFamily: 'Outfit_700Bold' }]}>Navigator</Text>
      <CardPair count={2} caption="Receive the shuffled pair" />
      <MaterialCommunityIcons name="arrow-down" size={26} color={C.secondary} accessible={false} />
      <Text style={[T.body, { color: C.secondary, textAlign: 'center' }]}>Play 1 course. Discard the other.</Text>
    </View>
    <Text style={T.muted}>These are normal draws. Character powers can change them. Keep both senders secret and do not communicate during selection.</Text>
  </View>;
}
