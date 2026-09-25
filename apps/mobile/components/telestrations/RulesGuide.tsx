import { TYPOGRAPHY } from '../../constants/typography';
import { Text, View } from 'react-native';
import type { TelestrationsDrawing } from '@zuychin-arcade/types';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RelayDiagram } from './RelayDiagram';
import { Drawing } from './Drawing';
import { TELESTRATIONS as C } from './palette';

const body = { color: C.text, fontFamily: TYPOGRAPHY.body.fontFamily, fontSize: 16, lineHeight: 25 } as const;
const heading = { color: C.accent, fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 23, lineHeight: 30 } as const;
const example: TelestrationsDrawing = { strokes: [
  { color: 1, width: 1, points: [[800, 2500], [3300, 2500], [2850, 3100], [1250, 3100], [800, 2500]] },
  { color: 1, width: 1, points: [[2050, 2500], [2050, 700], [3150, 2250], [2050, 2250]] },
  { color: 1, width: 1, points: [[1850, 1000], [900, 2250], [1850, 2250], [1850, 1000]] },
] };

export function TelestrationsRulesGuide() {
  return <View testID="telestrations-rules-guide" style={{ gap: 24, minWidth: 0 }}>
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={heading}>How the sketchbooks travel</Text>
      <Text style={body}>4–12 players, three rounds. Draw what you read, guess what you see, and enjoy the unexpected changes. No drawing skill required.</Text>
    </View>
    <RelayDiagram />
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>Start with a secret</Text>
      <Text style={body}>Choose one of your three original prompt offers. With a shared category, invent your own secret within it instead. Do not say it aloud or show other players.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        {([[false, 'Even table', 'Draw your own prompt first.'], [true, 'Odd table', 'Your book passes before the first drawing.']] as const).map(([odd, label, detail]) => <View key={label} style={{ flexGrow: 1, flexBasis: 190, minWidth: 0, gap: 8 }}>
          <MaterialCommunityIcons name={odd ? 'book-arrow-right-outline' : 'book-open-blank-variant'} color={C.secondary} size={36} accessible={false} />
          <Text style={{ ...body, fontFamily: TYPOGRAPHY.heading.fontFamily }}>{label}</Text><Text style={body}>{detail}</Text>
        </View>)}
      </View>
      <Text style={body}>The server assigns the right page. Alternate drawing and guessing until every book returns to its owner with a guess last. The selected passing direction applies to everyone.</Text>
    </View>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={heading}>See only the previous page</Text>
      <Text style={body}>Example only: a secret “sailing boat” becomes this drawing. The next player sees the drawing and might guess “a yacht”. The secret stays hidden until the reveal.</Text>
      <View accessible accessibilityLabel="Example drawing of a sailing boat, with a hull and two sails" style={{ width: '100%', maxWidth: 280, alignSelf: 'center' }}>
        <Drawing drawing={example} />
      </View>
      <Text style={body}>The same drawing surface appears in your sketchbook. Draw pictures only. Open the chapters below for page rules, scoring modes and reconnect behaviour.</Text>
    </View>
  </View>;
}
