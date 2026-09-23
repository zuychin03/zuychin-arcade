import { Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BangCard } from '@zuychin-arcade/types';
import { BANG as C } from '../../constants/theme';
import { BangCardView, BANG_ROLE_GUIDE } from './Card';
import { CardGrid } from '../ui/CardGrid';

const body = { fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, color: C.text } as const;
const heading = { fontFamily: 'Outfit_800ExtraBold', fontSize: 22, lineHeight: 28, color: C.gold } as const;
const examples: BangCard[] = [
  { id: 'rules-bang', name: 'bang', suit: 'hearts', rank: 'A' },
  { id: 'rules-mustang', name: 'mustang', suit: 'hearts', rank: '8' },
];

export function BangRulesGuide() {
  const { fontScale } = useWindowDimensions();
  return <View nativeID="bang-rules-guide" style={{ gap: 28, minWidth: 0 }}>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>The Sheriff is the centre of the fight</Text>
      <Text style={body}>Your secret role decides who must survive. Only the Sheriff starts with their role revealed.</Text>
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: 16, backgroundColor: C.panel, borderRadius: 12 }}>
          <MaterialCommunityIcons accessible={false} name="star-circle-outline" size={44} color={C.gold} />
          <View style={{ flex: 1, minWidth: 120, gap: 4 }}><Text style={{ ...body, fontFamily: 'Outfit_800ExtraBold' }}>Sheriff + Deputies</Text><Text style={body}>Keep the Sheriff alive. Eliminate every Outlaw and the Renegade.</Text></View>
        </View>
        {(['outlaw', 'renegade'] as const).map(role => <View key={role} style={{ gap: 4 }}>
          <Text style={{ ...body, fontFamily: 'Outfit_800ExtraBold', color: role === 'outlaw' ? C.red : C.gold }}>{BANG_ROLE_GUIDE[role].name}</Text>
          <Text style={body}>{BANG_ROLE_GUIDE[role].goal}</Text>
        </View>)}
      </View>
    </View>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>Life also limits your hand</Text>
      <View accessible accessibilityLabel="Example: three life remaining out of four" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {[true, true, true, false].map((alive, index) => <View key={index} accessible={false} style={{ width: 32, height: 40, borderRadius: 8, backgroundColor: alive ? C.sand : C.panel, borderWidth: 1, borderBottomWidth: 3, borderColor: C.muted, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons accessible={false} name={alive ? 'heart' : 'heart-outline'} size={20} color={alive ? C.bg : C.muted} /></View>)}
        <Text style={body}>Example: 3 / 4 life</Text>
      </View>
      <Text style={body}>Draw two, play legal cards, then discard down to your current life. In this example you finish your turn with at most three cards. Character abilities may change these rules.</Text>
    </View>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>A shot travels; equipment stays</Text>
      <Text style={body}>Example cards: BANG! resolves against a target, then leaves your hand. Mustang stays face up in play and makes you harder to reach.</Text>
      <CardGrid items={examples} keyExtractor={card => card.id} minCardWidth={208} maxCardWidth={300} textScale={fontScale} gap={12}
        renderItem={card => <BangCardView card={card} fluid idPrefix="rules" />} />
      <View nativeID="bang-rules-distance" style={{ gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border }}>
        <Text style={{ ...body, fontFamily: 'Outfit_700Bold' }}>Example without distance modifiers</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          {['You', 'Neighbour: distance 1', 'Two seats away: distance 2'].map((label, index) => <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: '100%' }}>
            {index > 0 ? <MaterialCommunityIcons accessible={false} name="arrow-right" size={20} color={C.gold} /> : null}<Text style={{ ...body, flexShrink: 1 }}>{label}</Text>
          </View>)}
        </View>
        <Text style={body}>Count the shorter route around living players. A weapon increases BANG! range, not every card’s reach. Panic! still requires distance 1.</Text>
      </View>
    </View>
  </View>;
}
