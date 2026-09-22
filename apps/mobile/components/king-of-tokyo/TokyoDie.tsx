import { Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import type { KingOfTokyoDieFace } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { CardSurface } from '../ui/CardSurface';
import { TOKYO } from '../../constants/theme';

interface Props {
  face: KingOfTokyoDieFace | null;
  index: number;
  selectionState?: TokyoDieSelectionState;
  interactive: boolean;
  size: number;
  textScale?: number;
  onPress: () => void;
  accessibilityHint?: string;
}

export type TokyoDieSelectionState = 'kept' | 'targeted' | 'changed' | 'armed';

const FACE_META: Record<Exclude<KingOfTokyoDieFace, number>, { icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string; label: string }> = {
  energy: { icon: 'lightning-bolt', color: TOKYO.energy, label: 'energy' },
  heart: { icon: 'heart', color: TOKYO.danger, label: 'heal' },
  smash: { icon: 'paw', color: '#FF8B72', label: 'smash' },
};

const SELECTION_META: Record<TokyoDieSelectionState, { icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string; label: string }> = {
  kept: { icon: 'lock', color: TOKYO.lime, label: 'kept for the next reroll' },
  targeted: { icon: 'target', color: TOKYO.cyan, label: 'targeted by the armed power' },
  changed: { icon: 'swap-horizontal', color: '#B58CFF', label: 'changed from the rolled face' },
  armed: { icon: 'lightning-bolt', color: TOKYO.energy, label: 'armed to prevent incoming damage' },
};

function faceLabel(face: KingOfTokyoDieFace | null): string {
  if (face === null) return 'not rolled';
  if (typeof face === 'number') return String(face);
  return FACE_META[face].label;
}

const NUMBER_PATH = {
  1: 'M17 16L25 10V44M17 44H34',
  2: 'M12 19C12 7 37 7 37 20C37 28 16 34 12 44H38',
  3: 'M12 12H35L24 25C43 23 44 46 24 46C18 46 13 43 11 39',
} as const;

export function TokyoDie({ face, index, selectionState, interactive, size, textScale = 1, onPress, accessibilityHint }: Props) {
  const { width, fontScale = 1 } = useWindowDimensions();
  const scale = Math.max(1, Number.isFinite(fontScale) ? fontScale : 1, Number.isFinite(textScale) ? textScale : 1);
  const dieWidth = Math.min(Math.max(size, 80 * scale), Math.max(48, width - 48));
  const color = face === null ? TOKYO.muted : typeof face === 'number' ? TOKYO.cyan : FACE_META[face].color;
  const selection = selectionState ? SELECTION_META[selectionState] : null;
  const label = `Die ${index + 1}: ${faceLabel(face)}${selection ? `, ${selection.label}` : ''}`;
  const dieStyle = {
      width: dieWidth,
      minWidth: 0,
      maxWidth: '100%' as const,
      minHeight: dieWidth,
      borderRadius: size * 0.2,
      paddingBottom: 4,
  };
  const content = (
    <CardSurface fill radius={size * 0.2} faceColor="#10251D" edgeColor="#030B08" highlightColor={selection?.color ?? `${color}88`} selected={Boolean(selection)} depth={4}>
    <LinearGradient
      colors={selection ? ['#244B38', '#10251D'] : ['#173328', '#0A1C16']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flexGrow: 1, minHeight: dieWidth, alignItems: 'center', justifyContent: 'center', padding: 7, gap: 3 }}
    >
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ minHeight: size * 0.55, alignItems: 'center', justifyContent: 'center' }}>
      {typeof face === 'number' ? (
        <Svg width={size * 0.52} height={size * 0.55} viewBox="0 0 50 56"><Path d={NUMBER_PATH[face]} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" /></Svg>
      ) : face ? (
          <MaterialCommunityIcons name={FACE_META[face].icon} size={size * 0.43} color={color} />
      ) : (
        <MaterialCommunityIcons name="help" size={size * 0.36} color={TOKYO.muted} />
      )}

      </View>
      {face !== null && typeof face !== 'number' ? <Text style={{ maxWidth: '100%', fontFamily: 'Outfit_800ExtraBold', color, fontSize: 11, lineHeight: 15, textAlign: 'center' }}>{FACE_META[face].label.toUpperCase()}</Text> : null}
      {selection && (
        <View style={{ maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 3, borderRadius: 7, paddingHorizontal: 4, paddingVertical: 3, backgroundColor: selection.color, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name={selection.icon} size={13} color={TOKYO.bg} />
          <Text style={{ flexShrink: 1, fontFamily: 'Outfit_700Bold', fontSize: 11, lineHeight: 15, color: TOKYO.bg, textAlign: 'center' }}>{selectionState?.toUpperCase()}</Text>
        </View>
      )}
    </LinearGradient>
    </CardSurface>
  );

  if (!interactive) {
    return (
      <View accessible accessibilityRole="text" accessibilityLabel={label} style={dieStyle}>
        {content}
      </View>
    );
  }

  return (
    <ScalePressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint ?? 'Double tap to keep or release this die'}
      accessibilityState={{ selected: Boolean(selection) }}
      style={dieStyle}
    >
      {content}
    </ScalePressable>
  );
}
