import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { CoupCharacter } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { COUP, COUP_CHARACTER_COLOR } from '../../constants/theme';
import { CHARACTER_EMOJI } from '../../constants/coupReference';

// Re-exported for existing importers.
export { CHARACTER_EMOJI };

const GRAD_START = { x: 0, y: 0 };
const GRAD_END = { x: 1, y: 1 };

type Size = 'xs' | 'sm' | 'md' | 'lg';
const DIMS: Record<Size, { w: number; h: number; emoji: number; label: number; radius: number }> = {
  xs: { w: 30, h: 40, emoji: 16, label: 0, radius: 7 },
  sm: { w: 52, h: 72, emoji: 26, label: 7, radius: 10 },
  md: { w: 72, h: 100, emoji: 38, label: 9, radius: 12 },
  lg: { w: 88, h: 122, emoji: 46, label: 10, radius: 14 },
};

interface Props {
  character?: CoupCharacter;
  faceDown?: boolean;
  lost?: boolean;
  size?: Size;
  selected?: boolean;
  onPress?: () => void;
}

export function CharacterCard({ character, faceDown, lost, size = 'sm', selected, onPress }: Props) {
  const d = DIMS[size];
  const accent = character ? COUP_CHARACTER_COLOR[character] : COUP.border;
  const showName = !faceDown && character && d.label > 0;
  const showCorner = !faceDown && character && (size === 'md' || size === 'lg');

  // The gradient is a single bordered, rounded element — on web it renders as a
  // CSS background-image that clips to border-radius, so corners always match.
  if (faceDown) {
    return wrap(
      <LinearGradient
        colors={[COUP.panel, COUP.bg] as const}
        start={GRAD_START}
        end={GRAD_END}
        style={{
          width: d.w,
          height: d.h,
          borderRadius: d.radius,
          borderWidth: 1.5,
          borderColor: COUP.border,
          backgroundColor: COUP.panel,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: lost ? 0.4 : 1,
        }}
      >
        {/* inset frame ring to read as a card back (inset, never touches corners) */}
        <View
          style={{
            position: 'absolute',
            top: 4,
            left: 4,
            right: 4,
            bottom: 4,
            borderRadius: d.radius - 4,
            borderWidth: 1,
            borderColor: `${COUP.crimson}3A`,
          }}
        />
        <Text style={{ fontSize: d.emoji, opacity: 0.85 }}>🎭</Text>
      </LinearGradient>,
      onPress,
    );
  }

  return wrap(
    <LinearGradient
      colors={[`${accent}80`, `${accent}12`] as const}
      start={GRAD_START}
      end={GRAD_END}
      style={{
        width: d.w,
        height: d.h,
        borderRadius: d.radius,
        borderWidth: selected ? 2.5 : 1.5,
        borderColor: selected ? COUP.gold : accent,
        backgroundColor: `${accent}1A`,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: lost ? 0.4 : 1,
        boxShadow: selected ? `0 0 12px ${COUP.gold}99` : !lost ? `0 0 8px ${accent}3A` : undefined,
      }}
    >
      {/* corner pip, like a playing card (inset, never touches corners) */}
      {showCorner && (
        <Text style={{ position: 'absolute', top: 6, left: 6, fontSize: 11, opacity: 0.7 }}>
          {CHARACTER_EMOJI[character!]}
        </Text>
      )}
      <Text style={{ fontSize: d.emoji }}>{CHARACTER_EMOJI[character!]}</Text>
      {showName && (
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{
            fontFamily: 'Outfit_700Bold',
            color: lost ? COUP.muted : accent,
            fontSize: d.label,
            marginTop: 3,
            letterSpacing: 0,
            maxWidth: d.w - 4,
            paddingHorizontal: 1,
            textAlign: 'center',
            textDecorationLine: lost ? 'line-through' : 'none',
          }}
        >
          {character!.toUpperCase()}
        </Text>
      )}
    </LinearGradient>,
    onPress,
  );
}

function wrap(body: ReactElement, onPress?: () => void) {
  return onPress ? <ScalePressable onPress={onPress}>{body}</ScalePressable> : body;
}
