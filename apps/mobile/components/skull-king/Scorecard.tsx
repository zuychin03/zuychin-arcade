import { useState } from 'react';
import { Text, View } from 'react-native';
import type { SkullKingRoundScore } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { SKULL_KING } from '../../constants/theme';
import { CardSurface } from '../ui/CardSurface';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export function SkullKingScorecard({ history }: { history: SkullKingRoundScore[] }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const index = Math.max(0, Math.min(selected ?? history.length - 1, history.length - 1));
  const round = history[index];
  return <View testID="skull-score-ledger" style={{ maxWidth: '100%', minWidth: 0 }}><CardSurface radius={14} faceColor={SKULL_KING.surface} edgeColor={SKULL_KING.bg} highlightColor={`${SKULL_KING.teal}55`} depth={2}><View style={{ padding: 12, gap: 12 }}>
    <ScalePressable accessibilityLabel={expanded ? 'Hide completed-round scorecard' : 'Show completed-round scorecard'}
      accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}
      style={{ minHeight: 48, justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <MaterialCommunityIcons name="book-open-page-variant-outline" size={24} color={SKULL_KING.gold} accessible={false} />
        <Text style={{ flex: 1, minWidth: 0, color: SKULL_KING.text, fontFamily: 'Outfit_700Bold', fontSize: 16, lineHeight: 22 }}>{expanded ? 'HIDE SCORECARD' : 'COMPLETED-ROUND SCORECARD'}</Text>
        <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={SKULL_KING.teal} accessible={false} />
      </View>
      <Text style={{ marginTop: 6, color: SKULL_KING.muted, fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 20 }}>{history.length} completed {history.length === 1 ? 'round' : 'rounds'}. Bids, tricks and points.</Text>
    </ScalePressable>
    {expanded && !round ? <Text style={{ color: SKULL_KING.muted, fontSize: 14 }}>Scores appear after the first round. Current secret bids are never shown here.</Text> : null}
    {expanded && round ? <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: SKULL_KING.border }}>
        <ScalePressable accessibilityLabel="Previous scored round" disabled={index === 0} onPress={() => setSelected(index - 1)} style={{ minWidth: 48, minHeight: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', opacity: index === 0 ? 0.4 : 1 }}><Text style={{ color: SKULL_KING.teal, fontFamily: 'Outfit_700Bold', fontSize: 14, lineHeight: 20 }}>PREV</Text></ScalePressable>
        <Text accessibilityRole="header" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 120, minWidth: 0, textAlign: 'center', color: SKULL_KING.text, fontFamily: 'Outfit_700Bold', fontSize: 16, lineHeight: 22 }}>Round {round.roundNumber} · {round.cardsPerPlayer} {round.cardsPerPlayer === 1 ? 'card' : 'cards'}</Text>
        <ScalePressable accessibilityLabel="Next scored round" disabled={index === history.length - 1} onPress={() => setSelected(index + 1)} style={{ minWidth: 48, minHeight: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', opacity: index === history.length - 1 ? 0.4 : 1 }}><Text style={{ color: SKULL_KING.teal, fontFamily: 'Outfit_700Bold', fontSize: 14, lineHeight: 20 }}>NEXT</Text></ScalePressable>
      </View>
      {round.players.map((row) => <View key={row.playerId} accessible accessibilityLabel={`${row.displayName}. Bid ${row.bid}, won ${row.tricksWon}. Base ${row.baseScore}, bonus ${row.bonus}, round ${row.roundScore}, total ${row.totalScore}.${row.forfeited ? ' Forfeited; historical score only.' : ''}`} style={{ paddingBottom: 12, gap: 5, borderBottomWidth: 1, borderBottomColor: SKULL_KING.border }}>
        <Text style={{ color: row.forfeited ? SKULL_KING.coral : SKULL_KING.text, fontFamily: 'Outfit_700Bold', fontSize: 15, lineHeight: 21 }}>{row.displayName}{row.forfeited ? ' · FORFEITED' : ''}</Text>
        <Text style={{ color: SKULL_KING.muted, fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 20 }}>Bid {row.bid} · Won {row.tricksWon} · Base {row.baseScore} · Bonus {row.bonus}</Text>
        <Text style={{ color: SKULL_KING.gold, fontFamily: 'SpaceMono_700Bold', fontSize: 14, lineHeight: 20 }}>Round {row.roundScore >= 0 ? '+' : ''}{row.roundScore} · Total {row.totalScore}</Text>
      </View>)}
      <Text style={{ color: SKULL_KING.muted, fontFamily: 'Outfit_400Regular', fontSize: 14 }}>Round score = base + awarded bonus. Capture bonuses count only when the bid is exact.</Text>
    </> : null}
  </View></CardSurface></View>;
}
