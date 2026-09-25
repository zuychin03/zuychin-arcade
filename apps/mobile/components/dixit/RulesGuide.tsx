import { TYPOGRAPHY } from '../../constants/typography';
import { Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DIXIT as C } from '../../constants/theme';
import { DreamCard } from './DreamCard';

const body = { color: C.text, fontFamily: TYPOGRAPHY.body.fontFamily, fontSize: 16, lineHeight: 25 } as const;
const heading = { color: C.accent, fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 23, lineHeight: 30 } as const;

export function DixitRulesGuide() {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(160, Math.max(90, (width - 96) / 2));
  return <View testID="dixit-rules-guide" style={{ gap: 24, minWidth: 0 }}>
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={heading}>An image, a clue, many meanings</Text>
      <Text style={body}>3–12 storytellers. Reach 30 points, then finish that round. The highest score wins; tied leaders share the win.</Text>
      <Text style={body}>The storyteller chooses one image from their hand and gives a clue. A word, a phrase or a short quotation can work. Aim for a clue that some people understand, but not everyone.</Text>
    </View>
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
        <DreamCard cardId="dream-01" width={cardWidth} />
        <DreamCard cardId="dream-02" width={cardWidth} />
      </View>
      <Text style={body}>Public example images, not anyone’s hand. A clue can connect to a small detail, an atmosphere or an unexpected association.</Text>
      <Text style={body}>Everyone else secretly chooses one image that could fit the clue. The table shuffles those images with the storyteller’s image. You cannot see who contributed each one yet.</Text>
    </View>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>Two votes, one storyteller’s image</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        {['Both on one image', 'One on each of two images'].map((label, index) => <View key={label} style={{ flexGrow: 1, flexBasis: 200, minWidth: 0, gap: 8 }}>
          <View accessible accessibilityLabel={index === 0 ? 'Two votes together' : 'Two votes split'} style={{ flexDirection: 'row', gap: index === 0 ? 4 : 32 }}>
            <MaterialCommunityIcons name="circle-double" size={28} color={C.accent} accessible={false} />
            <MaterialCommunityIcons name="circle-double" size={28} color={C.secondary} accessible={false} />
          </View>
          <Text style={{ ...body, fontFamily: TYPOGRAPHY.heading.fontFamily }}>{label}</Text>
        </View>)}
      </View>
      <Text style={body}>Place both votes on one image, or split them across two. You cannot vote for your own image. The storyteller does not vote. Votes stay secret until everyone has locked theirs in.</Text>
      <Text style={body}>The reveal shows which image was the storyteller’s. Open the scoring chapter below to distinguish some, all or no votes finding it.</Text>
    </View>
  </View>;
}
