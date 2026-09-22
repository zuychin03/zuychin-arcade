import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { CITADELS } from '../../constants/theme';

export function CitadelsMark({ size = 60, color = CITADELS.royal }: { size?: number; color?: string }) {
  return <Svg accessibilityLabel="Citadels crowned castle mark" width={size} height={size} viewBox="0 0 100 100">
    <Circle cx="50" cy="50" r="46" fill={CITADELS.bg} stroke={color} strokeWidth="3"/>
    <Path d="M28 42V24H38V34H46V22H55V34H63V24H73V43L68 48V78H32V48Z" fill={CITADELS.surface} stroke={color} strokeWidth="4" strokeLinejoin="round"/>
    <Path d="M43 78V61C43 51 57 51 57 61V78M25 82H75" fill="none" stroke={CITADELS.gold} strokeWidth="4" strokeLinecap="round"/>
    <Circle cx="38" cy="49" r="3" fill={CITADELS.gold}/><Circle cx="62" cy="49" r="3" fill={CITADELS.gold}/>
    <Path d="M35 19L42 10L50 18L58 10L66 19" fill="none" stroke={CITADELS.gold} strokeWidth="3" strokeLinejoin="round"/>
  </Svg>;
}

export function CitadelsHero({ height = 215 }: { height?: number }) {
  return <Svg accessibilityLabel="Original moonlit royal city artwork" width="100%" height={height} viewBox="0 0 420 230">
    <Defs><LinearGradient id="cit-sky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#243762"/><Stop offset="0.55" stopColor="#101A34"/><Stop offset="1" stopColor={CITADELS.bg}/></LinearGradient></Defs>
    <Rect x="2" y="2" width="416" height="226" rx="24" fill="url(#cit-sky)" stroke={CITADELS.border} strokeWidth="2"/>
    <Circle cx="330" cy="48" r="25" fill={CITADELS.gold} opacity="0.16"/><Circle cx="330" cy="48" r="19" fill="none" stroke={CITADELS.gold} strokeWidth="2" opacity="0.75"/>
    <Path d="M12 184L48 156V116H70V139L93 121V78H119V106L146 88V136L177 112V64H203V98L232 78V128L262 101V69H289V101L316 82V125L347 104V145L383 122V184Z" fill="#0B1225" stroke={CITADELS.royal} strokeWidth="2.5" strokeLinejoin="round"/>
    <Path d="M24 184H397V226H24ZM169 184V142H211V184M173 142L190 122L207 142M82 184V154H112V184M303 184V143H336V184" fill="#080C18" stroke={CITADELS.border} strokeWidth="2"/>
    <Path d="M48 116L59 97L70 116M93 78L106 55L119 78M177 64L190 40L203 64M262 69L275 45L289 69M316 82L331 57L347 82" fill={CITADELS.surface} stroke={CITADELS.gold} strokeWidth="2"/>
    {[55,104,190,275,331].map((x) => <Circle key={x} cx={x} cy={x === 190 ? 92 : 132} r="3" fill={CITADELS.gold}/>)}
    <Path d="M14 199C88 184 130 209 198 194C260 180 325 207 408 187" fill="none" stroke={CITADELS.royal} strokeWidth="3" opacity="0.45"/>
  </Svg>;
}
