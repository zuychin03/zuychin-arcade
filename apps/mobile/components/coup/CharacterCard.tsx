import { Text, View } from 'react-native';
import type { CoupCharacter } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { COUP, COUP_CHARACTER_COLOR } from '../../constants/theme';

export const CHARACTER_EMOJI: Record<CoupCharacter, string> = {
  duke: '👑',
  assassin: '🗡️',
  captain: '⚓',
  ambassador: '🤝',
  contessa: '🌹',
  inquisitor: '🔍',
};

type Size = 'xs' | 'sm' | 'md';
const DIMS: Record<Size, { w: number; h: number; emoji: number; label: number }> = {
  xs: { w: 30, h: 40, emoji: 16, label: 0 },
  sm: { w: 52, h: 70, emoji: 24, label: 9 },
  md: { w: 70, h: 96, emoji: 34, label: 11 },
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

  const body = (
    <View
      style={{
        width: d.w,
        height: d.h,
        borderRadius: 10,
        borderWidth: selected ? 2.5 : 1.5,
        borderColor: faceDown ? COUP.border : selected ? COUP.gold : accent,
        backgroundColor: faceDown ? COUP.panel : `${accent}26`,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: lost ? 0.4 : 1,
        boxShadow: selected ? `0 0 10px ${COUP.gold}88` : undefined,
      }}
    >
      <Text style={{ fontSize: d.emoji }}>{faceDown ? '🎭' : character ? CHARACTER_EMOJI[character] : '🎭'}</Text>
      {!faceDown && character && d.label > 0 && (
        <Text
          style={{
            fontFamily: 'Outfit_700Bold',
            color: lost ? COUP.muted : accent,
            fontSize: d.label,
            marginTop: 3,
            letterSpacing: 0.5,
            textDecorationLine: lost ? 'line-through' : 'none',
          }}
        >
          {character.toUpperCase()}
        </Text>
      )}
    </View>
  );

  return onPress ? <ScalePressable onPress={onPress}>{body}</ScalePressable> : body;
}
