import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { DixitCardId } from '@zuychin-arcade/types';
import { DIXIT as C } from '../../constants/theme';
import { CardSurface } from '../ui/CardSurface';
import { ScalePressable } from '../ui/ScalePressable';
import { DIXIT_ARTWORK } from './artwork';

export function DreamCard({ cardId, width, selected = false, onInspect }: {
  cardId: DixitCardId; width: number; selected?: boolean; onInspect?: () => void;
}) {
  const [failedCardId, setFailedCardId] = useState<DixitCardId | null>(null);
  const art = DIXIT_ARTWORK[cardId];
  const face = <CardSurface width={width} height={width * 1.5} radius={12} faceColor={C.panel}
    edgeColor="#090614" highlightColor={selected ? C.secondary : '#A087B5'} selected={selected}>
    <View style={{ flex: 1, padding: 4 }}>
      {art && failedCardId !== cardId ? <Image key={cardId} source={art.source} accessible={false} onError={() => setFailedCardId(cardId)}
        resizeMode="contain" style={{ width: '100%', height: '100%', borderRadius: 8 }} />
        : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 8 }}>
          <MaterialCommunityIcons name="image-off-outline" size={32} color={C.muted} />
          <Text style={{ color: C.text, fontFamily: 'Outfit_400Regular', fontSize: 14, textAlign: 'center' }}>Image {cardId.slice(6)} unavailable</Text>
        </View>}
    </View>
  </CardSurface>;
  return onInspect ? <ScalePressable onPress={onInspect} scaleTo={0.98}
    accessibilityLabel={`Enlarge image ${cardId.slice(6)}. ${art?.description ?? 'Artwork unavailable.'}`}
    accessibilityState={{ selected }} style={{ width, marginBottom: 4 }}>{face}</ScalePressable> : face;
}
