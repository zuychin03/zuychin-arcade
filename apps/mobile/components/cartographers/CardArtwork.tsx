import { useState } from 'react';
import { Image, View, type ImageSourcePropType } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CARTOGRAPHERS as C } from './palette';

export function CardArtwork({ source }: { source: ImageSourcePropType }) {
  const [failedSource, setFailedSource] = useState<ImageSourcePropType | null>(null);
  return <View accessible={false} style={{ width: '100%', maxWidth: 480, alignSelf: 'center', aspectRatio: 3 / 2,
    overflow: 'hidden', backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: `${C.accent}40`,
    borderTopWidth: 2, borderTopColor: '#071912', alignItems: 'center', justifyContent: 'center' }}>
    {failedSource === source ? <MaterialCommunityIcons name="image-filter-hdr" size={48} color={C.muted} />
      : <Image source={source} accessible={false} resizeMode="contain" onError={() => setFailedSource(source)}
        style={{ width: '100%', height: '100%' }} />}
  </View>;
}
