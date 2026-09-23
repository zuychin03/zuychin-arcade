import type { ReactElement, ReactNode } from 'react';
import { Platform, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CoupCharacter } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { CardSurface } from '../ui/CardSurface';
import { CoupCharacterArtwork } from './CoupCharacterArtwork';
import { CoupTableArtwork } from './CoupTableArtwork';
import { COUP, COUP_CHARACTER_COLOR } from '../../constants/theme';

type Size = 'xs' | 'sm' | 'md' | 'lg';
const DIMS = {
  xs: { width: 32, art: 32, back: 44, radius: 6 },
  sm: { width: 88, art: 88, back: 120, radius: 10 },
  md: { width: 128, art: 144, back: 192, radius: 12 },
  lg: { width: 160, art: 176, back: 228, radius: 14 },
} as const;
const abilities: Record<CoupCharacter, string> = {
  duke: 'Tax +3\nBlocks aid', assassin: 'Pay 3 to assassinate', captain: 'Steal 2\nBlocks stealing',
  ambassador: 'Exchange\nBlocks stealing', contessa: 'Blocks assassination', inquisitor: 'Exchange / examine',
};
const decoration = { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const, pointerEvents: 'none' as const };

interface Props {
  character?: CoupCharacter;
  faceDown?: boolean;
  lost?: boolean;
  size?: Size;
  fluid?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  referenceContent?: ReactNode;
}

export function CharacterCard({ character, faceDown, lost, size = 'sm', fluid = false, selected, disabled, onPress, accessibilityLabel, accessibilityHint, referenceContent }: Props) {
  const { width, fontScale = 1 } = useWindowDimensions();
  const d = DIMS[size], compact = size === 'xs', detailed = size === 'md' || size === 'lg';
  const frame: ViewStyle = compact ? { width: d.width, paddingBottom: 2 } : fluid ? {
    width: '100%', flexGrow: 1, flexShrink: 0, minWidth: 0, maxWidth: '100%', paddingBottom: 4,
  } : {
    flexBasis: d.width, flexGrow: 1, flexShrink: 1, maxWidth: '100%', paddingBottom: 4,
    // Web intrinsic sizing responds to text-only enlargement, not just native fontScale.
    minWidth: Platform.OS === 'web' ? 'min-content' as ViewStyle['minWidth'] : Math.min(d.width * Math.max(1, fontScale), Math.max(48, width - 56)),
  };
  const cardLabel = accessibilityLabel ?? (faceDown ? 'Hidden influence' : character
    ? `${character}${lost ? ', revealed and lost' : ', active influence'}${selected ? ', selected' : ''}` : 'Unknown influence');
  if (faceDown) {
    return wrap(
      <CardSurface fill={!compact} radius={d.radius} faceColor={COUP.panel} edgeColor={COUP.bg} highlightColor={selected ? COUP.gold : COUP.border} selected={selected} depth={compact ? 1 : 3}>
        <View style={{ minHeight: d.back, padding: compact ? 3 : 12, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <View {...decoration} style={{ width: compact ? 24 : size === 'sm' ? 50 : 72, maxWidth: '100%', borderRadius: compact ? 3 : 8, overflow: 'hidden' }}><CoupTableArtwork kind="back" /></View>
          {!compact ? <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.text, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>Hidden influence</Text> : null}
        </View>
      </CardSurface>, onPress, cardLabel, accessibilityHint, selected, disabled, frame,
    );
  }

  const accent = character ? COUP_CHARACTER_COLOR[character] : COUP.border;
  const title = character ? character[0].toUpperCase() + character.slice(1) : 'Unknown';
  return wrap(
    <CardSurface fill={!compact} radius={d.radius} faceColor={COUP.panel} edgeColor={COUP.bg} highlightColor={selected ? COUP.gold : accent} selected={selected} depth={compact ? 1 : 3}>
      <View style={{ padding: compact ? 0 : 8, gap: compact ? 0 : 8, ...(compact ? { minHeight: d.back, justifyContent: 'center' } as const : {}) }}>
        <View {...decoration} style={{ width: '100%', maxWidth: d.art, alignSelf: 'center', overflow: 'hidden', borderRadius: compact ? 4 : 8 }}>
          {character ? <CoupCharacterArtwork character={character} /> : <View style={{ minHeight: compact ? 32 : 88, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="help" size={compact ? 20 : 32} color={COUP.muted} /></View>}
        </View>
        {!compact ? <Text style={{ fontFamily: 'Outfit_800ExtraBold', color: COUP.text, fontSize: detailed ? 16 : 12, lineHeight: detailed ? 22 : 18, textAlign: 'center' }}>{title}</Text> : null}
        {detailed && character && !lost ? referenceContent ?? <Text style={{ fontFamily: 'Outfit_400Regular', color: COUP.text, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>{abilities[character]}</Text> : null}
        {lost ? compact
          ? <View {...decoration} style={{ alignItems: 'center', backgroundColor: COUP.bg }}><MaterialCommunityIcons name="close" size={12} color={COUP.text} /></View>
          : <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>Revealed · lost</Text>
          : selected && !compact ? <Text style={{ fontFamily: 'Outfit_700Bold', color: COUP.gold, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>Selected</Text> : null}
      </View>
    </CardSurface>, onPress, cardLabel, accessibilityHint, selected, disabled, frame,
  );
}

function wrap(body: ReactElement, onPress: (() => void) | undefined, accessibilityLabel: string, accessibilityHint: string | undefined, selected: boolean | undefined, disabled: boolean | undefined, frame: ViewStyle) {
  return onPress ? <ScalePressable onPress={onPress} disabled={disabled} accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} accessibilityState={{ selected, disabled }} style={{ ...frame, minHeight: 48, minWidth: frame.minWidth ?? 48 }}>
    {body}
  </ScalePressable> : <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={frame}>{body}</View>;
}
