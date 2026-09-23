import { useState } from 'react';
import { Platform, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LIBERTALIA_CREW } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { CardSurface } from '../ui/CardSurface';
import { LibertaliaCrewArtwork } from './LibertaliaCrewArtwork';
import { LIBERTALIA as C } from '../../constants/theme';

interface Props {
  rank: number;
  selection?: 'candidate' | 'submitted';
  disabled?: boolean;
  onPress?: () => void;
  onFocus?: () => void;
  fluid?: boolean;
  nativeID?: string;
}

export function CrewCard({ rank, selection, disabled = false, onPress, onFocus, fluid = false, nativeID }: Props) {
  const { width, fontScale } = useWindowDimensions();
  const scale = Math.max(1, Number.isFinite(fontScale) ? fontScale : 1);
  const available = Math.max(1, width - 56);
  const [headerWidth, setHeaderWidth] = useState(0);
  const [rankHeight, setRankHeight] = useState(25);
  const textScale = Math.max(scale, rankHeight / 25);
  const stackedHeader = (headerWidth || Math.max(1, Math.min(320 * scale, available) - 24)) < 240 * textScale;
  const crew = LIBERTALIA_CREW[rank - 1];
  if (!crew) return null;
  const accent = selection === 'submitted' ? C.gold : C.sky;
  const stateLabel = selection === 'submitted' ? 'Current secret choice.' : selection === 'candidate' ? 'Proposed choice, not submitted.' : '';
  const label = `${crew.name}, rank ${rank}. Timing: ${crew.phases.join(', ')}. ${crew.summary}${stateLabel ? ` ${stateLabel}` : ''}`;
  const content = <CardSurface fill radius={14} depth={3} faceColor={C.panel} edgeColor={C.bg} highlightColor={selection ? accent : C.sky} selected={Boolean(selection)}>
    <View style={{ padding: 12, gap: 10, minWidth: 0 }}>
      <View testID="libertalia-crew-header" onLayout={event => { const measured = event.nativeEvent.layout.width; if (Number.isFinite(measured) && measured > 0) setHeaderWidth(measured); }} style={{ flexDirection: stackedHeader ? 'column' : 'row', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
        <View testID="libertalia-crew-metadata" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0, ...(stackedHeader ? { width: '100%' } : {}) }}>
          <View style={{ flexShrink: 0, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: C.gold, backgroundColor: C.bg }}><Text onLayout={event => { const measured = event.nativeEvent.layout.height; if (Number.isFinite(measured) && measured > 0) setRankHeight(measured); }} style={{ fontFamily: 'SpaceMono_700Bold', color: C.gold, fontSize: 18, lineHeight: 25 }}>#{rank}</Text></View>
          {selection ? <MaterialCommunityIcons name={selection === 'submitted' ? 'check-circle' : 'circle-outline'} size={22} color={accent} accessible={false} /> : null}
        </View>
        <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: C.text, fontSize: 20, lineHeight: 26, ...(stackedHeader ? { width: '100%' } : { flex: 1 }), minWidth: 0 }}>{crew.name}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{crew.phases.map(phase => <View key={phase} style={{ borderRadius: 6, backgroundColor: C.bg, paddingHorizontal: 7, paddingVertical: 4 }}><Text style={{ fontFamily: 'Outfit_700Bold', color: C.violet, fontSize: 13, lineHeight: 18 }}>{phase.toUpperCase()}</Text></View>)}</View>
    </View>
    <LibertaliaCrewArtwork rank={rank} />
    <View style={{ padding: 12, gap: 10, minWidth: 0 }}>
      <Text style={{ fontFamily: 'Outfit_400Regular', color: C.text, fontSize: 15, lineHeight: 22 }}>{crew.summary}</Text>
      {onPress ? <Text style={{ fontFamily: 'Outfit_700Bold', color: disabled && !selection ? C.muted : accent, fontSize: 14, lineHeight: 20 }}>{selection === 'submitted' ? 'CURRENT SECRET CHOICE' : selection === 'candidate' ? 'PROPOSED · CONFIRM TO SUBMIT' : disabled ? 'NOT SELECTABLE NOW' : 'CHOOSE THIS CREW'}</Text> : null}
    </View>
  </CardSurface>;
  const style: ViewStyle = fluid ? { width: '100%', maxWidth: '100%', minWidth: 0, flexGrow: 1, alignSelf: 'stretch', paddingBottom: 4 }
    : { flexBasis: 250 * scale, flexGrow: 1, flexShrink: 1, alignSelf: 'stretch', maxWidth: Math.min(320 * scale, available), minWidth: Platform.OS === 'web' ? 'min-content' as unknown as number : Math.min(180 * scale, available), paddingBottom: 4 };
  return <View nativeID={nativeID} testID={`libertalia-crew-card-${rank}`} style={style}>
    {onPress ? <ScalePressable accessibilityLabel={`Choose ${label}`} accessibilityHint="Selects this crew locally, without sending it yet" accessibilityState={{ disabled, selected: Boolean(selection) }} disabled={disabled} onPress={onPress} onFocus={disabled ? undefined : onFocus} style={{ width: '100%', minWidth: 0, minHeight: 48, flexGrow: 1 }}>{content}</ScalePressable>
      : <View accessible accessibilityLabel={label} style={{ flexGrow: 1 }}>{content}</View>}
  </View>;
}
