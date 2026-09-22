import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { TOKYO } from '../../constants/theme';

interface TokyoMarkProps {
  size?: number;
  color?: string;
}

/** Compact original city-and-claw mark for navigation, tiles and headers. */
export function TokyoMark({ size = 54, color = TOKYO.lime }: TokyoMarkProps) {
  return (
    <Svg accessibilityLabel="Tokyo monster city mark" width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="46" fill="#0A1D17" stroke={color} strokeWidth="3" />
      <Circle cx="50" cy="50" r="38" fill="none" stroke={TOKYO.cyan} strokeOpacity="0.28" strokeWidth="2" strokeDasharray="3 5" />
      <Path d="M17 75 H84 M21 75 V58 H31 V67 H38 V48 H49 V75 M54 75 V61 H62 V53 H70 V75 M74 75 V43 H81 V75" fill="none" stroke={TOKYO.cyan} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M28 23 C34 32 37 40 39 50 M48 18 C50 30 50 40 48 52 M68 23 C61 34 58 42 57 53" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" />
    </Svg>
  );
}

interface TokyoHeroArtworkProps {
  height?: number;
}

/** Wide, responsive original key art used on entry and join screens. */
export function TokyoHeroArtwork({ height = 210 }: TokyoHeroArtworkProps) {
  return (
    <Svg accessibilityLabel="Original neon monster overlooking Tokyo" width="100%" height={height} viewBox="0 0 420 230" preserveAspectRatio="xMidYMid meet">
      <Defs>
        <LinearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#12352C" />
          <Stop offset="0.58" stopColor="#0A201A" />
          <Stop offset="1" stopColor="#07130F" />
        </LinearGradient>
        <LinearGradient id="hero-beam" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={TOKYO.lime} stopOpacity="0" />
          <Stop offset="0.5" stopColor={TOKYO.lime} stopOpacity="0.45" />
          <Stop offset="1" stopColor={TOKYO.lime} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="2" y="2" width="416" height="226" rx="24" fill="url(#hero-sky)" stroke={TOKYO.border} strokeWidth="2" />
      <Circle cx="335" cy="51" r="27" fill="#D8FFF0" opacity="0.12" />
      <Circle cx="335" cy="51" r="20" fill="none" stroke={TOKYO.cyan} strokeOpacity="0.45" strokeWidth="2" />
      <Path d="M35 73 H375" stroke="url(#hero-beam)" strokeWidth="3" />
      <Path d="M19 175 H402 V213 H19 Z" fill="#06100D" />
      <Path d="M22 177 V144 H42 V160 H55 V122 H75 V177 M84 177 V153 H101 V133 H116 V177 M125 177 V141 H141 V112 H159 V177 M264 177 V143 H282 V128 H298 V177 M307 177 V118 H329 V148 H345 V177 M354 177 V139 H375 V157 H394 V177" fill="#0E2B24" stroke={TOKYO.cyan} strokeOpacity="0.55" strokeWidth="2" strokeLinejoin="round" />
      <Rect x="62" y="133" width="4" height="8" fill={TOKYO.energy} />
      <Rect x="93" y="160" width="4" height="7" fill={TOKYO.lime} />
      <Rect x="145" y="123" width="5" height="8" fill={TOKYO.cyan} />
      <Rect x="317" y="130" width="5" height="8" fill={TOKYO.energy} />
      <Rect x="367" y="147" width="5" height="8" fill={TOKYO.lime} />

      <Path d="M142 178 C134 139 143 91 175 76 L168 43 L195 67 L216 36 L230 68 L257 47 L250 82 C277 101 287 140 276 178 Z" fill="#091611" stroke={TOKYO.lime} strokeWidth="4" strokeLinejoin="round" />
      <Path d="M165 110 L195 99 L202 115 L168 121 Z M250 110 L220 99 L213 115 L247 121 Z" fill={TOKYO.cyan} />
      <Path d="M181 143 Q210 159 239 143 L230 171 L210 158 L190 171 Z" fill={TOKYO.lime} opacity="0.82" />
      <Path d="M145 142 L119 126 L127 157 L102 171 M275 142 L301 126 L293 157 L318 171" fill="none" stroke={TOKYO.lime} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M117 43 L107 62 L121 62 L112 81 M296 68 L309 50 L313 65 L327 52" fill="none" stroke={TOKYO.energy} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <Ellipse cx="210" cy="205" rx="108" ry="10" fill={TOKYO.lime} opacity="0.09" />
      <Path d="M20 196 C82 184 128 206 191 193 C254 180 319 207 400 188" fill="none" stroke={TOKYO.cyan} strokeOpacity="0.24" strokeWidth="2" />
    </Svg>
  );
}

type ResourceKind = 'health' | 'victory' | 'energy';

const RESOURCE_STYLE: Record<ResourceKind, { icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string; label: string }> = {
  health: { icon: 'heart', color: TOKYO.danger, label: 'health' },
  victory: { icon: 'star-four-points', color: TOKYO.lime, label: 'victory points' },
  energy: { icon: 'lightning-bolt', color: TOKYO.energy, label: 'energy' },
};

export function ResourceBadge({ kind, value, compact = false }: { kind: ResourceKind; value: number; compact?: boolean }) {
  const resource = RESOURCE_STYLE[kind];
  return (
    <View
      accessible
      accessibilityLabel={`${value} ${resource.label}`}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        flexShrink: 1,
        maxWidth: '100%',
        alignItems: 'center',
        gap: compact ? 3 : 5,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: `${resource.color}66`,
        borderTopColor: `${resource.color}99`,
        borderBottomWidth: 3,
        borderBottomColor: TOKYO.bg,
        backgroundColor: `${resource.color}16`,
        paddingHorizontal: compact ? 6 : 8,
        paddingVertical: compact ? 3 : 5,
      }}
    >
      <MaterialCommunityIcons name={resource.icon} size={compact ? 12 : 14} color={resource.color} />
      <Text style={{ flexShrink: 1, fontFamily: 'SpaceMono_700Bold', color: resource.color, fontSize: compact ? 12 : 14 }}>{value}</Text>
    </View>
  );
}
