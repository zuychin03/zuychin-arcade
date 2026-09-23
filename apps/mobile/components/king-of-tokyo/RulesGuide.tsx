import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TOKYO } from '../../constants/theme';
import { TokyoDie } from './TokyoDie';
import { useMeasuredTextScale } from '../../hooks/useMeasuredTextScale';

const noAction = () => {};

export function TokyoRulesGuide() {
  const { fontScale } = useWindowDimensions();
  const { textRef, onTextLayout, textScale } = useMeasuredTextScale(16, fontScale);
  return <View testID="tokyo-rules-guide" style={s.guide}>
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.title}>Keep the set. Reroll the rest.</Text>
      <Text ref={textRef} onLayout={onTextLayout} style={s.body}>Six dice, up to three rolls. This example keeps three 2s. Before either reroll, you may keep or release any die.</Text>
      <View style={s.tray}>
        <View style={s.dice}>{[0, 1, 2].map(index => <TokyoDie key={index} face={2} index={index} selectionState="kept" size={80} textScale={textScale} interactive={false} onPress={noAction} />)}</View>
        <Text style={s.caption}>Kept: three 2s score 2 points.</Text>
        <View style={s.dice}>{(['energy', 'heart', 'smash'] as const).map((face, index) => <TokyoDie key={face} face={face} index={index + 3} size={80} textScale={textScale} interactive={false} onPress={noAction} />)}</View>
        <Text style={s.caption}>Unkept: these three may be rerolled.</Text>
      </View>
      <Text style={s.body}>A fourth 2 adds 1 point: four 2s score 3. You can stop early, but all final dice resolve in the category order you choose.</Text>
    </View>

    <View nativeID="tokyo-rules-crossfire" style={s.section}>
      <Text accessibilityRole="header" style={s.title}>Tokyo changes who you hit</Text>
      <View style={s.zone}>
        <View style={s.zoneHeading}><MaterialCommunityIcons name="city-variant" size={36} color={TOKYO.lime} accessible={false} /><Text style={s.zoneTitle}>Inside Tokyo</Text></View>
        <Text style={s.body}>Your Smash hits every monster outside. Rolled Hearts cannot heal you here.</Text>
        <View style={s.rewards}><Text style={s.reward}>Enter: +1 point</Text><Text style={s.reward}>Start a turn here: +2</Text></View>
      </View>
      <View style={s.crossfire}>
        <MaterialCommunityIcons name="arrow-up-down-bold" size={32} color={TOKYO.danger} accessible={false} />
        <Text style={[s.caption, s.flex]}>Smash crosses the Tokyo boundary.</Text>
      </View>
      <View style={s.outside}>
        <View style={s.zoneHeading}><MaterialCommunityIcons name="paw" size={32} color={TOKYO.cyan} accessible={false} /><Text style={s.zoneTitle}>Outside Tokyo</Text></View>
        <Text style={s.body}>Your Smash hits every Tokyo occupant. Each Heart can heal 1 health, up to your limit.</Text>
      </View>
      <Text style={s.body}>After taking rolled Smash damage, a Tokyo occupant normally chooses whether to stay or yield. The attacker enters an open space during Enter Tokyo, even without a Smash roll.</Text>
    </View>

    <View style={s.section}>
      <Text accessibilityRole="header" style={s.title}>Spend energy. Survive the turn.</Text>
      <View style={s.finish}>
        <MaterialCommunityIcons name="lightning-bolt" size={36} color={TOKYO.energy} accessible={false} />
        <Text style={[s.body, s.flex]}>Each Energy die gives 1 cube. Buy powers from the three face-up market cards after resolving and entering Tokyo.</Text>
      </View>
      <Text style={s.caption}>Win with 20 points and survive the turn, or be the last living monster.</Text>
    </View>
  </View>;
}

const s = StyleSheet.create({
  guide: { gap: 28 }, section: { gap: 12 },
  title: { fontFamily: 'Outfit_800ExtraBold', fontSize: 22, lineHeight: 28, color: TOKYO.lime },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, color: TOKYO.text },
  caption: { fontFamily: 'Outfit_700Bold', fontSize: 16, lineHeight: 24, color: TOKYO.text },
  tray: { gap: 12, paddingVertical: 16, borderRadius: 12, backgroundColor: TOKYO.bg },
  dice: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  zone: { padding: 16, gap: 12, backgroundColor: TOKYO.panel, borderRadius: 12 },
  outside: { gap: 12, paddingVertical: 8 },
  zoneHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  zoneTitle: { fontFamily: 'Outfit_700Bold', fontSize: 20, lineHeight: 26, color: TOKYO.text, flexShrink: 1 },
  rewards: { gap: 4 }, reward: { fontFamily: 'Outfit_700Bold', fontSize: 16, lineHeight: 24, color: TOKYO.lime },
  crossfire: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  finish: { flexDirection: 'row', alignItems: 'center', gap: 12 }, flex: { flex: 1, minWidth: 0 },
});
