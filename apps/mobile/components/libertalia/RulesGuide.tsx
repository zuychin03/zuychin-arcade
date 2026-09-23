import { Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LIBERTALIA as C } from '../../constants/theme';
import { CrewCard } from './CrewCard';
import { LibertaliaLootArtwork } from './LibertaliaArtwork';
import { CardGrid } from '../ui/CardGrid';

const body = { fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, color: C.text } as const;
const heading = { fontFamily: 'Outfit_800ExtraBold', fontSize: 22, lineHeight: 28, color: C.sky } as const;

export function LibertaliaRulesGuide() {
  const { fontScale } = useWindowDimensions();
  return <View nativeID="libertalia-rules-guide" style={{ gap: 28, minWidth: 0 }}>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>The same crew. Different choices.</Text>
      <Text style={body}>Each voyage adds the same six crew ranks to every player’s hand. Choose one secretly each day. Everyone reveals together, so knowing the available crew is part of the contest.</Text>
      <View style={{ gap: 8, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
        <Text style={{ ...body, fontFamily: 'Outfit_700Bold' }}>Illustrative reveal: rank 8 before rank 12</Text>
        <Text style={body}>The island sorts low to high. Higher reputation breaks a tie between equal ranks.</Text>
      </View>
      <CardGrid items={[8, 12]} keyExtractor={String} minCardWidth={220} maxCardWidth={320} textScale={fontScale} gap={12}
        renderItem={rank => <CrewCard rank={rank} fluid nativeID={`libertalia-rules-rank-${rank}`} />} />
    </View>
    <View nativeID="libertalia-rules-directions" style={{ gap: 20 }}>
      <Text accessibilityRole="header" style={heading}>One island, two directions</Text>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><MaterialCommunityIcons accessible={false} name="white-balance-sunny" size={28} color={C.gold} /><Text style={{ ...body, fontFamily: 'Outfit_800ExtraBold', flex: 1 }}>Day: low rank to high</Text></View>
        <Text style={body}>Resolve daytime powers from left to right. These can change who is still on the island before loot is chosen.</Text>
      </View>
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><MaterialCommunityIcons accessible={false} name="weather-sunset" size={28} color={C.gold} /><Text style={{ ...body, fontFamily: 'Outfit_800ExtraBold', flex: 1 }}>Dusk: high rank to low</Text></View>
        <Text style={body}>Take one available loot token, then resolve that crew member’s and token’s dusk powers in your chosen order. A surviving crew member enters your ship.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
          {([{ kind: 'chest', label: 'Chest: 5 at anchor' }, { kind: 'barrel', label: 'Barrel: reputation at dusk, 1 at anchor' }] as const).map(({ kind, label }) => <View key={kind} style={{ flexBasis: 180, flexGrow: 1, gap: 8, alignItems: 'flex-start', minWidth: 0 }}><LibertaliaLootArtwork kind={kind} size={80} /><Text style={body}>Example loot: {label}</Text></View>)}
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><MaterialCommunityIcons accessible={false} name="weather-night" size={28} color={C.violet} /><Text style={{ ...body, fontFamily: 'Outfit_800ExtraBold', flex: 1 }}>Night: your ship works again</Text></View>
        <Text style={body}>Resolve night powers in your ship, including crew from previous days. When several are yours, choose their order.</Text>
      </View>
    </View>
    <View style={{ gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.border }}>
      <Text accessibilityRole="header" style={heading}>Anchor, bank, sail again</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{[4, 5, 6].map((days, index) => <View key={days} style={{ flexGrow: 1, flexBasis: 120, gap: 4 }}><MaterialCommunityIcons accessible={false} name="anchor" size={28} color={C.gold} /><Text style={{ ...body, fontFamily: 'Outfit_700Bold' }}>Voyage {index + 1}</Text><Text style={body}>{days} days</Text></View>)}</View>
      <Text style={body}>Resolve anchor powers, bank doubloons into protected score, then clear the voyage. Unused hand cards remain. After the third voyage, highest score wins; reputation breaks a tie.</Text>
    </View>
  </View>;
}
