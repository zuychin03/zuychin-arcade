import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NOT_ALONE_PLACE_BY_ID, type NotAlonePlaceId } from '@zuychin-arcade/types';
import { NOT_ALONE } from '../../constants/theme';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { NotAlonePlaceCard } from './PlaceCard';

interface Props {
  places: readonly NotAlonePlaceId[];
  selected: readonly NotAlonePlaceId[];
  selectionBlockedPlaces?: readonly NotAlonePlaceId[];
  onToggle: (place: NotAlonePlaceId) => void;
}

export function placeChoiceWidth(viewport: number, fontScale: number, web: boolean): number {
  const available = Number.isFinite(viewport) && viewport > 0 ? viewport : 280;
  const scale = !web && Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  return available < 260 ? available : Math.min(300 * scale, available - 20);
}

export function placeBrowseOffset(offset: number, maximum: number, anchors: number[], direction: -1 | 1): number {
  const points = [...new Set([0, ...anchors, maximum])].filter(Number.isFinite).sort((a, b) => a - b);
  const target = direction === 1 ? points.find(point => point > offset + 1) ?? maximum
    : [...points].reverse().find(point => point < offset - 1) ?? 0;
  return Math.max(0, Math.min(maximum, target));
}

export function placeFocusOffset(offset: number, maximum: number, anchor: number, cardWidth: number, viewport: number): number {
  const limit = Number.isFinite(maximum) ? Math.max(0, maximum) : 0;
  const current = Math.max(0, Math.min(limit, Number.isFinite(offset) ? offset : 0));
  if (![anchor, cardWidth, viewport].every(Number.isFinite) || anchor < 0 || cardWidth <= 0 || viewport <= 0) return current;
  const left = anchor + 2;
  const right = left + cardWidth;
  if (left >= current && right <= current + viewport) return current;
  const next = left < current || cardWidth > viewport ? anchor : right - viewport + 2;
  return Math.max(0, Math.min(limit, next));
}

export function PlaceChoiceGrid({ places, selected, selectionBlockedPlaces = [], onToggle }: Props) {
  const { width, fontScale = 1 } = useWindowDimensions();
  const reduceMotion = useReducedMotionPreference();
  const scroll = useRef<ScrollView>(null);
  const anchors = useRef(new Map<NotAlonePlaceId, number>());
  const offsetRef = useRef(0);
  const [viewport, setViewport] = useState(Math.max(1, width - 64));
  const [contentWidth, setContentWidth] = useState(0);
  const [offset, setOffset] = useState(0);
  const identity = places.join(',');
  const horizontal = places.length >= 3;
  const maximum = Math.max(0, contentWidth - viewport);
  const cardWidth = placeChoiceWidth(viewport - 4, fontScale, Platform.OS === 'web');
  const selectedHere = selected.filter(place => places.includes(place));

  useEffect(() => {
    offsetRef.current = 0;
    setOffset(0);
    scroll.current?.scrollTo({ x: 0, animated: false });
  }, [identity]);

  const browse = (direction: -1 | 1) => {
    const positions = places.flatMap(place => { const position = anchors.current.get(place); return position === undefined ? [] : [position]; });
    const next = placeBrowseOffset(offset, maximum, positions, direction);
    offsetRef.current = next;
    setOffset(next);
    scroll.current?.scrollTo({ x: next, animated: !reduceMotion });
  };

  const revealFocusedPlace = (place: NotAlonePlaceId) => {
    const anchor = anchors.current.get(place);
    if (anchor === undefined) return;
    const next = placeFocusOffset(offsetRef.current, maximum, anchor, cardWidth, viewport);
    if (next === offsetRef.current) return;
    offsetRef.current = next;
    setOffset(next);
    scroll.current?.scrollTo({ x: next, animated: false });
  };

  if (!places.length) return null;
  return <View testID="not-alone-place-choices" style={{ minWidth: 0, maxWidth: '100%', gap: 8 }}>
    {horizontal ? <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Text style={{ flexGrow: 1, flexShrink: 1, flexBasis: 130, fontFamily: 'Outfit_400Regular', color: NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>{places.length} Places · swipe or browse</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([-1, 1] as const).map(direction => {
            const disabled = direction === -1 ? offset <= 1 : offset >= maximum - 1;
            return <Pressable key={direction} accessibilityRole="button" accessibilityLabel={direction === -1 ? 'Previous Place cards' : 'Next Place cards'} accessibilityHint="Browse the available cards without selecting or playing one" disabled={disabled} accessibilityState={{ disabled }} onPress={() => browse(direction)}
              style={({ pressed }) => ({ minWidth: 48, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: disabled ? NOT_ALONE.border : NOT_ALONE.signal, backgroundColor: pressed && !disabled ? NOT_ALONE.panel : NOT_ALONE.surface, alignItems: 'center', justifyContent: 'center' })}>
              <MaterialCommunityIcons name={direction === -1 ? 'chevron-left' : 'chevron-right'} size={24} color={disabled ? NOT_ALONE.muted : NOT_ALONE.signal} />
            </Pressable>;
          })}
        </View>
      </View>
      <ScrollView ref={scroll} testID="not-alone-choice-rail" horizontal showsHorizontalScrollIndicator
        onLayout={event => setViewport(event.nativeEvent.layout.width)}
        onContentSizeChange={next => setContentWidth(next)}
        onScroll={event => { offsetRef.current = event.nativeEvent.contentOffset.x; setOffset(offsetRef.current); }} scrollEventThrottle={32}
        style={{ width: '100%', maxWidth: '100%' }} contentContainerStyle={{ gap: 12, paddingHorizontal: 2, paddingTop: 8, paddingBottom: 12, alignItems: 'stretch' }}>
        {places.map(place => <View key={place} onLayout={event => { anchors.current.set(place, Math.max(0, event.nativeEvent.layout.x - 2)); }} style={{ width: cardWidth, flexShrink: 0 }}>
          <NotAlonePlaceCard placeId={place} fluid selected={selected.includes(place)} selectionBlocked={selectionBlockedPlaces.includes(place)} onPress={() => onToggle(place)} onFocus={() => revealFocusedPlace(place)} />
        </View>)}
      </ScrollView>
    </> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 8, paddingBottom: 8 }}>
      {places.map(place => <View key={place} style={{ minWidth: 0, maxWidth: '100%', flexBasis: 240, flexGrow: 1, flexShrink: 1 }}>
        <NotAlonePlaceCard placeId={place} fluid selected={selected.includes(place)} selectionBlocked={selectionBlockedPlaces.includes(place)} onPress={() => onToggle(place)} />
      </View>)}
    </View>}
    <Text testID="not-alone-choice-summary" accessibilityLiveRegion="polite" style={{ fontFamily: 'Outfit_700Bold', color: selectedHere.length ? NOT_ALONE.signal : NOT_ALONE.muted, fontSize: 14, lineHeight: 21 }}>
      {selectedHere.length ? `${selectedHere.length} selected: ${selectedHere.map(place => `${place} ${NOT_ALONE_PLACE_BY_ID[place].name}`).join(' · ')}` : 'No Places selected'}
    </Text>
  </View>;
}
