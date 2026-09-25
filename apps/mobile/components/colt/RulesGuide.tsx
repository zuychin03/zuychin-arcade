import { Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ColtAction } from '@zuychin-arcade/types';
import { COLT as C } from '../../constants/theme';
import { ActionArtwork } from './ActionArtwork';
import { BanditPiece } from './TrainBoard';
import { COLT_ACTION_HELP } from './decision';
import { CardGrid } from '../ui/CardGrid';
import { CardSurface } from '../ui/CardSurface';
import { useMeasuredTextScale } from '../../hooks/useMeasuredTextScale';

const body = { fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, color: C.text } as const;
const heading = { fontFamily: 'Outfit_800ExtraBold', fontSize: 22, lineHeight: 28, color: C.ember } as const;
const program: { action: ColtAction; label: string }[] = [{ action: 'move', label: 'First: move' }, { action: 'rob', label: 'Next: rob' }, { action: 'shoot', label: 'Then: shoot' }];

export function ColtRulesGuide() {
  const { fontScale } = useWindowDimensions();
  const { textRef, onTextLayout, textScale } = useMeasuredTextScale(16, fontScale);
  return <View nativeID="colt-rules-guide" style={{ gap: 28, minWidth: 0 }}>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>Plan now. Find out later.</Text>
      <Text ref={textRef} onLayout={onTextLayout} style={body}>Take turns adding actions to one shared program. Nobody moves yet. Once programming ends, reveal and execute the cards in that same order.</Text>
      <Text style={{ ...body, fontFamily: 'Outfit_700Bold' }}>Illustrative shared sequence, not a live program</Text>
      <CardGrid items={program} keyExtractor={item => item.action} minCardWidth={200} maxCardWidth={300} textScale={textScale} gap={12} renderItem={item => <CardSurface fill radius={12} faceColor={C.panel} edgeColor={C.bg} highlightColor={C.border} depth={3}>
        <View style={{ padding: 16 }}><Text style={{ ...body, fontFamily: 'Outfit_800ExtraBold' }}>{item.label}</Text></View>
        <ActionArtwork action={item.action} />
        <View style={{ padding: 16 }}><Text style={body}>{COLT_ACTION_HELP[item.action]}</Text></View>
      </CardSurface>} />
      <Text style={body}>Earlier actions may move your target or take the loot you wanted. Choose from the legal options when your action actually executes. A tunnel hides programmed cards until then.</Text>
    </View>
    <View nativeID="colt-rules-train" style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>Two levels change the robbery</Text>
      <Text style={body}>Example: two adjacent carriages. Each roof and interior is a separate space. The Marshal stays inside; bandits meeting him escape to the roof.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        {[0, 1].map(car => <View key={car} style={{ flexBasis: 220, flexGrow: 1, minWidth: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomWidth: 5, borderBottomColor: C.bg, backgroundColor: C.panel, padding: 16, gap: 12 }}>
          <Text style={{ ...body, fontFamily: 'Outfit_700Bold' }}>Carriage {car + 1}</Text>
          <View style={{ gap: 8, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 12 }}><Text style={body}>Roof</Text>{car === 0 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><BanditPiece character="doc" /><Text style={body}>Bandit after escape</Text></View> : <Text style={{ ...body, color: C.muted }}>Empty in this example</Text>}</View>
          <View style={{ gap: 8 }}><Text style={body}>Inside</Text>{car === 0 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><BanditPiece marshal /><Text style={body}>Marshal</Text></View> : <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><MaterialCommunityIcons accessible={false} name="treasure-chest" size={36} color={C.gold} /><Text style={{ ...body, flex: 1 }}>Loot to rob</Text></View>}</View>
        </View>)}
      </View>
      <Text style={body}>Move one car inside or one to three cars on the roof. Floor changes level in your current car. Rob takes loot only from your exact space.</Text>
    </View>
    <View style={{ gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.border }}>
      <Text accessibilityRole="header" style={heading}>Bullets clog your future hand</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}><ActionArtwork action="bullet" size={80} /><Text style={{ ...body, flexBasis: 200, flexGrow: 1 }}>Received bullets are useless cards in later hands. You can draw three cards instead of programming an action.</Text></View>
      <Text style={body}>After five rounds, add your loot and any $1000 Gunslinger prize. Most wealth wins. In a tie, fewer received bullets wins; a remaining tie shares victory.</Text>
    </View>
  </View>;
}
