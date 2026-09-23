import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScalePressable } from '../ui/ScalePressable';
import { CardSurface } from '../ui/CardSurface';
import { NOT_ALONE } from '../../constants/theme';
import { PowerArtwork } from './PowerArtwork';

interface Props {
  cardId: string;
  width?: number;
  title: string;
  body: string;
  color: string;
  disabled: boolean;
  needsOptions: boolean;
  onPress: () => void;
}

export function CardChip({ cardId, width = 220, title, body, color, disabled, needsOptions, onPress }: Props) {
  const actionLabel = disabled ? 'NOT AVAILABLE NOW' : needsOptions ? 'CHOOSE OPTIONS' : 'PLAY CARD NOW';
  const hint = disabled ? 'This card is unavailable during the current decision'
    : needsOptions ? 'Choose options before playing this card' : 'Plays this card immediately';
  return (
    <View testID={`not-alone-card-chip-${cardId}`} style={{ width, maxWidth: '100%', minWidth: 0, paddingBottom: 3 }}>
      <ScalePressable accessibilityLabel={`${title}. ${body} ${actionLabel}`} accessibilityHint={hint} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={{ width: '100%', minWidth: 0, minHeight: 48, flexGrow: 1 }}>
        <CardSurface fill radius={14} depth={3} faceColor={NOT_ALONE.surface} edgeColor={NOT_ALONE.bg} highlightColor={`${color}99`}>
          <View style={{ padding: 12, minWidth: 0, backgroundColor: NOT_ALONE.panel }}>
            <Text style={{ fontFamily: 'Outfit_800ExtraBold', color, fontSize: 16, lineHeight: 22 }}>{title}</Text>
          </View>
          <View style={{ padding: 12, minWidth: 0, gap: 16 }}>
            <PowerArtwork cardId={cardId} color={color} />
            <Text style={{ fontFamily: 'Outfit_400Regular', color: NOT_ALONE.text, fontSize: 14, lineHeight: 20 }}>{body}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, minWidth: 0 }}>
              <MaterialCommunityIcons name={disabled ? 'clock-outline' : needsOptions ? 'tune-variant' : 'gesture-tap'} size={20} color={disabled ? NOT_ALONE.muted : color} accessible={false} />
              <Text style={{ flex: 1, minWidth: 0, fontFamily: 'Outfit_700Bold', color: disabled ? NOT_ALONE.muted : color, fontSize: 14, lineHeight: 20 }}>{actionLabel}</Text>
            </View>
          </View>
        </CardSurface>
      </ScalePressable>
    </View>
  );
}
