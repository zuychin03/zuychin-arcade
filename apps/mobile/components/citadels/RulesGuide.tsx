import { TYPOGRAPHY } from '../../constants/typography';
import { Text, View } from 'react-native';
import { CITADELS_COLOR_LABELS, CITADELS_DISTRICT_MANIFEST, CITADELS_ROLES } from '@zuychin-arcade/types';
import { CitadelsDistrictView, CitadelsRoleCard, DISTRICT_COLOR } from './CitadelsCard';
import { CITADELS as C } from '../../constants/theme';

const body = { fontFamily: TYPOGRAPHY.body.fontFamily, fontSize: 16, lineHeight: 25, color: C.text } as const;
const heading = { fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 23, lineHeight: 30, color: C.gold } as const;
const examples = ['manor', 'temple', 'tavern', 'watchtower', 'keep'];

export function CitadelsRulesGuide() {
  return <View testID="citadels-rules-guide" style={{ gap: 24, minWidth: 0 }}>
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={heading}>Build a city. Conceal your next move.</Text>
      <Text style={body}>Draft a character each round. Their rank decides when you act; their power helps you build the most valuable city. Building a seventh district makes the current round the final round, not an instant victory.</Text>
    </View>
    <View style={{ gap: 14 }}>
      <Text accessibilityRole="header" style={heading}>From secret choice to public court</Text>
      {[
        ['1 · Draft privately', 'The crowned player chooses first, then passes the remaining characters. Removed and unchosen roles mean you cannot assume every character belongs to a player.'],
        ['2 · Call ranks 1 to 8', 'Reveal when your character is called, not when your seat comes around. A murdered character loses its turn.'],
        ['3 · Gather, then build', 'Take two gold or draw district cards and keep one. Pay a district’s cost to build it. Normally you may build one district; the Architect may build three.'],
      ].map(([title, text]) => <View key={title} style={{ gap: 5, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Text style={{ ...body, fontFamily: TYPOGRAPHY.heading.fontFamily, color: C.royal }}>{title}</Text><Text style={body}>{text}</Text>
      </View>)}
      <Text style={body}>Example: a player seated after you chooses the Assassin, while you choose the Architect. Their rank 1 acts before your rank 7. Seat order does not decide character turns.</Text>
    </View>
    <View nativeID="citadels-rules-characters" style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>Meet the court, in call order</Text>
      <Text style={body}>These are the eight available characters, not anyone’s current secret choice.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'stretch', justifyContent: 'center' }}>
        {CITADELS_ROLES.map(info => <CitadelsRoleCard key={info.role} role={info.role} />)}
      </View>
    </View>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>Read a district</Text>
      <Text style={body}>The gold number is its build cost and usually its final points. The labelled colour identifies its type. You cannot build the same district name twice.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {Object.entries(CITADELS_COLOR_LABELS).map(([key, label]) => <Text key={key} style={{ ...body, color: DISTRICT_COLOR[key as keyof typeof DISTRICT_COLOR], fontFamily: TYPOGRAPHY.heading.fontFamily }}>{label}</Text>)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
        {examples.map(id => {
          const district = CITADELS_DISTRICT_MANIFEST.find(card => card.templateId === id)!;
          return <CitadelsDistrictView key={id} card={{ ...district, id: `guide-${id}` }} />;
        })}
      </View>
      <Text style={body}>Illustrated example: these five different types cost 9 gold in total and score 9 district points plus the 3-point diversity bonus. This five-district example has no completion bonus.</Text>
      <Text style={body}>At seven districts, the first completed city earns 4 extra points; another completed city earns 2. Finish calling the remaining characters, then add any unique-district bonuses.</Text>
    </View>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>The unique-district collection</Text>
      <Text style={body}>This table enables these 14 unique districts. Their printed effects change the normal building, income or scoring rules.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
        {CITADELS_DISTRICT_MANIFEST.filter(card => card.color === 'unique').map(card => <CitadelsDistrictView key={card.templateId} card={{ ...card, id: `guide-unique-${card.templateId}` }} />)}
      </View>
    </View>
  </View>;
}
