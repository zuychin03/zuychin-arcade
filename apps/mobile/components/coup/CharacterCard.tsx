import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CoupCharacter } from '@zuychin-arcade/types';
import { ScalePressable } from '../ui/ScalePressable';
import { COUP, COUP_CHARACTER_COLOR } from '../../constants/theme';

type Size = 'xs' | 'sm' | 'md' | 'lg';
const DIMS: Record<Size, { w: number; h: number; icon: number; label: number; radius: number; border: number }> = {
  xs: { w: 32, h: 44, icon: 16, label: 0, radius: 6, border: 1 },
  sm: { w: 56, h: 78, icon: 26, label: 8, radius: 10, border: 1.5 },
  md: { w: 78, h: 108, icon: 36, label: 10, radius: 12, border: 2 },
  lg: { w: 96, h: 134, icon: 44, label: 11, radius: 14, border: 2.5 },
};

const CHARACTER_ICONS: Record<CoupCharacter, keyof typeof MaterialCommunityIcons.glyphMap> = {
  duke: 'crown',
  assassin: 'sword',
  captain: 'anchor',
  ambassador: 'handshake',
  contessa: 'shield-crown',
  inquisitor: 'magnify',
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

  if (faceDown) {
    return wrap(
      <LinearGradient
        colors={['#251520', '#11050F'] as const}
        style={{
          width: d.w,
          height: d.h,
          borderRadius: d.radius,
          borderWidth: d.border,
          borderColor: COUP.border,
          backgroundColor: COUP.panel,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: lost ? 0.35 : 1,
          position: 'relative',
        }}
      >
        {/* Inset ornamental frame */}
        <View
          style={{
            position: 'absolute',
            top: size === 'xs' ? 2 : 4,
            left: size === 'xs' ? 2 : 4,
            right: size === 'xs' ? 2 : 4,
            bottom: size === 'xs' ? 2 : 4,
            borderRadius: d.radius - (size === 'xs' ? 2 : 4),
            borderWidth: 1,
            borderColor: 'rgba(226, 58, 94, 0.25)', // Subtle crimson border
            borderStyle: 'solid',
          }}
        />
        <MaterialCommunityIcons
          name="shield-cross"
          size={d.icon}
          color={COUP.crimson}
          style={{ opacity: 0.75 }}
        />
      </LinearGradient>,
      onPress,
    );
  }

  const iconName = character ? CHARACTER_ICONS[character] : 'help';

  return wrap(
    <LinearGradient
      colors={[`${accent}40`, `${accent}0D`] as const}
      style={{
        width: d.w,
        height: d.h,
        borderRadius: d.radius,
        borderWidth: selected ? d.border + 1 : d.border,
        borderColor: selected ? COUP.gold : lost ? `${accent}40` : accent,
        backgroundColor: `${accent}0A`,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: lost ? 0.4 : 1,
        position: 'relative',
        boxShadow: selected ? `0 0 14px ${COUP.gold}E6` : !lost ? `0 0 10px ${accent}40` : undefined,
      }}
    >
      {/* Outer corner badge decoration */}
      {showCorner && (
        <View style={{ position: 'absolute', top: 5, left: 5, opacity: 0.6 }}>
          <MaterialCommunityIcons name={iconName} size={11} color={accent} />
        </View>
      )}

      {/* Decorative center shield bg */}
      <View
        style={{
          width: d.icon * 1.3,
          height: d.icon * 1.3,
          borderRadius: (d.icon * 1.3) / 2,
          backgroundColor: `${accent}1A`,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 0.5,
          borderColor: `${accent}30`,
          boxShadow: !lost ? `0 0 6px ${accent}30` : undefined,
        }}
      >
        <MaterialCommunityIcons name={iconName} size={d.icon} color={lost ? COUP.muted : accent} />
      </View>

      {showName && (
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{
            fontFamily: 'Outfit_800ExtraBold',
            color: lost ? COUP.muted : accent,
            fontSize: d.label,
            marginTop: 6,
            letterSpacing: 0.5,
            maxWidth: d.w - 8,
            paddingHorizontal: 2,
            textAlign: 'center',
            textDecorationLine: lost ? 'line-through' : 'none',
          }}
        >
          {character!.toUpperCase()}
        </Text>
      )}

      {/* Dead / Lost overlay ribbon */}
      {lost && (
        <View
          style={{
            position: 'absolute',
            width: '105%',
            height: 18,
            backgroundColor: '#1E121C',
            borderWidth: 1,
            borderColor: COUP.border,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ rotate: '-15deg' }],
            boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
          }}
        >
          <Text
            style={{
              fontFamily: 'SpaceMono_700Bold',
              color: COUP.muted,
              fontSize: size === 'md' ? 8 : 7,
              letterSpacing: 1,
            }}
          >
            DEAD
          </Text>
        </View>
      )}
    </LinearGradient>,
    onPress,
  );
}

function wrap(body: ReactElement, onPress?: () => void) {
  return onPress ? <ScalePressable onPress={onPress}>{body}</ScalePressable> : body;
}
