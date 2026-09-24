import { useState, type ComponentProps } from 'react';
import { Image, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { FeedTheKrakenCardEffect, FeedTheKrakenColour, FeedTheKrakenNavigationCard } from '@zuychin-arcade/types';
import { CardSurface } from '../ui/CardSurface';
import { ScalePressable } from '../ui/ScalePressable';
import { KRAKEN as C } from './palette';
import { typography as T } from './Controls';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
export const COURSE_COLOURS = { red: '#FF9297', blue: '#8DD8FF', yellow: '#FFE28D' };
export const COURSES: Record<FeedTheKrakenColour, { name: string; icon: IconName; destination: string }> = {
  blue: { name: 'Blue course', icon: 'anchor', destination: 'Sailors’ destination' },
  red: { name: 'Red course', icon: 'flag-variant', destination: 'Pirates’ destination' },
  yellow: { name: 'Yellow course', icon: 'octagram-outline', destination: 'The Kraken’s destination' },
};
export const NAVIGATION_EFFECTS: Record<FeedTheKrakenCardEffect, { name: string; icon: IconName; summary: string }> = {
  drunk: { name: 'Drunk', icon: 'glass-mug-variant', summary: 'Pass captaincy to an eligible player with the shortest navigation résumé.' },
  armed: { name: 'Armed', icon: 'plus-circle-outline', summary: 'The navigator takes one gun from the supply, if available.' },
  disarmed: { name: 'Disarmed', icon: 'minus-circle-outline', summary: 'The navigator returns one gun, if they have one.' },
  mermaid: { name: 'Mermaid', icon: 'waves', summary: 'Choose someone to privately inspect the last three discarded cards, shuffled.' },
  telescope: { name: 'Telescope', icon: 'telescope', summary: 'Choose someone to inspect the top card and keep or discard it.' },
  uprising: { name: 'Cult uprising', icon: 'octagram-outline', summary: 'Reveal and resolve the next cult ritual.' },
};
const images = {
  blue: require('../../assets/game-art/kraken-course-blue.webp'),
  red: require('../../assets/game-art/kraken-course-red.webp'),
  yellow: require('../../assets/game-art/kraken-course-yellow.webp'),
};

export function NavigationCard({ card, selected = false, disabled = false, onSelect }: {
  card: Pick<FeedTheKrakenNavigationCard, 'colour' | 'effect'>;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  const [failedColour, setFailedColour] = useState<FeedTheKrakenColour | null>(null);
  const course = COURSES[card.colour], effect = NAVIGATION_EFFECTS[card.effect], accent = COURSE_COLOURS[card.colour];
  const face = <CardSurface fill radius={12} faceColor={C.surface} edgeColor={C.bg} highlightColor={accent} selected={selected} disabled={disabled}>
    <View style={{ padding: 5, flexGrow: 1 }}>
      <View style={{ width: '100%', aspectRatio: 1.5, borderRadius: 8, overflow: 'hidden', backgroundColor: C.panel }}>
        {failedColour !== card.colour ? <Image key={card.colour} source={images[card.colour]} accessible={false} resizeMode="contain"
          onError={() => setFailedColour(card.colour)} style={{ width: '100%', height: '100%' }} />
          : <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><MaterialCommunityIcons name={course.icon} size={48} color={accent} /></View>}
      </View>
      <View style={{ padding: 11, gap: 12, flexGrow: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MaterialCommunityIcons name={course.icon} size={24} color={accent} accessible={false} />
          <Text style={[T.heading, { fontSize: 20, color: accent, flexShrink: 1 }]}>{course.name}</Text>
        </View>
        <View style={{ gap: 6, flexGrow: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><MaterialCommunityIcons name={effect.icon} size={22} color={C.text} accessible={false} /><Text style={[T.body, { fontFamily: 'Outfit_700Bold', flexShrink: 1 }]}>{effect.name}</Text></View>
          <Text style={T.body}>{effect.summary}</Text>
        </View>
        {onSelect ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border }}>
          <MaterialCommunityIcons name={selected ? 'check-circle' : 'circle-outline'} size={24} color={accent} accessible={false} />
          <Text style={[T.body, { color: accent, fontFamily: 'Outfit_700Bold', flexShrink: 1 }]}>{selected ? 'Selected' : 'Select card'}</Text>
        </View> : null}
      </View>
    </View>
  </CardSurface>;
  return onSelect ? <ScalePressable onPress={onSelect} disabled={disabled} scaleTo={0.98}
    accessibilityLabel={`Select ${card.colour} / ${card.effect}`} accessibilityHint={effect.summary}
    accessibilityState={{ selected, disabled }} style={{ flexGrow: 1, minWidth: 0, marginBottom: 4 }}>{face}</ScalePressable> : face;
}
