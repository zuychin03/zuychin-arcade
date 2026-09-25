import { TYPOGRAPHY } from '../../constants/typography';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { SkullKingCard } from '@zuychin-arcade/types';
import { SKULL_KING } from '../../constants/theme';
import { SkullKingCardView } from './SkullKingCard';
import { useIntrinsicCardHeight } from '../../hooks/useIntrinsicCardHeight';
import { useMeasuredTextScale } from '../../hooks/useMeasuredTextScale';

const TRICK: SkullKingCard[] = [
  { id: 'rules-led', kind: 'number', suit: 'green', rank: 12 },
  { id: 'rules-trump', kind: 'number', suit: 'black', rank: 2 },
];
const CHARACTERS: SkullKingCard[] = [
  { id: 'rules-pirate', kind: 'pirate' },
  { id: 'rules-king', kind: 'skull_king' },
  { id: 'rules-mermaid', kind: 'mermaid' },
];

export function SkullKingRulesGuide() {
  const { width, fontScale } = useWindowDimensions();
  const { textRef, onTextLayout, textScale } = useMeasuredTextScale(16, fontScale);
  const faces = useIntrinsicCardHeight([...TRICK, ...CHARACTERS].map(card => card.id), `rules:${width}:${textScale}`);
  return <View testID="skull-rules-guide" style={s.guide}>
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.title}>Predict your tricks, not your points</Text>
      <Text ref={textRef} onLayout={onTextLayout} style={s.body}>A trick is one card from each captain. Bid secretly before the round. These example cards show how to read a trick.</Text>
      <View style={s.cards}>
        {TRICK.map((card, index) => <View key={card.id} style={s.example}><SkullKingCardView card={card} compact faceSizing={faces.forCard(card.id)} /><Text style={s.caption}>{index === 0 ? 'Green leads' : 'Black trump wins'}</Text></View>)}
      </View>
      <Text style={s.body}>Follow the led numbered suit if you can, or play a special card. Black trumps the other suits. Without trump or specials, the highest card of the led suit wins.</Text>
    </View>

    <View nativeID="skull-rules-hierarchy" style={s.section}>
      <Text accessibilityRole="header" style={s.title}>The royal exception</Text>
      <Text style={s.body}>These three characters beat numbered cards, but they do not form a simple strongest-to-weakest ladder.</Text>
      <View style={s.characters}>
        {CHARACTERS.map((card, index) => <View key={card.id} style={s.characterRow}>
          <SkullKingCardView card={card} compact faceSizing={faces.forCard(card.id)} />
          <Text style={[s.body, s.explanation]}>{[
            'Pirate beats Mermaid. The first Pirate wins a Pirate tie.',
            'Skull King beats Pirates.',
            'Mermaid beats the Skull King. When all three appear, the first Mermaid wins the trick.',
          ][index]}</Text>
        </View>)}
      </View>
      <Text style={s.caption}>Escape normally loses. Tigress lets you choose Pirate or Escape when you play her.</Text>
    </View>

    <View style={s.section}>
      <Text accessibilityRole="header" style={s.title}>Your scorecard, worked out</Text>
      <View style={s.scorecard}>
        <Text style={s.scoreLabel}>Bid 3 · Win 3</Text>
        <Text style={s.score}>3 × 20 = +60</Text>
        <Text style={s.body}>Exact positive bid: 20 points per trick.</Text>
        <View style={s.rule} />
        <Text style={s.scoreLabel}>Bid 3 · Win 2</Text>
        <Text style={s.miss}>1 short = −10</Text>
        <Text style={s.body}>Miss by any amount: lose 10 per trick above or below your bid.</Text>
        <View style={s.rule} />
        <Text style={s.scoreLabel}>Round 4 · Bid 0</Text>
        <Text style={s.score}>No tricks: +40</Text>
        <Text style={s.miss}>Any trick: −40</Text>
        <Text style={s.body}>Zero bids risk 10 points per card dealt. Capture bonuses count only when your bid is exact.</Text>
      </View>
    </View>
  </View>;
}

const s = StyleSheet.create({
  guide: { gap: 28 }, section: { gap: 12 },
  title: { fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 22, lineHeight: 28, color: SKULL_KING.teal },
  body: { fontFamily: TYPOGRAPHY.body.fontFamily, fontSize: 16, lineHeight: 24, color: SKULL_KING.text },
  caption: { fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 16, lineHeight: 24, color: SKULL_KING.cyan },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center', alignItems: 'flex-start' },
  example: { gap: 8, alignItems: 'center', maxWidth: '100%' },
  characters: { gap: 20 }, characterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center' },
  explanation: { flexGrow: 1, flexShrink: 1, flexBasis: 140, minWidth: 0 },
  scorecard: { gap: 8, padding: 16, backgroundColor: SKULL_KING.bg, borderRadius: 12 },
  scoreLabel: { fontFamily: TYPOGRAPHY.heading.fontFamily, fontSize: 18, lineHeight: 26, color: SKULL_KING.text },
  score: { fontFamily: 'SpaceMono_700Bold', fontSize: 22, lineHeight: 32, color: SKULL_KING.gold },
  miss: { fontFamily: 'SpaceMono_700Bold', fontSize: 20, lineHeight: 30, color: SKULL_KING.coral },
  rule: { height: 1, backgroundColor: SKULL_KING.border, marginVertical: 8 },
});
