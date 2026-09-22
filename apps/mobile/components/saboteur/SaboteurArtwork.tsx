import Svg, { Circle, Defs, G, LinearGradient, Line, Path, Rect, Stop } from 'react-native-svg';
import { ARCADE, MINE } from '../../constants/theme';

interface MarkProps {
  size?: number;
  color?: string;
}

export function SaboteurMark({ size = 54, color = MINE.gold }: MarkProps) {
  return (
    <Svg accessibilityLabel="Saboteur crossed pickaxes mark" width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="46" fill={MINE.bg} stroke={color} strokeWidth="3" />
      <Circle cx="50" cy="50" r="38" fill="none" stroke={ARCADE.cyan} strokeOpacity="0.25" strokeWidth="2" strokeDasharray="3 5" />
      <Path d="M31 73 L65 29 M69 73 L35 29" stroke={color} strokeWidth="7" strokeLinecap="round" />
      <Path d="M55 24 Q70 18 79 31 Q65 28 61 38 M45 24 Q30 18 21 31 Q35 28 39 38" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="50" cy="50" r="7" fill={MINE.bg} stroke={ARCADE.cyan} strokeWidth="2" />
    </Svg>
  );
}

interface HeroProps {
  height?: number;
}

export function SaboteurHeroArtwork({ height = 210 }: HeroProps) {
  return (
    <Svg accessibilityLabel="Original neon mine tunnel artwork" width="100%" height={height} viewBox="0 0 420 230" preserveAspectRatio="xMidYMid meet">
      <Defs>
        <LinearGradient id="mine-sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#30213E" />
          <Stop offset="0.55" stopColor="#1E162D" />
          <Stop offset="1" stopColor={MINE.bg} />
        </LinearGradient>
        <LinearGradient id="mine-track" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={MINE.gold} stopOpacity="0" />
          <Stop offset="0.5" stopColor={MINE.gold} stopOpacity="0.7" />
          <Stop offset="1" stopColor={MINE.gold} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="2" y="2" width="416" height="226" rx="24" fill="url(#mine-sky)" stroke={ARCADE.border} strokeWidth="2" />
      <Path d="M24 190 V124 Q24 35 210 25 Q396 35 396 124 V190 Z" fill="#100B1A" stroke="#4A365C" strokeWidth="3" />
      <Path d="M48 190 V130 Q48 60 210 49 Q372 60 372 130 V190" fill="none" stroke={MINE.gold} strokeOpacity="0.28" strokeWidth="3" strokeDasharray="8 10" />
      <Path d="M20 192 H400" stroke="url(#mine-track)" strokeWidth="4" />
      <Path d="M122 211 L177 139 M298 211 L243 139 M143 211 H277" fill="none" stroke="#855B35" strokeWidth="4" strokeLinecap="round" />
      <Line x1="150" y1="197" x2="270" y2="197" stroke="#5F422B" strokeWidth="5" />
      <Line x1="160" y1="184" x2="260" y2="184" stroke="#5F422B" strokeWidth="5" />
      <Line x1="171" y1="170" x2="249" y2="170" stroke="#5F422B" strokeWidth="5" />
      <Path d="M165 183 L179 145 H241 L255 183 Z" fill="#33243F" stroke={MINE.gold} strokeWidth="3" strokeLinejoin="round" />
      <Circle cx="182" cy="185" r="9" fill="#0D0914" stroke={ARCADE.cyan} strokeWidth="3" />
      <Circle cx="238" cy="185" r="9" fill="#0D0914" stroke={ARCADE.cyan} strokeWidth="3" />
      <Path d="M183 145 L195 124 H225 L238 145" fill="#49324F" stroke={MINE.gold} strokeWidth="3" />
      <Path d="M201 137 L210 125 L219 137 L210 145 Z" fill={MINE.gold} opacity="0.9" />
      <G>
        <Rect x="63" y="82" width="52" height="67" rx="7" fill="#241B36" stroke={ARCADE.cyan} strokeOpacity="0.55" strokeWidth="2" />
        <Path d="M71 122 H106 M89 92 V142" stroke={ARCADE.cyan} strokeOpacity="0.45" strokeWidth="3" />
        <Circle cx="89" cy="112" r="7" fill={ARCADE.cyan} opacity="0.55" />
        <Rect x="305" y="82" width="52" height="67" rx="7" fill="#241B36" stroke={MINE.gold} strokeOpacity="0.8" strokeWidth="2" />
        <Path d="M313 122 H348 M331 92 V142" stroke={MINE.gold} strokeOpacity="0.5" strokeWidth="3" />
        <Path d="M322 119 L331 105 L340 119 L331 132 Z" fill={MINE.gold} />
      </G>
      <Path d="M102 52 L120 72 M120 52 L102 72 M300 54 L318 72 M318 54 L300 72" stroke={MINE.gold} strokeWidth="3" strokeLinecap="round" />
      <Circle cx="210" cy="73" r="22" fill={MINE.gold} opacity="0.08" />
      <Path d="M196 86 L223 51 M224 86 L197 51" stroke={MINE.gold} strokeWidth="5" strokeLinecap="round" />
      <Path d="M215 47 Q229 43 237 53 Q225 51 221 59 M205 47 Q191 43 183 53 Q195 51 199 59" fill="none" stroke={MINE.gold} strokeWidth="4" strokeLinecap="round" />
    </Svg>
  );
}