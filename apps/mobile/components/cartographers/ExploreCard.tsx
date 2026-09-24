import { Text, View } from 'react-native';
import type { CartographersCard } from '@zuychin-arcade/types';
import { CardSurface } from '../ui/CardSurface';
import { ShapeDiagram, TERRAIN } from './MapBoard';
import { CARTOGRAPHERS as C } from './palette';
import { CARTOGRAPHERS_CARD_ART } from './artwork';
import { CardArtwork } from './CardArtwork';

export function ExploreCard({ card }: { card: CartographersCard }) {
  const shapes = card.kind === 'explore' ? card.options.map(option => option.cells) : [card.kind === 'hero' ? [{ x: 0, y: 0 }] : card.cells];
  return <CardSurface fill faceColor={C.panel} edgeColor={C.bg} highlightColor={`${C.accent}70`} radius={12}>
    <CardArtwork source={CARTOGRAPHERS_CARD_ART[card.id]} />
    <View style={{ padding: 16, gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: C.text, fontFamily: 'Outfit_700Bold', fontSize: 20 }}>{card.name}</Text>
      <Text style={{ color: C.muted, fontFamily: 'Outfit_400Regular', fontSize: 16 }}>
        {card.kind === 'explore' ? `${card.time} time · ${card.terrains.map(t => TERRAIN[t].label).join(' or ')}` : card.kind === 'hero' ? 'Hero · 0 time · dashed cells are protected' : `Ambush · 0 time · ${card.direction === 'clockwise' ? 'Pass clockwise' : 'Pass anticlockwise'}`}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        {shapes.map((cells, i) => <View key={i} style={{ gap: 8 }}>
          <ShapeDiagram cells={cells} terrain={card.kind === 'hero' ? 'hero' : card.kind === 'ambush' ? 'monster' : card.terrains[0]} attack={card.kind === 'hero' ? card.attack : []} />
          {card.kind === 'explore' ? <Text style={{ color: C.accent, fontFamily: 'Outfit_600SemiBold', fontSize: 14 }}>Shape {i + 1}{card.options[i]!.coin ? ' · +1 coin' : ''}</Text> : null}
        </View>)}
      </View>
    </View>
  </CardSurface>;
}
