import { TYPOGRAPHY } from '../../constants/typography';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PathCard } from '@zuychin-arcade/types';
import { ARCADE, MINE } from '../../constants/theme';
import { PathCardView } from './cards/PathCardView';
import { ActionCardView } from './cards/ActionCardView';
import { useMeasuredTextScale } from '../../hooks/useMeasuredTextScale';

const STRAIGHT: PathCard = { id: 'rules-straight', type: 'path', subtype: 'tunnel', isDeadEnd: false, edges: { top: 'closed', right: 'open', bottom: 'closed', left: 'open', center: true } };
const CORNER: PathCard = { ...STRAIGHT, id: 'rules-corner', edges: { top: 'open', right: 'open', bottom: 'closed', left: 'closed', center: true } };

export function SaboteurRulesGuide() {
  const { width, fontScale } = useWindowDimensions();
  const { textRef, onTextLayout, textScale } = useMeasuredTextScale(16, fontScale);
  const actionWidth = Math.min(Math.max(96, width - 80), 96 * textScale);
  return <View testID="saboteur-rules-guide" style={s.guide}>
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.title}>Read the tunnel, not just the card</Text>
      <Text ref={textRef} onLayout={onTextLayout} style={s.body}>Miners connect the start to gold. Saboteurs quietly prevent it. These are example pieces, not your current mine.</Text>
      <View style={s.tunnel} accessible accessibilityLabel="Example tunnel fragment: three cards connect through matching open left and right edges.">
        <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.joined}>
          <PathCardView card={{ ...STRAIGHT, id: 'rules-start', subtype: 'start' }} width={64} height={88} />
          <PathCardView card={STRAIGHT} width={64} height={88} />
          <PathCardView card={STRAIGHT} width={64} height={88} />
        </View>
        <Text style={s.caption}>Start → continuous open tunnel</Text>
      </View>
      <Text style={s.body}>Every touching edge must match. The new card must connect back to the start through open tunnels.</Text>
      <View style={s.boundary}>
        <MaterialCommunityIcons name="grid" size={24} color={MINE.gold} accessible={false} />
        <Text style={[s.body, s.flex]}>Your mine stops at 5 columns × 9 rows. There is no placement beyond that boundary.</Text>
      </View>
    </View>

    <View style={s.section}>
      <Text accessibilityRole="header" style={s.title}>Turn the same card halfway</Text>
      <View style={s.rotation}>
        <View style={s.piece}><PathCardView card={CORNER} width={64} height={88} /><Text style={s.caption}>Before</Text></View>
        <View style={s.turn}><MaterialCommunityIcons name="rotate-right" size={28} color={MINE.gold} accessible={false} /><Text style={s.caption}>180°</Text></View>
        <View style={s.piece}><PathCardView card={CORNER} rotated width={64} height={88} /><Text style={s.caption}>After</Text></View>
      </View>
      <Text style={s.body}>Rotate 180°, never a quarter-turn. Rotation changes the openings, but it does not remove a dead end.</Text>
    </View>

    <View nativeID="saboteur-rules-tools" style={s.section}>
      <Text accessibilityRole="header" style={s.title}>One broken tool stops your dig</Text>
      <View style={s.tools}>
        <View style={[s.tool, { width: actionWidth }]}><ActionCardView card={{ id: 'rules-break', type: 'action', subtype: 'sabotage_pickaxe' }} width={actionWidth} height={132} /><Text style={s.caption}>Break a pickaxe</Text></View>
        <View style={[s.tool, { width: actionWidth }]}><ActionCardView card={{ id: 'rules-fix', type: 'action', subtype: 'repair_pickaxe' }} width={actionWidth} height={132} /><Text style={s.caption}>Repair that tool</Text></View>
      </View>
      <Text style={s.body}>Any broken lantern, cart or pickaxe blocks path placement. You can still play an action or discard. A matching repair restores that tool.</Text>
      <Text style={s.caption}>Each turn: play one card or discard one, then draw one if the deck has cards.</Text>
    </View>
  </View>;
}

const s = StyleSheet.create({
  guide: { gap: 28 }, section: { gap: 12 },
  title: { fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 22, lineHeight: 28, color: MINE.gold },
  body: { fontFamily: TYPOGRAPHY.body.fontFamily, fontSize: 16, lineHeight: 24, color: ARCADE.text },
  caption: { fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 16, lineHeight: 22, color: ARCADE.text, textAlign: 'center' },
  tunnel: { gap: 12, alignItems: 'center', paddingVertical: 16, backgroundColor: MINE.bg, borderRadius: 12 },
  joined: { flexDirection: 'row', gap: 2 }, boundary: { flexDirection: 'row', gap: 12, alignItems: 'center' }, flex: { flex: 1, minWidth: 0 },
  rotation: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', alignItems: 'center', paddingVertical: 8 },
  piece: { gap: 8, alignItems: 'center', maxWidth: '100%' }, turn: { gap: 4, alignItems: 'center' },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, justifyContent: 'center', alignItems: 'flex-start' },
  tool: { alignItems: 'center', gap: 8, width: 108, maxWidth: '100%' },
});
