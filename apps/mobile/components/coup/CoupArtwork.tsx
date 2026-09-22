import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { COUP } from '../../constants/theme';

interface MarkProps {
  size?: number;
  color?: string;
}

export function CoupMark({ size = 54, color = COUP.crimson }: MarkProps) {
  return (
    <Svg accessibilityLabel="Coup royal mask mark" width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="46" fill={COUP.bg} stroke={color} strokeWidth="3" />
      <Circle cx="50" cy="50" r="38" fill="none" stroke={COUP.gold} strokeOpacity="0.28" strokeWidth="2" strokeDasharray="3 5" />
      <Path d="M24 39 Q50 24 76 39 L70 66 Q50 80 30 66 Z" fill="#2D1425" stroke={color} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M32 47 Q41 41 47 48 Q39 57 31 52 M68 47 Q59 41 53 48 Q61 57 69 52" fill={COUP.gold} opacity="0.9" />
      <Path d="M40 67 Q50 61 60 67" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <Path d="M34 31 L42 20 L50 31 L59 19 L67 31" fill="none" stroke={COUP.gold} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

interface HeroProps {
  height?: number;
}

export function CoupHeroArtwork({ height = 210 }: HeroProps) {
  return (
    <Svg accessibilityLabel="Original neon royal court artwork" width="100%" height={height} viewBox="0 0 420 230" preserveAspectRatio="xMidYMid meet">
      <Defs>
        <LinearGradient id="court-bg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3B172D" />
          <Stop offset="0.58" stopColor="#241221" />
          <Stop offset="1" stopColor={COUP.bg} />
        </LinearGradient>
        <LinearGradient id="court-glow" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={COUP.crimson} stopOpacity="0" />
          <Stop offset="0.5" stopColor={COUP.crimson} stopOpacity="0.58" />
          <Stop offset="1" stopColor={COUP.crimson} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="2" y="2" width="416" height="226" rx="24" fill="url(#court-bg)" stroke={COUP.border} strokeWidth="2" />
      <Path d="M24 181 H396" stroke="url(#court-glow)" strokeWidth="4" />
      <Path d="M39 181 V67 H75 V181 M345 181 V67 H381 V181" fill="#1A0C16" stroke={COUP.gold} strokeOpacity="0.35" strokeWidth="3" />
      <Path d="M35 67 H79 L70 52 H44 Z M341 67 H385 L376 52 H350 Z" fill="#311828" stroke={COUP.gold} strokeOpacity="0.55" strokeWidth="2" />
      <Path d="M132 184 V91 Q132 62 161 62 H259 Q288 62 288 91 V184" fill="#190C16" stroke={COUP.crimson} strokeOpacity="0.55" strokeWidth="3" />
      <Path d="M151 184 V104 Q151 80 174 80 H246 Q269 80 269 104 V184" fill="#2B1223" stroke={COUP.gold} strokeOpacity="0.35" strokeWidth="2" />
      <Path d="M174 77 L188 51 L210 72 L233 48 L247 77" fill="#3B172D" stroke={COUP.gold} strokeWidth="3" strokeLinejoin="round" />
      <Circle cx="188" cy="56" r="4" fill={COUP.crimson} />
      <Circle cx="233" cy="53" r="4" fill={COUP.crimson} />
      <Path d="M167 113 Q210 89 253 113 L245 151 Q210 176 175 151 Z" fill="#190C16" stroke={COUP.crimson} strokeWidth="4" strokeLinejoin="round" />
      <Path d="M178 122 Q192 112 203 123 Q191 138 177 130 M242 122 Q228 112 217 123 Q229 138 243 130" fill={COUP.gold} opacity="0.9" />
      <Path d="M194 151 Q210 141 226 151" fill="none" stroke={COUP.crimson} strokeWidth="4" strokeLinecap="round" />
      <G opacity="0.9">
        <Rect x="67" y="105" width="56" height="76" rx="8" fill="#281222" stroke={COUP.purple} strokeWidth="2" transform="rotate(-8 95 143)" />
        <Path d="M81 136 Q95 121 109 136 Q95 151 81 136" fill={COUP.purple} opacity="0.75" />
        <Rect x="297" y="105" width="56" height="76" rx="8" fill="#281222" stroke={COUP.blue} strokeWidth="2" transform="rotate(8 325 143)" />
        <Path d="M310 135 H340 M325 120 V151" stroke={COUP.blue} strokeWidth="4" strokeLinecap="round" />
      </G>
      <Circle cx="210" cy="116" r="72" fill="none" stroke={COUP.crimson} strokeOpacity="0.14" strokeWidth="2" strokeDasharray="6 8" />
      <Path d="M40 201 C116 184 163 215 224 198 C290 180 333 208 387 193" fill="none" stroke={COUP.gold} strokeOpacity="0.22" strokeWidth="2" />
    </Svg>
  );
}