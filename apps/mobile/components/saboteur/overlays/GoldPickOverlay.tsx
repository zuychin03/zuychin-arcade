import { Text, View } from 'react-native';
import { ScalePressable } from '../../ui/ScalePressable';
import { NeonButton } from '../../ui/NeonButton';
import { ARCADE, MINE } from '../../../constants/theme';
import { OverlayFrame } from './OverlayFrame';

interface Props {
  values: number[] | null;
  busy: boolean;
  message: string | null;
  onPick: (cardIndex: number) => void;
  onLeave: () => void;
  onRefresh: () => void;
}

export function GoldPickOverlay({ values, busy, message, onPick, onLeave, onRefresh }: Props) {
  return <OverlayFrame id="saboteur-gold-pick" label="Choose your gold reward" onEscape={onLeave}>
    <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_800ExtraBold', fontSize: 28, color: MINE.gold }}>Choose your gold</Text>
    <Text style={{ color: ARCADE.text, fontSize: 16, lineHeight: 24 }}>Only you can see these values. Choose one card; the remaining cards pass to the next miner.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {values?.map((value, index) => <ScalePressable key={index} accessibilityLabel={'Choose gold card ' + (index + 1) + ', worth ' + value + ' gold'}
        disabled={busy} onPress={() => onPick(index)}
        style={{ minHeight: 120, minWidth: 92, flexGrow: 1, borderRadius: 14, borderWidth: 2, borderColor: MINE.gold, backgroundColor: MINE.surface, padding: 16, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>
        <Text style={{ color: MINE.gold, fontFamily: 'Outfit_800ExtraBold', fontSize: 32 }}>{value}</Text>
        <Text style={{ color: ARCADE.text, fontSize: 14 }}>gold</Text>
      </ScalePressable>)}
    </View>
    <Text accessibilityLiveRegion="polite" style={{ color: ARCADE.text, fontSize: 14, lineHeight: 20 }}>{message ?? (values ? 'Your choice is private until the final scores.' : 'Refreshing your private reward choices…')}</Text>
    {!values && <NeonButton label="REFRESH CHOICES" color={ARCADE.cyan} variant="outline" onPress={onRefresh} />}
    <NeonButton label="LEAVE GAME" color={ARCADE.red} variant="outline" onPress={onLeave} />
  </OverlayFrame>;
}
