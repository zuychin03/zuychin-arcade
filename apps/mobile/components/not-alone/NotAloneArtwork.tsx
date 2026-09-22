import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { NOT_ALONE } from '../../constants/theme';

export function NotAloneMark({ size = 60, color = NOT_ALONE.signal }: { size?: number; color?: string }) {
  return <Svg accessibilityLabel="Not Alone alien signal mark" width={size} height={size} viewBox="0 0 100 100">
    <Circle cx="50" cy="50" r="46" fill={NOT_ALONE.bg} stroke={color} strokeWidth="3"/>
    <Path d="M23 65C31 48 40 40 50 40S69 48 77 65" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"/>
    <Path d="M30 31C40 20 60 20 70 31M21 23C37 6 63 6 79 23" fill="none" stroke={NOT_ALONE.amber} strokeWidth="3" strokeLinecap="round" opacity=".9"/>
    <Path d="M32 57Q40 46 48 58Q40 68 32 57ZM52 58Q60 46 68 57Q60 68 52 58Z" fill={NOT_ALONE.creature}/>
    <Circle cx="50" cy="78" r="4" fill={color}/><Path d="M50 74V64" stroke={color} strokeWidth="3"/>
  </Svg>;
}

export function NotAloneHero({ height = 218 }: { height?: number }) {
  return <Svg accessibilityLabel="Original alien planet rescue signal artwork" width="100%" height={height} viewBox="0 0 420 230">
    <Defs><LinearGradient id="na-sky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#2A1742"/><Stop offset=".56" stopColor="#160D2A"/><Stop offset="1" stopColor={NOT_ALONE.bg}/></LinearGradient></Defs>
    <Rect x="2" y="2" width="416" height="226" rx="24" fill="url(#na-sky)" stroke={NOT_ALONE.border} strokeWidth="2"/>
    <Circle cx="328" cy="47" r="28" fill={NOT_ALONE.amber} opacity=".14"/><Circle cx="328" cy="47" r="19" fill="none" stroke={NOT_ALONE.amber} strokeWidth="2" opacity=".75"/>
    <Path d="M0 168L40 132L73 148L112 101L149 148L191 116L230 151L278 93L319 143L356 118L420 163V230H0Z" fill="#0B0714" stroke={NOT_ALONE.border} strokeWidth="2"/>
    <Path d="M12 190C76 169 132 198 191 181C252 163 311 197 409 171" fill="none" stroke={NOT_ALONE.signal} strokeWidth="3" opacity=".42"/>
    <Path d="M184 160L213 124L243 160L231 177H197Z" fill={NOT_ALONE.surface} stroke={NOT_ALONE.signal} strokeWidth="2.5"/><Path d="M213 124V79" stroke={NOT_ALONE.signal} strokeWidth="3"/>
    <Path d="M196 77C206 67 220 67 230 77M188 67C203 51 223 51 238 67" fill="none" stroke={NOT_ALONE.amber} strokeWidth="2.5" strokeLinecap="round"/>
    <Path d="M73 133Q84 119 96 134Q84 145 73 133ZM105 135Q116 120 128 133Q116 146 105 135Z" fill={NOT_ALONE.creature} opacity=".95"/>
    <Circle cx="84" cy="132" r="2" fill="#FFF4DA"/><Circle cx="116" cy="133" r="2" fill="#FFF4DA"/>
    <Path d="M274 94L286 70L299 94" fill="none" stroke={NOT_ALONE.violet} strokeWidth="2" opacity=".7"/>
  </Svg>;
}
