import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { SKULL_KING } from '../../constants/theme';

export function SkullKingMark({ size = 58, color = SKULL_KING.teal }: { size?: number; color?: string }) {
  return (
    <Svg accessibilityLabel="Skull King crown and compass mark" width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="46" fill={SKULL_KING.bg} stroke={color} strokeWidth="3" />
      <Path d="M24 35 L34 17 L49 32 L64 16 L77 35 L72 46 H28 Z" fill="none" stroke={SKULL_KING.gold} strokeWidth="4" strokeLinejoin="round" />
      <Path d="M28 53 C28 38 72 38 72 53 C72 67 64 76 55 77 V87 H45 V77 C36 76 28 67 28 53 Z" fill={SKULL_KING.surface} stroke={color} strokeWidth="4" />
      <Circle cx="41" cy="57" r="6" fill={color} /><Circle cx="59" cy="57" r="6" fill={color} />
      <Path d="M44 70 L50 65 L56 70 M40 82 H60" fill="none" stroke={SKULL_KING.gold} strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}

export function SkullKingHero({ height = 210 }: { height?: number }) {
  return (
    <Svg accessibilityLabel="Original moonlit pirate ship artwork" width="100%" height={height} viewBox="0 0 420 230">
      <Defs><LinearGradient id="sk-sea" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#1A2433"/><Stop offset="0.55" stopColor="#0D131E"/><Stop offset="1" stopColor={SKULL_KING.bg}/></LinearGradient></Defs>
      <Rect x="2" y="2" width="416" height="226" rx="24" fill="url(#sk-sea)" stroke={SKULL_KING.border} strokeWidth="2" />
      <Circle cx="324" cy="49" r="28" fill={SKULL_KING.text} opacity="0.12" /><Circle cx="324" cy="49" r="22" fill="none" stroke={SKULL_KING.teal} opacity="0.6" strokeWidth="2" />
      <Path d="M18 175 C69 155 112 189 163 171 C220 151 268 188 316 171 C355 157 385 167 406 158 V228 H18 Z" fill="#071923" />
      <Path d="M14 190 C77 167 120 205 180 184 C234 166 282 200 336 180 C369 168 393 176 412 170" fill="none" stroke={SKULL_KING.cyan} strokeOpacity="0.35" strokeWidth="3" />
      <Path d="M91 165 H312 L285 198 H124 Z" fill="#080B12" stroke={SKULL_KING.gold} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M194 52 V166 M194 60 L286 105 L194 127 Z" fill="#101A29" stroke={SKULL_KING.teal} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M194 67 L119 105 L194 118 Z" fill="#14202F" stroke={SKULL_KING.cyan} strokeWidth="2" />
      <Path d="M183 77 L194 62 L205 77" fill="none" stroke={SKULL_KING.gold} strokeWidth="3" />
      <Circle cx="239" cy="105" r="15" fill={SKULL_KING.bg} stroke={SKULL_KING.gold} strokeWidth="2" />
      <Path d="M231 102 C231 91 247 91 247 102 C247 109 243 113 239 113 C235 113 231 109 231 102 Z M234 116 H244" fill="none" stroke={SKULL_KING.gold} strokeWidth="2" />
      <Path d="M92 165 L70 148 M311 165 L333 145" stroke={SKULL_KING.teal} strokeWidth="4" strokeLinecap="round" />
    </Svg>
  );
}
