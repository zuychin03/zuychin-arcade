import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LIBERTALIA } from '../../constants/theme';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { CardGrid } from '../ui/CardGrid';

const CARD_GAP = 12;

interface Props {
  ranks: readonly number[];
  textScale?: number;
  renderCard: (card: number, onFocus?: () => void, fluid?: boolean) => ReactNode;
}

export function libertaliaHandWidth(viewport: number, fontScale: number, web: boolean) {
  const width = Number.isFinite(viewport) && viewport > 0 ? viewport : 280;
  const available = Math.max(1, width - 8);
  const scale = !web && Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  return available < 280 ? available : Math.min(360 * scale, available - 20);
}

export function libertaliaHandBrowseOffset(offset: number, maximum: number, anchors: number[], direction: -1 | 1) {
  const limit = Number.isFinite(maximum) ? Math.max(0, maximum) : 0;
  const current = Number.isFinite(offset) ? Math.max(0, Math.min(limit, offset)) : 0;
  const points = [...new Set([0, ...anchors, limit])].filter(point => Number.isFinite(point) && point >= 0 && point <= limit).sort((a, b) => a - b);
  return direction === 1 ? points.find(point => point > current + 1) ?? limit : [...points].reverse().find(point => point < current - 1) ?? 0;
}

export function libertaliaHandFocusOffset(offset: number, maximum: number, anchor: number, width: number, viewport: number) {
  const limit = Number.isFinite(maximum) ? Math.max(0, maximum) : 0;
  const current = Number.isFinite(offset) ? Math.max(0, Math.min(limit, offset)) : 0;
  if (![anchor, width, viewport].every(Number.isFinite) || anchor < 0 || width <= 0 || viewport <= 0) return current;
  const left = anchor + 4, right = left + width;
  if (left >= current && right <= current + viewport) return current;
  return Math.max(0, Math.min(limit, left < current || width > viewport ? anchor : right - viewport + 4));
}

export function libertaliaHandPosition(offset: number, anchors: (number | undefined)[], count: number) {
  let nearest = 0, distance = Infinity;
  anchors.forEach((anchor, index) => {
    if (anchor !== undefined && Number.isFinite(anchor) && Math.abs(anchor - offset) < distance) {
      distance = Math.abs(anchor - offset); nearest = index;
    }
  });
  return count ? Math.min(count, nearest + 1) : 0;
}

export function LibertaliaHand({ ranks, textScale = 1, renderCard }: Props) {
  const { width, fontScale = 1 } = useWindowDimensions();
  const reduceMotion = useReducedMotionPreference();
  const rail = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  const [viewport, setViewport] = useState(Math.max(1, width - 64));
  const [contentWidth, setContentWidth] = useState(0);
  const [offset, setOffset] = useState(0);
  const scale = Math.max(1, Number.isFinite(fontScale) ? fontScale : 1, Number.isFinite(textScale) ? textScale : 1);
  const horizontal = viewport < 600 * scale;
  const identity = JSON.stringify(ranks);
  const maximum = Math.max(0, contentWidth - viewport);
  const cardWidth = libertaliaHandWidth(viewport, fontScale, Platform.OS === 'web');
  const positions = ranks.map((_, index) => index * (cardWidth + CARD_GAP));
  const current = libertaliaHandPosition(offset, positions, ranks.length);

  useEffect(() => {
    offsetRef.current = 0;
    setOffset(0);
    rail.current?.scrollTo({ x: 0, animated: false });
  }, [identity, horizontal]);

  const browse = (direction: -1 | 1) => {
    const next = libertaliaHandBrowseOffset(offsetRef.current, maximum, positions, direction);
    offsetRef.current = next; setOffset(next);
    rail.current?.scrollTo({ x: next, animated: !reduceMotion });
  };
  const reveal = (id: number) => {
    const anchor = positions[ranks.findIndex(card => card === id)];
    if (anchor === undefined) return;
    const next = libertaliaHandFocusOffset(offsetRef.current, maximum, anchor, cardWidth, viewport);
    if (next === offsetRef.current) return;
    offsetRef.current = next; setOffset(next);
    rail.current?.scrollTo({ x: next, animated: false });
  };

  if (!ranks.length) return null;
  return <View testID="libertalia-hand-ranks" onLayout={event => setViewport(event.nativeEvent.layout.width)} style={styles.root}>
    {horizontal ? <>
      {ranks.length > 1 ? <View style={styles.toolbar}>
        <Text testID="libertalia-hand-position" accessibilityLiveRegion="polite" style={styles.position}>Crew {current} of {ranks.length} · swipe or browse</Text>
        <View style={styles.controls}>
          {([-1, 1] as const).map(direction => {
            const disabled = direction === -1 ? offset <= 1 : offset >= maximum - 1;
            return <Pressable key={direction} accessibilityRole="button" accessibilityLabel={direction === -1 ? 'Previous hand card' : 'Next hand card'} accessibilityHint="Browse your hand without selecting or submitting crew" disabled={disabled} accessibilityState={{ disabled }} onPress={() => browse(direction)}
              style={({ pressed }) => [styles.browse, { borderColor: disabled ? LIBERTALIA.border : LIBERTALIA.gold, backgroundColor: pressed && !disabled ? LIBERTALIA.panel : LIBERTALIA.surface }]}>
              <MaterialCommunityIcons accessible={false} name={direction === -1 ? 'chevron-left' : 'chevron-right'} size={24} color={disabled ? LIBERTALIA.muted : LIBERTALIA.gold} />
            </Pressable>;
          })}
        </View>
      </View> : null}
      <ScrollView ref={rail} testID="libertalia-hand-rail" horizontal showsHorizontalScrollIndicator
        onLayout={event => setViewport(event.nativeEvent.layout.width)} onContentSizeChange={next => setContentWidth(next)}
        onScroll={event => { offsetRef.current = event.nativeEvent.contentOffset.x; setOffset(offsetRef.current); }} scrollEventThrottle={32}
        style={styles.rail} contentContainerStyle={styles.railContent}>
        {ranks.map(card => <View key={card} style={{ width: cardWidth, flexShrink: 0 }}>
          {renderCard(card, () => reveal(card), true)}
        </View>)}
      </ScrollView>
    </> : <CardGrid testID="libertalia-hand-grid" items={ranks} keyExtractor={String} minCardWidth={250} maxCardWidth={320} textScale={scale} renderItem={card => renderCard(card, undefined, true)} />}
  </View>;
}

const styles = StyleSheet.create({
  root: { minWidth: 0, maxWidth: '100%', gap: 8 },
  toolbar: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  position: { flexGrow: 1, flexShrink: 1, flexBasis: 160, fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 21, color: LIBERTALIA.text },
  controls: { flexDirection: 'row', gap: 8 },
  browse: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rail: { width: '100%', maxWidth: '100%' },
  railContent: { gap: CARD_GAP, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 12, alignItems: 'stretch' },
});
