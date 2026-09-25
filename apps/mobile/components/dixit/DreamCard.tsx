import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { DixitCardId } from '@zuychin-arcade/types';
import { DIXIT as C } from '../../constants/theme';
import { CardSurface } from '../ui/CardSurface';
import { CardIllustration } from '../ui/CardIllustration';
import { ScalePressable } from '../ui/ScalePressable';
import { DIXIT_ARTWORK } from './artwork';

export function DreamCard({ cardId, width, selected = false, onInspect }: {
  cardId: DixitCardId; width: number; selected?: boolean; onInspect?: () => void;
}) {
  const art = DIXIT_ARTWORK[cardId];
  const unavailable = <View style={{ padding: 8, gap: 8, alignItems: 'center', justifyContent: 'center' }}>
    <MaterialCommunityIcons name="image-off-outline" size={32} color={C.muted} />
    <Text style={{ color: C.text, fontFamily: 'Outfit_400Regular', fontSize: 14, textAlign: 'center' }}>Image {cardId.slice(6)} unavailable</Text>
  </View>;
  const face = <CardSurface width={width} height={width * 1.5} radius={12} faceColor={C.panel}
    edgeColor="#090614" highlightColor={selected ? C.secondary : '#A087B5'} selected={selected}>
    {art ? <CardIllustration source={art.source} aspectRatio={2 / 3} backgroundColor={C.panel} fallback={unavailable} />
      : <View style={{ flex: 1, justifyContent: 'center' }}>{unavailable}</View>}
  </CardSurface>;
  return onInspect ? <ScalePressable onPress={onInspect} scaleTo={0.98}
    accessibilityLabel={`Enlarge image ${cardId.slice(6)}. ${art?.description ?? 'Artwork unavailable.'}`}
    accessibilityState={{ selected }} style={{ width, marginBottom: 4 }}>{face}</ScalePressable> : face;
}
