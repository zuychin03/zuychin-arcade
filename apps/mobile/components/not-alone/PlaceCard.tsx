import { Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NOT_ALONE_PLACE_BY_ID, type NotAlonePlaceId } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { CardSurface } from '../ui/CardSurface';
import { PlaceArtwork } from './PlaceArtwork';
import { NOT_ALONE } from '../../constants/theme';
import type { IntrinsicCardFaceSizing } from '../../hooks/useIntrinsicCardHeight';
import { useMeasuredTextScale } from '../../hooks/useMeasuredTextScale';

interface Props {
  placeId: NotAlonePlaceId;
  selected?: boolean;
  disabled?: boolean;
  selectionBlocked?: boolean;
  powerDisabled?: boolean;
  compact?: boolean;
  fluid?: boolean;
  accessibilityHint?: string;
  onPress?: () => void;
  onFocus?: () => void;
  faceSizing?: IntrinsicCardFaceSizing;
}

export function NotAlonePlaceCard({
  placeId,
  selected = false,
  disabled = false,
  selectionBlocked = false,
  powerDisabled = false,
  compact = false,
  fluid = false,
  accessibilityHint = 'Select this Place card',
  onPress,
  onFocus,
  faceSizing,
}: Props) {
  const { width, fontScale } = useWindowDimensions();
  const { textScale, textRef, onTextLayout } = useMeasuredTextScale(18, fontScale);
  const place = NOT_ALONE_PLACE_BY_ID[placeId];
  const unavailable = disabled || selectionBlocked;
  const status = selectionBlocked && powerDisabled
    ? 'INACCESSIBLE · POWER INEFFECTIVE'
    : selectionBlocked
      ? 'INACCESSIBLE THIS TURN'
      : powerDisabled
        ? 'POWER INEFFECTIVE'
        : disabled
          ? 'NOT AVAILABLE'
          : null;
  const style: ViewStyle = {
    width: fluid ? '100%' : Math.min((compact ? 176 : 208) * textScale, Math.max(1, width - 64)),
    maxWidth: '100%',
    minWidth: 0,
    paddingBottom: 3,
    ...(faceSizing ? { minHeight: faceSizing.minimumHeight + 3 } : {}),
    ...(fluid ? { flexGrow: 1 } : {}),
  };
  const label = `Place ${placeId}, ${place.name}. ${place.summary}${selected ? ' Selected.' : ''}${selectionBlocked ? ' Inaccessible this turn.' : ''}${powerDisabled ? ' Place power ineffective this turn.' : ''}${disabled && !selectionBlocked ? ' Not available.' : ''}`;
  const content = (
    <CardSurface fill radius={14} depth={3} faceColor={NOT_ALONE.surface} edgeColor={NOT_ALONE.bg} highlightColor={selected ? NOT_ALONE.signal : `${place.accent}88`} selected={selected}>
      <View key={faceSizing?.measurementKey} onLayout={faceSizing ? event => faceSizing.onMeasure(event.nativeEvent.layout.height) : undefined} style={{ minWidth: 0, flexShrink: 0 }}>
        <View style={{ padding: 12, gap: 4, minWidth: 0 }}>
          <Text style={{ fontFamily: 'Outfit_700Bold', color: place.accent, fontSize: 14, lineHeight: 20 }}>Place {placeId}</Text>
          <Text ref={textRef} onLayout={onTextLayout} style={{ fontFamily: 'Outfit_800ExtraBold', color: NOT_ALONE.text, fontSize: 18, lineHeight: 24 }}>{place.name}</Text>
        </View>
        <PlaceArtwork placeId={placeId} color={place.accent} compact={compact} />
        <View style={{ padding: 12, gap: 10, minWidth: 0 }}>
          <Text style={{ fontFamily: 'Outfit_400Regular', color: NOT_ALONE.text, fontSize: 14, lineHeight: 20 }}>{place.summary}</Text>
          {selected ? <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, minWidth: 0 }}>
            <MaterialCommunityIcons name="check-circle" size={20} color={NOT_ALONE.signal} accessible={false} />
            <Text style={{ flex: 1, minWidth: 0, fontFamily: 'Outfit_700Bold', color: NOT_ALONE.signal, fontSize: 14, lineHeight: 20 }}>Selected</Text>
          </View> : null}
          {status ? <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, minWidth: 0 }}>
            <MaterialCommunityIcons name={unavailable ? 'lock-outline' : 'flash-off'} size={20} color={unavailable ? NOT_ALONE.creature : NOT_ALONE.amber} accessible={false} />
            <Text style={{ flex: 1, minWidth: 0, fontFamily: 'Outfit_700Bold', color: unavailable ? NOT_ALONE.creature : NOT_ALONE.amber, fontSize: 14, lineHeight: 20 }}>{status}</Text>
          </View> : null}
        </View>
      </View>
    </CardSurface>
  );

  return (
    <View testID={`not-alone-place-card-${placeId}`} accessible={!onPress} accessibilityLabel={onPress ? undefined : label} style={style}>
      {onPress ? <ScalePressable accessibilityLabel={label} accessibilityHint={unavailable ? undefined : accessibilityHint} accessibilityState={{ selected, disabled: unavailable }} disabled={unavailable} onPress={onPress} onFocus={unavailable ? undefined : onFocus} style={{ minHeight: 48, minWidth: 0, width: '100%', flexGrow: 1 }}>
        {content}
      </ScalePressable> : content}
    </View>
  );
}
